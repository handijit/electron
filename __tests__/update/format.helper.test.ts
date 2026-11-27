import { describe, expect, test } from "vitest";

import {
  formatBytes,
  formatPercent,
  formatSpeed,
} from "../../lib/update-ui/format.helper";

describe("format helpers", () => {
  test("should format sizes the Turkish way", () => {
    expect(formatBytes(512 * 1024)).toBe("512 KB");
    expect(formatBytes(84.2 * 1024 * 1024)).toBe("84,2 MB");
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe("1,25 GB");
  });

  test("should format a speed", () => {
    expect(formatSpeed(1.2 * 1024 * 1024)).toBe("1,2 MB/sn");
  });

  test("should put the percent sign first and never round up to 100", () => {
    expect(formatPercent(42)).toBe("%42");
    expect(formatPercent(99.9)).toBe("%99");
  });
});
