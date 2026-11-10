import { beforeEach, describe, expect, test, vi } from "vitest";

import createUrlPolicy from "../../lib/main/url-policy";

const electron = vi.hoisted(() => ({ app: { isPackaged: false } }));

vi.mock("electron", () => electron);

beforeEach(() => {
  electron.app.isPackaged = false;
  vi.stubEnv("ELECTRON_RENDERER_URL", undefined);
});

describe("createUrlPolicy: the dev server", () => {
  test.each([
    ["http://localhost:5173", "http://localhost:5173"],
    ["http://localhost:5173/some/page?x=1#top", "http://localhost:5173"],
    ["https://localhost:5173/", "https://localhost:5173"],
    ["http://127.0.0.1:3000/", "http://127.0.0.1:3000"],
    ["http://[::1]:5173/", "http://[::1]:5173"],
  ])(
    "should trust the loopback dev server %s in an unpackaged app",
    (devServerUrl, origin) => {
      const policy = createUrlPolicy({ devServerUrl });

      expect(policy.devServerUrl).toBe(origin);
      expect(policy.isTrustedAppUrl(`${origin}/index.html`)).toBe(true);
    }
  );

  test("should never trust the dev server in a packaged app", () => {
    electron.app.isPackaged = true;
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173");

    const fromEnvironment = createUrlPolicy();
    const fromOption = createUrlPolicy({
      devServerUrl: "http://localhost:5173",
    });

    for (const policy of [fromEnvironment, fromOption]) {
      expect(policy.devServerUrl).toBeUndefined();
      expect(policy.isTrustedAppUrl("http://localhost:5173/")).toBe(false);
    }
  });

  test.each([
    ["a remote host", "http://example.com:5173"],
    ["a host that only starts with localhost", "http://localhost.evil.test"],
    ["a loopback name used as credentials", "http://localhost@evil.test"],
    ["a private network address", "http://192.168.1.10:5173"],
    ["every interface", "http://0.0.0.0:5173"],
    ["a file URL", "file:///Users/someone/index.html"],
    ["a WebSocket URL on loopback", "ws://localhost:5173"],
    ["a custom scheme on loopback", "evil://localhost/"],
    ["text that is not a URL", "not a url"],
    ["an empty string", ""],
  ])("should not trust a dev server that is %s", (_label, devServerUrl) => {
    const policy = createUrlPolicy({ devServerUrl });

    expect(policy.devServerUrl).toBeUndefined();
    expect(policy.isTrustedAppUrl(devServerUrl)).toBe(false);
  });

  test("should read the dev server from ELECTRON_RENDERER_URL by default", () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173/");

    expect(createUrlPolicy().devServerUrl).toBe("http://localhost:5173");
  });

  test("should prefer the devServerUrl option over the environment", () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173/");

    const policy = createUrlPolicy({ devServerUrl: "http://127.0.0.1:4000" });

    expect(policy.devServerUrl).toBe("http://127.0.0.1:4000");
  });

  test("should have no dev server when none is configured", () => {
    const policy = createUrlPolicy();

    expect(policy.devServerUrl).toBeUndefined();
    expect(policy.isTrustedAppUrl("http://localhost:5173/")).toBe(false);
  });
});

describe("createUrlPolicy: isTrustedAppUrl", () => {
  test.each([
    "app://bundle/",
    "app://bundle/index.html",
    "app://bundle/settings?tab=about#top",
  ])("should trust the app's own page %s", (url) => {
    expect(createUrlPolicy().isTrustedAppUrl(url)).toBe(true);
  });

  test.each([
    ["another host on the app scheme", "app://evil/index.html"],
    ["the app host with a port", "app://bundle:8080/"],
    ["the app host as a subdomain", "app://bundle.evil.test/"],
    ["the app host on https", "https://bundle/"],
    ["the app host on http", "http://bundle/"],
    ["a file URL", "file:///bundle/index.html"],
    ["a remote page", "https://example.com/"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<p>hi</p>"],
    ["about:blank", "about:blank"],
    ["text that is not a URL", "bundle/index.html"],
    ["an empty string", ""],
  ])("should not trust %s", (_label, url) => {
    expect(createUrlPolicy().isTrustedAppUrl(url)).toBe(false);
  });

  test("should trust only the exact origin of the dev server", () => {
    const policy = createUrlPolicy({ devServerUrl: "http://localhost:5173" });

    expect(policy.isTrustedAppUrl("http://localhost:5173/src/main.ts")).toBe(
      true
    );
    expect(policy.isTrustedAppUrl("app://bundle/")).toBe(true);
    expect(policy.isTrustedAppUrl("http://localhost:5174/")).toBe(false);
    expect(policy.isTrustedAppUrl("https://localhost:5173/")).toBe(false);
    expect(policy.isTrustedAppUrl("http://127.0.0.1:5173/")).toBe(false);
    expect(policy.isTrustedAppUrl("http://localhost:5173@evil.test/")).toBe(
      false
    );
  });
});

describe("createUrlPolicy: isAllowedExternalUrl", () => {
  test("should allow no external link by default", () => {
    const policy = createUrlPolicy();

    expect(policy.isAllowedExternalUrl("https://example.com/")).toBe(false);
  });

  test("should allow an https link to a listed host only", () => {
    const policy = createUrlPolicy({
      externalHosts: ["example.com", "docs.example.com"],
    });

    expect(policy.isAllowedExternalUrl("https://example.com/")).toBe(true);
    expect(policy.isAllowedExternalUrl("https://example.com:8443/a?b#c")).toBe(
      true
    );
    expect(policy.isAllowedExternalUrl("https://docs.example.com/x")).toBe(
      true
    );
    expect(policy.isAllowedExternalUrl("https://www.example.com/")).toBe(false);
    expect(policy.isAllowedExternalUrl("https://example.com.evil.test/")).toBe(
      false
    );
    expect(policy.isAllowedExternalUrl("https://evil.test/example.com")).toBe(
      false
    );
  });

  test.each([
    ["http", "http://example.com/"],
    ["file", "file:///etc/passwd"],
    ["javascript", "javascript:alert(1)"],
    ["mailto", "mailto:someone@example.com"],
    ["a custom scheme", "ms-settings://example.com"],
    ["the app scheme", "app://bundle/"],
  ])("should refuse a link that uses %s, not https", (_label, url) => {
    const listed = createUrlPolicy({ externalHosts: ["example.com"] });
    const anyHost = createUrlPolicy({ externalHosts: "any-https" });

    expect(listed.isAllowedExternalUrl(url)).toBe(false);
    expect(anyHost.isAllowedExternalUrl(url)).toBe(false);
  });

  test.each([
    ["a user name", "https://example.com@evil.test/"],
    ["a user name on a listed host", "https://user@example.com/"],
    ["a user name and a password", "https://user:secret@example.com/"],
    ["a password only", "https://:secret@example.com/"],
  ])("should refuse an https link that carries %s", (_label, url) => {
    const listed = createUrlPolicy({
      externalHosts: ["example.com", "evil.test"],
    });
    const anyHost = createUrlPolicy({ externalHosts: "any-https" });

    expect(listed.isAllowedExternalUrl(url)).toBe(false);
    expect(anyHost.isAllowedExternalUrl(url)).toBe(false);
  });

  test.each(["not a url", "", "//example.com/", "/relative/path"])(
    "should refuse %j, which is not an absolute URL",
    (url) => {
      const policy = createUrlPolicy({ externalHosts: "any-https" });

      expect(policy.isAllowedExternalUrl(url)).toBe(false);
    }
  );

  test('should allow every https host with "any-https"', () => {
    const policy = createUrlPolicy({ externalHosts: "any-https" });

    expect(policy.isAllowedExternalUrl("https://example.com/")).toBe(true);
    expect(policy.isAllowedExternalUrl("https://anything.test/a/b")).toBe(true);
  });
});
