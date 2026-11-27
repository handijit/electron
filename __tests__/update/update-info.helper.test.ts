import { describe, expect, test } from "vitest";

import {
  toUpdateInfo,
  toUpdateProgress,
} from "../../lib/update/update-info.helper";

describe("toUpdateInfo", () => {
  test("should read a complete Windows feed entry", () => {
    expect(
      toUpdateInfo(
        {
          version: "1.5.0",
          releaseDate: "2026-11-10T09:00:00Z",
          releaseNotes: "<p>Faster <b>start</b></p>\n\n\n\n<script>x</script>",
          files: [
            { url: "app-1.5.0-win-arm64.exe", size: 10 },
            { url: "app-1.5.0-win-x64.exe", size: 20 },
            { url: "app-1.5.0-win-x64.exe.blockmap", size: 1 },
          ],
        },
        "win32",
        "x64"
      )
    ).toEqual({
      version: "1.5.0",
      releaseDate: "2026-11-10T09:00:00.000Z",
      releaseNotes: "Faster start\n\nx",
      sizeBytes: 20,
    });
  });

  test("should take the zip on macOS, the first one when none names the architecture", () => {
    expect(
      toUpdateInfo(
        {
          version: "1.5.0",
          files: [
            { url: "app.dmg", size: 99 },
            { url: "app-universal.zip", size: 30 },
            "not a file",
          ],
        },
        "darwin",
        "arm64"
      )?.sizeBytes
    ).toBe(30);
  });

  test("should join a list of notes and drop empty ones", () => {
    expect(
      toUpdateInfo(
        {
          version: "1.5.0",
          releaseNotes: [{ note: "One" }, { note: null }, "x", { note: "Two" }],
        },
        "win32",
        "x64"
      )?.releaseNotes
    ).toBe("One\n\nTwo");
  });

  test("should leave out what the feed does not say", () => {
    expect(
      toUpdateInfo(
        {
          version: "1.5.0",
          releaseDate: "not a date",
          releaseNotes: "  ",
          files: [{ url: "app.exe", size: 0 }],
        },
        "win32",
        "x64"
      )
    ).toEqual({
      version: "1.5.0",
      releaseDate: null,
      releaseNotes: null,
      sizeBytes: null,
    });
    expect(
      toUpdateInfo({ version: "1.5.0", releaseDate: 5 }, "win32", "x64")
    ).toEqual({
      version: "1.5.0",
      releaseDate: null,
      releaseNotes: null,
      sizeBytes: null,
    });
    expect(
      toUpdateInfo({ version: "1.5.0", files: [] }, "win32", "x64")?.sizeBytes
    ).toBeNull();
  });

  test("should shorten very long notes", () => {
    const notes = toUpdateInfo(
      { version: "1.5.0", releaseNotes: "a".repeat(5000) },
      "win32",
      "x64"
    )?.releaseNotes;
    expect(notes).toHaveLength(4000);
  });

  test("should refuse what is not a version", () => {
    expect(toUpdateInfo({ version: "v1" }, "win32", "x64")).toBeNull();
    expect(toUpdateInfo(null, "win32", "x64")).toBeNull();
  });
});

describe("toUpdateProgress", () => {
  test("should keep every number in range", () => {
    expect(
      toUpdateProgress({
        percent: 120,
        transferred: 5,
        total: Number.NaN,
        bytesPerSecond: -3,
      })
    ).toEqual({
      percent: 100,
      transferredBytes: 5,
      totalBytes: 0,
      bytesPerSecond: 0,
    });
    expect(toUpdateProgress("garbage")).toEqual({
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
    });
  });
});
