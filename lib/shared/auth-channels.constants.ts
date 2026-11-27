/**
 * The channel names of `authContract` without its schemas: what a preload spreads into the
 * map it passes to `exposeBridge`, so that the preload bundle stays free of Zod. A test keeps
 * it equal to the contract.
 */
const AUTH_CHANNELS = {
  invoke: {
    "auth:get-state": true,
    "auth:sign-in": true,
    "auth:cancel-sign-in": true,
    "auth:sign-out": true,
  },
  events: {
    "auth:changed": true,
  },
} as const;

export default AUTH_CHANNELS;
