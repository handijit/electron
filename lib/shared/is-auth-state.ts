import type {
  AuthError,
  AuthErrorCode,
  AuthState,
  AuthStatus,
  AuthUser,
  SignInResult,
} from "../types";
import AUTH_ERROR_CODES from "./auth-error-codes.constants";
import AUTH_STATUSES from "./auth-statuses.constants";

// The renderer's side of "validated on both sides": the same shapes as the Zod schemas of the
// contract, written by hand so that a page bundle carries no Zod. A test feeds both the same
// values and expects the same verdicts.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isTextOrNull = (value: unknown): boolean =>
  value === null || typeof value === "string";

const isAuthUser = (value: unknown): value is AuthUser =>
  isRecord(value) &&
  typeof value.id === "string" &&
  isTextOrNull(value.name) &&
  isTextOrNull(value.email);

const isAuthError = (value: unknown): value is AuthError =>
  isRecord(value) &&
  AUTH_ERROR_CODES.includes(value.code as AuthErrorCode) &&
  typeof value.message === "string" &&
  (value.retryAfterSeconds === undefined ||
    (Number.isSafeInteger(value.retryAfterSeconds) &&
      (value.retryAfterSeconds as number) >= 0));

/** Whether a value that came over IPC is an `AuthState`. */
const isAuthState = (value: unknown): value is AuthState =>
  isRecord(value) &&
  AUTH_STATUSES.includes(value.status as AuthStatus) &&
  (value.user === null || isAuthUser(value.user)) &&
  (value.error === null || isAuthError(value.error)) &&
  typeof value.isRemembered === "boolean";

/** Whether a value that came over IPC is a `SignInResult`. */
const isSignInResult = (value: unknown): value is SignInResult =>
  isRecord(value) &&
  (value.ok === true
    ? value.user === null || isAuthUser(value.user)
    : value.ok === false && isAuthError(value.error));

export { isAuthState, isSignInResult };
