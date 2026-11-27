// The updater (main process): the state machine over electron-updater, the minimum-version
// policy and the updater's IPC.
import createUpdater from "./update/create-updater";
import createPolicyStore from "./update/policy-store";
import type { PolicyStoreOptions } from "./update/policy-store";
import updateContract, { updateStateSchema } from "./update/update-contract";
import registerUpdateIpc, { createUpdateHandlers } from "./update/update-ipc";
import type { RegisterUpdateIpcOptions } from "./update/update-ipc";
import type {
  PolicyAnswer,
  PolicyStore,
  StoredPolicy,
  Updater,
  UpdaterEngine,
  UpdaterEngineLogger,
  UpdaterOptions,
  UpdatePolicyOptions,
} from "./update/types";

export {
  createPolicyStore,
  createUpdateHandlers,
  createUpdater,
  registerUpdateIpc,
  updateContract,
  updateStateSchema,
};
export type {
  PolicyAnswer,
  PolicyStore,
  PolicyStoreOptions,
  RegisterUpdateIpcOptions,
  StoredPolicy,
  Updater,
  UpdaterEngine,
  UpdaterEngineLogger,
  UpdaterOptions,
  UpdatePolicyOptions,
};
