# Synthesis Report — GUI Stale Instance Banner

**Plan:** `2026-04-14-gui-stale-instance-banner`
**Date:** 2026-04-14
**Status:** COMPLETE — 7/7 work packages shipped

---

## Executive Summary

This session delivered a **stale instance detection banner** for the MCP server GUI dashboard. When the Markdown-rendered web UI detects that one or more component version files on disk differ from the versions that were in place when the server booted, it automatically injects a sticky amber banner at the top of the page listing the changed components. The feature is self-contained, requires no user configuration, and is idempotent.

The implementation was built in seven sequential work packages following a clean bottom-up dependency chain: utility → CSS → HTTP endpoint → API client → client module → bootstrap wiring → documentation audit.

---

## What Was Built

| Layer | Artifact | Description |
|-------|----------|-------------|
| Utility | `src/utils/workspace-versions.ts` (new) | Reads `mcpServer`, `personas`, and `orchestrator` version strings from disk (package.json / pyproject.toml) using Node.js built-ins only. |
| CSS | `gui/public/styles.css` | `.stale-banner` class: sticky amber banner, z-index 200, WCAG-compliant in light (8.15:1) and dark (8.97:1) modes. |
| HTTP API | `gui/server.ts` | `GET /api/server-info` endpoint returning `{ stale: boolean, bootVersions, diskVersions }`. Boot versions captured once at startup; disk versions read on each request. |
| API client | `gui/public/api-client.js` | `API.getServerInfo()` one-liner following the ES5 module convention. |
| Client module | `gui/public/stale-check.js` (new) | `StaleCheck` IIFE: polls every 30 s, inserts `.stale-banner` before `<header>` on first stale response, stops polling, silences network errors. |
| Bootstrap | `gui/public/index.html`, `gui/public/app.js` | `<script src="/stale-check.js">` added before `app.js`; `StaleCheck.init()` called after `Router.init()`. |
| Documentation | `api-surface.md`, `file-tree.md`, `README.md` | All new artifacts documented in the manifest; stale-detection feature added to the README GUI feature list. |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages completed | 7 / 7 |
| Pipelines completed (PASS) | 25 / 25 |
| Tests at session start | 1,809 |
| Tests at session end | 1,826 |
| Net new tests added | +17 (6 server-info integration, 1 api-client unit, 10 stale-check unit) |
| Test failures | 0 |
| Regressions | 0 |
| Fix-Forward fixes applied by Reviewer | 2 (WP-005) |
| Bugs found in review | 2 (both fixed in-pipeline) |

---

## Fix-Forward Items (Applied in WP-005)

Both bugs were caught during the code-review pipeline and fixed immediately without rework:

1. **Null-check false positive in `_detectChanges()`** *(medium priority)*
   The expression `bootVersions && bootVersions[key]` short-circuits to `null` when `bootVersions` is `null`, so the subsequent `!== undefined` guard always passed — risking a false-positive "changed component" entry. Fixed to `bootVersions != null ? bootVersions[key] : undefined`.

2. **Double-`init()` zombie interval** *(low priority)*
   A second call to `StaleCheck.init()` before staleness would orphan the first `setInterval` handle, leaving it running indefinitely. Fixed by calling `_stopPolling()` as the first statement of `init()`, making the function idempotent at zero cost when called once.

---

## Strategic Recommendations (Gold Nuggets)

### 1. Add a Dedicated Unit Test File for `workspace-versions.ts`
Flagged by both QA and Reviewer (WP-001). The module was verified at runtime via `tsx` but has no Vitest unit tests. The ENOENT and malformed-TOML throw paths are untested by the automated suite. Suggested path: `mcp-server/tests/utils/workspace-versions.test.ts`.

### 2. Harden the TOML Version Regex
The regex `/^version\s*=\s*"([^"]+)"/m` matches the first top-level `version = "…"` line in `pyproject.toml`. It is section-unaware — if any dependency pin or metadata key with `version =` appears above `[project]`, the wrong value would be captured. A `[project]` header anchor should be added proactively before the orchestrator's `pyproject.toml` changes.

### 3. Replace Explicit Field Enumeration in Stale Check with `Object.keys()` Iteration
`gui/server.ts` hardcodes `boot.mcpServer !== disk.mcpServer || boot.personas !== ...`. If `WorkspaceVersions` gains a new field, this comparison silently misses it. Replacing with `(Object.keys(disk) as Array<keyof WorkspaceVersions>).some(k => boot[k] !== disk[k])` future-proofs the check at no behavioral cost today.

### 4. Consider a Short TTL Cache for `captureWorkspaceVersions()`
The function reads three files from disk on every `GET /api/server-info` request. At a 30-second polling interval this is negligible, but a 5-second TTL cache would eliminate the I/O cost entirely should polling frequency ever increase.

### 5. WP Spec Path Consistency
Four WP specs (`WP-005`, `WP-006`) referenced a non-existent `mcp-server/gui/public/js/` subdirectory. All client scripts live directly at `gui/public/`. One spec was corrected in the documentation pass (WP-006). Future plan authoring should verify actual file paths before committing.

---

## Next Steps

1. **Create `tests/utils/workspace-versions.test.ts`** — straightforward unit test; covers missing-file throw and malformed-TOML throw using mocked `fs.readFileSync`.
2. **Anchor the TOML regex** to the `[project]` section in `workspace-versions.ts` — protective against future `pyproject.toml` restructuring.
3. **Replace field-enumeration in stale check** with `Object.keys()` iteration in `gui/server.ts`.
4. **CTX refresh** — the context docs (`.context/mcp-server/`) will be stale after this session's changes to `api-surface.md`, `file-tree.md`, and `README.md`. Run `node scripts/cli.js ctx-generate` before the next agent cycle.
5. **Changelog update** — `mcp-server/changelog.md` should receive an entry for the stale-instance-banner feature (version bump TBD by Release Engineer).

---

## Files Modified This Session

```
mcp-server/src/utils/workspace-versions.ts        ← new
mcp-server/gui/public/styles.css
mcp-server/gui/server.ts
mcp-server/tests/gui/server-info.test.ts           ← new
mcp-server/gui/public/api-client.js
mcp-server/tests/gui/api-client.test.ts
mcp-server/gui/public/stale-check.js               ← new
mcp-server/tests/gui/stale-check.test.ts           ← new
mcp-server/gui/public/index.html
mcp-server/gui/public/app.js
mcp-server/README.md
mcp-server/docs/agents/project-manifest/api-surface.md
mcp-server/docs/agents/project-manifest/file-tree.md
docs/agents/plans/2026-04-14-gui-stale-instance-banner/work/WP-006.md
```

14 files total — 4 new, 10 modified.
