import { describe, expect, test } from "vitest";

import isUpdateState from "../../lib/shared/is-update-state";
import UPDATE_CHANNELS from "../../lib/shared/update-channels.constants";
import {
  UNSUPPORTED_REASONS,
  UPDATE_ERROR_CODES,
  UPDATE_STATUSES,
  UPDATE_VERDICTS,
} from "../../lib/shared/update-state.constants";
import withUpdateChannels from "../../lib/shared/with-update-channels";
import { INFO, makeState } from "../helpers/update-fixtures";

const PROGRESS = {
  percent: 40,
  transferredBytes: 40,
  totalBytes: 100,
  bytesPerSecond: 10,
};

describe("update constants", () => {
  test("should list every status, verdict, code and reason", () => {
    expect(UPDATE_STATUSES).toEqual([
      "idle",
      "unsupported",
      "checking",
      "not-available",
      "available",
      "downloading",
      "downloaded",
      "error",
    ]);
    expect(UPDATE_VERDICTS).toEqual(["ok", "recommended", "required"]);
    expect(UPDATE_ERROR_CODES).toHaveLength(9);
    expect(UNSUPPORTED_REASONS).toEqual([
      "development",
      "unsigned",
      "platform",
    ]);
  });
});

describe("isUpdateState", () => {
  test.each([
    makeState(),
    makeState({ status: "unsupported", reason: "unsigned" }),
    makeState({ status: "checking" }),
    makeState({ status: "not-available", checkedAt: 5 }),
    makeState({ status: "available", update: INFO }),
    makeState({
      status: "available",
      update: {
        version: "1.5.0",
        releaseDate: null,
        releaseNotes: null,
        sizeBytes: null,
      },
    }),
    makeState({ status: "downloading", update: INFO, progress: PROGRESS }),
    makeState({ status: "downloaded", update: INFO }),
    makeState({
      status: "error",
      error: { code: "OFFLINE", message: "x" },
      update: null,
    }),
    makeState({
      status: "error",
      error: { code: "CHECKSUM", message: "x" },
      update: INFO,
    }),
  ])("should accept a complete $status state", (state) => {
    expect(isUpdateState(state)).toBe(true);
  });

  test.each([
    ["null", null],
    ["an array", []],
    ["a number status", makeState({ status: 1 })],
    ["an unknown status", makeState({ status: "constructor" })],
    ["an unknown reason", makeState({ status: "unsupported", reason: "x" })],
    ["a missing update", makeState({ status: "available" })],
    [
      "an update without a version",
      makeState({ status: "available", update: { ...INFO, version: 1 } }),
    ],
    [
      "a negative size",
      makeState({ status: "available", update: { ...INFO, sizeBytes: -1 } }),
    ],
    [
      "a progress above 100",
      makeState({
        status: "downloading",
        update: INFO,
        progress: { ...PROGRESS, percent: 101 },
      }),
    ],
    [
      "a progress that is not an object",
      makeState({ status: "downloading", update: INFO, progress: 5 }),
    ],
    [
      "an unknown error code",
      makeState({
        status: "error",
        error: { code: "NOPE", message: "x" },
        update: null,
      }),
    ],
    ["a negative revision", makeState({ revision: -1 })],
    ["an infinite revision", makeState({ revision: Infinity })],
    ["a missing version", makeState({ currentVersion: undefined })],
    ["a missing policy", makeState({ policy: null })],
    [
      "an unknown verdict",
      makeState({
        policy: {
          verdict: "maybe",
          latestVersion: null,
          minSupportedVersion: null,
          checkedAt: null,
        },
      }),
    ],
    ["a text checkedAt", makeState({ checkedAt: "now" })],
    ["a missing install flag", makeState({ isInstallPending: 1 })],
  ])("should refuse %s", (_name, value) => {
    expect(isUpdateState(value)).toBe(false);
  });
});

describe("withUpdateChannels", () => {
  test("should add the updater's channels to a program's list", () => {
    const channels = withUpdateChannels({
      invoke: { "notes:list": true },
      events: { "sync:done": true },
    });
    expect(Object.keys(channels.invoke)).toEqual([
      "notes:list",
      ...Object.keys(UPDATE_CHANNELS.invoke),
    ]);
    expect(Object.keys(channels.events)).toEqual([
      "sync:done",
      "update:state-changed",
    ]);
  });

  test.each([
    [{ invoke: { "update:check": true }, events: {} }],
    [{ invoke: {}, events: { "update:state-changed": true } }],
  ])("should refuse a list that already uses an update channel", (list) => {
    expect(() => withUpdateChannels(list)).toThrow(TypeError);
  });
});
