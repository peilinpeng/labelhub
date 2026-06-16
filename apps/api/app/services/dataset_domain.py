import io
import json
import os
import uuid

import pandas as pd
from sqlalchemy.orm import Session

from app.config import settings
from app.middleware.error_handler import (
    FileNotReadyException,
    ResourceNotFoundException,
    ValidationFailedException,
)
from app.models.dataset import DatasetItem
from app.models.file import FileObject
from app.models.task import Task
from app.schemas.dataset import (
    ImportDatasetRequest,
    ImportDatasetResponse,
    ImportError,
    DatasetItemResponse,
    ListItemsResponse,
    UpdateDatasetItemRequest,
    BatchUpdateItemsRequest,
)
from app.schemas.task import AuditLogSummaryResponse
from app.services.audit_domain import write_audit_log


def _extract_external_key(record: dict, path: str | None) -> str | None:
    if path is None:
        return None
    try:
        value = record
        for key in path.split("."):
            value = value[key]
        return str(value) if value is not None else None
    except (KeyError, TypeError):
        return None


def _read_file_bytes(storage_key: str) -> bytes:
    file_path = os.path.join(settings.LOCAL_STORAGE_DIR, storage_key)
    if not os.path.exists(file_path):
        raise ValidationFailedException(f"本地文件不存在: {file_path}")
    with open(file_path, "rb") as f:
        return f.read()


def _parse_records(content: bytes, fmt: str) -> tuple[list[dict], list[ImportError]]:
    errors: list[ImportError] = []

    if fmt == "JSON":
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            return [], [ImportError(message=f"JSON 解析失败: {e}")]
        if not isinstance(data, list):
            return [], [ImportError(message="JSON 文件根节点必须是数组")]
        records = []
        for i, item in enumerate(data):
            if not isinstance(item, dict):
                errors.append(ImportError(row=i + 1, message=f"第 {i + 1} 个元素不是对象"))
            else:
                records.append(item)
        return records, errors

    if fmt == "JSONL":
        records = []
        for i, line in enumerate(content.decode("utf-8").splitlines()):
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
                if not isinstance(item, dict):
                    errors.append(ImportError(row=i + 1, message=f"第 {i + 1} 行不是对象"))
                else:
                    records.append(item)
            except json.JSONDecodeError as e:
                errors.append(ImportError(row=i + 1, message=str(e)))
        return records, errors

    if fmt == "EXCEL":
        df = pd.read_excel(io.BytesIO(content), engine="openpyxl")
        df.columns = df.columns.str.strip()
        records = df.where(pd.notna(df), None).to_dict(orient="records")
        return records, errors

    return [], [ImportError(message=f"不支持的格式: {fmt}")]


def import_dataset(
    db: Session, task_id: str, actor: object, req: ImportDatasetRequest
) -> ImportDatasetResponse:
    task = db.query(Task).filter_by(id=task_id).first()
    if not task:
        raise ResourceNotFoundException(f"任务 {task_id!r} 不存在")

    file_obj = db.query(FileObject).filter_by(id=req.fileId).first()
    if not file_obj:
        raise ResourceNotFoundException(f"文件 {req.fileId} 不存在")
    if file_obj.purpose != "DATASET_IMPORT":
        raise ValidationFailedException(
            f"文件用途必须为 DATASET_IMPORT，当前为 {file_obj.purpose}"
        )
    if file_obj.status != "READY":
        raise FileNotReadyException(f"文件尚未就绪，当前状态为 {file_obj.status}")

    content = _read_file_bytes(file_obj.storage_key)
    records, parse_errors = _parse_records(content, req.format)

    existing_keys: set[str] = set(
        row[0]
        for row in db.query(DatasetItem.external_key)
        .filter(DatasetItem.task_id == task_id)
        .filter(DatasetItem.external_key.isnot(None))
        .all()
    )

    imported_count = 0
    skipped_count = 0
    preview_items: list[DatasetItem] = []

    for record in records:
        ext_key = _extract_external_key(record, req.externalKeyPath)
        if ext_key and ext_key in existing_keys:
            skipped_count += 1
            continue
        item = DatasetItem(
            id="item_" + uuid.uuid4().hex,
            task_id=task_id,
            external_key=ext_key,
            source_payload=record,
            status="AVAILABLE",
        )
        db.add(item)
        imported_count += 1
        if len(preview_items) < 5:
            preview_items.append(item)
        if ext_key:
            existing_keys.add(ext_key)

    db.flush()

    log = write_audit_log(
        db,
        entity_type="TASK",
        entity_id=task_id,
        action="DATASET_IMPORTED",
        actor_id=actor.id,
        after={"importedCount": imported_count, "skippedCount": skipped_count},
    )

    db.commit()
    db.refresh(log)
    for item in preview_items:
        db.refresh(item)

    return ImportDatasetResponse(
        taskId=task_id,
        importedCount=imported_count,
        skippedCount=skipped_count,
        failedCount=len(parse_errors),
        previewItems=[DatasetItemResponse.from_orm(i) for i in preview_items],
        errors=parse_errors or None,
        auditLog=AuditLogSummaryResponse.from_orm_obj(log),
    )


def list_items(
    db: Session, task_id: str, actor: object, page: int, page_size: int
) -> ListItemsResponse:
    task = db.query(Task).filter_by(id=task_id).first()
    if not task:
        raise ResourceNotFoundException(f"任务 {task_id!r} 不存在")

    base_q = db.query(DatasetItem).filter(DatasetItem.task_id == task_id)
    total = base_q.count()
    items = (
        base_q.order_by(DatasetItem.created_at.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return ListItemsResponse(
        items=[DatasetItemResponse.from_orm(i) for i in items],
        page=page,
        pageSize=page_size,
        total=total,
    )


def get_item(db: Session, item_id: str, actor: object) -> DatasetItem:
    item = db.query(DatasetItem).filter_by(id=item_id).first()
    if not item:
        raise ResourceNotFoundException(f"题目 {item_id!r} 不存在")
    return item


def update_item(
    db: Session, item_id: str, actor: object, req: UpdateDatasetItemRequest
) -> DatasetItem:
    item = get_item(db, item_id, actor)
    if req.sourcePayload is not None:
        item.source_payload = req.sourcePayload
    if req.status is not None:
        item.status = req.status
    db.commit()
    db.refresh(item)
    return item


def batch_update_items(
    db: Session, task_id: str, actor: object, req: BatchUpdateItemsRequest
) -> list[DatasetItem]:
    """批量编辑题目（§4.1）：对选中题目应用同一 patch。

    - 校验任务存在。
    - 每个 item 必须属于该 task（跨任务/不存在 → 404）。
    - status 仅允许 AVAILABLE/DISABLED（由 schema Literal 保证）。
    - 全部命中后在同一事务提交，返回更新后的题目列表（保持请求 itemIds 顺序）。
    """
    task = db.query(Task).filter_by(id=task_id).first()
    if not task:
        raise ResourceNotFoundException(f"任务 {task_id!r} 不存在")

    items = (
        db.query(DatasetItem)
        .filter(DatasetItem.task_id == task_id, DatasetItem.id.in_(req.itemIds))
        .all()
    )
    found = {it.id: it for it in items}
    missing = [iid for iid in req.itemIds if iid not in found]
    if missing:
        raise ResourceNotFoundException(
            f"以下题目不存在或不属于任务 {task_id!r}：{', '.join(missing)}"
        )

    for it in found.values():
        if req.sourcePayload is not None:
            it.source_payload = req.sourcePayload
        if req.status is not None:
            it.status = req.status

    db.commit()
    ordered = []
    for iid in req.itemIds:
        it = found[iid]
        db.refresh(it)
        ordered.append(it)
    return ordered
