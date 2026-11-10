import type { BrowserWindowConstructorOptions } from "electron";
import { beforeEach, describe, expect, test, vi } from "vitest";

import createSecureWindow, {
  ENFORCED_WEB_PREFERENCES,
} from "../../lib/main/secure-window";
import type { SecureWindowOptions } from "../../lib/main/secure-window";
import createUrlPolicy from "../../lib/main/url-policy";

type Listener = (...args: unknown[]) => unknown;
type Subscribe = (event: string, listener: Listener) => void;
type WindowOpenHandler = (details: { url: string }) => { action: string };

const { electron, fakeWindow } = vi.hoisted(() => {
  const fakeWindow = {
    webContents: {
      setWindowOpenHandler: vi.fn<(handler: WindowOpenHandler) => void>(),
      on: vi.fn<Subscribe>(),
    },
    once: vi.fn<Subscribe>(),
    show: vi.fn(),
    setBackgroundColor: vi.fn<(color: string) => void>(),
    loadURL: vi.fn<(url: string) => Promise<void>>(),
  };
  const electron = {
    app: { isPackaged: true },
    shell: { openExternal: vi.fn<(url: string) => Promise<void>>() },
    nativeTheme: {
      shouldUseDarkColors: false,
      on: vi.fn<Subscribe>(),
      removeListener: vi.fn<Subscribe>(),
    },
    BrowserWindow: vi.fn<
      (options: BrowserWindowConstructorOptions) => typeof fakeWindow
    >(function () {
      return fakeWindow;
    }),
  };
  return { electron, fakeWindow };
});

vi.mock("electron", () => electron);

const PRELOAD = "/Applications/App.app/Contents/Resources/preload.cjs";

const policy = createUrlPolicy({ externalHosts: ["example.com"] });

beforeEach(() => {
  vi.clearAllMocks();
  electron.app.isPackaged = true;
  electron.nativeTheme.shouldUseDarkColors = false;
  electron.shell.openExternal.mockResolvedValue(undefined);
  fakeWindow.loadURL.mockResolvedValue(undefined);
});

const open = (options: Partial<SecureWindowOptions> = {}): unknown =>
  createSecureWindow({ preload: PRELOAD, policy, ...options });

/** The options the BrowserWindow was constructed with. */
const windowOptions = (): BrowserWindowConstructorOptions => {
  const options = electron.BrowserWindow.mock.calls[0]?.[0];
  if (options === undefined) throw new Error("no BrowserWindow was created");
  return options;
};

/** The single listener registered for an event through `on`/`once`. */
const listenerOf = (
  subscribe: { mock: { calls: Parameters<Subscribe>[] } },
  event: string
): Listener => {
  const listeners = subscribe.mock.calls
    .filter(([name]) => name === event)
    .map(([, listener]) => listener);
  const [listener] = listeners;
  if (listener === undefined || listeners.length !== 1) {
    throw new Error(
      `expected one "${event}" listener, got ${listeners.length}`
    );
  }
  return listener;
};

const windowOpenHandler = (): WindowOpenHandler => {
  const handler =
    fakeWindow.webContents.setWindowOpenHandler.mock.calls[0]?.[0];
  if (handler === undefined) throw new Error("no window open handler was set");
  return handler;
};

describe("createSecureWindow: isolation", () => {
  test("should enforce the isolation preferences", () => {
    open();

    expect(windowOptions().webPreferences).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      preload: PRELOAD,
    });
  });

  test("should export the enforced preferences as they are applied", () => {
    expect(ENFORCED_WEB_PREFERENCES).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
    });
  });

  test("should keep the harmless preferences next to the enforced ones", () => {
    open({
      webPreferences: {
        spellcheck: false,
        zoomFactor: 1.25,
        devTools: false,
        partition: "persist:main",
        additionalArguments: ["--flag"],
      },
    });

    expect(windowOptions().webPreferences).toEqual({
      spellcheck: false,
      zoomFactor: 1.25,
      devTools: false,
      partition: "persist:main",
      additionalArguments: ["--flag"],
      ...ENFORCED_WEB_PREFERENCES,
      preload: PRELOAD,
    });
  });

  test.each([
    ["sandbox", false],
    ["sandbox", true],
    ["contextIsolation", false],
    ["nodeIntegration", true],
    ["nodeIntegrationInWorker", true],
    ["nodeIntegrationInSubFrames", true],
    ["webSecurity", false],
    ["allowRunningInsecureContent", true],
    ["experimentalFeatures", true],
    ["webviewTag", true],
    ["navigateOnDragDrop", true],
    ["enableBlinkFeatures", "ExecCommandInJavaScript"],
    ["disableBlinkFeatures", "Auxclick"],
    ["preload", "/tmp/other-preload.js"],
    ["javascript", false],
    ["images", false],
    ["someFuturePreference", true],
  ])(
    "should refuse to create a window with webPreferences.%s set to %j",
    (key, value) => {
      expect(() =>
        open({
          // A key outside SafeWebPreferences, as an untyped caller could pass it.
          webPreferences: { [key]: value },
        })
      ).toThrow(
        new TypeError(
          `createSecureWindow: webPreferences.${key} cannot be set; the isolation settings of a window are fixed`
        )
      );
      expect(electron.BrowserWindow).not.toHaveBeenCalled();
    }
  );

  test("should name every refused preference, and only those", () => {
    expect(() =>
      open({
        webPreferences: {
          spellcheck: true,
          // @ts-expect-error -- unsafe keys, as an untyped caller could pass them
          sandbox: false,
          nodeIntegration: true,
        },
      })
    ).toThrow(
      new TypeError(
        "createSecureWindow: webPreferences.sandbox, webPreferences.nodeIntegration cannot be set; the isolation settings of a window are fixed"
      )
    );
    expect(electron.BrowserWindow).not.toHaveBeenCalled();
  });

  test("should enforce the preferences over an object that changes after the check", () => {
    // The first key listing (the check) sees nothing; the second (the copy) sees everything.
    let listings = 0;
    const shifting = new Proxy(
      {
        sandbox: false,
        contextIsolation: false,
        nodeIntegration: true,
        webSecurity: false,
        webviewTag: true,
        preload: "/tmp/other-preload.js",
      },
      {
        ownKeys: (target) => (listings++ === 0 ? [] : Reflect.ownKeys(target)),
      }
    );

    // @ts-expect-error -- unsafe keys behind a proxy, to reach the second line of defence
    open({ webPreferences: shifting });

    expect(listings).toBe(2);
    expect(windowOptions().webPreferences).toEqual({
      ...ENFORCED_WEB_PREFERENCES,
      preload: PRELOAD,
    });
  });

  test("should not let a window option smuggle web preferences or show the window", () => {
    const smuggled = {
      show: true,
      webPreferences: { sandbox: false, spellcheck: true },
    };

    expect(() => open(smuggled as Partial<SecureWindowOptions>)).toThrow(
      TypeError
    );

    open({ show: true } as Partial<SecureWindowOptions>);

    expect(windowOptions().show).toBe(false);
  });
});

describe("createSecureWindow: the window", () => {
  test("should return the window it created", () => {
    expect(open()).toBe(fakeWindow);
    expect(electron.BrowserWindow).toHaveBeenCalledOnce();
  });

  test("should default to a 1200 by 800 window", () => {
    open();

    expect(windowOptions()).toMatchObject({ width: 1200, height: 800 });
  });

  test("should pass the other window options through", () => {
    open({ width: 640, height: 480, title: "Notes", minWidth: 320 });

    expect(windowOptions()).toMatchObject({
      width: 640,
      height: 480,
      title: "Notes",
      minWidth: 320,
    });
  });

  test("should keep its own options out of the BrowserWindow options", () => {
    open({
      path: "/settings",
      themeBackground: { light: "#ffffff", dark: "#000000" },
      onLoadError: () => undefined,
    });

    expect(Object.keys(windowOptions()).sort()).toEqual([
      "backgroundColor",
      "height",
      "show",
      "webPreferences",
      "width",
    ]);
  });

  test("should stay hidden until the first frame is ready", () => {
    open();

    expect(windowOptions().show).toBe(false);
    expect(fakeWindow.show).not.toHaveBeenCalled();

    listenerOf(fakeWindow.once, "ready-to-show")();

    expect(fakeWindow.show).toHaveBeenCalledOnce();
  });
});

describe("createSecureWindow: window.open", () => {
  test.each([
    ["an allowed external link", "https://example.com/docs"],
    ["an external link that is not allowed", "https://evil.test/"],
    ["the app's own page", "app://bundle/settings"],
    ["about:blank", "about:blank"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a file URL", "file:///etc/passwd"],
  ])("should deny a new window for %s", (_label, url) => {
    open();

    expect(windowOpenHandler()({ url })).toEqual({ action: "deny" });
  });

  test("should hand an allowed link to the system browser", () => {
    open();

    windowOpenHandler()({ url: "https://example.com/docs" });

    expect(electron.shell.openExternal).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/docs"
    );
  });

  test.each([
    "https://evil.test/",
    "http://example.com/",
    "https://user:secret@example.com/",
    "app://bundle/settings",
    "file:///etc/passwd",
  ])("should not hand %s to the system browser", (url) => {
    open();

    windowOpenHandler()({ url });

    expect(electron.shell.openExternal).not.toHaveBeenCalled();
  });

  test("should deny the window even when the system browser fails", async () => {
    electron.shell.openExternal.mockRejectedValue(new Error("no browser"));
    open();

    expect(windowOpenHandler()({ url: "https://example.com/" })).toEqual({
      action: "deny",
    });
    await vi.waitFor(() =>
      expect(electron.shell.openExternal).toHaveBeenCalledOnce()
    );
  });
});

describe("createSecureWindow: navigation", () => {
  const FOREIGN_URLS = [
    "https://example.com/",
    "https://evil.test/login",
    "http://localhost:5173/",
    "app://evil/index.html",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "about:blank",
    "",
  ];

  describe.each(["will-navigate", "will-redirect"])("%s", (eventName) => {
    test.each(FOREIGN_URLS)("should prevent leaving the app for %j", (url) => {
      const event = { preventDefault: vi.fn() };
      open();

      listenerOf(fakeWindow.webContents.on, eventName)(event, url);

      expect(event.preventDefault).toHaveBeenCalledOnce();
    });

    test.each(["app://bundle/", "app://bundle/settings?tab=about#top"])(
      "should let the app move to its own page %s",
      (url) => {
        const event = { preventDefault: vi.fn() };
        open();

        listenerOf(fakeWindow.webContents.on, eventName)(event, url);

        expect(event.preventDefault).not.toHaveBeenCalled();
      }
    );

    test("should let an unpackaged app move inside its dev server only", () => {
      electron.app.isPackaged = false;
      const devPolicy = createUrlPolicy({
        devServerUrl: "http://localhost:5173",
      });
      const inside = { preventDefault: vi.fn() };
      const outside = { preventDefault: vi.fn() };
      open({ policy: devPolicy });
      const listener = listenerOf(fakeWindow.webContents.on, eventName);

      listener(inside, "http://localhost:5173/settings");
      listener(outside, "http://localhost:5174/settings");

      expect(inside.preventDefault).not.toHaveBeenCalled();
      expect(outside.preventDefault).toHaveBeenCalledOnce();
    });
  });

  test("should prevent every <webview> from attaching", () => {
    const event = { preventDefault: vi.fn() };
    open();

    listenerOf(fakeWindow.webContents.on, "will-attach-webview")(
      event,
      { preload: "/tmp/evil.js", nodeIntegration: true },
      { src: "app://bundle/" }
    );

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  test("should install the guards before the page starts to load", () => {
    open();

    const [loadOrder = 0] = fakeWindow.loadURL.mock.invocationCallOrder;
    const guardOrders = [
      ...fakeWindow.webContents.setWindowOpenHandler.mock.invocationCallOrder,
      ...fakeWindow.webContents.on.mock.invocationCallOrder,
    ];

    expect(guardOrders).toHaveLength(4);
    for (const order of guardOrders) expect(order).toBeLessThan(loadOrder);
  });
});

describe("createSecureWindow: the page it loads", () => {
  test("should load the root of the bundle by default", () => {
    open();

    expect(fakeWindow.loadURL).toHaveBeenCalledExactlyOnceWith("app://bundle/");
  });

  test.each([
    ["/settings", "app://bundle/settings"],
    ["settings/profile", "app://bundle/settings/profile"],
    ["/search?q=a b#top", "app://bundle/search?q=a%20b#top"],
    ["#/settings", "app://bundle/#/settings"],
  ])("should load the route %s as %s", (path, url) => {
    open({ path });

    expect(fakeWindow.loadURL).toHaveBeenCalledExactlyOnceWith(url);
  });

  test("should load from the dev server in an unpackaged app", () => {
    electron.app.isPackaged = false;
    const devPolicy = createUrlPolicy({
      devServerUrl: "http://localhost:5173",
    });

    open({ policy: devPolicy, path: "/settings" });

    expect(fakeWindow.loadURL).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:5173/settings"
    );
  });

  test("should load the bundle in a packaged app whatever dev server is configured", () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173");
    const packagedPolicy = createUrlPolicy({
      devServerUrl: "http://localhost:5173",
    });

    open({ policy: packagedPolicy });

    expect(fakeWindow.loadURL).toHaveBeenCalledExactlyOnceWith("app://bundle/");
  });

  test.each([
    ["an absolute https URL", "https://evil.test/"],
    ["a protocol-relative URL", "//evil.test/index.html"],
    ["another host on the app scheme", "app://evil/index.html"],
    ["a file URL", "file:///etc/passwd"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<script>alert(1)</script>"],
  ])("should refuse to create a window whose path is %s", (_label, path) => {
    expect(() => open({ path })).toThrow(
      new TypeError(
        `createSecureWindow: path ${JSON.stringify(path)} must be a route inside the app, like "/settings"`
      )
    );
    expect(electron.BrowserWindow).not.toHaveBeenCalled();
    expect(fakeWindow.loadURL).not.toHaveBeenCalled();
  });

  test("should refuse a path that leaves the dev server in an unpackaged app", () => {
    electron.app.isPackaged = false;
    const devPolicy = createUrlPolicy({
      devServerUrl: "http://localhost:5173",
    });

    expect(() =>
      open({ policy: devPolicy, path: "//evil.test/index.html" })
    ).toThrow(TypeError);
    expect(() =>
      open({ policy: devPolicy, path: "http://localhost:5174/" })
    ).toThrow(TypeError);
    expect(fakeWindow.loadURL).not.toHaveBeenCalled();
  });

  test("should report a failed load to onLoadError", async () => {
    const failure = new Error("ERR_FILE_NOT_FOUND");
    const onLoadError = vi.fn();
    fakeWindow.loadURL.mockRejectedValue(failure);

    open({ onLoadError });

    await vi.waitFor(() =>
      expect(onLoadError).toHaveBeenCalledExactlyOnceWith(failure)
    );
  });

  test("should not call onLoadError when the page loads", async () => {
    const onLoadError = vi.fn();
    const loading = Promise.resolve();
    fakeWindow.loadURL.mockReturnValue(loading);

    open({ onLoadError });
    await loading;

    expect(onLoadError).not.toHaveBeenCalled();
  });

  test("should leave the load rejection alone without onLoadError", () => {
    const loading = Promise.resolve();
    const catchSpy = vi.spyOn(loading, "catch");
    fakeWindow.loadURL.mockReturnValue(loading);

    open();

    expect(catchSpy).not.toHaveBeenCalled();
  });
});

describe("createSecureWindow: the theme background", () => {
  const themeBackground = { light: "#ffffff", dark: "#101010" };

  test("should start with the light background on a light system", () => {
    open({ themeBackground });

    expect(windowOptions().backgroundColor).toBe("#ffffff");
  });

  test("should start with the dark background on a dark system", () => {
    electron.nativeTheme.shouldUseDarkColors = true;

    open({ themeBackground });

    expect(windowOptions().backgroundColor).toBe("#101010");
  });

  test("should let an explicit backgroundColor win", () => {
    open({ themeBackground, backgroundColor: "#ff0000" });

    expect(windowOptions().backgroundColor).toBe("#ff0000");
  });

  test("should repaint when the system theme changes", () => {
    open({ themeBackground });
    const repaint = listenerOf(electron.nativeTheme.on, "updated");

    electron.nativeTheme.shouldUseDarkColors = true;
    repaint();
    electron.nativeTheme.shouldUseDarkColors = false;
    repaint();

    expect(fakeWindow.setBackgroundColor.mock.calls).toEqual([
      ["#101010"],
      ["#ffffff"],
    ]);
  });

  test("should stop following the theme when the window closes", () => {
    open({ themeBackground });
    const repaint = listenerOf(electron.nativeTheme.on, "updated");

    expect(electron.nativeTheme.removeListener).not.toHaveBeenCalled();

    listenerOf(fakeWindow.once, "closed")();

    expect(electron.nativeTheme.removeListener).toHaveBeenCalledExactlyOnceWith(
      "updated",
      repaint
    );
  });

  test("should not touch the background or the theme without themeBackground", () => {
    open();

    expect(windowOptions().backgroundColor).toBeUndefined();
    expect(electron.nativeTheme.on).not.toHaveBeenCalled();
    expect(fakeWindow.once.mock.calls.map(([name]) => name)).toEqual([
      "ready-to-show",
    ]);
  });
});
