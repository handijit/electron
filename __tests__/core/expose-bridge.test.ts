import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

vi.mock("electron", () => electron);

import exposeBridge from "../../lib/preload/expose-bridge";

type Exposed = {
  invoke: Record<string, (input?: unknown) => Promise<unknown>>;
  on: Record<string, (listener: unknown) => () => void>;
};

const exposed = (): Exposed => {
  const call = electron.contextBridge.exposeInMainWorld.mock.calls[0];
  expect(call?.[0]).toBe("desktop");
  return call?.[1] as Exposed;
};

describe("exposeBridge", () => {
  beforeEach(() => {
    electron.ipcRenderer.invoke.mockResolvedValue("answer");
  });

  test("should expose one function per channel plus the core channels", () => {
    exposeBridge({
      invoke: { "notes:list": true, "notes:rename": true },
      events: { "sync:done": true },
    });
    const bridge = exposed();
    expect(Object.keys(bridge.invoke).sort()).toEqual([
      "core-log:write",
      "core-theme:get",
      "core-theme:set",
      "notes:list",
      "notes:rename",
    ]);
    expect(Object.keys(bridge.on).sort()).toEqual([
      "core-theme:changed",
      "sync:done",
    ]);
  });

  test("should accept a contract with schemas as well", () => {
    exposeBridge({
      invoke: { "notes:list": { output: z.string() } },
      events: {},
    });
    expect(Object.keys(exposed().invoke)).toContain("notes:list");
  });

  test("should forward an invocation with its single argument", async () => {
    exposeBridge({ invoke: { "notes:rename": true }, events: {} });
    await expect(exposed().invoke["notes:rename"]?.({ id: 1 })).resolves.toBe(
      "answer"
    );
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith("notes:rename", {
      id: 1,
    });
  });

  test("should hand the listener the payload, never the IPC event", () => {
    exposeBridge({ invoke: {}, events: { "sync:done": true } });
    const listener = vi.fn();
    const stop = exposed().on["sync:done"]?.(listener);
    const [channel, handler] = electron.ipcRenderer.on.mock.calls[0] as [
      string,
      (event: unknown, payload: unknown) => void,
    ];
    expect(channel).toBe("sync:done");
    handler({ sender: "secret" }, { count: 2 });
    expect(listener).toHaveBeenCalledWith({ count: 2 });
    expect(listener.mock.calls[0]).toHaveLength(1);

    stop?.();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      "sync:done",
      handler
    );
  });

  test("should refuse a listener that is not a function", () => {
    exposeBridge({ invoke: {}, events: { "sync:done": true } });
    expect(() => exposed().on["sync:done"]?.("nope")).toThrow(
      new TypeError(
        'desktop.on["sync:done"]: expected a listener function, received string'
      )
    );
    expect(electron.ipcRenderer.on).not.toHaveBeenCalled();
  });

  test("should refuse a malformed channel before exposing anything", () => {
    expect(() =>
      exposeBridge({ invoke: { "core-log:write": true }, events: {} })
    ).toThrow(/^exposeBridge: /);
    expect(electron.contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
  });
});
