# Plan: Orchestrator Runner & Supervisor Sync

**Created:** 2026-03-18
**Source:** Audit of Orchestrator Runner agent persona against current codebase state
**Project:** ai-insights-dev (this workspace)

> **Depends on:** [`2026-03-18-shared-role-manifest`](../2026-03-18-shared-role-manifest/plan.md) — the shared workflow manifest eliminates the need for manual constant additions in supervisor.py and config.py (WP-1 of this plan). Execute that plan first.

---

## Context

The Orchestrator Runner is a standalone agent persona (`personas/standalone/src/`) that operators use to launch headless AI Insights orchestrator runs against external project codebases. It handles pre-flight checks (locating ai-insights workspace via `$AI_INSIGHTS_ROOT`, validating venv, checking `.env`), launching via `node scripts/run-orchestrator.js`, monitoring JSONL log output, and reporting results.

The ledger's workflow has evolved to support **flexible per-WP pipeline stages** (any subset of 6 stages instead of a fixed 4-stage pipeline), but several components haven't been updated to match:

1. The **supervisor router** (`orchestrator/src/supervisor.py`) only queries 5 of the 9 agent roles, missing Security Auditor and Release Engineer entirely.
2. The **generated persona output files** are stale (v1.0.1) while the source template is at v1.0.2.
3. The runner persona's **log field documentation** references field names that don't match the actual supervisor output.

---

## Work Packages

### WP-1: Add Security Auditor and Release Engineer to Supervisor Router

**Priority:** P1 — These stages are wired in the graph but unreachable; any 6-stage WP will silently skip them.

**Problem:**
The supervisor at `orchestrator/src/supervisor.py` has a hardcoded `_ROLES` list (line ~303) and `_ROLE_STAGE_MAP` dict (line ~77) that only cover 5 roles:

```python
# Current state — orchestrator/src/supervisor.py lines ~77-83
_ROLE_STAGE_MAP: dict[str, str] = {
    "Project Manager": _DEST_PM,
    "Developer": _DEST_DEVELOPER,
    "QA": _DEST_QA,
    "Reviewer": _DEST_REVIEWER,
    "Documentation": _DEST_DOCS,
}

# Current state — orchestrator/src/supervisor.py lines ~303-309
_ROLES = [
    "Project Manager",
    "Developer",
    "QA",
    "Reviewer",
    "Documentation",
]
```

Meanwhile, the graph (`orchestrator/src/graph.py`) already has nodes for `security_auditor` and `release_engineer`, and `orchestrator/src/config.py` already maps them to persona files and pipeline types:

```python
# Already exists in config.py
PIPELINE_AGENT_MAP: dict[str, str] = {
    ...
    "security-audit": "Security Auditor",
    ...
    "release-engineering": "Release Engineer",
    ...
}

PERSONA_FILES: dict[str, str] = {
    ...
    "security_auditor": "personas/ledger/vs-code/5-security-auditor.md",
    ...
    "release_engineer": "personas/ledger/vs-code/7-release-engineer.md",
    ...
}
```

**Required changes in `orchestrator/src/supervisor.py`:**

1. Add two destination constants:
   ```python
   _DEST_SECURITY_AUDITOR = "security_auditor"
   _DEST_RELEASE_ENGINEER = "release_engineer"
   ```

2. Add entries to `_ROLE_STAGE_MAP`:
   ```python
   "Security Auditor": _DEST_SECURITY_AUDITOR,
   "Release Engineer": _DEST_RELEASE_ENGINEER,
   ```

3. Add entries to `_ROLES` list (in correct pipeline order — after QA for Security Auditor, after Reviewer for Release Engineer):
   ```python
   _ROLES = [
       "Project Manager",
       "Developer",
       "QA",
       "Security Auditor",
       "Reviewer",
       "Release Engineer",
       "Documentation",
   ]
   ```

4. Add the new action strings to `_DISPATCH_ACTIONS` if the ledger emits role-specific actions for these roles (check `mcp-server/src/tools/workflow.ts` for `ledger_get_next_action` to see what actions Security Auditor and Release Engineer can receive — they likely get `RUN_SECURITY_AUDIT` and `RUN_RELEASE` or similar, or they may reuse existing action names like `RUN_QA`/`RUN_REVIEW`).

**Source of truth for role names:** `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` array (9 roles).

**Tests to update:** Check `orchestrator/tests/test_supervisor.py` for any hardcoded role lists or routing assertions that need expanding.

**Cross-references:**
- `mcp-server/src/utils/pipeline-maps.ts` → `PIPELINE_AGENT_MAP` (TypeScript source of truth)
- `orchestrator/src/config.py` → `PIPELINE_AGENT_MAP`, `NEXT_STAGE_MAP`, `STAGE_TO_PIPELINE` (Python mirrors)
- `orchestrator/src/graph.py` → node wiring (already has both nodes)
- `orchestrator/src/nodes/security_auditor.py` → node implementation (already exists)
- `orchestrator/src/nodes/release_engineer.py` → node implementation (already exists)

---

### WP-2: Rebuild Stale Persona Output Files

**Priority:** P0 — Trivial to fix, blocks correct agent behavior.

**Problem:**
The source template `personas/standalone/src/content/orchestrator-runner.md` is at v1.0.2 (meta: `personas/standalone/src/meta/orchestrator-runner.yaml`), but the generated outputs are at v1.0.1 and still reference the deleted `scripts/setup-orchestrator.js`:

**Stale generated files:**
- `personas/standalone/vs-code/orchestrator-runner.md` (v1.0.1, 4 stale references)
- `personas/standalone/claude-code/orchestrator-runner.md` (v1.0.1, 4 stale references)

**Stale references in generated files (not in source):**
- Line ~96-98: `node scripts/setup-orchestrator.js` (should be `node scripts/cli.js setup --components orchestrator`)
- Line ~241: `run scripts/setup-orchestrator.js first` (should be `run node scripts/cli.js setup --components orchestrator first`)
- Line ~242: `Re-run node scripts/setup-orchestrator.js` (should be `Re-run node scripts/cli.js setup --components orchestrator`)

**Fix:** Run from workspace root:
```bash
node scripts/build-personas.js
```

This regenerates all persona output files from their source templates. No source changes needed — the source is already correct.

**Validation:** After rebuild, confirm no occurrences of `setup-orchestrator` in the generated files:
```bash
grep -r "setup-orchestrator" personas/standalone/vs-code/ personas/standalone/claude-code/
```

---

### WP-3: Fix Log Field Names in Runner Persona

**Priority:** P2 — Cosmetic; agents may look for wrong fields but will still function.

**Problem:**
The runner persona's "Key log fields to watch" table documents field values that don't exactly match actual supervisor output:

**In `personas/standalone/src/content/orchestrator-runner.md` (Monitoring Progress section):**

| Runner says | Supervisor actually emits | Notes |
|-------------|--------------------------|-------|
| `action: stage_complete` | Varies by node — nodes set `stage_result` and `stage_success` in state update; log entries use `action: "route"` for supervisor decisions | Need to verify actual node log output format in `orchestrator/src/nodes/*.py` |
| `action: supervisor_route` | `action: "route"` | Supervisor uses `_log_entry(action="route", ...)` at `supervisor.py` line ~389 |
| `result: PASS` / `result: FAIL` | Not a top-level log field; `stage_success: true/false` is in state, not JSONL | Need to check JSONL writer to see actual field names |

**Required investigation before fixing:**
1. Read `orchestrator/src/nodes/*.py` — how do nodes add entries to `run_log`?
2. Read JSONL log writing code — is it in `cli.py`? What fields does it write per event?
3. Compare actual field names against what the runner documents.

**Files to change:** `personas/standalone/src/content/orchestrator-runner.md` (the source, not generated output)

**After editing source:** Rebuild personas with `node scripts/build-personas.js`

---

### WP-4: Bump Runner Version

**Priority:** P2 — After all other WPs are done.

**Problem:** Version should reflect the updates made.

**File:** `personas/standalone/src/meta/orchestrator-runner.yaml`

**Changes:**
- `version: "1.0.2"` → `"1.0.3"` (or `"1.1.0"` if WP-1's supervisor fix changes observable behavior)
- `last_updated:` → `"2026-03-18"`

**After editing:** Rebuild personas with `node scripts/build-personas.js`

---

## Execution Order

```
WP-1 (supervisor fix) ─────────────────────┐
WP-3 (log field names) ────────────────────┤
                                            ├─→ WP-4 (version bump) ─→ WP-2 (rebuild personas)
                                            │
```

WP-1 and WP-3 are independent and can proceed in parallel. WP-4 depends on both being complete (to set the correct version). WP-2 (rebuild) must be last since it regenerates output from the source that WP-3 and WP-4 modify.

---

## Acceptance Criteria

1. `orchestrator/src/supervisor.py` queries all 7 pipeline roles (PM, Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation) and routes to the corresponding graph nodes.
2. All existing orchestrator tests pass (`cd orchestrator && python -m pytest`).
3. No references to `setup-orchestrator.js` remain in any generated persona file.
4. The runner persona's log field documentation matches actual JSONL output.
5. Generated persona files are in sync with source (`node scripts/build-personas.js --check` returns 0).
