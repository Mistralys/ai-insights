# Project Synthesis Report

**Plan:** 2026-02-25 Workflow Specification Audit Fixes 2 — Rework 1  
**Date:** 2026-02-26  
**Status:** COMPLETE — all 6 work packages delivered  
**Report Author:** Head of Operations (Synthesis)

---

## Executive Summary

This rework addressed six targeted defects and documentation gaps identified as immediate or short-term priorities in the Round 2 synthesis. All changes were surgical: no new MCP tools, no new public API surface, no schema additions. The session closed four residual correctness bugs in the `mcp-server/` TypeScript codebase, hardened one security/authorization gap, and reinforced the agent operating documentation with two new constraints.

**What was built:**

| Fix | Area | Outcome |
|-----|------|---------|
| `noEmitOnError: true` added to `tsconfig.json` | Build infrastructure | TypeScript compiler now refuses to emit JavaScript when type errors are present |
| Residual `=== 'COMPLETE'` inline terminal checks replaced with `isTerminalStatus()` | `workflow-handoff.ts`, `workflow-batch-actions.ts` | CANCELLED is now correctly treated as a terminal status in all workflow paths |
| Override authorization guard added to `claimWorkPackage` | `work-package.ts` | Third-party agents can no longer use `override: true` to hijack assigned WPs |
| `completeSynthesis` read-modify-write wrapped in `withLock()` | `project-lifecycle.ts` | Synthesis completion is now TOCTOU-safe and fully compliant with the locking constraint |
| `updateWorkPackageWithSync` hoisting convention documented | `constraints.md`, `AGENTS.md` | Gotcha 12 and Critical Constraints row #11 prevent recurrence of the prior session's code-review FAILs |
| WP ID regex updated from `\d{3}$` to `\d{3,}$` in three Zod schemas | `work-package.ts` | System now correctly accepts WP-1000+ identifiers, matching documented constraint #5 |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 6 / 6 COMPLETE |
| Pipelines completed | 24 (4 per WP × 6 WPs) |
| Pipeline failures | 0 |
| Test suite at session start | 489 passing |
| New tests added (WP-006) | 16 |
| Test suite at session end | **505 passing** |
| Test failures | 0 |
| Build status | Clean (`npm run build` exits code 0, zero errors) |
| Source files modified | 5 (`tsconfig.json`, `workflow-handoff.ts`, `workflow-batch-actions.ts`, `work-package.ts`, `project-lifecycle.ts`) |
| Documentation files modified | 7 (`tech-stack.md`, `api-surface.md`, `constraints.md` ×2, `data-flows.md`, `file-tree.md`, `AGENTS.md`, `changelog.md`) |

---

## Work Package Summaries

### WP-001 — `noEmitOnError: true` in `tsconfig.json`

**Risk closed:** TypeScript was silently emitting JavaScript even when type errors were present, meaning a broken build could be deployed without a failing CI step.

- Added `"noEmitOnError": true` to `compilerOptions` in alphabetical order (before `outDir`). All 15 existing options are unmodified.
- `tech-stack.md` updated to document the flag alongside `strict` and `noUncheckedIndexedAccess`. `npm run build` added to the Build & Test command table.
- 489 tests pass; build clean.

### WP-002 — Residual Inline Terminal-Status Checks

**Risk closed:** `CANCELLED` was not recognized as a terminal status in the handoff and batch-action paths, potentially causing workflow stalls when all WPs were cancelled.

- `workflow-handoff.ts`: `import { isTerminalStatus }` added; `nextAgentFromStatus` now returns `null` for any terminal status, not just `COMPLETE`.
- `workflow-batch-actions.ts`: `allComplete` → `allTerminal`, guard uses `isTerminalStatus(wp.status)`, reason string updated to `'All work packages are in a terminal status (COMPLETE or CANCELLED).'`
- `api-surface.md` updated: `nextAgentFromStatus` return-value semantics now documented explicitly.
- **Out-of-scope observation (tracked):** `workflow-next-action.ts` line 87 still uses `allComplete` — a pre-existing inconsistency that can be addressed in a future micro-debt WP.

### WP-003 — `claimWorkPackage` Override Authorization Guard

**Risk closed:** Any agent could use `override: true` to claim a WP assigned to another agent, bypassing the assignment system entirely.

- Added block 2b in `claimWorkPackage`: rejects `override:true` when the caller is neither `'Project Manager'` nor `wp.assigned_to`. Guard is conditioned on `wp.assigned_to` being truthy (unassigned WPs are unaffected).
- Three WP ID regex schemas updated from `/^WP-\d{3}$/` to `/^WP-\d{3,}$/`: `GetWorkPackageSchema`, `CreateWorkPackageSchema` dependencies, `ClaimWorkPackageSchema`.
- `constraints.md` constraint #8 corrected (WP ID regex example updated to 4-digit); constraint #14 updated to remove the now-false "no code enforcement" caveat.
- `api-surface.md` `ledger_claim_work_package` entry updated to document the hard-rejection guard.

### WP-004 — `completeSynthesis` Locking

**Risk closed:** `completeSynthesis` was performing a read-modify-write on the root index outside of `withLock()`, violating the atomic-write constraint and creating a potential TOCTOU race.

- Wrapped the `readRootIndex` / `synthesis_generated=true` mutation / `writeRootIndex` sequence in `withLock(store.storageDir, async () => { ... })` using the `let result!` hoisting pattern.
- `data-flows.md` Flow 12 updated to show the `withLock` scope.
- `constraints.md` constraint #2 extended: now explicitly covers single-file read-modify-write sequences (not only dual-file updates), with `completeSynthesis` as the canonical example.
- 34 targeted tests pass (project-lifecycle: 21/21, synthesis-terminal: 13/13).

### WP-005 — `updateWorkPackageWithSync` Hoisting Convention Documentation

**Risk closed:** The outer-scope `let` hoisting pattern required when returning values from `updateWorkPackageWithSync` (and `withLock`) callbacks was undocumented, causing two consecutive code-review FAILs in the prior session.

- Added **Gotcha 12** to `constraints.md` (before the "Runtime Config Monitoring" section): includes anti-pattern (`const` inside callback) and correct pattern (`let` outer scope) code blocks with rationale.
- Added **row #11** to the AGENTS.md Critical Constraints table: `'Pre-mutation state passed out of updateWorkPackageWithSync must use outer-scope let | TS2304 compile error + runtime ReferenceError at call site'`.
- No existing content modified in either file.

### WP-006 — New Test Coverage

**Risk closed:** Several behavioral changes from WP-001–WP-005 had no dedicated test coverage, leaving correctness dependent only on the pre-existing suite.

16 new tests added across 3 test files:

| Test group | File | Tests |
|-----------|------|-------|
| `nextAgentFromStatus` returns `null` for `CANCELLED` | `workflow-handoff.test.ts` | 1 |
| All-CANCELLED terminal short-circuit + reason string | `workflow-batch-actions.test.ts` *(new file)* | 4 |
| Override authorization guard (PM allowed, assignee allowed, third-party rejected) | `work-package.test.ts` | 5 |
| WP ID regex boundary (WP-1000 accepted, WP-10 rejected) across 3 schemas | `work-package.test.ts` | 6 |

`workflow-batch-actions.test.ts` added to `file-tree.md`. v1.6.0 changelog entry added to `mcp-server/changelog.md`.

Final suite: **505 tests passing, 0 failures, 27 test files, exit code 0**.

---

## Strategic Recommendations (Gold Nuggets)

These observations emerged from the review and QA pipelines and represent actionable follow-up for the Planner/PM.

### High Priority

None — no blocking issues were identified across any of the 24 pipelines.

### Medium Priority

1. **`workflow-next-action.ts` `allComplete` variable (micro-debt):** This file still uses `const allComplete = ... === 'COMPLETE'` on line 87 — the same pattern fixed in WP-002 for the other two files. It was correctly scoped out of this rework but represents a semantic inconsistency. Recommend a micro-debt WP targeting this single variable, analogous to WP-002.

2. **`workflow-batch-actions.ts` import formatting:** The `isTerminalStatus` import on line 22 lacks the blank-line separator used consistently by the same import in `workflow-handoff.ts`. Non-functional, but a minor convention inconsistency that will be visible to future agents reading the file.

3. **`changelog.md` / `package.json` version drift:** The v1.6.0 entry was written to `changelog.md`, but `package.json` remains at `1.5.0`. The `sync-version.js` script handles this, but it was not run during this session. Should be run before the next release.

### Low Priority

4. **WP ID regex completeness check:** `UpdateWorkPackageStatusSchema` and other schemas not covered by WP-003 should be audited to confirm all WP ID patterns are also `\d{3,}`. A single grep pass (`/\\^WP-\\\\d\{3\}\$/`) would identify any remaining stragglers.

5. **`constraints.md` constraint #2 title:** The constraint was originally titled "Dual-File Updates Require Locking" but now covers single-file read-modify-write as well. The title could be updated to "All Root-Index Mutations Require Locking" for accuracy — flagged as low-priority cosmetic.

---

## Next Steps

| Priority | Action | Owner |
|----------|--------|-------|
| Medium | Create micro-debt WP for `workflow-next-action.ts` `allComplete` → `allTerminal` + `isTerminalStatus()` migration | Planner / PM |
| Medium | Run `npm run sync-version` to align `package.json` version with `changelog.md` v1.6.0 entry | Developer |
| Low | Audit remaining schemas for `/^WP-\d{3}$/` pattern to confirm no stragglers | Developer |
| Low | Rename `constraints.md` constraint #2 title for accuracy | Documentation |

---

## Appendix: Files Modified This Session

**Source:**
- `mcp-server/tsconfig.json`
- `mcp-server/src/tools/workflow-handoff.ts`
- `mcp-server/src/tools/workflow-batch-actions.ts`
- `mcp-server/src/tools/work-package.ts`
- `mcp-server/src/tools/project-lifecycle.ts`

**Tests:**
- `mcp-server/tests/tools/workflow-handoff.test.ts`
- `mcp-server/tests/tools/workflow-batch-actions.test.ts` *(new)*
- `mcp-server/tests/tools/work-package.test.ts`

**Documentation:**
- `mcp-server/docs/agents/project-manifest/tech-stack.md`
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/constraints.md`
- `mcp-server/docs/agents/project-manifest/data-flows.md`
- `mcp-server/docs/agents/project-manifest/file-tree.md`
- `mcp-server/AGENTS.md`
- `mcp-server/changelog.md`
