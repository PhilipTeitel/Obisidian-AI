import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: resolve(__dirname, "src/__tests__/setup/mockObsidianModule.ts")
    }
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    setupFiles: [
      "src/__tests__/setup/mockObsidianModule.ts",
      "src/__tests__/setup/mockVectorStoreWasm.ts"
    ]
  }
});
