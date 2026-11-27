/** The privileged scheme the bundled renderer is served from. `file://` is never used. */
const APP_SCHEME = "app" as const;

/** The only host the scheme serves. */
const APP_HOST = "bundle" as const;

/** The URL every window of a packaged app loads. */
const APP_URL = `${APP_SCHEME}://${APP_HOST}/` as const;

export { APP_HOST, APP_SCHEME, APP_URL };
