import { useUpdate } from "@handijitcom/electron/update-react";
import type {
  UpdateClient,
  UpdateState,
} from "@handijitcom/electron/update-react";
import { Button, Progress, UISize, UIVariant } from "@handijitcom/ui";
import { useId, useMemo } from "react";
import type { ReactElement, ReactNode } from "react";

import { formatPercent } from "./format.helper";
import { CheckIcon, DownloadIcon, RestartIcon, WarningIcon } from "./icons";
import DEFAULT_UPDATE_LABELS from "./labels.constants";
import type { UpdateLabels } from "./labels.constants";

type UpdateButtonProps = {
  /** The client to read from. Default: the page's `updateClient`. */
  client?: UpdateClient;
  /**
   * Show something in every state: "check for updates", "up to date", "checking". For a
   * settings page. Default: `false`, the button appears only when there is something to do,
   * which is what a title bar wants.
   */
  isAlwaysVisible?: boolean;
  /** The size of the button. Default: `UISize.SMALL`. */
  size?: UISize;
  /** Replaces any of the Turkish texts. */
  labels?: Partial<UpdateLabels>;
  /** Added to the root element. */
  className?: string;
};

// A click must never become an unhandled rejection: without a bridge there is simply no answer.
const run = (action: () => Promise<unknown>) => (): void => {
  void action().catch(() => undefined);
};

// What a screen reader is told when the status changes. Progress is not announced: the
// progress bar speaks for itself when it is asked.
const announcementOf = (
  state: UpdateState | null,
  text: UpdateLabels
): string => {
  if (state?.status === "available") {
    return text.announceAvailable(state.update.version);
  }
  if (state?.status === "downloaded") {
    return text.announceDownloaded(state.update.version);
  }
  return state?.status === "error" ? state.error.message : "";
};

/**
 * The update button: nothing while there is nothing to do, "Güncelle 1.5.0" when a version
 * is published, the progress while it downloads, "Yeniden başlat" when it is ready and
 * "Yeniden dene" after a failure. Needs the styles of `@handijitcom/ui` and
 * `@handijitcom/electron/styles.css`.
 */
const UpdateButton = ({
  client,
  isAlwaysVisible = false,
  size = UISize.SMALL,
  labels,
  className,
}: UpdateButtonProps): ReactElement => {
  const { state, check, download, install } = useUpdate(client);
  const text = useMemo(
    () => ({ ...DEFAULT_UPDATE_LABELS, ...labels }),
    [labels]
  );
  const statusId = useId();

  const note = (content: string, icon?: ReactNode): ReactNode =>
    isAlwaysVisible ? (
      <span className="hdu-update__note">
        {icon}
        {content}
      </span>
    ) : null;
  const checkButton = isAlwaysVisible ? (
    <Button variant={UIVariant.SECONDARY} size={size} onClick={run(check)}>
      {text.check}
    </Button>
  ) : null;

  const render = (): ReactNode => {
    switch (state?.status) {
      case "available":
        return (
          <Button
            variant={UIVariant.OUTLINE}
            size={size}
            startIcon={<DownloadIcon />}
            onClick={run(download)}
          >
            {text.update(state.update.version)}
          </Button>
        );

      case "downloading": {
        const percent = formatPercent(state.progress.percent);
        return (
          <>
            {note(text.downloading)}
            <span
              className="hdu-update__progress"
              data-size={size}
              title={text.downloading}
            >
              <DownloadIcon />
              <span className="hdu-update__percent" aria-hidden="true">
                {percent}
              </span>
              <Progress
                size="xs"
                value={state.progress.percent}
                max={100}
                label={text.downloading}
                valueText={percent}
              />
            </span>
          </>
        );
      }

      case "downloaded":
        return (
          <Button
            variant={UIVariant.PRIMARY}
            size={size}
            startIcon={<RestartIcon />}
            isLoading={state.isInstallPending}
            onClick={run(install)}
          >
            {state.isInstallPending ? text.restarting : text.restart}
          </Button>
        );

      case "error":
        return (
          <>
            {note(state.error.message)}
            <Button
              variant={UIVariant.SECONDARY}
              size={size}
              startIcon={<WarningIcon />}
              title={state.error.message}
              aria-describedby={statusId}
              // With an update at hand the failure was a download: get it again.
              onClick={run(state.update === null ? check : download)}
            >
              {text.retry}
            </Button>
          </>
        );

      case "checking":
        return isAlwaysVisible ? (
          <Button variant={UIVariant.SECONDARY} size={size} isLoading disabled>
            {text.checking}
          </Button>
        ) : null;

      case "not-available":
        return isAlwaysVisible ? (
          <>
            {note(text.upToDate, <CheckIcon />)}
            {checkButton}
          </>
        ) : null;

      case "unsupported":
        return note(text.unsupported);

      default:
        return checkButton;
    }
  };

  const content = render();

  return (
    <>
      {content === null ? null : (
        <span
          className={["hdu-update", className]
            .filter((name) => name !== undefined)
            .join(" ")}
          data-status={state?.status ?? "unknown"}
        >
          {content}
        </span>
      )}
      <span id={statusId} role="status" className="hdu-sr-only">
        {announcementOf(state, text)}
      </span>
    </>
  );
};

export type { UpdateButtonProps };
export default UpdateButton;
