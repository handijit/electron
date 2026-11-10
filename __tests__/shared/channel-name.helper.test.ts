import { describe, expect, test } from "vitest";

import {
  collectChannels,
  isChannelName,
} from "../../lib/shared/channel-name.helper";

describe("isChannelName", () => {
  test.each([
    "settings:get",
    "settings:set-theme",
    "auto-update:check-now",
    "a:b",
    "db2:query-v2",
  ])("should accept %s", (name) => {
    expect(isChannelName(name)).toBe(true);
  });

  test.each([
    "",
    "settings",
    ":get",
    "settings:",
    "settings:get:all",
    "Settings:get",
    "settings:getAll",
    "settings_get:all",
    "settings:get_all",
    "2fa:verify",
    "settings:-get",
    "settings-:get",
    "settings--user:get",
    "settings: get",
    "settings:get ",
    " settings:get",
    "settings:get\n",
    "ayarlar:güncelle",
    "__proto__",
    "constructor",
    "*",
  ])("should refuse %j", (name) => {
    expect(isChannelName(name)).toBe(false);
  });

  test("should answer in linear time for a long hostile name", () => {
    const hostile = `${"a-".repeat(50_000)}!`;

    const startedAt = performance.now();
    expect(isChannelName(hostile)).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(250);
  });
});

describe("collectChannels", () => {
  test("should return the names of both kinds, in declaration order", () => {
    expect(
      collectChannels(
        {
          invoke: { "settings:get": {}, "app:quit": true },
          events: { "update:ready": 1 },
        },
        "test"
      )
    ).toEqual({
      invoke: ["settings:get", "app:quit"],
      events: ["update:ready"],
    });
  });

  test("should accept a source without channels", () => {
    expect(collectChannels({ invoke: {}, events: {} }, "test")).toEqual({
      invoke: [],
      events: [],
    });
  });

  test.each([
    ["a request", { invoke: { getSettings: true }, events: {} }, "getSettings"],
    [
      "an event",
      { invoke: {}, events: { "Update:Ready": true } },
      "Update:Ready",
    ],
  ])("should refuse a malformed name of %s", (_kind, source, name) => {
    expect(() => collectChannels(source, "defineContract")).toThrow(
      new TypeError(
        `defineContract: channel "${name}" must be "area:action" in kebab-case, like "settings:set-theme"`
      )
    );
  });

  test.each([
    [
      "a request",
      { invoke: { "core-log:write": true }, events: {} },
      "core-log:write",
    ],
    [
      "an event",
      { invoke: {}, events: { "core-theme:changed": true } },
      "core-theme:changed",
    ],
    [
      "an unknown core name",
      { invoke: { "core-x:y": true }, events: {} },
      "core-x:y",
    ],
  ])(
    "sentinel: should refuse the reserved core- area for %s",
    (_kind, source, name) => {
      expect(() => collectChannels(source, "exposeBridge")).toThrow(
        new TypeError(
          `exposeBridge: channel "${name}" uses the "core-" area, which is reserved for @handijit/electron`
        )
      );
    }
  );

  test("should allow an area that merely starts with the letters core", () => {
    expect(
      collectChannels(
        { invoke: { "core:get": true, "corel:draw": true }, events: {} },
        "test"
      ).invoke
    ).toEqual(["core:get", "corel:draw"]);
  });

  test("should refuse a name declared both as a request and as an event", () => {
    expect(() =>
      collectChannels(
        {
          invoke: { "sync:run": true },
          events: { "sync:done": true, "sync:run": true },
        },
        "defineContract"
      )
    ).toThrow(
      new TypeError(
        'defineContract: channel "sync:run" is declared both as a request and as an event'
      )
    );
  });

  test("should not treat inherited keys as channels", () => {
    const inherited = Object.create({ "evil:channel": true }) as Record<
      string,
      unknown
    >;
    inherited["app:quit"] = true;

    expect(
      collectChannels({ invoke: inherited, events: {} }, "test").invoke
    ).toEqual(["app:quit"]);
  });
});
