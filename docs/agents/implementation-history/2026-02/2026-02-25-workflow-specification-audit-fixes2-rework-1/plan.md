# Plan

## Summary

This rework addresses the four strategic recommendations flagged as "Immediate" or "Short-term (next sprint)" in the Round 2 synthesis, plus one additional residual defect discovered during codebase verification. The scope covers: (1) closing the TypeScript silent-emit gap via `noEmitOnError`, (2) fixing the remaining two inline terminal-status checks that still bypass the `isTerminalStatus()` utility, (3) sealing the `override: true` authorization gap in `ledger_claim_work_package`, (4) wrapping `completeSynthesis` in a `withLock()` call, (5) documenting the `updateWorkPackageWithSync` hoisting convention in `AGENTS.md` and `constraints.md`, and (6) patching the three WP ID regex schemas that were incompletely updated in WP-005.

---

## Architectural Context

**Codebase:** `mcp-server/` — TypeScript ESM MCP server (Node.js). Primary source under `mcp-server/src/`.

| Relevant Module | Path | Relevance |
|----------------|------|-----------|
| `validators.ts` | `src/schema/validators.ts` | Houses `isTerminalStatus()` — the shared utility that all inline checks must delegate to |
| `workflow-handoff.ts` | `src/tools/workflow-handoff.ts` | One residual `=== 'COMPLETE'` inline check (line 136) |
| `workflow-batch-actions.ts` | `src/tools/workflow-batch-actions.ts` | One residual `.every((wp) => wp.status === 'COMPLETE')` inline check (line 150) |
| `work-package.ts` | `src/tools/work-package.ts` | `claimWorkPackage` override authorization gap; three WP ID regex sites still at `\d{3}$` |
| `project-lifecycle.ts` | `src/tools/project-lifecycle.ts` | `completeSynthesis` reads/writes root index without `withLock()` |
| `tsconfig.json` | `mcp-server/tsconfig.json` | Emits JS on tsc error (`noEmitOnError` absent) |
| `AGENTS.md` | `mcp-server/AGENTS.md` | Constraint #10 / hoisting convention docs |
| `constraints.md` | `mcp-server/docs/agents/project-manifest/constraints.md` | Canonical rule set — hoisting convention needs addition here |

**Key patterns in use:**
- `withLock(store.storageDir, async () => { ... })` — mandatory for any dual-file or race-sensitive I/O (`file-lock.ts`)
- `isTerminalStatus(status)` — already defined in `validators.ts`, already imported in most files that need it
- `updateWorkPackageWithSync` callback pattern — pre-mutation state must be captured in outer-scope `let` variables to remain visible after the callback

---

## Approach / Architecture

Six independent fixes are batched into this rework. All changes are surgical — no new files, no schema additions, no new MCP tools. Each fix is self-contained:

1. **`tsconfig.json` guard (GN-2):** Single-line addition of `"noEmitOnError": true`.
2. **Residual inline terminal-status checks (GN-1):** Two sites to convert to `isTerminalStatus()` calls; `workflow-handoff.ts` needs an `isTerminalStatus` import added; `workflow-batch-actions.ts` also needs the hardcoded `reason` string updated.
3. **`claimWorkPackage` override authorization (GN-5):** Add an identity guard block after the existing assignment guard — reject `override: true` if the caller is neither `"Project Manager"` nor the current `wp.assigned_to`. Guard must be conditional on `wp.assigned_to` being set (unassigned WPs do not require authorization to claim).
4. **`completeSynthesis` lock (GN-4):** Wrap the `readRootIndex` / `mutate` / `writeRootIndex` sequence in `withLock(store.storageDir, async () => { ... })`. `withLock` is already imported in `project-lifecycle.ts`.
5. **Hoisting convention docs (GN-3):** Add a new constraint section to `constraints.md` and a matching note to `AGENTS.md` Critical Constraints table explicitly requiring outer-scope hoisting for `updateWorkPackageWithSync` callback captures.
6. **WP ID regex completeness (residual from WP-005):** The three schemas that still match `/^WP-\d{3}$/` — `GetWorkPackageSchema` (line 75), `CreateWorkPackageSchema` dependencies array (line 176), and `ClaimWorkPackageSchema` (line 314) — must be updated to `/^WP-\d{3,}$/` to match the documented constraint (`mcp-server/AGENTS.md` constraint #5).

---

## Rationale

- **GN-2 first:** The silent-emit bug is the highest-severity infrastructure risk — it can mask any future syntax error and corrupt the running server without test failure. It is also the lowest-effort fix.
- **GN-1 inline checks:** With `CANCELLED` now a terminal status, any code path that hard-codes `=== 'COMPLETE'` as the terminal test creates a latent semantic bug. Two sites remain; neither was caught in the prior session's test pass.
- **GN-5 override auth:** The authorization gap is exploitable by any agent today. A simple identity check closes it without changing the public API surface.
- **GN-4 lock:** `completeSynthesis` is currently single-agent safe, but the constraints mandate `withLock` for all root-index mutations. Compliance is required regardless of perceived risk.
- **GN-3 docs:** The `updateWorkPackageWithSync` hoisting pattern caused two back-to-back code-review FAILs in WP-004. A documented convention reduces future error surface.
- **WP ID regex:** Per the failure protocol, when code contradicts the manifest, the code must be corrected. Constraint #5 in `AGENTS.md` specifies `/^WP-\d{3,}$/`; three schemas still violate it.

---

## Detailed Steps

1. **`tsconfig.json` — add `noEmitOnError`**
   - Add `"noEmitOnError": true` to `compilerOptions` in `mcp-server/tsconfig.json`.
   - Verify `npm run build` still succeeds cleanly.

2. **`workflow-handoff.ts` — replace inline COMPLETE check**
   - Add `import { isTerminalStatus } from '../schema/validators.js';` if not already present.
   - Replace `if (status === 'COMPLETE') return null;` (line 136) with `if (isTerminalStatus(status)) return null;`.

3. **`workflow-batch-actions.ts` — replace inline `allComplete` check**
   - Add `import { isTerminalStatus } from '../schema/validators.js';` if not already present.
   - Replace `const allComplete = rootIndex.work_packages.every((wp) => wp.status === 'COMPLETE');` with `const allTerminal = rootIndex.work_packages.every((wp) => isTerminalStatus(wp.status));`.
   - Rename variable `allComplete` to `allTerminal` in the following `if` block.
   - Update the `reason` string from `'All work packages are COMPLETE.'` to `'All work packages are in a terminal status (COMPLETE or CANCELLED).'`.

4. **`work-package.ts` — override authorization guard**
   - In `claimWorkPackage`, after the existing assignment guard block (lines 338-349), add a new guard:
     ```typescript
     // 2b. Override authorization: only PM or current assignee may bypass the assignment check
     if (
       args.override &&
       wp.assigned_to &&
       args.agent !== 'Project Manager' &&
       args.agent !== wp.assigned_to
     ) {
       throw new Error(
         `Cannot override claim on work package ${args.work_package_id}: ` +
         `override is restricted to "Project Manager" or the current assignee ` +
         `("${wp.assigned_to}"). You are "${args.agent}".`
       );
     }
     ```

5. **`work-package.ts` — WP ID regex completeness**
   - Update `GetWorkPackageSchema` (line 75): `/^WP-\d{3}$/` → `/^WP-\d{3,}$/`.
   - Update `CreateWorkPackageSchema` dependencies array (line 176): `/^WP-\d{3}$/` → `/^WP-\d{3,}$/`.
   - Update `ClaimWorkPackageSchema` (line 314): `/^WP-\d{3}$/` → `/^WP-\d{3,}$/`.

6. **`project-lifecycle.ts` — wrap `completeSynthesis` in `withLock`**
   - `withLock` is already imported (line 11). In `completeSynthesis`, wrap the `store.readRootIndex()` + mutation + `store.writeRootIndex()` sequence inside `await withLock(store.storageDir, async () => { ... })`.
   - The return value (`content` block) must be constructed inside the lock callback or returned from it, then returned from the outer `try`.

7. **`constraints.md` — add hoisting convention**
   - Add a new named constraint entry (after the existing dual-file/lock constraint) titled **"Pre-mutation State Capture in `updateWorkPackageWithSync` Callbacks"** with the rule: any variable holding pre-mutation WP or root-index state that is needed *after* the callback must be declared with `let` in the outer scope and assigned inside the callback; `const` captures inside the callback are invisible at the call site.
   - Include the anti-pattern (`const` inside callback) and correct pattern (`let` in outer scope, assigned in callback).

8. **`AGENTS.md` — add hoisting convention to Critical Constraints table**
   - Add row #11 to the Critical Constraints table: `updateWorkPackageWithSync pre-mutation captures use outer-scope \`let\`` / `TS2304 compile error + runtime ReferenceError at call site`.

9. **Build and test**
   - Run `npm run build` — must succeed with zero errors (now enforced by `noEmitOnError`).
   - Run `npm test` — all 489 tests must pass.
   - Spot-check: attempt to call `claimWorkPackage` with `override: true` from a non-PM, non-assignee agent — expect rejection error.

---

## Dependencies

- `withLock` — already imported in `project-lifecycle.ts` (`src/storage/file-lock.js`)
- `isTerminalStatus` — already defined in `src/schema/validators.ts`; already imported in most target files
- No new npm dependencies

---

## Required Components

Files to modify (all existing):

| File | Change |
|------|--------|
| `mcp-server/tsconfig.json` | Add `"noEmitOnError": true` |
| `mcp-server/src/tools/workflow-handoff.ts` | Replace inline `=== 'COMPLETE'` terminal check; add import |
| `mcp-server/src/tools/workflow-batch-actions.ts` | Replace `allComplete` with `allTerminal`; add import; update reason string |
| `mcp-server/src/tools/work-package.ts` | Override auth guard; 3 WP ID regex updates |
| `mcp-server/src/tools/project-lifecycle.ts` | Wrap `completeSynthesis` in `withLock()` |
| `mcp-server/docs/agents/project-manifest/constraints.md` | Add `updateWorkPackageWithSync` hoisting convention |
| `mcp-server/AGENTS.md` | Add constraint #11 to Critical Constraints table |

Files to modify (tests — new tests needed):

| File | Change |
|------|--------|
| `mcp-server/tests/tools/workflow-handoff.test.ts` (or equivalent) | Add test: `getNextAgent` returns `null` for CANCELLED status |
| `mcp-server/tests/tools/workflow-batch-actions.test.ts` (or equivalent) | Add test: batch actions short-circuit when all WPs are CANCELLED |
| `mcp-server/tests/tools/work-package.test.ts` (or equivalent) | Add tests: override by PM passes; override by assignee passes; override by third-party rejected |

---

## Assumptions

- The `completeSynthesis` return value can be built inside the `withLock` callback (no I/O needed after lock release); this is consistent with how other locked writes in `project-lifecycle.ts` are structured.
- `"Project Manager"` is the canonical PM agent name string used in `AGENT_ROLES` (confirmed by constants). The guard hard-codes this string, consistent with existing patterns in the codebase.
- `workflow-handoff.ts` does not yet import `isTerminalStatus` — if it does, the import line can be skipped.
- The `allComplete` → `allTerminal` rename in `workflow-batch-actions.ts` does not affect any external callers (the variable is local).

---

## Constraints

- No new MCP tools; no schema additions; no breaking API changes.
- All existing 489 tests must continue to pass.
- `withLock` wrapping in `completeSynthesis` must follow the same pattern as the existing locked write in `project-lifecycle.ts` lines 167–176 (fresh re-read inside lock).
- Timestamps must use the `now()` utility; no raw `Date` calls.
- STDIO discipline: no `console.log` to stdout.

---

## Out of Scope

- Refactoring `buildBatchNextSteps` in `workflow-batch-actions.ts` (backlog item).
- Adding a `tsc --noEmit` pre-test step to `package.json` (listed as belt-and-suspenders; `noEmitOnError` in `tsconfig.json` is sufficient for now).
- GN-6 end-to-end test policy for cascade propagators (documentation/process change, deferred to a future dedicated documentation WP).
- Monitor/refactor `workflow-handoff.ts` QA/Reviewer 3-way split (backlog).

---

## Acceptance Criteria

- `mcp-server/tsconfig.json` contains `"noEmitOnError": true` and `npm run build` succeeds.
- `workflow-handoff.ts` returns `null` for both `COMPLETE` and `CANCELLED` pipeline statuses (verified by test).
- `workflow-batch-actions.ts` returns the terminal reason message when all WPs are `CANCELLED` (verified by test).
- `claimWorkPackage` rejects a third-party agent passing `override: true` when the WP has an existing assignee; allows PM and current assignee to use `override: true` (verified by tests).
- `GetWorkPackageSchema`, `CreateWorkPackageSchema` dependencies, and `ClaimWorkPackageSchema` all match `/^WP-\d{3,}$/`.
- `completeSynthesis` wraps its root-index mutation in `withLock()` with a fresh re-read inside the lock.
- `constraints.md` contains a new constraint documenting the `updateWorkPackageWithSync` hoisting requirement with anti-pattern and correct pattern examples.
- `AGENTS.md` Critical Constraints table contains a row #11 for the hoisting convention.
- All 489 existing tests pass; new tests for the three behavioral changes pass.

---

## Testing Strategy

Each behavioral change requires at least one targeted new test:

| Fix | Test Location | Test Description |
|-----|--------------|------------------|
| GN-1: `workflow-handoff.ts` | `tests/tools/workflow-handoff.test.ts` | `getNextAgent` returns `null` when status is `CANCELLED` |
| GN-1: `workflow-batch-actions.ts` | `tests/tools/workflow-batch-actions.test.ts` | All-CANCELLED WPs returns terminal reason with updated message |
| GN-5: override auth | `tests/tools/work-package.test.ts` (claim section) | 3 tests: PM override allowed, assignee override allowed, third-party override rejected |
| GN-4: completeSynthesis lock | `tests/tools/project-lifecycle.test.ts` or `tests/integration/` | Verify synthesis completes correctly (existing test coverage sufficient; no new race condition possible in test environment) |
| WP ID regex | `tests/schema/validators.test.ts` or inline | `WP-1000` passes all four schema validations |

Structural changes (GN-2, GN-3 docs) require no new tests but must not cause existing tests to regress.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`completeSynthesis` lock causes deadlock if called within an outer lock** | Inspect call chain — `completeSynthesis` is invoked directly from the MCP tool handler, never from within another `withLock` call. Confirm before implementing. |
| **`workflow-batch-actions.ts` `allTerminal` rename breaks a downstream variable reference** | The variable is purely local; search the function body for `allComplete` references before renaming. |
| **`isTerminalStatus` import missing in `workflow-handoff.ts`** | Verify import at file top before editing; add if absent. |
| **Override auth guard String comparison fragile if PM name changes** | `'Project Manager'` is the canonical value in `AGENT_ROLES` constants. If it ever changes, both the constant and this guard must be updated together. Document this coupling in a code comment. |
| **Residual `\d{3}$` regex patches break existing tests that rely on 3-digit-only WP IDs** | All current test WP IDs use 3-digit format (WP-001 etc.), which `\d{3,}` still matches — no regressions. |
