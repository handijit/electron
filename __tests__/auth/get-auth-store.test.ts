import { afterEach, describe, expect, test, vi } from "vitest";

import getAuthStore from "../../lib/renderer/get-auth-store";
import { SIGNED_OUT_STATE } from "../../lib/shared/auth-states.constants";

const STORE_KEY = Symbol.for("@handijitcom/electron:auth-store");

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
});

describe("getAuthStore", () => {
  test("should create one store per page, over window.desktop", async () => {
    const bridge = {
      invoke: { "auth:get-state": vi.fn(async () => SIGNED_OUT_STATE) },
      on: { "auth:changed": vi.fn(() => () => undefined) },
    };
    vi.stubGlobal("desktop", bridge);
    const store = getAuthStore();
    expect(getAuthStore()).toBe(store);
    store.subscribe(vi.fn());
    expect(bridge.on["auth:changed"]).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(store.getState()).toEqual(SIGNED_OUT_STATE));
  });

  test("should not read the bridge before it connects", () => {
    const store = getAuthStore();
    expect(store.getState().status).toBe("loading");
    expect(() => store.subscribe(vi.fn())).toThrow(
      /window\.desktop is missing/
    );
  });
});
