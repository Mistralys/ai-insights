# Plan

## Summary

Act on all six strategic recommendations and the ten open technical-debt items
identified in the `2026-02-25-orchestrator-smoke-test` synthesis. The work is
grouped into four targeted phases: (1) critical infrastructure hardening
(pre-flight dist guard), (2) observability quick-wins (token tracking, JSONL
field consistency, test fixture correctness, delta run counter), (3)
documentation completion (3-path routing model, JSONL schema reference, README
cleanup), and (4) dependency hygiene (Pydantic-V2-native `langchain-core`).

A fifth concern — the ledger `review_exempt` pipeline flag (Recommendation #6)
— is explicitly **out of scope** for this rework because it requires changes to
the MCP server's ledger schema and pipeline state-machine, warranting its own
dedicated plan.

---

## Architectural Context

All changes are confined to the `orchestrator/` sub-project except where
explicitly noted.

**Key files:**

| File | Relevance |
|------|-----------|
| `orchestrator/src/nodes/__init__.py` | `create_stage_node` — `stage_complete` dict missing `tokens_used` |
| `orchestrator/src/cli.py` | `run_end` log entry missing `level`; `initial_state` dict; "WPs done" counter |
| `orchestrator/src/state.py` | `WorkflowState` TypedDict — needs `wps_completed_this_run` field |
| `orchestrator/src/supervisor.py` | 3-path routing logic (SOURCE OF TRUTH for routing diagram) |
| `orchestrator/src/mcp_client.py` | `_sync_cleanup` — `new_event_loop()` path missing `loop.close()` |
| `orchestrator/tests/test_integration.py` | `_initial_state()` missing `consecutive_failures: {}`; `make_mcp_tools()` return type |
| `orchestrator/README.md` | Missing: routing model diagram, JSONL schema section, test name correction |
| `orchestrator/pyproject.toml` | `langchain-core` / `langchain-anthropic` pinning for Pydantic V2 |
| `orchestrator/requirements.txt` | Mirror of pyproject.toml changes |
| `orchestrator/.env.example` | `[checkpoint]` prerequisite note |
| `mcp-server/package.json` | Build script entry point for the pre-flight guard |

**No changes are needed in:** `personas/`, `scripts/`, `mcp-server/src/`,
`mcp-server/tests/`.

---

## Approach / Architecture

### Phase 1 — Pre-flight dist Freshness Guard (Recommendation #1 / High debt)

Create a shell script `orchestrator/run.sh` that:

1. Locates `mcp-server/src/` and `mcp-server/dist/`.
2. Compares the most-recently-modified source timestamp against the most-recently-modified dist file using standard POSIX tools (`find`, `stat`).
3. If source is newer, runs `npm run build` in `mcp-server/` before proceeding.
4. Passes all remaining CLI arguments through to `orchestrate "$@"`.

This fulfills the recommendation without altering `cli.py` or coupling the
Python package to Node build tooling. The script is opt-in (users can still
call `orchestrate` directly), but the README and `.env.example` will recommend
`./run.sh` as the canonical entry point for production use.

No Makefile is introduced: the workspace has no existing Makefile and adding
one just for a single target would be disproportionate.

### Phase 2 — Observability Quick-Wins (Recommendations #2, #3 partial; debt items M/L)

Five targeted, independent changes:

**2a. Token tracking (`nodes/__init__.py`)**
Extract `usage_metadata` from the final message in `result["messages"]`.
Deep Agents returns a `dict` with `usage_metadata` on the AIMessage; the
field schema follows LangChain's `UsageMetadata`: `{"input_tokens": int,
"output_tokens": int, "total_tokens": int}`. Store the extracted dict (or
`None` if not present) as `tokens_used` in the `stage_complete` JSONL dict.

**2b. `run_end` `level` field (`cli.py`)**
Add `level="INFO"` (or `"ERROR"` when `outside_errors` is non-empty) to the
`run_end` `run_logger.log(...)` call. One-line fix.

**2c. `_initial_state()` missing `consecutive_failures` (`test_integration.py`)**
Add `"consecutive_failures": {}` to the dict returned by `_initial_state()`.
Without this, any test that calls `state["consecutive_failures"]` directly
raises a `KeyError`.

**2d. `wps_completed_this_run` delta counter (`state.py`, `supervisor.py`, `cli.py`)**
Add a new `wps_completed_this_run: int` field to `WorkflowState` (defaulting
to `0`). In `supervisor_node`, when a WP transitions to a "none" routing
(all pipelines done), increment the counter. In `cli.py`, include the counter
in the run summary print.  
*Note:* This requires updating `test_state.py` to account for the new field.

**2e. `loop.close()` after `new_event_loop()` (`mcp_client.py`)**
In `_sync_cleanup`, after `loop.run_until_complete(aclose())` in the
`new_event_loop()` branch, add `loop.close()` to prevent a loop object leak.

### Phase 3 — Documentation Completion (Recommendations #3, #4; debt items L)

**3a. Routing model diagram + JSONL schema (`orchestrator/README.md`)**

Add two new sections:

- **Supervisor routing model** — ASCII-art flowchart of the 3-path exit model
  (route to synthesis, route to `__end__` all-in-flight, circuit-breaker
  `__end__`) plus the standard routing decision tree (no WPs → PM, all COMPLETE
  → synthesis, BLOCKED only → `__end__`, actionable WPs → developer / QA /
  reviewer / docs).
- **JSONL log schema** — table documenting every field in the log object:
  `timestamp`, `stage`, `wp_id`, `action`, `destination`, `result`, `level`,
  plus `error` (error-only), `tokens_used` (stage_complete), `thread_id`
  (run_start/end), `dry_run` (run_start).

**3b. Smoke-test runbook (`orchestrator/README.md` or new `docs/` file)**

Document the correct procedure for validating the dispatch loop as described
in Recommendation #3: create a dedicated ledger project with 2–3 scripted WPs
in `READY` state with no in-flight pipelines, then run `orchestrate` against
it. Reference [orchestrator/README.md](orchestrator/README.md) for the exact
commands.

**3c. Minor README corrections (debt items L)**

- Fix the stale test function name reference (`test_safety_limit_terminates_cleanly`).

**3d. `.env.example` checkpoint note**

Add a comment explaining that `pip install -e '.[checkpoint]'` is a
prerequisite when using `--resume`.

**3e. `make_mcp_tools()` return type annotation (`test_integration.py`)**

Widen from implicit `list[MagicMock]` to `list[Any]`.

### Phase 4 — Dependency Hygiene (Recommendation #5)

Pin `langchain-core` to `>=0.3.45` (the first version that fully drops Pydantic
V1 shims) and `langchain-anthropic` to `>=0.3.10`. Update both `pyproject.toml`
and `requirements.txt`. Run `pip install -e '.[anthropic,dev]'` in the venv and
confirm:
1. `CompatibilityWarning` from `langchain_core._api.deprecation` is gone in
   Python 3.14.
2. All 160 tests continue to pass.

If the required versions are not yet released / introduce breaking API changes,
document the blocker in the plan notes and defer the pin — correctness is more
important than silencing warnings.

---

## Rationale

- The pre-flight guard is implemented as a shell script rather than a Python
  check inside `cli.py` to keep the orchestrator package free of Node.js
  toolchain dependencies.
- Token tracking uses the existing `usage_metadata` field on LangChain
  AIMessage objects rather than introducing an SDK wrapper, matching the
  architecture convention of zero new dependencies for the orchestrator core.
- `wps_completed_this_run` is added to `WorkflowState` (not `cli.py` local
  state) so the counter is available to future nodes and is persisted in
  LangGraph checkpoints.
- The `review_exempt` ledger feature is deferred because it requires changes to
  the MCP server's schema, pipeline state machine, and Zod validation — a scope
  that exceeds a rework plan focused on the orchestrator.

---

## Detailed Steps

1. **Create `orchestrator/run.sh`** — pre-flight dist freshness guard script.
2. **Update `orchestrator/README.md`** — add `run.sh` usage to the Quick Start
   section.
3. **Update `orchestrator/src/nodes/__init__.py`** — extract `tokens_used` from
   `result["messages"][-1].usage_metadata`; add it to `stage_complete` dict.
4. **Update `orchestrator/src/cli.py`** — add `level` to `run_end` log entry;
   add `wps_completed_this_run: 0` to `initial_state`; include it in the run
   summary.
5. **Update `orchestrator/src/state.py`** — add `wps_completed_this_run: int`
   to `WorkflowState`.
6. **Update `orchestrator/src/supervisor.py`** — increment
   `wps_completed_this_run` when `_route_for_wp` returns `None` (WP done).
7. **Update `orchestrator/src/mcp_client.py`** — add `loop.close()` after
   `loop.run_until_complete(aclose())` in `_sync_cleanup`.
8. **Update `orchestrator/tests/test_integration.py`** — add
   `"consecutive_failures": {}` to `_initial_state()`; widen `make_mcp_tools()`
   return type; add `"wps_completed_this_run": 0` to `_initial_state()`.
9. **Update `orchestrator/tests/test_state.py`** — add
   `wps_completed_this_run` to field-presence assertions.
10. **Update `orchestrator/README.md`** — add routing model diagram, JSONL
    schema section, smoke-test runbook, fix stale test function name.
11. **Update `orchestrator/.env.example`** — add checkpoint prerequisite comment.
12. **Pin `langchain-core` / `langchain-anthropic` in `pyproject.toml` and
    `requirements.txt`** — verify no `CompatibilityWarning`, confirm 160 tests
    pass.
13. **Run the full test suite** — `pytest orchestrator/tests/ -q` must return
    160+ pass, 0 fail.

---

## Dependencies

- Steps 4–6 and 8–9 share the `wps_completed_this_run` field — implement steps
  5 then 6 then 4 then 8 then 9 to avoid KeyErrors during partial edits.
- Step 12 (dep pinning) must be validated in an actual venv on the target
  Python version; verification is a prerequisite before marking the step
  complete.
- Steps 1 and 2 are independent of all other steps.

---

## Required Components

**Modified files (existing):**

- `orchestrator/run.sh` ← **new file**
- `orchestrator/src/nodes/__init__.py`
- `orchestrator/src/cli.py`
- `orchestrator/src/state.py`
- `orchestrator/src/supervisor.py`
- `orchestrator/src/mcp_client.py`
- `orchestrator/tests/test_integration.py`
- `orchestrator/tests/test_state.py`
- `orchestrator/README.md`
- `orchestrator/.env.example`
- `orchestrator/pyproject.toml`
- `orchestrator/requirements.txt`

**No new modules or services are introduced.**

---

## Assumptions

- The `orchestrator/` venv is Python 3.11+ (as documented). The loop-leak fix
  in `_sync_cleanup` targets `new_event_loop()` scenarios (atexit, non-async
  code paths) and is safe on all supported versions.
- `langchain-core >=0.3.45` exists and is compatible with `deep-agents >=0.3`
  and `langchain-mcp-adapters >=0.2`. If not, the Pydantic pin is deferred with
  a documented blocker note.
- `agent.ainvoke()` result messages carry `.usage_metadata` as a plain `dict`
  attribute (or `None`). The extraction must be guarded with `getattr(msg,
  "usage_metadata", None)` to handle models that do not return token counts.
- `orchestrator/.env.example` exists (it was created/updated in WP-001 of the
  prior plan).

---

## Constraints

- **No new production dependencies** may be added to `orchestrator/` beyond
  updating the version pins for existing packages.
- **No changes to `mcp-server/src/`** — the pre-flight guard calls `npm run build`
  externally; the orchestrator does not import or depend on mcp-server directly.
- **Test count must not decrease** — the 160-test baseline from the prior plan
  must be maintained or exceeded.
- **`orchestrator/run.sh` must be POSIX-compatible** — no Bash-only syntax;
  the script derives its path relatively so it can be called from any working
  directory.

---

## Out of Scope

- **Ledger `review_exempt` pipeline flag** (Recommendation #6) — requires MCP
  server schema, state-machine, and Zod changes; merits its own plan.
- **Dedicated smoke-test ledger project creation** — the runbook will document
  *how* to create and use one, but seeding actual ledger fixture data is an
  operational task, not a code change.
- **CI pipeline integration** — no GitHub Actions or other CI configuration is
  in scope.
- **Git operations** — the user manages commits.

---

## Acceptance Criteria

1. `orchestrator/run.sh` exists, is executable, and correctly triggers an
   `npm run build` in `mcp-server/` when any file under `mcp-server/src/` is
   newer than any file under `mcp-server/dist/`; skips the build when already
   fresh.
2. Every `stage_complete` JSONL entry produced by `create_stage_node` contains
   a `tokens_used` key (value may be `null` if the model provides no metadata).
3. Every `run_end` JSONL entry contains a `level` field (`"INFO"` or `"ERROR"`).
4. `_initial_state()` in `test_integration.py` includes `consecutive_failures: {}`
   and `wps_completed_this_run: 0`.
5. `WorkflowState` includes `wps_completed_this_run: int`.
6. `_sync_cleanup` closes the event loop when the `new_event_loop()` path is taken.
7. `orchestrator/README.md` contains (a) a supervisor routing model section with
   the 3-path exit diagram, (b) a JSONL log schema field-reference table, and
   (c) the smoke-test runbook section.
8. `orchestrator/.env.example` documents the `[checkpoint]` install prerequisite.
9. `pyproject.toml`/`requirements.txt` pins do not introduce `CompatibilityWarning`
   from `langchain_core._api.deprecation` on the target Python version (or the
   blocker is documented if the required release does not yet exist).
10. `pytest orchestrator/tests/ -q` reports ≥ 160 passed, 0 failed.

---

## Testing Strategy

- **Unit tests:** `test_state.py` verifies `WorkflowState` field presence
  including `wps_completed_this_run`. `test_supervisor.py` adds one new test
  for the counter increment path. `test_nodes.py` asserts `tokens_used` key
  presence in the returned state dict for both the success and error branches.
- **Integration tests:** `test_integration.py` `_initial_state()` fix is also a
  regression guard — the next time `state["consecutive_failures"]` is accessed
  directly, the test won't silently mask a `KeyError`.
- **Manual smoke verification:** After dep pinning (Step 12), run `python -c
  "import langchain_core"` and confirm no `CompatibilityWarning` is printed.
- **Shell script verification:** Run
  `touch mcp-server/src/index.ts && ./orchestrator/run.sh --dry-run path/to/plan.md`
  and confirm `npm run build` output appears; then run again immediately and
  confirm it is skipped.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`langchain-core` pin breaks deep-agents or mcp-adapters** | Run full test suite before finalising; if any test fails, revert pin and document as deferred debt |
| **`usage_metadata` attribute missing on some model responses** | Guard with `getattr(msg, "usage_metadata", None)` — `tokens_used` becomes `null`, matching current state and preserving schema compatibility |
| **`wps_completed_this_run` counter double-counts completed WPs from previous runs** | Counter resets to `0` in `initial_state`; it accumulates only within a single graph execution; its semantics are documented in the JSONL schema section |
| **`run.sh` not executable after checkout** | README Quick Start documents `chmod +x orchestrator/run.sh`; alternatively set execute bit via `git update-index --chmod=+x` |
| **Supervisor changes (step 6) cause regression** | The counter increment is additive only — no existing routing logic is altered; covered by existing `test_supervisor.py` suite and new counter test |
