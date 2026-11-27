// Semantic versions as electron-builder writes them and a policy endpoint answers with:
// `MAJOR.MINOR.PATCH` with an optional pre-release (`1.4.0-beta.2`), no `v` prefix, no leading
// zeros and no build metadata (`+build` takes no part in ordering).

type Version = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
};

const MAX_VERSION_LENGTH = 64;
// A number without a leading zero; nine digits keep it a safe integer.
const NUMBER_PATTERN = /^(?:0|[1-9][0-9]{0,8})$/;
const NUMERIC_IDENTIFIER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
// Letters, digits and hyphens with at least one that is not a digit.
const ALPHANUMERIC_IDENTIFIER_PATTERN = /^[0-9]*[A-Za-z-][0-9A-Za-z-]*$/;
const NUMERIC_PATTERN = /^[0-9]+$/;

/** The version a text spells, or `undefined` when it is not one. */
const parseVersion = (value: unknown): Version | undefined => {
  if (typeof value !== "string" || value.length > MAX_VERSION_LENGTH) {
    return undefined;
  }
  // The first hyphen ends the numbers; a pre-release identifier may hold hyphens of its own.
  const hyphenIndex = value.indexOf("-");
  const core = hyphenIndex === -1 ? value : value.slice(0, hyphenIndex);
  const numbers = core.split(".");
  if (
    numbers.length !== 3 ||
    !numbers.every((number) => NUMBER_PATTERN.test(number))
  ) {
    return undefined;
  }
  const prerelease =
    hyphenIndex === -1 ? [] : value.slice(hyphenIndex + 1).split(".");
  const isIdentifier = (identifier: string): boolean =>
    NUMERIC_IDENTIFIER_PATTERN.test(identifier) ||
    ALPHANUMERIC_IDENTIFIER_PATTERN.test(identifier);
  if (!prerelease.every(isIdentifier)) return undefined;

  const [major, minor, patch] = numbers.map(Number) as [number, number, number];
  return { major, minor, patch, prerelease };
};

/** Whether a value is a semantic version this package can compare. */
const isVersion = (value: unknown): value is string =>
  parseVersion(value) !== undefined;

const compareIdentifiers = (left: string, right: string): number => {
  const isLeftNumeric = NUMERIC_PATTERN.test(left);
  const isRightNumeric = NUMERIC_PATTERN.test(right);
  if (isLeftNumeric && isRightNumeric) {
    // No leading zeros: the longer number is the larger one, equal lengths compare as text.
    // This also orders numbers beyond 2^53, which `Number` would not.
    if (left.length !== right.length) return left.length - right.length;
  } else if (isLeftNumeric !== isRightNumeric) {
    // A numeric identifier ranks below an alphanumeric one.
    return isLeftNumeric ? -1 : 1;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const requireVersion = (value: string, name: string): Version => {
  const version = parseVersion(value);
  if (version === undefined) {
    throw new TypeError(
      `compareVersions: ${name} must be a semantic version like "1.4.0" or "1.4.0-beta.2", received ${JSON.stringify(value)}`
    );
  }
  return version;
};

/**
 * Orders two semantic versions by precedence: `-1` when `left` is older, `1` when it is newer,
 * `0` when they are equal. A text that is not a version throws a `TypeError`; check it with
 * `isVersion` first.
 */
const compareVersions = (left: string, right: string): -1 | 0 | 1 => {
  const a = requireVersion(left, "left");
  const b = requireVersion(right, "right");
  const numbers = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (numbers !== 0) return Math.sign(numbers) as -1 | 1;

  const leftLength = a.prerelease.length;
  const rightLength = b.prerelease.length;
  // A release outranks its own pre-releases.
  if (leftLength === 0 || rightLength === 0) {
    return Math.sign(Number(leftLength === 0) - Number(rightLength === 0)) as
      -1 | 0 | 1;
  }
  for (let i = 0; i < Math.min(leftLength, rightLength); i++) {
    const order = compareIdentifiers(
      a.prerelease[i] as string,
      b.prerelease[i] as string
    );
    if (order !== 0) return Math.sign(order) as -1 | 1;
  }
  // The longer identifier list outranks its own prefix.
  return Math.sign(leftLength - rightLength) as -1 | 0 | 1;
};

/** What an installed version should do about a policy. */
type PolicyStatus = "update-required" | "update-available" | "up-to-date";

/**
 * `update-required` below the supported minimum, `update-available` when a newer version is
 * published, `up-to-date` otherwise (also for a build newer than the newest published one).
 */
const evaluateUpdatePolicy = (
  currentVersion: string,
  policy: { latestVersion: string; minSupportedVersion: string | null }
): PolicyStatus => {
  if (
    policy.minSupportedVersion !== null &&
    compareVersions(currentVersion, policy.minSupportedVersion) < 0
  ) {
    return "update-required";
  }
  return compareVersions(currentVersion, policy.latestVersion) < 0
    ? "update-available"
    : "up-to-date";
};

export type { PolicyStatus };
export { compareVersions, evaluateUpdatePolicy, isVersion };
