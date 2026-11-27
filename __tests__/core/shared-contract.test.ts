import { THEME_ATTRIBUTE as UI_THEME_ATTRIBUTE } from "@handijitcom/ui/design";
import { THEME_STORAGE_KEY as UI_THEME_STORAGE_KEY } from "@handijitcom/ui/design";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { CORE_CONTRACT } from "../../lib/main/core-contract";
import {
  APP_HOST,
  APP_SCHEME,
  APP_URL,
} from "../../lib/shared/app-url.constants";
import AUTH_CHANNELS from "../../lib/shared/auth-channels.constants";
import BRIDGE_KEY from "../../lib/shared/bridge-key.constants";
import {
  collectChannels,
  isChannelName,
} from "../../lib/shared/channel-name.helper";
import channelsOf from "../../lib/shared/channels-of";
import {
  CORE_CHANNEL_PREFIX,
  CORE_CHANNELS,
} from "../../lib/shared/core-channels.constants";
import defineContract from "../../lib/shared/define-contract";
import LOG_LEVELS from "../../lib/shared/log-levels.constants";
import {
  THEME_ATTRIBUTE,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
} from "../../lib/shared/theme.constants";
import UPDATE_CHANNELS from "../../lib/shared/update-channels.constants";

vi.mock("electron", () => ({}));

describe("constants", () => {
  test("should serve the app from app://bundle/", () => {
    expect(APP_SCHEME).toBe("app");
    expect(APP_HOST).toBe("bundle");
    expect(APP_URL).toBe("app://bundle/");
    expect(BRIDGE_KEY).toBe("desktop");
  });

  test("should list the log levels from the most verbose", () => {
    expect(LOG_LEVELS).toEqual(["debug", "info", "warn", "error"]);
  });

  test("should list the theme preferences in settings order", () => {
    expect(THEME_PREFERENCES).toEqual(["system", "light", "dark"]);
  });

  test("should keep the theme attribute and storage key equal to @handijitcom/ui/design", () => {
    expect(THEME_ATTRIBUTE).toBe(UI_THEME_ATTRIBUTE);
    expect(THEME_STORAGE_KEY).toBe(UI_THEME_STORAGE_KEY);
  });

  test("should name exactly the channels the core contract registers", () => {
    expect(Object.keys(CORE_CHANNELS.invoke).sort()).toEqual(
      Object.keys(CORE_CONTRACT.invoke).sort()
    );
    expect(Object.keys(CORE_CHANNELS.events).sort()).toEqual(
      Object.keys(CORE_CONTRACT.events).sort()
    );
    for (const name of [
      ...Object.keys(CORE_CHANNELS.invoke),
      ...Object.keys(CORE_CHANNELS.events),
    ]) {
      expect(name.startsWith(CORE_CHANNEL_PREFIX)).toBe(true);
    }
  });

  test("should never use one channel name twice across the package", () => {
    const names = [CORE_CHANNELS, UPDATE_CHANNELS, AUTH_CHANNELS].flatMap(
      (channels) => [
        ...Object.keys(channels.invoke),
        ...Object.keys(channels.events),
      ]
    );
    expect(names).toHaveLength(15);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every(isChannelName)).toBe(true);
  });
});

describe("isChannelName", () => {
  test.each([
    "notes:list",
    "settings:set-theme",
    "a1:b2",
    "core-log:write",
    "sync-2:finished-3",
  ])("should accept %s", (name) => {
    expect(isChannelName(name)).toBe(true);
  });

  test.each([
    "",
    "notes",
    "notes:",
    ":list",
    "Notes:list",
    "notes:List",
    "notes:list:extra",
    "notes-:list",
    "notes:-list",
    "notes--x:list",
    "1notes:list",
    "notes :list",
    "notes_list:x",
  ])("should refuse %j", (name) => {
    expect(isChannelName(name)).toBe(false);
  });
});

describe("collectChannels", () => {
  test("should return the request and event names", () => {
    expect(
      collectChannels(
        { invoke: { "a:b": 1, "a:c": 2 }, events: { "a:d": 3 } },
        "caller"
      )
    ).toEqual({ invoke: ["a:b", "a:c"], events: ["a:d"] });
  });

  test("should refuse a malformed name with the caller in the message", () => {
    expect(() =>
      collectChannels({ invoke: { Bad: true }, events: {} }, "myCaller")
    ).toThrow(
      new TypeError(
        'myCaller: channel "Bad" must be "area:action" in kebab-case, like "settings:set-theme"'
      )
    );
  });

  test("should refuse a malformed event name", () => {
    expect(() =>
      collectChannels({ invoke: {}, events: { "x:Y": true } }, "c")
    ).toThrow(TypeError);
  });

  test("should refuse the reserved core- area", () => {
    expect(() =>
      collectChannels({ invoke: { "core-x:y": true }, events: {} }, "c")
    ).toThrow(/reserved for @handijitcom\/electron/);
  });

  test("should refuse a name that is both a request and an event", () => {
    expect(() =>
      collectChannels({ invoke: { "a:b": true }, events: { "a:b": true } }, "c")
    ).toThrow('c: channel "a:b" is declared both as a request and as an event');
  });

  test("should not mistake an inherited key for a declared request", () => {
    expect(
      collectChannels({ invoke: {}, events: { "to-string:x": true } }, "c")
        .events
    ).toEqual(["to-string:x"]);
  });
});

describe("defineContract", () => {
  test("should return the very contract it was given", () => {
    const contract = {
      invoke: { "notes:list": { output: z.array(z.string()) } },
      events: { "sync:done": z.number() },
    };
    expect(defineContract(contract)).toBe(contract);
  });

  test("should throw on a malformed channel at definition time", () => {
    expect(() =>
      defineContract({ invoke: { "notes list": {} }, events: {} })
    ).toThrow(/^defineContract: channel "notes list"/);
  });
});

describe("channelsOf", () => {
  test("should map every channel to true without the schemas", () => {
    const contract = defineContract({
      invoke: {
        "notes:list": { output: z.array(z.string()) },
        "notes:rename": { input: z.string() },
      },
      events: { "sync:done": z.number() },
    });
    expect(channelsOf(contract)).toEqual({
      invoke: { "notes:list": true, "notes:rename": true },
      events: { "sync:done": true },
    });
  });

  test("should map an empty contract to empty maps", () => {
    expect(channelsOf({ invoke: {}, events: {} })).toEqual({
      invoke: {},
      events: {},
    });
  });
});
