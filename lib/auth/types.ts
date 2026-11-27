import type { Handlers, SecretStore } from "@handijitcom/electron/main";

import type { FetchLike } from "../shared/fetch-like.type";
import type {
  AuthContract,
  AuthState,
  AuthUser,
  SignInResult,
  Unsubscribe,
} from "../types";

/** What the token endpoint is asked for. */
type TokenGrant =
  | {
      readonly type: "authorization_code";
      /** The one-time code the browser brought back. */
      readonly code: string;
      /** The PKCE verifier of this attempt. */
      readonly codeVerifier: string;
      /** The loopback address the code was issued for. */
      readonly redirectUri: string;
      /** `clientId`, when one is set. */
      readonly clientId: string | null;
    }
  | {
      readonly type: "refresh_token";
      /** The refresh token to renew the session with. */
      readonly refreshToken: string;
      /** `clientId`, when one is set. */
      readonly clientId: string | null;
    };

/** The body of a `POST` this package sends, and the headers that describe it. */
type TokenRequestBody = {
  /** A `URLSearchParams` is sent as `application/x-www-form-urlencoded`. */
  readonly body: string | URLSearchParams;
  /** Extra headers, like `{ "Content-Type": "application/json" }` for a JSON body. */
  readonly headers?: Readonly<Record<string, string>>;
};

/** What the token endpoint answered, as this package keeps it. */
type TokenSet = {
  /** The access token: kept in memory, never written, never sent to the renderer. */
  readonly accessToken: string;
  /** The refresh token; `null` when the server issued none (a refresh then keeps the old one). */
  readonly refreshToken: string | null;
  /** How long the access token lives, in seconds. */
  readonly expiresInSeconds: number;
  /** Who signed in; `null` when the answer does not say (a refresh keeps the previous user). */
  readonly user: AuthUser | null;
};

/** The part of a logger this package writes to; the `Logger` of the main entry fits. */
type AuthLogger = {
  /** Something worth a line in the log. */
  readonly info: (message: string, context?: Record<string, unknown>) => void;
  /** Something that went wrong and was handled. */
  readonly warn: (message: string, context?: Record<string, unknown>) => void;
};

/** The texts of one page the browser shows after the consent page. */
type ReturnPageText = {
  /** The tab title. */
  readonly title: string;
  /** The heading. */
  readonly heading: string;
  /** One sentence under it. */
  readonly text: string;
};

/** The texts of the pages the loopback listener serves. Turkish by default. */
type ReturnPageLabels = {
  /** The `lang` of the pages. */
  readonly lang: string;
  /** After a good callback: "go back to the program". */
  readonly done: ReturnPageText;
  /** After the user declined on the consent page. */
  readonly denied: ReturnPageText;
  /** For a callback without the right `state` or code. */
  readonly invalid: ReturnPageText;
};

/** The part of the `AppContext` of `startApp` that `attach` uses. */
type AuthHost = {
  /** Sends the state to every window. */
  readonly emitter: {
    readonly broadcast: (
      channel: "auth:changed",
      payload: AuthState
    ) => unknown;
  };
  /** Brings the program's window to the front. */
  readonly showWindow: () => unknown;
};

/** How `createAuth` is set up: where the authorization server is and how it speaks. */
type AuthOptions = {
  /**
   * The authorization (consent) page, opened in the system browser. `response_type`,
   * `redirect_uri`, `state`, `code_challenge`, `code_challenge_method` and, when set,
   * `client_id` and `scope` are added to its query. https only; http for a loopback host.
   */
  readonly authorizeUrl: string;
  /** Where the code is exchanged for tokens (`POST`). https only; http for a loopback host. */
  readonly tokenEndpoint: string;
  /** Where the session is renewed (`POST`). Default: `tokenEndpoint`. */
  readonly refreshEndpoint?: string;
  /** Where a sign-out revokes the refresh token (`POST`, best effort). Default: nothing is revoked. */
  readonly revokeEndpoint?: string;
  /** The public client's id, sent as `client_id`. There is never a client secret. */
  readonly clientId?: string;
  /** The `scope` asked for. */
  readonly scope?: string;
  /** Extra query parameters of the authorization page, like `{ product: "notes" }`. */
  readonly authorizeParams?: Readonly<Record<string, string>>;
  /**
   * Builds the body of a token request. Default: the OAuth 2.0 form (`grant_type=…`, RFC 6749
   * sections 4.1.3 and 6). Return JSON with a `Content-Type` header for a server that wants it.
   */
  readonly buildTokenRequest?: (grant: TokenGrant) => TokenRequestBody;
  /**
   * Builds the body of the revocation request. Default: RFC 7009
   * (`token`, `token_type_hint=refresh_token`, `client_id`).
   */
  readonly buildRevokeRequest?: (
    refreshToken: string,
    clientId: string | null
  ) => TokenRequestBody;
  /**
   * Reads a token answer; return `null` (or throw) to refuse it. Default: the OAuth 2.0 answer
   * (`access_token`, `refresh_token`, `expires_in`) with the user from a `user` object
   * (`id`, `name`, `email`) or from the claims of an `id_token` (`sub`, `name`, `email`).
   */
  readonly parseTokenResponse?: (body: unknown) => TokenSet | null;
  /** Refuses an account the program may not be used with: the sign-in ends with `ACCOUNT_NOT_ALLOWED`. */
  readonly isAccountAllowed?: (tokens: TokenSet) => boolean;
  /**
   * Origins the access token may be sent to by `fetch`. A request to any other origin throws.
   * Default: the origin of `tokenEndpoint`.
   */
  readonly apiOrigins?: readonly string[];
  /** The `User-Agent` of every request, when the server wants to name the device. Default: Electron's. */
  readonly userAgent?: string;
  /** The `fetch` to send with. Default: Electron's `net.fetch` (system proxy and certificates). */
  readonly fetch?: FetchLike;
  /** How long a token request may take, in milliseconds. Default: 15000. */
  readonly requestTimeoutMs?: number;
  /** Opens the consent page. Default: `shell.openExternal`. */
  readonly openBrowser?: (url: string) => void | Promise<void>;
  /** How long a sign-in waits for the browser, in milliseconds. Default: 600000 (ten minutes). */
  readonly signInTimeoutMs?: number;
  /** Called when the browser has come back: the moment to bring the window to the front. */
  readonly onCallback?: () => void;
  /** Where the session is kept. Default: `createSecretStore()` of the main entry. */
  readonly secretStore?: SecretStore;
  /** A fixed loopback port (1024–65535). Default: the operating system picks a free one. */
  readonly port?: number;
  /** Replaces any of the texts of the pages the browser shows after the consent page. */
  readonly returnPage?: Partial<ReturnPageLabels>;
  /** Where problems are reported. Never receives a token, a code or a `state`. Default: silent. */
  readonly logger?: AuthLogger;
};

/** The session of one installation: the only holder of its tokens. */
type Auth = {
  /**
   * `fetch` with the access token: renews an expired session first, and once more (sending the
   * request again) when the server answers `401`. Only for `apiOrigins`; a request made while
   * nobody is signed in goes out without a token.
   */
  readonly fetch: FetchLike;
  /** A valid access token (renewed when needed), or `null` while nobody is signed in. Never rejects. */
  readonly getAccessToken: () => Promise<string | null>;
  /** The handlers of `authContract`; spread them into the app's handlers. */
  readonly handlers: Handlers<AuthContract>;
  /** The current state. `loading` until `restore` has finished. */
  readonly getState: () => AuthState;
  /** Calls the listener after every change of the state. Returns the function that stops it. */
  readonly onChange: (listener: (state: AuthState) => void) => Unsubscribe;
  /** Reads the stored session, once; later calls answer with the current state. Never rejects. */
  readonly restore: () => Promise<AuthState>;
  /** Signs in with the browser. A second call while one is waiting reopens the same page. Never rejects. */
  readonly signIn: () => Promise<SignInResult>;
  /** Ends a waiting sign-in with `SIGN_IN_CANCELLED`. Does nothing when none is waiting. */
  readonly cancelSignIn: () => void;
  /** Signs out: wipes the session here, then revokes it at the server (best effort). Never rejects. */
  readonly signOut: () => Promise<void>;
  /**
   * Wires the session to a running app: every change is broadcast as `auth:changed`, the window
   * comes to the front when the browser returns, and the stored session is read. Call it in
   * `beforeWindow` of `startApp`. Returns the function that undoes the wiring.
   */
  readonly attach: (host: AuthHost) => Unsubscribe;
  /** Cancels a waiting sign-in, closes the listener and drops every listener. For a shutdown and for tests. */
  readonly dispose: () => Promise<void>;
};

export type {
  Auth,
  AuthHost,
  AuthLogger,
  AuthOptions,
  ReturnPageLabels,
  ReturnPageText,
  TokenGrant,
  TokenRequestBody,
  TokenSet,
};
