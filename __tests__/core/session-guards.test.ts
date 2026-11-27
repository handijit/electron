import { describe, expect, test, vi } from "vitest";

import installSessionGuards from "../../lib/main/session-guards";
import type { UrlPolicy } from "../../lib/main/url-policy";
import { createSession } from "../helpers/core-electron";

vi.mock("electron", () => ({}));

const policy = (devServerUrl?: string): UrlPolicy => ({
  devServerUrl,
  isTrustedAppUrl: (url) => url.startsWith("app://bundle/"),
  isAllowedExternalUrl: () => false,
});

type RequestHandler = (
  contents: { getURL: () => string },
  permission: string,
  callback: (isGranted: boolean) => void
) => void;
type CheckHandler = (
  contents: { getURL: () => string } | null,
  permission: string
) => boolean;

const install = (
  options: Partial<Parameters<typeof installSessionGuards>[1]> = {}
) => {
  const session = createSession();
  installSessionGuards(session as never, { policy: policy(), ...options });
  return {
    session,
    request: session.setPermissionRequestHandler.mock
      .calls[0]?.[0] as RequestHandler,
    check: session.setPermissionCheckHandler.mock.calls[0]?.[0] as CheckHandler,
    device: session.setDevicePermissionHandler.mock
      .calls[0]?.[0] as () => boolean,
  };
};

const page = (url: string) => ({ getURL: () => url });

describe("installSessionGuards", () => {
  test("should deny every permission request by default", () => {
    const { request } = install();
    const callback = vi.fn();
    request(page("app://bundle/"), "notifications", callback);
    expect(callback).toHaveBeenCalledWith(false);
  });

  test("should grant a listed permission to the app's own page only", () => {
    const { request } = install({ permissions: ["notifications"] });
    const callback = vi.fn();
    request(page("app://bundle/"), "notifications", callback);
    request(page("https://evil.example/"), "notifications", callback);
    request(page("app://bundle/"), "media", callback);
    expect(callback.mock.calls).toEqual([[true], [false], [false]]);
  });

  test("should answer silent checks the same way, also without a page", () => {
    const { check } = install({ permissions: ["clipboard-read"] });
    expect(check(page("app://bundle/"), "clipboard-read")).toBe(true);
    expect(check(page("app://bundle/"), "geolocation")).toBe(false);
    expect(check(null, "clipboard-read")).toBe(false);
  });

  test("should always deny device access", () => {
    expect(install({ permissions: ["hid"] }).device()).toBe(false);
  });

  test("should put the development policy on the dev server's responses", () => {
    const { session } = install({
      policy: policy("http://localhost:5173"),
      devContentSecurityPolicy: "default-src 'self' 'unsafe-inline'",
    });
    const [filter, listener] = session.webRequest.onHeadersReceived.mock
      .calls[0] as [
      { urls: string[] },
      (
        details: { responseHeaders: Record<string, string[]> },
        callback: (response: unknown) => void
      ) => void,
    ];
    expect(filter).toEqual({ urls: ["http://localhost:5173/*"] });
    const callback = vi.fn();
    listener({ responseHeaders: { "X-Test": ["1"] } }, callback);
    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        "X-Test": ["1"],
        "Content-Security-Policy": ["default-src 'self' 'unsafe-inline'"],
      },
    });
  });

  test("should not touch headers without a dev server or without a policy", () => {
    expect(
      install({ devContentSecurityPolicy: "x" }).session.webRequest
        .onHeadersReceived
    ).not.toHaveBeenCalled();
    expect(
      install({ policy: policy("http://localhost:5173") }).session.webRequest
        .onHeadersReceived
    ).not.toHaveBeenCalled();
  });
});
