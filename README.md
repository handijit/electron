# @handijit/electron

The application core of Han Dijit's Electron desktop programs. Every program starts from the
same template; this package is the part of that template that must not differ between
programs: the secure window, the `app://` protocol and its Content-Security-Policy, the typed
and validated IPC contract, the single-instance lock, the settings and secret stores, the
logger and the theme bridge.

It ships no UI, no auto-update, no sign-in and no licensing. Those live in their own packages.

- **Four entry points, one per process.** `@handijit/electron/main`,
  `@handijit/electron/preload`, `@handijit/electron/renderer`, and `@handijit/electron` for
  what all three share. A build check keeps each entry importing only what its process can
  load: the renderer entry never touches `electron` or `node:*`, the preload entry requires
  `electron` and nothing else.
- **No runtime dependency.** `electron` and `zod` are peer dependencies.
- **Small where it matters.** Preload 1.4 kB and renderer entry 2.0 kB, gzipped.
- **ES modules and CommonJS**, with types for both.

## Install

```sh
npm install @handijit/electron zod
npm install --save-dev electron
```

| Peer       | Range              | Why                                                                                                                                             |
| ---------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron` | `>=43.0.0 <46.0.0` | The smoke test of this package passes on 43, 44 and 45. A new major is added to the range after the smoke test has run on it, never in advance. |
| `zod`      | `^4.0.0`           | Contracts are Zod 4 schemas.                                                                                                                    |

Node 24 or newer for the tooling. The main-process code runs on the Node that Electron embeds.

## Quick start

One contract, three small files.

### 1. The contract (shared)

```ts
// src/shared/contract.ts
import { defineContract } from "@handijit/electron";
import { z } from "zod";

export const contract = defineContract({
  // renderer → main, with an answer
  invoke: {
    "notes:list": {
      output: z.array(z.object({ id: z.number(), title: z.string() })),
    },
    "notes:rename": {
      input: z.object({ id: z.number(), title: z.string().min(1) }),
    },
  },
  // main → renderer
  events: {
    "sync:finished": z.object({ count: z.number() }),
  },
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
import { THEME_BOOT_SCRIPT_HASH } from "@handijit/design";
import { startApp } from "@handijit/electron/main";
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
    width: 1100,
    height: 720,
    themeBackground: { light: "#ffffff", dark: "#0b0d12" },
  },
  contentSecurityPolicy: {
    connectSrc: ["https://api.handijit.com"],
    scriptHashes: [THEME_BOOT_SCRIPT_HASH],
  },
  externalHosts: ["handijit.com"],
  deepLink: {
    scheme: "handijit-notes",
    parse: (url) =>
      url.hostname === "open" ? { noteId: url.pathname.slice(1) } : null,
    onLink: ({ noteId }) => openNote(noteId),
  },
})
  // Resolves to the app context, or to `null` when another instance is running (it was focused
  // and got this launch's link).
  .catch((error: unknown) => {
    console.error("The program could not start", error);
    app.exit(1);
  });
```

`startApp` does the start-up in the one order that is safe: single-instance lock → `app://`
scheme registration → logger and uncaught-error capture → `ready` → protocol handler,
permission guards, theme, IPC handlers → `beforeWindow` → window. Every piece is also exported
on its own for an app that needs a different shape.

### 3. preload

```ts
// src/preload/index.ts
import { exposeBridge } from "@handijit/electron/preload";
import { contract } from "../shared/contract";

exposeBridge(contract);
```

A sandboxed preload is one CommonJS file that can `require` only `electron`, so the bundler
has to inline `@handijit/electron/preload` and the contract into it. To keep Zod out of that
file, pass a plain channel map instead; the compiler rejects a map that is not exactly the
contract's channels:

```ts
import type { ChannelMap } from "@handijit/electron/preload";
import type { AppContract } from "../shared/contract";

const channels: ChannelMap<AppContract> = {
  invoke: { "notes:list": true, "notes:rename": true },
  events: { "sync:finished": true },
};
exposeBridge(channels);
```

### 4. renderer

```html
<!-- index.html, before any stylesheet. The build replaces the placeholder with
     THEME_BOOT_SCRIPT of @handijit/design. -->
<script>
  /*THEME_BOOT_SCRIPT*/
</script>
```

The CSP hash covers the exact content of the element: the build must leave nothing but
`THEME_BOOT_SCRIPT` between the tags, not even a line break, or the script is blocked.

```ts
// src/renderer/main.ts
import {
  createClient,
  forwardErrors,
  syncTheme,
} from "@handijit/electron/renderer";
import type { AppContract } from "../shared/contract";

forwardErrors(); // uncaught errors of this window go to the main log
syncTheme(); // keeps <html data-theme> equal to what main resolved, whatever else writes it

export const desktop = createClient<AppContract>();

const notes = await desktop.invoke("notes:list"); // { id: number; title: string }[]
await desktop.invoke("notes:rename", { id: 1, title: "Inbox" });
const stop = desktop.on("sync:finished", ({ count }) => console.info(count));
```

The renderer imports the contract as a type only, so no schema reaches the page bundle.

In development `startApp` loads `process.env.ELECTRON_RENDERER_URL` (what electron-vite sets)
instead of `app://bundle/`, only when the app is not packaged and the URL is a loopback
address.

## What this enforces, and why

These are the rules of the Electron guide of Han Dijit (`ELECTRON_APP.md`), turned into code
that an app cannot forget to write. Each line is covered by a unit test and, where the real
Electron has a say, by the smoke test.

| Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Why                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Window (§5).** `sandbox`, `contextIsolation`, `webSecurity` on; `nodeIntegration` (also in workers and sub-frames), `webviewTag`, `allowRunningInsecureContent`, `experimentalFeatures`, `navigateOnDragDrop` off. `SecureWindowOptions` has no field to change them, and an untyped caller that passes one gets a `TypeError`.                                                                                                                                                                                     | A renderer shows remote data. With these on, a script injected into it reaches the bridge and nothing else: no Node, no file system. |
| **Navigation (§5).** `will-navigate` and `will-redirect` are cancelled for every URL that is not the app; `window.open` is always denied; `<webview>` attachment is prevented.                                                                                                                                                                                                                                                                                                                                        | A window that can navigate can be made to show an attacker's page with the app's preload attached.                                   |
| **External links (§5).** Only `https://` URLs of the hosts in `externalHosts` reach `shell.openExternal`, and never one that carries credentials. Default: none.                                                                                                                                                                                                                                                                                                                                                      | `shell.openExternal` runs whatever handler the system has for a URL; `file:`, `smb:` or a custom scheme is code execution.           |
| **Permissions (§5).** Every permission request and permission check is denied unless the permission is listed and the asking page is the app; device access (HID, serial, USB) is always denied.                                                                                                                                                                                                                                                                                                                      | Electron grants every permission by default.                                                                                         |
| **`app://` (§5).** The renderer is served from `app://bundle/`, registered as a standard, secure scheme; never `file://`. Only `GET`/`HEAD`, only that host, only files inside `rendererRoot` after decoding and resolving the path; a missing asset is a 404, not `index.html`.                                                                                                                                                                                                                                      | `file://` gives every page the same origin as every file on the disk. A path check that runs before decoding is not a path check.    |
| **CSP (§5).** Every `app://` response carries the policy: `default-src 'self'`, script and style from the app only, inline script by hash only, no `eval`, `object-src`, `frame-src`, `form-action`, `frame-ancestors` `'none'`. Sources are checked so that a value cannot start a new directive. In development the dev server's responses get the relaxed policy through `onHeadersReceived`.                                                                                                                      | The policy is the second wall behind the sandbox: injected markup cannot run script or send data to another origin.                  |
| **IPC surface (§6).** The preload exposes one function per channel of the contract. There is no generic `invoke(channel)` and `ipcRenderer` never leaves the preload; listeners receive the payload, never the IPC event.                                                                                                                                                                                                                                                                                             | A generic gate turns one injected script into access to every handler, present and future. The event object carries `sender`.        |
| **IPC validation (§6).** Every call passes, in this order: the sender frame must be the app (`UNTRUSTED_SENDER`), the input must match its Zod schema (`INVALID_INPUT`), the handler runs, the answer must match its schema (`INVALID_OUTPUT`). Events are validated before they are sent and go only to pages that are the app.                                                                                                                                                                                      | The renderer is untrusted input. TypeScript types are erased; only the schema stands between a compromised page and the handler.     |
| **IPC errors (§6).** A handler that throws reaches the renderer as `[HANDLER_FAILED] <channel>: the handler failed`; the original error goes to `onError` (the log).                                                                                                                                                                                                                                                                                                                                                  | Error messages carry paths, SQL and tokens.                                                                                          |
| **Single instance (§7).** The lock is taken first; a second launch quits and its command line is forwarded. Deep links from `argv` and `open-url` go through the app's `parse` before `onLink`, and a throw in either is logged, not fatal.                                                                                                                                                                                                                                                                           | Two instances corrupt the same files. A deep link is a URL anyone can make the user click.                                           |
| **Settings (§8).** One JSON file, validated by a schema on every read and write, written to a temporary file and renamed. A corrupt file is set aside as `<name>.corrupt-<time>` and the defaults are used.                                                                                                                                                                                                                                                                                                           | A half-written or hand-edited file must not stop the app from starting, and must not be lost either.                                 |
| **Secrets (§8).** `safeStorage` only, one encrypted file per secret. Without OS-backed encryption (also Linux's `basic_text` backend) `set` rejects with `SecretStoreUnavailableError` and `get` resolves `null`.                                                                                                                                                                                                                                                                                                     | Falling back to plain text silently is the failure this store exists to prevent.                                                     |
| **Renderer (§10).** The renderer entry has no access to Node or Electron; everything goes through `window.desktop`.                                                                                                                                                                                                                                                                                                                                                                                                   | It is the only code that touches remote content.                                                                                     |
| **Theme (§10).** Main owns the preference and sets `nativeTheme.themeSource` before the first window exists; the window background follows it; the design boot script runs by CSP hash. `syncTheme` undoes any write of `<html data-theme>` that disagrees with main (the boot script follows `prefers-color-scheme`, which DevTools emulation changes without main changing) and asks main again when the window is focused or shown; after sleep or a locked screen main puts the preference back and announces it. | The first frame is already in the right theme: nothing flashes. A choice of dark stays dark until the user changes it.               |
| **Logging (§14).** JSON lines in `app.getPath("logs")`, rotated by size, written asynchronously and in order. Every message and context value passes the redactor: secret-looking keys, bearer tokens, JWTs, secrets in URLs, e-mail addresses. Renderer lines are schema-checked like any other IPC input.                                                                                                                                                                                                           | A log file is what users attach to a support request.                                                                                |

## API

Signatures are abridged; the type declarations carry the full documentation.

### `@handijit/electron`: shared

```ts
defineContract<const C extends Contract>(contract: C): C
channelsOf<C extends Contract>(contract: C): ChannelMap<C>

APP_SCHEME: "app"        APP_HOST: "bundle"        APP_URL: "app://bundle/"
BRIDGE_KEY: "desktop"
CORE_CHANNELS: CoreChannels
LOG_LEVELS: readonly LogLevel[]                 // debug, info, warn, error
THEME_PREFERENCES: readonly ThemePreference[]   // system, light, dark
THEME_ATTRIBUTE: "data-theme"                   // equal to @handijit/design's
THEME_STORAGE_KEY: "hd-theme"                   // equal to @handijit/design's
```

Types: `Contract`, `InvokeDefinition`, `ChannelMap<C>`, `ChannelSource`, `InvokeChannel<C>`,
`EventChannel<C>`, `InvokeInput<C, K>`, `InvokeParsedInput<C, K>`, `InvokeArgs<C, K>`,
`InvokeOutput<C, K>`, `InvokeResult<C, K>`, `EventInput<C, K>`, `EventPayload<C, K>`,
`ContractBridge<C>`, `CoreBridge`, `CoreChannels`, `DesktopBridge<C>`, `ThemePreference`,
`ResolvedTheme`, `ThemeState`, `LogLevel`, `LogContext`, `RendererLogEntry`, `Unsubscribe`.

### `@handijit/electron/main`

```ts
startApp<C, L = never>(options: StartAppOptions<C, L>): Promise<AppContext<C> | null>

type StartAppOptions<C, L> = {
  contract: C;
  handlers: (context: AppContext<C>) => Handlers<C>;
  rendererRoot: string;
  window: Omit<SecureWindowOptions, "policy" | "onLoadError">;
  contentSecurityPolicy?: Omit<ContentSecurityPolicyOptions, "devServerUrl">;
  externalHosts?: readonly string[] | "any-https";
  permissions?: readonly string[];
  log?: LoggerOptions;
  themeStore?: ThemePreferenceStore; // default: theme.json in userData
  deepLink?: {
    scheme: string;
    parse: (url: URL) => L | null;
    onLink: (link: L) => void;
    register?: boolean; // default true
  };
  beforeWindow?: (context: AppContext<C>) => Promise<void> | void;
};
type AppContext<C> = {
  logger: Logger;
  emitter: Emitter<C>;
  theme: ThemeBridge;
  policy: UrlPolicy;
  getWindow: () => BrowserWindow | null;
  showWindow: () => BrowserWindow;
};
```

Window, protocol and policy:

```ts
createUrlPolicy(options?: { externalHosts?: readonly string[] | "any-https"; devServerUrl?: string }): UrlPolicy
// UrlPolicy: { devServerUrl, isTrustedAppUrl(url), isAllowedExternalUrl(url) }
createSecureWindow(options: SecureWindowOptions): BrowserWindow
// SecureWindowOptions: BrowserWindow options without `webPreferences`/`show`, plus
// { preload, policy, webPreferences?: SafeWebPreferences, path?, themeBackground?, onLoadError? }
ENFORCED_WEB_PREFERENCES // the fixed isolation settings, for an app's own sentinel test
registerAppScheme(): void // before `ready`, once
registerAppProtocol(options: { root: string; contentSecurityPolicy: string }): void
buildContentSecurityPolicy(options?: {
  connectSrc?; scriptHashes?; imgSrc?; fontSrc?; mediaSrc?; devServerUrl?
}): string
installSessionGuards(session: Session, options: {
  policy: UrlPolicy; permissions?: readonly string[]; devContentSecurityPolicy?: string
}): void
openExternal(url: string, policy: UrlPolicy): Promise<boolean>
```

IPC:

```ts
registerHandlers<C>(contract: C, handlers: Handlers<C>, options: {
  policy: UrlPolicy; onError?: (error: IpcError, cause: unknown) => void
}): Unsubscribe
createEmitter<C>(contract: C, options: { policy: UrlPolicy }): Emitter<C>
// Emitter: { send(target: WebContents, channel, payload): boolean; broadcast(channel, payload): number }
registerCoreHandlers(options: { policy; onError?; logger: Logger; theme: ThemeBridge }): Unsubscribe
class IpcError extends Error { code: IpcErrorCode; channel: string }
// IpcErrorCode: UNTRUSTED_SENDER | INVALID_INPUT | INVALID_OUTPUT | INVALID_EVENT | HANDLER_FAILED
```

Only the message of an error crosses IPC, so it starts with the code:
`[INVALID_INPUT] notes:rename: …`. Expected failures belong in the output schema as a typed
result, not in a thrown error.

Single instance and deep links:

```ts
acquireSingleInstance(onSecondInstance: (launch: { argv; workingDirectory }) => void): boolean
findDeepLink(argv: readonly string[], scheme: string): string | undefined
```

Data:

```ts
createSettingsStore<T>(options: {
  schema: ZodType<T>; directory?; fileName?; onCorrupt?: (backupPath: string, reason: unknown) => void
}): Promise<SettingsStore<T>>
// SettingsStore: { path, get(), set(patch), reset(), onChange(listener) }
createSecretStore(options?: { directory?: string }): SecretStore
// SecretStore: { isAvailable(), get(name), set(name, value), delete(name) }
class SecretStoreUnavailableError extends Error { code: "SECRET_STORE_UNAVAILABLE" }
```

Every key of a settings schema needs a default: `schema.parse({})` is the first-run value.
Listeners of `onChange` run after the file is written; all of them run even when one throws,
and `set` then rejects with the first error.

Logging and theme:

```ts
createLogger(options?: {
  directory?; fileName?; level?; maxFileBytes?; maxFiles?; redactKeys?; mirrorToConsole?
}): Logger
// Logger: debug/info/warn/error(message, context?), child(scope), flush(), directory
captureUncaughtErrors(logger: Logger, options?: { exitOnUncaughtException?: boolean }): Unsubscribe
redactText(text: string): string
createThemeBridge(store: ThemePreferenceStore): ThemeBridge
// ThemeBridge: { getState(), setPreference(preference), reapply(), onChange(listener), dispose() }
```

Defaults: `main.log` in `app.getPath("logs")`, level `info`, rotation at 1 MiB, three rotated
files.

### `@handijit/electron/preload`

```ts
exposeBridge(channels: ChannelSource): void // the contract, or a ChannelMap<C>
```

Exposes `window.desktop = { invoke: { [channel]: fn }, on: { [channel]: fn } }` with the app's
channels and the core's own (`core-log:write`, `core-theme:get`, `core-theme:set`,
`core-theme:changed`).

### `@handijit/electron/renderer`

```ts
createClient<C extends Contract>(): Client<C>
// Client: { invoke(channel, ...input): Promise<output>; on(channel, listener): Unsubscribe }

log: { debug; info; warn; error } // (message, context?) => void; never throws
forwardErrors(): Unsubscribe

getTheme(): Promise<ThemeState>
setThemePreference(preference: ThemePreference): Promise<ThemeState>
onThemeChange(listener: (state: ThemeState) => void): Unsubscribe
applyTheme(resolved: ResolvedTheme): void
syncTheme(): Unsubscribe
```

## Not in this package

- **Window size and position** are not persisted. Keep them in a settings store and pass
  `width`, `height`, `x`, `y` to `startApp`.
- **Fuses, signing and packaging** belong to the app's build. This package assumes the
  recommended fuses but cannot set them.
- **Auto-update, sign-in, licensing and UI** are separate packages.

## Development

```sh
npm run verify          # lint, type-check, unit tests with 100% coverage, build, size, publint + attw
npm run test:electron   # launches the built package in a real Electron (needs `npm run build`)
sh scripts/smoke-test.sh  # installs the packed tarball into an empty project and uses it
```

The unit tests mock `electron`. `test:electron` is the proof that the real one behaves the way
the mocks assume: it starts a fixture app three times (ES module main, CommonJS main, dev
server) and checks the window's effective web preferences, `app://` under the CSP, typed IPC
round trips, refused payloads, senders and navigations, the theme without a flash, log
forwarding, `safeStorage` and the single-instance hand-over. Set `ELECTRON_OVERRIDE_DIST_PATH`
to run it on another Electron version.

CI runs it on `macos-latest` and `windows-latest`; a release needs both.

## License

MIT
