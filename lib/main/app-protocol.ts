import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { net, protocol } from "electron";

import { APP_HOST, APP_SCHEME } from "../shared/app-url.constants";

type AppProtocolOptions = {
  /** Absolute path of the bundled renderer (the folder that holds `index.html`). */
  root: string;
  /** The Content-Security-Policy header sent with every response. */
  contentSecurityPolicy: string;
};

/**
 * Declares `app://` as a standard, secure scheme. Must run before the app is ready, once:
 * Electron ignores a second registration, so calling it again would silently drop other schemes.
 */
const registerAppScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
};

const respond = (status: number, text: string, csp: string): Response =>
  new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Security-Policy": csp,
      "X-Content-Type-Options": "nosniff",
    },
  });

const isFile = async (path: string): Promise<boolean> =>
  (await stat(path).catch(() => null))?.isFile() ?? false;

/**
 * Serves the bundled renderer from `app://bundle/`. Nothing outside `root` is ever served,
 * and every response carries the CSP. Call it after the app is ready and before a window loads.
 */
const registerAppProtocol = ({
  root,
  contentSecurityPolicy,
}: AppProtocolOptions): void => {
  const base = resolve(root);

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) {
      return respond(404, "Not found", contentSecurityPolicy);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return respond(405, "Method not allowed", contentSecurityPolicy);
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return respond(400, "Bad request", contentSecurityPolicy);
    }

    const target = resolve(base, `.${pathname}`);
    // Path traversal guard: an encoded "../" or a NUL byte never leaves the renderer build.
    const isInside = target === base || target.startsWith(base + sep);
    if (!isInside || pathname.includes("\0")) {
      return respond(404, "Not found", contentSecurityPolicy);
    }

    let file = target;
    if (!(await isFile(target))) {
      // A missing asset is a 404; a missing route is the client router's to resolve.
      if (extname(target) !== "") {
        return respond(404, "Not found", contentSecurityPolicy);
      }
      file = join(base, "index.html");
    }

    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", contentSecurityPolicy);
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  });
};

export type { AppProtocolOptions };
export { registerAppProtocol, registerAppScheme };
