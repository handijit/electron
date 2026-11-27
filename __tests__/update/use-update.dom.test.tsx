import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";

import useUpdate from "../../lib/update-react/use-update";
import { createFakeClient } from "../helpers/update-client";
import { makeState } from "../helpers/update-fixtures";

describe("useUpdate", () => {
  test("should read the client's state and follow its changes", () => {
    const { client, set } = createFakeClient();
    const { result } = renderHook(() => useUpdate(client));
    expect(result.current.state).toBeNull();
    const first = result.current;

    const next = makeState({ status: "checking", revision: 2 });
    act(() => set(next));
    expect(result.current.state).toBe(next);
    expect(result.current).not.toBe(first);
    expect(result.current.check).toBe(client.check);
    expect(result.current.download).toBe(client.download);
    expect(result.current.install).toBe(client.install);
    expect(result.current.openDownloadPage).toBe(client.openDownloadPage);
  });

  test("should subscribe and unsubscribe cleanly under StrictMode", () => {
    const { client, listeners } = createFakeClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    const { unmount } = renderHook(() => useUpdate(client), { wrapper });
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });

  test("should use the page's client by default", () => {
    const { result } = renderHook(() => useUpdate());
    expect(result.current.state).toBeNull();
  });

  test("should render nothing on a server", () => {
    const { client } = createFakeClient(makeState());
    const Probe = () => (
      <span>{useUpdate(client).state?.status ?? "none"}</span>
    );
    expect(renderToString(<Probe />)).toBe("<span>none</span>");
  });
});
