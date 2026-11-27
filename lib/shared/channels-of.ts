import type { ChannelMap, Contract } from "../types";

/**
 * The Zod-free channel list of a contract. A test compares it with the map the preload
 * passes to `exposeBridge`, so the preload bundle never has to import the schemas.
 */
const channelsOf = <C extends Contract>(contract: C): ChannelMap<C> => {
  const toMap = (names: string[]): Record<string, true> =>
    Object.fromEntries(names.map((name) => [name, true]));

  return {
    invoke: toMap(Object.keys(contract.invoke)),
    events: toMap(Object.keys(contract.events)),
  } as ChannelMap<C>;
};

export default channelsOf;
