import { createEmitter, registerHandlers } from "@handijitcom/electron/main";
import type {
  Handlers,
  RegisterHandlersOptions,
  UrlPolicy,
} from "@handijitcom/electron/main";

import type { Unsubscribe, UpdateContract } from "../types";
import type { Updater } from "./types";
import updateContract from "./update-contract";

/**
 * The handlers of the updater's channels. Spread them into the program's handlers when the
 * program spread `updateContract` into its contract.
 */
const createUpdateHandlers = (updater: Updater): Handlers<UpdateContract> => ({
  "update:get-state": () => updater.getState(),
  "update:check": () => updater.check(),
  "update:download": () => updater.download(),
  "update:install": () => updater.install(),
  "update:open-download-page": () => updater.openDownloadPage(),
});

type RegisterUpdateIpcOptions = {
  /** The updater the renderer talks to. */
  updater: Updater;
  /** The program's URL policy: which pages may call the handlers and receive the state. */
  policy: UrlPolicy;
  /** Receives every refused or failed call, like `registerHandlers`. Use it to log. */
  onError?: RegisterHandlersOptions["onError"];
};

/**
 * Wires the updater to the renderer in one call: registers the handlers of `updateContract`
 * and broadcasts every state change to the program's windows. Returns the function that
 * undoes both. Use it when the updater's channels are not part of the program's own contract.
 */
const registerUpdateIpc = ({
  updater,
  policy,
  onError,
}: RegisterUpdateIpcOptions): Unsubscribe => {
  const removeHandlers = registerHandlers(
    updateContract,
    createUpdateHandlers(updater),
    { policy, ...(onError === undefined ? {} : { onError }) }
  );
  const emitter = createEmitter(updateContract, { policy });
  const stopBroadcasting = updater.onChange((state) => {
    emitter.broadcast("update:state-changed", state);
  });

  return () => {
    stopBroadcasting();
    removeHandlers();
  };
};

export type { RegisterUpdateIpcOptions };
export { createUpdateHandlers };
export default registerUpdateIpc;
