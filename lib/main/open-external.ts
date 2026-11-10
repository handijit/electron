import { shell } from "electron";

import type { UrlPolicy } from "./url-policy";

/**
 * Opens a link in the system browser when the policy allows it. Resolves with whether it was
 * opened; a refused or failing link never throws, because the URL is untrusted input.
 */
const openExternal = async (
  url: string,
  policy: UrlPolicy
): Promise<boolean> => {
  if (!policy.isAllowedExternalUrl(url)) return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
};

export default openExternal;
