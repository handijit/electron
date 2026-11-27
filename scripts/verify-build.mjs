// Checks the built entries the way a process loads them (section 21): each entry imports only
// what its process can load, ESM and CommonJS export the same names, and every path that
// package.json promises exists.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const require = createRequire(import.meta.url);

// What each built entry may import at run time. Everything else is a leak: a page that pulls
// in `electron` or `node:*` breaks, and a sandboxed preload can require `electron` only.
const ALLOWED = {
  index: [],
  preload: ["electron"],
  renderer: [],
  main: ["electron", "zod", "node:*"],
  auth: [
    "electron",
    "zod",
    "node:*",
    "@handijitcom/api-client/pkce",
    "@handijitcom/electron/main",
  ],
  "auth-react": ["react", "@handijitcom/electron/renderer"],
  update: [
    "electron",
    "zod",
    "node:*",
    "@handijitcom/api-client/version",
    "@handijitcom/electron",
    "@handijitcom/electron/main",
  ],
  "update-react": ["react", "@handijitcom/electron/renderer"],
  "update-ui": [
    "react",
    "react/jsx-runtime",
    "@handijitcom/ui",
    "@handijitcom/electron/update-react",
  ],
};

const IMPORT_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
];

const importsOf = (file) => {
  const source = readFileSync(file, "utf8");
  const found = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
};

const isAllowed = (specifier, allowed) =>
  allowed.some((rule) =>
    rule.endsWith("*")
      ? specifier.startsWith(rule.slice(0, -1))
      : specifier === rule
  );

const problems = [];

for (const [entry, allowed] of Object.entries(ALLOWED)) {
  for (const extension of ["mjs", "cjs"]) {
    const file = `build/${entry}.${extension}`;
    if (!existsSync(file)) {
      problems.push(`${file} is missing; run "npm run build" first`);
      continue;
    }
    for (const specifier of importsOf(file)) {
      if (!isAllowed(specifier, allowed)) {
        problems.push(
          `${file} imports "${specifier}", which its process cannot load`
        );
      }
    }
  }
}

// ESM and CommonJS must agree on the names; read from the declaration of each format.
const exportedNames = (file) => {
  const source = readFileSync(file, "utf8");
  const names = new Set();
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (name) names.add(name.replace(/^type\s+/, ""));
    }
  }
  return [...names].sort();
};
for (const entry of Object.keys(ALLOWED)) {
  const esm = exportedNames(`build/${entry}.d.mts`);
  const cjs = exportedNames(`build/${entry}.d.ts`);
  if (JSON.stringify(esm) !== JSON.stringify(cjs)) {
    problems.push(`build/${entry}: the ESM and CommonJS declarations differ`);
  }
}

// The two pure entries load in plain Node: the CommonJS build exports what the ESM build does.
for (const entry of ["index", "renderer"]) {
  const esm = Object.keys(await import(`../build/${entry}.mjs`)).sort();
  const cjs = Object.keys(require(`../build/${entry}.cjs`)).sort();
  if (JSON.stringify(esm) !== JSON.stringify(cjs)) {
    problems.push(
      `build/${entry}: ESM exports ${esm} but CommonJS exports ${cjs}`
    );
  }
}

// Every path package.json promises.
const promised = new Set([pkg.main, pkg.module, pkg.types]);
const walk = (value) => {
  if (typeof value === "string") promised.add(value);
  else if (value && typeof value === "object")
    Object.values(value).forEach(walk);
};
walk(pkg.exports);
walk(pkg.typesVersions);
for (const path of promised) {
  if (!existsSync(path))
    problems.push(`package.json promises ${path}, which does not exist`);
}

if (problems.length > 0) {
  console.error(
    problems.map((problem) => `verify-build: ${problem}`).join("\n")
  );
  process.exit(1);
}
console.log(
  `verify-build: ${Object.keys(ALLOWED).length} entries import only what their process can load`
);
