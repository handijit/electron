// The React hook of the updater; the client comes from the renderer entry, so every component
// of the page shares one subscription.
import type { UpdateClient, UpdateState } from "@handijitcom/electron/renderer";

import useUpdate from "./update-react/use-update";
import type { UseUpdateResult } from "./update-react/use-update";

export { useUpdate };
export type { UpdateClient, UpdateState, UseUpdateResult };
