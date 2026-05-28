from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import Actor, require_roles
from app.services import dataset_domain
from app.schemas.dataset import (
    ImportDatasetRequest,
    ImportDatasetResponse,
    DatasetItemResponse,
    ListItemsResponse,
    UpdateDatasetItemRequest,
)

router = APIRouter(tags=["dataset"])


@router.post(
    "/tasks/{task_id}/dataset/import",
    response_model=ImportDatasetResponse,
    status_code=201,
    summary="导入数据集（JSON / JSONL / Excel）",
)
def import_dataset(
    task_id: str,
    body: ImportDatasetRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER")),
) -> ImportDatasetResponse:
    """从已上传文件导入数据集（契约 §23.2）。文件必须 purpose=DATASET_IMPORT、status=READY。"""
    return dataset_domain.import_dataset(db, task_id, actor, body)


@router.get(
    "/tasks/{task_id}/items",
    response_model=ListItemsResponse,
    summary="获取题目列表（分页）",
)
def list_items(
    task_id: str,
    page: int = Query(1, ge=1, description="页码，从 1 开始"),
    pageSize: int = Query(20, ge=1, le=200, description="每页数量"),
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER")),
) -> ListItemsResponse:
    return dataset_domain.list_items(db, task_id, actor, page, pageSize)


@router.get(
    "/items/{item_id}",
    response_model=DatasetItemResponse,
    summary="获取题目详情",
)
def get_item(
    item_id: str,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER", "REVIEWER", "LABELER")),
) -> DatasetItemResponse:
    """OWNER / REVIEWER / LABELER 均可访问（契约 §23.2）。"""
    item = dataset_domain.get_item(db, item_id, actor)
    return DatasetItemResponse.from_orm(item)


@router.patch(
    "/items/{item_id}",
    response_model=DatasetItemResponse,
    summary="编辑题目",
)
def update_item(
    item_id: str,
    body: UpdateDatasetItemRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER")),
) -> DatasetItemResponse:
    """更新题目 sourcePayload 或 status（status 仅限 AVAILABLE/DISABLED）。"""
    item = dataset_domain.update_item(db, item_id, actor, body)
    return DatasetItemResponse.from_orm(item)
