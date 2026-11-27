import type { SecretStore } from "@handijitcom/electron/main";
import { z } from "zod";

import type { AuthUser } from "../types";
import reasonOf from "./reason-of.helper";
import type { AuthLogger } from "./types";

/** The one secret this package keeps: `<userData>/secrets/auth-session.bin` with the default store. */
const SESSION_SECRET_NAME = "auth-session";
const STORAGE_VERSION = 1;

// The user's snapshot lives inside the encrypted secret, next to the refresh token: one value,
// written atomically, and no e-mail address in plain text on the disk.
const storedSessionSchema = z.object({
  v: z.literal(STORAGE_VERSION),
  refreshToken: z.string().min(1),
  user: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable(),
});

/** What survives a restart: the refresh token and who it belongs to. Never an access token. */
type StoredSession = {
  /** The refresh token to renew the session with. */
  readonly refreshToken: string;
  /** Who was signed in, so the program can show them before the network answers. */
  readonly user: AuthUser | null;
};

type SessionVaultOptions = {
  /** Where the secret is kept. */
  readonly secretStore: SecretStore;
  /** Where a storage problem is reported. Never receives a token. */
  readonly logger: AuthLogger;
};

type SessionVault = {
  /** Reads the stored session; `null` when there is none or it cannot be read. Never rejects. */
  readonly load: () => Promise<StoredSession | null>;
  /** Stores the session and resolves `true`, or `false` when it could not be stored. Never rejects. */
  readonly save: (session: StoredSession) => Promise<boolean>;
  /** Removes the stored session. Never rejects. */
  readonly clear: () => Promise<void>;
};

/**
 * The session on the disk, behind the secret store of the main entry. Its calls run one
 * after another in the order they were made, so a save that started before a sign-out can
 * never land after the wipe.
 *
 * When the operating system offers no encryption (the store refuses to write), nothing is
 * written and `save` answers `false`: the session then lives in memory only. It is never
 * stored in plain text.
 */
const createSessionVault = (options: SessionVaultOptions): SessionVault => {
  const { secretStore, logger } = options;
  let tail: Promise<unknown> = Promise.resolve();

  // Every task below handles its own failure, so the chain never breaks.
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run;
    return run;
  };

  const remove = async (): Promise<void> => {
    try {
      await secretStore.delete(SESSION_SECRET_NAME);
    } catch (error) {
      logger.warn("The stored session could not be removed", {
        reason: reasonOf(error),
      });
    }
  };

  const load = async (): Promise<StoredSession | null> => {
    let raw: string | null;
    try {
      raw = await secretStore.get(SESSION_SECRET_NAME);
    } catch (error) {
      logger.warn("The stored session could not be read", {
        reason: reasonOf(error),
      });
      return null;
    }
    if (raw === null) return null;

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      // Not what this package wrote; handled below.
    }
    const parsed = storedSessionSchema.safeParse(value);
    if (!parsed.success) {
      logger.warn("The stored session is not valid and was removed");
      await remove();
      return null;
    }
    return { refreshToken: parsed.data.refreshToken, user: parsed.data.user };
  };

  const save = async (session: StoredSession): Promise<boolean> => {
    try {
      await secretStore.set(
        SESSION_SECRET_NAME,
        JSON.stringify({
          v: STORAGE_VERSION,
          refreshToken: session.refreshToken,
          user: session.user,
        })
      );
      return true;
    } catch (error) {
      logger.warn(
        "The session could not be stored; it lasts until the program closes",
        { reason: reasonOf(error) }
      );
      // An older refresh token left on the disk is already retired: it would only end the
      // session at the next start.
      await remove();
      return false;
    }
  };

  return {
    load: () => enqueue(load),
    save: (session) => enqueue(() => save(session)),
    clear: () => enqueue(remove),
  };
};

export type { SessionVault, SessionVaultOptions, StoredSession };
export { SESSION_SECRET_NAME };
export default createSessionVault;
