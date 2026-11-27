import { vi } from "vitest";

import type { UpdateState } from "../../lib/types";

type Listener = (payload: unknown) => void;

/**
 * A stand-in for `window.desktop` with the updater's channels: every invoke is a spy that
 * resolves with `answer`, and `emit` plays an event from main.
 */
const createUpdateBridge = (answer: () => unknown = () => null) => {
  const listeners = new Set<Listener>();
  const invoke = {
    "update:get-state": vi.fn(async () => answer()),
    "update:check": vi.fn(async () => answer()),
    "update:download": vi.fn(async () => answer()),
    "update:install": vi.fn(async () => answer()),
    "update:open-download-page": vi.fn(async () => undefined),
  };
  const unsubscribe = vi.fn();
  const bridge = {
    invoke,
    on: {
      "update:state-changed": vi.fn((listener: Listener) => {
        listeners.add(listener);
        return () => {
          unsubscribe();
          listeners.delete(listener);
        };
      }),
    },
  };
  return {
    bridge,
    invoke,
    unsubscribe,
    listeners,
    emit: (state: UpdateState | unknown) => {
      for (const listener of [...listeners]) listener(state);
    },
  };
};

export { createUpdateBridge };
