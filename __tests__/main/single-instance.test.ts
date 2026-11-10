import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  acquireSingleInstance,
  findDeepLink,
} from "../../lib/main/single-instance";

const mocks = vi.hoisted(() => ({
  app: {
    requestSingleInstanceLock: vi.fn<() => boolean>(),
    on: vi.fn<
      (event: string, listener: (...args: unknown[]) => void) => void
    >(),
  },
}));

vi.mock("electron", () => ({ app: mocks.app }));

beforeEach(() => {
  mocks.app.requestSingleInstanceLock.mockReset().mockReturnValue(true);
  mocks.app.on.mockReset();
});

describe("acquireSingleInstance", () => {
  test("should return false and listen to nothing when another instance holds the lock", () => {
    mocks.app.requestSingleInstanceLock.mockReturnValue(false);
    const onSecondInstance = vi.fn();

    expect(acquireSingleInstance(onSecondInstance)).toBe(false);

    expect(mocks.app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(mocks.app.on).not.toHaveBeenCalled();
    expect(onSecondInstance).not.toHaveBeenCalled();
  });

  test("should return true and listen for later launches when it gets the lock", () => {
    const onSecondInstance = vi.fn();

    expect(acquireSingleInstance(onSecondInstance)).toBe(true);

    expect(mocks.app.on).toHaveBeenCalledExactlyOnceWith(
      "second-instance",
      expect.any(Function)
    );
    expect(onSecondInstance).not.toHaveBeenCalled();
  });

  test("should hand over the command line and the working directory of every later launch", () => {
    const onSecondInstance = vi.fn();
    acquireSingleInstance(onSecondInstance);
    const listener = mocks.app.on.mock.calls[0]?.[1];

    listener?.({}, ["app.exe", "--flag", "notes://open/1"], "C:\\Users\\ada");
    listener?.({}, ["app.exe"], "/home/ada");

    expect(onSecondInstance.mock.calls).toEqual([
      [
        {
          argv: ["app.exe", "--flag", "notes://open/1"],
          workingDirectory: "C:\\Users\\ada",
        },
      ],
      [{ argv: ["app.exe"], workingDirectory: "/home/ada" }],
    ]);
  });
});

describe("findDeepLink", () => {
  test("should find the argument that is a link of the scheme", () => {
    expect(
      findDeepLink(
        ["/opt/app/app", "--no-sandbox", "handijit-notes://open/42?x=1"],
        "handijit-notes"
      )
    ).toBe("handijit-notes://open/42?x=1");
  });

  test("should return the first link when there are several", () => {
    expect(
      findDeepLink(["app", "notes://first", "notes://second"], "notes")
    ).toBe("notes://first");
  });

  test("should compare the scheme without regard to case, and return the argument as it was given", () => {
    expect(findDeepLink(["app", "NOTES://Open/1"], "notes")).toBe(
      "NOTES://Open/1"
    );
    expect(findDeepLink(["app", "notes://open/1"], "Notes")).toBe(
      "notes://open/1"
    );
  });

  test("should return undefined when no argument is a link of the scheme", () => {
    expect(findDeepLink([], "notes")).toBeUndefined();
    expect(
      findDeepLink(["app", "--flag", "/a/file.txt"], "notes")
    ).toBeUndefined();
  });

  test("should not mistake a look-alike for a link of the scheme", () => {
    expect(
      findDeepLink(
        [
          "app",
          "other://open/1",
          "notes-pro://open/1",
          "xnotes://open/1",
          "notes:/open/1",
          "notes:open",
          "--url=notes://open/1",
          "https://evil.test/?next=notes://open/1",
        ],
        "notes"
      )
    ).toBeUndefined();
  });
});
