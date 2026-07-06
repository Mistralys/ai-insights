## Synthesis

### Completion Status
- Date: 2026-07-03
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-07-03

### Outcome Summary

A "Dialogues" section has been added to the project detail page, appearing below the Orchestrator Runs section. The backend parse regexes were updated to accept both the existing `WP-\d+` prefix and the new `project-` prefix (with a `revision` field added to both `DialogueEntry` and `ChunkEntry`), and `"project"` is now accepted as a valid `wpId` filter value. A new `project-detail-dialogues.js` sub-module renders an overview table grouping all project dialogues by source and stage with expandable inline revision buttons.

### Implementation Summary

- **`mcp-server/gui/api.ts`**: Updated `WP_ID_RE` to `/^(WP-\d+|project)$/`, updated `DIALOGUE_PARSE_RE` and `CHUNK_PARSE_RE` to match the `project-` prefix and capture the revision number, added `revision: number` field to `DialogueEntry` and `ChunkEntry` interfaces and their parse functions.
- **`mcp-server/gui/public/views/project-detail-dialogues.js`** (new): `renderDialoguesSection(sectionEl, repo, slug)` — fetches all chunks/dialogues (no WP filter), uses chunks when present (same priority strategy as WP page), groups entries by `source:stage`, renders an overview table with Source/Stage/Dialogue columns and expandable revision buttons with inline content loading.
- **`mcp-server/gui/public/views/project-detail.js`**: Added `<div id="project-dialogues-section">` placeholder after the `orchestrator-runs-wrapper` div; calls `renderDialoguesSection()` asynchronously after the DOM is set.
- **`mcp-server/gui/public/index.html`**: Registered `project-detail-dialogues.js?v=1` between `project-detail-modal.js` and `project-detail.js`.
- **`mcp-server/gui/public/styles.css`**: Added `.dialogues-table-wrapper`, `.dialogues-overview-table`, `.dialogue-source-badge`, and `.dialogue-source-badge.dialogue-source-project` CSS with light/dark mode support.
- **`mcp-server/tests/gui/api.test.ts`**: Updated all `toEqual` assertions for `handleListDialogues` and `handleListChunks` to include `revision: 0` matching the new interface field.
- **`mcp-server/tests/gui/api-dialogue-parse.test.ts`** (new): Integration tests for the updated regexes — `project-` prefix parsing, `WP-\d+` regression, `wpId="project"` filter acceptance, invalid filter rejection, and mixed entry sorting.
- **`mcp-server/tests/gui/project-detail-dialogues.test.ts`** (new): jsdom tests for `renderDialoguesSection()` — empty state, project-level source badges, WP-level entries, chunk priority, expand/collapse interaction, error state, table structure, and grouping.
- **`mcp-server/docs/agents/project-manifest/api-surface.md`**: Updated `DialogueEntry` and `ChunkEntry` interface docs to document the `revision` field and `project` prefix support; updated `handleListDialogues`/`handleListChunks` filter docs to list accepted values.
- **`mcp-server/docs/agents/project-manifest/file-tree.md`**: Added entries for `project-detail-dialogues.js`, `api-dialogue-parse.test.ts`, and `project-detail-dialogues.test.ts`.

### Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Updated `DialogueEntry`, `ChunkEntry`, `handleListDialogues`, and `handleListChunks` documentation to reflect the `revision` field and `project` wpId support.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Added new file entries for `project-detail-dialogues.js` (GUI public views) and the two new test files.

### Verification Summary

- Tests run: `tests/gui/api-dialogue-parse.test.ts` (14 tests), `tests/gui/project-detail-dialogues.test.ts` (12 tests), `tests/gui/dialogue-qa.test.ts` (31 tests), `tests/gui/api.test.ts` (172 tests)
- Static analysis run: `tsc --noEmit` (no errors)
- Result: All 229 tests in the tested files PASS. TypeScript compiles cleanly.

### Code Insights

- [low] (convention) `mcp-server/gui/public/views/project-detail.js`: The inline HTML template string (~610 lines) for `renderProjectDetail()` continues to grow. The placeholder addition is minimal and follows the established pattern, but future additions may benefit from a template extraction approach similar to what `project-detail-orch.js` uses for its toolbar.
- [low] (improvement) `mcp-server/gui/public/views/project-detail-dialogues.js`: The `renderDialoguesSection()` function is currently called once on page load with no refresh mechanism. If the orchestrator completes PM/Synthesis stages during a session, the Dialogues section would not auto-update without a page reload. Adding a refresh hook (similar to how the Orchestrator Runs section refreshes) could improve UX for active runs — but this is out of scope per the plan's "no polling" constraint.
- [low] (debt) `mcp-server/tests/gui/api.test.ts`: The `handleListDialogues` and `handleListChunks` test fixtures use hard-coded `{ filename: '...', wp_id: '...', stage: '...', revision: 0 }` patterns that will drift if the interface grows further. A shared fixture factory (like the `makeProject` pattern used in `project-detail-*.test.ts`) would reduce maintenance overhead.

### Additional Comments

- The `color-mix()` CSS function used in `.dialogue-source-badge.dialogue-source-project` requires modern browser support (Chrome 111+, Firefox 113+, Safari 16.2+). This is consistent with other `color-mix()` usage in `styles.css` and matches the project's existing browser baseline.
- Existing tests in `api.test.ts` that used `toEqual` with `DialogueEntry`/`ChunkEntry` objects were updated to include the new `revision` field. No tests were deleted.
