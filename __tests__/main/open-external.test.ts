import { beforeEach, describe, expect, test, vi } from "vitest";

import openExternal from "../../lib/main/open-external";
import createUrlPolicy from "../../lib/main/url-policy";

const electron = vi.hoisted(() => ({
  app: { isPackaged: true },
  shell: { openExternal: vi.fn<(url: string) => Promise<void>>() },
}));

vi.mock("electron", () => electron);

const policy = createUrlPolicy({ externalHosts: ["example.com"] });

beforeEach(() => {
  electron.shell.openExternal.mockReset();
  electron.shell.openExternal.mockResolvedValue(undefined);
});

describe("openExternal", () => {
  test("should open an allowed link in the system browser", async () => {
    const opened = await openExternal("https://example.com/docs", policy);

    expect(opened).toBe(true);
    expect(electron.shell.openExternal).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/docs"
    );
  });

  test.each([
    ["a host that is not in the allow-list", "https://evil.test/"],
    ["a link that is not https", "http://example.com/"],
    ["a link with credentials", "https://user:secret@example.com/"],
    ["a file URL", "file:///Applications/Calculator.app"],
    ["a javascript URL", "javascript:alert(1)"],
    ["text that is not a URL", "example.com"],
  ])("should refuse %s without calling the shell", async (_label, url) => {
    const opened = await openExternal(url, policy);

    expect(opened).toBe(false);
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
  });

  test("should ask the policy about the exact URL it was given", async () => {
    const isAllowedExternalUrl = vi.fn(() => false);

    await openExternal("https://example.com/a", {
      ...policy,
      isAllowedExternalUrl,
    });

    expect(isAllowedExternalUrl).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/a"
    );
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
  });

  test("should resolve with false, not throw, when the shell fails", async () => {
    electron.shell.openExternal.mockRejectedValue(new Error("no browser"));

    await expect(openExternal("https://example.com/", policy)).resolves.toBe(
      false
    );
    expect(electron.shell.openExternal).toHaveBeenCalledOnce();
  });
});
