import { readFileSync } from "node:fs";

// The exact file list of the tarball: a file that is missing breaks a consumer, a file that
// was not meant to ship (sources, tests, the fixture app) is a leak.
const ENTRIES = ["index", "main", "preload", "renderer"];
const EXTENSIONS = ["cjs", "cjs.map", "d.mts", "d.ts", "mjs", "mjs.map"];
const expected = [
  "package/CHANGELOG.md",
  "package/LICENSE",
  "package/README.md",
  "package/package.json",
  ...ENTRIES.flatMap((entry) =>
    EXTENSIONS.map((extension) => `package/build/${entry}.${extension}`)
  ),
].sort();

const actual = readFileSync(process.argv[2], "utf8")
  .split("\n")
  .filter((line) => line !== "")
  .sort();

const missing = expected.filter((file) => !actual.includes(file));
const unexpected = actual.filter((file) => !expected.includes(file));
if (missing.length > 0 || unexpected.length > 0) {
  throw new Error(
    `The tarball is not what it should be. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`
  );
}

console.log(`Tarball holds exactly its ${actual.length} files OK`);
