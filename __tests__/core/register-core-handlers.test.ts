import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);

import {
  CORE_CONTRACT,
  themePreferenceSchema,
} from "../../lib/main/core-contract";
import type { Logger } from "../../lib/main/logger";
import registerCoreHandlers from "../../lib/main/register-core-handlers";
import type { ThemeBridge } from "../../lib/main/theme-bridge";
import type { UrlPolicy } from "../../lib/main/url-policy";
import type { ThemeState } from "../../lib/types";
import { CORE_CHANNELS } from "../../lib/shared/core-channels.constants";
import {
  allContents,
  createWebContents,
  handlers,
  resetElectron,
} from "../helpers/core-electron";

const policy: UrlPolicy = {
  devServerUrl: undefined,
  isTrustedAppUrl: (url) => url.startsWith("app://bundle/"),
  isAllowedExternalUrl: () => false,
};

const DARK: ThemeState = { preference: "dark", resolved: "dark" };
const fromApp = { senderFrame: { url: "app://bundle/" } };

const fakeLogger = () => {
  const renderer = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const logger = { child: vi.fn(() => renderer) } as unknown as Logger;
  return { logger, renderer };
};

const fakeTheme = () => {
  const listeners = new Set<(state: ThemeState) => void>();
  const theme = {
    getState: vi.fn(() => DARK),
    setPreference: vi.fn(async () => DARK),
    reapply: vi.fn(),
    onChange: vi.fn((listener: (state: ThemeState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    dispose: vi.fn(),
  } as unknown as ThemeBridge;
  return { theme, listeners };
};

const call = (channel: string, input?: unknown): Promise<unknown> =>
  Promise.resolve(
    (handlers.get(channel) as (...args: unknown[]) => unknown)(fromApp, input)
  );

beforeEach(() => {
  resetElectron();
});

describe("CORE_CONTRACT", () => {
  test("should have exactly the channels the preload exposes", () => {
    expect(Object.keys(CORE_CONTRACT.invoke).sort()).toEqual(
      Object.keys(CORE_CHANNELS.invoke).sort()
    );
    expect(Object.keys(CORE_CONTRACT.events)).toEqual(
      Object.keys(CORE_CHANNELS.events)
    );
  });

  test("should accept the three theme preferences only", () => {
    expect(themePreferenceSchema.options).toEqual(["system", "light", "dark"]);
  });

  test("should cap what a renderer may log", () => {
    const schema = CORE_CONTRACT.invoke["core-log:write"].input;
    expect(
      schema.safeParse({ level: "info", message: "x".repeat(4000) }).success
    ).toBe(true);
    expect(
      schema.safeParse({ level: "info", message: "x".repeat(4001) }).success
    ).toBe(false);
    expect(schema.safeParse({ level: "trace", message: "x" }).success).toBe(
      false
    );
  });
});

describe("registerCoreHandlers", () => {
  test("should write renderer lines under the renderer scope", async () => {
    const { logger, renderer } = fakeLogger();
    registerCoreHandlers({ policy, logger, theme: fakeTheme().theme });
    expect(logger.child).toHaveBeenCalledWith("renderer");
    await call("core-log:write", {
      level: "warn",
      message: "slow",
      context: { ms: 900 },
    });
    expect(renderer.warn).toHaveBeenCalledWith("slow", { ms: 900 });
  });

  test("should answer and change the theme", async () => {
    const { theme } = fakeTheme();
    registerCoreHandlers({ policy, logger: fakeLogger().logger, theme });
    await expect(call("core-theme:get")).resolves.toEqual(DARK);
    await expect(call("core-theme:set", "dark")).resolves.toEqual(DARK);
    expect(theme.setPreference).toHaveBeenCalledWith("dark");
  });

  test("should broadcast theme changes until it is removed", () => {
    const { theme, listeners } = fakeTheme();
    const page = createWebContents();
    allContents.push(page);
    const stop = registerCoreHandlers({
      policy,
      logger: fakeLogger().logger,
      theme,
    });
    for (const listener of listeners) listener(DARK);
    expect(page.send).toHaveBeenCalledWith("core-theme:changed", DARK);

    stop();
    expect(listeners.size).toBe(0);
    expect(handlers.size).toBe(0);
  });
});
