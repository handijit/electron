import { ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type { ZodType } from "zod";

import type {
  Contract,
  InvokeChannel,
  InvokeParsedInput,
  InvokeResult,
  Unsubscribe,
} from "../types";
import IpcError from "./ipc-error";
import type { IpcErrorCode } from "./ipc-error";
import type { UrlPolicy } from "./url-policy";

/** One function per request–response channel of the contract; none may be missing. */
type Handlers<C extends Contract> = {
  readonly [K in InvokeChannel<C>]: (
    input: InvokeParsedInput<C, K>,
    event: IpcMainInvokeEvent
  ) => InvokeResult<C, K> | Promise<InvokeResult<C, K>>;
};

type RegisterHandlersOptions = {
  /** Decides which frames may call the handlers. */
  policy: UrlPolicy;
  /** Receives every refused or failed call, with the original error. Use it to log. */
  onError?: (error: IpcError, cause: unknown) => void;
};

type AnyHandler = (input: unknown, event: IpcMainInvokeEvent) => unknown;

const describeIssues = (error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): string =>
  error.issues
    .map(({ path, message }) =>
      path.length > 0 ? `${path.map(String).join(".")}: ${message}` : message
    )
    .join("; ");

const parse = (
  schema: ZodType,
  value: unknown,
  code: IpcErrorCode,
  channel: string
): unknown => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new IpcError(code, channel, describeIssues(result.error));
  }
  return result.data;
};

/**
 * Registers a handler for every request–response channel of the contract. Each call goes
 * through the same steps, in this order: the sender frame must be the app itself, the input
 * must match the schema, then the handler runs, then its answer must match the output schema.
 *
 * A handler that throws is a bug: the renderer receives `[HANDLER_FAILED]` without the
 * original message, which may hold paths or secrets. Expected failures belong in the output
 * schema as a typed result (`{ ok: false, code }`).
 *
 * Returns the function that removes the handlers.
 */
const registerHandlers = <C extends Contract>(
  contract: C,
  handlers: Handlers<C>,
  { policy, onError }: RegisterHandlersOptions
): Unsubscribe => {
  const channels = Object.keys(contract.invoke);
  const implementations = handlers as Readonly<Record<string, AnyHandler>>;

  for (const channel of channels) {
    if (typeof implementations[channel] !== "function") {
      throw new TypeError(
        `registerHandlers: no handler for channel "${channel}"`
      );
    }
  }
  const unknown = Object.keys(implementations).find(
    (channel) => !Object.hasOwn(contract.invoke, channel)
  );
  if (unknown !== undefined) {
    throw new TypeError(
      `registerHandlers: handler "${unknown}" has no channel in the contract`
    );
  }

  for (const channel of channels) {
    const { input, output } = contract.invoke[channel] ?? {};
    const handler = implementations[channel] as AnyHandler;

    const run = async (
      event: IpcMainInvokeEvent,
      args: readonly unknown[]
    ): Promise<unknown> => {
      const frameUrl = event.senderFrame?.url;
      if (frameUrl === undefined || !policy.isTrustedAppUrl(frameUrl)) {
        throw new IpcError(
          "UNTRUSTED_SENDER",
          channel,
          `refused frame ${frameUrl ?? "(gone)"}`
        );
      }

      let parsed: unknown;
      if (input !== undefined) {
        parsed = parse(input, args[0], "INVALID_INPUT", channel);
      } else if (args.some((arg) => arg !== undefined)) {
        throw new IpcError("INVALID_INPUT", channel, "takes no argument");
      }

      const result = await handler(parsed, event);
      return output === undefined
        ? undefined
        : parse(output, result, "INVALID_OUTPUT", channel);
    };

    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        return await run(event, args);
      } catch (cause) {
        const error =
          cause instanceof IpcError
            ? cause
            : new IpcError("HANDLER_FAILED", channel, "the handler failed");
        try {
          onError?.(error, cause);
        } catch {
          // A reporter that fails must not replace the safe error with its own message.
        }
        throw error;
      }
    });
  }

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
};

export type { Handlers, RegisterHandlersOptions };
export { parse };
export default registerHandlers;
