import { defineContract } from "@handijitcom/electron";
import { z } from "zod";

import {
  UNSUPPORTED_REASONS,
  UPDATE_ERROR_CODES,
  UPDATE_VERDICTS,
} from "../shared/update-state.constants";
import type { UpdateContract, UpdateState } from "../types";

const count = z.number().nonnegative();

const updateInfoSchema = z.strictObject({
  version: z.string(),
  releaseDate: z.string().nullable(),
  releaseNotes: z.string().nullable(),
  sizeBytes: count.nullable(),
});

// The fields every status carries.
const context = {
  revision: count,
  currentVersion: z.string(),
  policy: z.strictObject({
    verdict: z.enum(UPDATE_VERDICTS),
    latestVersion: z.string().nullable(),
    minSupportedVersion: z.string().nullable(),
    checkedAt: count.nullable(),
  }),
  checkedAt: count.nullable(),
  isInstallPending: z.boolean(),
};

/** The schema of the state as it crosses IPC. Strict: an unknown field is a bug in main. */
const updateStateSchema: z.ZodType<UpdateState, UpdateState> =
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("idle"), ...context }),
    z.strictObject({
      status: z.literal("unsupported"),
      reason: z.enum(UNSUPPORTED_REASONS),
      ...context,
    }),
    z.strictObject({ status: z.literal("checking"), ...context }),
    z.strictObject({ status: z.literal("not-available"), ...context }),
    z.strictObject({
      status: z.literal("available"),
      update: updateInfoSchema,
      ...context,
    }),
    z.strictObject({
      status: z.literal("downloading"),
      update: updateInfoSchema,
      progress: z.strictObject({
        percent: count.max(100),
        transferredBytes: count,
        totalBytes: count,
        bytesPerSecond: count,
      }),
      ...context,
    }),
    z.strictObject({
      status: z.literal("downloaded"),
      update: updateInfoSchema,
      ...context,
    }),
    z.strictObject({
      status: z.literal("error"),
      error: z.strictObject({
        code: z.enum(UPDATE_ERROR_CODES),
        message: z.string(),
      }),
      update: updateInfoSchema.nullable(),
      ...context,
    }),
  ]);

/**
 * The updater's part of a program's IPC contract. Spread it into the program's own contract
 * (`invoke: { ...updateContract.invoke, ... }`), or register it on its own with
 * `registerUpdateIpc`. No channel takes an argument: the renderer can ask for a check, a
 * download or an install, and nothing else.
 */
const updateContract: UpdateContract = defineContract({
  invoke: {
    "update:get-state": { output: updateStateSchema },
    "update:check": { output: updateStateSchema },
    "update:download": { output: updateStateSchema },
    "update:install": { output: updateStateSchema },
    "update:open-download-page": {},
  },
  events: {
    "update:state-changed": updateStateSchema,
  },
});

export { updateStateSchema };
export default updateContract;
