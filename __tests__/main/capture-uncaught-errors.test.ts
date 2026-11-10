import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import captureUncaughtErrors from "../../lib/main/capture-uncaught-errors";
import type { Logger } from "../../lib/main/logger";

const mocks = vi.hoisted(() => ({
  app: { exit: vi.fn<(code?: number) => void>() },
}));

vi.mock("electron", () => ({ app: mocks.app }));

type ProcessEvent = "uncaughtException" | "unhandledRejection";
type Listener = (reason: unknown) => void;

const listenersOf = (event: ProcessEvent): Listener[] =>
  process.listeners(event as "uncaughtException") as Listener[];

let before: Record<ProcessEvent, Listener[]>;

/**
 * The listener the function under test added. It is called directly: emitting the event on
 * the real process would also reach the test runner's own handlers.
 */
const added = (event: ProcessEvent): Listener => {
  const listeners = listenersOf(event).filter(
    (listener) => !before[event].includes(listener)
  );
  expect(listeners, event).toHaveLength(1);
  return listeners[0] as Listener;
};

const createLoggerStub = (): {
  logger: Logger;
  error: ReturnType<typeof vi.fn<Logger["error"]>>;
  flush: ReturnType<typeof vi.fn<Logger["flush"]>>;
  finishFlush: () => void;
} => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  const error = vi.fn<Logger["error"]>();
  const flush = vi.fn<Logger["flush"]>(() => promise);
  const logger: Logger = {
    directory: "/logs",
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error,
    child: () => logger,
    flush,
  };
  return { logger, error, flush, finishFlush: () => resolve() };
};

/** Lets the promise reactions that are already due run. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

beforeEach(() => {
  mocks.app.exit.mockReset();
  before = {
    uncaughtException: listenersOf("uncaughtException"),
    unhandledRejection: listenersOf("unhandledRejection"),
  };
});

afterEach(() => {
  for (const event of ["uncaughtException", "unhandledRejection"] as const) {
    for (const listener of listenersOf(event)) {
      if (!before[event].includes(listener)) {
        process.removeListener(event, listener);
      }
    }
  }
});

describe("captureUncaughtErrors", () => {
  test("should listen to uncaught exceptions and unhandled rejections of the process", () => {
    const { logger } = createLoggerStub();

    captureUncaughtErrors(logger);

    expect(listenersOf("uncaughtException")).toHaveLength(
      before.uncaughtException.length + 1
    );
    expect(listenersOf("unhandledRejection")).toHaveLength(
      before.unhandledRejection.length + 1
    );
  });

  test("should log an uncaught exception, then exit with code 1 once the log is on disk", async () => {
    const { logger, error, flush, finishFlush } = createLoggerStub();
    captureUncaughtErrors(logger);
    const failure = new Error("boom");

    added("uncaughtException")(failure);

    expect(error).toHaveBeenCalledExactlyOnceWith(
      "Uncaught exception in main",
      { error: failure }
    );
    expect(flush).toHaveBeenCalledTimes(1);
    expect(error.mock.invocationCallOrder[0]).toBeLessThan(
      flush.mock.invocationCallOrder[0] as number
    );
    // The process must not go down while the line that explains why is still in memory.
    await settle();
    expect(mocks.app.exit).not.toHaveBeenCalled();

    finishFlush();
    await settle();

    expect(mocks.app.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  test("should exit after an uncaught exception when the options leave it open", async () => {
    const { logger, finishFlush } = createLoggerStub();
    captureUncaughtErrors(logger, {});

    added("uncaughtException")(new Error("boom"));
    finishFlush();
    await settle();

    expect(mocks.app.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  test("should only log an uncaught exception when told not to exit", async () => {
    const { logger, error, flush, finishFlush } = createLoggerStub();
    captureUncaughtErrors(logger, { exitOnUncaughtException: false });

    added("uncaughtException")("a thrown string");
    finishFlush();
    await settle();

    expect(error).toHaveBeenCalledExactlyOnceWith(
      "Uncaught exception in main",
      { error: "a thrown string" }
    );
    expect(flush).not.toHaveBeenCalled();
    expect(mocks.app.exit).not.toHaveBeenCalled();
  });

  test("should log an unhandled rejection and keep the app running", async () => {
    const { logger, error, flush, finishFlush } = createLoggerStub();
    captureUncaughtErrors(logger);
    const reason = new Error("rejected");

    added("unhandledRejection")(reason);
    finishFlush();
    await settle();

    expect(error).toHaveBeenCalledExactlyOnceWith(
      "Unhandled rejection in main",
      { error: reason }
    );
    expect(flush).not.toHaveBeenCalled();
    expect(mocks.app.exit).not.toHaveBeenCalled();
  });

  test("should remove exactly its own listeners when unsubscribed, also twice", () => {
    const { logger } = createLoggerStub();
    const other = createLoggerStub();
    const unsubscribe = captureUncaughtErrors(logger);
    const onException = added("uncaughtException");
    const onRejection = added("unhandledRejection");
    captureUncaughtErrors(other.logger);

    unsubscribe();
    unsubscribe();

    expect(listenersOf("uncaughtException")).not.toContain(onException);
    expect(listenersOf("unhandledRejection")).not.toContain(onRejection);
    // The other capture and the listeners that were there before are untouched.
    expect(listenersOf("uncaughtException")).toHaveLength(
      before.uncaughtException.length + 1
    );
    expect(listenersOf("unhandledRejection")).toHaveLength(
      before.unhandledRejection.length + 1
    );
    expect(listenersOf("uncaughtException")).toEqual(
      expect.arrayContaining(before.uncaughtException)
    );
  });
});
