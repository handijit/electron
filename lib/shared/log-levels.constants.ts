import type { LogLevel } from "../types";

/** Every log level, from the most to the least verbose. */
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export default LOG_LEVELS;
