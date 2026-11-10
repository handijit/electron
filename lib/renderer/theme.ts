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

/**
 * Keeps `<html data-theme>` equal to the theme main resolved, and returns the function that
 * stops doing so. Main is the only owner of the preference: a choice left in `localStorage`
 * by web code would make the `@handijit/design` boot script disagree with it on the next
 * start, so that entry is removed.
 */
const syncTheme = (): Unsubscribe => {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage can be blocked; then there is no stale choice to remove either.
  }

  // An event is newer than the answer to the first read; once one arrived, or once the caller
  // stopped, that answer must not be applied any more.
  let isSettled = false;
  const stop = onThemeChange((state) => {
    isSettled = true;
    applyTheme(state.resolved);
  });
  getTheme().then(
    (state) => {
      if (!isSettled) applyTheme(state.resolved);
    },
    // A refused read leaves the theme the boot script chose.
    () => undefined
  );

  return () => {
    isSettled = true;
    stop();
  };
};

export { applyTheme, getTheme, onThemeChange, setThemePreference, syncTheme };
