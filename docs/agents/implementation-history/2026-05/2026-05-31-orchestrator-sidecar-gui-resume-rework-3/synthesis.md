# Synthesis Report
## Plan: `2026-05-31-orchestrator-sidecar-gui-resume-rework-3`

**Generated:** 2026-05-31  
**Status:** COMPLETE  
**Total Work Packages:** 6 / 6 COMPLETE  
**Total Pipeline Stages Passed:** 23 / 23

---

## Executive Summary

This plan addressed all actionable follow-up items from the prior synthesis (`2026-05-31-orchestrator-sidecar-gui-resume-rework-2`). Six work packages delivered across two codebases (TypeScript `mcp-server` and Python `orchestrator`) covering:

1. **Security hardening** — closed a path-traversal gap in the MCP server's queue-entry validation layer with defense-in-depth guards.
2. **Python DRY refactor** — extracted a shared `_derive_repo_name()` helper in `orchestrator/src/cli.py`, aligning Python with TypeScript's lowercasing convention.
3. **GUI cache-key centralization** — introduced `makeProjectCacheKey(repo, slug)` in `utils.js`, eliminating repeated inline `repo + '/' + slug` concatenation.
4. **ProjectNameCache eviction** — replaced an unbounded IIFE-based map with a bounded 200-entry FIFO implementation.
5. **jsdom test coverage** — created `tests/gui/project-list.test.ts` (8 tests), filling the last GUI test gap flagged in prior syntheses.
6. **Cross-cutting documentation** — consolidated all deliverables into project-manifest docs, constraints, and CTX context files.

All changes were approved through full implementation → QA → (security audit where applicable) → code-review → documentation pipelines with zero regressions.

---

## Work Package Summary

| WP | Title | Pipelines | Tests Passed | Security Issues |
|----|-------|-----------|--------------|-----------------|
| WP-001 | `isRawQueueEntry()` + `getProjectLedgerStatus()` path-segment hardening | impl → qa → sec → review → docs | 2,851 | 0 |
| WP-002 (plan WP-004) | `ProjectNameCache` bounded FIFO eviction (200-entry cap) | impl → qa → review → docs | 2,851 | — |
| WP-003 (plan WP-002) | `_derive_repo_name()` Python helper extraction | impl → qa → sec → review → docs | 1,042 | 0 |
| WP-004 (plan WP-003) | `makeProjectCacheKey()` GUI helper + 3-site migration | impl → qa → review → docs | 2,851 (82 GUI) | — |
| WP-005 | `tests/gui/project-list.test.ts` jsdom test file | impl → qa → review → docs | 2,859 | — |
| WP-006 | Cross-cutting documentation consolidation | docs only | — | — |

**MCP server cumulative test count progression:** 2,851 → 2,859 (+8 new tests)  
**Orchestrator test count:** 1,042 (stable, +7 new `TestDeriveRepoName` cases within that count)

---

## Metrics

| Metric | Value |
|--------|-------|
| mcp-server test suite (final) | **2,859 passed / 0 failed** (94 test files) |
| orchestrator test suite (final) | **1,042 passed / 6 skipped / 0 failed** |
| Security findings (Critical/High/Medium) | **0** across all audited WPs |
| Security findings (Low/Info) | 6 (all informational — no action required) |
| Pre-existing unrelated failures | 2 in `scripts/tests/health-checks.test.js` (missing sibling-cli-menu registry entry, not introduced by this plan) |
| Fix-Forward edits applied by Reviewer | 3 (import reordering in `get-queue.ts`; FIFO eviction comment in `utils.js`; stale WP-013 JSDoc removal in `utils.js`) |
| Documentation-forward items raised | 5 (all resolved by Documentation agent) |
| Regressions introduced | **0** |

---

## Deliverables

### Security Hardening (WP-001)

**Files modified:**
- `mcp-server/src/gui/queue/validate-entry.ts` — extended `isRawQueueEntry()` to normalize empty-string and whitespace-only `expectedRepo` to `null`
- `mcp-server/src/gui/queue/get-queue.ts` — added `assertSafeSegment()` defense-in-depth guard to `getProjectLedgerStatus()` for both `slug` and `expectedRepo`
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — TC-26, TC-27 (empty-string, whitespace normalization)
- `mcp-server/tests/gui/queue/get-queue.test.ts` — 6-case path-segment guard suite
- `mcp-server/src/utils/path-validator.ts` — module-level JSDoc added
- `mcp-server/docs/agents/project-manifest/constraints.md` — Constraint 74 (two-layer queue-entry validation pattern)

### Python DRY Refactor (WP-003)

**Files modified:**
- `orchestrator/src/cli.py` — `_derive_repo_name(plan_dir, fallback)` extracted; `.lower()` aligns with TypeScript `deriveRepoName()` convention; both inline `try/except` blocks replaced
- `orchestrator/tests/test_cli.py` — 7 new `TestDeriveRepoName` cases
- `orchestrator/docs/agents/project-manifest/api-surface.md` — `_derive_repo_name()` documented

### GUI Cache-Key Helper (WP-004)

**Files modified:**
- `mcp-server/gui/public/utils.js` — `makeProjectCacheKey(repo, slug)` added
- `mcp-server/gui/public/views/project-list.js` — 1 call site migrated
- `mcp-server/gui/public/views/project-detail.js` — 1 call site migrated
- `mcp-server/docs/agents/project-manifest/api-surface.md` — documented
- `mcp-server/docs/agents/project-manifest/file-tree.md` — documented

### ProjectNameCache Bounded Eviction (WP-002)

**Files modified:**
- `mcp-server/gui/public/utils.js` — IIFE replaced with 200-entry FIFO bounded cache; `_size()` method for testing; `hasOwnProperty` guard for duplicate key safety; FIFO-vs-LRU comment added
- `mcp-server/docs/agents/project-manifest/api-surface.md` — updated ProjectNameCache entry (was stale)
- `mcp-server/docs/agents/project-manifest/file-tree.md` — updated
- `mcp-server/README.md` — GUI unit test coverage gap noted

### jsdom Test Coverage (WP-005)

**Files created:**
- `mcp-server/tests/gui/project-list.test.ts` — 8 tests covering:
  1. Clickable `<a>` link for projects with `repository_name`
  2. Read-only name cell for null-repo projects
  3. `ProjectNameCache` populated with composite key for repo-bearing entries, not populated for null-repo entries
  4. `action-menu-wrapper` `data-repo`/`data-slug` attributes (both non-empty and empty-string repo)
  5. Portal action handler skips and logs `console.error` when `data-repo` is empty

### Cross-cutting Documentation (WP-006)

**Files modified:**
- `mcp-server/docs/agents/project-manifest/api-surface.md` — `getProjectLedgerStatus()` updated with `assertSafeSegment()` validation note
- `mcp-server/docs/agents/project-manifest/file-tree.md` — `project-list.test.ts` entry added; `validate-entry.ts` and `validate-entry.test.ts` annotations updated
- `orchestrator/docs/agents/project-manifest/api-surface.md` — `_derive_repo_name()` CLI private-helper table

---

## Strategic Recommendations (Gold Nuggets)

### 1. Two-Layer Input Validation is Now a Documented Pattern (Constraint 74)
The dual-layer guard (type-guard normalization → path-construction guard) is now codified as Constraint 74 in `constraints.md`. This pattern should be applied to any future path-construction boundary that accepts queue-file values. Future Planners should reference Constraint 74 when designing MCP server features that consume orchestrator-written data.

### 2. ~~`_derive_repo_name()` Lowercasing Breaks Mixed-Case On-Disk Ledger Paths~~ **ACCEPTED**
The new `.lower()` call in `_derive_repo_name()` aligns Python with TypeScript, but creates a **deployment migration concern** for environments where the orchestrator previously wrote mixed-case `repo_name` values to the queue and/or ledger log directories. The QA agent flagged this explicitly. Before deploying to environments with existing ledger data, a one-time path normalization script should be confirmed or a migration note should be added to `CHANGELOG.md`.

> All repo names in storage are lowercase already.

### 3. ~~`ProjectNameCache` FIFO vs. LRU — Eviction Semantics are Documented but Not Tested at Scale~~ **ACCEPTED**
The bounded FIFO cache correctly caps at 200 entries. However, no persistent unit test file was created for it (QA verified inline, and the README now notes the gap). The test file `tests/gui/utils-project-name-cache.test.ts` was explicitly called out in `README.md` as planned — this should be created in the next plan cycle before `utils.js` is modified again. Also: should usage patterns shift toward high-frequency updates to the same project names, the FIFO-not-LRU semantics may cause frequently-used entries to be evicted while stale entries persist — evaluate if usage warrants an upgrade to proper LRU at that time.

### 4. ~~`scripts/tests/health-checks.test.js` Has Pre-existing Failures~~ **DONE**
Two test failures in `health-checks.test.js` (missing `sibling-cli-menu` registry entry) were visible across multiple WPs. These are not regressions from this plan but indicate a documentation or registry drift that should be addressed. Leaving known failures in the test suite erodes confidence in the CI signal.

> Removed, as it was deprecated.

### 5. ~~`path-validator.ts` Has Two Distinct Responsibilities — Consider Future Split~~ **DONE**
The module currently houses both pure path-segment utilities (`assertSafeSegment`, `planFolderBasename`, `validatePlanPath`) and a LedgerStore-dependent resolver (`resolveProjectPath`). This cohesion concern was flagged in both the code-review and documentation pipelines and is now captured in the module's JSDoc. A future refactor should extract `resolveProjectPath` into a dedicated `project-resolver.ts` to keep `path-validator.ts` as a pure, easily-testable utility module.

### 6. ~~`assertSafeSegment()` Has No Maximum Length Bound~~ **DONE**
The security audit identified that `SAFE_SLUG_REGEX` enforces character set but not maximum string length. Very long valid slugs (e.g., 500+ chars) pass through to the OS path layer. While not exploitable for traversal, a maximum length guard (e.g., 128 chars) would be a low-effort hardening improvement worth adding in the next security-focused plan.

---

## Incident Log

| Type | Agent | WP | Description | Resolved |
|------|-------|----|-------------|----------|
| Ledger guard false-positive | Documentation | WP-006 | `ledger_claim_work_package` and `ledger_begin_work` rejected claim on READY WP-006 citing WP-005 as still "active", despite WP-005 being COMPLETE. Appears to be a stale active-WP guard in the ledger server. No workaround found by the agent. | No — reported in project comments |

---

## Next Steps for Planner / Project Manager

1. **Create `tests/gui/utils-project-name-cache.test.ts`** — Fill the persistent test gap for `ProjectNameCache` AC-1 through AC-4, as noted in `README.md`. Low effort; high value for future `utils.js` changes.

2. **Resolve `health-checks.test.js` failures** — Add the missing `sibling-cli-menu` registry entry or remove the stale test assertions. Known failures in CI erode signal quality.

3. **Deployment migration check** — Validate that environments with mixed-case `repo_name` values in existing ledger log directories can handle the new `.lower()` output from `_derive_repo_name()`. Consider a one-time migration script or CHANGELOG entry.

4. **`assertSafeSegment()` length cap** — Add a `maxLength` guard (128 chars suggested) as a low-effort hardening follow-up.

5. **`path-validator.ts` module split** — Extract `resolveProjectPath` into a dedicated `project-resolver.ts` to reduce coupling in a future refactor plan.

6. **Investigate and fix the ledger active-WP guard bug** — The false-positive rejection during WP-006 claim (see Incident Log) should be investigated in the `central_pm` server. If reproducible, it represents a workflow blocker for future plans with long dependency chains.
