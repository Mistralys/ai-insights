# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.6.0
- Architectural Reviews: none — Plan Architect Reviewer v2.0.0

## Prior Project Context
The repository's short-term strategic vision emphasizes reducing friction in onboarding and daily usage. A truncated, unreadable project summary on the GUI project detail page is a direct friction point. The `outcome_summary` field (set at synthesis completion) already proves the pattern for curated summary fields stored in both the root index and `.meta.json`. This plan extends that pattern with a `project_summary` field set at initialization time.

## Summary
The GUI project detail page truncates long plan summaries with a hard `overflow: hidden` CSS rule, leaving no visual indicator that content is cut off. The root cause is that the data model has no dedicated short-form project description — the GUI extracts the uncontrolled `## Summary` section from the archived plan via regex. This plan delivers two phases: (1) an immediate CSS/JS fix adding a fade-out gradient and "Show more / Show less" toggle, and (2) a `project_summary` field added to the data model, populated by the Ledger Bootstrapper during project initialization, and rendered by the GUI with fallback to the current extraction for older projects.

## Architectural Context
The MCP server's project data flows through three layers: **schema** (`RootIndexSchema`, `ProjectMetaSchema` — Zod-validated), **storage** (`LedgerStore.writeRootIndex()` auto-syncs to `.meta.json` via `writeProjectMeta()`), and **API** (`handleGetProject()` spreads the full root index into the response). The GUI is a vanilla ES5 SPA that consumes these API responses and renders them without a build step. The `outcome_summary` field — set by the Synthesis agent at project end — already traverses this entire pipeline and serves as the direct precedent for `project_summary`.

## Approach / Architecture
**Phase 1 — CSS/JS quick fix:** Replace the hard `overflow: hidden` on `.plan-synopsis` with a CSS gradient fade-out at the bottom edge. Add a "Show more / Show less" toggle button in the synopsis block. When expanded, remove `max-height` and the gradient. The "View full plan →" link remains visible in both states.

**Phase 2 — `project_summary` data field:** Add `project_summary: z.string().nullable().optional()` to `RootIndexSchema` and `ProjectMetaSchema`. Add an optional `project_summary` parameter to `InitializeProjectSchema`. Wire the field through `MetaCacheUpdates`, `writeRootIndex()`, and `writeProjectMeta()` using the same key-presence semantics as `outcome_summary`. Update the GUI to prefer `project_summary` over `extractSynopsis()` when available. Update the Ledger Bootstrapper persona to craft and submit a 2–3 sentence summary during initialization.

## Rationale
- **Phase 1 first:** The visual truncation is the immediate user-facing problem. A CSS/JS fix has zero data-model risk and can ship independently.
- **`project_summary` as an `initializeProject` parameter** rather than a separate tool: The Bootstrapper already reads the plan before calling `ledger_initialize_project`, so it can craft the summary in the same step. This avoids an extra tool call and keeps project creation atomic.
- **No hard character limit in the schema:** A soft guideline in the persona instructions (2–3 sentences) is more flexible than a Zod `.max()` constraint. Complex projects may need slightly longer summaries, and agent-generated text is already length-controlled by the persona prompt.
- **Fallback to `extractSynopsis()`:** Ensures backward compatibility — the ~118 existing projects will continue to display their plan summaries as they do today.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Summary source | Curated `project_summary` field (agent-written) | Auto-extract first N characters from `## Summary`; server-side truncation in `api.ts` | Agent curation produces natural-reading text vs. awkward mid-sentence truncation; small agent cost per project is negligible |
| Tool surface | Optional param on `ledger_initialize_project` | Separate `ledger_set_project_summary` tool | Single atomic call is simpler; a separate update tool can be added later if editing becomes needed |
| Schema enforcement | Soft guideline (2–3 sentences in persona instructions) | Hard `.max(500)` in Zod schema | Hard limit risks rejecting valid summaries for complex projects; persona instructions already control agent output length effectively |

## Pattern Alignment
- **Nullable optional field pattern** — follows `outcome_summary` in both `RootIndexSchema` and `ProjectMetaSchema` — `mcp-server/src/schema/root-index.ts` L53, `mcp-server/src/schema/project-meta.ts` L21
- **Key-presence sync in `writeRootIndex()`** — follows the `'outcome_summary' in validated` pattern — `mcp-server/src/storage/ledger-store.ts` L265
- **MetaCacheUpdates extension** — follows the existing spread-override pattern for `outcome_summary` — `mcp-server/src/storage/ledger-store.ts` L17–L35
- **CSS toggle pattern** — follows the existing collapsible tool-call cards in `buildDialogueHTML()` — `mcp-server/gui/public/views/project-detail-dialogues.js`
- **No departures** from existing patterns.

## Detailed Steps

### Phase 1 — CSS Fade-Out and Toggle (GUI Only)

1. **Update `.plan-synopsis` CSS** in `mcp-server/gui/public/styles.css`:
   - Replace `overflow: hidden` with `overflow: hidden; position: relative`.
   - Add a `::after` pseudo-element on `.plan-synopsis` creating a gradient fade from transparent to `var(--color-surface)` at the bottom (height ~3rem).
   - Add a `.plan-synopsis--expanded` modifier class that removes `max-height` and hides the `::after` gradient.
   - Style a `.plan-synopsis__toggle` button (inline-block, 12px font, same color as `.plan-synopsis__link`, no border/background, cursor pointer).
   - No dark-mode overrides are needed for the gradient: the fade uses `var(--color-surface)`, which is already overridden for dark mode in `styles.css` (`#1e293b` at L131).

2. **Add toggle behavior** in `mcp-server/gui/public/views/project-detail.js`:
   - After rendering the `.plan-synopsis` block, check if the content height exceeds the container's `max-height` (12rem = 192px at default font size).
   - If it does, insert a "Show more" toggle button after `.plan-synopsis__content`.
   - On click, toggle `.plan-synopsis--expanded` class on the container and update button text to "Show less" / "Show more".
   - If content fits within `max-height`, do not show the toggle and do not apply the gradient (add a `.plan-synopsis--fits` class that hides the `::after`).

### Phase 2 — `project_summary` Data Field

3. **Add `project_summary` to `RootIndexSchema`** in `mcp-server/src/schema/root-index.ts`:
   - Add `project_summary: z.string().nullable().optional()` to the schema object, positioned after `outcome_summary` for logical grouping.

4. **Add `project_summary` to `ProjectMetaSchema`** in `mcp-server/src/schema/project-meta.ts`:
   - Add `project_summary: z.string().nullable().optional()` after `outcome_summary`.

5. **Add `project_summary` to `MetaCacheUpdates`** in `mcp-server/src/storage/ledger-store.ts`:
   - Add `project_summary?: string | null` to the `MetaCacheUpdates` interface.

6. **Wire `project_summary` through `writeRootIndex()`** in `mcp-server/src/storage/ledger-store.ts`:
   - Add `...('project_summary' in validated ? { project_summary: validated.project_summary } : {})` to the `writeProjectMeta()` call inside `writeRootIndex()`, following the `outcome_summary` pattern.

7. **Wire `project_summary` through `writeProjectMeta()`** in `mcp-server/src/storage/ledger-store.ts`:
   - Add preserve-existing logic: `...(existing.project_summary !== undefined ? { project_summary: existing.project_summary } : {})`
   - Add cacheUpdates override: `...(cacheUpdates !== undefined && 'project_summary' in cacheUpdates ? { project_summary: cacheUpdates.project_summary } : {})`
   - Both additions follow the exact `outcome_summary` lines.

8. **Add `project_summary` parameter to `InitializeProjectSchema`** in `mcp-server/src/tools/project-lifecycle.ts`:
   - Add `project_summary: z.string().min(1).optional().describe('Optional 2–3 sentence summary of the project intent, for display in the GUI')` to the schema. The `.min(1)` guard prevents empty-string submissions (aligns schema validation with the truthiness check applied at storage time; consistent with constraint §75 — string input fields enforce quality when provided).
   - In `initializeProject()`, if `args.project_summary` is provided, include it in the root index construction at L581–L596: `...(args.project_summary ? { project_summary: args.project_summary } : {})`.

9. **Update GUI to prefer `project_summary`** in `mcp-server/gui/public/views/project-detail.js`:
   - In the synopsis rendering IIFE (L578–L590), check if `project.project_summary` exists and is non-empty.
   - If yes, render it directly (escaped via `escapeHtml()`, no `marked.parse()` since it's plain text) in the `.plan-synopsis` block, with the "View full plan →" link below.
   - If no, fall back to the existing `extractSynopsis()` + `marked.parse()` approach.
   - The Phase 1 toggle behavior applies to both rendering paths.

10. **Update Ledger Bootstrapper persona** in `personas/ledger-support/src/content/ledger-bootstrapper.md`:
    - In the 7-step Bootstrapping Protocol, modify step 2 to include summary curation:
      - Before calling `ledger_initialize_project`, read the plan's `## Summary` section.
      - Craft a 2–3 sentence plain-text summary of the project's intent (what it aims to accomplish, not how).
      - Pass the summary as the `project_summary` parameter to `ledger_initialize_project`.
    - Add a guideline: the summary should be factual and concise (2–3 sentences, no markdown formatting).

11. **Rebuild persona output** by running `node scripts/build-personas.js` after editing the persona source.

### Phase 3 — Display `outcome_summary` for Completed Projects

12. **Render `outcome_summary` in the GUI** for projects with `synthesis_generated === true`:
    - In the project detail view, after the synthesis link row, add a `.outcome-synopsis` block (styled similarly to `.plan-synopsis` but with a distinct accent color, e.g., `--color-complete`).
    - Render `project.outcome_summary` as escaped plain text.
    - This provides the dual-field display: `project_summary` shows the *intent*, `outcome_summary` shows the *result*.

## Dependencies
- Phase 1 has no dependencies — pure CSS/JS change.
- Phase 2 steps 3–8 (schema + storage + tool) must be completed before step 9 (GUI) and step 10 (persona).
- Step 11 (persona rebuild) depends on step 10.
- Phase 3 (step 12) depends on Phase 2 being complete (for visual consistency).

## Required Components
- `mcp-server/gui/public/styles.css` — CSS modifications
- `mcp-server/gui/public/views/project-detail.js` — JS toggle + rendering logic
- `mcp-server/src/schema/root-index.ts` — schema addition
- `mcp-server/src/schema/project-meta.ts` — schema addition
- `mcp-server/src/storage/ledger-store.ts` — storage sync wiring
- `mcp-server/src/tools/project-lifecycle.ts` — tool parameter addition
- `personas/ledger-support/src/content/ledger-bootstrapper.md` — persona instruction update

## Assumptions
- The `project_summary` field is plain text (no markdown). This simplifies rendering (no `marked.parse()` needed) and keeps the content predictable.
- Existing projects (~118) will continue using the `extractSynopsis()` fallback and will not be retroactively populated. A future migration script could be added if needed, but is out of scope.
- The Ledger Bootstrapper has sufficient context from reading the plan to craft a meaningful 2–3 sentence summary without additional tool calls.

## Constraints
- GUI code must be ES5-compatible (no `const`, `let`, arrow functions, template literals) — `mcp-server/gui/public/` convention.
- All Zod schema additions must be `.optional()` or `.nullable().optional()` for backward compatibility.
- File writes must use `atomicWriteJson()` (Constraint 1 in `mcp-server/docs/agents/project-manifest/constraints.md`).
- Generated persona files must not be edited directly — changes go through `personas/ledger-support/src/content/` source files (AGENTS.md failure protocol).

## Out of Scope
- Retroactive population of `project_summary` for existing projects.
- A dedicated `ledger_set_project_summary` or `ledger_update_project_summary` tool (can be added later if summary editing becomes needed).
- Hard character limits in the Zod schema for `project_summary`.
- Changes to the project list view to show `project_summary` as a subtitle (nice-to-have for a future iteration).
- `outcome_summary` display in the project *list* view (only added to the detail view in Phase 3).

## Acceptance Criteria

- AC-01: The `.plan-synopsis` block displays a gradient fade-out at the bottom instead of hard truncation when content exceeds `max-height`.
- AC-02: A "Show more / Show less" toggle button appears when the synopsis content exceeds the container height, and clicking it expands/collapses the content.
- AC-03: When the synopsis content fits within `max-height`, no toggle button or gradient is shown.
- AC-04: The `RootIndexSchema` and `ProjectMetaSchema` accept a `project_summary: string | null` field and parse successfully with or without it.
- AC-05: The `InitializeProjectSchema` accepts an optional `project_summary` string parameter.
- AC-06: When `project_summary` is passed to `ledger_initialize_project`, it is persisted in both `project-ledger.json` and `.meta.json`.
- AC-07: The GUI project detail page renders `project_summary` when available, falling back to `extractSynopsis()` for projects without it.
- AC-08: The Ledger Bootstrapper persona instructions include a step to craft and submit a `project_summary` during initialization.
- AC-09: Persona output is rebuilt and the generated files reflect the updated instructions.
- AC-10: For completed projects with `synthesis_generated === true` and a non-null `outcome_summary`, the project detail page displays the outcome summary in a visually distinct block.
- AC-11: All existing tests continue to pass (no regressions).
- AC-12: New tests cover schema acceptance/rejection, tool parameter handling, storage sync, and GUI rendering logic for `project_summary`.

## Testing Strategy
Schema and storage changes are tested with unit tests against the Zod schemas and `LedgerStore` methods. Tool changes are tested with integration-style tests using real `LedgerStore` instances in temp directories. GUI rendering logic is tested via the existing jsdom-based test infrastructure (if applicable) or manually via the GUI server. CSS/JS toggle behavior is verified via manual testing in the browser.

## Test Plan

- `mcp-server/tests/schema/root-index-project-summary.test.ts` (new) — Verifies `RootIndexSchema` accepts `project_summary: "text"`, `project_summary: null`, and missing `project_summary`; rejects `project_summary: 123` — covers AC-04
- `mcp-server/tests/schema/project-meta-project-summary.test.ts` (new) — Same validation for `ProjectMetaSchema` — covers AC-04
- `mcp-server/tests/tools/project-lifecycle.test.ts` (modified) — New test case: `initializeProject` with `project_summary` param persists the field in root index and `.meta.json`; without the param, field is absent — covers AC-05, AC-06
- `mcp-server/tests/tools/meta-enrichment.test.ts` (modified) — Verify `project_summary` appears in `.meta.json` when passed to `initializeProject` — covers AC-06
- `mcp-server/tests/gui/api.test.ts` (modified) — Verify `handleGetProject` returns `project_summary` when present in the root index — covers AC-07 (data layer)
- Manual browser test — Verify fade-out gradient, toggle button, expand/collapse, no-toggle-when-fits, dark mode — covers AC-01, AC-02, AC-03
- Manual browser test — Verify `project_summary` rendering vs. `extractSynopsis()` fallback — covers AC-07
- Manual browser test — Verify `outcome_summary` block for completed projects — covers AC-10
- `npm test` in `mcp-server/` — Full regression run — covers AC-11

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `project_summary` to `ledger_initialize_project` tool signature; add field to `RootIndexSchema` and `ProjectMetaSchema` documentation
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Add `project_summary` to the `initializeProject` data flow description
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — Document `.plan-synopsis--expanded`, `.plan-synopsis__toggle`, `.plan-synopsis--fits` CSS classes and the toggle behavior; document `.outcome-synopsis` block
- `mcp-server/docs/agents/project-manifest/constraints.md` — Update §75 (Dual-Schema Pattern) to note `project_summary` as a second instance of the dual-schema / key-presence pattern alongside the existing `outcome_summary` canonical example
- `mcp-server/docs/agents/project-manifest/file-tree.md` — No new files expected; update if any new test files are added at unexpected paths
- Root `AGENTS.md` — Add `project_summary` to the Cross-System Dependencies table (source of truth: `RootIndexSchema`; must stay in sync with: `ProjectMetaSchema`, `InitializeProjectSchema`, Bootstrapper persona)
- Persona build output — Regenerated automatically by step 11

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Retroactive population of `project_summary` for existing projects | Research paper — Open Questions | Low priority since the GUI falls back to `extractSynopsis()`; can be done with a one-shot script later | Consider a `scripts/backfill-project-summary.js` if the number of legacy projects without summaries becomes a UX concern |
| 2 | `ledger_set_project_summary` update tool | Research paper — Implementation Decision | No current use case for updating summaries after creation; the `initializeProject` param covers the primary flow | Add when summary editing becomes a user need |
| 3 | Project list view subtitle from `project_summary` | Research paper — Phase 2 step 5 | Nice-to-have that adds complexity to the list rendering; the detail page is the primary beneficiary | Revisit once the field is established and populated |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Bootstrapper produces low-quality summaries** | The persona instructions specify "2–3 sentences, plain text, factual summary of the project's intent." Monitor initial outputs and refine the prompt if needed. The GUI always has the `extractSynopsis()` fallback. |
| **Toggle button breaks in dark mode** | Explicit dark-mode CSS overrides for the gradient and button colors, following the existing dark-mode pattern throughout `styles.css`. |
| **Backward compatibility regression** | All schema additions use `.nullable().optional()`. Existing tests must pass without any `project_summary` data. The enrichment resilience test (`enrichment-resilience.test.ts`) already validates that `initializeProject` succeeds even when optional features fail. |
| **Persona rebuild produces stale output** | Step 11 explicitly runs `node scripts/build-personas.js`. The pre-commit hook (`scripts/build-personas.js --check`) will catch stale output before commit. |
