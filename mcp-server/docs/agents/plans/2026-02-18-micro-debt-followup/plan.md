# Plan

**Source:** `2026-02-18-technical-debt-remediation` synthesis  
**Generated:** 2026-02-18  
**Agent:** Chief Product Officer (Planning)

---

## Summary

The technical debt remediation session (`v1.3.0 → v1.3.1`) closed all blocking issues but produced ~16 non-blocking carry-forward observations, 7 of which were flagged independently by multiple agents and are catalogued in the synthesis. This plan addresses all 7 carry-forward items plus all strategic recommendations from that synthesis, bundled into a single follow-up pass targeting `v1.3.2`. The changes are all small (each ~5–10 minutes of implementation), but collectively they close remaining correctness traps, eliminate dual-maintenance risk, and bring the codebase to a higher structural clarity standard.

---

## Approach / Architecture

All changes are confined to existing files — no new modules are created. They fall into four categories:

1. **Derived inverse map** — eliminate the manually maintained `AGENT_PIPELINE_MAP` by deriving it at runtime from `PIPELINE_AGENT_MAP` in `pipeline-maps.ts`.
2. **Type safety** — introduce a `PipelineType` string union and type all four routing maps as `Record<PipelineType, string>` for compile-time exhaustiveness.
3. **Inline documentation** — add targeted comments at three locations (`timestamp.ts`, `index.ts`, `workflow.ts`) to prevent future silent regressions.
4. **Code organisation** — hoist three inline maps to module-level constants in `workflow.ts`; standardise `_internal` export placement across `pipeline.ts` and `workflow.ts`.

No behavioural changes. No new tests are strictly required, though the derived-map change should be verified by the existing test suite.

---

## Rationale

- **Derived inverse map** eliminates the most-flagged risk in the whole remediation session (flagged by Developer, QA, and Reviewer independently on WP-001): if `PIPELINE_AGENT_MAP` gains a new entry and `AGENT_PIPELINE_MAP` is not updated, tools silently break. A single `Object.fromEntries` call makes divergence structurally impossible.
- **`PipelineType` union** pairs naturally with the derived map and extends compile-time protection to all map accesses. A misspelled pipeline type key currently passes TypeScript silently; `Record<PipelineType, string>` changes that to a compile error.
- **`now()` comment** is a correctness trap: the function deliberately avoids `toISOString()` to prevent UTC conversion. Without documentation, this will be "simplified" by a future maintainer and introduce a timezone bug. It has been flagged independently by three agents.
- **Inline source comment on `index.ts`** tool listing: the existing note was added to the startup log only (runtime-visible). Adding it as a static source comment above the `register()` block makes it visible at edit time — when it actually matters.
- **Hoisting `agentNameMap` / `actionNameMap` / `reworkActionMap`** out of `getNextActions` removes per-call allocation of three objects that are logically constant. More importantly, it makes the relationship between these maps and the module-level `PIPELINE_AGENT_MAP` visible at the top of the file.
- **`_internal` placement standardisation** removes an inconsistency: `pipeline.ts` places it immediately after imports (line 16); `workflow.ts` at the bottom (line 1805). A consistent convention, after imports, is easier to navigate and matches the "public surface first" pattern already used in `pipeline.ts`.

---

## Detailed Steps

1. **`src/utils/pipeline-maps.ts` — derive `AGENT_PIPELINE_MAP`**  
   Replace the manually written `AGENT_PIPELINE_MAP` constant with a derived expression:
   ```ts
   export const AGENT_PIPELINE_MAP = Object.fromEntries(
     Object.entries(PIPELINE_AGENT_MAP).map(([k, v]) => [v, k])
   ) as Record<string, string>;
   ```
   Once the `PipelineType` type is introduced (step 2), tighten the cast to `Record<string, PipelineType>` if appropriate.

2. **`src/utils/pipeline-maps.ts` — introduce `PipelineType` union**  
   Add above the map definitions:
   ```ts
   export type PipelineType = 'implementation' | 'qa' | 'code-review' | 'documentation';
   ```
   Update the four map type annotations:
   - `PIPELINE_PREREQUISITES: Record<PipelineType, PipelineType | null>`
   - `PIPELINE_AGENT_MAP: Record<PipelineType, string>`
   - `NEXT_AGENT_MAP: Record<PipelineType, string>`
   - `AGENT_PIPELINE_MAP` retains `Record<string, string>` (inverse direction; agent names are not a closed union here)

3. **`src/utils/timestamp.ts` — add UTC-trap comment to `now()`**  
   Add an inline comment on or directly above the `return` statement explaining why `toISOString()` is intentionally not used:
   ```ts
   // NOTE: toISOString() converts to UTC, which would corrupt timestamps for
   // users in non-UTC timezones. This manual construction uses local time
   // deliberately. Do not replace with toISOString().
   ```

4. **`src/tools/workflow.ts` — hoist three inline maps to module-level**  
   Move `agentNameMap`, `actionNameMap`, and `reworkActionMap` from inside `getNextActions` to module-level `const` declarations (below imports, before the first function). Add brief JSDoc describing their purpose.

5. **`src/tools/workflow.ts` — move `_internal` export to after imports**  
   Relocate the `export const _internal = { ... }` block from line 1805 (bottom of file) to immediately after the import block, matching the placement convention already established in `pipeline.ts`.

6. **`src/index.ts` — add inline source comment above the tool registration block**  
   Add a `// NOTE:` comment directly above the `projectLifecycleTools.register(server)` line explaining that the startup-log tool list requires manual sync and must be updated whenever tools are added or removed in `src/tools/**`.

7. **Version bump and changelog**  
   Bump `package.json` from `1.3.1` → `1.3.2`. Add a `v1.3.2` entry to `changelog.md` describing all changes above.

8. **Update project manifest**  
   Review `docs/agents/project-manifest/api-surface.md` to reflect the new `PipelineType` export from `pipeline-maps.ts`.

---

## Dependencies

- No external library changes.
- Steps 1 and 2 are tightly coupled (`PipelineType` must exist before annotating the maps with it); do them together.
- Steps 4 and 5 are independent of each other but both touch `workflow.ts`; implement in a single editing session to avoid conflicts.
- Steps 6, 7, and 8 are independent of all others and can be done in any order.

---

## Required Components

| File | Change |
|------|--------|
| `src/utils/pipeline-maps.ts` | Export `PipelineType`; refine map annotations; derive `AGENT_PIPELINE_MAP` |
| `src/utils/timestamp.ts` | Add UTC-trap inline comment |
| `src/tools/workflow.ts` | Hoist three maps to module-level; relocate `_internal` export |
| `src/index.ts` | Add inline source comment above registration block |
| `package.json` | Version bump `1.3.1 → 1.3.2` |
| `changelog.md` | `v1.3.2` entry |
| `docs/agents/project-manifest/api-surface.md` | Document `PipelineType` export |

---

## Assumptions

- The existing test suite (136 tests) covers all map access paths; no new tests are required for the derived-map change, though the Developer should verify no type errors arise from the `Record<PipelineType, ...>` annotations.
- The `_internal` relocation in `workflow.ts` is a source-only structural move; all test imports remain valid because the exported shape is unchanged.
- `agentNameMap`, `actionNameMap`, and `reworkActionMap` contain no closure dependencies on `getNextActions` parameters and are safe to hoist.

---

## Constraints

- **No behavioural changes.** All changes must be purely structural, documentary, or type-level.
- **Tests must remain green.** All 136 existing tests must pass after each change.
- **No new external dependencies.**
- The `findLast` upgrade is intentionally out of scope — it requires a `tsconfig.json` target/lib bump and should be a separate, explicitly scoped change.

---

## Out of Scope

- `hasDependencyBlocked` / `isBlockedByDependencies` consolidation — requires design discussion; deferred to a future refactor WP.
- `tsconfig` target bump to ES2023 and `.findLast()` migration — tracked as a future item; not part of this pass.
- Any changes to test files beyond what is necessitated by type annotation changes in `pipeline-maps.ts`.

---

## Acceptance Criteria

- `AGENT_PIPELINE_MAP` is derived from `PIPELINE_AGENT_MAP` via `Object.fromEntries`; the manually written entries are removed.
- `PipelineType` is exported from `pipeline-maps.ts` and all four map type annotations use it.
- `now()` in `timestamp.ts` has an inline comment explaining the UTC-avoidance rationale.
- `agentNameMap`, `actionNameMap`, and `reworkActionMap` are module-level constants in `workflow.ts`.
- `_internal` in `workflow.ts` is located directly after the import block, matching `pipeline.ts`.
- `src/index.ts` has a static source comment above the `register()` block noting the manual-sync requirement.
- `package.json` version is `1.3.2`; `changelog.md` contains a `v1.3.2` entry.
- `api-surface.md` documents `PipelineType`.
- `npm test` passes with 136+ tests, 0 failures.

---

## Testing Strategy

- Run the full test suite (`npm test`) after steps 1–2 to confirm the `PipelineType` annotation changes introduce no type or runtime regressions.
- Run the full test suite again after steps 4–5 to confirm the `workflow.ts` restructuring breaks nothing.
- A final `npm test` pass after all changes validates the complete session.
- No new test files are expected; if type narrowing from `PipelineType` reveals untested edge cases the Developer should flag them as observations rather than adding tests speculatively.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`Record<PipelineType, string>` annotation causes type errors at existing call sites that pass `string` keys** | Audit all map-access call sites in `pipeline.ts` and `workflow.ts` before committing; widen to `Record<string, string>` on a per-map basis if needed, noting the exception. |
| **Derived `AGENT_PIPELINE_MAP` produces wrong key/value order if `Object.entries` iteration order is non-deterministic** | Object.entries on string-keyed objects is insertion-ordered in V8 and per ES2015+ spec for non-integer keys; this is safe. Verify with a quick console check during development. |
| **Relocating `_internal` in `workflow.ts` breaks test imports** | The export name and shape are unchanged; only source position moves. Module-level `export const` is order-independent in TypeScript/ESM. |
| **Hoisting the three maps uncovers a hidden closure dependency** | Read all three map definitions carefully before moving; confirm no references to function-scoped variables. The synthesis analysis indicates they are pure literal objects. |
