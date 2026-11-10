"use strict";

const design = require("@handijit/design");
const shared = require("@handijit/electron");
const core = require("@handijit/electron/main");
const { z } = require("zod");

const run = require("./scenario.cjs");

// The CommonJS build of the package, resolved through its "exports" map.
run({ core, shared, design, z });
