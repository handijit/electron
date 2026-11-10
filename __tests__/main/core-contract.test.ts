import { describe, expect, test } from "vitest";

import {
  CORE_CONTRACT,
  themePreferenceSchema,
} from "../../lib/main/core-contract";
import { isChannelName } from "../../lib/shared/channel-name.helper";
import channelsOf from "../../lib/shared/channels-of";
import {
  CORE_CHANNEL_PREFIX,
  CORE_CHANNELS,
} from "../../lib/shared/core-channels.constants";
import LOG_LEVELS from "../../lib/shared/log-levels.constants";
import { THEME_PREFERENCES } from "../../lib/shared/theme.constants";

const logWrite = CORE_CONTRACT.invoke["core-log:write"].input;
const themeState = CORE_CONTRACT.events["core-theme:changed"];

describe("CORE_CONTRACT", () => {
  test("should declare exactly the channels the preload exposes", () => {
    expect(channelsOf(CORE_CONTRACT)).toEqual(CORE_CHANNELS);
  });

  test("should keep every channel well-formed and inside the reserved area", () => {
    const names = [
      ...Object.keys(CORE_CONTRACT.invoke),
      ...Object.keys(CORE_CONTRACT.events),
    ];

    expect(names).toHaveLength(4);
    for (const name of names) {
      expect(isChannelName(name)).toBe(true);
      expect(name.startsWith(CORE_CHANNEL_PREFIX)).toBe(true);
    }
  });

  test("should declare which channels take an input and which answer", () => {
    const { invoke } = CORE_CONTRACT;

    expect(Object.keys(invoke["core-log:write"])).toEqual(["input"]);
    expect(Object.keys(invoke["core-theme:get"])).toEqual(["output"]);
    expect(Object.keys(invoke["core-theme:set"])).toEqual(["input", "output"]);
    expect(invoke["core-theme:set"].input).toBe(themePreferenceSchema);
    expect(invoke["core-theme:get"].output).toBe(themeState);
    expect(invoke["core-theme:set"].output).toBe(themeState);
  });
});

describe("themePreferenceSchema", () => {
  test("should accept exactly the shared theme preferences", () => {
    expect(themePreferenceSchema.options).toEqual(THEME_PREFERENCES);
    for (const preference of THEME_PREFERENCES) {
      expect(themePreferenceSchema.parse(preference)).toBe(preference);
    }
  });

  test.each(["", "auto", "Dark", "dark ", 1, null, undefined, ["dark"], {}])(
    "should reject %j",
    (value) => {
      expect(themePreferenceSchema.safeParse(value).success).toBe(false);
    }
  );
});

describe("the theme state schema", () => {
  test.each([
    { preference: "system", resolved: "light" },
    { preference: "system", resolved: "dark" },
    { preference: "light", resolved: "light" },
    { preference: "dark", resolved: "dark" },
  ])("should accept $preference resolved to $resolved", (state) => {
    expect(themeState.parse(state)).toEqual(state);
  });

  test.each([
    [
      "a resolved theme of system",
      { preference: "system", resolved: "system" },
    ],
    ["an unknown preference", { preference: "auto", resolved: "dark" }],
    ["a missing resolved theme", { preference: "dark" }],
    ["a missing preference", { resolved: "dark" }],
    ["a bare preference", "dark"],
    ["nothing", undefined],
  ])("should reject %s", (_label, state) => {
    expect(themeState.safeParse(state).success).toBe(false);
  });

  test("should drop keys it does not know", () => {
    const state = { preference: "dark", resolved: "dark", extra: "x" };

    expect(themeState.parse(state)).toEqual({
      preference: "dark",
      resolved: "dark",
    });
  });
});

describe("the renderer log entry schema", () => {
  test("should accept every shared log level", () => {
    expect(logWrite.shape.level.options).toEqual(LOG_LEVELS);
    for (const level of LOG_LEVELS) {
      expect(logWrite.parse({ level, message: "hello" })).toEqual({
        level,
        message: "hello",
      });
    }
  });

  test("should accept a context of any JSON-like values", () => {
    const entry = {
      level: "info",
      message: "saved",
      context: { id: 7, tags: ["a"], nested: { ok: true }, none: null },
    };

    expect(logWrite.parse(entry)).toEqual(entry);
  });

  test.each([
    ["an unknown level", { level: "trace", message: "x" }],
    ["a missing level", { message: "x" }],
    ["a missing message", { level: "info" }],
    ["a message that is not text", { level: "info", message: 42 }],
    [
      "a context that is not an object",
      { level: "info", message: "x", context: "y" },
    ],
    [
      "a context that is a list",
      { level: "info", message: "x", context: ["y"] },
    ],
    ["a context that is null", { level: "info", message: "x", context: null }],
    ["a bare string", "info: x"],
    ["nothing", undefined],
  ])("should reject %s", (_label, entry) => {
    expect(logWrite.safeParse(entry).success).toBe(false);
  });

  test("should cap the message at 4000 characters", () => {
    const atLimit = { level: "warn", message: "m".repeat(4000) };
    const overLimit = { level: "warn", message: "m".repeat(4001) };

    expect(logWrite.safeParse(atLimit).success).toBe(true);
    expect(logWrite.safeParse(overLimit).success).toBe(false);
  });

  test("should cap a context key at 100 characters", () => {
    const entry = (key: string): unknown => ({
      level: "error",
      message: "x",
      context: { [key]: 1 },
    });

    expect(logWrite.safeParse(entry("k".repeat(100))).success).toBe(true);
    expect(logWrite.safeParse(entry("k".repeat(101))).success).toBe(false);
  });
});
