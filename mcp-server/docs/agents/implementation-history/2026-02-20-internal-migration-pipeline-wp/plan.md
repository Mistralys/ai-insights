# Plan

## Summary

Eliminate the `export const _internal = { ... }` manual-object pattern from `mcp-server/src/tools/pipeline.ts` and `mcp-server/src/tools/work-package.ts`, replacing it with individual named exports and namespace imports in the corresponding test files. This follows the identical approach applied to `workflow.ts` in WP-002 of the `2026-02-20-strategic-recommendations` plan and resolves the cross-cutting technical debt item flagged in that plan's project comments by the Reviewer agent.

---

## Approach / Architecture

Each module receives the same two-part structural change applied to `workflow.ts`:

1. **Source file (`pipeline.ts`, `work-package.ts`):** Remove the manually-maintained `export const _internal = { ... }` object. Add the `export` keyword directly to each previously-private function or constant that was listed inside `_internal`. For constants that are re-imported from another module (e.g., `PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`, `NEXT_AGENT_MAP` from `pipeline-maps.ts`), add a named re-export statement alongside the existing import.

2. **Test file (`pipeline.test.ts`, `work-package.test.ts`):** Replace the named `import { _internal }` destructuring with a namespace import: `import * as _internal from '../../src/tools/<module>.js'`. All downstream destructuring inside the test (e.g., `const { PIPELINE_PREREQUISITES, PIPELINE_AGENT_MAP } = _internal`) continues to work without change, as namespace object shape is compatible.

The two modules are independent but are sequenced WP-001 → WP-002 to avoid any risk of overlapping edits and to provide a clean verification gate between them.

---

## Rationale

- The `_internal` manual-object pattern requires a developer to manually add each new testable symbol to the list; if omitted, the test cannot access it without a refactor. Eliminating it means any new export is automatically available via the namespace import — identical reasoning to the `workflow.ts` fix.
- The namespace import (`import * as _internal`) is the proven pattern from the `workflow.ts` precedent. ESM does not allow a module to re-export itself (`export * as _internal from './pipeline.js'`), so the namespace import on the test side is the canonical solution.
- Sequencing as two independent WPs (one per module) keeps each change minimal, easily reviewable, and independently verifiable.

---

## Detailed Steps

### WP-001 — Eliminate `_internal` from `pipeline.ts` + update `pipeline.test.ts`

1. Open `mcp-server/src/tools/pipeline.ts`.
2. Locate the private function `buildCompletionGuidance` (line ~26). Add the `export` keyword to its declaration.
3. Locate the existing named imports at the top of the file:
   ```ts
   import { PIPELINE_PREREQUISITES, PIPELINE_AGENT_MAP, NEXT_AGENT_MAP, ... } from '../utils/pipeline-maps.js';
   ```
   Add a re-export statement for the three constants (they are used internally and must remain imported; the re-export makes them externally accessible):
   ```ts
   export { PIPELINE_PREREQUISITES, PIPELINE_AGENT_MAP, NEXT_AGENT_MAP };
   ```
   Place this re-export near the bottom of the file, after `buildCompletionGuidance`, before the tool registration functions.
4. Remove the `_internal` block (lines ~69–75):
   ```ts
   /**
    * @internal — exported for unit testing only
    */
   export const _internal = {
     PIPELINE_PREREQUISITES,
     PIPELINE_AGENT_MAP,
     NEXT_AGENT_MAP,
     buildCompletionGuidance,
   };
   ```
5. Open `mcp-server/tests/tools/pipeline.test.ts`.
6. Replace line 9:
   ```ts
   import { _internal } from '../../src/tools/pipeline.js';
   ```
   with:
   ```ts
   import * as _internal from '../../src/tools/pipeline.js';
   ```
   No other changes to the test file are needed — all downstream destructuring (`const { PIPELINE_PREREQUISITES, PIPELINE_AGENT_MAP } = _internal` and `const { buildCompletionGuidance } = _internal`) remains syntactically valid against a namespace object.
7. Run `tsc --noEmit` in `mcp-server/` and confirm exit 0.
8. Run `npx vitest run` in `mcp-server/` and confirm all tests pass.

### WP-002 — Eliminate `_internal` from `work-package.ts` + update `work-package.test.ts`

1. Open `mcp-server/src/tools/work-package.ts`.
2. Locate the private function `buildStatusTransitionGuidance` (line ~28). Add the `export` keyword to its declaration.
3. Remove the `_internal` block (lines ~58–60):
   ```ts
   /**
    * @internal — exported for unit testing only
    */
   export const _internal = {
     buildStatusTransitionGuidance,
   };
   ```
4. Open `mcp-server/tests/tools/work-package.test.ts`.
5. Replace line 2:
   ```ts
   import { _internal } from '../../src/tools/work-package.js';
   ```
   with:
   ```ts
   import * as _internal from '../../src/tools/work-package.js';
   ```
   The downstream destructuring (`const { buildStatusTransitionGuidance } = _internal`) continues to work without change.
6. Run `tsc --noEmit` in `mcp-server/` and confirm exit 0.
7. Run `npx vitest run` in `mcp-server/` and confirm all tests pass.

---

## Dependencies

- WP-001 must complete (implementation + QA pipelines both PASS) before WP-002 begins.
- No external code changes are required; this is a purely structural (export/import) refactor within the `mcp-server` package.

---

## Required Components

- `mcp-server/src/tools/pipeline.ts` — add `export` to `buildCompletionGuidance`; add `export { PIPELINE_PREREQUISITES, PIPELINE_AGENT_MAP, NEXT_AGENT_MAP }`; remove `_internal` block
- `mcp-server/tests/tools/pipeline.test.ts` — replace named `_internal` import with namespace import
- `mcp-server/src/tools/work-package.ts` — add `export` to `buildStatusTransitionGuidance`; remove `_internal` block
- `mcp-server/tests/tools/work-package.test.ts` — replace named `_internal` import with namespace import

---

## Assumptions

- The codebase remains at 251 passing tests and clean `tsc --noEmit` at the start of this session (as confirmed after `2026-02-20-strategic-recommendations`).
- `pipeline.test.ts` only destructures `PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`, and `buildCompletionGuidance` from `_internal`; no other symbols are consumed. (Confirmed by workspace grep on 2026-02-20.)
- `work-package.test.ts` only destructures `buildStatusTransitionGuidance` from `_internal`. (Confirmed by workspace grep on 2026-02-20.)
- No other test file imports `_internal` from `pipeline.js` or `work-package.js`.
- `PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`, and `NEXT_AGENT_MAP` are already imported into `pipeline.ts` from `pipeline-maps.js`; adding a re-export does not break the internal usage.

---

## Constraints

- Do **not** alter any production logic — this is a structural export/import change only.
- Do **not** use `export * as _internal from './pipeline.js'` (ESM self-export is not valid).
- Do **not** modify the public tool API surface (tool schemas, handler signatures, or registered tool names).
- Do **not** add new barrel files; the direct named-export approach is sufficient for both modules.

---

## Out of Scope

- Refactoring `pipeline-maps.ts` itself
- Enabling additional TypeScript strict flags
- Changelog / version bump (handled in the next synthesis step)
- Documentation updates beyond what is required by the Planner output

---

## Acceptance Criteria

- `pipeline.ts` contains no `export const _internal` block
- `pipeline.ts` exports `buildCompletionGuidance`, `PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`, and `NEXT_AGENT_MAP` as named top-level exports
- `pipeline.test.ts` imports via `import * as _internal from '../../src/tools/pipeline.js'`
- `work-package.ts` contains no `export const _internal` block
- `work-package.ts` exports `buildStatusTransitionGuidance` as a named top-level export
- `work-package.test.ts` imports via `import * as _internal from '../../src/tools/work-package.js'`
- `tsc --noEmit` exits with code 0
- All tests pass (no regressions)

---

## Testing Strategy

The existing test suite is the primary verification mechanism. After each WP:
1. `tsc --noEmit` must exit 0 — confirms the structural change is type-correct.
2. `npx vitest run` must pass all tests — confirms the namespace import is behaviourally equivalent to the former `_internal` object destructuring.

No new tests are required; the goal is to preserve existing test coverage while removing the structural anti-pattern.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`NEXT_AGENT_MAP` is in the `_internal` block but not destructured in `pipeline.test.ts`** | It must still be re-exported from `pipeline.ts` to match the original `_internal` surface. The re-export is harmless even if no test currently uses it. |
| **Namespace import exposes additional public symbols from the module** | Acceptable — this is identical to the `workflow.ts` precedent. The `_internal` name in tests signals "for test use only" by convention, not by runtime restriction. |
| **A future engineer adds a new function to `pipeline.ts` and forgets to add `export`** | They would get a TypeScript error when the test tries to access it via the namespace, making the omission immediately visible — an improvement over the silent drift risk of the old `_internal` list. |
