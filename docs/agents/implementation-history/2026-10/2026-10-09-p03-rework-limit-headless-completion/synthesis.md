# Synthesis: P03 Rework Limit Headless Completion

**Status:** COMPLETE (6/6 work packages, all pipeline stages PASS)

### Outcome Summary

A work package that reaches the rework limit is now recorded by the ledger, cancelled by the orchestrator supervisor, and the headless run proceeds to synthesis instead of looping on refused starts. `ledger_start_pipeline` and `ledger_begin_work` now persist the counter on the refused start, `ledger_begin_work` ignores auto-cancelled prerequisite runs like `ledger_start_pipeline`, and the supervisor handles `REVIEW_REWORK_LIMIT` itself per spec section 16.3c. Spec v2.8.0, mcp-server v2.12.0 and orchestrator v1.5.0 were delivered, with a tool-driven integration test and a scripted orchestrator end-to-end test proving the path. Two live-LLM orchestrator tests still fail on an invalid API key (environmental).

### Metrics

| WP | Title | Stages | Tests |
|---|---|---|---|
| WP-001 | Spec revision, manifest alignment | impl, qa, review, release, docs: PASS | 39 passed (manifest test) |
| WP-002 | Persist rework counter on refused start | impl, qa, review, docs: PASS | 4227 passed, 0 failed |
| WP-003 | PM review payload, integration test | impl, qa, review, docs: PASS | 4229 passed, 0 failed |
| WP-004 | begin_work prerequisite alignment, parity suite | impl, qa, review, release, docs: PASS | 4236 passed, 0 failed |
| WP-005 | Supervisor handles REVIEW_REWORK_LIMIT | impl, qa, review, release, docs: PASS | 1156 passed, 0 failed (excl. live) |
| WP-006 | Scripted E2E test, exit gate, derived docs | impl, qa, review, docs: PASS | mcp-server 4236 passed; orchestrator 1163 passed, 2 failed (live LLM) |

- Final mcp-server suite: 148 files / 4236 tests passing; `npm run build` clean.
- Final orchestrator suite: 1163 passed; the only failures are `test_developer_stage_live` and `test_pm_stage_live` (401 invalid API key).
- `ruff check`: 22 errors, identical to the recorded baseline (pre-existing E501/I001 in untouched files); `src` and `test_supervisor.py` clean.
- Version sync OK. Pipeline health: 6/6 WPs with all stages PASS. 0 blocking review findings, 0 security issues.

**Failed metrics / blockers:** none blocking. Environmental: 2 live-LLM orchestrator tests fail without a valid API key rather than skipping. The baseline worktree pytest run was noisy (38 failures, shared venv) but a superset of the current failures.

### Strategic Recommendations

- **Persist-on-refusal is the key design choice.** The refused call is the only moment the ledger learns a needed rework cannot run; persisting it makes all existing `>= MAX_REWORK_COUNT` recommendation checks correct without engine changes, and covers legacy verifier-only chains with no special code.
- **Spec-first discipline paid off.** The Reviewer called the v2.8.0 change a model for future spec changes: persist-on-trip, idempotence, claim persistence and headless resolution are cross-referenced across sections 11.1, 14.1.2, 16.3, 16.3c and 21.74.
- **Parity suite as drift guard.** `start-path-parity.test.ts` pins `startPipeline` and `beginWork` equivalence while the guard chains stay duplicated.
- **Tool-driven tests beat seeded counters.** The new `rework-limit.test.ts` is the first test proving the limit is reachable from real tool-driven state.
- Both changes (WP-002 and WP-005) had to land in the same run, since the persisted trip alone would have looped the plan-only PM node.

### Code Insights

**Developer**
- WP-002: rework detection/increment/breaker logic is duplicated in `pipeline.ts` and `begin-work.ts` (shared helper out of scope).
- WP-002 decision: breaker message captured outside the updater and thrown after lock release so the counter write commits.
- WP-004: guard-chain duplication remains (Deferred Item 3), medium priority.
- WP-005 decision: `_handle_rework_limit` returns bool plus a per-iteration cancelled-ID set; `_query_next_action` extracted to share polling.
- WP-005 debt (medium): halted sweep uses a stale `wp_summaries` snapshot, so a WP cancelled via rework limit with 3+ consecutive failures gets a redundant (harmless) second CANCELLED call (also noted by QA and Reviewer).
- WP-005 debt (low): live tests fail rather than skip; pre-existing ruff E501/I001 in untouched files.
- WP-005 process slip: an accidental `git stash` was immediately popped; working tree restored intact.
- WP-003 decision: the first start is not a rework, so the tests run five cycles and the sixth start is refused (the WP text's "four cycles / fifth start" was off by one); ACs unaffected.
- WP-006 debt: `REWORK_LIMIT=3` hardcoded in the test duplicates the server's `MAX_REWORK_COUNT`.

**QA**
- WP-001 / Reviewer / Release Engineer: the manifest parity test only compares manifest vs constants, so the 2.6.0/2.7.0 drift went undetected; add a manifest-vs-spec-README check.
- WP-002: no test covers a `beginWork` refusal at stored count >= MAX on a READY WP (claim should not persist).
- WP-005 / WP-006: live integration tests should skip on missing credentials.

**Reviewer**
- WP-001 gold nugget (medium): internally consistent spec-first change, a model for future specs.
- WP-002 maintainability (medium): shared helper for increment/breaker logic in a follow-up.
- WP-003: gold nugget for the tool-driven limit walk; low-priority note on `as any` casts and duplicated describe setup in `rework-limit.test.ts`.

**Release Engineer**
- Spec 2.7.0 to 2.8.0, mcp-server 2.11.0 to 2.12.0, orchestrator 1.4.0 to 1.5.0 (all minor, backwards compatible, no migration guides). Publishing/tagging left to the user.

**Documentation**
- WP-006: `orchestrator/README.md` integration-test section updated; a stale hardcoded test count near line 376 should be replaced with a count-free description.

### Deferred & Follow-Up Items

| # | Type | Source | Agent | Description | Priority |
|---|---|---|---|---|---|
| 1 | Deferred | Plan (Deferred Item 1), WP-005 | Planner / Developer | Halted sweep's direct synthesis route left unchanged | Per plan |
| 2 | Deferred | Plan (Deferred Item 3), WP-004 | Developer / Reviewer | Extract shared guard chain (or narrow Guards 4-5 helper) from `pipeline.ts` and `begin-work.ts`; parity suite mitigates drift meanwhile | Medium |
| 3 | Follow-up | WP-001 | QA / Reviewer / Release Engineer | Add test asserting `shared/workflow-manifest.json` `spec_version` equals spec README version | Low |
| 4 | Follow-up | WP-002 | QA | Add test for `beginWork` refusal at stored count >= MAX on a READY WP (no claim persisted) | Low |
| 5 | Follow-up | WP-005 | Developer / QA / Reviewer | Track cancelled IDs across the iteration to avoid the redundant second CANCELLED call in the halted sweep | Low-Medium |
| 6 | Follow-up | WP-005, WP-006 | QA | Skip live-LLM orchestrator tests when API credentials are absent or invalid | Low |
| 7 | Follow-up | WP-006 | Developer / QA / Reviewer | Derive `REWORK_LIMIT` in the orchestrator integration test from the server constant instead of hardcoding 3 | Low |
| 8 | Follow-up | WP-006 | Documentation | Replace stale hardcoded test count in `orchestrator/README.md` (~line 376) | Low |
| 9 | Follow-up | WP-003 | Reviewer | Tidy `as any` casts and duplicated describe setup in `rework-limit.test.ts` | Low |
| 10 | Out-of-scope | WP-005 | Developer | Persona changes (PM persona cancelling), new graph edge, exit code, WP status or ledger tool were ruled out; orchestrator extension seam left for plan P05 | Per plan |
| 11 | Follow-up | Project | Reviewer / Release / Documentation | Several PASS pipelines declared no `artifacts.files_modified` (12 low-priority ledger warnings); declare modified files for traceability | Low |

### Next Steps

- Plan the shared guard-chain extraction (Deferred Item 2) so the duplicated breaker logic and the parity suite's workaround can retire.
- Land the small test hygiene items: manifest-vs-README spec version check, the `beginWork` at-MAX READY-WP test, live-test skipping, and a derived `REWORK_LIMIT`.
- Optionally fix the halted-sweep stale-snapshot double cancel and revisit the direct synthesis route (Deferred Item 1) when planning P05.
- Publish and tag releases (spec v2.8.0, mcp-server v2.12.0, orchestrator v1.5.0) at the user's discretion.
- Pending: Knowledge Archiver run (see project comment if the dispatch did not complete).
