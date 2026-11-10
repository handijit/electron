import type { WebContents } from "electron";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import createEmitter from "../../lib/main/ipc-emitter";
import IpcError from "../../lib/main/ipc-error";
import createUrlPolicy from "../../lib/main/url-policy";
import defineContract from "../../lib/shared/define-contract";

const electron = vi.hoisted(() => ({
  app: { isPackaged: true },
  ipcMain: {},
  webContents: { getAllWebContents: vi.fn<() => WebContents[]>() },
}));

vi.mock("electron", () => electron);

const APP_PAGE = "app://bundle/index.html";

let progressChecks = 0;

const contract = defineContract({
  invoke: {},
  events: {
    "notes:changed": z.object({
      id: z.number({ error: "must be a number" }),
      title: z.string().default("Untitled"),
    }),
    "sync:progress": z.number().refine((value) => {
      progressChecks += 1;
      return value >= 0 && value <= 1;
    }, "must be between 0 and 1"),
  },
});

const policy = createUrlPolicy();

type FakeTarget = {
  isDestroyed: ReturnType<typeof vi.fn<() => boolean>>;
  getURL: ReturnType<typeof vi.fn<() => string>>;
  send: ReturnType<typeof vi.fn<(channel: string, payload: unknown) => void>>;
};

const createTarget = (url: string): FakeTarget => ({
  isDestroyed: vi.fn(() => false),
  getURL: vi.fn(() => url),
  send: vi.fn(),
});

/** A target whose window is gone: Electron throws on everything but `isDestroyed`. */
const createDestroyedTarget = (): FakeTarget => {
  const destroyed = (): never => {
    throw new TypeError("Object has been destroyed");
  };
  return {
    isDestroyed: vi.fn(() => true),
    getURL: vi.fn(destroyed),
    send: vi.fn(destroyed),
  };
};

const asWebContents = (target: FakeTarget): WebContents =>
  target as unknown as WebContents;

const thrownBy = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("expected the action to throw");
};

beforeEach(() => {
  progressChecks = 0;
  electron.app.isPackaged = true;
  electron.webContents.getAllWebContents.mockReset();
  electron.webContents.getAllWebContents.mockReturnValue([]);
});

describe("createEmitter: send", () => {
  test("should send the parsed payload to the app's own page", () => {
    const emitter = createEmitter(contract, { policy });
    const target = createTarget(APP_PAGE);
    const payload = { id: 7, extra: "dropped" };

    const sent = emitter.send(asWebContents(target), "notes:changed", payload);

    expect(sent).toBe(true);
    // Parsed: the default is filled in and the unknown key is gone.
    expect(target.send).toHaveBeenCalledExactlyOnceWith("notes:changed", {
      id: 7,
      title: "Untitled",
    });
  });

  test("should throw on a payload that does not match the schema, and send nothing", () => {
    const emitter = createEmitter(contract, { policy });
    const target = createTarget(APP_PAGE);

    const error = thrownBy(() =>
      emitter.send(asWebContents(target), "notes:changed", {
        // @ts-expect-error -- a payload of the wrong type, as a bug in main would pass it
        id: "seven",
      })
    );

    expect(error).toBeInstanceOf(IpcError);
    expect(error).toMatchObject({
      code: "INVALID_EVENT",
      channel: "notes:changed",
      message: "[INVALID_EVENT] notes:changed: id: must be a number",
    });
    expect(target.send).not.toHaveBeenCalled();
  });

  test("should validate the payload before it looks at the target", () => {
    const emitter = createEmitter(contract, { policy });
    const target = createTarget(APP_PAGE);

    expect(() =>
      emitter.send(asWebContents(target), "sync:progress", 2)
    ).toThrow("[INVALID_EVENT] sync:progress: must be between 0 and 1");
    expect(target.isDestroyed).not.toHaveBeenCalled();
    expect(target.getURL).not.toHaveBeenCalled();
    expect(target.send).not.toHaveBeenCalled();
  });

  test("should skip a destroyed target without touching it", () => {
    const emitter = createEmitter(contract, { policy });
    const target = createDestroyedTarget();

    expect(emitter.send(asWebContents(target), "sync:progress", 0.5)).toBe(
      false
    );
    expect(target.getURL).not.toHaveBeenCalled();
    expect(target.send).not.toHaveBeenCalled();
  });

  test.each([
    "https://evil.test/",
    "http://localhost:5173/",
    "app://evil/index.html",
    "devtools://devtools/bundled/devtools_app.html",
    "about:blank",
    "",
  ])("should never send to the foreign page %j", (url) => {
    const emitter = createEmitter(contract, { policy });
    const target = createTarget(url);

    expect(emitter.send(asWebContents(target), "sync:progress", 0.5)).toBe(
      false
    );
    expect(target.send).not.toHaveBeenCalled();
  });

  test("should send to the dev server page of an unpackaged app only", () => {
    electron.app.isPackaged = false;
    const emitter = createEmitter(contract, {
      policy: createUrlPolicy({ devServerUrl: "http://localhost:5173" }),
    });
    const devPage = createTarget("http://localhost:5173/");
    const otherPort = createTarget("http://localhost:5174/");

    expect(emitter.send(asWebContents(devPage), "sync:progress", 1)).toBe(true);
    expect(emitter.send(asWebContents(otherPort), "sync:progress", 1)).toBe(
      false
    );
    expect(devPage.send).toHaveBeenCalledExactlyOnceWith("sync:progress", 1);
    expect(otherPort.send).not.toHaveBeenCalled();
  });

  test.each(["notes:deleted", "toString", "constructor", "__proto__"])(
    "should refuse the event %j, which is not in the contract",
    (channel) => {
      const emitter = createEmitter(contract, { policy });
      const target = createTarget(APP_PAGE);

      expect(() =>
        // @ts-expect-error -- a channel the contract does not declare
        emitter.send(asWebContents(target), channel, { id: 1 })
      ).toThrow(
        new TypeError(
          `createEmitter: event "${channel}" is not in the contract`
        )
      );
      expect(target.send).not.toHaveBeenCalled();
    }
  );
});

describe("createEmitter: broadcast", () => {
  test("should send to every window of the app and count them", () => {
    const emitter = createEmitter(contract, { policy });
    const first = createTarget(APP_PAGE);
    const second = createTarget("app://bundle/settings");
    electron.webContents.getAllWebContents.mockReturnValue(
      [first, second].map(asWebContents)
    );

    expect(emitter.broadcast("notes:changed", { id: 3, title: "A" })).toBe(2);
    for (const target of [first, second]) {
      expect(target.send).toHaveBeenCalledExactlyOnceWith("notes:changed", {
        id: 3,
        title: "A",
      });
    }
  });

  test("should skip destroyed and foreign targets", () => {
    const emitter = createEmitter(contract, { policy });
    const appPage = createTarget(APP_PAGE);
    const destroyed = createDestroyedTarget();
    const foreign = createTarget("https://evil.test/");
    const devTools = createTarget("devtools://devtools/bundled/inspector.html");
    electron.webContents.getAllWebContents.mockReturnValue(
      [destroyed, foreign, appPage, devTools].map(asWebContents)
    );

    expect(emitter.broadcast("sync:progress", 0.25)).toBe(1);
    expect(appPage.send).toHaveBeenCalledExactlyOnceWith("sync:progress", 0.25);
    expect(destroyed.getURL).not.toHaveBeenCalled();
    expect(destroyed.send).not.toHaveBeenCalled();
    expect(foreign.send).not.toHaveBeenCalled();
    expect(devTools.send).not.toHaveBeenCalled();
  });

  test("should count nothing when no window is open", () => {
    const emitter = createEmitter(contract, { policy });

    expect(emitter.broadcast("sync:progress", 0)).toBe(0);
  });

  test("should validate the payload once, before it looks for targets", () => {
    const emitter = createEmitter(contract, { policy });
    const targets = [createTarget(APP_PAGE), createTarget(APP_PAGE)];
    electron.webContents.getAllWebContents.mockReturnValue(
      targets.map(asWebContents)
    );

    emitter.broadcast("sync:progress", 1);

    expect(progressChecks).toBe(1);
  });

  test("should throw on a payload that does not match the schema, and send nothing", () => {
    const emitter = createEmitter(contract, { policy });
    const target = createTarget(APP_PAGE);
    electron.webContents.getAllWebContents.mockReturnValue([
      asWebContents(target),
    ]);

    const error = thrownBy(() => emitter.broadcast("sync:progress", 1.5));

    expect(error).toBeInstanceOf(IpcError);
    expect(error).toMatchObject({
      code: "INVALID_EVENT",
      channel: "sync:progress",
    });
    expect(electron.webContents.getAllWebContents).not.toHaveBeenCalled();
    expect(target.send).not.toHaveBeenCalled();
  });

  test("should refuse an event that is not in the contract", () => {
    const emitter = createEmitter(contract, { policy });

    expect(() =>
      // @ts-expect-error -- a channel the contract does not declare
      emitter.broadcast("notes:deleted", { id: 1 })
    ).toThrow(
      new TypeError(
        'createEmitter: event "notes:deleted" is not in the contract'
      )
    );
    expect(electron.webContents.getAllWebContents).not.toHaveBeenCalled();
  });
});
