#!/bin/sh
# Build the presentation slides.
# Output: dist/ai-insights-slides.html
#
# Usage:
#   ./build.sh           -- single build
#   ./build.sh --watch   -- rebuild on source changes

cd "$(dirname "$0")" || exit 1
node tools/build.js "$@"
