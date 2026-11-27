import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { electron } = vi.hoisted(() => ({
  electron: { app: { getPath: vi.fn() } },
}));
vi.mock("electron", () => electron);

import createPolicyStore from "../../lib/update/policy-store";

const POLICY = {
  latestVersion: "1.5.0",
  minSupportedVersion: "1.4.0",
  fetchedAt: 5,
};

describe("createPolicyStore", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "policy-store-"));
    electron.app.getPath.mockReturnValue(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("should read nothing before anything was written", async () => {
    expect(await createPolicyStore({ directory }).read()).toBeNull();
  });

  test("should write the policy to update-policy.json and read it back", async () => {
    const store = createPolicyStore({ directory });
    await store.write(POLICY);
    expect(await store.read()).toEqual(POLICY);
    expect(
      JSON.parse(await readFile(join(directory, "update-policy.json"), "utf8"))
    ).toEqual({ policy: POLICY });
    await store.write(null);
    expect(await createPolicyStore({ directory }).read()).toBeNull();
  });

  test("should use the user data folder by default", async () => {
    await createPolicyStore().write(POLICY);
    expect(electron.app.getPath).toHaveBeenCalledWith("userData");
    expect(await createPolicyStore({ directory }).read()).toEqual(POLICY);
  });

  test("should set a corrupt file aside and read nothing", async () => {
    await writeFile(join(directory, "update-policy.json"), "{not json");
    expect(await createPolicyStore({ directory }).read()).toBeNull();
  });

  test("should try to open the file again after a failed open", async () => {
    // A folder where the file should be makes the read fail with EISDIR.
    await mkdir(join(directory, "update-policy.json"));
    const store = createPolicyStore({ directory });
    await expect(store.read()).rejects.toThrow();
    await rm(join(directory, "update-policy.json"), { recursive: true });
    expect(await store.read()).toBeNull();
  });
});
