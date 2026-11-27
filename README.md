# @handijitcom/electron

The part of an Electron desktop program that must not differ between programs, in one
dependency-free package: a secure window, the `app://` protocol with a strict
Content-Security-Policy, a typed and validated IPC contract, the single-instance lock, settings
and secret stores, a redacting logger, the theme bridge, silent printing for label printers,
"sign in with the browser" (RFC 8252 loopback with PKCE) and an `electron-updater` state machine
with a minimum-version gate.

- **One entry per process.** Each entry imports only what its process can load; a build check
  (`scripts/verify-build.mjs`) reads the built files and fails otherwise. The page entries never
  touch `electron`, `node:*` or Zod; the preload entry requires `electron` and nothing else.
- **No runtime dependency.** `electron` and `zod` are peers; `react`, `@handijitcom/ui` and
  `electron-updater` are optional peers of the entries that use them.
- **Backend-agnostic.** The sign-in speaks OAuth 2.0 by default and every endpoint, request and
  answer is an option; the update policy is a URL you give.
- **ES modules and CommonJS**, with types for both.

## Entries

| Entry                                | Runs in | Peers it needs                           | What                                                                                    |
| ------------------------------------ | ------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `@handijitcom/electron`              | any     | —                                        | `defineContract`, channel lists, constants, guards, types                               |
| `@handijitcom/electron/main`         | main    | `electron`, `zod`                        | `startApp` and every piece of it, stores, logger, theme, `listPrinters`/`printSilently` |
| `@handijitcom/electron/preload`      | preload | `electron`                               | `exposeBridge`, `withUpdateChannels`, `UPDATE_CHANNELS`, `AUTH_CHANNELS`                |
| `@handijitcom/electron/renderer`     | page    | —                                        | `createClient`, `log`, theme, `updateClient`, `getAuthStore`                            |
| `@handijitcom/electron/auth`         | main    | `electron`, `zod`                        | `createAuth`, `authContract`                                                            |
| `@handijitcom/electron/auth-react`   | page    | `react`                                  | `useAuth`                                                                               |
| `@handijitcom/electron/update`       | main    | `electron`, `zod` (+ `electron-updater`) | `createUpdater`, `registerUpdateIpc`, `updateContract`                                  |
| `@handijitcom/electron/update-react` | page    | `react`                                  | `useUpdate`                                                                             |
| `@handijitcom/electron/update-ui`    | page    | `react`, `@handijitcom/ui`               | `UpdateButton`, `UpdateGate` (+ `@handijitcom/electron/styles.css`)                     |

Peer ranges: `electron >=43.0.0 <46.0.0`, `zod ^4`, `electron-updater ^6.8`, `react >=18`,
`@handijitcom/ui ^3`. The updater never imports `electron-updater`: you pass its `autoUpdater`
in. Node 24 or newer for the tooling.

```sh
npm install @handijitcom/electron zod
npm install --save-dev electron
npm install electron-updater                       # for /update
npm install react react-dom @handijitcom/ui        # for /auth-react, /update-react, /update-ui
```

## Quick start

### 1. The contract (shared)

```ts
// src/shared/contract.ts
import { defineContract } from "@handijitcom/electron";
import { z } from "zod";

export const contract = defineContract({
  invoke: {
    "notes:list": {
      output: z.array(z.object({ id: z.number(), title: z.string() })),
    },
    "notes:rename": {
      input: z.object({ id: z.number(), title: z.string().min(1) }),
    },
  },
  events: { "sync:finished": z.object({ count: z.number() }) },
});
export type AppContract = typeof contract;
```

Channel names are `area:action` in kebab-case. `defineContract` throws at start-up on a
malformed name, on a name used both as a request and as an event, and on the reserved `core-`
area.

### 2. main

```ts
// src/main/index.ts
import { join } from "node:path";
import { THEME_BOOT_SCRIPT_HASH } from "@handijitcom/ui/design";
import { startApp } from "@handijitcom/electron/main";
import { app } from "electron";
import { contract } from "../shared/contract";

// No top-level `await`: Electron emits `ready` only after an ES module main has finished
// evaluating, so awaiting the start-up here would wait forever.
startApp({
  contract,
  handlers: ({ emitter, logger }) => ({
    "notes:list": () => database.listNotes(),
    "notes:rename": async ({ id, title }) => {
      await database.renameNote(id, title);
      logger.info("Renamed a note", { id });
      emitter.broadcast("sync:finished", { count: 1 });
    },
  }),
  rendererRoot: join(import.meta.dirname, "../renderer"),
  window: {
    preload: join(import.meta.dirname, "../preload/index.cjs"),
    themeBackground: { light: "#ffffff", dark: "#0b0d12" },
  },
  contentSecurityPolicy: {
    connectSrc: ["https://api.example.com"],
    scriptHashes: [THEME_BOOT_SCRIPT_HASH],
  },
  externalHosts: ["example.com"],
}).catch((error: unknown) => {
  console.error("The program could not start", error);
  app.exit(1);
});
```

`startApp` starts in the one safe order: single-instance lock → `app://` scheme → logger and
uncaught-error capture → `ready` → protocol handler, permission guards, theme, IPC handlers →
`beforeWindow` → window. Every piece is exported on its own as well.

### 3. preload

```ts
// src/preload/index.ts
import { exposeBridge, type ChannelMap } from "@handijitcom/electron/preload";
import type { AppContract } from "../shared/contract";

// A plain channel map keeps Zod out of the sandboxed preload bundle; the compiler rejects a
// map that is not exactly the contract's channels.
const channels: ChannelMap<AppContract> = {
  invoke: { "notes:list": true, "notes:rename": true },
  events: { "sync:finished": true },
};
exposeBridge(channels);
```

### 4. renderer

```ts
// src/renderer/main.ts
import {
  createClient,
  forwardErrors,
  syncTheme,
} from "@handijitcom/electron/renderer";
import type { AppContract } from "../shared/contract";

forwardErrors(); // uncaught errors of this window go to the main log
syncTheme(); // keeps <html data-theme> equal to what main resolved

export const desktop = createClient<AppContract>();
const notes = await desktop.invoke("notes:list");
await desktop.invoke("notes:rename", { id: 1, title: "Inbox" });
desktop.on("sync:finished", ({ count }) => console.info(count));
```

The renderer imports the contract as a type only, so no schema reaches the page bundle. In
development `startApp` loads `process.env.ELECTRON_RENDERER_URL` instead of `app://bundle/`,
only when the app is not packaged and the URL is a loopback address.

## Silent printing

```ts
import { listPrinters, printSilently } from "@handijitcom/electron/main";

const printers = await listPrinters(labelWindow.webContents); // [{ name, displayName, … }]
const result = await printSilently(labelWindow.webContents, {
  deviceName: "Zebra_ZD421",
  pageSize: { width: 100_000, height: 50_000 }, // microns: a 100 × 50 mm label
  margins: { marginType: "none" },
});
if (!result.ok)
  logger.warn("Label not printed", {
    reason: result.reason,
    detail: result.detail,
  });
```

`printSilently` calls `webContents.print({ silent: true, … })` only when a printer of exactly
that name is installed, so a renamed or unplugged label printer is reported
(`printer-not-found`) instead of Electron printing on the default printer. Expected failures
(`printer-not-found`, `destroyed`, `cancelled`, `failed`) resolve as `{ ok: false, reason,
detail }`; only a programming error (an empty `deviceName`, `copies` below 1) throws.
`printBackground` defaults to `true`, since labels draw boxes and bars with backgrounds.

## Sign in with the browser (`/auth`)

The program never asks for a password: it opens the authorization page in the system browser,
listens on `127.0.0.1` at a port the operating system picks, receives the code (RFC 8252 with
PKCE S256), exchanges it, keeps the refresh token in the operating system's secret store
(`safeStorage`) and gives the rest of main an authenticated `fetch`. Tokens never leave main:
neither the contract nor the state has a field for one.

```ts
// src/shared/contract.ts
import { authContract } from "@handijitcom/electron/auth";
export const contract = defineContract({
  invoke: { ...authContract.invoke, ...appInvoke },
  events: { ...authContract.events, ...appEvents },
});

// src/main/index.ts
import { createAuth } from "@handijitcom/electron/auth";

export const auth = createAuth({
  authorizeUrl: "https://id.example.com/oauth/authorize",
  tokenEndpoint: "https://id.example.com/oauth/token",
  revokeEndpoint: "https://id.example.com/oauth/revoke", // optional
  clientId: "notes-desktop",
  scope: "openid profile email offline_access",
  apiOrigins: ["https://api.example.com"], // where auth.fetch may send the token
});

startApp({
  contract,
  handlers: () => ({ ...auth.handlers, ...appHandlers }),
  beforeWindow: (context) => {
    auth.attach(context); // broadcasts auth:changed, focuses the window on return, restores
  },
  // …
});

const response = await auth.fetch("https://api.example.com/notes");

// src/preload/index.ts
import { AUTH_CHANNELS, exposeBridge } from "@handijitcom/electron/preload";
exposeBridge({
  invoke: { ...AUTH_CHANNELS.invoke, ...appChannels.invoke },
  events: { ...AUTH_CHANNELS.events },
});

// a React page
import { useAuth } from "@handijitcom/electron/auth-react";
const { status, user, error, signIn, cancelSignIn, signOut } = useAuth();
```

Everything about the server is an option, with OAuth 2.0 defaults:

| Option                          | Default                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `authorizeUrl`, `tokenEndpoint` | required (https; http only for a loopback host)                                |
| `refreshEndpoint`               | `tokenEndpoint`                                                                |
| `revokeEndpoint`                | none: nothing is revoked on sign-out                                           |
| `authorizeParams`               | none; extra query parameters of the authorization page                         |
| `buildTokenRequest(grant)`      | RFC 6749 form (`grant_type=authorization_code` / `refresh_token`, `client_id`) |
| `buildRevokeRequest(token)`     | RFC 7009 form                                                                  |
| `parseTokenResponse(body)`      | `access_token`, `refresh_token`, `expires_in`; user from `user` or `id_token`  |
| `isAccountAllowed(tokens)`      | every account; `false` ends the sign-in with `ACCOUNT_NOT_ALLOWED`             |
| `apiOrigins`                    | the origin of `tokenEndpoint`; `auth.fetch` refuses any other origin           |
| `returnPage`                    | Turkish texts of the pages the browser shows after the consent page            |

A server with a JSON API, for example:

```ts
createAuth({
  authorizeUrl: "https://www.example.com/panel/desktop-sign-in",
  authorizeParams: { product: "notes" },
  tokenEndpoint: "https://api.example.com/api/public/desktop/token",
  refreshEndpoint: "https://api.example.com/api/auth/refresh",
  revokeEndpoint: "https://api.example.com/api/auth/logout",
  buildTokenRequest: (grant) => ({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      grant.type === "authorization_code"
        ? {
            code: grant.code,
            codeVerifier: grant.codeVerifier,
            redirectUri: grant.redirectUri,
          }
        : { refreshToken: grant.refreshToken }
    ),
  }),
  buildRevokeRequest: (refreshToken) => ({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  }),
  parseTokenResponse: (body) => {
    const { accessToken, refreshToken, expiresInSeconds, user } =
      body as ServerSession;
    return {
      accessToken,
      refreshToken,
      expiresInSeconds,
      user: { id: String(user.id), name: user.name, email: user.email },
    };
  },
});
```

Failures resolve as `{ ok: false, error }` with a stable code: `SIGN_IN_TIMED_OUT`,
`SIGN_IN_CANCELLED`, `STATE_MISMATCH`, `ACCESS_DENIED`, `CODE_REFUSED`, `RATE_LIMITED`,
`OFFLINE`, `SESSION_ENDED`, `ACCOUNT_NOT_ALLOWED`, `BROWSER_NOT_OPENED`, `LISTENER_FAILED`,
`UNEXPECTED`. Only a refusal of the refresh token (`400`/`401`/`403`) ends a stored session; no
network, a timeout or a `5xx` keep the user signed in. Without operating-system encryption the
session lives in memory only (`isRemembered: false`); plain text is never a fallback.

The listener binds `127.0.0.1` only, checks `Host` (DNS rebinding) and path, compares `state` in
constant time, answers the callback with a `303` to a code-free `/done` page under
`default-src 'none'`, and gives up after 20 refused requests.

## Updates (`/update`, `/update-react`, `/update-ui`)

A thin layer over `electron-updater` that turns its events into one explicit state machine and
joins it with an optional minimum-version policy.

```ts
// main
import { createUpdater, registerUpdateIpc } from "@handijitcom/electron/update";
import electronUpdater from "electron-updater";

let updater: Updater | undefined;
startApp({
  contract,
  handlers: (context) => {
    updater = createUpdater({
      engine: electronUpdater.autoUpdater,
      feedUrl: "https://downloads.example.com/notes/",
      downloadPageUrl: "https://example.com/notes/download",
      logger: context.logger,
      policy: { url: "https://api.example.com/products/notes/update-policy" },
    });
    registerUpdateIpc({ updater, policy: context.policy });
    return appHandlers;
  },
  // Before the window: a stored "required" verdict shows the gate on the first frame.
  beforeWindow: async () => {
    await updater?.start();
  },
  // …
});

// preload
exposeBridge(withUpdateChannels(channels));

// page
import "@handijitcom/ui/tokens.css";
import "@handijitcom/ui/styles.css";
import "@handijitcom/electron/styles.css";
import { UpdateButton, UpdateGate } from "@handijitcom/electron/update-ui";

<UpdateGate productName="Notes">
  <header>
    Notes <UpdateButton />
  </header>
  <Routes />
</UpdateGate>;
```

Han Dijit programs pass
`policy: { url: "https://api.handijit.com/api/public/products/<slug>/update-policy" }`.

- **The feed says what can be installed; the policy says whether the program may go on being
  used.** The updater asks the policy with `GET <url>?os=windows|macos&arch=x64|arm64&channel=stable|beta`
  and reads `latestVersion` and `minSupportedVersion` (`policy.parse` for another shape).
  `200` is a policy, `404` means no release, `429` is obeyed with `Retry-After`.
- **A policy failure never blocks the program.** No answer, an error status, an unreadable
  body or an unreadable stored file leave the stored verdict, or `ok`, in force; `start()`
  never waits for the endpoint. A stored `required` holds for 7 days (`requiredCacheTtlMs`),
  symmetric around the time it was fetched, then weakens to `recommended`.
- **A required update ignores the staged rollout** and is looked for at once; when the feed has
  nothing newer yet the gate offers the manual download and retries after 1, 2, 5 and then
  every 15 minutes.
- **Nothing overlaps, nothing throws, nothing restarts unasked.** `autoDownload` is `false` by
  default, a downloaded update installs on quit, a failed background check shows nothing.
  Downgrades are refused twice (`allowDowngrade = false` before every check, plus a version
  comparison).
- **Builds that cannot update themselves say so**: `unsupported` with `development`,
  `unsigned` (macOS without a Developer ID signature) or `platform`.

The state is one frozen, serializable object with a `revision`; statuses are `idle`,
`unsupported`, `checking`, `not-available`, `available`, `downloading`, `downloaded`, `error`,
verdicts `ok`, `recommended`, `required`, error codes `OFFLINE`, `SERVER`, `INVALID_FEED`,
`CHECKSUM`, `SIGNATURE`, `DISK`, `INSTALL`, `NOT_IN_APPLICATIONS`, `UNKNOWN` (messages are
Turkish; `errorMessages` replaces them, `labels` replaces the component texts).

`UpdateGate` covers the window while the verdict is `required` and keeps the program mounted
behind it, `inert`. `UpdateButton` renders nothing while there is nothing to do;
`isAlwaysVisible` makes it a settings-page control. Both draw with `@handijitcom/ui` 3 and its
tokens; `useUpdate()` gives a program with its own design the same state.

## What `/main` enforces

- **Window:** `sandbox`, `contextIsolation`, `webSecurity` on; `nodeIntegration` (also in
  workers and sub-frames), `webviewTag`, `allowRunningInsecureContent`, `experimentalFeatures`,
  `navigateOnDragDrop` off (`ENFORCED_WEB_PREFERENCES`); no field to change them. Navigation
  and redirects away from the app are cancelled, `window.open` is denied, `<webview>` is
  prevented.
- **External links:** only `https://` URLs of `externalHosts` reach `shell.openExternal`, never
  with credentials. Default: none.
- **Permissions:** denied unless listed and asked by the app's own page; device access denied.
- **`app://`:** `GET`/`HEAD` only, one host, the path checked after decoding, a missing asset is
  a 404, every response carries the CSP and `nosniff`.
- **IPC:** sender frame → input schema → handler → output schema, in that order; a throwing
  handler reaches the renderer as `[HANDLER_FAILED] <channel>` only; events are validated and go
  only to the app's pages. No generic `invoke(channel)` gate exists.
- **Data:** settings validated on every read and write, written atomically, a corrupt file set
  aside (`<name>.corrupt-<time>`) and the defaults used; secrets via `safeStorage` only, failing
  closed (also on Linux's `basic_text`).
- **Logging:** JSON lines in `app.getPath("logs")`, rotated, asynchronous, every value through
  the redactor (secret-looking keys, bearer tokens, JWTs, URL secrets, e-mail addresses).

## Migrating from `@handijit/electron`, `@handijit/auth`, `@handijit/electron-update`

| Before                                                             | Now                                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `@handijit/electron[/main\|/preload\|/renderer]`                   | `@handijitcom/electron[/main\|/preload\|/renderer]` (same API)                                                          |
| `@handijit/auth` `authContract`, `/main` `createAuth`              | `@handijitcom/electron/auth`                                                                                            |
| `@handijit/auth/preload` `AUTH_CHANNELS`                           | `@handijitcom/electron/preload` (or `.`)                                                                                |
| `@handijit/auth/renderer` `getAuthStore`, `/react` `useAuth`       | `@handijitcom/electron/renderer`, `@handijitcom/electron/auth-react`                                                    |
| `createAuth({ product })` against the Han Dijit panel              | `createAuth({ authorizeUrl, tokenEndpoint, … })`; pass `authorizeParams: { product }` and the JSON builders shown above |
| `auth.client` (API client of `@handijit/core`)                     | `auth.fetch` and `auth.getAccessToken()`                                                                                |
| `AuthUser.id: number`                                              | `AuthUser.id: string`; `name`, `email` may be `null`                                                                    |
| `NOT_A_CUSTOMER`                                                   | `ACCOUNT_NOT_ALLOWED` (`403`, or `isAccountAllowed`); new `ACCESS_DENIED`                                               |
| `@handijit/electron-update/main` `createUpdater({ product, api })` | `@handijitcom/electron/update` `createUpdater({ feedUrl, downloadPageUrl, policy: { url } })`                           |
| `@handijit/electron-update/preload\|/renderer\|/react\|/ui`        | `@handijitcom/electron/preload`, `/renderer`, `/update-react`, `/update-ui`                                             |
| `@handijit/electron-update/styles.css`                             | `@handijitcom/electron/styles.css` (needs `@handijitcom/ui` 3 tokens)                                                   |
| `onCorrupt(backupPath: string)`                                    | `onCorrupt(backupPath: string \| null)`                                                                                 |

## Development

```sh
npm ci --ignore-scripts   # no Electron binary is downloaded; the tests mock `electron`
npm run verify            # lint + prettier, typecheck, unit tests (100% coverage), build + verify-build, size, publint + attw
```

The tests are unit tests only (`vi.mock("electron")`, jsdom and Testing Library for the page
entries); there is no real-Electron or browser test in this package. Behaviour the mocks cannot
know is measured by the programs that use it.

## Releasing

A push to `master` with a version that is not on npm yet runs `.github/workflows/publish.yml`:
the same gates, a smoke test of the packed tarball (`.` and `./renderer`, ESM and CommonJS),
`npm publish --provenance` with the repository secret `NPM_ACCESS_TOKEN`, the `v<version>` tag
and the GitHub Release from `CHANGELOG.md`.

## License

MIT
