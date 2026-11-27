import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);

import {
  acquireSingleInstance,
  findDeepLink,
} from "../../lib/main/single-instance";
import { fakeElectron, resetElectron } from "../helpers/core-electron";

beforeEach(() => {
  resetElectron();
});

describe("acquireSingleInstance", () => {
  test("should hand a second launch's command line to the running instance", () => {
    const onSecondInstance = vi.fn();
    expect(acquireSingleInstance(onSecondInstance)).toBe(true);
    fakeElectron.app.emit(
      "second-instance",
      {},
      ["app", "my-notes://open/1"],
      "/home"
    );
    expect(onSecondInstance).toHaveBeenCalledWith({
      argv: ["app", "my-notes://open/1"],
      workingDirectory: "/home",
    });
  });

  test("should answer false and listen to nothing when another instance runs", () => {
    fakeElectron.app.requestSingleInstanceLock.mockReturnValue(false);
    expect(acquireSingleInstance(vi.fn())).toBe(false);
    expect(fakeElectron.app.listenerCount("second-instance")).toBe(0);
  });
});

describe("findDeepLink", () => {
  test("should find the first link of the scheme, in any case", () => {
    expect(
      findDeepLink(
        ["app.exe", "--flag", "My-Notes://open/1", "my-notes://open/2"],
        "my-notes"
      )
    ).toBe("My-Notes://open/1");
  });

  test("should find nothing on a command line without one", () => {
    expect(findDeepLink(["app.exe", "my-notes:open"], "my-notes")).toBe(
      undefined
    );
  });
});
