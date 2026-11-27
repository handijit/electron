import type { AppUpdater } from "electron-updater";
import { describe, expect, expectTypeOf, test, vi } from "vitest";

vi.mock("electron", () => ({}));

import UPDATE_CHANNELS from "../../lib/shared/update-channels.constants";
import type { UpdaterEngine } from "../../lib/update/types";
import updateContract, {
  updateStateSchema,
} from "../../lib/update/update-contract";
import { INFO, makeState } from "../helpers/update-fixtures";

describe("updateContract", () => {
  test("should name exactly the channels of UPDATE_CHANNELS", () => {
    expect(Object.keys(updateContract.invoke).sort()).toEqual(
      Object.keys(UPDATE_CHANNELS.invoke).sort()
    );
    expect(Object.keys(updateContract.events).sort()).toEqual(
      Object.keys(UPDATE_CHANNELS.events).sort()
    );
  });

  test("should take no argument on any channel", () => {
    for (const definition of Object.values(updateContract.invoke)) {
      expect("input" in definition).toBe(false);
    }
  });

  test("should accept every complete state", () => {
    for (const state of [
      makeState(),
      makeState({ status: "unsupported", reason: "development" }),
      makeState({
        status: "downloading",
        update: INFO,
        progress: {
          percent: 1,
          transferredBytes: 1,
          totalBytes: 2,
          bytesPerSecond: 3,
        },
      }),
      makeState({
        status: "error",
        error: { code: "UNKNOWN", message: "x" },
        update: null,
      }),
    ]) {
      expect(updateStateSchema.parse(state)).toEqual(state);
    }
  });

  test("should refuse an unknown field: a bug in main", () => {
    expect(updateStateSchema.safeParse(makeState({ token: "x" })).success).toBe(
      false
    );
  });

  test("should accept electron-updater's autoUpdater as the engine", () => {
    expectTypeOf<AppUpdater>().toExtend<UpdaterEngine>();
  });
});
