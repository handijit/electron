// The preload entry. It requires only `electron`, so a bundler can inline it into the single
// CommonJS file a sandboxed preload has to be.
import exposeBridge from "./preload/expose-bridge";

export { exposeBridge };
export type { ChannelMap, ChannelSource } from "./types";
