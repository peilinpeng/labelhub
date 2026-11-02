import type { LabelHubSchema } from "@labelhub/contracts";
import { compileSchema } from "./compile-cache.ts";
import type { CompiledSchema } from "./compile-cache.ts";
export interface CompileWorkerRequest { requestId: number; schema: LabelHubSchema }
export type CompileWorkerResponse = { requestId: number; result: CompiledSchema } | { requestId: number; error: string };
export interface CompilerWorker {
  postMessage(message: CompileWorkerRequest): void;
  addEventListener(type: "message", listener: (event: MessageEvent<CompileWorkerResponse>) => void): void;
  addEventListener(type: "error", listener: () => void): void;
  terminate(): void;
}

/** 一个客户端对应一个 Worker；超时/崩溃回退，取消不产生旧结果，销毁不泄漏监听器。 */
export class AsyncSchemaCompiler {
  private nextId = 0;
  private worker: CompilerWorker | undefined;
  private disposed = false;
  private readonly pending = new Map<number, { finish: (result?: CompiledSchema) => void; cancel: () => void }>();
  constructor(factory?: () => CompilerWorker, private readonly timeoutMs = 5000) {
    try { this.worker = factory?.(); } catch { this.worker = undefined; }
    this.worker?.addEventListener("message", (event) => {
      const message = event.data;
      this.pending.get(message.requestId)?.finish("result" in message ? message.result : undefined);
    });
    this.worker?.addEventListener("error", () => this.fallback());
  }
  compile(schema: LabelHubSchema, signal?: AbortSignal): Promise<CompiledSchema> {
    if (this.disposed || signal?.aborted) return Promise.reject(new DOMException("编译已取消", "AbortError"));
    if (!this.worker) return Promise.resolve().then(() => {
      if (this.disposed || signal?.aborted) throw new DOMException("编译已取消", "AbortError");
      return compileSchema(schema);
    });
    const snapshot = structuredClone(schema);
    return new Promise((resolve, reject) => {
      const requestId = ++this.nextId;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); this.pending.delete(requestId); };
      const cancel = () => { cleanup(); reject(new DOMException("编译已取消", "AbortError")); };
      const finish = (result?: CompiledSchema) => {
        cleanup();
        try { resolve(result ?? compileSchema(snapshot)); } catch (error) { reject(error); }
      };
      const timer = setTimeout(() => this.fallback(), this.timeoutMs);
      this.pending.set(requestId, { finish, cancel });
      signal?.addEventListener("abort", cancel, { once: true });
      try { this.worker!.postMessage({ requestId, schema: snapshot }); } catch { this.fallback(); }
    });
  }
  private fallback(): void {
    this.worker?.terminate(); this.worker = undefined;
    for (const pending of [...this.pending.values()]) pending.finish();
  }
  dispose(): void {
    this.disposed = true;
    this.worker?.terminate(); this.worker = undefined;
    for (const pending of [...this.pending.values()]) pending.cancel();
  }
}
