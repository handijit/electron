import { createSettingsStore } from "@handijitcom/electron/main";
import type { SettingsStore } from "@handijitcom/electron/main";
import { z } from "zod";

import type { PolicyStore, StoredPolicy } from "./types";

type PolicyFile = { policy: StoredPolicy | null };

const POLICY_FILE_NAME = "update-policy.json";

const policyFileSchema: z.ZodType<PolicyFile> = z.object({
  policy: z
    .object({
      latestVersion: z.string(),
      minSupportedVersion: z.string().nullable(),
      fetchedAt: z.number(),
    })
    .nullable()
    .default(null),
});

type PolicyStoreOptions = {
  /** Folder of the file. Default: `app.getPath("userData")`. */
  directory?: string;
};

/**
 * Keeps the last policy in `update-policy.json`, through the settings store of the main entry:
 * atomic writes, and a corrupt file is set aside instead of crashing the
 * start. The file is opened on first use.
 */
const createPolicyStore = ({
  directory,
}: PolicyStoreOptions = {}): PolicyStore => {
  let opened: Promise<SettingsStore<PolicyFile>> | undefined;
  const open = (): Promise<SettingsStore<PolicyFile>> => {
    opened ??= createSettingsStore({
      schema: policyFileSchema,
      fileName: POLICY_FILE_NAME,
      ...(directory === undefined ? {} : { directory }),
    }).catch((cause: unknown) => {
      // A failed open is not remembered: the next call tries again.
      opened = undefined;
      throw cause;
    });
    return opened;
  };

  return {
    read: async () => (await open()).get().policy,
    write: async (policy) => {
      await (await open()).set({ policy });
    },
  };
};

export type { PolicyStoreOptions };
export default createPolicyStore;
