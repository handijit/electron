import type { ContractBridge, Contract, Unsubscribe } from "./contract.type";

/** The user's theme choice. */
type ThemePreference = "system" | "light" | "dark";

/** The theme actually shown. */
type ResolvedTheme = "light" | "dark";

/** The theme choice together with what it currently resolves to. */
type ThemeState = {
  /** What the user chose. */
  readonly preference: ThemePreference;
  /** What that choice means right now (`system` follows the operating system). */
  readonly resolved: ResolvedTheme;
};

type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured data attached to a log line. Must survive structured clone and JSON. */
type LogContext = Readonly<Record<string, unknown>>;

/** A log line sent by the renderer to main. */
type RendererLogEntry = {
  readonly level: LogLevel;
  readonly message: string;
  readonly context?: LogContext;
};

/** The channels this package registers for itself (log forwarding and the theme bridge). */
type CoreBridge = {
  readonly invoke: {
    readonly "core-log:write": (entry: RendererLogEntry) => Promise<void>;
    readonly "core-theme:get": () => Promise<ThemeState>;
    readonly "core-theme:set": (
      preference: ThemePreference
    ) => Promise<ThemeState>;
  };
  readonly on: {
    readonly "core-theme:changed": (
      listener: (state: ThemeState) => void
    ) => Unsubscribe;
  };
};

/** Everything `exposeBridge` puts on `window.desktop` for a contract. */
type DesktopBridge<C extends Contract> = {
  readonly invoke: ContractBridge<C>["invoke"] & CoreBridge["invoke"];
  readonly on: ContractBridge<C>["on"] & CoreBridge["on"];
};

export type {
  CoreBridge,
  DesktopBridge,
  LogContext,
  LogLevel,
  RendererLogEntry,
  ResolvedTheme,
  ThemePreference,
  ThemeState,
};
