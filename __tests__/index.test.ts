import { describe, expect, test, vi } from "vitest";

import * as shared from "../lib/index";
import * as main from "../lib/main";
import * as preload from "../lib/preload";
import * as renderer from "../lib/renderer";

// The barrels only re-export; `electron` is mocked so that importing them has no side effect.
vi.mock("electron", () => ({
  app: {},
  BrowserWindow: class {},
  contextBridge: {},
  ipcMain: {},
  ipcRenderer: {},
  nativeTheme: {},
  net: {},
  protocol: {},
  safeStorage: {},
  session: {},
  shell: {},
}));

const names = (module: object): string[] => Object.keys(module).sort();

describe("the public API", () => {
  test("sentinel: the shared entry should export exactly its documented names", () => {
    expect(names(shared)).toEqual([
      "APP_HOST",
      "APP_SCHEME",
      "APP_URL",
      "BRIDGE_KEY",
      "CORE_CHANNELS",
      "LOG_LEVELS",
      "THEME_ATTRIBUTE",
      "THEME_PREFERENCES",
      "THEME_STORAGE_KEY",
      "channelsOf",
      "defineContract",
    ]);
  });

  test("sentinel: the main entry should export exactly its documented names", () => {
    expect(names(main)).toEqual([
      "ENFORCED_WEB_PREFERENCES",
      "IpcError",
      "SecretStoreUnavailableError",
      "acquireSingleInstance",
      "buildContentSecurityPolicy",
      "captureUncaughtErrors",
      "createEmitter",
      "createLogger",
      "createSecretStore",
      "createSecureWindow",
      "createSettingsStore",
      "createThemeBridge",
      "createUrlPolicy",
      "findDeepLink",
      "installSessionGuards",
      "openExternal",
      "redactText",
      "registerAppProtocol",
      "registerAppScheme",
      "registerCoreHandlers",
      "registerHandlers",
      "startApp",
    ]);
  });

  test("sentinel: the preload entry should export exposeBridge and nothing else", () => {
    expect(names(preload)).toEqual(["exposeBridge"]);
  });

  test("sentinel: the renderer entry should export exactly its documented names", () => {
    expect(names(renderer)).toEqual([
      "applyTheme",
      "createClient",
      "forwardErrors",
      "getTheme",
      "log",
      "onThemeChange",
      "setThemePreference",
      "syncTheme",
    ]);
  });

  test("should export no undefined binding from any entry", () => {
    for (const module of [shared, main, preload, renderer]) {
      for (const [name, value] of Object.entries(module)) {
        expect(value, name).toBeDefined();
      }
    }
  });

  test("should keep the fixed values that apps and the design system rely on", () => {
    expect(shared.APP_SCHEME).toBe("app");
    expect(shared.APP_HOST).toBe("bundle");
    expect(shared.APP_URL).toBe("app://bundle/");
    expect(shared.BRIDGE_KEY).toBe("desktop");
    expect(shared.LOG_LEVELS).toEqual(["debug", "info", "warn", "error"]);
    expect(shared.THEME_PREFERENCES).toEqual(["system", "light", "dark"]);
    expect(main.ENFORCED_WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      sandbox: true,
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
