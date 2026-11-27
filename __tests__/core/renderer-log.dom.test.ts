import { afterEach, describe, expect, test, vi } from "vitest";

import { forwardErrors, log } from "../../lib/renderer/log";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "desktop");
});

const install = (write: unknown): void => {
  Object.defineProperty(globalThis, "desktop", {
    value: { invoke: { "core-log:write": write }, on: {} },
    configurable: true,
    writable: true,
  });
};

describe("log", () => {
  test.each(["debug", "info", "warn", "error"] as const)(
    "should forward a %s line to main",
    (level) => {
      const write = vi.fn().mockResolvedValue(undefined);
      install(write);
      log[level]("hello", { id: 1 });
      expect(write).toHaveBeenCalledWith({
        level,
        message: "hello",
        context: { id: 1 },
      });
    }
  );

  test("should swallow a refused line", async () => {
    const write = vi.fn().mockRejectedValue(new Error("refused"));
    install(write);
    expect(() => log.info("x")).not.toThrow();
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
  });

  test("should do nothing without a bridge", () => {
    expect(() => log.error("x")).not.toThrow();
  });

  test("should do nothing when the core channel is missing", () => {
    Object.defineProperty(globalThis, "desktop", {
      value: { invoke: {}, on: {} },
      configurable: true,
    });
    expect(() => log.warn("x")).not.toThrow();
  });
});

describe("forwardErrors", () => {
  test("should forward an uncaught error with its stack and place", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    install(write);
    const stop = forwardErrors();
    const error = new Error("boom");
    window.dispatchEvent(
      new ErrorEvent("error", {
        error,
        message: "boom",
        filename: "app://bundle/main.js",
        lineno: 7,
      })
    );
    expect(write).toHaveBeenCalledWith({
      level: "error",
      message: "Uncaught error: boom",
      context: { stack: error.stack, source: "app://bundle/main.js", line: 7 },
    });
    stop();
  });

  test("should use the message when the event carries no error", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    install(write);
    const stop = forwardErrors();
    window.dispatchEvent(new ErrorEvent("error", { message: "script error" }));
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      message: "Uncaught error: script error",
      context: { stack: undefined },
    });
    stop();
  });

  test("should forward an unhandled rejection and stop when asked", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    install(write);
    const stop = forwardErrors();
    const event = new Event("unhandledrejection") as Event & {
      reason: unknown;
    };
    event.reason = "plain reason";
    window.dispatchEvent(event);
    expect(write).toHaveBeenCalledWith({
      level: "error",
      message: "Unhandled rejection: plain reason",
      context: { stack: undefined },
    });

    stop();
    window.dispatchEvent(event);
    window.dispatchEvent(new ErrorEvent("error", { message: "late" }));
    expect(write).toHaveBeenCalledTimes(1);
  });
});
