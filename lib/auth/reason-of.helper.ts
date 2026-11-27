/** What went wrong, as one line for the log. Never a token: callers pass errors, not payloads. */
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export default reasonOf;
