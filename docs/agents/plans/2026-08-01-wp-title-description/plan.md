# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Prior Project Context
The repository's short-term goal is minimal friction and ease of use. The WP data model currently stores only operational metadata (status, AC, pipelines, dependencies) with zero descriptive content. The WP Decomposer and Bootstrapper agents produce rich structured specs with titles and descriptions, but this information is never persisted to the ledger — it exists only in ephemeral filesystem artifacts. The GUI displays raw WP IDs (`WP-001`) with no human-readable context, requiring users to click into each WP and infer purpose from acceptance criteria. This directly contradicts the ease-of-use strategic goal.

## Summary
Add `title` and `description` fields to the Work Package data model so that every WP carries its human-readable identity and full specification content in the ledger. The `title` (a short label like "Implement duration tracking") flows into WP summaries for fast scanning in both the GUI list view and MCP tool output. The `description` (the full WP spec body) is stored in the WP detail file and rendered in the GUI detail view using the existing `marked.js` Markdown parser. Both fields are optional in storage schemas (backward-compatible with 280+ existing WPs) but `title` is required in the `ledger_create_work_package` tool input going forward. The Bootstrapper persona is updated to extract title and description from the WP Decomposer output and pass them to the tool.

## Architectural Context
The WP data model spans three layers:

1. **Storage schemas** (`mcp-server/src/schema/`): `WorkPackageDetailSchema` (16 fields, stored as `WP-###.json`) and `WorkPackageSummarySchema` (7 fields, embedded in `project-ledger.json` root index). Both use Zod validation with `.optional()` for backward-compatible fields.

2. **MCP tools** (`mcp-server/src/tools/work-package.ts`): `ledger_create_work_package` accepts 7 input params and constructs both the detail and summary objects inline. `ledger_get_work_package` returns the raw detail. `ledger_list_work_packages` returns summaries from the root index without reading detail files.

3. **GUI** (`mcp-server/gui/`): The project detail view renders a 4-column WP table (ID, Pipeline Stages, Assigned To, Status). The WP detail view shows `<h1>WP-001</h1>` with no title or description. The `WpOverviewEntry` type enriches summaries with pipeline stage status and AC counts. The GUI already vendors `marked.js` v15 for Markdown rendering throughout the application.

4. **Personas** (`personas/ledger-support/src/content/`): The WP Decomposer produces `work-packages-draft.md` with `## WP-{NUMBER} — {SHORT_TITLE}` headers and structured spec content (Description, Scope, Deliverables, AC, etc.). The Bootstrapper reads this file, calls `ledger_create_work_package` with metadata-only params, then writes the spec content to `work/{WP_ID}.md` filesystem files — but the spec content never enters the ledger.

## Approach / Architecture
Add two fields at each layer:

| Layer | `title` | `description` |
|-------|---------|---------------|
| **Detail schema** | `z.string().optional()` | `z.string().optional()` |
| **Summary schema** | `z.string().optional()` | — (too large for index) |
| **Create tool input** | `z.string()` (required) | `z.string().optional()` |
| **WP detail JSON** | Stored | Stored |
| **Root index summary** | Stored | — |
| **GUI WP table** | New column | — |
| **GUI WP detail** | In `<h1>` alongside WP ID | Rendered as Markdown card |
| **GUI WP overview** | In `WpOverviewEntry` | — |
| **MCP list output** | In summaries | — |
| **MCP detail output** | In response | In response |

The `description` field stores the full WP spec body (everything from "Description:" through "Notes:" in the decomposer output). At ~20–40 lines per WP, this is negligible compared to the pipeline history already stored in WP detail files (often 200+ lines of JSON).

## Rationale
- **Title in summary, description in detail only:** The root index is read frequently for status queries. A short title adds negligible size. The full description (~1–2 KB) would bloat the root index unnecessarily since it's only needed when viewing a specific WP.
- **Full spec as description vs. a generated summary:** Storing the full spec preserves all structured information (scope, deliverables, rationale, rejected approaches) which is valuable for traceability. A summary can be derived from the stored content if needed later. Storing only a summary would lose information that cannot be recovered.
- **Title required in tool input, optional in schema:** Every new WP should have a title — there's no good reason to create one without it. But the schema must remain backward-compatible with existing WPs that lack titles.
- **Markdown rendering via `marked.js`:** Already vendored and used extensively throughout the GUI. No new dependency needed.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| What to store | `title` + `description` (full spec) | Title-only; title + short summary; title + summary + full spec (3 fields) | Full spec preserves all traceability context with negligible storage cost (~1–2 KB). A separate summary field adds complexity without clear benefit — the GUI can truncate the description for list views if ever needed. |
| Description in summary vs. detail | Detail only | Both summary and detail; summary with truncation | Root index is read on every `ledger_get_project_status` call for all WPs. Adding ~1 KB per WP to the root index would measurably increase response size. Title alone is sufficient for scanning. |
| Title required vs. optional in tool | Required | Optional with fallback to WP ID | Every WP should be identifiable. Making it optional perpetuates the current problem. Existing WPs are handled by schema optionality. |
| Backfill existing WPs | No backfill | Script to extract titles from acceptance criteria; script to reconstruct from plan files | Existing WPs are historical — their titles weren't captured. Fabricating them adds risk and complexity for marginal value. The GUI already falls back to WP ID display when title is absent. |

## Pattern Alignment
- **Optional schema fields** — follows `handoff_notes`, `active_pipeline_stages`, `rework_counts` pattern in `mcp-server/src/schema/work-package.ts`
- **Summary vs. detail split** — follows existing pattern where summary has compact fields and detail has the full object (`passed_stages` computed on write, not stored redundantly in both)
- **GUI Markdown rendering** — follows `marked.parse()` pattern used in plan/synthesis/dialogue views in `mcp-server/gui/public/views/project-detail.js` and `mcp-server/gui/public/views/work-package.js`
- **Tool description update** — follows existing pattern of listing REQUIRED params in tool description strings at `mcp-server/src/tools/work-package.ts` (L1602)

## Detailed Steps

### Step 1: Add `title` and `description` to `WorkPackageDetailSchema`

In `mcp-server/src/schema/work-package.ts`, add two optional fields to `WorkPackageDetailSchema`:
- `title: z.string().optional()` — short human-readable label
- `description: z.string().optional()` — full WP specification content (Markdown)

Place them after `work_package_file` and before `status` for logical grouping (identification fields together).

### Step 2: Add `title` to `WorkPackageSummarySchema`

In `mcp-server/src/schema/root-index.ts`, add:
- `title: z.string().optional()` — same short label, for display in list views

Place after `work_package_id` for logical grouping.

### Step 3: Add `title` and `description` to `CreateWorkPackageSchema` and wire into creation logic

In `mcp-server/src/tools/work-package.ts`:

a. Add to `CreateWorkPackageSchema`:
   - `title: z.string()` — required for new WPs
   - `description: z.string().optional()` — optional

b. Set `title` and `description` in the `wpDetail` object construction (L357–376).

c. Set `title` in the `wpSummary` object construction (L385–393).

d. Update the tool registration description (L1602) to include `title` in the REQUIRED params list.

### Step 4: Update `importStandaloneProject` synthetic WP

In `mcp-server/src/storage/ledger-store.ts`, update the synthetic WP-001 created by `importStandaloneProject`:
- Set `title: 'Standalone implementation'` in both the detail and summary objects.
- No `description` — standalone imports have no decomposer output.

### Step 5: Add `title` to `WpOverviewEntry` and populate it

In `mcp-server/gui/api.ts`:

a. Add `title?: string` to the `WpOverviewEntry` interface (L1163–1171).

b. In the overview construction loop (L1248–1261), set `title` from the WP detail's `title` field.

### Step 6: Update GUI WP table in project detail view

In `mcp-server/gui/public/views/project-detail.js`:

a. Keep the 4-column layout unchanged (WP ID, Pipeline Stages, Assigned To, Status). Do **not** add a fifth "Title" column — doing so would compress the pipeline track cell (the most information-dense column) and degrade readability on narrower screens.

b. Instead, render the title as a second line *within* the WP ID cell. When `title` is present in the overview entry, output the ID as a link followed by a `<div>` with muted, smaller text below it:

   ```html
   <td class="monospace">
     <a href="…">WP-001</a>
     <div class="wp-title-label">Implement duration tracking</div>
   </td>
   ```

   When `title` is absent, render the cell exactly as it is today (ID link only, no subtitle element).

c. Add a `.wp-title-label` rule to the stylesheet (`mcp-server/gui/public/style.css`) — `font-size: 12px; color: var(--color-text-muted); font-family: inherit; margin-top: 2px;` (or equivalent using existing CSS custom properties).

d. The WP table row builder (L621–631) uses the overview data which now includes `title`.

### Step 7: Update GUI WP detail view

In `mcp-server/gui/public/views/work-package.js`:

a. Change the header from `<h1>WP-001</h1>` to `<h1>WP-001 — Title</h1>`, falling back to just the WP ID when `title` is absent.

b. Add a "Description" card below the info card when `description` is present. Render the Markdown content using `marked.parse()` (already available globally). Wrap in `escapeHtml`-safe pipeline: use `marked.parse()` directly since the content is agent-generated (same trust model as plan/synthesis rendering).

c. Update the file's dependency header comment to add `marked` to the `Depends on:` list. `marked` is already loaded globally by the time this view runs, but the dependency comment must stay accurate — `project-detail.js` currently declares it, `work-package.js` does not.

### Step 8: Update Bootstrapper persona to pass `title` and `description`

In `personas/ledger-support/src/content/ledger-bootstrapper.md`:

a. Update Step 3 (the `ledger_create_work_package` call pattern) to include `title` and `description` parameters.

b. The `title` comes from the WP Decomposer's `{SHORT_TITLE}` (the header text after `## WP-{NUMBER} — `).

c. The `description` is the full WP spec body from the decomposer output — everything from "Plan Context:" through "Code Observations:" (or the last populated section), excluding the `## WP-{NUMBER} — {TITLE}` header line and the Acceptance Criteria section (which is already stored separately as `acceptance_criteria`).

d. Since the description now carries the specification content, Step 4 (creating `work/{WP_ID}.md` filesystem files) can be simplified: the spec files become optional supplementary artifacts rather than the sole carrier of WP context. However, the bootstrapper should continue creating them for backward compatibility with orchestrator dialogue file naming conventions that reference `work_package_file`.

### Step 9: Update project manifest documentation

In `mcp-server/docs/agents/project-manifest/api-surface.md`:

a. Update the `ledger_create_work_package` tool signature to include `title` (required) and `description` (optional).

b. Update the `WorkPackageDetailSchema` field list to include both new fields.

c. Update the `WorkPackageSummarySchema` field list to include `title`.

d. Update the `WpOverviewEntry` interface to include `title?: string`.

### Step 10: Add tests

In `mcp-server/tests/`:

a. Add a test verifying `ledger_create_work_package` stores `title` in both detail and summary, and `description` in detail only.

b. Add a test verifying `ledger_create_work_package` rejects calls without `title` (Zod validation).

c. Add a test verifying existing WPs without `title`/`description` parse successfully through the updated schema (backward compatibility).

d. Add a test verifying `importStandaloneProject` sets `title` on the synthetic WP.

e. Add a test verifying `handleGetWorkPackageOverview` includes `title` in each entry when the WP detail carries one.

f. Add a test for the WP table row rendering in `project-detail.js`: assert that when overview data includes a `title`, the rendered WP ID cell contains a `.wp-title-label` element with that title text; assert that when `title` is absent the element is not present. Follow the `jsdom` + `vm.runInThisContext` pattern established in `project-detail-*.test.ts`.

g. Add a test for the WP detail page header in `work-package.js`: assert the `<h1>` renders `WP-001 — Title` when `title` is present and `WP-001` alone when absent. Add to or extend `tests/gui/client-rendering.test.ts`.

h. Add a test for the description card rendering in `work-package.js`: assert a description card is present in the rendered HTML when `description` is provided and absent when omitted. Add to or extend `tests/gui/client-rendering.test.ts`.

## Dependencies
- None — all changes are internal to the MCP server and persona system.

## Required Components
- `mcp-server/src/schema/work-package.ts` — detail schema
- `mcp-server/src/schema/root-index.ts` — summary schema
- `mcp-server/src/tools/work-package.ts` — create tool + registration
- `mcp-server/src/storage/ledger-store.ts` — standalone import
- `mcp-server/gui/api.ts` — overview type + handler
- `mcp-server/gui/public/views/project-detail.js` — WP table (subtitle in WP ID cell)
- `mcp-server/gui/public/views/work-package.js` — WP detail page
- `mcp-server/gui/public/style.css` — `.wp-title-label` rule
- `personas/ledger-support/src/content/ledger-bootstrapper.md` — bootstrapper persona
- `mcp-server/docs/agents/project-manifest/api-surface.md` — API documentation

## Assumptions
- The WP description content is agent-generated Markdown and follows the same trust model as plan and synthesis documents (rendered via `marked.parse()` without additional sanitization, consistent with existing GUI patterns).
- Existing WPs without title/description fields will display with WP ID fallback in the GUI — no backfill is planned.
- The WP Decomposer output format (`## WP-{NUMBER} — {SHORT_TITLE}`) is stable and can be relied upon for title extraction.

## Constraints
- Both new schema fields MUST be `.optional()` for backward compatibility with 280+ existing WPs.
- The `title` field in `CreateWorkPackageSchema` MUST be required (not optional) to ensure all new WPs are identifiable.
- The `description` MUST NOT be added to `WorkPackageSummarySchema` — the root index is read on every status query and must remain compact.
- No new npm dependencies — `marked.js` is already vendored.

## Out of Scope
- Backfilling title/description for existing historical WPs.
- Adding a `summary` field (auto-generated from description) — can be added later if needed.
- Changing the WP Decomposer output format.
- Full-text search over WP descriptions.
- Rendering description in the MCP tool responses (they already return the raw JSON which will include the field).

## Acceptance Criteria

- AC-01: `WorkPackageDetailSchema` includes optional `title` (string) and `description` (string) fields.
- AC-02: `WorkPackageSummarySchema` includes an optional `title` (string) field.
- AC-03: `ledger_create_work_package` accepts a required `title` parameter and an optional `description` parameter, storing both in the WP detail and `title` in the root index summary.
- AC-04: Calling `ledger_create_work_package` without `title` fails Zod validation.
- AC-05: Existing WPs without `title`/`description` parse successfully through the updated schemas (backward compatibility).
- AC-06: `importStandaloneProject` sets `title: 'Standalone implementation'` on the synthetic WP-001 (both detail and summary).
- AC-07: The GUI WP overview endpoint (`/api/projects/:repo/:slug/work-packages/overview`) includes `title` in each entry.
- AC-08: The GUI project detail WP table displays a "Title" column showing the WP title (or `—` fallback).
- AC-09: The GUI WP detail page header shows `WP-001 — Title` (falling back to WP ID alone when no title).
- AC-10: The GUI WP detail page renders the `description` as a Markdown card below the info card when present.
- AC-11: The Bootstrapper persona instructions include `title` and `description` in the `ledger_create_work_package` call pattern.
- AC-12: `mcp-server/docs/agents/project-manifest/api-surface.md` documents the new `title` and `description` parameters and schema fields.
- AC-13: All new code paths have test coverage.

## Testing Strategy
Unit tests verify schema validation (new fields accepted, backward compatibility, required enforcement). Integration tests verify the create tool stores fields correctly and the standalone import sets defaults. GUI API tests verify the overview endpoint surfaces the title. Frontend view tests (using the project's established `jsdom` + `vm.runInThisContext` pattern) verify the WP table title column, the WP detail header fallback, and the description card rendering.

## Test Plan
- `mcp-server/tests/tools/work-package.test.ts` — "creates WP with title and description, stores title in summary" — asserts both detail and root index contain expected values — AC-03
- `mcp-server/tests/tools/work-package.test.ts` — "rejects create without title" — asserts Zod validation error — AC-04
- `mcp-server/tests/schema/work-package.test.ts` (or inline in existing test file) — "parses existing WP without title/description" — asserts backward compat — AC-05
- `mcp-server/tests/tools/standalone-import.test.ts` (or inline in existing test file) — "standalone import sets title on synthetic WP" — AC-06
- `mcp-server/tests/gui/api-wp-overview.test.ts` — "WP overview includes title from WP detail" — AC-07
- `mcp-server/tests/gui/project-detail-wp-table.test.ts` (new) or extend existing `project-detail-*.test.ts` — "WP table row includes title cell" and "WP table row falls back to '—' when title absent" — AC-08
- `mcp-server/tests/gui/client-rendering.test.ts` (extend) — "WP detail header shows WP-ID — title when title present" and "WP detail header shows WP-ID alone when title absent" — AC-09
- `mcp-server/tests/gui/client-rendering.test.ts` (extend) — "WP detail renders description card via marked.parse when description present" and "WP detail omits description card when absent" — AC-10

## Documentation Updates
- `mcp-server/docs/agents/project-manifest/api-surface.md` — add `title` and `description` to `ledger_create_work_package` params, `WorkPackageDetailSchema` fields, `WorkPackageSummarySchema` fields, and `WpOverviewEntry` interface
- `mcp-server/docs/agents/project-manifest/constraints.md` — add a note that `title` is a required parameter on `ledger_create_work_package` for all new WPs (backward-compat handled by schema optionality)
- `personas/ledger-support/src/content/ledger-bootstrapper.md` — update WP creation protocol
- Root `AGENTS.md` — no update needed (cross-system dependencies table doesn't reference WP content fields)

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Large descriptions bloat WP detail files** | WP specs are ~20–40 lines (~1–2 KB). Typical WP detail files with pipeline history are already 5–20 KB. Negligible impact. |
| **Existing tool callers break if they don't pass `title`** | Only the Bootstrapper persona calls `ledger_create_work_package`. The persona update (Step 8) and tool schema change (Step 3) ship together. The orchestrator invokes the persona, not the tool directly. |
| **XSS via Markdown rendering of description** | Description follows the same trust model as plan/synthesis content — agent-generated, rendered via `marked.parse()` without additional sanitization. This is consistent with existing GUI patterns (plan rendering, dialogue rendering). |
| **Schema migration for existing WPs** | No migration needed. Both fields are `.optional()` in the schema. Zod `.parse()` passes existing WPs unchanged — unknown fields would be stripped, but no existing WPs have these fields. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** Changes span multiple layers (schema, tools, storage, GUI API, GUI frontend, personas, docs) across distinct concerns — benefits from formal QA and code review stages.
