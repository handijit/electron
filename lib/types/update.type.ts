import type { ZodType } from "zod";

/** What the updater is doing right now. */
type UpdateStatus =
  | "idle"
  | "unsupported"
  | "checking"
  | "not-available"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

/**
 * What the version policy says about the installed version: `ok` (nothing to do),
 * `recommended` (a newer version is published) or `required` (the installed version is below
 * the supported minimum and must not be used until it is updated).
 */
type UpdateVerdict = "ok" | "recommended" | "required";

/**
 * Why this build cannot update itself: `development` (not a packaged app), `unsigned` (a macOS
 * build without a Developer ID signature) or `platform` (neither Windows nor macOS, or an
 * architecture no release is built for).
 */
type UnsupportedReason = "development" | "unsigned" | "platform";

/** The stable code of a failure; the text shown to the user is `UpdateError.message`. */
type UpdateErrorCode =
  | "OFFLINE"
  | "SERVER"
  | "INVALID_FEED"
  | "CHECKSUM"
  | "SIGNATURE"
  | "DISK"
  | "INSTALL"
  | "NOT_IN_APPLICATIONS"
  | "UNKNOWN";

/** The version the feed offers. */
type UpdateInfo = {
  /** The version that can be installed, e.g. `1.5.0`. */
  readonly version: string;
  /** When it was released (ISO 8601), when the feed says so. */
  readonly releaseDate: string | null;
  /** The release notes as plain text, when the feed has them. Never HTML. */
  readonly releaseNotes: string | null;
  /** The size of the full download in bytes, when the feed says so. */
  readonly sizeBytes: number | null;
};

/** How far a download is. */
type UpdateProgress = {
  /** 0 to 100. */
  readonly percent: number;
  /** Bytes received so far. */
  readonly transferredBytes: number;
  /** Bytes of the whole download; 0 while unknown. */
  readonly totalBytes: number;
  /** The current speed in bytes per second. */
  readonly bytesPerSecond: number;
};

/** A failure, ready to be shown. */
type UpdateError = {
  /** The stable code: branch on this. */
  readonly code: UpdateErrorCode;
  /** One or two sentences for the user. */
  readonly message: string;
};

/** The version policy as it applies to the installed version. */
type UpdatePolicyState = {
  /** Whether the program may go on being used. */
  readonly verdict: UpdateVerdict;
  /** The newest published version, when the policy is known. */
  readonly latestVersion: string | null;
  /** The oldest supported version, when the policy sets one. */
  readonly minSupportedVersion: string | null;
  /** When the policy endpoint last answered (epoch milliseconds); `null` before the first answer. */
  readonly checkedAt: number | null;
};

/** The part of the state that depends on the status. */
type UpdateActivity =
  | { readonly status: "idle" }
  | { readonly status: "unsupported"; readonly reason: UnsupportedReason }
  | { readonly status: "checking" }
  | { readonly status: "not-available" }
  | { readonly status: "available"; readonly update: UpdateInfo }
  | {
      readonly status: "downloading";
      readonly update: UpdateInfo;
      readonly progress: UpdateProgress;
    }
  | { readonly status: "downloaded"; readonly update: UpdateInfo }
  | {
      readonly status: "error";
      readonly error: UpdateError;
      /** The update the failure belongs to; when set, retrying means downloading it again. */
      readonly update: UpdateInfo | null;
    };

/** The part of the state every status carries. */
type UpdateContext = {
  /** Counts the changes. A snapshot with a lower number is older. */
  readonly revision: number;
  /** The version that is running. */
  readonly currentVersion: string;
  /** The version policy as it applies to the running version. */
  readonly policy: UpdatePolicyState;
  /** When the feed was last read successfully (epoch milliseconds). */
  readonly checkedAt: number | null;
  /** An install was asked for: the program restarts as soon as the update is ready. */
  readonly isInstallPending: boolean;
};

/** Everything the interface needs to know about updates. Plain data: survives IPC and JSON. */
type UpdateState = UpdateActivity & UpdateContext;

type UpdateStateSchema = ZodType<UpdateState, UpdateState>;

/**
 * The IPC surface of the updater as types. `updateContract` in the `/update` entry is the
 * value; a program that spreads it into its own contract gets these channels typed on both
 * sides.
 */
type UpdateContract = {
  readonly invoke: {
    readonly "update:get-state": { readonly output: UpdateStateSchema };
    readonly "update:check": { readonly output: UpdateStateSchema };
    readonly "update:download": { readonly output: UpdateStateSchema };
    readonly "update:install": { readonly output: UpdateStateSchema };
    readonly "update:open-download-page": Readonly<Record<never, never>>;
  };
  readonly events: {
    readonly "update:state-changed": UpdateStateSchema;
  };
};

export type {
  UnsupportedReason,
  UpdateActivity,
  UpdateContext,
  UpdateContract,
  UpdateError,
  UpdateErrorCode,
  UpdateInfo,
  UpdatePolicyState,
  UpdateProgress,
  UpdateState,
  UpdateStatus,
  UpdateVerdict,
};
