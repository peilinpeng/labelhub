from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import Actor, require_roles
from app.services import file_domain
from app.schemas.file import (
    CreateUploadUrlRequest,
    CreateUploadUrlResponse,
    ConfirmUploadRequest,
    ConfirmUploadResponse,
    FileObjectResponse,
)

router = APIRouter(tags=["files"])


@router.post(
    "/files/upload-url",
    response_model=CreateUploadUrlResponse,
    status_code=201,
    summary="生成上传 URL（MVP：返回本地存储接收端点）",
)
def create_upload_url(
    req: CreateUploadUrlRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("LABELER", "OWNER", "ADMIN")),
) -> CreateUploadUrlResponse:
    file_obj, upload_url, expires_at = file_domain.create_upload_url(
        db, actor, req, str(request.base_url)
    )
    return CreateUploadUrlResponse(
        file=FileObjectResponse.from_orm(file_obj),
        uploadUrl=upload_url,
        expiresAt=expires_at,
    )


@router.post(
    "/files/{file_id}/upload",
    include_in_schema=False,
    summary="二进制内容接收端点（MVP 本地存储，不对外暴露于 OpenAPI）",
)
async def upload_file_binary(
    file_id: str,
    request: Request,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("LABELER", "OWNER", "ADMIN")),
):
    content = await request.body()
    file_domain.receive_upload(db, file_id, actor, content)
    return {"status": "UPLOADING", "fileId": file_id}


@router.post(
    "/files/{file_id}/confirm",
    response_model=ConfirmUploadResponse,
    summary="确认上传完成：status→READY，写 FILE_CONFIRMED audit log",
)
def confirm_upload(
    file_id: str,
    req: ConfirmUploadRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("LABELER", "OWNER", "ADMIN")),
) -> ConfirmUploadResponse:
    file_obj = file_domain.confirm_upload(db, file_id, actor, req)
    return ConfirmUploadResponse(file=FileObjectResponse.from_orm(file_obj))


@router.get(
    "/files/{file_id}",
    response_model=FileObjectResponse,
    summary="查询文件元数据",
)
def get_file(
    file_id: str,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("LABELER", "OWNER", "ADMIN", "REVIEWER")),
) -> FileObjectResponse:
    file_obj = file_domain.get_file(db, file_id, actor)
    return FileObjectResponse.from_orm(file_obj)


@router.delete(
    "/files/{file_id}",
    status_code=204,
    summary="软删除文件：status→DELETED，不物理删除",
)
def delete_file(
    file_id: str,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("LABELER", "OWNER", "ADMIN")),
) -> Response:
    file_domain.delete_file(db, file_id, actor)
    return Response(status_code=204)
