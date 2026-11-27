import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Mock } from "vitest";

const { electron } = vi.hoisted(() => ({
  electron: {
    app: {
      getVersion: vi.fn(() => "1.4.0"),
      isPackaged: true,
      getPath: vi.fn(() => "C:\\Program Files\\Notes\\Notes.exe"),
    },
    net: { fetch: vi.fn() },
    shell: { openExternal: vi.fn(async () => undefined) },
  },
}));
vi.mock("electron", () => electron);

import type { UpdateState } from "../../lib/types";
import createUpdater from "../../lib/update/create-updater";
import type {
  PolicyStore,
  StoredPolicy,
  UpdaterOptions,
} from "../../lib/update/types";
import { UPDATE_ERROR_MESSAGES } from "../../lib/update/update-error";
import {
  createFakeEngine,
  createFakeLogger,
  deferred,
  flush,
} from "../helpers/update-engine";
import type { FakeEngine } from "../helpers/update-engine";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const FEED = "https://downloads.example.com/notes/";
const PAGE = "https://example.com/notes/download";
const POLICY_URL = "https://api.example.com/notes/update-policy";
const NEWER = { version: "1.5.0", files: [{ url: "notes-x64.exe", size: 9 }] };

const REQUIRED: StoredPolicy = {
  latestVersion: "1.5.0",
  minSupportedVersion: "1.5.0",
  fetchedAt: 0,
};

const errorWith = (code: string, message = "boom"): Error =>
  Object.assign(new Error(message), { code });

const policyResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), init);

let clock = 0;
let disposers: (() => void)[] = [];

type Setup = {
  engine: FakeEngine;
  log: ReturnType<typeof createFakeLogger>["log"];
  store: PolicyStore & {
    read: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };
  // Typed, so an `async` implementation is a promise the mock is meant to return.
  policyFetch: Mock<() => Promise<Response>>;
  openExternal: ReturnType<typeof vi.fn>;
  states: UpdateState[];
  updater: ReturnType<typeof createUpdater>;
};

const setup = (
  overrides: Partial<UpdaterOptions> & { stored?: StoredPolicy | null } = {}
): Setup => {
  const { stored = null, ...options } = overrides;
  const engine = createFakeEngine();
  const { log, logger } = createFakeLogger();
  const store = {
    read: vi.fn(async (): Promise<StoredPolicy | null> => stored),
    write: vi.fn<(policy: StoredPolicy | null) => Promise<void>>(
      async () => undefined
    ),
  };
  // By default the endpoint never answers, so it changes nothing.
  const policyFetch = vi.fn<() => Promise<Response>>(
    () => new Promise<Response>(() => undefined)
  );
  const openExternal = vi.fn<(url: string) => Promise<void>>(
    async () => undefined
  );
  const updater = createUpdater({
    engine,
    feedUrl: FEED,
    downloadPageUrl: PAGE,
    logger,
    currentVersion: "1.4.0",
    buildSupport: "supported",
    platform: "win32",
    arch: "x64",
    now: () => clock,
    random: () => 0.5,
    policyStore: store,
    openExternal,
    policy: { url: POLICY_URL, fetch: policyFetch },
    ...options,
  });
  const states: UpdateState[] = [];
  updater.onChange((state) => states.push(state));
  disposers.push(updater.dispose);
  return { engine, log, store, policyFetch, openExternal, states, updater };
};

const offering = (engine: FakeEngine, info: unknown = NEWER): void => {
  engine.checkForUpdates.mockImplementation(async () => {
    engine.emit("update-available", info);
    return {};
  });
};

beforeEach(() => {
  clock = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
});

describe("createUpdater: options", () => {
  test("should refuse a running version that is not a version", () => {
    expect(() => setup({ currentVersion: "v1" })).toThrow(
      'createUpdater: the current version "v1" is not a version like "1.4.0"'
    );
  });

  test("should read the running version from the app by default", () => {
    const { updater } = setup({ currentVersion: undefined });
    expect(updater.getState().currentVersion).toBe("1.4.0");
    expect(electron.app.getVersion).toHaveBeenCalled();
  });

  test.each([
    [{ feedUrl: "http://downloads.example.com/" }, "feedUrl"],
    [{ feedUrl: "not a url" }, "feedUrl"],
    [{ downloadPageUrl: "ftp://example.com/" }, "downloadPageUrl"],
    [{ policy: { url: "http://api.example.com/" } }, "policy.url"],
  ])("should refuse a URL that is not https: %j", (options, name) => {
    expect(() => setup(options)).toThrow(
      `createUpdater: "${name}" must be an https URL`
    );
  });

  test("should accept plain http towards this computer", () => {
    expect(() =>
      setup({
        feedUrl: "http://127.0.0.1:8080/",
        downloadPageUrl: "http://localhost:8080/",
      })
    ).not.toThrow();
  });

  test("should read the platform, the clock and the jitter from the process by default", async () => {
    const { updater } = setup({
      platform: undefined,
      arch: undefined,
      now: undefined,
      random: undefined,
      policy: undefined,
    });
    expect((await updater.check()).checkedAt).toBeGreaterThan(0);
  });

  test("should start with an idle, frozen state", () => {
    const { updater } = setup();
    const state = updater.getState();
    expect(state).toEqual({
      status: "idle",
      revision: 0,
      currentVersion: "1.4.0",
      policy: {
        verdict: "ok",
        latestVersion: null,
        minSupportedVersion: null,
        checkedAt: null,
      },
      checkedAt: null,
      isInstallPending: false,
    });
    expect(Object.isFrozen(state)).toBe(true);
  });
});

describe("createUpdater: start", () => {
  test("should set the engine up once", async () => {
    const { engine, updater } = setup();
    const first = await updater.start();
    await updater.start();
    expect(first.status).toBe("idle");
    expect(engine.autoDownload).toBe(false);
    expect(engine.autoInstallOnAppQuit).toBe(true);
    expect(engine.allowDowngrade).toBe(false);
    expect(engine.setFeedURL).toHaveBeenCalledTimes(1);
    expect(engine.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: FEED,
    });
    engine.logger?.info("hello");
    expect(engine.listenerCount("update-available")).toBe(1);
  });

  test("should pass the beta channel, the range option and installOnQuit", async () => {
    const { engine, updater } = setup({
      channel: "beta",
      useMultipleRangeRequest: false,
      installOnQuit: false,
    });
    await updater.start();
    expect(engine.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: FEED,
      channel: "beta",
      useMultipleRangeRequest: false,
    });
    expect(engine.autoInstallOnAppQuit).toBe(false);
  });

  test("should detect a packaged Windows build as supported", async () => {
    const { engine, updater } = setup({ buildSupport: undefined });
    await updater.start();
    expect(engine.setFeedURL).toHaveBeenCalled();
    expect(electron.app.getPath).toHaveBeenCalledWith("exe");
  });

  test("should honour a forced development feed in an unpackaged run", async () => {
    electron.app.isPackaged = false;
    try {
      const { engine, updater } = setup({ buildSupport: undefined });
      engine.forceDevUpdateConfig = true;
      expect((await updater.start()).status).toBe("idle");
      const plain = setup({ buildSupport: undefined });
      expect((await plain.updater.start()).status).toBe("unsupported");
    } finally {
      electron.app.isPackaged = true;
    }
  });

  test("should report a build that cannot update itself, and still read the policy", async () => {
    const { engine, updater, store, policyFetch } = setup({
      buildSupport: "unsigned",
      stored: REQUIRED,
    });
    policyFetch.mockImplementation(async () =>
      policyResponse({ latestVersion: "1.5.0", minSupportedVersion: "1.5.0" })
    );
    const state = await updater.start();
    expect(state).toMatchObject({
      status: "unsupported",
      reason: "unsigned",
      policy: { verdict: "required" },
    });
    expect(engine.setFeedURL).not.toHaveBeenCalled();
    expect(store.read).toHaveBeenCalled();
    expect(policyFetch).toHaveBeenCalledTimes(1);

    // The schedule asks the policy only; nothing is downloaded or installed.
    clock = 11 * MINUTE;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(policyFetch).toHaveBeenCalledTimes(2);
    expect(engine.checkForUpdates).not.toHaveBeenCalled();
    expect((await updater.download()).status).toBe("unsupported");
    expect((await updater.install()).status).toBe("unsupported");
  });

  test("should ask no policy and schedule nothing in a development run", async () => {
    const { updater, store, policyFetch } = setup({
      buildSupport: "development",
    });
    await updater.start();
    expect(store.read).not.toHaveBeenCalled();
    expect(policyFetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should ask no policy for a platform no release is built for", async () => {
    const linux = setup({ platform: "linux" });
    await linux.updater.start();
    const ia32 = setup({ platform: "darwin", arch: "ia32" });
    await ia32.updater.start();
    expect(linux.policyFetch).not.toHaveBeenCalled();
    expect(ia32.policyFetch).not.toHaveBeenCalled();
    expect(linux.store.read).not.toHaveBeenCalled();
  });

  test("should work without a policy at all", async () => {
    const { updater, store } = setup({ policy: undefined });
    await updater.check();
    expect(store.read).not.toHaveBeenCalled();
    expect(updater.getState().policy.verdict).toBe("ok");
  });

  test("should use the default store, net.fetch and shell.openExternal", async () => {
    electron.net.fetch.mockResolvedValue(
      policyResponse({ latestVersion: "1.4.0" })
    );
    const { updater } = setup({
      policyStore: undefined,
      openExternal: undefined,
      policy: { url: POLICY_URL },
      // A development run never opens the default store.
      buildSupport: "development",
    });
    await updater.start();
    await updater.openDownloadPage();
    expect(electron.shell.openExternal).toHaveBeenCalledWith(PAGE);

    const asked = setup({ policy: { url: POLICY_URL } });
    await asked.updater.start();
    await flush();
    expect(electron.net.fetch).toHaveBeenCalledWith(
      `${POLICY_URL}?os=windows&arch=x64&channel=stable`,
      expect.objectContaining({ method: "GET" })
    );
  });

  test("should stop when disposed while the build is being examined", async () => {
    const { updater, engine } = setup();
    const starting = updater.start();
    updater.dispose();
    await starting;
    expect(engine.setFeedURL).not.toHaveBeenCalled();
  });

  test("should stop when disposed while the stored policy is read", async () => {
    const reading = deferred<StoredPolicy | null>();
    const { updater, store, policyFetch } = setup();
    store.read.mockReturnValue(reading.promise);
    const starting = updater.start();
    await flush();
    updater.dispose();
    reading.resolve(REQUIRED);
    await starting;
    expect(policyFetch).not.toHaveBeenCalled();
    expect(updater.getState().policy.verdict).toBe("ok");
  });
});

describe("createUpdater: the feed", () => {
  test("should end a check without an event as not-available", async () => {
    const { engine, updater, states } = setup();
    clock = 42;
    engine.allowDowngrade = true;
    engine.checkForUpdates.mockImplementation(async () => {
      expect(engine.allowDowngrade).toBe(false);
      return {};
    });
    const state = await updater.check();
    expect(state).toMatchObject({ status: "not-available", checkedAt: 42 });
    expect(states.map(({ status }) => status)).toEqual([
      "checking",
      "not-available",
    ]);
    expect(states.map(({ revision }) => revision)).toEqual([1, 2]);
  });

  test("should offer a newer version", async () => {
    const { engine, updater, log } = setup();
    offering(engine);
    const state = await updater.check();
    expect(state).toMatchObject({
      status: "available",
      update: { version: "1.5.0", sizeBytes: 9 },
    });
    expect(log.info).toHaveBeenCalledWith("status changed", {
      from: "checking",
      to: "available",
      version: "1.5.0",
    });
  });

  test("should refuse a version that is not newer", async () => {
    const { engine, updater, log } = setup();
    offering(engine, { version: "1.4.0" });
    expect((await updater.check()).status).toBe("not-available");
    expect(log.warn).toHaveBeenCalledWith(
      "the feed offers a version that is not newer; ignored",
      { offered: "1.4.0" }
    );
  });

  test("should fail on a version that is not one", async () => {
    const { engine, updater } = setup();
    offering(engine, { version: "latest" });
    expect(await updater.check()).toMatchObject({
      status: "error",
      error: { code: "INVALID_FEED" },
      update: null,
    });
  });

  test("should call an inactive engine a development run", async () => {
    const { engine, updater } = setup();
    engine.checkForUpdates.mockResolvedValue(null);
    expect(await updater.check()).toMatchObject({
      status: "unsupported",
      reason: "development",
    });
  });

  test("should show a failed check that was asked for, with the program's message", async () => {
    const { engine, updater } = setup({
      errorMessages: { OFFLINE: "No network" },
    });
    engine.checkForUpdates.mockRejectedValue(errorWith("ENOTFOUND"));
    expect(await updater.check()).toMatchObject({
      status: "error",
      error: { code: "OFFLINE", message: "No network" },
    });
  });

  test("should treat a missing channel file as no update", async () => {
    const { engine, updater } = setup();
    engine.checkForUpdates.mockRejectedValue(
      errorWith("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND")
    );
    expect((await updater.check()).status).toBe("not-available");
  });

  test("should hide a failed background check and try again later", async () => {
    const { engine, updater, states } = setup();
    engine.checkForUpdates.mockRejectedValue(errorWith("ETIMEDOUT"));
    await updater.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.getState().status).toBe("idle");
    expect(states.map(({ status }) => status)).toEqual(["checking", "idle"]);

    // The interval is 6 hours with the jitter at its middle.
    await vi.advanceTimersByTimeAsync(6 * HOUR - 1);
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  test("should let a manual check join a running background check", async () => {
    const answer = deferred<unknown>();
    const { engine, updater } = setup({ startDelayMs: 0 });
    engine.checkForUpdates.mockReturnValue(answer.promise);
    await updater.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(updater.getState().status).toBe("checking");
    const checking = updater.check();
    await flush();
    answer.reject(errorWith("ECONNREFUSED"));
    // Joined, so the failure is shown.
    expect((await checking).status).toBe("error");
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  test("should fall back to the defaults for durations out of range", async () => {
    const { engine, updater } = setup({
      startDelayMs: -5,
      checkIntervalMs: MINUTE,
      requiredCacheTtlMs: Number.NaN,
    });
    await updater.start();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(engine.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  test("should ignore an engine failure outside a check or a download", async () => {
    const { engine, updater, log } = setup();
    await updater.start();
    engine.emit("error", errorWith("EPIPE"));
    expect(updater.getState().status).toBe("idle");
    expect(log.warn).toHaveBeenCalledWith(
      "the engine failed outside a check or a download; ignored",
      expect.objectContaining({ code: "OFFLINE", causeCode: "EPIPE" })
    );
  });

  test("should ignore the engine's late answer to a settled check", async () => {
    const { engine, updater } = setup();
    engine.checkForUpdates.mockImplementation(async () => {
      engine.emit("update-available", NEWER);
      throw errorWith("ENOTFOUND");
    });
    expect((await updater.check()).status).toBe("available");
  });
});

describe("createUpdater: downloads", () => {
  test("should download, report progress and finish", async () => {
    const { engine, updater } = setup();
    offering(engine);
    const finished = deferred<unknown>();
    engine.downloadUpdate.mockReturnValue(finished.promise);
    await updater.check();
    expect((await updater.download()).status).toBe("downloading");
    // A second request changes nothing while one runs.
    await updater.download();
    await flush();
    engine.emit("download-progress", {
      percent: 50,
      transferred: 5,
      total: 10,
      bytesPerSecond: 2,
    });
    expect(updater.getState()).toMatchObject({
      status: "downloading",
      progress: { percent: 50, transferredBytes: 5 },
    });
    engine.emit("update-downloaded", NEWER);
    finished.resolve([]);
    await flush();
    expect(updater.getState()).toMatchObject({
      status: "downloaded",
      update: { version: "1.5.0" },
    });
    expect(engine.downloadUpdate).toHaveBeenCalledTimes(1);
    // A check changes nothing once a download is held.
    expect((await updater.check()).status).toBe("downloaded");
  });

  test("should keep a running download through late feed events", async () => {
    const { engine, updater } = setup({ autoDownload: true });
    offering(engine);
    engine.downloadUpdate.mockReturnValue(new Promise(() => undefined));
    await updater.check();
    await flush();
    engine.emit("update-available", NEWER);
    engine.emit("update-not-available");
    expect(updater.getState().status).toBe("downloading");
    expect(engine.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  test("should finish a download whose engine resolves without the event", async () => {
    const { engine, updater } = setup();
    offering(engine);
    await updater.check();
    await updater.download();
    await flush();
    expect(updater.getState().status).toBe("downloaded");
  });

  test("should download at once with autoDownload", async () => {
    const { engine, updater } = setup({ autoDownload: true });
    offering(engine);
    await updater.check();
    await flush();
    expect(engine.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  test("should do nothing on download without an update", async () => {
    const { engine, updater } = setup();
    await updater.download();
    engine.checkForUpdates.mockRejectedValue(errorWith("ENOTFOUND"));
    await updater.check();
    // An error without an update: nothing to download again.
    expect((await updater.download()).status).toBe("error");
    expect(engine.downloadUpdate).not.toHaveBeenCalled();
  });

  test("should show a failed download and download again after a fresh check", async () => {
    const { engine, updater } = setup();
    offering(engine);
    engine.downloadUpdate.mockRejectedValueOnce(errorWith("ENOSPC"));
    await updater.check();
    await updater.download();
    await flush();
    expect(updater.getState()).toMatchObject({
      status: "error",
      error: { code: "DISK" },
      update: { version: "1.5.0" },
    });

    await updater.download();
    await flush();
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(engine.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(updater.getState().status).toBe("downloaded");
  });

  test("should show a failed re-check that was meant to download", async () => {
    const { engine, updater } = setup();
    offering(engine);
    engine.downloadUpdate.mockRejectedValueOnce(errorWith("ENOSPC"));
    await updater.check();
    await updater.download();
    await flush();
    engine.checkForUpdates.mockRejectedValue(errorWith("HTTP_ERROR_500"));
    await updater.download();
    await flush();
    expect(updater.getState()).toMatchObject({
      status: "error",
      error: { code: "SERVER" },
    });
  });

  test("should return to available when the download is cancelled", async () => {
    const { engine, updater } = setup();
    offering(engine);
    const finished = deferred<unknown>();
    engine.downloadUpdate.mockReturnValue(finished.promise);
    await updater.check();
    await updater.download();
    engine.emit("update-cancelled");
    expect(updater.getState().status).toBe("available");
    // The engine's rejection after the cancel belongs to nothing any more.
    finished.reject(new Error("cancelled"));
    await flush();
    expect(updater.getState().status).toBe("available");
  });

  test("should call a refused macOS signature unsupported", async () => {
    const { engine, updater } = setup({ platform: "darwin", arch: "arm64" });
    offering(engine);
    await updater.check();
    await updater.download();
    await flush();
    engine.emit("error", new Error("Code signature at URL did not pass"));
    expect(updater.getState()).toMatchObject({
      status: "unsupported",
      reason: "unsigned",
    });
  });

  test("should call a refused Windows signature an error", async () => {
    const { engine, updater } = setup();
    offering(engine);
    engine.downloadUpdate.mockRejectedValue(
      errorWith("ERR_UPDATER_INVALID_SIGNATURE")
    );
    await updater.check();
    await updater.download();
    await flush();
    expect(updater.getState()).toMatchObject({
      status: "error",
      error: { code: "SIGNATURE" },
    });
  });
});

describe("createUpdater: install", () => {
  const downloadedUpdater = async (overrides: Partial<UpdaterOptions> = {}) => {
    const context = setup(overrides);
    offering(context.engine);
    await context.updater.check();
    await context.updater.download();
    await flush();
    return context;
  };

  test("should quit and install a downloaded update, once", async () => {
    const { engine, updater, log } = await downloadedUpdater();
    expect((await updater.install()).isInstallPending).toBe(true);
    await updater.install();
    expect(engine.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(engine.quitAndInstall).toHaveBeenCalledWith(false, true);

    // A window refused to close: "restarting" ends after 30 seconds.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(updater.getState().isInstallPending).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      "the program is still running after the install was started"
    );
  });

  test("should install silently when asked", async () => {
    const { engine, updater } = await downloadedUpdater({
      isSilentInstall: true,
    });
    await updater.install();
    expect(engine.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  test("should report an installer that could not start", async () => {
    const { engine, updater } = await downloadedUpdater();
    engine.quitAndInstall.mockImplementation(() => {
      throw new Error("spawn failed");
    });
    expect(await updater.install()).toMatchObject({
      status: "error",
      error: { code: "INSTALL", message: UPDATE_ERROR_MESSAGES.INSTALL },
      isInstallPending: false,
    });
  });

  test("should keep a known code for a failed install", async () => {
    const { engine, updater } = await downloadedUpdater();
    engine.emit("error", errorWith("EACCES"));
    expect(updater.getState()).toMatchObject({
      status: "error",
      error: { code: "DISK" },
    });
  });

  test("should never restart unasked outside a required update", async () => {
    const { engine, updater } = setup();
    offering(engine);
    await updater.check();
    expect((await updater.install()).isInstallPending).toBe(false);
    expect(engine.downloadUpdate).not.toHaveBeenCalled();
  });
});

describe("createUpdater: the policy", () => {
  test("should apply a stored required verdict at once and look for the update", async () => {
    const { engine, updater } = setup({ stored: REQUIRED });
    const state = await updater.start();
    expect(state.policy).toEqual({
      verdict: "required",
      latestVersion: "1.5.0",
      minSupportedVersion: "1.5.0",
      checkedAt: 0,
    });
    await flush();
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  test("should offer the update to everyone while it is required", async () => {
    const { engine, updater } = setup();
    await updater.start();
    expect(engine.isUserWithinRollout({})).toBe(false);
    expect(engine.originalRollout).toHaveBeenCalledWith({});

    const required = setup({ stored: REQUIRED });
    await required.updater.start();
    expect(required.engine.isUserWithinRollout({})).toBe(true);
  });

  test("should retry after 1, 2 and 5 minutes, then every 15, while nothing is installable", async () => {
    const { engine, updater } = setup({
      stored: REQUIRED,
      startDelayMs: 7 * DAY - 1,
    });
    await updater.start();
    await flush();
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
    for (const [minutes, calls] of [
      [1, 2],
      [2, 3],
      [5, 4],
      [15, 5],
      [15, 6],
    ] as const) {
      await vi.advanceTimersByTimeAsync(minutes * MINUTE - 1);
      expect(engine.checkForUpdates).toHaveBeenCalledTimes(calls - 1);
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(engine.checkForUpdates).toHaveBeenCalledTimes(calls);
    }
  });

  test("should not retry while a check already runs, nor schedule a second retry", async () => {
    const { engine, updater } = setup({ stored: REQUIRED });
    await updater.start();
    await flush();
    // A not-available from the engine itself while the retry waits.
    engine.emit("update-not-available");
    const answer = deferred<unknown>();
    engine.checkForUpdates.mockReturnValue(answer.promise);
    void updater.check();
    await flush();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(2);
    answer.resolve({});
    await flush();
  });

  test("should show a failed check while required", async () => {
    const { engine, updater } = setup({ stored: REQUIRED });
    engine.checkForUpdates.mockRejectedValue(errorWith("ENOTFOUND"));
    await updater.start();
    await flush();
    expect(updater.getState()).toMatchObject({
      status: "error",
      error: { code: "OFFLINE" },
    });
  });

  test("should download and restart on install while required", async () => {
    const { engine, updater } = setup({ stored: REQUIRED });
    await updater.start();
    await flush();
    expect(updater.getState().status).toBe("not-available");
    offering(engine);
    expect((await updater.install()).isInstallPending).toBe(true);
    await flush();
    expect(engine.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(engine.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test("should download at once on install when the update is available", async () => {
    const { engine, updater } = setup({ stored: REQUIRED });
    offering(engine);
    await updater.start();
    await flush();
    expect(updater.getState().status).toBe("available");
    await updater.install();
    await flush();
    expect(engine.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test("should only arm the restart while a check runs", async () => {
    const answer = deferred<unknown>();
    const { engine, updater } = setup({ stored: REQUIRED });
    engine.checkForUpdates.mockReturnValue(answer.promise);
    await updater.start();
    await flush();
    expect((await updater.install()).isInstallPending).toBe(true);
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
    // Nothing installable after all: the armed restart is dropped.
    answer.resolve({});
    await flush();
    expect(updater.getState()).toMatchObject({
      status: "not-available",
      isInstallPending: false,
    });
  });

  test("should store a fresh answer and require the update", async () => {
    clock = 5 * DAY;
    const { engine, updater, store, policyFetch } = setup();
    policyFetch.mockResolvedValue(
      policyResponse({ latestVersion: "1.6.0", minSupportedVersion: "1.5.0" })
    );
    await updater.start();
    await flush();
    expect(store.write).toHaveBeenCalledWith({
      latestVersion: "1.6.0",
      minSupportedVersion: "1.5.0",
      fetchedAt: 5 * DAY,
    });
    expect(updater.getState().policy).toEqual({
      verdict: "required",
      latestVersion: "1.6.0",
      minSupportedVersion: "1.5.0",
      checkedAt: 5 * DAY,
    });
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  test("should drop the stored policy when the endpoint has no release", async () => {
    clock = 7;
    const { updater, store, policyFetch } = setup({ stored: REQUIRED });
    policyFetch.mockResolvedValue(new Response("", { status: 404 }));
    await updater.start();
    await flush();
    expect(store.write).toHaveBeenCalledWith(null);
    expect(updater.getState().policy).toEqual({
      verdict: "ok",
      latestVersion: null,
      minSupportedVersion: null,
      checkedAt: 7,
    });
  });

  test("should read a policy without a minimum from a program's parser", async () => {
    const { updater, policyFetch } = setup({
      policy: {
        url: POLICY_URL,
        fetch: vi.fn(async () => policyResponse({ newest: "1.5.0" })),
        parse: (body) => ({
          latestVersion: (body as { newest: string }).newest,
        }),
        timeoutMs: 500,
      },
    });
    await updater.start();
    await flush();
    expect(updater.getState().policy).toMatchObject({
      verdict: "recommended",
      minSupportedVersion: null,
    });
    expect(policyFetch).not.toHaveBeenCalled();
  });

  test("should ignore a policy that holds no version", async () => {
    const { updater, store, policyFetch, log } = setup();
    policyFetch.mockResolvedValue(policyResponse({ latestVersion: "latest" }));
    await updater.start();
    await flush();
    expect(store.write).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "the policy holds a version that is not a version; ignored"
    );
  });

  test("should keep the stored verdict when the endpoint cannot be reached", async () => {
    const { updater, policyFetch, log } = setup({ stored: REQUIRED });
    policyFetch.mockRejectedValue(new TypeError("fetch failed"));
    await updater.start();
    await flush();
    expect(updater.getState().policy.verdict).toBe("required");
    expect(log.warn).toHaveBeenCalledWith(
      "the update policy could not be fetched",
      expect.objectContaining({ cause: "fetch failed" })
    );
  });

  test("should never block the program on an unreadable or unwritable store", async () => {
    const { updater, store, policyFetch, log } = setup();
    store.read.mockRejectedValue(new Error("EIO"));
    store.write.mockRejectedValue(new Error("EROFS"));
    policyFetch.mockResolvedValue(policyResponse({ latestVersion: "1.4.0" }));
    expect((await updater.start()).policy.verdict).toBe("ok");
    await flush();
    expect(log.warn).toHaveBeenCalledWith(
      "the stored update policy could not be read",
      expect.objectContaining({ cause: "EIO" })
    );
    expect(log.warn).toHaveBeenCalledWith(
      "the update policy could not be stored",
      expect.objectContaining({ cause: "EROFS" })
    );
  });

  test("should not trust a stored value of the wrong shape", async () => {
    const { updater, store } = setup();
    store.read.mockResolvedValue({ latestVersion: 5 } as never);
    expect((await updater.start()).policy.verdict).toBe("ok");
  });

  test("should ask the policy at most once a minute on clicks", async () => {
    const { updater, policyFetch } = setup();
    policyFetch.mockImplementation(async () =>
      policyResponse({ latestVersion: "1.4.0" })
    );
    await updater.start();
    await flush();
    expect(policyFetch).toHaveBeenCalledTimes(1);
    clock = 30_000;
    await updater.check();
    expect(policyFetch).toHaveBeenCalledTimes(1);
    clock = MINUTE;
    await updater.check();
    await flush();
    expect(policyFetch).toHaveBeenCalledTimes(2);
    // A clock set back must not silence the policy.
    clock = -2 * MINUTE;
    await updater.check();
    expect(policyFetch).toHaveBeenCalledTimes(3);
  });

  test("should share a running policy request", async () => {
    const answer = deferred<Response>();
    const { updater, policyFetch } = setup({ buildSupport: "unsigned" });
    policyFetch.mockReturnValue(answer.promise);
    await updater.start();
    clock = 2 * MINUTE;
    const checking = updater.check();
    await flush();
    expect(policyFetch).toHaveBeenCalledTimes(1);
    answer.resolve(policyResponse({ latestVersion: "1.5.0" }));
    expect((await checking).policy.verdict).toBe("recommended");
  });

  test("should obey a 429 and its Retry-After", async () => {
    const { updater, policyFetch } = setup();
    policyFetch.mockResolvedValueOnce(
      new Response("", { status: 429, headers: { "Retry-After": "1800" } })
    );
    policyFetch.mockResolvedValue(policyResponse({ latestVersion: "1.4.0" }));
    await updater.start();
    await flush();
    clock = 20 * MINUTE;
    await updater.check();
    expect(policyFetch).toHaveBeenCalledTimes(1);
    clock = 30 * MINUTE;
    await updater.check();
    await flush();
    expect(policyFetch).toHaveBeenCalledTimes(2);
  });

  test("should wait ten minutes after a 429 without Retry-After", async () => {
    const { updater, policyFetch } = setup();
    policyFetch.mockResolvedValueOnce(new Response("", { status: 429 }));
    policyFetch.mockResolvedValue(policyResponse({ latestVersion: "1.4.0" }));
    await updater.start();
    await flush();
    clock = 9 * MINUTE;
    await updater.check();
    expect(policyFetch).toHaveBeenCalledTimes(1);
    clock = 10 * MINUTE;
    await updater.check();
    expect(policyFetch).toHaveBeenCalledTimes(2);
  });

  test("should drop the armed restart when the update stops being required", async () => {
    const answer = deferred<unknown>();
    const { engine, updater, policyFetch } = setup({ stored: REQUIRED });
    engine.checkForUpdates.mockReturnValue(answer.promise);
    policyFetch.mockImplementationOnce(async () =>
      policyResponse({ latestVersion: "1.5.0", minSupportedVersion: "1.5.0" })
    );
    await updater.start();
    await flush();
    await updater.install();
    expect(updater.getState().isInstallPending).toBe(true);
    // The minimum was lowered.
    policyFetch.mockImplementation(async () =>
      policyResponse({ latestVersion: "1.5.0" })
    );
    clock = 2 * MINUTE;
    void updater.check();
    await flush();
    expect(updater.getState()).toMatchObject({
      policy: { verdict: "recommended" },
      isInstallPending: false,
    });
    answer.resolve({});
    await flush();
  });

  test("should let a stored required verdict expire while the program runs", async () => {
    const { updater } = setup({ stored: REQUIRED, checkIntervalMs: 8 * DAY });
    await updater.start();
    expect(updater.getState().policy.verdict).toBe("required");
    clock = 8 * DAY;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(updater.getState().policy.verdict).toBe("recommended");
  });

  test("should not look for an update a build cannot install", async () => {
    const { engine, updater, policyFetch } = setup({
      buildSupport: "platform",
    });
    policyFetch.mockResolvedValue(
      policyResponse({ latestVersion: "1.5.0", minSupportedVersion: "1.5.0" })
    );
    await updater.start();
    await flush();
    expect(updater.getState().policy.verdict).toBe("required");
    expect(engine.checkForUpdates).not.toHaveBeenCalled();
    expect((await updater.check()).status).toBe("unsupported");
  });
});

describe("createUpdater: listeners and disposal", () => {
  test("should log a listener that throws and go on", async () => {
    const { updater, log } = setup();
    const stop = updater.onChange(() => {
      throw new Error("listener");
    });
    await updater.check();
    expect(log.error).toHaveBeenCalledWith(
      "a state listener threw",
      expect.objectContaining({ cause: "listener" })
    );
    stop();
  });

  test("should open the download page and never reject", async () => {
    const { updater, openExternal, log } = setup();
    await updater.openDownloadPage();
    expect(openExternal).toHaveBeenCalledWith(PAGE);
    openExternal.mockRejectedValue(new Error("no browser"));
    await expect(updater.openDownloadPage()).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(
      "the download page could not be opened",
      expect.objectContaining({ cause: "no browser" })
    );
  });

  test("should detach and become inert when disposed", async () => {
    const { engine, updater, states } = setup({ stored: REQUIRED });
    await updater.start();
    await flush();
    const before = updater.getState();
    updater.dispose();
    updater.dispose();
    expect(engine.listenerCount("update-available")).toBe(0);
    expect(engine.isUserWithinRollout).toBe(engine.originalRollout);
    expect(vi.getTimerCount()).toBe(0);
    expect(await updater.check()).toBe(before);
    expect(await updater.download()).toBe(before);
    expect(await updater.install()).toBe(before);
    const count = states.length;
    engine.emit("update-available", NEWER);
    expect(states).toHaveLength(count);
  });

  test("should drop a policy answer that arrives after disposal", async () => {
    const answer = deferred<Response>();
    const failure = deferred<Response>();
    const ok = setup();
    ok.policyFetch.mockReturnValue(answer.promise);
    await ok.updater.start();
    ok.updater.dispose();
    answer.resolve(policyResponse({ latestVersion: "1.5.0" }));

    const failing = setup();
    failing.policyFetch.mockReturnValue(failure.promise);
    await failing.updater.start();
    failing.updater.dispose();
    failure.reject(new Error("aborted"));
    await flush();
    expect(ok.store.write).not.toHaveBeenCalled();
    expect(failing.log.warn).not.toHaveBeenCalledWith(
      "the update policy could not be fetched",
      expect.anything()
    );
  });

  test("should start the updater on first use of an action", async () => {
    const { engine, updater } = setup();
    await updater.download();
    expect(engine.setFeedURL).toHaveBeenCalledTimes(1);
  });

  test("should not dispose a disposed engine twice when unsupported", async () => {
    const { engine, updater } = setup({ buildSupport: "unsigned" });
    await updater.start();
    updater.dispose();
    expect(engine.isUserWithinRollout).toBe(engine.originalRollout);
  });
});
