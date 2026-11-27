import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import useAuth from "../../lib/auth-react/use-auth";
import type { AuthStore } from "../../lib/renderer/create-auth-store";
import {
  LOADING_STATE,
  SIGNED_OUT_STATE,
} from "../../lib/shared/auth-states.constants";
import type { AuthState } from "../../lib/types";

const STORE_KEY = Symbol.for("@handijitcom/electron:auth-store");

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
});

const fakeStore = () => {
  let state: AuthState = LOADING_STATE;
  const listeners = new Set<() => void>();
  const store: AuthStore = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    signIn: vi.fn(async () => ({ ok: true, user: null }) as const),
    cancelSignIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  };
  const set = (next: AuthState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  return { store, set };
};

describe("useAuth", () => {
  test("should render the store's state and keep its identity until it changes", () => {
    const { store, set } = fakeStore();
    const { result, rerender } = renderHook(() => useAuth(store));
    expect(result.current.status).toBe("loading");
    expect(result.current.signIn).toBe(store.signIn);
    expect(result.current.cancelSignIn).toBe(store.cancelSignIn);
    expect(result.current.signOut).toBe(store.signOut);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    act(() => set(SIGNED_OUT_STATE));
    expect(result.current.status).toBe("signed-out");
    expect(result.current).not.toBe(first);
  });

  test("should use the page's store by default", async () => {
    vi.stubGlobal("desktop", {
      invoke: { "auth:get-state": vi.fn(async () => SIGNED_OUT_STATE) },
      on: { "auth:changed": vi.fn(() => () => undefined) },
    });
    const { result } = renderHook(() => useAuth());
    await vi.waitFor(() => expect(result.current.status).toBe("signed-out"));
  });
});
