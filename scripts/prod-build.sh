#!/bin/sh
set -e

# A leftover from an earlier build must never reach the tarball.
rm -rf build
rollup -c
# Each entry has to stay loadable in the process it is meant for.
node ./scripts/verify-build.mjs
