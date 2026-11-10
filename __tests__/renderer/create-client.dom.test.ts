import { describe, expect, test, vi } from "vitest";
import type { ZodNumber, ZodString } from "zod";

import createClient from "../../lib/renderer/create-client";
import type defineContract from "../../lib/shared/define-contract";

// Types only: the renderer never imports the schemas, and neither does its test.
type TestContract = ReturnType<
  typeof defineContract<{
    invoke: {
      "settings:get": { output: ZodString };
      "settings:set-theme": { input: ZodString };
    };
    events: { "update:ready": ZodNumber };
  }>
>;

const stubBridge = (): {
  invoke: Record<string, ReturnType<typeof vi.fn>>;
  on: Record<string, ReturnType<typeof vi.fn>>;
} => {
  const bridge = {
    invoke: {
      "settings:get": vi.fn().mockResolvedValue("dark"),
      "settings:set-theme": vi.fn().mockResolvedValue(undefined),
    },
    on: { "update:ready": vi.fn() },
  };
  vi.stubGlobal("desktop", bridge);
  return bridge;
};

describe("createClient", () => {
  test("should be creatable before the preload ran: the bridge is read per call", async () => {
    const client = createClient<TestContract>();
    expect(() => client.invoke("settings:get")).toThrow(
      /^invoke: window\.desktop is missing/
    );
    expect(() => client.on("update:ready", vi.fn())).toThrow(
      /^on: window\.desktop is missing/
    );

    stubBridge();

    await expect(client.invoke("settings:get")).resolves.toBe("dark");
  });

  describe("invoke", () => {
    test("should call the channel's own function with the input and resolve with its answer", async () => {
      const bridge = stubBridge();
      const client = createClient<TestContract>();

      await expect(
        client.invoke("settings:set-theme", "light")
      ).resolves.toBeUndefined();

      expect(
        bridge.invoke["settings:set-theme"]
      ).toHaveBeenCalledExactlyOnceWith("light");
      expect(bridge.invoke["settings:get"]).not.toHaveBeenCalled();
    });

    test("should pass undefined for a channel without input", async () => {
      const bridge = stubBridge();

      await createClient<TestContract>().invoke("settings:get");

      expect(bridge.invoke["settings:get"]).toHaveBeenCalledExactlyOnceWith(
        undefined
      );
    });

    test("should reject with main's refusal", async () => {
      const bridge = stubBridge();
      const refusal = new Error("[INVALID_INPUT] settings:set-theme: nope");
      bridge.invoke["settings:set-theme"]?.mockRejectedValue(refusal);

      await expect(
        createClient<TestContract>().invoke("settings:set-theme", "x")
      ).rejects.toBe(refusal);
    });

    test("should throw for a channel the preload does not expose", () => {
      stubBridge();
      const client = createClient<TestContract>();

      expect(() =>
        // @ts-expect-error the channel is not in the contract
        client.invoke("fs:read")
      ).toThrow(/^invoke: channel "fs:read" is not exposed by the preload/);
      expect(() =>
        // @ts-expect-error an inherited name is not a channel
        client.invoke("toString")
      ).toThrow(/is not exposed/);
    });
  });

  describe("on", () => {
    test("should subscribe through the channel's own function and return its unsubscribe", () => {
      const bridge = stubBridge();
      const unsubscribe = vi.fn();
      bridge.on["update:ready"]?.mockReturnValue(unsubscribe);
      const listener = vi.fn();

      const stop = createClient<TestContract>().on("update:ready", listener);

      expect(bridge.on["update:ready"]).toHaveBeenCalledExactlyOnceWith(
        listener
      );
      expect(stop).toBe(unsubscribe);
    });

    test("should throw for an event the preload does not expose", () => {
      stubBridge();

      expect(() =>
        createClient<TestContract>().on(
          // @ts-expect-error the event is not in the contract
          "update:failed",
          vi.fn()
        )
      ).toThrow(/^on: channel "update:failed" is not exposed by the preload/);
    });
  });
});
