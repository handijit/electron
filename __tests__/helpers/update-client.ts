import { vi } from "vitest";

import type { UpdateClient } from "../../lib/renderer/create-update-client";
import type { UpdateState } from "../../lib/types";

/** An update client whose state a test sets, with every action a spy. */
const createFakeClient = (initial: UpdateState | null = null) => {
  let state = initial;
  const listeners = new Set<(state: UpdateState) => void>();
  const client = {
    getState: () => state,
    subscribe: vi.fn((listener: (state: UpdateState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    refresh: vi.fn(async () => state),
    check: vi.fn(async () => state),
    download: vi.fn(async () => state),
    install: vi.fn(async () => state),
    openDownloadPage: vi.fn(async () => undefined),
  } satisfies UpdateClient;
  return {
    client,
    listeners,
    /** Replaces the state and tells every subscriber, as main would. */
    set: (next: UpdateState) => {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
};

export { createFakeClient };
