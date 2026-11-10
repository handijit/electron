import { describe, expect, test } from "vitest";
import { z } from "zod";

import channelsOf from "../../lib/shared/channels-of";
import defineContract from "../../lib/shared/define-contract";

describe("defineContract", () => {
  test("should return the very object it was given", () => {
    const contract = {
      invoke: { "settings:get": { output: z.object({ theme: z.string() }) } },
      events: { "update:ready": z.object({ version: z.string() }) },
    };

    expect(defineContract(contract)).toBe(contract);
  });

  test("should accept a contract without channels", () => {
    expect(defineContract({ invoke: {}, events: {} })).toEqual({
      invoke: {},
      events: {},
    });
  });

  test("should throw on a malformed channel name, naming itself", () => {
    expect(() =>
      defineContract({ invoke: { getSettings: {} }, events: {} })
    ).toThrow(/^defineContract: channel "getSettings" must be "area:action"/);
  });

  test("sentinel: should throw on a channel in the reserved core- area", () => {
    expect(() =>
      defineContract({
        invoke: {},
        events: { "core-theme:changed": z.string() },
      })
    ).toThrow(/reserved for @handijit\/electron$/);
  });
});

describe("channelsOf", () => {
  test("should list the channel names without their schemas", () => {
    const contract = defineContract({
      invoke: {
        "settings:get": { output: z.string() },
        "settings:set-theme": { input: z.string() },
      },
      events: { "update:ready": z.object({ version: z.string() }) },
    });

    expect(channelsOf(contract)).toStrictEqual({
      invoke: { "settings:get": true, "settings:set-theme": true },
      events: { "update:ready": true },
    });
  });

  test("should return empty maps for an empty contract", () => {
    expect(channelsOf({ invoke: {}, events: {} })).toStrictEqual({
      invoke: {},
      events: {},
    });
  });

  test("should survive structured clone, so it can be bundled or serialised", () => {
    const map = channelsOf({
      invoke: { "a:b": { input: z.string() } },
      events: { "c:d": z.number() },
    });

    expect(structuredClone(map)).toStrictEqual(map);
  });
});
