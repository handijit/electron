import type { UpdaterEngineLogger, UpdaterLogger } from "./types";

const MAX_LINE_LENGTH = 400;
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Any account folder, whoever's it is: Squirrel.Mac and the Windows installer name paths of
// the account they run under, which need not be the folder Node calls home. A Windows
// account folder may hold spaces ("Ayşe Yılmaz"), so there the name ends at the next separator.
const ACCOUNT_FOLDER_PATTERN =
  /(?:\/Users\/|\/home\/)[^/\s"']+|[A-Za-z]:\\Users\\[^\\/"']+/g;

/**
 * Makes a line of the engine safe to keep: the user's home folder (it holds the account name)
 * becomes `~`, the installation's rollout id and the query of any URL are dropped, and only
 * the first line survives (the rest is a stack with more paths).
 */
const sanitizeLine = (message: unknown, homeDirectory: string): string => {
  const text = message instanceof Error ? message.message : String(message);
  const end = text.indexOf("\n");
  const line = end === -1 ? text : text.slice(0, end);
  const withoutHome =
    homeDirectory === "" ? line : line.split(homeDirectory).join("~");
  return withoutHome
    .replace(ACCOUNT_FOLDER_PATTERN, "~")
    .replace(UUID_PATTERN, "<id>")
    .replace(/\?[^\s"')]*/g, "")
    .slice(0, MAX_LINE_LENGTH);
};

/**
 * The logger handed to `electron-updater`. Its lines are a debugging aid, so they go to the
 * `debug` level; its warnings and errors stay warnings, because the failures that matter
 * arrive as events and are logged there with their stable code.
 */
const createEngineLogger = (
  logger: UpdaterLogger,
  homeDirectory: string
): UpdaterEngineLogger => {
  const forward =
    (level: "debug" | "warn") =>
    (message?: unknown): void =>
      logger[level](`engine: ${sanitizeLine(message, homeDirectory)}`);

  return {
    info: forward("debug"),
    warn: forward("warn"),
    error: forward("warn"),
  };
};

export { sanitizeLine };
export default createEngineLogger;
