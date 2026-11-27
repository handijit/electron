import { homedir } from "node:os";

import { app, net, shell } from "electron";

import { compareVersions, isVersion } from "../shared/version.helper";
import type {
  UnsupportedReason,
  UpdateActivity,
  UpdatePolicyState,
  UpdateState,
} from "../types";
import reduceActivity from "./activity-reducer";
import type { ActivityEvent } from "./activity-reducer";
import detectBuildSupport from "./build-support";
import createEngineLogger, { sanitizeLine } from "./engine-logger";
import createPolicyClient, {
  parsePolicyAnswer,
  PolicyRequestError,
} from "./policy-client";
import type { PolicyQuery, PolicyRequest } from "./policy-client";
import createPolicyStore from "./policy-store";
import { evaluateStoredPolicy, isStoredPolicy } from "./policy-verdict";
import type { StoredPolicy, Updater, UpdaterOptions } from "./types";
import {
  causeCodeOf,
  classifyError,
  isMissingFeed,
  toUpdateError,
} from "./update-error";
import { toUpdateInfo, toUpdateProgress } from "./update-info.helper";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const DEFAULT_START_DELAY_MS = 10_000;
const DEFAULT_CHECK_INTERVAL_MS = 6 * HOUR_MS;
const MIN_CHECK_INTERVAL_MS = 15 * MINUTE_MS;
// A timer cannot wait longer than 2^31 ms; a week is far more than any program needs.
const MAX_DURATION_MS = 7 * 24 * HOUR_MS;
const DEFAULT_REQUIRED_TTL_MS = 7 * 24 * HOUR_MS;

// While an update is required and the feed has nothing to install yet (staged files, a CDN
// that lags), the feed is read again after 1, 2, 5 and then every 15 minutes.
const REQUIRED_RETRY_MINUTES = [1, 2, 5];
const REQUIRED_RETRY_CAP_MINUTES = 15;

// A policy endpoint is usually throttled per address, and an office shares one address. A click
// may ask once a minute, the schedule once in ten.
const POLICY_GAP_MANUAL_MS = MINUTE_MS;
const POLICY_GAP_BACKGROUND_MS = 10 * MINUTE_MS;
const DEFAULT_RATE_LIMIT_PAUSE_SECONDS = 600;

// How long "restarting" is shown when the program did not quit (a window refused to close).
const INSTALL_GUARD_MS = 30_000;

const DEFAULT_POLICY_TIMEOUT_MS = 10_000;

const OPERATING_SYSTEMS: Readonly<Record<string, "windows" | "macos">> = {
  win32: "windows",
  darwin: "macos",
};

type Intent = "none" | "download" | "install";
type PolicyTarget = { request: PolicyRequest; query: PolicyQuery | null };
type ActivePolicyTarget = { request: PolicyRequest; query: PolicyQuery };
type Run = { isSettled: boolean };
type CheckRun = Run & {
  isManual: boolean;
  previous: UpdateActivity;
  done: Promise<void>;
};

const isSupportedArch = (arch: string): arch is "x64" | "arm64" =>
  arch === "x64" || arch === "arm64";

// A duration that is out of range is a wrong setting, not a reason to crash: the default applies.
const durationOr = (
  value: number | undefined,
  minimum: number,
  fallback: number
): number =>
  value !== undefined &&
  Number.isFinite(value) &&
  value >= minimum &&
  value <= MAX_DURATION_MS
    ? value
    : fallback;

// https everywhere; plain http only towards this computer (a test server).
const requireWebUrl = (value: string, option: string): string => {
  const url = URL.canParse(value) ? new URL(value) : undefined;
  const isLoopback =
    url?.hostname === "127.0.0.1" || url?.hostname === "localhost";
  if (
    url === undefined ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback))
  ) {
    throw new TypeError(`createUpdater: "${option}" must be an https URL`);
  }
  return value;
};

const later = (run: () => void, delayMs: number): NodeJS.Timeout => {
  const timer = setTimeout(run, delayMs);
  // The schedule never keeps a quitting program alive.
  timer.unref();
  return timer;
};

/**
 * Creates the updater of a program: an explicit state machine over `electron-updater`, joined
 * with a minimum-version policy. Nothing happens until `start()`; every method is safe to
 * call at any time and from any state, and none of them rejects because of the network, the
 * feed or the engine: failures are part of the state.
 *
 * The policy can only ever lock the program after the endpoint has answered "required": no
 * answer, a failed request or an unreadable body leave the stored verdict (or `ok`) in force,
 * and `start()` never waits for the endpoint.
 *
 * Throws a `TypeError` for a setting that can only be a programming error: a current version
 * that is not a version, a URL that is not https.
 */
const createUpdater = (options: UpdaterOptions): Updater => {
  const { engine } = options;
  const currentVersion = options.currentVersion ?? app.getVersion();
  if (!isVersion(currentVersion)) {
    throw new TypeError(
      `createUpdater: the current version "${currentVersion}" is not a version like "1.4.0"`
    );
  }

  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const channel = options.channel ?? "stable";
  const os = OPERATING_SYSTEMS[platform];
  const policyOptions = options.policy;

  const feedUrl = requireWebUrl(options.feedUrl, "feedUrl");
  const downloadPageUrl = requireWebUrl(
    options.downloadPageUrl,
    "downloadPageUrl"
  );
  const startDelayMs = durationOr(
    options.startDelayMs,
    0,
    DEFAULT_START_DELAY_MS
  );
  const checkIntervalMs = durationOr(
    options.checkIntervalMs,
    MIN_CHECK_INTERVAL_MS,
    DEFAULT_CHECK_INTERVAL_MS
  );
  const requiredTtlMs = durationOr(
    options.requiredCacheTtlMs,
    0,
    DEFAULT_REQUIRED_TTL_MS
  );
  const isAutoDownload = options.autoDownload ?? false;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const store = options.policyStore ?? createPolicyStore();
  // The policy is asked only for a platform a release can be built for.
  const policyTarget: PolicyTarget | null =
    policyOptions === undefined
      ? null
      : {
          request: createPolicyClient({
            url: requireWebUrl(policyOptions.url, "policy.url"),
            // Read when a request is sent, not now: `net` works only once the app is ready.
            fetch: policyOptions.fetch ?? ((url, init) => net.fetch(url, init)),
            parse: policyOptions.parse ?? parsePolicyAnswer,
            timeoutMs: durationOr(
              policyOptions.timeoutMs,
              1,
              DEFAULT_POLICY_TIMEOUT_MS
            ),
            now,
          }),
          query:
            os !== undefined && isSupportedArch(arch)
              ? { os, arch, channel }
              : null,
        };
  const errorMessages = options.errorMessages ?? {};
  const openExternal =
    options.openExternal ?? ((url: string) => shell.openExternal(url));
  const log = options.logger.child("updater");
  const homeDirectory = homedir();

  // What a log line says about a cause: its code and one cleaned line. Never the stack.
  const about = (
    cause: unknown
  ): { readonly causeCode: string; readonly cause: string } => ({
    causeCode: causeCodeOf(cause),
    cause: sanitizeLine(cause, homeDirectory),
  });

  let activity: UpdateActivity = { status: "idle" };
  let stored: StoredPolicy | null = null;
  let answeredAt: number | null = null;
  let checkedAt: number | null = null;
  let intent: Intent = "none";
  let isInstalling = false;
  let isDisposed = false;
  let isEngineAttached = false;
  let policyTargetInUse: ActivePolicyTarget | null = null;
  let started: Promise<void> | undefined;
  let checkRun: CheckRun | undefined;
  let downloadRun: Run | undefined;
  let policyRun: Promise<void> | undefined;
  let policyAttemptAt: number | null = null;
  let policyPauseMs = 0;
  let retryStep = 0;
  let tickTimer: NodeJS.Timeout | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let installTimer: NodeJS.Timeout | undefined;
  let originalRollout = engine.isUserWithinRollout;
  const abort = new AbortController();
  const listeners = new Set<(state: UpdateState) => void>();

  const evaluatePolicy = (): UpdatePolicyState =>
    evaluateStoredPolicy({
      stored,
      currentVersion,
      now: now(),
      requiredTtlMs,
      answeredAt,
    });
  let policy = evaluatePolicy();

  const compose = (revision: number): UpdateState =>
    Object.freeze({
      ...activity,
      revision,
      currentVersion,
      policy,
      checkedAt,
      isInstallPending: intent === "install" || isInstalling,
    });
  let state = compose(0);
  let fingerprint = JSON.stringify(state);

  // Publishes a new snapshot when, and only when, something the interface can see changed.
  const publish = (): void => {
    const next = JSON.stringify(compose(0));
    if (next === fingerprint) return;
    fingerprint = next;
    state = compose(state.revision + 1);
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (cause) {
        log.error("a state listener threw", about(cause));
      }
    }
  };

  const dispatch = (event: ActivityEvent): void => {
    const previous = activity.status;
    activity = reduceActivity(activity, event);
    if (activity.status !== previous) {
      log.info("status changed", {
        from: previous,
        to: activity.status,
        ...("update" in activity && activity.update !== null
          ? { version: activity.update.version }
          : {}),
      });
    }
    publish();
  };

  const isUsable = (): boolean =>
    !isDisposed && isEngineAttached && activity.status !== "unsupported";
  // The statuses a check may start from.
  const canCheck = (): boolean =>
    checkRun === undefined &&
    (activity.status === "idle" ||
      activity.status === "not-available" ||
      activity.status === "available" ||
      activity.status === "error");
  // The statuses in which nothing installable is known.
  const lacksUpdate = (): boolean =>
    canCheck() && activity.status !== "available";

  const settleCheck = (): void => {
    if (checkRun !== undefined) checkRun.isSettled = true;
    checkRun = undefined;
  };
  const settleDownload = (): void => {
    if (downloadRun !== undefined) downloadRun.isSettled = true;
    downloadRun = undefined;
  };
  const stopInstalling = (): void => {
    clearTimeout(installTimer);
    isInstalling = false;
  };
  const stopRetrying = (): void => {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  // --- the feed -------------------------------------------------------------------------

  const scheduleRequiredRetry = (): void => {
    if (
      retryTimer !== undefined ||
      policy.verdict !== "required" ||
      !isUsable() ||
      !lacksUpdate()
    ) {
      return;
    }
    const minutes =
      REQUIRED_RETRY_MINUTES[retryStep] ?? REQUIRED_RETRY_CAP_MINUTES;
    retryStep += 1;
    retryTimer = later(() => {
      retryTimer = undefined;
      void refreshPolicy("background");
      if (policy.verdict === "required" && isUsable() && lacksUpdate()) {
        void runCheck(false);
      }
    }, minutes * MINUTE_MS);
  };

  const concludeNotAvailable = (): void => {
    settleCheck();
    checkedAt = now();
    dispatch({ type: "update-not-available" });
    if (activity.status === "not-available") {
      // Nothing to install: whatever was asked for cannot happen now.
      intent = "none";
      publish();
    }
    scheduleRequiredRetry();
  };

  const beginInstall = (): void => {
    if (isInstalling) return;
    isInstalling = true;
    intent = "none";
    installTimer = later(() => {
      isInstalling = false;
      log.warn("the program is still running after the install was started");
      publish();
    }, INSTALL_GUARD_MS);
    publish();
    log.info("restarting to install the update");
    try {
      engine.quitAndInstall(options.isSilentInstall ?? false, true);
    } catch (cause) {
      fail(cause);
    }
  };

  const onDownloaded = (raw: unknown): void => {
    settleDownload();
    dispatch({
      type: "update-downloaded",
      update: toUpdateInfo(raw, platform, arch),
    });
    if (activity.status === "downloaded" && intent === "install") {
      beginInstall();
    }
  };

  const beginDownload = (): void => {
    if (downloadRun !== undefined || activity.status !== "available") return;
    const run: Run = { isSettled: false };
    downloadRun = run;
    if (intent === "download") intent = "none";
    dispatch({ type: "download-started" });
    void Promise.resolve()
      .then(() => engine.downloadUpdate())
      .then(
        () => {
          // An engine that resolves without the event still finished the download.
          if (!run.isSettled) onDownloaded(null);
        },
        (cause: unknown) => {
          if (!run.isSettled) fail(cause);
        }
      );
  };

  const onAvailable = (raw: unknown): void => {
    const update = toUpdateInfo(raw, platform, arch);
    if (update === null) {
      fail(
        Object.assign(new Error("the feed offers a version that is not one"), {
          code: "ERR_UPDATER_INVALID_VERSION",
        })
      );
      return;
    }
    // The engine refuses downgrades too; this is the second lock on the same door.
    if (compareVersions(update.version, currentVersion) <= 0) {
      log.warn("the feed offers a version that is not newer; ignored", {
        offered: update.version,
      });
      concludeNotAvailable();
      return;
    }

    settleCheck();
    checkedAt = now();
    retryStep = 0;
    stopRetrying();
    dispatch({ type: "update-available", update });
    if (isAutoDownload || intent !== "none") beginDownload();
  };

  const onProgress = (raw: unknown): void => {
    dispatch({ type: "download-progress", progress: toUpdateProgress(raw) });
  };

  const onCancelled = (): void => {
    settleDownload();
    intent = "none";
    dispatch({ type: "download-cancelled" });
    publish();
  };

  // Every failure of the engine ends here, whether it arrived as an event or as a rejection.
  const fail = (cause: unknown): void => {
    const code = classifyError(cause);
    const run = checkRun;

    if (run !== undefined) {
      if (isMissingFeed(cause)) {
        // Nothing was published for this channel and platform yet: for the user that
        // is "no update", not an error.
        log.warn("the feed has no file for this channel and platform");
        concludeNotAvailable();
        return;
      }
      settleCheck();
      const isShown =
        run.isManual || policy.verdict === "required" || intent !== "none";
      intent = "none";
      log.warn("the update check failed", {
        code,
        shown: isShown,
        ...about(cause),
      });
      // A failure nobody asked about is not shown: the schedule tries again.
      dispatch(
        isShown
          ? { type: "failed", error: toUpdateError(code, errorMessages) }
          : { type: "check-abandoned", previous: run.previous }
      );
      scheduleRequiredRetry();
      return;
    }

    if (activity.status === "downloading" || activity.status === "downloaded") {
      const wasDownloaded = activity.status === "downloaded";
      settleDownload();
      stopInstalling();
      intent = "none";
      if (code === "SIGNATURE" && platform === "darwin") {
        // Squirrel.Mac refused the running app's signature: this build cannot update itself.
        log.warn("this build is not signed for updates", about(cause));
        dispatch({ type: "unsupported", reason: "unsigned" });
        return;
      }
      log.error(
        wasDownloaded
          ? "the update could not be installed"
          : "the update download failed",
        { code, ...about(cause) }
      );
      dispatch({
        type: "failed",
        error: toUpdateError(
          wasDownloaded && code === "UNKNOWN" ? "INSTALL" : code,
          errorMessages
        ),
      });
      return;
    }

    log.warn("the engine failed outside a check or a download; ignored", {
      code,
      ...about(cause),
    });
  };

  const runCheck = (isManual: boolean): Promise<void> => {
    if (checkRun !== undefined) {
      checkRun.isManual ||= isManual;
      return checkRun.done;
    }
    const run: CheckRun = {
      isManual,
      isSettled: false,
      previous: activity,
      done: Promise.resolve(),
    };
    checkRun = run;
    // Built before the status changes, so that a listener that checks again joins this run.
    run.done = Promise.resolve()
      .then(() => {
        // The engine turns this on by itself when a channel is assigned; never trust it.
        engine.allowDowngrade = false;
        return engine.checkForUpdates();
      })
      .then(
        (result) => {
          if (run.isSettled) return;
          if (result === null) {
            // electron-updater answers `null` when it is inactive: an unpackaged run.
            settleCheck();
            log.info("the engine is inactive in this build");
            dispatch({ type: "unsupported", reason: "development" });
            return;
          }
          // An engine that resolves without an event found nothing to install.
          concludeNotAvailable();
        },
        (cause: unknown) => {
          if (!run.isSettled) fail(cause);
        }
      );
    dispatch({ type: "check-started" });
    return run.done;
  };

  // --- the policy -----------------------------------------------------------------------

  const applyPolicy = (): void => {
    const previous = policy.verdict;
    policy = evaluatePolicy();
    if (policy.verdict !== previous) {
      log.info("the policy verdict changed", {
        from: previous,
        to: policy.verdict,
        latestVersion: policy.latestVersion,
        minSupportedVersion: policy.minSupportedVersion,
      });
      if (policy.verdict === "required") {
        // The feed decides what can be installed: ask it now, not at the next interval.
        retryStep = 0;
        if (isUsable() && lacksUpdate()) void runCheck(false);
      } else {
        // The program may be used again, so it must not restart on its own any more.
        if (intent === "install") intent = "none";
        stopRetrying();
      }
    }
    publish();
  };

  const fetchPolicy = async ({
    request,
    query,
  }: ActivePolicyTarget): Promise<void> => {
    try {
      const answer = await request(query, abort.signal);
      if (isDisposed) return;
      if (answer === null) {
        // The endpoint has no release for this platform: nothing can be required.
        stored = null;
      } else {
        const candidate = {
          latestVersion: answer.latestVersion,
          minSupportedVersion: answer.minSupportedVersion ?? null,
          fetchedAt: now(),
        };
        if (!isStoredPolicy(candidate)) {
          log.warn("the policy holds a version that is not a version; ignored");
          return;
        }
        stored = candidate;
      }
    } catch (cause) {
      if (isDisposed) return;
      if (cause instanceof PolicyRequestError && cause.status === 429) {
        policyPauseMs =
          (cause.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_PAUSE_SECONDS) * 1000;
      }
      // Offline is not an error: the stored policy, if any, goes on applying.
      log.warn("the update policy could not be fetched", about(cause));
      return;
    }
    policyPauseMs = 0;
    answeredAt = now();
    void store.write(stored).catch((cause: unknown) => {
      log.warn("the update policy could not be stored", about(cause));
    });
    applyPolicy();
  };

  const refreshPolicy = (kind: "manual" | "background"): Promise<void> => {
    const target = policyTargetInUse;
    if (target === null) return Promise.resolve();
    if (policyRun !== undefined) return policyRun;
    const time = now();
    const gap = Math.max(
      kind === "manual" ? POLICY_GAP_MANUAL_MS : POLICY_GAP_BACKGROUND_MS,
      policyPauseMs
    );
    // The absolute difference: a clock that was set back must not silence the policy.
    if (policyAttemptAt !== null && Math.abs(time - policyAttemptAt) < gap) {
      return Promise.resolve();
    }
    policyAttemptAt = time;
    policyRun = fetchPolicy(target).finally(() => {
      policyRun = undefined;
    });
    return policyRun;
  };

  // --- the schedule ---------------------------------------------------------------------

  const tick = (): void => {
    // Re-evaluated on every tick: a stored "required" expires while the program runs, too.
    applyPolicy();
    void refreshPolicy("background");
    if (isUsable() && canCheck()) void runCheck(false);
    // ±10 %: the programs of one office do not all ask in the same second.
    tickTimer = later(tick, checkIntervalMs * (0.9 + 0.2 * random()));
  };

  const engineListeners: readonly (readonly [
    string,
    (...parameters: never[]) => void,
  ])[] = [
    ["update-available", onAvailable],
    ["update-not-available", concludeNotAvailable],
    ["download-progress", onProgress],
    ["update-downloaded", onDownloaded],
    ["update-cancelled", onCancelled],
    ["error", fail],
  ];

  const attachEngine = (): void => {
    engine.logger = createEngineLogger(log, homeDirectory);
    // The updater starts downloads itself, so that the user (or the option) decides.
    engine.autoDownload = false;
    engine.autoInstallOnAppQuit = options.installOnQuit ?? true;
    engine.setFeedURL({
      provider: "generic",
      url: feedUrl,
      // Passed here and not through `engine.channel`, whose setter allows downgrades.
      ...(channel === "beta" ? { channel: "beta" } : {}),
      ...(options.useMultipleRangeRequest === undefined
        ? {}
        : { useMultipleRangeRequest: options.useMultipleRangeRequest }),
    });
    engine.allowDowngrade = false;
    // A required update is not a staged one: everybody below the minimum gets it.
    originalRollout = engine.isUserWithinRollout;
    engine.isUserWithinRollout = (updateInfo) =>
      policy.verdict === "required"
        ? true
        : originalRollout.call(engine, updateInfo);
    for (const [event, listener] of engineListeners) engine.on(event, listener);
    isEngineAttached = true;
  };

  const detectSupport = async (): Promise<UnsupportedReason | null> => {
    if (options.buildSupport !== undefined) {
      return options.buildSupport === "supported" ? null : options.buildSupport;
    }
    return detectBuildSupport({
      platform,
      arch,
      isPackaged: app.isPackaged,
      isDevelopmentForced: engine.forceDevUpdateConfig === true,
      executablePath: app.getPath("exe"),
    });
  };

  const run = async (): Promise<void> => {
    const reason = await detectSupport();
    if (isDisposed) return;
    if (reason === null) {
      attachEngine();
    } else {
      log.info("this build cannot update itself", { reason });
      dispatch({ type: "unsupported", reason });
    }

    // A development run has its own version numbers; the production policy says nothing
    // about them, and a developer must never be locked out of the program being built.
    policyTargetInUse =
      reason === "development" ||
      policyTarget === null ||
      policyTarget.query === null
        ? null
        : { request: policyTarget.request, query: policyTarget.query };
    if (policyTargetInUse !== null) {
      try {
        const value: unknown = await store.read();
        stored = isStoredPolicy(value) ? value : null;
      } catch (cause) {
        log.warn("the stored update policy could not be read", about(cause));
      }
      if (isDisposed) return;
      applyPolicy();
      void refreshPolicy("background");
    }

    if (reason === null || policyTargetInUse !== null) {
      tickTimer = later(tick, startDelayMs);
    }
  };

  const start = async (): Promise<UpdateState> => {
    started ??= run();
    await started;
    return state;
  };

  // --- the public actions ---------------------------------------------------------------

  const check = async (): Promise<UpdateState> => {
    if (isDisposed) return state;
    await start();
    const policyDone = refreshPolicy("manual");
    if (!isUsable()) {
      // A build that cannot update itself still obeys the policy.
      await policyDone;
      return state;
    }
    if (checkRun !== undefined || canCheck()) await runCheck(true);
    return state;
  };

  const download = async (): Promise<UpdateState> => {
    if (isDisposed) return state;
    await start();
    if (!isUsable()) return state;
    if (activity.status === "available") {
      beginDownload();
    } else if (activity.status === "error" && activity.update !== null) {
      // The files of the failed download may be gone (a newer release replaced them): read
      // the feed again and download what it offers now.
      intent = "download";
      void runCheck(true);
    }
    return state;
  };

  const install = async (): Promise<UpdateState> => {
    if (isDisposed) return state;
    await start();
    if (!isUsable()) return state;
    if (activity.status === "downloaded") {
      beginInstall();
      return state;
    }
    // Outside a required update the program never restarts on its own, so there is nothing
    // to arm: the user presses "restart" once the download is done.
    if (policy.verdict !== "required") return state;
    intent = "install";
    if (activity.status === "available") beginDownload();
    else if (canCheck()) void runCheck(true);
    publish();
    return state;
  };

  const openDownloadPage = async (): Promise<void> => {
    try {
      await openExternal(downloadPageUrl);
    } catch (cause) {
      log.warn("the download page could not be opened", about(cause));
    }
  };

  const dispose = (): void => {
    if (isDisposed) return;
    isDisposed = true;
    abort.abort();
    clearTimeout(tickTimer);
    stopRetrying();
    stopInstalling();
    settleCheck();
    settleDownload();
    if (isEngineAttached) {
      for (const [event, listener] of engineListeners) {
        engine.removeListener(event, listener);
      }
      engine.isUserWithinRollout = originalRollout;
    }
    listeners.clear();
  };

  return {
    getState: () => state,
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    check,
    download,
    install,
    openDownloadPage,
    dispose,
  };
};

export default createUpdater;
