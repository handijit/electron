import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  applyTheme,
  getTheme,
  onThemeChange,
  setThemePreference,
  syncTheme,
} from "../../lib/renderer/theme";
import type { ThemeState, Unsubscribe } from "../../lib/types";

type Listener = (state: ThemeState) => void;

const DARK: ThemeState = { preference: "dark", resolved: "dark" };
const LIGHT: ThemeState = { preference: "system", resolved: "light" };

const stubBridge = (
  initial: Promise<ThemeState> = Promise.resolve(DARK)
): {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  changed: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  emit: Listener;
} => {
  const listeners: Listener[] = [];
  const unsubscribe = vi.fn();
  const bridge = {
    get: vi.fn(() => initial),
    set: vi.fn((preference: string) =>
      Promise.resolve({ preference, resolved: "light" })
    ),
    changed: vi.fn((listener: Listener) => {
      listeners.push(listener);
      return unsubscribe;
    }),
    unsubscribe,
    emit: (state: ThemeState): void => {
      for (const listener of listeners) listener(state);
    },
  };
  vi.stubGlobal("desktop", {
    invoke: { "core-theme:get": bridge.get, "core-theme:set": bridge.set },
    on: { "core-theme:changed": bridge.changed },
  });
  return bridge;
};

const attribute = (): string | null =>
  document.documentElement.getAttribute("data-theme");
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

// Every sync a test starts is stopped after it, so that its guard cannot touch the next test.
const running: Unsubscribe[] = [];
const sync = (): Unsubscribe => {
  const stop = syncTheme();
  running.push(stop);
  return stop;
};

afterEach(() => {
  for (const stop of running.splice(0)) stop();
});

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
});

describe("getTheme", () => {
  test("should ask main and resolve with its state", async () => {
    const bridge = stubBridge();

    await expect(getTheme()).resolves.toBe(DARK);
    expect(bridge.get).toHaveBeenCalledExactlyOnceWith();
  });

  test("should fail loudly without a bridge", () => {
    expect(() => getTheme()).toThrow(/^getTheme: window\.desktop is missing/);
  });

  test("should fail loudly when the preload exposes no core channels", () => {
    vi.stubGlobal("desktop", { invoke: {}, on: {} });

    expect(() => getTheme()).toThrow(
      /^getTheme: channel "core-theme:get" is not exposed/
    );
  });
});

describe("setThemePreference", () => {
  test("should send the preference to main and resolve with the new state", async () => {
    const bridge = stubBridge();

    await expect(setThemePreference("light")).resolves.toEqual({
      preference: "light",
      resolved: "light",
    });
    expect(bridge.set).toHaveBeenCalledExactlyOnceWith("light");
  });

  test("should not touch the page by itself: main announces the change", async () => {
    stubBridge();

    await setThemePreference("light");

    expect(attribute()).toBeNull();
    expect(localStorage.getItem("hd-theme")).toBeNull();
  });

  test("should fail loudly without a bridge", () => {
    expect(() => setThemePreference("dark")).toThrow(
      /^setThemePreference: window\.desktop is missing/
    );
  });
});

describe("onThemeChange", () => {
  test("should subscribe the listener and return the unsubscribe", () => {
    const bridge = stubBridge();
    const listener = vi.fn();

    const stop = onThemeChange(listener);
    bridge.emit(LIGHT);

    expect(listener).toHaveBeenCalledExactlyOnceWith(LIGHT);
    expect(stop).toBe(bridge.unsubscribe);
  });

  test("should fail loudly without a bridge", () => {
    expect(() => onThemeChange(vi.fn())).toThrow(
      /^onThemeChange: window\.desktop is missing/
    );
  });
});

describe("applyTheme", () => {
  test.each(["light", "dark"] as const)(
    "should write %s where @handijit/design reads it",
    (theme) => {
      applyTheme(theme);

      expect(attribute()).toBe(theme);
    }
  );
});

describe("syncTheme", () => {
  test("should apply the theme main resolved", async () => {
    stubBridge(Promise.resolve(DARK));

    sync();
    expect(attribute()).toBeNull();
    await settle();

    expect(attribute()).toBe("dark");
  });

  test("should follow every later change", async () => {
    const bridge = stubBridge(Promise.resolve(DARK));
    sync();
    await settle();

    bridge.emit(LIGHT);
    expect(attribute()).toBe("light");
    bridge.emit(DARK);
    expect(attribute()).toBe("dark");
  });

  test("sentinel: should remove a theme left in localStorage, so the design boot script cannot disagree with main", () => {
    localStorage.setItem("hd-theme", "light");
    localStorage.setItem("unrelated", "kept");
    stubBridge();

    sync();

    expect(localStorage.getItem("hd-theme")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("kept");
  });

  test("should keep working when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    stubBridge(Promise.resolve(DARK));

    expect(() => sync()).not.toThrow();
    await settle();

    expect(attribute()).toBe("dark");
  });

  test("should not let the first read overwrite a newer change", async () => {
    let answer: (state: ThemeState) => void = () => undefined;
    const bridge = stubBridge(
      new Promise<ThemeState>((resolve) => {
        answer = resolve;
      })
    );
    sync();

    bridge.emit(LIGHT);
    answer(DARK);
    await settle();

    expect(attribute()).toBe("light");
  });

  test("should stop following changes, and ignore a late first read, once stopped", async () => {
    let answer: (state: ThemeState) => void = () => undefined;
    const bridge = stubBridge(
      new Promise<ThemeState>((resolve) => {
        answer = resolve;
      })
    );

    const stop = sync();
    expect(bridge.unsubscribe).not.toHaveBeenCalled();
    stop();
    answer(DARK);
    await settle();

    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1);
    expect(attribute()).toBeNull();
  });

  test("should leave the boot script's theme when main refuses the read", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    const unhandled = vi.fn();
    window.addEventListener("unhandledrejection", unhandled);
    stubBridge(Promise.reject(new Error("[UNTRUSTED_SENDER] core-theme:get")));

    sync();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.removeEventListener("unhandledrejection", unhandled);

    expect(attribute()).toBe("light");
    expect(unhandled).not.toHaveBeenCalled();
  });

  test("sentinel: should undo a write that disagrees with main, like the boot script following an emulated prefers-color-scheme", async () => {
    stubBridge(Promise.resolve(DARK));
    const stop = sync();
    await settle();

    document.documentElement.setAttribute("data-theme", "light");
    await settle();

    expect(attribute()).toBe("dark");
    stop();
  });

  test("should keep guarding the theme main announced last", async () => {
    const bridge = stubBridge(Promise.resolve(DARK));
    const stop = sync();
    await settle();

    bridge.emit(LIGHT);
    document.documentElement.setAttribute("data-theme", "dark");
    await settle();

    expect(attribute()).toBe("light");
    stop();
  });

  test("should not rewrite an attribute that already holds main's theme", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const writes = vi.spyOn(Element.prototype, "setAttribute");
    stubBridge(Promise.resolve(DARK));

    sync();
    await settle();

    expect(writes).not.toHaveBeenCalled();
    expect(attribute()).toBe("dark");
  });

  test("should leave the boot script's theme alone until main has answered", async () => {
    stubBridge(new Promise<ThemeState>(() => undefined));
    const stop = sync();

    document.documentElement.setAttribute("data-theme", "light");
    await settle();

    expect(attribute()).toBe("light");
    stop();
  });

  test.each([
    [
      "the window is focused",
      (): void => void window.dispatchEvent(new Event("focus")),
    ],
    [
      "the page is shown again",
      (): void => void window.dispatchEvent(new Event("pageshow")),
    ],
    [
      "the page becomes visible",
      (): void => void document.dispatchEvent(new Event("visibilitychange")),
    ],
  ])("should ask main again when %s", async (_name, trigger) => {
    const bridge = stubBridge(Promise.resolve(LIGHT));
    const stop = sync();
    await settle();
    expect(attribute()).toBe("light");
    bridge.get.mockReturnValue(Promise.resolve(DARK));

    trigger();
    await settle();

    expect(bridge.get).toHaveBeenCalledTimes(2);
    expect(attribute()).toBe("dark");
    stop();
  });

  test("should not ask main while the page is hidden", async () => {
    const bridge = stubBridge(Promise.resolve(DARK));
    const stop = sync();
    await settle();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    document.dispatchEvent(new Event("visibilitychange"));

    expect(bridge.get).toHaveBeenCalledTimes(1);
    stop();
  });

  test("should stop guarding and asking once stopped", async () => {
    const bridge = stubBridge(Promise.resolve(DARK));
    const stop = sync();
    await settle();

    stop();
    document.documentElement.setAttribute("data-theme", "light");
    window.dispatchEvent(new Event("focus"));
    await settle();

    expect(attribute()).toBe("light");
    expect(bridge.get).toHaveBeenCalledTimes(1);
  });

  test("should fail loudly without a bridge", () => {
    expect(() => syncTheme()).toThrow(
      /^onThemeChange: window\.desktop is missing/
    );
  });
});
