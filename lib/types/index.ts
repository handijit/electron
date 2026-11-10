import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";

/** One request–response channel: the renderer invokes it, main validates and answers. */
type InvokeDefinition = {
  /** Schema of the single argument. Leave it out for a channel that takes none. */
  readonly input?: ZodType;
  /** Schema of the answer. Leave it out for a channel that resolves with nothing. */
  readonly output?: ZodType;
};

/** The IPC surface of an app: every channel the renderer may use, and nothing else. */
type Contract = {
  /** Request–response channels (`ipcRenderer.invoke` → `ipcMain.handle`). */
  readonly invoke: Readonly<Record<string, InvokeDefinition>>;
  /** Notifications from main to the renderer (`webContents.send`). */
  readonly events: Readonly<Record<string, ZodType>>;
};

/** The channel names a preload needs: the contract itself, or a plain map with the same keys. */
type ChannelSource = {
  /** Keys are the request–response channel names; values are ignored. */
  readonly invoke: Readonly<Record<string, unknown>>;
  /** Keys are the event channel names; values are ignored. */
  readonly events: Readonly<Record<string, unknown>>;
};

/** A Zod-free list of a contract's channels, checked for exactness by the compiler. */
type ChannelMap<C extends Contract> = {
  readonly invoke: { readonly [K in InvokeChannel<C>]: true };
  readonly events: { readonly [K in EventChannel<C>]: true };
};

type InvokeChannel<C extends Contract> = keyof C["invoke"] & string;
type EventChannel<C extends Contract> = keyof C["events"] & string;

/** What the renderer passes to a channel (before Zod transforms and defaults). */
type InvokeInput<
  C extends Contract,
  K extends InvokeChannel<C>,
> = C["invoke"][K] extends { readonly input: infer S extends ZodType }
  ? ZodInput<S>
  : undefined;

/** What the handler in main receives (after Zod parsing). */
type InvokeParsedInput<
  C extends Contract,
  K extends InvokeChannel<C>,
> = C["invoke"][K] extends { readonly input: infer S extends ZodType }
  ? ZodOutput<S>
  : undefined;

/** The argument list of a channel: empty when the channel declares no input. */
type InvokeArgs<
  C extends Contract,
  K extends InvokeChannel<C>,
> = C["invoke"][K] extends { readonly input: ZodType }
  ? [input: InvokeInput<C, K>]
  : [];

/** What the renderer receives from a channel. */
type InvokeOutput<
  C extends Contract,
  K extends InvokeChannel<C>,
> = C["invoke"][K] extends { readonly output: infer S extends ZodType }
  ? ZodOutput<S>
  : void;

/** What the handler in main returns (before the output schema parses it). */
type InvokeResult<
  C extends Contract,
  K extends InvokeChannel<C>,
> = C["invoke"][K] extends { readonly output: infer S extends ZodType }
  ? ZodInput<S>
  : void;

/** What main passes to the emitter for an event channel. */
type EventInput<C extends Contract, K extends EventChannel<C>> = ZodInput<
  C["events"][K]
>;

/** What a renderer listener receives for an event channel. */
type EventPayload<C extends Contract, K extends EventChannel<C>> = ZodOutput<
  C["events"][K]
>;

/** Removes the listener it was returned for. Safe to call more than once. */
type Unsubscribe = () => void;

/** The object the preload exposes for a contract: one named function per channel. */
type ContractBridge<C extends Contract> = {
  readonly invoke: {
    readonly [K in InvokeChannel<C>]: (
      ...args: InvokeArgs<C, K>
    ) => Promise<InvokeOutput<C, K>>;
  };
  readonly on: {
    readonly [K in EventChannel<C>]: (
      listener: (payload: EventPayload<C, K>) => void
    ) => Unsubscribe;
  };
};

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
};
