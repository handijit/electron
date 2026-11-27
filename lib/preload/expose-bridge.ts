import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

import BRIDGE_KEY from "../shared/bridge-key.constants";
import { collectChannels } from "../shared/channel-name.helper";
import { CORE_CHANNELS } from "../shared/core-channels.constants";
import type { ChannelSource, Unsubscribe } from "../types";

type Listener = (payload: unknown) => void;

const toInvoker =
  (channel: string) =>
  (input?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, input);

const toSubscriber =
  (channel: string) =>
  (listener: Listener): Unsubscribe => {
    if (typeof listener !== "function") {
      throw new TypeError(
        `desktop.on["${channel}"]: expected a listener function, received ${typeof listener}`
      );
    }
    // The IPC event is never handed to the renderer: it exposes the sender.
    const handler = (_event: IpcRendererEvent, payload: unknown): void =>
      listener(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  };

const toRecord = <T>(
  names: readonly string[],
  build: (channel: string) => T
): Record<string, T> =>
  Object.fromEntries(names.map((name) => [name, build(name)]));

/**
 * Exposes `window.desktop` with one named function per channel of the contract, plus the
 * channels this package owns. Neither `ipcRenderer` nor a generic `invoke(channel)` gate
 * reaches the renderer: a channel that is not in the list cannot be called at all.
 *
 * Pass the contract itself, or a `ChannelMap` when the preload bundle must stay free of Zod.
 */
const exposeBridge = (channels: ChannelSource): void => {
  const app = collectChannels(channels, "exposeBridge");
  const invoke = [...app.invoke, ...Object.keys(CORE_CHANNELS.invoke)];
  const events = [...app.events, ...Object.keys(CORE_CHANNELS.events)];

  contextBridge.exposeInMainWorld(BRIDGE_KEY, {
    invoke: toRecord(invoke, toInvoker),
    on: toRecord(events, toSubscriber),
  });
};

export default exposeBridge;
