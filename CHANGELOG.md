# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-11-10

### Fixed

- A SIGTERM no longer leaves the app running without a window on macOS. `startApp` holds the
  first `before-quit` until the log is on disk and then quits again; that second `app.quit()`
  ran in the flush's promise reaction. A quit that Electron starts itself (a SIGTERM) emits
  `before-quit` from native code and drains microtasks before it returns, so the second quit
  ran inside the held one and was undone when that one returned: the windows closed,
  `window-all-closed` kept the app open (as on macOS it should), `will-quit` never came and
  the process kept its ports and files. The second quit is now asked on the next turn
  (`setImmediate`). A quit asked from JavaScript (`app.quit()`, Playwright's `close()`) was
  not affected.

### Tests

- The real-Electron smoke test has a fourth launch on macOS (and any POSIX system) that ends
  the app with one SIGTERM and checks that it exits without the SIGKILL fallback, that
  `will-quit` fires and that the lines logged before the signal are on disk. It is skipped on
  Windows, where Node's `kill()` is `TerminateProcess` and no quit runs.

## [1.1.0] - 2026-11-10

### Fixed

- A window could fall back to the light theme while main held "dark": the `@handijit/design`
  boot script keeps listening to `prefers-color-scheme` and rewrote `<html data-theme>` when
  that media query changed without main's theme changing (DevTools media emulation, which
  Playwright applies to every page it attaches to, with `_electron` and `connectOverCDP`
  alike), and main had nothing new to announce, so the page stayed wrong. `syncTheme` now
  undoes any write of the attribute that disagrees with main before the next paint, asks main
  again when the window is focused or shown, and runs once per page (a second call stops the
  first).

### Added

- `ThemeBridge.reapply()`: applies the preference to `nativeTheme` again and announces the
  state to every window, changed or not. `startApp` calls it on `powerMonitor` `resume` and
  `unlock-screen`.

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
