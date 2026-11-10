import type { IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import IpcError from "../../lib/main/ipc-error";
import registerHandlers, { parse } from "../../lib/main/ipc-handlers";
import type { Handlers } from "../../lib/main/ipc-handlers";
import createUrlPolicy from "../../lib/main/url-policy";
import type { UrlPolicy } from "../../lib/main/url-policy";
import defineContract from "../../lib/shared/define-contract";
import type { Contract } from "../../lib/types";

type InvokeListener = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => Promise<unknown>;

const { electron, listeners } = vi.hoisted(() => {
  // Stands in for ipcMain: one listener per channel, a second registration throws.
  const listeners = new Map<string, InvokeListener>();
  const electron = {
    app: { isPackaged: true },
    ipcMain: {
      handle: vi.fn((channel: string, listener: InvokeListener): void => {
        if (listeners.has(channel)) {
          throw new Error(`a second handler for '${channel}'`);
        }
        listeners.set(channel, listener);
      }),
      removeHandler: vi.fn((channel: string): void => {
        listeners.delete(channel);
      }),
    },
  };
  return { electron, listeners };
});

vi.mock("electron", () => electron);

const APP_FRAME = "app://bundle/index.html";

const contract = defineContract({
  invoke: {
    "notes:save": {
      input: z.object({
        title: z.string({ error: "must be text" }).min(1, "must not be empty"),
        tags: z.array(z.string({ error: "must be text" })).default([]),
      }),
      output: z.object({ id: z.number({ error: "must be a number" }) }),
    },
    "notes:count": { output: z.number({ error: "must be a number" }) },
    "notes:rename": { input: z.string({ error: "must be text" }) },
    "notes:clear": {},
  },
  events: {},
});

type NotesHandlers = Handlers<typeof contract>;

const policy = createUrlPolicy();

const createHandlers = () => ({
  "notes:save": vi.fn<NotesHandlers["notes:save"]>(() => ({ id: 1 })),
  "notes:count": vi.fn<NotesHandlers["notes:count"]>(() => 3),
  "notes:rename": vi.fn<NotesHandlers["notes:rename"]>(),
  "notes:clear": vi.fn<NotesHandlers["notes:clear"]>(),
});

const eventFrom = (frameUrl: string | null | undefined): IpcMainInvokeEvent =>
  ({
    senderFrame: typeof frameUrl === "string" ? { url: frameUrl } : frameUrl,
  }) as unknown as IpcMainInvokeEvent;

/** Calls a channel the way ipcMain does for `ipcRenderer.invoke(channel, ...args)`. */
const invokeFrom = (
  frameUrl: string | null | undefined,
  channel: string,
  ...args: unknown[]
): Promise<unknown> => {
  const listener = listeners.get(channel);
  if (listener === undefined) {
    throw new Error(`No handler registered for '${channel}'`);
  }
  return listener(eventFrom(frameUrl), ...args);
};

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  invokeFrom(APP_FRAME, channel, ...args);

/** The error a call is rejected with; fails when the call resolves. */
const rejectionOf = async (call: Promise<unknown>): Promise<unknown> => {
  const settled = await call.then(
    (value) => ({ resolved: true, value }),
    (error: unknown) => ({ resolved: false, value: error })
  );
  expect(settled.resolved, "the call should be rejected").toBe(false);
  return settled.value;
};

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  electron.app.isPackaged = true;
});

describe("registerHandlers: registration", () => {
  test("should register one handler per channel of the contract", () => {
    registerHandlers(contract, createHandlers(), { policy });

    expect(electron.ipcMain.handle.mock.calls.map(([name]) => name)).toEqual([
      "notes:save",
      "notes:count",
      "notes:rename",
      "notes:clear",
    ]);
  });

  test("should refuse a set of handlers with a channel missing", () => {
    const handlers = createHandlers();
    const incomplete = {
      "notes:save": handlers["notes:save"],
      "notes:count": handlers["notes:count"],
      "notes:rename": handlers["notes:rename"],
    };

    expect(() =>
      // @ts-expect-error -- "notes:clear" is missing, as an untyped caller could pass it
      registerHandlers(contract, incomplete, { policy })
    ).toThrow(
      new TypeError('registerHandlers: no handler for channel "notes:clear"')
    );
    expect(electron.ipcMain.handle).not.toHaveBeenCalled();
  });

  test("should refuse a handler that is not a function", () => {
    const handlers = { ...createHandlers(), "notes:count": 3 };

    expect(() =>
      // @ts-expect-error -- a number where a function belongs, as an untyped caller could pass it
      registerHandlers(contract, handlers, { policy })
    ).toThrow(
      new TypeError('registerHandlers: no handler for channel "notes:count"')
    );
    expect(electron.ipcMain.handle).not.toHaveBeenCalled();
  });

  test("should refuse a handler whose channel is not in the contract", () => {
    const handlers = { ...createHandlers(), "notes:delete-all": vi.fn() };

    expect(() => registerHandlers(contract, handlers, { policy })).toThrow(
      new TypeError(
        'registerHandlers: handler "notes:delete-all" has no channel in the contract'
      )
    );
    expect(electron.ipcMain.handle).not.toHaveBeenCalled();
  });

  test("should refuse a handler named like an inherited property", () => {
    const handlers = { ...createHandlers(), toString: vi.fn() };

    expect(() => registerHandlers(contract, handlers, { policy })).toThrow(
      new TypeError(
        'registerHandlers: handler "toString" has no channel in the contract'
      )
    );
  });

  test("should remove every handler with the function it returns", () => {
    const unregister = registerHandlers(contract, createHandlers(), { policy });

    expect(listeners.size).toBe(4);
    expect(electron.ipcMain.removeHandler).not.toHaveBeenCalled();

    unregister();

    expect(listeners.size).toBe(0);
    expect(
      electron.ipcMain.removeHandler.mock.calls.map(([name]) => name)
    ).toEqual(["notes:save", "notes:count", "notes:rename", "notes:clear"]);
  });

  test("should register nothing for a contract without request channels", () => {
    const unregister = registerHandlers(
      defineContract({ invoke: {}, events: {} }),
      {},
      { policy }
    );
    unregister();

    expect(electron.ipcMain.handle).not.toHaveBeenCalled();
    expect(electron.ipcMain.removeHandler).not.toHaveBeenCalled();
  });
});

describe("registerHandlers: the sender frame", () => {
  test.each([
    "https://evil.test/",
    "http://localhost:5173/",
    "app://evil/index.html",
    "file:///index.html",
    "about:blank",
    "",
  ])("should refuse a call from the foreign frame %j", async (frameUrl) => {
    const handlers = createHandlers();
    registerHandlers(contract, handlers, { policy });

    const error = await rejectionOf(
      invokeFrom(frameUrl, "notes:save", { title: "a" })
    );

    expect(error).toBeInstanceOf(IpcError);
    expect(error).toMatchObject({
      code: "UNTRUSTED_SENDER",
      channel: "notes:save",
      message: `[UNTRUSTED_SENDER] notes:save: refused frame ${frameUrl}`,
    });
    expect(handlers["notes:save"]).not.toHaveBeenCalled();
  });

  test.each([null, undefined])(
    "should refuse a call whose frame is gone (%s)",
    async (frame) => {
      const handlers = createHandlers();
      registerHandlers(contract, handlers, { policy });

      const error = await rejectionOf(invokeFrom(frame, "notes:count"));

      expect(error).toMatchObject({
        code: "UNTRUSTED_SENDER",
        message: "[UNTRUSTED_SENDER] notes:count: refused frame (gone)",
      });
      expect(handlers["notes:count"]).not.toHaveBeenCalled();
    }
  );

  test("should refuse a foreign frame on a channel without input or output", async () => {
    const handlers = createHandlers();
    registerHandlers(contract, handlers, { policy });

    const error = await rejectionOf(
      invokeFrom("https://evil.test/", "notes:clear")
    );

    expect(error).toMatchObject({ code: "UNTRUSTED_SENDER" });
    expect(handlers["notes:clear"]).not.toHaveBeenCalled();
  });

  test("should accept the app's own frame", async () => {
    registerHandlers(contract, createHandlers(), { policy });

    await expect(invokeFrom(APP_FRAME, "notes:count")).resolves.toBe(3);
  });

  test("should accept the dev server frame of an unpackaged app only", async () => {
    electron.app.isPackaged = false;
    const devPolicy = createUrlPolicy({
      devServerUrl: "http://localhost:5173",
    });
    registerHandlers(contract, createHandlers(), { policy: devPolicy });

    await expect(
      invokeFrom("http://localhost:5173/", "notes:count")
    ).resolves.toBe(3);
    expect(
      await rejectionOf(invokeFrom("http://localhost:5174/", "notes:count"))
    ).toMatchObject({ code: "UNTRUSTED_SENDER" });
  });

  test("should ask the policy about the frame's URL, not the page's", async () => {
    const isTrustedAppUrl = vi.fn(() => true);
    registerHandlers(contract, createHandlers(), {
      policy: { ...policy, isTrustedAppUrl },
    });
    const listener = listeners.get("notes:count");
    const event = {
      senderFrame: { url: "app://bundle/frame.html" },
      sender: { getURL: () => "app://bundle/page.html" },
    } as unknown as IpcMainInvokeEvent;

    await listener?.(event);

    expect(isTrustedAppUrl).toHaveBeenCalledExactlyOnceWith(
      "app://bundle/frame.html"
    );
  });
});

describe("registerHandlers: the order of the checks", () => {
  const steps: string[] = [];
  const orderedContract = defineContract({
    invoke: {
      "steps:run": {
        input: z.string().refine((value) => {
          steps.push(`input:${value}`);
          return value !== "bad-input";
        }),
        output: z.string().refine((value) => {
          steps.push(`output:${value}`);
          return value !== "bad-output";
        }),
      },
    },
    events: {},
  });
  const orderedPolicy: UrlPolicy = {
    ...policy,
    isTrustedAppUrl: (url) => {
      steps.push("sender");
      return policy.isTrustedAppUrl(url);
    },
  };
  const handler = vi.fn((input: string): string => {
    steps.push(`handler:${input}`);
    return input === "make-bad-output" ? "bad-output" : `${input}!`;
  });

  beforeEach(() => {
    steps.length = 0;
    registerHandlers(
      orderedContract,
      { "steps:run": handler },
      { policy: orderedPolicy }
    );
  });

  test("should check the sender, then the input, then run the handler, then check the output", async () => {
    await expect(invoke("steps:run", "go")).resolves.toBe("go!");

    expect(steps).toEqual(["sender", "input:go", "handler:go", "output:go!"]);
  });

  test("should stop at the sender: the input of a foreign frame is not even parsed", async () => {
    const error = await rejectionOf(
      invokeFrom("https://evil.test/", "steps:run", "bad-input")
    );

    expect(error).toMatchObject({ code: "UNTRUSTED_SENDER" });
    expect(steps).toEqual(["sender"]);
    expect(handler).not.toHaveBeenCalled();
  });

  test("should stop at the input: the handler never sees an invalid one", async () => {
    const error = await rejectionOf(invoke("steps:run", "bad-input"));

    expect(error).toMatchObject({ code: "INVALID_INPUT" });
    expect(steps).toEqual(["sender", "input:bad-input"]);
    expect(handler).not.toHaveBeenCalled();
  });

  test("should check the output after the handler ran", async () => {
    const error = await rejectionOf(invoke("steps:run", "make-bad-output"));

    expect(error).toMatchObject({ code: "INVALID_OUTPUT" });
    expect(steps).toEqual([
      "sender",
      "input:make-bad-output",
      "handler:make-bad-output",
      "output:bad-output",
    ]);
  });
});

describe("registerHandlers: the input", () => {
  test("should pass the parsed input and the event to the handler", async () => {
    const handlers = createHandlers();
    registerHandlers(contract, handlers, { policy });
    const event = eventFrom(APP_FRAME);

    await listeners.get("notes:save")?.(event, { title: "a", extra: "x" });

    // Parsed: the default is filled in and the unknown key is gone.
    expect(handlers["notes:save"]).toHaveBeenCalledExactlyOnceWith(
      { title: "a", tags: [] },
      event
    );
  });

  test("should ignore arguments after the first", async () => {
    const handlers = createHandlers();
    registerHandlers(contract, handlers, { policy });

    await invoke("notes:rename", "new name", "second", { third: true });

    expect(handlers["notes:rename"]).toHaveBeenCalledExactlyOnceWith(
      "new name",
      expect.anything()
    );
  });

  test.each([
    ["a field of the wrong type", [{ title: 7 }], "title: must be text"],
    ["a field that breaks a rule", [{ title: "" }], "title: must not be empty"],
    [
      "several wrong fields",
      [{ title: "", tags: ["a", 2] }],
      "title: must not be empty; tags.1: must be text",
    ],
    [
      "a missing argument",
      [],
      "Invalid input: expected object, received undefined",
    ],
    ["null", [null], "Invalid input: expected object, received null"],
  ])(
    "should reject %s without running the handler",
    async (_label, args, detail) => {
      const handlers = createHandlers();
      registerHandlers(contract, handlers, { policy });

      const error = await rejectionOf(invoke("notes:save", ...args));

      expect(error).toBeInstanceOf(IpcError);
      expect(error).toMatchObject({
        code: "INVALID_INPUT",
        channel: "notes:save",
        message: `[INVALID_INPUT] notes:save: ${detail}`,
      });
      expect(handlers["notes:save"]).not.toHaveBeenCalled();
    }
  );

  test("should describe an issue at the root of the input without a path", async () => {
    registerHandlers(contract, createHandlers(), { policy });

    const error = await rejectionOf(invoke("notes:rename", 42));

    expect(error).toMatchObject({
      message: "[INVALID_INPUT] notes:rename: must be text",
    });
  });

  test.each([
    ["no argument", []],
    ["an undefined argument", [undefined]],
    ["only undefined arguments", [undefined, undefined]],
  ])(
    "should run a channel that takes no input with %s",
    async (_label, args) => {
      const handlers = createHandlers();
      registerHandlers(contract, handlers, { policy });

      await expect(invoke("notes:count", ...args)).resolves.toBe(3);
      expect(handlers["notes:count"]).toHaveBeenCalledExactlyOnceWith(
        undefined,
        expect.anything()
      );
    }
  );

  test.each([
    ["a value", ["x"]],
    ["null", [null]],
    ["a falsy value", [0]],
    ["a value after an undefined one", [undefined, { sneaky: true }]],
  ])(
    "should reject %s on a channel that takes no input",
    async (_label, args) => {
      const handlers = createHandlers();
      registerHandlers(contract, handlers, { policy });

      const error = await rejectionOf(invoke("notes:count", ...args));

      expect(error).toMatchObject({
        code: "INVALID_INPUT",
        message: "[INVALID_INPUT] notes:count: takes no argument",
      });
      expect(handlers["notes:count"]).not.toHaveBeenCalled();
    }
  );
});

describe("registerHandlers: the output", () => {
  test("should answer with the parsed output", async () => {
    const handlers = createHandlers();
    handlers["notes:save"].mockReturnValue(
      // An extra key the schema does not declare must not reach the renderer.
      { id: 9, path: "/Users/someone/notes.db" } as { id: number }
    );
    registerHandlers(contract, handlers, { policy });

    await expect(invoke("notes:save", { title: "a" })).resolves.toEqual({
      id: 9,
    });
  });

  test("should wait for an asynchronous handler", async () => {
    const handlers = createHandlers();
    handlers["notes:count"].mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(12), 5))
    );
    registerHandlers(contract, handlers, { policy });

    await expect(invoke("notes:count")).resolves.toBe(12);
  });

  test("should reject an answer that does not match the output schema", async () => {
    const handlers = createHandlers();
    // @ts-expect-error -- a handler that returns the wrong type, as a bug in main would
    handlers["notes:count"].mockReturnValue("three");
    registerHandlers(contract, handlers, { policy });

    const error = await rejectionOf(invoke("notes:count"));

    expect(error).toBeInstanceOf(IpcError);
    expect(error).toMatchObject({
      code: "INVALID_OUTPUT",
      channel: "notes:count",
      message: "[INVALID_OUTPUT] notes:count: must be a number",
    });
  });

  test("should describe a nested output issue with its path", async () => {
    const handlers = createHandlers();
    // @ts-expect-error -- a handler that returns the wrong type, as a bug in main would
    handlers["notes:save"].mockResolvedValue({ id: "nine" });
    registerHandlers(contract, handlers, { policy });

    const error = await rejectionOf(invoke("notes:save", { title: "a" }));

    expect(error).toMatchObject({
      message: "[INVALID_OUTPUT] notes:save: id: must be a number",
    });
  });

  test("should answer with nothing on a channel without an output schema", async () => {
    const handlers = createHandlers();
    // @ts-expect-error -- a handler that returns a value where the contract declares none
    handlers["notes:rename"].mockReturnValue({ secret: "leak" });
    registerHandlers(contract, handlers, { policy });

    await expect(invoke("notes:rename", "x")).resolves.toBeUndefined();
    expect(handlers["notes:rename"]).toHaveBeenCalledOnce();
  });
});

describe("registerHandlers: failures", () => {
  const SECRET = "ENOENT: /Users/someone/.config/app/token.json (token=abc123)";

  test.each([
    [
      "throws",
      (): number => {
        throw new Error(SECRET);
      },
    ],
    ["rejects", (): Promise<number> => Promise.reject(new Error(SECRET))],
  ])(
    "should never leak the message of a handler that %s",
    async (_label, implementation) => {
      const handlers = createHandlers();
      handlers["notes:count"].mockImplementation(implementation);
      registerHandlers(contract, handlers, { policy });

      const error = await rejectionOf(invoke("notes:count"));

      expect(error).toBeInstanceOf(IpcError);
      expect(error).toMatchObject({
        code: "HANDLER_FAILED",
        channel: "notes:count",
        message: "[HANDLER_FAILED] notes:count: the handler failed",
      });
      expect(JSON.stringify(error)).not.toContain("token");
      expect(String((error as Error).stack)).not.toContain("token");
      expect((error as Error).cause).toBeUndefined();
    }
  );

  test("should not leak a thrown value that is not an Error", async () => {
    const handlers = createHandlers();
    handlers["notes:count"].mockImplementation(() => {
      throw SECRET;
    });
    registerHandlers(contract, handlers, { policy });

    const error = await rejectionOf(invoke("notes:count"));

    expect(error).toMatchObject({
      message: "[HANDLER_FAILED] notes:count: the handler failed",
    });
  });

  test("should pass an IpcError thrown by the handler through unchanged", async () => {
    const thrown = new IpcError("INVALID_INPUT", "notes:count", "by hand");
    const handlers = createHandlers();
    handlers["notes:count"].mockRejectedValue(thrown);
    registerHandlers(contract, handlers, { policy });

    expect(await rejectionOf(invoke("notes:count"))).toBe(thrown);
  });

  test("should give onError the safe error and the original cause", async () => {
    const cause = new Error(SECRET);
    const onError = vi.fn();
    const handlers = createHandlers();
    handlers["notes:count"].mockRejectedValue(cause);
    registerHandlers(contract, handlers, { policy, onError });

    const error = await rejectionOf(invoke("notes:count"));

    expect(onError).toHaveBeenCalledExactlyOnceWith(error, cause);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(IpcError);
    expect(onError.mock.calls[0]?.[1]).toBe(cause);
  });

  test.each([
    ["an untrusted sender", "https://evil.test/", [], "UNTRUSTED_SENDER"],
    ["an invalid input", APP_FRAME, ["unexpected"], "INVALID_INPUT"],
    ["an invalid output", APP_FRAME, [], "INVALID_OUTPUT"],
  ])("should report %s to onError", async (_label, frameUrl, args, code) => {
    const onError = vi.fn();
    const handlers = createHandlers();
    // @ts-expect-error -- a handler that returns the wrong type, as a bug in main would
    handlers["notes:count"].mockReturnValue("three");
    registerHandlers(contract, handlers, { policy, onError });

    const error = await rejectionOf(
      invokeFrom(frameUrl, "notes:count", ...args)
    );

    expect(error).toMatchObject({ code });
    expect(onError).toHaveBeenCalledExactlyOnceWith(error, error);
  });

  test("should not call onError for a call that succeeds", async () => {
    const onError = vi.fn();
    registerHandlers(contract, createHandlers(), { policy, onError });

    await invoke("notes:count");

    expect(onError).not.toHaveBeenCalled();
  });
});

describe("registerHandlers: sentinel, an onError that throws", () => {
  const SECRET = "ENOENT: /Users/someone/.config/app/token.json (token=abc123)";
  const REPORTER_SECRET = "EACCES: /var/log/app/errors.log (dsn=key-987)";

  test.each([
    [
      "an Error",
      (): void => {
        throw new Error(REPORTER_SECRET);
      },
    ],
    [
      "a value that is not an Error",
      (): void => {
        throw REPORTER_SECRET;
      },
    ],
  ])(
    "should still answer [HANDLER_FAILED] with neither the handler's nor the reporter's message when onError throws %s",
    async (_label, reporter) => {
      const onError = vi.fn(reporter);
      const handlers = createHandlers();
      handlers["notes:count"].mockRejectedValue(new Error(SECRET));
      registerHandlers(contract, handlers, { policy, onError });

      const error = await rejectionOf(invoke("notes:count"));

      expect(onError).toHaveBeenCalledOnce();
      expect(error).toBeInstanceOf(IpcError);
      expect(error).toMatchObject({
        code: "HANDLER_FAILED",
        channel: "notes:count",
        message: "[HANDLER_FAILED] notes:count: the handler failed",
      });
      for (const text of [
        JSON.stringify(error),
        String(error),
        String((error as Error).stack),
      ]) {
        expect(text).not.toContain("token");
        expect(text).not.toContain("dsn");
      }
      expect((error as Error).cause).toBeUndefined();
    }
  );

  test.each([
    [
      "an untrusted sender",
      "https://evil.test/",
      [],
      "UNTRUSTED_SENDER",
      "[UNTRUSTED_SENDER] notes:rename: refused frame https://evil.test/",
    ],
    [
      "an invalid input",
      APP_FRAME,
      [42],
      "INVALID_INPUT",
      "[INVALID_INPUT] notes:rename: must be text",
    ],
  ])(
    "should still answer the original IpcError for %s when onError throws",
    async (_label, frameUrl, args, code, message) => {
      const onError = vi.fn((): void => {
        throw new Error(REPORTER_SECRET);
      });
      const handlers = createHandlers();
      registerHandlers(contract, handlers, { policy, onError });

      const error = await rejectionOf(
        invokeFrom(frameUrl, "notes:rename", ...args)
      );

      expect(onError).toHaveBeenCalledExactlyOnceWith(error, error);
      expect(error).toBeInstanceOf(IpcError);
      expect(error).toMatchObject({ code, channel: "notes:rename" });
      expect((error as Error).message).toBe(message);
      expect(String((error as Error).stack)).not.toContain("dsn");
      expect(handlers["notes:rename"]).not.toHaveBeenCalled();
    }
  );
});

describe("registerHandlers: a contract built without types", () => {
  test("should treat a channel without a definition as taking and answering nothing", async () => {
    const untyped = {
      invoke: { "notes:ping": undefined },
      events: {},
    } as unknown as Contract;
    const ping = vi.fn((): void => undefined);
    registerHandlers(untyped, { "notes:ping": ping }, { policy });

    await expect(invoke("notes:ping")).resolves.toBeUndefined();
    expect(ping).toHaveBeenCalledExactlyOnceWith(undefined, expect.anything());
    expect(await rejectionOf(invoke("notes:ping", "x"))).toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(
      await rejectionOf(invokeFrom("https://evil.test/", "notes:ping"))
    ).toMatchObject({ code: "UNTRUSTED_SENDER" });
  });
});

describe("parse", () => {
  const schema = z.object({
    name: z.string({ error: "must be text" }),
    size: z.coerce.number({ error: "must be a number" }),
  });

  test("should return the parsed value", () => {
    expect(
      parse(schema, { name: "a", size: "7", extra: 1 }, "INVALID_EVENT", "a:b")
    ).toEqual({ name: "a", size: 7 });
  });

  test("should throw an IpcError with the given code and channel", () => {
    let thrown: unknown;
    try {
      parse(schema, { name: 1, size: "x" }, "INVALID_EVENT", "notes:changed");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IpcError);
    expect(thrown).toMatchObject({
      code: "INVALID_EVENT",
      channel: "notes:changed",
      message:
        "[INVALID_EVENT] notes:changed: name: must be text; size: must be a number",
    });
  });

  test("should join a nested path with dots", () => {
    const nested = z.object({
      rows: z.array(z.object({ id: z.number({ error: "must be a number" }) })),
    });

    expect(() =>
      parse(nested, { rows: [{ id: 1 }, { id: "2" }] }, "INVALID_INPUT", "a:b")
    ).toThrow("[INVALID_INPUT] a:b: rows.1.id: must be a number");
  });
});
