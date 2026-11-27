import { describe, expect, test, vi } from "vitest";

import createUpdateClient, {
  updateClient,
} from "../../lib/renderer/create-update-client";
import { makeState } from "../helpers/update-fixtures";
import { createUpdateBridge } from "../helpers/update-bridge";

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("createUpdateClient", () => {
  test("should stay quiet without a bridge", async () => {
    const client = createUpdateClient();
    const listener = vi.fn();
    const stop = client.subscribe(listener);
    expect(client.getState()).toBeNull();
    await expect(client.refresh()).rejects.toThrow(
      /window\.desktop is missing/
    );
    stop();
    expect(listener).not.toHaveBeenCalled();
    expect(updateClient.getState()).toBeNull();
  });

  test("should connect on the first subscriber and ask for the state", async () => {
    const state = makeState({ revision: 3 });
    const { bridge, invoke } = createUpdateBridge(() => state);
    vi.stubGlobal("desktop", bridge);
    const client = createUpdateClient();
    const listener = vi.fn();
    client.subscribe(listener);
    client.subscribe(listener);
    await flush();
    expect(bridge.on["update:state-changed"]).toHaveBeenCalledTimes(1);
    expect(invoke["update:get-state"]).toHaveBeenCalledTimes(1);
    expect(client.getState()).toBe(state);
    // Each subscription is its own entry.
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("should order snapshots by revision and ignore what is not a state", async () => {
    const { bridge, emit } = createUpdateBridge(() =>
      makeState({ revision: 1 })
    );
    vi.stubGlobal("desktop", bridge);
    const client = createUpdateClient();
    const listener = vi.fn();
    client.subscribe(listener);
    emit(makeState({ revision: 5, status: "checking" }));
    await flush();
    // The answer to the first request is older than the event.
    expect(client.getState()?.revision).toBe(5);
    emit({ status: "hacked" });
    emit(makeState({ revision: 5, status: "idle" }));
    expect(client.getState()?.status).toBe("checking");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("should swallow a failed first request", async () => {
    const { bridge, invoke } = createUpdateBridge();
    invoke["update:get-state"].mockRejectedValue(new Error("refused"));
    vi.stubGlobal("desktop", bridge);
    const client = createUpdateClient();
    client.subscribe(vi.fn());
    await flush();
    expect(client.getState()).toBeNull();
  });

  test("should disconnect when the last subscriber leaves", () => {
    const { bridge, unsubscribe, listeners } = createUpdateBridge();
    vi.stubGlobal("desktop", bridge);
    const client = createUpdateClient();
    const first = client.subscribe(vi.fn());
    const second = client.subscribe(vi.fn());
    first();
    first();
    expect(unsubscribe).not.toHaveBeenCalled();
    second();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  test("should resolve every action with the newest known state", async () => {
    let revision = 0;
    const { bridge, invoke } = createUpdateBridge(() =>
      makeState({ revision: ++revision })
    );
    vi.stubGlobal("desktop", bridge);
    const client = createUpdateClient();
    expect((await client.check())?.revision).toBe(1);
    expect((await client.download())?.revision).toBe(2);
    expect((await client.install())?.revision).toBe(3);
    expect((await client.refresh())?.revision).toBe(4);
    await client.openDownloadPage();
    expect(invoke["update:open-download-page"]).toHaveBeenCalledTimes(1);
  });
});
