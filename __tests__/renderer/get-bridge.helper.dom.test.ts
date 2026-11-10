import { describe, expect, test, vi } from "vitest";

import { getBridge, pick } from "../../lib/renderer/get-bridge.helper";

const MISSING =
  "caller: window.desktop is missing; call exposeBridge() in the preload script of this window";

describe("getBridge", () => {
  test("should return window.desktop as the preload exposed it", () => {
    const bridge = { invoke: {}, on: {} };
    vi.stubGlobal("desktop", bridge);

    expect(getBridge("caller")).toBe(bridge);
    expect(window).toHaveProperty("desktop", bridge);
  });

  test("should fail loudly when the preload did not run", () => {
    expect(() => getBridge("caller")).toThrow(new Error(MISSING));
  });

  test.each([
    ["null", null],
    ["a string", "desktop"],
    ["a function", () => undefined],
    ["an object without invoke", { on: {} }],
    ["an object without on", { invoke: {} }],
    ["a null invoke", { invoke: null, on: {} }],
    ["a primitive on", { invoke: {}, on: 1 }],
  ])("should refuse %s as the bridge", (_label, value) => {
    vi.stubGlobal("desktop", value);

    expect(() => getBridge("caller")).toThrow(new Error(MISSING));
  });
});

describe("pick", () => {
  test("should return the member of the channel", () => {
    const member = (): void => undefined;

    expect(pick({ "a:b": member }, "a:b", "invoke")).toBe(member);
  });

  test("should name the missing channel and what to do about it", () => {
    expect(() => pick({}, "a:b", "invoke")).toThrow(
      new Error(
        'invoke: channel "a:b" is not exposed by the preload; add it to the contract passed to exposeBridge()'
      )
    );
  });

  test.each(["toString", "constructor", "__proto__", "hasOwnProperty"])(
    "sentinel: should not resolve %s through the prototype chain",
    (name) => {
      expect(() => pick({}, name, "invoke")).toThrow(/is not exposed/);
    }
  );
});
