import { setupServer } from "msw/node";
import { handlers } from "../mocks/handlers";

// 测试用 MSW server，复用 dev 同一套契约 handlers（src/mocks/handlers.ts）。
// 不重复维护一份假数据：组件测试看到的响应形状 = 浏览器 dev mock 的形状。
export const server = setupServer(...handlers);
