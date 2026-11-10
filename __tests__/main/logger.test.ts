import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import createLogger from "../../lib/main/logger";

const mocks = vi.hoisted(() => ({
  app: { isPackaged: false, getPath: vi.fn<(name: string) => string>() },
}));

vi.mock("electron", () => ({ app: mocks.app }));

type Line = {
  time: string;
  level: string;
  scope: string;
  message: string;
  context?: unknown;
};

const NOW = new Date("2026-01-02T03:04:05.678Z");
const LEVELS = ["debug", "info", "warn", "error"] as const;

let root: string;
let directory: string;
let file: string;

const readLines = (path = file): Line[] =>
  readFileSync(path, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Line);

const messagesIn = (path: string): string[] =>
  readLines(path).map(({ message }) => message.split(" ")[0] ?? "");

/** A message that makes every line a little under 300 bytes: three fit in 1024 bytes, four do not. */
const padded = (index: number): string => `line-${index} ${"x".repeat(200)}`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hd-electron-logger-"));
  directory = join(root, "logs");
  file = join(directory, "main.log");
  mocks.app.isPackaged = true;
  mocks.app.getPath.mockReset().mockReturnValue(directory);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("createLogger", () => {
  describe("writing", () => {
    test("should write one JSON line per call with time, level, scope, message and context", async () => {
      const logger = createLogger({ directory });

      logger.info("Window opened", { width: 1200, tags: ["a", "b"] });
      logger.error("Sync failed");
      await logger.flush();

      expect(readFileSync(file, "utf8")).toBe(
        '{"time":"2026-01-02T03:04:05.678Z","level":"info","scope":"main","message":"Window opened","context":{"width":1200,"tags":["a","b"]}}\n' +
          '{"time":"2026-01-02T03:04:05.678Z","level":"error","scope":"main","message":"Sync failed"}\n'
      );
    });

    test("should write to main.log in the app's log folder unless told otherwise", async () => {
      const byDefault = createLogger();
      byDefault.info("default place");
      await byDefault.flush();

      expect(mocks.app.getPath).toHaveBeenCalledExactlyOnceWith("logs");
      expect(byDefault.directory).toBe(directory);
      expect(readLines(join(directory, "main.log"))).toHaveLength(1);

      mocks.app.getPath.mockClear();
      const elsewhere = join(root, "deep", "elsewhere");
      const custom = createLogger({
        directory: elsewhere,
        fileName: "updater.log",
      });
      custom.info("custom place");
      await custom.flush();

      expect(mocks.app.getPath).not.toHaveBeenCalled();
      expect(custom.directory).toBe(elsewhere);
      expect(readdirSync(elsewhere)).toEqual(["updater.log"]);
    });

    test.skipIf(process.platform === "win32")(
      "should keep the log file private to the user",
      async () => {
        const logger = createLogger({ directory });

        logger.info("private");
        await logger.flush();

        expect(statSync(file).mode & 0o777).toBe(0o600);
      }
    );

    test("should keep the lines in the order they were logged", async () => {
      const logger = createLogger({ directory });

      for (let index = 0; index < 200; index += 1) logger.info(`line-${index}`);
      await logger.flush();

      expect(readLines().map(({ message }) => message)).toEqual(
        Array.from({ length: 200 }, (_, index) => `line-${index}`)
      );
    });

    test("should stamp each line with the time it was logged, not written", async () => {
      const logger = createLogger({ directory });

      logger.info("first");
      vi.setSystemTime(new Date("2026-01-02T03:04:06.000Z"));
      logger.info("second");
      await logger.flush();

      expect(readLines().map(({ time }) => time)).toEqual([
        "2026-01-02T03:04:05.678Z",
        "2026-01-02T03:04:06.000Z",
      ]);
    });

    test("should resolve flush at once when nothing was logged", async () => {
      const logger = createLogger({ directory });

      await expect(logger.flush()).resolves.toBeUndefined();
      expect(existsSync(directory)).toBe(false);
    });

    test("should append to the file of an earlier run", async () => {
      const first = createLogger({ directory });
      first.info("yesterday");
      await first.flush();

      const second = createLogger({ directory });
      second.info("today");
      await second.flush();

      expect(readLines().map(({ message }) => message)).toEqual([
        "yesterday",
        "today",
      ]);
    });
  });

  describe("levels", () => {
    const logAll = async (
      options: Parameters<typeof createLogger>[0]
    ): Promise<string[]> => {
      const logger = createLogger({ directory, ...options });
      for (const level of LEVELS) logger[level](`a ${level} line`);
      await logger.flush();
      return existsSync(file) ? readLines().map(({ level }) => level) : [];
    };

    test("sentinel: should drop debug lines by default", async () => {
      expect(await logAll({})).toEqual(["info", "warn", "error"]);
    });

    test.each([
      ["debug", ["debug", "info", "warn", "error"]],
      ["info", ["info", "warn", "error"]],
      ["warn", ["warn", "error"]],
      ["error", ["error"]],
    ] as const)(
      "sentinel: should write only %s and above when that is the level",
      async (level, written) => {
        expect(await logAll({ level })).toEqual(written);
      }
    );

    test("should write everything when the level is not one it knows", async () => {
      expect(
        // @ts-expect-error -- a level from a configuration file that the types cannot vouch for
        await logAll({ level: "verbose" })
      ).toEqual(["debug", "info", "warn", "error"]);
    });

    test("should not print a line the level filtered out", async () => {
      const debug = vi.spyOn(console, "debug").mockReturnValue();

      await logAll({ level: "info", mirrorToConsole: true });

      expect(debug).not.toHaveBeenCalled();
    });
  });

  describe("child", () => {
    test("should write to the same file under its own scope, in order", async () => {
      const logger = createLogger({ directory });
      const updater = logger.child("updater");
      const download = updater.child("download");

      logger.info("one");
      updater.warn("two", { version: "1.2.3" });
      download.error("three");
      logger.info("four");
      await download.flush();

      expect(
        readLines().map(({ scope, level, message }) => [scope, level, message])
      ).toEqual([
        ["main", "info", "one"],
        ["updater", "warn", "two"],
        ["download", "error", "three"],
        ["main", "info", "four"],
      ]);
      expect(updater.directory).toBe(directory);
      expect(readdirSync(directory)).toEqual(["main.log"]);
    });

    test("should follow the level and the redaction of its parent", async () => {
      const logger = createLogger({ directory, level: "warn" });
      const child = logger.child("renderer");

      child.info("dropped");
      child.warn("kept", { password: "hunter2" });
      await logger.flush();

      expect(readLines()).toEqual([
        {
          time: NOW.toISOString(),
          level: "warn",
          scope: "renderer",
          message: "kept",
          context: { password: "[REDACTED]" },
        },
      ]);
    });
  });

  describe("redaction", () => {
    const SECRETS = [
      "hunter2",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
      "s3cr3t-bearer",
      "ada.lovelace",
      "oauth-code-123",
      "TR330006100519786457841326",
    ];

    test("sentinel: should pass every message and every context value through the redactor", async () => {
      const log = vi.spyOn(console, "error").mockReturnValue();
      const logger = createLogger({
        directory,
        level: "debug",
        redactKeys: ["iban"],
        mirrorToConsole: true,
      });
      vi.spyOn(console, "debug").mockReturnValue();
      vi.spyOn(console, "info").mockReturnValue();
      vi.spyOn(console, "warn").mockReturnValue();

      for (const level of LEVELS) {
        logger
          .child("auth")
          [level](
            `Login of ada.lovelace@example.com failed with Bearer s3cr3t-bearer at https://id.test/cb?code=oauth-code-123`,
            {
              password: "hunter2",
              iban: "TR330006100519786457841326",
              nested: { token: SECRETS[1], note: `jwt ${SECRETS[1]}` },
              error: new Error("refused for ada.lovelace@example.com"),
            }
          );
      }
      await logger.flush();

      const written = readFileSync(file, "utf8");
      const printed = log.mock.calls.map(([line]) => String(line)).join("\n");
      for (const secret of SECRETS) {
        expect(written, secret).not.toContain(secret);
        expect(printed, secret).not.toContain(secret);
      }
      const [first] = readLines();
      expect(readLines()).toHaveLength(4);
      expect(first?.message).toBe(
        "Login of ***@example.com failed with Bearer [REDACTED] at https://id.test/cb?code=[REDACTED]"
      );
      expect(first?.context).toMatchObject({
        password: "[REDACTED]",
        iban: "[REDACTED]",
        nested: { token: "[REDACTED]", note: "jwt [REDACTED]" },
        error: { name: "Error", message: "refused for ***@example.com" },
      });
    });

    test("should leave a key alone that only the extra keys of another logger name", async () => {
      const logger = createLogger({ directory });

      logger.info("payment", { iban: "TR33" });
      await logger.flush();

      expect(readLines()[0]?.context).toEqual({ iban: "TR33" });
    });

    test("sentinel: should take a context that JSON cannot carry without throwing into the caller", async () => {
      const logger = createLogger({ directory });
      const cyclic: Record<string, unknown> = { big: 10n ** 20n };
      cyclic.self = cyclic;
      const hostile = {
        get value(): string {
          throw new Error("no");
        },
      };

      expect(() =>
        logger.info("odd context", { cyclic, hostile, run: () => 1 })
      ).not.toThrow();
      await logger.flush();

      expect(readLines()[0]?.context).toEqual({
        cyclic: { big: "100000000000000000000", self: "[Circular]" },
        hostile: "[Unreadable]",
        run: "[function]",
      });
    });
  });

  describe("console mirror", () => {
    test("should print each line with the console method of its level, redacted", async () => {
      const spies = LEVELS.map((level) =>
        vi.spyOn(console, level).mockReturnValue()
      );
      const logger = createLogger({
        directory,
        level: "debug",
        mirrorToConsole: true,
      });

      for (const level of LEVELS)
        logger[level](`${level} token=x`, { token: "t" });
      await logger.flush();

      LEVELS.forEach((level, index) => {
        expect(spies[index]).toHaveBeenCalledExactlyOnceWith(
          `{"time":"${NOW.toISOString()}","level":"${level}","scope":"main","message":"${level} token=x","context":{"token":"[REDACTED]"}}`
        );
      });
      expect(readLines()).toHaveLength(4);
    });

    test("should print by default in an unpackaged app only", async () => {
      const info = vi.spyOn(console, "info").mockReturnValue();

      mocks.app.isPackaged = false;
      createLogger({ directory }).info("development");
      expect(info).toHaveBeenCalledTimes(1);

      info.mockClear();
      mocks.app.isPackaged = true;
      const packaged = createLogger({ directory });
      packaged.info("production");
      expect(info).not.toHaveBeenCalled();

      await packaged.flush();
    });

    test("should let the option overrule the default both ways", async () => {
      const info = vi.spyOn(console, "info").mockReturnValue();

      mocks.app.isPackaged = false;
      const quiet = createLogger({ directory, mirrorToConsole: false });
      quiet.info("quiet");
      expect(info).not.toHaveBeenCalled();

      mocks.app.isPackaged = true;
      const loud = createLogger({ directory, mirrorToConsole: true });
      loud.info("loud");
      expect(info).toHaveBeenCalledTimes(1);

      await quiet.flush();
      await loud.flush();
    });
  });

  describe("a failing disk", () => {
    test("sentinel: should never throw into the caller when the log folder cannot be created", async () => {
      writeFileSync(directory, "a file where the log folder should be");
      const logger = createLogger({ directory });

      expect(() => {
        for (const level of LEVELS) logger[level]("lost");
        logger.child("scope").error("lost too", { reason: "disk" });
      }).not.toThrow();
      await expect(logger.flush()).resolves.toBeUndefined();

      expect(readFileSync(directory, "utf8")).toBe(
        "a file where the log folder should be"
      );
    });

    test("sentinel: should never throw into the caller when the file cannot be appended to", async () => {
      // A folder where the file should be: every append fails.
      mkdirSync(file, { recursive: true });
      const logger = createLogger({ directory });

      expect(() => logger.error("lost")).not.toThrow();
      await expect(logger.flush()).resolves.toBeUndefined();
      expect(() => logger.error("lost as well")).not.toThrow();
      await expect(logger.flush()).resolves.toBeUndefined();

      expect(readdirSync(file)).toEqual([]);
    });

    test("should write again as soon as the disk allows it", async () => {
      writeFileSync(directory, "in the way");
      const logger = createLogger({ directory });
      logger.info("lost");
      await logger.flush();

      rmSync(directory);
      logger.info("written");
      await logger.flush();

      expect(readLines().map(({ message }) => message)).toEqual(["written"]);
    });

    test("should drop lines beyond 1000 that wait for the disk, and say so afterwards", async () => {
      const logger = createLogger({ directory });

      // Nothing reaches the disk while this loop runs, so the queue fills up.
      for (let index = 0; index < 1005; index += 1)
        logger.info(`line-${index}`);
      await logger.flush();
      logger.info("after the stall");
      await logger.flush();

      const lines = readLines();
      expect(lines).toHaveLength(1002);
      expect(lines[999]?.message).toBe("line-999");
      expect(lines[1000]).toEqual({
        time: NOW.toISOString(),
        level: "error",
        scope: "logger",
        message: "Dropped 5 log lines: the disk is too slow",
      });
      expect(lines[1001]?.message).toBe("after the stall");

      // The loss is reported once.
      logger.info("later");
      await logger.flush();
      expect(readLines()).toHaveLength(1003);
    });

    test("sentinel: should say that lines were dropped even when only errors are written", async () => {
      const logger = createLogger({ directory, level: "error" });

      for (let index = 0; index < 1003; index += 1) {
        logger.error(`failure-${index}`);
      }
      await logger.flush();
      // A line below the level neither is written nor uses the notice up.
      logger.warn("filtered out");
      logger.error("after the stall");
      await logger.flush();

      // The strictest level there is must not filter the notice out.
      expect(
        readLines()
          .slice(1000)
          .map(({ level, scope, message }) => [level, scope, message])
      ).toEqual([
        ["error", "logger", "Dropped 3 log lines: the disk is too slow"],
        ["error", "main", "after the stall"],
      ]);
    });
  });

  describe("rotation", () => {
    test("sentinel: should rotate at the size limit and keep at most maxFiles old files", async () => {
      const logger = createLogger({
        directory,
        maxFileBytes: 1024,
        maxFiles: 2,
      });

      for (let index = 0; index <= 10; index += 1) logger.info(padded(index));
      await logger.flush();

      expect(readdirSync(directory).sort()).toEqual([
        "main.log",
        "main.log.1",
        "main.log.2",
      ]);
      // Newest in the current file, older ones behind it, the oldest three gone.
      expect(messagesIn(file)).toEqual(["line-9", "line-10"]);
      expect(messagesIn(`${file}.1`)).toEqual(["line-6", "line-7", "line-8"]);
      expect(messagesIn(`${file}.2`)).toEqual(["line-3", "line-4", "line-5"]);
      for (const name of readdirSync(directory)) {
        expect(statSync(join(directory, name)).size, name).toBeLessThanOrEqual(
          1024
        );
      }
    });

    test("sentinel: should never keep more than maxFiles old files however much is logged", async () => {
      const logger = createLogger({
        directory,
        maxFileBytes: 1024,
        maxFiles: 1,
      });

      for (let index = 0; index < 40; index += 1) logger.info(padded(index));
      await logger.flush();

      expect(readdirSync(directory).sort()).toEqual(["main.log", "main.log.1"]);
      expect(messagesIn(file)).toEqual(["line-39"]);
      expect(messagesIn(`${file}.1`)).toEqual([
        "line-36",
        "line-37",
        "line-38",
      ]);
    });

    test("should keep no old file at all when maxFiles is 0", async () => {
      const logger = createLogger({
        directory,
        maxFileBytes: 1024,
        maxFiles: 0,
      });

      for (let index = 0; index <= 7; index += 1) logger.info(padded(index));
      await logger.flush();

      expect(readdirSync(directory)).toEqual(["main.log"]);
      expect(messagesIn(file)).toEqual(["line-6", "line-7"]);
    });

    test("should count the size of the file an earlier run left behind", async () => {
      mkdirSync(directory);
      writeFileSync(file, `${"o".repeat(1000)}\n`);
      const logger = createLogger({
        directory,
        maxFileBytes: 1024,
        maxFiles: 2,
      });

      logger.info("first line of this run");
      await logger.flush();

      expect(readFileSync(`${file}.1`, "utf8")).toBe(`${"o".repeat(1000)}\n`);
      expect(readLines().map(({ message }) => message)).toEqual([
        "first line of this run",
      ]);
    });

    test("should write a line larger than the limit into an empty file instead of rotating forever", async () => {
      const logger = createLogger({
        directory,
        maxFileBytes: 1024,
        maxFiles: 2,
      });

      logger.info("big", { blob: "z".repeat(3000) });
      await logger.flush();

      expect(readdirSync(directory)).toEqual(["main.log"]);
      expect(statSync(file).size).toBeGreaterThan(3000);

      logger.info("small");
      await logger.flush();

      expect(readdirSync(directory).sort()).toEqual(["main.log", "main.log.1"]);
      expect(readLines().map(({ message }) => message)).toEqual(["small"]);
    });

    test("should count bytes, not characters", async () => {
      const logger = createLogger({
        directory,
        maxFileBytes: 1024,
        maxFiles: 1,
      });

      // 300 three-byte characters: over 900 bytes a line, so the second line must rotate.
      logger.info("€".repeat(300));
      logger.info("€".repeat(300));
      await logger.flush();

      expect(readdirSync(directory).sort()).toEqual(["main.log", "main.log.1"]);
    });

    test("should round a fractional limit down", async () => {
      const logger = createLogger({
        directory,
        maxFileBytes: 1024.9,
        maxFiles: 1.9,
      });

      for (let index = 0; index <= 10; index += 1) logger.info(padded(index));
      await logger.flush();

      expect(readdirSync(directory).sort()).toEqual(["main.log", "main.log.1"]);
      expect(messagesIn(file)).toEqual(["line-9", "line-10"]);
    });

    test.each([
      ["too small", 100, -1],
      ["not a number", Number.NaN, Number.NaN],
    ])(
      "should fall back to 1 MiB and 3 old files when the limits are %s",
      async (_label, maxFileBytes, maxFiles) => {
        mkdirSync(directory);
        // One byte short of 1 MiB once the first line is added: no rotation yet.
        const logger = createLogger({ directory, maxFileBytes, maxFiles });
        logger.info("probe");
        await logger.flush();
        const lineBytes = statSync(file).size;
        writeFileSync(file, "o".repeat(1_048_576 - lineBytes));

        const reopened = createLogger({ directory, maxFileBytes, maxFiles });
        reopened.info("probe");
        await reopened.flush();
        expect(readdirSync(directory)).toEqual(["main.log"]);
        expect(statSync(file).size).toBe(1_048_576);

        // From here every line rotates the full file; five rotations leave three old files.
        for (let round = 0; round < 5; round += 1) {
          writeFileSync(file, "o".repeat(1_048_576));
          const next = createLogger({ directory, maxFileBytes, maxFiles });
          next.info("probe");
          await next.flush();
        }
        expect(readdirSync(directory).sort()).toEqual([
          "main.log",
          "main.log.1",
          "main.log.2",
          "main.log.3",
        ]);
      },
      10_000
    );

    test("should keep 3 old files, and keep writing, when maxFiles is not finite", async () => {
      const logger = createLogger({
        directory,
        maxFileBytes: 1024,
        maxFiles: Number.POSITIVE_INFINITY,
      });

      // Shifting an endless number of old files would never finish: the first rotation
      // would stall every later line and `flush` with it.
      for (let index = 0; index <= 19; index += 1) logger.info(padded(index));
      await logger.flush();

      expect(readdirSync(directory).sort()).toEqual([
        "main.log",
        "main.log.1",
        "main.log.2",
        "main.log.3",
      ]);
      expect(messagesIn(file)).toEqual(["line-18", "line-19"]);
      expect(messagesIn(`${file}.3`)).toEqual(["line-9", "line-10", "line-11"]);
    }, 3000);
  });
});
