import { describe, expect, test } from "vitest";

import { createRedactor, redactText } from "../../lib/main/redact";

const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

describe("redactText", () => {
  test("should leave harmless text alone", () => {
    expect(redactText("Window opened in 42 ms")).toBe("Window opened in 42 ms");
    expect(redactText("")).toBe("");
  });

  test("sentinel: should mask bearer and basic credentials, keeping the scheme", () => {
    expect(redactText("Authorization: Bearer abc.DEF-123_~+/=")).toBe(
      "Authorization: Bearer [REDACTED]"
    );
    expect(redactText("authorization: basic dXNlcjpwYXNzd29yZA==")).toBe(
      "authorization: basic [REDACTED]"
    );
    expect(redactText("BEARER   s3cr3t and Bearer other")).toBe(
      "BEARER [REDACTED] and Bearer [REDACTED]"
    );
  });

  test("sentinel: should mask JSON Web Tokens wherever they stand", () => {
    expect(redactText(`refresh failed for ${JWT}!`)).toBe(
      "refresh failed for [REDACTED]!"
    );
    expect(redactText(`${JWT} ${JWT}`)).toBe("[REDACTED] [REDACTED]");
    // An unsigned token ends with its second dot.
    expect(redactText("eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.")).toBe(
      "[REDACTED]"
    );
  });

  test("sentinel: should mask secret URL parameters in the query and in the fragment", () => {
    expect(
      redactText(
        "GET https://app.test/callback?code=4/0AbC&state=xyz&page=2#access_token=ya29.a0 done"
      )
    ).toBe(
      "GET https://app.test/callback?code=[REDACTED]&state=[REDACTED]&page=2#access_token=[REDACTED] done"
    );
    for (const name of [
      "code",
      "token",
      "access_token",
      "refresh_token",
      "id_token",
      "key",
      "secret",
      "password",
      "state",
    ]) {
      expect(redactText(`https://x.test/?a=1&${name}=VALUE-1`), name).toBe(
        `https://x.test/?a=1&${name}=[REDACTED]`
      );
      expect(
        redactText(`https://x.test/?${name.toUpperCase()}=VALUE-1`),
        name
      ).toBe(`https://x.test/?${name.toUpperCase()}=[REDACTED]`);
    }
  });

  test("sentinel: should mask the local part of e-mail addresses", () => {
    expect(redactText("Signed in as ada.lovelace+test@mail.example.com.")).toBe(
      "Signed in as ***@mail.example.com."
    );
    expect(redactText("a@b.co, c_d%e@f-g.org")).toBe("***@b.co, ***@f-g.org");
  });

  test("should clip a very long string and say how much is missing", () => {
    const text = "x".repeat(8000);

    expect(redactText(text)).toBe(text);
    expect(redactText(`${text}yz`)).toBe(`${text}… (2 more characters)`);
    expect(redactText("x".repeat(1_000_000))).toHaveLength(
      8000 + "… (992000 more characters)".length
    );
  });

  test("should still mask a secret that the clipping cut in two", () => {
    const text = `${"x".repeat(7980)} Bearer ${"t".repeat(100)}`;

    const redacted = redactText(text);

    expect(redacted).toContain("Bearer [REDACTED]");
    expect(redacted).not.toContain("ttt");
  });
});

describe("createRedactor", () => {
  const redact = createRedactor();

  test("should pass plain values through", () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact("plain")).toBe("plain");
    expect(
      redact({ count: 3, nested: { ok: false, list: [1, "two"] } })
    ).toEqual({ count: 3, nested: { ok: false, list: [1, "two"] } });
  });

  test("should turn values JSON cannot carry into text", () => {
    expect(redact(12345678901234567890n)).toBe("12345678901234567890");
    expect(redact(() => 1)).toBe("[function]");
    expect(redact(Symbol("id"))).toBe("[symbol]");
    expect(redact(new Date("2026-01-02T03:04:05.678Z"))).toBe(
      "2026-01-02T03:04:05.678Z"
    );
    expect(redact(new Date(Number.NaN))).toBe("Invalid Date");
    expect(() =>
      JSON.stringify(redact({ big: 1n, at: new Date(0) }))
    ).not.toThrow();
  });

  test("sentinel: should replace the value of every secret-looking key", () => {
    const secretKeys = [
      "password",
      "passwd",
      "pass",
      "passphrase",
      "userPassword",
      "clientSecret",
      "token",
      "accessToken",
      "refresh_token",
      "Authorization",
      "authorisation",
      "cookie",
      "Set-Cookie",
      "license",
      "licenceKey",
      "credentials",
      "sessionId",
      "signature",
      "apiKey",
      "api_key",
      "api-key",
      "APIKEY",
      "privateKey",
      "private_key",
      "private-key",
      "email",
      "e-mail",
      "userEmail",
      "phone",
      "phoneNumber",
    ];
    const input = Object.fromEntries(
      secretKeys.map((key) => [key, `value-of-${key}`])
    );

    const output = redact({ ...input, name: "kept" }) as Record<
      string,
      unknown
    >;

    for (const key of secretKeys) {
      expect(output[key], key).toBe("[REDACTED]");
    }
    expect(output.name).toBe("kept");
    expect(JSON.stringify(output)).not.toContain("value-of-");
  });

  test("sentinel: should replace a secret key's value whatever its type or depth", () => {
    const output = redact({
      user: {
        id: 7,
        token: { value: "abc", expires: 1 },
        sessions: ["s1", "s2"],
        profile: [{ password: 123456 }],
      },
    });

    expect(output).toEqual({
      user: {
        id: 7,
        token: "[REDACTED]",
        sessions: "[REDACTED]",
        profile: [{ password: "[REDACTED]" }],
      },
    });
  });

  test("sentinel: should mask secrets inside strings at any depth", () => {
    const output = redact({
      request: {
        url: "https://api.test/login?token=abc123",
        headers: [`Bearer ${JWT}`, "x"],
        note: "sent by ada@example.com",
      },
    });

    expect(output).toEqual({
      request: {
        url: "https://api.test/login?token=[REDACTED]",
        headers: ["Bearer [REDACTED]", "x"],
        note: "sent by ***@example.com",
      },
    });
  });

  test("should honour extra keys, case-insensitively and literally", () => {
    const custom = createRedactor(["iban", "tax.id", "c++"]);

    expect(
      custom({
        IBAN: "TR00",
        customerIban: "TR01",
        "tax.id": "123",
        taxXid: "kept: the dot is not a wildcard",
        "c++": "x",
        password: "still secret",
        name: "kept",
      })
    ).toEqual({
      IBAN: "[REDACTED]",
      customerIban: "[REDACTED]",
      "tax.id": "[REDACTED]",
      taxXid: "kept: the dot is not a wildcard",
      "c++": "[REDACTED]",
      password: "[REDACTED]",
      name: "kept",
    });
    // Without the extra keys the same names pass.
    expect(redact({ iban: "TR00" })).toEqual({ iban: "TR00" });
  });

  test("should give the same answer every time a key is tested", () => {
    const custom = createRedactor(["iban"]);

    for (let round = 0; round < 3; round += 1) {
      expect(custom({ iban: "TR00", token: "t" })).toEqual({
        iban: "[REDACTED]",
        token: "[REDACTED]",
      });
    }
  });

  test("should describe an error by name, message and stack, masking each", () => {
    const error = new RangeError("no access for ada@example.com");
    error.stack = `RangeError: no access for ada@example.com\n    at fetch https://api.test/?token=abc (main.js:1:1)`;

    expect(redact({ error })).toEqual({
      error: {
        name: "RangeError",
        message: "no access for ***@example.com",
        stack:
          "RangeError: no access for ***@example.com\n    at fetch https://api.test/?token=[REDACTED] (main.js:1:1)",
      },
    });
  });

  test("should describe an error that has no stack", () => {
    const error = new Error("plain");
    Object.defineProperty(error, "stack", { value: undefined });

    expect(redact(error)).toEqual({
      name: "Error",
      message: "plain",
      stack: undefined,
    });
  });

  test("sentinel: should survive a cycle without mistaking a shared object for one", () => {
    const shared = { id: 1 };
    const root: Record<string, unknown> = { first: shared, second: shared };
    root.self = root;
    const list: unknown[] = [root];
    list.push(list);
    root.list = list;

    const output = redact(root);

    expect(output).toEqual({
      first: { id: 1 },
      second: { id: 1 },
      self: "[Circular]",
      list: ["[Circular]", "[Circular]"],
    });
    expect(() => JSON.stringify(output)).not.toThrow();
  });

  test("sentinel: should cut off input that is nested too deep", () => {
    type Nested = { level: number; child?: Nested; items?: unknown[] };
    const root: Nested = { level: 0 };
    let cursor = root;
    for (let level = 1; level <= 50; level += 1) {
      cursor.child = { level };
      cursor = cursor.child;
    }

    let output = redact(root) as Nested | string;
    const levels: number[] = [];
    while (typeof output !== "string") {
      levels.push(output.level);
      output = output.child as Nested | string;
    }

    expect(levels).toEqual([0, 1, 2, 3, 4, 5]);
    expect(output).toBe("[Truncated]");
    expect(redact([[[[[[["too deep"]]]]]]])).toEqual([[[[[["[Truncated]"]]]]]]);
  });

  test("sentinel: should bound wide arrays, wide objects and long strings", () => {
    const array = Array.from({ length: 10_000 }, (_, index) => index);
    const object = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [`key${index}`, index])
    );

    const output = redact({ array, object, text: "y".repeat(100_000) }) as {
      array: unknown[];
      object: Record<string, unknown>;
      text: string;
    };

    expect(output.array).toHaveLength(101);
    expect(output.array.slice(0, 100)).toEqual(array.slice(0, 100));
    expect(output.array[100]).toBe("[9900 more items]");
    expect(Object.keys(output.object)).toEqual(
      Array.from({ length: 100 }, (_, index) => `key${index}`)
    );
    expect(output.text).toHaveLength(8000 + "… (92000 more characters)".length);
    expect(JSON.stringify(output).length).toBeLessThan(20_000);
    // An array of exactly the limit is complete and carries no marker.
    expect(redact(array.slice(0, 100))).toEqual(array.slice(0, 100));
  });

  test("sentinel: should copy a __proto__ key as data without touching any prototype", () => {
    const hostile = JSON.parse(
      '{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"polluted": "yes"}}, "safe": 1}'
    ) as unknown;

    const output = redact(hostile) as Record<string, unknown>;

    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(Object.hasOwn(output, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(output, "__proto__")?.value).toEqual(
      {
        polluted: "yes",
      }
    );
    expect(output.safe).toBe(1);
    expect("polluted" in output).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(
      (Object.prototype as Record<string, unknown>).polluted
    ).toBeUndefined();
    // The copy still serialises with the key as plain data.
    expect(JSON.parse(JSON.stringify(output))).toEqual(hostile);
  });

  test("should write a placeholder for an object that cannot be read", () => {
    const throwingGetter = {
      get value(): string {
        throw new Error("no");
      },
    };
    const hostileProxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("no");
        },
      }
    );

    expect(redact({ throwingGetter, hostileProxy, kept: 1 })).toEqual({
      throwingGetter: "[Unreadable]",
      hostileProxy: "[Unreadable]",
      kept: 1,
    });
  });

  test("should never change the value it was given", () => {
    const input = {
      password: "p",
      list: ["Bearer abc"],
      nested: { email: "e" },
    };
    const snapshot = structuredClone(input);

    redact(input);

    expect(input).toEqual(snapshot);
  });
});
