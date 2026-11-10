import { app } from "electron";

import type { Unsubscribe } from "../types";
import type { Logger } from "./logger";

type CaptureUncaughtErrorsOptions = {
  /**
   * Quit after an uncaught exception has been logged. Default: `true`; main is in an unknown
   * state after one, and Electron's own default is an error dialog.
   */
  exitOnUncaughtException?: boolean;
};

/**
 * Logs uncaught exceptions and unhandled rejections of the main process. Returns the
 * function that removes the listeners.
 */
const captureUncaughtErrors = (
  logger: Logger,
  { exitOnUncaughtException = true }: CaptureUncaughtErrorsOptions = {}
): Unsubscribe => {
  const onException = (error: unknown): void => {
    logger.error("Uncaught exception in main", { error });
    if (exitOnUncaughtException) {
      void logger.flush().finally(() => app.exit(1));
    }
  };
  const onRejection = (reason: unknown): void => {
    logger.error("Unhandled rejection in main", { error: reason });
  };

  process.on("uncaughtException", onException);
  process.on("unhandledRejection", onRejection);
  return () => {
    process.removeListener("uncaughtException", onException);
    process.removeListener("unhandledRejection", onRejection);
  };
};

export type { CaptureUncaughtErrorsOptions };
export default captureUncaughtErrors;
