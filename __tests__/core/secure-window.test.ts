import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);

import createSecureWindow, {
  ENFORCED_WEB_PREFERENCES,
} from "../../lib/main/secure-window";
import type { UrlPolicy } from "../../lib/main/url-policy";
import {
  fakeElectron,
  FakeBrowserWindow,
  resetElectron,
} from "../helpers/core-electron";

const policy = (
  devServerUrl?: string,
  isAllowedExternal = true
): UrlPolicy => ({
  devServerUrl,
  isTrustedAppUrl: (url) =>
    url.startsWith("app://bundle/") ||
    (devServerUrl !== undefined && url.startsWith(devServerUrl)),
  isAllowedExternalUrl: () => isAllowedExternal,
});

const PRELOAD = "/app/preload/index.cjs";

const open = (
  options: Partial<Parameters<typeof createSecureWindow>[0]> = {}
): FakeBrowserWindow => {
  createSecureWindow({ preload: PRELOAD, policy: policy(), ...options });
  return FakeBrowserWindow.instances.at(-1) as FakeBrowserWindow;
};

const listenerOf = (window: FakeBrowserWindow, event: string) =>
  window.webContents.listeners(event)[0] as (
    event: { preventDefault: () => void },
    url: string
  ) => void;

beforeEach(() => {
  resetElectron();
});

describe("ENFORCED_WEB_PREFERENCES", () => {
  test("should hold the isolation settings, written out", () => {
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
});

describe("createSecureWindow", () => {
  test("should create a hidden, isolated window with the preload and load the app", () => {
    const window = open({ webPreferences: { spellcheck: false } });
    expect(window.options).toEqual({
      width: 1200,
      height: 800,
      backgroundColor: undefined,
      show: false,
      webPreferences: {
        spellcheck: false,
        ...ENFORCED_WEB_PREFERENCES,
        preload: PRELOAD,
      },
    });
    expect(window.loadURL).toHaveBeenCalledWith("app://bundle/");
  });

  test("should keep the app's own window options but never `show`", () => {
    const window = open({ width: 900, title: "Notes" });
    expect(window.options).toMatchObject({
      width: 900,
      height: 800,
      title: "Notes",
      show: false,
    });
  });

  test("should refuse a web preference that weakens the isolation", () => {
    expect(() =>
      open({
        webPreferences: { sandbox: false, nodeIntegration: true } as never,
      })
    ).toThrow(
      "createSecureWindow: webPreferences.sandbox, webPreferences.nodeIntegration cannot be set"
    );
    expect(FakeBrowserWindow.instances).toHaveLength(0);
  });

  test("should open a route inside the app, on the dev server in development", () => {
    expect(open({ path: "/settings" }).loadURL).toHaveBeenCalledWith(
      "app://bundle/settings"
    );
    expect(
      open({ path: "/x", policy: policy("http://localhost:5173") }).loadURL
    ).toHaveBeenCalledWith("http://localhost:5173/x");
  });

  test.each([["https://evil.example/"], ["//evil.example/page"]])(
    "should refuse a path that leaves the app: %s",
    (path) => {
      expect(() => open({ path })).toThrow(/must be a route inside the app/);
    }
  );

  test("should deny every new window and send an allowed link to the system browser", () => {
    const window = open();
    const handler = window.webContents.setWindowOpenHandler.mock
      .calls[0]?.[0] as (details: { url: string }) => { action: string };
    expect(handler({ url: "https://example.com/" })).toEqual({
      action: "deny",
    });
    expect(fakeElectron.shell.openExternal).toHaveBeenCalledWith(
      "https://example.com/"
    );
  });

  test("should cancel navigations and redirects away from the app", () => {
    const window = open();
    for (const event of ["will-navigate", "will-redirect"]) {
      const preventDefault = vi.fn();
      listenerOf(window, event)({ preventDefault }, "https://evil.example/");
      listenerOf(window, event)({ preventDefault }, "app://bundle/other");
      expect(preventDefault).toHaveBeenCalledTimes(1);
    }
  });

  test("should prevent a <webview> from attaching", () => {
    const preventDefault = vi.fn();
    listenerOf(open(), "will-attach-webview")({ preventDefault }, "");
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  test("should show the window once its first frame is ready", () => {
    const window = open();
    expect(window.show).not.toHaveBeenCalled();
    window.emit("ready-to-show");
    expect(window.show).toHaveBeenCalledTimes(1);
  });

  test("should paint the theme's background and follow the system", () => {
    fakeElectron.nativeTheme.shouldUseDarkColors = true;
    const window = open({
      themeBackground: { light: "#ffffff", dark: "#000000" },
    });
    expect(window.options.backgroundColor).toBe("#000000");

    fakeElectron.nativeTheme.shouldUseDarkColors = false;
    fakeElectron.nativeTheme.emit("updated");
    expect(window.setBackgroundColor).toHaveBeenCalledWith("#ffffff");

    window.close();
    expect(fakeElectron.nativeTheme.listenerCount("updated")).toBe(0);
  });

  test("should not follow the system without a theme background", () => {
    open();
    expect(fakeElectron.nativeTheme.listenerCount("updated")).toBe(0);
  });

  test("should report a failed load to onLoadError", async () => {
    const failure = new Error("ERR_FILE_NOT_FOUND");
    FakeBrowserWindow.loadFailure = failure;
    const onLoadError = vi.fn();
    open({ onLoadError });
    await vi.waitFor(() => expect(onLoadError).toHaveBeenCalledWith(failure));
  });
});
