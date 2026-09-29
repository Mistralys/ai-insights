# Synthesis

## Synthesis

### Completion Status
- Date: 2026-09-28
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Research brief: none found

### Outcome Summary

Both `ledger_import_standalone` and `ledger_update_synthesis` now accept an optional
`outcome_summary` parameter, so the calling agent supplies a curated summary instead of the
server parsing one out of a named section of `synthesis.md`. A supplied value is stored
verbatim and wins over the document; `parseOutcomeSummary()` remains the fallback, untouched,
which keeps every existing caller — including the agent-less batch importer — working exactly
as before. `ledger_update_synthesis` additionally falls back to the summary already stored, so a
refresh can set or replace a summary but can no longer clear one it cannot parse.

### Implementation Summary
- Added `outcome_summary` (`z.string().trim().min(10).optional()`) to `ImportStandaloneSchema`
  and `UpdateSynthesisSchema` in `mcp-server/src/tools/standalone-import.ts`, matching the
  validation floor `ledger_complete_synthesis` already applies to the same stored field.
- `importStandalone()` resolves `args.outcome_summary ?? parseOutcomeSummary(synthesisContent)`.
  The resolved value flows unchanged into `importStandaloneProject()`, the `pipelineSummary`
  derivation, and the response payload.
- `updateSynthesis()` resolves the first two terms before the lock and the third
  (`?? rootIndex.outcome_summary ?? null`) inside it, where the root index is available. A
  supplied or parsed value always wins over the stored one — the stored value is a last resort,
  never a veto.
- `synthesis.md` is still read and re-archived on every update call regardless of how the
  summary was resolved, so the archived copy stays in step with the plan folder.
- `UpdateSynthesisSchema` is now reachable from tests via the existing `_internal` export.
- Bumped the MCP server to v2.11.0 and re-synced `mcp-server/package.json` via
  `npm run sync-version`, which the pre-commit version check requires.

### Documentation Updates
- `mcp-server/src/tools/help-content.ts` — documented the parameter for both tools and replaced
  the line claiming the summary is extracted from the document unconditionally with the
  parameter-first resolution order, including the update tool's stored-value fallback.
- `mcp-server/src/tools/standalone-import.ts` — both `registerTool()` descriptions, which also
  claimed unconditional extraction. Not named in the plan, but they are the first copy an agent
  reads and acceptance criterion 5 covers them.
- `mcp-server/src/utils/synthesis-parser.ts` — the `parseOutcomeSummary()` doc comment now states
  it is the fallback path and that its return value is not necessarily what reaches the ledger.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — the new parameter on both tool
  signatures, the rewritten outcome-summary resolution paragraphs, and the response-shape comments.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Flow 17a and 17b now show the
  resolution chain, including where the third term is evaluated and why.
- Root `AGENTS.md` and `CLAUDE.md` — added an `outcome_summary` field row to the Cross-System
  Dependencies table, modelled on the `project_summary` row. Both files were updated because
  `CLAUDE.md` is generated from `AGENTS.md` but is Git-tracked and read directly by agents.
- `mcp-server/changelog.md` — a v2.11.0 entry in house style.

### Verification Summary
- Tests run: `npm test` in `mcp-server/` (full Vitest suite, all files passing, including the new
  `outcome_summary` coverage in `tests/tools/standalone-import.test.ts` and the pre-existing
  `tests/utils/synthesis-parser.test.ts` unmodified); `npm test` at the workspace root
  (`scripts/tests/`).
- Static analysis run: `npx tsc --noEmit` in `mcp-server/` (exit 0); `node scripts/check-version-sync.js`;
  `node scripts/validate-workflow-manifest.js`.
- Result: PASS. One caveat worth recording: an early root-workspace run reported two failing test
  files, and every subsequent run passed with all files green. The failures were not reproducible
  and the root suite covers `scripts/` only — no file this plan touched. The most likely cause is
  contention with the parallel Persona Curator session writing under `personas/` while the script
  tests read it.

### Code Insights

#### Implementation Decisions
- [high] (decision) `docs/agents/plans/2026-09-28-outcome-summary-parameter/plan.md`: `plan.md` was
  edited after this session read it, gaining a third fallback for `ledger_update_synthesis`, a new
  acceptance criterion 2a, two further test cases, and a reworded backward-compatibility
  constraint. The drift was caught only because an unrelated repo-wide grep surfaced a plan line
  number that did not match the copy in context. The revised plan was re-read and implemented in
  full; `plan.md` itself was not modified.
- [medium] (decision) `AGENTS.md` / `CLAUDE.md` (workspace root): The plan named only `CLAUDE.md`
  for the Cross-System Dependencies row, but `CLAUDE.md` carries a banner marking it as generated
  from `AGENTS.md`. Editing it alone would have been overwritten on the next CTX run, so the row
  went into both.
- [low] (decision) `mcp-server/src/tools/standalone-import.ts`: `UpdateSynthesisSchema` was exposed
  through the existing `_internal` export rather than made a public `export const` like
  `ImportStandaloneSchema`. Its only new consumer is the validation test, and the code-style
  constraint *Test-Only Exports Must Use the `_internal` Naming Convention* puts it there.
- [low] (decision) `mcp-server/src/tools/standalone-import.ts`: The two `registerTool()` description
  strings were updated alongside `help-content.ts`, since they still claimed unconditional
  extraction and acceptance criterion 5 forbids any remaining such claim.

#### Follow-Up Items
- [high] (debt) `mcp-server/package.json` (pretest hook): `pretest` runs
  `node ../scripts/build-personas.js` plus `--check`, so the standard verification command for this
  module **writes** into `personas/` — it regenerated `personas/name-mapping.json` during this
  session, while a parallel Persona Curator session owned that directory and the plan forbade
  touching it. The regenerated content derives entirely from the Curator's own source edits, so no
  work was lost. Suggested follow-up: make `pretest` run `build-personas.js --check` only and leave
  the writing build to `build-maintain`.
- [medium] (code-smell) `mcp-server/src/tools/standalone-import.ts`: `importStandalone()` and
  `updateSynthesis()` repeat the same resolve-path → stat plan folder → read `synthesis.md` →
  build error-response sequence, with only the `Import failed:` / `Update failed:` prefix differing.
  A shared helper returning either the file content or a prefixed error response would remove the
  duplication. Deliberately left alone here — the plan records it as Rejected in its Structural
  Improvements table.
- [medium] (debt) `AGENTS.md` / `CLAUDE.md` (workspace root): `CLAUDE.md` is generated from
  `AGENTS.md` but is Git-tracked and hand-editable, with nothing that fails when the two drift.
  Suggested follow-up: add a `--check` staleness comparison for this pair alongside the existing
  persona and CTX pre-commit warnings, or make `CLAUDE.md` an include rather than a copy.
- [medium] (improvement) `mcp-server/src/tools/standalone-import.ts`: `updateSynthesis()` now
  resolves the summary in two places — `suppliedOrParsedSummary` before the lock, the stored-value
  fallback inside it — because the root index is only available under the lock. The split is
  correct but easy to misread as a leftover. If the read-modify-write ever moves behind a
  `store.updateRootIndexWithSync()`-style helper, collapse the chain into one expression at the
  assignment site.
- [low] (debt) `mcp-server/src/tools/help-content.ts`: In the `ledger_get_repository_context` help
  text, both the `outcome_summary` table row and the Usage Notes bullet state the field is set by
  the Synthesis agent via `ledger_complete_synthesis`. The standalone tools write the same field.
  The attribution predates this change and was left alone as out of scope. Suggested follow-up:
  name all three writing tools in both places.
- [low] (convention) `mcp-server/tests/tools/standalone-import.test.ts`:
  `WorkPackage.pipelines[].summary` is a `string[]`, not a string — the singular field name reads
  as scalar and cost a failed assertion on first run. Suggested follow-up: rename it to
  `summary_lines`, or document the array shape in the schema JSDoc, so callers do not have to read
  the storage layer to find out.

### Additional Comments
- Nothing under `personas/` was edited by hand. The one persona-adjacent file that changed,
  `personas/name-mapping.json`, was rewritten by the `mcp-server` `pretest` build hook from the
  Persona Curator's in-flight source edits — see the high-priority follow-up item above.
- No Git write operations were performed.
