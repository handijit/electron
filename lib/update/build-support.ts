import { execFile } from "node:child_process";
import { resolve } from "node:path";

import type { UnsupportedReason } from "../types";

type BuildFacts = {
  /** `process.platform`. */
  platform: string;
  /** `process.arch`. */
  arch: string;
  /** `app.isPackaged`. */
  isPackaged: boolean;
  /** The program asked the engine to work in an unpackaged run. */
  isDevelopmentForced: boolean;
  /** `app.getPath("exe")`. */
  executablePath: string;
};

const CODESIGN_TIMEOUT_MS = 5000;

// `codesign` describes the signature on stderr; a bundle that is not signed makes it fail.
const readSignature = (bundlePath: string): Promise<string> =>
  new Promise((done) => {
    execFile(
      "/usr/bin/codesign",
      ["--display", "--verbose=2", bundlePath],
      { timeout: CODESIGN_TIMEOUT_MS },
      (error, stdout, stderr) => {
        done(error === null ? `${stdout}\n${stderr}` : "");
      }
    );
  });

/**
 * Whether this build can update itself, and if not, why. Asked once at start, so that a build
 * that cannot (a development run, an unsigned macOS build, another platform) says so in the
 * state instead of failing on the first check.
 *
 * Windows needs no signature: the installer is verified by its checksum from the feed. macOS
 * does: Squirrel.Mac refuses to replace an app that has no Developer ID signature.
 */
const detectBuildSupport = async ({
  platform,
  arch,
  isPackaged,
  isDevelopmentForced,
  executablePath,
}: BuildFacts): Promise<UnsupportedReason | null> => {
  if (platform !== "win32" && platform !== "darwin") return "platform";
  if (arch !== "x64" && arch !== "arm64") return "platform";
  if (!isPackaged && !isDevelopmentForced) return "development";
  if (platform === "win32") return null;

  // <name>.app/Contents/MacOS/<name>
  const bundlePath = resolve(executablePath, "../../..");
  const signature = await readSignature(bundlePath);
  return /^Authority=Developer ID Application:/m.test(signature)
    ? null
    : "unsigned";
};

export default detectBuildSupport;
