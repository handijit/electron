import { fileURLToPath } from "node:url";

import { library } from "@handijitcom/config/vitest";
import { mergeConfig } from "vitest/config";

const fromRoot = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));

const lib = fromRoot("./lib/");

// The peer range starts at React 18, so the page tests also run on the copy installed in the
// private react18/ workspace.
const REACT_18 = fromRoot("./react18/node_modules");

// The house preset: tests in node with `electron` mocked, `*.dom.test.*` in jsdom, mocks and
// stubs undone after each test, real timers restored, 100 % coverage of everything but the
// logic-free entry barrels (measured by the public surface tests) and the type-only files.
export default mergeConfig(
  library({
    barrels: [
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
  }),
  {
    resolve: {
      // The published names of this package's entries point at their barrels, as in
      // tsconfig.json.
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
      // Appended to the preset's node and jsdom projects.
      projects: [
        {
          extends: true,
          resolve: {
            alias: [
              { find: /^react$/, replacement: `${REACT_18}/react` },
              { find: /^react\/(.*)$/, replacement: `${REACT_18}/react/$1` },
              { find: /^react-dom$/, replacement: `${REACT_18}/react-dom` },
              {
                find: /^react-dom\/(.*)$/,
                replacement: `${REACT_18}/react-dom/$1`,
              },
              // Their CommonJS builds would require React from the root through Node; the ES
              // module builds go through Vite and meet the aliases above.
              {
                find: /^@testing-library\/react$/,
                replacement: fromRoot(
                  "./node_modules/@testing-library/react/dist/@testing-library/react.esm.js"
                ),
              },
              {
                find: /^react-bootstrap-icons$/,
                replacement: fromRoot(
                  "./node_modules/react-bootstrap-icons/dist/index.js"
                ),
              },
            ],
          },
          test: {
            name: "react18",
            environment: "jsdom",
            env: { REACT_MAJOR: "18" },
            include: ["__tests__/**/*.dom.test.{ts,tsx}"],
            // Processed by Vite, so that their own React imports meet the aliases above; Node
            // would hand them React 19 from the root node_modules.
            server: {
              deps: {
                inline: [
                  /@testing-library\/react/,
                  /@handijitcom\/ui/,
                  /react-bootstrap-icons/,
                ],
              },
            },
          },
        },
      ],
    },
  }
);
