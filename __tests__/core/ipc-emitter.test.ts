import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);

import createEmitter from "../../lib/main/ipc-emitter";
import type { UrlPolicy } from "../../lib/main/url-policy";
import defineContract from "../../lib/shared/define-contract";
import {
  allContents,
  createWebContents,
  resetElectron,
} from "../helpers/core-electron";

const policy: UrlPolicy = {
  devServerUrl: undefined,
  isTrustedAppUrl: (url) => url.startsWith("app://bundle/"),
  isAllowedExternalUrl: () => false,
};

const contract = defineContract({
  invoke: {},
  events: {
    "sync:finished": z.object({ count: z.number().default(0) }),
  },
});

beforeEach(() => {
  resetElectron();
});

describe("createEmitter", () => {
  test("should send the parsed payload to an app window", () => {
    const target = createWebContents();
    const emitter = createEmitter(contract, { policy });
    expect(emitter.send(target as never, "sync:finished", {})).toBe(true);
    expect(target.send).toHaveBeenCalledWith("sync:finished", { count: 0 });
  });

  test("should skip a destroyed window and a foreign page", () => {
    const destroyed = createWebContents();
    destroyed.destroyed = true;
    const foreign = createWebContents("https://evil.example/");
    const emitter = createEmitter(contract, { policy });
    expect(
      emitter.send(destroyed as never, "sync:finished", { count: 1 })
    ).toBe(false);
    expect(emitter.send(foreign as never, "sync:finished", { count: 1 })).toBe(
      false
    );
    expect(destroyed.send).not.toHaveBeenCalled();
    expect(foreign.send).not.toHaveBeenCalled();
  });

  test("should broadcast to every app window and count them", () => {
    const first = createWebContents();
    const second = createWebContents("app://bundle/settings");
    const foreign = createWebContents("https://evil.example/");
    allContents.push(first, second, foreign);
    const emitter = createEmitter(contract, { policy });
    expect(emitter.broadcast("sync:finished", { count: 2 })).toBe(2);
    expect(foreign.send).not.toHaveBeenCalled();
  });

  test("should throw for a payload that does not match its schema", () => {
    const emitter = createEmitter(contract, { policy });
    expect(() =>
      emitter.broadcast("sync:finished", { count: "x" } as never)
    ).toThrow(/^\[INVALID_EVENT\] sync:finished: /);
  });

  test("should throw for an event that is not in the contract", () => {
    const emitter = createEmitter(contract, { policy });
    expect(() =>
      emitter.send(
        createWebContents() as never,
        "toString" as never,
        {} as never
      )
    ).toThrow('createEmitter: event "toString" is not in the contract');
  });
});
