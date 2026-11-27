import { describe, expect, test } from "vitest";

import toAuthError, { isRefusal } from "../../lib/auth/to-auth-error.helper";
import { TokenRequestError } from "../../lib/auth/token-client";

const status = (
  code: number,
  oauthError?: string,
  retryAfterSeconds?: number
) =>
  new TokenRequestError("status", "x", {
    status: code,
    oauthError,
    retryAfterSeconds,
  });

describe("toAuthError", () => {
  test.each([
    ["something that is not a token error", new Error("x"), "UNEXPECTED"],
    ["no network", new TokenRequestError("network", "x"), "OFFLINE"],
    ["a timeout", new TokenRequestError("timeout", "x"), "OFFLINE"],
    [
      "an unreadable answer",
      new TokenRequestError("invalid", "x"),
      "UNEXPECTED",
    ],
    ["403", status(403), "ACCOUNT_NOT_ALLOWED"],
    ["400 invalid_grant", status(400, "invalid_grant"), "CODE_REFUSED"],
    ["401 without an OAuth error", status(401), "CODE_REFUSED"],
    ["400 invalid_client", status(400, "invalid_client"), "UNEXPECTED"],
    ["400 invalid_request", status(400, "invalid_request"), "UNEXPECTED"],
    ["500", status(500), "UNEXPECTED"],
  ])("should map %s", (_name, error, code) => {
    expect(toAuthError(error).code).toBe(code);
  });

  test("should carry the wait of a 429", () => {
    expect(toAuthError(status(429, undefined, 120))).toEqual({
      code: "RATE_LIMITED",
      message: "Çok fazla deneme yapıldı. 2 dakika sonra yeniden deneyin.",
      retryAfterSeconds: 120,
    });
  });
});

describe("isRefusal", () => {
  test("should count 400, 401 and 403 only", () => {
    expect(isRefusal(status(400))).toBe(true);
    expect(isRefusal(status(401))).toBe(true);
    expect(isRefusal(status(403))).toBe(true);
    expect(isRefusal(status(500))).toBe(false);
    expect(isRefusal(new TokenRequestError("network", "x"))).toBe(false);
    expect(isRefusal(new Error("x"))).toBe(false);
  });
});
