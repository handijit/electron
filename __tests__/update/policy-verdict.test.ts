import { describe, expect, test } from "vitest";

import {
  evaluateStoredPolicy,
  isStoredPolicy,
} from "../../lib/update/policy-verdict";

const DAY = 24 * 60 * 60 * 1000;
const base = { currentVersion: "1.4.0", now: 10 * DAY, requiredTtlMs: 7 * DAY };

describe("isStoredPolicy", () => {
  test("should accept what this package writes", () => {
    expect(
      isStoredPolicy({
        latestVersion: "1.5.0",
        minSupportedVersion: null,
        fetchedAt: 1,
      })
    ).toBe(true);
    expect(
      isStoredPolicy({
        latestVersion: "1.5.0",
        minSupportedVersion: "1.4.0",
        fetchedAt: 1,
      })
    ).toBe(true);
  });

  test.each([
    null,
    "x",
    { latestVersion: "v1", minSupportedVersion: null, fetchedAt: 1 },
    { latestVersion: "1.5.0", minSupportedVersion: "x", fetchedAt: 1 },
    { latestVersion: "1.5.0", minSupportedVersion: null, fetchedAt: "1" },
    { latestVersion: "1.5.0", minSupportedVersion: null, fetchedAt: Infinity },
  ])("should refuse %j", (value) => {
    expect(isStoredPolicy(value)).toBe(false);
  });
});

describe("evaluateStoredPolicy", () => {
  test("should say ok without a stored policy", () => {
    expect(
      evaluateStoredPolicy({ ...base, stored: null, answeredAt: 7 })
    ).toEqual({
      verdict: "ok",
      latestVersion: null,
      minSupportedVersion: null,
      checkedAt: 7,
    });
  });

  test("should map the policy to a verdict", () => {
    const stored = (
      latestVersion: string,
      minSupportedVersion: string | null
    ) =>
      evaluateStoredPolicy({
        ...base,
        answeredAt: null,
        stored: { latestVersion, minSupportedVersion, fetchedAt: 9 * DAY },
      }).verdict;
    expect(stored("1.4.0", null)).toBe("ok");
    expect(stored("1.5.0", null)).toBe("recommended");
    expect(stored("1.5.0", "1.5.0")).toBe("required");
  });

  test("should weaken a stale required verdict in either clock direction", () => {
    const at = (fetchedAt: number) =>
      evaluateStoredPolicy({
        ...base,
        answeredAt: null,
        stored: {
          latestVersion: "1.5.0",
          minSupportedVersion: "1.5.0",
          fetchedAt,
        },
      });
    expect(at(2 * DAY).verdict).toBe("recommended");
    expect(at(18 * DAY).verdict).toBe("recommended");
    expect(at(3 * DAY)).toEqual({
      verdict: "required",
      latestVersion: "1.5.0",
      minSupportedVersion: "1.5.0",
      checkedAt: 3 * DAY,
    });
  });
});
