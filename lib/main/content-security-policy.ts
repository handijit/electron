type ContentSecurityPolicyOptions = {
  /** Origins the renderer may call (`https://api.example.com`). The app's own origin is always allowed. */
  connectSrc?: readonly string[];
  /** Hashes of the inline scripts that may run, like `THEME_BOOT_SCRIPT_HASH` from `@handijit/design`. */
  scriptHashes?: readonly string[];
  /** Extra image sources. `'self'` and `data:` are always allowed. */
  imgSrc?: readonly string[];
  /** Extra font sources. `'self'` is always allowed. */
  fontSrc?: readonly string[];
  /** Extra media sources. `'self'` is always allowed. */
  mediaSrc?: readonly string[];
  /** The Vite dev server origin. Set only in development: it relaxes the policy for HMR. */
  devServerUrl?: string;
};

// A source that contains one of these would end the directive or the header and start another.
const UNSAFE_SOURCE_PATTERN = /[;,\s]/;
const HASH_PATTERN = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

const assertSources = (name: string, sources: readonly string[]): void => {
  for (const source of sources) {
    if (source === "" || UNSAFE_SOURCE_PATTERN.test(source)) {
      throw new TypeError(
        `buildContentSecurityPolicy: ${name} entry ${JSON.stringify(source)} must be a single source without spaces, commas or semicolons`
      );
    }
  }
};

/**
 * Builds the Content-Security-Policy header of the app.
 *
 * Production: only the app's own origin runs script and style; inline script is allowed by
 * hash only, `eval` never. Development (`devServerUrl` set): Vite's client needs inline
 * script and style and a WebSocket to the dev server, so exactly those are added.
 */
const buildContentSecurityPolicy = ({
  connectSrc = [],
  scriptHashes = [],
  imgSrc = [],
  fontSrc = [],
  mediaSrc = [],
  devServerUrl,
}: ContentSecurityPolicyOptions = {}): string => {
  assertSources("connectSrc", connectSrc);
  assertSources("imgSrc", imgSrc);
  assertSources("fontSrc", fontSrc);
  assertSources("mediaSrc", mediaSrc);
  for (const hash of scriptHashes) {
    if (!HASH_PATTERN.test(hash)) {
      throw new TypeError(
        `buildContentSecurityPolicy: scriptHashes entry ${JSON.stringify(hash)} must look like "sha256-<base64>"`
      );
    }
  }

  const isDevelopment = devServerUrl !== undefined;
  const devSocket = isDevelopment
    ? [new URL(devServerUrl).origin.replace(/^http/, "ws")]
    : [];
  // With 'unsafe-inline' present a hash would switch inline script off again, so development
  // lists no hashes.
  const script = isDevelopment
    ? ["'self'", "'unsafe-inline'"]
    : ["'self'", ...scriptHashes.map((hash) => `'${hash}'`)];
  const style = isDevelopment ? ["'self'", "'unsafe-inline'"] : ["'self'"];

  const directives: readonly (readonly [string, readonly string[]])[] = [
    ["default-src", ["'self'"]],
    ["script-src", script],
    ["style-src", style],
    ["img-src", ["'self'", "data:", ...imgSrc]],
    ["font-src", ["'self'", ...fontSrc]],
    ["media-src", ["'self'", ...mediaSrc]],
    ["connect-src", ["'self'", ...devSocket, ...connectSrc]],
    ["object-src", ["'none'"]],
    ["frame-src", ["'none'"]],
    ["worker-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
  ];

  return directives
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
};

export type { ContentSecurityPolicyOptions };
export default buildContentSecurityPolicy;
