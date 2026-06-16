"""
绩效看板路由（只读）。

GET /api/v1/analytics/dashboard?taskId=<可选>
  返回 AI 成本 / Labeler 效能 / AI-人工一致率 三块聚合数据。
  仅 OWNER / ADMIN 可见；纯读取，不改任何业务状态。
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import Actor, require_roles
from app.services import analytics_domain
from app.schemas.analytics import AnalyticsDashboardResponse

router = APIRouter(tags=["analytics"])


@router.get(
    "/analytics/dashboard",
    response_model=AnalyticsDashboardResponse,
    summary="绩效看板：AI 成本 / 标注员效能 / AI-人工一致率（只读聚合）",
)
def get_analytics_dashboard(
    taskId: str | None = Query(None, description="按任务过滤；留空为全局口径"),
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER", "ADMIN")),
) -> AnalyticsDashboardResponse:
    data = analytics_domain.get_dashboard(db, taskId)
    return AnalyticsDashboardResponse(**data)
