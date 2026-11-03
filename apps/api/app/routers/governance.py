"""迁移审批与任务授权接口。所有操作使用服务端权限和状态机。"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import Actor, get_current_actor
from app.models.governance import MigrationJob, MigrationRecord, TaskPermissionGrant
from app.schemas.governance import CreateMigrationJobRequest, MigrationDecisionRequest, CreateTaskPermissionRequest
from app.services import migration_domain as migration, permission_domain as permission

router = APIRouter(prefix="/tasks/{task_id}", tags=["governance"])


@router.get("/permissions/me")
def my_permissions(task_id: str, db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
    task = permission.task_or_404(db, task_id)
    return {"taskId": task_id, "permissions": [action for action in permission.PERMISSIONS if permission.has_permission(db, task, actor, action)]}


@router.get("/permissions")
def list_permissions(task_id: str, db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
    permission.require_permission(db, task_id, actor, "permissions.manage")
    return {"grants": [permission.serialize_grant(row) for row in db.query(TaskPermissionGrant).filter_by(task_id=task_id).order_by(TaskPermissionGrant.created_at.desc()).all()]}


@router.post("/permissions", status_code=201)
def grant_permissions(task_id: str, req: CreateTaskPermissionRequest, db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
    return {"grants": permission.create_grants(db, task_id, actor, req)}


@router.post("/permissions/{grant_id}/revoke")
def revoke_permission(task_id: str, grant_id: str, db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
    return permission.revoke_grant(db, task_id, grant_id, actor)


@router.get("/migrations")
def list_migrations(task_id: str, page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100), db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
    permission.require_permission(db, task_id, actor, "migration.read")
    query = db.query(MigrationJob).filter_by(task_id=task_id)
    rows = query.order_by(MigrationJob.created_at.desc(), MigrationJob.id).offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [migration.serialize_job(row) for row in rows], "total": query.count(), "page": page, "pageSize": pageSize}


@router.post("/migrations", status_code=201)
def create_migration(task_id: str, req: CreateMigrationJobRequest, db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
    return migration.serialize_job(migration.create_job(db, task_id, actor, req))


@router.get("/migrations/{job_id}")
def get_migration(task_id: str, job_id: str, db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
    return migration.serialize_job(migration.get_job(db, task_id, job_id, actor))


@router.post("/migrations/{job_id}/dry-run")
def dry_run(task_id: str, job_id: str, db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
    job = migration.get_job(db, task_id, job_id, actor, "migration.plan", lock=True)
    return migration.serialize_job(migration.dry_run(db, job, actor))


def add_command_route(name, action, decision_required=False):
    if decision_required:
        def endpoint(task_id: str, job_id: str, req: MigrationDecisionRequest, db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
            job = migration.get_job(db, task_id, job_id, actor, action, lock=True)
            return migration.serialize_job(migration.command(db, job, actor, name, req))
    else:
        def endpoint(task_id: str, job_id: str, db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
            job = migration.get_job(db, task_id, job_id, actor, action, lock=True)
            return migration.serialize_job(migration.command(db, job, actor, name))
    endpoint.__name__ = f"migration_{name}"
    router.add_api_route(f"/migrations/{{job_id}}/{name}", endpoint, methods=["POST"])


for name, action in [("submit", "migration.plan"), ("approve", "migration.approve"), ("reject", "migration.approve"),
                     ("execute", "migration.execute"), ("retry", "migration.execute"), ("cancel", "migration.plan")]:
    add_command_route(name, action, name in ("approve", "reject"))


@router.get("/migrations/{job_id}/records")
def records(task_id: str, job_id: str, page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100), db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
    migration.get_job(db, task_id, job_id, actor)
    query = db.query(MigrationRecord).filter_by(job_id=job_id)
    return {"items": [migration.serialize_record(row) for row in query.order_by(MigrationRecord.submission_id).offset((page - 1) * pageSize).limit(pageSize).all()],
            "total": query.count(), "page": page, "pageSize": pageSize}

# 跨角色的治理工作台只发现具有治理权限的任务。
discovery_router = APIRouter(tags=["governance"])


@discovery_router.get("/governance/tasks")
def governance_tasks(db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
    from app.models.task import Task
    from app.schemas.task import TaskResponse
    from sqlalchemy import or_
    tasks = db.query(Task).filter(or_(permission.permission_filter(actor, "migration.read"), permission.permission_filter(actor, "permissions.manage"))).order_by(Task.created_at.desc()).all()
    return {"items": [TaskResponse.from_orm(task) for task in tasks]}


@router.get("/migration-candidates")
def migration_candidates(task_id: str, schemaVersionId: str, page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100), db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
    from app.models.schema import SchemaVersion
    from app.models.submission import Submission
    from app.middleware.error_handler import ResourceNotFoundException
    permission.require_permission(db, task_id, actor, "migration.read")
    version = db.get(SchemaVersion, schemaVersionId)
    if not version or version.task_id != task_id:
        raise ResourceNotFoundException("源版本不存在于当前任务")
    query = db.query(Submission).filter_by(task_id=task_id, schema_version_id=schemaVersionId)
    return {"items": [{"id": row.id, "schemaVersionId": row.schema_version_id, "labelerId": row.labeler_id, "status": row.status, "createdAt": migration.iso(row.created_at)}
                      for row in query.order_by(Submission.created_at.desc(), Submission.id).offset((page - 1) * pageSize).limit(pageSize).all()],
            "total": query.count(), "page": page, "pageSize": pageSize}
