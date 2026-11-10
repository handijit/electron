import type { Session } from "electron";

import type { UrlPolicy } from "./url-policy";

type SessionGuardsOptions = {
  /** Decides which page counts as the app itself. */
  policy: UrlPolicy;
  /**
   * Permissions the app's own pages may use, like `"notifications"`. Default: none.
   * Screen capture is `"display-capture"` since Electron 45; `"media"` alone does not cover it.
   */
  permissions?: readonly string[];
  /** The relaxed development CSP, applied to dev server responses. Ignored when packaged. */
  devContentSecurityPolicy?: string;
};

/**
 * Denies every permission request by default, for requests and for silent checks alike, and
 * for device pickers. In development it also puts the CSP on the dev server's responses,
 * which do not pass through the `app://` handler.
 *
 * It takes the session's single `onHeadersReceived` slot when a dev server is in use.
 */
const installSessionGuards = (
  session: Session,
  { policy, permissions = [], devContentSecurityPolicy }: SessionGuardsOptions
): void => {
  const granted = new Set(permissions);
  const isGranted = (permission: string, url: string | undefined): boolean =>
    granted.has(permission) && url !== undefined && policy.isTrustedAppUrl(url);

  session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isGranted(permission, webContents.getURL()));
  });
  session.setPermissionCheckHandler((webContents, permission) =>
    isGranted(permission, webContents?.getURL())
  );
  session.setDevicePermissionHandler(() => false);

  const devOrigin = policy.devServerUrl;
  if (devOrigin !== undefined && devContentSecurityPolicy !== undefined) {
    session.webRequest.onHeadersReceived(
      { urls: [`${devOrigin}/*`] },
      (details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [devContentSecurityPolicy],
          },
        });
      }
    );
  }
};

export type { SessionGuardsOptions };
export default installSessionGuards;
