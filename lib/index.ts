// The shared entry: pure constants, the contract helper and the types. It imports neither
// `electron` nor `node:*`, so main, preload and renderer can all load it.
import { APP_HOST, APP_SCHEME, APP_URL } from "./shared/app-url.constants";
import BRIDGE_KEY from "./shared/bridge-key.constants";
import channelsOf from "./shared/channels-of";
import { CORE_CHANNELS } from "./shared/core-channels.constants";
import defineContract from "./shared/define-contract";
import LOG_LEVELS from "./shared/log-levels.constants";
import {
  THEME_ATTRIBUTE,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
} from "./shared/theme.constants";

export {
  APP_HOST,
  APP_SCHEME,
  APP_URL,
  BRIDGE_KEY,
  channelsOf,
  CORE_CHANNELS,
  defineContract,
  LOG_LEVELS,
  THEME_ATTRIBUTE,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
};
export type { CoreChannels } from "./shared/core-channels.constants";
export type {
  ChannelMap,
  ChannelSource,
  Contract,
  ContractBridge,
  CoreBridge,
  DesktopBridge,
  EventChannel,
  EventInput,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeDefinition,
  InvokeInput,
  InvokeOutput,
  InvokeParsedInput,
  InvokeResult,
  LogContext,
  LogLevel,
  RendererLogEntry,
  ResolvedTheme,
  ThemePreference,
  ThemeState,
  Unsubscribe,
} from "./types";
