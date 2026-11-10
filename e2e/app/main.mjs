import * as design from "@handijit/design";
import * as shared from "@handijit/electron";
import * as core from "@handijit/electron/main";
import { z } from "zod";

import run from "./scenario.cjs";

// The ES module build of the package, resolved through its "exports" map.
run({ core, shared, design, z });
