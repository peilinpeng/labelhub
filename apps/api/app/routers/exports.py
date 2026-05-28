import os

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import Actor, require_roles
from app.services import export_domain
from app.schemas.export import (
    CreateExportJobRequest,
    CreateExportJobResponse,
    GetExportJobResponse,
    ListExportJobsResponse,
    DownloadExportResponse,
    ExportJobResponse,
    AuditLogSummary,
    FileObjectResponse,
)

router = APIRouter(tags=["exports"])


@router.post(
    "/tasks/{task_id}/exports",
    response_model=CreateExportJobResponse,
    status_code=201,
    summary="创建导出任务（异步，立即返回 PENDING 状态的 ExportJob）",
)
def create_export_job(
    task_id: str,
    req: CreateExportJobRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER", "ADMIN")),
) -> CreateExportJobResponse:
    job, log = export_domain.create_export_job(db, task_id, actor, req)
    return CreateExportJobResponse(
        exportJob=ExportJobResponse.from_orm(job),
        auditLog=AuditLogSummary.from_orm(log),
    )


@router.get(
    "/tasks/{task_id}/exports",
    response_model=ListExportJobsResponse,
    summary="导出历史：查询任务的所有导出记录",
)
def list_export_jobs(
    task_id: str,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER", "ADMIN")),
) -> ListExportJobsResponse:
    jobs, total = export_domain.list_export_jobs(db, task_id, actor, page, pageSize)
    return ListExportJobsResponse(
        exportJobs=[ExportJobResponse.from_orm(j) for j in jobs],
        total=total,
        page=page,
        pageSize=pageSize,
    )


@router.get(
    "/exports/{export_job_id}",
    response_model=GetExportJobResponse,
    summary="导出状态：查询指定导出任务详情",
)
def get_export_job(
    export_job_id: str,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER", "ADMIN")),
) -> GetExportJobResponse:
    job = export_domain.get_export_job(db, export_job_id, actor)
    return GetExportJobResponse(exportJob=ExportJobResponse.from_orm(job))


@router.get(
    "/exports/{export_job_id}/download",
    response_model=DownloadExportResponse,
    summary="下载信息：获取已完成导出任务的下载 URL（本地存储 MVP）",
)
def get_download_info(
    export_job_id: str,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER", "ADMIN")),
) -> DownloadExportResponse:
    job, file_obj, download_url, expires_at = export_domain.get_download_info(
        db, export_job_id, actor
    )
    return DownloadExportResponse(
        exportJob=ExportJobResponse.from_orm(job),
        file=FileObjectResponse.from_orm(file_obj),
        downloadUrl=download_url,
        expiresAt=expires_at,
    )


@router.get(
    "/exports/{export_job_id}/download/file",
    summary="文件下载：直接流式返回导出文件（本地存储 MVP）",
    include_in_schema=False,
)
def download_export_file(
    export_job_id: str,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER", "ADMIN")),
):
    from app.config import settings
    from app.middleware.error_handler import ResourceNotFoundException
    from app.models.file import FileObject

    job = export_domain.get_export_job(db, export_job_id, actor)
    if not job.file_id:
        raise ResourceNotFoundException("导出文件不存在")

    file_obj = db.query(FileObject).filter_by(id=job.file_id).first()
    if not file_obj:
        raise ResourceNotFoundException("文件记录不存在")

    file_path = os.path.join(settings.LOCAL_STORAGE_DIR, file_obj.storage_key)
    if not os.path.exists(file_path):
        raise ResourceNotFoundException(f"文件不存在于本地存储: {file_path}")

    return FileResponse(
        path=file_path,
        media_type=file_obj.mime_type,
        filename=os.path.basename(file_path),
    )
