
# Plan

## Plan Audit Cycles
- Audits: 1 (revised) — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Prior Project Context
The parent project `2026-08-01-wp-title-description` added `title` and `description` fields to the Work Package data model. It completed cleanly (4/4 WPs, 16/16 pipeline stages, 0 rework). This rework plan addresses the 5 deferred/out-of-scope items and 2 strategic items identified in its synthesis, plus 1 documentation gap discovered during research that was not in the synthesis (`RootIndex` missing 4 fields in `api-surface.md`).

## Summary
Close all deferred, out-of-scope, and strategic follow-up items from the `2026-08-01-wp-title-description` synthesis. Changes span schema validation hardening, test coverage improvement, GUI CSS decoupling, title truncation UX, documentation audit of `api-surface.md` type interfaces, and trust boundary documentation for markdown rendering.

## Architectural Context
The MCP server uses Zod schemas at two layers: **tool schemas** (input validation at the MCP SDK boundary, module-private in `src/tools/`) and **storage schemas** (data shape enforcement at the persistence layer, exported from `src/schema/`). The GUI frontend is ES5-compatible vanilla JavaScript served as static files from `gui/public/`. Documentation lives in `docs/agents/project-manifest/` with `.context/` snapshots regenerated via CTX.

Key files:
- `mcp-server/src/tools/work-package.ts` — tool handlers + `CreateWorkPackageSchema`
- `mcp-server/src/schema/work-package.ts` — `WorkPackageDetailSchema` (storage)
- `mcp-server/src/schema/root-index.ts` — `WorkPackageSummarySchema`, `RootIndexSchema` (storage)
- `mcp-server/gui/public/styles.css` — all GUI styles
- `mcp-server/gui/public/views/work-package.js` — WP detail view
- `mcp-server/gui/public/views/project-detail.js` — project detail view (WP table)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — type interface documentation
- `mcp-server/docs/agents/project-manifest/constraints.md` — Gotcha 10b

## Approach / Architecture
Six independent changes, each self-contained:

1. **Schema hardening** — Add `.min(1)` to `title` in `CreateWorkPackageSchema` so empty strings are rejected at the tool boundary. Update Gotcha 10b to reflect the new behavior.
2. **Test improvement** — Replace the `MinimalCreateSchema` replica test with a direct integration test that calls `createWorkPackage` with an empty-string title through the full handler, verifying the live schema rejects it.
3. **CSS decoupling** — Introduce a `.rendered-markdown` utility class that duplicates the `.dialogue-markdown` rules, then switch `work-package.js` to use `.rendered-markdown`. This keeps dialogue-specific styling isolated.
4. **Doc audit** — Add missing fields to `WorkPackageSummary` and `RootIndex` in `api-surface.md`.
5. **Title truncation** — Add `text-overflow: ellipsis` + `max-width` to `.wp-title-label` and emit a `title` attribute on the `<div>` for native browser tooltip on hover.
6. **Trust boundary doc** — Add a Gotcha entry in `constraints.md` documenting the `marked.parse()` trust model for rendered markdown content.

## Rationale
All items are small, well-understood fixes flagged by the synthesis. Addressing them in one batch avoids the overhead of separate planning cycles for each micro-change. The CSS decoupling uses `.rendered-markdown` (generic utility) rather than `.wp-description-markdown` (scoped) because the same pattern may be reused for other non-dialogue markdown renders in the GUI.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| CSS class name | `.rendered-markdown` (generic utility) | `.wp-description-markdown` (scoped to WP view) | Generic name avoids creating a new scoped class for each future non-dialogue markdown render; if dialogue styling diverges later, only `.dialogue-markdown` needs changes |
| Empty title rejection | `.min(1)` on Zod schema | Runtime check in `createWorkPackage` handler body | Schema-level validation is the established pattern; runtime checks duplicate what Zod already provides and miss SDK-layer error formatting |
| Test approach | Integration test through handler | Export `CreateWorkPackageSchema` for direct test access | Integration test validates the actual code path without breaking the module-private convention for tool schemas |
| Title truncation | CSS `text-overflow` + `title` attr | JavaScript-based truncation with character limit | CSS approach is zero-JS, progressive (full text visible on resize), and the `title` attribute provides native tooltip without custom UI code |

## Pattern Alignment
- `.min(1)` guard follows the `project_summary` field pattern in `InitializeProjectSchema` — `mcp-server/src/tools/project-lifecycle.ts`.
- Integration test through handler follows the pattern established in `mcp-server/tests/tools/work-package.test.ts` for other validation tests (e.g., "rejects empty string in acceptance_criteria" at L1493).
- `.rendered-markdown` as a utility class follows the existing pattern of shared CSS utilities in `styles.css` (e.g., `.monospace`, `.text-muted`).
- Documentation audit follows the manifest maintenance rules in `AGENTS.md`: "Modify public method signature → `api-surface.md`".

## Detailed Steps

### Step 1: Add `.min(1)` to `CreateWorkPackageSchema.title`

In `mcp-server/src/tools/work-package.ts`, change the `title` field definition from:
```typescript
title: z.string().describe('...')
```
to:
```typescript
title: z.string().min(1).describe('...')
```

This ensures empty-string titles are rejected at the Zod validation layer before the handler executes.

### Step 2: Update Gotcha 10b in `constraints.md`

In `mcp-server/docs/agents/project-manifest/constraints.md`, update the blockquote under Gotcha 10b. Replace the "Empty-string note" paragraph to reflect that `.min(1)` is now enforced and empty strings are rejected at the tool boundary.

### Step 3: Update schema replica test to cover empty-string rejection

In `mcp-server/tests/tools/work-package.test.ts`, update the "rejects missing title via Zod validation" test (L3390–L3412) and add a companion test in the same block.

**Why schema replica, not handler call:** `CreateWorkPackageSchema` Zod validation fires at the MCP SDK layer before the handler is invoked. `createWorkPackage()` does not re-run the schema internally — calling the handler with `title: ''` or `title: undefined` bypasses the `.min(1)` guard entirely and would not produce an error response. The schema-replica pattern (matching the test comment "Zod validation fires at the MCP SDK layer, not inside createWorkPackage()") is the correct approach.

**Test A — "rejects missing title (schema replica)"**: Keep the `MinimalCreateSchema` replica but add `.min(1)` to the `title` field (matching the change in Step 1). Rename the test to "rejects missing title (schema replica)". Parse a payload with `title` omitted and assert `success === false` with a `title` path in the error.

**Test B — "rejects empty-string title (schema replica)"**: Add a second test in the same describe block using the same `MinimalCreateSchema`. Parse a payload with `title: ''` and assert `success === false` with a `title` path in the error. This validates the new `.min(1)` guard.

### Step 4: Introduce `.rendered-markdown` CSS class

In `mcp-server/gui/public/styles.css`, add a `.rendered-markdown` class immediately after the `.dialogue-markdown` block (after L2454). Duplicate all `.dialogue-markdown` rules under the new class name:
- `> p, > ul, > ol, > h1, > h2, > h3` max-width constraint
- `h1, h2, h3` margin and font-weight
- `pre` styling
- `code` styling
- `pre code` reset

### Step 5: Switch WP description to `.rendered-markdown`

In `mcp-server/gui/public/views/work-package.js`:
- L157: Change `'<div class="dialogue-markdown">'` to `'<div class="rendered-markdown">'`
- L292: Change `'<div class="dialogue-markdown">'` to `'<div class="rendered-markdown">'`

### Step 6: Add title truncation to `.wp-title-label`

In `mcp-server/gui/public/styles.css`, add overflow handling to `.wp-title-label` (L2198–L2203):
```css
.wp-title-label {
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: inherit;
  margin-top: 2px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

In `mcp-server/gui/public/views/project-detail.js` (L627), add a `title` attribute to the `<div>` for native tooltip:
```javascript
'<div class="wp-title-label" title="' + escapeHtml(overviewEntry.title) + '">'
```

### Step 7: Audit `WorkPackageSummary` in `api-surface.md`

Add the missing `passed_stages` field to the `WorkPackageSummary` interface in `mcp-server/docs/agents/project-manifest/api-surface.md`:
```typescript
interface WorkPackageSummary {
  work_package_id: string;
  title?: string;
  status: WorkPackageStatus;
  assigned_to: string | null;
  dependencies: string[];
  file: string;
  active_pipeline_stages?: string[] | null;
  passed_stages?: number;  // Count of completed pipeline stages; computed at write time
}
```

### Step 8: Audit `RootIndex` in `api-surface.md`

Add the missing fields to the `RootIndex` interface in `mcp-server/docs/agents/project-manifest/api-surface.md`:
```typescript
server_version?: string;      // Semantic version of the MCP server that last wrote this ledger
runner?: 'vscode' | 'claude-code' | 'orchestrator' | 'standalone' | 'unknown';
runner_client?: string;       // Raw clientInfo.name from the MCP connection
runner_version?: string;      // Raw clientInfo.version from the MCP connection
```

### Step 9: Add trust boundary Gotcha

In `mcp-server/docs/agents/project-manifest/constraints.md`, add a new Gotcha entry (number sequentially after the current last):

> **Gotcha N: Markdown Rendering Uses `marked.parse()` Without HTML Sanitization**
>
> All markdown rendering in the GUI (`work-package.js`, `project-detail-dialogues.js`, plan/synthesis views) passes content through `marked.parse()` without DOMPurify or equivalent HTML sanitization. This is acceptable because all rendered content is server-authored (generated by MCP tools from agent pipelines). If the system ever accepts markdown content from untrusted sources (user-submitted descriptions, external imports), a sanitization step must be added before rendering.

### Step 10: Regenerate `.context/` snapshots

After all documentation edits are complete, run `node scripts/cli.js ctx-generate` from the workspace root to update `.context/mcp-server/manifest-api-surface.md` and `.context/mcp-server/manifest-constraints.md`.

## Dependencies
- Steps 1–3 are related (schema change → gotcha update → test update) but can be implemented independently.
- Steps 4–5 are sequential (CSS class must exist before JS can reference it).
- Steps 6–9 are independent of each other and of steps 1–5.
- Step 10 depends on steps 7, 8, and 9 being complete.

## Required Components
- `mcp-server/src/tools/work-package.ts` — schema modification
- `mcp-server/tests/tools/work-package.test.ts` — test replacement
- `mcp-server/gui/public/styles.css` — new CSS class + title truncation
- `mcp-server/gui/public/views/work-package.js` — class name swap
- `mcp-server/gui/public/views/project-detail.js` — tooltip attribute
- `mcp-server/docs/agents/project-manifest/api-surface.md` — field additions
- `mcp-server/docs/agents/project-manifest/constraints.md` — gotcha updates

## Assumptions
- The current last Gotcha number in `constraints.md` is known at implementation time; the new entry is numbered sequentially.
- `marked` library is always available in the GUI runtime (loaded in the HTML shell).

## Constraints
- Storage schemas (`WorkPackageDetailSchema`, `WorkPackageSummarySchema`) must NOT add `.min(1)` to `title` — backward compatibility with 280+ existing WPs requires the field to remain optional.
- `.dialogue-markdown` CSS rules must NOT be removed or modified — they remain in use by `project-detail-dialogues.js`.
- The `.rendered-markdown` class must produce identical visual output to `.dialogue-markdown` at the time of this change.
- All `api-surface.md` edits must match the live Zod schemas exactly.

## Out of Scope
- No max-length constraint on `description` field — intentional design (spec body container). UI-level truncation for description is not addressed.
- No changes to the Bootstrapper persona — it was already updated in the parent project.
- No changes to dialogue-specific styling or the dialogue views.
- `mcp-server/docs/agents/workflow-specification/data-model.md` — The §3.1 `Project` and §3.2 `WorkPackageSummary` blocks are stale (missing `server_version`, `runner`, `runner_client`, `runner_version`, `passed_stages`), but updating the workflow spec data model is deferred; `api-surface.md` (Steps 7–8) is the authoritative documentation target for this plan.

## Acceptance Criteria

- AC-01: `CreateWorkPackageSchema` rejects empty-string `title` (`""`) at the Zod validation layer.
- AC-02: `CreateWorkPackageSchema` continues to reject missing `title` (omitted field).
- AC-03: Gotcha 10b in `constraints.md` reflects that empty-string titles are now rejected.
- AC-04: The "rejects missing title (schema replica)" test uses a `MinimalCreateSchema` replica with `.min(1)` on `title`.
- AC-05: A new test verifies empty-string title (`""`) rejection via the same schema-replica approach.
- AC-06: WP description card in `work-package.js` uses `.rendered-markdown` class instead of `.dialogue-markdown`.
- AC-07: `.rendered-markdown` CSS class exists in `styles.css` with identical rules to `.dialogue-markdown`.
- AC-08: `.dialogue-markdown` rules remain unchanged and in use by dialogue views.
- AC-09: `WorkPackageSummary` in `api-surface.md` includes `passed_stages?: number`.
- AC-10: `RootIndex` in `api-surface.md` includes `server_version`, `runner`, `runner_client`, `runner_version`.
- AC-11: `.wp-title-label` has CSS truncation with `text-overflow: ellipsis`.
- AC-12: WP title `<div>` in project detail table has a `title` attribute for tooltip.
- AC-13: A new Gotcha documents the `marked.parse()` trust boundary.
- AC-14: `.context/` snapshots are regenerated after documentation edits.
- AC-15: All existing tests pass (`tsc --noEmit` clean, full test suite green).
- AC-16: `.rendered-markdown` is added to the Utility Classes table (Section 14) in `mcp-server/gui/docs/agents/project-manifest/ui-components.md`.

## Testing Strategy
Test the schema hardening via the schema-replica pattern (`CreateWorkPackageSchema` Zod validation fires at the MCP SDK layer, not inside the handler). CSS and UX changes are verified visually (no automated visual testing in this codebase). Documentation changes are validated by diffing `api-surface.md` interfaces against live Zod schemas.

## Test Plan

- `mcp-server/tests/tools/work-package.test.ts` — **Update** "rejects missing title via Zod validation" test (L3390–L3412): rename to "rejects missing title (schema replica)", add `.min(1)` to the `MinimalCreateSchema` `title` field — covers AC-02, AC-04.
- `mcp-server/tests/tools/work-package.test.ts` — **Add** "rejects empty-string title (schema replica)" test in the same block: parse `{...validPayload, title: ''}` via `MinimalCreateSchema` and assert `success === false` with `title` in the error path — covers AC-01, AC-05.
- Existing test suite must remain green — covers AC-15.

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/constraints.md` — Update Gotcha 10b blockquote (AC-03); add new Gotcha for markdown trust boundary (AC-13).
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `passed_stages` to `WorkPackageSummary` (AC-09); add 4 fields to `RootIndex` (AC-10).
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — Add `.rendered-markdown` to the Utility Classes table (Section 14) alongside `.monospace` and `.text-muted` (AC-16).
- `.context/` — Regenerate via `node scripts/cli.js ctx-generate` (AC-14).

## Deferred Items

_None — all items from the parent synthesis are addressed in this plan._

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`.min(1)` breaks existing agent callers that pass empty title** | All current callers (Bootstrapper) extract titles from WP Decomposer headers which are always non-empty. The change makes an implicit assumption explicit. |
| **`.rendered-markdown` diverges from `.dialogue-markdown` over time** | Both classes serve the same visual purpose (readable markdown). If dialogue-specific styles are added later, they go only on `.dialogue-markdown`, which is the entire point of the decoupling. |
| **Title truncation `max-width: 260px` is too narrow/wide** | 260px accommodates ~35–40 characters at 12px, which covers most WP titles. The `title` tooltip ensures no information is lost. Can be adjusted later without code changes. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** All changes are within `mcp-server/`, follow well-understood patterns, and require no cross-module coordination — a single developer session with self-review is sufficient.
