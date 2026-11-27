import { describe, expect, test } from "vitest";

import { createRedactor, redactText } from "../../lib/main/redact";

describe("redactText", () => {
  test("should mask bearer and basic credentials", () => {
    expect(redactText("Authorization: Bearer abc.def-123")).toBe(
      "Authorization: Bearer [REDACTED]"
    );
    expect(redactText("basic dXNlcjpwYXNz")).toBe("basic [REDACTED]");
  });

  test("should mask a JWT", () => {
    expect(redactText("token eyJhbGciOi.eyJzdWIiOjF9.sig_123 end")).toBe(
      "token [REDACTED] end"
    );
  });

  test("should mask secrets in URLs and keep the rest", () => {
    expect(
      redactText("http://127.0.0.1/callback?code=abc&state=xyz&lang=tr#token=t")
    ).toBe(
      "http://127.0.0.1/callback?code=[REDACTED]&state=[REDACTED]&lang=tr#token=[REDACTED]"
    );
  });

  test("should keep only the domain of an e-mail address", () => {
    expect(redactText("sent to ayse.yilmaz@example.com.tr")).toBe(
      "sent to ***@example.com.tr"
    );
  });

  test("should clip a very long text", () => {
    const text = redactText("x".repeat(8010));
    expect(text).toBe(`${"x".repeat(8000)}… (10 more characters)`);
  });
});

describe("createRedactor", () => {
  const redact = createRedactor();

  test("should replace values under secret-looking keys, at any depth", () => {
    expect(
      redact({
        user: { name: "Ayşe", password: "p", apiKey: "k", "e-mail": "a@b.co" },
        refresh_token: "t",
        Authorization: "Bearer x",
        count: 3,
      })
    ).toEqual({
      user: {
        name: "Ayşe",
        password: "[REDACTED]",
        apiKey: "[REDACTED]",
        "e-mail": "[REDACTED]",
      },
      refresh_token: "[REDACTED]",
      Authorization: "[REDACTED]",
      count: 3,
    });
  });

  test("should redact free text inside values", () => {
    expect(redact({ note: "Bearer abc" })).toEqual({
      note: "Bearer [REDACTED]",
    });
  });

  test("should mask extra keys, written as literal text", () => {
    const custom = createRedactor(["customerNo", "a.b"]);
    expect(custom({ customerNo: 5, axb: 1, "a.b": 2 })).toEqual({
      customerNo: "[REDACTED]",
      axb: 1,
      "a.b": "[REDACTED]",
    });
  });

  test("should describe values JSON cannot hold", () => {
    expect(
      redact({
        big: 10n,
        run: () => undefined,
        tag: Symbol("x"),
        none: null,
        missing: undefined,
        flag: true,
      })
    ).toEqual({
      big: "10",
      run: "[function]",
      tag: "[symbol]",
      none: null,
      missing: undefined,
      flag: true,
    });
  });

  test("should write errors and dates readably", () => {
    const error = new Error("failed for a@b.co");
    const withoutStack = new Error("plain");
    withoutStack.stack = undefined;
    expect(
      redact({
        error,
        withoutStack,
        at: new Date(0),
        bad: new Date(Number.NaN),
      })
    ).toEqual({
      error: {
        name: "Error",
        message: "failed for ***@b.co",
        stack: expect.stringContaining("failed for ***@b.co"),
      },
      withoutStack: { name: "Error", message: "plain", stack: undefined },
      at: "1970-01-01T00:00:00.000Z",
      bad: "Invalid Date",
    });
  });

  test("should mark a cycle but not a shared object", () => {
    const shared = { id: 1 };
    const cyclic: Record<string, unknown> = { shared, again: shared };
    cyclic.self = cyclic;
    expect(redact(cyclic)).toEqual({
      shared: { id: 1 },
      again: { id: 1 },
      self: "[Circular]",
    });
  });

  test("should bound depth and width", () => {
    let deep: unknown = "end";
    for (let i = 0; i < 8; i++) deep = { deep };
    expect(JSON.stringify(redact(deep))).toContain('"[Truncated]"');

    const wide = redact(Array.from({ length: 105 }, (_, i) => i)) as unknown[];
    expect(wide).toHaveLength(101);
    expect(wide.at(-1)).toBe("[5 more items]");
    expect(redact([1, 2])).toEqual([1, 2]);
  });

  test("should survive a throwing getter and a hostile proxy", () => {
    const getter = Object.defineProperty({}, "boom", {
      enumerable: true,
      get: () => {
        throw new Error("no");
      },
    });
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("no");
        },
      }
    );
    expect(redact({ getter, proxy })).toEqual({
      getter: "[Unreadable]",
      proxy: "[Unreadable]",
    });
  });

  test("should not let a __proto__ key swap the prototype", () => {
    const value = JSON.parse('{"__proto__":{"polluted":true}}') as object;
    const copy = redact(value) as Record<string, unknown>;
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.hasOwn(copy, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
