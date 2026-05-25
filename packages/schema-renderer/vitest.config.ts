import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
  },
  resolve: {
    alias: {
      "@labelhub/contracts": new URL("../contracts/src/index.ts", import.meta.url).pathname,
      "@labelhub/schema-core": new URL("../schema-core/src/index.ts", import.meta.url).pathname,
    },
  },
});
