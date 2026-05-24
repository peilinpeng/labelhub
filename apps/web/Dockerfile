FROM node:20-alpine

WORKDIR /workspace

ENV NODE_ENV=development
ENV VITE_API_BASE_URL=http://localhost:3000/api/v1
ENV VITE_ENABLE_MSW=true

EXPOSE 5173

CMD ["sh", "-lc", "if [ -f apps/web/package.json ]; then cd apps/web && npm install && npm run dev -- --host 0.0.0.0; else node -e \"const http=require('node:http'); const port=5173; http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'}); res.end('<!doctype html><html><head><title>LabelHub Web</title></head><body><h1>LabelHub Web 占位服务</h1><p>apps/web 尚未接入 Vite / React。MSW mock 文件已位于 apps/web/src/mocks。</p><p>接入真实前端后，此容器会执行 npm run dev。</p></body></html>');}).listen(port,'0.0.0.0',()=>console.log('LabelHub web 占位服务已启动：http://localhost:'+port));\"; fi"]
