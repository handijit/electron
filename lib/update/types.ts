import type { Logger } from "@handijitcom/electron/main";

import type { FetchLike } from "../shared/fetch-like.type";
import type {
  UnsupportedReason,
  UpdateErrorCode,
  UpdateState,
  Unsubscribe,
} from "../types";

/** The logger interface `electron-updater` writes to. */
type UpdaterEngineLogger = {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
};

/** The levels of the program's logger the updater writes with. */
type UpdaterLogger = Pick<Logger, "debug" | "info" | "warn" | "error">;

type RolloutCheck = {
  // A method, not a property, so that electron-updater's own (a method) is assignable.
  check(updateInfo: unknown): boolean | Promise<boolean>;
}["check"];

/**
 * The part of `electron-updater`'s `AppUpdater` this package uses. `autoUpdater` fits as it
 * is; a test passes a scripted fake.
 */
type UpdaterEngine = {
  /** Set to `false`: the updater decides when a download starts. */
  autoDownload: boolean;
  /** Set from the `installOnQuit` option. */
  autoInstallOnAppQuit: boolean;
  /** Set to `false` before every check. */
  allowDowngrade: boolean;
  /** Replaced by an adapter that writes to the updater's logger. */
  logger: UpdaterEngineLogger | null;
  /** Wrapped: a required update is offered to everyone, whatever the staged rollout says. */
  isUserWithinRollout: RolloutCheck;
  /** `true` when the program asked for updates in an unpackaged run (`dev-app-update.yml`). */
  readonly forceDevUpdateConfig?: boolean;
  setFeedURL(options: {
    provider: "generic";
    url: string;
    channel?: string;
    useMultipleRangeRequest?: boolean;
  }): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
};

/** The last answer of the version policy, as it is kept between starts. */
type StoredPolicy = {
  /** The newest published version. */
  readonly latestVersion: string;
  /** The oldest supported version; `null` when no release sets a floor. */
  readonly minSupportedVersion: string | null;
  /** When the endpoint answered, by this computer's clock (epoch milliseconds). */
  readonly fetchedAt: number;
};

/** Where the last answer of the version policy is kept between starts. */
type PolicyStore = {
  /** The stored policy, or `null` when there is none. */
  readonly read: () => Promise<StoredPolicy | null>;
  /** Replaces the stored policy; `null` removes it. */
  readonly write: (policy: StoredPolicy | null) => Promise<void>;
};

/** The versions a policy answer names. */
type PolicyAnswer = {
  /** The newest published version for this platform and channel. */
  readonly latestVersion: string;
  /** The oldest version still supported; absent or `null` when no release sets a floor. */
  readonly minSupportedVersion?: string | null;
};

/** Where the minimum-version policy is read. Without it no version is ever required. */
type UpdatePolicyOptions = {
  /**
   * The policy endpoint, like `https://api.example.com/products/notes/update-policy`. The updater
   * asks it with `GET`, adding `os` (`windows` or `macos`), `arch` (`x64` or `arm64`) and
   * `channel` (`stable` or `beta`) to the query. `200` with JSON is a policy, `404` means no
   * release (nothing can be required), `429` is obeyed with its `Retry-After`; anything else,
   * and no answer at all, leaves the stored policy in force and never blocks the program.
   */
  url: string;
  /** Turns the JSON body into versions; `null` refuses it. Default: reads `latestVersion` and `minSupportedVersion`. */
  parse?: (body: unknown) => PolicyAnswer | null;
  /** The `fetch` to ask with. Default: Electron's `net.fetch` (system proxy and certificates). */
  fetch?: FetchLike;
  /** How long one request may take, in milliseconds. Default: 10 seconds. */
  timeoutMs?: number;
};

/** How `createUpdater` is set up. */
type UpdaterOptions = {
  /** The `autoUpdater` of `electron-updater` (or anything with the same surface). */
  engine: UpdaterEngine;
  /** The folder that holds the feed (`latest.yml`, `latest-mac.yml`): an https URL. */
  feedUrl: string;
  /** What "download it yourself" opens: an https page with the installers. */
  downloadPageUrl: string;
  /** The logger of the main entry; the updater writes under the `updater` scope. */
  logger: Pick<Logger, "child">;
  /** The minimum-version policy. Leave it out and the verdict is always `ok`. */
  policy?: UpdatePolicyOptions;
  /** The running version. Default: `app.getVersion()`. */
  currentVersion?: string;
  /** The release channel. Default: `"stable"`. */
  channel?: "stable" | "beta";
  /** Download an update as soon as it is found, without asking. Default: `false`. */
  autoDownload?: boolean;
  /** Install a downloaded update when the program quits. Default: `true`. */
  installOnQuit?: boolean;
  /** Windows: run the installer without its window on "restart and update". Default: `false`. */
  isSilentInstall?: boolean;
  /** Set `false` when the server mishandles multi-range requests (differential downloads). Default: the engine decides. */
  useMultipleRangeRequest?: boolean;
  /** How long after `start()` the feed is first read, in milliseconds. Default: 10 seconds. */
  startDelayMs?: number;
  /** How often the feed and the policy are read again, in milliseconds (at least 15 minutes). Default: 6 hours. */
  checkIntervalMs?: number;
  /** How long a stored "required" verdict holds without the endpoint confirming it, in milliseconds. Default: 7 days. */
  requiredCacheTtlMs?: number;
  /** Where the last policy is kept. Default: `update-policy.json` in the user data folder. */
  policyStore?: PolicyStore;
  /** Replaces any of the (Turkish) messages the state carries for a failure. */
  errorMessages?: Partial<Record<UpdateErrorCode, string>>;
  /** Overrides the detection of whether this build can update itself. */
  buildSupport?: "supported" | UnsupportedReason;
  /** Opens the download page. Default: `shell.openExternal`. */
  openExternal?: (url: string) => Promise<void>;
  /** For tests: stands in for `process.platform`. */
  platform?: string;
  /** For tests: stands in for `process.arch`. */
  arch?: string;
  /** For tests: the clock. Default: `Date.now`. */
  now?: () => number;
  /** For tests: the source of the interval's jitter. Default: `Math.random`. */
  random?: () => number;
};

/** The updater of a program: one per main process. */
type Updater = {
  /** The current state. The object is frozen; every change produces a new one. */
  readonly getState: () => UpdateState;
  /** Listens to state changes. Returns the function that stops listening. */
  readonly onChange: (listener: (state: UpdateState) => void) => Unsubscribe;
  /**
   * Finds out whether this build can update itself, loads the stored policy and starts the
   * schedule. Resolves with the state once it reflects both; calling it again starts nothing
   * and resolves with the current state. Never waits for the policy endpoint.
   */
  readonly start: () => Promise<UpdateState>;
  /** Reads the feed and the policy now. Resolves when the feed has answered or failed. */
  readonly check: () => Promise<UpdateState>;
  /** Starts downloading the available update; after a failed download, checks again first. */
  readonly download: () => Promise<UpdateState>;
  /**
   * Restarts into the downloaded update. While an update is required it also downloads first
   * and restarts on its own when the download is done; otherwise it never restarts unasked.
   */
  readonly install: () => Promise<UpdateState>;
  /** Opens the page the new version can be downloaded from by hand. Never rejects. */
  readonly openDownloadPage: () => Promise<void>;
  /** Stops the timers and detaches from the engine. The updater stays readable and inert. */
  readonly dispose: () => void;
};

export type {
  PolicyAnswer,
  PolicyStore,
  StoredPolicy,
  Updater,
  UpdaterEngine,
  UpdaterEngineLogger,
  UpdaterLogger,
  UpdaterOptions,
  UpdatePolicyOptions,
};
