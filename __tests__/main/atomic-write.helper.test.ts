import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import writeFileAtomic from "../../lib/main/atomic-write.helper";

// The real file system is used; `writeFile`, `rename` and `rm` pass through unless a test
// makes one of them fail, which a real disk cannot be asked to do on demand.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    rm: vi.fn(actual.rm),
    writeFile: vi.fn(actual.writeFile),
  };
});

let directory: string;

beforeEach(() => {
  vi.mocked(rename).mockReset();
  vi.mocked(rm).mockReset();
  vi.mocked(writeFile).mockReset();
  directory = mkdtempSync(join(tmpdir(), "hd-electron-atomic-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  test("should write text to a new file", async () => {
    const path = join(directory, "note.txt");

    await writeFileAtomic(path, "merhaba");

    expect(readFileSync(path, "utf8")).toBe("merhaba");
    expect(readdirSync(directory)).toEqual(["note.txt"]);
  });

  test("should write bytes unchanged", async () => {
    const path = join(directory, "blob.bin");
    const bytes = new Uint8Array([0, 255, 10, 13, 128]);

    await writeFileAtomic(path, bytes);

    expect([...readFileSync(path)]).toEqual([...bytes]);
  });

  test("should create the missing parent folders", async () => {
    const path = join(directory, "a", "b", "note.txt");

    await writeFileAtomic(path, "deep");

    expect(readFileSync(path, "utf8")).toBe("deep");
  });

  test("should replace an existing file and leave nothing else behind", async () => {
    const path = join(directory, "note.txt");
    writeFileSync(path, "old content that is longer than the new one");

    await writeFileAtomic(path, "new");

    expect(readFileSync(path, "utf8")).toBe("new");
    expect(readdirSync(directory)).toEqual(["note.txt"]);
  });

  test.skipIf(process.platform === "win32")(
    "should create the file readable and writable by its owner only",
    async () => {
      const path = join(directory, "private.txt");

      await writeFileAtomic(path, "secret");

      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  );

  test("should flush a sibling file to disk and rename it over the target", async () => {
    const path = join(directory, "note.txt");

    await writeFileAtomic(path, "content");

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [temporary, content, options] = vi.mocked(writeFile).mock.calls[0]!;
    // Same folder, so the rename never crosses a file system and stays atomic.
    expect(dirname(String(temporary))).toBe(directory);
    expect(temporary).not.toBe(path);
    expect(content).toBe("content");
    expect(options).toEqual({ mode: 0o600, flush: true });
    expect(rename).toHaveBeenCalledExactlyOnceWith(temporary, path);
  });

  test("sentinel: should keep the old file and remove the temporary one when the rename fails", async () => {
    const path = join(directory, "note.txt");
    writeFileSync(path, "old");
    const failure = new Error("EXDEV: rename failed");
    vi.mocked(rename).mockRejectedValueOnce(failure);

    await expect(writeFileAtomic(path, "new")).rejects.toBe(failure);

    expect(readFileSync(path, "utf8")).toBe("old");
    expect(readdirSync(directory)).toEqual(["note.txt"]);
  });

  test("sentinel: should keep the old file intact when the disk fails half-way through the write", async () => {
    const path = join(directory, "note.txt");
    writeFileSync(path, "old");
    const failure = new Error("ENOSPC: no space left on device");
    vi.mocked(writeFile).mockImplementationOnce(async (target, content) => {
      // What a full disk does: part of the content lands, then the write fails.
      writeFileSync(String(target), String(content).slice(0, 2));
      throw failure;
    });

    await expect(writeFileAtomic(path, "new content")).rejects.toBe(failure);

    expect(readFileSync(path, "utf8")).toBe("old");
    expect(readdirSync(directory)).toEqual(["note.txt"]);
    expect(rename).not.toHaveBeenCalled();
  });

  test("sentinel: should leave no file at all when the first write of a file fails", async () => {
    const path = join(directory, "note.txt");
    vi.mocked(rename).mockRejectedValueOnce(new Error("rename failed"));

    await expect(writeFileAtomic(path, "new")).rejects.toThrow("rename failed");

    expect(readdirSync(directory)).toEqual([]);
  });

  test("sentinel: should reject with why the rename failed when the cleanup fails too", async () => {
    const path = join(directory, "note.txt");
    writeFileSync(path, "old");
    const failure = new Error("EXDEV: rename failed");
    vi.mocked(rename).mockRejectedValueOnce(failure);
    vi.mocked(rm).mockRejectedValueOnce(new Error("EPERM: cleanup failed"));

    await expect(writeFileAtomic(path, "new")).rejects.toBe(failure);

    expect(rm).toHaveBeenCalledTimes(1);
    expect(readFileSync(path, "utf8")).toBe("old");
  });

  test("sentinel: should reject with why the write failed when the cleanup fails too", async () => {
    const path = join(directory, "note.txt");
    writeFileSync(path, "old");
    const failure = new Error("ENOSPC: no space left on device");
    vi.mocked(writeFile).mockRejectedValueOnce(failure);
    vi.mocked(rm).mockRejectedValueOnce(new Error("EPERM: cleanup failed"));

    await expect(writeFileAtomic(path, "new")).rejects.toBe(failure);

    expect(rm).toHaveBeenCalledTimes(1);
    expect(readFileSync(path, "utf8")).toBe("old");
    expect(rename).not.toHaveBeenCalled();
  });

  test("should reject when the parent folder cannot be created", async () => {
    const blocker = join(directory, "blocker");
    writeFileSync(blocker, "a file where a folder is needed");

    await expect(
      writeFileAtomic(join(blocker, "note.txt"), "content")
    ).rejects.toThrow();

    expect(writeFile).not.toHaveBeenCalled();
    expect(readFileSync(blocker, "utf8")).toBe(
      "a file where a folder is needed"
    );
  });

  test("should let concurrent writes of one file each succeed, leaving one complete content", async () => {
    const path = join(directory, "note.txt");
    const contents = ["a".repeat(50_000), "b".repeat(10), "c".repeat(20_000)];

    await Promise.all(
      contents.map((content) => writeFileAtomic(path, content))
    );

    // Each write has its own temporary file: sharing one would mix the contents or lose a rename.
    const temporaries = vi
      .mocked(writeFile)
      .mock.calls.map(([temporary]) => String(temporary));
    expect(new Set(temporaries).size).toBe(3);
    expect(contents).toContain(readFileSync(path, "utf8"));
    expect(readdirSync(directory)).toEqual(["note.txt"]);
  });

  test("should write into a folder that already exists", async () => {
    const folder = join(directory, "existing");
    mkdirSync(folder);

    await writeFileAtomic(join(folder, "note.txt"), "content");

    expect(readdirSync(folder)).toEqual(["note.txt"]);
  });
});
