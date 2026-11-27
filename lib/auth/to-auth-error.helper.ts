import createAuthError from "../shared/create-auth-error.helper";
import type { AuthError } from "../types";
import { TokenRequestError } from "./token-client";

// OAuth errors that say the request was built wrong, not that the code was bad: a setting of
// the program, which the user cannot fix by signing in again.
const CONFIGURATION_ERRORS = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_scope",
  "unauthorized_client",
  "unsupported_grant_type",
]);

/** Turns a failed code exchange into the error a screen can show. */
const toAuthError = (error: unknown): AuthError => {
  if (!(error instanceof TokenRequestError))
    return createAuthError("UNEXPECTED");
  if (error.kind === "network" || error.kind === "timeout") {
    return createAuthError("OFFLINE");
  }
  if (error.status === 429) {
    return createAuthError("RATE_LIMITED", error.retryAfterSeconds);
  }
  if (error.status === 403) return createAuthError("ACCOUNT_NOT_ALLOWED");
  if (
    (error.status === 400 || error.status === 401) &&
    !CONFIGURATION_ERRORS.has(error.oauthError ?? "")
  ) {
    // RFC 6749 answers a used, expired or foreign code with `400 invalid_grant`.
    return createAuthError("CODE_REFUSED");
  }
  return createAuthError("UNEXPECTED");
};

/** Whether the server refused a refresh token: only that ends a stored session. */
const isRefusal = (error: unknown): boolean =>
  error instanceof TokenRequestError &&
  (error.status === 400 || error.status === 401 || error.status === 403);

export { isRefusal };
export default toAuthError;
