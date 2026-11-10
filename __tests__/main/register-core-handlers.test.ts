import type { IpcMainInvokeEvent, WebContents } from "electron";
import { beforeEach, describe, expect, test, vi } from "vitest";

import IpcError from "../../lib/main/ipc-error";
import type { Logger } from "../../lib/main/logger";
import registerCoreHandlers from "../../lib/main/register-core-handlers";
import type { ThemeBridge } from "../../lib/main/theme-bridge";
import createUrlPolicy from "../../lib/main/url-policy";
import LOG_LEVELS from "../../lib/shared/log-levels.constants";
import type { ThemeState } from "../../lib/types";

type InvokeListener = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => Promise<unknown>;

const { electron, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, InvokeListener>();
  const electron = {
    app: { isPackaged: true },
    ipcMain: {
      handle: vi.fn((channel: string, listener: InvokeListener): void => {
        listeners.set(channel, listener);
      }),
      removeHandler: vi.fn((channel: string): void => {
        listeners.delete(channel);
      }),
    },
    webContents: { getAllWebContents: vi.fn<() => WebContents[]>() },
  };
  return { electron, listeners };
});

vi.mock("electron", () => electron);

const APP_FRAME = "app://bundle/index.html";
const DARK: ThemeState = { preference: "dark", resolved: "dark" };
const SYSTEM_LIGHT: ThemeState = { preference: "system", resolved: "light" };

const policy = createUrlPolicy();

const createLogger = () => {
  const build = () => ({
    debug: vi.fn<Logger["debug"]>(),
    info: vi.fn<Logger["info"]>(),
    warn: vi.fn<Logger["warn"]>(),
    error: vi.fn<Logger["error"]>(),
    directory: "/logs",
    flush: vi.fn<Logger["flush"]>(),
  });
  const renderer = { ...build(), child: vi.fn<Logger["child"]>() };
  const root = { ...build(), child: vi.fn<Logger["child"]>(() => renderer) };
  return { root, renderer };
};

const createTheme = () => {
  const changeListeners = new Set<(state: ThemeState) => void>();
  const stop = vi.fn();
  const theme = {
    getState: vi.fn<ThemeBridge["getState"]>(() => SYSTEM_LIGHT),
    setPreference: vi.fn<ThemeBridge["setPreference"]>(async (preference) => ({
      preference,
      resolved: preference === "dark" ? "dark" : "light",
    })),
    onChange: vi.fn<ThemeBridge["onChange"]>((listener) => {
      changeListeners.add(listener);
      return () => {
        stop();
        changeListeners.delete(listener);
      };
    }),
    dispose: vi.fn<ThemeBridge["dispose"]>(),
  };
  const change = (state: ThemeState): void => {
    for (const listener of changeListeners) listener(state);
  };
  return { theme, change, stop, changeListeners };
};

const createTarget = (url: string) => ({
  isDestroyed: vi.fn(() => false),
  getURL: vi.fn(() => url),
  send: vi.fn<(channel: string, payload: unknown) => void>(),
});

const setUp = (onError?: (error: IpcError, cause: unknown) => void) => {
  const logger = createLogger();
  const theme = createTheme();
  const dispose = registerCoreHandlers({
    logger: logger.root,
    theme: theme.theme,
    policy,
    onError,
  });
  return { logger, ...theme, dispose };
};

const invokeFrom = (
  frameUrl: string,
  channel: string,
  ...args: unknown[]
): Promise<unknown> => {
  const listener = listeners.get(channel);
  if (listener === undefined) {
    throw new Error(`No handler registered for '${channel}'`);
  }
  const event = { senderFrame: { url: frameUrl } };
  return listener(event as unknown as IpcMainInvokeEvent, ...args);
};

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  invokeFrom(APP_FRAME, channel, ...args);

const rejectionOf = async (call: Promise<unknown>): Promise<unknown> => {
  const settled = await call.then(
    (value) => ({ resolved: true, value }),
    (error: unknown) => ({ resolved: false, value: error })
  );
  expect(settled.resolved, "the call should be rejected").toBe(false);
  return settled.value;
};

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  electron.webContents.getAllWebContents.mockReturnValue([]);
});

describe("registerCoreHandlers: registration", () => {
  test("should register exactly the core request channels", () => {
    setUp();

    expect([...listeners.keys()]).toEqual([
      "core-log:write",
      "core-theme:get",
      "core-theme:set",
    ]);
  });

  test("should log under the renderer scope", () => {
    const { logger } = setUp();

    expect(logger.root.child).toHaveBeenCalledExactlyOnceWith("renderer");
  });

  test("should listen to theme changes once", () => {
    const { theme, changeListeners } = setUp();

    expect(theme.onChange).toHaveBeenCalledOnce();
    expect(changeListeners.size).toBe(1);
  });
});

describe("registerCoreHandlers: core-log:write", () => {
  test.each(LOG_LEVELS)(
    "should write a %s line to the renderer logger",
    async (level) => {
      const { logger } = setUp();
      const context = { route: "/settings", attempt: 2 };

      await expect(
        invoke("core-log:write", { level, message: "hello", context })
      ).resolves.toBeUndefined();

      expect(logger.renderer[level]).toHaveBeenCalledExactlyOnceWith(
        "hello",
        context
      );
      for (const other of LOG_LEVELS.filter((name) => name !== level)) {
        expect(logger.renderer[other]).not.toHaveBeenCalled();
      }
      for (const name of LOG_LEVELS) {
        expect(logger.root[name]).not.toHaveBeenCalled();
      }
    }
  );

  test("should write a line without context", async () => {
    const { logger } = setUp();

    await invoke("core-log:write", { level: "warn", message: "careful" });

    expect(logger.renderer.warn).toHaveBeenCalledExactlyOnceWith(
      "careful",
      undefined
    );
  });

  test.each([
    ["an unknown level", { level: "fatal", message: "x" }],
    ["a method of the logger as level", { level: "flush", message: "x" }],
    ["an inherited property as level", { level: "constructor", message: "x" }],
    ["an oversized message", { level: "info", message: "m".repeat(4001) }],
    [
      "an oversized context key",
      { level: "info", message: "x", context: { ["k".repeat(101)]: 1 } },
    ],
    ["a missing entry", undefined],
  ])("should reject %s and log nothing", async (_label, entry) => {
    const { logger } = setUp();

    const error = await rejectionOf(invoke("core-log:write", entry));

    expect(error).toBeInstanceOf(IpcError);
    expect(error).toMatchObject({
      code: "INVALID_INPUT",
      channel: "core-log:write",
    });
    for (const name of LOG_LEVELS) {
      expect(logger.renderer[name]).not.toHaveBeenCalled();
    }
    expect(logger.renderer.flush).not.toHaveBeenCalled();
  });
});

describe("registerCoreHandlers: core-theme:get and core-theme:set", () => {
  test("should answer core-theme:get with the current state", async () => {
    const { theme } = setUp();
    theme.getState.mockReturnValue(DARK);

    await expect(invoke("core-theme:get")).resolves.toEqual(DARK);
    expect(theme.getState).toHaveBeenCalledOnce();
  });

  test.each(["system", "light", "dark"] as const)(
    "should set the preference %s and answer with the new state",
    async (preference) => {
      const { theme } = setUp();

      await expect(invoke("core-theme:set", preference)).resolves.toEqual({
        preference,
        resolved: preference === "dark" ? "dark" : "light",
      });
      expect(theme.setPreference).toHaveBeenCalledExactlyOnceWith(preference);
    }
  );

  test.each(["auto", "", "DARK", 1, null, undefined, { preference: "dark" }])(
    "should reject the preference %j without setting it",
    async (preference) => {
      const { theme } = setUp();

      const error = await rejectionOf(invoke("core-theme:set", preference));

      expect(error).toMatchObject({
        code: "INVALID_INPUT",
        channel: "core-theme:set",
      });
      expect(theme.setPreference).not.toHaveBeenCalled();
    }
  );

  test("should reject a state from the theme bridge that is not a theme state", async () => {
    const { theme } = setUp();
    theme.getState.mockReturnValue({
      preference: "dark",
      resolved: "system",
    } as unknown as ThemeState);

    expect(await rejectionOf(invoke("core-theme:get"))).toMatchObject({
      code: "INVALID_OUTPUT",
      channel: "core-theme:get",
    });
  });
});

describe("registerCoreHandlers: the sender frame", () => {
  test.each([
    ["core-log:write", [{ level: "error", message: "forged" }]],
    ["core-theme:get", []],
    ["core-theme:set", ["dark"]],
  ])("should refuse %s from a foreign frame", async (channel, args) => {
    const { logger, theme } = setUp();

    const error = await rejectionOf(
      invokeFrom("https://evil.test/", channel, ...args)
    );

    expect(error).toMatchObject({ code: "UNTRUSTED_SENDER", channel });
    expect(logger.renderer.error).not.toHaveBeenCalled();
    expect(theme.getState).not.toHaveBeenCalled();
    expect(theme.setPreference).not.toHaveBeenCalled();
  });

  test("should report a refused call to onError", async () => {
    const onError = vi.fn();
    setUp(onError);

    const error = await rejectionOf(
      invokeFrom("https://evil.test/", "core-theme:get")
    );

    expect(onError).toHaveBeenCalledExactlyOnceWith(error, error);
  });

  test("should hide a failure of the theme bridge and report its cause to onError", async () => {
    const onError = vi.fn();
    const cause = new Error("EACCES: /Users/someone/theme.json");
    const { theme } = setUp(onError);
    theme.setPreference.mockRejectedValue(cause);

    const error = await rejectionOf(invoke("core-theme:set", "dark"));

    expect(error).toMatchObject({
      message: "[HANDLER_FAILED] core-theme:set: the handler failed",
    });
    expect(onError).toHaveBeenCalledExactlyOnceWith(error, cause);
  });
});

describe("registerCoreHandlers: theme changes", () => {
  test("should broadcast a theme change to every window of the app", () => {
    const { change } = setUp();
    const first = createTarget(APP_FRAME);
    const second = createTarget("app://bundle/settings");
    const foreign = createTarget("https://evil.test/");
    electron.webContents.getAllWebContents.mockReturnValue(
      [first, foreign, second].map((target) => target as unknown as WebContents)
    );

    change(DARK);

    expect(first.send).toHaveBeenCalledExactlyOnceWith(
      "core-theme:changed",
      DARK
    );
    expect(second.send).toHaveBeenCalledExactlyOnceWith(
      "core-theme:changed",
      DARK
    );
    expect(foreign.send).not.toHaveBeenCalled();
  });

  test("should broadcast every change", () => {
    const { change } = setUp();
    const target = createTarget(APP_FRAME);
    electron.webContents.getAllWebContents.mockReturnValue([
      target as unknown as WebContents,
    ]);

    change(DARK);
    change(SYSTEM_LIGHT);

    expect(target.send.mock.calls).toEqual([
      ["core-theme:changed", DARK],
      ["core-theme:changed", SYSTEM_LIGHT],
    ]);
  });

  test("should refuse to broadcast a state that is not a theme state", () => {
    const { change } = setUp();
    const target = createTarget(APP_FRAME);
    electron.webContents.getAllWebContents.mockReturnValue([
      target as unknown as WebContents,
    ]);

    expect(() =>
      change({ preference: "dark", resolved: "blue" } as unknown as ThemeState)
    ).toThrow(IpcError);
    expect(target.send).not.toHaveBeenCalled();
  });
});

describe("registerCoreHandlers: undoing", () => {
  test("should remove the handlers and stop broadcasting", () => {
    const { dispose, change, stop } = setUp();
    const target = createTarget(APP_FRAME);
    electron.webContents.getAllWebContents.mockReturnValue([
      target as unknown as WebContents,
    ]);

    expect(electron.ipcMain.removeHandler).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();

    dispose();

    expect(
      electron.ipcMain.removeHandler.mock.calls.map(([name]) => name)
    ).toEqual(["core-log:write", "core-theme:get", "core-theme:set"]);
    expect(listeners.size).toBe(0);
    expect(stop).toHaveBeenCalledOnce();

    change(DARK);

    expect(target.send).not.toHaveBeenCalled();
  });
});
