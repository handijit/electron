import type { AuthErrorCode } from "../types";

/**
 * Every stable code of a failure a screen has to tell apart. A code never changes its meaning;
 * a new failure gets a new code.
 */
const AUTH_ERROR_CODES = [
  /** The browser never came back within the time limit. */
  "SIGN_IN_TIMED_OUT",
  /** The user cancelled in the program (or signed out, or the program is closing). */
  "SIGN_IN_CANCELLED",
  /** The loopback address was called too many times without the right `state`. */
  "STATE_MISMATCH",
  /** The user declined on the consent page (`error=access_denied` and the like). */
  "ACCESS_DENIED",
  /** The server refused the one-time code: expired, used, or not ours. */
  "CODE_REFUSED",
  /** Too many attempts (`429`); `retryAfterSeconds` says how long to wait. */
  "RATE_LIMITED",
  /** The server could not be reached. */
  "OFFLINE",
  /** The server refused the stored session: signed out elsewhere, revoked or expired. */
  "SESSION_ENDED",
  /** The account that signed in may not use this program (`403`, or `isAccountAllowed`). */
  "ACCOUNT_NOT_ALLOWED",
  /** The system browser could not be opened. */
  "BROWSER_NOT_OPENED",
  /** The loopback listener could not be started on this machine. */
  "LISTENER_FAILED",
  /** Anything else: an answer the program does not understand. */
  "UNEXPECTED",
] as const satisfies readonly AuthErrorCode[];

export default AUTH_ERROR_CODES;
