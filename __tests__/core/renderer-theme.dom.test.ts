import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  applyTheme,
  getTheme,
  onThemeChange,
  setThemePreference,
  syncTheme,
} from "../../lib/renderer/theme";
import type { ThemeState } from "../../lib/types";

type Listener = (state: ThemeState) => void;

let listeners: Listener[];
let themeGet: ReturnType<typeof vi.fn>;
let themeSet: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;

const root = (): HTMLElement => document.documentElement;
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const dark: ThemeState = { preference: "dark", resolved: "dark" };
const light: ThemeState = { preference: "light", resolved: "light" };

beforeEach(() => {
  listeners = [];
  unsubscribe = vi.fn();
  themeGet = vi.fn().mockResolvedValue(dark);
  themeSet = vi.fn().mockResolvedValue(light);
  Object.defineProperty(globalThis, "desktop", {
    configurable: true,
    writable: true,
    value: {
      invoke: { "core-theme:get": themeGet, "core-theme:set": themeSet },
      on: {
        "core-theme:changed": (listener: Listener) => {
          listeners.push(listener);
          return unsubscribe;
        },
      },
    },
  });
  root().removeAttribute("data-theme");
  localStorage.clear();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "desktop");
});

describe("theme calls", () => {
  test("should read the theme from main", async () => {
    await expect(getTheme()).resolves.toEqual(dark);
    expect(themeGet).toHaveBeenCalledWith();
  });

  test("should store a preference in main", async () => {
    await expect(setThemePreference("light")).resolves.toEqual(light);
    expect(themeSet).toHaveBeenCalledWith("light");
  });

  test("should listen to theme changes", () => {
    const listener = vi.fn();
    expect(onThemeChange(listener)).toBe(unsubscribe);
    listeners[0]?.(dark);
    expect(listener).toHaveBeenCalledWith(dark);
  });

  test("should write the resolved theme on <html>", () => {
    applyTheme("dark");
    expect(root().getAttribute("data-theme")).toBe("dark");
  });
});

describe("syncTheme", () => {
  test("should remove a stale stored choice and apply what main resolved", async () => {
    localStorage.setItem("hd-theme", "light");
    const stop = syncTheme();
    expect(localStorage.getItem("hd-theme")).toBeNull();
    await flush();
    expect(root().getAttribute("data-theme")).toBe("dark");
    stop();
  });

  test("should survive blocked storage", async () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const stop = syncTheme();
    await flush();
    expect(root().getAttribute("data-theme")).toBe("dark");
    stop();
  });

  test("should leave the attribute alone when it already agrees", async () => {
    root().setAttribute("data-theme", "dark");
    const spy = vi.spyOn(Element.prototype, "setAttribute");
    const stop = syncTheme();
    await flush();
    expect(spy).not.toHaveBeenCalled();
    stop();
  });

  test("should follow theme events from main", async () => {
    const stop = syncTheme();
    await flush();
    listeners[0]?.(light);
    expect(root().getAttribute("data-theme")).toBe("light");
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("should undo a write of the attribute that disagrees with main", async () => {
    const stop = syncTheme();
    await flush();
    root().setAttribute("data-theme", "light");
    await flush();
    expect(root().getAttribute("data-theme")).toBe("dark");
    stop();
  });

  test("should let the boot script's guess stand until main answers", async () => {
    let answer: (state: ThemeState) => void = () => undefined;
    themeGet.mockReturnValue(
      new Promise<ThemeState>((resolve) => {
        answer = resolve;
      })
    );
    const stop = syncTheme();
    root().setAttribute("data-theme", "light");
    await flush();
    expect(root().getAttribute("data-theme")).toBe("light");
    answer(dark);
    await flush();
    expect(root().getAttribute("data-theme")).toBe("dark");
    stop();
  });

  test("should drop an answer that is older than an event", async () => {
    let answer: (state: ThemeState) => void = () => undefined;
    themeGet.mockReturnValue(
      new Promise<ThemeState>((resolve) => {
        answer = resolve;
      })
    );
    const stop = syncTheme();
    listeners[0]?.(light);
    answer(dark);
    await flush();
    expect(root().getAttribute("data-theme")).toBe("light");
    stop();
  });

  test("should drop an answer that arrives after stopping", async () => {
    let answer: (state: ThemeState) => void = () => undefined;
    themeGet.mockReturnValue(
      new Promise<ThemeState>((resolve) => {
        answer = resolve;
      })
    );
    const stop = syncTheme();
    stop();
    answer(dark);
    await flush();
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  test("should ignore a failed read", async () => {
    themeGet.mockRejectedValue(new Error("refused"));
    const stop = syncTheme();
    await flush();
    expect(root().hasAttribute("data-theme")).toBe(false);
    stop();
  });

  test("should ask again on focus, pageshow and when visible", async () => {
    const stop = syncTheme();
    await flush();
    expect(themeGet).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    expect(themeGet).toHaveBeenCalledTimes(3);

    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(themeGet).toHaveBeenCalledTimes(3);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(themeGet).toHaveBeenCalledTimes(4);

    stop();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(themeGet).toHaveBeenCalledTimes(4);
  });

  test("should run once per page: a second call stops the first", async () => {
    const first = syncTheme();
    const second = syncTheme();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await flush();
    first();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    second();
    second();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
