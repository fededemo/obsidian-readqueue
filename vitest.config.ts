import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "happy-dom",
    alias: {
      obsidian: resolve(__dirname, "tests/setup/obsidian-mock.ts"),
    },
  },
});
