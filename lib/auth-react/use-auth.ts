import { getAuthStore } from "@handijitcom/electron/renderer";
import type {
  AuthState,
  AuthStore,
  SignInResult,
} from "@handijitcom/electron/renderer";
import { useMemo, useSyncExternalStore } from "react";

/** What `useAuth` returns: the state of the session and the three actions. */
type UseAuth = AuthState & {
  /** Starts the sign-in in the browser. Resolves with the outcome; never rejects. */
  readonly signIn: () => Promise<SignInResult>;
  /** Cancels the sign-in that is waiting for the browser. */
  readonly cancelSignIn: () => Promise<void>;
  /** Signs out. */
  readonly signOut: () => Promise<void>;
};

/**
 * The session in a component. Every component shares the page's one store (pass another only
 * in a test), so the hook can be used anywhere without a provider. The first render is
 * `loading`, never a `signed-out` that flips a moment later; the returned object keeps its
 * identity until the state changes.
 */
const useAuth = (store: AuthStore = getAuthStore()): UseAuth => {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState
  );
  return useMemo(
    () => ({
      ...state,
      signIn: store.signIn,
      cancelSignIn: store.cancelSignIn,
      signOut: store.signOut,
    }),
    [state, store]
  );
};

export type { UseAuth };
export default useAuth;
