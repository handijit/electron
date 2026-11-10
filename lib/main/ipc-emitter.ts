import { webContents as allWebContents } from "electron";
import type { WebContents } from "electron";

import type { Contract, EventChannel, EventInput } from "../types";
import { parse } from "./ipc-handlers";
import type { UrlPolicy } from "./url-policy";

/** Sends the contract's events from main to the renderer. */
type Emitter<C extends Contract> = {
  /** Sends an event to one window. Returns `false` when the target is gone or is not the app. */
  readonly send: <K extends EventChannel<C>>(
    target: WebContents,
    channel: K,
    payload: EventInput<C, K>
  ) => boolean;
  /** Sends an event to every window of the app. Returns how many received it. */
  readonly broadcast: <K extends EventChannel<C>>(
    channel: K,
    payload: EventInput<C, K>
  ) => number;
};

type EmitterOptions = {
  /** Decides which pages may receive events. */
  policy: UrlPolicy;
};

/**
 * Creates the sender for the contract's events. A payload that does not match its schema
 * throws: that is a bug in main. A target that is destroyed, or that somehow shows a page
 * which is not the app, is skipped: data never leaves for a foreign page.
 */
const createEmitter = <C extends Contract>(
  contract: C,
  { policy }: EmitterOptions
): Emitter<C> => {
  const deliver = (
    target: WebContents,
    channel: string,
    payload: unknown
  ): boolean => {
    if (target.isDestroyed() || !policy.isTrustedAppUrl(target.getURL())) {
      return false;
    }
    target.send(channel, payload);
    return true;
  };

  const validate = (channel: string, payload: unknown): unknown => {
    const schema = Object.hasOwn(contract.events, channel)
      ? contract.events[channel]
      : undefined;
    if (schema === undefined) {
      throw new TypeError(
        `createEmitter: event "${channel}" is not in the contract`
      );
    }
    return parse(schema, payload, "INVALID_EVENT", channel);
  };

  return {
    send: (target, channel, payload) =>
      deliver(target, channel, validate(channel, payload)),
    broadcast: (channel, payload) => {
      const parsed = validate(channel, payload);
      return allWebContents
        .getAllWebContents()
        .filter((target) => deliver(target, channel, parsed)).length;
    },
  };
};

export type { Emitter, EmitterOptions };
export default createEmitter;
