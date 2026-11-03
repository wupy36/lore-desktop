import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests load the native Lore library: run them in a forked process, serially.
export default defineConfig({
  resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  test: { include: ["tests/integration/**/*.it.test.ts"], environment: "node", pool: "forks", fileParallelism: false, testTimeout: 60_000 },
});
