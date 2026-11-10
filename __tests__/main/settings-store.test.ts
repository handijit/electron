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
import { rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import createSettingsStore from "../../lib/main/settings-store";

const mocks = vi.hoisted(() => ({
  app: { getPath: vi.fn<(name: string) => string>() },
}));

vi.mock("electron", () => ({ app: mocks.app }));

// The real file system is used; `writeFile` and `rename` pass through unless a test makes
// one of them fail.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  };
});

const schema = z.object({
  theme: z.enum(["system", "light", "dark"]).default("system"),
  zoom: z.number().min(0.5).max(3).default(1),
  recent: z.array(z.string()).default([]),
});
type Settings = z.infer<typeof schema>;

const DEFAULTS: Settings = { theme: "system", zoom: 1, recent: [] };
const NOW = new Date("2026-03-04T05:06:07.000Z");

let directory: string;
let file: string;

const readStored = (): unknown => JSON.parse(readFileSync(file, "utf8"));

beforeEach(() => {
  vi.mocked(rename).mockReset();
  vi.mocked(writeFile).mockReset();
  directory = mkdtempSync(join(tmpdir(), "hd-electron-settings-"));
  file = join(directory, "settings.json");
  mocks.app.getPath.mockReset();
  mocks.app.getPath.mockReturnValue(directory);
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("createSettingsStore", () => {
  describe("opening", () => {
    test("should start with the schema defaults and write nothing on a first run", async () => {
      const store = await createSettingsStore({ schema, directory });

      expect(store.get()).toEqual(DEFAULTS);
      expect(store.path).toBe(file);
      expect(readdirSync(directory)).toEqual([]);
    });

    test("should live in userData as settings.json unless told otherwise", async () => {
      const byDefault = await createSettingsStore({ schema });

      expect(mocks.app.getPath).toHaveBeenCalledExactlyOnceWith("userData");
      expect(byDefault.path).toBe(join(directory, "settings.json"));

      mocks.app.getPath.mockClear();
      const elsewhere = join(directory, "elsewhere");
      const custom = await createSettingsStore({
        schema,
        directory: elsewhere,
        fileName: "prefs.json",
      });

      expect(mocks.app.getPath).not.toHaveBeenCalled();
      expect(custom.path).toBe(join(elsewhere, "prefs.json"));
    });

    test("should load a stored file and fill the keys it lacks with their defaults", async () => {
      writeFileSync(file, JSON.stringify({ theme: "dark", recent: ["a.txt"] }));

      const store = await createSettingsStore({ schema, directory });

      expect(store.get()).toEqual({
        theme: "dark",
        zoom: 1,
        recent: ["a.txt"],
      });
    });

    test("should refuse a schema that has no value for a first run", async () => {
      const onCorrupt = vi.fn();

      await expect(
        createSettingsStore({
          schema: z.object({ name: z.string() }),
          directory,
          onCorrupt,
        })
      ).rejects.toThrow(
        /^createSettingsStore: the schema must accept \{\} \(give every key a default\): /
      );
      expect(onCorrupt).not.toHaveBeenCalled();
    });

    test("should reject, and move nothing, when the file exists but cannot be read", async () => {
      // A folder where the file should be: reading fails with something other than "missing".
      mkdirSync(file);

      await expect(
        createSettingsStore({ schema, directory })
      ).rejects.toMatchObject({ code: "EISDIR" });

      expect(readdirSync(directory)).toEqual(["settings.json"]);
    });
  });

  describe("corrupt files", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });

    test("sentinel: should set a file that is not JSON aside and start with the defaults", async () => {
      writeFileSync(file, '{"theme": "dark", "zo');
      const onCorrupt = vi.fn();

      const store = await createSettingsStore({ schema, directory, onCorrupt });

      const backup = `${file}.corrupt-${NOW.getTime()}`;
      expect(store.get()).toEqual(DEFAULTS);
      expect(readdirSync(directory)).toEqual([
        `settings.json.corrupt-${NOW.getTime()}`,
      ]);
      // The old bytes are kept for support, untouched.
      expect(readFileSync(backup, "utf8")).toBe('{"theme": "dark", "zo');
      expect(onCorrupt).toHaveBeenCalledExactlyOnceWith(
        backup,
        expect.any(SyntaxError)
      );
    });

    test("sentinel: should set a file the schema refuses aside and start with the defaults", async () => {
      writeFileSync(file, JSON.stringify({ theme: "neon", zoom: 99 }));
      const onCorrupt = vi.fn();

      const store = await createSettingsStore({ schema, directory, onCorrupt });

      const backup = `${file}.corrupt-${NOW.getTime()}`;
      expect(store.get()).toEqual(DEFAULTS);
      expect(readFileSync(backup, "utf8")).toBe('{"theme":"neon","zoom":99}');
      expect(onCorrupt).toHaveBeenCalledExactlyOnceWith(
        backup,
        expect.any(z.ZodError)
      );
    });

    test.each([
      ["null", "null"],
      ["an array", "[1, 2]"],
      ["a string", '"dark"'],
      ["an empty file", ""],
    ])(
      "sentinel: should recover from a file that holds %s",
      async (_label, content) => {
        writeFileSync(file, content);

        // No `onCorrupt`: recovery does not depend on someone listening.
        const store = await createSettingsStore({ schema, directory });

        expect(store.get()).toEqual(DEFAULTS);
        expect(readFileSync(`${file}.corrupt-${NOW.getTime()}`, "utf8")).toBe(
          content
        );
      }
    );

    test("should write a fresh file after a recovery, next to the one set aside", async () => {
      writeFileSync(file, "not json");
      const store = await createSettingsStore({ schema, directory });

      await store.set({ theme: "light" });

      expect(readStored()).toEqual({ ...DEFAULTS, theme: "light" });
      expect(readdirSync(directory).sort()).toEqual([
        "settings.json",
        `settings.json.corrupt-${NOW.getTime()}`,
      ]);
    });

    test("should reject when the corrupt file cannot be set aside", async () => {
      writeFileSync(file, "not json");
      const failure = new Error("EACCES: rename refused");
      vi.mocked(rename).mockRejectedValueOnce(failure);
      const onCorrupt = vi.fn();

      await expect(
        createSettingsStore({ schema, directory, onCorrupt })
      ).rejects.toBe(failure);

      expect(onCorrupt).not.toHaveBeenCalled();
      expect(readFileSync(file, "utf8")).toBe("not json");
    });
  });

  describe("set", () => {
    test("should merge the patch, write the file and resolve with the new settings", async () => {
      const store = await createSettingsStore({ schema, directory });

      const next = await store.set({ theme: "dark" });

      expect(next).toEqual({ ...DEFAULTS, theme: "dark" });
      expect(store.get()).toBe(next);
      expect(readFileSync(file, "utf8")).toBe(
        `${JSON.stringify({ ...DEFAULTS, theme: "dark" }, null, 2)}\n`
      );
      expect(readdirSync(directory)).toEqual(["settings.json"]);
    });

    test("should keep the keys a later patch does not mention", async () => {
      const store = await createSettingsStore({ schema, directory });

      await store.set({ theme: "dark" });
      await store.set({ zoom: 2 });

      expect(readStored()).toEqual({ theme: "dark", zoom: 2, recent: [] });
    });

    test("should be read back by the next start", async () => {
      const first = await createSettingsStore({ schema, directory });
      await first.set({ zoom: 1.5, recent: ["a", "b"] });

      const second = await createSettingsStore({ schema, directory });

      expect(second.get()).toEqual({
        theme: "system",
        zoom: 1.5,
        recent: ["a", "b"],
      });
    });

    test.skipIf(process.platform === "win32")(
      "should keep the file private to the user",
      async () => {
        const store = await createSettingsStore({ schema, directory });

        await store.set({ theme: "dark" });

        expect(statSync(file).mode & 0o777).toBe(0o600);
      }
    );

    test("should hand out frozen settings that a caller cannot change", async () => {
      const store = await createSettingsStore({ schema, directory });
      const initial = store.get() as Settings;

      expect(Object.isFrozen(initial)).toBe(true);
      expect(() => {
        initial.theme = "dark";
      }).toThrow(TypeError);

      const next = (await store.set({ zoom: 2 })) as Settings;

      expect(Object.isFrozen(next)).toBe(true);
      expect(initial).toEqual(DEFAULTS);
    });

    test("sentinel: should reject a patch the schema refuses and change nothing", async () => {
      const store = await createSettingsStore({ schema, directory });
      await store.set({ theme: "dark" });
      const before = readFileSync(file, "utf8");
      const listener = vi.fn();
      store.onChange(listener);
      vi.mocked(writeFile).mockClear();

      await expect(
        // @ts-expect-error -- a value outside the schema, as untyped input from a renderer would be
        store.set({ theme: "neon" })
      ).rejects.toBeInstanceOf(z.ZodError);
      await expect(store.set({ zoom: 99 })).rejects.toBeInstanceOf(z.ZodError);

      expect(store.get()).toEqual({ ...DEFAULTS, theme: "dark" });
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(writeFile).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    });

    test("sentinel: should keep the stored file and the current settings when the rename fails", async () => {
      const store = await createSettingsStore({ schema, directory });
      await store.set({ theme: "dark" });
      const before = readFileSync(file, "utf8");
      const listener = vi.fn();
      store.onChange(listener);
      const failure = new Error("EIO: rename failed");
      vi.mocked(rename).mockRejectedValueOnce(failure);

      await expect(store.set({ theme: "light" })).rejects.toBe(failure);

      expect(readFileSync(file, "utf8")).toBe(before);
      expect(readdirSync(directory)).toEqual(["settings.json"]);
      expect(store.get()).toEqual({ ...DEFAULTS, theme: "dark" });
      expect(listener).not.toHaveBeenCalled();
    });

    test("sentinel: should keep the stored file valid when the disk fails half-way through a write", async () => {
      const store = await createSettingsStore({ schema, directory });
      await store.set({ theme: "dark", recent: ["a.txt"] });
      const before = readFileSync(file, "utf8");
      vi.mocked(writeFile).mockImplementationOnce(async (target, content) => {
        writeFileSync(String(target), String(content).slice(0, 10));
        throw new Error("ENOSPC: no space left on device");
      });

      await expect(store.set({ theme: "light" })).rejects.toThrow("ENOSPC");

      expect(readFileSync(file, "utf8")).toBe(before);
      expect(readdirSync(directory)).toEqual(["settings.json"]);
      // The next start reads the last good settings, not defaults.
      const reopened = await createSettingsStore({ schema, directory });
      expect(reopened.get()).toEqual({
        theme: "dark",
        zoom: 1,
        recent: ["a.txt"],
      });
    });

    test("should keep working after a failed write", async () => {
      const store = await createSettingsStore({ schema, directory });
      vi.mocked(rename).mockRejectedValueOnce(new Error("rename failed"));

      await expect(store.set({ theme: "light" })).rejects.toThrow();
      await expect(store.set({ zoom: 99 })).rejects.toThrow();
      const next = await store.set({ theme: "dark" });

      expect(next).toEqual({ ...DEFAULTS, theme: "dark" });
      expect(readStored()).toEqual({ ...DEFAULTS, theme: "dark" });
    });

    test("should run overlapping writes one after another, each building on the one before", async () => {
      const store = await createSettingsStore({ schema, directory });
      const changes: [Settings, Settings][] = [];
      store.onChange((next, previous) => changes.push([next, previous]));

      const results = await Promise.all([
        store.set({ theme: "dark" }),
        store.set({ zoom: 2 }),
        store.set({ recent: ["a"] }),
      ]);

      expect(results).toEqual([
        { theme: "dark", zoom: 1, recent: [] },
        { theme: "dark", zoom: 2, recent: [] },
        { theme: "dark", zoom: 2, recent: ["a"] },
      ]);
      expect(changes).toEqual([
        [results[0], DEFAULTS],
        [results[1], results[0]],
        [results[2], results[1]],
      ]);
      expect(readStored()).toEqual({ theme: "dark", zoom: 2, recent: ["a"] });
      expect(readdirSync(directory)).toEqual(["settings.json"]);
    });

    test("should not let a failed write in the middle disturb its neighbours", async () => {
      const store = await createSettingsStore({ schema, directory });
      // The first rename succeeds, the second fails, the third succeeds.
      vi.mocked(rename)
        .mockImplementationOnce(vi.mocked(rename).getMockImplementation()!)
        .mockRejectedValueOnce(new Error("rename failed"));

      const results = await Promise.allSettled([
        store.set({ theme: "dark" }),
        store.set({ zoom: 2 }),
        store.set({ recent: ["a"] }),
      ]);

      expect(results.map(({ status }) => status)).toEqual([
        "fulfilled",
        "rejected",
        "fulfilled",
      ]);
      expect(readStored()).toEqual({ theme: "dark", zoom: 1, recent: ["a"] });
      expect(store.get()).toEqual({ theme: "dark", zoom: 1, recent: ["a"] });
    });
  });

  describe("reset", () => {
    test("should write the defaults back and tell the listeners", async () => {
      const store = await createSettingsStore({ schema, directory });
      await store.set({ theme: "dark", zoom: 2 });
      const listener = vi.fn();
      store.onChange(listener);

      const next = await store.reset();

      expect(next).toEqual(DEFAULTS);
      expect(store.get()).toEqual(DEFAULTS);
      expect(readStored()).toEqual(DEFAULTS);
      expect(listener).toHaveBeenCalledExactlyOnceWith(DEFAULTS, {
        ...DEFAULTS,
        theme: "dark",
        zoom: 2,
      });
    });
  });

  describe("onChange", () => {
    test("should call every listener with the new and the previous settings, after the write", async () => {
      const store = await createSettingsStore({ schema, directory });
      const seenOnDisk: unknown[] = [];
      const first = vi.fn(() => {
        seenOnDisk.push(readStored());
      });
      const second = vi.fn();
      store.onChange(first);
      store.onChange(second);

      await store.set({ theme: "dark" });

      expect(first).toHaveBeenCalledExactlyOnceWith(
        { ...DEFAULTS, theme: "dark" },
        DEFAULTS
      );
      expect(second).toHaveBeenCalledExactlyOnceWith(
        { ...DEFAULTS, theme: "dark" },
        DEFAULTS
      );
      expect(seenOnDisk).toEqual([{ ...DEFAULTS, theme: "dark" }]);
    });

    test("sentinel: should call every listener even when an earlier one throws", async () => {
      const store = await createSettingsStore({ schema, directory });
      const broken = vi.fn(() => {
        throw new Error("first listener failed");
      });
      const alsoBroken = vi.fn(() => {
        throw new Error("third listener failed");
      });
      const second = vi.fn();
      const fourth = vi.fn();
      store.onChange(broken);
      store.onChange(second);
      store.onChange(alsoBroken);
      store.onChange(fourth);

      await store.set({ theme: "dark" }).catch(() => undefined);

      for (const listener of [broken, second, alsoBroken, fourth]) {
        expect(listener).toHaveBeenCalledExactlyOnceWith(
          { ...DEFAULTS, theme: "dark" },
          DEFAULTS
        );
      }
    });

    test("sentinel: should reject set with the first listener error, after the file and the settings changed", async () => {
      const store = await createSettingsStore({ schema, directory });
      const first = new Error("first listener failed");
      store.onChange(() => undefined);
      store.onChange(() => {
        throw first;
      });
      store.onChange(() => {
        throw new Error("a later listener failed");
      });

      await expect(store.set({ zoom: 2 })).rejects.toBe(first);

      // The change itself happened: the rejection reports the listener, not a lost write.
      expect(readStored()).toEqual({ ...DEFAULTS, zoom: 2 });
      expect(store.get()).toEqual({ ...DEFAULTS, zoom: 2 });
      expect(readdirSync(directory)).toEqual(["settings.json"]);
    });

    test("should reject reset with the listener error, after the defaults were written", async () => {
      const store = await createSettingsStore({ schema, directory });
      await store.set({ theme: "dark", zoom: 2 });
      const failure = new Error("listener failed");
      store.onChange(() => {
        throw failure;
      });

      await expect(store.reset()).rejects.toBe(failure);

      expect(readStored()).toEqual(DEFAULTS);
      expect(store.get()).toEqual(DEFAULTS);
    });

    test("sentinel: should keep writing after a listener threw, each write building on the one before", async () => {
      const store = await createSettingsStore({ schema, directory });
      const failure = new Error("listener failed once");
      const listener = vi.fn<(next: Settings, previous: Settings) => void>();
      listener.mockImplementationOnce(() => {
        throw failure;
      });
      store.onChange(listener);

      const failing = store.set({ zoom: 2 });
      const queued = store.set({ theme: "dark" });

      await expect(failing).rejects.toBe(failure);
      await expect(queued).resolves.toEqual({
        ...DEFAULTS,
        zoom: 2,
        theme: "dark",
      });
      await expect(store.set({ recent: ["a.txt"] })).resolves.toEqual({
        theme: "dark",
        zoom: 2,
        recent: ["a.txt"],
      });

      expect(readStored()).toEqual({
        theme: "dark",
        zoom: 2,
        recent: ["a.txt"],
      });
      expect(listener).toHaveBeenCalledTimes(3);
      expect(listener).toHaveBeenLastCalledWith(
        { theme: "dark", zoom: 2, recent: ["a.txt"] },
        { ...DEFAULTS, zoom: 2, theme: "dark" }
      );
    });

    test("should stop calling a listener that unsubscribed, and tolerate a second call", async () => {
      const store = await createSettingsStore({ schema, directory });
      const stopped = vi.fn();
      const kept = vi.fn();
      const unsubscribe = store.onChange(stopped);
      store.onChange(kept);

      unsubscribe();
      unsubscribe();
      await store.set({ theme: "dark" });

      expect(stopped).not.toHaveBeenCalled();
      expect(kept).toHaveBeenCalledTimes(1);
    });

    test("should still call the listeners of this change when one of them unsubscribes another", async () => {
      const store = await createSettingsStore({ schema, directory });
      const calls: string[] = [];
      const stopSecond = { run: (): void => undefined };
      store.onChange(() => {
        calls.push("first");
        stopSecond.run();
      });
      stopSecond.run = store.onChange(() => calls.push("second"));

      await store.set({ theme: "dark" });
      await store.set({ theme: "light" });

      expect(calls).toEqual(["first", "second", "first"]);
    });
  });
});
