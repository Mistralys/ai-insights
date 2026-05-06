# Synthesis Report — GUI Orchestrator Integration

**Date:** 2026-05-05  
**Project:** GUI Orchestrator Integration  
**Work Packages:** 16 / 16 COMPLETE  
**Pipeline Health:** All stages passed — no outstanding failures

---

## Executive Summary

This session delivered end-to-end GUI integration for the orchestrator subsystem across
the MCP server and orchestrator codebases. The work was organized in three parallel
tracks that converged at the server-routing and frontend layers:

- **Track 1 — Orchestrator side:** A persistent run queue (`run_queue.py`) with atomic
  file I/O and `filelock.py` integration, wired into `cli.py` so every orchestrator run
  registers on start and unregisters in the `finally` block.
- **Track 2 — MCP server backend:** `orchestrator-manager.ts` providing queue read,
  process lifecycle management (7 preflight checks, SIGTERM/SIGKILL kill flow, dismiss),
  and a `startOrchestrator()` launcher with cross-platform binary resolution and detached
  spawn. Four HTTP handlers in `gui/api.ts` wired into `gui/server.ts`.
- **Track 3 — GUI frontend:** A full `orchestrator.js` view (preflight + queue table +
  inline log preview), `orchestrator-widgets.js` widget library, project-detail
  enhancements with queue-aware active-run sections, CSS rules, and nav/router wiring.

One security vulnerability was identified and remediated before merge (negative PID
broadcast risk). One code-review FAIL triggered a rework (unguarded `register()` call
in `cli.py`).

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 16 / 16 COMPLETE |
| Total pipeline stages passed | 63 (across all WPs) |
| Rework events | 2 (WP-001 code-review FAIL; WP-006 security-audit FAIL) |
| Security vulnerabilities found | 1 HIGH (fixed), 2 Medium (pre-existing, deferred) |
| Reviewer-applied fixes | 1 (WP-003: test class misplacement) |
| MCP server test suite (final) | **2,096 tests across 66 files — 0 failures** |
| Orchestrator test suite (final) | **978 tests — 0 failures** |
| New tests introduced | ~200 (orchestrator-manager ×72, orchestrator-widgets ×41, |
|                       | api-orchestrator ×23, run_queue ×12, project-detail ×13, |
|                       | orchestrator-view ×25, cli-integration ×4, security ×5, |
|                       | api-client ×7, plus WP-015 preflight fail-paths ×3) |

---

## Deliverables by Work Package

| WP | Title | New / Modified Files | Key Outcome |
|----|-------|---------------------|-------------|
| WP-001 | Run queue module | `run_queue.py`, `test_run_queue.py`, `cli.py` | Atomic queue with locking; cli.py integration |
| WP-002 | API client methods | `api-client.js`, `api-client.test.ts` | 4 orchestrator API methods (start/queue/kill/dismiss) |
| WP-003 | Run queue tests review | `test_run_queue.py`, `run_queue.py` | Test class restructure; code review fix applied |
| WP-004 | cli.py integration tests | `test_cli.py` | 4 integration tests for register/unregister lifecycle |
| WP-005 | getQueue() manager | `orchestrator-manager.ts`, test | 36 tests; 5-state lifecycle; JSONL progress resolution |
| WP-006 | kill/dismiss actions | `orchestrator-manager.ts`, test | SIGTERM→SIGKILL; HIGH security fix (negative PID) |
| WP-007 | startOrchestrator() | `orchestrator-manager.ts`, test | 7 preflight checks; cross-platform spawn; security PASS |
| WP-008 | API route handlers | `api.ts`, `server.ts`, `ledger-root.ts`, test | 4 handlers + `assertSafeQueueId()` guard; security PASS |
| WP-009 | Server route wiring | `server.ts` | All 4 routes wired; decodeURIComponent before guard |
| WP-010 | OrchestratorWidgets | `orchestrator-widgets.js`, test | 6 widget functions exposed on `OrchestratorWidgets` global |
| WP-011 | Orchestrator view | `orchestrator.js`, `orchestrator-widgets.js` | Full view: preflight, queue table, log preview, cleanup |
| WP-012 | Navigation wiring | `index.html`, `router.js` | Pre-satisfied by WP-010/WP-011; nav + router confirmed |
| WP-013 | Project detail enhancement | `project-detail.js`, test | Queue-aware active-run section; kill button / log preview |
| WP-014 | CSS styles | `styles.css` | 15 new rule sets; dark mode overrides; theme-consistent |
| WP-015 | Preflight test coverage | `orchestrator-manager.test.ts` | 3 fail-path tests for venv / plan-file / mcp-dist |
| WP-016 | API handler test review | `api-orchestrator.test.ts`, `api.ts` | Code review PASS; `assertSafeQueueId` pattern verified |

---

## Security Summary

### Fixed

- **WP-006 — HIGH — A03 Injection / A04 Insecure Design:**  
  `isRawQueueEntry()` in `orchestrator-manager.ts` accepted `pid ≤ 0`. On POSIX,
  `process.kill(-1, SIGKILL)` broadcasts to all user processes. Remediated by extending
  the guard to `typeof pid === 'number' && Number.isInteger(pid) && pid > 0` and adding
  a `if (pid <= 0) return` early-exit in `terminateProcess()`. Five security regression
  tests added.

### Deferred (non-blocking)

- **WP-008 / WP-009 — Medium — A04 Insecure Design:**  
  `readBody()` in `server.ts` buffers the full request body with no size cap. Pre-existing
  across all POST handlers. For a localhost dev tool the exploitability is low; a 1 MB
  `maxBytes` guard would eliminate the risk entirely. **Recommended for a follow-up WP.**
- **WP-006 — Low — A01 path prefix:**  
  `removeLockFile()` derives the lock directory from `entry.planPath` (queue file, not
  HTTP body). No containment check, but blast radius is bounded to ENOENT-swallowed
  unlink. Consistent with `checkPathPrefix()` pattern elsewhere — candidate for cleanup.

---

## Strategic Recommendations

### 1. Refactor: `computeEffectiveStatus()` helper
**Priority: Medium.** Effective status computation (PID liveness + ledger synthesis check)
is copy-pasted verbatim across `getQueue()`, `killQueueEntry()`, and `dismissQueueEntry()`
in `orchestrator-manager.ts`. Extracting a private helper would eliminate 3× duplication
and reduce the surface area for divergence bugs. Flagged independently by Developer and QA.

### 2. Security: `readBody()` size cap
**Priority: Medium.** Add a `maxBytes` guard (e.g., 1 MB) inside `readBody()` in
`gui/server.ts`. All POST handlers (`/api/orchestrator/start`, `/api/config`,
`/api/projects/:slug/reset`, etc.) benefit. Minimal implementation cost; eliminates an
unbounded memory-growth vector.

### 3. API: CONFLICT → 409 mapping in `apiErrorToStatus()`
**Priority: Low.** The `'CONFLICT'` error code in `gui/server.ts` `apiErrorToStatus()`
has no case, so conflict errors fall through to a 500. The orchestrator start route can
surface a `CONFLICT` when a duplicate plan is already in the queue. Adding
`case 'CONFLICT': return 409` is a one-liner fix with significant clarity impact for the
front-end.

### 4. Test: `unregister()` empty-queue edge case
**Priority: Low.** `test_run_queue.py` has no test for `unregister()` removing the last
entry (leaving `[]`). The code handles it correctly via filter logic. An explicit test
would document the intent and prevent regression. Flagged by both QA (WP-003) and
Reviewer (WP-003 documentation-forward).

### 5. Test: Server-level integration test for orchestrator routes
**Priority: Low.** All orchestrator handlers are unit-tested at the `api.ts` level.
A single integration test exercising `handleRequest()` directly (as done in `api.test.ts`
for other routes) would provide defense-in-depth coverage for the `server.ts` dispatch
blocks. Not a blocker — handler tests are strong.

### 6. Documentation: `assertSafeQueueId()` backslash comment
**Priority: Low.** Add a brief comment explaining that Windows path separators are not
checked because queue IDs are system-generated UUIDs, not user-controlled file paths.
Flagged by Reviewer in WP-016 documentation-forward.

### 7. Architecture: Locking parity between TypeScript and Python writers
**Priority: Low.** `writeQueueFileAtomic()` in `orchestrator-manager.ts` does not acquire
the `.run-queue.lock` used by the Python `run_queue.py` writers. A concurrent Python
`register()` call between the GUI's read and write-back could silently drop a new entry.
Low risk at current concurrency levels. Flagged by Developer (WP-006) and QA (WP-006).

---

## Next Steps

1. **Immediate (follow-up WPs):** Address `readBody()` size cap and
   `CONFLICT → 409` mapping — both are small changes with clear positive impact.
2. **Short-term refactor:** Extract `computeEffectiveStatus()` helper in
   `orchestrator-manager.ts` to remove duplication.
3. **UX iteration:** `renderLogPreview()` currently appends raw action strings / JSON.
   A structured formatter for JSONL events would improve readability in the GUI log
   preview. The widget architecture is already in place.
4. **Cross-platform validation:** `isProcessAlive()` uses `process.kill(pid, 0)` — not
   verified on Windows CI. If the server is ever tested on Windows, add a targeted test.
5. **Changelog:** Module changelogs for `mcp-server/` and `orchestrator/` should be
   updated to document this integration before the next root release.

---

*Generated by Synthesis Agent (Head of Operations) · 2026-05-05*
