import { describe, expect, test } from "vitest";

import IpcError from "../../lib/main/ipc-error";
import type { IpcErrorCode } from "../../lib/main/ipc-error";

describe("IpcError", () => {
  test("should be an Error named IpcError", () => {
    const error = new IpcError("INVALID_INPUT", "settings:set-theme", "x");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(IpcError);
    expect(error.name).toBe("IpcError");
    expect(error.stack).toContain("IpcError");
  });

  test("should expose the code and the channel", () => {
    const error = new IpcError("UNTRUSTED_SENDER", "files:open", "refused");

    expect(error.code).toBe("UNTRUSTED_SENDER");
    expect(error.channel).toBe("files:open");
  });

  test.each<IpcErrorCode>([
    "UNTRUSTED_SENDER",
    "INVALID_INPUT",
    "INVALID_OUTPUT",
    "INVALID_EVENT",
    "HANDLER_FAILED",
  ])("should start the message with the code %s", (code) => {
    const error = new IpcError(code, "settings:set-theme", "the detail");

    expect(error.message).toBe(`[${code}] settings:set-theme: the detail`);
  });
});
