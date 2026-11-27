import { describe, expect, test, vi } from "vitest";

import { listPrinters, printSilently } from "../../lib/main/print";
import { createWebContents } from "../helpers/core-electron";

vi.mock("electron", () => ({}));

const PRINTERS = [{ name: "Zebra_ZD420" }, { name: "Office" }];

const contents = () => {
  const webContents = createWebContents();
  webContents.getPrintersAsync.mockResolvedValue(PRINTERS);
  return webContents;
};

type PrintCallback = (isPrinted: boolean, failureReason: string) => void;

const answer = (
  webContents: ReturnType<typeof createWebContents>,
  isPrinted: boolean,
  failureReason = ""
): void => {
  webContents.print.mockImplementation(
    (_options: unknown, callback: PrintCallback) =>
      callback(isPrinted, failureReason)
  );
};

describe("listPrinters", () => {
  test("should list the printers of the window's print system", async () => {
    await expect(listPrinters(contents() as never)).resolves.toEqual(PRINTERS);
  });

  test("should list nothing when the window is gone", async () => {
    const webContents = contents();
    webContents.destroyed = true;
    await expect(listPrinters(webContents as never)).resolves.toEqual([]);
    expect(webContents.getPrintersAsync).not.toHaveBeenCalled();
  });
});

describe("printSilently", () => {
  test("should print silently on the named printer with label-friendly defaults", async () => {
    const webContents = contents();
    answer(webContents, true);
    await expect(
      printSilently(webContents as never, { deviceName: "Zebra_ZD420" })
    ).resolves.toEqual({ ok: true });
    expect(webContents.print.mock.calls[0]?.[0]).toEqual({
      silent: true,
      deviceName: "Zebra_ZD420",
      landscape: false,
      copies: 1,
      printBackground: true,
    });
  });

  test("should pass the page size, margins, scale and the other options", async () => {
    const webContents = contents();
    answer(webContents, true);
    await printSilently(webContents as never, {
      deviceName: "Zebra_ZD420",
      pageSize: { width: 100000, height: 50000 },
      margins: { marginType: "none" },
      landscape: true,
      copies: 3,
      scaleFactor: 90,
      printBackground: false,
    });
    expect(webContents.print.mock.calls[0]?.[0]).toEqual({
      silent: true,
      deviceName: "Zebra_ZD420",
      landscape: true,
      copies: 3,
      printBackground: false,
      pageSize: { width: 100000, height: 50000 },
      margins: { marginType: "none" },
      scaleFactor: 90,
    });
  });

  test("should report a printer that is not installed instead of using the default one", async () => {
    const webContents = contents();
    await expect(
      printSilently(webContents as never, { deviceName: "Unplugged" })
    ).resolves.toEqual({
      ok: false,
      reason: "printer-not-found",
      detail: 'no printer named "Unplugged"',
    });
    expect(webContents.print).not.toHaveBeenCalled();
  });

  test("should report a window that is gone", async () => {
    const webContents = contents();
    webContents.isDestroyed.mockReturnValueOnce(false).mockReturnValue(true);
    await expect(
      printSilently(webContents as never, { deviceName: "Zebra_ZD420" })
    ).resolves.toEqual({
      ok: false,
      reason: "destroyed",
      detail: "the window is gone",
    });
  });

  test("should tell a cancelled job from a failed one", async () => {
    const cancelled = contents();
    answer(cancelled, false, "cancelled");
    await expect(
      printSilently(cancelled as never, { deviceName: "Office" })
    ).resolves.toEqual({ ok: false, reason: "cancelled", detail: "cancelled" });

    const failed = contents();
    answer(failed, false, "Printer is offline");
    await expect(
      printSilently(failed as never, { deviceName: "Office" })
    ).resolves.toEqual({
      ok: false,
      reason: "failed",
      detail: "Printer is offline",
    });
  });

  test.each([[""], ["   "], [undefined], [42]])(
    "should throw for a device name that is not a name: %j",
    async (deviceName) => {
      await expect(
        printSilently(contents() as never, { deviceName } as never)
      ).rejects.toThrow(TypeError);
    }
  );

  test.each([[0], [1.5], [Number.NaN]])(
    "should throw for copies that is not a count: %s",
    async (copies) => {
      await expect(
        printSilently(contents() as never, { deviceName: "Office", copies })
      ).rejects.toThrow(/copies must be a whole number/);
    }
  );
});
