import { describe, expect, test, vi } from "vitest";
import { z } from "zod";

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: class {},
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcMain: {},
  ipcRenderer: {},
  nativeTheme: {},
  net: {},
  powerMonitor: {},
  protocol: {},
  safeStorage: {},
  session: {},
  shell: {},
  webContents: {},
}));

import * as shared from "@handijitcom/electron";
import * as auth from "@handijitcom/electron/auth";
import * as main from "@handijitcom/electron/main";
import * as preload from "@handijitcom/electron/preload";
import * as renderer from "@handijitcom/electron/renderer";
import * as update from "@handijitcom/electron/update";

const EXPECTED_SHARED = [
  "APP_HOST",
  "APP_SCHEME",
  "APP_URL",
  "AUTH_CHANNELS",
  "AUTH_ERROR_CODES",
  "AUTH_STATUSES",
  "authErrorMessage",
  "BRIDGE_KEY",
  "channelsOf",
  "CORE_CHANNELS",
  "defineContract",
  "isAuthState",
  "isSignInResult",
  "isUpdateState",
  "LOG_LEVELS",
  "THEME_ATTRIBUTE",
  "THEME_PREFERENCES",
  "THEME_STORAGE_KEY",
  "UNSUPPORTED_REASONS",
  "UPDATE_CHANNELS",
  "UPDATE_ERROR_CODES",
  "UPDATE_STATUSES",
  "UPDATE_VERDICTS",
  "withUpdateChannels",
] as const;

const EXPECTED_MAIN = [
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
  "ENFORCED_WEB_PREFERENCES",
  "findDeepLink",
  "installSessionGuards",
  "IpcError",
  "listPrinters",
  "openExternal",
  "printSilently",
  "redactText",
  "registerAppProtocol",
  "registerAppScheme",
  "registerCoreHandlers",
  "registerHandlers",
  "SecretStoreUnavailableError",
  "startApp",
] as const;

const EXPECTED_PRELOAD = [
  "AUTH_CHANNELS",
  "exposeBridge",
  "UPDATE_CHANNELS",
  "withUpdateChannels",
] as const;

const EXPECTED_RENDERER = [
  "applyTheme",
  "authErrorMessage",
  "createAuthStore",
  "createClient",
  "createUpdateClient",
  "forwardErrors",
  "getAuthStore",
  "getTheme",
  "isUpdateState",
  "log",
  "onThemeChange",
  "setThemePreference",
  "syncTheme",
  "updateClient",
] as const;

const EXPECTED_AUTH = [
  "authContract",
  "authErrorSchema",
  "authStateSchema",
  "authUserSchema",
  "buildOAuthRevokeRequest",
  "buildOAuthTokenRequest",
  "createAuth",
  "parseOAuthTokenResponse",
  "signInResultSchema",
] as const;

const EXPECTED_UPDATE = [
  "createPolicyStore",
  "createUpdateHandlers",
  "createUpdater",
  "registerUpdateIpc",
  "updateContract",
  "updateStateSchema",
] as const;

const sorted = (names: readonly string[]): string[] => [...names].sort();

describe("@handijitcom/electron (shared)", () => {
  test("should expose exactly the documented surface", () => {
    expect(Object.keys(shared).sort()).toEqual(sorted(EXPECTED_SHARED));
  });

  test("should define a contract and list its channels through the barrel", () => {
    const contract = shared.defineContract({
      invoke: { "notes:list": { output: z.array(z.string()) } },
      events: { "sync:done": z.number() },
    });
    expect(shared.channelsOf(contract)).toEqual({
      invoke: { "notes:list": true },
      events: { "sync:done": true },
    });
    expect(shared.APP_URL).toBe("app://bundle/");
  });
});

describe("@handijitcom/electron/main", () => {
  test("should expose exactly the documented surface", () => {
    expect(Object.keys(main).sort()).toEqual(sorted(EXPECTED_MAIN));
  });

  test("should build a policy through the barrel", () => {
    expect(main.buildContentSecurityPolicy()).toContain("default-src 'self'");
    expect(main.redactText("Bearer abc.def")).toBe("Bearer [REDACTED]");
  });
});

describe("@handijitcom/electron/preload", () => {
  test("should expose exactly the documented surface", () => {
    expect(Object.keys(preload).sort()).toEqual(sorted(EXPECTED_PRELOAD));
  });

  test("should add the updater's channels through the barrel", () => {
    const channels = preload.withUpdateChannels({
      invoke: { ...preload.AUTH_CHANNELS.invoke, "notes:list": true },
      events: { ...preload.AUTH_CHANNELS.events },
    });
    expect(Object.keys(channels.invoke)).toContain("update:check");
    expect(Object.keys(channels.invoke)).toContain("auth:sign-in");
    expect(channels.events).toEqual({
      "auth:changed": true,
      "update:state-changed": true,
    });
  });
});

describe("@handijitcom/electron/renderer", () => {
  test("should expose exactly the documented surface", () => {
    expect(Object.keys(renderer).sort()).toEqual(sorted(EXPECTED_RENDERER));
  });

  test("should load without a window and keep the update client quiet", () => {
    expect(renderer.updateClient.getState()).toBeNull();
    expect(renderer.authErrorMessage("OFFLINE")).toBe(
      shared.authErrorMessage("OFFLINE")
    );
  });
});

describe("@handijitcom/electron/auth", () => {
  test("should expose exactly the documented surface", () => {
    expect(Object.keys(auth).sort()).toEqual(sorted(EXPECTED_AUTH));
  });

  test("should carry the auth channels the preload lists", () => {
    expect(Object.keys(auth.authContract.invoke).sort()).toEqual(
      Object.keys(shared.AUTH_CHANNELS.invoke).sort()
    );
  });
});

describe("@handijitcom/electron/update", () => {
  test("should expose exactly the documented surface", () => {
    expect(Object.keys(update).sort()).toEqual(sorted(EXPECTED_UPDATE));
  });

  test("should carry the update channels the preload lists", () => {
    expect(Object.keys(update.updateContract.invoke).sort()).toEqual(
      Object.keys(shared.UPDATE_CHANNELS.invoke).sort()
    );
  });
});
