FROM node:20-alpine

WORKDIR /workspace

ENV NODE_ENV=development
ENV DATABASE_URL=mysql://labelhub:labelhub@mysql:3306/labelhub
ENV REDIS_URL=redis://redis:6379
ENV FILE_STORAGE_DRIVER=local
ENV LOCAL_STORAGE_DIR=/workspace/.storage/files

EXPOSE 3000

CMD ["sh", "-lc", "mkdir -p \"$LOCAL_STORAGE_DIR\" && if [ -f apps/api/package.json ]; then cd apps/api && npm install && npm run dev; else node -e \"const http=require('node:http'); const port=3000; http.createServer((req,res)=>{res.setHeader('content-type','application/json; charset=utf-8'); if(req.url==='/api/v1/health'){res.end(JSON.stringify({status:'ok', service:'labelhub-api-placeholder'})); return;} res.statusCode=501; res.end(JSON.stringify({code:'RESOURCE_NOT_FOUND', message:'LabelHub API 占位服务：apps/api 尚未实现真实后端', traceId:'trace_placeholder'}));}).listen(port,'0.0.0.0',()=>console.log('LabelHub API 占位服务已启动：http://localhost:'+port));\"; fi"]
