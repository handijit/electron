import { describe, expect, test, vi } from "vitest";

import { forwardErrors, log } from "../../lib/renderer/log";

const stubBridge = (
  write: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined)
): ReturnType<typeof vi.fn> => {
  vi.stubGlobal("desktop", { invoke: { "core-log:write": write }, on: {} });
  return write;
};

describe("log", () => {
  test.each(["debug", "info", "warn", "error"] as const)(
    "should forward a %s line to main with its context",
    (level) => {
      const write = stubBridge();

      log[level]("Saved the draft", { draftId: 7 });

      expect(write).toHaveBeenCalledExactlyOnceWith({
        level,
        message: "Saved the draft",
        context: { draftId: 7 },
      });
    }
  );

  test("should forward a line without context", () => {
    const write = stubBridge();

    log.info("Started");

    expect(write).toHaveBeenCalledExactlyOnceWith({
      level: "info",
      message: "Started",
      context: undefined,
    });
  });

  test("should return nothing: logging is fire and forget", () => {
    stubBridge();

    expect(log.warn("x")).toBeUndefined();
  });

  test("should never throw without a bridge", () => {
    expect(() => log.error("lost")).not.toThrow();
  });

  test("should never throw when the preload exposes no log channel", () => {
    vi.stubGlobal("desktop", { invoke: {}, on: {} });

    expect(() => log.error("lost")).not.toThrow();
  });

  test("should never throw when the bridge itself throws", () => {
    stubBridge(
      vi.fn(() => {
        throw new Error("An object could not be cloned.");
      })
    );

    expect(() => log.info("x", { fn: () => undefined })).not.toThrow();
  });

  test("should swallow main's refusal instead of leaving an unhandled rejection", async () => {
    const unhandled = vi.fn();
    window.addEventListener("unhandledrejection", unhandled);
    stubBridge(
      vi.fn().mockRejectedValue(new Error("[INVALID_INPUT] core-log:write"))
    );

    log.info("refused");
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.removeEventListener("unhandledrejection", unhandled);

    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("forwardErrors", () => {
  const dispatchError = (init: ErrorEventInit): void => {
    window.dispatchEvent(new ErrorEvent("error", init));
  };
  const dispatchRejection = (reason: unknown): void => {
    // jsdom has no PromiseRejectionEvent constructor; the handler only reads `reason`.
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason })
    );
  };

  test("should forward an uncaught error with its stack and position", () => {
    const write = stubBridge();
    const stop = forwardErrors();
    const error = new Error("boom");

    dispatchError({
      error,
      message: "Uncaught Error: boom",
      filename: "app://bundle/assets/index.js",
      lineno: 12,
    });
    stop();

    expect(write).toHaveBeenCalledExactlyOnceWith({
      level: "error",
      message: "Uncaught error: boom",
      context: {
        stack: error.stack,
        source: "app://bundle/assets/index.js",
        line: 12,
      },
    });
  });

  test("should fall back to the event's message when there is no error object", () => {
    const write = stubBridge();
    const stop = forwardErrors();

    dispatchError({ message: "Script error.", filename: "", lineno: 0 });
    stop();

    expect(write).toHaveBeenCalledExactlyOnceWith({
      level: "error",
      message: "Uncaught error: Script error.",
      context: { stack: undefined, source: "", line: 0 },
    });
  });

  test("should forward an unhandled rejection with an Error reason", () => {
    const write = stubBridge();
    const stop = forwardErrors();
    const reason = new Error("request failed");

    dispatchRejection(reason);
    stop();

    expect(write).toHaveBeenCalledExactlyOnceWith({
      level: "error",
      message: "Unhandled rejection: request failed",
      context: { stack: reason.stack },
    });
  });

  test.each([
    ["a string", "timeout", "timeout"],
    ["a number", 404, "404"],
    ["undefined", undefined, "undefined"],
    ["an object", { code: "E_FAIL" }, "[object Object]"],
  ])("should describe %s as a rejection reason", (_label, reason, text) => {
    const write = stubBridge();
    const stop = forwardErrors();

    dispatchRejection(reason);
    stop();

    expect(write).toHaveBeenCalledExactlyOnceWith({
      level: "error",
      message: `Unhandled rejection: ${text}`,
      context: { stack: undefined },
    });
  });

  test("should stop forwarding once unsubscribed, and tolerate a second call", () => {
    const write = stubBridge();
    const stop = forwardErrors();

    stop();
    stop();
    // No error object: with no listener left, Vitest would report one as an uncaught exception.
    dispatchError({ message: "late" });
    dispatchRejection(new Error("late"));

    expect(write).not.toHaveBeenCalled();
  });

  test("should not break the page when there is no bridge", () => {
    const stop = forwardErrors();

    expect(() =>
      dispatchError({ error: new Error("x"), message: "x" })
    ).not.toThrow();
    stop();
  });
});
