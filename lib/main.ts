// The main process: windows, protocol, IPC, stores, logging, theme and printing.
import { registerAppProtocol, registerAppScheme } from "./main/app-protocol";
import type { AppProtocolOptions } from "./main/app-protocol";
import captureUncaughtErrors from "./main/capture-uncaught-errors";
import type { CaptureUncaughtErrorsOptions } from "./main/capture-uncaught-errors";
import buildContentSecurityPolicy from "./main/content-security-policy";
import type { ContentSecurityPolicyOptions } from "./main/content-security-policy";
import createEmitter from "./main/ipc-emitter";
import type { Emitter, EmitterOptions } from "./main/ipc-emitter";
import IpcError from "./main/ipc-error";
import type { IpcErrorCode } from "./main/ipc-error";
import registerHandlers from "./main/ipc-handlers";
import type { Handlers, RegisterHandlersOptions } from "./main/ipc-handlers";
import createLogger from "./main/logger";
import type { Logger, LoggerOptions } from "./main/logger";
import openExternal from "./main/open-external";
import { listPrinters, printSilently } from "./main/print";
import type {
  PrintFailureReason,
  PrintResult,
  PrintSilentlyOptions,
} from "./main/print";
import { redactText } from "./main/redact";
import registerCoreHandlers from "./main/register-core-handlers";
import type { CoreHandlersOptions } from "./main/register-core-handlers";
import createSecretStore, {
  SecretStoreUnavailableError,
} from "./main/secret-store";
import type { SecretStore, SecretStoreOptions } from "./main/secret-store";
import createSecureWindow, {
  ENFORCED_WEB_PREFERENCES,
} from "./main/secure-window";
import type {
  SafeWebPreferences,
  SecureWindowOptions,
} from "./main/secure-window";
import installSessionGuards from "./main/session-guards";
import type { SessionGuardsOptions } from "./main/session-guards";
import createSettingsStore from "./main/settings-store";
import type {
  SettingsStore,
  SettingsStoreOptions,
} from "./main/settings-store";
import { acquireSingleInstance, findDeepLink } from "./main/single-instance";
import type { SecondInstance } from "./main/single-instance";
import startApp from "./main/start-app";
import type {
  AppContext,
  DeepLinkOptions,
  StartAppOptions,
} from "./main/start-app";
import createThemeBridge from "./main/theme-bridge";
import type { ThemeBridge, ThemePreferenceStore } from "./main/theme-bridge";
import createUrlPolicy from "./main/url-policy";
import type { UrlPolicy, UrlPolicyOptions } from "./main/url-policy";

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
  listPrinters,
  openExternal,
  printSilently,
  redactText,
  registerAppProtocol,
  registerAppScheme,
  registerCoreHandlers,
  registerHandlers,
  SecretStoreUnavailableError,
  startApp,
};
export type {
  AppContext,
  AppProtocolOptions,
  CaptureUncaughtErrorsOptions,
  ContentSecurityPolicyOptions,
  CoreHandlersOptions,
  DeepLinkOptions,
  Emitter,
  EmitterOptions,
  Handlers,
  IpcErrorCode,
  Logger,
  LoggerOptions,
  PrintFailureReason,
  PrintResult,
  PrintSilentlyOptions,
  RegisterHandlersOptions,
  SafeWebPreferences,
  SecondInstance,
  SecretStore,
  SecretStoreOptions,
  SecureWindowOptions,
  SessionGuardsOptions,
  SettingsStore,
  SettingsStoreOptions,
  StartAppOptions,
  ThemeBridge,
  ThemePreferenceStore,
  UrlPolicy,
  UrlPolicyOptions,
};
