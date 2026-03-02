# Project Synthesis Report

**Plan:** `2026-03-02-pm-wait-handoff-embedding`
**Date:** 2026-03-02
**Status:** COMPLETE

---

## Executive Summary

This session fixed a targeted bug in the `ledger_get_next_action` MCP tool: the `'Project Manager'` switch case in `workflow-next-action.ts` was not wrapped in `embedHandoffStatusInWait`, causing PM `WAIT` responses to be missing the `handoff_status` payload that all other agent roles (Developer, QA, Reviewer, Documentation, Synthesis) received correctly.

The fix was a single-line change wrapping `getProjectManagerAction` with `embedHandoffStatusInWait`, matching the established pattern across all six other agent roles. One new unit test was added to assert the PM WAIT response includes a correctly-shaped `handoff_status` block. Documentation was updated to reflect the now-complete set of agent roles covered by the embedding.

---

## Work Packages

| WP | Title | Agent | Status | Pipelines |
|----|-------|-------|--------|-----------|
| WP-001 | PM WAIT Handoff Embedding + Tests + Docs | Documentation | COMPLETE | impl PASS · qa PASS · code-review PASS · docs PASS |
| WP-002 | Final QA Validation | QA | COMPLETE | qa PASS |

---

## Metrics

| Metric | Value |
|--------|-------|
| Tests passed | 983 |
| Tests failed | 0 |
| New tests added | 1 |
| Acceptance criteria met | 10 / 10 |
| Files modified | 3 |

**Files modified:**
- `mcp-server/src/tools/workflow-next-action.ts` — switch-case fix (line 216–223)
- `mcp-server/tests/tools/workflow-next-action.test.ts` — new PM WAIT handoff test (line 1503–1527)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — updated `computeHandoffStatus` comment to list all six embedded roles

---

## Incident Log

| WP | Priority | Tool | Resolved | Summary |
|----|----------|------|----------|---------|
| WP-001 | medium | `ledger_begin_work` | No | Documentation agent was rejected because the WP was still `assigned_to: "Reviewer"` after the code-review PASS. `ledger_begin_work` requires either `READY` state (claim path) or `IN_PROGRESS` assigned to the calling agent (idempotent re-entry). Neither condition was met for Documentation on a Reviewer-owned IN_PROGRESS WP. Workaround: changes were made without a formally started pipeline. |

**Root cause:** `ledger_begin_work` imposes an `assigned_to` guard that blocks the natural Documentation handoff from a Reviewer-assigned `IN_PROGRESS` WP. `ledger_start_pipeline` would have succeeded (it checks `pipeline_type` against `PIPELINE_AGENT_MAP`, not `assigned_to`), but Documentation's role-boundary tool set excludes `ledger_start_pipeline`. The WP assignment is not automatically updated to "Documentation" after a code-review PASS.

---

## Strategic Recommendations (Gold Nuggets)

### 1. `ledger_begin_work` assigned_to guard blocks the Documentation handoff

**Priority:** Medium — affects every project that reaches the Documentation stage.

After a Reviewer completes a code-review pipeline, the WP `assigned_to` field remains `"Reviewer"`. When the Documentation agent calls `ledger_begin_work`, the guard rejects it because the WP is `IN_PROGRESS` but not assigned to the Documentation agent. This is a workflow contract violation — Documentation is the next legitimate owner.

**Options:**
- Auto-update `assigned_to` to the next pipeline owner when completing a pipeline (e.g., completing `code-review` sets `assigned_to: "Documentation"` if a `documentation` pipeline is expected next).
- Relax the `ledger_begin_work` guard to allow any agent whose pipeline type is valid per `PIPELINE_AGENT_MAP` for the current WP state.
- Add `ledger_start_pipeline` to the Documentation persona's role-boundary tool set as a fallback (lower-impact workaround).

### 2. `getProjectManagerAction` makes redundant disk reads

**Priority:** Low (micro-debt).

`getProjectManagerAction` (line 291 of `workflow-next-action.ts`) fetches all WP details via its own internal `Promise.all`, even though the outer `getNextAction` scope already loaded `wpDetails` at line 75 and forwards them as `opts`. Every PM call incurs N redundant file reads.

Aligning `getProjectManagerAction`'s signature with `getDeveloperAction`/`getQaAction`/etc. to accept an optional pre-loaded `wpDetails` parameter would eliminate this I/O overhead. Small change, consistent with the existing pattern everywhere else.

### 3. `Synthesis` case uses inline object literal instead of `getSynthesisAction()`

**Priority:** Low (style/uniformity).

The `'Synthesis'` case in the `getNextAction` switch constructs its response via an inline object literal rather than delegating to a named `getSynthesisAction()` function, unlike every other agent-role case. This is a minor inconsistency with no functional impact but reduces uniformity and discoverability.

---

## Next Steps

1. **Address the Documentation-agent blocked handoff** (Incident above, Medium priority) — Consider auto-updating WP `assigned_to` when each pipeline type completes, or relaxing the `ledger_begin_work` guard to accept pipeline-type-validated agents.
2. **Track micro-debt: `getProjectManagerAction` redundant I/O** — Add a work package in a future housekeeping plan to align PM action signature with the `getDeveloperAction`/`getQaAction` pattern.
3. **Track micro-debt: Synthesis inline object literal** — Extract the Synthesis switch-case response into a `getSynthesisAction()` helper for uniformity.
