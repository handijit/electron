import BRIDGE_KEY from "../shared/bridge-key.constants";

type RawBridge = {
  readonly invoke: Readonly<
    Record<string, (input?: unknown) => Promise<unknown>>
  >;
  readonly on: Readonly<
    Record<string, (listener: (payload: unknown) => void) => () => void>
  >;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Reads `window.desktop`, failing loudly when the preload did not run. */
const getBridge = (caller: string): RawBridge => {
  const bridge: unknown = (globalThis as Record<string, unknown>)[BRIDGE_KEY];
  if (!isRecord(bridge) || !isRecord(bridge.invoke) || !isRecord(bridge.on)) {
    throw new Error(
      `${caller}: window.${BRIDGE_KEY} is missing; call exposeBridge() in the preload script of this window`
    );
  }
  return bridge as RawBridge;
};

/** Looks a channel up without walking the prototype chain. */
const pick = <T>(
  record: Readonly<Record<string, T>>,
  channel: string,
  caller: string
): T => {
  if (!Object.hasOwn(record, channel)) {
    throw new Error(
      `${caller}: channel "${channel}" is not exposed by the preload; add it to the contract passed to exposeBridge()`
    );
  }
  return record[channel] as T;
};

export type { RawBridge };
export { getBridge, pick };
