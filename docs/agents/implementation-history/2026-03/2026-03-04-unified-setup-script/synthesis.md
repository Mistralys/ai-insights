# Project Synthesis — Unified Workspace CLI

**Date:** 2026-03-04  
**Project:** `2026-03-04-unified-setup-script`  
**Status:** COMPLETE  
**Work Packages:** 6 / 6 COMPLETE

---

## Executive Summary

This sprint delivered `scripts/cli.js` — a unified, zero-dependency workspace CLI that replaces the need to remember 10 separate `node scripts/X.js` invocations. The script operates in two modes: an **interactive TUI menu** (invoked with no arguments, single-keypress dispatch) and a **direct CLI** (`node scripts/cli.js <command> [...flags]`) for automation and CI use.

The existing `scripts/setup-orchestrator.js` was deleted entirely; its logic was absorbed into the new `setup` subcommand. All other scripts remain unchanged delegatees — `cli.js` spawns them as child processes and forwards arguments verbatim.

Four Blocker defects were discovered and fixed during QA smoke-testing on Windows/Node.js 22.14.0, all related to cross-platform execution patterns that had silently regressed in Node.js 22.

| WP | Title | Agent | Key Outcome |
|----|-------|-------|-------------|
| WP-001 | Create `scripts/cli.js` | Developer | New 694-line CommonJS CLI with interactive menu + 10 commands |
| WP-002 | Implement setup wizard | Developer | 5-component checkbox wizard absorbed from `setup-orchestrator.js` |
| WP-003 | Implement delegating commands | Developer | 8 thin wrapper commands delegating to existing scripts |
| WP-004 | Delete `setup-orchestrator.js` | Developer | File removed; references cleaned from package.json |
| WP-005 | Update README.md + AGENTS.md | Documentation | Quick Start rewritten; Root-Level Tooling table updated |
| WP-006 | QA + Code Review | QA / Reviewer | Full smoke test; 4 Blockers found and fixed |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work Packages | 6 / 6 COMPLETE |
| Acceptance criteria met | 16 / 16 (plan) + 10 / 10 (QA) |
| Blocker defects found during QA | 4 |
| Blocker defects resolved | 4 |
| Files created | 1 (`scripts/cli.js`) |
| Files deleted | 1 (`scripts/setup-orchestrator.js`) |
| Files modified | 5 (`scripts/run-orchestrator.js`, `README.md`, `AGENTS.md`, `personas/standalone/src/content/orchestrator-runner.md`, and generated persona outputs) |
| `cli.js` line count | 694 |
| External dependencies added | 0 |

---

## Deliverables

### `scripts/cli.js` — Unified Workspace CLI

**New file.** 694-line CommonJS script. Highlights:

- **Interactive mode** (`node scripts/cli.js`): ASCII art banner, categorized numbered menu (Setup & Configuration, Personas, MCP Server, Orchestrator, Validation & Utilities), single-keypress dispatch via `readline` raw mode. Fallback to required subcommand when stdin is not a TTY.
- **Direct CLI mode**: `node scripts/cli.js <command> [flags]` for every menu item.
- **`setup` subcommand**: 5-component checkbox wizard (MCP Server, Personas, Orchestrator, `.mcp.json`, Git hooks). Interactive toggle or non-interactive via `--all` / `--components`. Post-run `✓`/`✗` validation summary. Orchestrator setup absorbed from deleted `setup-orchestrator.js`.
- **`.mcp.json` scaffold**: Copies `.mcp.dist.json` and rewrites the placeholder path with the correct absolute path to `mcp-server/src/index.ts`.
- **Delegation**: `sync-personas`, `build-personas`, `package-personas`, `check-roles`, `bundle-docs` use `spawnSync` with `stdio: 'inherit'`. `gui` and `orchestrator` use async `spawn` for long-running / interactive processes.
- **Zero external dependencies**: only Node.js built-ins (`path`, `fs`, `child_process`, `readline`, `os`).
- **Cross-platform**: `IS_WIN` guard, `.cmd` suffixes, `Scripts/` vs `bin/` venv paths, `shell: IS_WIN` on all `spawnSync` calls.

### `scripts/setup-orchestrator.js` — Deleted

Absorbed into `cli.js setup` → Orchestrator component. No backward compatibility breakage — no `package.json` scripts referenced it directly.

### `README.md` — Updated

- Quick Start section rewritten to lead with `node scripts/cli.js` as the primary entry point.
- Additional direct-CLI examples added (`sync-personas`, `gui`, `orchestrator`, `help`).
- Key scripts table updated: `cli.js` added as first entry (interactive command center), `setup-orchestrator.js` removed.

### `AGENTS.md` — Updated

- Root-Level Tooling table updated: `scripts/cli.js` entry describes it as the **Interactive command center + direct CLI**; notes replacement of `setup-orchestrator.js`.

---

## Bug Fixes (QA Blockers)

All four blockers were discovered and fixed during WP-006 smoke testing on Windows/Node.js 22.14.0.

### B-001 — Node.js 22 `spawnSync` + `.cmd` EINVAL (Blocker)

**File:** `scripts/cli.js`  
**Symptom:** `sh()` helper called `spawnSync('npm.cmd', ...)` without `shell: true`. Node.js 22+ refuses to execute `.cmd` files without the `shell` flag, throwing `EINVAL`.  
**Fix:** Changed `sh()` to default `shell: IS_WIN` and spread user-supplied `opts` after, allowing override. All `spawnSync` calls within `cli.js` now work correctly on Node.js 22+ Windows.

### B-002 — `orchestrate.cmd` Binary Not Found (Blocker)

**File:** `scripts/run-orchestrator.js`  
**Symptom:** Used `orchestrate.cmd` to invoke the installed console script. Python venv on Windows installs console-script entry points as `.exe` files (looked up via `PATHEXT`), not `.cmd`. The binary was not found.  
**Fix:** Changed to plain `orchestrate` (no extension). The OS resolves via `PATHEXT` on Windows, directly on Unix.

### B-003 — `npm.cmd` Without `shell` in `run-orchestrator.js` (Blocker)

**File:** `scripts/run-orchestrator.js`  
**Symptom:** The MCP server build step used `spawnSync('npm.cmd', ...)` without `shell: true`. Same Node.js 22 regression as B-001.  
**Fix:** Added `shell: isWindows` to the build-step `spawnSync` call, symmetric with B-001.

### B-004 — Stale `setup-orchestrator.js` References in Persona (Blocker)

**File:** `personas/standalone/src/content/orchestrator-runner.md`  
**Symptom:** 5 references to removed `setup-orchestrator.js` remained in the orchestrator-runner persona source, propagated into generated VS Code and Claude Code persona output files.  
**Fix:** All 5 references replaced with `node scripts/cli.js setup --components orchestrator`. Personas regenerated and deployed to both IDE targets.

---

## Incident Log

No cross-cutting incidents. The four bug fixes above were contained within WP-006 implementation and did not require rework of earlier work packages.

**High-priority observation (QA + Code Review):** Node.js 22 changed behavior for `spawnSync` with `.cmd` executables — they require `shell: true`. This is a **workspace-wide risk**: other scripts in `scripts/` that use `spawnSync` with `npm.cmd` or `pip.cmd` without the shell flag will silently fail on Node.js 22+. B-001 and B-003 fixed the two confirmed instances, but a targeted audit of all scripts is recommended.

---

## Strategic Recommendations (Gold Nuggets)

### 1. Audit all `scripts/` for `spawnSync` + `.cmd` without `shell: true`

**Priority:** High — silent runtime failures on Node.js 22+.

The B-001/B-003 fixes corrected the two confirmed instances in `cli.js` and `run-orchestrator.js`. A quick grep for `spawnSync` across `scripts/` paired with inspection for `npm.cmd`, `pip.cmd`, or any `.cmd` suffix without `shell: true` would surface any remaining exposure. This is a small incremental audit that could prevent future Node.js version upgrade surprises.

**Recommended fix pattern:**
```javascript
// Before (broken on Node 22+)
spawnSync('npm.cmd', ['install'], { cwd, stdio: 'inherit' });

// After (safe cross-version)
const IS_WIN = process.platform === 'win32';
spawnSync('npm' + (IS_WIN ? '.cmd' : ''), ['install'], { cwd, stdio: 'inherit', shell: IS_WIN });
// or simply:
spawnSync('npm', ['install'], { cwd, stdio: 'inherit', shell: IS_WIN });
```

### 2. `cli.js` interactive menu scales to ~15 items before needing sub-menus

**Priority:** Low — design consideration for future growth.

The current numbered menu uses keys 1–9 + 0 (10 slots). If item count grows beyond ~12–15, a two-level menu (category selection → item selection) would be cleaner. The command registry is already category-tagged, making this a straightforward extension. No action needed now.

### 3. `extract-changelog-entry.js` is intentionally absent from the menu

**Priority:** Low — awareness item.

The plan explicitly excluded `extract-changelog-entry.js` from the CLI menu as a CI-only utility. If a future user wants it accessible interactively, adding it is trivial (one new entry in the `COMMANDS` array). The exclusion is intentional, not an oversight.

---

## Next Steps

1. **Run the Node.js 22+ `spawnSync` audit** (Recommendation 1, High priority) — grep `scripts/` for `.cmd` without `shell: true` and fix any remaining instances in a targeted housekeeping work package.
2. **Consider versioning `cli.js` banner** — the banner currently reads the workspace version from `changelog.md`. If the changelog format changes, the semver extraction regex in `cli.js` may need updating. Low risk; worth noting.
3. **Consider adding `node scripts/cli.js` to a root `package.json` "start" script** — would make `npm start` the canonical entry point for users who prefer npm conventions.
