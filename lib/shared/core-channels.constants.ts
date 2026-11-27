import type { CoreBridge } from "../types";

type CoreChannels = {
  readonly invoke: { readonly [K in keyof CoreBridge["invoke"]]: true };
  readonly events: { readonly [K in keyof CoreBridge["on"]]: true };
};

/**
 * The channels this package owns. The `core-` area is reserved: `defineContract` rejects an
 * app channel that uses it, so the two sets can never collide on the bridge.
 */
const CORE_CHANNELS: CoreChannels = {
  invoke: {
    "core-log:write": true,
    "core-theme:get": true,
    "core-theme:set": true,
  },
  events: {
    "core-theme:changed": true,
  },
};

/** The area prefix no app channel may use. */
const CORE_CHANNEL_PREFIX = "core-" as const;

export type { CoreChannels };
export { CORE_CHANNEL_PREFIX, CORE_CHANNELS };
