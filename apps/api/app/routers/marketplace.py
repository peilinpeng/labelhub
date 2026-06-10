from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import Actor, require_roles
from app.services import assignment_domain
from app.schemas.assignment import MarketplaceResponse

router = APIRouter(tags=["marketplace"])


@router.get(
    "/marketplace/tasks",
    response_model=MarketplaceResponse,
    summary="任务广场：获取可领取任务列表",
)
def list_marketplace_tasks(
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    keyword: str | None = Query(None, description="按标题/描述模糊搜索"),
    status: str | None = Query(None, description="按任务状态筛选（广场仅 PUBLISHED 可见）"),
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("LABELER")),
) -> MarketplaceResponse:
    return assignment_domain.get_marketplace_tasks(db, actor, page, pageSize, keyword, status)
