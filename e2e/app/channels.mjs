// The fixture's channel names, without Zod: what a sandboxed preload bundles. The scenario
// asserts that this list equals channelsOf(contract), the way an app's sentinel test would.
export default {
  invoke: { "math:add": true, "app:info": true },
  events: { "clock:tick": true },
};
