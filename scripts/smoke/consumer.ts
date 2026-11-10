import { z } from "zod";
import {
  channelsOf,
  defineContract,
  type ChannelMap,
  type DesktopBridge,
  type ThemeState,
} from "@handijit/electron";
import {
  createSecretStore,
  createSettingsStore,
  startApp,
  type AppContext,
  type Handlers,
} from "@handijit/electron/main";
import { exposeBridge } from "@handijit/electron/preload";
import {
  createClient,
  log,
  syncTheme,
  type Client,
} from "@handijit/electron/renderer";

const contract = defineContract({
  invoke: {
    "notes:list": { output: z.array(z.object({ id: z.number() })) },
    "notes:rename": { input: z.object({ id: z.number(), title: z.string() }) },
  },
  events: { "sync:done": z.object({ count: z.number() }) },
});
type AppContract = typeof contract;

// main
const handlers = (context: AppContext<AppContract>): Handlers<AppContract> => ({
  "notes:list": () => {
    context.emitter.broadcast("sync:done", { count: 0 });
    return [{ id: 1 }];
  },
  "notes:rename": ({ id, title }) => {
    context.logger.info("Renamed a note", { id, length: title.length });
  },
});
const started: Promise<AppContext<AppContract> | null> = startApp({
  contract,
  handlers,
  rendererRoot: "/app/renderer",
  window: { preload: "/app/preload.cjs", width: 1100, height: 720 },
  deepLink: {
    scheme: "handijit-notes",
    parse: (url) => (url.hostname === "open" ? { note: url.pathname } : null),
    onLink: (link) => link.note.length,
  },
});
const settings = createSettingsStore({
  schema: z.object({ fontSize: z.number().default(14) }),
});
const fontSize: Promise<number> = settings.then(
  (store) => store.get().fontSize
);
const secret: Promise<string | null> = createSecretStore().get("refresh-token");

// preload
const channels: ChannelMap<AppContract> = channelsOf(contract);
exposeBridge(channels);
exposeBridge(contract);

// renderer
const client: Client<AppContract> = createClient<AppContract>();
const notes: Promise<{ id: number }[]> = client.invoke("notes:list");
const renamed: Promise<void> = client.invoke("notes:rename", {
  id: 1,
  title: "x",
});
const stop: () => void = client.on("sync:done", ({ count }) => {
  log.info("Synced", { count });
});
const stopTheme: () => void = syncTheme();
declare const bridge: DesktopBridge<AppContract>;
const theme: Promise<ThemeState> = bridge.invoke["core-theme:get"]();

// @ts-expect-error a channel that is not in the contract must not compile
void client.invoke("fs:read");
// @ts-expect-error a wrong input must not compile
void client.invoke("notes:rename", { id: "1", title: "x" });
// @ts-expect-error a missing handler must not compile
const incomplete: Handlers<AppContract> = { "notes:list": () => [] };
void startApp({
  contract,
  handlers,
  rendererRoot: "/app/renderer",
  window: {
    preload: "/app/preload.cjs",
    // @ts-expect-error a web preference that weakens the isolation must not compile
    webPreferences: { sandbox: false },
  },
});
// @ts-expect-error a subpath the package does not export must not resolve
import("@handijit/electron/main/logger");

export {
  fontSize,
  incomplete,
  notes,
  renamed,
  secret,
  started,
  stop,
  stopTheme,
  theme,
};
