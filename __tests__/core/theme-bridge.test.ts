import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);

import createThemeBridge from "../../lib/main/theme-bridge";
import type { ThemePreference } from "../../lib/types";
import { fakeElectron, resetElectron } from "../helpers/core-electron";

const { nativeTheme } = fakeElectron;

const store = (stored: unknown = "light") => ({
  get: vi.fn(() => stored as ThemePreference),
  set: vi.fn(async () => undefined),
});

beforeEach(() => {
  resetElectron();
});

describe("createThemeBridge", () => {
  test("should apply the stored preference before anything else", () => {
    createThemeBridge(store("dark"));
    expect(nativeTheme.themeSource).toBe("dark");
  });

  test("should fall back to system for a stored value it does not know", () => {
    const bridge = createThemeBridge(store("sepia"));
    expect(nativeTheme.themeSource).toBe("system");
    expect(bridge.getState()).toEqual({
      preference: "system",
      resolved: "light",
    });
  });

  test("should resolve with the operating system's colours", () => {
    nativeTheme.shouldUseDarkColors = true;
    expect(createThemeBridge(store("system")).getState()).toEqual({
      preference: "system",
      resolved: "dark",
    });
  });

  test("should store, apply and announce a new preference", async () => {
    const preferences = store("light");
    const bridge = createThemeBridge(preferences);
    const listener = vi.fn();
    bridge.onChange(listener);
    nativeTheme.shouldUseDarkColors = true;
    await expect(bridge.setPreference("dark")).resolves.toEqual({
      preference: "dark",
      resolved: "dark",
    });
    expect(nativeTheme.themeSource).toBe("dark");
    expect(preferences.set).toHaveBeenCalledWith("dark");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("should refuse a preference that is not one", async () => {
    await expect(
      createThemeBridge(store()).setPreference("blue" as never)
    ).rejects.toThrow(TypeError);
  });

  test("should announce a system switch, and nothing when only other settings changed", () => {
    const bridge = createThemeBridge(store("system"));
    const listener = vi.fn();
    const stop = bridge.onChange(listener);
    nativeTheme.emit("updated");
    expect(listener).not.toHaveBeenCalled();
    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit("updated");
    expect(listener).toHaveBeenCalledWith({
      preference: "system",
      resolved: "dark",
    });
    stop();
    nativeTheme.shouldUseDarkColors = false;
    nativeTheme.emit("updated");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("should re-apply and announce the state even when it did not change", () => {
    const bridge = createThemeBridge(store("dark"));
    const listener = vi.fn();
    bridge.onChange(listener);
    nativeTheme.themeSource = "light";
    bridge.reapply();
    expect(nativeTheme.themeSource).toBe("dark");
    expect(listener).toHaveBeenCalledWith({
      preference: "dark",
      resolved: "light",
    });
  });

  test("should stop following the system once disposed", () => {
    const bridge = createThemeBridge(store("system"));
    const listener = vi.fn();
    bridge.onChange(listener);
    bridge.dispose();
    expect(nativeTheme.listenerCount("updated")).toBe(0);
    bridge.reapply();
    expect(listener).not.toHaveBeenCalled();
  });
});
