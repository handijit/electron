import type { Contract } from "../types";
import createAuthStore from "./create-auth-store";
import type { AuthStore } from "./create-auth-store";
import createClient from "./create-client";

// One store per page, whichever copy of this package asks: an app may load both the ESM and the
// CommonJS build of the renderer entry. The registry symbol is the same in all of them.
const STORE_KEY = Symbol.for("@handijitcom/electron:auth-store");

type StoreHolder = { [STORE_KEY]?: AuthStore };

/**
 * The page's session store, created on first use. It talks to main through `window.desktop`
 * (the bridge `exposeBridge` puts there), which it reads only when it connects, so this can be
 * called before the page has one.
 */
const getAuthStore = (): AuthStore => {
  const holder = globalThis as StoreHolder;
  const existing = holder[STORE_KEY];
  if (existing !== undefined) return existing;

  // The channels are checked against the bridge by name at call time; their payloads are
  // checked by the store itself, so the client needs no schema types here.
  const client = createClient<Contract>();
  const store = createAuthStore({
    invoke: (channel) => client.invoke(channel),
    on: (channel, listener) => client.on(channel, listener),
  });
  holder[STORE_KEY] = store;
  return store;
};

export default getAuthStore;
