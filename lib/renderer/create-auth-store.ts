import {
  LOADING_STATE,
  SIGNED_OUT_STATE,
} from "../shared/auth-states.constants";
import createAuthError from "../shared/create-auth-error.helper";
import { isAuthState, isSignInResult } from "../shared/is-auth-state";
import type { AuthState, SignInResult, Unsubscribe } from "../types";

/** The four requests and the one event of `authContract`, as the bridge carries them. */
type AuthIpc = {
  /** Calls a request channel of the contract. */
  readonly invoke: (
    channel:
      | "auth:get-state"
      | "auth:sign-in"
      | "auth:cancel-sign-in"
      | "auth:sign-out"
  ) => Promise<unknown>;
  /** Listens to the state event. */
  readonly on: (
    channel: "auth:changed",
    listener: (payload: unknown) => void
  ) => Unsubscribe;
};

/** The session as a page sees it: a state to read and subscribe to, and three actions. */
type AuthStore = {
  /** The current state; the same object until it changes. `loading` until main has answered. */
  readonly getState: () => AuthState;
  /** Calls the listener after every change. The first subscription connects the store to main. */
  readonly subscribe: (listener: () => void) => Unsubscribe;
  /** Starts the sign-in in the browser. Resolves with the outcome; never rejects. */
  readonly signIn: () => Promise<SignInResult>;
  /** Cancels the sign-in that is waiting for the browser. */
  readonly cancelSignIn: () => Promise<void>;
  /** Signs out. */
  readonly signOut: () => Promise<void>;
};

const UNEXPECTED_STATE: AuthState = Object.freeze({
  ...SIGNED_OUT_STATE,
  error: createAuthError("UNEXPECTED"),
});

/**
 * Builds a store over a bridge. It connects once, on the first subscription or action, and
 * stays connected for the life of the page: it listens to `auth:changed` first and asks for the
 * state second, and an event that arrives before the answer wins, because it is newer.
 * Everything that arrives is checked before it is believed.
 */
const createAuthStore = (ipc: AuthIpc): AuthStore => {
  let state: AuthState = LOADING_STATE;
  let isConnected = false;
  let hasEvent = false;
  const listeners = new Set<() => void>();

  const setState = (next: AuthState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const connect = (): void => {
    if (isConnected) return;
    // Throws when the preload did not expose the bridge: a programming error, reported loudly.
    ipc.on("auth:changed", (payload) => {
      if (!isAuthState(payload)) return;
      hasEvent = true;
      setState(payload);
    });
    isConnected = true;
    const adoptAnswer = (answer: unknown): void => {
      if (hasEvent) return;
      setState(isAuthState(answer) ? answer : UNEXPECTED_STATE);
    };
    ipc.invoke("auth:get-state").then(adoptAnswer, () => adoptAnswer(null));
  };

  // A request main refused or failed is an outcome to show, not an exception to catch.
  const quietly = async (
    channel: "auth:cancel-sign-in" | "auth:sign-out"
  ): Promise<void> => {
    connect();
    await ipc.invoke(channel).catch(() => undefined);
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      connect();
      return () => {
        listeners.delete(listener);
      };
    },
    signIn: async () => {
      connect();
      const answer = await ipc.invoke("auth:sign-in").catch(() => null);
      return isSignInResult(answer)
        ? answer
        : { ok: false, error: createAuthError("UNEXPECTED") };
    },
    cancelSignIn: () => quietly("auth:cancel-sign-in"),
    signOut: () => quietly("auth:sign-out"),
  };
};

export type { AuthIpc, AuthStore };
export default createAuthStore;
