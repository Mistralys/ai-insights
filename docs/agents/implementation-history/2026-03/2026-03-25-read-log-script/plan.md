# Plan

## Summary

Add two dedicated scripts to the `scripts/` directory that address recurring pain points for agents operating the orchestrator:

1. **`scripts/read-log.js`** — Structured, cross-platform access to orchestrator JSONL log files. Replaces ad-hoc `grep`, `tail`, `jq` pipelines with simple flag-based queries (e.g. `--errors`, `--last 20`, `--summary`).
2. **`scripts/kill-orchestrator.js`** — Detects and terminates stale orchestrator processes. Currently when the preflight script detects conflicts, the agent must ask the user to run `kill` commands manually. This script automates that workflow with a safe interactive confirmation.

Both scripts are registered in the CLI menu, and the Orchestrator Runner persona is updated to reference them.

## Architectural Context

- **JSONL log files** are written to `orchestrator/logs/` during runs and copied to `mcp-server/storage/ledger/{slug}/orchestrator/logs/` at run end. Each line is a JSON object with an `action` field identifying the event type (20+ event types). Full schema: `orchestrator/docs/jsonl-log-schema.md`.
- **`scripts/cli.js`** is the unified workspace CLI. Commands are registered in the `COMMANDS` array and exposed both as interactive menu items and direct CLI subcommands. Simple scripts use `runScript()` (synchronous delegation).
- **`scripts/run-orchestrator.js`** is the canonical orchestrator launcher, following a Node.js CJS pattern with cross-platform support (Windows `npm.cmd`, venv `Scripts/` vs `bin/`).
- **Existing log resolver** (`mcp-server/src/gui/log-resolver.ts`) provides log file discovery and reading for the GUI — but it's TypeScript/ESM and coupled to the GUI's API layer. The new script is a standalone CJS Node.js utility with no dependencies.
- **Orchestrator Runner persona** (`personas/standalone/src/content/orchestrator-runner.md` + `personas/standalone/src/meta/orchestrator-runner.yaml`) instructs agents to use `jq`, `grep`, and `tail` for log inspection, and tells them to ask the user to manually kill stale processes. Both sections need updating.
- **Process detection** in `scripts/preflight-orchestrator.js` uses `pgrep -fl orchestrate` (Unix) to find running orchestrator processes, filtering out `preflight-orchestrator` and `pgrep` itself. On Windows it skips the check (relies on the `.orchestrator.lock` file instead). The new `kill-orchestrator.js` script reuses this same detection pattern.

## Approach / Architecture

Create two self-contained Node.js CJS scripts:

**`scripts/read-log.js`:**
1. Auto-discovers the latest log file in `orchestrator/logs/` (or accepts `--file` / `--slug` to target a specific one).
2. Parses JSONL lines with Node.js built-ins (no external dependencies).
3. Provides filtering by action type(s), log level, and tail count.
4. Offers a `--summary` mode that extracts a one-line run overview.
5. Outputs in human-readable `text` (default) or machine-readable `json` format.

**`scripts/kill-orchestrator.js`:**
1. Detects running orchestrator processes using the same `pgrep -fl orchestrate` pattern as `preflight-orchestrator.js`.
2. Lists found processes with PID, command line, and age.
3. In interactive mode (default): prompts for confirmation before killing.
4. With `--force`: kills without confirmation (for agent use).
5. Cleans up stale `.orchestrator.lock` files after killing.
6. On Windows: provides guidance to use Task Manager (process detection via `pgrep` is not available).

Register both in `scripts/cli.js` under the "Orchestrator" category. Update the Orchestrator Runner persona to reference both scripts.

## Rationale

- **Cross-platform:** Pure Node.js CJS — no `jq`, `grep`, `tail`, or manual `kill` commands needed. Works identically on macOS, Linux, and Windows (with graceful degradation for process detection on Windows).
- **Token-efficient:** Agents invoke one command with flags instead of constructing multi-pipe shell commands or asking the user for manual intervention.
- **No new dependencies:** Uses only `fs`, `path`, `readline`, `child_process` from Node.js stdlib.
- **Follows existing patterns:** Same CJS style as `run-orchestrator.js`, `preflight-orchestrator.js`, `run-gui.js`. Same CLI registration pattern as other commands.
- **Standalone scripts:** Avoid coupling to the GUI's TypeScript log-resolver or the preflight script's check logic. Each script has a single, focused responsibility.
- **Safe process cleanup:** Interactive confirmation by default prevents accidental kills; `--force` enables agent automation.

## Detailed Steps

### 1. Create `scripts/read-log.js`

New file. CJS, `#!/usr/bin/env node`, no external dependencies.

**Core responsibilities:**

- **Log discovery:** Find the latest `.jsonl` file in `orchestrator/logs/`. With `--slug <name>`, filter to files matching `*-<slug>.jsonl`. With `--file <path>`, use an explicit file path.
- **Filtering flags:**
  - `--last N` — Show the last N entries (default: 20 when no other filter is specified).
  - `--actions <type,...>` — Filter by one or more action types (comma-separated). E.g. `--actions route,stage_error`.
  - `--level <level,...>` — Filter by log level(s). E.g. `--level ERROR,WARNING`.
  - `--errors` — Shorthand for `--level ERROR,WARNING`.
  - `--wp <id>` — Filter to entries for a specific work package (e.g. `--wp WP-003`).
  - `--summary` — Print a one-line run overview: start time, total duration, WP count, final result, error count.
- **Output format:**
  - `--format text` (default) — Human-readable, colored console output. Each entry on one line with timestamp, stage, action, and key fields.
  - `--format json` — Raw JSON array to stdout (for piping into other tools).
- **`--help`** — Print usage information.

**Text output format** (per entry):

```
HH:MM:SS [stage] WP-NNN action → result (duration, tokens)
```

For `--summary`:
```
Run: 2026-03-25T20:10:50Z | Duration: 1h 12m | WPs: 5 (3 complete, 1 in-progress, 1 ready) | Result: COMPLETE | Tokens: 145,200 (in: 112,800 / out: 32,400) | Errors: 0 | Warnings: 2
```

Token totals are aggregated from all `stage_complete` entries where `tokens_used` is non-null. If no token data is available, the tokens segment is omitted.

**Error handling:**
- If no log files found, print a clear message and exit code 1.
- If the specified file doesn't exist, print "File not found" and exit code 1.
- Malformed JSON lines are silently skipped (same convention as `log-resolver.ts`).

### 2. Create `scripts/kill-orchestrator.js`

New file. CJS, `#!/usr/bin/env node`, no external dependencies.

**Core responsibilities:**

- **Process detection:** Run `pgrep -fl orchestrate` (same pattern as `preflight-orchestrator.js`). Filter out the script itself, `pgrep`, and `preflight-orchestrator`.
- **Process display:** For each found process, show:
  - PID
  - Command line (truncated to 120 chars)
  - Elapsed time if available (from `ps -o etime=` per PID)
- **Flags:**
  - `--force` — Skip confirmation, kill immediately. Intended for agent use.
  - `--json` — Output process list as JSON array (for machine consumption). Does not kill.
  - `--help` — Print usage information.
- **Kill behavior:**
  - Without `--force`: Print the process list and prompt "Kill all N processes? [y/N]". Only proceed on explicit `y`.
  - With `--force`: Kill all found processes without prompting.
  - Send `SIGTERM` first. If a process is still alive after 3 seconds, send `SIGKILL`.
- **Lock file cleanup:** After killing, scan for stale `.orchestrator.lock` files in recently-used plan directories (found by checking JSONL log files for plan paths) and remove them.
- **Windows behavior:** Print a message explaining that automatic process detection is not supported on Windows, and suggest using Task Manager to find and kill `python` processes running `orchestrate`. Exit code 0 (advisory, not an error).
- **Exit codes:**
  - `0` — No processes found, or processes successfully killed.
  - `1` — Processes found but user declined to kill (interactive mode).

### 3. Register both in `scripts/cli.js`

Add command functions:

```js
function cmdReadLog(args)         { runScript('read-log.js', args); }
function cmdKillOrchestrator(args) { runScript('kill-orchestrator.js', args); }
```

Registrations in `COMMANDS`:

**read-log:**
- `id: 'read-log'`
- `key: 'l'` (verify not already taken)
- `label: 'Read orchestrator log'`
- `category: 'Orchestrator'`
- `description: 'Query & filter JSONL run logs'`

**kill-orchestrator:**
- `id: 'kill-orchestrator'`
- `key: 'k'` (verify not already taken)
- `label: 'Kill stale processes'`
- `category: 'Orchestrator'`
- `description: 'Find & terminate stale orchestrator processes'`

### 4. Update the Orchestrator Runner persona

Edit `personas/standalone/src/content/orchestrator-runner.md`:

**A. In the "JSONL log file" subsection** (under "Monitoring Progress"), replace the `jq` and `grep` examples with `read-log.js` invocations:

```markdown
### JSONL log file (secondary — for post-run analysis)

Every run writes a structured JSONL log to `orchestrator/logs/`. Use the `read-log.js` script for querying:

```bash
# Show the last 20 entries from the most recent run:
node scripts/read-log.js

# Show only errors and warnings:
node scripts/read-log.js --errors

# Show routing decisions:
node scripts/read-log.js --actions route

# Show all events for a specific WP:
node scripts/read-log.js --wp WP-003

# Run summary (one-line overview):
node scripts/read-log.js --summary

# Target a specific project's log:
node scripts/read-log.js --slug my-project-name

# JSON output for piping:
node scripts/read-log.js --errors --format json
```
```

Remove the `jq` and `grep`-based examples and the note about `jq` being required. Keep the schema reference to `orchestrator/docs/jsonl-log-schema.md` and the field reference table.

**B. In the "Pre-Flight Checklist" section or "Common Errors and Fixes" table**, add a reference to `kill-orchestrator.js` for resolving process conflicts:

```markdown
### Resolving stale orchestrator processes

If the preflight script reports a conflicting orchestrator process, use the cleanup script:

```bash
# List stale processes (interactive — asks before killing):
node scripts/kill-orchestrator.js

# Kill without confirmation (for automated/agent use):
node scripts/kill-orchestrator.js --force
```

This replaces the need to manually run `pgrep` and `kill` commands.
```

Also update the "Common Errors and Fixes" table row for the preflight process conflict — change the "Fix" column from a manual kill suggestion to `node scripts/kill-orchestrator.js`.

### 5. Bump persona version

In `personas/standalone/src/meta/orchestrator-runner.yaml`:
- Bump `version` from `"1.4.1"` to `"1.5.0"` (new feature: two new script references).
- Update `last_updated` to the current date.

### 6. Add changelog entry

Add an entry to `personas/changelog.md` under a new `## v3.10.0` heading (or whatever the next version is — check the current top entry):

```
- feat: Orchestrator Runner persona references new `read-log.js` and `kill-orchestrator.js` scripts
```

No entry needed in `mcp-server/changelog.md` or `orchestrator/changelog.md` — the scripts live in root `scripts/` and the persona change is the only module-level artifact. A root `changelog.md` entry is out of scope (deferred to the next release roll-up).

### 7. Rebuild personas

Run `node scripts/build-personas.js --suite standalone` to regenerate the Orchestrator Runner output files in `personas/standalone/vs-code/` and `personas/standalone/claude-code/`.

## Dependencies

- None external. Pure Node.js CJS using only `fs`, `path`, `readline`, `child_process` built-ins.
- The JSONL schema is a read contract — `read-log.js` must handle all 20+ action types gracefully (unknown types are printed as-is, never crash).
- `kill-orchestrator.js` depends on `pgrep` and `kill` being available on Unix systems (standard on macOS and Linux). On Windows, it degrades gracefully with a manual-guidance message.

## Required Components

- **New file:** `scripts/read-log.js` — The log reader script.
- **New file:** `scripts/kill-orchestrator.js` — The process cleanup script.
- **Modified file:** `scripts/cli.js` — Register both new commands.
- **Modified file:** `personas/standalone/src/content/orchestrator-runner.md` — Replace shell examples with script references.
- **Modified file:** `personas/standalone/src/meta/orchestrator-runner.yaml` — Version bump.
- **Regenerated (not hand-edited):** `personas/standalone/vs-code/orchestrator-runner.agent.md`, `personas/standalone/claude-code/orchestrator-runner.md`.

## Assumptions

- The `l` and `k` keys are not already claimed in the `COMMANDS` array. If either is taken, pick an alternative available key.
- `read-log.js` reads files synchronously (acceptable for CLI tools; log files are typically < 1 MB).
- The `orchestrator/logs/` directory path is resolved relative to the workspace root (same as `run-orchestrator.js`).
- `pgrep` and `kill` are available on macOS and Linux (they are standard POSIX utilities).
- On Windows, process detection is not automated (acceptable — the preflight script already skips this check on Windows).

## Constraints

- Must follow the Cross-Platform Policy: use `path.join()` for all paths, handle Windows correctly. `kill-orchestrator.js` uses `pgrep`/`kill` on Unix but must degrade gracefully on Windows (advisory message, not a crash).
- Must follow CJS conventions (`'use strict'`, `require()`) matching all existing `scripts/` files.
- No new npm dependencies — stdlib only.
- Malformed JSON lines must be skipped silently (existing convention from `log-resolver.ts`).
- The persona edit must be made in `personas/standalone/src/content/`, never in generated output directories.
- `kill-orchestrator.js` must never kill processes without confirmation unless `--force` is passed. Safety first.

## Out of Scope

- GUI integration — the GUI has its own log viewer via `log-resolver.ts` and the web dashboard.
- Log rotation, cleanup, or archival — handled separately by the GUI's `archiveCompletedLogs()`.
- Modifying the JSONL schema or the `WorkflowLogger` class.
- Adding the scripts to the MCP server's tool surface.
- Updating the `smoke-testing.md` doc (nice-to-have follow-up, not part of this plan).
- Modifying `preflight-orchestrator.js` — it keeps its existing process detection as a read-only check. The new `kill-orchestrator.js` is a separate tool for remediation.

## Acceptance Criteria

### read-log.js
- `node scripts/read-log.js` with no arguments prints the last 20 entries from the most recent log file in human-readable format.
- `node scripts/read-log.js --errors` filters to ERROR and WARNING entries.
- `node scripts/read-log.js --actions route` filters to routing events.
- `node scripts/read-log.js --wp WP-003` filters to a specific work package.
- `node scripts/read-log.js --summary` prints a one-line run overview including token totals.
- `node scripts/read-log.js --slug my-project` targets the latest log matching the slug.
- `node scripts/read-log.js --format json` outputs a JSON array.
- `node scripts/read-log.js --help` prints usage information.
- The script exits cleanly with code 0 on success, 1 on no-logs-found or file-not-found.

### kill-orchestrator.js
- `node scripts/kill-orchestrator.js` with no running processes prints "No orchestrator processes found" and exits 0.
- With stale processes running, it lists them and prompts for confirmation.
- `node scripts/kill-orchestrator.js --force` kills without prompting.
- `node scripts/kill-orchestrator.js --json` outputs the process list as JSON without killing.
- Stale `.orchestrator.lock` files are cleaned up after successful kills.
- On Windows, it prints advisory guidance and exits 0.

### CLI & Persona
- `node scripts/cli.js read-log` and `node scripts/cli.js kill-orchestrator` delegate correctly.
- The interactive CLI menu shows both commands under "Orchestrator".
- The Orchestrator Runner persona (standalone) references both scripts instead of `jq`/`grep`/manual kill commands.
- Persona version is bumped to 1.5.0 and output is rebuilt.
- `personas/changelog.md` has a new entry documenting the persona update.

## Testing Strategy

### read-log.js
- **Manual validation:** Run each flag combination against an existing log file in `orchestrator/logs/` and verify output correctness.
- **Edge cases:** Test with an empty log file, a file with malformed lines, and a non-existent `--file` path.
- **Cross-platform:** The script uses only Node.js built-ins and `path.join()` — no platform-specific commands. Verify on the current platform (macOS); Windows compatibility is assured by design.

### kill-orchestrator.js
- **No-processes case:** Run when no orchestrator is running — verify "No orchestrator processes found" message and exit code 0.
- **Interactive confirmation:** Start a dummy long-running process (e.g. `sleep 999` renamed via `exec -a orchestrate sleep 999`), run the script, verify it lists the process and prompts. Decline and verify exit code 1. Accept and verify the process is killed.
- **`--force` mode:** Same test but with `--force` — verify no prompt and process is killed.
- **Lock file cleanup:** Create a stale `.orchestrator.lock` in a plan directory, run the script, verify it's removed.

### Persona
- **Persona rebuild:** Run `node scripts/build-personas.js --suite standalone --check` to verify generated output matches source.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Key collision in CLI menu** | Verify `l` and `k` are not already taken before registration; pick alternatives if needed. |
| **Large log files slow down sync reads** | Log files rarely exceed 1 MB (typical runs produce 50–200 entries). Sync reads are fine for CLI tools at this scale. If needed in the future, switch to line-by-line streaming via `readline`. |
| **Persona update breaks other sections** | Only modify the JSONL-related and process-conflict subsections; keep all other persona content unchanged. Run `--check` to validate. |
| **Unknown action types in future schema** | `read-log.js` prints unknown action types as-is in text mode, never crashes. Filtering by `--actions` still works for any string value. |
| **Accidental kill of active orchestrator** | Interactive confirmation by default. `--force` is explicitly opt-in. The script lists full command lines so the user/agent can verify before confirming. |
| **Process detection false positives** | Filter out known non-orchestrator matches (`preflight-orchestrator`, `pgrep`, `kill-orchestrator`). Match the same filter logic as `preflight-orchestrator.js`. |
| **`pgrep` not available on some minimal Linux distros** | `pgrep` is part of `procps` which is installed on virtually all Linux distros. If missing, the script prints a clear error and exits 1. |
