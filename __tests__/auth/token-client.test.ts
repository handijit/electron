import { describe, expect, test, vi } from "vitest";

import createTokenClient, {
  baseHeaders,
  buildOAuthRevokeRequest,
  buildOAuthTokenRequest,
  parseOAuthTokenResponse,
  requireEndpoint,
  TokenRequestError,
} from "../../lib/auth/token-client";
import type { FetchLike } from "../../lib/shared/fetch-like.type";
import { jsonResponse, tokenAnswer } from "../helpers/auth-fakes";

const idToken = (claims: unknown): string =>
  `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

describe("requireEndpoint", () => {
  test("should accept https and loopback http, normalised", () => {
    expect(requireEndpoint("https://auth.example.com/token", "x")).toBe(
      "https://auth.example.com/token"
    );
    expect(requireEndpoint("http://127.0.0.1:8080/t?a=1", "x")).toBe(
      "http://127.0.0.1:8080/t?a=1"
    );
    expect(requireEndpoint("http://localhost/t", "x")).toBe(
      "http://localhost/t"
    );
    expect(requireEndpoint("http://[::1]/t", "x")).toBe("http://[::1]/t");
  });

  test.each([
    ["not a string", 42],
    ["not a URL", "token"],
    ["plain http", "http://auth.example.com/token"],
    ["credentials", "https://user:pass@auth.example.com/token"],
    ["a user only", "https://user@auth.example.com/token"],
    ["a fragment", "https://auth.example.com/token#x"],
    ["another scheme", "ftp://auth.example.com/token"],
  ])("should refuse %s", (_name, value) => {
    expect(() => requireEndpoint(value, "tokenEndpoint")).toThrow(
      /options\.tokenEndpoint must be an https URL/
    );
  });
});

describe("parseOAuthTokenResponse", () => {
  test("should read an OAuth answer with a user object", () => {
    expect(parseOAuthTokenResponse(tokenAnswer())).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresInSeconds: 3600,
      user: { id: "u1", name: "Ayşe", email: "ayse@example.com" },
    });
  });

  test("should read a numeric user id and missing names as null", () => {
    expect(
      parseOAuthTokenResponse(tokenAnswer({ user: { id: 7 } }))?.user
    ).toEqual({ id: "7", name: null, email: null });
  });

  test.each([
    ["an empty id", { id: "" }],
    ["an id that is not finite", { id: Number.NaN }],
    ["an id of another type", { id: true }],
    ["no id", {}],
  ])("should give no user for %s", (_name, user) => {
    expect(parseOAuthTokenResponse(tokenAnswer({ user }))?.user).toBeNull();
  });

  test("should fall back to the claims of an id_token", () => {
    const tokens = parseOAuthTokenResponse(
      tokenAnswer({
        user: undefined,
        id_token: idToken({ sub: "s-1", name: "Ali", email: "ali@x.com" }),
      })
    );
    expect(tokens?.user).toEqual({
      id: "s-1",
      name: "Ali",
      email: "ali@x.com",
    });
  });

  test.each([
    ["no id_token", undefined],
    ["an id_token that is not a string", 5],
    ["an id_token without a payload", "abc"],
    ["an id_token whose payload is not JSON", "a.%%%.c"],
    ["an id_token whose claims are not an object", idToken([1, 2])],
  ])("should give no user for %s", (_name, value) => {
    expect(
      parseOAuthTokenResponse(tokenAnswer({ user: undefined, id_token: value }))
        ?.user
    ).toBeNull();
  });

  test("should keep no refresh token when none or an empty one is sent", () => {
    expect(
      parseOAuthTokenResponse(tokenAnswer({ refresh_token: undefined }))
        ?.refreshToken
    ).toBeNull();
    expect(
      parseOAuthTokenResponse(tokenAnswer({ refresh_token: "" }))?.refreshToken
    ).toBeNull();
  });

  test.each([undefined, 0, -5, "soon", Number.POSITIVE_INFINITY])(
    "should treat expires_in %s as a short lifetime",
    (value) => {
      expect(
        parseOAuthTokenResponse(tokenAnswer({ expires_in: value }))
          ?.expiresInSeconds
      ).toBe(300);
    }
  );

  test("should read expires_in sent as text", () => {
    expect(
      parseOAuthTokenResponse(tokenAnswer({ expires_in: "120" }))
        ?.expiresInSeconds
    ).toBe(120);
  });

  test.each([
    ["null", null],
    ["an array", [tokenAnswer()]],
    ["text", "token"],
    ["no access token", tokenAnswer({ access_token: undefined })],
    ["an empty access token", tokenAnswer({ access_token: "" })],
  ])("should refuse %s", (_name, body) => {
    expect(parseOAuthTokenResponse(body)).toBeNull();
  });
});

describe("request builders", () => {
  test("should build the code grant with and without a client id", () => {
    const grant = {
      type: "authorization_code",
      code: "c",
      codeVerifier: "v",
      redirectUri: "http://127.0.0.1:5000/callback",
    } as const;
    expect(
      String(buildOAuthTokenRequest({ ...grant, clientId: null }).body)
    ).toBe(
      "grant_type=authorization_code&code=c&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback&code_verifier=v"
    );
    expect(
      String(buildOAuthTokenRequest({ ...grant, clientId: "app" }).body)
    ).toContain("&client_id=app");
  });

  test("should build the refresh grant", () => {
    expect(
      String(
        buildOAuthTokenRequest({
          type: "refresh_token",
          refreshToken: "r",
          clientId: "app",
        }).body
      )
    ).toBe("grant_type=refresh_token&refresh_token=r&client_id=app");
  });

  test("should build the RFC 7009 revocation", () => {
    expect(String(buildOAuthRevokeRequest("r", null).body)).toBe(
      "token=r&token_type_hint=refresh_token"
    );
    expect(String(buildOAuthRevokeRequest("r", "app").body)).toBe(
      "token=r&token_type_hint=refresh_token&client_id=app"
    );
  });

  test("should add the user agent only when there is one", () => {
    expect(baseHeaders(undefined).get("User-Agent")).toBeNull();
    expect(baseHeaders("app/1.0").get("User-Agent")).toBe("app/1.0");
    expect(baseHeaders(undefined, { "X-A": "1" }).get("Accept")).toBe(
      "application/json"
    );
  });
});

describe("createTokenClient", () => {
  const client = (fetch: FetchLike) =>
    createTokenClient({
      fetch,
      userAgent: "app/1.0",
      timeoutMs: 1000,
      now: () => Date.parse("2026-11-10T09:00:00Z"),
    });

  const rejection = async (
    promise: Promise<unknown>
  ): Promise<TokenRequestError> => {
    try {
      await promise;
    } catch (error) {
      return error as TokenRequestError;
    }
    throw new Error("expected a rejection");
  };

  test("should post the body with its headers and read the tokens", async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse(tokenAnswer()));
    const tokens = await client(fetch).requestTokens(
      "https://auth.example.com/token",
      { body: "{}", headers: { "Content-Type": "application/json" } },
      parseOAuthTokenResponse
    );
    expect(tokens.accessToken).toBe("access-1");
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.example.com/token");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("User-Agent")).toBe("app/1.0");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test.each([
    ["a TimeoutError", new DOMException("t", "TimeoutError"), "timeout"],
    ["an AbortError", new DOMException("a", "AbortError"), "timeout"],
    ["a TypeError", new TypeError("fetch failed"), "network"],
    ["a value that is not an error", "nope", "network"],
  ])("should classify %s as %s", async (_name, thrown, kind) => {
    const error = await rejection(
      client(async () => {
        throw thrown;
      }).requestTokens(
        "https://a.example/t",
        { body: "" },
        parseOAuthTokenResponse
      )
    );
    expect(error).toBeInstanceOf(TokenRequestError);
    expect(error.kind).toBe(kind);
    expect(error.status).toBeNull();
    expect(error.oauthError).toBeNull();
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  test("should carry the status and the OAuth error of a refusal", async () => {
    const error = await rejection(
      client(async () =>
        jsonResponse({ error: "invalid_grant" }, 400)
      ).requestTokens(
        "https://a.example/t",
        { body: "" },
        parseOAuthTokenResponse
      )
    );
    expect(error.kind).toBe("status");
    expect(error.status).toBe(400);
    expect(error.oauthError).toBe("invalid_grant");
    expect(error.message).toBe("the token endpoint answered 400");
  });

  test.each([
    ["a body that is not JSON", new Response("<html>", { status: 500 })],
    ["a JSON array", jsonResponse(["x"], 500)],
    ["an error that is not text", jsonResponse({ error: 5 }, 500)],
  ])("should carry no OAuth error for %s", async (_name, response) => {
    const error = await rejection(
      client(async () => response).requestTokens(
        "https://a.example/t",
        { body: "" },
        parseOAuthTokenResponse
      )
    );
    expect(error.status).toBe(500);
    expect(error.oauthError).toBeNull();
  });

  test("should read Retry-After of a 429", async () => {
    const error = await rejection(
      client(async () =>
        jsonResponse({}, 429, { "Retry-After": "90" })
      ).requestTokens(
        "https://a.example/t",
        { body: "" },
        parseOAuthTokenResponse
      )
    );
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(90);
  });

  test("should refuse an answer the parser refuses or throws on", async () => {
    const refused = await rejection(
      client(async () => jsonResponse({})).requestTokens(
        "https://a.example/t",
        { body: "" },
        () => null
      )
    );
    expect(refused.kind).toBe("invalid");
    const thrown = await rejection(
      client(async () => jsonResponse({})).requestTokens(
        "https://a.example/t",
        { body: "" },
        () => {
          throw new Error("bad");
        }
      )
    );
    expect(thrown.kind).toBe("invalid");
  });

  test("should revoke whatever the server answers, failing only without an answer", async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({}, 500));
    await expect(
      client(fetch).revoke("https://a.example/revoke", { body: "x" }, 500)
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const error = await rejection(
      client(async () => {
        throw new TypeError("offline");
      }).revoke("https://a.example/revoke", { body: "x" }, 500)
    );
    expect(error.kind).toBe("network");
  });
});
