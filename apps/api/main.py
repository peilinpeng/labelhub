# FastAPI 应用入口：初始化 app 实例，挂载全局中间件，注册所有路由前缀。
# 路由前缀统一为 /api/v1，对应契约第 23 节 REST API 契约。
from fastapi import FastAPI

app = FastAPI(title="LabelHub API", version="1.0.0")

# TODO: 挂载中间件（auth、idempotency、error_handler）

# TODO: 注册路由
# app.include_router(tasks.router, prefix="/api/v1")
# app.include_router(dataset.router, prefix="/api/v1")
# app.include_router(marketplace.router, prefix="/api/v1")
# app.include_router(assignments.router, prefix="/api/v1")
# app.include_router(ai_review.router, prefix="/api/v1")
# app.include_router(review.router, prefix="/api/v1")
# app.include_router(exports.router, prefix="/api/v1")
# app.include_router(files.router, prefix="/api/v1")


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "labelhub-api"}
