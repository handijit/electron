import type * as FsPromises from "node:fs/promises";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { failures } = vi.hoisted(() => ({
  failures: { rm: false },
}));

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

import writeFileAtomic from "../../lib/main/atomic-write.helper";

let directory: string;

beforeEach(async () => {
  failures.rm = false;
  directory = await mkdtemp(join(tmpdir(), "atomic-write-"));
});

afterEach(async () => {
  failures.rm = false;
  await rm(directory, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  test("should create the folder and write a file private to the user", async () => {
    const path = join(directory, "nested", "a.json");
    await writeFileAtomic(path, "{}");
    await expect(readFile(path, "utf8")).resolves.toBe("{}");
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  test("should replace an existing file with bytes", async () => {
    const path = join(directory, "a.bin");
    await writeFile(path, "old");
    await writeFileAtomic(path, new Uint8Array([104, 105]));
    await expect(readFile(path, "utf8")).resolves.toBe("hi");
  });

  test("should leave no temporary file behind when the rename fails", async () => {
    // A non-empty folder cannot be replaced by a file.
    const path = join(directory, "taken");
    await mkdir(path);
    await writeFile(join(path, "inside"), "x");
    await expect(writeFileAtomic(path, "new")).rejects.toThrow();
    expect((await readdir(directory)).sort()).toEqual(["taken"]);
  });

  test("should report why the write failed even when the cleanup fails too", async () => {
    const path = join(directory, "taken");
    await mkdir(path);
    await writeFile(join(path, "inside"), "x");
    failures.rm = true;
    await expect(writeFileAtomic(path, "new")).rejects.not.toThrow("EPERM");
  });
});
