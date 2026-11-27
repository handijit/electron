import { library } from "@handijitcom/config/eslint";

// One layer per entry (section 23): where its code runs decides what it may import, and
// scripts/verify-build.mjs checks the same on the built files.
const ENTRIES = [
  "main",
  "preload",
  "renderer",
  "auth",
  "auth-react",
  "update",
  "update-react",
  "update-ui",
];

// One entry reaches another by its published name, never by a relative path (section 21). The
// preset seals the other layers' folders; this also refuses `../<entry>`, another entry's barrel.
const otherEntries = (own) => ({
  group: ENTRIES.filter((entry) => entry !== own).flatMap((entry) => [
    `../${entry}`,
    `../${entry}/*`,
  ]),
  message:
    "Import another entry by its published name: @handijitcom/electron/<entry>.",
});

const entry = (name, environment, restrict = []) => ({
  environment,
  restrict: [otherEntries(name), ...restrict],
});

export default [
  ...library({
    rootDir: import.meta.dirname,
    react: ["lib/*-react/**/*.ts", "lib/*-ui/**/*.tsx"],
    layers: {
      // Loaded by every process, the sandboxed preload and the page included.
      shared: {
        environment: "shared",
        files: ["lib/index.ts", "lib/shared/**/*.ts"],
        zod: "forbid",
      },
      // The public types name Zod's types; an `import type` leaves nothing at run time.
      types: { environment: "shared", files: ["lib/types/**/*.ts"] },
      main: entry("main", "main"),
      auth: entry("auth", "main"),
      update: entry("update", "main"),
      preload: entry("preload", "preload"),
      renderer: entry("renderer", "renderer"),
      "auth-react": entry("auth-react", "renderer"),
      "update-react": entry("update-react", "renderer", [
        {
          group: ["@handijitcom/ui", "@handijitcom/ui/*"],
          message: "The hook entry stays UI-free; components go in update-ui.",
        },
      ]),
      "update-ui": entry("update-ui", "renderer"),
    },
  }),
  {
    // The logger is the single place of the package that prints, and only to a developer's
    // terminal.
    files: ["lib/main/logger.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["scripts/**/*.mjs"],
    rules: { "no-console": "off" },
  },
];
