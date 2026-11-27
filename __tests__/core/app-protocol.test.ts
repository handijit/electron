import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);

import {
  registerAppProtocol,
  registerAppScheme,
} from "../../lib/main/app-protocol";
import {
  fakeElectron,
  protocolHandlers,
  resetElectron,
} from "../helpers/core-electron";

const CSP = "default-src 'self'";
let root: string;

beforeEach(async () => {
  resetElectron();
  root = await mkdtemp(join(tmpdir(), "app-protocol-"));
  await writeFile(join(root, "index.html"), "<!doctype html>");
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets", "app.js"), "console.log(1)");
  fakeElectron.net.fetch.mockImplementation(
    async () =>
      new Response("file body", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
  );
  registerAppProtocol({ root, contentSecurityPolicy: CSP });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const serve = (url: string, method = "GET"): Promise<Response> =>
  (protocolHandlers.get("app") as (request: Request) => Promise<Response>)({
    url,
    method,
  } as Request);

const expectRefusal = async (
  response: Response,
  status: number
): Promise<void> => {
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Security-Policy")).toBe(CSP);
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Content-Type")).toBe(
    "text/plain; charset=utf-8"
  );
  expect(fakeElectron.net.fetch).not.toHaveBeenCalled();
};

describe("registerAppScheme", () => {
  test("should register app:// as a standard, secure scheme", () => {
    registerAppScheme();
    expect(
      fakeElectron.protocol.registerSchemesAsPrivileged
    ).toHaveBeenCalledWith([
      {
        scheme: "app",
        privileges: { standard: true, secure: true, supportFetchAPI: true },
      },
    ]);
  });
});

describe("registerAppProtocol", () => {
  test("should serve a file of the build with the CSP and nosniff", async () => {
    const response = await serve("app://bundle/assets/app.js");
    expect(fakeElectron.net.fetch).toHaveBeenCalledWith(
      pathToFileURL(join(root, "assets", "app.js")).toString()
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(response.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    await expect(response.text()).resolves.toBe("file body");
  });

  test("should answer HEAD like GET", async () => {
    expect((await serve("app://bundle/index.html", "HEAD")).status).toBe(200);
  });

  test("should serve index.html for the root and for an extensionless route", async () => {
    await serve("app://bundle/");
    await serve("app://bundle/settings/profile");
    const indexUrl = pathToFileURL(join(root, "index.html")).toString();
    expect(fakeElectron.net.fetch.mock.calls).toEqual([[indexUrl], [indexUrl]]);
  });

  test("should answer 404 for a missing asset instead of index.html", async () => {
    await expectRefusal(await serve("app://bundle/assets/missing.js"), 404);
  });

  test("should answer 404 for another host", async () => {
    await expectRefusal(await serve("app://evil/index.html"), 404);
  });

  test("should answer 405 for a method other than GET and HEAD", async () => {
    await expectRefusal(await serve("app://bundle/index.html", "POST"), 405);
  });

  test("should answer 400 for a malformed escape", async () => {
    await expectRefusal(await serve("app://bundle/%E0%A4%A"), 400);
  });

  test("should never leave the build through an encoded ../", async () => {
    await expectRefusal(
      await serve("app://bundle/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd"),
      404
    );
    await expectRefusal(await serve("app://bundle/..%2f..%2fsecret.txt"), 404);
  });

  test("should refuse a NUL byte in the path", async () => {
    await expectRefusal(await serve("app://bundle/index.html%00.js"), 404);
  });
});
