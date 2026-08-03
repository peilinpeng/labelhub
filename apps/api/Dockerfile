# syntax=docker/dockerfile:1.7

ARG PYTHON_VERSION=3.11.13

FROM python:${PYTHON_VERSION}-slim-bookworm AS dependencies

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build
COPY apps/api/requirements.txt ./requirements.txt
RUN python -m pip install \
    --no-compile \
    --prefix=/install \
    --require-hashes \
    --only-binary=:all: \
    -r requirements.txt

FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/usr/local/bin:${PATH}" \
    LOCAL_STORAGE_DIR=/data/files

RUN groupadd --gid 10001 labelhub \
    && useradd --uid 10001 --gid labelhub --create-home --home-dir /home/labelhub labelhub \
    && mkdir -p /app /data/files \
    && chown -R labelhub:labelhub /app /data/files

COPY --from=dependencies /install/ /usr/local/

WORKDIR /app
COPY --chown=labelhub:labelhub apps/api/app/ ./app/
COPY --chown=labelhub:labelhub apps/api/alembic/ ./alembic/
COPY --chown=labelhub:labelhub apps/api/scripts/ ./scripts/
COPY --chown=labelhub:labelhub apps/api/datasets/ ./datasets/
COPY --chown=labelhub:labelhub apps/api/main.py apps/api/alembic.ini ./

USER 10001:10001

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD ["python", "scripts/container_healthcheck.py", "api"]

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3000", "--timeout-graceful-shutdown", "30"]
