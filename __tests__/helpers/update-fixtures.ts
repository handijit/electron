import type { UpdateInfo, UpdateState } from "../../lib/types";

/** A version the feed offers, with every optional field filled. */
const INFO: UpdateInfo = {
  version: "1.5.0",
  releaseDate: "2026-11-10T09:00:00.000Z",
  releaseNotes: "Faster start.",
  sizeBytes: 88_000_000,
};

/** A complete state; override what a test needs. */
const makeState = (
  overrides: Partial<Record<string, unknown>> = {}
): UpdateState =>
  ({
    status: "idle",
    revision: 1,
    currentVersion: "1.4.0",
    policy: {
      verdict: "ok",
      latestVersion: null,
      minSupportedVersion: null,
      checkedAt: null,
    },
    checkedAt: null,
    isInstallPending: false,
    ...overrides,
  }) as UpdateState;

/** A policy block for `makeState`. */
const policyOf = (
  verdict: "ok" | "recommended" | "required",
  latestVersion: string | null = "1.5.0"
): UpdateState["policy"] => ({
  verdict,
  latestVersion,
  minSupportedVersion: verdict === "required" ? "1.5.0" : null,
  checkedAt: 1,
});

export { INFO, makeState, policyOf };
