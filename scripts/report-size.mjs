import { existsSync, readFileSync } from "node:fs";
import { brotliCompressSync, gzipSync } from "node:zlib";

const OUTPUTS = [
  "build/index.mjs",
  "build/index.cjs",
  "build/main.mjs",
  "build/main.cjs",
  "build/preload.mjs",
  "build/preload.cjs",
  "build/renderer.mjs",
  "build/renderer.cjs",
];

// The preload runs before every page load and the renderer entry ships inside the app's
// page bundle; the budgets guard those two. main is loaded once, from disk.
const GZIP_BUDGETS = {
  "build/preload.cjs": 2000,
  "build/renderer.mjs": 2500,
  "build/index.mjs": 2000,
};

const missing = OUTPUTS.filter((file) => !existsSync(file));
if (missing.length > 0) {
  console.error(
    `report-size: missing ${missing.join(", ")}; run "npm run build" first`
  );
  process.exit(1);
}

const formatBytes = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;

const rows = OUTPUTS.map((file) => {
  const content = readFileSync(file);
  return {
    file,
    raw: content.length,
    gzip: gzipSync(content, { level: 9 }).length,
    brotli: brotliCompressSync(content).length,
  };
});

console.log("| File | Raw | Gzip | Brotli |");
console.log("| --- | --- | --- | --- |");
for (const { file, raw, gzip, brotli } of rows) {
  console.log(
    `| \`${file}\` | ${formatBytes(raw)} | ${formatBytes(gzip)} | ${formatBytes(brotli)} |`
  );
}

let failed = false;
console.log("");
for (const [file, budget] of Object.entries(GZIP_BUDGETS)) {
  const { gzip } = rows.find((row) => row.file === file);
  const verdict = gzip <= budget ? "within" : "OVER";
  console.log(`${file}: ${gzip} B gzip, ${verdict} the ${budget} B budget`);
  if (gzip > budget) failed = true;
}

if (failed) process.exit(1);
