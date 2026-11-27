import { evaluateUpdatePolicy, isVersion } from "../shared/version.helper";
import type { UpdatePolicyState } from "../types";
import type { StoredPolicy } from "./types";

type EvaluateOptions = {
  /** The stored policy, or `null` when the policy endpoint never answered (or has no release). */
  stored: StoredPolicy | null;
  /** The version that is running. */
  currentVersion: string;
  /** The current time (epoch milliseconds). */
  now: number;
  /** How long a "required" verdict holds without the policy endpoint confirming it. */
  requiredTtlMs: number;
  /** When the policy endpoint last answered at all, for a policy that has no release. */
  answeredAt: number | null;
};

/** Whether a value read from disk is a policy this package wrote. */
const isStoredPolicy = (value: unknown): value is StoredPolicy => {
  if (typeof value !== "object" || value === null) return false;
  const { latestVersion, minSupportedVersion, fetchedAt } = value as Readonly<
    Record<string, unknown>
  >;
  return (
    isVersion(latestVersion) &&
    (minSupportedVersion === null || isVersion(minSupportedVersion)) &&
    typeof fetchedAt === "number" &&
    Number.isFinite(fetchedAt)
  );
};

/**
 * What the stored policy means for the running version right now.
 *
 * Without a stored policy the verdict is `ok`: a user is never locked out because the policy
 * endpoint could not be reached. A stored "required" holds for `requiredTtlMs` around the
 * moment it was fetched and then weakens to `recommended` until the endpoint confirms it. The
 * window is symmetric, so a clock moved in either direction can only end the lock early, never
 * extend it; the lock is a courtesy to the user, not a security boundary.
 */
const evaluateStoredPolicy = ({
  stored,
  currentVersion,
  now,
  requiredTtlMs,
  answeredAt,
}: EvaluateOptions): UpdatePolicyState => {
  if (stored === null) {
    return {
      verdict: "ok",
      latestVersion: null,
      minSupportedVersion: null,
      checkedAt: answeredAt,
    };
  }

  const status = evaluateUpdatePolicy(currentVersion, stored);
  const isFresh = Math.abs(now - stored.fetchedAt) <= requiredTtlMs;

  return {
    verdict:
      status === "up-to-date"
        ? "ok"
        : status === "update-required" && isFresh
          ? "required"
          : "recommended",
    latestVersion: stored.latestVersion,
    minSupportedVersion: stored.minSupportedVersion,
    checkedAt: stored.fetchedAt,
  };
};

export { evaluateStoredPolicy, isStoredPolicy };
