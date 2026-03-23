# Project Status Report — Synthesis

**Plan:** 2026-02-26-workflow-spec-audit-fixes  
**Date:** 2026-02-26  
**Status:** COMPLETE  
**Prepared by:** Head of Operations (Synthesis)

---

## Executive Summary

This session resolved **10 audit findings** (3 critical, 4 moderate, 3 minor) across three synchronized layers of the AI Insights workflow system: the behavioral specification, the MCP server TypeScript implementation, and the Python orchestrator. All four work packages completed without blockers, passing every pipeline gate (implementation → QA → code-review → documentation).

The core deliverable is a fully consistent, specification-accurate workflow system at **version 1.1.0**, with two critical bugs fixed in the MCP server, one logic defect patched in the orchestrator, and twelve editorial corrections applied to the specification document.

---

## What Was Built

### WP-001 — Specification Document Fixes (`docs/agents/workflow-specification.md`)

- **Spec version** bumped from 1.0.0 to 1.1.0.
- Twelve editorial corrections covering six audit issues (#2, #4, #5, #6, #7, #8, #9, #10):
  - `§11.1` — "all COMPLETE" corrected to "all terminal (COMPLETE or CANCELLED)".
  - `§11.3.1` — New subsection defining `stage_success` precisely.
  - `§12.2` — Non-dependency blocker guard added to `propagateDependencyUnblock` pseudocode.
  - `§14.1` — Healing pseudocode generalized from IN_PROGRESS-only to IN_PROGRESS or READY.
  - `§14.3` — Invariant updated to match the `§14.1` change (IN_PROGRESS or READY).
  - `§15.5` — Auto-handoff eligibility condition clarified; Note distinguishing `HandoffStatus` from `ProjectStatus` added.
  - `§19.2` — Stale editorial note removed; accurate `rework_count` explanation added.
  - `§20.7` — Explicit Planner fallthrough paragraph added.
  - `§6.2` — Vacuous-true edge case callout for non-dependency blockers added.
  - `§21.1` — `READY_FOR_PM` row added to the handoff status table with accurate description.
  - `§21.3` — Planner "no WPs exist" branch changed from WAIT to READY_FOR_PM.
  - `§21.8` — Documentation FAIL routing corrected (self-rework → IN_PROGRESS, not READY_FOR_DEVELOPER).

### WP-002 — Self-Healing & Dependency Propagation (`mcp-server/`)

| Fix | Location | Description |
|-----|----------|-------------|
| READY→COMPLETE healing | `project-lifecycle.ts` — `computeHealedStatus()` | Generalizes terminal check from IN_PROGRESS-only to IN_PROGRESS or READY; preserves original status on fallback when `synthesis_generated=false`. |
| BLOCKED→COMPLETE healing | `project-lifecycle.ts` — `computeHealedStatus()` | When project is BLOCKED, no WPs are BLOCKED, `pendingWps=0`, `totalWps>0`, and `synthesis_generated=true`, heals to COMPLETE. |
| Non-dependency blocker guard | `work-package.ts` — `propagateDependencyUnblock()` | Skips WPs with `blocked_by.type` in `[external, decision, technical]`; only auto-clears dependency-type or absent `blocked_by`. |
| MCP server manifests updated | `api-surface.md`, `data-flows.md`, `constraints.md` | All three affected manifest files updated to document the new healing rules and blocker guard (Gotcha 8 added to constraints). |

**7 new tests added** — 3 for `computeHealedStatus`, 4 for `propagateDependencyUnblock`.

### WP-003 — Handoff Routing (`mcp-server/`)

| Fix | Location | Description |
|-----|----------|-------------|
| READY_FOR_PM registration | `workflow-handoff.ts` — `nextAgentFromStatus` map | New key maps `READY_FOR_PM` → `'Project Manager'`. |
| Planner empty-WPs routing | `workflow-handoff.ts` — `getPlannerHandoff()` | Returns `READY_FOR_PM` (not `WAIT`) when no WPs exist. |
| Clarifying comment | `workflow-handoff.ts` — `buildHandoffResponse()` | Comment documents the naming distinction between `status` (handoff status) and `ProjectStatus`. |
| Documentation regression test | `workflow-handoff.test.ts` | Locks in the existing `FAIL → IN_PROGRESS` routing for Documentation; confirms audit issue #2 was a coverage gap, not a code bug. |
| Help content updated | `help-content.ts` | `READY_FOR_PM` added to valid statuses list. |
| MCP server manifests updated | `api-surface.md`, `data-flows.md` | `nextAgentFromStatus` documentation expanded; Planner handoff and Documentation FAIL paths updated in data flows. |

**4 new tests added** — regression test + 3 new describe blocks.

### WP-004 — Orchestrator Supervisor (`orchestrator/`)

| Fix | Location | Description |
|-----|----------|-------------|
| `_TERMINAL_STATUSES` frozenset | `supervisor.py` — module level | Single constant shared by `pending_count` and all-done routing; `frozenset({'COMPLETE', 'CANCELLED'})`. |
| `pending_count` fix | `supervisor.py` | Uses `not in _TERMINAL_STATUSES` instead of `!= 'COMPLETE'`. |
| All-done routing fix | `supervisor.py` | Routes to synthesis when ALL WPs are COMPLETE or CANCELLED (not just COMPLETE). |
| Route reason string | `supervisor.py` | Updated to `'all work packages terminal (COMPLETE or CANCELLED)'`. |
| `stage_success` documentation | `state.py`, `nodes/__init__.py` | Docstrings and inline comments aligned to agreed definition; architectural trade-off documented. |
| README updated | `orchestrator/README.md` | Special Exits routing table and WorkflowState fields table updated to reflect fixes. |

**2 new tests added** — `test_routes_to_synthesis_when_all_wps_mix_of_complete_and_cancelled`, `test_pending_count_excludes_cancelled_wps`.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages completed | 4 / 4 |
| Pipelines executed | 16 (4 per WP × 4 WPs) |
| Pipeline outcomes | 16 PASS, 0 FAIL |
| MCP server tests (final) | **515 passed, 0 failed** |
| Orchestrator tests (final) | **162 passed, 0 failed, 1 skipped** |
| New tests added | **13 total** (7 MCP server + 4 handoff + 2 orchestrator) |
| Spec acceptance criteria | **12 / 12 met** |
| Files modified | 12 source/test files + 5 manifest/doc files |
| Security issues | 0 |

---

## Strategic Recommendations (Gold Nuggets)

### GN-1 — Type-safe `nextAgentFromStatus` map (Medium priority)

> *Source: WP-003 code-review*

The `nextAgentFromStatus` map in `workflow-handoff.ts` is a plain `Record<string, string>` with no compile-time guarantee of completeness. If a new `READY_FOR_*` status is added without a corresponding map entry, `nextAgentFromStatus` returns `null` silently and auto-handoff is skipped with no error. Keying the map against a TypeScript union of valid `READY_FOR_*` literals would make omissions a compile error.

**Suggested next step:** Define `type HandoffStatusKey = 'READY_FOR_PM' | 'READY_FOR_DEVELOPER' | ...` and type the map as `Record<HandoffStatusKey, string>`.

### GN-2 — `stage_success` proxy accuracy (Medium priority)

> *Source: WP-004 implementation*

`nodes/__init__.py` sets `stage_success=True` on successful node completion as the best available proxy for "at least one PASS pipeline was produced". The actual PASS/FAIL state of pipelines is not verified — a node that succeeded but produced only FAIL pipelines would still set `stage_success=True`. This is an architectural constraint documented by a clarifying comment, but a future improvement could add a ledger re-query to check for at least one PASS pipeline before setting the flag.

**Trade-off:** One extra MCP round-trip per agent stage vs. more accurate circuit-breaker input.

### GN-3 — Retire or annotate the `applyStatusHealing` inline replica (Low priority)

> *Source: WP-002 code-review*

`project-lifecycle.test.ts` contains an inline replica of `applyStatusHealing` that was not updated when `computeHealedStatus` gained the BLOCKED→COMPLETE path in WP-002. The new describe block tests the exported function directly (correct approach), so coverage is sound. However, the replica now documents stale behavior. It should be either retired (replaced entirely by the exported-function tests) or annotated explicitly as a partial replica.

### GN-4 — Derive help-content valid-status list from `nextAgentFromStatus` (Low priority)

> *Source: WP-003 implementation*

The valid-statuses list in `help-content.ts` is a manually maintained human-readable comment. It can drift from `nextAgentFromStatus` keys silently. Deriving it automatically from the map at build time would prevent documentation drift.

### GN-5 — Add `technical` blocker type to integration tests (Low priority)

> *Source: WP-002 QA + code-review*

`propagateDependencyUnblock` guards on `type !== 'dependency'` uniformly for `external`, `decision`, and `technical` types. The integration tests in WP-002 cover `external` and `decision` explicitly but not `technical`. The guard logic is correct — this is a test completeness gap, not a functional gap.

### GN-6 — `§21.3` precedence ordering note (Low priority)

> *Source: WP-001 implementation + QA + code-review (convergent observation)*

Three independent agents flagged that the pre-routing block check (`§21.2`) fires before Planner-specific logic (`§21.3`), meaning an edge case (all WPs BLOCKED in a re-opened Planner project) could shadow the READY_FOR_PM branch silently. An explicit ordering note in `§21.3` referencing `§21.2` precedence would make the evaluation order unambiguous without any logic change.

---

## Blockers / Failures

**None.** All 16 pipelines across all 4 work packages resulted in PASS. No security issues, no regressions, no blocking observations.

---

## Next Steps

| Priority | Recommendation |
|----------|---------------|
| High | No immediate high-priority items. |
| Medium | Implement GN-1 (type-safe `nextAgentFromStatus` map) in a follow-up WP. |
| Medium | Evaluate GN-2 trade-off: one extra MCP query per stage to harden `stage_success` accuracy. |
| Low | GN-3: retire or annotate the `applyStatusHealing` replica in `project-lifecycle.test.ts`. |
| Low | GN-5: add a `technical` blocker type integration test in `work-package.test.ts`. |
| Low | GN-4: derive help-content status list from `nextAgentFromStatus` at build time. |
| Low | GN-6: add `§21.2` precedence note to `§21.3` in `workflow-specification.md`. |

---

*Report generated by Head of Operations (Synthesis Agent) — 2026-02-26*
