import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);
// The real one would add listeners to the test runner's own process.
vi.mock("../../lib/main/capture-uncaught-errors", () => ({
  default: vi.fn(() => () => undefined),
}));

import captureUncaughtErrors from "../../lib/main/capture-uncaught-errors";
import startApp from "../../lib/main/start-app";
import type { StartAppOptions } from "../../lib/main/start-app";
import type { ThemePreference } from "../../lib/types";
import defineContract from "../../lib/shared/define-contract";
import {
  createSession,
  fakeElectron,
  FakeBrowserWindow,
  handlers,
  paths,
  resetElectron,
} from "../helpers/core-electron";

const { app, nativeTheme, powerMonitor, protocol, session } = fakeElectron;

const contract = defineContract({
  invoke: { "notes:count": { output: z.number() } },
  events: { "sync:finished": z.object({ count: z.number() }) },
});

type Link = { noteId: string };

let directory: string;
const platform = Object.getOwnPropertyDescriptor(process, "platform");
const argv = process.argv;

const setPlatform = (value: string): void => {
  Object.defineProperty(process, "platform", { value, configurable: true });
};

const options = (
  overrides: Partial<StartAppOptions<typeof contract, Link>> = {}
): StartAppOptions<typeof contract, Link> => ({
  contract,
  handlers: () => ({ "notes:count": () => 3 }),
  rendererRoot: join(directory, "renderer"),
  window: { preload: "/app/preload.cjs" },
  ...overrides,
});

const deepLink = (overrides: { register?: boolean } = {}) => ({
  scheme: "my-notes",
  parse: vi.fn((url: URL): Link | null =>
    url.hostname === "open" ? { noteId: url.pathname.slice(1) } : null
  ),
  onLink: vi.fn<(link: Link) => void>(),
  register: false as boolean | undefined,
  ...overrides,
});

const logLines = async (): Promise<Record<string, unknown>[]> =>
  (await readFile(join(directory, "logs", "main.log"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const nextTurn = (): Promise<void> =>
  new Promise((done) => {
    setImmediate(done);
  });

beforeEach(async () => {
  resetElectron();
  directory = await mkdtemp(join(tmpdir(), "start-app-"));
  paths.userData = join(directory, "user");
  paths.logs = join(directory, "logs");
  vi.stubEnv("ELECTRON_RENDERER_URL", undefined);
  process.argv = ["electron", "main.js"];
  // An unpackaged app mirrors its log to the terminal; the test output stays clean.
  for (const level of ["debug", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation(() => undefined);
  }
});

afterEach(async () => {
  Object.defineProperty(process, "platform", platform as PropertyDescriptor);
  process.argv = argv;
  await rm(directory, { recursive: true, force: true });
});

describe("startApp", () => {
  test("should quit and resolve null when another instance runs", async () => {
    app.requestSingleInstanceLock.mockReturnValue(false);
    await expect(startApp(options())).resolves.toBeNull();
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(app.whenReady).not.toHaveBeenCalled();
    expect(FakeBrowserWindow.instances).toHaveLength(0);
  });

  test("should set up security before the window, then open it", async () => {
    const beforeWindow = vi.fn(() => {
      expect(FakeBrowserWindow.instances).toHaveLength(0);
      expect(protocol.handle).toHaveBeenCalledWith("app", expect.any(Function));
      expect(handlers.has("notes:count")).toBe(true);
      expect(handlers.has("core-theme:get")).toBe(true);
    });
    const handlerFactory = vi.fn(() => ({ "notes:count": () => 3 }));
    const context = await startApp(
      options({ beforeWindow, handlers: handlerFactory })
    );

    expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledTimes(1);
    expect(captureUncaughtErrors).toHaveBeenCalledTimes(1);
    expect(
      session.defaultSession.setPermissionRequestHandler
    ).toHaveBeenCalled();
    expect(
      session.defaultSession.webRequest.onHeadersReceived
    ).not.toHaveBeenCalled();
    expect(beforeWindow).toHaveBeenCalledWith(context);
    expect(handlerFactory).toHaveBeenCalledWith(context);

    const [window] = FakeBrowserWindow.instances;
    expect(window?.options.webPreferences).toMatchObject({
      preload: "/app/preload.cjs",
      sandbox: true,
    });
    expect(window?.loadURL).toHaveBeenCalledWith("app://bundle/");
    expect(context?.getWindow()).toBe(window);
    expect(context?.policy.devServerUrl).toBeUndefined();
  });

  test("should bring the window to the front and open a new one when it is closed", async () => {
    const context = await startApp(options());
    const [first] = FakeBrowserWindow.instances as [FakeBrowserWindow];

    expect(context?.showWindow()).toBe(first);
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(first.restore).not.toHaveBeenCalled();

    first.minimized = true;
    context?.showWindow();
    expect(first.restore).toHaveBeenCalledTimes(1);

    first.close();
    expect(context?.getWindow()).toBeNull();
    const second = context?.showWindow();
    expect(second).not.toBe(first);
    expect(context?.getWindow()).toBe(second);
  });

  test("should reopen a window on macOS activate only when none is open", async () => {
    await startApp(options());
    app.emit("activate");
    expect(FakeBrowserWindow.instances).toHaveLength(1);

    FakeBrowserWindow.getAllWindows.mockReturnValueOnce([]);
    app.emit("activate");
    expect(FakeBrowserWindow.instances).toHaveLength(2);
  });

  test("should keep the newer window as the main one when an older one closes", async () => {
    const context = await startApp(options());
    const [first] = FakeBrowserWindow.instances as [FakeBrowserWindow];
    FakeBrowserWindow.getAllWindows.mockReturnValueOnce([]);
    app.emit("activate");
    const second = FakeBrowserWindow.instances[1];
    first.close();
    expect(context?.getWindow()).toBe(second);
  });

  test("should quit when the last window closes, except on macOS", async () => {
    await startApp(options());
    setPlatform("win32");
    app.emit("window-all-closed");
    expect(app.quit).toHaveBeenCalledTimes(1);
    setPlatform("darwin");
    app.emit("window-all-closed");
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  test("should hold the first quit until the log is on disk, then quit on the next turn", async () => {
    const context = await startApp(options());
    context?.logger.info("last words");
    const first = { preventDefault: vi.fn() };
    app.emit("before-quit", first);
    app.emit("before-quit", { preventDefault: vi.fn() });
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    expect(app.quit).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1));
    expect((await logLines()).map((line) => line.message)).toContain(
      "last words"
    );

    const later = { preventDefault: vi.fn() };
    app.emit("before-quit", later);
    expect(later.preventDefault).not.toHaveBeenCalled();
  });

  test("should log gone renderer and child processes and a failed load", async () => {
    FakeBrowserWindow.loadFailure = new Error("ERR_FAILED");
    const context = await startApp(options());
    app.emit("render-process-gone", {}, {}, { reason: "crashed", exitCode: 1 });
    app.emit("child-process-gone", {}, { type: "GPU", reason: "oom" });
    await nextTurn();
    await context?.logger.flush();
    const messages = (await logLines()).map((line) => line.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        "A renderer process is gone",
        "A child process is gone",
        "The window failed to load",
      ])
    );
  });

  test("should log a refused IPC call", async () => {
    const context = await startApp(options());
    await expect(
      (handlers.get("core-theme:get") as (event: unknown) => Promise<unknown>)({
        senderFrame: { url: "https://evil.example/" },
      })
    ).rejects.toThrow(/UNTRUSTED_SENDER/);
    await context?.logger.flush();
    expect((await logLines()).at(-1)).toMatchObject({
      level: "warn",
      message: expect.stringContaining("[UNTRUSTED_SENDER] core-theme:get"),
    });
  });

  test("should keep the theme in theme.json by default and re-apply it after sleep", async () => {
    const context = await startApp(options());
    await context?.theme.setPreference("dark");
    expect(
      JSON.parse(await readFile(join(directory, "user", "theme.json"), "utf8"))
    ).toEqual({ theme: "dark" });

    const listener = vi.fn();
    context?.theme.onChange(listener);
    nativeTheme.themeSource = "light";
    powerMonitor.emit("resume");
    powerMonitor.emit("unlock-screen");
    expect(nativeTheme.themeSource).toBe("dark");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("should use the given theme store and window session", async () => {
    const themeStore = {
      get: vi.fn((): ThemePreference => "light"),
      set: vi.fn(),
    };
    const windowSession = createSession();
    await startApp(
      options({
        themeStore,
        window: {
          preload: "/app/preload.cjs",
          webPreferences: { session: windowSession as never },
        },
      })
    );
    expect(nativeTheme.themeSource).toBe("light");
    expect(windowSession.setPermissionRequestHandler).toHaveBeenCalled();
    expect(
      session.defaultSession.setPermissionRequestHandler
    ).not.toHaveBeenCalled();
  });

  test("should load the dev server and give its responses the development policy", async () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173/");
    const context = await startApp(
      options({
        contentSecurityPolicy: { connectSrc: ["https://api.example.com"] },
      })
    );
    expect(context?.policy.devServerUrl).toBe("http://localhost:5173");
    expect(FakeBrowserWindow.instances[0]?.loadURL).toHaveBeenCalledWith(
      "http://localhost:5173/"
    );
    const [filter, listener] = session.defaultSession.webRequest
      .onHeadersReceived.mock.calls[0] as [
      unknown,
      (details: unknown, callback: (response: unknown) => void) => void,
    ];
    expect(filter).toEqual({ urls: ["http://localhost:5173/*"] });
    const callback = vi.fn();
    listener({ responseHeaders: {} }, callback);
    const policy = (
      callback.mock.calls[0]?.[0] as {
        responseHeaders: Record<string, string[]>;
      }
    ).responseHeaders["Content-Security-Policy"]?.[0];
    expect(policy).toContain("'unsafe-inline'");
    expect(policy).toContain("https://api.example.com");
  });

  describe("deep links", () => {
    test("should register the scheme by default, for a packaged and an unpackaged app", async () => {
      app.isPackaged = true;
      await startApp(options({ deepLink: deepLink({ register: undefined }) }));
      expect(app.setAsDefaultProtocolClient).toHaveBeenLastCalledWith(
        "my-notes"
      );

      resetElectron();
      paths.userData = join(directory, "user");
      paths.logs = join(directory, "logs");
      await startApp(options({ deepLink: deepLink({ register: true }) }));
      expect(app.setAsDefaultProtocolClient).toHaveBeenLastCalledWith(
        "my-notes",
        process.execPath,
        [resolve("main.js")]
      );
    });

    test("should register with the scheme only when there is no script", async () => {
      process.argv = ["electron"];
      await startApp(options({ deepLink: deepLink({ register: true }) }));
      expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith("my-notes");
    });

    test("should not register when the installer owns it", async () => {
      await startApp(options({ deepLink: deepLink() }));
      expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    });

    test("should handle the link that started the app on its command line", async () => {
      process.argv = ["app.exe", "my-notes://open/7"];
      const link = deepLink();
      await startApp(options({ deepLink: link }));
      expect(link.onLink).toHaveBeenCalledWith({ noteId: "7" });
    });

    test("should keep links that arrive before the window, bounded, and deliver them after", async () => {
      let ready!: () => void;
      app.whenReady.mockReturnValueOnce(
        new Promise<void>((done) => {
          ready = done;
        })
      );
      const link = deepLink();
      const starting = startApp(options({ deepLink: link }));
      const event = { preventDefault: vi.fn() };
      for (let i = 0; i < 20; i++)
        app.emit("open-url", event, `my-notes://open/${i}`);
      expect(event.preventDefault).toHaveBeenCalledTimes(20);
      expect(link.onLink).not.toHaveBeenCalled();
      ready();
      await starting;
      expect(link.onLink).toHaveBeenCalledTimes(16);
      expect(link.onLink).toHaveBeenLastCalledWith({ noteId: "15" });
    });

    test("should focus the window and deliver a link from macOS or a second launch", async () => {
      const link = deepLink();
      await startApp(options({ deepLink: link }));
      const [window] = FakeBrowserWindow.instances as [FakeBrowserWindow];

      app.emit("open-url", { preventDefault: vi.fn() }, "my-notes://open/1");
      app.emit("second-instance", {}, ["app.exe", "MY-NOTES://open/2"], "/");
      app.emit("second-instance", {}, ["app.exe"], "/");
      expect(link.onLink.mock.calls).toEqual([
        [{ noteId: "1" }],
        [{ noteId: "2" }],
      ]);
      expect(window.focus).toHaveBeenCalledTimes(3);
    });

    test("should ignore a link that does not validate and survive a throwing parser", async () => {
      const link = deepLink();
      const context = await startApp(options({ deepLink: link }));
      const event = { preventDefault: vi.fn() };
      app.emit("open-url", event, "my-notes://delete/everything");
      app.emit("open-url", event, "other-scheme://open/1");
      app.emit("open-url", event, "not a url");
      link.parse.mockImplementationOnce(() => {
        throw new Error("parser bug");
      });
      app.emit("open-url", event, "my-notes://open/3");
      link.onLink.mockImplementationOnce(() => {
        throw new Error("receiver bug");
      });
      app.emit("open-url", event, "my-notes://open/4");

      expect(link.parse).toHaveBeenCalledTimes(3);
      await context?.logger.flush();
      const messages = (await logLines()).map((line) => line.message);
      expect(
        messages.filter(
          (message) => message === "Ignored a deep link that did not validate"
        )
      ).toHaveLength(3);
      expect(
        messages.filter(
          (message) => message === "A deep link could not be handled"
        )
      ).toHaveLength(2);
    });

    test("should only focus on a second launch without deep links, also before the window", async () => {
      let ready!: () => void;
      app.whenReady.mockReturnValueOnce(
        new Promise<void>((done) => {
          ready = done;
        })
      );
      const starting = startApp(options());
      app.emit("second-instance", {}, ["app.exe", "my-notes://open/1"], "/");
      ready();
      await starting;
      const [window] = FakeBrowserWindow.instances as [FakeBrowserWindow];
      app.emit("second-instance", {}, ["app.exe"], "/");
      expect(window.focus).toHaveBeenCalledTimes(1);
    });
  });
});
