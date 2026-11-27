import { describe, expect, test, vi } from "vitest";

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);

import openExternal from "../../lib/main/open-external";
import type { UrlPolicy } from "../../lib/main/url-policy";
import { fakeElectron } from "../helpers/core-electron";

const policy = (isAllowed: boolean): UrlPolicy => ({
  devServerUrl: undefined,
  isTrustedAppUrl: () => false,
  isAllowedExternalUrl: () => isAllowed,
});

describe("openExternal", () => {
  test("should open an allowed link in the system browser", async () => {
    await expect(openExternal("https://a.com/", policy(true))).resolves.toBe(
      true
    );
    expect(fakeElectron.shell.openExternal).toHaveBeenCalledWith(
      "https://a.com/"
    );
  });

  test("should refuse a link the policy does not allow, without asking the system", async () => {
    await expect(openExternal("file:///etc", policy(false))).resolves.toBe(
      false
    );
    expect(fakeElectron.shell.openExternal).not.toHaveBeenCalled();
  });

  test("should resolve false when the system cannot open it", async () => {
    fakeElectron.shell.openExternal.mockRejectedValueOnce(new Error("no"));
    await expect(openExternal("https://a.com/", policy(true))).resolves.toBe(
      false
    );
  });
});
