# Project Synthesis — Standalone Ledger Integration

**Plan:** `2026-06-30-standalone-ledger-integration`
**Date:** 2026-07-01
**Status:** COMPLETE — all 10 work packages delivered

---

## Executive Summary

This project delivered end-to-end integration of standalone developer plan executions into the project ledger. A new `ledger_import_standalone` MCP tool (the 30th tool in the server) creates a proper ledger project from any plan folder containing `plan.md` and `synthesis.md`, writes it with `runner: 'standalone'` for visual distinction in the GUI, and archives both documents into storage. The implementation spans six layers: a synthesis parser utility, an anchor-based path resolver upgrade, a new runner enum value with CSS badge, a `LedgerStore` storage method, the MCP tool with CLI wrapper, and a `standalone-archiver` ledger-support persona dispatched automatically by the standalone developer persona after synthesis. All deliverables are fully tested, documented, and architecturally consistent with established codebase conventions.

---

## What Was Built

### Phase 1 — Foundation (WP-001 to WP-004)

| WP | Spec | Deliverable | Files |
|----|------|------------|-------|
| WP-001 | WP-003.md | `parseOutcomeSummary()` utility — extracts `### Outcome Summary` from synthesis documents with `### Implementation Summary` fallback | `mcp-server/src/utils/synthesis-parser.ts` + 17-test suite |
| WP-002 | WP-001.md | `inferProjectRootFromPlanPath()` upgraded to anchor-based algorithm — finds `docs/agents` pair regardless of nesting depth, returns `string\|null` | `mcp-server/src/utils/ledger-root.ts` + `ledger-store.ts` + `project-lifecycle.ts` |
| WP-003 | WP-004.md | `### Outcome Summary` section added to standalone developer synthesis template (between `### Completion Status` and `### Implementation Summary`) | `personas/standalone/src/content/developer.md` + 3 generated targets |
| WP-004 | WP-002.md | `'standalone'` added as 5th runner enum value across Zod schemas, TypeScript union, GUI labels/order, CSS token pair (emerald, light + dark), and storage cast | 6 source files across `mcp-server/` |

### Phase 2 — Integration (WP-005 to WP-010)

| WP | Spec | Deliverable | Files |
|----|------|------------|-------|
| WP-005 | WP-005.md | `LedgerStore.importStandaloneProject()` — atomic storage bootstrap for imported standalone projects; `ImportStandaloneDetail` interface | `mcp-server/src/storage/ledger-store.ts` + 9-test suite |
| WP-006 | WP-006.md | `ledger_import_standalone` MCP tool — full validation pipeline, synthesis parsing, duplicate rejection, archival; registered as tool #30 | `mcp-server/src/tools/standalone-import.ts` + `index.ts` + 14-test suite |
| WP-007 | WP-007.md | `standalone-archiver` ledger-support persona — single-step archival workflow with graceful error handling and least-privilege tool scope | 5 persona files + C24 constraint documentation |
| WP-008 | WP-010.md | Standalone developer subagent dispatch — `Archive to Ledger (Optional)` step with all 3 target-conditional variants; non-blocking failure note | `personas/standalone/src/meta/developer.yaml` + `developer.md` + 3 generated targets |
| WP-009 | WP-009.md | CLI `import-standalone` command — single-plan and batch import modes, `--dry-run`, `--base-dir`, auto-rebuild on stale dist, duplicate-skip, confirmation prompt | `scripts/import-standalone.js` + `scripts/cli.js` |
| WP-010 | WP-PENDING.md | Developer dispatch verification pass + `subagents` field documentation for standalone suite; README corrections | `personas/standalone/README.md` + `api-surface.md` |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages completed | 10 / 10 |
| Pipeline stages passed | 43 / 43 (all stages in all WPs) |
| Rework cycles | 1 (WP-007: C24 id prefix violation, corrected immediately) |
| Security audits | 2 (WP-006, WP-009) — 0 Critical, 0 High findings |
| Total tests at close | 3,251 |
| New dedicated tests | ~49 (synthesis-parser: 17, ledger-root: 8, ledger-store: 9, standalone-import: 14) |
| Regressions | 0 |
| TypeScript compile status | Clean (`tsc --noEmit`) throughout |

---

## Strategic Recommendations

### Gold Nugget 1 — Anchor-Based Path Resolution
The `inferProjectRootFromPlanPath()` upgrade from a fixed 4-level `dirname()` walk to an anchor-based algorithm (`docs/agents` pair scan) is a correctness improvement with wide impact. Any future tooling that needs to find the repository root from a plan path should use this function rather than writing a custom depth walk. The `string|null` return contract with null-guard propagation to all callers is the pattern to follow for path utilities that may receive paths outside the expected structure.

### Gold Nugget 2 — Defense-in-Depth for Tool Input Paths
Security audit on WP-006 identified that `planFolderBasename()` validates only the basename, not the full normalized path. Two low-severity defense-in-depth improvements were noted: (1) add a `path.isAbsolute()` assertion after input resolution; (2) add a max-length guard on `outcomeSummary` (e.g. 4096 chars) to prevent unexpectedly large ledger records. Neither is blocking for a local developer tool, but both are advisable if the tool is ever exposed in a multi-user context.

### Gold Nugget 3 — Persona `id` Namespace Discipline (C24)
The WP-007 rework revealed that the `standalone-*` id namespace in `personas/ledger-support/` is **closed to new personas** — it exists only for the 9 historically migrated personas (a legacy artifact from their original `standalone/` location). The C24 constraint has been updated with a prominent ⚠️ warning and the ledger-support README corrected. All new ledger-support personas must use `ledger-support-{slug}`. This pattern should be verified whenever a new ledger-support persona is added.

### Gold Nugget 4 — Single-Tool Persona Scoping
The `standalone-archiver` persona uses `central_pm/ledger_import_standalone` (single-tool reference) rather than the wildcard `central_pm/*` used by all 9 peer personas. This is the correct least-privilege pattern for single-operation personas. The wildcard in peers reflects their need for multiple tools, not a policy mandate. Future single-purpose ledger-support personas should follow this scoping model.

### Gold Nugget 5 — Standalone Version Derivation Requires Persona-Builder ≥ 2.5.0
The standalone persona frontmatter shows `v1.0.0` even when the persona's `changelog:` entry lists a later version (e.g., `developer.yaml` at v1.2.0). Root cause confirmed: changelog-based frontmatter version derivation requires `@mistralys/persona-builder` >= 2.5.0 (the `resolveChangelogMeta` function). The currently installed version is 2.4.1. The known limitation is now documented in `constraints-build-system.md`. **Do not add a standalone `version:` field to YAML as a workaround** — this would conflict with the library's automated derivation after the upgrade.

---

## Critical Observations — Carried Forward

### 1. WP-008 Ledger Anomaly (HIGH PRIORITY — deferred)
The `WP-008` ledger entry was associated with `work/WP-010.md` (developer dispatch), not `work/WP-008.md` (GUI detail page verification for imported standalone projects). The original WP-008.md spec — **verifying that the GUI detail page renders correctly for `runner: 'standalone'` imported projects** — was never implemented. This scope was silently displaced by the ledger setup error and subsequently absorbed into WP-010's pipeline.

**Required follow-up:** Create a new WP for GUI verification of imported standalone projects. The spec is in `work/WP-008.md`. This is not cosmetic — users viewing an imported project in the GUI dashboard have no confirmation that the detail page, status badges, and runner label render as expected.

### 2. Pre-existing: Index.ts Startup Tool Log Gap (LOW)
The startup log string in `mcp-server/src/index.ts` is missing 3 tools from its manually-maintained list: `ledger_list_projects`, `ledger_detect_project`, `ledger_complete_synthesis`. Discovered during WP-006 documentation pass. No functional impact — tools are registered and callable. Low-priority cleanup.

### 3. Pre-existing: `repositoryName` Derivation Bypass (LOW)
`project-lifecycle.ts` L596-598 derives `repositoryName` via a raw `split/filter/pop` instead of delegating to `deriveRepoName()`. This bypasses the lowercase normalization and `assertSafeSegment` validation that `deriveRepoName()` applies. Flagged by Reviewer in WP-002. Low priority, out of scope here, but should be unified in a future cleanup WP.

---

## Deferred & Follow-Up Items

| Item | Source | Agent | Description | Priority | Type |
|------|--------|-------|-------------|----------|------|
| GUI detail page verification for `runner: 'standalone'` | WP-008.md (original spec) | Reviewer / QA (WP-008) | Original WP-008.md scope (GUI verification of imported project rendering) was displaced by a ledger entry anomaly and never implemented. Needs its own WP. | HIGH | Deferred |
| Upgrade `@mistralys/persona-builder` to ≥ 2.5.0 | WP-008 + WP-010 docs | Developer / Documentation | Fixes the standalone frontmatter version derivation gap (currently always `v1.0.0` regardless of changelog). Known limitation documented in `constraints-build-system.md`. | MEDIUM | Deferred |
| CTX regeneration | WP-010 docs | Documentation | `.context/personas/` files (standalone-suite.md, standalone-metadata.md, file-structure.md) are stale after Phase 1+2 changes. Run `node scripts/cli.js ctx-generate` to refresh. | LOW | Deferred |
| `ledger_import_standalone` cwd_path semantic callout | WP-006 code-review | Reviewer | Consider adding a README/usage guide note that `cwd_path` in this tool means the plan folder itself, not a workspace root (documented in api-surface.md but not in any top-level guide). | LOW | Deferred |
| `collectKnownSlugs()` error swallowing | WP-009 QA + Security | QA / Security Auditor | `collectKnownSlugs()` silently swallows directory read errors — a permission-denied entry would cause its slugs to appear absent, risking false "not tracked" results. Add `log.warn` at minimum. | LOW | Improvement |
| Index.ts startup tool log | WP-006 docs | Documentation | 3 tools missing from startup log string (`ledger_list_projects`, `ledger_detect_project`, `ledger_complete_synthesis`). Pre-existing gap. | LOW | Out-of-scope |
| `repositoryName` bypass in `project-lifecycle.ts` | WP-002 code-review | Reviewer | L596-598 uses raw path split instead of `deriveRepoName()`, bypassing lowercase + segment validation. Pre-existing inconsistency. | LOW | Out-of-scope |

---

## Next Steps for the Planner

1. **Priority 1 — GUI Verification WP:** Create a work package for `work/WP-008.md` (GUI detail page verification for standalone-imported projects). This is the only scope gap from this plan that has user-visible impact.

2. **Priority 2 — Persona-Builder Upgrade:** Plan an upgrade to `@mistralys/persona-builder` >= 2.5.0 to activate changelog-based frontmatter version derivation for the standalone suite. The known limitation is documented; the fix is a dependency bump + rebuild.

3. **Priority 3 — CTX Regeneration:** Run `node scripts/cli.js ctx-generate` to refresh `.context/` snapshots before the next planning cycle. Many files changed across mcp-server, personas, scripts, and docs.

4. **Priority 4 — Standalone Import Real-World Testing:** The batch import mode was verified against 187 plans during QA (`docs/agents/implementation-history/`). A follow-up pass importing historical plans into the ledger would validate the end-to-end flow at scale and populate the GUI's project history.

---

*Generated by: Head of Operations (Synthesis) — 2026-07-01*
