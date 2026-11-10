import { BrowserWindow, nativeTheme } from "electron";
import type { BrowserWindowConstructorOptions, WebPreferences } from "electron";

import { APP_URL } from "../shared/app-url.constants";
import openExternal from "./open-external";
import type { UrlPolicy } from "./url-policy";

// The only web preferences an app may set. Everything that can weaken the renderer's
// isolation (sandbox, contextIsolation, nodeIntegration*, webSecurity, webviewTag,
// enableBlinkFeatures, experimentalFeatures, allowRunningInsecureContent, preload) is absent.
const SAFE_WEB_PREFERENCES = [
  "additionalArguments",
  "autoplayPolicy",
  "backgroundThrottling",
  "defaultEncoding",
  "defaultFontFamily",
  "defaultFontSize",
  "defaultMonospaceFontSize",
  "devTools",
  "disableDialogs",
  "minimumFontSize",
  "partition",
  "safeDialogs",
  "safeDialogsMessage",
  "session",
  "spellcheck",
  "textAreasAreResizable",
  "zoomFactor",
] as const satisfies readonly (keyof WebPreferences)[];

/** The web preferences that cannot weaken the renderer's isolation. */
type SafeWebPreferences = Pick<
  WebPreferences,
  (typeof SAFE_WEB_PREFERENCES)[number]
>;

type SecureWindowOptions = Omit<
  BrowserWindowConstructorOptions,
  "webPreferences" | "show"
> & {
  /** Absolute path of the bundled preload script (one CommonJS file). */
  preload: string;
  /** Decides which navigations stay in the window and which links may leave the app. */
  policy: UrlPolicy;
  /** Harmless web preferences only; the isolation settings are fixed. */
  webPreferences?: SafeWebPreferences;
  /** Route to open inside the app, like `/settings`. Default: `/`. A URL that leaves the app throws. */
  path?: string;
  /** Window background per theme, shown before the renderer paints. */
  themeBackground?: { light: string; dark: string };
  /** Called when the page fails to load. Without it the rejection reaches the global handlers. */
  onLoadError?: (error: unknown) => void;
};

// Written out, although most are Electron's defaults, so that a sentinel test can assert them
// and an Electron upgrade cannot change them silently.
const ENFORCED_WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  navigateOnDragDrop: false,
} as const satisfies WebPreferences;

const assertSafeWebPreferences = (webPreferences: object): void => {
  const allowed: readonly string[] = SAFE_WEB_PREFERENCES;
  const refused = Object.keys(webPreferences).filter(
    (key) => !allowed.includes(key)
  );
  if (refused.length > 0) {
    throw new TypeError(
      `createSecureWindow: webPreferences.${refused.join(", webPreferences.")} cannot be set; the isolation settings of a window are fixed`
    );
  }
};

/**
 * Creates a window that can only show this app: sandboxed, context-isolated, without Node,
 * unable to open windows or to navigate away. Allowed `https://` links open in the system
 * browser. The window is shown when its first frame is ready, so it never flashes white.
 */
const createSecureWindow = ({
  preload,
  policy,
  webPreferences = {},
  path = "/",
  themeBackground,
  onLoadError,
  ...windowOptions
}: SecureWindowOptions): BrowserWindow => {
  assertSafeWebPreferences(webPreferences);

  // The base is either the dev server (unpackaged only, see the policy) or the app's bundle.
  const base = policy.devServerUrl ?? APP_URL;
  const url = new URL(path, base).toString();
  // An absolute or protocol-relative `path` would resolve to a foreign page.
  if (!policy.isTrustedAppUrl(url)) {
    throw new TypeError(
      `createSecureWindow: path ${JSON.stringify(path)} must be a route inside the app, like "/settings"`
    );
  }

  const background = (): string | undefined =>
    themeBackground?.[nativeTheme.shouldUseDarkColors ? "dark" : "light"];

  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: background(),
    ...windowOptions,
    show: false,
    webPreferences: { ...webPreferences, ...ENFORCED_WEB_PREFERENCES, preload },
  });
  const { webContents } = window;

  // The renderer never opens windows; allowed external links go to the system browser.
  webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url, policy);
    return { action: "deny" };
  });

  // The app never navigates away from its own origin, directly or through a redirect.
  const guardNavigation = (
    event: { preventDefault: () => void },
    url: string
  ): void => {
    if (!policy.isTrustedAppUrl(url)) event.preventDefault();
  };
  webContents.on("will-navigate", guardNavigation);
  webContents.on("will-redirect", guardNavigation);
  webContents.on("will-attach-webview", (event) => event.preventDefault());

  if (themeBackground !== undefined) {
    const repaint = (): void =>
      window.setBackgroundColor(background() as string);
    nativeTheme.on("updated", repaint);
    window.once("closed", () => nativeTheme.removeListener("updated", repaint));
  }

  window.once("ready-to-show", () => window.show());

  const loading = window.loadURL(url);
  if (onLoadError !== undefined) loading.catch(onLoadError);

  return window;
};

export type { SafeWebPreferences, SecureWindowOptions };
export { ENFORCED_WEB_PREFERENCES };
export default createSecureWindow;
