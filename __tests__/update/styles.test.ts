import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const TOKENS = join(
  dirname(require.resolve("@handijitcom/ui/package.json")),
  "build/design/tokens.css"
);

const tokensIn = (css: string, pattern: RegExp): Set<string> =>
  new Set([...css.matchAll(pattern)].map((match) => match[1] as string));

describe("update-ui styles", () => {
  test("should use only tokens @handijitcom/ui/design defines", () => {
    const styles = readFileSync("lib/update-ui/styles.css", "utf8");
    const used = tokensIn(styles, /var\((--hd-[a-z0-9-]+)\)/g);
    const defined = tokensIn(
      readFileSync(TOKENS, "utf8"),
      /(--hd-[a-z0-9-]+):/g
    );
    expect(used.size).toBeGreaterThan(20);
    expect([...used].filter((token) => !defined.has(token))).toEqual([]);
  });

  test("should hold no raw colour", () => {
    const styles = readFileSync("lib/update-ui/styles.css", "utf8");
    expect(styles.match(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/gi)).toBeNull();
  });
});
