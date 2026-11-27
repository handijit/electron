import { existsSync, readFileSync } from "node:fs";
import { brotliCompressSync, gzipSync } from "node:zlib";

// What ships to a page or a preload is budgeted; main-process entries are listed for the record.
// The build is not minified (section 11); a program's bundler minifies it.
const OUTPUTS = [
  { file: "build/index.mjs" },
  { file: "build/preload.mjs", budget: 2200 },
  { file: "build/renderer.mjs", budget: 8000 },
  { file: "build/auth-react.mjs", budget: 700 },
  { file: "build/update-react.mjs", budget: 700 },
  { file: "build/update-ui.mjs", budget: 6000 },
  { file: "build/styles.css", budget: 2000 },
  { file: "build/main.mjs" },
  { file: "build/auth.mjs" },
  { file: "build/update.mjs" },
];

const missing = OUTPUTS.filter(({ file }) => !existsSync(file));
if (missing.length > 0) {
  console.error(
    `report-size: missing ${missing.map(({ file }) => file).join(", ")}; run "npm run build" first`
  );
  process.exit(1);
}

const formatBytes = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;

console.log("| File | Raw | Gzip | Brotli | Gzip budget |");
console.log("| --- | --- | --- | --- | --- |");
const over = [];
for (const { file, budget } of OUTPUTS) {
  const content = readFileSync(file);
  const gzip = gzipSync(content, { level: 9 }).length;
  const brotli = brotliCompressSync(content).length;
  console.log(
    `| \`${file}\` | ${formatBytes(content.length)} | ${formatBytes(gzip)} | ${formatBytes(brotli)} | ${budget === undefined ? "-" : formatBytes(budget)} |`
  );
  if (budget !== undefined && gzip > budget)
    over.push(`${file}: ${gzip} B > ${budget} B`);
}

if (over.length > 0) {
  console.error(`\nreport-size: over budget\n${over.join("\n")}`);
  process.exit(1);
}
