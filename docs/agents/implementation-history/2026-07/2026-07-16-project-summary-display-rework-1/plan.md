# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.6.0
- Architectural Reviews: 2 — Plan Architect Reviewer v2.1.0

## Prior Project Context
The original `2026-07-16-project-summary-display` project delivered a two-phase improvement: CSS/JS synopsis toggle and a `project_summary` data field wired end-to-end. The synthesis identified 9 deferred items and 5 strategic recommendations. This rework promotes the highest-value items and closes a structural gap where standalone-imported projects never receive a curated `project_summary`.

## Summary
This rework plan addresses actionable items from the `2026-07-16-project-summary-display` synthesis. It closes the `project_summary` gap for standalone imports (tool parameter + Archiver persona update), eliminates CLAUDE.md drift by replacing the file with an `@AGENTS.md` include directive, hardens the GUI toggle IIFE against async font loading, adds a live-update mechanism for the outcome-synopsis block, and applies three targeted polish items (inline comment, CSS style fix, Bootstrapper edge-case guard).

## Architectural Context
The MCP server's `ledger_import_standalone` tool (`mcp-server/src/tools/standalone-import.ts`) accepts a plan folder path, reads `plan.md` and `synthesis.md`, and delegates to `LedgerStore.importStandaloneProject()` which constructs a root index and writes it via `writeRootIndex()`. The `writeRootIndex()` method already has key-presence propagation for `project_summary` (L271), so adding the field to the constructed root index is sufficient for automatic `.meta.json` sync.

The GUI's project detail page (`mcp-server/gui/public/views/project-detail.js`) uses a poll loop with `_snapshotProjectState()` / `_diffProjectState()` for targeted DOM patches. The `synthesis-link-row` already demonstrates the pre-rendered hidden container + `_patch*` function pattern that will be extended to `outcome-synopsis`.

Both sibling repositories in this workspace (`ai-persona-builder/CLAUDE.md`, `cli-menu/CLAUDE.md`) already use a single-line `@AGENTS.md` include directive instead of a full content copy, which eliminates drift structurally. This plan adopts the same pattern.

## Approach / Architecture
Seven changes across four areas:

1. **Standalone import `project_summary` support** — Add an optional `project_summary` parameter to `ImportStandaloneSchema`, extend `ImportStandaloneDetail` with an optional `projectSummary` field, pass it through `importStandaloneProject()` into the root index construction. Update help content. Update the Standalone Archiver persona to read `plan.md`, craft a summary, and pass it via the new parameter.

2. **CLAUDE.md drift elimination** — Replace `CLAUDE.md` full content with a single `@AGENTS.md` include directive, matching the pattern already in use in `ai-persona-builder/CLAUDE.md` and `cli-menu/CLAUDE.md`. This eliminates drift structurally rather than detecting it reactively and removes the need for any sync step.

3. **GUI hardening** — Wrap the toggle IIFE in `document.fonts.ready.then()`, add an inline comment documenting the synopsis rendering asymmetry, add `font-family: inherit` to `.plan-synopsis__toggle`, and implement live-update for the outcome-synopsis block.

4. **Bootstrapper edge-case guard** — Add a sentence to Step 2 instructing the agent to omit `project_summary` if the `## Summary` section is too brief for a meaningful 2–3 sentence description.

## Rationale
- **Standalone `project_summary`** closes the last gap in the curated summary pipeline — all project types will now benefit from agent-curated descriptions rather than regex fallbacks.
- **Tool parameter (not automatic extraction)** keeps `importStandalone()` as a pure storage orchestrator per its documented contract. The agent crafts the summary; the tool stores it.
- **`@AGENTS.md` include for CLAUDE.md** eliminates drift structurally — both sibling repositories already use this pattern. Replacing the full content copy with one line is smaller in scope than adding a pre-commit check and removes the need for any sync step.
- **`document.fonts.ready.then()`** is the correct API for font-load deferral — it returns a Promise compatible with ES5 `.then()` syntax and is supported in all modern browsers.
- **Pre-rendered hidden container for outcome-synopsis** follows the established `synthesis-link-row` pattern exactly, keeping the poll loop's patch architecture consistent.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| `project_summary` for standalone | Tool parameter (agent crafts, tool stores) | Auto-extract `## Summary` inside `importStandalone()` | Keeps tool as pure storage orchestrator; agent produces higher-quality curated text than mechanical extraction |
| CLAUDE.md drift prevention | Replace with `@AGENTS.md` include | Pre-commit advisory warning; auto-sync on commit | One-line include eliminates drift entirely; the advisory warning was rejected because both sibling repos already prove the include pattern works and it removes Step 4 + the sync step from Step 11 entirely |
| Font-load guard | `document.fonts.ready.then()` | `requestAnimationFrame` | `fonts.ready` targets the exact condition (font loading); rAF only defers one frame and may still miss slow font loads |

## Pattern Alignment
- **Key-presence semantics for optional nullable field** — follows `outcome_summary` and `project_summary` pattern in `writeRootIndex()` — `mcp-server/src/storage/ledger-store.ts` L270–271
- **Pre-rendered hidden container + `_patch*` function** — follows `#synthesis-link-row` + `_patchSynthesisLink()` — `mcp-server/gui/public/views/project-detail.js` L25–27, L205–230
- **`@AGENTS.md` include directive** — follows `ai-persona-builder/CLAUDE.md` and `cli-menu/CLAUDE.md` (both already in production in this workspace)
- **`ImportStandaloneDetail` interface extension** — follows existing optional field pattern (`outcomeSummary`) — `mcp-server/src/storage/ledger-store.ts` L55
- **No departures** from existing patterns.

## Detailed Steps

### Step 1 — Add `project_summary` to `ImportStandaloneSchema` and `ImportStandaloneDetail`

1a. In `mcp-server/src/tools/standalone-import.ts`, add an optional `project_summary` field to `ImportStandaloneSchema`:
```typescript
project_summary: z
  .string()
  .min(1)
  .optional()
  .describe(
    'Optional curated 2–3 sentence plain-text summary of the project\'s intent. ' +
    'When provided, stored as project_summary in the root index and .meta.json. ' +
    'When omitted, the project will use the GUI\'s extractSynopsis() fallback.'
  ),
```

1b. In `mcp-server/src/storage/ledger-store.ts`, add an optional `projectSummary` field to `ImportStandaloneDetail`:
```typescript
/** Optional curated project summary, or `undefined` if not provided by the caller. */
projectSummary?: string;
```

1c. In `importStandalone()` handler (`standalone-import.ts`), pass `args.project_summary` through to the store call:
```typescript
archiveResult = await store.importStandaloneProject({
  planFile: PLAN_ARCHIVE_FILENAME,
  synthesisFile: SYNTHESIS_ARCHIVE_FILENAME,
  dateCreated,
  outcomeSummary,
  pipelineSummary: ...,
  projectSummary: args.project_summary,
});
```

1d. In `importStandaloneProject()` (`ledger-store.ts`), include `project_summary` in the root index construction when the field is defined:
```typescript
const rootIndex: RootIndex = {
  // ...existing fields...
  ...(detail.projectSummary !== undefined ? { project_summary: detail.projectSummary } : {}),
};
```

1e. Update `mcp-server/src/tools/help-content.ts` — add `project_summary` to the `ledger_import_standalone` help entry's parameter list.

### Step 2 — Add tests for standalone import `project_summary`

In `mcp-server/tests/tools/standalone-import.test.ts`, add tests:

- Schema accepts a valid `project_summary` string
- Schema accepts objects without `project_summary`
- Schema rejects an empty `project_summary` string (min(1) constraint)
- `importStandalone()` persists `project_summary` in root index and `.meta.json` when provided
- `importStandalone()` omits `project_summary` from root index when not provided (backward compatibility)

### Step 3 — Update Standalone Archiver persona

3a. In `personas/ledger-support/src/content/standalone-archiver.md`, update the Import Mode workflow. Before the current Step 1 ("Import the plan folder"), insert a new preliminary step:

**New Step 1 — Craft project summary:** Read `plan.md` in the plan folder and locate the `## Summary` section. From that section, craft a `project_summary` following the same guidelines as the Bootstrapper (factual, concise, plain text, 2–3 sentences, focused on intent). If the plan has no `## Summary` section, or if the section is too brief for a meaningful 2–3 sentence summary, skip this step — do not invent content.

**Updated Step 2 (formerly Step 1) — Import the plan folder:** Update the `ledger_import_standalone` call to include `project_summary` when crafted:
```
project_path: {absolute path to the plan folder}
project_summary: {the 2–3 sentence summary crafted above, or omit if not crafted}
```

3b. Rebuild personas via `node scripts/build-personas.js` to regenerate the 3 output targets for standalone-archiver.

### Step 4 — Replace CLAUDE.md with `@AGENTS.md` include directive

Replace the full content of `CLAUDE.md` with a single line:

```
@AGENTS.md
```

This matches the pattern already in production in `ai-persona-builder/CLAUDE.md` and `cli-menu/CLAUDE.md`. Claude Code resolves `@AGENTS.md` at read time, ensuring `CLAUDE.md` always reflects `AGENTS.md` without any sync step or drift risk. Remove the `<!-- NOTE: This file is generated automatically ... -->` header and all copied content.

### Step 5 — Wrap toggle IIFE in `document.fonts.ready.then()`

In `mcp-server/gui/public/views/project-detail.js`, wrap the toggle IIFE (L632–660) inside `document.fonts.ready.then()`:

```javascript
// ── Synopsis Show More / Show Less toggle ────────────────────────────────
// Deferred until fonts are loaded so that scrollHeight / offsetHeight
// measurements reflect the final rendered line heights.
document.fonts.ready.then(function () {
  var synopsisEl = document.getElementById('plan-synopsis');
  if (!synopsisEl) return;
  // ...rest of existing toggle logic unchanged...
});
```

This replaces the synchronous IIFE call. The `document.fonts.ready` property returns a Promise that resolves when all font faces have loaded, ensuring accurate height measurements.

### Step 6 — Add synopsis rendering asymmetry comment

In `mcp-server/gui/public/views/project-detail.js`, above the synopsis IIFE (around L578), add a comment:

```javascript
// Synopsis rendering note: project_summary (when present) is rendered as
// plain text via escapeHtml() wrapped in <p>.  The extractSynopsis()
// fallback renders Markdown via marked.parse(), which produces block-level
// HTML (<p> tags included).  Both paths render correctly but differ
// structurally — see styles.css .plan-synopsis__content p rule.
```

### Step 7 — Add `font-family: inherit` to `.plan-synopsis__toggle`

In `mcp-server/gui/public/styles.css`, add `font-family: inherit;` to the `.plan-synopsis__toggle` rule (L1331–1345).

### Step 8 — Outcome-synopsis live-update

8a. In `mcp-server/gui/public/views/project-detail.js`, change the outcome-synopsis IIFE to always pre-render the container (hidden when no outcome_summary), matching the `synthesis-link-row` pattern:

```javascript
(function () {
  if (!project.synthesis_generated || !project.outcome_summary) {
    return '<div id="outcome-synopsis" style="display:none"></div>';
  }
  return '<div id="outcome-synopsis" class="outcome-synopsis">' +
    '<div class="outcome-synopsis__content">' + escapeHtml(project.outcome_summary) + '</div>' +
    '</div>';
})()
```

8b. Add a `_patchOutcomeSynopsis()` function following the `_patchSynthesisLink()` pattern:

```javascript
function _patchOutcomeSynopsis(visible, outcomeSummary) {
  var el = document.getElementById('outcome-synopsis');
  if (visible && outcomeSummary) {
    if (el) {
      if (!el.querySelector('.outcome-synopsis__content')) {
        el.className = 'outcome-synopsis';
        el.innerHTML = '<div class="outcome-synopsis__content">' +
          escapeHtml(outcomeSummary) + '</div>';
      }
      el.style.display = '';
    }
  } else {
    if (el) el.style.display = 'none';
  }
}
```

8c. In `_snapshotProjectState()` (`project-detail-helpers.js`), add `outcome_summary` to the returned snapshot object:

```javascript
return {
  // ...existing fields...
  outcome_summary: (project && project.outcome_summary) || null,
};
```

8d. In `_diffProjectState()` (`project-detail-helpers.js`), add `outcome_summary` to the data-only diff detection:

```javascript
if (prev.outcome_summary !== next.outcome_summary) {
  changes.outcome_summary = true;
  type = 'data';
}
```

8e. In the poll loop's data-only patch section (`project-detail.js`), add a patch call after the synthesis link patch:

```javascript
if (changes.outcome_summary || changes.synthesis_generated) {
  _patchOutcomeSynopsis(
    nextSnapshot.synthesis_generated && !!nextSnapshot.outcome_summary,
    nextSnapshot.outcome_summary
  );
}
```

### Step 9 — Bootstrapper edge-case guard

In `personas/ledger-support/src/content/ledger-bootstrapper.md`, in Step 2 after the existing "If the plan has no `## Summary` section" fallback, add:

> **If `## Summary` exists but is too brief** (e.g., a single phrase or fewer than two complete sentences): Omit the `project_summary` parameter rather than producing a summary that adds no value beyond the raw section text.

### Step 10 — Rebuild personas

Run `node scripts/build-personas.js` to regenerate output files for both updated personas (standalone-archiver and ledger-bootstrapper) across all 3 output targets (vs-code, claude-code, deep-agents).

### Step 11 — Documentation updates

11a. Update `mcp-server/docs/agents/project-manifest/api-surface.md` — add `project_summary` to the `ledger_import_standalone` tool signature and the `ImportStandaloneDetail` interface entry.

11b. Update `mcp-server/docs/agents/project-manifest/data-flows.md` — note that standalone import now supports `project_summary` propagation.

11c. Update `AGENTS.md` cross-system dependencies table — extend the `project_summary` row to mention the Standalone Archiver as a second source (alongside the Bootstrapper).

11d. Sync `CLAUDE.md` from `AGENTS.md` (via `node scripts/cli.js ctx-generate` or manual copy with header).

11e. Update `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — note that outcome-synopsis now supports live-update via `_patchOutcomeSynopsis()`.

11f. Update `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — add the `#outcome-synopsis` DOM contract entry and the `_patchOutcomeSynopsis()` function reference.

## Dependencies
- Steps 1–2 (tool + tests) must complete before Step 3 (persona references the new parameter)
- Step 4 (CLAUDE.md include) is independent
- Steps 5–8 (GUI changes) are independent of each other and of Steps 1–4
- Step 9 (Bootstrapper) is independent
- Step 10 (persona rebuild) depends on Steps 3 and 9
- Step 11 (documentation) depends on all implementation steps

## Required Components
- `mcp-server/src/tools/standalone-import.ts` — schema + handler changes
- `mcp-server/src/storage/ledger-store.ts` — `ImportStandaloneDetail` interface extension + `importStandaloneProject()` root index construction
- `mcp-server/src/tools/help-content.ts` — help text update
- `mcp-server/tests/tools/standalone-import.test.ts` — new tests
- `mcp-server/gui/public/views/project-detail.js` — toggle IIFE, synopsis comment, outcome-synopsis live-update
- `mcp-server/gui/public/views/project-detail-helpers.js` — snapshot + diff extensions
- `mcp-server/gui/public/styles.css` — `font-family: inherit` on toggle button
- `personas/ledger-support/src/content/standalone-archiver.md` — summary crafting step
- `personas/ledger-support/src/content/ledger-bootstrapper.md` — edge-case guard
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/data-flows.md`
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md`
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md`
- `AGENTS.md`
- `CLAUDE.md`

## Assumptions
- `document.fonts.ready` is available in all target browsers (supported since Chrome 35, Firefox 41, Safari 10)
- The `scripts/import-standalone.js` batch import script does not need to craft `project_summary` — this is an agent-only feature for now

## Constraints
- GUI must remain ES5-compatible (no arrow functions, `const`/`let`, template literals)
- `importStandalone()` must remain a pure storage orchestrator — no plan parsing inside the handler
- Persona source files are the only editable artifacts; generated output must be rebuilt, never edited directly

## Out of Scope
- CSS custom property `--synopsis-fade-height` for the gradient height (no current tuning need)
- `.outcome-synopsis` toggle/expand mechanism (no evidence of long outcome summaries)
- Bootstrapper fallback to plan's first paragraph when no `## Summary` exists
- Extending `scripts/import-standalone.js` to craft `project_summary` during batch imports
- Backfilling `project_summary` for existing ~118 standalone-imported projects

## Acceptance Criteria

- AC-01: `ImportStandaloneSchema` accepts an optional `project_summary` string (min 1 char) and rejects empty strings
- AC-02: `importStandalone()` persists `project_summary` in root index and `.meta.json` when provided
- AC-03: `importStandalone()` omits `project_summary` from root index when not provided (backward compatibility)
- AC-04: Standalone Archiver persona reads `plan.md`, crafts a summary, and passes it to `ledger_import_standalone` during import
- AC-05: `CLAUDE.md` contains only the `@AGENTS.md` include directive (no copied content, no header comment)
- AC-06: Toggle IIFE defers height measurement until `document.fonts.ready` resolves
- AC-07: Inline comment documents the synopsis rendering asymmetry above the synopsis IIFE
- AC-08: `.plan-synopsis__toggle` has explicit `font-family: inherit`
- AC-09: Outcome-synopsis block uses a pre-rendered hidden container and appears dynamically via `_patchOutcomeSynopsis()` when synthesis completes during a poll cycle
- AC-10: `_snapshotProjectState()` includes `outcome_summary` and `_diffProjectState()` detects changes to it
- AC-11: Bootstrapper Step 2 instructs agents to omit `project_summary` when `## Summary` is too brief
- AC-12: All existing tests pass; new tests cover AC-01 through AC-03
- AC-13: Persona build (`--check`) confirms no stale output after rebuild
- AC-14: Documentation updates reflect all changes (api-surface, data-flows, ui-components, AGENTS.md, CLAUDE.md)

## Testing Strategy
Automated unit tests for the schema and storage changes (Steps 1–2). Manual browser testing for GUI changes (Steps 5–8). Persona build `--check` for persona changes (Steps 3, 9–10). File content verification for the CLAUDE.md include change (Step 4).

## Test Plan

- `mcp-server/tests/tools/standalone-import.test.ts` — "schema accepts valid project_summary" — AC-01
- `mcp-server/tests/tools/standalone-import.test.ts` — "schema accepts without project_summary" — AC-01
- `mcp-server/tests/tools/standalone-import.test.ts` — "schema rejects empty project_summary" — AC-01
- `mcp-server/tests/tools/standalone-import.test.ts` — "persists project_summary in root index and .meta.json" — AC-02
- `mcp-server/tests/tools/standalone-import.test.ts` — "omits project_summary when not provided" — AC-03
- `mcp-server/tests/gui/project-detail-helpers.test.ts` or equivalent — "snapshot includes outcome_summary" — AC-10
- `mcp-server/tests/gui/project-detail-helpers.test.ts` or equivalent — "diff detects outcome_summary change" — AC-10
- Manual browser test — toggle IIFE fires after font load, not synchronously — AC-06
- Manual browser test — outcome-synopsis appears without refresh when synthesis completes — AC-09
- Verify `CLAUDE.md` contains only `@AGENTS.md` (one line, no other content) — AC-05
- `node scripts/build-personas.js --check` — persona output is fresh — AC-13

## Documentation Updates

Per the `AGENTS.md` Manifest Maintenance Rules:

- `mcp-server/docs/agents/project-manifest/api-surface.md` — `ledger_import_standalone` signature + `ImportStandaloneDetail` interface
- `mcp-server/docs/agents/project-manifest/data-flows.md` — standalone import flow with `project_summary`
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — §12 update for outcome-synopsis live-update
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — `#outcome-synopsis` DOM contract + `_patchOutcomeSynopsis()`
- `AGENTS.md` — cross-system dependencies: extend `project_summary` row with Standalone Archiver source
- `CLAUDE.md` — replace full content with `@AGENTS.md` include directive (one-line change; eliminates future sync requirement)

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | CSS custom property `--synopsis-fade-height` for the 3rem gradient | Synthesis Deferred #2 | No current consumer or tuning need | Reconsider if gradient height needs adjustment across themes |
| 2 | `.outcome-synopsis` toggle/expand mechanism | Synthesis Deferred #5 | No evidence of long `outcome_summary` values | Implement if outcome summaries grow beyond the visible area |
| 3 | Bootstrapper fallback to plan's first paragraph | Synthesis Deferred #9 | Explicitly out-of-scope in original plan; adds parsing complexity | Reconsider if many plans lack `## Summary` sections |
| 4 | Batch import script `project_summary` support | New (this plan) | `scripts/import-standalone.js` would need plan parsing logic; agent workflow is the primary consumer | Implement if batch re-import of existing projects with curated summaries becomes desirable |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **`document.fonts.ready` not supported in older browsers** | All target browsers support it (Chrome 35+, Firefox 41+, Safari 10+). The GUI already requires `marked` and modern CSS features, so this is not a regression. |
| **Poll loop overhead from `outcome_summary` tracking** | Adding one string comparison per poll cycle (5s interval) is negligible. The snapshot already tracks 5 scalar fields. |
| **Standalone Archiver summary quality varies** | The crafting guidelines mirror the Bootstrapper's proven instructions. The fallback guard (omit if too brief) prevents low-quality summaries. |
| **CLAUDE.md drift** | Eliminated structurally by replacing the file with `@AGENTS.md` include — no reactive detection needed. |
