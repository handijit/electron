import { describe, expect, test } from "vitest";

import {
  codeChallengeOf,
  createCodeVerifier,
  createState,
  loopbackRedirectUri,
} from "../../lib/auth/pkce.helper";

describe("pkce helpers", () => {
  test("should make a 43 character base64url verifier, fresh every time", () => {
    const first = createCodeVerifier();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createCodeVerifier()).not.toBe(first);
  });

  test("should compute the S256 challenge of RFC 7636 appendix B", () => {
    expect(codeChallengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  test("should make a 22 character state", () => {
    expect(createState()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test("should write the loopback redirect address for a valid port", () => {
    expect(loopbackRedirectUri(1024)).toBe("http://127.0.0.1:1024/callback");
    expect(loopbackRedirectUri(65535)).toBe("http://127.0.0.1:65535/callback");
  });

  test.each([1023, 65536, 1.5, Number.NaN, 0])(
    "should refuse the port %s",
    (port) => {
      expect(() => loopbackRedirectUri(port)).toThrow(RangeError);
    }
  );
});
