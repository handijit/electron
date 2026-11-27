import { describe, expect, test } from "vitest";

import reduceActivity, {
  NO_PROGRESS,
  updateOf,
} from "../../lib/update/activity-reducer";
import type { UpdateActivity } from "../../lib/types";
import { INFO } from "../helpers/update-fixtures";

const PROGRESS = {
  percent: 50,
  transferredBytes: 5,
  totalBytes: 10,
  bytesPerSecond: 1,
};
const ERROR = { code: "OFFLINE", message: "x" } as const;

const IDLE: UpdateActivity = { status: "idle" };
const CHECKING: UpdateActivity = { status: "checking" };
const NOT_AVAILABLE: UpdateActivity = { status: "not-available" };
const AVAILABLE: UpdateActivity = { status: "available", update: INFO };
const DOWNLOADING: UpdateActivity = {
  status: "downloading",
  update: INFO,
  progress: PROGRESS,
};
const DOWNLOADED: UpdateActivity = { status: "downloaded", update: INFO };
const FAILED: UpdateActivity = { status: "error", error: ERROR, update: null };
const UNSUPPORTED: UpdateActivity = {
  status: "unsupported",
  reason: "platform",
};

describe("reduceActivity", () => {
  test("should never leave unsupported", () => {
    expect(reduceActivity(UNSUPPORTED, { type: "check-started" })).toBe(
      UNSUPPORTED
    );
  });

  test("should become unsupported from anywhere else", () => {
    expect(
      reduceActivity(DOWNLOADING, { type: "unsupported", reason: "unsigned" })
    ).toEqual({ status: "unsupported", reason: "unsigned" });
  });

  test("should start a check unless one runs or a download is held", () => {
    expect(reduceActivity(IDLE, { type: "check-started" })).toEqual(CHECKING);
    expect(reduceActivity(CHECKING, { type: "check-started" })).toBe(CHECKING);
    expect(reduceActivity(DOWNLOADING, { type: "check-started" })).toBe(
      DOWNLOADING
    );
    expect(reduceActivity(DOWNLOADED, { type: "check-started" })).toBe(
      DOWNLOADED
    );
  });

  test("should return to the previous status when a check is abandoned", () => {
    expect(
      reduceActivity(CHECKING, { type: "check-abandoned", previous: AVAILABLE })
    ).toBe(AVAILABLE);
    expect(
      reduceActivity(IDLE, { type: "check-abandoned", previous: AVAILABLE })
    ).toBe(IDLE);
  });

  test("should take an available update unless a download is held", () => {
    expect(
      reduceActivity(CHECKING, { type: "update-available", update: INFO })
    ).toEqual(AVAILABLE);
    expect(
      reduceActivity(DOWNLOADED, { type: "update-available", update: INFO })
    ).toBe(DOWNLOADED);
  });

  test("should say not-available unless a download is held", () => {
    expect(reduceActivity(CHECKING, { type: "update-not-available" })).toEqual(
      NOT_AVAILABLE
    );
    expect(reduceActivity(DOWNLOADING, { type: "update-not-available" })).toBe(
      DOWNLOADING
    );
  });

  test("should start a download only from available", () => {
    expect(reduceActivity(AVAILABLE, { type: "download-started" })).toEqual({
      status: "downloading",
      update: INFO,
      progress: NO_PROGRESS,
    });
    expect(reduceActivity(IDLE, { type: "download-started" })).toBe(IDLE);
  });

  test("should show progress while downloading, also from available", () => {
    expect(
      reduceActivity(AVAILABLE, {
        type: "download-progress",
        progress: PROGRESS,
      })
    ).toEqual(DOWNLOADING);
    expect(
      reduceActivity(DOWNLOADING, {
        type: "download-progress",
        progress: NO_PROGRESS,
      })
    ).toEqual({ ...DOWNLOADING, progress: NO_PROGRESS });
    expect(
      reduceActivity(IDLE, { type: "download-progress", progress: PROGRESS })
    ).toBe(IDLE);
  });

  test("should return to available when a download is cancelled", () => {
    expect(reduceActivity(DOWNLOADING, { type: "download-cancelled" })).toEqual(
      AVAILABLE
    );
    expect(reduceActivity(IDLE, { type: "download-cancelled" })).toBe(IDLE);
  });

  test("should finish a download with the event's or the known update", () => {
    const other = { ...INFO, version: "1.6.0" };
    expect(
      reduceActivity(DOWNLOADING, { type: "update-downloaded", update: other })
    ).toEqual({ status: "downloaded", update: other });
    expect(
      reduceActivity(DOWNLOADING, { type: "update-downloaded", update: null })
    ).toEqual(DOWNLOADED);
    expect(
      reduceActivity(IDLE, { type: "update-downloaded", update: null })
    ).toBe(IDLE);
  });

  test("should fail only a check or a download", () => {
    expect(reduceActivity(CHECKING, { type: "failed", error: ERROR })).toEqual(
      FAILED
    );
    expect(
      reduceActivity(DOWNLOADED, { type: "failed", error: ERROR })
    ).toEqual({ status: "error", error: ERROR, update: INFO });
    expect(reduceActivity(IDLE, { type: "failed", error: ERROR })).toBe(IDLE);
  });
});

describe("updateOf", () => {
  test("should read the update of a status that has one", () => {
    expect(updateOf(AVAILABLE)).toBe(INFO);
    expect(updateOf(FAILED)).toBeNull();
    expect(updateOf(IDLE)).toBeNull();
  });
});
