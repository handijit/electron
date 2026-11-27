# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-27

First release. Ports `@handijit/electron` 1.1.1, `@handijit/auth` 1.0.2 and
`@handijit/electron-update` 1.0.1 into one package with nine entries (`.`, `./main`,
`./preload`, `./renderer`, `./auth`, `./auth-react`, `./update`, `./update-react`,
`./update-ui`) and `./styles.css`, as ES modules and CommonJS.

### Added

- `listPrinters(webContents)` and `printSilently(webContents, { deviceName, pageSize, margins, … })`
  in `./main`: silent printing for label and receipt printers. The printer must exist by name;
  expected failures resolve as `{ ok: false, reason }`.
- `./auth`: options for every part of the server (`authorizeUrl`, `tokenEndpoint`,
  `refreshEndpoint`, `revokeEndpoint`, `clientId`, `scope`, `authorizeParams`,
  `buildTokenRequest`, `buildRevokeRequest`, `parseTokenResponse`, `isAccountAllowed`), with
  OAuth 2.0 defaults; `auth.fetch` (restricted to `apiOrigins`) and `auth.getAccessToken()`;
  the `ACCESS_DENIED` code for a declined consent (`error=` on the callback); replaceable texts
  of the return pages (`returnPage`).
- `./update`: the policy endpoint is an option (`policy: { url, parse?, fetch?, timeoutMs? }`),
  `errorMessages` replaces the state's messages.

### Changed (from the `@handijit/*` packages)

- Renamed to `@handijitcom/electron`; the auth and update packages are entries of it. Entries
  reach each other by the published name.
- `./auth` no longer knows any server: no default URL, no `product`, no `@handijit/core` API
  client (`auth.client` is replaced by `auth.fetch`). `AuthUser.id` is a string, `name` and
  `email` may be `null`; `NOT_A_CUSTOMER` is `ACCOUNT_NOT_ALLOWED`. The return pages carry no
  brand and serve `/done`.
- `./update` no longer has download, feed or policy defaults: `feedUrl` and `downloadPageUrl`
  are required, and without `policy` no version is ever required.
- The PKCE and version helpers come from `@handijitcom/api-client` (`/pkce`, `/version`), the
  successor of `@handijit/core`: an optional peer (`^1.0.0`) that `./auth` and `./update` need;
  the other entries do not load it. Its `codeChallengeOf` is asynchronous (WebCrypto) and its
  `evaluateUpdatePolicy` checks every version before comparing; neither changes what `./auth`
  or `./update` do.
- `react >=18` is tested: the page tests run on React 19 and on React 18.
- Tooling: ESLint, Prettier, the TypeScript base and the Vitest preset come from
  `@handijitcom/config` 1.0.0, with its type-aware promise rules on the source and the tests.
  CI verifies every pull request and every push to a branch other than `master` on Node 24 and
  26, with the tarball smoke test.
- `./update-ui` is drawn with `@handijitcom/ui` 3 and its tokens (`--hd-info-fg` replaces the
  removed `--hd-success-fg`).

### Fixed

- `externalHosts` matched case-sensitively, so `Example.com` never matched a link (URL parsing
  lowercases the host).
- A corrupt settings file that could not be renamed aside (permissions, a read-only folder)
  stopped the app from starting; the defaults are now used and `onCorrupt` receives `null`.

### Removed

- The real-Electron smoke tests and screenshot scripts of the old packages: this package has
  unit tests only.

[Unreleased]: https://github.com/handijit/electron/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/handijit/electron/releases/tag/v1.0.0
