# Smoke-Testing the Dispatch Loop

> **Parent:** [orchestrator/README.md](../README.md)

Use this runbook to verify the supervisor dispatch loop is working correctly against a fresh ledger project without running the full agent pipeline.

> **Pre-flight:** Before any smoke test, run `node scripts/preflight-orchestrator.js` from the workspace root to verify the environment is ready (venv, `.env`, MCP dist). See [orchestrator/README.md](../README.md) for details.

---

## 1. Prepare a Test Ledger Project

Create a dedicated plan directory with 2–3 work packages in `READY` state and no in-flight pipelines. Use the MCP server tools (or create `.json` files directly under `.ledger/`) to initialise a minimal project:

```bash
# Example: use the orchestrator CLI in dry-run mode against an existing plan
orchestrate docs/agents/plans/my-test-plan/plan.md --dry-run --max-iterations 5
```

Alternatively, use the Node.js launcher from the workspace root:

```bash
source orchestrator/.venv/bin/activate
node scripts/run-orchestrator.js docs/agents/plans/my-test-plan/plan.md --dry-run --max-iterations 5
```

---

## 2. Expected Console Output (dry-run)

### With an existing ledger (WPs already created)

For a project with two `READY` WPs (WP-001, WP-002, no dependencies):

```
[INFO] Supervisor iteration 1: routing WP-001 → developer
[INFO] Supervisor iteration 2: routing WP-002 → developer
[INFO] Supervisor iteration 3: all WPs COMPLETE → synthesis
```

### Without a ledger (fresh plan, no project initialised)

The supervisor validates the PM routing path once and terminates cleanly:

```
[dry-run] Starting orchestrator in dry-run mode.
[dry-run] Plan   : /path/to/plan.md
[dry-run] Project: /path/to/project
[dry-run] Thread : <uuid>

  [dry-run] pm: WP=—
```

No MCP error messages appear — the missing ledger is expected and logged at INFO level (`dry_run_no_ledger`). The run exits with `Result: SUCCESS`.

In `--dry-run` mode no agents are called — only the routing decisions are executed.

---

## 3. Inspect the JSONL Log

The JSONL log is written to `orchestrator/logs/<timestamp>-<plan-title>.jsonl`. To verify routing decisions:

```bash
# Print all routing events
grep '"action": "route"' orchestrator/logs/<your-log-file>.jsonl | python3 -m json.tool

# Check for any WARNING or ERROR level entries
grep -E '"level": "(WARNING|ERROR)"' orchestrator/logs/<your-log-file>.jsonl

# Count stage dispatches
grep '"action": "route"' orchestrator/logs/<your-log-file>.jsonl | wc -l
```

---

## 4. Verifying Dispatch Correctness

| What to check | How |
|---|---|
| Correct first dispatch | First `"action": "route"` entry should have `"destination": "developer"` for a fresh WP |
| No duplicate dispatches | Each WP ID should appear at most once per routing sweep |
| Safety limit behaviour | Run with `--max-iterations 2`; verify the log ends with `"action": "safety_limit"` at `"level": "WARNING"` |
| Circuit-breaker halt | Manually set `consecutive_failures` ≥ 3 in state; verify `"action": "halted_repeated_failure"` |
