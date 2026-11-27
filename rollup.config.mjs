import { readFileSync } from "node:fs";

import typescript from "@rollup/plugin-typescript";
import { dts } from "rollup-plugin-dts";

// One build per entry (section 21): no chunk is shared between entries, so each process loads
// exactly the code written for it.
const ENTRIES = [
  "index",
  "main",
  "preload",
  "renderer",
  "auth",
  "auth-react",
  "update",
  "update-react",
  "update-ui",
];

// Peers, Node's own modules and this package's other entries are never bundled. An entry that
// needs another reaches it by the published name, so a page that loads three entries still has
// one update client and one auth store.
const isExternal = (id) =>
  id === "electron" ||
  id === "zod" ||
  id.startsWith("zod/") ||
  id === "react" ||
  id.startsWith("react/") ||
  id === "@handijitcom/ui" ||
  id.startsWith("@handijitcom/ui/") ||
  id === "@handijitcom/electron" ||
  id.startsWith("@handijitcom/electron/") ||
  id.startsWith("node:");

// TypeScript alone downlevels to the tsconfig target; no Babel anywhere.
const ts = () => typescript({ tsconfig: "./tsconfig.json" });

// The stylesheet of the update components ships as a file the page imports (section 22).
const copyStyles = () => ({
  name: "copy-styles",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "styles.css",
      source: readFileSync("./lib/update-ui/styles.css", "utf8"),
    });
  },
});

const javascript = (entry) => ({
  input: `./lib/${entry}.ts`,
  external: isExternal,
  output: [
    { file: `./build/${entry}.mjs`, format: "es", sourcemap: true },
    {
      file: `./build/${entry}.cjs`,
      format: "cjs",
      exports: "named",
      sourcemap: true,
    },
  ],
  plugins: entry === "update-ui" ? [ts(), copyStyles()] : [ts()],
});

// One bundled declaration per entry, written twice: TypeScript reads the format of a
// declaration file from its extension, so the ESM entry needs a .d.mts next to the .d.ts.
const declarations = (entry) => ({
  input: `./lib/${entry}.ts`,
  external: isExternal,
  output: [
    { file: `./build/${entry}.d.ts`, format: "es" },
    { file: `./build/${entry}.d.mts`, format: "es" },
  ],
  plugins: [dts({ tsconfig: "./tsconfig.json" })],
});

export default [...ENTRIES.map(javascript), ...ENTRIES.map(declarations)];
