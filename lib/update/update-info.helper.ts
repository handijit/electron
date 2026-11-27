import { isVersion } from "@handijitcom/api-client/version";

import type { UpdateInfo, UpdateProgress } from "../types";

const MAX_NOTES_LENGTH = 4000;

type Shape = Readonly<Record<string, unknown>>;

const isShape = (value: unknown): value is Shape =>
  typeof value === "object" && value !== null;

const toCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Release notes as plain text. A feed may carry HTML (GitHub does) or a list of notes per
 * version; the interface must never have to trust markup that came over the network, so tags
 * are dropped here and the text is shortened.
 */
const toPlainNotes = (notes: unknown): string | null => {
  const parts = Array.isArray(notes)
    ? notes.map((entry: unknown) => (isShape(entry) ? entry.note : undefined))
    : [notes];
  const text = parts
    .filter((part): part is string => typeof part === "string")
    .join("\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text === "" ? null : text.slice(0, MAX_NOTES_LENGTH);
};

const toIsoDate = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

// The engine downloads the installer on Windows and the zip on macOS, and prefers the file
// that names the architecture; the size shown is the size of that file.
const sizeOf = (
  files: unknown,
  platform: string,
  arch: string
): number | null => {
  if (!Array.isArray(files)) return null;
  const extension = platform === "darwin" ? ".zip" : ".exe";
  const candidates = files
    .filter(isShape)
    .filter(({ url }) => typeof url === "string" && url.endsWith(extension));
  const file =
    candidates.find(({ url }) => (url as string).includes(arch)) ??
    candidates[0];
  const size = toCount(file?.size);
  return size > 0 ? size : null;
};

/**
 * Turns what the engine reports about a version into the state's `UpdateInfo`. Returns `null`
 * when the version is not a version this package can compare: such a feed is refused.
 */
const toUpdateInfo = (
  raw: unknown,
  platform: string,
  arch: string
): UpdateInfo | null => {
  if (!isShape(raw) || !isVersion(raw.version)) return null;
  return {
    version: raw.version,
    releaseDate: toIsoDate(raw.releaseDate),
    releaseNotes: toPlainNotes(raw.releaseNotes),
    sizeBytes: sizeOf(raw.files, platform, arch),
  };
};

/** Turns the engine's progress report into the state's, with every number in range. */
const toUpdateProgress = (raw: unknown): UpdateProgress => {
  const report = isShape(raw) ? raw : {};
  return {
    percent: Math.min(100, toCount(report.percent)),
    transferredBytes: toCount(report.transferred),
    totalBytes: toCount(report.total),
    bytesPerSecond: toCount(report.bytesPerSecond),
  };
};

export { toUpdateInfo, toUpdateProgress };
