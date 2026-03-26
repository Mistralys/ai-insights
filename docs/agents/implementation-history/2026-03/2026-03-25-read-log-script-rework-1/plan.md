# Plan

## Summary

Follow-up rework addressing the five strategic recommendations from the
`2026-03-25-read-log-script` synthesis. The scope covers: extracting a named
constant for the SIGTERM grace period, auto-generating `printHelp()` rows from
the `COMMANDS` registry, documenting both new scripts in the AGENTS.md
root-level tooling table, adding a `--depth N` flag for lock-file cleanup, and
extracting the `SIGTERM_GRACE_MS` constant — all low-risk, high-clarity
improvements that reduce tech debt and improve agent discoverability.

## Architectural Context

### `scripts/cli.js` (~950 lines, CJS)

- **`COMMANDS` array** (12 entries): Each entry has `id`, `key`, `label`,
  `category`, `description`, and `run`. The interactive menu (`renderMenu()`)
  already auto-generates its display from `COMMANDS`.
- **`printHelp()`** (line 564): Maintains a separate `rows` array of 20
  hand-written `[command-string, description]` tuples. This array includes
  flag-variant rows (e.g. `setup --all`, `preflight --plan <path>`) that have
  no corresponding `COMMANDS` entry — they are sub-usages of existing commands.
- **Dispatch**: `parseArgs()` → `COMMANDS.find(c => c.id === command)` →
  `cmd.run(flags)`.

### `scripts/kill-orchestrator.js` (~390 lines, CJS)

- **`killProcess(pid)`**: Uses a hardcoded `3000` ms literal in
  `setTimeout(resolve, 3000)` for the SIGTERM → SIGKILL grace window.
- **`findRecentPlanDirs()`**: Scans `.slice(-20)` log files — hardcoded
  constant.
- Both scripts are zero-external-dependency (Node.js stdlib only).

### `AGENTS.md` root-level tooling table

- Documents 8 root-level scripts (`cli.js`, `sync-personas.js`,
  `build-personas.js`, `check-known-roles.js`, `bundle-docs.js`,
  `preflight-orchestrator.js`, `install-hooks.js`,
  `validate-workflow-manifest.js`).
- **Missing entries**: `scripts/read-log.js` and
  `scripts/kill-orchestrator.js`.

### `CLAUDE.md`

- Auto-generated mirror of `AGENTS.md` — synchronized automatically by the CTX generate script. Use this script to update as necessary.

## Approach / Architecture

### 1. Auto-generate `printHelp()` from `COMMANDS`

Replace the manually-maintained `rows` array with logic that derives help rows
from `COMMANDS`. To preserve the existing sub-usage rows (e.g. `--all`,
`--plan <path>`, `--force`), add an optional `helpVariants` property to each
relevant `COMMANDS` entry. The auto-generation loop renders:

1. The base command (`id` + `description`) for every entry.
2. Any `helpVariants` entries for commands that have flag sub-usages.
3. A hardcoded `help` row at the end (since `help` is not in `COMMANDS`).

This eliminates the dual-maintenance: adding a new command to `COMMANDS`
automatically makes it appear in `printHelp()`.

### 2. Extract named constants in `kill-orchestrator.js`

- `SIGTERM_GRACE_MS = 3000` — replaces the magic `3000` in `killProcess()`.
- `DEFAULT_LOG_DEPTH = 20` — replaces the `.slice(-20)` in
  `findRecentPlanDirs()`.

### 3. Add `--depth N` flag to `kill-orchestrator.js`

Parse a `--depth <n>` flag in the argument handling, defaulting to
`DEFAULT_LOG_DEPTH`. Pass it through to `findRecentPlanDirs(depth)`.

### 4. Document new scripts in AGENTS.md

Add two rows to the root-level tooling table for `read-log.js` and
`kill-orchestrator.js`, placed after the `preflight-orchestrator.js` row to
maintain the Orchestrator grouping. `CLAUDE.md` is auto-synced from
`AGENTS.md` by a build script — no manual update needed.

## Rationale

- **Auto-generated help** is the highest-value change: it was flagged in two
  separate WPs and prevents silent drift as new commands are added. The
  `helpVariants` approach preserves the richer sub-usage display that users and
  agents rely on, while eliminating the need to manually add base-command rows.
- **Named constants** make intent explicit and future tuning trivial — zero
  behavioral change, purely declarative.
- **`--depth N`** addresses the bounded-heuristic concern with minimal API
  surface (one flag, one constant default).
- **AGENTS.md documentation** closes the discoverability gap for agents
  entering the workspace.

## Detailed Steps

1. **Add `helpVariants` to relevant `COMMANDS` entries** in `scripts/cli.js`:
   - `setup`: `['setup --all', 'Non-interactive full setup']`,
     `['setup --components <ids>', 'Run selected components (e.g. mcp-server,personas)']`
   - `mcp-json`: `['mcp-json --force', 'Overwrite existing .mcp.json']`
   - `preflight`: `['preflight --plan <path>', 'Also verify plan file exists']`
   - `read-log`: `['read-log --summary', 'One-line run overview with token totals']`
   - `kill-orchestrator`:
     `['kill-orchestrator --force', 'Kill without confirmation (agent use)']`
   - Note: `orchestrator` appears in help rows but not in `COMMANDS`
     (it requires `--plan`). Add it to `COMMANDS` with the existing
     `cmdOrchestrator` handler, or keep it as a static extra row. The simpler
     approach: add to `COMMANDS` since the handler already exists. If it
     should remain hidden from the interactive menu, gate it with a
     `hidden: true` flag that `renderMenu()` skips but `printHelp()` includes.

2. **Rewrite `printHelp()`** to iterate `COMMANDS`:
   - For each command: emit `[cmd.id, cmd.description]`.
   - If `cmd.helpVariants` exists: emit each variant row.
   - After the loop: emit the static `['help', 'Show this help']` row.
   - Preserve the existing header/footer formatting.

3. **Extract constants in `scripts/kill-orchestrator.js`**:
   - Add `const SIGTERM_GRACE_MS = 3000;` near the top constants block.
   - Add `const DEFAULT_LOG_DEPTH = 20;` near the top constants block.
   - Replace `setTimeout(resolve, 3000)` with
     `setTimeout(resolve, SIGTERM_GRACE_MS)`.
   - Replace `.slice(-20)` with `.slice(-depth)` (parameter-driven).

4. **Add `--depth N` flag** to `scripts/kill-orchestrator.js`:
   - In the argument parsing section, detect `--depth` and parse the next
     token as an integer, defaulting to `DEFAULT_LOG_DEPTH`.
   - Pass `depth` to `findRecentPlanDirs(depth)`.
   - Update the function signature: `function findRecentPlanDirs(depth)` →
     uses `depth` in `.slice(-depth)`.

5. **Add AGENTS.md tooling table entries** for both scripts:
   - `scripts/read-log.js` | Structured JSONL log reader — query, filter,
     and summarize orchestrator run logs. Supports `--format json`. |
   - `scripts/kill-orchestrator.js` | Detect and terminate stale orchestrator
     processes; cleans up `.orchestrator.lock` files. Supports `--json`,
     `--force`, and `--depth N`. |
   - Place both after the `preflight-orchestrator.js` row.

6. **Update Orchestrator Runner persona source** in
   `personas/standalone/src/`:
   - `content/orchestrator-runner.md`: In the troubleshooting table row for
     process conflicts (~line 305), add `--depth N` to the
     `kill-orchestrator.js` description so agents discover the flag.
   - `meta/orchestrator-runner.yaml`: Bump `version` to `1.5.1` and update
     `last_updated` to the current date.

7. **Rebuild generated persona output** via
   `node scripts/build-personas.js --suite standalone` to propagate the
   persona source changes to VS Code and Claude Code output files.

8. **Update `README.md`** (root): In the quick-start CLI block (~lines
   35–54), add the `--depth` variant alongside the existing
   `kill-orchestrator` line so it's discoverable from the landing page.

9. **Bump `personas/package.json`** version (patch) and add a changelog
    entry in `personas/changelog.md` for the Orchestrator Runner v1.5.1
    update.

## Dependencies

- Steps 1–2 are tightly coupled (both touch `cli.js`).
- Steps 3–4 are tightly coupled (both touch `kill-orchestrator.js`).
- Steps 5–6 are independent of 1–4.
- Steps 6–7 depend on step 4 (the `--depth` flag must exist before
  documenting it in the persona).
- Step 8 depends on step 4 (same reason).
- Step 9 depends on steps 6–7 (persona version bump after content change).
- All three groups (cli.js, kill-orchestrator.js, docs) can begin in
  parallel, but persona rebuild (step 7) and version bump (step 9) must
  wait for content changes to land.
- `CLAUDE.md` is auto-synced from `AGENTS.md` — no explicit step needed.

## Required Components

- `scripts/cli.js` — `COMMANDS` array, `printHelp()` function (existing)
- `scripts/kill-orchestrator.js` — `killProcess()`,
  `findRecentPlanDirs()`, argument parsing (existing)
- `AGENTS.md` — root-level tooling table (existing)
- `personas/standalone/src/content/orchestrator-runner.md` — persona body
  (existing)
- `personas/standalone/src/meta/orchestrator-runner.yaml` — persona metadata
  (existing)
- `personas/package.json` — version field (existing)
- `personas/changelog.md` — changelog (existing)
- `README.md` — quick-start CLI block (existing)

## Assumptions

- The `orchestrator` command (visible in `printHelp()` rows but absent from
  `COMMANDS`) should be added to `COMMANDS` to be auto-generated. The
  `cmdOrchestrator` handler already exists.
- `helpVariants` is an optional array property; commands without it simply
  show the base row.
- `--depth` only affects lock-file cleanup scope, not process detection.

## Constraints

- CJS module format — no ESM imports.
- Zero external dependencies — both scripts remain stdlib-only.
- Cross-platform: all changes must work on Windows, macOS, and Linux.
- `CLAUDE.md` is auto-synced from `AGENTS.md` by a build script — only
  `AGENTS.md` needs manual edits.
- The interactive menu (`renderMenu()`) continues to use `COMMANDS` directly;
  it is NOT affected by this plan.

## Out of Scope

- Adding a `--grace-ms` CLI flag to override SIGTERM grace period (the named
  constant is sufficient; runtime configurability is not needed yet).
- Refactoring the `parseArgs()` unrecognised-flag consumption issue (synthesis
  recommendation #3) — this is a separate, lower-priority concern.
- Root changelog entry — will be bundled with the next workspace release.
- Adding tests for `printHelp()` output format — nice-to-have but not
  required for this rework.
- Ledger persona updates — only the standalone Orchestrator Runner persona
  references these scripts.

## Acceptance Criteria

- `node scripts/cli.js help` output is identical to the current output (no
  visible regression).
- Adding a new `COMMANDS` entry automatically adds a row to `printHelp()`
  output without touching the help function.
- `SIGTERM_GRACE_MS` and `DEFAULT_LOG_DEPTH` are named constants at the top
  of `kill-orchestrator.js`.
- `node scripts/kill-orchestrator.js --depth 5` scans only the last 5 log
  files for lock cleanup.
- `node scripts/kill-orchestrator.js` (no flag) defaults to 20 logs.
- `AGENTS.md` root-level tooling table includes entries for `read-log.js`
  and `kill-orchestrator.js` (`CLAUDE.md` auto-syncs).
- Orchestrator Runner persona source mentions `--depth N` in the
  troubleshooting table.
- Orchestrator Runner persona version is bumped to `1.5.1`.
- Generated persona output files are rebuilt and match source.
- `README.md` quick-start CLI block includes the `--depth` variant.
- `personas/changelog.md` has a new entry for the persona patch.
- `personas/package.json` version is incremented (patch).
- All existing script tests pass (`npm test` from workspace root).
- `node scripts/build-personas.js --check` reports no stale output.

## Testing Strategy

- **Regression**: Run `node scripts/cli.js help` before and after step 2;
  diff outputs to confirm identical content.
- **New flag**: Run `node scripts/kill-orchestrator.js --depth 3 --json` on a
  workspace with logs; verify it only scans 3 files.
- **Auto-generation**: Temporarily add a dummy `COMMANDS` entry, run `help`,
  confirm it appears, then remove it.
- **Persona freshness**: Run `node scripts/build-personas.js --check` to
  confirm generated output matches source after rebuild.
- **Documentation audit**: Verify `AGENTS.md`, `CLAUDE.md`, `README.md`, and
  Orchestrator Runner persona all reference `--depth N`.
- **Existing tests**: `npm test` from workspace root (1,767 tests should
  pass).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`printHelp()` output changes subtly** (ordering, spacing) causing agent parsers to break | Diff before/after output; preserve exact column widths and ordering by iterating `COMMANDS` in insertion order |
| **`orchestrator` command added to `COMMANDS` appears in interactive menu** | Gate with `hidden: true`; `renderMenu()` filters `!cmd.hidden` |
| **`--depth` flag conflicts with future flags** | Use a descriptive name; document in `--help` output via `helpVariants` |
| **Persona version bump forgotten** after content change | Step 10 explicitly tracks the package.json + changelog bump; `--check` flag guards against stale output |
| **AGENTS.md and CLAUDE.md drift apart** | `CLAUDE.md` auto-syncs from `AGENTS.md` via build script — no manual step needed |
