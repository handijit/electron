import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  DEFAULT_RETURN_PAGE_LABELS,
  escapeHtml,
  renderReturnPages,
  returnPageCsp,
} from "../../lib/auth/return-page";

describe("return pages", () => {
  test("should escape every character HTML treats specially", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;"
    );
  });

  test("should render the default Turkish pages", () => {
    const pages = renderReturnPages();
    expect(pages.done).toContain('<html lang="tr">');
    expect(pages.done).toContain(DEFAULT_RETURN_PAGE_LABELS.done.heading);
    expect(pages.done).not.toContain('class="mark bad"');
    expect(pages.denied).toContain('class="mark bad"');
    expect(pages.invalid).toContain(DEFAULT_RETURN_PAGE_LABELS.invalid.text);
    expect(pages.done).not.toMatch(/<script|<link|<img|https?:\/\//);
  });

  test("should merge and escape the program's own labels", () => {
    const pages = renderReturnPages({
      lang: "en",
      done: { title: "Done", heading: "<b>Back</b>", text: "Close & go" },
    });
    expect(pages.done).toContain('<html lang="en">');
    expect(pages.done).toContain("<title>Done</title>");
    expect(pages.done).toContain("&lt;b&gt;Back&lt;/b&gt;");
    expect(pages.done).toContain("Close &amp; go");
    expect(pages.invalid).toContain(DEFAULT_RETURN_PAGE_LABELS.invalid.heading);
  });

  test("should allow exactly the inline style sheet by its hash", () => {
    const style = /<style>(.*)<\/style>/.exec(renderReturnPages().done)?.[1];
    const hash = createHash("sha256")
      .update(style as string)
      .digest("base64");
    expect(returnPageCsp()).toBe(
      `default-src 'none'; style-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
    );
  });
});
