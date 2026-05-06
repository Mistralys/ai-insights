# Project Synthesis Report

**Plan:** 2026-05-05-gui-orchestrator-integration-rework-1
**Date:** 2026-05-05
**Status:** COMPLETE — 7/7 work packages delivered

---

## Executive Summary

This session delivered a focused hardening and quality pass on the GUI orchestrator integration
layer, targeting five discrete concerns identified in a prior code review: deduplication of
status-computation logic, HTTP request body-size enforcement, path-traversal guard
completeness, a bug fix for CONFLICT errors returning the wrong HTTP status, and
documentation of a known locking parity gap.

All seven work packages passed all pipeline stages (implementation → QA → security audit →
code review, and documentation where applicable). No regressions were introduced: the
TypeScript MCP server test suite grew from 2,096 to 2,108 tests with 0 failures; the Python
orchestrator suite stands at 983 passed, 6 skipped, 0 failed.

One medium-severity security finding was recorded but not remediated within this session scope
(see Critical Follow-Up below).

---

## Work Package Summary

| WP | Title | Type | Stages | Result |
|----|-------|------|--------|--------|
| WP-001 | Extract `computeEffectiveStatus()` helper | Refactor | impl → qa → sec → review | PASS |
| WP-002 | 1 MiB HTTP body-size cap | Security / Feature | impl → qa → sec → review | PASS |
| WP-003 | `test_removing_last_entry_leaves_empty_list` | Test coverage | qa → review | PASS |
| WP-004 | Backslash guard for `assertSafeWpId/QueueId` | Security hardening | impl → qa → sec → review | PASS |
| WP-005 | Integration smoke test: `GET /api/orchestrator/queue` | Test coverage | qa → review | PASS |
| WP-006 | Fix CONFLICT errors returning 409 not 500 | Bug fix | impl → qa → review | PASS |
| WP-007 | `writeQueueFileAtomic()` locking-parity JSDoc | Documentation | documentation | PASS |

---

## Metrics

### TypeScript MCP Server (Vitest)

| Metric | Value |
|--------|-------|
| Tests passed | 2,108 |
| Tests failed | 0 |
| Test files | 69 |
| New test files added | 3 (`server-body-limit.test.ts`, `server-queue.test.ts`, `server-error-mapping.test.ts`) |
| Security issues (Critical/High) | 0 |
| Security issues (Medium) | 1 (flagged, not remediated — see below) |

### Python Orchestrator (pytest)

| Metric | Value |
|--------|-------|
| Tests passed | 983 |
| Tests skipped | 6 |
| Tests failed | 0 |
| New tests added | 1 (`test_removing_last_entry_leaves_empty_list`) |

### Files Modified

| File | WP(s) |
|------|-------|
| `mcp-server/gui/orchestrator-manager.ts` | WP-001, WP-007 |
| `mcp-server/gui/server.ts` | WP-002, WP-006 |
| `mcp-server/gui/api.ts` | WP-004 |
| `mcp-server/tests/gui/server-body-limit.test.ts` | WP-002 (new) |
| `mcp-server/tests/gui/api-orchestrator.test.ts` | WP-004 |
| `mcp-server/tests/gui/api.test.ts` | WP-004 |
| `mcp-server/tests/gui/server-queue.test.ts` | WP-005 (new) |
| `mcp-server/tests/gui/server-error-mapping.test.ts` | WP-006 (new) |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-006 |
| `orchestrator/tests/test_run_queue.py` | WP-003 |

---

## Critical Follow-Up (Required)

### `assertSafeSlug()` missing backslash guard — Windows path-traversal risk

**Severity:** Medium (A01 Broken Access Control) | **Flagged by:** Security Auditor + Reviewer

WP-004 correctly added `id.includes('\\')` to both `assertSafeWpId()` and
`assertSafeQueueId()`. However, the sibling function `assertSafeSlug()` (line 97 of
`gui/api.ts`) was not updated — it protects 14+ `path.join(ledgerRoot, slug, ...)` call
sites. On Windows, a backslash in a slug is treated as a directory separator by Node.js
`path.join()`, making this an active path-traversal vector for non-browser HTTP clients on
the LAN.

**Minimum remediation:** Add `id.includes('\\')` to `assertSafeSlug()` (matching the
pattern applied to the other two guard functions) and add a corresponding test.

**After fix:** Update the `assertSafeSlug()` JSDoc to list all three vectors (forward-slash,
backslash, `..`) consistent with `assertSafeWpId()` and `assertSafeQueueId()`.

---

## Strategic Recommendations

### 1. Replace blocklist guards with an allowlist regex

All three guard functions (`assertSafeSlug`, `assertSafeWpId`, `assertSafeQueueId`) use an
additive blocklist approach. The `assertSafeSlug` backslash gap is a textbook example of the
failure mode this creates. Replacing all three with a strict allowlist regex
(`/^[\w.-]+$/`) eliminates the entire class of "missed a blocklist entry" bugs and reduces
the three functions to a single, auditable pattern.

### 2. Unify the `readBody()` caller pattern

WP-002 added `PayloadTooLargeError` catch blocks at all four `readBody()` call sites. As the
route count grows, this pattern will drift. Introducing a shared `sendBodyError()` helper (or
wrapping `readBody()` in a route-level adapter) would reduce repetition and ensure consistent
413 handling. Low urgency at four sites; worth planning before a fifth route is added.

### 3. Document `apiErrorToStatus()` in `api-surface.md`

WP-006 exported `apiErrorToStatus()` to enable direct unit testing — a correct and
maintainable decision. However, the exported function has no named entry in `api-surface.md`
(only the HTTP status mapping table is present). Add a function signature entry under the
`gui/server.ts` section to keep the manifest accurate.

### 4. Add `req.resume()` drain to the Content-Length pre-check path in `readBody()`

The streaming rejection path in `readBody()` calls `req.resume()` to drain remaining body
data cleanly. The Content-Length pre-check path does not, leaving body data in Node's
internal socket buffer until the connection closes. This is benign for a local dev server
with `Connection: close` semantics, but adding `req.resume()` after the pre-check rejection
would make the two paths symmetric and is good defensive practice.

---

## Documentation Debt Inventory

| Item | File | Priority |
|------|------|----------|
| Add `readBody()` JSDoc contract: callers must catch `PayloadTooLargeError` and return 413 | `gui/server.ts` | Medium |
| Add `apiErrorToStatus()` named entry to `api-surface.md` | `api-surface.md` | Medium |
| Add reverse cross-reference in module header → `computeEffectiveStatus()` | `gui/orchestrator-manager.ts` | Low |
| Update `assertSafeSlug()` JSDoc to list all three vectors (after backslash fix) | `gui/api.ts` | Low (after fix) |

---

## Technical Highlights

**Body-size cap (WP-002):** The dual-mechanism design (Content-Length pre-check before any
data is read, plus a streaming byte-count fallback for absent or understated headers) is
robust and handles the adversarial case correctly. The raw-TCP test technique for the pre-
check path is the correct approach for exercising server-side Content-Length validation
without interference from fetch client-side guards.

**CONFLICT fix (WP-006):** The single `case 'CONFLICT': return 409;` addition to the shared
`apiErrorToStatus()` switch automatically propagates to all 8+ route handlers that call
`conflict()`, eliminating any risk of patching only some endpoints. Exporting the function
for direct unit testing is the right call — it replaced the need for integration-level HTTP
tests to verify the mapping.

**`computeEffectiveStatus()` extraction (WP-001):** The helper correctly encodes all four
documented `(alive, projectExists)` combinations and is exercised by all four combinations in
the existing test suite. The extraction is a net reduction in security-relevant logic
duplication.

---

## Next Steps for Planner

1. **Immediate:** Create a follow-up WP to add `id.includes('\\')` to `assertSafeSlug()`
   with a test, and update its JSDoc. Consider also making this the trigger for a broader
   allowlist regex hardening pass (see Strategic Recommendation 1).

2. **Near-term:** Address the documentation debt items above in a single documentation WP.

3. **Future:** Plan the `readBody()` caller unification pass as a low-priority refactor
   once the route count grows beyond five.
