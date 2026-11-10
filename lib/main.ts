// The main-process entry. It imports `electron` and `node:*`; never load it in a renderer.
import { registerAppProtocol, registerAppScheme } from "./main/app-protocol";
import captureUncaughtErrors from "./main/capture-uncaught-errors";
import buildContentSecurityPolicy from "./main/content-security-policy";
import IpcError from "./main/ipc-error";
import createEmitter from "./main/ipc-emitter";
import registerHandlers from "./main/ipc-handlers";
import createLogger from "./main/logger";
import openExternal from "./main/open-external";
import { redactText } from "./main/redact";
import registerCoreHandlers from "./main/register-core-handlers";
import createSecretStore, {
  SecretStoreUnavailableError,
} from "./main/secret-store";
import createSecureWindow, {
  ENFORCED_WEB_PREFERENCES,
} from "./main/secure-window";
import installSessionGuards from "./main/session-guards";
import createSettingsStore from "./main/settings-store";
import { acquireSingleInstance, findDeepLink } from "./main/single-instance";
import startApp from "./main/start-app";
import createThemeBridge from "./main/theme-bridge";
import createUrlPolicy from "./main/url-policy";

export {
  acquireSingleInstance,
  buildContentSecurityPolicy,
  captureUncaughtErrors,
  createEmitter,
  createLogger,
  createSecretStore,
  createSecureWindow,
  createSettingsStore,
  createThemeBridge,
  createUrlPolicy,
  ENFORCED_WEB_PREFERENCES,
  findDeepLink,
  installSessionGuards,
  IpcError,
  openExternal,
  redactText,
  registerAppProtocol,
  registerAppScheme,
  registerCoreHandlers,
  registerHandlers,
  SecretStoreUnavailableError,
  startApp,
};
export type { AppProtocolOptions } from "./main/app-protocol";
export type { CaptureUncaughtErrorsOptions } from "./main/capture-uncaught-errors";
export type { ContentSecurityPolicyOptions } from "./main/content-security-policy";
export type { IpcErrorCode } from "./main/ipc-error";
export type { Emitter, EmitterOptions } from "./main/ipc-emitter";
export type { Handlers, RegisterHandlersOptions } from "./main/ipc-handlers";
export type { Logger, LoggerOptions } from "./main/logger";
export type { CoreHandlersOptions } from "./main/register-core-handlers";
export type { SecretStore, SecretStoreOptions } from "./main/secret-store";
export type {
  SafeWebPreferences,
  SecureWindowOptions,
} from "./main/secure-window";
export type { SessionGuardsOptions } from "./main/session-guards";
export type {
  SettingsStore,
  SettingsStoreOptions,
} from "./main/settings-store";
export type { SecondInstance } from "./main/single-instance";
export type {
  AppContext,
  DeepLinkOptions,
  StartAppOptions,
} from "./main/start-app";
export type { ThemeBridge, ThemePreferenceStore } from "./main/theme-bridge";
export type { UrlPolicy, UrlPolicyOptions } from "./main/url-policy";
