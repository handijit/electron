import type { ReactElement, ReactNode } from "react";

type IconProps = {
  /** Edge length in pixels. */
  size?: number;
};

// Line icons drawn here, so that the components do not need an icon package. Decorative:
// the text beside them says what they mean.
const icon =
  (shape: ReactNode) =>
  ({ size = 16 }: IconProps): ReactElement => (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shape}
    </svg>
  );

/** An arrow into a tray: there is something to download. */
const DownloadIcon = icon(
  <path d="M8 2.25v7.5m0 0L5 6.75m3 3 3-3M2.75 12.75h10.5" />
);

/** A circling arrow: restart. */
const RestartIcon = icon(
  <path d="M13 8a5 5 0 1 1-1.6-3.67M13 2.5v2.75h-2.75" />
);

/** A warning triangle. */
const WarningIcon = icon(
  <path d="M8 2.5 14.25 13H1.75L8 2.5Zm0 4v3m0 1.9v.1" />
);

/** A check mark: nothing to do. */
const CheckIcon = icon(<path d="m3.25 8.5 3 3 6.5-7" />);

/** An arrow leaving a circle upwards: the gate's emblem. */
const UpgradeIcon = icon(
  <path d="M8 14.25A6.25 6.25 0 1 0 8 1.75a6.25 6.25 0 0 0 0 12.5Zm0-3.5v-5.5m0 0L5.5 7.75M8 5.25l2.5 2.5" />
);

export { CheckIcon, DownloadIcon, RestartIcon, UpgradeIcon, WarningIcon };
