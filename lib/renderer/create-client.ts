import type {
  Contract,
  EventChannel,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeOutput,
  Unsubscribe,
} from "../types";
import { getBridge, pick } from "./get-bridge.helper";

/** The typed view of `window.desktop` for one contract. */
type Client<C extends Contract> = {
  /** Calls a request–response channel. Rejects when main refuses the sender or the input. */
  readonly invoke: <K extends InvokeChannel<C>>(
    channel: K,
    ...args: InvokeArgs<C, K>
  ) => Promise<InvokeOutput<C, K>>;
  /** Listens to an event from main. Returns the function that stops listening. */
  readonly on: <K extends EventChannel<C>>(
    channel: K,
    listener: (payload: EventPayload<C, K>) => void
  ) => Unsubscribe;
};

/**
 * Wraps `window.desktop` in the contract's types. The bridge is read on every call, not when
 * the client is created, so the module can be imported before the page has a window (tests,
 * shared packages).
 */
const createClient = <C extends Contract>(): Client<C> => ({
  invoke: (channel, ...args) => {
    const invoke = pick(getBridge("invoke").invoke, channel, "invoke");
    return invoke(args[0]) as Promise<never>;
  },
  on: (channel, listener) => {
    const subscribe = pick(getBridge("on").on, channel, "on");
    return subscribe(listener as (payload: unknown) => void);
  },
});

export type { Client };
export default createClient;
