# Synthesis Report — Multi-Store Ledger Root Fix

**Project:** `2026-08-02-multi-store-ledger-root-fix`  
**Date:** 2026-08-02  
**Status:** COMPLETE  
**Agent:** Head of Operations (Synthesis v3.7.1)

---

## Executive Summary

This project eliminated a class of silent failures in multi-store mode that affected every surface of
the AI Insights system. When a project was registered in a non-default ledger store, read and write
operations across 18 MCP tool handlers, the GUI API layer (20+ HTTP handlers), the auto-archive
service, the standalone-import tool, and the orchestrator's path helpers all silently targeted the
default store — producing file-not-found failures on reads and phantom directory creation on writes.

The fix was delivered in six work packages across a single session:

- **WP-001** extracted `extractLedgerRoot` and `resolveMultiStoreLedgerRoot` from `work-package.ts`
  into a new shared module (`src/utils/store-resolution.ts`), establishing the canonical resolution
  utility.
- **WP-002** fixed the GUI HTTP layer (`gui/api.ts`, `gui/server.ts`) and auto-archive service to
  iterate all store paths in multi-store mode.
- **WP-003** created a Python mirror (`orchestrator/src/utils/store_resolution.py`) and applied it
  to both orchestrator path helpers (`_derive_slug_dir`, `_derive_ledger_log_dir`).
- **WP-004** applied `resolveMultiStoreLedgerRoot()` to all 18 affected MCP tool handlers across 7
  source files, and added 18 handler-level integration tests.
- **WP-005** fixed `standalone-import.ts`'s two handlers to use the correct patterns
  (`resolveStoreForWrite` for writes, `resolveMultiStoreLedgerRoot` for read-then-write).
- **WP-006** updated manifest documentation across MCP server, orchestrator, and the root `AGENTS.md`
  cross-system dependency table.

No blocking issues, security concerns, or regressions were found. All 47 new tests pass.

---

## Metrics

### TypeScript Test Suite (MCP Server)

| Metric | Value |
|--------|-------|
| Tests passed | **4,010** |
| Tests failed | 0 |
| New tests added | **47** |
| New test files | 5 |
| TypeScript compile errors | 0 |

### Python Test Suite (Orchestrator, non-live-API)

| Metric | Value |
|--------|-------|
| Tests passed | **~1,131** |
| Tests failed | 0 |
| Tests skipped | 5 |
| New tests added | 7 |
| Pre-existing live-API failures | 2 (unrelated — API key auth errors, pre-existing) |

### Pipeline Health

| WP | Stages | Status |
|----|--------|--------|
| WP-001 | implementation → qa → code-review → documentation | All PASS |
| WP-002 | implementation → qa → code-review → documentation | All PASS |
| WP-003 | implementation → qa → code-review → documentation | All PASS |
| WP-004 | implementation → qa → code-review → documentation | All PASS |
| WP-005 | implementation → qa → code-review → documentation | All PASS |
| WP-006 | documentation | PASS |

All 6 WPs COMPLETE. All acceptance criteria met (36 criteria across 6 WPs, 36 met).

### New Files Delivered

**Production:**
- `mcp-server/src/utils/store-resolution.ts` — shared TypeScript store-resolution utility
- `orchestrator/src/utils/store_resolution.py` — Python mirror utility (stdlib-only)

**Tests (new):**
- `mcp-server/tests/utils/store-resolution.test.ts` — 11 unit tests for the shared utility
- `mcp-server/tests/gui/multi-store-api.test.ts` — 5 GUI API integration tests
- `mcp-server/tests/gui/auto-archive-multi-store.test.ts` — 2 auto-archive tests
- `mcp-server/tests/tools/multi-store-tool-resolution.test.ts` — 18 handler integration tests
- `mcp-server/tests/tools/standalone-import-multi-store.test.ts` — 4 standalone-import tests
- `orchestrator/tests/test_store_resolution.py` — 7 Python resolution tests

---

## Strategic Recommendations

### Gold Nuggets

**1. The shared-utility extraction pattern is now the authoritative pattern for cross-cutting store concerns.**  
The `store-resolution.ts` module follows the `project-resolver.ts` precedent: pure functions, no
class, stateless, clean imports. Constraint 86 was added to `constraints.md` to codify this as a
mandatory rule: any future MCP tool handler constructing `LedgerStore` must call
`resolveMultiStoreLedgerRoot()`, not bare `extractLedgerRoot()`.

**2. Handler count audits matter.**  
WP-004 was scoped for 16 handlers but found 18 affected calls during test-writing (`getWorkPackage`
at `work-package.ts:L106` and `createWorkPackage` at `L269` were both missed in the plan). The
integration-test-first discovery process caught both gaps before release. Future multi-surface
migrations should include a grep pass before estimating scope.

**3. Test isolation from user configuration is a mandatory practice for orchestrator tests.**  
The developer's real `~/.ai-insights/stores.json` registers `ai-insights` in a non-default store.
This caused two pre-existing orchestrator test files (`test_slug_dir.py`,
`test_streaming_capture.py`) to resolve the wrong store path during testing until autouse fixtures
were added. Any orchestrator test that calls store resolution (directly or transitively) must mock
`src.nodes.resolve_store_for_repo` and `src.cli.resolve_store_for_repo` via an autouse fixture.
This pattern should be documented in the orchestrator test README.

**4. The ENOENT / AMBIGUOUS / corrupt-JSON triaging in `resolveProjectStore()` is architecturally correct and should be preserved.**  
ENOENT and AMBIGUOUS both signal "not in this store" → continue loop. Corrupt JSON signals a
genuine storage error → log and 404. The security rationale (AMBIGUOUS downgraded to NOT_FOUND to
prevent cross-namespace slug enumeration) is well-documented in the source. Never conflate these
three cases again.

**5. The Python `store_resolution.py` broad-exception pattern is intentional by design.**  
The `_load_json()` function silently swallows all I/O and parse failures, mirroring the existing
`nodes/__init__.py` pattern. This is correct for a fallback-capable utility, but a debug-level log
statement would make misconfigured environments diagnosable without changing the fallback semantics.
Consider adding `logging.debug(f"store_resolution: could not load {path}: {e}")` in a follow-on.

---

## Deferred & Follow-Up Items

### Deferred (intentionally postponed, in scope of future WPs)

| # | Source | Agent | Description | Priority |
|---|--------|-------|-------------|----------|
| D-1 | WP-001 (impl) | Developer | `createWorkPackage` write routing: the WP-001 developer noted this handler should use `resolveStoreForWrite` (not `resolveMultiStoreLedgerRoot`) because it is a write operation. WP-004 fixed it to use `resolveMultiStoreLedgerRoot` for consistency, but a true write-routing fix (routing new WP creation to the correct registered store on write) still requires applying `resolveStoreForWrite`. | medium |
| D-2 | WP-003 (code-review) | Reviewer | `TestDeriveSlugDirMultiStore` and `TestDeriveLedgerLogDirMultiStore` test classes do not actually call `_derive_slug_dir()` or `_derive_ledger_log_dir()` — they test `resolve_store_for_repo()` directly. Adding a `_stores_config_path` parameter to both helpers (mirroring TypeScript's `_ledgerRoot` pattern) would enable direct multi-store testing. | low |

### Out-of-Scope (beyond this plan's boundaries, flagged for future consideration)

| # | Source | Agent | Description | Priority |
|---|--------|-------|-------------|----------|
| O-1 | WP-005 (code-review) | Reviewer | **Typed error class refactor:** `importStandalone()` and `initializeProject()` both discriminate `resolveStoreForWrite` errors via string matching (`!msg.includes('not registered in any store')`). This is fragile if the error message changes. A `StoreNotRegisteredError` typed exception class would eliminate the string match in both callers. | low |
| O-2 | WP-002 (impl) | Developer | **`resolveProjectDir()` leaky abstraction:** The function does not verify path existence for qualified slugs — it simply constructs the path and returns, leaving ENOENT detection to the caller's `.meta.json` read. Adding an existence check inside `resolveProjectDir()` for the qualified-slug path would remove the leaky abstraction. | low |
| O-3 | WP-002 (code-review) | Reviewer | **`auto-archive.ts` guard inconsistency:** Uses `isStoreContextInitialized()` alone while `resolveProjectStore()` and `resolveRepoName()` both use `isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()`. Functionally equivalent, but visually inconsistent for future contributors. Align to the two-condition guard. | low |
| O-4 | WP-004, WP-006 (impl) | Documentation | **CTX regeneration needed:** `.context/mcp-server/manifest-data-flows.md`, `.context/mcp-server/manifest-constraints.md`, and `.context/agents.md` are stale following documentation updates in WP-004 and WP-006. Run `node scripts/cli.js ctx-generate` before the next planning cycle. | low |
| O-5 | WP-003 (impl) | Developer | **`store_resolution.py` silent exception swallowing:** `_load_json()` swallows all I/O and JSON parse failures. Adding `logging.debug(...)` for caught exceptions would make misconfigured environments diagnosable without altering fallback behavior. | low |

---

## Next Steps

**Immediate (before next release):**
1. Run `node scripts/cli.js ctx-generate` to refresh stale `.context/` snapshots (O-4 above).
2. Verify the changelog entries for `mcp-server/` and `orchestrator/` cover the multi-store fix.

**Next planning cycle candidates:**
1. **Write-routing for `createWorkPackage` (D-1):** This is the only remaining handler that doesn't
   route writes to the correct store. It is medium-priority because WP creation in a non-default
   store silently falls back to the default store.
2. **Typed error class for `StoreNotRegisteredError` (O-1):** Low effort, high correctness gain
   — eliminate two string-matching error discriminators in `project-lifecycle.ts` and
   `standalone-import.ts`.
3. **`resolveProjectDir()` existence check (O-2):** Remove the leaky abstraction to make the GUI
   API error semantics cleaner.
4. **Orchestrator test README update:** Document the autouse fixture pattern for store-resolution
   isolation so future contributors don't rediscover the user-config leakage issue.

---

*Generated by Head of Operations (Synthesis v3.7.1) · 2026-08-02*
