import { resolve } from "node:path";

import { app, BrowserWindow, session } from "electron";
import { z } from "zod";

import type { Contract, ThemePreference } from "../types";
import { registerAppProtocol, registerAppScheme } from "./app-protocol";
import captureUncaughtErrors from "./capture-uncaught-errors";
import buildContentSecurityPolicy from "./content-security-policy";
import type { ContentSecurityPolicyOptions } from "./content-security-policy";
import { themePreferenceSchema } from "./core-contract";
import createEmitter from "./ipc-emitter";
import type { Emitter } from "./ipc-emitter";
import registerHandlers from "./ipc-handlers";
import type { Handlers } from "./ipc-handlers";
import createLogger from "./logger";
import type { Logger, LoggerOptions } from "./logger";
import registerCoreHandlers from "./register-core-handlers";
import createSecureWindow from "./secure-window";
import type { SecureWindowOptions } from "./secure-window";
import installSessionGuards from "./session-guards";
import createSettingsStore from "./settings-store";
import { acquireSingleInstance, findDeepLink } from "./single-instance";
import createThemeBridge from "./theme-bridge";
import type { ThemeBridge, ThemePreferenceStore } from "./theme-bridge";
import createUrlPolicy from "./url-policy";
import type { UrlPolicy } from "./url-policy";

/** What the app's own code gets to work with once the core is up. */
type AppContext<C extends Contract> = {
  /** The main-process logger. */
  readonly logger: Logger;
  /** Sends the contract's events to the renderer. */
  readonly emitter: Emitter<C>;
  /** The theme preference and its resolved value. */
  readonly theme: ThemeBridge;
  /** The URL rules in force: what is the app, what may leave it. */
  readonly policy: UrlPolicy;
  /** The main window, or `null` while none is open (macOS keeps the app alive without one). */
  readonly getWindow: () => BrowserWindow | null;
  /** Brings the main window to the front, creating it when none is open. */
  readonly showWindow: () => BrowserWindow;
};

type DeepLinkOptions<L> = {
  /** The URL scheme the app registers, without `://`, like `handijit-notes`. */
  scheme: string;
  /**
   * Validates an incoming link and turns it into the app's own typed value, or `null` to
   * ignore it. The URL is untrusted input: accept only known paths and parameters.
   */
  parse: (url: URL) => L | null;
  /** Receives every accepted link, after the main window exists. */
  onLink: (link: L) => void;
  /**
   * Make this app the system's handler of the scheme at start. Default: `true`. Turn it off
   * where the installer owns the registration, and in tests that must not touch the machine.
   */
  register?: boolean;
};

type StartAppOptions<C extends Contract, L> = {
  /** The app's IPC contract. */
  contract: C;
  /** Builds the handler of every request–response channel. Called once, before the window opens. */
  handlers: (context: AppContext<C>) => Handlers<C>;
  /** Absolute path of the bundled renderer (the folder that holds `index.html`). */
  rendererRoot: string;
  /** The main window: at least the absolute path of the bundled preload script. */
  window: Omit<SecureWindowOptions, "policy" | "onLoadError">;
  /** Content-Security-Policy additions: API origins, the theme boot script hash. */
  contentSecurityPolicy?: Omit<ContentSecurityPolicyOptions, "devServerUrl">;
  /** Hosts whose `https://` links open in the system browser. Default: none. */
  externalHosts?: readonly string[] | "any-https";
  /** Permissions the app's own pages may use. Default: none. */
  permissions?: readonly string[];
  /** Logger settings. */
  log?: LoggerOptions;
  /** Where the theme preference lives. Default: a `theme.json` file in `userData`. */
  themeStore?: ThemePreferenceStore;
  /** Deep link handling. Leave it out for an app without a URL scheme. */
  deepLink?: DeepLinkOptions<L>;
  /** Runs after the security setup and before the window: migrations, opening a database. */
  beforeWindow?: (context: AppContext<C>) => Promise<void> | void;
};

const createThemeFileStore = async (): Promise<ThemePreferenceStore> => {
  const store = await createSettingsStore({
    schema: z.object({ theme: themePreferenceSchema.default("system") }),
    fileName: "theme.json",
  });
  return {
    get: (): ThemePreference => store.get().theme,
    set: (theme) => store.set({ theme }),
  };
};

const registerScheme = (scheme: string): void => {
  const script = process.argv[1];
  if (app.isPackaged || script === undefined) {
    app.setAsDefaultProtocolClient(scheme);
    return;
  }
  // An unpackaged app is "electron <script>": Windows needs both to start it from a link.
  app.setAsDefaultProtocolClient(scheme, process.execPath, [resolve(script)]);
};

/**
 * Starts an app in the one order that is safe: single-instance lock → scheme registration →
 * `ready` → protocol handler, permission and navigation guards, IPC handlers → `beforeWindow`
 * → window. No window exists before the security setup does.
 *
 * Resolves with `null` when another instance already runs; that instance is focused and
 * receives this launch's deep link, and this process quits.
 */
const startApp = async <C extends Contract, L = never>({
  contract,
  handlers,
  rendererRoot,
  window: windowOptions,
  contentSecurityPolicy = {},
  externalHosts,
  permissions,
  log,
  themeStore,
  deepLink,
  beforeWindow,
}: StartAppOptions<C, L>): Promise<AppContext<C> | null> => {
  let context: AppContext<C> | null = null;
  // Links that arrive before the window exists (a cold start through the URL scheme) wait here.
  const earlyLinks: string[] = [];

  const acceptLink = (raw: string | undefined): void => {
    if (deepLink === undefined || raw === undefined) return;
    if (context === null) {
      // Bounded: only a launch storm before `ready` could add more than one.
      if (earlyLinks.length < 16) earlyLinks.push(raw);
      return;
    }
    const url = URL.parse(raw);
    // The app's own parser and receiver run on untrusted input from an OS event: a throw
    // there is logged, it does not become an uncaught exception that ends the app.
    try {
      const link =
        url !== null && url.protocol === `${deepLink.scheme.toLowerCase()}:`
          ? deepLink.parse(url)
          : null;
      if (link === null) {
        context.logger.warn("Ignored a deep link that did not validate");
        return;
      }
      deepLink.onLink(link);
    } catch (error) {
      context.logger.error("A deep link could not be handled", { error });
    }
  };

  const hasLock = acquireSingleInstance(({ argv }) => {
    context?.showWindow();
    if (deepLink !== undefined) acceptLink(findDeepLink(argv, deepLink.scheme));
  });
  if (!hasLock) {
    app.quit();
    return null;
  }

  registerAppScheme();
  const logger = createLogger(log);
  captureUncaughtErrors(logger);

  if (deepLink !== undefined) {
    if (deepLink.register !== false) registerScheme(deepLink.scheme);
    // macOS delivers links through this event, also for the launch that starts the app.
    app.on("open-url", (event, url) => {
      event.preventDefault();
      context?.showWindow();
      acceptLink(url);
    });
  }

  await app.whenReady();

  const policy = createUrlPolicy({ externalHosts });
  const devServerUrl = policy.devServerUrl;
  registerAppProtocol({
    root: rendererRoot,
    contentSecurityPolicy: buildContentSecurityPolicy(contentSecurityPolicy),
  });
  installSessionGuards(
    windowOptions.webPreferences?.session ?? session.defaultSession,
    {
      policy,
      permissions,
      devContentSecurityPolicy:
        devServerUrl === undefined
          ? undefined
          : buildContentSecurityPolicy({
              ...contentSecurityPolicy,
              devServerUrl,
            }),
    }
  );

  const theme = createThemeBridge(themeStore ?? (await createThemeFileStore()));
  const ipcOptions = {
    policy,
    onError: (error: Error): void => logger.warn(error.message),
  };

  let mainWindow: BrowserWindow | null = null;
  const openWindow = (): BrowserWindow => {
    const window = createSecureWindow({
      ...windowOptions,
      policy,
      onLoadError: (error) =>
        logger.error("The window failed to load", { error }),
    });
    window.once("closed", () => {
      if (mainWindow === window) mainWindow = null;
    });
    mainWindow = window;
    return window;
  };

  const ready: AppContext<C> = {
    logger,
    emitter: createEmitter(contract, { policy }),
    theme,
    policy,
    getWindow: () => mainWindow,
    showWindow: () => {
      const window = mainWindow ?? openWindow();
      if (window.isMinimized()) window.restore();
      window.focus();
      return window;
    },
  };

  registerCoreHandlers({ ...ipcOptions, logger, theme });
  registerHandlers(contract, handlers(ready), ipcOptions);

  app.on("render-process-gone", (_event, _webContents, details) => {
    logger.error("A renderer process is gone", { ...details });
  });
  app.on("child-process-gone", (_event, details) => {
    logger.error("A child process is gone", { ...details });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
  let isFlushed = false;
  let flushing: Promise<void> | undefined;
  app.on("before-quit", (event) => {
    if (isFlushed) return;
    // Hold the quit until the last log lines are on disk, then let it through, once.
    event.preventDefault();
    flushing ??= logger.flush().finally(() => {
      isFlushed = true;
      app.quit();
    });
  });

  await beforeWindow?.(ready);
  openWindow();

  context = ready;
  if (deepLink !== undefined) {
    // Windows and Linux pass the link that started the app on its own command line.
    acceptLink(findDeepLink(process.argv, deepLink.scheme));
    for (const link of earlyLinks.splice(0)) acceptLink(link);
  }

  return ready;
};

export type { AppContext, DeepLinkOptions, StartAppOptions };
export default startApp;
