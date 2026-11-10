const { z } = require("zod");
const shared = require("@handijit/electron");
const renderer = require("@handijit/electron/renderer");

const fail = (message) => {
  throw new Error(`CJS entry is broken: ${message}`);
};

const contract = shared.defineContract({
  invoke: { "notes:list": { output: z.array(z.string()) } },
  events: {},
});
if (shared.channelsOf(contract).invoke["notes:list"] !== true)
  fail("channelsOf");
if (shared.CORE_CHANNELS.events["core-theme:changed"] !== true)
  fail("CORE_CHANNELS");
if (typeof renderer.syncTheme !== "function") fail("renderer");
for (const [subpath, file] of [
  ["main", "main.cjs"],
  ["preload", "preload.cjs"],
]) {
  if (
    !require.resolve(`@handijit/electron/${subpath}`).endsWith(`/build/${file}`)
  )
    fail(subpath);
}
require("@handijit/electron/package.json");

console.log("CJS entries OK");
