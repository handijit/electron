import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { app, safeStorage } from "electron";

import writeFileAtomic from "./atomic-write.helper";

type SecretStoreOptions = {
  /** Folder of the encrypted files. Default: `<userData>/secrets`. */
  directory?: string;
};

/** Secrets encrypted with the operating system's key store. Main process only. */
type SecretStore = {
  /** Whether secrets can be stored on this machine right now. */
  readonly isAvailable: () => Promise<boolean>;
  /** Reads a secret. `null` when it does not exist, cannot be decrypted, or encryption is unavailable. */
  readonly get: (name: string) => Promise<string | null>;
  /** Stores a secret. Rejects with `SecretStoreUnavailableError` instead of writing plain text. */
  readonly set: (name: string, value: string) => Promise<void>;
  /** Removes a secret. Removing a missing one is not an error. */
  readonly delete: (name: string) => Promise<void>;
};

/** Thrown by `set` when the operating system offers no real encryption. Nothing was written. */
class SecretStoreUnavailableError extends Error {
  readonly code = "SECRET_STORE_UNAVAILABLE" as const;

  constructor() {
    super(
      "Secret storage is unavailable: the operating system offers no encryption key store, so the secret was not stored"
    );
    this.name = "SecretStoreUnavailableError";
  }
}

// The name becomes a file name: no separators, no dots first, nothing a file system folds.
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Creates the secret store. It fails closed: without OS-backed encryption (including Linux's
 * `basic_text` backend, which encrypts with a hard-coded password) nothing is stored and
 * nothing is read, so the user signs in again instead of having a token lie on disk.
 */
const createSecretStore = ({
  directory = join(app.getPath("userData"), "secrets"),
}: SecretStoreOptions = {}): SecretStore => {
  const pathOf = (name: string): string => {
    if (!NAME_PATTERN.test(name)) {
      throw new TypeError(
        `secretStore: name ${JSON.stringify(name)} must be 1-64 characters of a-z, 0-9, ".", "_" or "-", starting with a letter or digit`
      );
    }
    return join(directory, `${name}.bin`);
  };

  const isAvailable = async (): Promise<boolean> => {
    if (!app.isReady()) return false;
    if (
      process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text"
    ) {
      return false;
    }
    return safeStorage.isAsyncEncryptionAvailable().catch(() => false);
  };

  const set = async (name: string, value: string): Promise<void> => {
    const path = pathOf(name);
    if (!(await isAvailable())) throw new SecretStoreUnavailableError();
    await writeFileAtomic(path, await safeStorage.encryptStringAsync(value));
  };

  const remove = async (name: string): Promise<void> => {
    await rm(pathOf(name), { force: true });
  };

  const get = async (name: string): Promise<string | null> => {
    const path = pathOf(name);
    if (!(await isAvailable())) return null;

    const encrypted = await readFile(path).catch(() => null);
    if (encrypted === null) return null;

    try {
      const { result, shouldReEncrypt } =
        await safeStorage.decryptStringAsync(encrypted);
      // The OS rotated its key: write the value again under the new one. Best effort.
      if (shouldReEncrypt) await set(name, result).catch(() => undefined);
      return result;
    } catch {
      // Encrypted under a key this machine no longer has: the blob is useless, drop it.
      await remove(name).catch(() => undefined);
      return null;
    }
  };

  return { isAvailable, get, set, delete: remove };
};

export type { SecretStore, SecretStoreOptions };
export { SecretStoreUnavailableError };
export default createSecretStore;
