import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

// The layer rule of the package: which entry may import what.
const NODE_AND_ELECTRON = [
  { group: ["node:*"], message: "This layer must run without Node." },
  { group: ["electron"], message: "This layer must run without Electron." },
];
const OTHER_LAYERS = (layers) => ({
  group: layers.map((layer) => `**/${layer}/**`),
  message: "A process layer imports only itself, shared/ and types/.",
});

export default defineConfig([
  globalIgnores(["build/**", "coverage/**", "e2e/out/**"]),
  {
    files: ["**/*.ts", "**/*.mts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "error",
    },
  },
  {
    // The public contract must not be a side effect of type inference.
    files: ["lib/**/*.ts"],
    rules: { "@typescript-eslint/explicit-module-boundary-types": "error" },
  },
  {
    // Pure: loaded by main, preload and renderer alike. Zod is allowed as a type only.
    files: ["lib/index.ts", "lib/shared/**/*.ts", "lib/types/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...NODE_AND_ELECTRON,
            OTHER_LAYERS(["main", "preload", "renderer"]),
            {
              group: ["zod"],
              allowTypeImports: true,
              message: "The shared entry carries no Zod at run time.",
            },
          ],
        },
      ],
    },
  },
  {
    // A sandboxed preload can require `electron` and nothing else.
    files: ["lib/preload.ts", "lib/preload/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["node:*"], message: "A sandboxed preload has no Node." },
            { group: ["zod"], message: "Schemas stay in main." },
            OTHER_LAYERS(["main", "renderer"]),
          ],
        },
      ],
    },
  },
  {
    // A web page: no Node, no Electron, no schemas.
    files: ["lib/renderer.ts", "lib/renderer/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...NODE_AND_ELECTRON,
            { group: ["zod"], message: "Schemas stay in main." },
            OTHER_LAYERS(["main", "preload"]),
          ],
        },
      ],
    },
  },
  {
    files: ["lib/main.ts", "lib/main/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [OTHER_LAYERS(["preload", "renderer"])] },
      ],
    },
  },
  {
    // The logger is the single place allowed to write to the console (development only).
    files: ["lib/main/logger.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Build and release tooling and the Electron fixture: plain scripts that report on the console.
    files: ["**/*.mjs", "**/*.cjs", "**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        window: "readonly",
        document: "readonly",
        location: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
      },
    },
  },
  prettier,
]);
