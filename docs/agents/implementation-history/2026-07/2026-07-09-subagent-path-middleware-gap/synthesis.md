# Synthesis Report — subagent-path-middleware-gap

**Plan:** `2026-07-09-subagent-path-middleware-gap`
**Date:** 2026-07-09
**Status:** COMPLETE — 2/2 WPs, all 8 pipeline stages PASS

---

## Executive Summary

This plan fixed two root-cause issues that caused orchestrator runs with Deep Agents subagents to fail silently or produce corrupt state. **Fix 1** propagated `PathNormalizationMiddleware` into subagent spec dicts so that subagent file operations receive the same host-path → virtual-path rewriting as the main agent — eliminating doubled directory structures and infinite retry loops under `virtual_mode`. **Fix 2** added a pre-run plan-folder date-rename function (`_maybe_rename_plan_dir`) to `cli.py`, executed before lock acquisition and state initialization, so the PM's rename directive becomes a no-op mid-run and all downstream state (lock path, sidecar metadata, JSONL logger, MCP `project_path`) is initialized with the correct path from the start. Together the two fixes eliminate an entire class of ghost-directory and stale-path failures in subagent-enabled orchestrator runs. Issues 3 ("unknown" repo name) and 4 (cross-workspace ledger mismatch) — downstream consequences of the stale-path bug — were resolved as a side effect of Fix 2.

---

## Metrics

| Metric | WP-001 | WP-002 |
|--------|--------|--------|
| **Tests passed** | 1,100 | 1,122 |
| **Tests failed** | 0 | 3 (pre-existing) |
| **New tests added** | 3 (TestSubagentMiddlewarePropagation) | 8 (7 unit + 1 integration) |
| **Pipeline stages** | 4/4 PASS | 4/4 PASS |
| **Acceptance criteria met** | 6/6 | 10/10 |

Pre-existing failures (unchanged by this plan):

- `test_stream_retry::test_401_propagates_immediately` — pre-existing HTTP 401 retry logic bug
- `test_deep_agent_integration::test_developer_stage_live` — requires live Anthropic API key
- `test_deep_agent_integration::test_pm_stage_live` — requires live Anthropic API key

---

## Files Modified

**WP-001 (Subagent middleware propagation)**
- `orchestrator/src/nodes/__init__.py` — 5-line middleware injection loop after `load_subagents()`
- `orchestrator/tests/test_nodes.py` — `TestSubagentMiddlewarePropagation` (3 tests)
- `orchestrator/requirements.txt` — pinned `deepagents>=0.3,<1`
- `orchestrator/pyproject.toml` — pinned `deepagents>=0.3,<1`
- `orchestrator/docs/agents/project-manifest/constraints.md` — Constraint §26 subagent scope
- `orchestrator/docs/agents/project-manifest/api-surface.md` — `create_stage_node` entry
- `orchestrator/README.md` — `TestSubagentMiddlewarePropagation` mention

**WP-002 (Pre-run plan folder rename)**
- `orchestrator/src/cli.py` — `_SLUG_DATE_RE`, `_maybe_rename_plan_dir()`
- `orchestrator/tests/test_cli.py` — `TestMaybeRenamePlanDir` (7 tests) + `TestRunFlow` (1 test)
- `orchestrator/docs/agents/project-manifest/constraints.md` — Constraint §27
- `orchestrator/docs/agents/project-manifest/api-surface.md` — `_maybe_rename_plan_dir`, `_SLUG_DATE_RE` entries
- `orchestrator/docs/agents/project-manifest/data-flows.md` — Flow 5 pre-run rename note
- `orchestrator/changelog.md` — v1.4.0 entry covering both WPs

---

## Strategic Recommendations (Gold Nuggets)

1. **Subagent spec mutation safety:** The `setdefault/append` injection idiom is safe because `load_subagents()` caches only `(description, system_prompt)` string tuples, not dict objects — every call returns fresh dicts. If caching is ever extended to dict-level (for performance), callers must shallow-copy specs before mutation to avoid accumulating middleware across invocations. Forward-looking comment added at `nodes/__init__.py:903–905`.

2. **`_plan_hash` cross-boundary invariant:** `_plan_hash` and `_run_status_path` are intentionally computed from `plan_path` *before* `_maybe_rename_plan_dir()` fires. The TypeScript GUI computes the same run-status hash before spawning the orchestrator process. This means the hash must remain stable even if the folder is renamed — the pre-rename path is the shared key. Never reorder these assignments; the invariant is now documented in Constraint §27 with a correct/wrong code example.

3. **Tombstone-based integration test pattern:** `TestRunFlow.test_plan_hash_stability_after_rename` verifies `_plan_hash` stability via observable side-effect (pre-rename hash tombstone file exists, post-rename hash tombstone file does not) without accessing private locals. This approach is clean, non-brittle, and reusable for future `_run()` integration tests that need to assert initialization-order invariants.

4. **`setdefault/append` vs `update` for middleware injection:** Using `setdefault` + `append` (rather than replacing the list or merging with `update`) correctly handles all three spec shapes: no `middleware` key, empty list, and pre-existing entries. The QA edge-case tests verified all three; the pattern is the right template for any future middleware injection site.

5. **Three stale api-surface.md descriptions corrected (WP-001 documentation):** The `path_middleware.py` section had three pre-existing inaccuracies — the module blurb incorrectly claimed macOS/Linux is a no-op, `__init__` omitted the POSIX `len > 1` branch, and `_rewrite_args` only described Windows coverage. These contradicted Constraint §26 and the actual source. The Documentation pipeline corrected all three as a side effect of addressing the Reviewer's documentation-forward. When API surface descriptions drift from both the code and constraints, the constraints.md entry is the right cross-check source.

---

## Deferred & Follow-Up Items

### Deferred (intentionally postponed)

| Source | Agent | Description | Priority / Rationale |
|--------|-------|-------------|---------------------|
| Plan | Planner | **`general_purpose` subagent middleware propagation** — the auto-created `general_purpose` subagent does not accept per-instance middleware via the spec mechanism; requires upstream Deep Agents API change. Risk is low (rarely used for file operations). | Low — deferred until upstream API supports it |

### Out-of-Scope (beyond this plan's boundaries)

| Source | Agent | Description | Priority / Rationale |
|--------|-------|-------------|---------------------|
| WP-001 QA | QA | **`test_401_propagates_immediately` failure** — pre-existing HTTP 401 retry logic bug in `test_stream_retry.py`; confirmed via `git stash` to pre-date this work. | Medium — independent fix needed |
| WP-001 QA | QA | **`test_developer_stage_live` / `test_pm_stage_live`** — require live Anthropic API key; environment gap, not a code defect. | Low — developer environment concern |
| WP-002 QA | QA | **`_plan_hash` asymmetry** — when `args.plan` is a directory path the hash is computed from the directory string; when it's a file path it's computed from the file path. Pre-existing inconsistency unrelated to this plan. | Low — consistency review for future plan |
| WP-002 impl + review | Developer / Reviewer | **OSError errno in `_maybe_rename_plan_dir` warning** — logging `exc.errno` would help diagnose WinError 5 / WinError 183 failures. Surfaced by both Developer and Reviewer. | Low — enhancement for Windows diagnostics |
| WP-001 documentation | Documentation | **CTX regeneration** — `.context/orchestrator/manifest.md` still contains the stale `path_middleware` module description. Run `node scripts/cli.js ctx-generate` to refresh. | Low — run before next CTX-dependent tooling use |

---

## Next Steps

1. **Regenerate CTX docs** — ~~run `node scripts/cli.js ctx-generate` to refresh `.context/orchestrator/` snapshots with the new api-surface and constraint entries.~~ **DONE**
2. **Fix `test_401_propagates_immediately`** — ~~the HTTP 401 retry logic bug in `test_stream_retry.py` is a pre-existing failure that predates this plan; consider a focused plan to address the retry contract.~~ **DONE** Already fixed in main - merged from upstream.
3. **Monitor `general_purpose` subagent middleware** — ~~if users encounter path doubling from `general_purpose` subagent file operations, revisit the upstream Deep Agents API to determine when per-instance middleware can be passed for auto-created subagents. ~~ **DOCUMENTED** Added to the project manifest for visibility.
4. **Verify orchestrator v1.4.0 in root changelog** — ~~`orchestrator/changelog.md` has the v1.4.0 entry; root `changelog.md` should include an orchestrator module entry at the next release cut.~~ **DEFERRED** Will be handled by the changelog agent.
