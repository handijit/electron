import { afterEach, describe, expect, test, vi } from "vitest";

import createClient from "../../lib/renderer/create-client";
import { getBridge, pick } from "../../lib/renderer/get-bridge.helper";
import type { Contract } from "../../lib/types";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "desktop");
});

const install = (bridge: unknown): void => {
  Object.defineProperty(globalThis, "desktop", {
    value: bridge,
    configurable: true,
    writable: true,
  });
};

describe("getBridge", () => {
  test("should return window.desktop when the preload exposed it", () => {
    const bridge = { invoke: {}, on: {} };
    install(bridge);
    expect(getBridge("caller")).toBe(bridge);
  });

  test.each([
    ["missing", undefined],
    ["null", null],
    ["not an object", "desktop"],
    ["without invoke", { on: {} }],
    ["with a null invoke", { invoke: null, on: {} }],
    ["without on", { invoke: {} }],
  ])("should fail loudly when the bridge is %s", (_name, bridge) => {
    install(bridge);
    expect(() => getBridge("myCaller")).toThrow(
      "myCaller: window.desktop is missing; call exposeBridge() in the preload script of this window"
    );
  });
});

describe("pick", () => {
  test("should return an own channel", () => {
    const fn = (): void => undefined;
    expect(pick({ "a:b": fn }, "a:b", "c")).toBe(fn);
  });

  test("should not walk the prototype chain", () => {
    expect(() => pick({}, "constructor", "invoke")).toThrow(
      'invoke: channel "constructor" is not exposed by the preload; add it to the contract passed to exposeBridge()'
    );
  });
});

describe("createClient", () => {
  test("should read the bridge on every call, not when created", async () => {
    const client = createClient<Contract>();
    expect(() => client.invoke("notes:list")).toThrow(
      /window.desktop is missing/
    );

    const invoke = vi.fn().mockResolvedValue(["a"]);
    install({ invoke: { "notes:list": invoke }, on: {} });
    await expect(client.invoke("notes:list")).resolves.toEqual(["a"]);
    expect(invoke).toHaveBeenCalledWith(undefined);
  });

  test("should pass the single argument through", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    install({ invoke: { "notes:rename": invoke }, on: {} });
    const client = createClient<{
      invoke: Record<string, never>;
      events: Record<string, never>;
    }>();
    await client.invoke("notes:rename" as never, { id: 1 } as never);
    expect(invoke).toHaveBeenCalledWith({ id: 1 });
  });

  test("should subscribe through the bridge and return its unsubscribe", () => {
    const stop = vi.fn();
    const subscribe = vi.fn().mockReturnValue(stop);
    install({ invoke: {}, on: { "sync:done": subscribe } });
    const listener = vi.fn();
    const unsubscribe = createClient<Contract>().on("sync:done", listener);
    expect(subscribe).toHaveBeenCalledWith(listener);
    expect(unsubscribe).toBe(stop);
  });

  test("should refuse a channel the preload did not expose", () => {
    install({ invoke: {}, on: {} });
    expect(() => createClient<Contract>().on("x:y", vi.fn())).toThrow(
      'on: channel "x:y" is not exposed by the preload'
    );
  });
});
