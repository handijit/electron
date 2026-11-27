import { EventEmitter } from "node:events";

import { vi } from "vitest";

import type { Logger } from "../../lib/main/logger";
import type { UpdaterEngine } from "../../lib/update/types";

/** A scripted stand-in for electron-updater's `autoUpdater`. */
const createFakeEngine = () => {
  const events = new EventEmitter();
  const originalRollout = vi.fn<(info: unknown) => boolean>(() => false);
  const engine = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowDowngrade: true,
    logger: null as UpdaterEngine["logger"],
    isUserWithinRollout:
      originalRollout as UpdaterEngine["isUserWithinRollout"],
    forceDevUpdateConfig: false,
    setFeedURL: vi.fn(),
    // By default a check finds nothing: it resolves without an event.
    checkForUpdates: vi.fn(async (): Promise<unknown> => ({})),
    downloadUpdate: vi.fn(async (): Promise<unknown> => []),
    quitAndInstall: vi.fn(),
    on: (event: string, listener: (...args: never[]) => void) =>
      events.on(event, listener as (...args: unknown[]) => void),
    removeListener: (event: string, listener: (...args: never[]) => void) =>
      events.removeListener(event, listener as (...args: unknown[]) => void),
    /** Emits an engine event the way electron-updater does. */
    emit: (event: string, ...args: unknown[]) => events.emit(event, ...args),
    listenerCount: (event: string) => events.listenerCount(event),
    originalRollout,
  };
  return engine;
};

type FakeEngine = ReturnType<typeof createFakeEngine>;

/** Lets every pending promise reaction and I/O callback run. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** A logger whose every level is a spy; `child` returns itself. */
const createFakeLogger = () => {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    log,
    logger: { child: vi.fn(() => log) } as unknown as Pick<Logger, "child">,
  };
};

/** A promise and the functions that settle it. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

export type { FakeEngine };
export { createFakeEngine, createFakeLogger, deferred, flush };
