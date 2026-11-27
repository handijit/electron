const SECONDS_PATTERN = /^[0-9]{1,9}$/;
// The one date form HTTP senders generate (RFC 9110 section 5.6.7): `Tue, 10 Nov 2026 09:00:30 GMT`.
const HTTP_DATE_PATTERN =
  /^[A-Z][a-z]{2}, [0-9]{2} [A-Z][a-z]{2} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/;

/**
 * The `Retry-After` header in whole seconds: a server sends a number of seconds, a proxy may
 * send an HTTP date (RFC 9110 section 10.2.3). `undefined` when the header is absent or says
 * neither.
 */
const parseRetryAfter = (
  header: string | null,
  nowMs: number
): number | undefined => {
  if (header === null) return undefined;
  const value = header.trim();
  if (SECONDS_PATTERN.test(value)) return Number(value);
  // The shape is checked first: `Date.parse` alone reads far too much as a date ("-5", "1.5").
  const dateMs = HTTP_DATE_PATTERN.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, Math.ceil((dateMs - nowMs) / 1000));
};

export default parseRetryAfter;
