import { describe, expect, test, vi } from "vitest";

import createSessionVault, {
  SESSION_SECRET_NAME,
} from "../../lib/auth/session-vault";
import { createFakeSecretStore } from "../helpers/auth-fakes";

const USER = { id: "u1", name: "Ayşe", email: null };
const stored = (value: unknown): string => JSON.stringify(value);

const setup = (initial: Record<string, string> = {}) => {
  const secretStore = createFakeSecretStore(initial);
  const logger = { info: vi.fn(), warn: vi.fn() };
  return {
    secretStore,
    logger,
    vault: createSessionVault({ secretStore, logger }),
  };
};

describe("createSessionVault", () => {
  test("should save and load the session under one secret", async () => {
    const { vault, secretStore } = setup();
    await expect(vault.save({ refreshToken: "r", user: USER })).resolves.toBe(
      true
    );
    expect(
      JSON.parse(secretStore.values.get(SESSION_SECRET_NAME) as string)
    ).toEqual({
      v: 1,
      refreshToken: "r",
      user: USER,
    });
    await expect(vault.load()).resolves.toEqual({
      refreshToken: "r",
      user: USER,
    });
  });

  test("should keep a session without a user", async () => {
    const { vault } = setup({
      [SESSION_SECRET_NAME]: stored({ v: 1, refreshToken: "r", user: null }),
    });
    await expect(vault.load()).resolves.toEqual({
      refreshToken: "r",
      user: null,
    });
  });

  test("should answer null when nothing is stored", async () => {
    const { vault } = setup();
    await expect(vault.load()).resolves.toBeNull();
  });

  test("should answer null when the store cannot be read", async () => {
    const { vault, secretStore, logger } = setup();
    vi.mocked(secretStore.get).mockRejectedValueOnce(new Error("locked"));
    await expect(vault.load()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "The stored session could not be read",
      { reason: "locked" }
    );
  });

  test.each([
    ["not JSON", "{"],
    ["another version", stored({ v: 2, refreshToken: "r", user: null })],
    ["an empty token", stored({ v: 1, refreshToken: "", user: null })],
  ])("should remove a stored value that is %s", async (_name, value) => {
    const { vault, secretStore, logger } = setup({
      [SESSION_SECRET_NAME]: value,
    });
    await expect(vault.load()).resolves.toBeNull();
    expect(secretStore.values.has(SESSION_SECRET_NAME)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "The stored session is not valid and was removed"
    );
  });

  test("should report a removal that fails", async () => {
    const { vault, secretStore, logger } = setup({
      [SESSION_SECRET_NAME]: "{",
    });
    vi.mocked(secretStore.delete).mockRejectedValueOnce(new Error("busy"));
    await expect(vault.load()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "The stored session could not be removed",
      { reason: "busy" }
    );
  });

  test("should answer false and remove an older token when saving fails", async () => {
    const { vault, secretStore, logger } = setup({
      [SESSION_SECRET_NAME]: stored({ v: 1, refreshToken: "old", user: null }),
    });
    vi.mocked(secretStore.set).mockRejectedValueOnce(new Error("no keychain"));
    await expect(vault.save({ refreshToken: "new", user: USER })).resolves.toBe(
      false
    );
    expect(secretStore.values.has(SESSION_SECRET_NAME)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "The session could not be stored; it lasts until the program closes",
      { reason: "no keychain" }
    );
  });

  test("should run its calls in the order they were made", async () => {
    const { vault, secretStore } = setup();
    let release!: () => void;
    vi.mocked(secretStore.set).mockImplementationOnce(
      (name, value) =>
        new Promise<void>((resolve) => {
          release = () => {
            secretStore.values.set(name, value);
            resolve();
          };
        })
    );
    const saving = vault.save({ refreshToken: "r", user: null });
    const clearing = vault.clear();
    await Promise.resolve();
    release();
    await saving;
    await clearing;
    expect(secretStore.values.has(SESSION_SECRET_NAME)).toBe(false);
  });
});
