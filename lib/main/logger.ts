import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import LOG_LEVELS from "../shared/log-levels.constants";
import type { LogContext, LogLevel } from "../types";
import { createRedactor } from "./redact";

type LoggerOptions = {
  /** Folder of the log files. Default: `app.getPath("logs")`. */
  directory?: string;
  /** Name of the current log file. Default: `main.log`. */
  fileName?: string;
  /** The least severe level that is written. Default: `info`. */
  level?: LogLevel;
  /** Size at which the file is rotated, in bytes. Default: 1 MiB. */
  maxFileBytes?: number;
  /** How many rotated files are kept next to the current one. Default: 3. */
  maxFiles?: number;
  /** Extra key names whose values are always replaced with `[REDACTED]`. */
  redactKeys?: readonly string[];
  /** Also print each line to the terminal. Default: only in an unpackaged app. */
  mirrorToConsole?: boolean;
};

/** A structured, redacting logger that writes JSON lines to a rotating file. */
type Logger = Readonly<
  Record<LogLevel, (message: string, context?: LogContext) => void>
> & {
  /** Folder of the log files, for an "Open log folder" menu item. */
  readonly directory: string;
  /** A logger that writes to the same file under another scope, like `"updater"`. */
  readonly child: (scope: string) => Logger;
  /** Resolves when every line logged so far is on disk. Await it before quitting. */
  readonly flush: () => Promise<void>;
};

const DEFAULT_MAX_FILE_BYTES = 1_048_576;
const DEFAULT_MAX_FILES = 3;
// Lines waiting for the disk. A stalled disk must not grow the process without bound.
const MAX_PENDING_LINES = 1000;

const atLeast = (
  value: number | undefined,
  floor: number,
  fallback: number
): number =>
  typeof value === "number" && value >= floor ? Math.floor(value) : fallback;

/**
 * Creates the logger of the main process. Writing is asynchronous and ordered; it never
 * blocks main and never throws into the code that logs. Every message and context value
 * passes through the redactor before it is written.
 */
const createLogger = ({
  directory = app.getPath("logs"),
  fileName = "main.log",
  level = "info",
  maxFileBytes,
  maxFiles,
  redactKeys = [],
  mirrorToConsole = !app.isPackaged,
}: LoggerOptions = {}): Logger => {
  const file = join(directory, fileName);
  const sizeLimit = atLeast(maxFileBytes, 1024, DEFAULT_MAX_FILE_BYTES);
  // A count without end would never finish shifting the old files: it gets the default.
  const keep = atLeast(
    Number.isFinite(maxFiles) ? maxFiles : undefined,
    0,
    DEFAULT_MAX_FILES
  );
  const threshold = Math.max(LOG_LEVELS.indexOf(level), 0);
  const redact = createRedactor(redactKeys);

  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  let dropped = 0;
  let size: number | undefined;

  const rotate = async (): Promise<void> => {
    await rm(`${file}.${keep}`, { force: true });
    for (let index = keep - 1; index >= 1; index -= 1) {
      await rename(`${file}.${index}`, `${file}.${index + 1}`).catch(
        () => undefined
      );
    }
    if (keep >= 1) await rename(file, `${file}.1`);
    else await rm(file, { force: true });
    size = 0;
  };

  const write = async (line: string): Promise<void> => {
    if (size === undefined) {
      await mkdir(directory, { recursive: true });
      size = (await stat(file).catch(() => null))?.size ?? 0;
    }
    const bytes = Buffer.byteLength(line);
    if (size > 0 && size + bytes > sizeLimit) await rotate();
    await appendFile(file, line, { mode: 0o600 });
    size += bytes;
  };

  const enqueue = (line: string): void => {
    if (pending >= MAX_PENDING_LINES) {
      dropped += 1;
      return;
    }
    pending += 1;
    queue = queue
      .then(() => write(line))
      // A full or read-only disk must not take the app down with it.
      .catch(() => undefined)
      .finally(() => {
        pending -= 1;
      });
  };

  const emit = (
    scope: string,
    entryLevel: LogLevel,
    message: string,
    context: LogContext | undefined
  ): void => {
    if (LOG_LEVELS.indexOf(entryLevel) < threshold) return;

    if (dropped > 0 && pending < MAX_PENDING_LINES) {
      const lost = dropped;
      dropped = 0;
      // Logged as an error so that no level setting can filter the notice itself out.
      emit(
        "logger",
        "error",
        `Dropped ${lost} log lines: the disk is too slow`,
        undefined
      );
    }

    const line = JSON.stringify({
      time: new Date().toISOString(),
      level: entryLevel,
      scope,
      message: redact(String(message)),
      context: context === undefined ? undefined : redact(context),
    });
    // The single place of the package that prints: a developer's terminal, never a packaged app.
    if (mirrorToConsole) console[entryLevel](line);
    enqueue(`${line}\n`);
  };

  const scoped = (scope: string): Logger => ({
    directory,
    debug: (message, context) => emit(scope, "debug", message, context),
    info: (message, context) => emit(scope, "info", message, context),
    warn: (message, context) => emit(scope, "warn", message, context),
    error: (message, context) => emit(scope, "error", message, context),
    child: (name) => scoped(name),
    flush: () => queue,
  });

  return scoped("main");
};

export type { Logger, LoggerOptions };
export default createLogger;
