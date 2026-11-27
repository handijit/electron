import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

// What a page or a sandboxed preload cannot load (section 23). scripts/verify-build.mjs checks
// the same on the built files.
const NODE_AND_ELECTRON = [
  { name: "electron", message: "Page code has no access to Electron." },
  { name: "zod", message: "Page code checks payloads without Zod." },
];
const NODE_PATTERN = {
  group: ["node:*"],
  message: "Page and preload code cannot load Node modules.",
};
// One entry reaches another by its published name, never by a relative path (section 21).
const OTHER_ENTRY_FOLDERS = (own) => ({
  group: [
    "main",
    "preload",
    "renderer",
    "auth",
    "auth-react",
    "update",
    "update-react",
    "update-ui",
  ]
    .filter((folder) => folder !== own)
    .flatMap((folder) => [`../${folder}/*`, `../${folder}`]),
  message:
    "Import another entry by its published name: @handijitcom/electron/<entry>.",
});

const entryRules = (folder, { isPage = false, isPreload = false } = {}) => ({
  files: [`lib/${folder}/**/*.ts`, `lib/${folder}/**/*.tsx`],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: isPage
          ? NODE_AND_ELECTRON
          : isPreload
            ? [NODE_AND_ELECTRON[1]]
            : [],
        patterns: [
          OTHER_ENTRY_FOLDERS(folder),
          ...(isPage || isPreload ? [NODE_PATTERN] : []),
        ],
      },
    ],
  },
});

export default defineConfig([
  globalIgnores(["build/**", "coverage/**"]),
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "error",
    },
  },
  {
    // The public contract must not be a side effect of type inference.
    files: ["lib/**/*.ts", "lib/**/*.tsx"],
    rules: { "@typescript-eslint/explicit-module-boundary-types": "error" },
  },
  entryRules("main"),
  entryRules("auth"),
  entryRules("update"),
  entryRules("preload", { isPreload: true }),
  entryRules("renderer", { isPage: true }),
  entryRules("auth-react", { isPage: true }),
  entryRules("update-react", { isPage: true }),
  entryRules("update-ui", { isPage: true }),
  {
    // Shared code is loaded by every process, the sandboxed preload and the page included.
    files: ["lib/shared/**/*.ts", "lib/index.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: NODE_AND_ELECTRON, patterns: [NODE_PATTERN] },
      ],
    },
  },
  {
    // The logger is the single place of the package that prints, and only to a developer's
    // terminal.
    files: ["lib/main/logger.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
    rules: { "no-console": "off" },
  },
  prettier,
]);
