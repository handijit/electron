import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // main, preload and the shared code run in node with `electron` mocked; the renderer
    // entry runs in a real DOM.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["__tests__/**/*.test.ts"],
          exclude: ["__tests__/**/*.dom.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["__tests__/**/*.dom.test.ts"],
        },
      },
    ],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      // Type-only files have no behaviour; the logic-free barrels are measured by index.test.ts.
      exclude: [
        "lib/index.ts",
        "lib/main.ts",
        "lib/preload.ts",
        "lib/renderer.ts",
        "lib/types/**",
      ],
      thresholds: { 100: true },
    },
  },
});
