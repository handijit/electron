import { describe, expect, test } from "vitest";

import reasonOf from "../../lib/auth/reason-of.helper";

describe("reasonOf", () => {
  test("should use the message of an error and the text of anything else", () => {
    expect(reasonOf(new Error("boom"))).toBe("boom");
    expect(reasonOf(42)).toBe("42");
  });
});
