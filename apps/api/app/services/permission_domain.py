"""集中计算任务动作权限：显式拒绝优先，失效授权不参与计算。"""
from datetime import datetime, timezone
from typing import get_args
from uuid import uuid4
from sqlalchemy import or_, and_, select, literal
from sqlalchemy.orm import Session
from app.models.governance import TaskPermissionGrant
from app.models.task import Task
from app.models.user import User
from app.schemas.governance import TaskPermission
from app.middleware.error_handler import PermissionDeniedException, ResourceNotFoundException, ValidationFailedException
from app.services.audit_domain import write_audit_log

PERMISSIONS = get_args(TaskPermission)


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def task_or_404(db, task_id):
    task = db.get(Task, task_id)
    if task is None:
        raise ResourceNotFoundException("任务不存在")
    return task


def permission_filter(actor, action):
    """可直接合入列表查询的权限谓词，避免每个任务再查一次授权。"""
    if actor.role not in ("OWNER", "ADMIN", "LABELER", "REVIEWER") or action not in PERMISSIONS:
        return literal(False)
    owner = and_(Task.owner_id == actor.id, literal(actor.role == "OWNER"))
    admin = literal(actor.role == "ADMIN")
    if action == "permissions.manage":
        return or_(owner, admin)
    conditions = [TaskPermissionGrant.task_id == Task.id, TaskPermissionGrant.user_id == actor.id,
                  TaskPermissionGrant.action == action, TaskPermissionGrant.revoked_at.is_(None),
                  or_(TaskPermissionGrant.expires_at.is_(None), TaskPermissionGrant.expires_at > utcnow())]
    allow = select(TaskPermissionGrant.id).where(*conditions, TaskPermissionGrant.effect == "ALLOW").correlate(Task).exists()
    deny = select(TaskPermissionGrant.id).where(*conditions, TaskPermissionGrant.effect == "DENY").correlate(Task).exists()
    role_default = action == "task.read" or (action == "review.work" and actor.role == "REVIEWER") or (action == "labeling.work" and actor.role == "LABELER")
    return and_(~deny, or_(allow, owner, admin, literal(role_default)))


def has_permission(db: Session, task: Task, actor, action: str) -> bool:
    return db.query(Task.id).filter(Task.id == task.id, permission_filter(actor, action)).first() is not None


def require_permission(db, task_id, actor, action):
    task = task_or_404(db, task_id)
    if not has_permission(db, task, actor, action):
        raise PermissionDeniedException(f"没有执行 {action} 的任务权限")
    return task


def serialize_grant(grant):
    return {"id": grant.id, "taskId": grant.task_id, "userId": grant.user_id, "action": grant.action,
            "effect": grant.effect, "createdBy": grant.created_by, "createdAt": grant.created_at,
            **({"expiresAt": grant.expires_at} if grant.expires_at else {}),
            **({"revokedAt": grant.revoked_at} if grant.revoked_at else {})}


def create_grants(db, task_id, actor, req):
    require_permission(db, task_id, actor, "permissions.manage")
    user = db.get(User, req.userId)
    if user is None or user.status != "ACTIVE" or user.role == "SYSTEM":
        raise ValidationFailedException("授权对象必须是有效人工用户")
    if "permissions.manage" in req.actions:
        raise ValidationFailedException("授权管理权不能转授或通过授权记录撤销")
    expires = req.expiresAt
    if expires:
        if expires.tzinfo is None:
            raise ValidationFailedException("到期时间必须包含时区")
        expires = expires.astimezone(timezone.utc).replace(tzinfo=None)
        if expires <= utcnow():
            raise ValidationFailedException("到期时间必须在未来")
    grants = []
    for action in sorted(set(req.actions)):
        grant = TaskPermissionGrant(id=f"cfg_{uuid4().hex}", task_id=task_id, user_id=user.id,
                                    action=action, effect=req.effect, expires_at=expires, created_by=actor.id)
        db.add(grant)
        write_audit_log(db, entity_type="PERMISSION_GRANT", entity_id=grant.id, action="PERMISSION_GRANTED",
                        actor_id=actor.id, after={"taskId": task_id, "userId": user.id, "action": action, "effect": req.effect})
        grants.append(grant)
    db.commit()
    return [serialize_grant(grant) for grant in grants]


def revoke_grant(db, task_id, grant_id, actor):
    require_permission(db, task_id, actor, "permissions.manage")
    grant = db.query(TaskPermissionGrant).filter_by(id=grant_id, task_id=task_id).with_for_update().first()
    if grant is None:
        raise ResourceNotFoundException("授权记录不存在")
    if grant.revoked_at is None:
        grant.revoked_at = utcnow()
        write_audit_log(db, entity_type="PERMISSION_GRANT", entity_id=grant.id, action="PERMISSION_REVOKED",
                        actor_id=actor.id, after={"taskId": task_id})
        db.commit()
    return serialize_grant(grant)


def allowed_task_ids(db, actor, action):
    return [task.id for task in db.query(Task.id).filter(permission_filter(actor, action)).all()]
