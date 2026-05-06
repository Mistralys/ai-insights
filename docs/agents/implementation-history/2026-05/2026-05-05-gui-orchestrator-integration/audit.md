# Plan Audit Report (Rev 2)

## Plan Under Review
- **Plan:** docs/agents/plans/2026-05-05-gui-orchestrator-integration/plan.md
- **Date:** 2026-05-05
- **Auditor:** Plan Auditor Agent
- **Note:** This is a re-audit of the revised plan. The previous audit's 5 Major findings were all addressed in the plan revision (consolidated preflight+start endpoint, filelock for queue atomicity, unregister in finally block, kill restriction clarified, race acknowledgment added).

## Verdict: PASS WITH FINDINGS

### Summary
The revised plan is exceptionally well-grounded — every file path, function signature, and API reference was verified against the actual codebase with zero hallucinations. The CLI-first self-registration design and lifecycle state machine are sound. All five Major findings from the previous audit have been addressed. Three new Major findings emerged: a cross-language race condition in the queue file write-back path, incomplete route-wiring instructions for the body-parsing split in `server.ts`, and the `workspaceRoot` variable being unavailable for threading. Five Minor findings address scoping, step numbering, security, and cleanup details.

### Finding Counts
- **Critical:** 0
- **Major:** 3
- **Minor:** 5

---

## Findings

### Critical

_None._

### Major

| # | Category | Finding | Location in Plan | Recommendation |
|---|----------|---------|-------------------|----------------|
| 1 | Consistency | **Cross-language queue file race condition.** The plan states `getQueue()` "writes back any state mutations" (lifecycle transitions like pending→started, pending→dead, started→removed). This means the TypeScript GUI server performs read-modify-write on the queue file. Simultaneously, the Python orchestrator acquires an exclusive lock via `filelock.py` for `register()` and `unregister()` writes. The TypeScript side does **not** acquire this lock. Race scenario: (a) TypeScript reads file (entries A, B), (b) Python registers entry C (file now has A, B, C), (c) TypeScript writes back its modified A, B — entry C is silently lost. The lost entry can never reappear because the orchestrator only registers once. The plan's constraint section acknowledges "only one GUI server runs at a time" but does not address the Python↔TypeScript concurrent write scenario. | Phase 2, Step 5 ("writes back any state mutations"); Constraints → "Queue file reads (TypeScript reader)" | Make `getQueue()` **read-only**: compute lifecycle transitions in-memory and return enriched entries without persisting state changes to the queue file. The `status` field in the file remains `pending` (as written by the orchestrator); the effective status is computed on every poll by checking process liveness and ledger state. Only explicit user actions (`dismissQueueEntry`, `killQueueEntry`) write to the file — these are infrequent point mutations with a negligible race window. This eliminates the bulk read-modify-write pattern entirely and follows the same read-heavy pattern used by `findRunLogs()` in [log-resolver.ts](mcp-server/src/gui/log-resolver.ts), which computes derived state (`is_active`) at read time without writing back. |
| 2 | Completeness | **Route wiring omits the `matchRoute()` vs `handleRequest()` split.** The plan lists four routes (Step 8, Phase 3) but does not specify which go in `matchRoute()` and which go in `handleRequest()`. In the existing codebase, POST/PUT/PATCH routes that require body parsing are handled as special cases in `handleRequest()` with explicit `readBody()` + `JSON.parse()` ([server.ts](mcp-server/gui/server.ts#L530-L663)). Routes without bodies go in `matchRoute()`. `POST /api/orchestrator/start` requires a JSON body (`{ planPath, dryRun? }`), so it **must** go in `handleRequest()` — not in `matchRoute()`. The other three routes (GET queue, POST kill, DELETE dismiss) have no body and belong in `matchRoute()`. Without this distinction, the implementer may wire the start route in `matchRoute()` where no body parsing occurs, resulting in empty/undefined request bodies. | Phase 3, Step 8 ("Wire routes in `gui/server.ts`") | Explicitly state: `POST /api/orchestrator/start` → `handleRequest()` special-case block (requires body parsing via `readBody()`, following the same pattern as `POST /api/projects/:slug/reset`). `GET /api/orchestrator/queue`, `POST /api/orchestrator/kill/:id`, `DELETE /api/orchestrator/queue/:id` → `matchRoute()`. |
| 3 | Completeness | **`workspaceRoot` is not exported and threading is unspecified.** The plan states `workspaceRoot` is derived from `server.ts`'s `__dirname`. However, `workspaceRoot` is already computed in [ledger-root.ts](mcp-server/src/utils/ledger-root.ts#L12) (`const workspaceRoot = join(serverDir, '..');`) but is **not exported**. The plan's `startOrchestrator()` function needs `workspaceRoot` to resolve: the venv binary path, the queue file path (`orchestrator/logs/.run-queue.json`), and the MCP dist path for freshness checks. Additionally, `matchRoute()` currently accepts only `ledgerRoot` and `orchestratorLogsDir` — `workspaceRoot` would need to be threaded through or derived. The plan does not specify how this value flows from server startup to the orchestrator manager module. | Phase 2, Step 4 (`startOrchestrator` signature takes `workspaceRoot`); Phase 3, Step 8 ("workspaceRoot is derived from server.ts's __dirname") | Export `workspaceRoot` from `ledger-root.ts` (add `export` to the existing `const` declaration). Import it directly in `orchestrator-manager.ts`. For routes in `matchRoute()`, either add `workspaceRoot` as a parameter (consistent expansion) or handle orchestrator routes in `handleRequest()` where module-level imports are accessible. |

### Minor

| # | Category | Finding | Location in Plan | Recommendation |
|---|----------|---------|-------------------|----------------|
| 1 | Completeness | **Step numbering collision.** Phase 3 (Step 7) and Phase 4 (Step 8) both exist, but Phase 4's step is also numbered 8 — colliding with Phase 3's Step 8 ("Wire routes"). Subsequent steps in Phase 5 continue from 9, so the numbering gap is cosmetic but creates ambiguity when referencing "Step 8." | Phase 3 Step 8 vs Phase 4 Step 8 | Renumber Phase 4's step to 8b or renumber all subsequent steps sequentially. |
| 2 | Completeness | **`entry_id` scoping not specified for Python `finally` block.** The plan says to call `register()` after `run_start` (~line 573) and `unregister(entry_id)` in the outermost `finally` block (~line 763). If `register()` itself raises an exception, `entry_id` will be undefined when `unregister()` is called in the `finally` block, causing a `NameError`. | Phase 1, Step 2 ("Store the returned `entry_id`") | Initialize `entry_id: str | None = None` before the inner `try` block (~line 518). In the `finally` block, guard with `if entry_id is not None: run_queue.unregister(entry_id)`. |
| 3 | Risk | **Plan path has no prefix validation (path traversal).** The plan validates that the plan path exists, is a `.md` file, and that `planFolderBasename()` matches the naming convention. However, none of these checks constrain the path to be under the workspace root. A path like `/tmp/evil/2026-05-05-exploit/plan.md` would pass all checks. The spawned orchestrator would operate on an arbitrary directory. The practical risk is low (local-only tool, developer-controlled input), but OWASP path traversal guidelines apply. | Constraints → "Security" | Add a prefix check in `startOrchestrator()`: resolve `planPath` and verify it starts with `workspaceRoot`. Reject paths outside the workspace with a failed preflight check ("Plan path is outside workspace"). |
| 4 | Completeness | **Queue file directory may not exist on first GUI server read.** The `orchestrator/logs/` directory is auto-created by `WorkflowLogger` on first orchestrator run. If no orchestrator has ever run, the directory does not exist. The plan specifies that Python `register()` handles a missing file (`[]` fallback), but `getQueue()` in TypeScript must also handle a missing directory (not just a missing file). | Phase 2, Step 4 ("reads the queue file") | Ensure `getQueue()` wraps the queue file read in a try/catch that returns `[]` when the directory or file does not exist, matching the `findRunLogs` pattern ([log-resolver.ts](mcp-server/src/gui/log-resolver.ts#L92-L96) returns `[]` on `readdir` failure). |
| 5 | Completeness | **Log preview cleanup mechanism unspecified.** The plan correctly identifies that `OrchestratorWidgets.renderLogPreview()` returns a cleanup function and that the calling view must invoke it on unmount. However, the vanilla JS SPA has no lifecycle hooks — when `dispatch()` fires, it sets `app.innerHTML` which destroys DOM elements but does not stop `setInterval` timers. The plan does not specify where the view stores cleanup functions or how it invokes them before re-render. | Phase 4, Step 8 ("Returns a cleanup function") | Specify: the `orchestrator.js` view stores cleanup functions in a module-scoped array. At the top of `renderOrchestrator()`, iterate the array and call each function, then clear it. This ensures any previously-created log preview intervals are stopped before new ones are created. |

---

## Alternative Approaches Considered

### Codebase-Internal Alternatives

**Read-only queue polling (Major #1 alternative):** The existing `findRunLogs()` / `readLogEntries()` infrastructure in [log-resolver.ts](mcp-server/src/gui/log-resolver.ts) already computes derived state (e.g., `is_active` based on whether `run_end` exists in the JSONL) without writing back to source files. The same pattern — compute lifecycle state at read time, never persist it — can be applied to the queue file. This is the most natural fit for the codebase's existing read-heavy, write-light architecture.

**Route handler via `handleRequest()` body-parsing block (Major #2 alternative):** The existing `POST /api/projects/:slug/reset` handler in [server.ts](mcp-server/gui/server.ts#L643-L663) demonstrates the exact pattern needed for `POST /api/orchestrator/start`: segment-based matching inside `handleRequest()`, followed by `readBody()` + `JSON.parse()` + handler call + error mapping.

**Export from `ledger-root.ts` (Major #3 alternative):** The `workspaceRoot` constant is already computed at [ledger-root.ts](mcp-server/src/utils/ledger-root.ts#L12). Adding `export` to the existing declaration is a one-character change that avoids re-deriving the path in multiple modules.

### Ecosystem-Sourced Alternatives

| Alternative | Source / Evidence | Trade-Off vs. Plan's Approach | Recommendation |
|---|---|---|---|
| SQLite for inter-process queue | Built-in to Python (`sqlite3`); available via `better-sqlite3` for Node.js | More robust concurrency (WAL mode handles concurrent readers/writer natively), but adds a dependency and complexity for a queue with typically 1–3 entries. | Not recommended. The JSON file approach is appropriate at this scale, especially if `getQueue()` is made read-only per Major #1. |
| Server-Sent Events (SSE) for queue updates | Native browser `EventSource` API; trivial Node.js implementation via `Transfer-Encoding: chunked` | Lower latency than 5s polling; no new npm dependencies. But adds a persistent connection pattern not present in the codebase, and polling is consistent with the existing project-list refresh pattern. | Consider for a future iteration if users report laggy queue updates. Not needed for initial implementation. |

---

## Completeness Assessment

| Plan Section | Status | Notes |
|--------------|--------|-------|
| Summary | OK | Clear, comprehensive, and accurate. |
| Architectural Context | OK | All five subsections verified against codebase — every file, function, and pattern reference is accurate. |
| Approach / Architecture | OK | Three-layer diagram is correct. Self-registration design is sound. Lifecycle state machine is well-defined. |
| Rationale | OK | Each design decision is justified with concrete reasoning. |
| Detailed Steps | Gap | Step numbering collision (Minor #1). Missing `matchRoute()` vs `handleRequest()` split (Major #2). Missing `workspaceRoot` export/threading detail (Major #3). |
| Dependencies | OK | All dependencies verified — stdlib-only on both sides, plus existing `filelock.py`. |
| Required Components | OK | New vs. modified files clearly distinguished. All paths verified. |
| Assumptions | OK | All six assumptions are stated and verifiable. |
| Constraints | Gap | Cross-language write race not addressed (Major #1). Path traversal not constrained (Minor #3). |
| Out of Scope | OK | Four clear exclusions preventing scope creep. |
| Acceptance Criteria | OK | 27 specific, testable criteria covering all features. |
| Testing Strategy | OK | Comprehensive coverage across Python unit, TypeScript unit, API integration, and manual testing. |
| Risks & Mitigations | Gap | Cross-language queue write race is missing (Major #1). Queue directory non-existence unaddressed (Minor #4). |
