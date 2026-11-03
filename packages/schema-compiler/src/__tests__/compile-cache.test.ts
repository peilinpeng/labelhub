import { test } from "node:test";
import assert from "node:assert/strict";
import type { LabelHubSchema } from "@labelhub/contracts";
import { SchemaCompileCache } from "../compile-cache.ts";
import { AsyncSchemaCompiler } from "../compile-worker-client.ts";
import type { CompilerWorker, CompileWorkerRequest, CompileWorkerResponse } from "../compile-worker-client.ts";
const schema: LabelHubSchema = { contractVersion: "1.1", schemaId: "schema_test", status: "DRAFT", meta: { taskId: "task_test", name: "测试", authorId: "usr_test", createdAt: "2026-11-02T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z" }, root: { id: "root", kind: "CONTAINER", type: "container.section", title: "表单", children: [{ id: "field", kind: "FIELD", type: "input.text", title: "字段", name: "answer" }] } };
test("同 ID 内容变更失效，结果和输入不能污染缓存，容量有上限", () => {
  const cache = new SchemaCompileCache(1);
  const input = structuredClone(schema);
  const first = cache.compile(input);
  first.graph.nodes[0]!.title = "污染";
  assert.equal(cache.compile(input).graph.nodes[0]!.title, "字段");
  input.root.children[0]!.title = "新标题";
  assert.equal(cache.compile(input).graph.nodes[0]!.title, "新标题");
  assert.equal(cache.size, 1);
  cache.clear(); assert.equal(cache.size, 0);
  const small = new SchemaCompileCache(20, 1); small.compile(input); assert.equal(small.size, 0);
});
class FakeWorker implements CompilerWorker {
  requests: CompileWorkerRequest[] = [];
  terminated = false;
  message: ((event: MessageEvent<CompileWorkerResponse>) => void) | undefined;
  error: (() => void) | undefined;
  postMessage(request: CompileWorkerRequest) { this.requests.push(request); }
  addEventListener(type: "message" | "error", callback: ((event: MessageEvent<CompileWorkerResponse>) => void) | (() => void)) {
    if (type === "message") this.message = callback as (event: MessageEvent<CompileWorkerResponse>) => void;
    else this.error = callback as () => void;
  }
  terminate() { this.terminated = true; }
}
test("Worker 取消拒绝旧结果，超时回退，卸载终止并拒绝未完成请求", async () => {
  const worker = new FakeWorker(); const compiler = new AsyncSchemaCompiler(() => worker, 10);
  const abort = new AbortController(); const canceled = compiler.compile(schema, abort.signal);
  abort.abort(); await assert.rejects(canceled, { name: "AbortError" });
  const result = await compiler.compile(schema);
  assert.equal(result.graph.nodes[0]!.fieldName, "answer"); assert.equal(worker.terminated, true);
  compiler.dispose(); await assert.rejects(compiler.compile(schema), { name: "AbortError" });
  const nextWorker = new FakeWorker(); const next = new AsyncSchemaCompiler(() => nextWorker);
  const pending = next.compile(schema); next.dispose(); await assert.rejects(pending, { name: "AbortError" });
  assert.equal(nextWorker.terminated, true);
});
test("Worker 并发响应按请求 ID 匹配，错误安全回退", async () => {
  const worker = new FakeWorker(); const compiler = new AsyncSchemaCompiler(() => worker);
  const first = compiler.compile(schema), second = compiler.compile(schema);
  worker.message?.(new MessageEvent<CompileWorkerResponse>("message", { data: { requestId: 2, result: { graph: { nodes: [], edges: [] }, reactionPlan: { reactions: [] } } } }));
  assert.equal((await second).graph.nodes.length, 0);
  worker.error?.(); assert.equal((await first).graph.nodes.length, 1);
  compiler.dispose();
});
