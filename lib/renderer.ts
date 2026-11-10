// The renderer entry: no `electron`, no `node:*`. Everything goes through `window.desktop`.
import createClient from "./renderer/create-client";
import { forwardErrors, log } from "./renderer/log";
import {
  applyTheme,
  getTheme,
  onThemeChange,
  setThemePreference,
  syncTheme,
} from "./renderer/theme";

export {
  applyTheme,
  createClient,
  forwardErrors,
  getTheme,
  log,
  onThemeChange,
  setThemePreference,
  syncTheme,
};
export type { Client } from "./renderer/create-client";
export type { RendererLogger } from "./renderer/log";
