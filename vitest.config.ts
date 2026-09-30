import { defineConfig } from "vitest/config";

// Default suite is offline: no browser, no network, no keys.
// Live tests live in packages/*/test/live/ and run only with TYTO_LIVE=1 (npm run test:live).
const live = process.env.TYTO_LIVE === "1";

export default defineConfig({
  test: {
    include: live ? ["packages/*/test/live/**/*.test.ts"] : ["packages/*/test/**/*.test.ts"],
    exclude: live ? [] : ["packages/*/test/live/**", "**/node_modules/**"],
    environment: "node",
    reporters: ["default"],
  },
});
