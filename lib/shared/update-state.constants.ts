import type {
  UnsupportedReason,
  UpdateErrorCode,
  UpdateStatus,
  UpdateVerdict,
} from "../types";

/** Every status of the updater, in the order a successful update passes through them. */
const UPDATE_STATUSES = [
  "idle",
  "unsupported",
  "checking",
  "not-available",
  "available",
  "downloading",
  "downloaded",
  "error",
] as const satisfies readonly UpdateStatus[];

/** Every verdict of the version policy, from harmless to blocking. */
const UPDATE_VERDICTS = [
  "ok",
  "recommended",
  "required",
] as const satisfies readonly UpdateVerdict[];

/** Every stable error code. */
const UPDATE_ERROR_CODES = [
  "OFFLINE",
  "SERVER",
  "INVALID_FEED",
  "CHECKSUM",
  "SIGNATURE",
  "DISK",
  "INSTALL",
  "NOT_IN_APPLICATIONS",
  "UNKNOWN",
] as const satisfies readonly UpdateErrorCode[];

/** Every reason a build cannot update itself. */
const UNSUPPORTED_REASONS = [
  "development",
  "unsigned",
  "platform",
] as const satisfies readonly UnsupportedReason[];

export {
  UNSUPPORTED_REASONS,
  UPDATE_ERROR_CODES,
  UPDATE_STATUSES,
  UPDATE_VERDICTS,
};
