import {
  codeChallengeOf,
  createCodeVerifier,
  createState,
} from "@handijitcom/api-client/pkce";
import { createSecretStore } from "@handijitcom/electron/main";
import { app, net, shell } from "electron";

import {
  LOADING_STATE,
  SIGNED_OUT_STATE,
} from "../shared/auth-states.constants";
import createAuthError from "../shared/create-auth-error.helper";
import type { FetchLike } from "../shared/fetch-like.type";
import type {
  AuthError,
  AuthErrorCode,
  AuthState,
  AuthUser,
  SignInResult,
  Unsubscribe,
} from "../types";
import startLoopbackListener from "./loopback-listener";
import type { LoopbackListener } from "./loopback-listener";
import reasonOf from "./reason-of.helper";
import createSessionVault from "./session-vault";
import type { SessionVault } from "./session-vault";
import toAuthError, { isRefusal } from "./to-auth-error.helper";
import createTokenClient, {
  buildOAuthRevokeRequest,
  buildOAuthTokenRequest,
  parseOAuthTokenResponse,
  requireEndpoint,
} from "./token-client";
import type {
  Auth,
  AuthHost,
  AuthLogger,
  AuthOptions,
  TokenSet,
} from "./types";

/** Long enough to sign up, verify an e-mail address and come back. */
const DEFAULT_SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/** An access token is treated as expired this long before it is, so a request never leaves with one that dies on the way. */
const ACCESS_TOKEN_SKEW_MS = 30_000;
/** A sign-out does not wait longer than this for the server. */
const SIGN_OUT_TIMEOUT_MS = 5_000;

const SILENT_LOGGER: AuthLogger = {
  info: () => undefined,
  warn: () => undefined,
};

type Adoption =
  | { readonly kind: "adopted"; readonly user: AuthUser | null }
  | { readonly kind: "stale" }
  | { readonly kind: "not-allowed" };

const requirePositive = (value: number, option: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(
      `createAuth: options.${option} must be a number of milliseconds above zero, received ${String(value)}`
    );
  }
  return value;
};

const originOf = (value: string, option: string): string => {
  const url = URL.parse(value);
  if (url === null || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new TypeError(
      `createAuth: options.${option} must hold http(s) origins, received ${JSON.stringify(value)}`
    );
  }
  return url.origin;
};

// A body that is a stream can be read once; such a request is not sent a second time.
const isReplayable = (body: RequestInit["body"]): boolean =>
  !(body instanceof ReadableStream);

/**
 * Creates the session of this installation: "sign in with the browser" (RFC 8252 loopback
 * redirect with PKCE S256) against any OAuth 2.0 style authorization server, the session kept
 * in the operating system's secret store, and an authenticated `fetch` for the main process.
 * Create one per program, in the main process, and keep it for the life of the process: it owns
 * the refresh token and the loopback listener. Nothing happens until `restore`, `attach`,
 * `signIn`, `fetch` or `getAccessToken` is called.
 *
 * Throws a `TypeError` for an option that is wrong.
 */
const createAuth = (options: AuthOptions): Auth => {
  const authorizeUrl = requireEndpoint(options.authorizeUrl, "authorizeUrl");
  const tokenEndpoint = requireEndpoint(options.tokenEndpoint, "tokenEndpoint");
  const refreshEndpoint =
    options.refreshEndpoint === undefined
      ? tokenEndpoint
      : requireEndpoint(options.refreshEndpoint, "refreshEndpoint");
  const revokeEndpoint =
    options.revokeEndpoint === undefined
      ? null
      : requireEndpoint(options.revokeEndpoint, "revokeEndpoint");
  const clientId = options.clientId ?? null;
  const signInTimeoutMs = requirePositive(
    options.signInTimeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS,
    "signInTimeoutMs"
  );
  const requestTimeoutMs = requirePositive(
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    "requestTimeoutMs"
  );
  const apiOrigins = new Set(
    (options.apiOrigins ?? [tokenEndpoint]).map((origin) =>
      originOf(origin, "apiOrigins")
    )
  );
  const buildTokenRequest = options.buildTokenRequest ?? buildOAuthTokenRequest;
  const buildRevokeRequest =
    options.buildRevokeRequest ?? buildOAuthRevokeRequest;
  const parseTokens = options.parseTokenResponse ?? parseOAuthTokenResponse;
  const logger = options.logger ?? SILENT_LOGGER;
  const openBrowser =
    options.openBrowser ?? ((url: string) => shell.openExternal(url));
  // Read when a request is sent, not now: `net` works only once the app is ready.
  const send: FetchLike =
    options.fetch ?? ((url, init) => net.fetch(url, init));
  const tokens = createTokenClient({
    fetch: send,
    userAgent: options.userAgent,
    timeoutMs: requestTimeoutMs,
    now: Date.now,
  });

  let state: AuthState = LOADING_STATE;
  const listeners = new Set<(state: AuthState) => void>();
  const callbackHooks = new Set<() => void>();
  if (options.onCallback !== undefined) callbackHooks.add(options.onCallback);

  // The session. `epoch` moves whenever it ends, so that an answer which arrives afterwards
  // (a refresh, an exchange) knows it is too late to be adopted.
  let epoch = 0;
  let refreshToken: string | null = null;
  let accessToken: { value: string; expiresAt: number } | null = null;
  let vault!: SessionVault;
  let restoring: Promise<void> | null = null;
  let refreshing: Promise<boolean> | null = null;

  // The sign-in that is waiting, if any. There is never a second one.
  let pendingSignIn: Promise<SignInResult> | null = null;
  let pendingUrl: string | null = null;
  let isCancelRequested = false;
  let wake: (() => void) | null = null;
  let listener: LoopbackListener | null = null;

  const setState = (next: AuthState): void => {
    state = next;
    for (const listen of [...listeners]) {
      try {
        listen(next);
      } catch (error) {
        logger.warn("A listener of the session state failed", {
          reason: reasonOf(error),
        });
      }
    }
  };

  // Best effort: the session here is already gone whatever the server says.
  const revoke = async (token: string | null): Promise<void> => {
    if (token === null || revokeEndpoint === null) return;
    try {
      await tokens.revoke(
        revokeEndpoint,
        buildRevokeRequest(token, clientId),
        SIGN_OUT_TIMEOUT_MS
      );
    } catch (error) {
      logger.info("The server could not be told that the session is over", {
        reason: reasonOf(error),
      });
    }
  };

  const endSession = async (code: AuthErrorCode): Promise<void> => {
    epoch += 1;
    refreshToken = null;
    accessToken = null;
    setState({ ...SIGNED_OUT_STATE, error: createAuthError(code) });
    await vault.clear();
  };

  // Takes a token set the server has just answered with. Both tokens are in place, in memory
  // and on the disk, before this resolves.
  const adopt = async (
    answer: TokenSet,
    startedAt: number,
    previousUser: AuthUser | null
  ): Promise<Adoption> => {
    // A sign-out while the request was on its way: the new session must not outlive it.
    if (epoch !== startedAt) {
      await revoke(answer.refreshToken);
      return { kind: "stale" };
    }
    if (options.isAccountAllowed?.(answer) === false) {
      await revoke(answer.refreshToken);
      return { kind: "not-allowed" };
    }
    const user = answer.user ?? previousUser;
    const lifetimeMs = answer.expiresInSeconds * 1000;
    // A server that does not rotate refresh tokens answers a refresh without one.
    refreshToken = answer.refreshToken ?? refreshToken;
    accessToken = {
      value: answer.accessToken,
      expiresAt:
        Date.now() +
        lifetimeMs -
        Math.min(ACCESS_TOKEN_SKEW_MS, lifetimeMs / 2),
    };
    let isRemembered = false;
    if (refreshToken === null) {
      // Nothing can renew this session after a restart; an older stored one is no use either.
      await vault.clear();
    } else {
      isRemembered = await vault.save({ refreshToken, user });
    }
    if (epoch !== startedAt) {
      await revoke(answer.refreshToken);
      return { kind: "stale" };
    }
    setState({ status: "signed-in", user, error: null, isRemembered });
    return { kind: "adopted", user };
  };

  const runRefresh = async (): Promise<boolean> => {
    const token = refreshToken;
    if (token === null) return false;
    const startedAt = epoch;
    const previousUser = state.user;
    let answer: TokenSet;
    try {
      answer = await tokens.requestTokens(
        refreshEndpoint,
        buildTokenRequest({
          type: "refresh_token",
          refreshToken: token,
          clientId,
        }),
        parseTokens
      );
    } catch (error) {
      // Only the server's refusal ends the session. No network, a timeout or an answer that
      // cannot be read say nothing about it: they are thrown, and the user stays signed in.
      if (!isRefusal(error)) throw error;
      if (epoch === startedAt) await endSession("SESSION_ENDED");
      return false;
    }
    const adoption = await adopt(answer, startedAt, previousUser);
    if (adoption.kind === "not-allowed") {
      await endSession("ACCOUNT_NOT_ALLOWED");
    }
    return adoption.kind === "adopted";
  };

  // Single flight. A server that rotates refresh tokens accepts each one once; two refreshes in
  // parallel would spend it twice and could end the session.
  const refreshOnce = (): Promise<boolean> => {
    refreshing ??= runRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  const runRestore = async (): Promise<void> => {
    // The secret store reads nothing before the app is ready, which would look like "signed out".
    await app.whenReady();
    vault = createSessionVault({
      secretStore: options.secretStore ?? createSecretStore(),
      logger,
    });
    const stored = await vault.load();
    if (stored === null) {
      setState(SIGNED_OUT_STATE);
      return;
    }
    refreshToken = stored.refreshToken;
    setState({
      status: "signed-in",
      user: stored.user,
      error: null,
      isRemembered: true,
    });
    // The user is shown as signed in at once; the server is asked in the background. Only its
    // refusal signs them out: a program that starts without a network stays signed in.
    refreshOnce().catch((error: unknown) => {
      logger.info(
        "The stored session could not be checked with the server; staying signed in",
        { reason: reasonOf(error) }
      );
    });
  };

  const restore = async (): Promise<AuthState> => {
    restoring ??= runRestore();
    await restoring;
    return state;
  };

  // A valid access token, renewing the session first when it has expired.
  const getAccessToken = async (): Promise<string | null> => {
    await restore();
    if (accessToken !== null && Date.now() < accessToken.expiresAt) {
      return accessToken.value;
    }
    if (refreshToken === null) return null;
    const isRenewed = await refreshOnce().catch((error: unknown) => {
      logger.info("The session could not be renewed", {
        reason: reasonOf(error),
      });
      return false;
    });
    return isRenewed && accessToken !== null ? accessToken.value : null;
  };

  const authenticatedFetch: FetchLike = async (input, init = {}) => {
    const target = URL.parse(input);
    if (target === null || !apiOrigins.has(target.origin)) {
      throw new TypeError(
        `auth.fetch: ${JSON.stringify(input)} is not on an origin of options.apiOrigins; the access token is sent nowhere else`
      );
    }
    const sendWith = (token: string | null): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (options.userAgent !== undefined && !headers.has("User-Agent")) {
        headers.set("User-Agent", options.userAgent);
      }
      if (token !== null) headers.set("Authorization", `Bearer ${token}`);
      return send(input, { ...init, headers });
    };

    const token = await getAccessToken();
    const response = await sendWith(token);
    if (response.status !== 401 || token === null || !isReplayable(init.body)) {
      return response;
    }
    // The token died early (revoked, the server's clock): renew once and send once more.
    const isRenewed = await refreshOnce().catch(() => false);
    if (!isRenewed || accessToken === null) return response;
    return sendWith(accessToken.value);
  };

  const fail = (error: AuthError): SignInResult => {
    setState({ ...SIGNED_OUT_STATE, error });
    return { ok: false, error };
  };

  // A cancel is the user's own choice: it is answered, but it is not an error to show.
  const cancelled = (): SignInResult => {
    if (state.status === "signing-in") setState(SIGNED_OUT_STATE);
    return { ok: false, error: createAuthError("SIGN_IN_CANCELLED") };
  };

  const open = async (url: string): Promise<boolean> => {
    try {
      await openBrowser(url);
      return true;
    } catch (error) {
      logger.warn("The browser could not be opened", {
        reason: reasonOf(error),
      });
      return false;
    }
  };

  const buildAuthorizeUrl = (
    codeChallenge: string,
    redirectUri: string,
    attemptState: string
  ): string => {
    const url = new URL(authorizeUrl);
    for (const [name, value] of Object.entries(options.authorizeParams ?? {})) {
      url.searchParams.set(name, value);
    }
    // Set last: an extra parameter of the program cannot replace one the flow depends on.
    url.searchParams.set("response_type", "code");
    if (clientId !== null) url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    if (options.scope !== undefined)
      url.searchParams.set("scope", options.scope);
    url.searchParams.set("state", attemptState);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  };

  // Opens the consent page and waits for the browser, the time limit or a cancel.
  const waitForCode = async (
    current: LoopbackListener,
    url: string
  ): Promise<{ code: string } | AuthErrorCode> => {
    // A cancel that came while the listener was starting: the browser is not opened at all.
    if (isCancelRequested) return "SIGN_IN_CANCELLED";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<AuthErrorCode>((resolve) => {
      timer = setTimeout(() => resolve("SIGN_IN_TIMED_OUT"), signInTimeoutMs);
      wake = () => resolve("SIGN_IN_CANCELLED");
      // Not awaited: an opener that never answers must not outlast the time limit or a cancel.
      void open(url).then((isOpen) => {
        if (!isOpen) resolve("BROWSER_NOT_OPENED");
      });
    });
    pendingUrl = url;
    try {
      const outcome = await Promise.race([current.outcome, interrupted]);
      if (typeof outcome === "string") return outcome;
      if (outcome.kind === "code") return { code: outcome.code };
      return outcome.kind === "denied" ? "ACCESS_DENIED" : "STATE_MISMATCH";
    } finally {
      clearTimeout(timer);
      wake = null;
      pendingUrl = null;
    }
  };

  const runSignIn = async (): Promise<SignInResult> => {
    await restore();
    if (state.status === "signed-in") {
      return { ok: true, user: state.user };
    }
    if (isCancelRequested) return cancelled();

    const startedAt = epoch;
    setState({ ...SIGNED_OUT_STATE, status: "signing-in" });

    const codeVerifier = createCodeVerifier();
    const codeChallenge = await codeChallengeOf(codeVerifier);
    const attemptState = createState();
    let current: LoopbackListener;
    try {
      // The listener of the previous attempt may still be serving its page.
      await listener?.close();
      current = await startLoopbackListener({
        state: attemptState,
        port: options.port,
        pages: options.returnPage,
      });
    } catch (error) {
      logger.warn("The loopback listener could not be started", {
        reason: reasonOf(error),
      });
      return fail(createAuthError("LISTENER_FAILED"));
    }
    listener = current;

    const waited = await waitForCode(
      current,
      buildAuthorizeUrl(codeChallenge, current.redirectUri, attemptState)
    );
    if (typeof waited === "string") {
      await current.close();
      return waited === "SIGN_IN_CANCELLED"
        ? cancelled()
        : fail(createAuthError(waited));
    }

    // The browser is back. The listener closes by itself once it has served its page.
    for (const hook of [...callbackHooks]) {
      try {
        hook();
      } catch (error) {
        logger.warn("The callback hook failed", { reason: reasonOf(error) });
      }
    }

    let answer: TokenSet;
    try {
      // Once. A server consumes the code on the first attempt, whatever the outcome.
      answer = await tokens.requestTokens(
        tokenEndpoint,
        buildTokenRequest({
          type: "authorization_code",
          code: waited.code,
          codeVerifier,
          redirectUri: current.redirectUri,
          clientId,
        }),
        parseTokens
      );
    } catch (error) {
      if (isCancelRequested) return cancelled();
      logger.warn("The sign-in code could not be exchanged", {
        reason: reasonOf(error),
      });
      return fail(toAuthError(error));
    }
    if (isCancelRequested) {
      await revoke(answer.refreshToken);
      return cancelled();
    }

    const adoption = await adopt(answer, startedAt, null);
    if (adoption.kind === "adopted") return { ok: true, user: adoption.user };
    return adoption.kind === "not-allowed"
      ? fail(createAuthError("ACCOUNT_NOT_ALLOWED"))
      : cancelled();
  };

  const signIn = (): Promise<SignInResult> => {
    if (pendingSignIn !== null) {
      // The user lost the tab: the same page again, on the same listener.
      if (pendingUrl !== null) void open(pendingUrl);
      return pendingSignIn;
    }
    isCancelRequested = false;
    const run = runSignIn().finally(() => {
      pendingSignIn = null;
    });
    pendingSignIn = run;
    return run;
  };

  const cancelSignIn = (): void => {
    if (pendingSignIn === null) return;
    isCancelRequested = true;
    wake?.();
  };

  const signOut = async (): Promise<void> => {
    cancelSignIn();
    await restore();
    const token = refreshToken;
    const pendingRefresh = refreshing;
    epoch += 1;
    refreshToken = null;
    accessToken = null;
    if (state !== SIGNED_OUT_STATE) setState(SIGNED_OUT_STATE);
    await vault.clear();
    if (token === null) return;
    if (pendingRefresh !== null) {
      try {
        // A refresh that answers after this point revokes the session it was given.
        await pendingRefresh;
        return;
      } catch {
        // It got no answer, so the token read above may still be the live one.
      }
    }
    await revoke(token);
  };

  const onChange = (listen: (state: AuthState) => void): Unsubscribe => {
    listeners.add(listen);
    return () => {
      listeners.delete(listen);
    };
  };

  const attach = (host: AuthHost): Unsubscribe => {
    const stop = onChange((next) => {
      host.emitter.broadcast("auth:changed", next);
    });
    const focus = (): void => {
      host.showWindow();
      // The browser is the active application at this moment; on macOS a window that asks for
      // focus stays behind it unless the app takes it.
      app.focus({ steal: true });
    };
    callbackHooks.add(focus);
    void restore();
    return () => {
      stop();
      callbackHooks.delete(focus);
    };
  };

  const dispose = async (): Promise<void> => {
    cancelSignIn();
    listeners.clear();
    callbackHooks.clear();
    await pendingSignIn;
    await listener?.close();
  };

  return {
    fetch: authenticatedFetch,
    getAccessToken,
    handlers: {
      "auth:get-state": () => restore(),
      "auth:sign-in": () => signIn(),
      "auth:cancel-sign-in": () => cancelSignIn(),
      "auth:sign-out": () => signOut(),
    },
    getState: () => state,
    onChange,
    restore,
    signIn,
    cancelSignIn,
    signOut,
    attach,
    dispose,
  };
};

export default createAuth;
