# FastAPI 应用入口：初始化 app 实例，挂载全局中间件，注册所有路由前缀。
# 路由前缀统一为 /api/v1，对应契约第 23 节 REST API 契约。
#
# 中间件注册顺序（Starlette LIFO，后加的先执行）：
#   app.add_middleware(IdempotencyMiddleware)  # 第1个加 → 内层，在 AuthMiddleware 之后执行
#   app.add_middleware(AuthMiddleware)          # 第2个加 → 外层，最先执行
# 请求进入顺序：AuthMiddleware → IdempotencyMiddleware → 路由处理函数
# register_error_handlers 必须在 add_middleware 之后、include_router 之前调用。
from fastapi import FastAPI

from app.middleware.auth import AuthMiddleware
from app.middleware.idempotency import IdempotencyMiddleware
from app.middleware.error_handler import register_error_handlers
from app.routers import auth as auth_router

# 其余路由暂未实现，导入后按需解注释
from app.routers import tasks
from app.routers import dataset, marketplace, assignments
from app.routers import review
# from app.routers import ai_review, exports, files

app = FastAPI(title="LabelHub API", version="1.0.0")

# ① 挂载中间件（LIFO：后加的先执行）
app.add_middleware(IdempotencyMiddleware)  # 内层，需要 actor 已被注入
app.add_middleware(AuthMiddleware)          # 外层，先于 IdempotencyMiddleware 执行

# ② 注册全局异常处理器
register_error_handlers(app)

# ③ 注册路由
app.include_router(auth_router.router, prefix="/api/v1")
app.include_router(tasks.router, prefix="/api/v1")
app.include_router(dataset.router, prefix="/api/v1")
app.include_router(marketplace.router, prefix="/api/v1")
app.include_router(assignments.router, prefix="/api/v1")
app.include_router(review.router, prefix="/api/v1")
# app.include_router(ai_review.router, prefix="/api/v1")
# app.include_router(exports.router, prefix="/api/v1")
# app.include_router(files.router, prefix="/api/v1")


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    # 健康检查端点，无需鉴权
    return {"status": "ok", "service": "labelhub-api"}
