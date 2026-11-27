import type { ChannelSource } from "../types";
import UPDATE_CHANNELS from "./update-channels.constants";

/** The channel list of a program with the updater's channels added. */
type WithUpdateChannels<C extends ChannelSource> = {
  readonly invoke: C["invoke"] & typeof UPDATE_CHANNELS.invoke;
  readonly events: C["events"] & typeof UPDATE_CHANNELS.events;
};

/**
 * Adds the updater's channels to the channel list of a program, for its preload:
 * `exposeBridge(withUpdateChannels(APP_CHANNELS))`. Throws when the program already uses one
 * of the names: two handlers for one channel is a bug found at start-up.
 */
const withUpdateChannels = <const C extends ChannelSource>(
  channels: C
): WithUpdateChannels<C> => {
  const taken = [
    ...Object.keys(UPDATE_CHANNELS.invoke),
    ...Object.keys(UPDATE_CHANNELS.events),
  ].find(
    (name) =>
      Object.hasOwn(channels.invoke, name) ||
      Object.hasOwn(channels.events, name)
  );
  if (taken !== undefined) {
    throw new TypeError(
      `withUpdateChannels: channel "${taken}" is already in the list; the "update:" area belongs to the updater of @handijitcom/electron`
    );
  }

  return {
    invoke: { ...channels.invoke, ...UPDATE_CHANNELS.invoke },
    events: { ...channels.events, ...UPDATE_CHANNELS.events },
  };
};

export type { WithUpdateChannels };
export default withUpdateChannels;
