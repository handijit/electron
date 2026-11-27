import { describe, expect, test } from "vitest";

import {
  authContract,
  authErrorSchema,
  authStateSchema,
  authUserSchema,
  signInResultSchema,
} from "../../lib/auth/auth-contract";
import AUTH_CHANNELS from "../../lib/shared/auth-channels.constants";
import AUTH_ERROR_CODES from "../../lib/shared/auth-error-codes.constants";
import authErrorMessage from "../../lib/shared/auth-error-message";
import {
  LOADING_STATE,
  SIGNED_OUT_STATE,
} from "../../lib/shared/auth-states.constants";
import AUTH_STATUSES from "../../lib/shared/auth-statuses.constants";
import createAuthError from "../../lib/shared/create-auth-error.helper";
import { isAuthState, isSignInResult } from "../../lib/shared/is-auth-state";
import parseRetryAfter from "../../lib/shared/retry-after.helper";

const USER = { id: "u1", name: "Ayşe", email: "a@x.com" };
const ERROR = createAuthError("OFFLINE");

describe("auth channels", () => {
  test("should list exactly the channels of authContract", () => {
    expect(Object.keys(AUTH_CHANNELS.invoke).sort()).toEqual(
      Object.keys(authContract.invoke).sort()
    );
    expect(Object.keys(AUTH_CHANNELS.events).sort()).toEqual(
      Object.keys(authContract.events).sort()
    );
  });

  test("should give every request no input, and no schema a token field", () => {
    for (const definition of Object.values(authContract.invoke)) {
      expect("input" in definition).toBe(false);
    }
    expect(
      authStateSchema.safeParse({ ...SIGNED_OUT_STATE, accessToken: "x" }).data
    ).toEqual(SIGNED_OUT_STATE);
  });
});

describe("states and codes", () => {
  test("should freeze the two fixed states", () => {
    expect(Object.isFrozen(LOADING_STATE)).toBe(true);
    expect(LOADING_STATE.status).toBe("loading");
    expect(SIGNED_OUT_STATE).toEqual({
      status: "signed-out",
      user: null,
      error: null,
      isRemembered: false,
    });
  });

  test("should list every status and code once", () => {
    expect(AUTH_STATUSES).toEqual([
      "loading",
      "signed-out",
      "signing-in",
      "signed-in",
    ]);
    expect(new Set(AUTH_ERROR_CODES).size).toBe(AUTH_ERROR_CODES.length);
    expect(AUTH_ERROR_CODES).toContain("ACCESS_DENIED");
    expect(AUTH_ERROR_CODES).toContain("ACCOUNT_NOT_ALLOWED");
  });
});

describe("authErrorMessage", () => {
  test("should give every code a sentence", () => {
    for (const code of AUTH_ERROR_CODES) {
      expect(authErrorMessage(code).length).toBeGreaterThan(5);
    }
  });

  test.each([
    [45, "Çok fazla deneme yapıldı. 45 saniye sonra yeniden deneyin."],
    [0.2, "Çok fazla deneme yapıldı. 1 saniye sonra yeniden deneyin."],
    [60, "Çok fazla deneme yapıldı. 1 dakika sonra yeniden deneyin."],
    [61, "Çok fazla deneme yapıldı. 2 dakika sonra yeniden deneyin."],
  ])("should name a wait of %s seconds", (seconds, message) => {
    expect(authErrorMessage("RATE_LIMITED", seconds)).toBe(message);
  });

  test.each([undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY])(
    "should give the plain sentence for a wait of %s",
    (seconds) => {
      expect(authErrorMessage("RATE_LIMITED", seconds)).toBe(
        "Çok fazla deneme yapıldı. Biraz sonra yeniden deneyin."
      );
    }
  );

  test("should ignore a wait for another code", () => {
    expect(authErrorMessage("OFFLINE", 30)).toBe(authErrorMessage("OFFLINE"));
  });
});

describe("createAuthError", () => {
  test("should carry the wait only when there is one", () => {
    expect(createAuthError("OFFLINE")).toEqual({
      code: "OFFLINE",
      message: authErrorMessage("OFFLINE"),
    });
    expect(createAuthError("RATE_LIMITED", 30).retryAfterSeconds).toBe(30);
  });
});

describe("isAuthState and isSignInResult", () => {
  const states: [string, unknown][] = [
    ["the loading state", LOADING_STATE],
    [
      "a signed-in state",
      { status: "signed-in", user: USER, error: null, isRemembered: true },
    ],
    [
      "a user without names",
      {
        status: "signed-in",
        user: { id: "1", name: null, email: null },
        error: null,
        isRemembered: false,
      },
    ],
    [
      "an error with a wait",
      { ...SIGNED_OUT_STATE, error: createAuthError("RATE_LIMITED", 30) },
    ],
    ["an error", { ...SIGNED_OUT_STATE, error: ERROR }],
    ["null", null],
    ["text", "signed-in"],
    ["an unknown status", { ...SIGNED_OUT_STATE, status: "gone" }],
    [
      "a numeric user id",
      { ...SIGNED_OUT_STATE, user: { id: 1, name: null, email: null } },
    ],
    [
      "a user name of another type",
      { ...SIGNED_OUT_STATE, user: { id: "1", name: 5, email: null } },
    ],
    [
      "a user without email",
      { ...SIGNED_OUT_STATE, user: { id: "1", name: null } },
    ],
    [
      "an unknown code",
      { ...SIGNED_OUT_STATE, error: { code: "NOPE", message: "x" } },
    ],
    [
      "a message of another type",
      { ...SIGNED_OUT_STATE, error: { code: "OFFLINE", message: 1 } },
    ],
    [
      "a fractional wait",
      { ...SIGNED_OUT_STATE, error: { ...ERROR, retryAfterSeconds: 1.5 } },
    ],
    [
      "a negative wait",
      { ...SIGNED_OUT_STATE, error: { ...ERROR, retryAfterSeconds: -1 } },
    ],
    ["no isRemembered", { status: "signed-out", user: null, error: null }],
    ["an error that is not an object", { ...SIGNED_OUT_STATE, error: "x" }],
  ];

  test.each(states)("should judge %s as the schema does", (_name, value) => {
    expect(isAuthState(value)).toBe(authStateSchema.safeParse(value).success);
  });

  const results: [string, unknown][] = [
    ["a success", { ok: true, user: USER }],
    ["a success without a user", { ok: true, user: null }],
    ["a failure", { ok: false, error: ERROR }],
    ["a success with a broken user", { ok: true, user: { id: 1 } }],
    ["a failure with a broken error", { ok: false, error: { code: "x" } }],
    ["no ok", { user: USER }],
    ["null", null],
  ];

  test.each(results)("should judge %s as the schema does", (_name, value) => {
    expect(isSignInResult(value)).toBe(
      signInResultSchema.safeParse(value).success
    );
  });

  test("should parse the parts with their own schemas", () => {
    expect(authUserSchema.parse(USER)).toEqual(USER);
    expect(authErrorSchema.parse(ERROR)).toEqual(ERROR);
  });
});

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-11-10T09:00:00Z");

  test.each([
    ["no header", null, undefined],
    ["seconds", " 120 ", 120],
    ["a date ahead", "Tue, 10 Nov 2026 09:00:30 GMT", 30],
    ["a date past", "Tue, 10 Nov 2026 08:00:00 GMT", 0],
    ["a negative number", "-5", undefined],
    ["a fraction", "1.5", undefined],
    ["a date in another form", "2026-11-10T09:00:30Z", undefined],
    [
      "a date-shaped text that is no date",
      "Xyz, 99 Abc 2026 09:00:30 GMT",
      undefined,
    ],
  ])("should read %s", (_name, header, seconds) => {
    expect(parseRetryAfter(header, now)).toBe(seconds);
  });
});
