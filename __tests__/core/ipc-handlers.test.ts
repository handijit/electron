import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);

import IpcError from "../../lib/main/ipc-error";
import registerHandlers, { parse } from "../../lib/main/ipc-handlers";
import type { UrlPolicy } from "../../lib/main/url-policy";
import defineContract from "../../lib/shared/define-contract";
import {
  fakeElectron,
  handlers,
  resetElectron,
} from "../helpers/core-electron";

const policy: UrlPolicy = {
  devServerUrl: undefined,
  isTrustedAppUrl: (url) => url.startsWith("app://bundle/"),
  isAllowedExternalUrl: () => false,
};

const contract = defineContract({
  invoke: {
    "notes:rename": {
      input: z.object({ id: z.number(), title: z.string().min(1) }),
      output: z.object({ ok: z.boolean() }),
    },
    "notes:count": { output: z.number() },
    "notes:clear": {},
    "notes:echo": { input: z.string() },
  },
  events: {},
});

const fromApp = { senderFrame: { url: "app://bundle/" } };

const call = (
  channel: string,
  event: unknown,
  ...args: unknown[]
): Promise<unknown> =>
  Promise.resolve(
    (handlers.get(channel) as (...args: unknown[]) => unknown)(event, ...args)
  );

const implementations = () => ({
  "notes:rename": vi.fn(({ id }: { id: number }) => ({ ok: id > 0 })),
  "notes:count": vi.fn((): number => 3),
  "notes:clear": vi.fn(() => "ignored" as unknown as void),
  "notes:echo": vi.fn((): void => undefined),
});

beforeEach(() => {
  resetElectron();
});

describe("IpcError", () => {
  test("should start its message with the code and the channel", () => {
    const error = new IpcError("INVALID_INPUT", "notes:rename", "bad");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("IpcError");
    expect(error.message).toBe("[INVALID_INPUT] notes:rename: bad");
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.channel).toBe("notes:rename");
  });
});

describe("parse", () => {
  test("should return the parsed value or throw an IpcError naming every issue", () => {
    expect(parse(z.number(), 1, "INVALID_OUTPUT", "a:b")).toBe(1);
    expect(() =>
      parse(z.object({ a: z.string() }), { a: 1 }, "INVALID_OUTPUT", "a:b")
    ).toThrow(/^\[INVALID_OUTPUT\] a:b: a: /);
    // An issue at the root has no path to name.
    expect(() => parse(z.number(), "x", "INVALID_INPUT", "a:b")).toThrow(
      "[INVALID_INPUT] a:b: Invalid input: expected number, received string"
    );
  });
});

describe("registerHandlers", () => {
  test("should register one handler per channel and remove them all", () => {
    const stop = registerHandlers(contract, implementations(), { policy });
    expect([...handlers.keys()].sort()).toEqual([
      "notes:clear",
      "notes:count",
      "notes:echo",
      "notes:rename",
    ]);
    stop();
    expect(handlers.size).toBe(0);
    expect(fakeElectron.ipcMain.removeHandler).toHaveBeenCalledTimes(4);
  });

  test("should throw for a missing handler", () => {
    const { "notes:echo": _omitted, ...partial } = implementations();
    void _omitted;
    expect(() =>
      registerHandlers(contract, partial as never, { policy })
    ).toThrow('registerHandlers: no handler for channel "notes:echo"');
  });

  test("should throw for a handler without a channel", () => {
    expect(() =>
      registerHandlers(
        contract,
        { ...implementations(), "notes:extra": () => undefined } as never,
        { policy }
      )
    ).toThrow('registerHandlers: handler "notes:extra" has no channel');
  });

  test("should run a valid call and answer with the parsed output", async () => {
    const implementation = implementations();
    registerHandlers(contract, implementation, { policy });
    await expect(
      call("notes:rename", fromApp, { id: 1, title: "Inbox" })
    ).resolves.toEqual({ ok: true });
    expect(implementation["notes:rename"]).toHaveBeenCalledWith(
      { id: 1, title: "Inbox" },
      fromApp
    );
    await expect(call("notes:count", fromApp)).resolves.toBe(3);
  });

  test("should answer nothing for a channel without an output schema", async () => {
    registerHandlers(contract, implementations(), { policy });
    await expect(call("notes:clear", fromApp, undefined)).resolves.toBe(
      undefined
    );
  });

  test("should refuse a sender frame that is not the app", async () => {
    const onError = vi.fn();
    const implementation = implementations();
    registerHandlers(contract, implementation, { policy, onError });
    await expect(
      call("notes:count", { senderFrame: { url: "https://evil.example/" } })
    ).rejects.toThrow(
      "[UNTRUSTED_SENDER] notes:count: refused frame https://evil.example/"
    );
    await expect(call("notes:count", { senderFrame: null })).rejects.toThrow(
      "refused frame (gone)"
    );
    expect(implementation["notes:count"]).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  test("should refuse an input that does not match the schema", async () => {
    const implementation = implementations();
    registerHandlers(contract, implementation, { policy });
    await expect(
      call("notes:rename", fromApp, { id: "1", title: "" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT", channel: "notes:rename" });
    expect(implementation["notes:rename"]).not.toHaveBeenCalled();
  });

  test("should refuse an argument to a channel that takes none", async () => {
    registerHandlers(contract, implementations(), { policy });
    await expect(call("notes:clear", fromApp, "surprise")).rejects.toThrow(
      "[INVALID_INPUT] notes:clear: takes no argument"
    );
  });

  test("should refuse an answer that does not match the output schema", async () => {
    const implementation = implementations();
    implementation["notes:count"].mockReturnValue("three" as never);
    registerHandlers(contract, implementation, { policy });
    await expect(call("notes:count", fromApp)).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
    });
  });

  test("should hide a handler's own error behind HANDLER_FAILED and report it", async () => {
    const onError = vi.fn();
    const implementation = implementations();
    const cause = new Error("SELECT * FROM secrets at /Users/me/db.sqlite");
    implementation["notes:count"].mockImplementation(() => {
      throw cause;
    });
    registerHandlers(contract, implementation, { policy, onError });
    const rejection = call("notes:count", fromApp);
    await expect(rejection).rejects.toThrow(
      "[HANDLER_FAILED] notes:count: the handler failed"
    );
    await expect(rejection).rejects.not.toThrow(/secrets/);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "HANDLER_FAILED" }),
      cause
    );
  });

  test("should treat a channel declared as undefined as one without schemas", async () => {
    registerHandlers(
      { invoke: { "notes:loose": undefined }, events: {} } as never,
      { "notes:loose": () => "ignored" } as never,
      { policy }
    );
    await expect(call("notes:loose", fromApp)).resolves.toBe(undefined);
    await expect(call("notes:loose", fromApp, 1)).rejects.toThrow(
      "takes no argument"
    );
  });

  test("should keep the safe error when the reporter itself throws", async () => {
    registerHandlers(contract, implementations(), {
      policy,
      onError: () => {
        throw new Error("reporter broke");
      },
    });
    await expect(call("notes:clear", fromApp, 1)).rejects.toThrow(
      "[INVALID_INPUT] notes:clear: takes no argument"
    );
  });
});
