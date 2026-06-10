# 全局错误处理中间件：将业务异常（状态迁移冲突、权限拒绝、资源未找到等）
# 统一映射为契约 ApiError 结构（code/message/details/traceId）的 JSON 响应。
# HTTP 状态码约定：409→INVALID_STATE_TRANSITION/IDEMPOTENCY_CONFLICT，
# 403→PERMISSION_DENIED，404→RESOURCE_NOT_FOUND，422→VALIDATION_FAILED。
import uuid
import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 业务异常基类
# ---------------------------------------------------------------------------

class LabelHubException(Exception):
    """所有业务异常的基类。子类必须声明 code 和 status_code。"""

    code: str = "UNKNOWN"
    status_code: int = 400

    def __init__(self, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


# ---------------------------------------------------------------------------
# 业务异常子类（code 值与契约 §3 ErrorCode 完全对齐）
# ---------------------------------------------------------------------------

class UnauthorizedException(LabelHubException):
    """401：未携带或无效 token，契约 §3 ErrorCode PERMISSION_DENIED。"""
    code = "PERMISSION_DENIED"
    status_code = 401


class PermissionDeniedException(LabelHubException):
    """403：角色权限不足，契约 §3 ErrorCode PERMISSION_DENIED。"""
    code = "PERMISSION_DENIED"
    status_code = 403


class ResourceNotFoundException(LabelHubException):
    """404：资源不存在，契约 §3 ErrorCode RESOURCE_NOT_FOUND。"""
    code = "RESOURCE_NOT_FOUND"
    status_code = 404


class ValidationFailedException(LabelHubException):
    """422：业务层参数校验失败，契约 §3 ErrorCode VALIDATION_FAILED。"""
    code = "VALIDATION_FAILED"
    status_code = 422


class InvalidStateTransitionException(LabelHubException):
    """409：非法状态迁移，契约 §3 ErrorCode INVALID_STATE_TRANSITION。"""
    code = "INVALID_STATE_TRANSITION"
    status_code = 409


class IdempotencyConflictException(LabelHubException):
    """409：相同 Idempotency-Key 与不同 body 冲突，契约 §3 ErrorCode IDEMPOTENCY_CONFLICT。"""
    code = "IDEMPOTENCY_CONFLICT"
    status_code = 409


class RevisionConflictException(LabelHubException):
    """409：乐观锁版本冲突，契约 §3 ErrorCode REVISION_CONFLICT。"""
    code = "REVISION_CONFLICT"
    status_code = 409


class SchemaInvalidException(LabelHubException):
    """422：Schema 结构非法，契约 §3 ErrorCode SCHEMA_INVALID。"""
    code = "SCHEMA_INVALID"
    status_code = 422


class SchemaVersionImmutableException(LabelHubException):
    """409：Schema 版本不可变更，契约 §3 ErrorCode SCHEMA_VERSION_IMMUTABLE。"""
    code = "SCHEMA_VERSION_IMMUTABLE"
    status_code = 409


class SchemaDraftConflictException(LabelHubException):
    """409：Schema 草稿冲突，契约 §3 ErrorCode SCHEMA_DRAFT_CONFLICT。"""
    code = "SCHEMA_DRAFT_CONFLICT"
    status_code = 409


class ExportMappingInvalidException(LabelHubException):
    """422：导出映射非法，契约 §3 ErrorCode EXPORT_MAPPING_INVALID。"""
    code = "EXPORT_MAPPING_INVALID"
    status_code = 422


class FileNotReadyException(LabelHubException):
    """409：文件尚未就绪，契约 §3 ErrorCode FILE_NOT_READY。"""
    code = "FILE_NOT_READY"
    status_code = 409


class FilePermissionDeniedException(LabelHubException):
    """403：文件操作权限不足，契约 §3 ErrorCode FILE_PERMISSION_DENIED。"""
    code = "FILE_PERMISSION_DENIED"
    status_code = 403


class ReviewReasonRequiredException(LabelHubException):
    """422：审核必须填写原因，契约 §3 ErrorCode REVIEW_REASON_REQUIRED。"""
    code = "REVIEW_REASON_REQUIRED"
    status_code = 422


class AIReviewFailedException(LabelHubException):
    """500：AI 审核调用失败，契约 §3 ErrorCode AI_REVIEW_FAILED。"""
    code = "AI_REVIEW_FAILED"
    status_code = 500


class SchemaGenerationFailedException(LabelHubException):
    """500：Schema 生成失败，契约 §3 ErrorCode SCHEMA_GENERATION_FAILED。"""
    code = "SCHEMA_GENERATION_FAILED"
    status_code = 500


class LLMAssistFailedException(LabelHubException):
    """502：标注 LLM 辅助调用失败（含超时），上游模型不可用。"""
    code = "LLM_ASSIST_FAILED"
    status_code = 502


# ---------------------------------------------------------------------------
# 注册全局异常处理器
# ---------------------------------------------------------------------------

def register_error_handlers(app: FastAPI) -> None:
    """
    在 FastAPI app 上注册全局异常处理器。
    必须在 main.py 中 add_middleware 之后、include_router 之前调用。
    """

    @app.exception_handler(LabelHubException)
    async def labelhub_exception_handler(
        request: Request, exc: LabelHubException
    ) -> JSONResponse:
        """处理所有业务异常，返回契约 §3 ApiError 结构。"""
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
                "traceId": uuid.uuid4().hex,
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Pydantic v2 请求体校验失败 → 422 VALIDATION_FAILED。"""
        # jsonable_encoder：model_validator/field_validator 抛 ValueError 时，pydantic
        # 会把原始异常对象放进 error 的 ctx 里（不可直接 JSON 序列化），需编码为可序列化
        # 形式，否则 JSONResponse 会抛 TypeError 退化成 500。对齐 FastAPI 默认处理。
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_FAILED",
                "message": "请求参数校验失败",
                "details": jsonable_encoder(exc.errors()),
                "traceId": uuid.uuid4().hex,
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        """
        捕获所有未预期的服务端异常：记录完整日志，返回通用 500，
        不向客户端暴露内部细节（堆栈、SQL、密钥等）。
        """
        logger.exception(
            "未处理的服务端异常 path=%s method=%s",
            request.url.path,
            request.method,
            exc_info=exc,
        )
        return JSONResponse(
            status_code=500,
            content={
                "code": "VALIDATION_FAILED",
                "message": "服务端内部错误，请联系管理员",
                "details": None,
                "traceId": uuid.uuid4().hex,
            },
        )
