import { app } from "electron";

import { APP_HOST, APP_SCHEME } from "../shared/app-url.constants";

type UrlPolicyOptions = {
  /**
   * Hosts whose `https://` links may be handed to the system browser. Default: none.
   * `"any-https"` allows every https host; use it only when links come from the user's own data.
   */
  externalHosts?: readonly string[] | "any-https";
  /** The dev server URL to trust. Default: `process.env.ELECTRON_RENDERER_URL`. Ignored when packaged. */
  devServerUrl?: string;
};

/** Decides which URLs are the app itself and which may leave the app. */
type UrlPolicy = {
  /** The dev server origin in use, or `undefined` in a packaged app. */
  readonly devServerUrl: string | undefined;
  /** Whether a URL is this app's own page: `app://bundle/…`, or the dev server in development. */
  readonly isTrustedAppUrl: (raw: string) => boolean;
  /** Whether a URL may be opened in the system browser. */
  readonly isAllowedExternalUrl: (raw: string) => boolean;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The dev server is honoured only by an unpackaged app and only on loopback: a packaged app
 * always loads its own bundle, whatever the environment says.
 */
const resolveDevServerUrl = (
  candidate: string | undefined
): string | undefined => {
  if (app.isPackaged || candidate === undefined) return undefined;
  const url = URL.parse(candidate);
  if (url === null) return undefined;
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  return isHttp && LOOPBACK_HOSTS.has(url.hostname) ? url.origin : undefined;
};

const createUrlPolicy = ({
  externalHosts = [],
  devServerUrl = process.env.ELECTRON_RENDERER_URL,
}: UrlPolicyOptions = {}): UrlPolicy => {
  const devOrigin = resolveDevServerUrl(devServerUrl);
  const hosts = externalHosts === "any-https" ? null : new Set(externalHosts);

  return {
    devServerUrl: devOrigin,
    isTrustedAppUrl: (raw) => {
      const url = URL.parse(raw);
      if (url === null) return false;
      if (devOrigin !== undefined && url.origin === devOrigin) return true;
      // Custom schemes have an opaque origin ("null"), so scheme and host are compared instead.
      return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST;
    },
    isAllowedExternalUrl: (raw) => {
      const url = URL.parse(raw);
      if (url === null || url.protocol !== "https:") return false;
      // Credentials in a link are a phishing aid ("https://bank.com@evil.example").
      if (url.username !== "" || url.password !== "") return false;
      return hosts === null || hosts.has(url.hostname);
    },
  };
};

export type { UrlPolicy, UrlPolicyOptions };
export default createUrlPolicy;
