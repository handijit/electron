import { useUpdate } from "@handijitcom/electron/update-react";
import type {
  UpdateClient,
  UpdateState,
} from "@handijitcom/electron/update-react";
import { Alert, Button, Progress, UISize, UIVariant } from "@handijitcom/ui";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { formatBytes, formatPercent, formatSpeed } from "./format.helper";
import { DownloadIcon, RestartIcon, UpgradeIcon } from "./icons";
import DEFAULT_UPDATE_LABELS from "./labels.constants";
import type { UpdateLabels } from "./labels.constants";

type UpdateGateProps = {
  /** The client to read from. Default: the page's `updateClient`. */
  client?: UpdateClient;
  /** The program's name as the user knows it, for the explanation. */
  productName: string;
  /** The program. It stays mounted behind the gate, inert, so nothing typed is lost. */
  children?: ReactNode;
  /** Shown along the top of the gate: the window controls of a frameless window. */
  titleBar?: ReactNode;
  /** Replaces any of the Turkish texts. */
  labels?: Partial<UpdateLabels>;
};

type GateBody = {
  /** What is going on, in a sentence. Announced when it changes. */
  note: ReactNode;
  /** Anything that is not a sentence: the progress bar, the error box. */
  detail?: ReactNode;
  /** The buttons. */
  actions?: ReactNode;
};

const PRIMARY = { "data-hdu-primary": "" };

// A click must never become an unhandled rejection: without a bridge there is simply no answer.
const run = (action: () => Promise<unknown>) => (): void => {
  void action().catch(() => undefined);
};

const progressLine = ({
  transferredBytes,
  totalBytes,
  bytesPerSecond,
}: {
  transferredBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
}): string =>
  [
    totalBytes > 0
      ? `${formatBytes(transferredBytes)} / ${formatBytes(totalBytes)}`
      : formatBytes(transferredBytes),
    ...(bytesPerSecond > 0 ? [formatSpeed(bytesPerSecond)] : []),
  ].join(" · ");

// The version that will be installed: what the feed offers, else what the policy names.
const targetVersionOf = (state: UpdateState): string | null =>
  "update" in state && state.update !== null
    ? state.update.version
    : state.policy.latestVersion;

/**
 * The gate of a required update. While the backend's policy says that the running version
 * is below the supported minimum, it covers the whole window with "Güncelleme gerekli" and
 * offers exactly one way on: update now (or, where the build cannot update itself or the
 * feed has nothing yet, download the new version by hand). Otherwise it renders its children
 * and nothing else.
 *
 * Wrap the program in it, once, at the top. Needs the styles of `@handijitcom/ui` and
 * `@handijitcom/electron/styles.css`.
 */
const UpdateGate = ({
  client,
  productName,
  children,
  titleBar,
  labels,
}: UpdateGateProps): ReactElement => {
  const { state, check, install, openDownloadPage } = useUpdate(client);
  const text = useMemo(
    () => ({ ...DEFAULT_UPDATE_LABELS, ...labels }),
    [labels]
  );
  const titleId = useId();
  const bodyId = useId();
  const [panel, setPanel] = useState<HTMLElement | null>(null);

  const isRequired = state?.policy.verdict === "required";
  const status = state?.status;
  const isInstallPending = state?.isInstallPending;

  // `inert` through the DOM: React 18 does not know the attribute and React 19 wants a
  // boolean, so neither spelling works on both. The program behind the gate can be neither
  // clicked nor reached with the keyboard nor read by a screen reader.
  const setInert = useCallback(
    (node: HTMLElement | null): void => {
      node?.toggleAttribute("inert", isRequired);
    },
    [isRequired]
  );

  // Focus follows the one thing that can be done; when nothing can, the gate itself, so
  // that a screen reader reads the heading and the keyboard is never left on a hidden page.
  useEffect(() => {
    if (panel === null) return;
    (panel.querySelector<HTMLElement>("[data-hdu-primary]") ?? panel).focus();
  }, [panel, status, isInstallPending]);

  const manualDownload = (
    variant: UIVariant,
    isPrimary: boolean
  ): ReactNode => (
    <Button
      variant={variant}
      size={UISize.MEDIUM}
      startIcon={isPrimary ? <DownloadIcon /> : undefined}
      onClick={run(openDownloadPage)}
      {...(isPrimary ? PRIMARY : {})}
    >
      {text.downloadManually}
    </Button>
  );

  const bodyOf = (current: UpdateState): GateBody => {
    switch (current.status) {
      case "checking":
        return {
          note: text.searching,
          detail: <Progress size="sm" label={text.searching} />,
        };

      case "available":
        return {
          note:
            current.update.sizeBytes === null
              ? null
              : text.downloadSize(formatBytes(current.update.sizeBytes)),
          actions: (
            <Button
              variant={UIVariant.PRIMARY}
              size={UISize.MEDIUM}
              startIcon={<DownloadIcon />}
              isLoading={current.isInstallPending}
              onClick={run(install)}
              {...PRIMARY}
            >
              {text.updateNow}
            </Button>
          ),
        };

      case "downloading": {
        const percent = formatPercent(current.progress.percent);
        return {
          note: current.isInstallPending
            ? `${text.downloading}. ${text.willRestart}`
            : text.downloading,
          detail: (
            <>
              <Progress
                size="md"
                value={current.progress.percent}
                max={100}
                label={text.downloading}
                valueText={percent}
                isValueVisible
              />
              <span className="hdu-gate__meter" aria-hidden="true">
                {progressLine(current.progress)}
              </span>
            </>
          ),
        };
      }

      case "downloaded":
        // Once asked, the program is quitting: nothing is left to press.
        if (current.isInstallPending) {
          return {
            note: text.restarting,
            detail: <Progress size="sm" label={text.restarting} />,
          };
        }
        return {
          note: text.announceDownloaded(current.update.version),
          actions: (
            <Button
              variant={UIVariant.PRIMARY}
              size={UISize.MEDIUM}
              startIcon={<RestartIcon />}
              onClick={run(install)}
              {...PRIMARY}
            >
              {text.restartAndUpdate}
            </Button>
          ),
        };

      case "error":
        return {
          note: null,
          detail: (
            <Alert tone="danger" title={text.errorTitle}>
              {current.error.message}
            </Alert>
          ),
          actions: (
            <>
              <Button
                variant={UIVariant.PRIMARY}
                size={UISize.MEDIUM}
                onClick={run(install)}
                {...PRIMARY}
              >
                {text.retry}
              </Button>
              {manualDownload(UIVariant.SECONDARY, false)}
            </>
          ),
        };

      case "unsupported":
        return {
          note: text.cannotSelfUpdate,
          actions: manualDownload(UIVariant.PRIMARY, true),
        };

      default:
        // idle, not-available: required, and the feed has nothing to install yet.
        return {
          note: text.notYetAvailable,
          actions: (
            <>
              <Button
                variant={UIVariant.PRIMARY}
                size={UISize.MEDIUM}
                onClick={run(check)}
                {...PRIMARY}
              >
                {text.retry}
              </Button>
              {manualDownload(UIVariant.SECONDARY, false)}
            </>
          ),
        };
    }
  };

  const renderGate = (current: UpdateState): ReactElement => {
    const { note, detail, actions } = bodyOf(current);
    const targetVersion = targetVersionOf(current);

    return (
      <div className="hdu-gate" data-status={current.status}>
        {titleBar === undefined ? null : (
          <div className="hdu-gate__bar">{titleBar}</div>
        )}
        <div
          ref={setPanel}
          className="hdu-gate__panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          tabIndex={-1}
        >
          <span className="hdu-gate__emblem">
            <UpgradeIcon size={24} />
          </span>
          <h1 id={titleId} className="hdu-gate__title">
            {text.gateTitle}
          </h1>
          <p id={bodyId} className="hdu-gate__text">
            {text.gateBody(productName)}
          </p>
          <dl className="hdu-gate__versions">
            <div>
              <dt>{text.installedVersion}</dt>
              <dd>{current.currentVersion}</dd>
            </div>
            {targetVersion === null ? null : (
              <div>
                <dt>{text.newVersion}</dt>
                <dd>{targetVersion}</dd>
              </div>
            )}
          </dl>
          <p className="hdu-gate__note" role="status">
            {note}
          </p>
          {detail === undefined ? null : (
            <div className="hdu-gate__detail">{detail}</div>
          )}
          {actions === undefined ? null : (
            <div className="hdu-gate__actions">{actions}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div ref={setInert} className="hdu-gate__content">
        {children}
      </div>
      {state !== null && isRequired ? renderGate(state) : null}
    </>
  );
};

export type { UpdateGateProps };
export default UpdateGate;
