import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);

import createUrlPolicy from "../../lib/main/url-policy";
import { fakeElectron, resetElectron } from "../helpers/core-electron";

beforeEach(() => {
  resetElectron();
});

describe("createUrlPolicy", () => {
  describe("dev server", () => {
    test("should trust a loopback dev server in an unpackaged app", () => {
      const policy = createUrlPolicy({
        devServerUrl: "http://localhost:5173/index.html",
      });
      expect(policy.devServerUrl).toBe("http://localhost:5173");
      expect(policy.isTrustedAppUrl("http://localhost:5173/settings")).toBe(
        true
      );
    });

    test("should accept https and the IPv4 and IPv6 loopback literals", () => {
      expect(
        createUrlPolicy({ devServerUrl: "https://127.0.0.1:4000" }).devServerUrl
      ).toBe("https://127.0.0.1:4000");
      expect(
        createUrlPolicy({ devServerUrl: "http://[::1]:4000" }).devServerUrl
      ).toBe("http://[::1]:4000");
    });

    test("should ignore the dev server in a packaged app", () => {
      fakeElectron.app.isPackaged = true;
      const policy = createUrlPolicy({ devServerUrl: "http://localhost:5173" });
      expect(policy.devServerUrl).toBeUndefined();
      expect(policy.isTrustedAppUrl("http://localhost:5173/")).toBe(false);
    });

    test("should ignore a dev server that is not on loopback, not http or not a URL", () => {
      expect(
        createUrlPolicy({ devServerUrl: "http://evil.example:5173" })
          .devServerUrl
      ).toBeUndefined();
      expect(
        createUrlPolicy({ devServerUrl: "file:///tmp/index.html" }).devServerUrl
      ).toBeUndefined();
      expect(
        createUrlPolicy({ devServerUrl: "not a url" }).devServerUrl
      ).toBeUndefined();
    });

    test("should read ELECTRON_RENDERER_URL by default", () => {
      vi.stubEnv("ELECTRON_RENDERER_URL", "http://127.0.0.1:5173/");
      expect(createUrlPolicy().devServerUrl).toBe("http://127.0.0.1:5173");
    });

    test("should have no dev server without the variable", () => {
      vi.stubEnv("ELECTRON_RENDERER_URL", undefined);
      expect(createUrlPolicy().devServerUrl).toBeUndefined();
    });
  });

  describe("isTrustedAppUrl", () => {
    const policy = () => createUrlPolicy({ devServerUrl: undefined });

    test("should trust app://bundle and nothing else", () => {
      expect(policy().isTrustedAppUrl("app://bundle/index.html")).toBe(true);
      expect(policy().isTrustedAppUrl("app://other/index.html")).toBe(false);
      expect(policy().isTrustedAppUrl("https://bundle/")).toBe(false);
      expect(policy().isTrustedAppUrl("file:///etc/passwd")).toBe(false);
      expect(policy().isTrustedAppUrl("::not a url")).toBe(false);
    });
  });

  describe("isAllowedExternalUrl", () => {
    test("should let nothing out by default", () => {
      expect(
        createUrlPolicy().isAllowedExternalUrl("https://example.com/")
      ).toBe(false);
    });

    test("should allow https links to listed hosts only", () => {
      const policy = createUrlPolicy({ externalHosts: ["example.com"] });
      expect(policy.isAllowedExternalUrl("https://example.com/a")).toBe(true);
      expect(policy.isAllowedExternalUrl("https://other.com/")).toBe(false);
      expect(policy.isAllowedExternalUrl("http://example.com/")).toBe(false);
      expect(policy.isAllowedExternalUrl("smb://example.com/")).toBe(false);
      expect(policy.isAllowedExternalUrl("not a url")).toBe(false);
    });

    test("should refuse a link that carries credentials", () => {
      const policy = createUrlPolicy({ externalHosts: "any-https" });
      expect(policy.isAllowedExternalUrl("https://bank.com@evil.com/")).toBe(
        false
      );
      expect(policy.isAllowedExternalUrl("https://:secret@evil.com/")).toBe(
        false
      );
    });

    test("should allow every https host with any-https", () => {
      const policy = createUrlPolicy({ externalHosts: "any-https" });
      expect(policy.isAllowedExternalUrl("https://anything.example/")).toBe(
        true
      );
    });
  });
});

describe("regression 1.0.0", () => {
  test("a listed host written in capitals still matched the lowercased hostname", () => {
    const policy = createUrlPolicy({ externalHosts: ["Example.COM"] });
    expect(policy.isAllowedExternalUrl("https://example.com/")).toBe(true);
    expect(policy.isAllowedExternalUrl("https://EXAMPLE.com/")).toBe(true);
  });
});
