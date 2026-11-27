import isUpdateState from "../shared/is-update-state";
import type { Unsubscribe, UpdateContract, UpdateState } from "../types";
import createClient from "./create-client";

/** The page's view of the updater: the last known state and the actions. */
type UpdateClient = {
  /** The last state received from main; `null` until the first one arrives. */
  readonly getState: () => UpdateState | null;
  /**
   * Listens to state changes. The first listener connects to main and asks for the current
   * state; the last one to leave disconnects. Returns the function that stops listening.
   */
  readonly subscribe: (listener: (state: UpdateState) => void) => Unsubscribe;
  /** Asks main for the current state. */
  readonly refresh: () => Promise<UpdateState | null>;
  /** Reads the feed and the policy now. */
  readonly check: () => Promise<UpdateState | null>;
  /** Downloads the available update; after a failed download, tries again. */
  readonly download: () => Promise<UpdateState | null>;
  /** Restarts into the downloaded update (while an update is required: downloads first). */
  readonly install: () => Promise<UpdateState | null>;
  /** Opens the page the new version can be downloaded from by hand. */
  readonly openDownloadPage: () => Promise<void>;
};

/**
 * Creates a client over the bridge (`window.desktop`). Every action
 * resolves with the newest known state and rejects only when the bridge is missing or main
 * refuses the call: a failed check or download is a state, not a rejection.
 *
 * A page needs one client; `updateClient` is that one. Create another only for a test.
 */
const createUpdateClient = (): UpdateClient => {
  const ipc = createClient<UpdateContract>();
  const listeners = new Set<(state: UpdateState) => void>();
  let state: UpdateState | null = null;
  let disconnect: Unsubscribe | undefined;

  // Answers and events travel separately and may arrive out of order: the revision decides.
  // What is not a state (an older main, a broken bridge) is ignored, never trusted.
  const accept = (value: unknown): UpdateState | null => {
    if (
      !isUpdateState(value) ||
      (state !== null && value.revision <= state.revision)
    ) {
      return state;
    }
    state = value;
    for (const listener of [...listeners]) listener(value);
    return state;
  };

  const refresh = async (): Promise<UpdateState | null> =>
    accept(await ipc.invoke("update:get-state"));

  const connect = (): void => {
    try {
      disconnect = ipc.on("update:state-changed", accept);
    } catch {
      // No bridge (a browser preview, a test): the state stays `null` and the interface
      // stays quiet. `refresh()` says why, to whoever wants to know.
      return;
    }
    void refresh().catch(() => undefined);
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      // Each subscription is its own entry, so the same function may subscribe twice.
      const entry = (next: UpdateState): void => {
        listener(next);
      };
      listeners.add(entry);
      if (listeners.size === 1) connect();
      return () => {
        if (!listeners.delete(entry) || listeners.size > 0) return;
        disconnect?.();
        disconnect = undefined;
      };
    },
    refresh,
    check: async () => accept(await ipc.invoke("update:check")),
    download: async () => accept(await ipc.invoke("update:download")),
    install: async () => accept(await ipc.invoke("update:install")),
    openDownloadPage: () => ipc.invoke("update:open-download-page"),
  };
};

/** The page's client. The hook and the components use it unless they are given another. */
const updateClient: UpdateClient = /* @__PURE__ */ createUpdateClient();

export type { UpdateClient };
export { updateClient };
export default createUpdateClient;
