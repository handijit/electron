import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import createSecretStore, {
  SecretStoreUnavailableError,
} from "../../lib/main/secret-store";

type Decrypted = { result: string; shouldReEncrypt: boolean };

const mocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn<(name: string) => string>(),
    isReady: vi.fn<() => boolean>(),
  },
  safeStorage: {
    getSelectedStorageBackend: vi.fn<() => string>(),
    isAsyncEncryptionAvailable: vi.fn<() => Promise<boolean>>(),
    encryptStringAsync: vi.fn<(plain: string) => Promise<Buffer>>(),
    decryptStringAsync:
      vi.fn<
        (
          encrypted: Buffer
        ) => Promise<{ result: string; shouldReEncrypt: boolean }>
      >(),
  },
}));

vi.mock("electron", () => ({
  app: mocks.app,
  safeStorage: mocks.safeStorage,
}));

// The real file system is used; `rm` passes through unless a test makes it fail.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, rm: vi.fn(actual.rm) };
});

// A stand-in for the OS key store: reversible, and its output never contains the plain text.
const CIPHER_PREFIX = "v1:";
const encrypt = (plain: string, prefix = CIPHER_PREFIX): Buffer =>
  Buffer.from(
    prefix + Buffer.from([...plain].reverse().join("")).toString("hex")
  );
const decrypt = (encrypted: Buffer): Decrypted => {
  const text = encrypted.toString();
  const prefix = text.slice(0, 3);
  if (prefix !== "v0:" && prefix !== CIPHER_PREFIX) {
    throw new Error("Error while decrypting the ciphertext");
  }
  const reversed = Buffer.from(text.slice(3), "hex").toString();
  return {
    result: [...reversed].reverse().join(""),
    // "v0:" plays a blob written under a key the OS has since rotated.
    shouldReEncrypt: prefix === "v0:",
  };
};

const SECRET = "refresh-token-value-7f3a";
const PLATFORM = Object.getOwnPropertyDescriptor(process, "platform");

const setPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, "platform", { ...PLATFORM, value: platform });
};

/** Every way the machine can fail to offer real encryption. */
const UNAVAILABLE: readonly (readonly [string, () => void])[] = [
  [
    "the operating system offers no encryption",
    () => mocks.safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(false),
  ],
  [
    "the availability check itself fails",
    () =>
      mocks.safeStorage.isAsyncEncryptionAvailable.mockRejectedValue(
        new Error("keychain locked")
      ),
  ],
  ["the app is not ready yet", () => mocks.app.isReady.mockReturnValue(false)],
  [
    "Linux falls back to its basic_text backend",
    () => {
      setPlatform("linux");
      mocks.safeStorage.getSelectedStorageBackend.mockReturnValue("basic_text");
    },
  ],
];

let root: string;
let directory: string;

/** Every file under the temporary root, relative to it. */
const filesUnderRoot = (): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hd-electron-secrets-"));
  directory = join(root, "secrets");

  vi.mocked(rm).mockReset();
  mocks.app.getPath.mockReset().mockReturnValue(root);
  mocks.app.isReady.mockReset().mockReturnValue(true);
  mocks.safeStorage.getSelectedStorageBackend
    .mockReset()
    .mockReturnValue("gnome_libsecret");
  mocks.safeStorage.isAsyncEncryptionAvailable
    .mockReset()
    .mockResolvedValue(true);
  mocks.safeStorage.encryptStringAsync
    .mockReset()
    .mockImplementation(async (plain) => encrypt(plain));
  mocks.safeStorage.decryptStringAsync
    .mockReset()
    .mockImplementation(async (encrypted) => decrypt(encrypted));
  setPlatform("darwin");
});

afterEach(() => {
  if (PLATFORM !== undefined) {
    Object.defineProperty(process, "platform", PLATFORM);
  }
  rmSync(root, { recursive: true, force: true });
});

describe("createSecretStore", () => {
  describe("isAvailable", () => {
    test("should be true when the app is ready and the OS can encrypt", async () => {
      await expect(createSecretStore().isAvailable()).resolves.toBe(true);
    });

    test.each(UNAVAILABLE)(
      "should be false when %s",
      async (_label, arrange) => {
        arrange();

        await expect(createSecretStore().isAvailable()).resolves.toBe(false);
      }
    );

    test("should not touch safeStorage before the app is ready", async () => {
      mocks.app.isReady.mockReturnValue(false);
      setPlatform("linux");

      await createSecretStore().isAvailable();

      expect(
        mocks.safeStorage.getSelectedStorageBackend
      ).not.toHaveBeenCalled();
      expect(
        mocks.safeStorage.isAsyncEncryptionAvailable
      ).not.toHaveBeenCalled();
    });

    test("should accept a real Linux key store", async () => {
      setPlatform("linux");
      mocks.safeStorage.getSelectedStorageBackend.mockReturnValue("kwallet6");

      await expect(createSecretStore().isAvailable()).resolves.toBe(true);
    });

    test.each(["darwin", "win32"] as const)(
      "should not ask for the Linux backend on %s",
      async (platform) => {
        setPlatform(platform);
        mocks.safeStorage.getSelectedStorageBackend.mockReturnValue(
          "basic_text"
        );

        await expect(createSecretStore().isAvailable()).resolves.toBe(true);
        expect(
          mocks.safeStorage.getSelectedStorageBackend
        ).not.toHaveBeenCalled();
      }
    );
  });

  describe("set and get", () => {
    test("should store a secret under <userData>/secrets and read it back", async () => {
      const store = createSecretStore();

      await store.set("refresh-token", SECRET);

      expect(mocks.app.getPath).toHaveBeenCalledExactlyOnceWith("userData");
      expect(filesUnderRoot()).toEqual([join("secrets", "refresh-token.bin")]);
      await expect(store.get("refresh-token")).resolves.toBe(SECRET);
    });

    test("should use the given folder instead of userData", async () => {
      const elsewhere = join(root, "vault");
      const store = createSecretStore({ directory: elsewhere });

      await store.set("api.key_1", SECRET);

      expect(mocks.app.getPath).not.toHaveBeenCalled();
      expect(filesUnderRoot()).toEqual([join("vault", "api.key_1.bin")]);
      await expect(store.get("api.key_1")).resolves.toBe(SECRET);
    });

    test("sentinel: should write only what the OS encryption returned, never the plain text", async () => {
      const store = createSecretStore({ directory });

      await store.set("refresh-token", SECRET);

      const stored = readFileSync(join(directory, "refresh-token.bin"));
      expect(
        mocks.safeStorage.encryptStringAsync
      ).toHaveBeenCalledExactlyOnceWith(SECRET);
      expect(stored.equals(encrypt(SECRET))).toBe(true);
      for (const name of filesUnderRoot()) {
        expect(readFileSync(join(root, name)).includes(SECRET), name).toBe(
          false
        );
      }
    });

    test.skipIf(process.platform === "win32")(
      "should keep the encrypted file private to the user",
      async () => {
        const store = createSecretStore({ directory });

        await store.set("refresh-token", SECRET);

        expect(
          statSync(join(directory, "refresh-token.bin")).mode & 0o777
        ).toBe(0o600);
      }
    );

    test("should replace a secret that is stored again", async () => {
      const store = createSecretStore({ directory });

      await store.set("refresh-token", "first");
      await store.set("refresh-token", "second");

      await expect(store.get("refresh-token")).resolves.toBe("second");
      expect(readdirSync(directory)).toEqual(["refresh-token.bin"]);
    });

    test("should keep secrets apart by name", async () => {
      const store = createSecretStore({ directory });

      await store.set("a", "alpha");
      await store.set("b", "beta");

      await expect(store.get("a")).resolves.toBe("alpha");
      await expect(store.get("b")).resolves.toBe("beta");
    });

    test("should resolve with null for a secret that was never stored", async () => {
      const store = createSecretStore({ directory });

      await expect(store.get("missing")).resolves.toBeNull();
      expect(mocks.safeStorage.decryptStringAsync).not.toHaveBeenCalled();
    });

    test("should reject, and store nothing, when the encryption fails", async () => {
      const failure = new Error("encryption failed");
      mocks.safeStorage.encryptStringAsync.mockRejectedValue(failure);
      const store = createSecretStore({ directory });

      await expect(store.set("refresh-token", SECRET)).rejects.toBe(failure);

      expect(filesUnderRoot()).toEqual([]);
    });
  });

  describe("failing closed", () => {
    test.each(UNAVAILABLE)(
      "sentinel: should refuse to store a secret when %s",
      async (_label, arrange) => {
        arrange();
        const store = createSecretStore({ directory });

        const attempt = store.set("refresh-token", SECRET);

        await expect(attempt).rejects.toBeInstanceOf(
          SecretStoreUnavailableError
        );
        await expect(attempt).rejects.toMatchObject({
          name: "SecretStoreUnavailableError",
          code: "SECRET_STORE_UNAVAILABLE",
          message: expect.stringContaining("the secret was not stored"),
        });
        // Nothing reached the disk, encrypted or not.
        expect(mocks.safeStorage.encryptStringAsync).not.toHaveBeenCalled();
        expect(filesUnderRoot()).toEqual([]);
        expect(existsSync(directory)).toBe(false);
      }
    );

    test.each(UNAVAILABLE)(
      "sentinel: should read nothing, and keep the stored file, when %s",
      async (_label, arrange) => {
        const store = createSecretStore({ directory });
        await store.set("refresh-token", SECRET);
        arrange();

        await expect(store.get("refresh-token")).resolves.toBeNull();

        expect(mocks.safeStorage.decryptStringAsync).not.toHaveBeenCalled();
        expect(readdirSync(directory)).toEqual(["refresh-token.bin"]);
      }
    );

    test("should be an ordinary Error with a stable code", () => {
      const error = new SecretStoreUnavailableError();

      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe("SECRET_STORE_UNAVAILABLE");
      expect(error.name).toBe("SecretStoreUnavailableError");
    });
  });

  describe("names", () => {
    const UNSAFE_NAMES = [
      "",
      "../escape",
      "..",
      ".hidden",
      "a/b",
      "a\\b",
      "/etc/passwd",
      "C:secret",
      "a b",
      "Token",
      "-flag",
      "_private",
      "token\n",
      "token\0",
      "tökén",
      "a".repeat(65),
    ];

    test.each(UNSAFE_NAMES)(
      "sentinel: should reject the unsafe name %j before anything touches the disk",
      async (name) => {
        const store = createSecretStore({ directory });
        mkdirSync(directory);
        writeFileSync(join(root, "escape.bin"), "must survive");
        const before = filesUnderRoot();

        await expect(store.set(name, SECRET)).rejects.toThrow(TypeError);
        await expect(store.get(name)).rejects.toThrow(TypeError);
        await expect(store.delete(name)).rejects.toThrow(TypeError);
        await expect(store.set(name, SECRET)).rejects.toThrow(
          `secretStore: name ${JSON.stringify(name)} must be 1-64 characters`
        );

        expect(filesUnderRoot()).toEqual(before);
        expect(readFileSync(join(root, "escape.bin"), "utf8")).toBe(
          "must survive"
        );
        expect(mocks.safeStorage.encryptStringAsync).not.toHaveBeenCalled();
        expect(mocks.safeStorage.decryptStringAsync).not.toHaveBeenCalled();
        expect(rm).not.toHaveBeenCalled();
      }
    );

    test("sentinel: should reject an unsafe name even while encryption is unavailable", async () => {
      mocks.app.isReady.mockReturnValue(false);
      const store = createSecretStore({ directory });

      await expect(store.set("../escape", SECRET)).rejects.toThrow(TypeError);
      await expect(store.get("../escape")).rejects.toThrow(TypeError);
    });

    test.each(["a", "0", "refresh-token", "api.key_1", "a".repeat(64)])(
      "should accept the name %j as a file inside the folder",
      async (name) => {
        const store = createSecretStore({ directory });

        await store.set(name, SECRET);

        expect(readdirSync(directory)).toEqual([`${name}.bin`]);
        await expect(store.get(name)).resolves.toBe(SECRET);
      }
    );
  });

  describe("damaged and outdated files", () => {
    test("should drop a file that can no longer be decrypted and resolve with null", async () => {
      const store = createSecretStore({ directory });
      mkdirSync(directory);
      writeFileSync(join(directory, "refresh-token.bin"), "garbage");
      writeFileSync(join(directory, "other.bin"), encrypt("kept"));

      await expect(store.get("refresh-token")).resolves.toBeNull();

      expect(readdirSync(directory)).toEqual(["other.bin"]);
    });

    test("should still resolve with null when the useless file cannot be removed", async () => {
      const store = createSecretStore({ directory });
      mkdirSync(directory);
      writeFileSync(join(directory, "refresh-token.bin"), "garbage");
      vi.mocked(rm).mockRejectedValueOnce(new Error("EACCES: rm refused"));

      await expect(store.get("refresh-token")).resolves.toBeNull();

      expect(rm).toHaveBeenCalledExactlyOnceWith(
        join(directory, "refresh-token.bin"),
        { force: true }
      );
    });

    test("should write the secret again under the new key when the OS rotated its key", async () => {
      const store = createSecretStore({ directory });
      mkdirSync(directory);
      const path = join(directory, "refresh-token.bin");
      writeFileSync(path, encrypt(SECRET, "v0:"));

      await expect(store.get("refresh-token")).resolves.toBe(SECRET);

      expect(readFileSync(path).equals(encrypt(SECRET))).toBe(true);
      // The next read finds an up-to-date blob and writes nothing.
      mocks.safeStorage.encryptStringAsync.mockClear();
      await expect(store.get("refresh-token")).resolves.toBe(SECRET);
      expect(mocks.safeStorage.encryptStringAsync).not.toHaveBeenCalled();
    });

    test("should still return the secret when writing it again fails", async () => {
      const store = createSecretStore({ directory });
      mkdirSync(directory);
      const path = join(directory, "refresh-token.bin");
      writeFileSync(path, encrypt(SECRET, "v0:"));
      mocks.safeStorage.encryptStringAsync.mockRejectedValue(
        new Error("encryption failed")
      );

      await expect(store.get("refresh-token")).resolves.toBe(SECRET);

      // The old blob is still there, still readable.
      expect(readFileSync(path).equals(encrypt(SECRET, "v0:"))).toBe(true);
    });
  });

  describe("delete", () => {
    test("should remove a stored secret and nothing else", async () => {
      const store = createSecretStore({ directory });
      await store.set("a", "alpha");
      await store.set("b", "beta");

      await store.delete("a");

      expect(readdirSync(directory)).toEqual(["b.bin"]);
      await expect(store.get("a")).resolves.toBeNull();
      await expect(store.get("b")).resolves.toBe("beta");
    });

    test("should not mind a secret that does not exist", async () => {
      const store = createSecretStore({ directory });

      await expect(store.delete("missing")).resolves.toBeUndefined();
    });

    test("should work while encryption is unavailable, so a sign-out always clears the token", async () => {
      const store = createSecretStore({ directory });
      await store.set("refresh-token", SECRET);
      mocks.safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(false);

      await store.delete("refresh-token");

      expect(readdirSync(directory)).toEqual([]);
    });
  });
});
