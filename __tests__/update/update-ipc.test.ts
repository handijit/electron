import { beforeEach, describe, expect, test, vi } from "vitest";

const { ipcMain, allWebContents } = vi.hoisted(() => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  allWebContents: { getAllWebContents: vi.fn(() => [] as unknown[]) },
}));
vi.mock("electron", () => ({ ipcMain, webContents: allWebContents }));

import type { UpdateState } from "../../lib/types";
import type { Updater } from "../../lib/update/types";
import registerUpdateIpc, {
  createUpdateHandlers,
} from "../../lib/update/update-ipc";
import { makeState } from "../helpers/update-fixtures";

const STATE = makeState();

const fakeUpdater = () => {
  const listeners = new Set<(state: UpdateState) => void>();
  const updater = {
    getState: vi.fn(() => STATE),
    onChange: vi.fn((listener: (state: UpdateState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    start: vi.fn(async () => STATE),
    check: vi.fn(async () => STATE),
    download: vi.fn(async () => STATE),
    install: vi.fn(async () => STATE),
    openDownloadPage: vi.fn(async () => undefined),
    dispose: vi.fn(),
  } satisfies Updater;
  return { updater, listeners };
};

const policy = {
  devServerUrl: undefined,
  isTrustedAppUrl: (url: string) => url.startsWith("app://bundle/"),
  isAllowedExternalUrl: () => false,
};

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlerOf = (channel: string): Handler =>
  ipcMain.handle.mock.calls.find(([name]) => name === channel)?.[1] as Handler;
const APP_EVENT = { senderFrame: { url: "app://bundle/" } };

describe("createUpdateHandlers", () => {
  test("should pass every channel to the updater", async () => {
    const { updater } = fakeUpdater();
    const handlers = createUpdateHandlers(updater);
    expect(handlers["update:get-state"](undefined, {} as never)).toBe(STATE);
    await handlers["update:check"](undefined, {} as never);
    await handlers["update:download"](undefined, {} as never);
    await handlers["update:install"](undefined, {} as never);
    await handlers["update:open-download-page"](undefined, {} as never);
    expect(updater.check).toHaveBeenCalledTimes(1);
    expect(updater.download).toHaveBeenCalledTimes(1);
    expect(updater.install).toHaveBeenCalledTimes(1);
    expect(updater.openDownloadPage).toHaveBeenCalledTimes(1);
  });
});

describe("registerUpdateIpc", () => {
  beforeEach(() => {
    ipcMain.handle.mockReset();
  });

  test("should register the handlers behind the sender check", async () => {
    const { updater } = fakeUpdater();
    registerUpdateIpc({ updater, policy });
    expect(ipcMain.handle.mock.calls.map(([name]) => name)).toEqual([
      "update:get-state",
      "update:check",
      "update:download",
      "update:install",
      "update:open-download-page",
    ]);
    expect(await handlerOf("update:check")(APP_EVENT)).toEqual(STATE);
    await expect(
      handlerOf("update:check")({
        senderFrame: { url: "https://evil.example/" },
      })
    ).rejects.toThrow("[UNTRUSTED_SENDER]");
  });

  test("should report refused calls to onError", async () => {
    const { updater } = fakeUpdater();
    const onError = vi.fn();
    registerUpdateIpc({ updater, policy, onError });
    await expect(
      handlerOf("update:check")({ senderFrame: null })
    ).rejects.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test("should broadcast every change to the app's pages until undone", () => {
    const { updater, listeners } = fakeUpdater();
    const page = {
      isDestroyed: () => false,
      getURL: () => "app://bundle/",
      send: vi.fn(),
    };
    allWebContents.getAllWebContents.mockReturnValue([page]);
    const stop = registerUpdateIpc({ updater, policy });
    const next = makeState({ revision: 2 });
    for (const listener of listeners) listener(next);
    expect(page.send).toHaveBeenCalledWith("update:state-changed", next);

    stop();
    expect(listeners.size).toBe(0);
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(5);
  });
});
