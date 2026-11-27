const KILOBYTE = 1024;
const MEGABYTE = KILOBYTE * 1024;
const GIGABYTE = MEGABYTE * 1024;

const LOCALE = "tr-TR";
const whole = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const twoDecimals = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percent = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  maximumFractionDigits: 0,
});

/** A size as Turkish reads it: `512 KB`, `84,2 MB`, `1,25 GB`. */
const formatBytes = (bytes: number): string => {
  if (bytes >= GIGABYTE) return `${twoDecimals.format(bytes / GIGABYTE)} GB`;
  if (bytes >= MEGABYTE) return `${oneDecimal.format(bytes / MEGABYTE)} MB`;
  return `${whole.format(bytes / KILOBYTE)} KB`;
};

/** A speed: `1,2 MB/sn`. */
const formatSpeed = (bytesPerSecond: number): string =>
  `${formatBytes(bytesPerSecond)}/sn`;

/** A percentage with the sign where Turkish puts it: `%42`. Never rounds up to `%100`. */
const formatPercent = (value: number): string =>
  percent.format(Math.floor(value) / 100);

export { formatBytes, formatPercent, formatSpeed };
