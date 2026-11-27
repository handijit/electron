import type { Contract } from "../types";
import { collectChannels } from "./channel-name.helper";

/**
 * Declares the IPC surface of an app in one place. Main, preload and renderer all derive
 * their types from the returned value, so a channel cannot exist on one side only.
 * Throws on a malformed channel name: that is a programming error, found at start-up.
 */
const defineContract = <const C extends Contract>(contract: C): C => {
  collectChannels(contract, "defineContract");
  return contract;
};

export default defineContract;
