/**
 * The channels of the updater without their schemas: what a preload passes to `exposeBridge`,
 * so that its bundle never has to import Zod. A test keeps it equal to `updateContract`.
 */
const UPDATE_CHANNELS = {
  invoke: {
    "update:get-state": true,
    "update:check": true,
    "update:download": true,
    "update:install": true,
    "update:open-download-page": true,
  },
  events: {
    "update:state-changed": true,
  },
} as const;

export default UPDATE_CHANNELS;
