// The page: everything goes through `window.desktop`; no Electron, no Node, no Zod.
import authErrorMessage from "./shared/auth-error-message";
import isUpdateState from "./shared/is-update-state";
import createAuthStore from "./renderer/create-auth-store";
import type { AuthIpc, AuthStore } from "./renderer/create-auth-store";
import createClient from "./renderer/create-client";
import type { Client } from "./renderer/create-client";
import createUpdateClient, {
  updateClient,
} from "./renderer/create-update-client";
import type { UpdateClient } from "./renderer/create-update-client";
import getAuthStore from "./renderer/get-auth-store";
import { forwardErrors, log } from "./renderer/log";
import type { RendererLogger } from "./renderer/log";
import {
  applyTheme,
  getTheme,
  onThemeChange,
  setThemePreference,
  syncTheme,
} from "./renderer/theme";
import type {
  AuthError,
  AuthErrorCode,
  AuthState,
  AuthStatus,
  AuthUser,
  SignInResult,
  Unsubscribe,
  UnsupportedReason,
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
  applyTheme,
  authErrorMessage,
  createAuthStore,
  createClient,
  createUpdateClient,
  forwardErrors,
  getAuthStore,
  getTheme,
  isUpdateState,
  log,
  onThemeChange,
  setThemePreference,
  syncTheme,
  updateClient,
};
export type {
  AuthError,
  AuthErrorCode,
  AuthIpc,
  AuthState,
  AuthStatus,
  AuthStore,
  AuthUser,
  Client,
  RendererLogger,
  SignInResult,
  Unsubscribe,
  UnsupportedReason,
  UpdateClient,
  UpdateError,
  UpdateErrorCode,
  UpdateInfo,
  UpdatePolicyState,
  UpdateProgress,
  UpdateState,
  UpdateStatus,
  UpdateVerdict,
};
