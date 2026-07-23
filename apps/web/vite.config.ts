import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@labelhub/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@labelhub/schema-core": path.resolve(__dirname, "../../packages/schema-core/src/index.ts"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
      },
      output: {
        // 按依赖切分 vendor chunk，避免单包过大（>500kB 警告）+ 提升缓存命中与首屏加载
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (/[\\/]node_modules[\\/]@formily[\\/]/.test(id)) {
            return "vendor-formily";
          }
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5180,
    proxy: {
      "/api": {
        // 默认 localhost（本机 npm dev）；Docker 下经 VITE_PROXY_TARGET 注入 http://api:3000
        target: process.env.VITE_PROXY_TARGET ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
