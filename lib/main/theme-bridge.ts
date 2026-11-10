import { nativeTheme } from "electron";

import { THEME_PREFERENCES } from "../shared/theme.constants";
import type { ThemePreference, ThemeState, Unsubscribe } from "../types";

/** Where the theme preference is persisted. A settings store with a `theme` key fits. */
type ThemePreferenceStore = {
  /** The stored preference. */
  readonly get: () => ThemePreference;
  /** Persists a new preference. */
  readonly set: (preference: ThemePreference) => Promise<unknown> | void;
};

/** The owner of the theme: the preference, what it resolves to, and who is told about it. */
type ThemeBridge = {
  /** The preference and the theme it resolves to right now. */
  readonly getState: () => ThemeState;
  /** Persists a preference and applies it to the whole app. */
  readonly setPreference: (preference: ThemePreference) => Promise<ThemeState>;
  /**
   * Applies the preference to `nativeTheme` again and tells every listener the state, changed
   * or not, so that every window re-applies it. For the moments the system may have reset the
   * appearance behind the app's back: waking from sleep, unlocking the screen.
   */
  readonly reapply: () => void;
  /** Listens to changes of the state. Returns the function that stops listening. */
  readonly onChange: (listener: (state: ThemeState) => void) => Unsubscribe;
  /** Stops following the operating system. */
  readonly dispose: () => void;
};

const isThemePreference = (value: unknown): value is ThemePreference =>
  THEME_PREFERENCES.includes(value as ThemePreference);

/**
 * Applies the stored preference to `nativeTheme.themeSource` and follows the operating
 * system from then on. Because the source is set in main before a window exists, the
 * renderer's `prefers-color-scheme`, the menus and the window frame all start in the right
 * theme: there is nothing to flash.
 */
const createThemeBridge = (store: ThemePreferenceStore): ThemeBridge => {
  const listeners = new Set<(state: ThemeState) => void>();
  // A stored value from a newer or broken file must not reach nativeTheme, which throws on it.
  const stored = store.get();
  let preference: ThemePreference = isThemePreference(stored)
    ? stored
    : "system";
  nativeTheme.themeSource = preference;

  const getState = (): ThemeState => ({
    preference,
    resolved: nativeTheme.shouldUseDarkColors ? "dark" : "light",
  });

  let last = getState();
  const tell = (state: ThemeState): void => {
    last = state;
    for (const listener of [...listeners]) listener(state);
  };
  const notify = (): void => {
    const next = getState();
    // nativeTheme reports "updated" for more than the colour scheme (contrast, transparency).
    if (
      next.preference === last.preference &&
      next.resolved === last.resolved
    ) {
      return;
    }
    tell(next);
  };
  nativeTheme.on("updated", notify);

  return {
    getState,
    setPreference: async (next) => {
      if (!isThemePreference(next)) {
        throw new TypeError(
          `setPreference: expected "system", "light" or "dark", received ${JSON.stringify(next)}`
        );
      }
      preference = next;
      nativeTheme.themeSource = next;
      notify();
      await store.set(next);
      return getState();
    },
    reapply: () => {
      nativeTheme.themeSource = preference;
      tell(getState());
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      nativeTheme.removeListener("updated", notify);
      listeners.clear();
    },
  };
};

export type { ThemeBridge, ThemePreferenceStore };
export default createThemeBridge;
