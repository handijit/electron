import { z } from "zod";

import AUTH_ERROR_CODES from "../shared/auth-error-codes.constants";
import AUTH_STATUSES from "../shared/auth-statuses.constants";
import type {
  AuthContract,
  AuthError,
  AuthState,
  AuthUser,
  SignInResult,
} from "../types";

/** Who is signed in: what a screen needs, and nothing a token could be derived from. */
const authUserSchema: z.ZodType<AuthUser, AuthUser> = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

/** A failure with its stable code and its sentence. */
const authErrorSchema: z.ZodType<AuthError, AuthError> = z.object({
  code: z.enum(AUTH_ERROR_CODES),
  message: z.string(),
  retryAfterSeconds: z.int().nonnegative().optional(),
});

/** The whole state of the session as the renderer sees it. Unknown keys are dropped. */
const authStateSchema: z.ZodType<AuthState, AuthState> = z.object({
  status: z.enum(AUTH_STATUSES),
  user: authUserSchema.nullable(),
  error: authErrorSchema.nullable(),
  isRemembered: z.boolean(),
});

/** The answer of a sign-in: the user, or why there is none. */
const signInResultSchema: z.ZodType<SignInResult, SignInResult> =
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), user: authUserSchema.nullable() }),
    z.object({ ok: z.literal(false), error: authErrorSchema }),
  ]);

/**
 * The IPC surface of the session, as a fragment of an app's contract: spread `invoke` and
 * `events` into the object given to `defineContract`. No channel takes an input, and no schema
 * has a field a token could travel in.
 */
const authContract: AuthContract = {
  invoke: {
    "auth:get-state": { output: authStateSchema },
    "auth:sign-in": { output: signInResultSchema },
    "auth:cancel-sign-in": {},
    "auth:sign-out": {},
  },
  events: {
    "auth:changed": authStateSchema,
  },
};

export {
  authContract,
  authErrorSchema,
  authStateSchema,
  authUserSchema,
  signInResultSchema,
};
