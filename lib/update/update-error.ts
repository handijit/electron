import type { UpdateError, UpdateErrorCode } from "../types";

/** The text shown to the user for each code. Turkish, complete sentences, no jargon. */
const UPDATE_ERROR_MESSAGES: Readonly<Record<UpdateErrorCode, string>> = {
  OFFLINE:
    "İnternet bağlantısı kurulamadı. Bağlantınızı kontrol edip yeniden deneyin.",
  SERVER:
    "Güncelleme sunucusuna şu anda ulaşılamıyor. Biraz sonra yeniden deneyin.",
  INVALID_FEED: "Güncelleme bilgisi okunamadı. Biraz sonra yeniden deneyin.",
  CHECKSUM: "İndirilen dosya doğrulanamadı. Yeniden deneyin.",
  SIGNATURE:
    "Güncelleme dosyasının imzası doğrulanamadı. Yeni sürümü indirip elle kurabilirsiniz.",
  DISK: "Güncelleme diske yazılamadı. Boş disk alanını kontrol edip yeniden deneyin.",
  INSTALL: "Güncelleme kurulamadı. Yeni sürümü indirip elle kurabilirsiniz.",
  NOT_IN_APPLICATIONS:
    "Program Uygulamalar klasöründe olmadığı için güncellenemiyor. Programı Uygulamalar klasörüne taşıyıp yeniden açın.",
  UNKNOWN:
    "Güncelleme sırasında beklenmeyen bir sorun oluştu. Yeniden deneyin.",
};

// The feed has no file for this channel and platform: nothing was published for it yet.
const MISSING_FEED_CODE = "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND";

// Node's and Chromium's ways of saying that the network is not there.
const OFFLINE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "EPIPE",
  "ERR_NETWORK_CHANGED",
  "ERR_INTERNET_DISCONNECTED",
  "ERR_NAME_NOT_RESOLVED",
]);
const SERVER_CODES = new Set([
  "ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
  "ERR_UPDATER_ASSET_NOT_FOUND",
  "ERR_UPDATER_BLOCKMAP_FILE_NOT_FOUND",
  MISSING_FEED_CODE,
]);
const INVALID_FEED_CODES = new Set([
  "ERR_UPDATER_INVALID_UPDATE_INFO",
  "ERR_UPDATER_INVALID_VERSION",
  "ERR_UPDATER_NO_FILES_PROVIDED",
  "ERR_UPDATER_ZIP_FILE_NOT_FOUND",
  "ERR_UPDATER_NO_CHECKSUM",
  "ERR_UPDATER_WEB_INSTALLER_DISABLED",
  "ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION",
  "ERR_UPDATER_OLD_FILE_NOT_FOUND",
]);
const DISK_CODES = new Set([
  "ENOSPC",
  "EACCES",
  "EPERM",
  "EROFS",
  "EBUSY",
  "EIO",
]);

type Described = {
  /** The `code` of the cause, when it is a string. */
  readonly code: string;
  /** The message of the cause. */
  readonly message: string;
};

const describe = (cause: unknown): Described => {
  const record =
    typeof cause === "object" && cause !== null
      ? (cause as { readonly code?: unknown; readonly message?: unknown })
      : {};
  return {
    code: typeof record.code === "string" ? record.code : "",
    message:
      typeof record.message === "string" ? record.message : String(cause),
  };
};

/** Whether the failure means that the feed has no channel file (nothing published yet). */
const isMissingFeed = (cause: unknown): boolean =>
  describe(cause).code === MISSING_FEED_CODE;

/** Maps whatever the engine threw to one of the stable codes. Unknown causes stay `UNKNOWN`. */
const classifyError = (cause: unknown): UpdateErrorCode => {
  const { code, message } = describe(cause);

  if (code === "ERR_CHECKSUM_MISMATCH") return "CHECKSUM";
  if (code === "ERR_UPDATER_INVALID_SIGNATURE") return "SIGNATURE";
  if (INVALID_FEED_CODES.has(code)) return "INVALID_FEED";
  if (SERVER_CODES.has(code) || code.startsWith("HTTP_ERROR_")) return "SERVER";
  if (DISK_CODES.has(code)) return "DISK";
  if (OFFLINE_CODES.has(code) || /\bnet::ERR_/.test(message)) return "OFFLINE";

  // Squirrel.Mac reports through messages only.
  if (/read-only volume/i.test(message)) return "NOT_IN_APPLICATIONS";
  if (
    /code signature|code object is not signed|code failed to satisfy/i.test(
      message
    )
  ) {
    return "SIGNATURE";
  }
  if (/quit and install|update filepath/i.test(message)) return "INSTALL";

  return "UNKNOWN";
};

/** The error as the state carries it, with the program's own message when it gave one. */
const toUpdateError = (
  code: UpdateErrorCode,
  messages: Partial<Record<UpdateErrorCode, string>> = {}
): UpdateError => ({
  code,
  message: messages[code] ?? UPDATE_ERROR_MESSAGES[code],
});

/** The `code` of a cause, for a log line; empty when it has none. */
const causeCodeOf = (cause: unknown): string => describe(cause).code;

export {
  causeCodeOf,
  classifyError,
  isMissingFeed,
  toUpdateError,
  UPDATE_ERROR_MESSAGES,
};
