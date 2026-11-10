# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-11-10

### Fixed

- The quick start no longer awaits `startApp` at the top level of an ES module main: Electron
  emits `ready` only after the main module has finished evaluating, so the program hung at
  start-up. It now calls `startApp(...).catch(...)`.

## [1.0.0] - 2026-11-10

First release: the application core shared by Han Dijit's Electron desktop
programs, in four entry points (`.`, `./main`, `./preload`, `./renderer`), as ES
modules and CommonJS.

### Added

- `startApp`: starts an app in the safe order, from the single-instance lock to
  the first window, and returns the logger, the event emitter, the theme bridge
  and the URL policy.
- `createSecureWindow`: a sandboxed, context-isolated window without Node that
  cannot navigate away, open windows or attach a `<webview>`; the isolation
  settings cannot be overridden (`ENFORCED_WEB_PREFERENCES`).
- `registerAppScheme` and `registerAppProtocol`: the renderer served from
  `app://bundle/` with path traversal protection, and
  `buildContentSecurityPolicy` for the header every response carries.
- `installSessionGuards`: permissions denied by default, and the development
  policy on the dev server's responses.
- `createUrlPolicy` and `openExternal`: which URLs are the app, and which
  `https://` hosts may open in the system browser.
- `defineContract`, `registerHandlers`, `createEmitter`, `exposeBridge` and
  `createClient`: one Zod contract typed across main, preload and renderer; the
  sender frame, the input and the output of every call are checked in main, and
  failures carry an `IpcError` code.
- `acquireSingleInstance` and `findDeepLink`: the single-instance lock with the
  second launch's command line and deep link forwarded.
- `createSettingsStore`: schema-validated settings with atomic writes, recovery
  from a corrupt file and change listeners.
- `createSecretStore`: secrets on `safeStorage`, failing closed when the
  operating system offers no real encryption.
- `createLogger`, `captureUncaughtErrors` and `redactText`: a levelled,
  rotating, redacting JSON-lines logger; `log` and `forwardErrors` forward the
  renderer's lines and uncaught errors to it.
- `createThemeBridge` with `syncTheme`, `getTheme`, `setThemePreference`,
  `onThemeChange` and `applyTheme`: the theme owned by main and applied before
  the first frame, compatible with the boot script of `@handijit/design`.

[Unreleased]: https://github.com/handijit/electron/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/handijit/electron/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/handijit/electron/releases/tag/v1.0.0
