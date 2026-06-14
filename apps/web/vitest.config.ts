import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// 前端单元/组件测试配置。
// 与 vite.config.ts 的 alias 保持镜像，确保测试里 @labelhub/* 解析到源码而非构建产物。
// 测试后端复用 src/mocks 的 MSW handlers（见 src/test/server.ts），与 dev mock 同源。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@labelhub/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@labelhub/schema-core": path.resolve(__dirname, "../../packages/schema-core/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // 仅纳入 src 下的测试，排除 e2e（Playwright 独立运行）。
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "e2e", "dist"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/features/**", "src/api/**", "src/app/**"],
    },
  },
});
