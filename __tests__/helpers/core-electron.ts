import { EventEmitter } from "node:events";

import { vi } from "vitest";

// A scripted stand-in for the parts of `electron` the main entry touches. A test file mocks
// `electron` with `fakeElectron` and calls `resetElectron()` in `beforeEach`.

type Handler = (...args: never[]) => unknown;

const createWebContents = (url = "app://bundle/") => {
  const contents = Object.assign(new EventEmitter(), {
    url,
    destroyed: false,
    getURL: vi.fn((): string => contents.url),
    isDestroyed: vi.fn((): boolean => contents.destroyed),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    getPrintersAsync: vi.fn(
      async (): Promise<{ name: string }[]> => []
    ) as ReturnType<typeof vi.fn>,
    print: vi.fn(),
  });
  return contents;
};

type FakeWebContents = ReturnType<typeof createWebContents>;

class FakeBrowserWindow extends EventEmitter {
  static instances: FakeBrowserWindow[] = [];
  /** When set, the next windows' `loadURL` rejects with it. */
  static loadFailure: Error | null = null;
  static getAllWindows = vi.fn((): FakeBrowserWindow[] =>
    FakeBrowserWindow.instances.filter((window) => !window.isClosed)
  );

  readonly options: Record<string, unknown>;
  readonly webContents: FakeWebContents = createWebContents();
  isClosed = false;
  minimized = false;
  loadURL = vi.fn((): Promise<void> =>
    FakeBrowserWindow.loadFailure === null
      ? Promise.resolve()
      : Promise.reject(FakeBrowserWindow.loadFailure)
  );
  show = vi.fn();
  focus = vi.fn();
  restore = vi.fn();
  isMinimized = vi.fn((): boolean => this.minimized);
  setBackgroundColor = vi.fn();

  constructor(options: Record<string, unknown>) {
    super();
    this.options = options;
    FakeBrowserWindow.instances.push(this);
  }

  close(): void {
    this.isClosed = true;
    this.emit("closed");
  }
}

const paths: Record<string, string> = {};

const app = Object.assign(new EventEmitter(), {
  isPackaged: false,
  getPath: vi.fn((name: string): string => paths[name] ?? `/tmp/${name}`),
  getVersion: vi.fn(() => "1.0.0"),
  requestSingleInstanceLock: vi.fn((): boolean => true),
  quit: vi.fn(),
  exit: vi.fn(),
  whenReady: vi.fn(async (): Promise<void> => undefined),
  isReady: vi.fn((): boolean => true),
  setAsDefaultProtocolClient: vi.fn(),
});

const nativeTheme = Object.assign(new EventEmitter(), {
  themeSource: "system" as string,
  shouldUseDarkColors: false,
});

const handlers = new Map<string, Handler>();
const ipcMain = {
  handle: vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  }),
  removeHandler: vi.fn((channel: string) => {
    handlers.delete(channel);
  }),
};

const protocolHandlers = new Map<string, (request: Request) => unknown>();
const protocol = {
  registerSchemesAsPrivileged: vi.fn(),
  handle: vi.fn((scheme: string, handler: (request: Request) => unknown) => {
    protocolHandlers.set(scheme, handler);
  }),
};

const createSession = () => ({
  setPermissionRequestHandler: vi.fn(),
  setPermissionCheckHandler: vi.fn(),
  setDevicePermissionHandler: vi.fn(),
  webRequest: { onHeadersReceived: vi.fn() },
});

const session = { defaultSession: createSession() };

const allContents: FakeWebContents[] = [];

const fakeElectron = {
  app,
  BrowserWindow: FakeBrowserWindow,
  nativeTheme,
  ipcMain,
  protocol,
  net: { fetch: vi.fn() },
  session,
  shell: { openExternal: vi.fn(async (): Promise<void> => undefined) },
  powerMonitor: new EventEmitter(),
  webContents: { getAllWebContents: vi.fn(() => allContents) },
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(async (): Promise<boolean> => true),
    getSelectedStorageBackend: vi.fn((): string => "gnome_libsecret"),
    encryptStringAsync: vi.fn(async (value: string): Promise<Buffer> =>
      Buffer.from(`enc:${value}`)
    ),
    decryptStringAsync: vi.fn(async (data: Buffer) => ({
      result: data.toString().slice(4),
      shouldReEncrypt: false,
    })),
  },
};

const isMock = (value: unknown): value is { mockReset: () => void } =>
  typeof value === "function" && "mockReset" in value;

const resetElectron = (): void => {
  // `clearMocks` keeps an implementation a test set with `mockReturnValue`; this puts the
  // original one back.
  for (const part of [
    app,
    ipcMain,
    protocol,
    fakeElectron.net,
    fakeElectron.shell,
    fakeElectron.webContents,
    fakeElectron.safeStorage,
  ]) {
    for (const value of Object.values(part))
      if (isMock(value)) value.mockReset();
  }
  FakeBrowserWindow.getAllWindows.mockReset();
  FakeBrowserWindow.instances.length = 0;
  FakeBrowserWindow.loadFailure = null;
  for (const emitter of [app, nativeTheme, fakeElectron.powerMonitor]) {
    emitter.removeAllListeners();
  }
  for (const key of Object.keys(paths)) delete paths[key];
  app.isPackaged = false;
  nativeTheme.themeSource = "system";
  nativeTheme.shouldUseDarkColors = false;
  handlers.clear();
  protocolHandlers.clear();
  allContents.length = 0;
  session.defaultSession = createSession();
};

export type { FakeWebContents };
export {
  allContents,
  createSession,
  createWebContents,
  fakeElectron,
  FakeBrowserWindow,
  handlers,
  paths,
  protocolHandlers,
  resetElectron,
};
