import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/test/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
    // Long timeout for live browser tests
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
