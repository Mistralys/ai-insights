# Synthesis Report — Orchestrator Sidecar & GUI Resume: Synthesis Rework

**Plan:** `2026-05-31-orchestrator-sidecar-gui-resume-rework`
**Generated:** 2026-05-31
**Status:** ✅ COMPLETE — 6/6 Work Packages delivered

---

## Executive Summary

This rework plan successfully closed all actionable items identified in the post-synthesis review of the initial orchestrator sidecar and GUI resume feature implementation. Six work packages were completed across three engineering domains: the MCP server GUI routing layer, the browser-side SPA, and the Python orchestrator CLI.

The highest-priority gap — a missing namespaced API route that left multi-root workspace users unable to retrieve run metadata for projects with shared slug names — was resolved with a correctly guarded, pattern-consistent route addition. Alongside this, all medium and low-priority items (API client test coverage, resume-button visibility tests, error-banner deduplication, interrupt detection hardening, and context regeneration) were delivered cleanly within a single session.

All 6 WPs passed every pipeline stage (implementation → QA → security-audit → code-review → documentation) with **zero blocking issues** across all reviews. One QA rework cycle occurred (WP-005) where the initial implementation satisfied supporting criteria but omitted the core test deliverable; it was self-corrected within the same session.

---

## Work Packages Summary

| WP | Title | Stages | Tests | Result |
|----|-------|--------|-------|--------|
| WP-002 | Add Namespaced `run-metadata` Route | impl → qa → security → review → docs | 17 tests / 2,777 regression | ✅ PASS |
| WP-003 | Flag-Based `INTERRUPTED` Detection in `cli.py` | impl → qa → review → docs | 1,017 regression | ✅ PASS |
| WP-004 | Extract `showResumeError` Helper in `project-detail.js` | impl → qa → review → docs | 35 tests (7 new) | ✅ PASS |
| WP-005 | Resume-Button Visibility Tests | qa → review | 43 tests (8 new) | ✅ PASS (1 QA rework) |
| WP-001 | API Client Tests (`getRunMetadata`, `orchestratorStart`) | qa → review | 2,777 regression | ✅ PASS |
| WP-006 | Context Snapshot Regeneration (`ctx-generate`) | docs | 32 context docs regenerated | ✅ PASS |

> **Note on WP IDs vs. files:** WP IDs in the ledger are sequenced in intake order; work package spec files follow the original plan numbering. The coverage sequence is: WP-001 (spec: WP-002) → WP-002 (spec: WP-001) → WP-003 (spec: WP-005) → WP-004 (spec: WP-003) → WP-005 (spec: WP-005) → WP-006.

---

## Metrics

### Test Coverage

| Component | Tests Before | Tests After | Delta |
|-----------|-------------|-------------|-------|
| `api-run-metadata.test.ts` (handler + HTTP) | 10 | 17 | +7 (HTTP integration) |
| `project-detail-runs.test.ts` | 28 | 43 | +15 (+7 WP-004, +8 WP-005) |
| Orchestrator regression suite | 1,017 | 1,017 | — (no regressions) |
| MCP Server regression suite | 2,771 | 2,777 | +6 (test count increase) |

### Pipeline Health

| Metric | Value |
|--------|-------|
| Total WPs | 6 |
| PASS rate | 100% (6/6) |
| Total pipelines executed | 17 (15 PASS, 1 FAIL → rework, 1 subsequent PASS) |
| Security issues (Critical/High/Medium) | 0 |
| QA rework cycles | 1 (WP-005) |
| Blocking code-review findings | 0 |

### Security Audit (WP-002)

- **0 Critical, 0 High, 0 Medium** findings.
- Defence-in-depth confirmed: `SAFE_SLUG_REGEX` at routing layer + `assertSafeSlug()` at handler layer + `resolveRepoName()` project-existence gate.
- 1 Low/Info pre-existing observation: `resolveRepoName()` logs full `metaPath` to stderr on malformed `.meta.json` — acceptable for local developer tooling, pre-dates this WP.

---

## Deliverables

### Files Modified

**MCP Server — Routing & Handler**
- `mcp-server/gui/server.ts` — Added `GET /api/projects/:repo/:slug/run-metadata` block (lines 648–672), pattern-consistent with all 6 sibling namespaced routes.
- `mcp-server/tests/gui/api-run-metadata.test.ts` — 7 new HTTP-level integration tests for the namespaced route.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Documented new route; updated `getRunMetadata()` API client table entry.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Corrected test count for `api-run-metadata.test.ts` (5 → 17).

**MCP Server — GUI Frontend**
- `mcp-server/gui/public/views/project-detail.js` — Extracted `showResumeError(msg)` helper, eliminating duplicated error-banner DOM creation; added inline deduplication comment.
- `mcp-server/tests/gui/project-detail-runs.test.ts` — Extended `renderWithAPI` with `getRunMetadata`/`orchestratorStart` stubs; added 8 resume-button visibility tests in a dedicated `describe` block.

**Orchestrator**
- `orchestrator/src/cli.py` — Module-level `_was_interrupted` flag set by all 3 interrupt paths (signal, KeyboardInterrupt-graph, KeyboardInterrupt-MCP startup); `_run()` docstring updated with side-effect documentation; substring matching removed from `_is_interrupted` determination.
- `orchestrator/docs/agents/project-manifest/constraints.md` — Constraint 24 updated to document flag-based detection.

**Context Snapshots (regenerated)**
- 32 `.context/` documents including `orchestrator/overview.md`, `orchestrator/manifest.md`, `mcp-server/manifest-api-surface.md`, `mcp-server/source-gui-frontend.md`, `mcp-server/tests.md`, and `CLAUDE.md`.

---

## Strategic Recommendations

### 🥇 Gold Nugget: Test Fixture Constraint for `planPath`

The `LedgerStore` constructor enforces a `YYYY-MM-DD-name` basename format via `planFolderBasename()`. When writing integration test fixtures, `plan_path` in `.meta.json` must conform to this pattern or the store construction fails silently (the `resolveProjectStore()` catch block returns `NOT_FOUND` and swallows the error). A shared test-fixture factory that always produces a valid `plan_path` would prevent this class of confusion for future contributors.

**Action:** Create a shared `createNamespacedProject(repo, slug)` fixture helper in a test utility module, with JSDoc explaining the `YYYY-MM-DD-slug` planPath constraint.

### 🔑 Error Swallowing in `resolveProjectStore()`

`gui/api.ts` line ~194: the catch block swallows all errors from `LedgerStore` construction (including `planFolderBasename()` pattern mismatches) and returns `NOT_FOUND`. This makes debugging corrupt `.meta.json` entries difficult in production. A `debug`-level `stderr` log of the caught error inside the catch block would improve operator diagnostics without leaking path information to API clients.

**Action:** Add `process.stderr.write('[api] resolveProjectStore error: ' + err.message + '\n')` inside the catch block.

### 🔑 `api-surface.md` Route Table Completeness

The GUI Server Routes table in `api-surface.md` uses a formal tabular format for some namespaced routes but the new `run-metadata` entry was added as a prose comment block. Additionally, the API client surface table does not yet reference the namespaced `GET /api/projects/:repo/:slug/run-metadata` variant (pending GUI client update). Maintaining a consistent table format across all routes will improve discoverability during future audits.

**Action (low priority):** Migrate the `run-metadata` route block in `api-surface.md` to the formal route-table format on the next documentation pass.

### ⚠️ Coverage Gap: KeyboardInterrupt Paths in `cli.py`

`TestSignalInterruptedRun` covers only the signal-triggered interrupt path. The two `KeyboardInterrupt` paths (graph execution at line 905, MCP startup at line 914) that set `_was_interrupted = True` have no dedicated test. This is a pre-existing gap not introduced by this WP.

**Action:** Add a follow-up WP to add `TestKeyboardInterruptRun` test cases for both paths.

### 🛠️ Test Isolation Pattern: Duplicate Helpers in `project-detail-runs.test.ts`

`makeResumableMeta()` and `flushResume()` are defined in both the WP-004 and WP-005 `describe` blocks. This is an intentional describe-level isolation pattern but is undocumented, risking future consolidation that would break isolation semantics.

**Action:** Add inline comments above each duplicated helper explaining the isolation intent (partially addressed by the documentation-forward from WP-005 code review).

### ⏱️ HIDE-Path Test Timing in Resume-Button Suite

Each HIDE-path test in the WP-005 `describe` block polls for `#orch-resume-btn || #orch-resume-error` and waits the full 300ms timeout before resolving. At current scale (~8 tests × ~326ms) this is acceptable, but will add ~2.6 seconds to the test suite. If the resume-button suite grows, a `render-settled` sentinel pattern would be more efficient.

---

## Failures & Rework Summary

| WP | Stage | Outcome | Root Cause |
|----|-------|---------|------------|
| WP-005 | qa (1st run) | FAIL | `describe('Resume Run button')` block absent — `renderWithAPI` stubs were extended (AC-2) but the 7+ test cases (AC-1) were omitted entirely in the initial delivery. |
| WP-005 | qa (2nd run) | PASS | 8 tests added in the `describe('Resume Run button')` block covering all 7 required show/hide conditions + 1 additional `thread_id: null` sub-case. |

No security findings, no blocking code-review issues, and no implementation rework cycles occurred across the remaining 5 WPs.

---

## Next Steps

### Immediate Follow-Up (High Value)

1. **GUI Client Namespaced Route Support:** The server now exposes `GET /api/projects/:repo/:slug/run-metadata` but `api-client.js` still calls only the non-namespaced variant. Update `API.getRunMetadata(slug)` to accept an optional `repo` parameter and use the namespaced route for multi-root workspaces.

2. **`resolveProjectStore()` Diagnostic Logging:** Add a `stderr` debug log inside the `catch` block to surface `LedgerStore` construction failures without exposing paths to API clients.

### Short-Term (Next Iteration)

3. **KeyboardInterrupt Test Coverage:** Add `TestKeyboardInterruptRun` to cover the two `_was_interrupted = True` assignments from non-signal interrupt paths in `cli.py`.

4. **Shared Namespaced Test Fixture Factory:** Extract `createNamespacedProject(repo, slug)` into a shared test utility to eliminate planPath constraint confusion.

5. **`api-surface.md` Route Table Normalization:** Migrate all namespaced route documentation to the formal table format.

### Deferred (Previously Scoped Out)

- Tombstone deprecation (requires broader impact analysis — separate plan).
- `startOrchestrator()` options-object refactor (no 5th parameter exists yet).
- UUID_V4 regex extraction (no second use site exists yet).

---

*Report generated by Head of Operations (Synthesis Agent) · Ledger v2.4.1 · Server v1.31.0*
