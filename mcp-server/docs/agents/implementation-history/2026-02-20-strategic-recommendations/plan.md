# Plan

## Summary

Implement the five strategic recommendations surfaced by Developer and Reviewer agents during the `2026-02-20-gold-nuggets-housekeeping` session. None are defects — the prior session closed with 251/251 passing tests and a clean `tsc --noEmit` — but each represents a concrete, low-risk improvement to type safety, structural correctness, test reliability, or script robustness. Items are sequenced by priority as defined in the synthesis report's "Next Steps (Planner Queue)".

---

## Approach / Architecture

The five items fall into four natural effort bands:

**Band 1 — One-line config change with downstream narrowing (SR-1):**  
Add `noUncheckedIndexedAccess: true` to `tsconfig.json`. This widens all string-indexed record lookups to `T | undefined`, which will cause `tsc` to surface every unguarded access. Each failing site needs a trivial explicit `if` guard or a non-null assertion. The existing `if (!pipelineType)` guard at `workflow.ts:1618` is already correct; it just needs `tsc` to recognise it as a narrowing point — which this flag enables.

**Band 2 — Structural refactor to eliminate manual sync (SR-2):**  
`workflow.ts`'s `_internal` object is a manually-maintained list of 18 internal function references used only in tests. Replacing it with a namespace re-export (`export * as _internal from './workflow.js'`) would eliminate the need to edit the list every time a new testable function is added. Because `_internal` is consumed directly in tests via named destructuring, the import side must be updated in lock-step.

**Band 3 — Script hardening (SR-3):**  
`scripts/check-known-roles.js` uses a `[^\]]+` regex that silently returns an empty array if either `AGENT_ROLES` or `KNOWN_ROLES` is formatted across multiple lines. Two parallel fixes: (a) replace the single-line regex with a `dotAll` (`/s` flag) multiline-aware variant, and (b) extract the two structurally-identical parse blocks into a `parseArray(source, pattern, label)` helper to reduce duplication and make future maintenance easier.

**Band 4 — Low-effort hygiene and documentation (SR-4, SR-5):**  
Migrate inline `stderrSpy` setup/teardown in `agent-registry.test.ts`'s collision-warning describe block to `beforeEach`/`afterEach` hooks, ensuring the spy is always restored even when an assertion throws. Add a `@param strict` JSDoc line to `discoverAgents` in `agent-registry.ts` documenting its intent (CI/validation tooling entry point) to prevent accidental removal.

---

## Rationale

- SR-1 (`noUncheckedIndexedAccess`) is highest priority because it directly hardens the type system against runtime `undefined` dereferences across the entire codebase, not just the one site in `workflow.ts`. The existing guard already handles the only hot path; `tsc` surfacing any unguarded sites is the primary output of this step.
- SR-2 (`_internal` drift guard) is sequenced second because it eliminates a structural maintenance trap that will compound as `workflow.ts` grows. The fan-out to test imports requires a coordinated change across multiple files but no logic modifications.
- SR-3 (`check-known-roles.js` robustness) is sequenced third because the script is a recently-added CI guard whose silent failure mode (empty parse result → false-negative diff check) undermines its own purpose.
- SR-4 (spy teardown hygiene) is Band 4 because the failure mode is test pollution rather than a production issue, and it affects only a localised describe block.
- SR-5 (`strict` JSDoc) is last: it is a single-line comment addition with zero risk and zero test impact.

---

## Detailed Steps

### SR-1 — Enable `noUncheckedIndexedAccess` in `tsconfig.json`

1. Open `mcp-server/tsconfig.json` and add `"noUncheckedIndexedAccess": true` inside `compilerOptions`.
2. Run `tsc --noEmit` and collect all new errors. Expected gap sites: string-keyed accesses on `AGENT_PIPELINE_MAP`, `PIPELINE_PREREQUISITES`, and any other `Record<string, T>` lookups that lack an explicit guard.
3. For each error site, add or confirm an explicit `if (!value)` or `if (value === undefined)` narrowing guard. Do **not** use non-null assertions (`!`) — prefer narrowing guards to preserve runtime safety.
4. Re-run `tsc --noEmit` until it exits clean.
5. Run the full test suite (`npm test` in `mcp-server/`) and confirm 251/251 pass.

### SR-2 — Eliminate manual `_internal` list in `workflow.ts`

1. Inspect current `_internal` consumers: run a workspace grep for `_internal` imports in `mcp-server/tests/`.
2. Replace the manual `export const _internal = { ... }` block (lines 38–56 of `workflow.ts`) with a namespace re-export:
   ```ts
   export * as _internal from './workflow.js';
   ```
   > Note: This will also export public symbols under `_internal`. If that is unacceptable, an intermediate barrel (`workflow-internal.ts`) exporting only the testable functions may be used instead. Evaluate after step 1 grep; choose the namespace re-export unless the public-symbol bleed is confirmed to be a problem.
3. Update all test files that import from `_internal` to use the new binding shape.
4. Run `tsc --noEmit` and confirm clean.
5. Run the full test suite and confirm 251/251 pass.

### SR-3 — Harden `check-known-roles.js` regex and extract `parseArray` helper

1. Open `scripts/check-known-roles.js` at the workspace root.
2. Add a `parseArray(source, pattern, label)` helper function above the two parse blocks. The helper should:
   - Apply `pattern` with the `s` (dotAll) flag to `source`.
   - If no match, print an error and `process.exit(1)`.
   - Split, trim, and filter the captured group into a `string[]`.
   - Return the array.
3. Update both `agentRolesMatch` and `knownRolesMatch` blocks to delegate to this helper.
4. Update the regex patterns to use the `s` flag (e.g., `/export const AGENT_ROLES\s*=\s*\[([\s\S]+?)\]/`).
5. Verify: run `node scripts/check-known-roles.js` from workspace root — expect exit 0.
6. Verify failure mode: temporarily add a bogus entry to `KNOWN_ROLES` in `sync-personas.js` — expect exit 1 with a clear diff message.
7. Revert the test change.

### SR-4 — Migrate stderr spy to `beforeEach`/`afterEach` in `agent-registry.test.ts`

1. Open `mcp-server/tests/utils/agent-registry.test.ts` and locate all `describe` blocks that initialise `stderrSpy` inline (currently at lines 191, 218, 233, 257, 393).
2. For each describe block that creates its own spy, move the `vi.spyOn(...)` call to a `beforeEach` hook and the `mockRestore()` call to an `afterEach` hook. Declare the spy variable at the describe scope.
3. Remove the inline `stderrSpy.mockRestore()` lines from within `it` bodies.
4. Run the full test suite and confirm 251/251 pass and no spy-leak warnings.

### SR-5 — Add `@param strict` JSDoc to `discoverAgents` in `agent-registry.ts`

1. Open `mcp-server/src/utils/agent-registry.ts`.
2. Locate the `discoverAgents` function (line ~91) and its existing JSDoc block.
3. Add a `@param strict` tag documenting that this parameter is intended for CI/validation tooling and test harnesses, and that passing `true` causes the function to throw a `RangeError` on unknown agent roles rather than silently ignoring them.
4. Run `tsc --noEmit` to confirm no type regressions.

---

## Dependencies

- SR-1 must complete before SR-2 (the re-export refactor may introduce new indexed-access gaps that SR-1's flag would surface; resolving SR-1 first ensures the baseline is stable).
- SR-2, SR-3, SR-4, SR-5 are independently deliverable after SR-1 and may be parallelised.

---

## Required Components

- `mcp-server/tsconfig.json` — add `noUncheckedIndexedAccess` flag
- `mcp-server/src/tools/workflow.ts` — replace `_internal` manual block; add/confirm narrowing guards
- `mcp-server/tests/` — update `_internal` consumers (files TBD by grep in SR-2 step 1; likely `workflow-handoff.test.ts`, `full-workflow.test.ts`, and `pipeline.test.ts`)
- `scripts/check-known-roles.js` — harden regex, extract helper
- `mcp-server/tests/utils/agent-registry.test.ts` — migrate spy setup/teardown
- `mcp-server/src/utils/agent-registry.ts` — add JSDoc

---

## Assumptions

- The MCP server repo remains at 251 passing tests and clean `tsc --noEmit` at the start of this session (per synthesis report).
- `workflow.ts`'s `_internal` consumers in tests use destructured access (`_internal.buildHandoffResponse`, etc.), meaning the shape change from a hand-rolled object to a namespace export is transparent to call sites.
- No Prettier or ESLint auto-format run has reformatted `AGENT_ROLES` or `KNOWN_ROLES` to multiline since the last session.

---

## Constraints

- Do **not** introduce `as` casts or non-null assertions (`!`) as workarounds for SR-1 narrowing errors.
- Do **not** alter the public API surface (exported types, tool schemas, or handler signatures).
- SR-2 namespace re-export must not break existing test imports; if the public-symbol bleed is unacceptable, use an intermediate barrel instead.
- `check-known-roles.js` must remain a CommonJS (`require`) script (no ESM rewrite), consistent with its current form and the workspace's Node.js tooling setup.

---

## Out of Scope

- Refactoring `sync-personas.js` itself
- ESM upgrade of `scripts/check-known-roles.js`
- Enabling any other TypeScript strict flags beyond `noUncheckedIndexedAccess`
- Changelog / version bump (treated as part of the next synthesis step, not this session)
- Documentation updates beyond the single JSDoc addition in SR-5

---

## Acceptance Criteria

- `tsc --noEmit` exits 0 with `noUncheckedIndexedAccess: true` in `tsconfig.json`
- All 251 tests pass with no regressions
- `workflow.ts` has no manually-enumerated `_internal` object
- `scripts/check-known-roles.js` exits 0 on the current codebase and exits 1 when a bogus role is injected into `KNOWN_ROLES`
- `scripts/check-known-roles.js` exits 0 when either array is reformatted to multiline
- No `stderrSpy.mockRestore()` call appears inside an `it` body in `agent-registry.test.ts`
- `discoverAgents` JSDoc includes a `@param strict` tag

---

## Testing Strategy

Each SR item is verified by the existing test suite (251 tests, run via `npm test` in `mcp-server/`). SR-1 and SR-2 require `tsc --noEmit` sign-off after implementation. SR-3 requires two manual invocations of `check-known-roles.js` (pass case + injected failure case). SR-4 verification is implicit in the test suite run — if spy teardown is broken, subsequent tests that depend on `process.stderr` will produce spurious failures. SR-5 requires only `tsc --noEmit` (JSDoc is type-checked by TypeScript for `@param` name alignment).

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`noUncheckedIndexedAccess` surfaces more gap sites than expected** | Treat each as a mandatory narrowing guard. Do not suppress with `!`. If volume is high, split into its own WP and fix iteratively. |
| **Namespace re-export for `_internal` bleeds public symbols into test imports** | Investigate early (step 1 grep). Fall back to a dedicated `workflow-internal.ts` barrel if needed. |
| **`check-known-roles.js` dotAll regex over-matches multi-line content** | Write the regex with a non-greedy quantifier (`[\s\S]+?`) to match the smallest possible array content. Add a unit-level smoke test in the script's own verify step. |
| **Spy migration in SR-4 changes test isolation in unexpected ways** | Run the full suite before and after to confirm no count changes. Vitest's `--reporter=verbose` will surface any newly-failing tests. |
