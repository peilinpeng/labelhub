import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./server";

// ── 相对 URL 修正 ──────────────────────────────────────────────────────────
// api/client.ts 用相对路径 fetch("/api/v1/...")。Node 的 undici fetch 不会
// 像浏览器那样基于 location 解析相对 URL，会抛 "Failed to parse URL"。
// 这里把以 "/" 开头的请求补上 jsdom 的 origin，再交给 MSW 拦截（MSW 按路径匹配，
// 与 origin 无关），从而让组件代码零改动地在测试中走真实的 fetch 链路。
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith("/")) {
    return realFetch(`${window.location.origin}${input}`, init);
  }
  return realFetch(input, init);
}) as typeof fetch;

// ── MSW 生命周期 ───────────────────────────────────────────────────────────
// onUnhandledRequest "error"：测试若打到未 mock 的 /api 端点会立刻失败，
// 避免静默落到真实网络或返回 undefined 造成误判。
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});

afterAll(() => server.close());
