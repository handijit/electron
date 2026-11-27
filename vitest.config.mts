import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const lib = fileURLToPath(new URL("./lib/", import.meta.url));

export default defineConfig({
  resolve: {
    // The published names of this package's entries point at their barrels, as in tsconfig.json.
    alias: [
      {
        find: /^@handijitcom\/electron$/,
        replacement: `${lib}index.ts`,
      },
      {
        find: /^@handijitcom\/electron\/(.+)$/,
        replacement: `${lib}$1.ts`,
      },
    ],
  },
  test: {
    // Main-process code runs in node with `electron` mocked; page code runs in a real DOM.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["__tests__/**/*.test.ts"],
          exclude: [
            "__tests__/**/*.dom.test.ts",
            "__tests__/**/*.dom.test.tsx",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: [
            "__tests__/**/*.dom.test.ts",
            "__tests__/**/*.dom.test.tsx",
          ],
        },
      },
    ],
    // Call history must not leak between tests: a module mock created once per file is shared by
    // every test in it.
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "lib/**/*.tsx"],
      // Type-only files have no behaviour; the logic-free barrels are measured by the public
      // surface tests.
      exclude: [
        "lib/index.ts",
        "lib/main.ts",
        "lib/preload.ts",
        "lib/renderer.ts",
        "lib/auth.ts",
        "lib/auth-react.ts",
        "lib/update.ts",
        "lib/update-react.ts",
        "lib/update-ui.ts",
        "lib/types/**",
      ],
      thresholds: { 100: true },
    },
  },
});
