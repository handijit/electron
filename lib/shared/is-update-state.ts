import type { UpdateState } from "../types";
import {
  UNSUPPORTED_REASONS,
  UPDATE_ERROR_CODES,
  UPDATE_VERDICTS,
} from "./update-state.constants";

type Shape = Readonly<Record<string, unknown>>;

const isShape = (value: unknown): value is Shape =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isNullOr = (
  value: unknown,
  check: (value: unknown) => boolean
): boolean => value === null || check(value);
const isOneOf = (list: readonly string[], value: unknown): boolean =>
  isText(value) && list.includes(value);

const isInfo = (value: unknown): boolean =>
  isShape(value) &&
  isText(value.version) &&
  isNullOr(value.releaseDate, isText) &&
  isNullOr(value.releaseNotes, isText) &&
  isNullOr(value.sizeBytes, isCount);

const isProgress = (value: unknown): boolean =>
  isShape(value) &&
  isCount(value.percent) &&
  value.percent <= 100 &&
  isCount(value.transferredBytes) &&
  isCount(value.totalBytes) &&
  isCount(value.bytesPerSecond);

const isFailure = (value: unknown): boolean =>
  isShape(value) &&
  isOneOf(UPDATE_ERROR_CODES, value.code) &&
  isText(value.message);

const isPolicy = (value: unknown): boolean =>
  isShape(value) &&
  isOneOf(UPDATE_VERDICTS, value.verdict) &&
  isNullOr(value.latestVersion, isText) &&
  isNullOr(value.minSupportedVersion, isText) &&
  isNullOr(value.checkedAt, isCount);

// What each status adds to the common fields.
const ACTIVITIES: Readonly<Record<string, (state: Shape) => boolean>> = {
  idle: () => true,
  unsupported: ({ reason }) => isOneOf(UNSUPPORTED_REASONS, reason),
  checking: () => true,
  "not-available": () => true,
  available: ({ update }) => isInfo(update),
  downloading: ({ update, progress }) => isInfo(update) && isProgress(progress),
  downloaded: ({ update }) => isInfo(update),
  error: ({ error, update }) => isFailure(error) && isNullOr(update, isInfo),
};

/**
 * Whether a value is a complete update state. The renderer checks what arrives over IPC with
 * it, without Zod: main validates with the schemas, the page with this.
 */
const isUpdateState = (value: unknown): value is UpdateState => {
  if (!isShape(value) || !isText(value.status)) return false;
  // Looked up without walking the prototype chain: "constructor" is not a status.
  const activity = Object.hasOwn(ACTIVITIES, value.status)
    ? ACTIVITIES[value.status]
    : undefined;

  return (
    activity !== undefined &&
    activity(value) &&
    isCount(value.revision) &&
    isText(value.currentVersion) &&
    isPolicy(value.policy) &&
    isNullOr(value.checkedAt, isCount) &&
    typeof value.isInstallPending === "boolean"
  );
};

export default isUpdateState;
