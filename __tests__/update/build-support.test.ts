import { beforeEach, describe, expect, test, vi } from "vitest";

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile }));

import detectBuildSupport from "../../lib/update/build-support";

const FACTS = {
  platform: "darwin",
  arch: "arm64",
  isPackaged: true,
  isDevelopmentForced: false,
  executablePath: "/Applications/Notes.app/Contents/MacOS/Notes",
};

type Callback = (error: Error | null, stdout: string, stderr: string) => void;

const answerCodesign = (error: Error | null, stderr = ""): void => {
  execFile.mockImplementation(
    (_file: string, _args: string[], _options: object, done: Callback) => {
      done(error, "", stderr);
    }
  );
};

describe("detectBuildSupport", () => {
  beforeEach(() => {
    execFile.mockReset();
  });

  test.each([[{ platform: "linux" }], [{ platform: "win32", arch: "ia32" }]])(
    "should refuse an unsupported platform",
    async (facts) => {
      expect(await detectBuildSupport({ ...FACTS, ...facts })).toBe("platform");
    }
  );

  test("should call an unpackaged run development unless forced", async () => {
    expect(await detectBuildSupport({ ...FACTS, isPackaged: false })).toBe(
      "development"
    );
    answerCodesign(null, "Authority=Developer ID Application: Example (ABC)");
    expect(
      await detectBuildSupport({
        ...FACTS,
        isPackaged: false,
        isDevelopmentForced: true,
      })
    ).toBeNull();
  });

  test("should support Windows without asking for a signature", async () => {
    expect(
      await detectBuildSupport({ ...FACTS, platform: "win32", arch: "x64" })
    ).toBeNull();
    expect(execFile).not.toHaveBeenCalled();
  });

  test("should ask codesign about the bundle on macOS", async () => {
    answerCodesign(null, "Authority=Developer ID Application: Example (ABC)");
    expect(await detectBuildSupport(FACTS)).toBeNull();
    expect(execFile).toHaveBeenCalledWith(
      "/usr/bin/codesign",
      ["--display", "--verbose=2", "/Applications/Notes.app"],
      { timeout: 5000 },
      expect.any(Function)
    );
  });

  test("should call an ad-hoc or unsigned bundle unsigned", async () => {
    answerCodesign(null, "Signature=adhoc");
    expect(await detectBuildSupport(FACTS)).toBe("unsigned");
    answerCodesign(new Error("not signed"));
    expect(await detectBuildSupport(FACTS)).toBe("unsigned");
  });
});
