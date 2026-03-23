# Synthesis Report — Phase 1: Schema & Type Foundations

**Plan:** `2026-02-27-schema-type-foundations`
**Date:** 2026-02-27
**Status:** COMPLETE
**Project:** [Ledger Specification Alignment](../../projects/ledger-specification-alignment.md) — Phase 1 of 6

---

## Executive Summary

Phase 1 successfully aligned the MCP Ledger Server's Zod schemas, TypeScript types, and creation defaults with the Agent Workflow Specification v1.3.1 data model (§3). All four work packages completed cleanly with zero test failures and zero TypeScript errors at every checkpoint. The final state is a fully backward-compatible schema layer that enables all subsequent phases (2–6) to proceed on solid foundations.

**What was built:**

- **Schema widening** — Five new optional fields added across `WorkPackageDetailSchema`, `WorkPackageSummarySchema`, and `PipelineSchema`: `rework_counts` (per-pipeline-type map), `status_changed_at`, `auto_cancelled`, nullable `assigned_to`, and relaxed `revision` validator (`.nonnegative()`).
- **Creation defaults corrected** — `createWorkPackage()` now sets `revision: 0` (was 1) and forwards `assigned_to` from input (was hardcoded null).
- **Read migration** — `LedgerStore.readWorkPackage()` automatically converts legacy `rework_count` scalar to the new `rework_counts` map on read, in-memory only, preserving all existing ledger files without migration scripts.
- **WP ID regex alignment** — `StartPipelineSchema`, `CancelPipelineSchema`, and `UpdatePipelineProgressSchema` updated from `/^WP-\d{3}$/` to `/^WP-\d{3,}$/` supporting 4+ digit WP IDs.
- **Dual-write bridge** — `startPipeline()` and `getDeveloperAction()` updated to maintain `rework_counts.implementation` in sync with legacy `rework_count` during the transition period.
- **Test fixture factory** — `tests/helpers/fixtures.ts` created with `makeWorkPackageDetail`, `makePipeline`, and `makeWorkPackageSummary` factory functions (spec-compliant defaults, override-friendly).
- **Bulk fixture update** — 53 occurrences of `revision: 1` replaced with `revision: 0` across 15 test files.
- **New test coverage** — `tests/schema/work-package-schema.test.ts` created (22 tests covering all new schema fields).

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages completed | 4 / 4 |
| All pipelines passed | 16 / 16 (impl + qa + review + docs per WP) |
| Test suite size (final) | 555 tests across 28 files |
| Tests failed | 0 |
| TypeScript errors | 0 |
| New test files | 1 (`tests/schema/work-package-schema.test.ts`) |
| New helper files | 1 (`tests/helpers/fixtures.ts`) |
| Acceptance criteria met | 29 / 29 |
| Bulk fixture replacements | 53 occurrences across 15 files |
| Schema fields added | 5 (rework_counts, status_changed_at, auto_cancelled, revision nonneg., assigned_to nullable) |
| Exported types added | 1 (`ReworkCounts`) |
| Docs updated | 5 manifest files + changelog.md |

---

## Work Package Summary

### WP-001 — Schema: Core Field Changes
Added `auto_cancelled`, `rework_counts` map, `status_changed_at`, nullable `assigned_to`, corrected `revision` validator and creation default. Added `_ledgerRoot` test-hook to `createWorkPackage()`. Created 22 new schema-level tests. All 10 ACs met; 539 tests passing.

### WP-002 — WP ID Regex & rework_count Migration
Fixed WP ID regex to `\d{3,}` in three pipeline tool schemas. Added in-memory backward-compat migration in `LedgerStore.readWorkPackage()`. Implemented dual-write bridge for `rework_count`/`rework_counts.implementation` parity. Added 12 regex tests and 4 migration tests. All 8 ACs met; 555 tests passing.

### WP-003 — Test Fixture Factory & Bulk Update
Created `tests/helpers/fixtures.ts` with three factory functions. Replaced 53 `revision: 1` defaults with `revision: 0` across 15 test files, preserving 3 deliberate non-zero values. Confirmed all schema/migration/regex tests from WP-001/WP-002 already covered WP-003's AC-4 through AC-6. All 6 ACs met; 555 tests passing.

### WP-004 — Verification Gate
Independent TypeScript compilation and full test suite run confirming zero regressions from WP-001 through WP-003. Completed documentation pass covering `data-flows.md` Flow 4, `file-tree.md`, and a comprehensive `changelog.md v1.7.0` entry. All 5 ACs met; 555 tests passing.

---

## Failures & Blockers

None. All 16 pipelines across 4 work packages returned `PASS`. No test failures occurred at any checkpoint.

---

## Strategic Recommendations (Gold Nuggets)

### 1. 🔴 HIGH-PRIORITY — Complete the WP ID Regex Fix (Micro-WP, ~15 minutes)

**Issue:** Two schemas still use `/^WP-\d{3}$/` (3-digit-only), creating a hard workflow break for projects reaching WP-1000+:
- `CompletePipelineSchema` — `src/tools/pipeline.ts` line 234
- `AddObservationSchema` — `src/tools/observations.ts` line 21

**Impact:** A pipeline can be *started* with WP-1000 but not *completed*; observations can be initiated but not recorded. Silent failure in production workflows.

**Fix:** Change both patterns to `/^WP-\d{3,}$/`. Two-line change. Recommend creating this as a Phase 2 prerequisite micro-WP before any project reaches WP-1000.

> Flagged by: Reviewer (WP-002, WP-003, WP-004), QA (WP-002, WP-003, WP-004). Highest consensus observation across the cycle.

---

### 2. 🟡 MEDIUM — Retire the Dual-Write rework_count Bridge (Phase 3)

**Issue:** `startPipeline()` and `getDeveloperAction()` now maintain both `rework_count` (legacy) and `rework_counts.implementation` (new) simultaneously. `readWorkPackage()` deletes `rework_count` on read, but `startPipeline()` re-creates it on each rework event. The legacy field re-appears in persisted JSON until Phase 3 terminates dual-write.

**Relevant locations:**
- `src/tools/pipeline.ts` lines 163–167 (dual-write on rework)
- `src/tools/workflow-next-action.ts` (effectiveReworkCount compatibility read)

**Fix:** Phase 3 should switch `startPipeline()` to write only to `rework_counts`, remove the `rework_count = newCount` write, and update `getDeveloperAction()` to read `rework_counts.implementation` exclusively.

---

### 3. 🟡 MEDIUM — Consolidate Test Export Naming Convention

**Issue:** Two naming conventions now exist for test-only exports:
- `_internal` in `src/tools/work-package.ts` (exports `createWorkPackage`, etc.)
- `_schemas` in `src/tools/pipeline.ts` (exports schema objects for unit tests)

**Fix:** Standardize on a single convention (recommend `_internal` as it already exists in `mcp-server/AGENTS.md` patterns). Document the convention explicitly in `mcp-server/AGENTS.md` so future agents don't introduce a third variant.

---

### 4. 🟢 LOW — Add Inline Comment to Protect the revision:1 Test Seed

**Issue:** `tests/integration/full-workflow.test.ts` line 769 deliberately seeds `revision: 1` to assert the COMPLETE→IN_PROGRESS increment yields `revision: 2`. No inline comment marks this as intentional. A future bulk-replace automation (e.g., Phase 2 fixture migrations) could silently reset it to 0, breaking the test.

**Fix:** Add inline comment:
```typescript
// Deliberate: seeds revision:1 to verify COMPLETE->IN_PROGRESS increment yields revision:2
```
Raised by: Developer (WP-003), QA (WP-003), Reviewer (WP-003) — three separate agents flagged this.

---

### 5. 🟢 LOW — Migrate ledger-store.test.ts Local Factory to Shared fixtures.ts

**Issue:** `tests/storage/ledger-store.test.ts` contains a local `makeWpDetail` factory function (line ~30) that duplicates the pattern now available in `tests/helpers/fixtures.ts`. This creates a divergence point where the local factory won't automatically pick up future schema additions.

**Fix:** Replace the local factory with `import { makeWorkPackageDetail } from '../helpers/fixtures.js'` in a follow-up cleanup pass.

---

## Next Steps for the Planner / Manager

1. **Create a follow-up micro-WP** targeting `CompletePipelineSchema` (pipeline.ts:234) and `AddObservationSchema` (observations.ts:21) — both 2-line regex changes, treat as Phase 2 prerequisite.

2. **Begin Phase 2** (rework tracking logic) with confidence that the schema foundation is solid. The `rework_counts` map, `status_changed_at`, and `assigned_to` nullable are all live and tested.

3. **Schedule Phase 3** to retire the `rework_count` dual-write bridge once Phase 2 is stable.

4. **Consider a 30-minute cleanup sprint** to: (a) consolidate `_internal`/`_schemas` test exports, (b) add the `revision:1` inline comment, (c) migrate `ledger-store.test.ts` to the shared fixture factory.

---

## Files Modified (Full List)

| File | WPs |
|------|-----|
| `mcp-server/src/schema/work-package.ts` | WP-001 |
| `mcp-server/src/schema/root-index.ts` | WP-001 |
| `mcp-server/src/tools/work-package.ts` | WP-001 |
| `mcp-server/src/tools/pipeline.ts` | WP-002 |
| `mcp-server/src/storage/ledger-store.ts` | WP-002 |
| `mcp-server/src/tools/workflow-next-action.ts` | WP-002 |
| `mcp-server/tests/schema/work-package-schema.test.ts` | WP-001 (created) |
| `mcp-server/tests/helpers/fixtures.ts` | WP-003 (created) |
| `mcp-server/tests/tools/work-package.test.ts` | WP-001, WP-003 |
| `mcp-server/tests/tools/pipeline.test.ts` | WP-002, WP-003 |
| `mcp-server/tests/storage/ledger-store.test.ts` | WP-002, WP-003 |
| `mcp-server/tests/tools/rework-circuit-breaker.test.ts` | WP-002, WP-003 |
| `mcp-server/tests/tools/cancelled-status.test.ts` | WP-003 |
| `mcp-server/tests/tools/workflow-next-action.test.ts` | WP-003 |
| `mcp-server/tests/tools/workflow-rework-loop.test.ts` | WP-003 |
| `mcp-server/tests/tools/workflow-batch-actions.test.ts` | WP-003 |
| `mcp-server/tests/tools/workflow-handoff.test.ts` | WP-003 |
| `mcp-server/tests/tools/claim-guard.test.ts` | WP-003 |
| `mcp-server/tests/tools/cascade-reblock.test.ts` | WP-003 |
| `mcp-server/tests/integration/auto-handoff.test.ts` | WP-003 |
| `mcp-server/tests/integration/full-workflow.test.ts` | WP-003 |
| `mcp-server/tests/storage/project-meta.test.ts` | WP-003 |
| `mcp-server/tests/gui/api.test.ts` | WP-003 |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-001, WP-002 |
| `mcp-server/docs/agents/project-manifest/constraints.md` | WP-002 |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | WP-003, WP-004 |
| `mcp-server/docs/agents/project-manifest/data-flows.md` | WP-004 |
| `mcp-server/changelog.md` | WP-004 |

---

*Generated by Synthesis Agent — 2026-02-27*
