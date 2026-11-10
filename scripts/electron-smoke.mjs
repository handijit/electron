import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

import { THEME_BOOT_SCRIPT } from "@handijit/design";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";

// Launches a real Electron with the fixture app in e2e/app and the built package, three times:
// with the ES module build, with the CommonJS build, and against a local dev server. The unit
// tests mock `electron`; this is the proof that the real one behaves the way they assume.

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, "..");
const APP = join(ROOT, "e2e/app");
const OUT = join(ROOT, "e2e/out");
const TIMEOUT_MS = 120_000;

if (!existsSync(join(ROOT, "build/main.mjs"))) {
  console.error('electron-smoke: build/ is missing; run "npm run build" first');
  process.exit(1);
}

// `require("electron")` in Node is the path of the binary. It throws when the binary was not
// downloaded, which is the case after `npm ci --ignore-scripts`.
let electronBinary;
try {
  electronBinary = require("electron");
} catch {
  console.error(
    'electron-smoke: the Electron binary is missing; run "node node_modules/electron/install.js" first'
  );
  process.exit(1);
}

// The fixture's preload and renderer are bundled the way an app bundles them: the preload
// into one CommonJS file (a sandboxed preload cannot load a second file), the page as a module.
const bundle = async (input, output) => {
  const build = await rollup({
    input,
    external: ["electron"],
    plugins: [nodeResolve()],
  });
  await build.write(output);
  await build.close();
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "renderer/assets"), { recursive: true });
await bundle(join(APP, "preload.mjs"), {
  file: join(OUT, "preload.cjs"),
  format: "cjs",
});
await bundle(join(APP, "renderer.mjs"), {
  file: join(OUT, "renderer/assets/renderer.js"),
  format: "es",
});
writeFileSync(
  join(OUT, "renderer/index.html"),
  // The CSP hash covers the element's exact content, so the formatter's whitespace around
  // the placeholder goes too.
  readFileSync(join(APP, "index.html"), "utf8").replace(
    /<script>\s*\/\*THEME_BOOT_SCRIPT\*\/\s*<\/script>/,
    () => `<script>${THEME_BOOT_SCRIPT}</script>`
  )
);
// Sits next to the renderer folder: the path traversal checks try to reach it.
writeFileSync(join(OUT, "secret.txt"), "TOP-SECRET");

// What an app's bundles may import, measured on the fixture's own output.
const preloadImports = [
  ...readFileSync(join(OUT, "preload.cjs"), "utf8").matchAll(
    /require\(['"]([^'"]+)['"]\)/g
  ),
].map(([, name]) => name);
const rendererImports = /^\s*import\s/m.test(
  readFileSync(join(OUT, "renderer/assets/renderer.js"), "utf8")
);
const bundleProblems = [];
if (preloadImports.some((name) => name !== "electron")) {
  bundleProblems.push(
    `the bundled preload requires ${preloadImports.join(", ")}`
  );
}
if (rendererImports) bundleProblems.push("the bundled renderer has imports");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
// Stands in for the Vite dev server: plain files over http on the loopback interface.
const startDevServer = () =>
  new Promise((done) => {
    const server = createServer((request, response) => {
      const path = new URL(request.url, "http://localhost").pathname;
      const file = join(
        OUT,
        "renderer",
        path === "/" ? "index.html" : path.slice(1)
      );
      if (!file.startsWith(join(OUT, "renderer")) || !existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response
        .writeHead(200, { "content-type": MIME[extname(file)] ?? "text/plain" })
        .end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => done(server));
  });

const launch = async ({ name, entry, devServerUrl }) => {
  const directory = mkdtempSync(join(tmpdir(), "handijit-electron-smoke-"));
  // A stored preference from an earlier run: the page has to start in it, without a flash.
  mkdirSync(join(directory, "user-data"), { recursive: true });
  writeFileSync(
    join(directory, "user-data/theme.json"),
    JSON.stringify({ theme: "dark" })
  );

  const environment = {
    ...process.env,
    SMOKE_DIR: directory,
    SMOKE_OUT: OUT,
    ELECTRON_ENABLE_LOGGING: "1",
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.ELECTRON_RENDERER_URL;
  if (devServerUrl !== undefined)
    environment.ELECTRON_RENDERER_URL = devServerUrl;

  const child = spawn(electronBinary, [join(APP, entry)], {
    cwd: ROOT,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  const exit = await new Promise((done) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ code: null, timedOut: true });
    }, TIMEOUT_MS);
    child.once("exit", (code) => {
      clearTimeout(timer);
      done({ code, timedOut: false });
    });
  });

  const resultFile = join(directory, "result.json");
  const result = existsSync(resultFile)
    ? JSON.parse(readFileSync(resultFile, "utf8"))
    : { checks: [] };
  const checks = [...result.checks];
  checks.push({
    name: "the app wrote its result and quit normally",
    ok: existsSync(resultFile) && exit.code === 0,
    detail: exit.timedOut
      ? `killed after ${TIMEOUT_MS} ms`
      : `exit code ${exit.code}`,
  });
  rmSync(directory, { recursive: true, force: true });

  const failed = checks.filter(({ ok }) => !ok);
  for (const { name: label, ok, detail } of checks) {
    console.log(`${ok ? "ok  " : "FAIL"} [${name}] ${label}`);
    if (!ok) console.log(`       ${JSON.stringify(detail)}`);
  }
  if (failed.length > 0) console.log(`--- output of [${name}] ---\n${output}`);
  return { ...result, total: checks.length, failed: failed.length };
};

const server = await startDevServer();
const runs = [];
try {
  runs.push(await launch({ name: "esm", entry: "main.mjs" }));
  runs.push(await launch({ name: "cjs", entry: "main.cjs" }));
  runs.push(
    await launch({
      name: "dev",
      entry: "main.mjs",
      devServerUrl: `http://127.0.0.1:${server.address().port}`,
    })
  );
} finally {
  server.close();
}

for (const problem of bundleProblems) console.log(`FAIL [bundle] ${problem}`);
const total = runs.reduce((sum, run) => sum + run.total, 0);
const failed =
  runs.reduce((sum, run) => sum + run.failed, 0) + bundleProblems.length;
const [{ electron, chrome, node, platform }] = runs;

if (failed > 0) {
  console.error(`electron-smoke: ${failed} of ${total} checks FAILED`);
  process.exit(1);
}
console.log(
  `electron-smoke: ${total} checks passed in ${runs.length} launches on Electron ${electron} (Chromium ${chrome}, Node ${node}, ${platform})`
);
