// The shared entry: constants, guards and types every process may load. It imports nothing at
// run time, so a page or a sandboxed preload can use it as well as main.
import { APP_HOST, APP_SCHEME, APP_URL } from "./shared/app-url.constants";
import AUTH_CHANNELS from "./shared/auth-channels.constants";
import AUTH_ERROR_CODES from "./shared/auth-error-codes.constants";
import authErrorMessage from "./shared/auth-error-message";
import AUTH_STATUSES from "./shared/auth-statuses.constants";
import BRIDGE_KEY from "./shared/bridge-key.constants";
import channelsOf from "./shared/channels-of";
import { CORE_CHANNELS } from "./shared/core-channels.constants";
import type { CoreChannels } from "./shared/core-channels.constants";
import defineContract from "./shared/define-contract";
import { isAuthState, isSignInResult } from "./shared/is-auth-state";
import isUpdateState from "./shared/is-update-state";
import LOG_LEVELS from "./shared/log-levels.constants";
import {
  THEME_ATTRIBUTE,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
} from "./shared/theme.constants";
import UPDATE_CHANNELS from "./shared/update-channels.constants";
import {
  UNSUPPORTED_REASONS,
  UPDATE_ERROR_CODES,
  UPDATE_STATUSES,
  UPDATE_VERDICTS,
} from "./shared/update-state.constants";
import withUpdateChannels from "./shared/with-update-channels";
import type { WithUpdateChannels } from "./shared/with-update-channels";
import type {
  AuthContract,
  AuthError,
  AuthErrorCode,
  AuthState,
  AuthStatus,
  AuthUser,
  ChannelMap,
  ChannelSource,
  Contract,
  ContractBridge,
  CoreBridge,
  DesktopBridge,
  EventChannel,
  EventInput,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeDefinition,
  InvokeInput,
  InvokeOutput,
  InvokeParsedInput,
  InvokeResult,
  LogContext,
  LogLevel,
  RendererLogEntry,
  ResolvedTheme,
  SignInResult,
  ThemePreference,
  ThemeState,
  Unsubscribe,
  UnsupportedReason,
  UpdateActivity,
  UpdateContext,
  UpdateContract,
  UpdateError,
  UpdateErrorCode,
  UpdateInfo,
  UpdatePolicyState,
  UpdateProgress,
  UpdateState,
  UpdateStatus,
  UpdateVerdict,
} from "./types";

export {
  APP_HOST,
  APP_SCHEME,
  APP_URL,
  AUTH_CHANNELS,
  AUTH_ERROR_CODES,
  AUTH_STATUSES,
  authErrorMessage,
  BRIDGE_KEY,
  channelsOf,
  CORE_CHANNELS,
  defineContract,
  isAuthState,
  isSignInResult,
  isUpdateState,
  LOG_LEVELS,
  THEME_ATTRIBUTE,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  UNSUPPORTED_REASONS,
  UPDATE_CHANNELS,
  UPDATE_ERROR_CODES,
  UPDATE_STATUSES,
  UPDATE_VERDICTS,
  withUpdateChannels,
};
export type {
  AuthContract,
  AuthError,
  AuthErrorCode,
  AuthState,
  AuthStatus,
  AuthUser,
  ChannelMap,
  ChannelSource,
  Contract,
  ContractBridge,
  CoreBridge,
  CoreChannels,
  DesktopBridge,
  EventChannel,
  EventInput,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeDefinition,
  InvokeInput,
  InvokeOutput,
  InvokeParsedInput,
  InvokeResult,
  LogContext,
  LogLevel,
  RendererLogEntry,
  ResolvedTheme,
  SignInResult,
  ThemePreference,
  ThemeState,
  Unsubscribe,
  UnsupportedReason,
  UpdateActivity,
  UpdateContext,
  UpdateContract,
  UpdateError,
  UpdateErrorCode,
  UpdateInfo,
  UpdatePolicyState,
  UpdateProgress,
  UpdateState,
  UpdateStatus,
  UpdateVerdict,
  WithUpdateChannels,
};
