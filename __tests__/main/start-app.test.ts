import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Session } from "electron";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import startApp from "../../lib/main/start-app";
import type {
  AppContext,
  DeepLinkOptions,
  StartAppOptions,
} from "../../lib/main/start-app";
import type { ThemePreferenceStore } from "../../lib/main/theme-bridge";
import type { Contract } from "../../lib/types";

/**
 * Only `electron` is mocked: the real protocol, session-guard, IPC, theme, logger and window
 * modules run against it, so these tests exercise the wiring itself. Every mock that matters
 * for the boot order appends its name to `calls`.
 */
const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const path = await import("node:path");

  type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
  type ProtocolHandler = (request: Request) => Promise<Response>;

  const calls: string[] = [];
  const state = {
    root: "",
    hasLock: true,
    isPackaged: false,
    ready: Promise.resolve(),
    themeSource: "system",
    osIsDark: false,
    loadError: undefined as unknown,
    windows: [] as FakeBrowserWindow[],
    ipcHandlers: new Map<string, IpcHandler>(),
    protocolHandlers: new Map<string, ProtocolHandler>(),
  };

  class FakeApp extends EventEmitter {
    get isPackaged(): boolean {
      return state.isPackaged;
    }
    readonly requestSingleInstanceLock = (): boolean => {
      calls.push("app.requestSingleInstanceLock");
      return state.hasLock;
    };
    readonly whenReady = (): Promise<void> => {
      calls.push("app.whenReady");
      return state.ready;
    };
    readonly getPath = (name: string): string => path.join(state.root, name);
    readonly quit = vi.fn(() => {
      calls.push("app.quit");
    });
    readonly exit = vi.fn();
    readonly setAsDefaultProtocolClient = vi.fn<
      (scheme: string, executable?: string, args?: string[]) => boolean
    >(() => {
      calls.push("app.setAsDefaultProtocolClient");
      return true;
    });
  }

  class FakeNativeTheme extends EventEmitter {
    get themeSource(): string {
      return state.themeSource;
    }
    set themeSource(value: string) {
      calls.push(`nativeTheme.themeSource=${value}`);
      state.themeSource = value;
    }
    get shouldUseDarkColors(): boolean {
      return state.themeSource === "system"
        ? state.osIsDark
        : state.themeSource === "dark";
    }
  }

  class FakeBrowserWindow extends EventEmitter {
    static readonly getAllWindows = (): FakeBrowserWindow[] =>
      state.windows.filter((window) => !window.isGone);

    readonly options: Record<string, unknown>;
    /** What `nativeTheme.themeSource` was when the window was constructed. */
    readonly themeSourceAtCreation: string;
    isGone = false;
    minimized = false;
    url = "";

    readonly webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      send: vi.fn(),
      isDestroyed: (): boolean => this.isGone,
      getURL: (): string => this.url,
    };
    readonly loadURL = vi.fn(async (url: string): Promise<void> => {
      calls.push("window.loadURL");
      this.url = url;
      if (state.loadError !== undefined) throw state.loadError;
    });
    readonly isMinimized = vi.fn((): boolean => this.minimized);
    readonly restore = vi.fn(() => {
      this.minimized = false;
    });
    readonly focus = vi.fn();
    readonly show = vi.fn();
    readonly setBackgroundColor = vi.fn();

    constructor(options: Record<string, unknown>) {
      super();
      calls.push("new BrowserWindow");
      this.options = options;
      this.themeSourceAtCreation = state.themeSource;
      state.windows.push(this);
    }

    /** What the user closing the window does. */
    close(): void {
      this.isGone = true;
      this.emit("closed");
    }
  }

  const createSession = (
    name: string
  ): {
    setPermissionRequestHandler: ReturnType<typeof vi.fn>;
    setPermissionCheckHandler: ReturnType<typeof vi.fn>;
    setDevicePermissionHandler: ReturnType<typeof vi.fn>;
    webRequest: { onHeadersReceived: ReturnType<typeof vi.fn> };
  } => {
    const logged = (method: string): ReturnType<typeof vi.fn> =>
      vi.fn(() => {
        calls.push(`${name}.${method}`);
      });
    return {
      setPermissionRequestHandler: logged("setPermissionRequestHandler"),
      setPermissionCheckHandler: logged("setPermissionCheckHandler"),
      setDevicePermissionHandler: logged("setDevicePermissionHandler"),
      webRequest: { onHeadersReceived: logged("onHeadersReceived") },
    };
  };

  const app = new FakeApp();
  const nativeTheme = new FakeNativeTheme();
  const powerMonitor = new EventEmitter();
  const session = { defaultSession: createSession("defaultSession") };
  const protocol = {
    registerSchemesAsPrivileged: vi.fn<(schemes: unknown) => void>(() => {
      calls.push("protocol.registerSchemesAsPrivileged");
    }),
    handle: vi.fn((scheme: string, handler: ProtocolHandler) => {
      calls.push(`protocol.handle:${scheme}`);
      state.protocolHandlers.set(scheme, handler);
    }),
  };
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      calls.push(`ipcMain.handle:${channel}`);
      state.ipcHandlers.set(channel, handler);
    }),
    removeHandler: vi.fn(),
  };
  const webContents = {
    getAllWebContents: (): FakeBrowserWindow["webContents"][] =>
      FakeBrowserWindow.getAllWindows().map((window) => window.webContents),
  };
  const net = { fetch: vi.fn() };
  const shell = { openExternal: vi.fn(async () => undefined) };

  const reset = (root: string): void => {
    calls.length = 0;
    state.root = root;
    state.hasLock = true;
    state.isPackaged = false;
    state.ready = Promise.resolve();
    state.themeSource = "system";
    state.osIsDark = false;
    state.loadError = undefined;
    state.windows = [];
    state.ipcHandlers.clear();
    state.protocolHandlers.clear();
    app.removeAllListeners();
    nativeTheme.removeAllListeners();
    powerMonitor.removeAllListeners();
    session.defaultSession = createSession("defaultSession");
    for (const mock of [
      app.quit,
      app.exit,
      app.setAsDefaultProtocolClient,
      protocol.registerSchemesAsPrivileged,
      protocol.handle,
      ipcMain.handle,
      ipcMain.removeHandler,
      net.fetch,
      shell.openExternal,
    ]) {
      mock.mockClear();
    }
  };

  return {
    calls,
    state,
    reset,
    createSession,
    electron: {
      app,
      BrowserWindow: FakeBrowserWindow,
      ipcMain,
      nativeTheme,
      net,
      powerMonitor,
      protocol,
      session,
      shell,
      webContents,
    },
  };
});

vi.mock("electron", () => mocks.electron);

const { app } = mocks.electron;

const contract = {
  invoke: {
    "notes:count": { output: z.number() },
    "notes:rename": {
      input: z.object({ id: z.string(), title: z.string() }),
      output: z.boolean(),
    },
  },
  events: { "notes:changed": z.object({ id: z.string() }) },
} as const satisfies Contract;

type NotesContract = typeof contract;
type Link = { noteId: string };
type Options = StartAppOptions<NotesContract, Link>;
type LogLine = {
  level: string;
  scope: string;
  message: string;
  context?: Record<string, unknown>;
};
type ProcessEvent = "uncaughtException" | "unhandledRejection";
type ProcessListener = (reason: unknown) => void;

const SCHEME = "handijit-notes";
const APP_PAGE = "app://bundle/";
const IGNORED_LINK = "Ignored a deep link that did not validate";
const PLATFORM = Object.getOwnPropertyDescriptor(process, "platform");
const ARGV = process.argv;

let root: string;
let processListeners: Record<ProcessEvent, ProcessListener[]>;

const listenersOf = (event: ProcessEvent): ProcessListener[] =>
  process.listeners(event as "uncaughtException") as ProcessListener[];

const setPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, "platform", { ...PLATFORM, value: platform });
};

const baseOptions = (): Options => ({
  contract,
  handlers: () => ({
    "notes:count": () => 3,
    "notes:rename": ({ title }) => title !== "",
  }),
  rendererRoot: join(root, "renderer"),
  window: { preload: "/app/preload.cjs" },
  log: { directory: join(root, "logs"), mirrorToConsole: false },
});

const start = async (
  overrides: Partial<Options> = {}
): Promise<AppContext<NotesContract>> => {
  const context = await startApp({ ...baseOptions(), ...overrides });
  if (context === null) throw new Error("the app did not start");
  return context;
};

/** A deep link handler that accepts `handijit-notes://open/<digits>` and nothing else. */
const createDeepLink = ({
  scheme = SCHEME,
  register = false,
  onLink,
}: {
  scheme?: string;
  register?: boolean;
  onLink?: (link: Link) => void;
} = {}): DeepLinkOptions<Link> & {
  parse: ReturnType<typeof vi.fn<(url: URL) => Link | null>>;
  onLink: ReturnType<typeof vi.fn<(link: Link) => void>>;
} => ({
  scheme,
  register,
  parse: vi.fn((url: URL): Link | null =>
    url.hostname === "open" && /^\/\d+$/.test(url.pathname)
      ? { noteId: url.pathname.slice(1) }
      : null
  ),
  onLink: vi.fn<(link: Link) => void>(onLink),
});

const deliveredNotes = (
  deepLink: ReturnType<typeof createDeepLink>
): string[] => deepLink.onLink.mock.calls.map(([link]) => link.noteId);

const readLog = async (
  context: AppContext<NotesContract>
): Promise<LogLine[]> => {
  await context.logger.flush();
  const file = join(root, "logs", "main.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as LogLine);
};

const invoke = (
  channel: string,
  frameUrl: string,
  ...args: unknown[]
): Promise<unknown> => {
  const handler = mocks.state.ipcHandlers.get(channel);
  if (handler === undefined) throw new Error(`no handler for "${channel}"`);
  return handler({ senderFrame: { url: frameUrl } }, ...args);
};

const position = (call: string): number => {
  const index = mocks.calls.indexOf(call);
  expect(index, `"${call}" never happened`).not.toBe(-1);
  return index;
};

/** Asserts that each of `earlier` happened before the first occurrence of `later`. */
const expectBefore = (earlier: readonly string[], later: string): void => {
  const limit = position(later);
  for (const call of earlier) {
    expect(
      position(call),
      `"${call}" must come before "${later}"`
    ).toBeLessThan(limit);
  }
};

const firstWindow = (): (typeof mocks.state.windows)[number] => {
  const [window] = mocks.state.windows;
  if (window === undefined) throw new Error("no window was created");
  return window;
};

/** A promise that the test settles by hand. */
const createDeferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** Lets everything that is already due (promise reactions, finished file work) run. */
const tick = (): Promise<void> =>
  new Promise((done) => {
    setImmediate(done);
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hd-electron-start-"));
  mocks.reset(root);
  process.argv = ["/usr/local/bin/electron", "/app/main.js"];
  vi.stubEnv("ELECTRON_RENDERER_URL", undefined);
  processListeners = {
    uncaughtException: listenersOf("uncaughtException"),
    unhandledRejection: listenersOf("unhandledRejection"),
  };
});

afterEach(() => {
  // startApp listens to the process for the lifetime of an app; a test is shorter than that.
  for (const event of ["uncaughtException", "unhandledRejection"] as const) {
    for (const listener of listenersOf(event)) {
      if (!processListeners[event].includes(listener)) {
        process.removeListener(event, listener);
      }
    }
  }
  process.argv = ARGV;
  if (PLATFORM !== undefined) {
    Object.defineProperty(process, "platform", PLATFORM);
  }
  rmSync(root, { recursive: true, force: true });
});

describe("startApp", () => {
  describe("single instance", () => {
    test("sentinel: should quit and set nothing up when another instance already runs", async () => {
      mocks.state.hasLock = false;
      const handlers = vi.fn(baseOptions().handlers);
      const beforeWindow = vi.fn();
      const deepLink = createDeepLink({ register: true });

      const context = await startApp({
        ...baseOptions(),
        handlers,
        beforeWindow,
        deepLink,
      });

      expect(context).toBeNull();
      expect(mocks.calls).toEqual([
        "app.requestSingleInstanceLock",
        "app.quit",
      ]);
      expect(app.quit).toHaveBeenCalledTimes(1);
      expect(app.eventNames()).toEqual([]);
      expect(mocks.state.windows).toEqual([]);
      expect(handlers).not.toHaveBeenCalled();
      expect(beforeWindow).not.toHaveBeenCalled();
      expect(deepLink.onLink).not.toHaveBeenCalled();
      expect(listenersOf("uncaughtException")).toEqual(
        processListeners.uncaughtException
      );
      // Not even a log file: the running instance owns the files.
      expect(existsSync(join(root, "logs"))).toBe(false);
      expect(existsSync(join(root, "userData"))).toBe(false);
    });

    test("should ask for the lock before anything else", async () => {
      await start({ deepLink: createDeepLink({ register: true }) });

      expect(mocks.calls[0]).toBe("app.requestSingleInstanceLock");
      expect(app.quit).not.toHaveBeenCalled();
    });
  });

  describe("boot order", () => {
    test("sentinel: should set the security up after ready and before the first window", async () => {
      const context = await start({
        handlers: (received) => {
          mocks.calls.push("handlers");
          expect(received.getWindow()).toBeNull();
          return baseOptions().handlers(received);
        },
        beforeWindow: async () => {
          mocks.calls.push("beforeWindow:start");
          await tick();
          mocks.calls.push("beforeWindow:end");
        },
        deepLink: createDeepLink({ register: true }),
      });

      // Lock → privileged scheme → ready.
      expectBefore(
        ["app.requestSingleInstanceLock"],
        "protocol.registerSchemesAsPrivileged"
      );
      expectBefore(
        [
          "protocol.registerSchemesAsPrivileged",
          "app.setAsDefaultProtocolClient",
        ],
        "app.whenReady"
      );
      // Nothing of the security setup can run before ready…
      const afterReady = [
        "protocol.handle:app",
        "defaultSession.setPermissionRequestHandler",
        "defaultSession.setPermissionCheckHandler",
        "defaultSession.setDevicePermissionHandler",
        "nativeTheme.themeSource=system",
        "ipcMain.handle:core-log:write",
        "ipcMain.handle:core-theme:get",
        "ipcMain.handle:core-theme:set",
        "handlers",
        "ipcMain.handle:notes:count",
        "ipcMain.handle:notes:rename",
        "beforeWindow:start",
        "beforeWindow:end",
      ];
      for (const call of afterReady) expectBefore(["app.whenReady"], call);
      // …and all of it is in place when the first window is constructed.
      expectBefore(afterReady, "new BrowserWindow");
      // The app's own preparation runs behind the guards, not before them.
      expectBefore(
        afterReady.filter((call) => !call.startsWith("beforeWindow")),
        "beforeWindow:start"
      );
      expectBefore(["new BrowserWindow"], "window.loadURL");

      expect(
        mocks.calls.filter((call) => call === "new BrowserWindow")
      ).toHaveLength(1);
      expect(
        mocks.calls.filter((call) => call === "app.requestSingleInstanceLock")
      ).toHaveLength(1);
      expect(context.getWindow()).toBe(firstWindow());
    });

    test("sentinel: should register the privileged scheme, and nothing that needs ready, before the app is ready", async () => {
      const ready = createDeferred();
      mocks.state.ready = ready.promise;
      const handlers = vi.fn(baseOptions().handlers);

      const starting = startApp({ ...baseOptions(), handlers });
      await tick();

      expect(mocks.calls).toEqual([
        "app.requestSingleInstanceLock",
        "protocol.registerSchemesAsPrivileged",
        "app.whenReady",
      ]);
      expect(
        mocks.electron.protocol.registerSchemesAsPrivileged
      ).toHaveBeenCalledExactlyOnceWith([
        {
          scheme: "app",
          privileges: { standard: true, secure: true, supportFetchAPI: true },
        },
      ]);
      expect(handlers).not.toHaveBeenCalled();
      expect(mocks.state.windows).toEqual([]);

      ready.resolve();
      const context = await starting;

      expect(handlers).toHaveBeenCalledExactlyOnceWith(context);
      expect(mocks.state.windows).toHaveLength(1);
    });

    test("sentinel: should wait for beforeWindow before it opens the window", async () => {
      const gate = createDeferred();
      const beforeWindow = vi.fn(() => gate.promise);

      const starting = startApp({ ...baseOptions(), beforeWindow });
      await vi.waitFor(() => expect(beforeWindow).toHaveBeenCalled(), {
        interval: 2,
      });
      await tick();

      // The guards are up, the app's preparation is still running: no window yet.
      expect(mocks.state.protocolHandlers.has("app")).toBe(true);
      expect(mocks.state.ipcHandlers.has("notes:count")).toBe(true);
      expect(mocks.state.windows).toEqual([]);
      const [received] = beforeWindow.mock.calls[0] as unknown as [
        AppContext<NotesContract>,
      ];
      expect(received.getWindow()).toBeNull();

      gate.resolve();
      const context = await starting;

      expect(context).toBe(received);
      expect(mocks.state.windows).toHaveLength(1);
      expect(beforeWindow).toHaveBeenCalledTimes(1);
    });

    test("should reject and open no window when beforeWindow fails", async () => {
      const failure = new Error("migration failed");

      await expect(
        start({
          beforeWindow: () => {
            throw failure;
          },
        })
      ).rejects.toBe(failure);

      expect(mocks.state.windows).toEqual([]);
    });

    test("sentinel: should apply the stored theme to nativeTheme before the window exists", async () => {
      mkdirSync(join(root, "userData"));
      writeFileSync(
        join(root, "userData", "theme.json"),
        JSON.stringify({ theme: "dark" })
      );

      const context = await start();

      expectBefore(["nativeTheme.themeSource=dark"], "new BrowserWindow");
      expect(firstWindow().themeSourceAtCreation).toBe("dark");
      expect(context.theme.getState()).toEqual({
        preference: "dark",
        resolved: "dark",
      });
    });
  });

  describe("the theme after sleep", () => {
    test.each(["resume", "unlock-screen"])(
      "sentinel: should put the stored preference back on %s and tell every window",
      async (event) => {
        mkdirSync(join(root, "userData"));
        writeFileSync(
          join(root, "userData", "theme.json"),
          JSON.stringify({ theme: "dark" })
        );
        const context = await start();
        const window = firstWindow();
        // The system reset the appearance while the computer slept.
        mocks.state.themeSource = "system";
        mocks.calls.length = 0;

        mocks.electron.powerMonitor.emit(event);

        expect(mocks.calls).toContain("nativeTheme.themeSource=dark");
        expect(context.theme.getState()).toEqual({
          preference: "dark",
          resolved: "dark",
        });
        expect(window.webContents.send).toHaveBeenCalledWith(
          "core-theme:changed",
          { preference: "dark", resolved: "dark" }
        );
      }
    );
  });

  describe("the window", () => {
    test("should open one isolated window on the app's own page", async () => {
      const context = await start({
        window: { preload: "/app/preload.cjs", width: 900, title: "Notes" },
      });

      const window = firstWindow();
      expect(context.getWindow()).toBe(window);
      expect(window.options).toMatchObject({
        width: 900,
        title: "Notes",
        show: false,
        webPreferences: {
          preload: "/app/preload.cjs",
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      });
      expect(window.loadURL).toHaveBeenCalledExactlyOnceWith(APP_PAGE);
    });

    test("should forget the window when it is closed", async () => {
      const context = await start();

      firstWindow().close();

      expect(context.getWindow()).toBeNull();
    });

    test("should focus the open window on showWindow, restoring it only when minimized", async () => {
      const context = await start();
      const window = firstWindow();

      expect(context.showWindow()).toBe(window);
      expect(window.focus).toHaveBeenCalledTimes(1);
      expect(window.restore).not.toHaveBeenCalled();

      window.minimized = true;
      context.showWindow();

      expect(window.restore).toHaveBeenCalledTimes(1);
      expect(window.focus).toHaveBeenCalledTimes(2);
      expect(mocks.state.windows).toHaveLength(1);
    });

    test("should open a new window on showWindow when none is open", async () => {
      const context = await start();
      firstWindow().close();

      const reopened = context.showWindow();

      expect(mocks.state.windows).toHaveLength(2);
      expect(reopened).toBe(mocks.state.windows[1]);
      expect(context.getWindow()).toBe(reopened);
      expect(mocks.state.windows[1]?.focus).toHaveBeenCalledTimes(1);
      expect(mocks.state.windows[1]?.loadURL).toHaveBeenCalledWith(APP_PAGE);
    });

    test("should keep the newer window when an older one reports closed late", async () => {
      const context = await start();
      const older = firstWindow();
      // The old window is gone for the app, but its "closed" event has not been delivered yet.
      older.isGone = true;
      app.emit("activate");
      const newer = mocks.state.windows[1];

      older.emit("closed");

      expect(newer).toBeDefined();
      expect(context.getWindow()).toBe(newer);
    });

    test.each(["https://evil.test/", "//evil.test/app", "file:///etc/passwd"])(
      "sentinel: should reject, before any window exists, when the window's path is %j",
      async (path) => {
        await expect(
          start({ window: { preload: "/app/preload.cjs", path } })
        ).rejects.toThrow(TypeError);

        expect(mocks.calls).not.toContain("new BrowserWindow");
        expect(mocks.state.windows).toEqual([]);
      }
    );

    test("should open the window on a route inside the app", async () => {
      await start({
        window: { preload: "/app/preload.cjs", path: "/settings?tab=about" },
      });

      expect(firstWindow().loadURL).toHaveBeenCalledExactlyOnceWith(
        "app://bundle/settings?tab=about"
      );
    });

    test("should log a page that fails to load instead of leaving the rejection unhandled", async () => {
      mocks.state.loadError = new Error(
        "ERR_FILE_NOT_FOUND (-6) loading app://bundle/"
      );

      const context = await start();
      await tick();

      expect(await readLog(context)).toEqual([
        expect.objectContaining({
          level: "error",
          scope: "main",
          message: "The window failed to load",
          context: {
            error: expect.objectContaining({
              name: "Error",
              message: "ERR_FILE_NOT_FOUND (-6) loading app://bundle/",
            }),
          },
        }),
      ]);
    });

    test("should load the dev server, and put the relaxed CSP on its responses, in an unpackaged app", async () => {
      vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173");

      const context = await start({
        contentSecurityPolicy: { connectSrc: ["https://api.test"] },
      });

      expect(context.policy.devServerUrl).toBe("http://localhost:5173");
      expect(firstWindow().loadURL).toHaveBeenCalledExactlyOnceWith(
        "http://localhost:5173/"
      );
      const { onHeadersReceived } =
        mocks.electron.session.defaultSession.webRequest;
      expect(onHeadersReceived).toHaveBeenCalledExactlyOnceWith(
        { urls: ["http://localhost:5173/*"] },
        expect.any(Function)
      );
      const [, listener] = onHeadersReceived.mock.calls[0] as [
        unknown,
        (
          details: { responseHeaders: Record<string, string[]> },
          callback: (response: {
            responseHeaders: Record<string, string[]>;
          }) => void
        ) => void,
      ];
      const callback = vi.fn();
      listener({ responseHeaders: { "X-Kept": ["1"] } }, callback);
      const headers = callback.mock.calls[0]?.[0] as {
        responseHeaders: Record<string, string[]>;
      };
      const [policy] = headers.responseHeaders["Content-Security-Policy"] ?? [];
      expect(headers.responseHeaders["X-Kept"]).toEqual(["1"]);
      expect(policy).toContain("script-src 'self' 'unsafe-inline'");
      expect(policy).toContain(
        "connect-src 'self' ws://localhost:5173 https://api.test"
      );
    });

    test("sentinel: should ignore the dev server in a packaged app", async () => {
      vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173");
      mocks.state.isPackaged = true;

      const context = await start();

      expect(context.policy.devServerUrl).toBeUndefined();
      expect(firstWindow().loadURL).toHaveBeenCalledExactlyOnceWith(APP_PAGE);
      expect(
        mocks.electron.session.defaultSession.webRequest.onHeadersReceived
      ).not.toHaveBeenCalled();
    });
  });

  describe("security setup", () => {
    test("should guard the default session unless the window brings its own", async () => {
      await start();

      const { defaultSession } = mocks.electron.session;
      expect(defaultSession.setPermissionRequestHandler).toHaveBeenCalledTimes(
        1
      );
      expect(defaultSession.setPermissionCheckHandler).toHaveBeenCalledTimes(1);
      expect(defaultSession.setDevicePermissionHandler).toHaveBeenCalledTimes(
        1
      );
    });

    test("should guard the session of the window when one is given", async () => {
      const own = mocks.createSession("ownSession");

      await start({
        window: {
          preload: "/app/preload.cjs",
          webPreferences: { session: own as unknown as Session },
        },
      });

      expect(own.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
      expect(own.setPermissionCheckHandler).toHaveBeenCalledTimes(1);
      expect(own.setDevicePermissionHandler).toHaveBeenCalledTimes(1);
      expectBefore(
        ["ownSession.setPermissionRequestHandler"],
        "new BrowserWindow"
      );
      expect(
        mocks.electron.session.defaultSession.setPermissionRequestHandler
      ).not.toHaveBeenCalled();
      expect(firstWindow().options).toMatchObject({
        webPreferences: { session: own },
      });
    });

    test("should deny every permission by default and grant the listed ones to the app's own page", async () => {
      const decide = async (
        options: Partial<Options>,
        permission: string,
        pageUrl: string
      ): Promise<boolean> => {
        mocks.reset(root);
        await start(options);
        const [handler] = mocks.electron.session.defaultSession
          .setPermissionRequestHandler.mock.calls[0] as [
          (
            contents: { getURL: () => string },
            permission: string,
            callback: (granted: boolean) => void
          ) => void,
        ];
        const callback = vi.fn<(granted: boolean) => void>();
        handler({ getURL: () => pageUrl }, permission, callback);
        return callback.mock.calls[0]?.[0] ?? true;
      };

      expect(await decide({}, "notifications", APP_PAGE)).toBe(false);
      expect(
        await decide(
          { permissions: ["notifications"] },
          "notifications",
          APP_PAGE
        )
      ).toBe(true);
      expect(
        await decide({ permissions: ["notifications"] }, "media", APP_PAGE)
      ).toBe(false);
      expect(
        await decide(
          { permissions: ["notifications"] },
          "notifications",
          "https://evil.test/"
        )
      ).toBe(false);
    });

    test("should serve app:// with the policy built from the options", async () => {
      const policyOf = async (options: Partial<Options>): Promise<string> => {
        mocks.reset(root);
        await start(options);
        const handler = mocks.state.protocolHandlers.get("app");
        if (handler === undefined) throw new Error("app:// has no handler");
        // A host the scheme does not serve: answered without touching the disk.
        const response = await handler(new Request("app://elsewhere/"));
        expect(response.status).toBe(404);
        return response.headers.get("Content-Security-Policy") ?? "";
      };

      const byDefault = await policyOf({});
      expect(byDefault).toContain("default-src 'self'");
      expect(byDefault).toContain("script-src 'self';");
      expect(byDefault).toContain("connect-src 'self';");

      const extended = await policyOf({
        contentSecurityPolicy: {
          connectSrc: ["https://api.test"],
          scriptHashes: ["sha256-AAAA"],
        },
      });
      expect(extended).toContain("script-src 'self' 'sha256-AAAA';");
      expect(extended).toContain("connect-src 'self' https://api.test;");
    });

    test("should let no link leave the app unless its host is listed", async () => {
      const closed = await start();
      expect(closed.policy.isAllowedExternalUrl("https://handijit.com/")).toBe(
        false
      );

      mocks.reset(root);
      const open = await start({ externalHosts: ["handijit.com"] });
      expect(open.policy.isAllowedExternalUrl("https://handijit.com/")).toBe(
        true
      );
      expect(open.policy.isAllowedExternalUrl("https://evil.test/")).toBe(
        false
      );
      expect(open.policy.isTrustedAppUrl(APP_PAGE)).toBe(true);
    });
  });

  describe("IPC", () => {
    test("should build the handlers once, with the context it resolves with", async () => {
      const handlers = vi.fn(baseOptions().handlers);

      const context = await start({ handlers });

      expect(handlers).toHaveBeenCalledExactlyOnceWith(context);
      expect([...mocks.state.ipcHandlers.keys()].sort()).toEqual([
        "core-log:write",
        "core-theme:get",
        "core-theme:set",
        "notes:count",
        "notes:rename",
      ]);
    });

    test("should answer the app's own page through the contract", async () => {
      await start();

      await expect(invoke("notes:count", APP_PAGE)).resolves.toBe(3);
      await expect(
        invoke("notes:rename", APP_PAGE, { id: "1", title: "New" })
      ).resolves.toBe(true);
    });

    test("sentinel: should refuse a foreign frame and an invalid input, and log each refusal as a warning", async () => {
      const context = await start();

      await expect(invoke("notes:count", "https://evil.test/")).rejects.toThrow(
        "[UNTRUSTED_SENDER] notes:count"
      );
      await expect(invoke("notes:rename", APP_PAGE, { id: 1 })).rejects.toThrow(
        "[INVALID_INPUT] notes:rename"
      );

      const lines = await readLog(context);
      expect(lines.map(({ level, scope }) => [level, scope])).toEqual([
        ["warn", "main"],
        ["warn", "main"],
      ]);
      expect(lines[0]?.message).toBe(
        "[UNTRUSTED_SENDER] notes:count: refused frame https://evil.test/"
      );
      expect(lines[1]?.message).toMatch(/^\[INVALID_INPUT\] notes:rename: /);
    });

    test("should serve the renderer's log and theme calls", async () => {
      const context = await start();

      await invoke("core-log:write", APP_PAGE, {
        level: "error",
        message: "render failed for ada@example.com",
        context: { token: "abc" },
      });
      await expect(invoke("core-theme:get", APP_PAGE)).resolves.toEqual({
        preference: "system",
        resolved: "light",
      });
      await expect(invoke("core-theme:set", APP_PAGE, "dark")).resolves.toEqual(
        {
          preference: "dark",
          resolved: "dark",
        }
      );

      expect(mocks.state.themeSource).toBe("dark");
      expect(await readLog(context)).toEqual([
        expect.objectContaining({
          level: "error",
          scope: "renderer",
          message: "render failed for ***@example.com",
          context: { token: "[REDACTED]" },
        }),
      ]);
    });

    test("should send the contract's events and theme changes to the window", async () => {
      const context = await start();
      const { send } = firstWindow().webContents;

      expect(context.emitter.broadcast("notes:changed", { id: "7" })).toBe(1);
      await context.theme.setPreference("dark");

      expect(send.mock.calls).toEqual([
        ["notes:changed", { id: "7" }],
        ["core-theme:changed", { preference: "dark", resolved: "dark" }],
      ]);
    });
  });

  describe("theme store", () => {
    test("should keep the preference in theme.json under userData by default", async () => {
      const context = await start();
      const file = join(root, "userData", "theme.json");

      expect(context.theme.getState().preference).toBe("system");
      expect(existsSync(file)).toBe(false);

      await context.theme.setPreference("light");

      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
        theme: "light",
      });
      expect(mocks.state.themeSource).toBe("light");
    });

    test("should use the supplied store and create no file of its own", async () => {
      const themeStore = {
        get: vi.fn<ThemePreferenceStore["get"]>(() => "dark"),
        set: vi.fn<ThemePreferenceStore["set"]>(),
      };

      const context = await start({ themeStore });

      expect(firstWindow().themeSourceAtCreation).toBe("dark");
      expect(themeStore.get).toHaveBeenCalledTimes(1);

      await context.theme.setPreference("light");

      expect(themeStore.set).toHaveBeenCalledExactlyOnceWith("light");
      expect(existsSync(join(root, "userData"))).toBe(false);
    });
  });

  describe("deep links: registration", () => {
    test("should register the scheme alone in a packaged app", async () => {
      mocks.state.isPackaged = true;

      await start({ deepLink: createDeepLink({ register: true }) });

      expect(app.setAsDefaultProtocolClient).toHaveBeenCalledExactlyOnceWith(
        SCHEME
      );
    });

    test("should register the scheme with the executable and the script in an unpackaged app", async () => {
      process.argv = ["/usr/local/bin/electron", "relative/main.js"];
      // `register` left out: registering is the default.
      const deepLink = createDeepLink();
      delete deepLink.register;

      await start({ deepLink });

      expect(app.setAsDefaultProtocolClient).toHaveBeenCalledExactlyOnceWith(
        SCHEME,
        process.execPath,
        [resolve("relative/main.js")]
      );
    });

    test("should register the scheme alone when an unpackaged app was started without a script", async () => {
      process.argv = ["/usr/local/bin/electron"];

      await start({ deepLink: createDeepLink({ register: true }) });

      expect(app.setAsDefaultProtocolClient).toHaveBeenCalledExactlyOnceWith(
        SCHEME
      );
    });

    test("should leave the machine alone with register: false, and still take links", async () => {
      const deepLink = createDeepLink({ register: false });

      await start({ deepLink });
      app.emit("open-url", { preventDefault: vi.fn() }, `${SCHEME}://open/5`);

      expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
      expect(deliveredNotes(deepLink)).toEqual(["5"]);
    });

    test("should neither register nor listen for links in an app without a scheme", async () => {
      process.argv = [
        "/usr/local/bin/electron",
        "/app/main.js",
        `${SCHEME}://open/1`,
      ];

      const context = await start();
      app.emit("second-instance", {}, ["app", `${SCHEME}://open/2`], "/");

      expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
      expect(app.listenerCount("open-url")).toBe(0);
      // The second launch still brings the window to the front.
      expect(firstWindow().focus).toHaveBeenCalledTimes(1);
      expect(await readLog(context)).toEqual([]);
    });
  });

  describe("deep links: delivery", () => {
    test("should take a link from open-url, bring the window forward and deliver the parsed value", async () => {
      const deepLink = createDeepLink();
      await start({ deepLink });
      const event = { preventDefault: vi.fn() };

      app.emit("open-url", event, `${SCHEME}://open/42?from=mail`);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(firstWindow().focus).toHaveBeenCalledTimes(1);
      expect(deepLink.parse).toHaveBeenCalledExactlyOnceWith(
        new URL(`${SCHEME}://open/42?from=mail`)
      );
      expect(deepLink.onLink).toHaveBeenCalledExactlyOnceWith({ noteId: "42" });
    });

    test("should deliver the link the app was started with, once the window exists", async () => {
      process.argv = [
        "C:\\Program Files\\Notes\\notes.exe",
        "--flag",
        `${SCHEME}://open/7`,
      ];
      const windowsAtDelivery: number[] = [];
      const deepLink = createDeepLink({
        onLink: () => {
          windowsAtDelivery.push(mocks.state.windows.length);
        },
      });

      await start({ deepLink });

      expect(deliveredNotes(deepLink)).toEqual(["7"]);
      expect(windowsAtDelivery).toEqual([1]);
    });

    test("should hold links that arrive before the app is ready and deliver them, in order, after the window opened", async () => {
      const ready = createDeferred();
      mocks.state.ready = ready.promise;
      process.argv = [
        "/usr/local/bin/electron",
        "/app/main.js",
        `${SCHEME}://open/1`,
      ];
      const windowsAtDelivery: number[] = [];
      const deepLink = createDeepLink({
        onLink: () => {
          windowsAtDelivery.push(mocks.state.windows.length);
        },
      });

      const starting = startApp({ ...baseOptions(), deepLink });
      const event = { preventDefault: vi.fn() };
      app.emit("open-url", event, `${SCHEME}://open/2`);
      app.emit("second-instance", {}, ["notes", `${SCHEME}://open/3`], "/");
      app.emit("open-url", event, `${SCHEME}://open/4`);
      await tick();

      // Held back: nothing is parsed, delivered or opened before the security setup.
      expect(event.preventDefault).toHaveBeenCalledTimes(2);
      expect(deepLink.parse).not.toHaveBeenCalled();
      expect(deepLink.onLink).not.toHaveBeenCalled();
      expect(mocks.state.windows).toEqual([]);

      ready.resolve();
      await starting;

      // The command line of this launch first, then the held links as they came.
      expect(deliveredNotes(deepLink)).toEqual(["1", "2", "3", "4"]);
      expect(windowsAtDelivery).toEqual([1, 1, 1, 1]);
      expect(mocks.state.windows).toHaveLength(1);
    });

    test("should also hold a link that arrives while beforeWindow runs", async () => {
      const gate = createDeferred();
      const beforeWindow = vi.fn(() => gate.promise);
      const deepLink = createDeepLink();

      const starting = startApp({ ...baseOptions(), deepLink, beforeWindow });
      await vi.waitFor(() => expect(beforeWindow).toHaveBeenCalled(), {
        interval: 2,
      });
      app.emit("open-url", { preventDefault: vi.fn() }, `${SCHEME}://open/9`);

      expect(deepLink.onLink).not.toHaveBeenCalled();
      expect(mocks.state.windows).toEqual([]);

      gate.resolve();
      await starting;

      expect(deliveredNotes(deepLink)).toEqual(["9"]);
    });

    test("sentinel: should hold at most 16 early links", async () => {
      const ready = createDeferred();
      mocks.state.ready = ready.promise;
      const deepLink = createDeepLink();

      const starting = startApp({ ...baseOptions(), deepLink });
      for (let index = 1; index <= 40; index += 1) {
        app.emit(
          "open-url",
          { preventDefault: vi.fn() },
          `${SCHEME}://open/${index}`
        );
      }
      ready.resolve();
      const context = await starting;

      expect(deliveredNotes(deepLink)).toEqual(
        Array.from({ length: 16 }, (_, index) => String(index + 1))
      );
      // The buffer is spent: later links are delivered directly, once each.
      app.emit("open-url", { preventDefault: vi.fn() }, `${SCHEME}://open/99`);
      expect(deepLink.onLink).toHaveBeenCalledTimes(17);
      expect(await readLog(context ?? (await start()))).toEqual([]);
    });

    test("sentinel: should ignore a link that does not validate, with a warning that does not repeat the link", async () => {
      const deepLink = createDeepLink();
      const context = await start({ deepLink });
      const event = { preventDefault: vi.fn() };

      // Refused by the app's own parser.
      app.emit("open-url", event, `${SCHEME}://delete/42?token=abc`);
      app.emit("open-url", event, `${SCHEME}://open/../../etc`);
      expect(deepLink.parse).toHaveBeenCalledTimes(2);
      // Another scheme, and something that is no URL at all: the parser is not even asked.
      app.emit("open-url", event, "other-app://open/42");
      app.emit("open-url", event, "https://evil.test/open/42");
      app.emit("open-url", event, "not a url");
      expect(deepLink.parse).toHaveBeenCalledTimes(2);

      expect(deepLink.onLink).not.toHaveBeenCalled();
      const lines = await readLog(context);
      expect(lines).toHaveLength(5);
      for (const line of lines) {
        expect(line).toMatchObject({ level: "warn", message: IGNORED_LINK });
        expect(line.context).toBeUndefined();
      }
    });

    test("should warn about an invalid link that was held before the window, too", async () => {
      process.argv = [
        "/usr/local/bin/electron",
        "/app/main.js",
        `${SCHEME}://nope`,
      ];
      const deepLink = createDeepLink();

      const context = await start({ deepLink });

      expect(deepLink.onLink).not.toHaveBeenCalled();
      expect((await readLog(context)).map(({ message }) => message)).toEqual([
        IGNORED_LINK,
      ]);
    });

    test("should compare the scheme without regard to case", async () => {
      process.argv = [
        "/usr/local/bin/electron",
        "/app/main.js",
        "HANDIJIT-NOTES://open/1",
      ];
      const deepLink = createDeepLink({ scheme: "Handijit-Notes" });

      await start({ deepLink });
      app.emit("open-url", { preventDefault: vi.fn() }, `${SCHEME}://open/2`);

      expect(deliveredNotes(deepLink)).toEqual(["1", "2"]);
    });

    test("sentinel: should log a parser that throws instead of letting it end the app", async () => {
      const failure = new Error("parser bug");
      const deepLink = createDeepLink();
      deepLink.parse.mockImplementation(() => {
        throw failure;
      });
      const context = await start({ deepLink });

      // An OS event has no caller to catch this: thrown here, it would be an uncaught exception.
      expect(() =>
        app.emit("open-url", { preventDefault: vi.fn() }, `${SCHEME}://open/1`)
      ).not.toThrow();
      expect(() =>
        app.emit("second-instance", {}, ["notes", `${SCHEME}://open/2`], "/")
      ).not.toThrow();

      expect(deepLink.parse).toHaveBeenCalledTimes(2);
      expect(deepLink.onLink).not.toHaveBeenCalled();
      const handled = expect.objectContaining({
        level: "error",
        scope: "main",
        message: "A deep link could not be handled",
        context: {
          error: expect.objectContaining({
            name: "Error",
            message: "parser bug",
          }),
        },
      });
      expect(await readLog(context)).toEqual([handled, handled]);
    });

    test("sentinel: should log a receiver that throws, and deliver the links that follow", async () => {
      const deepLink = createDeepLink();
      deepLink.onLink.mockImplementationOnce(() => {
        throw new TypeError("receiver bug");
      });
      const context = await start({ deepLink });

      expect(() =>
        app.emit("open-url", { preventDefault: vi.fn() }, `${SCHEME}://open/1`)
      ).not.toThrow();
      app.emit("open-url", { preventDefault: vi.fn() }, `${SCHEME}://open/2`);

      expect(deliveredNotes(deepLink)).toEqual(["1", "2"]);
      expect(await readLog(context)).toEqual([
        expect.objectContaining({
          level: "error",
          message: "A deep link could not be handled",
          context: {
            error: expect.objectContaining({
              name: "TypeError",
              message: "receiver bug",
            }),
          },
        }),
      ]);
    });

    test("sentinel: should still start when the link the app was started with makes the handler throw", async () => {
      const ready = createDeferred();
      mocks.state.ready = ready.promise;
      process.argv = [
        "/usr/local/bin/electron",
        "/app/main.js",
        `${SCHEME}://open/1`,
      ];
      const deepLink = createDeepLink({
        onLink: () => {
          throw new Error("receiver bug");
        },
      });

      const starting = startApp({ ...baseOptions(), deepLink });
      app.emit("open-url", { preventDefault: vi.fn() }, `${SCHEME}://open/2`);
      ready.resolve();
      const context = await starting;

      // Neither the command line's link nor the held one may reject the start.
      expect(context).not.toBeNull();
      expect(context?.getWindow()).toBe(firstWindow());
      expect(deliveredNotes(deepLink)).toEqual(["1", "2"]);
      expect(
        (await readLog(context ?? (await start()))).map(
          ({ level, message }) => [level, message]
        )
      ).toEqual([
        ["error", "A deep link could not be handled"],
        ["error", "A deep link could not be handled"],
      ]);
    });
  });

  describe("second instance", () => {
    test("should focus the window and deliver the link of the second launch", async () => {
      const deepLink = createDeepLink();
      await start({ deepLink });

      app.emit(
        "second-instance",
        {},
        ["notes.exe", "--allow-file-access", `${SCHEME}://open/8`],
        "C:\\"
      );

      expect(firstWindow().focus).toHaveBeenCalledTimes(1);
      expect(firstWindow().restore).not.toHaveBeenCalled();
      expect(deliveredNotes(deepLink)).toEqual(["8"]);
      expect(mocks.state.windows).toHaveLength(1);
    });

    test("should restore a minimized window", async () => {
      await start({ deepLink: createDeepLink() });
      firstWindow().minimized = true;

      app.emit("second-instance", {}, ["notes.exe"], "C:\\");

      expect(firstWindow().restore).toHaveBeenCalledTimes(1);
      expect(firstWindow().focus).toHaveBeenCalledTimes(1);
    });

    test("should open a new window when the old one was closed", async () => {
      const deepLink = createDeepLink();
      const context = await start({ deepLink });
      firstWindow().close();

      app.emit("second-instance", {}, ["notes", `${SCHEME}://open/8`], "/");

      expect(mocks.state.windows).toHaveLength(2);
      expect(context.getWindow()).toBe(mocks.state.windows[1]);
      expect(mocks.state.windows[1]?.focus).toHaveBeenCalledTimes(1);
      expect(deliveredNotes(deepLink)).toEqual(["8"]);
    });

    test("should only focus the window when the second launch carries no link", async () => {
      const deepLink = createDeepLink();
      const context = await start({ deepLink });

      app.emit("second-instance", {}, ["notes", "--flag", "/a/file.txt"], "/");

      expect(firstWindow().focus).toHaveBeenCalledTimes(1);
      expect(deepLink.parse).not.toHaveBeenCalled();
      expect(await readLog(context)).toEqual([]);
    });

    test("should ignore a link of another scheme on the second launch's command line", async () => {
      const deepLink = createDeepLink();
      await start({ deepLink });

      app.emit("second-instance", {}, ["notes", "other-app://open/8"], "/");

      expect(deepLink.parse).not.toHaveBeenCalled();
      expect(deepLink.onLink).not.toHaveBeenCalled();
    });
  });

  describe("app events", () => {
    test("should open a window on activate when none is open", async () => {
      const context = await start();
      firstWindow().close();

      app.emit("activate");

      expect(mocks.state.windows).toHaveLength(2);
      expect(context.getWindow()).toBe(mocks.state.windows[1]);
    });

    test("should not open a second window on activate", async () => {
      await start();

      app.emit("activate");

      expect(mocks.state.windows).toHaveLength(1);
    });

    test("should stay alive without windows on macOS", async () => {
      setPlatform("darwin");
      await start();

      app.emit("window-all-closed");

      expect(app.quit).not.toHaveBeenCalled();
    });

    test.each(["win32", "linux"] as const)(
      "should quit when the last window closes on %s",
      async (platform) => {
        setPlatform(platform);
        await start();

        app.emit("window-all-closed");

        expect(app.quit).toHaveBeenCalledTimes(1);
      }
    );

    test("should hold the quit until the log is on disk, flush exactly once, then quit", async () => {
      const context = await start();
      const written = createDeferred();
      const flush = vi
        .spyOn(context.logger, "flush")
        .mockReturnValue(written.promise);
      const first = { preventDefault: vi.fn() };

      app.emit("before-quit", first);
      await tick();

      expect(first.preventDefault).toHaveBeenCalledTimes(1);
      expect(flush).toHaveBeenCalledTimes(1);
      expect(app.quit).not.toHaveBeenCalled();

      written.resolve();
      await tick();
      await tick();

      expect(app.quit).toHaveBeenCalledTimes(1);

      // The quit it asked for comes back as a second before-quit: this one passes.
      const second = { preventDefault: vi.fn() };
      app.emit("before-quit", second);
      await tick();

      expect(second.preventDefault).not.toHaveBeenCalled();
      expect(flush).toHaveBeenCalledTimes(1);
      expect(app.quit).toHaveBeenCalledTimes(1);
    });

    test("sentinel: should flush once and quit once when before-quit comes twice before the log is on disk", async () => {
      const context = await start();
      const written = createDeferred();
      const flush = vi
        .spyOn(context.logger, "flush")
        .mockReturnValue(written.promise);
      const first = { preventDefault: vi.fn() };
      const second = { preventDefault: vi.fn() };

      app.emit("before-quit", first);
      app.emit("before-quit", second);
      await tick();

      // Both quits are held; the second one joins the flush that is already running.
      expect(first.preventDefault).toHaveBeenCalledTimes(1);
      expect(second.preventDefault).toHaveBeenCalledTimes(1);
      expect(flush).toHaveBeenCalledTimes(1);
      expect(app.quit).not.toHaveBeenCalled();

      written.resolve();
      await tick();
      await tick();

      expect(flush).toHaveBeenCalledTimes(1);
      expect(app.quit).toHaveBeenCalledTimes(1);
    });

    test("sentinel: should ask for the quit again on a later turn, never from the flush's microtask", async () => {
      // A SIGTERM emits before-quit from native code, which drains microtasks before it
      // returns: a quit asked from one runs inside the held quit and is undone (the windows
      // close, the process stays on macOS).
      const context = await start();
      const written = createDeferred();
      vi.spyOn(context.logger, "flush").mockReturnValue(written.promise);

      app.emit("before-quit", { preventDefault: vi.fn() });
      written.resolve();
      for (let index = 0; index < 10; index += 1) await Promise.resolve();

      expect(app.quit).not.toHaveBeenCalled();

      await tick();
      await tick();

      expect(app.quit).toHaveBeenCalledTimes(1);
    });

    test("should have the lines logged before the quit on disk when it quits", async () => {
      const context = await start();
      const linesAtQuit: number[] = [];
      app.quit.mockImplementationOnce(() => {
        linesAtQuit.push(
          readFileSync(join(root, "logs", "main.log"), "utf8").split("\n")
            .length - 1
        );
      });

      for (let index = 0; index < 25; index += 1) {
        context.logger.info(`line ${index}`);
      }
      app.emit("before-quit", { preventDefault: vi.fn() });
      await vi.waitFor(() => expect(app.quit).toHaveBeenCalled(), {
        interval: 2,
      });

      expect(linesAtQuit).toEqual([25]);
    });

    test("should log a renderer process that is gone", async () => {
      const context = await start();

      app.emit(
        "render-process-gone",
        {},
        {},
        { reason: "crashed", exitCode: 139 }
      );

      expect(await readLog(context)).toEqual([
        expect.objectContaining({
          level: "error",
          message: "A renderer process is gone",
          context: { reason: "crashed", exitCode: 139 },
        }),
      ]);
    });

    test("should log a child process that is gone", async () => {
      const context = await start();

      app.emit(
        "child-process-gone",
        {},
        { type: "GPU", reason: "killed", exitCode: 9 }
      );

      expect(await readLog(context)).toEqual([
        expect.objectContaining({
          level: "error",
          message: "A child process is gone",
          context: { type: "GPU", reason: "killed", exitCode: 9 },
        }),
      ]);
    });

    test("should log the unhandled rejections of the main process", async () => {
      const context = await start();
      const [onRejection] = listenersOf("unhandledRejection").filter(
        (listener) => !processListeners.unhandledRejection.includes(listener)
      );

      onRejection?.(new Error("lost promise"));

      expect(onRejection).toBeDefined();
      expect(await readLog(context)).toEqual([
        expect.objectContaining({
          level: "error",
          message: "Unhandled rejection in main",
          context: {
            error: expect.objectContaining({ message: "lost promise" }),
          },
        }),
      ]);
    });
  });
});
