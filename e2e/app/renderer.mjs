import {
  createClient,
  forwardErrors,
  getTheme,
  log,
  setThemePreference,
  syncTheme,
} from "@handijit/electron/renderer";

// The page's half of the smoke test. Main drives it through executeJavaScript and reads the
// answers; every function resolves with plain data.
const client = createClient();
const ticks = [];
client.on("clock:tick", (payload) => ticks.push(payload));
forwardErrors();

const settle = (promise) =>
  promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, message: String(error?.message ?? error) })
  );
const root = document.documentElement;

window.__smoke = {
  // Read before syncTheme runs: only the hashed inline boot script can have set it.
  bootTheme: root.getAttribute("data-theme"),
  inlineRan: window.__inlineRan === true,
  hasNode:
    typeof require !== "undefined" ||
    typeof process !== "undefined" ||
    typeof module !== "undefined" ||
    typeof Buffer !== "undefined",
  bridge: () => ({
    keys: Object.keys(window.desktop).sort(),
    invoke: Object.keys(window.desktop.invoke).sort(),
    on: Object.keys(window.desktop.on).sort(),
  }),
  add: (input) => settle(client.invoke("math:add", input)),
  info: () => settle(client.invoke("app:info")),
  ticks: () => ticks,
  codegen: () => {
    try {
      return new Function("return 1")();
    } catch (error) {
      return error.name;
    }
  },
  fetch: (url) =>
    fetch(url).then(
      async (response) => ({
        status: response.status,
        csp: response.headers.get("content-security-policy"),
        nosniff: response.headers.get("x-content-type-options"),
        body: (await response.text()).slice(0, 200),
      }),
      (error) => ({ error: String(error) })
    ),
  syncTheme: () => {
    syncTheme();
  },
  getTheme: () => settle(getTheme()),
  setTheme: (preference) => settle(setThemePreference(preference)),
  theme: () => ({
    attribute: root.getAttribute("data-theme"),
    prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
  }),
  log: (message, context) => log.warn(message, context),
  fail: (message) => {
    setTimeout(() => {
      throw new Error(message);
    }, 0);
  },
  open: (url) => window.open(url) === null,
  navigate: (url) => {
    location.href = url;
  },
};
