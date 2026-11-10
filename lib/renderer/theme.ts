import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "../shared/theme.constants";
import type {
  ResolvedTheme,
  ThemePreference,
  ThemeState,
  Unsubscribe,
} from "../types";
import { getBridge, pick } from "./get-bridge.helper";

/** Reads the theme preference and what it resolves to from main. */
const getTheme = (): Promise<ThemeState> =>
  pick(
    getBridge("getTheme").invoke,
    "core-theme:get",
    "getTheme"
  )() as Promise<ThemeState>;

/** Stores a new theme preference in main and resolves with the resulting state. */
const setThemePreference = (preference: ThemePreference): Promise<ThemeState> =>
  pick(
    getBridge("setThemePreference").invoke,
    "core-theme:set",
    "setThemePreference"
  )(preference) as Promise<ThemeState>;

/** Listens to theme changes: a new preference, or the operating system switching. */
const onThemeChange = (listener: (state: ThemeState) => void): Unsubscribe =>
  pick(
    getBridge("onThemeChange").on,
    "core-theme:changed",
    "onThemeChange"
  )(listener as (payload: unknown) => void);

/** Writes the resolved theme where `@handijit/design` reads it: `<html data-theme>`. */
const applyTheme = (resolved: ResolvedTheme): void => {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, resolved);
};

// Two guards holding different values would undo each other forever: one per page.
let stopRunning: Unsubscribe | null = null;

/**
 * Keeps `<html data-theme>` equal to the theme main resolved; returns the function that stops.
 * One per page: a second call stops the first. Main is the only owner of the theme: a stale
 * `localStorage` choice is removed; a write of the attribute that disagrees with main (the
 * design boot script follows `prefers-color-scheme`, which DevTools emulation can change
 * without main changing) is undone before the next paint; main is asked again when the
 * window is focused or shown again.
 */
const syncTheme = (): Unsubscribe => {
  stopRunning?.();
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage can be blocked; then there is no stale choice to remove either.
  }

  const root = document.documentElement;
  // Main's last word; until then the boot script's guess stands.
  let resolved: ResolvedTheme | null = null;
  // A read sent before an event is older than that event.
  let eventCount = 0;
  let isStopped = false;

  const hold = (next: ResolvedTheme): void => {
    resolved = next;
    if (root.getAttribute(THEME_ATTRIBUTE) !== next) applyTheme(next);
  };

  const stopEvents = onThemeChange((state) => {
    eventCount += 1;
    hold(state.resolved);
  });

  const ask = (): void => {
    const sentAfter = eventCount;
    getTheme().then(
      (state) => {
        if (!isStopped && sentAfter === eventCount) hold(state.resolved);
      },
      () => undefined
    );
  };

  // Mutation records arrive as a microtask, before the next paint.
  const guard = new MutationObserver(() => {
    if (resolved !== null && root.getAttribute(THEME_ATTRIBUTE) !== resolved) {
      applyTheme(resolved);
    }
  });
  guard.observe(root, { attributes: true, attributeFilter: [THEME_ATTRIBUTE] });

  const askWhenVisible = (): void => {
    if (document.visibilityState === "visible") ask();
  };
  window.addEventListener("focus", ask);
  window.addEventListener("pageshow", ask);
  document.addEventListener("visibilitychange", askWhenVisible);

  ask();

  const stop = (): void => {
    if (isStopped) return;
    stopRunning = null;
    isStopped = true;
    stopEvents();
    guard.disconnect();
    window.removeEventListener("focus", ask);
    window.removeEventListener("pageshow", ask);
    document.removeEventListener("visibilitychange", askWhenVisible);
  };
  stopRunning = stop;
  return stop;
};

export { applyTheme, getTheme, onThemeChange, setThemePreference, syncTheme };
