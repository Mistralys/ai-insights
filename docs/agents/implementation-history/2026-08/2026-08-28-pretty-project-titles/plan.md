# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Prior Project Context
The `meta.title` field was introduced to support manual GUI renames. The user currently corrects ~35% of all project titles manually — primarily for acronym capitalization (gui→GUI, api→API) and rework separator formatting ("Feature Rework 1" → "Feature - Rework 1"). This plan eliminates that friction by having the registering agent craft a curated title at project creation time, following the same pattern already established for `project_summary`.

## Summary
Add an optional `title` parameter to `ledger_initialize_project` and `ledger_import_standalone`, then update the Ledger Bootstrapper and Standalone Archiver personas to craft a curated display title from the plan's name/slug before calling these tools. The agent — which already reads the plan document — applies natural-language understanding to produce titles like "GUI API Enhancements - Rework 1" that no regex could reliably generate. This mirrors the established `project_summary` pattern exactly: tool parameter, persona instruction, shared partial for the crafting guide.

## Architectural Context
Project titles flow through three layers:

1. **Storage:** `.meta.json` has an optional `title` field. When set, it takes precedence over all derived names in the GUI.
2. **GUI API:** `handleListProjects` and `handleGetProject` both contain identical inline slug-to-title derivation logic that strips the date prefix and title-cases each word. This produces "Gui Enhancements" instead of "GUI Enhancements".
3. **MCP tools:** `ledger_initialize_project` and `ledger_import_standalone` create projects but never set a title — leaving it to the GUI's runtime derivation or manual correction.
4. **Personas:** The Ledger Bootstrapper (`personas/ledger-support/src/content/ledger-bootstrapper.md`) and Standalone Archiver (`personas/ledger-support/src/content/standalone-archiver.md`) both already craft a `project_summary` from the plan's `## Summary` section before calling their respective tools. The title crafting follows this exact same pattern.

The `LedgerStore` class exposes `updateTitle(title)` for persisting titles to `.meta.json`, and `writeProjectMeta` preserves any existing `title` via `...(existing.title !== undefined ? { title: existing.title } : {})`. New projects have no existing title, so passing it through the initialization flow sets it cleanly.

## Approach / Architecture

1. **MCP server:** Add an optional `title` parameter to `InitializeProjectSchema` and `ImportStandaloneSchema`. Thread it through to `.meta.json` storage — for init via the existing enrichment `writeProjectMeta` call, for standalone import via the `ImportStandaloneDetail` interface into `importStandaloneProject()`.
2. **Personas:** Add a title-crafting step to the Ledger Bootstrapper (alongside the existing `project_summary` step) and the Standalone Archiver. Create a shared partial `title-crafting-guide.md` with formatting rules, consumed by both personas via `{{> title-crafting-guide}}`.
3. **Persona rebuild:** Run `node scripts/build-personas.js` to regenerate the output files.

No new utility functions, no acronym lists, no regex transformations — the LLM agent handles all formatting intelligence naturally.

## Rationale
- **Agent-curated over automated:** The agent already reads the plan and understands its context. It can produce titles like "API: Split GetTenants" or "Cross-Platform Agent Plugin - Phase 3B" that no pattern matcher could generate. The user's manually corrected titles show patterns (colons, ampersands, creative grouping) that require contextual judgment.
- **Mirrors `project_summary` exactly:** Same tool parameter shape (`z.string().min(1).optional()`), same persona instruction placement (before the tool call), same shared partial pattern, same skip guards ("omit if ambiguous"). This reduces cognitive load — agents and developers see a familiar pattern.
- **No acronym list to maintain:** A curated acronym set would need constant extension as new projects use new terms. The LLM inherently knows which words are acronyms.
- **Handles novel formats:** The nexus ledger shows formats like `"API: CreateComtype"`, `"Strato Layout Template - 1 - Serializers"` — creative structures that emerge from the plan context, not the slug alone.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Title generation | Agent-curated (LLM crafts title from slug + plan context) | Automated `prettifyTitle()` function with acronym list + regex | Agent handles novel formats, acronyms, and creative structures without maintenance; automated function is deterministic but limited to known patterns and requires an ever-growing acronym list |
| Where to pass title | Tool parameter (like `project_summary`) | Separate `store.updateTitle()` call after init | Passing as a parameter keeps it atomic with the init call and follows the established `project_summary` pattern; a separate call adds a race window and extra I/O |
| Formatting guidance | Shared Markdown partial (`title-crafting-guide.md`) | Inline rules in each persona | Partial ensures consistency between Bootstrapper and Archiver, mirrors the `summary-crafting-guide.md` precedent |

## Pattern Alignment
- **`project_summary` parameter pattern** — follows the exact same flow: optional `z.string().min(1)` tool parameter → persona instruction to craft before calling → shared partial with formatting rules → skip guard when source material is missing. Established in the `project_summary` field plan.
- **Shared partial for cross-persona rules** — follows the `summary-crafting-guide.md` precedent in `personas/shared/partials/`.
- **`writeProjectMeta` cache updates** — threads `title` through the existing enrichment cache mechanism rather than adding a separate `updateTitle()` call.
- **Cross-system dependency documentation** — follows the `project_summary` entry pattern in root `AGENTS.md`.

## Detailed Steps

### Step 1 — Add `title` parameter to `InitializeProjectSchema`

In `mcp-server/src/tools/project-lifecycle.ts`:

Add a `title` field to `InitializeProjectSchema` following the `project_summary` pattern:
```typescript
title: z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe('Optional curated display title for the project. When provided, stored in .meta.json and used as the project name in the GUI and MCP tool responses. Craft from the plan folder name with proper capitalization, acronym handling, and formatting.'),
```

In `initializeProject()`, thread `args.title` into the enrichment `writeProjectMeta` call. The `writeProjectMeta` method needs a small extension to accept `title` in its `cacheUpdates` (see Step 3).

### Step 2 — Add `title` parameter to `ImportStandaloneSchema`

In `mcp-server/src/tools/standalone-import.ts`:

Add a `title` field to `ImportStandaloneSchema` (same shape as Step 1).

Thread `args.title` into the `ImportStandaloneDetail` passed to `store.importStandaloneProject()`.

### Step 3 — Extend `MetaCacheUpdates` and `ImportStandaloneDetail` with `title`

In `mcp-server/src/storage/ledger-store.ts`:

1. Add `title?: string` to the `MetaCacheUpdates` interface.
2. Add `title?: string` to the `ImportStandaloneDetail` interface.
3. In `writeProjectMeta()`, add a `cacheUpdates` handler for `title` following the existing pattern:
   ```typescript
   ...(cacheUpdates !== undefined && 'title' in cacheUpdates ? { title: cacheUpdates.title } : {}),
   ```
   This line goes after the existing `...(existing.title !== undefined ? { title: existing.title } : {})` preservation line, so a `cacheUpdates.title` overrides the existing value.
4. In `importStandaloneProject()`, after `writeRootIndex(rootIndex)` (which auto-syncs `.meta.json`), call `this.updateTitle(detail.title)` if `detail.title` is defined. This runs inside the existing `withLock` scope.

**Consistency note:** `initializeProject` writes `title` via `MetaCacheUpdates` (through `writeProjectMeta`), while `importStandaloneProject` writes it via `updateTitle()`. Both correctly persist to `.meta.json`. The `updateTitle()` path is used here because standalone import already calls `writeRootIndex` (which auto-syncs `.meta.json`) before any `writeProjectMeta`-style enrichment, so a direct `updateTitle()` is the cleanest integration point. Add a comment to `MetaCacheUpdates.title` noting that standalone import uses `updateTitle()` directly.

### Step 4 — Thread `title` through `initializeProject`

In `mcp-server/src/tools/project-lifecycle.ts`, in the enrichment `writeProjectMeta` call (~L679):

Add `title` to the cache updates object:
```typescript
await store.writeProjectMeta(args.plan_file, 'READY', {
  total_work_packages: 0,
  pending_work_packages: 0,
  project_name: projectName,
  repository_name: repositoryName,
  ...runnerInfo,
  ...(args.project_summary !== undefined ? { project_summary: args.project_summary } : {}),
  ...(args.title !== undefined ? { title: args.title } : {}),
});
```

**Note:** This `writeProjectMeta` call is inside the non-fatal enrichment try/catch block (~L672–693). If the enrichment block throws, `title` (like all other enrichment cache fields) is silently discarded and the GUI falls back to slug-derived title-casing. This is acceptable given the field's optional nature.

### Step 5 — Thread `title` through standalone import

In `mcp-server/src/tools/standalone-import.ts`, in the `store.importStandaloneProject()` call (~L250):

Add `title` to the detail object:
```typescript
archiveResult = await store.importStandaloneProject({
  planFile: PLAN_ARCHIVE_FILENAME,
  synthesisFile: SYNTHESIS_ARCHIVE_FILENAME,
  dateCreated,
  outcomeSummary,
  pipelineSummary: ...,
  ...(args.project_summary !== undefined ? { projectSummary: args.project_summary } : {}),
  ...(args.title !== undefined ? { title: args.title } : {}),
});
```

### Step 6 — Create `title-crafting-guide.md` shared partial

Create `personas/shared/partials/title-crafting-guide.md`:

```markdown
- **Short and scannable** — typically 2–6 words; avoid restating the full plan summary
- **Proper capitalization** — capitalize acronyms (API, GUI, MCP, CLI, WP, QA, UUID, etc.) and use title case for regular words
- **Rework/phase separator** — if the plan folder name ends with `-rework-N` or `-phase-N`, format as ` - Rework N` or ` - Phase N` (with a hyphen separator before the suffix)
- **Derived from the slug** — use the plan folder name (after stripping the `YYYY-MM-DD-` date prefix) as the base, then apply the formatting rules above
- **Plain text only** — no Markdown formatting, no backticks, no colons unless they genuinely clarify the title
```

### Step 7 — Update Ledger Bootstrapper persona

In `personas/ledger-support/src/content/ledger-bootstrapper.md`, in Step 2 (Initialize the Project):

After the `project_summary` crafting paragraph and before the `Call ledger_initialize_project with:` block, add a title-crafting paragraph:

```markdown
Also craft a `title` for the project: a short, human-readable display name derived from the plan folder name. The title must be:

{{> title-crafting-guide}}

> **Example:** For a plan folder `2026-08-04-gui-api-enhancements-rework-1`, craft the title `"GUI API Enhancements - Rework 1"`.
```

Update the `Call ledger_initialize_project with:` parameter list to include:
```markdown
- `title`: the display title you crafted above
```

### Step 8 — Update Standalone Archiver persona

In `personas/ledger-support/src/content/standalone-archiver.md`, in the Import Mode workflow Step 1:

After the `project_summary` crafting paragraph and before the `Call ledger_import_standalone with:` block, add the same title-crafting paragraph (using the same `{{> title-crafting-guide}}` partial).

Update the tool call parameter list to include `title`.

### Step 9 — Update help content

In `mcp-server/src/tools/help-content.ts`:

1. Update the `ledger_initialize_project` help entry to mention the optional `title` parameter in the parameters list.
2. Update the `ledger_import_standalone` help entry's Optional Parameters section to document the `title` parameter alongside `project_summary`, matching the style already used there.

### Step 10 — Rebuild personas

Run `node scripts/build-personas.js` to regenerate all persona output files with the new title-crafting instructions.

### Step 11 — Write tests

In `mcp-server/tests/`:

1. **Unit test for `initializeProject` with title:** Call `initializeProject` with a `title` parameter and verify the resulting `.meta.json` contains the title.
2. **Unit test for standalone import with title:** Call `importStandalone` with a `title` parameter and verify the resulting `.meta.json` contains the title.
3. **Unit test for title omission:** Call both tools without `title` and verify `.meta.json` has no `title` field (backward compatibility).
4. **GUI test:** Verify that a project with `meta.title` set returns that title as `project_name` in `handleListProjects` (existing test already covers this — verify it still passes).

## Dependencies
- No new npm dependencies required.
- The `@mistralys/persona-builder` package (already a dev dependency) handles the shared partial resolution.

## Required Components
- `mcp-server/src/tools/project-lifecycle.ts` — modification (add `title` to schema + thread through)
- `mcp-server/src/tools/standalone-import.ts` — modification (add `title` to schema + thread through)
- `mcp-server/src/storage/ledger-store.ts` — modification (extend `MetaCacheUpdates` + `ImportStandaloneDetail` + `writeProjectMeta` + `importStandaloneProject`)
- `mcp-server/src/tools/help-content.ts` — modification (document `title` parameter)
- `personas/shared/partials/title-crafting-guide.md` — new file
- `personas/ledger-support/src/content/ledger-bootstrapper.md` — modification (add title crafting step)
- `personas/ledger-support/src/content/standalone-archiver.md` — modification (add title crafting step)
- Generated persona output files — rebuilt via `node scripts/build-personas.js`
- `mcp-server/tests/` — new test cases for title parameter flow

## Assumptions
- The LLM agent can reliably produce properly formatted titles from slug-derived folder names. This is a trivial text-formatting task well within the capability of any model used in the persona workflow.
- The `title` parameter follows the same optionality semantics as `project_summary` — when omitted, the GUI falls back to slug-derived title-casing (existing behavior, unchanged).
- The agent can always derive a reasonable title from the slug, even without reading plan content. The slug is the primary source — the plan heading is a potential secondary source but not required.

## Constraints
- The `title` field must remain optional to preserve backward compatibility with existing tools and scripts that call `ledger_initialize_project` without it.
- The title must not be fabricated from thin air — it is derived from the plan folder name (slug), which the agent always has access to.
- The `max(200)` length constraint matches the existing `RenameBodySchema` validation in the GUI's PATCH endpoint.

## Out of Scope
- Retroactively setting titles on existing projects (the user can use the GUI rename feature).
- Automated `prettifyTitle()` utility function — the agent handles all formatting intelligence.
- Changing the slug format or plan folder naming convention.
- Prettifying WP titles (those come from the plan's WP Decomposer output and are already human-written).
- Refactoring the GUI's duplicated slug-to-title fallback logic — it remains as the fallback for projects created without a title.

## Acceptance Criteria

- AC-01: `ledger_initialize_project` accepts an optional `title` parameter (`z.string().min(1).max(200).optional()`) and stores it in `.meta.json`.
- AC-02: `ledger_import_standalone` accepts the same optional `title` parameter and stores it in `.meta.json`.
- AC-03: When `title` is provided, it appears as the `project_name` in `handleListProjects` and `handleGetProject` responses (since `meta.title` has highest precedence in the title chain).
- AC-04: When `title` is omitted, behavior is identical to current behavior (slug-derived fallback).
- AC-05: The Ledger Bootstrapper persona instructions include a title-crafting step that runs before calling `ledger_initialize_project`.
- AC-06: The Standalone Archiver persona instructions include a title-crafting step that runs before calling `ledger_import_standalone`.
- AC-07: A shared partial `title-crafting-guide.md` exists and is consumed by both personas.
- AC-08: Manually set titles (via GUI rename) continue to take precedence.
- AC-09: All new code paths have test coverage.
- AC-10: All existing MCP server tests continue to pass.

## Testing Strategy
Integration tests verify that the `title` parameter flows through each tool into `.meta.json`. Backward-compatibility tests verify that omitting `title` produces no change in behavior. The GUI test suite's existing title-precedence tests confirm `meta.title` still overrides slug-derived names.

## Test Plan

- `mcp-server/tests/tools/project-lifecycle.test.ts` (or equivalent) — new test: `initializeProject` with `title` parameter stores it in `.meta.json` — covers AC-01
- `mcp-server/tests/tools/standalone-import.test.ts` (or equivalent) — new test: `importStandalone` with `title` parameter stores it in `.meta.json` — covers AC-02
- `mcp-server/tests/tools/project-lifecycle.test.ts` — new test: `initializeProject` without `title` produces `.meta.json` with no `title` field — covers AC-04
- `mcp-server/tests/tools/standalone-import.test.ts` — new test: `importStandalone` without `title` produces `.meta.json` with no `title` field — covers AC-04
- `mcp-server/tests/gui/api.test.ts` — existing test: verify `meta.title` still takes precedence as `project_name` in list response — covers AC-03, AC-08
- `node scripts/build-personas.js --check` — verify persona output is fresh after rebuild — covers AC-05, AC-06, AC-07

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — add `title` to the `InitializeProjectSchema` and `ImportStandaloneSchema` parameter tables; add `title?: string` to the `ImportStandaloneDetail` interface block
- `personas/docs/agents/project-manifest/api-surface.md` — add `title-crafting-guide.md` to the shared partials table
- Root `AGENTS.md` — add `title` field cross-system dependency entry (following the `project_summary` pattern), listing the tool parameters, storage paths, persona sources, and GUI consumption points

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Refactor GUI duplicated slug-to-title logic | Research brief | Once agents set titles at creation time, the inline slug-to-title code in `handleListProjects`/`handleGetProject` becomes a rarely-hit fallback for legacy projects — not worth a separate refactoring effort now | Could be addressed as part of a broader GUI code-quality sweep |
| 2 | Automated `prettifyTitle()` as secondary fallback | Initial plan draft | Agent-curated titles are strictly superior; an automated fallback adds code with diminishing returns | Reconsider if title-less projects become common (unlikely once personas are updated) |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Agent produces poor-quality titles** | The title-crafting guide provides clear formatting rules; the slug provides an unambiguous base; the task is trivially simple for any LLM. Users can always correct via GUI rename. |
| **Existing projects remain untitled** | No regression — they continue using the slug-derived fallback exactly as before. Users can rename via GUI. |
| **Persona rebuild forgotten** | The `--check` flag in `node scripts/build-personas.js --check` and the pre-commit hook detect stale persona output. |
| **Title parameter ignored by older personas** | The parameter is optional — omitting it is safe. Older persona versions simply don't pass it, and behavior is unchanged. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Changes span the MCP server (tool parameters + storage) and persona templates (instructions + partial), but both sides are straightforward additions following established patterns. A single developer session is sufficient.
