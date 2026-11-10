import type { Session } from "electron";
import { beforeEach, describe, expect, test, vi } from "vitest";

import installSessionGuards from "../../lib/main/session-guards";
import type { SessionGuardsOptions } from "../../lib/main/session-guards";
import createUrlPolicy from "../../lib/main/url-policy";

type Page = { getURL: () => string };
type RequestHandler = (
  webContents: Page,
  permission: string,
  callback: (granted: boolean) => void
) => void;
type CheckHandler = (webContents: Page | null, permission: string) => boolean;
type DeviceHandler = (details: {
  deviceType: string;
  origin: string;
}) => boolean;
type ResponseHeaders = Record<string, string[]>;
type HeadersListener = (
  details: { responseHeaders?: ResponseHeaders },
  callback: (response: { responseHeaders?: ResponseHeaders }) => void
) => void;

const electron = vi.hoisted(() => ({ app: { isPackaged: true } }));

vi.mock("electron", () => electron);

const APP_PAGE = "app://bundle/index.html";
const DEV_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'";

// Every permission Electron can ask for, by request or by check.
const PERMISSIONS = [
  "clipboard-read",
  "clipboard-sanitized-write",
  "display-capture",
  "fullscreen",
  "geolocation",
  "idle-detection",
  "media",
  "mediaKeySystem",
  "midi",
  "midiSysex",
  "notifications",
  "pointerLock",
  "keyboardLock",
  "openExternal",
  "speaker-selection",
  "storage-access",
  "top-level-storage-access",
  "window-management",
  "fileSystem",
  "hid",
  "serial",
  "usb",
  "unknown",
];

const createSession = () => ({
  setPermissionRequestHandler: vi.fn<(handler: RequestHandler) => void>(),
  setPermissionCheckHandler: vi.fn<(handler: CheckHandler) => void>(),
  setDevicePermissionHandler: vi.fn<(handler: DeviceHandler) => void>(),
  webRequest: {
    onHeadersReceived:
      vi.fn<(filter: { urls: string[] }, listener: HeadersListener) => void>(),
  },
});

const page = (url: string): Page => ({ getURL: () => url });

/** Installs the guards on a fresh session and returns the handlers Electron would call. */
const install = (options: Partial<SessionGuardsOptions> = {}) => {
  const session = createSession();
  installSessionGuards(session as unknown as Session, {
    policy: createUrlPolicy(),
    ...options,
  });

  const requestHandler = session.setPermissionRequestHandler.mock.calls[0]?.[0];
  const checkHandler = session.setPermissionCheckHandler.mock.calls[0]?.[0];
  const deviceHandler = session.setDevicePermissionHandler.mock.calls[0]?.[0];
  if (
    requestHandler === undefined ||
    checkHandler === undefined ||
    deviceHandler === undefined
  ) {
    throw new Error("a permission handler was not installed");
  }

  return {
    session,
    /** Asks for a permission the way Electron does and returns the answer given. */
    request: (url: string, permission: string): boolean[] => {
      const answers: boolean[] = [];
      requestHandler(page(url), permission, (granted) => answers.push(granted));
      return answers;
    },
    check: checkHandler,
    device: deviceHandler,
  };
};

beforeEach(() => {
  electron.app.isPackaged = true;
});

describe("installSessionGuards: permission requests", () => {
  test("should install each permission handler exactly once", () => {
    const { session } = install();

    expect(session.setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(session.setPermissionCheckHandler).toHaveBeenCalledOnce();
    expect(session.setDevicePermissionHandler).toHaveBeenCalledOnce();
  });

  test.each(PERMISSIONS)(
    "should deny %s to the app's own page by default",
    (permission) => {
      const { request } = install();

      expect(request(APP_PAGE, permission)).toEqual([false]);
    }
  );

  test("should grant a listed permission to the app's own page", () => {
    const { request } = install({ permissions: ["notifications", "media"] });

    expect(request(APP_PAGE, "notifications")).toEqual([true]);
    expect(request(APP_PAGE, "media")).toEqual([true]);
  });

  test("should deny a permission that is not listed", () => {
    const { request } = install({ permissions: ["notifications"] });

    expect(request(APP_PAGE, "geolocation")).toEqual([false]);
    expect(request(APP_PAGE, "display-capture")).toEqual([false]);
    expect(request(APP_PAGE, "Notifications")).toEqual([false]);
  });

  test.each([
    "https://example.com/",
    "http://localhost:5173/",
    "app://evil/index.html",
    "file:///index.html",
    "about:blank",
    "",
  ])("should deny a listed permission to the foreign page %j", (url) => {
    const { request } = install({ permissions: ["notifications"] });

    expect(request(url, "notifications")).toEqual([false]);
  });

  test("should grant a listed permission to the dev server page of an unpackaged app", () => {
    electron.app.isPackaged = false;
    const policy = createUrlPolicy({ devServerUrl: "http://localhost:5173" });
    const { request } = install({ policy, permissions: ["notifications"] });

    expect(request("http://localhost:5173/", "notifications")).toEqual([true]);
    expect(request("http://localhost:5174/", "notifications")).toEqual([false]);
    expect(request("http://localhost:5173/", "geolocation")).toEqual([false]);
  });
});

describe("installSessionGuards: permission checks", () => {
  test.each(PERMISSIONS)(
    "should deny %s to the app's own page by default",
    (permission) => {
      const { check } = install();

      expect(check(page(APP_PAGE), permission)).toBe(false);
    }
  );

  test("should grant a listed permission to the app's own page", () => {
    const { check } = install({ permissions: ["notifications"] });

    expect(check(page(APP_PAGE), "notifications")).toBe(true);
  });

  test("should deny a permission that is not listed", () => {
    const { check } = install({ permissions: ["notifications"] });

    expect(check(page(APP_PAGE), "media")).toBe(false);
  });

  test("should deny a listed permission to a foreign page", () => {
    const { check } = install({ permissions: ["notifications"] });

    expect(check(page("https://example.com/"), "notifications")).toBe(false);
    expect(check(page("app://evil/"), "notifications")).toBe(false);
    expect(check(page(""), "notifications")).toBe(false);
  });

  test("should deny a check that comes without a page", () => {
    const { check } = install({ permissions: ["notifications"] });

    expect(check(null, "notifications")).toBe(false);
  });
});

describe("installSessionGuards: devices", () => {
  test.each(["hid", "serial", "usb"])(
    "should deny a %s device, even to the app's own origin",
    (deviceType) => {
      const { device } = install({ permissions: [deviceType] });

      expect(device({ deviceType, origin: "app://bundle" })).toBe(false);
    }
  );
});

describe("installSessionGuards: the development CSP", () => {
  const installWithDevServer = () => {
    electron.app.isPackaged = false;
    const policy = createUrlPolicy({ devServerUrl: "http://localhost:5173/" });
    const { session } = install({ policy, devContentSecurityPolicy: DEV_CSP });

    const [filter, listener] =
      session.webRequest.onHeadersReceived.mock.calls[0] ?? [];
    if (filter === undefined || listener === undefined) {
      throw new Error("onHeadersReceived was not installed");
    }
    const respond = (responseHeaders?: ResponseHeaders): unknown => {
      const callback = vi.fn();
      listener({ responseHeaders }, callback);
      expect(callback).toHaveBeenCalledOnce();
      return callback.mock.calls[0]?.[0];
    };
    return { session, filter, respond };
  };

  test("should watch the dev server's responses only", () => {
    const { session, filter } = installWithDevServer();

    expect(session.webRequest.onHeadersReceived).toHaveBeenCalledOnce();
    expect(filter).toEqual({ urls: ["http://localhost:5173/*"] });
  });

  test("should put the CSP on a response and keep its other headers", () => {
    const { respond } = installWithDevServer();

    expect(respond({ "Content-Type": ["text/html"], ETag: ['W/"1"'] })).toEqual(
      {
        responseHeaders: {
          "Content-Type": ["text/html"],
          ETag: ['W/"1"'],
          "Content-Security-Policy": [DEV_CSP],
        },
      }
    );
  });

  test("should replace a CSP the dev server sends itself", () => {
    const { respond } = installWithDevServer();

    expect(respond({ "Content-Security-Policy": ["default-src *"] })).toEqual({
      responseHeaders: { "Content-Security-Policy": [DEV_CSP] },
    });
  });

  test("should put the CSP on a response without headers", () => {
    const { respond } = installWithDevServer();

    expect(respond(undefined)).toEqual({
      responseHeaders: { "Content-Security-Policy": [DEV_CSP] },
    });
  });

  test("should leave the headers alone in a packaged app", () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173");
    const policy = createUrlPolicy({ devServerUrl: "http://localhost:5173" });

    const { session } = install({ policy, devContentSecurityPolicy: DEV_CSP });

    expect(session.webRequest.onHeadersReceived).not.toHaveBeenCalled();
  });

  test("should leave the headers alone without a development CSP", () => {
    electron.app.isPackaged = false;
    const policy = createUrlPolicy({ devServerUrl: "http://localhost:5173" });

    const { session } = install({ policy });

    expect(session.webRequest.onHeadersReceived).not.toHaveBeenCalled();
  });

  test("should still deny permissions when the development CSP is installed", () => {
    electron.app.isPackaged = false;
    const policy = createUrlPolicy({ devServerUrl: "http://localhost:5173" });

    const { request, check, device } = install({
      policy,
      devContentSecurityPolicy: DEV_CSP,
    });

    expect(request("http://localhost:5173/", "media")).toEqual([false]);
    expect(check(page("http://localhost:5173/"), "media")).toBe(false);
    expect(device({ deviceType: "usb", origin: "http://localhost:5173" })).toBe(
      false
    );
  });
});
