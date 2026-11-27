// Sign in with the browser (main process): RFC 8252 loopback with PKCE against any OAuth 2.0
// style server, the session in the operating system's secret store, and an authenticated fetch.
import {
  authContract,
  authErrorSchema,
  authStateSchema,
  authUserSchema,
  signInResultSchema,
} from "./auth/auth-contract";
import createAuth from "./auth/create-auth";
import {
  buildOAuthRevokeRequest,
  buildOAuthTokenRequest,
  parseOAuthTokenResponse,
} from "./auth/token-client";
import type {
  Auth,
  AuthHost,
  AuthLogger,
  AuthOptions,
  ReturnPageLabels,
  ReturnPageText,
  TokenGrant,
  TokenRequestBody,
  TokenSet,
} from "./auth/types";
import type {
  AuthContract,
  AuthError,
  AuthErrorCode,
  AuthState,
  AuthStatus,
  AuthUser,
  SignInResult,
} from "./types";

export {
  authContract,
  authErrorSchema,
  authStateSchema,
  authUserSchema,
  buildOAuthRevokeRequest,
  buildOAuthTokenRequest,
  createAuth,
  parseOAuthTokenResponse,
  signInResultSchema,
};
export type {
  Auth,
  AuthContract,
  AuthError,
  AuthErrorCode,
  AuthHost,
  AuthLogger,
  AuthOptions,
  AuthState,
  AuthStatus,
  AuthUser,
  ReturnPageLabels,
  ReturnPageText,
  SignInResult,
  TokenGrant,
  TokenRequestBody,
  TokenSet,
};
