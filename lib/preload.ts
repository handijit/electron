// The sandboxed preload: it can require `electron` and nothing else, so this entry carries no
// schema and no Node module.
import exposeBridge from "./preload/expose-bridge";
import AUTH_CHANNELS from "./shared/auth-channels.constants";
import UPDATE_CHANNELS from "./shared/update-channels.constants";
import withUpdateChannels from "./shared/with-update-channels";
import type { WithUpdateChannels } from "./shared/with-update-channels";
import type { ChannelMap, ChannelSource } from "./types";

export { AUTH_CHANNELS, exposeBridge, UPDATE_CHANNELS, withUpdateChannels };
export type { ChannelMap, ChannelSource, WithUpdateChannels };
