import type { Unsubscribe } from "../types";
import { CORE_CONTRACT } from "./core-contract";
import createEmitter from "./ipc-emitter";
import registerHandlers from "./ipc-handlers";
import type { RegisterHandlersOptions } from "./ipc-handlers";
import type { Logger } from "./logger";
import type { ThemeBridge } from "./theme-bridge";

type CoreHandlersOptions = RegisterHandlersOptions & {
  /** Receives the renderer's log lines, under the `renderer` scope. */
  logger: Logger;
  /** Answers the renderer's theme calls and is the source of its theme events. */
  theme: ThemeBridge;
};

/**
 * Registers the channels behind `log`, `getTheme`, `setThemePreference` and `onThemeChange`
 * of the renderer entry, and broadcasts theme changes to every window. Returns the function
 * that undoes both.
 */
const registerCoreHandlers = ({
  logger,
  theme,
  ...options
}: CoreHandlersOptions): Unsubscribe => {
  const rendererLogger = logger.child("renderer");
  const emitter = createEmitter(CORE_CONTRACT, options);

  const removeHandlers = registerHandlers(
    CORE_CONTRACT,
    {
      "core-log:write": ({ level, message, context }) => {
        rendererLogger[level](message, context);
      },
      "core-theme:get": () => theme.getState(),
      "core-theme:set": (preference) => theme.setPreference(preference),
    },
    options
  );
  const stopBroadcast = theme.onChange((state) => {
    emitter.broadcast("core-theme:changed", state);
  });

  return () => {
    removeHandlers();
    stopBroadcast();
  };
};

export type { CoreHandlersOptions };
export default registerCoreHandlers;
