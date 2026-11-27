import type { AuthError, AuthErrorCode } from "../types";
import authErrorMessage from "./auth-error-message";

/** An error as it crosses the IPC boundary: the code, its sentence and, for a 429, the wait. */
const createAuthError = (
  code: AuthErrorCode,
  retryAfterSeconds?: number
): AuthError => ({
  code,
  message: authErrorMessage(code, retryAfterSeconds),
  ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
});

export default createAuthError;
