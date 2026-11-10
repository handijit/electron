import { describe, expect, test } from "vitest";

import buildContentSecurityPolicy from "../../lib/main/content-security-policy";

const HASH = "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";

/** Splits a policy into its directives: `{ "script-src": ["'self'", …] }`. */
const directivesOf = (policy: string): Record<string, string[]> =>
  Object.fromEntries(
    policy.split("; ").map((directive) => {
      const [name = "", ...sources] = directive.split(" ");
      return [name, sources];
    })
  );

describe("buildContentSecurityPolicy: production", () => {
  test("should build the strict default policy", () => {
    expect(buildContentSecurityPolicy()).toBe(
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "media-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "frame-src 'none'",
        "worker-src 'self'",
        "base-uri 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join("; ")
    );
  });

  test("should never contain 'unsafe-inline' or 'unsafe-eval'", () => {
    const policies = [
      buildContentSecurityPolicy(),
      buildContentSecurityPolicy({}),
      buildContentSecurityPolicy({
        connectSrc: ["https://api.example.com"],
        scriptHashes: [HASH],
        imgSrc: ["https://images.example.com"],
        fontSrc: ["https://fonts.example.com"],
        mediaSrc: ["https://media.example.com"],
      }),
    ];

    for (const policy of policies) {
      expect(policy).not.toContain("unsafe-inline");
      expect(policy).not.toContain("unsafe-eval");
      expect(policy).not.toContain("*");
      expect(policy).not.toContain("ws:");
    }
  });

  test("should allow inline script by hash only", () => {
    const sha384 = `sha384-${"A".repeat(64)}`;
    const sha512 = `sha512-${"b".repeat(86)}==`;

    const policy = buildContentSecurityPolicy({
      scriptHashes: [HASH, sha384, sha512],
    });

    expect(directivesOf(policy)["script-src"]).toEqual([
      "'self'",
      `'${HASH}'`,
      `'${sha384}'`,
      `'${sha512}'`,
    ]);
    expect(directivesOf(policy)["style-src"]).toEqual(["'self'"]);
  });

  test("should add the extra sources to their own directive only", () => {
    const policy = buildContentSecurityPolicy({
      connectSrc: ["https://api.example.com", "wss://live.example.com"],
      imgSrc: ["https://images.example.com"],
      fontSrc: ["https://fonts.example.com"],
      mediaSrc: ["https://media.example.com"],
    });

    expect(directivesOf(policy)).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'"],
      "img-src": ["'self'", "data:", "https://images.example.com"],
      "font-src": ["'self'", "https://fonts.example.com"],
      "media-src": ["'self'", "https://media.example.com"],
      "connect-src": [
        "'self'",
        "https://api.example.com",
        "wss://live.example.com",
      ],
      "object-src": ["'none'"],
      "frame-src": ["'none'"],
      "worker-src": ["'self'"],
      "base-uri": ["'self'"],
      "form-action": ["'none'"],
      "frame-ancestors": ["'none'"],
    });
  });
});

describe("buildContentSecurityPolicy: malformed input", () => {
  test.each(["connectSrc", "imgSrc", "fontSrc", "mediaSrc"] as const)(
    "should reject a %s entry that could start another directive or header",
    (option) => {
      const malformed = [
        "https://a.example; script-src 'unsafe-inline'",
        "https://a.example, default-src *",
        "https://a.example https://b.example",
        "https://a.example\tdata:",
        "https://a.example\n",
        "https://a.example\r\nSet-Cookie:x=1",
        " ",
        "",
      ];

      for (const source of malformed) {
        expect(() =>
          buildContentSecurityPolicy({ [option]: [source] })
        ).toThrow(
          new TypeError(
            `buildContentSecurityPolicy: ${option} entry ${JSON.stringify(source)} must be a single source without spaces, commas or semicolons`
          )
        );
      }
    }
  );

  test("should reject a malformed entry after well-formed ones", () => {
    expect(() =>
      buildContentSecurityPolicy({
        connectSrc: ["https://api.example.com", "https://x.example;"],
      })
    ).toThrow(TypeError);
  });

  test.each([
    ["a keyword", "'unsafe-inline'"],
    ["a keyword without quotes", "unsafe-eval"],
    ["a quoted hash", `'${HASH}'`],
    [
      "an unknown algorithm",
      "sha1-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    ],
    ["md5", "md5-1B2M2Y8AsgTpgAmY7PhCfg=="],
    ["a hash without a digest", "sha256-"],
    [
      "a digest without an algorithm",
      "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    ],
    ["three padding characters", "sha256-abc==="],
    ["a hash followed by another source", `${HASH} 'unsafe-inline'`],
    ["a hash followed by a directive", `${HASH}; object-src *`],
    ["a hash preceded by a space", ` ${HASH}`],
    ["a hash followed by a line break", `${HASH}\n`],
    [
      "a URL-safe base64 digest",
      "sha256-47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU=",
    ],
    ["an origin", "https://cdn.example.com"],
    ["an empty string", ""],
  ])("should reject a script hash that is %s", (_label, hash) => {
    expect(() => buildContentSecurityPolicy({ scriptHashes: [hash] })).toThrow(
      new TypeError(
        `buildContentSecurityPolicy: scriptHashes entry ${JSON.stringify(hash)} must look like "sha256-<base64>"`
      )
    );
  });

  test("should reject a malformed hash even in development, where hashes are not listed", () => {
    expect(() =>
      buildContentSecurityPolicy({
        scriptHashes: ["'unsafe-eval'"],
        devServerUrl: "http://localhost:5173",
      })
    ).toThrow(TypeError);
  });

  test("should reject a dev server URL that is not a URL", () => {
    expect(() =>
      buildContentSecurityPolicy({ devServerUrl: "localhost" })
    ).toThrow(TypeError);
  });
});

describe("buildContentSecurityPolicy: development", () => {
  test("should relax script and style and allow the dev server's WebSocket", () => {
    const policy = buildContentSecurityPolicy({
      devServerUrl: "http://localhost:5173/",
      connectSrc: ["https://api.example.com"],
    });

    expect(directivesOf(policy)).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:"],
      "font-src": ["'self'"],
      "media-src": ["'self'"],
      "connect-src": [
        "'self'",
        "ws://localhost:5173",
        "https://api.example.com",
      ],
      "object-src": ["'none'"],
      "frame-src": ["'none'"],
      "worker-src": ["'self'"],
      "base-uri": ["'self'"],
      "form-action": ["'none'"],
      "frame-ancestors": ["'none'"],
    });
  });

  test("should never allow eval, even in development", () => {
    const policy = buildContentSecurityPolicy({
      devServerUrl: "http://localhost:5173",
    });

    expect(policy).not.toContain("unsafe-eval");
  });

  test("should list no hashes, which would switch 'unsafe-inline' off again", () => {
    const policy = buildContentSecurityPolicy({
      devServerUrl: "http://localhost:5173",
      scriptHashes: [HASH],
    });

    expect(policy).not.toContain("sha256-");
    expect(directivesOf(policy)["script-src"]).toEqual([
      "'self'",
      "'unsafe-inline'",
    ]);
  });

  test("should use a secure WebSocket for an https dev server", () => {
    const policy = buildContentSecurityPolicy({
      devServerUrl: "https://localhost:5173/app/index.html",
    });

    expect(directivesOf(policy)["connect-src"]).toEqual([
      "'self'",
      "wss://localhost:5173",
    ]);
  });
});
