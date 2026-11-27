/** Why main refused or failed an IPC call. The code is the first thing in the message. */
type IpcErrorCode =
  | "UNTRUSTED_SENDER"
  | "INVALID_INPUT"
  | "INVALID_OUTPUT"
  | "INVALID_EVENT"
  | "HANDLER_FAILED";

/**
 * The error main throws for an IPC call. Only the message survives the trip to the renderer,
 * so it starts with the code: `[INVALID_INPUT] settings:set-theme: …`.
 */
class IpcError extends Error {
  readonly code: IpcErrorCode;
  readonly channel: string;

  constructor(code: IpcErrorCode, channel: string, detail: string) {
    super(`[${code}] ${channel}: ${detail}`);
    this.name = "IpcError";
    this.code = code;
    this.channel = channel;
  }
}

export type { IpcErrorCode };
export default IpcError;
