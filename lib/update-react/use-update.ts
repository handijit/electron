import { updateClient } from "@handijitcom/electron/renderer";
import type { UpdateClient, UpdateState } from "@handijitcom/electron/renderer";
import { useMemo, useSyncExternalStore } from "react";

/** What `useUpdate` returns: the state and the actions. */
type UseUpdateResult = {
  /** The updater's state; `null` until main has answered (and outside Electron). */
  readonly state: UpdateState | null;
  /** Reads the feed and the policy now. */
  readonly check: UpdateClient["check"];
  /** Downloads the available update; after a failed download, tries again. */
  readonly download: UpdateClient["download"];
  /** Restarts into the downloaded update (while an update is required: downloads first). */
  readonly install: UpdateClient["install"];
  /** Opens the page the new version can be downloaded from by hand. */
  readonly openDownloadPage: UpdateClient["openDownloadPage"];
};

// There is no updater on a server: the first render shows nothing.
const getServerState = (): null => null;

/**
 * The updater's state and actions for a component. Every component that uses it shares one
 * subscription to main; mounting twice (StrictMode) subscribes and unsubscribes cleanly.
 *
 * The actions reject only when the bridge is missing or main refuses the call; attach a
 * `catch` when calling them from an event handler.
 */
const useUpdate = (client: UpdateClient = updateClient): UseUpdateResult => {
  const state = useSyncExternalStore(
    client.subscribe,
    client.getState,
    getServerState
  );

  return useMemo(
    () => ({
      state,
      check: client.check,
      download: client.download,
      install: client.install,
      openDownloadPage: client.openDownloadPage,
    }),
    [state, client]
  );
};

export type { UseUpdateResult };
export default useUpdate;
