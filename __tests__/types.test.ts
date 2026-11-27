import type { WebContents } from "electron";
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { z } from "zod";

vi.mock("electron", () => ({
  app: {},
  net: {},
  shell: {},
  ipcMain: {},
  webContents: {},
}));

import { defineContract } from "@handijitcom/electron";
import type {
  AuthState,
  ChannelMap,
  DesktopBridge,
  InvokeArgs,
  InvokeOutput,
  InvokeParsedInput,
  SignInResult,
  ThemeState,
  UpdateInfo,
  UpdateState,
} from "@handijitcom/electron";
import { createAuth } from "@handijitcom/electron/auth";
import type { AuthOptions } from "@handijitcom/electron/auth";
import { printSilently } from "@handijitcom/electron/main";
import type { Handlers, PrintResult } from "@handijitcom/electron/main";
import { createClient } from "@handijitcom/electron/renderer";
import { createUpdater } from "@handijitcom/electron/update";
import type { UpdaterOptions } from "@handijitcom/electron/update";

const contract = defineContract({
  invoke: {
    "notes:list": { output: z.array(z.object({ id: z.number() })) },
    "notes:rename": {
      input: z.object({ id: z.number(), title: z.string().default("x") }),
    },
  },
  events: { "sync:done": z.object({ count: z.number() }) },
});
type AppContract = typeof contract;

describe("contract types", () => {
  test("should keep the contract value as it was declared", () => {
    expect(Object.keys(contract.invoke)).toEqual([
      "notes:list",
      "notes:rename",
    ]);
  });

  test("should give a channel without input no argument and one with input one", () => {
    expectTypeOf<InvokeArgs<AppContract, "notes:list">>().toEqualTypeOf<[]>();
    expectTypeOf<InvokeArgs<AppContract, "notes:rename">>().toEqualTypeOf<
      [input: { id: number; title?: string | undefined }]
    >();
    expectTypeOf<
      InvokeParsedInput<AppContract, "notes:rename">
    >().toEqualTypeOf<{ id: number; title: string }>();
  });

  test("should give a channel without output void and one with output its type", () => {
    expectTypeOf<
      InvokeOutput<AppContract, "notes:rename">
    >().toEqualTypeOf<void>();
    expectTypeOf<InvokeOutput<AppContract, "notes:list">>().toEqualTypeOf<
      { id: number }[]
    >();
  });

  test("should demand a channel map with exactly the contract's channels", () => {
    const exact: ChannelMap<AppContract> = {
      invoke: { "notes:list": true, "notes:rename": true },
      events: { "sync:done": true },
    };
    const missing: ChannelMap<AppContract> = {
      // @ts-expect-error notes:rename is missing
      invoke: { "notes:list": true },
      events: { "sync:done": true },
    };
    const extra: ChannelMap<AppContract> = {
      invoke: {
        "notes:list": true,
        "notes:rename": true,
        // @ts-expect-error notes:delete is not in the contract
        "notes:delete": true,
      },
      events: { "sync:done": true },
    };
    expect(Object.keys(exact.invoke)).toHaveLength(2);
    expect(Object.keys(missing.invoke)).toHaveLength(1);
    expect(Object.keys(extra.invoke)).toHaveLength(3);
  });

  test("should demand a handler for every request channel", () => {
    const handlers: Handlers<AppContract> = {
      "notes:list": () => [{ id: 1 }],
      "notes:rename": ({ id, title }) => {
        expectTypeOf(id).toEqualTypeOf<number>();
        expectTypeOf(title).toEqualTypeOf<string>();
      },
    };
    // @ts-expect-error notes:rename has no handler
    const incomplete: Handlers<AppContract> = { "notes:list": () => [] };
    expect(Object.keys(handlers)).toHaveLength(2);
    expect(Object.keys(incomplete)).toHaveLength(1);
  });

  test("should type the renderer client from the contract", () => {
    const client = createClient<AppContract>();
    expectTypeOf(client.invoke<"notes:list">).returns.toEqualTypeOf<
      Promise<{ id: number }[]>
    >();
    expectTypeOf(client.invoke<"notes:rename">)
      .parameter(1)
      .toEqualTypeOf<{ id: number; title?: string | undefined }>();
    expectTypeOf(client.on<"sync:done">)
      .parameter(1)
      .parameter(0)
      .toEqualTypeOf<{ count: number }>();
    // @ts-expect-error notes:rename needs its input
    const missingInput = (): unknown => client.invoke("notes:rename");
    // @ts-expect-error notes:list takes no input
    const extraInput = (): unknown => client.invoke("notes:list", 1);
    // @ts-expect-error not a channel of the contract
    const unknownChannel = (): unknown => client.invoke("notes:delete");
    expect([missingInput, extraInput, unknownChannel]).toHaveLength(3);
  });

  test("should put the core channels on the bridge type", () => {
    type Bridge = DesktopBridge<AppContract>;
    expectTypeOf<Bridge["invoke"]["core-theme:get"]>().returns.toEqualTypeOf<
      Promise<ThemeState>
    >();
    expectTypeOf<Bridge["invoke"]["notes:list"]>().returns.toEqualTypeOf<
      Promise<{ id: number }[]>
    >();
    expectTypeOf<Bridge["on"]>().toHaveProperty("core-theme:changed");
  });
});

describe("state types", () => {
  test("should narrow the update state by its status", () => {
    const describeState = (state: UpdateState): string => {
      if (state.status === "downloading") {
        expectTypeOf(state.progress.percent).toEqualTypeOf<number>();
        return state.update.version;
      }
      if (state.status === "error") {
        expectTypeOf(state.update).toEqualTypeOf<UpdateInfo | null>();
        return state.error.code;
      }
      // @ts-expect-error only some statuses carry an update
      return state.update;
    };
    expect(typeof describeState).toBe("function");
  });

  test("should narrow a sign-in result by ok", () => {
    const describeResult = (result: SignInResult): string => {
      if (result.ok) return result.user?.id ?? "";
      expectTypeOf(result.error.code).toBeString();
      return result.error.message;
    };
    expect(
      describeResult({ ok: true, user: { id: "7", name: null, email: null } })
    ).toBe("7");
  });

  test("should never put a token in the auth state", () => {
    expectTypeOf<keyof AuthState>().toEqualTypeOf<
      "status" | "user" | "error" | "isRemembered"
    >();
  });
});

describe("main-process option types", () => {
  test("should require the printer's name", () => {
    const contents = {} as WebContents;
    expectTypeOf(printSilently).returns.toEqualTypeOf<Promise<PrintResult>>();
    // @ts-expect-error deviceName is required
    const unnamed = (): unknown => printSilently(contents, { copies: 1 });
    expect(typeof unnamed).toBe("function");
  });

  test("should require the authorize URL and the token endpoint", () => {
    expectTypeOf<AuthOptions>()
      .toHaveProperty("authorizeUrl")
      .toEqualTypeOf<string>();
    expectTypeOf<AuthOptions>()
      .toHaveProperty("tokenEndpoint")
      .toEqualTypeOf<string>();
    const noToken = (): unknown =>
      // @ts-expect-error tokenEndpoint is required
      createAuth({ authorizeUrl: "https://a.example/" });
    const noAuthorize = (): unknown =>
      // @ts-expect-error authorizeUrl is required
      createAuth({ tokenEndpoint: "https://a.example/" });
    expect([noToken, noAuthorize]).toHaveLength(2);
  });

  test("should require the engine, the logger, the feed and the download page", () => {
    type Required = {
      [
        K in keyof UpdaterOptions as undefined extends UpdaterOptions[K]
          ? never
          : K
      ]: true;
    };
    expectTypeOf<keyof Required>().toEqualTypeOf<
      "engine" | "feedUrl" | "downloadPageUrl" | "logger"
    >();
    // @ts-expect-error the feed and the download page are required
    const partial = (): unknown => createUpdater({ engine: {}, logger: {} });
    expect(typeof partial).toBe("function");
  });
});
