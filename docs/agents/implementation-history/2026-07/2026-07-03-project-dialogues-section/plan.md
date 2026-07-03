# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context
The `2026-07-03-pm-dialogue-capture` project recently enabled dialogue capture for PM and Synthesis stages by removing the `_wp_id` truthy guard in the orchestrator. These new dialogues produce chunk files with a `project-` prefix (e.g. `project-pm-r0.jsonl`, `project-synthesis-r0.jsonl`) instead of the traditional `WP-001-` prefix. The GUI currently only shows dialogues on the WP detail page, which cannot display project-level dialogues since they have no associated WP ID.

## Summary
Add a "Dialogues" section to the project detail page, placed below the Orchestrator Runs section. This section fetches all dialogues and chunks for the project (unfiltered by WP ID) and renders them in a summary table. Each row shows the source (WP ID or "Project"), stage, revision, and a button to expand the dialogue content inline. The backend parse regexes must be updated to handle the new `project-{stage}-r{N}` filename convention alongside the existing `{WP_ID}-{stage}-r{N}` convention.

## Architectural Context
The GUI is a vanilla-JS SPA served by the MCP server's built-in HTTP server (`mcp-server/gui/server.ts`). The project detail page is assembled from several sub-modules:
- [project-detail-helpers.js](mcp-server/gui/public/views/project-detail-helpers.js) — shared pure helpers (STAGE_ABBREV, buildPipelineTrack, etc.)
- [project-detail-orch.js](mcp-server/gui/public/views/project-detail-orch.js) — orchestrator toolbar + runs list
- [project-detail-modal.js](mcp-server/gui/public/views/project-detail-modal.js) — Reset Project modal
- [project-detail.js](mcp-server/gui/public/views/project-detail.js) — main orchestration of the project detail view

Dialogues/chunks are listed via `GET /api/projects/:repo/:slug/dialogues` and `GET /api/projects/:repo/:slug/chunks`, with individual content via `/dialogues/:filename` and `/chunks/:filename/rendered`. The API already supports omitting the `?wp=` filter to return all entries.

The parse regexes in [api.ts](mcp-server/gui/api.ts) (lines ~1351-1354 and ~1488-1489) currently only match `WP-\d+` prefixes:
- `DIALOGUE_PARSE_RE = /^(WP-\d+)-(.+)-r\d+\.md$/`
- `CHUNK_PARSE_RE = /^(WP-\d+)-(.+)-r\d+\.jsonl$/`

The WP detail page dialogue rendering is in [work-package.js](mcp-server/gui/public/views/work-package.js) (lines ~155-280) and groups entries by stage with expandable content buttons.

## Approach / Architecture
1. **Backend**: Update the parse regexes to handle both `WP-\d+` and `project` prefixes, producing structured entries with a `wp_id` of `"project"` for PM/Synthesis dialogues.
2. **Frontend**: Add a new sub-module `project-detail-dialogues.js` following the existing decomposition pattern (like `project-detail-orch.js`). This module exports a `renderDialoguesSection()` function called asynchronously from `renderProjectDetail()` after the DOM is set.
3. **HTML structure**: A `<div id="project-dialogues-section">` placeholder is added to the project detail innerHTML, below the Orchestrator Runs wrapper. The section renders a table with columns: Source (WP ID or "Project"), Stage, Revision(s), and expandable content buttons.
4. The WP detail page dialogue section remains unchanged — it continues to show WP-filtered dialogues.

## Rationale
- A dedicated sub-module (`project-detail-dialogues.js`) keeps the already-large `project-detail.js` from growing further, following the decomposition pattern established by `project-detail-orch.js` and `project-detail-modal.js`.
- Using a table provides a compact overview that works well for both WP-level and project-level dialogues, making it easy to scan which stages have been captured.
- Chunks take priority over Markdown dialogue files (same strategy as the WP detail page), ensuring the newest streaming capture format is preferred.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Placement of Dialogues section | Below Orchestrator Runs, same page level | Separate tab/route; inside Orchestrator Runs section | Same-page placement is consistent with the existing flat layout. A separate route would hide content behind a click. Nesting inside Orchestrator Runs conflates orchestrator process management with dialogue content. |
| Parse regex update approach | Single regex with alternation `(WP-\d+\|project)` | Separate regex + fallback; parsing in the frontend | A single regex is simpler and keeps the parse logic in one place on the server side. Frontend parsing would duplicate logic. |
| New sub-module vs inline | New `project-detail-dialogues.js` file | Inline in project-detail.js | project-detail.js is already ~1000+ lines; a sub-module matches the existing decomposition pattern. |

## Pattern Alignment
- Follows the sub-module decomposition pattern of `project-detail-orch.js` and `project-detail-modal.js` (separate JS file loaded before `project-detail.js` in `index.html`).
- Follows the async post-DOM rendering pattern used by the orchestrator runs section (placeholder div → async data fetch → innerHTML update).
- Follows the chunk-priority-over-markdown strategy established in `work-package.js` (lines ~159-174).
- Reuses existing CSS classes for dialogue buttons (`.dialogue-btn`, `.dialogue-btn-latest`, `.dialogue-btn-active`, `.dialogue-content`, `.dialogue-markdown`) from `styles.css`.

## Detailed Steps

### Step 1: Update parse regexes in `api.ts`
Update `DIALOGUE_PARSE_RE` and `CHUNK_PARSE_RE` to match both `WP-\d+` and `project` prefixes:
```
DIALOGUE_PARSE_RE = /^(WP-\d+|project)-(.+)-r(\d+)\.md$/
CHUNK_PARSE_RE    = /^(WP-\d+|project)-(.+)-r(\d+)\.jsonl$/
```
Also update the `DialogueEntry` and `ChunkEntry` interfaces to include a `revision` field (capture group 3), which will be useful for the table display.

### Step 2: Update `handleListChunks` and `handleListDialogues` wpId filter
Currently, the wpId filter uses `WP_ID_RE = /^WP-\d+$/` to validate the filter value. When `wpId` is `"project"`, it gets rejected as invalid. Add `"project"` as a valid wpId filter value alongside the existing `WP-\d+` pattern. The filter prefix logic (`f.startsWith(prefix)`) already works for any string value.

### Step 3: Create `project-detail-dialogues.js`
Create a new sub-module at `mcp-server/gui/public/views/project-detail-dialogues.js` that exports `renderDialoguesSection(sectionEl, repo, slug)`. This function:
1. Fetches all chunks and all dialogues (no wpId filter) in parallel.
2. Merges them, preferring chunks when both exist (same strategy as WP detail page).
3. Renders a table with columns: **Source** (WP ID badge or "Project" label), **Stage**, **Dialogue** (expandable revision buttons).
4. Each revision button fetches and displays the dialogue content inline when clicked (reusing the expand/collapse pattern from work-package.js).
5. Groups entries by source + stage for a clean overview.

### Step 4: Add placeholder div and async call in `project-detail.js`
In the `renderProjectDetail()` function's innerHTML template, add a `<div id="project-dialogues-section">` placeholder after the `#orchestrator-runs-wrapper` div. After the DOM is set, call `renderDialoguesSection()` asynchronously.

### Step 5: Register the new script in `index.html`
Add a `<script>` tag for `project-detail-dialogues.js` in `index.html`, placed after `project-detail-orch.js` and before `project-detail.js` (matching the sub-module loading order convention).

### Step 6: Add CSS for the dialogues table
Add minimal CSS in `styles.css` for the dialogues overview table. Reuse existing dialogue CSS classes where possible. Add a `.dialogue-source-badge` class for the Source column badges (styled like `.badge` but smaller).

### Step 7: Update tests
- Update `dialogue-qa.test.ts` or create a new test file to verify:
  - The parse regexes correctly handle `project-` prefix filenames.
  - The Dialogues section renders on the project detail page.
  - Project-level dialogues (PM, Synthesis) show with "Project" as the source.
  - WP-level dialogues show with the WP ID as the source.
  - Chunk files take priority over Markdown files when both exist.
  - Empty state is shown when no dialogues exist.

## Dependencies
- Depends on the PM dialogue capture feature (`2026-07-03-pm-dialogue-capture`) being complete (it is).
- No external dependencies.

## Required Components
- `mcp-server/gui/api.ts` — update parse regexes and wpId filter validation
- `mcp-server/gui/public/views/project-detail-dialogues.js` — **new file**: dialogues section renderer
- `mcp-server/gui/public/views/project-detail.js` — add placeholder div and async call
- `mcp-server/gui/public/index.html` — register new script
- `mcp-server/gui/public/styles.css` — add dialogues table CSS
- `mcp-server/tests/gui/dialogue-qa.test.ts` — extend with project-level dialogue tests
- `mcp-server/tests/gui/api-dialogue-parse.test.ts` — **new file**: test parse regex changes

## Assumptions
- PM/Synthesis chunk files follow the `project-{stage}-r{N}.jsonl` naming convention exactly as implemented in `2026-07-03-pm-dialogue-capture`.
- The existing Markdown dialogue files for PM/Synthesis (if they exist) would follow the same `project-{stage}-r{N}.md` convention.
- The WP detail page dialogue section will not be removed — it continues to provide WP-specific filtering.

## Constraints
- The existing WP detail page dialogue display must not break.
- Backward compatibility with the `WP-\d+` prefix convention must be maintained.
- No new npm dependencies.

## Out of Scope
- Removing or refactoring the WP-level dialogue display in work-package.js.
- Adding dialogue content search or filtering beyond source/stage grouping.
- Polling/auto-refresh of the dialogues section (static load on page render).
- Modifying the orchestrator's chunk writer behavior.

## Acceptance Criteria
- The project detail page shows a "Dialogues" section below the Orchestrator Runs section.
- The section displays a table listing all dialogues/chunks for the project.
- Each row shows the source (WP ID or "Project"), stage name, and revision button(s).
- Clicking a revision button expands the dialogue content inline (rendered as Markdown).
- Project-level dialogues (PM, Synthesis) are correctly parsed and displayed with "Project" as the source.
- WP-level dialogues continue to display correctly in both the new project-level section and the existing WP detail page.
- The parse regexes handle both `WP-\d+` and `project` prefixes.
- The `?wp=project` filter works correctly in the API.
- An empty state message is shown when no dialogues exist.
- All existing dialogue-qa tests continue to pass.

## Testing Strategy
Test at two levels: unit tests for the parse regex changes in `api.ts`, and jsdom-based integration tests for the new project detail dialogues section rendering.

## Test Plan
- `mcp-server/tests/gui/api-dialogue-parse.test.ts` — **new file**: Tests that `parseDialogueFilename` and `parseChunkFilename` correctly parse `project-pm-r0.md`, `project-synthesis-r0.jsonl`, and continue to parse `WP-001-developer-r0.md` correctly. Tests that `handleListChunks`/`handleListDialogues` accept `wpId="project"` as a valid filter. — Covers: parse regex and filter acceptance criteria.
- `mcp-server/tests/gui/project-detail-dialogues.test.ts` — **new file**: jsdom tests for the `renderDialoguesSection()` function. Tests: renders table with project-level entries; renders table with WP-level entries; prefers chunks over markdown; shows empty state when no dialogues; clicking a revision button expands content; clicking same button collapses content. — Covers: UI rendering and interaction acceptance criteria.
- Existing `mcp-server/tests/gui/dialogue-qa.test.ts` — must continue to pass without changes (regression guard).

## Documentation Updates
- `mcp-server/docs/agents/project-manifest/file-tree.md` — add entry for `project-detail-dialogues.js`
- `mcp-server/docs/agents/project-manifest/api-surface.md` — update `DialogueEntry`/`ChunkEntry` interface docs to note `revision` field and `project` prefix support

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Parse regex change breaks existing WP-level dialogue parsing** | The updated regex uses alternation `(WP-\d+\|project)` — the `WP-\d+` branch is identical to the existing pattern. Existing tests in `dialogue-qa.test.ts` provide regression coverage. |
| **Large number of dialogues makes the table unwieldy** | Group by source + stage and show only revision buttons (not content) by default. Content is loaded on demand per button click. |
| **Script loading order issues** | Place `project-detail-dialogues.js` after `project-detail-orch.js` and before `project-detail.js` in `index.html`, matching the established sub-module loading convention documented in `project-detail.js` header comment. |
