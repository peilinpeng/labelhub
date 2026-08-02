# syntax=docker/dockerfile:1.7

FROM node:20.20.2-alpine AS builder

WORKDIR /workspace

# 共享包与 Web 各自使用锁文件安装；源码变化不会绕过 npm ci 的确定性校验。
COPY package.json package-lock.json ./
COPY packages/ ./packages/
RUN npm ci

COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN npm ci --prefix apps/web

COPY apps/web/ ./apps/web/

ARG VITE_DEMO_MODE=false
ARG VITE_ENABLE_MSW=false
ENV VITE_DEMO_MODE=${VITE_DEMO_MODE}
ENV VITE_ENABLE_MSW=${VITE_ENABLE_MSW}

RUN npm run build --prefix apps/web \
    && rm -f apps/web/dist/mockServiceWorker.js

FROM nginxinc/nginx-unprivileged:1.27.5-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder --chown=101:101 /workspace/apps/web/dist/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
