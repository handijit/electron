import { beforeEach, describe, expect, test, vi } from "vitest";

import createThemeBridge from "../../lib/main/theme-bridge";
import type { ThemePreferenceStore } from "../../lib/main/theme-bridge";
import type { ThemePreference } from "../../lib/types";

/**
 * A stand-in for Electron's `nativeTheme`: `themeSource` forces the colours, `"system"`
 * follows the operating system, and listeners hear `"updated"`.
 */
const mocks = vi.hoisted(() => {
  const state = {
    osIsDark: false,
    source: "system",
    assignments: [] as string[],
    listeners: [] as (() => void)[],
  };
  const nativeTheme = {
    get themeSource(): string {
      return state.source;
    },
    set themeSource(value: string) {
      state.assignments.push(value);
      state.source = value;
    },
    get shouldUseDarkColors(): boolean {
      return state.source === "system"
        ? state.osIsDark
        : state.source === "dark";
    },
    on: (event: string, listener: () => void): void => {
      if (event === "updated") state.listeners.push(listener);
    },
    removeListener: (event: string, listener: () => void): void => {
      if (event === "updated") {
        state.listeners = state.listeners.filter((item) => item !== listener);
      }
    },
  };
  return { state, nativeTheme };
});

vi.mock("electron", () => ({ nativeTheme: mocks.nativeTheme }));

const emitUpdated = (): void => {
  for (const listener of [...mocks.state.listeners]) listener();
};

const setOsDark = (isDark: boolean): void => {
  mocks.state.osIsDark = isDark;
  emitUpdated();
};

const createStore = (
  stored: unknown = "system"
): ThemePreferenceStore & {
  set: ReturnType<typeof vi.fn<ThemePreferenceStore["set"]>>;
} => ({
  get: () => stored as ThemePreference,
  set: vi.fn<ThemePreferenceStore["set"]>(async () => undefined),
});

beforeEach(() => {
  mocks.state.osIsDark = false;
  mocks.state.source = "system";
  mocks.state.assignments = [];
  mocks.state.listeners = [];
});

describe("createThemeBridge", () => {
  describe("at start", () => {
    test.each(["system", "light", "dark"] as const)(
      "should apply the stored preference %j to nativeTheme at once",
      (stored) => {
        const bridge = createThemeBridge(createStore(stored));

        expect(mocks.state.assignments).toEqual([stored]);
        expect(bridge.getState().preference).toBe(stored);
      }
    );

    test.each([["neon"], [undefined], [null], [42], [{ theme: "dark" }]])(
      "sentinel: should fall back to the system theme when the stored value is %j",
      (stored) => {
        const bridge = createThemeBridge(createStore(stored));

        // nativeTheme throws on anything but its three values; it must never see this one.
        expect(mocks.state.assignments).toEqual(["system"]);
        expect(bridge.getState()).toEqual({
          preference: "system",
          resolved: "light",
        });
      }
    );

    test("should not write the preference back while starting", () => {
      const store = createStore("dark");

      createThemeBridge(store);

      expect(store.set).not.toHaveBeenCalled();
    });
  });

  describe("getState", () => {
    test("should resolve the system preference to what the operating system shows", () => {
      const bridge = createThemeBridge(createStore("system"));

      expect(bridge.getState()).toEqual({
        preference: "system",
        resolved: "light",
      });

      setOsDark(true);

      expect(bridge.getState()).toEqual({
        preference: "system",
        resolved: "dark",
      });
    });

    test("should resolve a fixed preference to itself whatever the operating system shows", () => {
      mocks.state.osIsDark = true;

      expect(createThemeBridge(createStore("light")).getState()).toEqual({
        preference: "light",
        resolved: "light",
      });
      expect(createThemeBridge(createStore("dark")).getState()).toEqual({
        preference: "dark",
        resolved: "dark",
      });
    });
  });

  describe("following the operating system", () => {
    test("should tell the listeners when the resolved theme changes", () => {
      const bridge = createThemeBridge(createStore("system"));
      const first = vi.fn();
      const second = vi.fn();
      bridge.onChange(first);
      bridge.onChange(second);

      setOsDark(true);
      setOsDark(false);

      expect(first.mock.calls).toEqual([
        [{ preference: "system", resolved: "dark" }],
        [{ preference: "system", resolved: "light" }],
      ]);
      expect(second).toHaveBeenCalledTimes(2);
    });

    test("should stay quiet for an update that changes neither preference nor theme", () => {
      const bridge = createThemeBridge(createStore("system"));
      const listener = vi.fn();
      bridge.onChange(listener);

      // nativeTheme also reports contrast and transparency changes as "updated".
      emitUpdated();
      emitUpdated();

      expect(listener).not.toHaveBeenCalled();
    });

    test("should stay quiet when the operating system changes under a fixed preference", () => {
      const bridge = createThemeBridge(createStore("light"));
      const listener = vi.fn();
      bridge.onChange(listener);

      setOsDark(true);

      expect(listener).not.toHaveBeenCalled();
      expect(bridge.getState().resolved).toBe("light");
    });
  });

  describe("setPreference", () => {
    test("should apply the preference, persist it and resolve with the new state", async () => {
      const store = createStore("system");
      const bridge = createThemeBridge(store);

      const state = await bridge.setPreference("dark");

      expect(state).toEqual({ preference: "dark", resolved: "dark" });
      expect(bridge.getState()).toEqual(state);
      expect(mocks.state.assignments).toEqual(["system", "dark"]);
      expect(store.set).toHaveBeenCalledExactlyOnceWith("dark");
    });

    test("should tell the listeners once, before the preference is on disk", async () => {
      const store = createStore("system");
      let finishSaving = (): void => undefined;
      store.set.mockReturnValue(
        new Promise<void>((done) => {
          finishSaving = done;
        })
      );
      const bridge = createThemeBridge(store);
      const listener = vi.fn();
      bridge.onChange(listener);

      const pending = bridge.setPreference("dark");

      // The app changes colour at once; it does not wait for the disk.
      expect(listener).toHaveBeenCalledExactlyOnceWith({
        preference: "dark",
        resolved: "dark",
      });
      finishSaving();
      await pending;
      // nativeTheme reports its own "updated" for the same change: no second notification.
      emitUpdated();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    test("should tell the listeners when only the preference changes", async () => {
      mocks.state.osIsDark = true;
      const bridge = createThemeBridge(createStore("system"));
      const listener = vi.fn();
      bridge.onChange(listener);

      await bridge.setPreference("dark");

      expect(listener).toHaveBeenCalledExactlyOnceWith({
        preference: "dark",
        resolved: "dark",
      });
    });

    test("should persist, but not announce, a preference that is already in force", async () => {
      const store = createStore("light");
      const bridge = createThemeBridge(store);
      const listener = vi.fn();
      bridge.onChange(listener);

      await bridge.setPreference("light");

      expect(listener).not.toHaveBeenCalled();
      expect(store.set).toHaveBeenCalledExactlyOnceWith("light");
    });

    test("should work with a store that saves synchronously", async () => {
      const store = createStore("system");
      store.set.mockReturnValue(undefined);
      const bridge = createThemeBridge(store);

      await expect(bridge.setPreference("light")).resolves.toEqual({
        preference: "light",
        resolved: "light",
      });
    });

    test.each([["neon"], ["Dark"], [""], [undefined], [null], [1]])(
      "sentinel: should reject %j without applying or storing it",
      async (value) => {
        const store = createStore("light");
        const bridge = createThemeBridge(store);
        const listener = vi.fn();
        bridge.onChange(listener);

        await expect(
          bridge.setPreference(value as ThemePreference)
        ).rejects.toThrow(TypeError);
        await expect(
          bridge.setPreference(value as ThemePreference)
        ).rejects.toThrow(
          `setPreference: expected "system", "light" or "dark", received ${JSON.stringify(value)}`
        );

        expect(mocks.state.assignments).toEqual(["light"]);
        expect(store.set).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
        expect(bridge.getState()).toEqual({
          preference: "light",
          resolved: "light",
        });
      }
    );

    test("should reject when the store fails, with the theme already applied", async () => {
      const store = createStore("system");
      const failure = new Error("disk full");
      store.set.mockRejectedValue(failure);
      const bridge = createThemeBridge(store);

      await expect(bridge.setPreference("dark")).rejects.toBe(failure);

      expect(bridge.getState()).toEqual({
        preference: "dark",
        resolved: "dark",
      });
    });
  });

  describe("onChange", () => {
    test("should stop calling a listener that unsubscribed, and tolerate a second call", () => {
      const bridge = createThemeBridge(createStore("system"));
      const stopped = vi.fn();
      const kept = vi.fn();
      const unsubscribe = bridge.onChange(stopped);
      bridge.onChange(kept);

      unsubscribe();
      unsubscribe();
      setOsDark(true);

      expect(stopped).not.toHaveBeenCalled();
      expect(kept).toHaveBeenCalledTimes(1);
    });

    test("should still call the listeners of this change when one of them unsubscribes another", () => {
      const bridge = createThemeBridge(createStore("system"));
      const calls: string[] = [];
      const stopSecond = { run: (): void => undefined };
      bridge.onChange(() => {
        calls.push("first");
        stopSecond.run();
      });
      stopSecond.run = bridge.onChange(() => calls.push("second"));

      setOsDark(true);
      setOsDark(false);

      expect(calls).toEqual(["first", "second", "first"]);
    });
  });

  describe("dispose", () => {
    test("should stop following the operating system and drop its listeners", async () => {
      const bridge = createThemeBridge(createStore("system"));
      const listener = vi.fn();
      bridge.onChange(listener);
      expect(mocks.state.listeners).toHaveLength(1);

      bridge.dispose();
      setOsDark(true);

      expect(mocks.state.listeners).toHaveLength(0);
      expect(listener).not.toHaveBeenCalled();

      await bridge.setPreference("light");

      expect(listener).not.toHaveBeenCalled();
    });

    test("should leave the listeners of another bridge alone", () => {
      const first = createThemeBridge(createStore("system"));
      const second = createThemeBridge(createStore("system"));
      const listener = vi.fn();
      second.onChange(listener);

      first.dispose();
      setOsDark(true);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
