import { describe, expect, test, vi } from "vitest";

import createEngineLogger, {
  sanitizeLine,
} from "../../lib/update/engine-logger";

describe("sanitizeLine", () => {
  test("should replace the home folder and any account folder", () => {
    expect(
      sanitizeLine(
        "read /Users/ayse/Library/x and /home/bob/y and C:\\Users\\Ayşe Yılmaz\\AppData",
        "/Users/ayse"
      )
    ).toBe("read ~/Library/x and ~/y and ~\\AppData");
  });

  test("should drop queries, ids and every line after the first", () => {
    expect(
      sanitizeLine(
        new Error(
          "GET https://feed.example.com/latest.yml?noCache=1 for 123e4567-e89b-12d3-a456-426614174000\n    at stack"
        ),
        ""
      )
    ).toBe("GET https://feed.example.com/latest.yml for <id>");
  });

  test("should shorten a long line", () => {
    expect(sanitizeLine("x".repeat(500), "")).toHaveLength(400);
    expect(sanitizeLine(undefined, "")).toBe("undefined");
  });
});

describe("createEngineLogger", () => {
  test("should send info to debug and errors to warn", () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const engineLogger = createEngineLogger(logger, "/home/me");
    engineLogger.info("checking /home/me/app");
    engineLogger.warn("slow");
    engineLogger.error(new Error("failed"));
    expect(logger.debug).toHaveBeenCalledWith("engine: checking ~/app");
    expect(logger.warn.mock.calls).toEqual([
      ["engine: slow"],
      ["engine: failed"],
    ]);
  });
});
