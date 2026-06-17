# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.0.0
- Architectural Reviews: none — Plan Architect Reviewer v1.0.0

## Prior Project Context
This is the fourth cycle (rework-3) in the `gui-project-detail-auto-update` series. The previous three cycles delivered: (1) a fully dynamic project-detail page with 5-second polling, snapshot/diff engine, and DOM patching; (2) shared `makeProject()` fixture consolidation, dead code removal, and function extraction; (3) micro-cleanup, strict `MakeProjectOpts` typing, 1,479-line test file split, and 1,886-line module decomposition into 4 sub-modules. All completed with zero rework cycles and 3,214 tests passing. The rework-2 synthesis identified two remaining documentation-forward items (low priority) and several "Next Steps" candidates. Repository strategic vision emphasises minimal friction and public-readiness, which aligns with improving DX around test maintenance.

## Summary
Address the two remaining low-priority deferred items from the rework-2 synthesis: (1) extract a shared `ProjectDetailApiStubs` type and `createApiStubs()` default-stub factory to replace the manual 4-file stub-key synchronisation burden with compile-time type enforcement and a single source of truth for default stubs, and (2) correct stale cross-references in JSDoc comments and manifest documentation. This is a narrow, targeted rework with no new product features.

## Architectural Context

The `renderProjectDetail` view in `mcp-server/gui/public/views/project-detail.js` is exercised by 8 dedicated test files in `mcp-server/tests/gui/`. Four of these files (`*-runs`, `*-resume`, `*-poll-modes`, `*-scroll`) contain a local `renderWithAPI` helper that installs a `globalThis.API` stub and calls `renderProjectDetail`. Each helper defines an identical 8-key `apiStubs` parameter type and identical default implementations:

| Stub Key | Default |
|---|---|
| `getProject` | `() => Promise.resolve(makeProject())` |
| `getPlanDocument` | `() => Promise.reject({ code: 'NOT_FOUND' })` |
| `getWorkPackageOverview` | `() => Promise.resolve(null)` |
| `getProjectHealth` | `() => Promise.resolve({ work_packages_needing_reset: 0 })` |
| `getRunLogs` | `() => Promise.resolve([])` |
| `orchestratorGetQueue` | `() => Promise.resolve([])` |
| `getRunMetadata` | `() => Promise.reject(new Error('not stubbed'))` |
| `orchestratorStart` | `() => Promise.reject(new Error('not stubbed'))` |

The `renderWithAPI` function bodies differ only in their wait logic (scroll file uses 400 ms timeout + 10 extra micro-task flushes; others use 200 ms). This per-file divergence is intentional and correct — the functions themselves remain file-local per strategic recommendation #4 from rework-2.

Shared test helpers live in `mcp-server/tests/gui/helpers/`. Currently: `make-project.ts` (fixture factory) and `create-namespaced-project.ts` (namespaced project fixture + cleanup).

## Approach / Architecture

Extract the duplicated type + default-stub logic into a new shared helper `mcp-server/tests/gui/helpers/api-stubs.ts` that exports:

1. **`ProjectDetailApiStubs`** — an interface with 8 required function fields matching the production `API` methods used by `renderProjectDetail`.
2. **`createApiStubs(overrides?)`** — a factory function that returns a complete `ProjectDetailApiStubs` object with sensible defaults, merging caller-supplied overrides via object spread.

Each of the 4 test files updates its `renderWithAPI` to:
- Import `createApiStubs` and `ProjectDetailApiStubs` from the shared helper.
- Replace the inline `apiStubs` parameter type with `Partial<ProjectDetailApiStubs>`.
- Replace the per-key `??` fallback block with a single `createApiStubs(apiStubs)` call.
- Retain its own file-specific wait logic unchanged.

This reduces each `renderWithAPI` body by ~20 lines while centralising the stub-key inventory. When a new API method is added to `api-client.js` and consumed by `renderProjectDetail`, a developer updates `api-stubs.ts` once — all 4 files inherit the new key automatically.

## Rationale

- **Compile-time enforcement.** The shared type ensures callers cannot pass unknown stub keys (typo prevention). Adding a key to the type + factory makes it immediately available in all 4 files.
- **Single source of truth.** The current 4-file duplication requires manual sync — documented via JSDoc and README, but still error-prone. The rework-2 synthesis and its Reviewer flagged this as the top DX risk.
- **Preserves file independence.** The `renderWithAPI` function body stays file-local. Only the declarative parts (type + defaults) are shared. This respects strategic recommendation #4: "Reserve shared test helper extraction for helpers >100 lines or referenced by >5 files." The shared part is ~25 lines; the per-file functions remain independently runnable.
- **Low risk.** The change is mechanical — same runtime behaviour, same test assertions, same API surface. The only semantic change is that stub construction is delegated to a factory.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|---|---|---|---|
| How to share stub shape | Shared type + factory function (`createApiStubs`) | Type-only (no shared defaults); Full `renderWithAPI` extraction; `TESTING.md` with manual inventory | Type-only doesn't eliminate the body duplication risk. Full extraction would violate rec #4 (per-file wait logic intentionally diverges). TESTING.md is a documentation-only mitigation that doesn't prevent runtime drift. The factory strikes the balance: centralises the data, keeps the procedure per-file. |
| Where to place the shared file | `tests/gui/helpers/api-stubs.ts` | Inline type in each file; Top-level `tests/gui/api-stubs.ts` | The `helpers/` directory already houses shared test fixtures (`make-project.ts`, `create-namespaced-project.ts`). Placing the type there follows the established convention. |

## Pattern Alignment

- **Shared test fixture in `helpers/` directory** — follows the pattern established by `make-project.ts` (introduced in rework-1, strict-typed in rework-2). File path: `mcp-server/tests/gui/helpers/make-project.ts`.
- **Factory-with-overrides pattern** — `createApiStubs(overrides)` mirrors `makeProject(opts)`, both accepting partial override objects merged over defaults. File path: `mcp-server/tests/gui/helpers/make-project.ts`.
- **Explicit interface fields (no index signatures)** — follows the MakeProjectOpts pattern from rework-2 WP-002. File path: `mcp-server/tests/gui/helpers/make-project.ts`.

## Detailed Steps

### Step 1 — Create `api-stubs.ts`

Create `mcp-server/tests/gui/helpers/api-stubs.ts` with:
- `ProjectDetailApiStubs` interface (8 required fields, each `() => Promise<unknown>`).
- `createApiStubs(overrides?: Partial<ProjectDetailApiStubs>): ProjectDetailApiStubs` function that imports `makeProject` from `./make-project.js` and returns the default stub object merged with overrides.
- JSDoc on the interface listing the 8 keys and noting that they correspond to the production `API` methods consumed by `renderProjectDetail`.
- JSDoc on `createApiStubs` explaining the factory purpose and the merge strategy.

### Step 2 — Update `project-detail-runs.test.ts`

- Add import: `import { createApiStubs, type ProjectDetailApiStubs } from './helpers/api-stubs.js';`
- Replace the inline `apiStubs` parameter type in `renderWithAPI` with `Partial<ProjectDetailApiStubs>`.
- Replace the 8-line per-key `??` block with `(globalThis as Record<string, unknown>)['API'] = createApiStubs(apiStubs);`.
- Update the JSDoc: remove the manual "Stub-key sync note" referencing sibling files; replace with a reference to the shared type: "Stub keys are defined in `helpers/api-stubs.ts` — see `ProjectDetailApiStubs`."

### Step 3 — Update `project-detail-resume.test.ts`

Same mechanical changes as Step 2. The wait logic (`200ms` timeout) is unchanged.

### Step 4 — Update `project-detail-poll-modes.test.ts`

Same mechanical changes as Step 2. The wait logic (`200ms` timeout) is unchanged.

### Step 5 — Update `project-detail-scroll.test.ts`

Same mechanical changes as Step 2. The wait logic (`400ms` timeout + 10 extra micro-task flushes) is unchanged. This file currently lacks a stub-key sync JSDoc — add one referencing the shared type.

### Step 6 — Update `tests/gui/README.md`

Update the `renderWithAPI stub keys` callout (lines 156–164) to reflect the new shared-type approach:
- Replace the "keeping them in sync is a manual step" language with a reference to the `ProjectDetailApiStubs` type in `helpers/api-stubs.ts`.
- Note that adding a new API method consumed by `renderProjectDetail` requires updating `api-stubs.ts` only — the type + factory propagate automatically.
- Keep the key inventory list for quick reference.

### Step 7 — Update `file-tree.md`

In `mcp-server/docs/agents/project-manifest/file-tree.md`:
- Add an entry for `api-stubs.ts` under `tests/gui/helpers/`.
- Add entries for `create-namespaced-project.ts` and `create-namespaced-project.test.ts` under `tests/gui/helpers/` (currently missing from the tree).
- Fix the stale "six" project-detail consumer count on the `make-project.ts` entry — the actual count is 8 files.

### Step 8 — Verify

- Run `npx vitest run tests/gui/` from `mcp-server/` — all tests must pass.
- Run `npx tsc --noEmit` from `mcp-server/` — zero type errors.

## Dependencies

- None. This is a self-contained test infrastructure improvement with no production code changes.

## Required Components

- `mcp-server/tests/gui/helpers/api-stubs.ts` (new)
- `mcp-server/tests/gui/project-detail-runs.test.ts` (modify)
- `mcp-server/tests/gui/project-detail-resume.test.ts` (modify)
- `mcp-server/tests/gui/project-detail-poll-modes.test.ts` (modify)
- `mcp-server/tests/gui/project-detail-scroll.test.ts` (modify)
- `mcp-server/tests/gui/README.md` (modify)
- `mcp-server/docs/agents/project-manifest/file-tree.md` (modify)

## Assumptions

- The 8 stub keys in the current `renderWithAPI` implementations are a complete and correct representation of the production `API` methods consumed by `renderProjectDetail`. Verified against `mcp-server/gui/public/api-client.js`.
- The wait-logic differences between files (200ms vs 400ms + micro-task flushes) are intentional and should not be normalised.
- `create-namespaced-project.ts` and `create-namespaced-project.test.ts` were added in a prior cycle but never documented in `file-tree.md` — this is a documentation gap, not a deliberate omission.

## Constraints

- Do not extract the full `renderWithAPI` function body into a shared module. Per strategic recommendation #4 from rework-2, per-file duplication of the function (but not the type/defaults) is the correct pattern at this scale.
- Do not modify production code (`gui/public/`). This plan is purely test infrastructure and documentation.

## Out of Scope

- **`TESTING.md` extraction from `README.md`.** The synthesis suggested this as an alternative to the shared type. Since the shared type is the stronger solution (compile-time vs documentation-only), and the README at 220 lines is not yet large enough to justify splitting, this is deferred.
- **`work-package.js` decomposition.** At 336 lines with 2 top-level functions and no clear section boundaries, this is not justified. The synthesis agreed: "no immediate pressure."
- **Strict typing other fixture factories.** Both `make-project.ts` and `create-namespaced-project.ts` already use explicit interface fields with no index signatures. Nothing to do.
- **JSDoc forward-reference cleanup on `_pdLogPreviewCleanups`.** Already resolved — the current JSDoc (lines 73–91 of `project-detail.js`) contains no "WP-004" forward-reference wording.

## Acceptance Criteria

1. `mcp-server/tests/gui/helpers/api-stubs.ts` exists and exports `ProjectDetailApiStubs` (interface) and `createApiStubs` (factory function).
2. All 4 `renderWithAPI` functions import and use `ProjectDetailApiStubs` for their `apiStubs` parameter type and call `createApiStubs()` for stub construction.
3. No inline `apiStubs` type definition or per-key `??` fallback block remains in any of the 4 test files.
4. All GUI tests pass (`npx vitest run tests/gui/` — 0 failures).
5. TypeScript compiles cleanly (`npx tsc --noEmit` — 0 errors).
6. `tests/gui/README.md` stub-key callout references the shared type instead of manual sync instructions.
7. `file-tree.md` includes the new `api-stubs.ts` entry, the missing `create-namespaced-project.ts`/`.test.ts` entries, and the corrected `makeProject` consumer count.

## Testing Strategy

This change is a pure refactor of test infrastructure — the runtime behavior of all tests is unchanged. Verification is:
1. **Full test suite run** — all existing tests must continue to pass with identical assertions.
2. **TypeScript type check** — the new shared type must integrate cleanly with the existing codebase.
3. **Manual inspection** — verify no inline stub type definitions or `??` fallback blocks remain in the 4 modified test files.

## Test Plan

No new tests are required. The existing test suite (3,214 tests across 109 files) serves as the regression gate. Specifically:

- `mcp-server/tests/gui/project-detail-runs.test.ts` — all existing tests pass with the refactored `renderWithAPI` — covers AC-2, AC-3, AC-4
- `mcp-server/tests/gui/project-detail-resume.test.ts` — all existing tests pass with the refactored `renderWithAPI` — covers AC-2, AC-3, AC-4
- `mcp-server/tests/gui/project-detail-poll-modes.test.ts` — all existing tests pass with the refactored `renderWithAPI` — covers AC-2, AC-3, AC-4
- `mcp-server/tests/gui/project-detail-scroll.test.ts` — all existing tests pass with the refactored `renderWithAPI` — covers AC-2, AC-3, AC-4
- TypeScript compilation (`tsc --noEmit`) — verifies the shared type integrates without errors — covers AC-5

## Documentation Updates

Per `AGENTS.md` → Manifest Maintenance Rules → MCP Server:

- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `api-stubs.ts` entry under `tests/gui/helpers/`; add missing `create-namespaced-project.ts` and `create-namespaced-project.test.ts` entries; fix stale "six" consumer count on `make-project.ts` to "eight" (covers AC-7)
- `mcp-server/tests/gui/README.md` — Update `renderWithAPI stub keys` callout to reference shared `ProjectDetailApiStubs` type instead of manual sync instructions (covers AC-6)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **`createApiStubs` import adds a cross-file dependency, reducing test isolation.** | The dependency is minimal (type + pure factory with no side effects). Each test file still owns its `renderWithAPI` function, `beforeAll`/`beforeEach` setup, and `declare global` block. The shared file is a data definition, not a behavior module. |
| **`makeProject` import chain becomes deeper (test → api-stubs → make-project).** | This is a single extra hop in a test-only import chain. No circular dependencies are introduced. Both files live in `helpers/` and are already co-located. |
