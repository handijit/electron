import parseRetryAfter from "../shared/retry-after.helper";
import type { FetchLike } from "../shared/fetch-like.type";
import type { AuthUser } from "../types";
import type { TokenGrant, TokenRequestBody, TokenSet } from "./types";

/** An access token without `expires_in` is treated as a short one, so it is renewed early. */
const DEFAULT_EXPIRES_IN_SECONDS = 300;
const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"];

/** Why a token request did not end in a token set. */
type TokenRequestFailure =
  /** No answer: no network, DNS, a refused connection. */
  | "network"
  /** No answer in time. */
  | "timeout"
  /** The server answered with an error status. */
  | "status"
  /** The server answered `2xx` with something that is not a token set. */
  | "invalid";

/** A token request that failed. Its message never holds a token or a code. */
class TokenRequestError extends Error {
  readonly kind: TokenRequestFailure;
  /** The HTTP status, for `status`. */
  readonly status: number | null;
  /** The OAuth `error` of the answer, like `invalid_grant`, when it had one. */
  readonly oauthError: string | null;
  /** For a `429`: how long the server asked to wait, in seconds. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    kind: TokenRequestFailure,
    message: string,
    details: {
      status?: number;
      oauthError?: string | null;
      retryAfterSeconds?: number;
    } = {}
  ) {
    super(message);
    this.name = "TokenRequestError";
    this.kind = kind;
    this.status = details.status ?? null;
    this.oauthError = details.oauthError ?? null;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

/**
 * Checks an endpoint of the options: https, or http for a loopback host (a server on the
 * developer's machine, a test); never with credentials or a fragment. Throws a `TypeError`:
 * these addresses receive codes and tokens.
 */
const requireEndpoint = (value: unknown, option: string): string => {
  const url = typeof value === "string" ? URL.parse(value) : null;
  const isAllowed =
    url !== null &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" &&
        LOOPBACK_HOSTNAMES.includes(url.hostname))) &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "";
  if (!isAllowed) {
    throw new TypeError(
      `createAuth: options.${option} must be an https URL (http for a loopback host) without credentials or fragment, received ${JSON.stringify(value)}`
    );
  }
  return url.toString();
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const toUser = (
  id: unknown,
  name: unknown,
  email: unknown
): AuthUser | null => {
  const text =
    typeof id === "string"
      ? id
      : typeof id === "number" && Number.isFinite(id)
        ? String(id)
        : "";
  return text === ""
    ? null
    : { id: text, name: textOrNull(name), email: textOrNull(email) };
};

// The claims of an ID token, for display only: nothing here is trusted, the signature is not
// checked, and nothing is decided on it.
const claimsOf = (idToken: unknown): Readonly<Record<string, unknown>> => {
  if (typeof idToken !== "string") return {};
  const payload = idToken.split(".")[1];
  if (payload === undefined) return {};
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    return isRecord(claims) ? claims : {};
  } catch {
    return {};
  }
};

/**
 * The OAuth 2.0 token answer (RFC 6749 section 5.1): `access_token`, an optional
 * `refresh_token` and `expires_in`. The user comes from a `user` object when the server sends
 * one, otherwise from the claims of an OpenID Connect `id_token`.
 */
const parseOAuthTokenResponse = (body: unknown): TokenSet | null => {
  if (!isRecord(body)) return null;
  const accessToken = body.access_token;
  if (typeof accessToken !== "string" || accessToken === "") return null;
  const refreshToken =
    typeof body.refresh_token === "string" && body.refresh_token !== ""
      ? body.refresh_token
      : null;
  const expiresIn = Number(body.expires_in);
  const claims = isRecord(body.user) ? body.user : claimsOf(body.id_token);
  return {
    accessToken,
    refreshToken,
    expiresInSeconds:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? expiresIn
        : DEFAULT_EXPIRES_IN_SECONDS,
    user: toUser(claims.id ?? claims.sub, claims.name, claims.email),
  };
};

/** The OAuth 2.0 form of a token request (RFC 6749 sections 4.1.3 and 6). */
const buildOAuthTokenRequest = (grant: TokenGrant): TokenRequestBody => {
  const body = new URLSearchParams(
    grant.type === "authorization_code"
      ? {
          grant_type: "authorization_code",
          code: grant.code,
          redirect_uri: grant.redirectUri,
          code_verifier: grant.codeVerifier,
        }
      : { grant_type: "refresh_token", refresh_token: grant.refreshToken }
  );
  if (grant.clientId !== null) body.set("client_id", grant.clientId);
  return { body };
};

/** The revocation request of RFC 7009. */
const buildOAuthRevokeRequest = (
  refreshToken: string,
  clientId: string | null
): TokenRequestBody => {
  const body = new URLSearchParams({
    token: refreshToken,
    token_type_hint: "refresh_token",
  });
  if (clientId !== null) body.set("client_id", clientId);
  return { body };
};

/** The two kinds of request the session sends to the server. */
type TokenClient = {
  /** Sends a token request and reads the answer with `parse`. */
  readonly requestTokens: (
    url: string,
    request: TokenRequestBody,
    parse: (body: unknown) => TokenSet | null
  ) => Promise<TokenSet>;
  /** Sends a revocation; resolves whatever the server says, rejects only without an answer. */
  readonly revoke: (
    url: string,
    request: TokenRequestBody,
    timeoutMs: number
  ) => Promise<void>;
};

type TokenClientOptions = {
  readonly fetch: FetchLike;
  readonly userAgent: string | undefined;
  readonly timeoutMs: number;
  readonly now: () => number;
};

/** The headers every request of this package carries. */
const baseHeaders = (
  userAgent: string | undefined,
  extra: Readonly<Record<string, string>> = {}
): Headers => {
  const headers = new Headers({ Accept: "application/json", ...extra });
  if (userAgent !== undefined) headers.set("User-Agent", userAgent);
  return headers;
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

/**
 * Sends a `POST` and classifies what comes back. A failure is a `TokenRequestError`; its
 * message names the step, never a value of the request.
 */
const createTokenClient = ({
  fetch,
  userAgent,
  timeoutMs,
  now,
}: TokenClientOptions): TokenClient => {
  const post = async (
    url: string,
    request: TokenRequestBody,
    timeout: number = timeoutMs
  ): Promise<Response> => {
    try {
      return await fetch(url, {
        method: "POST",
        headers: baseHeaders(userAgent, request.headers),
        body: request.body,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      const isTimeout =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      throw new TokenRequestError(
        isTimeout ? "timeout" : "network",
        isTimeout
          ? "the token endpoint did not answer in time"
          : "the token endpoint could not be reached"
      );
    }
  };

  const requestTokens: TokenClient["requestTokens"] = async (
    url,
    request,
    parse
  ) => {
    const response = await post(url, request);
    const body = await readJson(response);
    if (!response.ok) {
      throw new TokenRequestError(
        "status",
        `the token endpoint answered ${response.status}`,
        {
          status: response.status,
          oauthError: isRecord(body) ? textOrNull(body.error) : null,
          retryAfterSeconds:
            response.status === 429
              ? parseRetryAfter(response.headers.get("Retry-After"), now())
              : undefined,
        }
      );
    }
    let tokens: TokenSet | null;
    try {
      tokens = parse(body);
    } catch {
      tokens = null;
    }
    if (tokens === null) {
      throw new TokenRequestError(
        "invalid",
        "the token endpoint answered with something that is not a token set"
      );
    }
    return tokens;
  };

  const revoke: TokenClient["revoke"] = async (url, request, timeout) => {
    await post(url, request, timeout);
  };

  return { requestTokens, revoke };
};

export type { TokenClient, TokenRequestFailure };
export {
  baseHeaders,
  buildOAuthRevokeRequest,
  buildOAuthTokenRequest,
  parseOAuthTokenResponse,
  requireEndpoint,
  TokenRequestError,
};
export default createTokenClient;
