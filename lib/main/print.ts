import type {
  PrinterInfo,
  WebContents,
  WebContentsPrintOptions,
} from "electron";

/** How a silent print job is laid out. The printer is required: a label never goes to "whatever is default". */
type PrintSilentlyOptions = {
  /** The printer's system name, as `listPrinters` reports it in `name`. */
  deviceName: string;
  /** A named size (`"A4"`) or the label's size in microns, like `{ width: 100000, height: 50000 }`. */
  pageSize?: WebContentsPrintOptions["pageSize"];
  /** Margins; a label printer usually wants `{ marginType: "none" }`. Default: the printer's. */
  margins?: WebContentsPrintOptions["margins"];
  /** Print in landscape. Default: `false`. */
  landscape?: boolean;
  /** How many copies. Default: 1. */
  copies?: number;
  /** Scale of the page, in percent. Default: the printer's. */
  scaleFactor?: number;
  /** Print background colours and images. Default: `true`: labels draw boxes and bars with them. */
  printBackground?: boolean;
};

/** Why a silent print did not happen. */
type PrintFailureReason =
  /** No printer of that name is installed (it was renamed, unplugged or never set up). */
  | "printer-not-found"
  /** The window is gone. */
  | "destroyed"
  /** The print system cancelled the job. */
  | "cancelled"
  /** The print system refused the job. */
  | "failed";

/** The outcome of a silent print: expected failures are an answer, not an exception. */
type PrintResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: PrintFailureReason;
      /** What the print system said, for the log. */
      readonly detail: string;
    };

/**
 * The printers installed on this computer, as the window's print system sees them. An empty
 * list when the window is gone.
 */
const listPrinters = async (
  webContents: WebContents
): Promise<PrinterInfo[]> =>
  webContents.isDestroyed() ? [] : webContents.getPrintersAsync();

const failure = (reason: PrintFailureReason, detail: string): PrintResult => ({
  ok: false,
  reason,
  detail,
});

/**
 * Prints the window's page on one printer without a dialog: label and receipt printers. The
 * printer must exist by name, so a renamed or unplugged label printer is reported instead of
 * Electron falling back to the default printer. Resolves with the outcome; rejects only for a
 * programming error (a `deviceName` that is not a name, a `copies` that is not a count).
 */
const printSilently = async (
  webContents: WebContents,
  {
    deviceName,
    pageSize,
    margins,
    landscape = false,
    copies = 1,
    scaleFactor,
    printBackground = true,
  }: PrintSilentlyOptions
): Promise<PrintResult> => {
  if (typeof deviceName !== "string" || deviceName.trim() === "") {
    throw new TypeError(
      `printSilently: deviceName must be a printer's name from listPrinters(), received ${JSON.stringify(deviceName)}`
    );
  }
  if (!Number.isInteger(copies) || copies < 1) {
    throw new TypeError(
      `printSilently: copies must be a whole number of at least 1, received ${String(copies)}`
    );
  }

  const printers = await listPrinters(webContents);
  if (webContents.isDestroyed()) {
    return failure("destroyed", "the window is gone");
  }
  if (!printers.some((printer) => printer.name === deviceName)) {
    return failure(
      "printer-not-found",
      `no printer named ${JSON.stringify(deviceName)}`
    );
  }

  const options: WebContentsPrintOptions = {
    silent: true,
    deviceName,
    landscape,
    copies,
    printBackground,
    ...(pageSize === undefined ? {} : { pageSize }),
    ...(margins === undefined ? {} : { margins }),
    ...(scaleFactor === undefined ? {} : { scaleFactor }),
  };

  return new Promise<PrintResult>((resolve) => {
    webContents.print(options, (isPrinted, failureReason) => {
      if (isPrinted) {
        resolve({ ok: true });
        return;
      }
      resolve(
        failure(
          failureReason === "cancelled" ? "cancelled" : "failed",
          failureReason
        )
      );
    });
  });
};

export type { PrintFailureReason, PrintResult, PrintSilentlyOptions };
export { listPrinters, printSilently };
