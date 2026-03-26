# Plan

## Summary

Improve the Orchestrator Runner persona and related infrastructure based on a
post-mortem of a real run session where the agent wasted significant tokens on
excessive polling, used wrong JSONL field names, suffered terminal session
contamination, and misinterpreted exit codes. Six concrete issues were
identified; all have fixes within the persona source and one MCP tool
description.

## Architectural Context

The Orchestrator Runner is a standalone persona defined at
`personas/standalone/src/content/orchestrator-runner.md`. It generates VS Code
agent files via the build system in `scripts/build-personas.js`. The persona
instructs an AI agent to operate the orchestrator headlessly — pre-flight,
launch, monitor, and report.

Key files involved:

- `personas/standalone/src/content/orchestrator-runner.md` — persona content
  (the main target of this plan)
- `personas/standalone/src/meta/orchestrator-runner.yaml` — persona metadata
- `mcp-server/src/tools/project-lifecycle.ts` — `ledger_detect_project` tool
  registration and schema
- `orchestrator/docs/jsonl-log-schema.md` — JSONL field reference

The persona's "Monitoring Progress" section (lines ~147–210) provides guidance
on live terminal output and JSONL log parsing. The issues identified stem from
gaps in this guidance.

## Approach / Architecture

All fixes target the persona source content and one MCP tool description.
No runtime code, orchestrator logic, or build system changes are needed.

1. **Persona content improvements** — add polling discipline, ready-to-use
   JSONL commands, dry-run timing guidance, and exit code checking rules.
2. **Tool description improvement** — make `ledger_detect_project`'s required
   `cwd_path` argument more prominent in the tool description text.

## Rationale

The root causes fall into two categories:

- **Missing agent guidance** — the persona doesn't tell the agent _how_ to
  poll efficiently, _which_ JSONL fields to use, or how to avoid terminal
  session mixing. These are solvable by adding explicit instructions.
- **Ambiguous tool description** — the PM agent called `ledger_detect_project`
  without `cwd_path`. While this is an LLM inference error, a more directive
  tool description can reduce the failure rate.

## Detailed Steps

### 1. Add polling discipline to the Monitoring section

In `personas/standalone/src/content/orchestrator-runner.md`, after the
"Live terminal output" subsection, add a new subsection:

**"Polling discipline"** with these rules:
- LLM agent calls typically take 60–120 seconds. Do not check progress more
  frequently than every 30 seconds.
- When checking the JSONL log line count (`wc -l`), if the count has not
  changed between two checks, wait at least 60 seconds before the next check.
- Never poll `get_terminal_output` more than 3 times consecutively without new
  output. After 3 empty checks, switch to checking the JSONL log file instead.
- Limit total polling iterations to 10 before pausing and informing the user.

### 2. Add ready-to-use JSONL parsing commands

In the "JSONL log file" subsection, add a "Quick parsing" block with
copy-paste shell commands that use the correct field names:

```bash
# Summary of all events (use `action`, not `event`):
python3 << 'PYEOF'
import json, os, sys
logpath = sys.argv[1]
with open(logpath) as f:
    for line in f:
        d = json.loads(line.strip())
        stage = d.get('stage','')
        action = d.get('action','')
        level = d.get('level','')
        wp = d.get('wp_id','')
        err = str(d.get('error',''))[:100]
        print(f"[{stage}] {action} wp={wp} level={level}"
              + (f" error={err}" if err else ""))
PYEOF

# Watch for new events in real time:
tail -f <logpath> | python3 -c "
import sys, json
for l in sys.stdin:
    d = json.loads(l.strip())
    print(f\"[{d.get('stage','')}] {d.get('action','')} wp={d.get('wp_id','')}\")"
```

**Critical note:** The JSONL field for the event type is `action`, not `event`.
Reference: `orchestrator/docs/jsonl-log-schema.md`.

### 3. Add terminal session management guidance

Add a new subsection **"Terminal session hygiene"** in Monitoring Progress:
- Always launch the full run as a **background** terminal process
  (`isBackground: true`) to avoid blocking the agent's foreground terminal.
- Never run the dry run and the full run in the same foreground terminal
  session — the dry run's buffered output may contaminate subsequent commands.
- After running `cd` + `npm run build` in the foreground terminal, be aware
  the cwd has changed. Use `cd "$AI_INSIGHTS_ROOT"` before subsequent commands.

### 4. Add dry-run and exit code verification rules

In the "Dry run" subsection under Launching, add:
- The dry run may take 30–90 seconds. Run it as a foreground command with a
  sufficient timeout (e.g. 120 seconds), or run it in the background and
  monitor via `get_terminal_output`.
- **Always check the exit code** before declaring success. Exit code 0 = pass,
  exit code 130 = interrupted (SIGINT), exit code 1 = error.
- If the dry run was interrupted (exit code 130) but the summary output shows
  "Result: SUCCESS", the dry run _did_ complete — the interruption happened
  during Python's thread cleanup. This is safe to proceed from, but note it
  for the user.

### 5. Improve `ledger_detect_project` tool description

In `mcp-server/src/tools/project-lifecycle.ts` (line ~851), update the
tool's `description` string to make the required argument clearer:

**Before:**
```
'Detect the active project from the current workspace path when project_path
is not explicitly provided. Accepts a working directory path (cwd_path), ...'
```

**After:**
```
'Detect the active project from a workspace path. REQUIRED param: cwd_path
(absolute directory path). Cross-references cwd_path against all project
roots stored in the centralized ledger and returns the unique project
plan_path. Returns NOT_FOUND if no known project root is an ancestor of
the given path, or AMBIGUOUS (with candidate list) if more than one
project matches.'
```

Making "REQUIRED param: cwd_path" prominent reduces the chance of the LLM
omitting it.

### 6. Add JSONL field quick-reference to the persona

At the end of the "JSONL log file" subsection, add a compact field reference:

| Field | Description |
|-------|-------------|
| `action` | Event type (e.g. `stage_start`, `stage_complete`, `stage_error`, `route`, `run_end`) |
| `stage` | Node name (e.g. `pm`, `developer`, `supervisor`, `cli`) |
| `wp_id` | Work package ID (empty for supervisor/cli events) |
| `level` | `INFO`, `WARNING`, or `ERROR` |
| `result` | `PASS` or `FAIL` (on `stage_complete` / `stage_error`) |
| `error` | Error message (only on `ERROR` level entries) |
| `duration_s` | Stage duration in seconds |
| `thread_id` | Run identifier (on `run_start` / `run_end`) |

## Dependencies

- None — all changes are documentation/description updates.

## Required Components

- `personas/standalone/src/content/orchestrator-runner.md` — persona content
  (new subsections + edits)
- `mcp-server/src/tools/project-lifecycle.ts` — tool description update
  (line ~851)

## Assumptions

- The JSONL log schema at `orchestrator/docs/jsonl-log-schema.md` is accurate
  and stable (the field name is `action`, not `event`).
- The Orchestrator Runner persona is the only persona that operates the
  orchestrator headlessly (no other persona needs these monitoring rules).

## Constraints

- Persona source files are templates — never edit the generated output under
  `personas/standalone/vs-code/` or `personas/standalone/claude-code/`.
- After editing the persona source, run `node scripts/build-personas.js` to
  regenerate output, then `node scripts/build-personas.js --check` to verify.
- Tool description changes require `cd mcp-server && npm run build` to take
  effect for the orchestrator.

## Out of Scope

- Orchestrator runtime changes (supervisor routing, retry logic, circuit
  breaker) — those are working correctly.
- LLM agent behavior fixes — we can only guide via better tool descriptions
  and persona instructions; we cannot control how the LLM calls tools.
- Changes to the JSONL schema or logging infrastructure.
- VS Code terminal API limitations (background/foreground semantics are
  platform constraints, not ours to change).

## Acceptance Criteria

- [ ] The persona's Monitoring section includes polling discipline rules with
      explicit interval guidance.
- [ ] The persona includes ready-to-use JSONL parsing commands with correct
      field names (`action`, not `event`).
- [ ] The persona includes terminal session hygiene guidance.
- [ ] The persona includes dry-run timing and exit code verification rules.
- [ ] `ledger_detect_project` tool description starts with "REQUIRED param:
      cwd_path".
- [ ] The persona includes a compact JSONL field quick-reference table.
- [ ] `node scripts/build-personas.js --check` passes after changes.
- [ ] `cd mcp-server && npm run build` succeeds after the tool description
      change.

## Testing Strategy

- Run `node scripts/build-personas.js --check` to verify persona output is
  fresh after source edits.
- Build the MCP server (`cd mcp-server && npm run build`) to verify the tool
  description change compiles.
- Manual review: read the generated persona file to confirm the new sections
  are coherent and correctly assembled by the template engine.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Polling rules too restrictive** — agent waits too long and misses rapid failures | Set floor at 30s (not 60s); allow 3 consecutive fast checks before throttling |
| **Tool description change breaks existing personas** — PM persona references the old description | The PM persona reads tool descriptions dynamically from the MCP server; it does not hardcode them. No sync issue. |
| **Ready-to-use commands fail on Windows** | Use `python3` heredoc syntax which works on all platforms; note the `tail -f` command is Unix-only and provide the JSONL log path for manual inspection on Windows |
