import { createHash } from "node:crypto";

import type { ReturnPageLabels, ReturnPageText } from "./types";

// The pages the browser lands on after the consent page. They are served from 127.0.0.1 over
// plain HTTP, so they stand alone: no script, no font, no image, no link to anywhere. The
// colours are the page, surface, border, text, info and danger tokens of
// @handijitcom/ui/design, written out because the page cannot load a stylesheet.
const STYLE = [
  ":root{color-scheme:light dark;--bg:#fafbfe;--surface:#fff;--border:#dee3ed;--text:#091122;--text-2:#515b6e;--ok-bg:#f4f7fd;--ok-fg:#053dea;--bad-bg:#fdf4f5;--bad-fg:#a9143c}",
  "@media (prefers-color-scheme:dark){:root{--bg:#080e1b;--surface:#0f1727;--border:#283145;--text:#f1f3f9;--text-2:#bac1d0;--ok-bg:#11234f;--ok-fg:#adc6f7;--bad-bg:#3e141a;--bad-fg:#f8afb5}}",
  "*{box-sizing:border-box}",
  'body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}',
  "main{width:100%;max-width:420px;padding:40px 32px;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:16px}",
  ".mark{display:grid;place-items:center;width:56px;height:56px;margin:0 auto 20px;border-radius:50%;background:var(--ok-bg);color:var(--ok-fg)}",
  ".mark.bad{background:var(--bad-bg);color:var(--bad-fg)}",
  "h1{margin:0 0 8px;font-size:22px;line-height:1.25;font-weight:650}",
  "p{margin:0;color:var(--text-2)}",
].join("");

const ICON_ATTRIBUTES =
  'width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const CHECK_ICON = `<svg ${ICON_ATTRIBUTES}><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const CROSS_ICON = `<svg ${ICON_ATTRIBUTES}><path d="M7 7l10 10M17 7L7 17"/></svg>`;

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** The labels come from the program, never from a request; they are escaped all the same. */
const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] as string);

/** The default texts: Turkish, and promising nothing about the exchange that follows. */
const DEFAULT_RETURN_PAGE_LABELS: ReturnPageLabels = {
  lang: "tr",
  done: {
    title: "Giriş tamamlandı",
    heading: "Programa dönebilirsiniz",
    text: "Giriş programda tamamlanıyor. Bu sekmeyi kapatabilirsiniz.",
  },
  denied: {
    title: "Giriş onaylanmadı",
    heading: "Giriş onaylanmadı",
    text: "Programa dönüp isterseniz yeniden deneyebilirsiniz.",
  },
  invalid: {
    title: "Geçersiz bağlantı",
    heading: "Bu bağlantı geçersiz",
    text: "Giriş yapmak için programa dönüp yeniden deneyin.",
  },
};

const renderPage = (
  lang: string,
  { title, heading, text }: ReturnPageText,
  isError: boolean
): string =>
  [
    `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>`,
    `<body><main><div class="mark${isError ? " bad" : ""}">${isError ? CROSS_ICON : CHECK_ICON}</div>`,
    `<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(text)}</p></main></body></html>`,
  ].join("");

/** The three pages of the listener, with the program's texts merged over the defaults. */
type ReturnPages = {
  readonly done: string;
  readonly denied: string;
  readonly invalid: string;
};

const renderReturnPages = (
  labels: Partial<ReturnPageLabels> = {}
): ReturnPages => {
  const { lang, done, denied, invalid } = {
    ...DEFAULT_RETURN_PAGE_LABELS,
    ...labels,
  };
  return {
    done: renderPage(lang, done, false),
    denied: renderPage(lang, denied, true),
    invalid: renderPage(lang, invalid, true),
  };
};

/**
 * The policy sent with every answer of the listener: nothing loads and nothing runs; the one
 * inline style sheet is allowed by its hash. Computed on demand, not when the module loads.
 */
const returnPageCsp = (): string =>
  [
    "default-src 'none'",
    `style-src 'sha256-${createHash("sha256").update(STYLE).digest("base64")}'`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

export type { ReturnPages };
export {
  DEFAULT_RETURN_PAGE_LABELS,
  escapeHtml,
  renderReturnPages,
  returnPageCsp,
};
