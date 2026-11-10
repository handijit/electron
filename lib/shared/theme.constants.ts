import type { ThemePreference } from "../types";

/** The attribute `@handijit/design` reads: `<html data-theme="dark">`. Kept equal by a test. */
const THEME_ATTRIBUTE = "data-theme" as const;

/** The `localStorage` key the `@handijit/design` boot script reads. Kept equal by a test. */
const THEME_STORAGE_KEY = "hd-theme" as const;

/** Every theme preference, in the order a settings screen lists them. */
const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
];

export { THEME_ATTRIBUTE, THEME_PREFERENCES, THEME_STORAGE_KEY };
