import { describe, expect, test } from "vitest";

import {
  causeCodeOf,
  classifyError,
  isMissingFeed,
  toUpdateError,
  UPDATE_ERROR_MESSAGES,
} from "../../lib/update/update-error";

const withCode = (code: string, message = "x"): Error =>
  Object.assign(new Error(message), { code });

describe("classifyError", () => {
  test.each([
    ["ERR_CHECKSUM_MISMATCH", "CHECKSUM"],
    ["ERR_UPDATER_INVALID_SIGNATURE", "SIGNATURE"],
    ["ERR_UPDATER_INVALID_UPDATE_INFO", "INVALID_FEED"],
    ["ERR_UPDATER_NO_CHECKSUM", "INVALID_FEED"],
    ["ERR_UPDATER_ASSET_NOT_FOUND", "SERVER"],
    ["ERR_UPDATER_CHANNEL_FILE_NOT_FOUND", "SERVER"],
    ["HTTP_ERROR_503", "SERVER"],
    ["ENOSPC", "DISK"],
    ["EACCES", "DISK"],
    ["ENOTFOUND", "OFFLINE"],
    ["ECONNRESET", "OFFLINE"],
  ])("should map the code %s to %s", (code, expected) => {
    expect(classifyError(withCode(code))).toBe(expected);
  });

  test.each([
    ["net::ERR_INTERNET_DISCONNECTED", "OFFLINE"],
    [
      "Cannot update while running on a read-only volume",
      "NOT_IN_APPLICATIONS",
    ],
    ["Code signature at URL did not pass validation", "SIGNATURE"],
    ["code object is not signed at all", "SIGNATURE"],
    ["The code failed to satisfy specified code requirement(s)", "SIGNATURE"],
    ["Could not quit and install", "INSTALL"],
    ["No update filepath provided", "INSTALL"],
    ["something else", "UNKNOWN"],
  ])("should read the message %s as %s", (message, expected) => {
    expect(classifyError(new Error(message))).toBe(expected);
  });

  test("should classify causes that are not errors", () => {
    expect(classifyError("net::ERR_FAILED")).toBe("OFFLINE");
    expect(classifyError(null)).toBe("UNKNOWN");
    expect(classifyError({ code: 5, message: 7 })).toBe("UNKNOWN");
  });
});

describe("isMissingFeed", () => {
  test("should recognise a missing channel file only", () => {
    expect(isMissingFeed(withCode("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"))).toBe(
      true
    );
    expect(isMissingFeed(withCode("ENOTFOUND"))).toBe(false);
  });
});

describe("toUpdateError", () => {
  test("should carry the default message", () => {
    expect(toUpdateError("DISK")).toEqual({
      code: "DISK",
      message: UPDATE_ERROR_MESSAGES.DISK,
    });
  });

  test("should prefer the program's own message", () => {
    expect(toUpdateError("DISK", { DISK: "Disk full" })).toEqual({
      code: "DISK",
      message: "Disk full",
    });
    expect(toUpdateError("SERVER", { DISK: "Disk full" }).message).toBe(
      UPDATE_ERROR_MESSAGES.SERVER
    );
  });
});

describe("causeCodeOf", () => {
  test("should read a string code, or nothing", () => {
    expect(causeCodeOf(withCode("EPIPE"))).toBe("EPIPE");
    expect(causeCodeOf(new Error("x"))).toBe("");
  });
});
