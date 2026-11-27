import type * as FsPromises from "node:fs/promises";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

const { renameFailure } = vi.hoisted(() => ({
  renameFailure: { error: null as Error | null },
}));

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: async (from: string, to: string): Promise<void> => {
      if (renameFailure.error !== null && to.includes(".corrupt-")) {
        throw renameFailure.error;
      }
      return actual.rename(from, to);
    },
  };
});

import createSettingsStore from "../../lib/main/settings-store";
import { paths, resetElectron } from "../helpers/core-electron";

const schema = z.object({
  theme: z.enum(["light", "dark"]).default("light"),
  zoom: z.number().min(0.5).default(1),
});

let directory: string;

beforeEach(async () => {
  resetElectron();
  renameFailure.error = null;
  directory = await mkdtemp(join(tmpdir(), "settings-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const open = (
  options: Partial<Parameters<typeof createSettingsStore>[0]> = {}
) => createSettingsStore({ schema, directory, ...options });

describe("createSettingsStore", () => {
  test("should start from the defaults on the first run", async () => {
    const store = await open();
    expect(store.path).toBe(join(directory, "settings.json"));
    expect(store.get()).toEqual({ theme: "light", zoom: 1 });
    expect(Object.isFrozen(store.get())).toBe(true);
  });

  test("should live in userData by default", async () => {
    paths.userData = directory;
    const store = await createSettingsStore({ schema });
    expect(store.path).toBe(join(directory, "settings.json"));
  });

  test("should read a valid file", async () => {
    await writeFile(join(directory, "app.json"), '{"theme":"dark"}');
    const store = await open({ fileName: "app.json" });
    expect(store.get()).toEqual({ theme: "dark", zoom: 1 });
  });

  test("should refuse a schema without defaults", async () => {
    await expect(
      createSettingsStore({ schema: z.object({ name: z.string() }), directory })
    ).rejects.toThrow(/the schema must accept \{\}/);
  });

  test.each([
    ["not JSON", "{oops"],
    ["refused by the schema", '{"zoom":0.1}'],
  ])(
    "should set a file that is %s aside and use the defaults",
    async (_kind, content) => {
      await writeFile(join(directory, "settings.json"), content);
      const onCorrupt = vi.fn();
      const store = await open({ onCorrupt });
      expect(store.get()).toEqual({ theme: "light", zoom: 1 });
      const [backupPath] = onCorrupt.mock.calls[0] as [string, unknown];
      expect(backupPath).toMatch(/settings\.json\.corrupt-\d+$/);
      await expect(readFile(backupPath, "utf8")).resolves.toBe(content);
      expect(await readdir(directory)).not.toContain("settings.json");
    }
  );

  test("should set a corrupt file aside also without onCorrupt", async () => {
    await writeFile(join(directory, "settings.json"), "{oops");
    const store = await open();
    expect(store.get().theme).toBe("light");
  });

  test("should throw for a file it cannot read", async () => {
    await mkdir(join(directory, "settings.json"));
    await expect(open()).rejects.toThrow();
  });

  test("should merge, validate and write a patch, then tell the listeners", async () => {
    const store = await open();
    const listener = vi.fn();
    store.onChange(listener);
    const next = await store.set({ theme: "dark" });
    expect(next).toEqual({ theme: "dark", zoom: 1 });
    expect(store.get()).toBe(next);
    expect(listener).toHaveBeenCalledWith(next, { theme: "light", zoom: 1 });
    await expect(readFile(store.path, "utf8")).resolves.toBe(
      `${JSON.stringify(next, null, 2)}\n`
    );
  });

  test("should refuse a patch the schema refuses and keep working", async () => {
    const store = await open();
    await expect(store.set({ zoom: 0 })).rejects.toThrow();
    expect(store.get().zoom).toBe(1);
    await expect(store.set({ zoom: 2 })).resolves.toEqual({
      theme: "light",
      zoom: 2,
    });
  });

  test("should run quick writes one after another", async () => {
    const store = await open();
    await Promise.all([store.set({ zoom: 2 }), store.set({ theme: "dark" })]);
    expect(store.get()).toEqual({ theme: "dark", zoom: 2 });
    expect(JSON.parse(await readFile(store.path, "utf8"))).toEqual({
      theme: "dark",
      zoom: 2,
    });
  });

  test("should tell every listener and then fail with the first error", async () => {
    const store = await open();
    const first = new Error("first");
    const later = vi.fn();
    store.onChange(() => {
      throw first;
    });
    store.onChange(() => {
      throw new Error("second");
    });
    store.onChange(later);
    await expect(store.set({ theme: "dark" })).rejects.toBe(first);
    expect(later).toHaveBeenCalledTimes(1);
    expect(store.get().theme).toBe("dark");
  });

  test("should stop telling a listener that left, and reset to the defaults", async () => {
    const store = await open();
    const listener = vi.fn();
    const stop = store.onChange(listener);
    await store.set({ theme: "dark" });
    stop();
    await expect(store.reset()).resolves.toEqual({ theme: "light", zoom: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("regression 1.0.0", () => {
  test("a corrupt file that could not be moved aside stopped the app from starting", async () => {
    await writeFile(join(directory, "settings.json"), "{oops");
    renameFailure.error = new Error("EPERM");
    const onCorrupt = vi.fn();
    const store = await open({ onCorrupt });
    expect(store.get()).toEqual({ theme: "light", zoom: 1 });
    expect(onCorrupt).toHaveBeenCalledWith(null, expect.any(SyntaxError));
    // The next write replaces the corrupt file.
    renameFailure.error = null;
    await store.set({ theme: "dark" });
    expect(JSON.parse(await readFile(store.path, "utf8")).theme).toBe("dark");
  });
});
