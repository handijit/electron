import { z } from "zod";

import LOG_LEVELS from "../shared/log-levels.constants";
import { THEME_PREFERENCES } from "../shared/theme.constants";
import type { Contract } from "../types";

const themePreferenceSchema = z.enum(
  THEME_PREFERENCES as ["system", "light", "dark"]
);
const themeStateSchema = z.object({
  preference: themePreferenceSchema,
  resolved: z.enum(["light", "dark"]),
});

// A compromised renderer can call this as often and with as much as it likes; the sizes are
// capped here and the logger bounds its own queue.
const rendererLogEntrySchema = z.object({
  level: z.enum(LOG_LEVELS as ["debug", "info", "warn", "error"]),
  message: z.string().max(4000),
  context: z.record(z.string().max(100), z.unknown()).optional(),
});

/** The channels this package registers for itself. Not built with `defineContract`: it owns the reserved area. */
const CORE_CONTRACT = {
  invoke: {
    "core-log:write": { input: rendererLogEntrySchema },
    "core-theme:get": { output: themeStateSchema },
    "core-theme:set": {
      input: themePreferenceSchema,
      output: themeStateSchema,
    },
  },
  events: {
    "core-theme:changed": themeStateSchema,
  },
} as const satisfies Contract;

export { CORE_CONTRACT, themePreferenceSchema };
