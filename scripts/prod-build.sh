#!/bin/sh
set -e

# A leftover from an earlier build must never reach the tarball.
rm -rf build
rollup -c
node ./scripts/verify-build.mjs
