import { describe, expect, test } from "vitest";

import {
  compareVersions,
  evaluateUpdatePolicy,
  isVersion,
} from "../../lib/shared/version.helper";

describe("isVersion", () => {
  test.each([
    "1.4.0",
    "0.0.0",
    "1.4.0-beta.2",
    "1.4.0-rc-1",
    "999999999.0.1",
    "1.0.0-0.3.7",
    "1.0.0-x-y-z.--",
  ])("should accept %s", (value) => {
    expect(isVersion(value)).toBe(true);
  });

  test.each([
    "v1.4.0",
    "1.4",
    "1.4.0.1",
    "01.4.0",
    "1.4.0+build",
    "1.4.0-",
    "1.4.0-beta..1",
    "1.4.0-01",
    "1000000000.0.0",
    "",
    `1.0.0-${"a".repeat(64)}`,
  ])("should refuse %s", (value) => {
    expect(isVersion(value)).toBe(false);
  });

  test.each([1, null, undefined, {}, ["1.0.0"]])(
    "should refuse a value that is not a string: %s",
    (value) => {
      expect(isVersion(value)).toBe(false);
    }
  );
});

describe("compareVersions", () => {
  test.each([
    ["1.0.0", "2.0.0", -1],
    ["2.0.0", "1.0.0", 1],
    ["1.2.0", "1.10.0", -1],
    ["1.0.10", "1.0.9", 1],
    ["1.0.0", "1.0.0", 0],
    ["1.0.0-alpha", "1.0.0", -1],
    ["1.0.0", "1.0.0-alpha", 1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-alpha.1", "1.0.0-alpha.beta", -1],
    ["1.0.0-alpha.beta", "1.0.0-alpha.1", 1],
    ["1.0.0-beta.2", "1.0.0-beta.11", -1],
    ["1.0.0-beta.11", "1.0.0-beta.2", 1],
    ["1.0.0-beta", "1.0.0-alpha", 1],
    ["1.0.0-alpha", "1.0.0-beta", -1],
    ["1.0.0-rc.1", "1.0.0-rc.1", 0],
    ["1.0.0-99999999999999999999", "1.0.0-99999999999999999998", 1],
  ] as const)("should order %s against %s as %i", (left, right, order) => {
    expect(compareVersions(left, right)).toBe(order);
  });

  test("should throw a TypeError naming the side that is not a version", () => {
    expect(() => compareVersions("v1", "1.0.0")).toThrow(
      'compareVersions: left must be a semantic version like "1.4.0" or "1.4.0-beta.2", received "v1"'
    );
    expect(() => compareVersions("1.0.0", "x")).toThrow(/right must be/);
  });
});

describe("evaluateUpdatePolicy", () => {
  test("should require an update below the minimum", () => {
    expect(
      evaluateUpdatePolicy("1.0.0", {
        latestVersion: "2.0.0",
        minSupportedVersion: "1.5.0",
      })
    ).toBe("update-required");
  });

  test("should offer an update between the minimum and the latest", () => {
    expect(
      evaluateUpdatePolicy("1.6.0", {
        latestVersion: "2.0.0",
        minSupportedVersion: "1.5.0",
      })
    ).toBe("update-available");
    expect(
      evaluateUpdatePolicy("1.0.0", {
        latestVersion: "2.0.0",
        minSupportedVersion: null,
      })
    ).toBe("update-available");
  });

  test("should be up to date at or above the latest", () => {
    expect(
      evaluateUpdatePolicy("2.0.0", {
        latestVersion: "2.0.0",
        minSupportedVersion: null,
      })
    ).toBe("up-to-date");
    expect(
      evaluateUpdatePolicy("3.0.0", {
        latestVersion: "2.0.0",
        minSupportedVersion: "1.0.0",
      })
    ).toBe("up-to-date");
  });
});
