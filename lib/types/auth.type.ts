import type { ZodType } from "zod";

/** Every value of `AuthState.status`, in the order a start-up goes through them. */
type AuthStatus = "loading" | "signed-out" | "signing-in" | "signed-in";

/**
 * The stable code of everything that can go wrong and that a screen has to tell apart.
 * A code never changes its meaning; a new failure gets a new code.
 */
type AuthErrorCode =
  | "SIGN_IN_TIMED_OUT"
  | "SIGN_IN_CANCELLED"
  | "STATE_MISMATCH"
  | "ACCESS_DENIED"
  | "CODE_REFUSED"
  | "RATE_LIMITED"
  | "OFFLINE"
  | "SESSION_ENDED"
  | "ACCOUNT_NOT_ALLOWED"
  | "BROWSER_NOT_OPENED"
  | "LISTENER_FAILED"
  | "UNEXPECTED";

/** Who is signed in, as far as a screen needs to know: nothing a token could be derived from. */
type AuthUser = {
  /** The account's identifier at the authorization server. */
  readonly id: string;
  /** The display name, when the server tells it. */
  readonly name: string | null;
  /** The e-mail address, when the server tells it. */
  readonly email: string | null;
};

/** A failure with its stable code and a sentence a screen can show as it is. */
type AuthError = {
  readonly code: AuthErrorCode;
  readonly message: string;
  /** For `RATE_LIMITED`: how long the server asked to wait, in seconds. */
  readonly retryAfterSeconds?: number;
};

/** The whole state of the session as the renderer sees it. It never holds a token. */
type AuthState = {
  readonly status: AuthStatus;
  /** Who is signed in; `null` when nobody is, or when the server does not say. */
  readonly user: AuthUser | null;
  /** Why the last sign-in failed or the session ended; `null` otherwise. */
  readonly error: AuthError | null;
  /** `false` while signed in means the session ends with the process (no secret store). */
  readonly isRemembered: boolean;
};

/** The answer of a sign-in: the user, or why there is none. */
type SignInResult =
  | { readonly ok: true; readonly user: AuthUser | null }
  | { readonly ok: false; readonly error: AuthError };

/** The IPC surface of the session as types; `authContract` in the `/auth` entry is the value. */
type AuthContract = {
  readonly invoke: {
    readonly "auth:get-state": {
      readonly output: ZodType<AuthState, AuthState>;
    };
    readonly "auth:sign-in": {
      readonly output: ZodType<SignInResult, SignInResult>;
    };
    readonly "auth:cancel-sign-in": Readonly<Record<never, never>>;
    readonly "auth:sign-out": Readonly<Record<never, never>>;
  };
  readonly events: {
    readonly "auth:changed": ZodType<AuthState, AuthState>;
  };
};

export type {
  AuthContract,
  AuthError,
  AuthErrorCode,
  AuthState,
  AuthStatus,
  AuthUser,
  SignInResult,
};
