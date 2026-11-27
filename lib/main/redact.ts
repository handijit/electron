const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;
const MAX_ITEMS = 100;
const MAX_STRING_LENGTH = 8000;

// Keys whose value is a secret or personal data whatever it looks like.
const SECRET_KEY_PATTERN =
  /pass(?:word|wd|phrase)?|secret|token|authori[sz]ation|cookie|licen[cs]e|credential|session|signature|api[-_]?key|private[-_]?key|e-?mail|phone/i;

// Secrets and personal data that show up inside free text. All linear: no nested quantifier.
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8})/g;
const URL_SECRET_PATTERN =
  /([?&#](?:code|token|access_token|refresh_token|id_token|key|secret|password|state)=)[^&#\s]+/gi;

/** Masks the secrets and personal data a piece of free text may carry. */
const redactText = (text: string): string => {
  const clipped =
    text.length > MAX_STRING_LENGTH
      ? `${text.slice(0, MAX_STRING_LENGTH)}… (${text.length - MAX_STRING_LENGTH} more characters)`
      : text;
  return clipped
    .replace(BEARER_PATTERN, `$1 ${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(URL_SECRET_PATTERN, `$1${REDACTED}`)
    .replace(EMAIL_PATTERN, `***@$1`);
};

const walk = (
  value: unknown,
  secretKey: RegExp,
  ancestors: readonly object[]
): unknown => {
  if (typeof value === "string") return redactText(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`;
  }
  if (typeof value !== "object" || value === null) return value;

  // Cycles are found on the path being walked, so a shared object is not mistaken for one.
  if (ancestors.includes(value)) return "[Circular]";
  if (ancestors.length >= MAX_DEPTH) return "[Truncated]";
  const path = [...ancestors, value];

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack === undefined ? undefined : redactText(value.stack),
    };
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ITEMS)
      .map((item) => walk(item, secretKey, path));
    if (value.length > MAX_ITEMS) {
      items.push(`[${value.length - MAX_ITEMS} more items]`);
    }
    return items;
  }

  const result: Record<string, unknown> = {};
  let entries: [string, unknown][];
  try {
    entries = Object.entries(value);
  } catch {
    // A throwing getter or a hostile Proxy: the log line is written without that value.
    return "[Unreadable]";
  }
  for (const [key, item] of entries.slice(0, MAX_ITEMS)) {
    // Object.fromEntries-style assignment would let "__proto__" swap the prototype.
    Object.defineProperty(result, key, {
      value: secretKey.test(key) ? REDACTED : walk(item, secretKey, path),
      enumerable: true,
    });
  }
  return result;
};

const escapeForPattern = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A function that returns a copy of a value that is safe to write to a log file. */
type Redactor = (value: unknown) => unknown;

/**
 * Builds the redactor of a logger: values under secret-looking keys are replaced, free text
 * loses tokens, e-mail addresses and secret URL parameters, and the copy is bounded in depth,
 * width and string length so that one log call cannot write megabytes.
 */
const createRedactor = (extraKeys: readonly string[] = []): Redactor => {
  const secretKey =
    extraKeys.length === 0
      ? SECRET_KEY_PATTERN
      : new RegExp(
          `${SECRET_KEY_PATTERN.source}|${extraKeys.map(escapeForPattern).join("|")}`,
          "i"
        );
  return (value) => walk(value, secretKey, []);
};

export type { Redactor };
export { createRedactor, redactText };
