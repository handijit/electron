import type {
  UnsupportedReason,
  UpdateActivity,
  UpdateError,
  UpdateInfo,
  UpdateProgress,
} from "../types";

/** Everything that can happen to the updater, whoever caused it. */
type ActivityEvent =
  | { readonly type: "check-started" }
  | { readonly type: "check-abandoned"; readonly previous: UpdateActivity }
  | { readonly type: "update-available"; readonly update: UpdateInfo }
  | { readonly type: "update-not-available" }
  | { readonly type: "download-started" }
  | { readonly type: "download-progress"; readonly progress: UpdateProgress }
  | { readonly type: "download-cancelled" }
  | { readonly type: "update-downloaded"; readonly update: UpdateInfo | null }
  | { readonly type: "failed"; readonly error: UpdateError }
  | { readonly type: "unsupported"; readonly reason: UnsupportedReason };

const NO_PROGRESS: UpdateProgress = {
  percent: 0,
  transferredBytes: 0,
  totalBytes: 0,
  bytesPerSecond: 0,
};

/** The update a status knows about, if any. */
const updateOf = (activity: UpdateActivity): UpdateInfo | null =>
  "update" in activity ? activity.update : null;

// A download in flight, or a finished one, is never thrown away by a late answer of the feed.
const holdsDownload = (activity: UpdateActivity): boolean =>
  activity.status === "downloading" || activity.status === "downloaded";

/**
 * The state machine. It is driven by events alone and accepts them in any order: an event
 * that makes no sense in the current status returns the same object, so a late or doubled
 * event of the engine can never corrupt the state.
 */
const reduceActivity = (
  activity: UpdateActivity,
  event: ActivityEvent
): UpdateActivity => {
  // A build that cannot update itself stays that way until the program restarts.
  if (activity.status === "unsupported") return activity;

  switch (event.type) {
    case "unsupported":
      return { status: "unsupported", reason: event.reason };

    case "check-started":
      return holdsDownload(activity) || activity.status === "checking"
        ? activity
        : { status: "checking" };

    case "check-abandoned":
      return activity.status === "checking" ? event.previous : activity;

    case "update-available":
      return holdsDownload(activity)
        ? activity
        : { status: "available", update: event.update };

    case "update-not-available":
      return holdsDownload(activity) ? activity : { status: "not-available" };

    case "download-started":
      return activity.status === "available"
        ? {
            status: "downloading",
            update: activity.update,
            progress: NO_PROGRESS,
          }
        : activity;

    case "download-progress":
      // `available` too: a download someone started on the engine directly is still shown.
      return activity.status === "downloading" ||
        activity.status === "available"
        ? {
            status: "downloading",
            update: activity.update,
            progress: event.progress,
          }
        : activity;

    case "download-cancelled":
      return activity.status === "downloading"
        ? { status: "available", update: activity.update }
        : activity;

    case "update-downloaded": {
      const update = event.update ?? updateOf(activity);
      return update === null ? activity : { status: "downloaded", update };
    }

    case "failed":
      // An error outside a check or a download belongs to nothing the user asked for.
      return activity.status === "checking" || holdsDownload(activity)
        ? { status: "error", error: event.error, update: updateOf(activity) }
        : activity;
  }
};

export type { ActivityEvent };
export { NO_PROGRESS, updateOf };
export default reduceActivity;
