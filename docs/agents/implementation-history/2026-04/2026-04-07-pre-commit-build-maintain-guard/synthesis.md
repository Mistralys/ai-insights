## Synthesis

### Completion Status
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Created `scripts/check-version-sync.js` — a standalone CJS Node.js script that compares each module's changelog version (`## v{X.Y.Z}` heading) against its package manifest version (`package.json` or `pyproject.toml`). Exits 1 on mismatch with a clear error message naming the mismatched module(s) and the fix command (`node scripts/cli.js build-maintain`).
- Extended `.githooks/pre-commit` with two new check blocks: (1) version sync check (blocking, runs after persona freshness), and (2) CTX staleness warning (non-blocking, runs before changelog drift warning). The CTX heuristic detects when source files under `mcp-server/src/`, `orchestrator/src/`, `personas/`, `scripts/`, or `shared/` are staged without any `.context/` files.
- Registered `check-versions` as a hidden CLI command in `scripts/cli.js` dispatching to `cmdCheckVersions()`.
- Fixed three stale "(gitignored)" references in `AGENTS.md` (lines 158, 359) and `docs/agents/project-manifest/README.md` (line 115), replacing with "(tracked in VCS)".

### Documentation Updates
- `AGENTS.md` — Fixed 2 stale "(gitignored)" annotations to "(tracked in VCS)". Added `scripts/check-version-sync.js` to the Root-Level Tooling table. Updated `scripts/install-hooks.js` description to reflect all pre-commit checks (persona freshness, version sync, ruff lint, CTX staleness warning, changelog drift warning).
- `docs/agents/project-manifest/README.md` — Fixed 1 stale "gitignored" annotation to "tracked in VCS".
- Downstream generated files (`CLAUDE.md`, `.context/agents.md`, `.context/project-manifest.md`) will self-correct on the next `build-maintain` run as they mirror the source docs.

### Verification Summary
- Tests run: `node scripts/check-version-sync.js` (standalone, exit 0 — all versions in sync); `node scripts/cli.js check-versions` (via CLI, exit 0); mismatch simulation (temporarily set `mcp-server/package.json` version to `0.0.1`, confirmed exit 1 with correct error output, then restored); `node scripts/cli.js help` (confirmed `check-versions` appears in help output).
- Static analysis run: N/A (no TypeScript or Python files modified; the new script is CJS JavaScript matching existing `scripts/` convention; no linter configured for root-level JS scripts).
- Result: All checks pass. Pre-commit hook ordering is correct (persona freshness -> version sync -> ruff -> CTX warning -> changelog drift warning).

### Code Insights
- [low] (convention) `.githooks/pre-commit`: ~~The persona freshness check (`node scripts/build-personas.js --check`) on line 2 has no `|| exit 1` guard — it relies on the script calling `process.exit(1)` internally which propagates to the shell. All other blocking checks use the explicit `|| exit 1` pattern. For consistency and resilience, adding `|| exit 1` would be prudent.~~ **DONE** — guard added.
- [low] (improvement) `scripts/cli.js` — `readSubVersion()` and `readPyprojectVersion()` (lines 90-103) duplicate version-reading logic that is now also in `check-version-sync.js`. If more version-related tooling is added in the future, extracting a shared `lib/version-utils.js` module would reduce duplication. **DEFERRED** — added to `docs/agents/deferred-topics.md`.
- [low] (debt) `scripts/cli.js` — ~~The `git-hooks` command description (line 553) still says "pre-commit persona guard" which was accurate historically but now undersells the hook's scope. This is cosmetic and low-priority.~~ **DONE** — description updated.

### Additional Comments
- The CTX staleness heuristic intentionally excludes `tests/` directories from triggering — test-only changes do not affect `.context/` output, reducing false positive warnings.
- The version sync script uses the same `## v{X.Y.Z}` regex pattern as `cli.js`'s `readVersion()` function, ensuring consistent version extraction logic across the workspace.
