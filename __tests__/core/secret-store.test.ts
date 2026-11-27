import type * as FsPromises from "node:fs/promises";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { failures } = vi.hoisted(() => ({ failures: { rm: false } }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>): Promise<void> => {
      if (failures.rm) throw new Error("EPERM");
      return actual.rm(...args);
    },
  };
});

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);

import createSecretStore, {
  SecretStoreUnavailableError,
} from "../../lib/main/secret-store";
import { fakeElectron, paths, resetElectron } from "../helpers/core-electron";

const { app, safeStorage } = fakeElectron;
let directory: string;
const platform = Object.getOwnPropertyDescriptor(process, "platform");

const setPlatform = (value: string): void => {
  Object.defineProperty(process, "platform", { value, configurable: true });
};

beforeEach(async () => {
  failures.rm = false;
  resetElectron();
  directory = await mkdtemp(join(tmpdir(), "secrets-"));
});

afterEach(async () => {
  failures.rm = false;
  Object.defineProperty(process, "platform", platform as PropertyDescriptor);
  await rm(directory, { recursive: true, force: true });
});

describe("createSecretStore", () => {
  test("should store a secret encrypted and read it back", async () => {
    const store = createSecretStore({ directory });
    await store.set("token", "s3cr3t");
    await expect(readFile(join(directory, "token.bin"), "utf8")).resolves.toBe(
      "enc:s3cr3t"
    );
    await expect(store.get("token")).resolves.toBe("s3cr3t");
  });

  test("should keep its files in userData/secrets by default", async () => {
    paths.userData = directory;
    await createSecretStore().set("token", "x");
    expect(await readdir(join(directory, "secrets"))).toEqual(["token.bin"]);
  });

  test("should answer null for a secret that does not exist", async () => {
    await expect(createSecretStore({ directory }).get("none")).resolves.toBe(
      null
    );
  });

  test("should remove a secret, and removing a missing one is fine", async () => {
    const store = createSecretStore({ directory });
    await store.set("token", "x");
    await store.delete("token");
    await store.delete("token");
    await expect(store.get("token")).resolves.toBe(null);
  });

  test.each([[""], ["../escape"], [".hidden"], ["Upper"], ["a".repeat(65)]])(
    "should refuse a name that is not a plain file name: %j",
    async (name) => {
      const store = createSecretStore({ directory });
      await expect(store.get(name)).rejects.toThrow(TypeError);
      await expect(store.set(name, "x")).rejects.toThrow(TypeError);
      await expect(store.delete(name)).rejects.toThrow(TypeError);
    }
  );

  describe("isAvailable", () => {
    test("should be true with OS-backed encryption", async () => {
      await expect(
        createSecretStore({ directory }).isAvailable()
      ).resolves.toBe(true);
    });

    test("should be false before the app is ready", async () => {
      app.isReady.mockReturnValue(false);
      await expect(
        createSecretStore({ directory }).isAvailable()
      ).resolves.toBe(false);
    });

    test("should be false with Linux's hard-coded basic_text password", async () => {
      setPlatform("linux");
      safeStorage.getSelectedStorageBackend.mockReturnValue("basic_text");
      await expect(
        createSecretStore({ directory }).isAvailable()
      ).resolves.toBe(false);
    });

    test("should be true on Linux with a real backend", async () => {
      setPlatform("linux");
      await expect(
        createSecretStore({ directory }).isAvailable()
      ).resolves.toBe(true);
    });

    test("should be false when the check itself fails", async () => {
      safeStorage.isAsyncEncryptionAvailable.mockRejectedValue(new Error("x"));
      await expect(
        createSecretStore({ directory }).isAvailable()
      ).resolves.toBe(false);
    });
  });

  test("should fail closed without encryption: nothing written, nothing read", async () => {
    const store = createSecretStore({ directory });
    await store.set("token", "x");
    safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(false);
    const rejection = store.set("other", "plain");
    await expect(rejection).rejects.toBeInstanceOf(SecretStoreUnavailableError);
    await expect(rejection).rejects.toMatchObject({
      code: "SECRET_STORE_UNAVAILABLE",
      name: "SecretStoreUnavailableError",
    });
    expect(await readdir(directory)).toEqual(["token.bin"]);
    await expect(store.get("token")).resolves.toBe(null);
  });

  test("should write a secret again under the operating system's new key", async () => {
    const store = createSecretStore({ directory });
    await writeFile(join(directory, "token.bin"), "old-key-blob");
    safeStorage.decryptStringAsync.mockResolvedValueOnce({
      result: "value",
      shouldReEncrypt: true,
    });
    await expect(store.get("token")).resolves.toBe("value");
    await expect(readFile(join(directory, "token.bin"), "utf8")).resolves.toBe(
      "enc:value"
    );
  });

  test("should still answer when writing it again fails", async () => {
    const store = createSecretStore({ directory });
    await writeFile(join(directory, "token.bin"), "old-key-blob");
    safeStorage.decryptStringAsync.mockResolvedValueOnce({
      result: "value",
      shouldReEncrypt: true,
    });
    safeStorage.encryptStringAsync.mockRejectedValueOnce(new Error("busy"));
    await expect(store.get("token")).resolves.toBe("value");
  });

  test("should drop a blob encrypted under a key this machine no longer has", async () => {
    const store = createSecretStore({ directory });
    await writeFile(join(directory, "token.bin"), "foreign");
    safeStorage.decryptStringAsync.mockRejectedValueOnce(new Error("bad key"));
    await expect(store.get("token")).resolves.toBe(null);
    expect(await readdir(directory)).toEqual([]);
  });

  test("should still answer null when the useless blob cannot be removed", async () => {
    const store = createSecretStore({ directory });
    await writeFile(join(directory, "token.bin"), "foreign");
    safeStorage.decryptStringAsync.mockRejectedValueOnce(new Error("bad key"));
    failures.rm = true;
    await expect(store.get("token")).resolves.toBe(null);
  });
});
