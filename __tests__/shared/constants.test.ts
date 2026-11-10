import * as design from "@handijit/design";
import { describe, expect, test } from "vitest";

import {
  APP_HOST,
  APP_SCHEME,
  APP_URL,
} from "../../lib/shared/app-url.constants";
import BRIDGE_KEY from "../../lib/shared/bridge-key.constants";
import { isChannelName } from "../../lib/shared/channel-name.helper";
import {
  CORE_CHANNEL_PREFIX,
  CORE_CHANNELS,
} from "../../lib/shared/core-channels.constants";
import LOG_LEVELS from "../../lib/shared/log-levels.constants";
import {
  THEME_ATTRIBUTE,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
} from "../../lib/shared/theme.constants";

describe("app URL", () => {
  test("should be the app:// origin with a fixed host", () => {
    expect(APP_SCHEME).toBe("app");
    expect(APP_HOST).toBe("bundle");
    expect(APP_URL).toBe("app://bundle/");
  });

  test("should parse as a standard URL with that scheme and host", () => {
    const url = new URL(APP_URL);

    expect(url.protocol).toBe(`${APP_SCHEME}:`);
    expect(url.pathname).toBe("/");
    expect(APP_URL).toBe(`${APP_SCHEME}://${APP_HOST}/`);
  });
});

describe("bridge key", () => {
  test("should be window.desktop", () => {
    expect(BRIDGE_KEY).toBe("desktop");
  });
});

describe("core channels", () => {
  test("should be exactly the log and theme channels", () => {
    expect(CORE_CHANNELS).toStrictEqual({
      invoke: {
        "core-log:write": true,
        "core-theme:get": true,
        "core-theme:set": true,
      },
      events: { "core-theme:changed": true },
    });
  });

  test("should all be well-formed names inside the reserved area", () => {
    const names = [
      ...Object.keys(CORE_CHANNELS.invoke),
      ...Object.keys(CORE_CHANNELS.events),
    ];

    expect(CORE_CHANNEL_PREFIX).toBe("core-");
    for (const name of names) {
      expect(isChannelName(name), name).toBe(true);
      expect(name.startsWith(CORE_CHANNEL_PREFIX), name).toBe(true);
    }
  });
});

describe("log levels", () => {
  test("should run from the most to the least verbose", () => {
    expect(LOG_LEVELS).toEqual(["debug", "info", "warn", "error"]);
  });
});

describe("theme constants", () => {
  test("should list every preference, system first", () => {
    expect(THEME_PREFERENCES).toEqual(["system", "light", "dark"]);
  });

  // The renderer writes the attribute @handijit/design's stylesheet and boot script read.
  // The package does not depend on the design package at run time, so equality is a test.
  test("sentinel: should use the attribute and storage key of @handijit/design", () => {
    expect(THEME_ATTRIBUTE).toBe(design.THEME_ATTRIBUTE);
    expect(THEME_STORAGE_KEY).toBe(design.THEME_STORAGE_KEY);
  });

  test("sentinel: should match what the design boot script actually reads and writes", () => {
    expect(design.THEME_BOOT_SCRIPT).toContain(JSON.stringify(THEME_ATTRIBUTE));
    expect(design.THEME_BOOT_SCRIPT).toContain(
      JSON.stringify(THEME_STORAGE_KEY)
    );
  });
});
