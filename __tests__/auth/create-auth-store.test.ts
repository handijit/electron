import { describe, expect, test, vi } from "vitest";

import createAuthStore from "../../lib/renderer/create-auth-store";
import type { AuthIpc } from "../../lib/renderer/create-auth-store";
import {
  LOADING_STATE,
  SIGNED_OUT_STATE,
} from "../../lib/shared/auth-states.constants";
import createAuthError from "../../lib/shared/create-auth-error.helper";

const SIGNED_IN = {
  status: "signed-in",
  user: { id: "u1", name: "Ayşe", email: null },
  error: null,
  isRemembered: true,
} as const;

const fakeIpc = (
  answers: Partial<Record<string, () => Promise<unknown>>> = {}
) => {
  let emit: (payload: unknown) => void = () => undefined;
  const ipc = {
    invoke: vi.fn((channel: string) =>
      (answers[channel] ?? (() => Promise.resolve(undefined)))()
    ),
    on: vi.fn(
      (_channel: "auth:changed", listener: (payload: unknown) => void) => {
        emit = listener;
        return () => undefined;
      }
    ),
  };
  return {
    ipc: ipc as AuthIpc & typeof ipc,
    emit: (payload: unknown) => emit(payload),
  };
};

describe("createAuthStore", () => {
  test("should be loading until main answers, then hold its state", async () => {
    const { ipc } = fakeIpc({ "auth:get-state": async () => SIGNED_IN });
    const store = createAuthStore(ipc);
    expect(store.getState()).toBe(LOADING_STATE);
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.subscribe(vi.fn());
    await vi.waitFor(() => expect(store.getState()).toEqual(SIGNED_IN));
    expect(listener).toHaveBeenCalledTimes(1);
    // Connected once, whatever the number of subscribers.
    expect(ipc.on).toHaveBeenCalledTimes(1);
    expect(ipc.invoke).toHaveBeenCalledTimes(1);
    stop();
  });

  test("should let an event that arrives before the answer win", async () => {
    let answer!: (value: unknown) => void;
    const { ipc, emit } = fakeIpc({
      "auth:get-state": () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const store = createAuthStore(ipc);
    store.subscribe(vi.fn());
    emit({ not: "a state" });
    expect(store.getState()).toBe(LOADING_STATE);
    emit(SIGNED_IN);
    answer(SIGNED_OUT_STATE);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState()).toEqual(SIGNED_IN);
  });

  test.each([
    ["an answer that is not a state", async () => ({ status: "odd" })],
    ["a refused call", async () => Promise.reject(new Error("refused"))],
  ])("should show UNEXPECTED for %s", async (_name, answer) => {
    const { ipc } = fakeIpc({ "auth:get-state": answer });
    const store = createAuthStore(ipc);
    store.subscribe(vi.fn());
    await vi.waitFor(() =>
      expect(store.getState()).toEqual({
        ...SIGNED_OUT_STATE,
        error: createAuthError("UNEXPECTED"),
      })
    );
  });

  test("should stop calling a listener that unsubscribed", async () => {
    const { ipc, emit } = fakeIpc();
    const store = createAuthStore(ipc);
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    stop();
    emit(SIGNED_IN);
    expect(listener).not.toHaveBeenCalled();
    expect(store.getState()).toEqual(SIGNED_IN);
  });

  test("should answer a sign-in with what main said, checked", async () => {
    const result = { ok: true, user: SIGNED_IN.user };
    const { ipc } = fakeIpc({ "auth:sign-in": async () => result });
    const store = createAuthStore(ipc);
    await expect(store.signIn()).resolves.toEqual(result);
    expect(ipc.on).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["an answer that is not a result", async () => ({ ok: "yes" })],
    ["a refused call", async () => Promise.reject(new Error("refused"))],
  ])("should answer UNEXPECTED for %s", async (_name, answer) => {
    const { ipc } = fakeIpc({ "auth:sign-in": answer });
    await expect(createAuthStore(ipc).signIn()).resolves.toEqual({
      ok: false,
      error: createAuthError("UNEXPECTED"),
    });
  });

  test("should cancel and sign out without ever rejecting", async () => {
    const { ipc } = fakeIpc({
      "auth:cancel-sign-in": async () => Promise.reject(new Error("no")),
      "auth:sign-out": async () => undefined,
    });
    const store = createAuthStore(ipc);
    await expect(store.cancelSignIn()).resolves.toBeUndefined();
    await expect(store.signOut()).resolves.toBeUndefined();
    expect(ipc.invoke).toHaveBeenCalledWith("auth:cancel-sign-in");
    expect(ipc.invoke).toHaveBeenCalledWith("auth:sign-out");
  });
});
