import { describe, expect, test, vi } from "vitest";

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);

import captureUncaughtErrors from "../../lib/main/capture-uncaught-errors";
import type { Logger } from "../../lib/main/logger";
import { fakeElectron } from "../helpers/core-electron";

type Listener = (reason: unknown) => void;

// The real process listeners belong to the test runner; they are captured, never fired.
const capture = () => {
  const added = new Map<string, Listener>();
  vi.spyOn(process, "on").mockImplementation(((
    event: string,
    listener: Listener
  ) => {
    added.set(event, listener);
    return process;
  }) as never);
  const removed = vi
    .spyOn(process, "removeListener")
    .mockImplementation((() => process) as never);
  return { added, removed };
};

const fakeLogger = () =>
  ({
    error: vi.fn(),
    flush: vi.fn(async () => undefined),
  }) as unknown as Logger & {
    error: ReturnType<typeof vi.fn>;
  };

describe("captureUncaughtErrors", () => {
  test("should log an uncaught exception and quit once the log is on disk", async () => {
    const { added } = capture();
    const logger = fakeLogger();
    captureUncaughtErrors(logger);
    const error = new Error("boom");
    added.get("uncaughtException")?.(error);
    expect(logger.error).toHaveBeenCalledWith("Uncaught exception in main", {
      error,
    });
    await vi.waitFor(() =>
      expect(fakeElectron.app.exit).toHaveBeenCalledWith(1)
    );
  });

  test("should stay up when asked to", async () => {
    const { added } = capture();
    const logger = fakeLogger();
    captureUncaughtErrors(logger, { exitOnUncaughtException: false });
    added.get("uncaughtException")?.(new Error("boom"));
    await Promise.resolve();
    expect(logger.flush).not.toHaveBeenCalled();
    expect(fakeElectron.app.exit).not.toHaveBeenCalled();
  });

  test("should log an unhandled rejection without quitting", () => {
    const { added } = capture();
    const logger = fakeLogger();
    captureUncaughtErrors(logger);
    added.get("unhandledRejection")?.("nope");
    expect(logger.error).toHaveBeenCalledWith("Unhandled rejection in main", {
      error: "nope",
    });
    expect(fakeElectron.app.exit).not.toHaveBeenCalled();
  });

  test("should remove both listeners", () => {
    const { added, removed } = capture();
    captureUncaughtErrors(fakeLogger())();
    expect(removed).toHaveBeenCalledWith(
      "uncaughtException",
      added.get("uncaughtException")
    );
    expect(removed).toHaveBeenCalledWith(
      "unhandledRejection",
      added.get("unhandledRejection")
    );
  });
});
