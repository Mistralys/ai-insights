#!/bin/sh
# orchestrator/run.sh — Pre-flight dist freshness guard + orchestrate launcher.
#
# Checks whether mcp-server/dist/ is up to date relative to mcp-server/src/.
# Rebuilds via `npm run build` when source is newer than the compiled output
# (or when dist/ does not yet exist), then delegates to the `orchestrate` CLI
# with all supplied arguments.
#
# Usage (from the workspace root):
#   ./orchestrator/run.sh [orchestrate options…]
#   ./orchestrator/run.sh path/to/plan.md --dry-run
#
# Make executable once with:
#   chmod +x orchestrator/run.sh

set -e

# ---------------------------------------------------------------------------
# 1. Locate workspace root (parent of this script's own directory)
# ---------------------------------------------------------------------------
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
WORKSPACE_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

MCP_SRC="$WORKSPACE_ROOT/mcp-server/src"
MCP_DIST="$WORKSPACE_ROOT/mcp-server/dist"
MCP_DIST_SENTINEL="$MCP_DIST/index.js"

# ---------------------------------------------------------------------------
# 2. Determine whether a rebuild is needed
#    Strategy: use dist/index.js as the build sentinel.
#    - If it does not exist → first run or clean checkout → build.
#    - If any src/ file is newer than dist/index.js → source changed → build.
#    POSIX-portable: uses only `find -newer` (no stat -c / stat -f).
# ---------------------------------------------------------------------------
need_build=0

if [ ! -f "$MCP_DIST_SENTINEL" ]; then
    need_build=1
else
    stale=$(find "$MCP_SRC" -type f -newer "$MCP_DIST_SENTINEL" | head -1)
    if [ -n "$stale" ]; then
        need_build=1
    fi
fi

# ---------------------------------------------------------------------------
# 3. Rebuild when necessary
# ---------------------------------------------------------------------------
if [ "$need_build" -eq 1 ]; then
    printf '[run.sh] mcp-server/dist is stale or missing — building MCP server...\n'
    ( cd "$WORKSPACE_ROOT/mcp-server" && npm run build )
else
    printf '[run.sh] mcp-server/dist is up to date — skipping build.\n'
fi

# ---------------------------------------------------------------------------
# 4. Launch the orchestrator, forwarding all arguments verbatim
# ---------------------------------------------------------------------------
exec orchestrate "$@"
