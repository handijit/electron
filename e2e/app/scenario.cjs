"use strict";

// The main-process half of the real-Electron smoke test. It starts the fixture app with the
// built package, drives the page and writes one JSON file with every check it made.
// scripts/electron-smoke.mjs spawns it and reads that file.

const { spawn } = require("node:child_process");
const {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require("node:fs");
const { join } = require("node:path");
const { isDeepStrictEqual } = require("node:util");

const {
  app,
  BrowserWindow,
  nativeTheme,
  net,
  powerMonitor,
} = require("electron");

const DIRECTORY = process.env.SMOKE_DIR;
const OUT = process.env.SMOKE_OUT;
const DEV_SERVER = process.env.ELECTRON_RENDERER_URL;
const FOREIGN_URL = "https://example.com/";
const LINK_SCHEME = "handijit-smoke";

const checks = [];
const check = (name, ok, detail) => {
  checks.push({
    name,
    ok: ok === true,
    detail: ok === true ? undefined : detail,
  });
};

const within = (promise, label, milliseconds = 15_000) =>
  Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      setTimeout(
        () => reject(new Error(`timed out waiting for ${label}`)),
        milliseconds
      ).unref();
    }),
  ]);
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const until = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return true;
    await sleep(50);
  }
  check(label, false, "the condition never became true");
  return false;
};

const scenario = async ({ core, shared, design, z }) => {
  const contract = shared.defineContract({
    invoke: {
      "math:add": {
        input: z.object({ a: z.number(), b: z.number() }).strict(),
        output: z.object({ sum: z.number() }),
      },
      "app:info": { output: z.object({ electron: z.string() }) },
    },
    events: { "clock:tick": z.object({ n: z.number().int() }) },
  });
  let addCalls = 0;
  let resolveLink;
  const link = new Promise((resolve) => {
    resolveLink = resolve;
  });

  const context = await core.startApp({
    contract,
    handlers: () => ({
      "math:add": ({ a, b }) => {
        addCalls += 1;
        return { sum: a + b };
      },
      "app:info": () => ({ electron: process.versions.electron }),
    }),
    rendererRoot: join(OUT, "renderer"),
    window: { preload: join(OUT, "preload.cjs"), width: 640, height: 480 },
    contentSecurityPolicy: { scriptHashes: [design.THEME_BOOT_SCRIPT_HASH] },
    log: { level: "debug", mirrorToConsole: false },
    deepLink: {
      scheme: LINK_SCHEME,
      // Registering would make this Electron binary the machine's handler of the scheme.
      register: false,
      parse: (url) =>
        url.hostname === "open" ? { id: url.pathname.slice(1) } : null,
      onLink: (value) => resolveLink(value),
    },
  });
  // The second launch of the single-instance check: it handed over its command line.
  if (context === null) return null;

  const window = context.getWindow();
  const page = window.webContents;
  const evaluate = (code) =>
    within(page.executeJavaScript(code, true), `page: ${code.slice(0, 60)}`);
  // Chromium announces a navigation before will-navigate can cancel it, so the proof is that
  // it never commits and that no request for the foreign page is ever made.
  const origin = DEV_SERVER === undefined ? "app://bundle" : DEV_SERVER;
  const navigations = [];
  page.on("did-navigate", (_event, url) => {
    if (!url.startsWith(`${origin}/`)) navigations.push(url);
  });
  const foreignRequests = [];
  page.session.webRequest.onBeforeRequest(
    { urls: [`${FOREIGN_URL}*`] },
    (details, respond) => {
      foreignRequests.push(details.url);
      respond({ cancel: true });
    }
  );
  if (page.isLoading()) {
    await within(
      new Promise((resolve) => page.once("did-finish-load", resolve)),
      "the first page load"
    );
  }

  // 1. The window.
  const preferences = page.getLastWebPreferences();
  for (const [key, value] of Object.entries(core.ENFORCED_WEB_PREFERENCES)) {
    // Electron reports only the preferences it tracks; an absent one was not turned on.
    if (key in preferences) {
      check(
        `window: webPreferences.${key} is ${value}`,
        preferences[key] === value,
        preferences[key]
      );
    }
  }
  for (const key of ["sandbox", "contextIsolation", "nodeIntegration"]) {
    check(
      `window: Electron reports ${key}`,
      key in preferences,
      Object.keys(preferences)
    );
  }
  check(
    "window: the page is the app",
    page.getURL() === `${origin}/`,
    page.getURL()
  );
  check(
    "window: the renderer has no Node globals",
    (await evaluate("window.__smoke.hasNode")) === false
  );
  const bridge = await evaluate("window.__smoke.bridge()");
  check(
    "preload: the bridge exposes exactly the contract's and the core's channels",
    isDeepStrictEqual(bridge, {
      keys: ["invoke", "on"],
      invoke: [
        "app:info",
        "core-log:write",
        "core-theme:get",
        "core-theme:set",
        "math:add",
      ],
      on: ["clock:tick", "core-theme:changed"],
    }),
    bridge
  );
  check(
    "preload: the Zod-free channel list equals channelsOf(contract)",
    isDeepStrictEqual(shared.channelsOf(contract), {
      invoke: { "math:add": true, "app:info": true },
      events: { "clock:tick": true },
    })
  );

  // 2. The page and its Content-Security-Policy.
  const document = await evaluate("window.__smoke.fetch('/index.html')");
  const expectedPolicy = core.buildContentSecurityPolicy({
    scriptHashes: [design.THEME_BOOT_SCRIPT_HASH],
    devServerUrl: DEV_SERVER,
  });
  check("csp: the document is served", document.status === 200, document);
  check(
    "csp: the header is the built policy",
    document.csp === expectedPolicy,
    document.csp
  );
  check(
    "csp: the hashed theme boot script ran before first paint, in the stored theme",
    (await evaluate("window.__smoke.bootTheme")) === "dark",
    await evaluate("window.__smoke.bootTheme")
  );
  if (DEV_SERVER === undefined) {
    check(
      "csp: nosniff is set",
      document.nosniff === "nosniff",
      document.nosniff
    );
    check(
      "csp: an inline script without a hash is blocked",
      (await evaluate("window.__smoke.inlineRan")) === false
    );
    check(
      "csp: code generation from strings is blocked",
      (await evaluate("window.__smoke.codegen()")) === "EvalError",
      await evaluate("window.__smoke.codegen()")
    );
    const remote = await evaluate(
      `window.__smoke.fetch(${JSON.stringify(FOREIGN_URL)})`
    );
    check(
      "csp: a request to a foreign origin is blocked before it is made",
      "error" in remote && foreignRequests.length === 0,
      { remote, foreignRequests }
    );

    // 3. The app:// handler serves the renderer folder and nothing else.
    for (const path of [
      "/..%2Fsecret.txt",
      "/%2e%2e/secret.txt",
      "/assets/..%2F..%2Fsecret.txt",
      "/missing.js",
    ]) {
      const response = await within(
        net.fetch(`app://bundle${path}`),
        `net.fetch ${path}`
      );
      const body = await response.text();
      check(
        `protocol: ${path} is not served`,
        response.status === 404 && !body.includes("TOP-SECRET"),
        { status: response.status, body: body.slice(0, 80) }
      );
    }
    const otherHost = await within(
      net.fetch("app://other/index.html"),
      "net.fetch other host"
    );
    check(
      "protocol: another host is not served",
      otherHost.status === 404,
      otherHost.status
    );
    const post = await within(
      net.fetch("app://bundle/index.html", { method: "POST", body: "x" }),
      "net.fetch POST"
    );
    check(
      "protocol: only GET and HEAD are answered",
      post.status === 405,
      post.status
    );
    const route = await evaluate("window.__smoke.fetch('/settings/profile')");
    check(
      "protocol: a client-side route falls back to index.html",
      route.status === 200 && route.body.includes("<!doctype html>"),
      route
    );
  } else {
    check(
      "csp: the development policy allows the dev server's inline script and WebSocket",
      expectedPolicy.includes("'unsafe-inline'") &&
        expectedPolicy.includes(DEV_SERVER.replace("http", "ws")) &&
        (await evaluate("window.__smoke.inlineRan")) === true,
      expectedPolicy
    );
  }

  // 4. Typed IPC.
  const sum = await evaluate("window.__smoke.add({ a: 2, b: 3 })");
  check(
    "ipc: a typed round trip answers",
    isDeepStrictEqual(sum, { ok: true, value: { sum: 5 } }),
    sum
  );
  const info = await evaluate("window.__smoke.info()");
  check(
    "ipc: a channel without input answers",
    info.ok === true && info.value.electron === process.versions.electron,
    info
  );
  const callsBefore = addCalls;
  for (const [label, payload] of [
    ["a wrong type", '{ a: "2", b: 3 }'],
    ["an extra key", "{ a: 2, b: 3, admin: true }"],
    ["a missing argument", "undefined"],
  ]) {
    const refused = await evaluate(`window.__smoke.add(${payload})`);
    check(
      `ipc: ${label} is rejected with INVALID_INPUT`,
      refused.ok === false &&
        refused.message.includes("[INVALID_INPUT] math:add"),
      refused
    );
  }
  check(
    "ipc: the handler never ran for an invalid payload",
    addCalls === callsBefore,
    addCalls
  );
  check(
    "ipc: a channel outside the contract cannot be called",
    (await evaluate("typeof window.desktop.invoke['fs:read']")) === "undefined"
  );

  context.emitter.broadcast("clock:tick", { n: 7 });
  await until(
    async () =>
      isDeepStrictEqual(await evaluate("window.__smoke.ticks()"), [{ n: 7 }]),
    "ipc: a typed event reaches the renderer"
  );
  check("ipc: a typed event reaches the renderer", true);
  let invalidEvent = "sent";
  try {
    context.emitter.broadcast("clock:tick", { n: "7" });
  } catch (error) {
    invalidEvent = error.message;
  }
  check(
    "ipc: an event that breaks its schema is not sent",
    invalidEvent.includes("[INVALID_EVENT]"),
    invalidEvent
  );

  // A page that is not the app, even with the same preload, is refused by main.
  const foreign = new BrowserWindow({
    show: false,
    webPreferences: { preload: join(OUT, "preload.cjs"), sandbox: true },
  });
  await within(
    foreign.loadURL("data:text/html,<title>foreign</title>"),
    "the foreign page"
  );
  const stolen = await within(
    foreign.webContents.executeJavaScript(
      "window.desktop.invoke['math:add']({ a: 1, b: 1 }).then(() => 'answered', (error) => error.message)",
      true
    ),
    "the foreign call"
  );
  check(
    "ipc: a call from a foreign page is rejected with UNTRUSTED_SENDER",
    stolen.includes("[UNTRUSTED_SENDER]"),
    stolen
  );
  check(
    "ipc: the handler never ran for a foreign page",
    addCalls === callsBefore + 0,
    addCalls
  );
  check(
    "ipc: an event is not sent to a foreign page",
    context.emitter.send(foreign.webContents, "clock:tick", { n: 1 }) === false
  );
  foreign.destroy();

  // 5. Theme.
  check(
    "theme: the stored preference was applied before the window",
    nativeTheme.themeSource === "dark",
    nativeTheme.themeSource
  );
  await evaluate("window.__smoke.syncTheme()");
  const light = await evaluate("window.__smoke.setTheme('light')");
  check(
    "theme: the renderer sets the preference through main",
    isDeepStrictEqual(light, {
      ok: true,
      value: { preference: "light", resolved: "light" },
    }),
    light
  );
  await until(
    async () =>
      isDeepStrictEqual(await evaluate("window.__smoke.theme()"), {
        attribute: "light",
        prefersDark: false,
      }),
    "theme: the page follows the change"
  );
  check("theme: the page follows the change", true);
  check(
    "theme: nativeTheme follows the change",
    nativeTheme.themeSource === "light",
    nativeTheme.themeSource
  );
  // The design boot script follows prefers-color-scheme, which DevTools emulation (Playwright
  // does it to every page) changes without main changing: the page must stay in main's theme.
  page.debugger.attach("1.3");
  await page.debugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  await sleep(300);
  const emulated = await evaluate("window.__smoke.theme()");
  check(
    "theme: an emulated prefers-color-scheme does not override main's theme",
    isDeepStrictEqual(emulated, { attribute: "light", prefersDark: true }),
    emulated
  );
  page.debugger.detach();
  // After sleep the preference is put back and announced again.
  nativeTheme.themeSource = "dark";
  powerMonitor.emit("resume");
  await until(
    async () =>
      isDeepStrictEqual(await evaluate("window.__smoke.theme()"), {
        attribute: "light",
        prefersDark: false,
      }) && nativeTheme.themeSource === "light",
    "theme: waking from sleep puts the preference back"
  );
  check("theme: waking from sleep puts the preference back", true);
  const stored = JSON.parse(
    readFileSync(join(app.getPath("userData"), "theme.json"), "utf8")
  );
  check("theme: the preference is persisted", stored.theme === "light", stored);
  const refusedTheme = await evaluate("window.__smoke.setTheme('sepia')");
  check(
    "theme: an unknown preference is rejected",
    refusedTheme.ok === false &&
      refusedTheme.message.includes("[INVALID_INPUT]"),
    refusedTheme
  );

  // 6. Log forwarding and redaction.
  await evaluate(
    "window.__smoke.log('renderer line for jane.doe@example.com', { password: 'hunter2', note: 'ok' })"
  );
  await evaluate("window.__smoke.fail('boom from the renderer')");
  const readLog = async () => {
    await context.logger.flush();
    return readdirSync(context.logger.directory)
      .map((file) => readFileSync(join(context.logger.directory, file), "utf8"))
      .join("\n");
  };
  await until(async () => {
    const text = await readLog();
    return (
      text.includes("renderer line for") &&
      text.includes("boom from the renderer")
    );
  }, "log: renderer lines and uncaught renderer errors reach the main log file");
  const logText = await readLog();
  check(
    "log: renderer lines and uncaught renderer errors reach the main log file",
    logText.includes("boom from the renderer")
  );
  check(
    "log: secrets and e-mail addresses are redacted",
    !logText.includes("hunter2") && !logText.includes("jane.doe@example.com"),
    logText.slice(0, 400)
  );

  // 7. Secrets: a real round trip through safeStorage.
  const secrets = core.createSecretStore();
  const available = await within(secrets.isAvailable(), "safeStorage");
  check("secrets: OS encryption is available", available);
  if (available) {
    await within(
      secrets.set("refresh-token", "TOP-SECRET-value"),
      "secrets.set"
    );
    const directory = join(app.getPath("userData"), "secrets");
    const onDisk = readdirSync(directory).map((file) =>
      readFileSync(join(directory, file)).toString("latin1")
    );
    check(
      "secrets: the value is encrypted on disk",
      onDisk.length === 1 && !onDisk[0].includes("TOP-SECRET-value"),
      onDisk.length
    );
    check(
      "secrets: the value reads back",
      (await within(secrets.get("refresh-token"), "secrets.get")) ===
        "TOP-SECRET-value"
    );
    await secrets.delete("refresh-token");
    check(
      "secrets: a deleted value is gone",
      (await secrets.get("refresh-token")) === null
    );
  }

  // 8. Navigation and new windows. Nothing here may reach the network or the system browser.
  const windowsBefore = BrowserWindow.getAllWindows().length;
  check(
    "navigation: window.open is denied",
    (await evaluate(`window.__smoke.open(${JSON.stringify(FOREIGN_URL)})`)) ===
      true
  );
  await evaluate(`window.__smoke.navigate(${JSON.stringify(FOREIGN_URL)})`);
  await sleep(500);
  check(
    "navigation: no window was opened",
    BrowserWindow.getAllWindows().length === windowsBefore,
    BrowserWindow.getAllWindows().length
  );
  check(
    "navigation: leaving the app is prevented",
    page.getURL() === `${origin}/` &&
      navigations.length === 0 &&
      foreignRequests.length === 0,
    { url: page.getURL(), navigations, foreignRequests }
  );
  check(
    "navigation: the page is still alive afterwards",
    isDeepStrictEqual(await evaluate("window.__smoke.add({ a: 1, b: 1 })"), {
      ok: true,
      value: { sum: 2 },
    })
  );

  // 9. Single instance: a second launch quits and hands its deep link to this one.
  const second = spawn(
    process.execPath,
    [process.argv[1], `${LINK_SCHEME}://open/42`],
    { stdio: "ignore" }
  );
  const exitCode = await within(
    new Promise((resolve) => second.once("exit", resolve)),
    "the second instance to quit",
    30_000
  );
  check("single instance: the second launch quits", exitCode === 0, exitCode);
  const received = await within(link, "the deep link of the second launch");
  check(
    "single instance: the running app receives the validated deep link",
    isDeepStrictEqual(received, { id: "42" }),
    received
  );
  check(
    "single instance: there is still one window",
    BrowserWindow.getAllWindows().length === 1
  );

  return context;
};

const run = (dependencies) => {
  app.setName("handijit-electron-smoke");
  app.setPath("userData", join(DIRECTORY, "user-data"));
  mkdirSync(join(DIRECTORY, "logs"), { recursive: true });
  app.setAppLogsPath(join(DIRECTORY, "logs"));
  // The mock keychain keeps macOS from asking for the login keychain; safeStorage still runs.
  if (process.platform === "darwin")
    app.commandLine.appendSwitch("use-mock-keychain");

  scenario(dependencies)
    .then(
      (context) => ({ isPrimary: context !== null, context }),
      (error) => {
        check(
          "the scenario ran to its end",
          false,
          error.stack ?? String(error)
        );
        return { isPrimary: true, context: undefined };
      }
    )
    .then(({ isPrimary, context }) => {
      if (!isPrimary) return;
      const isQuitBySignal = process.env.SMOKE_QUIT_BY === "signal";
      if (isQuitBySignal) {
        // What the quit that a SIGTERM starts reaches: smoke reads it after the exit.
        const quit = { beforeQuit: 0, willQuit: false };
        const record = () =>
          writeFileSync(join(DIRECTORY, "quit.json"), JSON.stringify(quit));
        app.on("before-quit", () => {
          quit.beforeQuit += 1;
          record();
        });
        app.on("will-quit", () => {
          quit.willQuit = true;
          record();
        });
        context?.logger.info("smoke: the last line before the signal");
      }
      writeFileSync(
        join(DIRECTORY, "result.json"),
        JSON.stringify({
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
          platform: `${process.platform}-${process.arch}`,
          checks,
        })
      );
      if (isQuitBySignal) {
        // scripts/electron-smoke.mjs sends the SIGTERM once it reads this line.
        process.stdout.write("smoke: waiting for SIGTERM\n");
        return;
      }
      // A normal quit: it also proves that the log flush on before-quit lets the app end.
      app.quit();
    });
};

module.exports = run;
