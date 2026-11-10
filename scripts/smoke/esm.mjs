import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as shared from "@handijit/electron";
import * as renderer from "@handijit/electron/renderer";

const fail = (message) => {
  throw new Error(`ESM entry is broken: ${message}`);
};
const resolve = (specifier) => fileURLToPath(import.meta.resolve(specifier));

const contract = shared.defineContract({
  invoke: { "notes:list": { output: z.array(z.string()) } },
  events: { "sync:done": z.number() },
});
const channels = shared.channelsOf(contract);
if (channels.invoke["notes:list"] !== true) fail("channelsOf");
if (channels.events["sync:done"] !== true) fail("channelsOf events");
if (shared.APP_URL !== "app://bundle/") fail("APP_URL");
if (shared.BRIDGE_KEY !== "desktop") fail("BRIDGE_KEY");
try {
  shared.defineContract({ invoke: { listNotes: {} }, events: {} });
  fail("a malformed channel name was accepted");
} catch (error) {
  if (!String(error.message).includes("area:action")) throw error;
}

// The renderer entry loads without a window; it reaches for one only when called.
const client = renderer.createClient();
try {
  client.invoke("notes:list");
  fail("invoke worked without a bridge");
} catch (error) {
  if (!String(error.message).includes("window.desktop is missing")) throw error;
}
renderer.log.info("dropped quietly without a bridge");

// main and preload import `electron`, which only an Electron process can load: here they
// only have to resolve to the right files. The Electron smoke test loads them for real.
for (const [subpath, file] of [
  ["main", "main.mjs"],
  ["preload", "preload.mjs"],
]) {
  const path = resolve(`@handijit/electron/${subpath}`);
  if (!path.endsWith(`/build/${file}`) || !existsSync(path)) fail(subpath);
}

console.log("ESM entries OK");
