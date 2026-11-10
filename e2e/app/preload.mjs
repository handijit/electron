import { exposeBridge } from "@handijit/electron/preload";

import channels from "./channels.mjs";

exposeBridge(channels);
