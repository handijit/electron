import { createServer } from "node:net";

import { app, net, shell } from "electron";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { codeChallengeOf } from "@handijitcom/api-client/pkce";
import { createSecretStore } from "@handijitcom/electron/main";

import createAuth from "../../lib/auth/create-auth";
import { SESSION_SECRET_NAME } from "../../lib/auth/session-vault";
import type { Auth, AuthOptions } from "../../lib/auth/types";
import type { FetchLike } from "../../lib/shared/fetch-like.type";
import type { AuthState } from "../../lib/types";
import {
  createFakeSecretStore,
  flush,
  jsonResponse,
  rawRequest,
  tokenAnswer,
} from "../helpers/auth-fakes";

vi.mock("electron", () => ({
  app: { whenReady: vi.fn(), focus: vi.fn() },
  shell: { openExternal: vi.fn() },
  net: { fetch: vi.fn() },
}));

vi.mock("@handijitcom/electron/main", () => ({
  createSecretStore: vi.fn(),
}));

const AUTHORIZE = "https://auth.example.com/authorize?audience=api";
const TOKEN = "https://auth.example.com/token";
const REVOKE = "https://auth.example.com/revoke";
const API = "https://auth.example.com/api/me";
const USER = { id: "u1", name: "Ayşe", email: "ayse@example.com" };

type Route = (url: string, init: RequestInit | undefined) => Promise<Response>;

const created: Auth[] = [];

/** The answer the browser brings back for an authorization page address. */
const callbackOf = (authorize: string, query?: string): Promise<unknown> => {
  const url = new URL(authorize);
  const redirect = new URL(url.searchParams.get("redirect_uri") as string);
  const state = url.searchParams.get("state") as string;
  return rawRequest(
    Number(redirect.port),
    `/callback?${query ?? `code=the-code&state=${state}`}`
  );
};

const storedSession = (refreshToken = "stored-refresh", user: unknown = USER) =>
  JSON.stringify({ v: 1, refreshToken, user });

const setup = (
  overrides: Partial<AuthOptions> = {},
  initial: Record<string, string> = {}
) => {
  const secretStore = createFakeSecretStore(initial);
  const logger = { info: vi.fn(), warn: vi.fn() };
  const routes: { token: Route; refresh: Route; revoke: Route; api: Route } = {
    token: async () => jsonResponse(tokenAnswer()),
    refresh: async () =>
      jsonResponse(
        tokenAnswer({ access_token: "access-2", refresh_token: "refresh-2" })
      ),
    revoke: async () => new Response(null, { status: 200 }),
    api: async () => new Response("ok"),
  };
  const server = vi.fn<FetchLike>(async (url, init) => {
    if (url.startsWith(REVOKE)) return routes.revoke(url, init);
    if (url.startsWith(TOKEN)) {
      return String(init?.body).includes("grant_type=refresh_token")
        ? routes.refresh(url, init)
        : routes.token(url, init);
    }
    return routes.api(url, init);
  });
  const openBrowser = vi.fn(async (url: string) => {
    await callbackOf(url);
  });
  const auth = createAuth({
    authorizeUrl: AUTHORIZE,
    tokenEndpoint: TOKEN,
    fetch: server,
    openBrowser,
    secretStore,
    logger,
    ...overrides,
  });
  created.push(auth);
  const states: AuthState[] = [];
  auth.onChange((state) => states.push(state));
  const callsTo = (prefix: string) =>
    server.mock.calls.filter(([url]) => url.startsWith(prefix));
  const bodyOf = (call: Parameters<FetchLike> | undefined) =>
    new URLSearchParams(String(call?.[1]?.body));
  return {
    auth,
    secretStore,
    logger,
    routes,
    server,
    openBrowser,
    states,
    callsTo,
    bodyOf,
  };
};

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

beforeEach(() => {
  vi.mocked(app.whenReady).mockResolvedValue(undefined);
  vi.mocked(createSecretStore).mockReturnValue(createFakeSecretStore());
});

afterEach(async () => {
  await Promise.all(created.splice(0).map((auth) => auth.dispose()));
});

describe("createAuth options", () => {
  const base = { authorizeUrl: AUTHORIZE, tokenEndpoint: TOKEN };

  test.each([
    ["authorizeUrl", { authorizeUrl: "http://auth.example.com/a" }],
    ["tokenEndpoint", { tokenEndpoint: "nope" }],
    ["refreshEndpoint", { refreshEndpoint: "https://u:p@auth.example.com/r" }],
    ["revokeEndpoint", { revokeEndpoint: "https://auth.example.com/r#x" }],
  ])("should refuse a wrong %s", (option, override) => {
    expect(() => createAuth({ ...base, ...override })).toThrow(
      new RegExp(`options\\.${option} must be an https URL`)
    );
  });

  test.each([
    ["signInTimeoutMs", { signInTimeoutMs: 0 }],
    ["requestTimeoutMs", { requestTimeoutMs: Number.NaN }],
  ])("should refuse a wrong %s", (option, override) => {
    expect(() => createAuth({ ...base, ...override })).toThrow(
      new RegExp(`options\\.${option} must be a number of milliseconds`)
    );
  });

  test.each([["not a url"], ["ftp://files.example.com"]])(
    "should refuse the api origin %s",
    (origin) => {
      expect(() => createAuth({ ...base, apiOrigins: [origin] })).toThrow(
        /options\.apiOrigins must hold http\(s\) origins/
      );
    }
  );
});

describe("restore", () => {
  test("should be signed out without a stored session, in the default store", async () => {
    const store = createFakeSecretStore();
    vi.mocked(createSecretStore).mockReturnValue(store);
    const auth = createAuth({ authorizeUrl: AUTHORIZE, tokenEndpoint: TOKEN });
    created.push(auth);
    expect(auth.getState().status).toBe("loading");
    await expect(auth.restore()).resolves.toMatchObject({
      status: "signed-out",
      error: null,
    });
    await auth.restore();
    expect(app.whenReady).toHaveBeenCalledTimes(1);
    expect(store.get).toHaveBeenCalledWith(SESSION_SECRET_NAME);
  });

  test("should show a stored session at once and renew it in the background", async () => {
    const { auth, states, secretStore, callsTo, bodyOf } = setup(
      {},
      { [SESSION_SECRET_NAME]: storedSession() }
    );
    await expect(auth.restore()).resolves.toEqual({
      status: "signed-in",
      user: USER,
      error: null,
      isRemembered: true,
    });
    await flush();
    expect(bodyOf(callsTo(TOKEN)[0]).get("refresh_token")).toBe(
      "stored-refresh"
    );
    expect(states).toHaveLength(2);
    expect(
      JSON.parse(secretStore.values.get(SESSION_SECRET_NAME) as string)
        .refreshToken
    ).toBe("refresh-2");
    await expect(auth.getAccessToken()).resolves.toBe("access-2");
  });

  test("should sign out when the server refuses the stored session", async () => {
    const { auth, routes, secretStore } = setup(
      {},
      { [SESSION_SECRET_NAME]: storedSession() }
    );
    routes.refresh = async () => jsonResponse({ error: "invalid_grant" }, 400);
    await auth.restore();
    await flush();
    expect(auth.getState()).toMatchObject({
      status: "signed-out",
      error: { code: "SESSION_ENDED" },
    });
    expect(secretStore.values.has(SESSION_SECRET_NAME)).toBe(false);
  });

  test("should stay signed in when the server cannot be reached", async () => {
    const { auth, routes, logger } = setup(
      {},
      { [SESSION_SECRET_NAME]: storedSession() }
    );
    routes.refresh = async () => {
      throw new TypeError("offline");
    };
    await auth.restore();
    await flush();
    expect(auth.getState().status).toBe("signed-in");
    expect(logger.info).toHaveBeenCalledWith(
      "The stored session could not be checked with the server; staying signed in",
      { reason: "the token endpoint could not be reached" }
    );
  });

  test("should stay quiet without a logger", async () => {
    const { auth, routes } = setup(
      { logger: undefined },
      { [SESSION_SECRET_NAME]: storedSession() }
    );
    routes.refresh = async () => {
      throw new TypeError("offline");
    };
    auth.onChange(() => {
      throw new Error("listener");
    });
    await auth.restore();
    await flush();
    expect(auth.getState().status).toBe("signed-in");
  });

  test("should end a session the refresh shows not allowed", async () => {
    const { auth } = setup(
      { isAccountAllowed: (tokens) => tokens.accessToken !== "access-2" },
      { [SESSION_SECRET_NAME]: storedSession() }
    );
    await auth.restore();
    await flush();
    expect(auth.getState().error?.code).toBe("ACCOUNT_NOT_ALLOWED");
  });

  test("should keep the user and the refresh token a refresh does not send", async () => {
    const { auth, routes, secretStore } = setup(
      { refreshEndpoint: "https://auth.example.com/token?refresh=1" },
      { [SESSION_SECRET_NAME]: storedSession() }
    );
    routes.refresh = async () =>
      jsonResponse({ access_token: "access-2", expires_in: 60 });
    await auth.restore();
    await flush();
    expect(auth.getState().user).toEqual(USER);
    expect(
      JSON.parse(secretStore.values.get(SESSION_SECRET_NAME) as string)
        .refreshToken
    ).toBe("stored-refresh");
  });
});

describe("signIn", () => {
  test("should sign in with the browser, PKCE and the loopback address", async () => {
    const onCallback = vi.fn();
    const { auth, openBrowser, callsTo, bodyOf, states, secretStore } = setup({
      clientId: "desktop-app",
      scope: "openid profile",
      authorizeParams: { product: "notes", response_type: "token" },
      onCallback,
    });
    await expect(auth.signIn()).resolves.toEqual({ ok: true, user: USER });

    const authorize = new URL(openBrowser.mock.calls[0]?.[0] as string);
    expect(authorize.origin + authorize.pathname).toBe(
      "https://auth.example.com/authorize"
    );
    const query = authorize.searchParams;
    expect(query.get("audience")).toBe("api");
    expect(query.get("product")).toBe("notes");
    expect(query.get("response_type")).toBe("code");
    expect(query.get("client_id")).toBe("desktop-app");
    expect(query.get("scope")).toBe("openid profile");
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("redirect_uri")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/
    );

    const exchange = bodyOf(callsTo(TOKEN)[0]);
    expect(exchange.get("grant_type")).toBe("authorization_code");
    expect(exchange.get("code")).toBe("the-code");
    expect(exchange.get("redirect_uri")).toBe(query.get("redirect_uri"));
    expect(exchange.get("client_id")).toBe("desktop-app");
    await expect(
      codeChallengeOf(exchange.get("code_verifier") as string)
    ).resolves.toBe(query.get("code_challenge"));

    expect(onCallback).toHaveBeenCalledTimes(1);
    expect(states.map((state) => state.status)).toEqual([
      "signed-out",
      "signing-in",
      "signed-in",
    ]);
    expect(auth.getState().isRemembered).toBe(true);
    expect(secretStore.values.has(SESSION_SECRET_NAME)).toBe(true);
    await expect(auth.getAccessToken()).resolves.toBe("access-1");

    // Already signed in: no second trip to the browser.
    await expect(auth.signIn()).resolves.toEqual({ ok: true, user: USER });
    expect(openBrowser).toHaveBeenCalledTimes(1);
  });

  test("should sign in through shell.openExternal and net.fetch by default", async () => {
    vi.mocked(shell.openExternal).mockImplementation(async (url) => {
      await callbackOf(url);
    });
    vi.mocked(net.fetch).mockImplementation(async () =>
      jsonResponse(tokenAnswer())
    );
    const auth = createAuth({
      authorizeUrl: AUTHORIZE,
      tokenEndpoint: TOKEN,
      secretStore: createFakeSecretStore(),
    });
    created.push(auth);
    await expect(auth.signIn()).resolves.toMatchObject({ ok: true });
    expect(net.fetch).toHaveBeenCalledWith(TOKEN, expect.any(Object));
  });

  test("should keep a session without a refresh token in memory only", async () => {
    const { auth, routes, secretStore } = setup(
      {},
      { [SESSION_SECRET_NAME]: storedSession() }
    );
    routes.refresh = async () => jsonResponse({ error: "invalid_grant" }, 400);
    await auth.restore();
    await flush();
    routes.token = async () =>
      jsonResponse(tokenAnswer({ refresh_token: undefined, user: undefined }));
    await expect(auth.signIn()).resolves.toEqual({ ok: true, user: null });
    expect(auth.getState()).toMatchObject({
      status: "signed-in",
      isRemembered: false,
    });
    expect(secretStore.values.has(SESSION_SECRET_NAME)).toBe(false);

    // A 401 cannot be repaired without a refresh token.
    routes.api = async () => new Response("no", { status: 401 });
    const response = await auth.fetch(API);
    expect(response.status).toBe(401);
  });

  test("should refuse an account the program does not allow and revoke it", async () => {
    const { auth, callsTo, bodyOf } = setup({
      revokeEndpoint: REVOKE,
      isAccountAllowed: () => false,
    });
    await expect(auth.signIn()).resolves.toMatchObject({
      ok: false,
      error: { code: "ACCOUNT_NOT_ALLOWED" },
    });
    const revocation = bodyOf(callsTo(REVOKE)[0]);
    expect(revocation.get("token")).toBe("refresh-1");
    expect(revocation.get("token_type_hint")).toBe("refresh_token");
    expect(auth.getState().error?.code).toBe("ACCOUNT_NOT_ALLOWED");
  });

  test("should report a refused code", async () => {
    const { auth, routes, logger } = setup();
    routes.token = async () => jsonResponse({ error: "invalid_grant" }, 400);
    await expect(auth.signIn()).resolves.toMatchObject({
      ok: false,
      error: { code: "CODE_REFUSED" },
    });
    expect(auth.getState()).toMatchObject({
      status: "signed-out",
      error: { code: "CODE_REFUSED" },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "The sign-in code could not be exchanged",
      { reason: "the token endpoint answered 400" }
    );
  });

  test("should report a declined consent, and start again on a new listener", async () => {
    const { auth, openBrowser } = setup();
    openBrowser.mockImplementationOnce(async (url) => {
      const state = new URL(url).searchParams.get("state");
      await callbackOf(url, `error=access_denied&state=${state}`);
    });
    await expect(auth.signIn()).resolves.toMatchObject({
      ok: false,
      error: { code: "ACCESS_DENIED" },
    });
    await expect(auth.signIn()).resolves.toMatchObject({ ok: true });
    const ports = openBrowser.mock.calls.map(
      ([url]) =>
        new URL(new URL(url).searchParams.get("redirect_uri") as string).port
    );
    expect(ports[0]).not.toBe(ports[1]);
  });

  test("should give up when the browser does not come back in time", async () => {
    const { auth, openBrowser } = setup({ signInTimeoutMs: 30 });
    openBrowser.mockImplementation(async () => undefined);
    await expect(auth.signIn()).resolves.toMatchObject({
      ok: false,
      error: { code: "SIGN_IN_TIMED_OUT" },
    });
  });

  test("should report a browser that cannot be opened", async () => {
    const { auth, openBrowser, logger } = setup();
    openBrowser.mockRejectedValue(new Error("no browser"));
    await expect(auth.signIn()).resolves.toMatchObject({
      ok: false,
      error: { code: "BROWSER_NOT_OPENED" },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "The browser could not be opened",
      {
        reason: "no browser",
      }
    );
  });

  test("should give up after the listener refused too many requests", async () => {
    const { auth, openBrowser } = setup();
    openBrowser.mockImplementation(async (url) => {
      const port = Number(
        new URL(new URL(url).searchParams.get("redirect_uri") as string).port
      );
      for (let i = 0; i < 20; i++) await rawRequest(port, "/favicon.ico");
    });
    await expect(auth.signIn()).resolves.toMatchObject({
      ok: false,
      error: { code: "STATE_MISMATCH" },
    });
  });

  test("should report a listener that cannot start", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen({ host: "127.0.0.1", port: 0 }, resolve);
    });
    const address = blocker.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const { auth, logger, openBrowser } = setup({ port });
    await expect(auth.signIn()).resolves.toMatchObject({
      ok: false,
      error: { code: "LISTENER_FAILED" },
    });
    expect(openBrowser).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "The loopback listener could not be started",
      expect.any(Object)
    );
    await new Promise((resolve) => blocker.close(resolve));
  });

  test("should reopen the same page for a second call and end on a cancel", async () => {
    const { auth, openBrowser, states } = setup();
    const browserOpened = gate();
    openBrowser.mockImplementation(async () => {
      browserOpened.open();
    });
    const first = auth.signIn();
    await browserOpened.opened;
    const second = auth.signIn();
    expect(second).toBe(first);
    expect(openBrowser).toHaveBeenCalledTimes(2);
    expect(openBrowser.mock.calls[1]?.[0]).toBe(openBrowser.mock.calls[0]?.[0]);
    auth.cancelSignIn();
    await expect(first).resolves.toMatchObject({
      ok: false,
      error: { code: "SIGN_IN_CANCELLED" },
    });
    expect(states.at(-1)).toMatchObject({ status: "signed-out", error: null });
  });

  test("should not open the browser for a sign-in cancelled at once", async () => {
    const { auth, openBrowser } = setup();
    const signing = auth.signIn();
    auth.cancelSignIn();
    await expect(signing).resolves.toMatchObject({
      error: { code: "SIGN_IN_CANCELLED" },
    });
    expect(openBrowser).not.toHaveBeenCalled();
    expect(auth.getState().status).toBe("signed-out");
  });

  test("should not open the browser for a sign-in cancelled while the listener starts", async () => {
    const { auth, openBrowser } = setup();
    let again: Promise<unknown> | undefined;
    auth.onChange((state) => {
      if (state.status !== "signing-in") return;
      again = auth.signIn();
      auth.cancelSignIn();
    });
    const signing = auth.signIn();
    await expect(signing).resolves.toMatchObject({
      error: { code: "SIGN_IN_CANCELLED" },
    });
    expect(again).toBe(signing);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  test("should revoke a session issued after a cancel", async () => {
    const { auth, routes, callsTo } = setup({ revokeEndpoint: REVOKE });
    const exchanging = gate();
    let answer!: () => void;
    routes.token = () =>
      new Promise<Response>((resolve) => {
        answer = () => resolve(jsonResponse(tokenAnswer()));
        exchanging.open();
      });
    const signing = auth.signIn();
    await exchanging.opened;
    auth.cancelSignIn();
    answer();
    await expect(signing).resolves.toMatchObject({
      error: { code: "SIGN_IN_CANCELLED" },
    });
    expect(callsTo(REVOKE)).toHaveLength(1);
    expect(auth.getState().status).toBe("signed-out");
  });

  test("should answer a cancel when the exchange fails after it", async () => {
    const { auth, routes } = setup();
    const exchanging = gate();
    let fail!: () => void;
    routes.token = () =>
      new Promise<Response>((_resolve, reject) => {
        fail = () => reject(new TypeError("offline"));
        exchanging.open();
      });
    const signing = auth.signIn();
    await exchanging.opened;
    auth.cancelSignIn();
    fail();
    await expect(signing).resolves.toMatchObject({
      error: { code: "SIGN_IN_CANCELLED" },
    });
  });

  test("should drop a session that a sign-out overtook while it was stored", async () => {
    const { auth, secretStore, callsTo } = setup({ revokeEndpoint: REVOKE });
    const saving = gate();
    let release!: () => void;
    vi.mocked(secretStore.set).mockImplementationOnce(
      (name, value) =>
        new Promise<void>((resolve) => {
          release = () => {
            secretStore.values.set(name, value);
            resolve();
          };
          saving.open();
        })
    );
    const signing = auth.signIn();
    await saving.opened;
    const signingOut = auth.signOut();
    await flush();
    release();
    await expect(signing).resolves.toMatchObject({
      error: { code: "SIGN_IN_CANCELLED" },
    });
    await signingOut;
    expect(auth.getState().status).toBe("signed-out");
    expect(secretStore.values.has(SESSION_SECRET_NAME)).toBe(false);
    expect(
      callsTo(REVOKE).every(
        ([, init]) =>
          new URLSearchParams(String(init?.body)).get("token") === "refresh-1"
      )
    ).toBe(true);
  });

  test("should survive a callback hook and a state listener that throw", async () => {
    const { auth, logger } = setup({
      onCallback: () => {
        throw new Error("hook");
      },
    });
    auth.onChange(() => {
      throw new Error("listener");
    });
    await expect(auth.signIn()).resolves.toMatchObject({ ok: true });
    expect(logger.warn).toHaveBeenCalledWith("The callback hook failed", {
      reason: "hook",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "A listener of the session state failed",
      { reason: "listener" }
    );
  });

  test("should speak the server's own dialect through the builders", async () => {
    const { auth, callsTo } = setup({
      revokeEndpoint: REVOKE,
      buildTokenRequest: (grant) => ({
        body: JSON.stringify(grant),
        headers: { "Content-Type": "application/json" },
      }),
      buildRevokeRequest: (token) => ({ body: JSON.stringify({ token }) }),
      parseTokenResponse: (body) => {
        const value = body as Record<string, string>;
        return {
          accessToken: value.access_token as string,
          refreshToken: "custom-refresh",
          expiresInSeconds: 60,
          user: { id: "c1", name: null, email: null },
        };
      },
    });
    await expect(auth.signIn()).resolves.toEqual({
      ok: true,
      user: { id: "c1", name: null, email: null },
    });
    const exchange = callsTo(TOKEN)[0]?.[1];
    expect(JSON.parse(String(exchange?.body))).toMatchObject({
      type: "authorization_code",
      code: "the-code",
      clientId: null,
    });
    expect((exchange?.headers as Headers).get("Content-Type")).toBe(
      "application/json"
    );
    await auth.signOut();
    expect(String(callsTo(REVOKE)[0]?.[1]?.body)).toBe(
      '{"token":"custom-refresh"}'
    );
  });
});

describe("getAccessToken and fetch", () => {
  const signedIn = async (overrides: Partial<AuthOptions> = {}) => {
    const context = setup(overrides);
    await context.auth.signIn();
    return context;
  };

  test("should answer null while nobody is signed in", async () => {
    const { auth } = setup();
    await expect(auth.getAccessToken()).resolves.toBeNull();
  });

  test("should renew an expired token before handing it out", async () => {
    const { auth, routes } = await signedIn();
    routes.token = async () => jsonResponse(tokenAnswer());
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 3600 * 1000);
    await expect(auth.getAccessToken()).resolves.toBe("access-2");
  });

  test("should answer null when the renewal fails", async () => {
    const { auth, routes, logger } = await signedIn();
    routes.refresh = async () => {
      throw new TypeError("offline");
    };
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3600 * 1000);
    await expect(auth.getAccessToken()).resolves.toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      "The session could not be renewed",
      { reason: "the token endpoint could not be reached" }
    );
    expect(auth.getState().status).toBe("signed-in");
  });

  test("should answer null when a sign-out overtakes the renewal", async () => {
    const { auth } = await signedIn();
    let isDone = false;
    auth.onChange((state) => {
      if (isDone || state.status !== "signed-in") return;
      isDone = true;
      void auth.signOut();
    });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3600 * 1000);
    await expect(auth.getAccessToken()).resolves.toBeNull();
  });

  test("should send the token only to the api origins", async () => {
    const { auth } = await signedIn();
    await expect(auth.fetch("https://evil.example/steal")).rejects.toThrow(
      TypeError
    );
    await expect(auth.fetch("not a url")).rejects.toThrow(
      /is not on an origin of options\.apiOrigins/
    );
  });

  test("should send the token, the user agent and the caller's headers", async () => {
    const { auth, server } = await signedIn({
      userAgent: "notes/1.0",
      apiOrigins: ["https://api.example.com/v1"],
    });
    const response = await auth.fetch("https://api.example.com/v1/items", {
      headers: { "X-Trace": "1" },
    });
    expect(await response.text()).toBe("ok");
    const headers = server.mock.calls.at(-1)?.[1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer access-1");
    expect(headers.get("User-Agent")).toBe("notes/1.0");
    expect(headers.get("X-Trace")).toBe("1");

    await auth.fetch("https://api.example.com/v1/items", {
      headers: { "User-Agent": "own" },
    });
    expect(
      (server.mock.calls.at(-1)?.[1]?.headers as Headers).get("User-Agent")
    ).toBe("own");
  });

  test("should send no token while signed out and hand back the 401", async () => {
    const { auth, routes, server } = setup();
    routes.api = async () => new Response("no", { status: 401 });
    const response = await auth.fetch(API);
    expect(response.status).toBe(401);
    expect(
      (server.mock.calls.at(-1)?.[1]?.headers as Headers).has("Authorization")
    ).toBe(false);
  });

  test("should renew once and send again on a 401", async () => {
    const { auth, routes, server } = await signedIn();
    routes.api = vi
      .fn<Route>()
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(new Response("fresh"));
    const response = await auth.fetch(API, { method: "POST", body: "x" });
    expect(await response.text()).toBe("fresh");
    expect(
      (server.mock.calls.at(-1)?.[1]?.headers as Headers).get("Authorization")
    ).toBe("Bearer access-2");
  });

  test("should not send a stream body twice", async () => {
    const { auth, routes, callsTo } = await signedIn();
    routes.api = async () => new Response("expired", { status: 401 });
    const response = await auth.fetch(API, {
      method: "POST",
      body: new ReadableStream(),
    });
    expect(response.status).toBe(401);
    expect(callsTo(TOKEN)).toHaveLength(1);
  });

  test.each([
    ["refused", async () => jsonResponse({ error: "invalid_grant" }, 401)],
    [
      "unreachable",
      async () => {
        throw new TypeError("offline");
      },
    ],
  ])(
    "should hand back the 401 when the renewal is %s",
    async (_name, refresh) => {
      const { auth, routes } = await signedIn();
      routes.api = async () => new Response("expired", { status: 401 });
      routes.refresh = refresh;
      const response = await auth.fetch(API);
      expect(response.status).toBe(401);
    }
  );

  test("should hand back the 401 when a sign-out overtakes the renewal", async () => {
    const { auth, routes } = await signedIn();
    routes.api = async () => new Response("expired", { status: 401 });
    let isDone = false;
    auth.onChange((state) => {
      if (isDone || state.status !== "signed-in") return;
      isDone = true;
      void auth.signOut();
    });
    const response = await auth.fetch(API);
    expect(response.status).toBe(401);
  });
});

describe("signOut", () => {
  test("should wipe the session and revoke it", async () => {
    const { auth, secretStore, callsTo } = setup({ revokeEndpoint: REVOKE });
    await auth.signIn();
    await auth.signOut();
    expect(auth.getState()).toMatchObject({
      status: "signed-out",
      error: null,
    });
    expect(secretStore.values.has(SESSION_SECRET_NAME)).toBe(false);
    expect(callsTo(REVOKE)).toHaveLength(1);
    await expect(auth.getAccessToken()).resolves.toBeNull();
  });

  test("should not revoke without a revocation endpoint", async () => {
    const { auth, server } = setup();
    await auth.signIn();
    const calls = server.mock.calls.length;
    await auth.signOut();
    expect(server.mock.calls.length).toBe(calls);
  });

  test("should log a revocation the server never answered", async () => {
    const { auth, routes, logger } = setup({ revokeEndpoint: REVOKE });
    routes.revoke = async () => {
      throw new TypeError("offline");
    };
    await auth.signIn();
    await auth.signOut();
    expect(logger.info).toHaveBeenCalledWith(
      "The server could not be told that the session is over",
      { reason: "the token endpoint could not be reached" }
    );
  });

  test("should change nothing when nobody is signed in", async () => {
    const { auth, states } = setup();
    await auth.restore();
    await auth.signOut();
    expect(states).toHaveLength(1);
  });

  test("should let a renewal that answers after it revoke what it got", async () => {
    const { auth, routes, callsTo } = setup(
      { revokeEndpoint: REVOKE },
      { [SESSION_SECRET_NAME]: storedSession() }
    );
    const refreshing = gate();
    let answer!: () => void;
    routes.refresh = () =>
      new Promise<Response>((resolve) => {
        answer = () =>
          resolve(jsonResponse(tokenAnswer({ refresh_token: "refresh-2" })));
        refreshing.open();
      });
    await auth.restore();
    await refreshing.opened;
    const signingOut = auth.signOut();
    await flush();
    answer();
    await signingOut;
    const revoked = callsTo(REVOKE).map(([, init]) =>
      new URLSearchParams(String(init?.body)).get("token")
    );
    expect(revoked).toEqual(["refresh-2"]);
    expect(auth.getState().status).toBe("signed-out");
  });

  test("should ignore a refusal that answers after it", async () => {
    const { auth, routes } = setup(
      {},
      { [SESSION_SECRET_NAME]: storedSession() }
    );
    const refreshing = gate();
    let answer!: () => void;
    routes.refresh = () =>
      new Promise<Response>((resolve) => {
        answer = () => resolve(jsonResponse({}, 401));
        refreshing.open();
      });
    await auth.restore();
    await refreshing.opened;
    const signingOut = auth.signOut();
    await flush();
    answer();
    await signingOut;
    expect(auth.getState()).toMatchObject({
      status: "signed-out",
      error: null,
    });
  });

  test("should revoke the old token when the pending renewal got no answer", async () => {
    const { auth, routes, callsTo } = setup(
      { revokeEndpoint: REVOKE },
      { [SESSION_SECRET_NAME]: storedSession() }
    );
    const refreshing = gate();
    let fail!: () => void;
    routes.refresh = () =>
      new Promise<Response>((_resolve, reject) => {
        fail = () => reject(new TypeError("offline"));
        refreshing.open();
      });
    await auth.restore();
    await refreshing.opened;
    const signingOut = auth.signOut();
    await flush();
    fail();
    await signingOut;
    expect(
      new URLSearchParams(String(callsTo(REVOKE)[0]?.[1]?.body)).get("token")
    ).toBe("stored-refresh");
  });

  test("should cancel a waiting sign-in", async () => {
    const { auth, openBrowser } = setup();
    const browserOpened = gate();
    openBrowser.mockImplementation(async () => {
      browserOpened.open();
    });
    const signing = auth.signIn();
    await browserOpened.opened;
    await auth.signOut();
    await expect(signing).resolves.toMatchObject({
      error: { code: "SIGN_IN_CANCELLED" },
    });
  });
});

describe("attach, handlers and dispose", () => {
  test("should broadcast every change and bring the window up on the callback", async () => {
    const { auth } = setup();
    const host = { emitter: { broadcast: vi.fn() }, showWindow: vi.fn() };
    const detach = auth.attach(host);
    await auth.restore();
    expect(host.emitter.broadcast).toHaveBeenCalledWith(
      "auth:changed",
      expect.objectContaining({ status: "signed-out" })
    );
    await auth.signIn();
    expect(host.showWindow).toHaveBeenCalledTimes(1);
    expect(app.focus).toHaveBeenCalledWith({ steal: true });

    detach();
    const calls = host.emitter.broadcast.mock.calls.length;
    await auth.signOut();
    expect(host.emitter.broadcast.mock.calls.length).toBe(calls);
  });

  test("should answer the IPC handlers", async () => {
    const { auth, openBrowser } = setup();
    const event = {} as never;
    await expect(
      auth.handlers["auth:get-state"](undefined, event)
    ).resolves.toMatchObject({ status: "signed-out" });
    await expect(
      auth.handlers["auth:sign-in"](undefined, event)
    ).resolves.toMatchObject({ ok: true });
    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(
      auth.handlers["auth:cancel-sign-in"](undefined, event)
    ).toBeUndefined();
    await auth.handlers["auth:sign-out"](undefined, event);
    expect(auth.getState().status).toBe("signed-out");
  });

  test("should cancel a waiting sign-in and stop telling listeners on dispose", async () => {
    const { auth, openBrowser } = setup();
    const browserOpened = gate();
    openBrowser.mockImplementation(async () => {
      browserOpened.open();
    });
    const listener = vi.fn();
    auth.onChange(listener);
    const signing = auth.signIn();
    await browserOpened.opened;
    listener.mockClear();
    await auth.dispose();
    await expect(signing).resolves.toMatchObject({
      error: { code: "SIGN_IN_CANCELLED" },
    });
    expect(listener).not.toHaveBeenCalled();
  });

  test("should stop one listener without the others", async () => {
    const { auth } = setup();
    const stopped = vi.fn();
    const stop = auth.onChange(stopped);
    stop();
    await auth.restore();
    expect(stopped).not.toHaveBeenCalled();
  });
});
