import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import exposeBridge from "../../lib/preload/expose-bridge";
import channelsOf from "../../lib/shared/channels-of";
import defineContract from "../../lib/shared/define-contract";

type Bridge = {
  invoke: Record<string, (input?: unknown) => Promise<unknown>>;
  on: Record<string, (listener: (payload: unknown) => void) => () => void>;
};
type IpcListener = (event: unknown, payload: unknown) => void;

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}));
vi.mock("electron", () => electron);

const contract = defineContract({
  invoke: {
    "settings:get": { output: z.object({ theme: z.string() }) },
    "settings:set-theme": { input: z.string() },
  },
  events: { "update:ready": z.object({ version: z.string() }) },
});

const exposed = (): Bridge => {
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
  const [key, bridge] = electron.contextBridge.exposeInMainWorld.mock
    .calls[0] as [string, Bridge];
  expect(key).toBe("desktop");
  return bridge;
};

beforeEach(() => {
  electron.contextBridge.exposeInMainWorld.mockReset();
  electron.ipcRenderer.invoke.mockReset();
  electron.ipcRenderer.on.mockReset();
  electron.ipcRenderer.removeListener.mockReset();
});

describe("exposeBridge", () => {
  test("sentinel: should expose exactly one function per channel of the contract and of the core, and nothing else", () => {
    exposeBridge(contract);
    const bridge = exposed();

    expect(Object.keys(bridge)).toEqual(["invoke", "on"]);
    expect(Object.keys(bridge.invoke)).toEqual([
      "settings:get",
      "settings:set-theme",
      "core-log:write",
      "core-theme:get",
      "core-theme:set",
    ]);
    expect(Object.keys(bridge.on)).toEqual([
      "update:ready",
      "core-theme:changed",
    ]);
    for (const member of [
      ...Object.values(bridge.invoke),
      ...Object.values(bridge.on),
    ]) {
      expect(member).toBeTypeOf("function");
    }
  });

  test("sentinel: should never hand ipcRenderer or a generic channel gate to the page", () => {
    exposeBridge(contract);
    const bridge = exposed();

    const leaves = [
      bridge,
      bridge.invoke,
      bridge.on,
      ...Object.values(bridge.invoke),
      ...Object.values(bridge.on),
    ];
    expect(leaves).not.toContain(electron.ipcRenderer);
    expect(leaves).not.toContain(electron.ipcRenderer.invoke);
    expect(leaves).not.toContain(electron.ipcRenderer.on);
    // Every exposed function is bound to one channel: it takes the payload, never a channel.
    for (const invoke of Object.values(bridge.invoke)) {
      expect(invoke.length).toBeLessThanOrEqual(1);
    }
  });

  test("should expose the same bridge for the Zod-free channel map as for the contract", () => {
    exposeBridge(channelsOf(contract));
    const fromMap = exposed();
    electron.contextBridge.exposeInMainWorld.mockReset();
    exposeBridge(contract);
    const fromContract = exposed();

    expect(Object.keys(fromMap.invoke)).toEqual(
      Object.keys(fromContract.invoke)
    );
    expect(Object.keys(fromMap.on)).toEqual(Object.keys(fromContract.on));
  });

  test("should expose only the core channels for an app without channels", () => {
    exposeBridge({ invoke: {}, events: {} });
    const bridge = exposed();

    expect(Object.keys(bridge.invoke)).toEqual([
      "core-log:write",
      "core-theme:get",
      "core-theme:set",
    ]);
    expect(Object.keys(bridge.on)).toEqual(["core-theme:changed"]);
  });

  test.each([
    [{ invoke: { getSettings: true }, events: {} }, /must be "area:action"/],
    [{ invoke: { "core-log:write": true }, events: {} }, /reserved/],
    [
      { invoke: { "a:b": true }, events: { "a:b": true } },
      /both as a request and as an event/,
    ],
  ])(
    "should refuse an unsafe channel list and expose nothing: %j",
    (source, message) => {
      expect(() => exposeBridge(source)).toThrow(message);
      expect(() => exposeBridge(source)).toThrow(/^exposeBridge: /);
      expect(electron.contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
    }
  );

  describe("invoke", () => {
    test("should call its own channel with the single argument and resolve with the answer", async () => {
      electron.ipcRenderer.invoke.mockResolvedValue({ theme: "dark" });
      exposeBridge(contract);
      const bridge = exposed();

      await expect(
        bridge.invoke["settings:set-theme"]?.("dark")
      ).resolves.toEqual({
        theme: "dark",
      });
      expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(
        "settings:set-theme",
        "dark"
      );
    });

    test("should pass undefined for a channel called without an argument", async () => {
      electron.ipcRenderer.invoke.mockResolvedValue(undefined);
      exposeBridge(contract);

      await exposed().invoke["settings:get"]?.();

      expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(
        "settings:get",
        undefined
      );
    });

    test("sentinel: should ignore extra arguments, so the page cannot choose the channel or add data", async () => {
      electron.ipcRenderer.invoke.mockResolvedValue(undefined);
      exposeBridge(contract);
      const invoke = exposed().invoke["settings:get"] as (
        ...args: unknown[]
      ) => Promise<unknown>;

      await invoke("first", "fs:read", { path: "/etc/passwd" });

      expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(
        "settings:get",
        "first"
      );
    });

    test("should reject with main's error", async () => {
      const refusal = new Error(
        "[INVALID_INPUT] settings:set-theme: expected string"
      );
      electron.ipcRenderer.invoke.mockRejectedValue(refusal);
      exposeBridge(contract);

      await expect(exposed().invoke["settings:set-theme"]?.(1)).rejects.toBe(
        refusal
      );
    });

    test("should route the core channels as well", async () => {
      electron.ipcRenderer.invoke.mockResolvedValue({
        preference: "system",
        resolved: "light",
      });
      exposeBridge(contract);

      await exposed().invoke["core-theme:get"]?.();

      expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(
        "core-theme:get",
        undefined
      );
    });
  });

  describe("on", () => {
    const subscribe = (
      channel: string,
      listener: (payload: unknown) => void
    ): { unsubscribe: () => void; handler: IpcListener } => {
      const unsubscribe = exposed().on[channel]?.(listener) as () => void;
      const [registered, handler] = electron.ipcRenderer.on.mock.calls.at(
        -1
      ) as [string, IpcListener];
      expect(registered).toBe(channel);
      return { unsubscribe, handler };
    };

    test("sentinel: should pass the payload only, never the IPC event", () => {
      exposeBridge(contract);
      const listener = vi.fn();
      const { handler } = subscribe("update:ready", listener);
      const event = { sender: electron.ipcRenderer, senderId: 1 };

      handler(event, { version: "1.2.3" });

      expect(listener).toHaveBeenCalledExactlyOnceWith({ version: "1.2.3" });
      expect(listener.mock.calls[0]).toHaveLength(1);
    });

    test("should listen on its own channel only", () => {
      exposeBridge(contract);
      subscribe("core-theme:changed", vi.fn());

      expect(electron.ipcRenderer.on).toHaveBeenCalledTimes(1);
      expect(electron.ipcRenderer.on.mock.calls[0]?.[0]).toBe(
        "core-theme:changed"
      );
    });

    test("should remove exactly the handler it added when unsubscribed", () => {
      exposeBridge(contract);
      const { unsubscribe, handler } = subscribe("update:ready", vi.fn());
      expect(electron.ipcRenderer.removeListener).not.toHaveBeenCalled();

      unsubscribe();

      expect(
        electron.ipcRenderer.removeListener
      ).toHaveBeenCalledExactlyOnceWith("update:ready", handler);
    });

    test("should give two listeners of one channel their own handlers", () => {
      exposeBridge(contract);
      const first = subscribe("update:ready", vi.fn());
      const second = subscribe("update:ready", vi.fn());

      expect(first.handler).not.toBe(second.handler);
      first.unsubscribe();
      expect(
        electron.ipcRenderer.removeListener
      ).toHaveBeenCalledExactlyOnceWith("update:ready", first.handler);
    });

    test.each([undefined, null, "listener", 42, {}])(
      "should refuse %j as a listener and subscribe nothing",
      (listener) => {
        exposeBridge(contract);
        const on = exposed().on["update:ready"] as (
          listener: unknown
        ) => unknown;

        expect(() => on(listener)).toThrow(
          new TypeError(
            `desktop.on["update:ready"]: expected a listener function, received ${typeof listener}`
          )
        );
        expect(electron.ipcRenderer.on).not.toHaveBeenCalled();
      }
    );
  });
});
