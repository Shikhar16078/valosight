import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __APP_VERSION__: '"test"', __LOCAL_ENGINE__: "true" },
  test: { include: ["src/**/*.test.ts"], environment: "node", setupFiles: ["fake-indexeddb/auto"] },
});
