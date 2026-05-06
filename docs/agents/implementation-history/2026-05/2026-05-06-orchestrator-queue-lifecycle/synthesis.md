# Project Synthesis — Orchestrator Queue Lifecycle

**Plan:** `2026-05-06-orchestrator-queue-lifecycle`
**Date:** 2026-05-06
**Status:** COMPLETE
**Work Packages:** 4 / 4 COMPLETE
**Pipeline Health:** 16 / 16 stages PASS

---

## Executive Summary

This session refactored the monolithic `gui/orchestrator-manager.ts` into a set of single-
responsibility modules under `src/gui/queue/`, while simultaneously delivering two new
user-visible features: live "Tool call" progress display during long PM tool invocations,
and a more accurate `'started'` queue status for processes that have logged stage activity
but not yet created a project ledger.

Three pure modules were extracted and independently tested:

| New Module | Extracted From | Responsibility |
|---|---|---|
| `src/gui/queue/resolve-progress.ts` | `orchestrator-manager.ts` | Backwards JSONL walk → `ProgressResolution` |
| `src/gui/queue/format-progress-entry.ts` | `resolve-progress.ts` | JSONL entry → human-readable badge text |
| `src/gui/queue/compute-effective-status.ts` | `orchestrator-manager.ts` | `alive + project + hasLogActivity` → `EffectiveStatus` |

All manifest documentation (`api-surface.md`, `file-tree.md`) was updated in-line with each
WP's documentation pipeline, so the project manifests are current.

---

## Metrics

| Metric | Value |
|---|---|
| Work packages | 4 / 4 COMPLETE |
| Pipeline stages | 16 / 16 PASS |
| Tests at session end | 2 169 passing / 0 failing |
| New unit tests added | 44 (26 + 5 + 7 + 6) |
| New test files | 3 (`resolve-progress`, `format-progress-entry`, `compute-effective-status`) |
| TypeScript compile | Clean throughout |
| Regressions | None |
| Security issues | None |

---

## Work Package Outcomes

### WP-001 — Extract `resolveProgress()` into dedicated module

Extracted `resolveProgress()` and `formatProgressEntry()` from `orchestrator-manager.ts`
into `src/gui/queue/resolve-progress.ts`. Introduced the `ProgressResolution` interface
(`summary`, `lastAction`, `logFilename`, `hasStageActivity`), replacing the previous bare
`string | null` return type. `QueueEntry` was extended with `lastAction` and `logFilename`
fields populated from `ProgressResolution`. 26 direct unit tests added.

**Key artefacts:** `resolve-progress.ts`, `resolve-progress.test.ts`, updated
`orchestrator-manager.ts` (re-exports for backward compat).

### WP-002 — Add `tool_call` event type to `formatProgressEntry()`

Extracted `formatProgressEntry()` further into its own pure module
`src/gui/queue/format-progress-entry.ts` and added the `tool_call` case, returning
`"Tool call: {tool_name}"` (fallback: `"Tool call"` when `tool_name` absent). The function
now covers 11 event types. 5 unit tests added. A stale inaccurate comment in the test file
header and an erroneous `route` entry in `api-surface.md` were also corrected.

**Key artefacts:** `format-progress-entry.ts`, `format-progress-entry.test.ts`.

### WP-003 — Extend `QueueEntry` with `lastAction`/`logFilename` + tests

`QueueEntry.lastAction` and `QueueEntry.logFilename` were already in place from the
prior holistic queue-UI build. This WP contributed AC-6: 7 integration-level test cases
in `orchestrator-manager.test.ts` exercising the null paths, correct last-summarisable-
action resolution, heartbeat-only files, and both-fields-non-null correlation.
All front-end rendering paths (`renderProgressBadge`, `"View Log →"` link, log preview
expand) were verified against the data.

**Key artefacts:** Updated `orchestrator-manager.test.ts` (+7 cases, now 77 total).

### WP-004 — Extract `computeEffectiveStatus()` + log-activity detection

Extracted `computeEffectiveStatus(alive, projectExists, hasLogActivity=false)` into
`src/gui/queue/compute-effective-status.ts`. Added the `'started'` rule: an alive process
with stage activity but no project ledger is now correctly shown as `'started'` rather than
`'pending'` in the queue UI. `killQueueEntry` and `dismissQueueEntry` retain conservative
2-arg calls (default `false`) so they are unaffected by the new rule. A Reviewer Fix-
Forward corrected misleading `"same logic as getQueue()"` comments in the kill/dismiss
paths. 6 pure unit tests added.

**Key artefacts:** `compute-effective-status.ts`, `compute-effective-status.test.ts`,
updated `orchestrator-manager.ts` comments.

---

## Strategic Recommendations

### 1. Continue the `src/gui/queue/` extraction (medium priority)

`gui/orchestrator-manager.ts` is still a large monolithic file covering preflight checks,
queue reads, queue mutations, and process management. All four pipelines flagged this.
The `src/gui/queue/` directory is now established with a clear pattern. The logical next
step is extracting `QueueEntry` types into `src/gui/queue/types.ts` and the main
`getQueue()` call into `src/gui/queue/get-queue.ts` — exactly as the original WP specs
envisioned — to complete the migration.

### 2. Add missing `resolve-progress.ts` test coverage (low priority)

Two edge cases are unguarded by tests:
- **Malformed JSONL lines** — handled correctly by a try-catch skip, but no regression
  test exists. Low risk; worth a targeted test case in `resolve-progress.test.ts`.
- **0-byte (empty) log file** — falls through to `EMPTY_RESOLUTION` with `logFilename`
  set, which is correct, but unverified.

### 3. Freeze `EMPTY_RESOLUTION` sentinel (low priority)

`EMPTY_RESOLUTION` in `resolve-progress.ts` is a plain object literal. Callers use spread
(`{ ...EMPTY_RESOLUTION, logFilename }`) so there is no mutation risk today, but
`Object.freeze(EMPTY_RESOLUTION)` would make the intent explicit and guard against
accidental direct mutation by future consumers. One-line change, zero runtime cost.

### 4. Clarify `PROGRESS_BADGE_MAP 'heartbeat'` entry (low priority)

`orchestrator-widgets.js` contains a `'heartbeat'` entry in `PROGRESS_BADGE_MAP`, but
`resolveProgress()` never surfaces `'heartbeat'` as `lastAction` (heartbeat entries are
explicitly skipped as non-summarisable). The entry is dead code. A one-line comment
preventing future confusion was noted but not applied — worth adding in a maintenance pass.

### 5. Verify Python orchestrator always emits `tool_name` (low priority)

`formatProgressEntry()` gracefully falls back to `"Tool call"` when `tool_name` is absent.
Worth confirming on the Python side that all `tool_call` JSONL entries always include
`tool_name`, so the more informative `"Tool call: {name}"` string is surfaced in practice.

---

## Files Modified (Session Total)

| File | Change |
|---|---|
| `mcp-server/src/gui/queue/resolve-progress.ts` | New — `ProgressResolution`, `resolveProgress()`, re-exports `formatProgressEntry` |
| `mcp-server/src/gui/queue/format-progress-entry.ts` | New — pure `formatProgressEntry()`, 11 event types incl. `tool_call` |
| `mcp-server/src/gui/queue/compute-effective-status.ts` | New — pure `computeEffectiveStatus()`, `EffectiveStatus` type |
| `mcp-server/gui/orchestrator-manager.ts` | Extended `QueueEntry`; imports from new modules; backward-compat re-exports; corrected kill/dismiss comments; JSDoc `@remarks` on `lastAction` |
| `mcp-server/tests/gui/queue/resolve-progress.test.ts` | New — 26 unit tests |
| `mcp-server/tests/gui/queue/format-progress-entry.test.ts` | New — 5 unit tests; corrected inaccurate coverage comment |
| `mcp-server/tests/gui/queue/compute-effective-status.test.ts` | New — 6 unit tests |
| `mcp-server/tests/gui/orchestrator-manager.test.ts` | +7 AC-6 cases (WP-003); updated header |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | GUI Queue Helpers section; `QueueEntry` fields; `computeEffectiveStatus`; `EffectiveStatus` source; `tool_call` event type; removed erroneous `route` entry |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | `src/gui/queue/` directory; `tests/gui/queue/` directory; updated `orchestrator-manager.ts` annotation; corrected test counts |

---

## Next Steps for Planner

1. **Refactor WP** — Extract `QueueEntry` types to `src/gui/queue/types.ts` and `getQueue()`
   to `src/gui/queue/get-queue.ts` to complete the `src/gui/queue/` migration.
2. **Maintenance WP** — Add malformed-JSONL and empty-file tests; freeze `EMPTY_RESOLUTION`;
   annotate the dead `heartbeat` badge map entry.
3. **Orchestrator verification** — Confirm Python emits `tool_name` on all `tool_call` events.

---

*Generated by Head of Operations (Synthesis) · 2026-05-06*
