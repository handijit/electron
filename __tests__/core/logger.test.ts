import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock(
  "electron",
  async () => (await import("../helpers/core-electron")).fakeElectron
);

import createLogger from "../../lib/main/logger";
import { fakeElectron, paths, resetElectron } from "../helpers/core-electron";

let directory: string;

beforeEach(async () => {
  resetElectron();
  directory = await mkdtemp(join(tmpdir(), "logger-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const linesOf = async (file = "main.log"): Promise<Record<string, unknown>[]> =>
  (await readFile(join(directory, file), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const quiet = (options: Parameters<typeof createLogger>[0] = {}) =>
  createLogger({ directory, mirrorToConsole: false, ...options });

describe("createLogger", () => {
  test("should write redacted JSON lines in order", async () => {
    const logger = quiet();
    logger.info("Signed in as a@b.co", { token: "t", count: 2 });
    logger.warn("plain");
    await logger.flush();
    const [first, second] = await linesOf();
    expect(first).toMatchObject({
      level: "info",
      scope: "main",
      message: "Signed in as ***@b.co",
      context: { token: "[REDACTED]", count: 2 },
    });
    expect(typeof first?.time).toBe("string");
    expect(second).toMatchObject({ level: "warn", message: "plain" });
    expect(second).not.toHaveProperty("context");
    expect(logger.directory).toBe(directory);
  });

  test("should drop lines below the level", async () => {
    const logger = quiet({ level: "warn" });
    logger.debug("d");
    logger.info("i");
    logger.error("e");
    await logger.flush();
    expect((await linesOf()).map((line) => line.message)).toEqual(["e"]);
  });

  test("should write every level for an unknown level setting", async () => {
    const logger = quiet({ level: "verbose" as never });
    logger.debug("d");
    await logger.flush();
    expect((await linesOf()).map((line) => line.level)).toEqual(["debug"]);
  });

  test("should write a child's lines to the same file under its scope", async () => {
    const logger = quiet({ fileName: "app.log" });
    const child = logger.child("updater");
    child.error("failed");
    child.child("engine").debug("ignored at info");
    await child.flush();
    expect(await linesOf("app.log")).toEqual([
      expect.objectContaining({ scope: "updater", message: "failed" }),
    ]);
  });

  test("should rotate by size and keep the given number of files", async () => {
    const logger = quiet({ maxFileBytes: 1024, maxFiles: 2 });
    for (let i = 0; i < 40; i++) logger.info(`line ${i} ${"x".repeat(80)}`);
    await logger.flush();
    expect((await readdir(directory)).sort()).toEqual([
      "main.log",
      "main.log.1",
      "main.log.2",
    ]);
    const last = await linesOf();
    expect(last.at(-1)?.message).toMatch(/^line 39 /);
  });

  test("should start a new file without keeping one for maxFiles 0", async () => {
    const logger = quiet({ maxFileBytes: 1024, maxFiles: 0 });
    for (let i = 0; i < 20; i++) logger.info("x".repeat(100));
    await logger.flush();
    expect(await readdir(directory)).toEqual(["main.log"]);
  });

  test("should count an existing file towards the size", async () => {
    await writeFile(join(directory, "main.log"), `${"x".repeat(1100)}\n`);
    const logger = quiet({ maxFileBytes: 1024 });
    logger.info("after");
    await logger.flush();
    expect((await readdir(directory)).sort()).toEqual([
      "main.log",
      "main.log.1",
    ]);
  });

  test("should fall back to the defaults for out-of-range settings", async () => {
    const logger = quiet({
      maxFileBytes: 10,
      maxFiles: Number.POSITIVE_INFINITY,
    });
    for (let i = 0; i < 20; i++) logger.info("x".repeat(100));
    await logger.flush();
    // 1 MiB is far away: nothing rotated.
    expect(await readdir(directory)).toEqual(["main.log"]);
  });

  test("should never throw into the code that logs when the disk fails", async () => {
    const blocked = join(directory, "file");
    await writeFile(blocked, "");
    const logger = createLogger({
      directory: join(blocked, "logs"),
      mirrorToConsole: false,
    });
    expect(() => logger.error("lost")).not.toThrow();
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  test("should drop lines beyond the queue bound and say so afterwards", async () => {
    const logger = quiet();
    for (let i = 0; i < 1005; i++) logger.info(`line ${i}`);
    await logger.flush();
    logger.info("after");
    await logger.flush();
    const lines = await linesOf();
    expect(lines).toHaveLength(1002);
    expect(lines.at(-2)).toMatchObject({
      level: "error",
      scope: "logger",
      message: "Dropped 5 log lines: the disk is too slow",
    });
    expect(lines.at(-1)?.message).toBe("after");
  });

  test("should mirror to the terminal in an unpackaged app by default", async () => {
    paths.logs = directory;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const logger = createLogger();
    logger.info("hello");
    await logger.flush();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"hello"'));
    expect(await readdir(directory)).toEqual(["main.log"]);
  });

  test("should stay silent in a packaged app", async () => {
    fakeElectron.app.isPackaged = true;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const logger = createLogger({ directory });
    logger.info("hello");
    await logger.flush();
    expect(info).not.toHaveBeenCalled();
  });
});
