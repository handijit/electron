import type { LogContext, LogLevel, Unsubscribe } from "../types";
import { getBridge, pick } from "./get-bridge.helper";

/** A logger that writes to the log file main owns. */
type RendererLogger = Readonly<
  Record<LogLevel, (message: string, context?: LogContext) => void>
>;

const send = (level: LogLevel, message: string, context?: LogContext): void => {
  // Logging must never break the code that logs: a missing bridge or a refused entry is dropped.
  try {
    pick(
      getBridge("log").invoke,
      "core-log:write",
      "log"
    )({
      level,
      message,
      context,
    }).catch(() => undefined);
  } catch {
    // No bridge, or a preload without the core channels: nothing to forward to.
  }
};

/** Forwards renderer log lines to main, where they are redacted and written to the file. */
const log: RendererLogger = {
  debug: (message, context) => send("debug", message, context),
  info: (message, context) => send("info", message, context),
  warn: (message, context) => send("warn", message, context),
  error: (message, context) => send("error", message, context),
};

const describe = (reason: unknown): { message: string; stack?: string } =>
  reason instanceof Error
    ? { message: reason.message, stack: reason.stack }
    : { message: String(reason) };

/**
 * Forwards uncaught errors and unhandled rejections of this window to the main log.
 * Returns the function that removes the listeners.
 */
const forwardErrors = (): Unsubscribe => {
  const onError = (event: ErrorEvent): void => {
    const { message, stack } = describe(event.error ?? event.message);
    log.error(`Uncaught error: ${message}`, {
      stack,
      source: event.filename,
      line: event.lineno,
    });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const { message, stack } = describe(event.reason);
    log.error(`Unhandled rejection: ${message}`, { stack });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
};

export type { RendererLogger };
export { forwardErrors, log };
