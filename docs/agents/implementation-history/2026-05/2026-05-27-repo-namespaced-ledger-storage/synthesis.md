# Project Status Report — Repo-Namespaced Ledger Storage

**Plan:** `2026-05-27-repo-namespaced-ledger-storage`
**Date:** 2026-05-27
**Status:** COMPLETE
**Synthesized by:** Head of Operations (Synthesis)

---

## Executive Summary

This session delivered a complete architectural upgrade to the MCP server's ledger storage layout,
migrating from a flat `{ledgerRoot}/{slug}/` structure to a two-level repo-namespaced layout:
`{ledgerRoot}/{repoName}/{slug}/`. The change eliminates slug collision risk across repositories and
aligns the filesystem layout with how multi-repo users organize their workspaces.

**Scope of change:**
- New utility functions: `deriveRepoName()`, `resolveProjectDir()`, `migrateToNamespacedLayout()`
- `LedgerStore` constructor updated to compute `repoName` and namespace `storageDir`
- `listAllProjects()` extended with a two-level scan (backward-compatible with old flat layout)
- One-time idempotent migration runs automatically on server startup
- All 17 GUI API handlers migrated to `resolveProjectStore()` — no handler constructs a
  bare-slug path anymore
- `run-log-handlers.ts` and `gui/server.ts` updated for `/:repo/:slug/runs` routes
- Orchestrator `_derive_slug_dir()` and `cli.py` log-copy path updated for namespaced paths
- All project-manifest docs, AGENTS.md, CLAUDE.md, and `.context/` snapshot updated

**Version outcome:** MCP server v1.30.2 → **v1.31.0** · Orchestrator → **v0.21.0** · Root → **v1.27.0**

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 12 / 12 COMPLETE |
| Pipeline stages passed | 54 / 54 |
| Rework cycles | WP-005 × 1, WP-007 × 1 |
| Security findings (Critical/High) | 0 |
| Security findings resolved (Medium) | 2 (both fixed before code-review PASS) |
| Test suite — project start | 2,236 |
| Test suite — project end | 2,312 |
| Net new tests | ~76 |
| Tests failing at end | 0 (all 2,312 pass) |
| TypeScript errors at end | 0 |
| Pre-existing failures (Python) | 3 (test_streaming_capture.py — Python 3.14 async incompatibility, unrelated) |

---

## Work Package Summary

| WP | Title | Stages | Outcome |
|----|-------|--------|---------|
| WP-001 | `deriveRepoName()` utility | impl → qa → review → docs | PASS |
| WP-002 | `LedgerStore` namespaced `storageDir` | impl → qa → review → docs | PASS |
| WP-003 | `migrateToNamespacedLayout()` | impl → qa → review → docs | PASS |
| WP-004 | `listAllProjects()` direct test coverage | impl → qa → review → docs | PASS |
| WP-005 | `resolveProjectDir()` utility | impl → qa → sec → review → docs (1 rework cycle) | PASS |
| WP-006 | `run-log-handlers.ts` namespaced `logsDir` | impl → qa → sec → review → docs | PASS |
| WP-007 | `gui/server.ts` `/:repo/:slug/runs` routes | impl → qa → sec → review → docs (1 QA rework) | PASS |
| WP-008 | Orchestrator `_derive_slug_dir()` + `cli.py` | impl → qa → review → docs | PASS |
| WP-009 | GUI route registration `/:repo/:slug` | impl → qa → sec → review → docs | PASS |
| WP-010 | Project-manifest doc update (canonical layout) | docs only | PASS |
| WP-011 | Migrate all 15 `LedgerStore` call sites in `gui/api.ts` | impl → qa → sec → review → docs | PASS |
| WP-012 | Cross-system docs + version bump | release-eng → docs | PASS |

---

## Rework Analysis

### WP-005 — `resolveProjectDir()` (1 rework cycle)

**Root cause:** The bare-slug branch never called `assertSafeSlug(slug)` before the filesystem
probe. A bare `'..'` input entered the scan path and matched every namespace directory instead of
being rejected immediately.

**Fix applied:** `assertSafeSlug(slug)` added as the first statement in the bare-slug branch
(before any `readdir()` call). A new test explicitly covers `resolveProjectDir('..', tempLedgerRoot)`
rejecting with `'Invalid path segment'`. Security re-audit passed with zero Medium/High findings.

**Lesson:** Input validation must be symmetric across all code branches. The qualified-path branch
was secure but the bare-slug branch relied on the filesystem to absorb the bad input.

### WP-007 — `gui/server.ts` `/:repo/:slug/runs` routes (1 QA rework)

**Root cause:** AC3 required `repoName` to be derived from the resolved `.meta.json` object, not
the raw URL param. The implementation used `decodeURIComponent(rest[1])` directly — correct
security posture, but the meta-resolution requirement was not implemented.

**Fix applied:** `resolveRepoName()` helper added to read `.meta.json` before serving logs. Throws
`NOT_FOUND` if the project does not exist. Also closes a gap where a non-existent
`{repo}/{slug}` combination returned `200 []` instead of `404`.

---

## Security Summary

No Critical or High findings across any WP. All Medium findings were remediated before code-review
sign-off:

| WP | Finding | Severity | Resolution |
|----|---------|----------|------------|
| WP-005 | A04: bare-slug branch allowed `..` to enter filesystem scan | Medium | Fixed in rework — `assertSafeSlug(slug)` added before `readdir()` |
| WP-007 | A01: `repoUrlParam` used in `join()` before explicit SAFE_SLUG_REGEX guard | Medium | Fixed by Reviewer (Fix-Forward) — explicit guards added before all `join()` calls |

Remaining Low findings (accepted, documented in constraints.md):

- `resolveRepoName()` in `server.ts` relies on call sites to pre-validate — no internal guard.
- `plan_path` from `.meta.json` is passed to `LedgerStore` without a containment check (local
  developer tool, acceptable risk).
- `NOT_FOUND` error in `resolveProjectDir()` embeds the absolute `ledgerRoot` path — must be
  sanitised before API surface exposure (documented in constraints.md Gotcha 13).
- `assertSafeSlug` exists in two modules with different error types (intentional layer separation,
  documented as KL-3).

---

## Strategic Recommendations (Gold Nuggets)

### 1. Follow-Up WP Required — Dialogue/Chunk Handlers (Medium Priority)

**Finding (identified by Developer in WP-011, confirmed by QA/Security Auditor/Reviewer):**
`handleListDialogues`, `handleGetDialogueFile`, `handleListChunks`, `handleGetChunkFile` still use
`join(ledgerRoot, slug, DIALOGUES_DIR/CHUNKS_DIR)` — non-namespaced paths. They accept `repoName`
in their signatures (forward-compatibility stubs) but ignore it.

**Impact:** Once projects are stored in namespaced directories, these four handlers will return
empty results or serve stale data from `{ledgerRoot}/{slug}/` paths that no longer exist.

**Recommended action:** Create a follow-up WP to migrate these four handlers to use
`resolveProjectStore()`. This is the only remaining gap in the GUI layer.

Documented in `constraints.md` as **KL-4**.

---

### 2. Extract `assertSafeSlug` to a Shared Utility (Low Priority, Before Next Expansion)

**Finding (flagged by Security Auditor in WP-005, WP-006; repeated in WP-007, WP-009):**
Two independent `assertSafeSlug` implementations exist:
- `mcp-server/src/utils/ledger-root.ts` — throws plain `Error` (storage layer)
- `mcp-server/src/gui/handlers/run-log-handlers.ts` — throws `ApiError NOT_FOUND` (GUI layer)

Both use `SAFE_SLUG_REGEX` from `constants.ts`. The separation is intentional (layer error types
differ), but the logic must be kept in sync manually.

**Recommended action:** Extract a shared `assertSafeSegment(segment, ErrorClass)` utility to
`src/utils/path-validator.ts` before a third consumer appears. Cross-reference comments are in
place in both files. Documented in `constraints.md` as **KL-3**.

---

### 3. Add a Direct Unit Test for the `cli.py` Ledger Log Copy Path

**Finding (flagged by QA and Reviewer in WP-008):**
`orchestrator/src/cli.py` lines ~865–878 contain an inline `repo_name` derivation
(`plan_dir.parents[3].name or 'unknown'`) identical to `_derive_slug_dir()`, but with no
dedicated unit tests.

**Recommended action:** Add a parametrized test in `orchestrator/tests/test_slug_dir.py` mirroring
the `TestDeriveSlugDirFallback` pattern, asserting the `ledger_log_dir` shape for various
`plan_dir` depths.

---

### 4. Add `@security` JSDoc to `resolveProjectStore()` (Low Priority)

**Finding (Reviewer in WP-011):**
The `AMBIGUOUS → NOT_FOUND` error downgrade in `resolveProjectStore()` has an inline comment
(added as Fix-Forward), but the function's JSDoc block still lacks a `@remarks` / `@security`
note documenting the intentional information-hiding design.

**Recommended action:** Add a `@remarks` block to the JSDoc of `resolveProjectStore()` in
`gui/api.ts` before any external contributor encounters the function.

---

### 5. Strengthen `resolveRepoName()` Defence-in-Depth

**Finding (Security Auditor WP-011):**
`resolveRepoName()` in `gui/server.ts` relies entirely on call sites to pre-validate
`repoUrlParam` and `slugUrlParam`. Adding `assertSafeSlug()` calls at the top of the function
would make it safe-by-default if ever reused.

**Recommended action:** Add two `assertSafeSlug()` calls inside `resolveRepoName()` in a
future hardening pass. No active exploit path exists today.

---

## Architecture Decisions Recorded This Session

| Decision | Location |
|----------|----------|
| `listAllProjects()` is the canonical slug-to-path resolver — callers with only a slug must use it before constructing a `LedgerStore` | `api-surface.md` (architectural constraint note) |
| `resolveProjectStore()` is the canonical store-resolution helper for GUI handlers | `api-surface.md` (new entry) + `constraints.md` KL-4 |
| `AMBIGUOUS` errors from `resolveProjectDir()` are intentionally downgraded to `NOT_FOUND` to prevent cross-namespace slug existence leakage | Inline comment in `gui/api.ts` + Gotcha 13 in `constraints.md` |
| Storage layout version tracked via `STORAGE_VERSION` in `migrate-namespaced.ts` | AGENTS.md Cross-System Dependencies table |
| `'unknown'` namespace collision is a known limitation for repos with non-slug-compatible directory names | `constraints.md` KL-1 |

---

## Next Steps for Planner / Manager

1. **Follow-up WP (required):** Migrate dialogue and chunk handlers to `resolveProjectStore()` —
   see KL-4 in `constraints.md`. Estimated scope: 4 handlers in `gui/api.ts`.
2. **Regression sweep:** Run `npm run test` and `npm run build` in `mcp-server/` to confirm the
   green state after the session.
3. **CTX freshness:** Run `node scripts/cli.js ctx-generate` to pick up the WP-012 documentation
   changes in the `.context/` snapshot (WP-012 confirmed regeneration at completion).
4. **Changelog review:** `mcp-server/changelog.md` (v1.31.0), `orchestrator/changelog.md`
   (v0.21.0), and root `changelog.md` (v1.27.0) were updated by the Release Engineer in WP-012.
   Verify entries are consistent before tagging the release.
5. **Python 3.14 compatibility:** 3 pre-existing failures in
   `orchestrator/tests/test_streaming_capture.py` (async `StopIteration` in mock setup) should
   be resolved in a separate WP scoped to the orchestrator test suite.

---

*Report generated by the Synthesis Agent on 2026-05-27.*
