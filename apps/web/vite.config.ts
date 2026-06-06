import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
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
