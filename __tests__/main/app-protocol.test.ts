import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  registerAppProtocol,
  registerAppScheme,
} from "../../lib/main/app-protocol";

type ProtocolHandler = (request: Request) => Promise<Response>;

const electron = vi.hoisted(() => ({
  net: { fetch: vi.fn<(url: string) => Promise<Response>>() },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn<(scheme: string, handler: ProtocolHandler) => void>(),
  },
}));

vi.mock("electron", () => electron);

const CSP = "default-src 'self'; object-src 'none'";
const INDEX_HTML = "<!doctype html><title>The app</title>";
const APP_JS = "document.title = 'loaded';";
const SECRET = "TOP-SECRET: outside the renderer build";

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html",
  js: "text/javascript",
  txt: "text/plain",
};

let sandbox: string;
let root: string;

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "handijit-electron-app-protocol-"));
  root = join(sandbox, "renderer");
  await mkdir(join(root, "assets"), { recursive: true });
  await mkdir(join(root, "folder.d"));
  await writeFile(join(root, "index.html"), INDEX_HTML);
  await writeFile(join(root, "assets", "app.js"), APP_JS);
  await writeFile(join(root, "name with space.txt"), "spaced");
  // Files a traversal would reach: next to the root, and in a folder whose name only
  // starts with the root's name.
  await writeFile(join(sandbox, "secret.txt"), SECRET);
  await mkdir(join(sandbox, "renderer-private"));
  await writeFile(join(sandbox, "renderer-private", "secret.txt"), SECRET);
});

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  electron.protocol.registerSchemesAsPrivileged.mockReset();
  electron.protocol.handle.mockReset();
  electron.net.fetch.mockReset();
  // Stands in for Electron's `net.fetch` of a `file://` URL: answers with the real file.
  electron.net.fetch.mockImplementation(async (url) => {
    const path = fileURLToPath(url);
    const extension = path.slice(path.lastIndexOf(".") + 1);
    return new Response(await readFile(path), {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      },
    });
  });
});

/** Registers the protocol and returns the handler Electron would call for `app://` requests. */
const installHandler = (
  options: { root?: string; contentSecurityPolicy?: string } = {}
): ProtocolHandler => {
  registerAppProtocol({ root, contentSecurityPolicy: CSP, ...options });
  const handler = electron.protocol.handle.mock.calls[0]?.[1];
  if (handler === undefined) throw new Error("protocol.handle was not called");
  return handler;
};

const get = (url: string, method = "GET"): Promise<Response> =>
  installHandler()(new Request(url, { method }));

/** The paths `net.fetch` was asked to read. */
const fetchedPaths = (): string[] =>
  electron.net.fetch.mock.calls.map(([url]) => fileURLToPath(url));

const expectGuardHeaders = (response: Response): void => {
  expect(response.headers.get("Content-Security-Policy")).toBe(CSP);
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
};

describe("registerAppScheme", () => {
  test("should declare app:// as a standard, secure scheme with fetch support", () => {
    registerAppScheme();

    expect(
      electron.protocol.registerSchemesAsPrivileged
    ).toHaveBeenCalledExactlyOnceWith([
      {
        scheme: "app",
        privileges: { standard: true, secure: true, supportFetchAPI: true },
      },
    ]);
  });

  test("should not ask for a privilege that weakens the renderer", () => {
    registerAppScheme();

    const [schemes] =
      electron.protocol.registerSchemesAsPrivileged.mock.calls[0] ?? [];
    const [{ privileges }] = schemes;

    expect(privileges).not.toHaveProperty("bypassCSP");
    expect(privileges).not.toHaveProperty("corsEnabled");
    expect(privileges).not.toHaveProperty("allowServiceWorkers");
  });
});

describe("registerAppProtocol: serving the bundle", () => {
  test("should handle the app scheme, once", () => {
    installHandler();

    expect(electron.protocol.handle).toHaveBeenCalledExactlyOnceWith(
      "app",
      expect.any(Function)
    );
  });

  test("should serve index.html for the root URL", async () => {
    const response = await get("app://bundle/");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(fetchedPaths()).toEqual([join(root, "index.html")]);
  });

  test("should serve an asset with the content type net.fetch reports", async () => {
    const response = await get("app://bundle/assets/app.js");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(APP_JS);
    expect(response.headers.get("Content-Type")).toBe("text/javascript");
    expect(fetchedPaths()).toEqual([join(root, "assets", "app.js")]);
  });

  test("should ignore the query string and the fragment", async () => {
    const response = await get("app://bundle/assets/app.js?v=3#main");

    expect(await response.text()).toBe(APP_JS);
  });

  test("should decode a percent-encoded file name", async () => {
    const response = await get("app://bundle/name%20with%20space.txt");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("spaced");
  });

  test("should answer a HEAD request like a GET", async () => {
    const response = await get("app://bundle/assets/app.js", "HEAD");

    expect(response.status).toBe(200);
    expectGuardHeaders(response);
  });

  test.each([
    ["a client route", "app://bundle/settings/profile"],
    ["a folder", "app://bundle/assets"],
    ["a folder with a trailing slash", "app://bundle/assets/"],
  ])("should serve index.html for %s", async (_label, url) => {
    const response = await get(url);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
    expect(fetchedPaths()).toEqual([join(root, "index.html")]);
  });

  test.each([
    ["a missing asset", "app://bundle/assets/missing.js"],
    ["a missing page", "app://bundle/missing.html"],
    ["a folder whose name has an extension", "app://bundle/folder.d"],
  ])("should answer 404 for %s", async (_label, url) => {
    const response = await get(url);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(electron.net.fetch).not.toHaveBeenCalled();
  });

  test("should pass the status of net.fetch through", async () => {
    electron.net.fetch.mockResolvedValue(
      new Response("partial", { status: 206 })
    );

    const response = await get("app://bundle/assets/app.js");

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("partial");
    expectGuardHeaders(response);
  });

  test("should resolve a relative root against the working directory", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(sandbox);
    const handler = installHandler({ root: "renderer" });

    const response = await handler(new Request("app://bundle/assets/app.js"));

    expect(await response.text()).toBe(APP_JS);
    expect(fetchedPaths()).toEqual([join(root, "assets", "app.js")]);
  });
});

describe("registerAppProtocol: never serves a file outside the root", () => {
  // Every request below must end without `net.fetch` reading anything outside the root.
  const expectNothingOutsideRoot = async (
    response: Response
  ): Promise<void> => {
    expect(await response.text()).not.toContain("TOP-SECRET");
    for (const path of fetchedPaths()) {
      expect(path.startsWith(root + sep)).toBe(true);
    }
  };

  test.each([
    ["an encoded slash after dots", "app://bundle/..%2Fsecret.txt"],
    ["fully encoded dots and slash", "app://bundle/%2e%2e%2fsecret.txt"],
    ["an encoded slash in lower case", "app://bundle/..%2fsecret.txt"],
    [
      "a traversal from a subfolder",
      "app://bundle/assets/..%2F..%2Fsecret.txt",
    ],
    [
      "a traversal to the file system root",
      "app://bundle/..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2Fetc%2Fpasswd",
    ],
    [
      "a traversal to an extension-less file",
      "app://bundle/..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2Fetc%2Fhosts",
    ],
    ["a traversal to the parent folder", "app://bundle/..%2F"],
    [
      "a sibling folder that starts with the root's name",
      "app://bundle/..%2Frenderer-private%2Fsecret.txt",
    ],
    [
      "a sibling folder, without an extension",
      "app://bundle/..%2Frenderer-private",
    ],
  ])("should answer 404 for %s", async (_label, url) => {
    const response = await get(url);

    expect(response.status).toBe(404);
    expect(electron.net.fetch).not.toHaveBeenCalled();
    expectGuardHeaders(response);
    await expectNothingOutsideRoot(response);
  });

  test.each([
    ["plain dot segments", "app://bundle/../secret.txt", 404],
    ["encoded dot segments", "app://bundle/%2e%2e/%2e%2e/secret.txt", 404],
    ["a double slash", "app://bundle//secret.txt", 404],
    ["an absolute path after a double slash", "app://bundle//etc/hosts", 200],
    ["a backslash traversal", "app://bundle/..\\secret.txt", 404],
    ["an encoded backslash traversal", "app://bundle/..%5Csecret.txt", 404],
  ])("should stay inside the root for %s", async (_label, url, status) => {
    const response = await get(url);

    // Either nothing is read, or the path was taken as a route inside the root.
    expect(response.status).toBe(status);
    expect(fetchedPaths()).toEqual(
      status === 200 ? [join(root, "index.html")] : []
    );
    await expectNothingOutsideRoot(response);
  });

  test.each([
    ["in a route", "app://bundle/settings%00"],
    ["in the middle of a route", "app://bundle/a%00b"],
    ["after index.html", "app://bundle/index.html%00"],
    ["before an extension", "app://bundle/index%00.html"],
  ])("should answer 404 for a NUL byte %s", async (_label, url) => {
    const response = await get(url);

    expect(response.status).toBe(404);
    expect(electron.net.fetch).not.toHaveBeenCalled();
    expectGuardHeaders(response);
  });

  test.each([
    ["another host", "app://evil/index.html"],
    ["the app host with a port", "app://bundle:8080/index.html"],
    ["the app host as a subdomain", "app://bundle.evil.test/index.html"],
    ["the app host in upper case", "app://BUNDLE/index.html"],
    ["an empty host", "app:///index.html"],
  ])("should answer 404 for %s", async (_label, url) => {
    const response = await get(url);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(electron.net.fetch).not.toHaveBeenCalled();
    expectGuardHeaders(response);
  });

  test.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "should answer 405 for a %s request",
    async (method) => {
      const response = await get("app://bundle/index.html", method);

      expect(response.status).toBe(405);
      expect(await response.text()).toBe("Method not allowed");
      expect(electron.net.fetch).not.toHaveBeenCalled();
      expectGuardHeaders(response);
    }
  );

  test.each([
    ["a truncated escape", "app://bundle/%E0%A4%A"],
    ["a lone percent sign", "app://bundle/100%"],
    ["an invalid UTF-8 sequence", "app://bundle/%C0%AE%C0%AE/secret.txt"],
    ["a bad escape before a traversal", "app://bundle/%ZZ..%2Fsecret.txt"],
  ])("should answer 400 for %s", async (_label, url) => {
    const response = await get(url);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Bad request");
    expect(electron.net.fetch).not.toHaveBeenCalled();
    expectGuardHeaders(response);
  });
});

describe("registerAppProtocol: response headers", () => {
  test.each([
    ["a served file", "app://bundle/assets/app.js", "GET", 200],
    ["the index fallback", "app://bundle/some/route", "GET", 200],
    ["a missing asset", "app://bundle/missing.png", "GET", 404],
    ["a traversal", "app://bundle/..%2Fsecret.txt", "GET", 404],
    ["a foreign host", "app://evil/", "GET", 404],
    ["a refused method", "app://bundle/", "POST", 405],
    ["a bad escape", "app://bundle/%", "GET", 400],
  ])(
    "should send the CSP and nosniff with %s",
    async (_label, url, method, status) => {
      const response = await get(url, method);

      expect(response.status).toBe(status);
      expectGuardHeaders(response);
    }
  );

  test("should send the errors as plain text", async () => {
    const response = await get("app://bundle/missing.png");

    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8"
    );
  });

  test("should replace a CSP and a sniffing header that net.fetch reports", async () => {
    electron.net.fetch.mockResolvedValue(
      new Response(INDEX_HTML, {
        headers: {
          "Content-Type": "text/html",
          "Content-Security-Policy": "default-src *",
          "X-Content-Type-Options": "sniff",
          "Last-Modified": "Mon, 09 Nov 2026 10:00:00 GMT",
        },
      })
    );

    const response = await get("app://bundle/");

    expect(response.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(response.headers.get("Last-Modified")).toBe(
      "Mon, 09 Nov 2026 10:00:00 GMT"
    );
  });

  test("should send the policy it was given", async () => {
    const handler = installHandler({
      contentSecurityPolicy: "default-src 'none'",
    });

    const served = await handler(new Request("app://bundle/"));
    const refused = await handler(new Request("app://evil/"));

    expect(served.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'"
    );
    expect(refused.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'"
    );
  });
});
