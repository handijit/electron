import { describe, expect, test } from "vitest";

import buildContentSecurityPolicy from "../../lib/main/content-security-policy";

const HASH = "sha256-AbC+/9=";

describe("buildContentSecurityPolicy", () => {
  test("should build the strict production policy by default", () => {
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

  test("should add the given sources and script hashes", () => {
    const policy = buildContentSecurityPolicy({
      connectSrc: ["https://api.example.com"],
      scriptHashes: [HASH],
      imgSrc: ["https://img.example.com"],
      fontSrc: ["https://fonts.example.com"],
      mediaSrc: ["blob:"],
    });
    expect(policy).toContain(`script-src 'self' '${HASH}'`);
    expect(policy).toContain("connect-src 'self' https://api.example.com");
    expect(policy).toContain("img-src 'self' data: https://img.example.com");
    expect(policy).toContain("font-src 'self' https://fonts.example.com");
    expect(policy).toContain("media-src 'self' blob:");
    expect(policy).not.toContain("unsafe-inline");
  });

  test("should relax script and style for the dev server and drop the hashes", () => {
    const policy = buildContentSecurityPolicy({
      scriptHashes: [HASH],
      devServerUrl: "http://localhost:5173",
    });
    expect(policy).toContain("script-src 'self' 'unsafe-inline';");
    expect(policy).toContain("style-src 'self' 'unsafe-inline';");
    expect(policy).toContain("connect-src 'self' ws://localhost:5173");
    expect(policy).not.toContain(HASH);
  });

  test.each([
    ["connectSrc", { connectSrc: ["https://a.com; script-src *"] }],
    ["imgSrc", { imgSrc: ["a b"] }],
    ["fontSrc", { fontSrc: ["a,b"] }],
    ["mediaSrc", { mediaSrc: [""] }],
  ])(
    "should refuse a %s entry that could start a new directive",
    (name, options) => {
      expect(() => buildContentSecurityPolicy(options)).toThrow(
        new RegExp(`buildContentSecurityPolicy: ${name} entry`)
      );
    }
  );

  test("should refuse a script hash that is not one", () => {
    expect(() =>
      buildContentSecurityPolicy({ scriptHashes: ["'unsafe-eval'"] })
    ).toThrow(TypeError);
  });
});
