import { compileSchema } from "@labelhub/schema-compiler";
import type { CompileWorkerRequest, CompileWorkerResponse } from "@labelhub/schema-compiler";
self.onmessage = (event: MessageEvent<CompileWorkerRequest>) => {
  let response: CompileWorkerResponse;
  try { response = { requestId: event.data.requestId, result: compileSchema(event.data.schema) }; }
  catch { response = { requestId: event.data.requestId, error: "模板编译失败" }; }
  self.postMessage(response);
};
