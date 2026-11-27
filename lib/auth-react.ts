// The React hook of the session; the store comes from the renderer entry, so every component of
// the page shares it.
import type {
  AuthError,
  AuthErrorCode,
  AuthState,
  AuthStatus,
  AuthStore,
  AuthUser,
  SignInResult,
} from "@handijitcom/electron/renderer";

import useAuth from "./auth-react/use-auth";
import type { UseAuth } from "./auth-react/use-auth";

export { useAuth };
export type {
  AuthError,
  AuthErrorCode,
  AuthState,
  AuthStatus,
  AuthStore,
  AuthUser,
  SignInResult,
  UseAuth,
};
