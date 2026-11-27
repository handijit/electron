import type { AuthErrorCode } from "../types";

const SECONDS_PER_MINUTE = 60;

const MESSAGES: Readonly<Record<AuthErrorCode, string>> = {
  SIGN_IN_TIMED_OUT: "Giriş zamanında tamamlanmadı. Yeniden deneyin.",
  SIGN_IN_CANCELLED: "Giriş iptal edildi.",
  STATE_MISMATCH:
    "Giriş doğrulanamadı. Güvenliğiniz için işlem durduruldu; yeniden deneyin.",
  ACCESS_DENIED: "Giriş onaylanmadı.",
  CODE_REFUSED: "Giriş kodu geçersiz ya da süresi dolmuş. Yeniden giriş yapın.",
  RATE_LIMITED: "Çok fazla deneme yapıldı. Biraz sonra yeniden deneyin.",
  OFFLINE:
    "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.",
  SESSION_ENDED:
    "Oturumunuz başka bir yerden kapatıldı ya da süresi doldu. Yeniden giriş yapın.",
  ACCOUNT_NOT_ALLOWED: "Bu hesapla bu programa giriş yapılamaz.",
  BROWSER_NOT_OPENED: "Tarayıcı açılamadı. Yeniden deneyin.",
  LISTENER_FAILED: "Giriş başlatılamadı. Yeniden deneyin.",
  UNEXPECTED: "Giriş şu an tamamlanamadı. Biraz sonra yeniden deneyin.",
};

/** "45 saniye" below a minute, whole minutes rounded up above it. */
const formatWait = (seconds: number): string =>
  seconds < SECONDS_PER_MINUTE
    ? `${Math.max(1, Math.ceil(seconds))} saniye`
    : `${Math.ceil(seconds / SECONDS_PER_MINUTE)} dakika`;

/**
 * The Turkish sentence a screen shows for an error code; branch on the code to show your own.
 * `retryAfterSeconds` is used by `RATE_LIMITED` only: "Çok fazla deneme yapıldı. 3 dakika sonra yeniden deneyin."
 */
const authErrorMessage = (
  code: AuthErrorCode,
  retryAfterSeconds?: number
): string =>
  code === "RATE_LIMITED" &&
  typeof retryAfterSeconds === "number" &&
  Number.isFinite(retryAfterSeconds) &&
  retryAfterSeconds > 0
    ? `Çok fazla deneme yapıldı. ${formatWait(retryAfterSeconds)} sonra yeniden deneyin.`
    : MESSAGES[code];

export default authErrorMessage;
