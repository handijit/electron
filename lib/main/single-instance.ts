import { app } from "electron";

/** What a second launch of the app hands over to the running one. */
type SecondInstance = {
  /** Command line of the second launch. Untrusted: anyone can start the app with any arguments. */
  readonly argv: readonly string[];
  /** Working directory of the second launch. */
  readonly workingDirectory: string;
};

/**
 * Takes the single-instance lock. Returns `false` when another instance already runs: the
 * caller must quit at once, and that instance receives this launch's command line instead.
 */
const acquireSingleInstance = (
  onSecondInstance: (launch: SecondInstance) => void
): boolean => {
  if (!app.requestSingleInstanceLock()) return false;
  app.on("second-instance", (_event, argv, workingDirectory) => {
    onSecondInstance({ argv, workingDirectory });
  });
  return true;
};

/**
 * Finds the first `<scheme>://…` argument of a command line: how Windows and Linux deliver a
 * deep link. The value is untrusted and still has to be validated by the app.
 */
const findDeepLink = (
  argv: readonly string[],
  scheme: string
): string | undefined => {
  const prefix = `${scheme.toLowerCase()}://`;
  return argv.find((argument) => argument.toLowerCase().startsWith(prefix));
};

export type { SecondInstance };
export { acquireSingleInstance, findDeepLink };
