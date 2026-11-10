import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";
import type { ZodType } from "zod";

import type { Unsubscribe } from "../types";
import writeFileAtomic from "./atomic-write.helper";

type SettingsStoreOptions<T extends Record<string, unknown>> = {
  /** Schema of the whole file. Every key needs a default: `schema.parse({})` is the first-run value. */
  schema: ZodType<T>;
  /** Folder of the file. Default: `app.getPath("userData")`. */
  directory?: string;
  /** Name of the file. Default: `settings.json`. */
  fileName?: string;
  /** Called when a corrupt file was set aside; `backupPath` is where it went. */
  onCorrupt?: (backupPath: string, reason: unknown) => void;
};

/** Validated settings kept in one small JSON file. */
type SettingsStore<T extends Record<string, unknown>> = {
  /** Absolute path of the file. */
  readonly path: string;
  /** The current settings. The object is frozen; `set` replaces it. */
  readonly get: () => Readonly<T>;
  /** Merges a patch, validates the result, writes it atomically and resolves with it. */
  readonly set: (patch: Partial<T>) => Promise<Readonly<T>>;
  /** Writes the defaults back. */
  readonly reset: () => Promise<Readonly<T>>;
  /** Listens to changes. Returns the function that stops listening. */
  readonly onChange: (
    listener: (next: Readonly<T>, previous: Readonly<T>) => void
  ) => Unsubscribe;
};

const isMissingFile = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException | null)?.code === "ENOENT";

/**
 * Opens the settings file. A missing file means first run. A file that is not JSON, or that
 * the schema refuses, is renamed to `<name>.corrupt-<time>` and the defaults are used: the
 * app starts, and the old file is still there for support.
 */
const createSettingsStore = async <T extends Record<string, unknown>>({
  schema,
  directory = app.getPath("userData"),
  fileName = "settings.json",
  onCorrupt,
}: SettingsStoreOptions<T>): Promise<SettingsStore<T>> => {
  const path = join(directory, fileName);
  const defaults = schema.safeParse({});
  if (!defaults.success) {
    throw new TypeError(
      `createSettingsStore: the schema must accept {} (give every key a default): ${defaults.error.message}`
    );
  }
  const freeze = (value: T): Readonly<T> => Object.freeze({ ...value });

  let current = freeze(defaults.data);
  let raw: string | undefined;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  if (raw !== undefined) {
    try {
      current = freeze(schema.parse(JSON.parse(raw)));
    } catch (reason) {
      const backupPath = `${path}.corrupt-${Date.now()}`;
      await rename(path, backupPath);
      onCorrupt?.(backupPath, reason);
    }
  }

  const listeners = new Set<
    (next: Readonly<T>, previous: Readonly<T>) => void
  >();
  // Writes run one after another, so two quick `set` calls cannot interleave their files.
  let queue: Promise<unknown> = Promise.resolve();

  const replace = (build: () => T): Promise<Readonly<T>> => {
    const task = queue.then(async () => {
      const next = freeze(schema.parse(build()));
      await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
      const previous = current;
      current = next;
      // Every listener hears the change; the first one that throws fails the call afterwards.
      const failures: unknown[] = [];
      for (const listener of [...listeners]) {
        try {
          listener(next, previous);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw failures[0];
      return next;
    });
    queue = task.catch(() => undefined);
    return task;
  };

  return {
    path,
    get: () => current,
    set: (patch) => replace(() => ({ ...current, ...patch })),
    reset: () => replace(() => defaults.data),
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export type { SettingsStore, SettingsStoreOptions };
export default createSettingsStore;
