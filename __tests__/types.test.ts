import { describe, expectTypeOf, test } from "vitest";
import { z } from "zod";

import channelsOf from "../lib/shared/channels-of";
import defineContract from "../lib/shared/define-contract";
import type { Handlers } from "../lib/main/ipc-handlers";
import type { Emitter } from "../lib/main/ipc-emitter";
import type { Client } from "../lib/renderer/create-client";
import type {
  ChannelMap,
  DesktopBridge,
  EventChannel,
  EventInput,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeInput,
  InvokeOutput,
  InvokeParsedInput,
  InvokeResult,
  ThemeState,
  Unsubscribe,
} from "../lib/types";

const contract = defineContract({
  invoke: {
    "notes:list": { output: z.array(z.object({ id: z.number() })) },
    "notes:rename": {
      input: z.object({
        id: z.number(),
        title: z.string().default("Untitled"),
      }),
    },
    "notes:count": {
      input: z.string().transform((text) => text.length),
      output: z.number().transform(String),
    },
    "notes:clear": {},
  },
  events: {
    "sync:progress": z.object({ done: z.number(), total: z.number() }),
    "sync:finished": z.string().transform((text) => new Date(text)),
  },
});
type C = typeof contract;

describe("the types a contract derives", () => {
  test("should list exactly the channels of the contract", () => {
    expectTypeOf<InvokeChannel<C>>().toEqualTypeOf<
      "notes:list" | "notes:rename" | "notes:count" | "notes:clear"
    >();
    expectTypeOf<EventChannel<C>>().toEqualTypeOf<
      "sync:progress" | "sync:finished"
    >();
  });

  test("should give the renderer the schema's input and the handler its parsed output", () => {
    expectTypeOf<InvokeInput<C, "notes:rename">>().toEqualTypeOf<{
      id: number;
      title?: string | undefined;
    }>();
    expectTypeOf<InvokeParsedInput<C, "notes:rename">>().toEqualTypeOf<{
      id: number;
      title: string;
    }>();
    expectTypeOf<InvokeInput<C, "notes:count">>().toEqualTypeOf<string>();
    expectTypeOf<InvokeParsedInput<C, "notes:count">>().toEqualTypeOf<number>();
    expectTypeOf<InvokeInput<C, "notes:list">>().toEqualTypeOf<undefined>();
    expectTypeOf<
      InvokeParsedInput<C, "notes:clear">
    >().toEqualTypeOf<undefined>();
  });

  test("should give the handler the schema's input as its result and the renderer the parsed output", () => {
    expectTypeOf<InvokeResult<C, "notes:count">>().toEqualTypeOf<number>();
    expectTypeOf<InvokeOutput<C, "notes:count">>().toEqualTypeOf<string>();
    expectTypeOf<InvokeOutput<C, "notes:list">>().toEqualTypeOf<
      { id: number }[]
    >();
    expectTypeOf<InvokeOutput<C, "notes:clear">>().toEqualTypeOf<void>();
    expectTypeOf<InvokeResult<C, "notes:rename">>().toEqualTypeOf<void>();
  });

  test("should take an argument only for a channel that declares an input", () => {
    expectTypeOf<InvokeArgs<C, "notes:list">>().toEqualTypeOf<[]>();
    expectTypeOf<InvokeArgs<C, "notes:clear">>().toEqualTypeOf<[]>();
    expectTypeOf<InvokeArgs<C, "notes:count">>().toEqualTypeOf<
      [input: string]
    >();
  });

  test("should type an event by what main passes and what the listener receives", () => {
    expectTypeOf<EventInput<C, "sync:finished">>().toEqualTypeOf<string>();
    expectTypeOf<EventPayload<C, "sync:finished">>().toEqualTypeOf<Date>();
    expectTypeOf<EventPayload<C, "sync:progress">>().toEqualTypeOf<{
      done: number;
      total: number;
    }>();
  });
});

describe("the typed surfaces", () => {
  test("should type the renderer client from the contract alone", () => {
    const client = {} as Client<C>;

    expectTypeOf(client.invoke<"notes:list">).returns.toEqualTypeOf<
      Promise<{ id: number }[]>
    >();
    expectTypeOf(client.invoke<"notes:count">).parameters.toEqualTypeOf<
      [channel: "notes:count", input: string]
    >();
    expectTypeOf(client.invoke<"notes:clear">).parameters.toEqualTypeOf<
      [channel: "notes:clear"]
    >();
    expectTypeOf(client.on<"sync:finished">).parameters.toEqualTypeOf<
      [channel: "sync:finished", listener: (payload: Date) => void]
    >();
    expectTypeOf(
      client.on<"sync:finished">
    ).returns.toEqualTypeOf<Unsubscribe>();
  });

  test("should refuse a channel, an input or a listener the contract does not declare", () => {
    const client = {} as Client<C>;
    const calls = (): void => {
      // @ts-expect-error the channel is not in the contract
      void client.invoke("fs:read");
      // @ts-expect-error the input is required
      void client.invoke("notes:count");
      // @ts-expect-error the input has the wrong type
      void client.invoke("notes:count", 1);
      // @ts-expect-error the channel takes no input
      void client.invoke("notes:clear", {});
      // @ts-expect-error an event is not a request
      void client.invoke("sync:progress");
      // @ts-expect-error a request is not an event
      client.on("notes:list", () => undefined);
      client.on("sync:progress", (payload) => {
        expectTypeOf(payload).toEqualTypeOf<{ done: number; total: number }>();
      });
    };
    expectTypeOf(calls).toBeFunction();
  });

  test("should require a handler for every request and type each one", () => {
    expectTypeOf<keyof Handlers<C>>().toEqualTypeOf<InvokeChannel<C>>();
    expectTypeOf<
      Parameters<Handlers<C>["notes:count"]>[0]
    >().toEqualTypeOf<number>();
    expectTypeOf<
      Parameters<Handlers<C>["notes:list"]>[0]
    >().toEqualTypeOf<undefined>();
    expectTypeOf<ReturnType<Handlers<C>["notes:count"]>>().toEqualTypeOf<
      number | Promise<number>
    >();
    // @ts-expect-error a handler is missing
    const incomplete: Handlers<C> = { "notes:list": () => [] };
    expectTypeOf(incomplete).toBeObject();
  });

  test("should type what main may emit", () => {
    const emitter = {} as Emitter<C>;
    const calls = (): void => {
      emitter.broadcast("sync:finished", "2026-11-10T00:00:00Z");
      // @ts-expect-error the payload is the schema's input, not its output
      emitter.broadcast("sync:finished", new Date());
      // @ts-expect-error a request is not an event
      emitter.broadcast("notes:list", []);
    };
    expectTypeOf(calls).toBeFunction();
    expectTypeOf(emitter.broadcast).returns.toEqualTypeOf<number>();
    expectTypeOf(emitter.send).returns.toEqualTypeOf<boolean>();
  });

  test("should expose the app's channels together with the core's on window.desktop", () => {
    type Bridge = DesktopBridge<C>;

    expectTypeOf<Bridge["invoke"]["notes:list"]>().toEqualTypeOf<
      () => Promise<{ id: number }[]>
    >();
    expectTypeOf<Bridge["invoke"]["core-theme:get"]>().toEqualTypeOf<
      () => Promise<ThemeState>
    >();
    expectTypeOf<Bridge["on"]["sync:progress"]>().toEqualTypeOf<
      (
        listener: (payload: { done: number; total: number }) => void
      ) => Unsubscribe
    >();
    expectTypeOf<Bridge["on"]["core-theme:changed"]>().toEqualTypeOf<
      (listener: (state: ThemeState) => void) => Unsubscribe
    >();
  });

  test("should make the Zod-free channel map exact", () => {
    expectTypeOf(channelsOf(contract)).toEqualTypeOf<ChannelMap<C>>();
    const exact: ChannelMap<C> = {
      invoke: {
        "notes:list": true,
        "notes:rename": true,
        "notes:count": true,
        "notes:clear": true,
      },
      events: { "sync:progress": true, "sync:finished": true },
    };
    expectTypeOf(exact).toEqualTypeOf<ChannelMap<C>>();
    const missing: ChannelMap<C> = {
      invoke: exact.invoke,
      // @ts-expect-error a channel is missing
      events: { "sync:progress": true },
    };
    const extra: ChannelMap<C> = {
      invoke: exact.invoke,
      // @ts-expect-error a channel that is not in the contract
      events: { ...exact.events, "sync:other": true },
    };
    expectTypeOf([missing, extra]).toBeArray();
  });
});
