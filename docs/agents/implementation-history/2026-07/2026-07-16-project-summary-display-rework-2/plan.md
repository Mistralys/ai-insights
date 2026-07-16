# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.6.0
- Architectural Reviews: none — Plan Architect Reviewer v2.1.0

## Summary

This rework plan addresses actionable items from the `2026-07-16-project-summary-display-rework-1` synthesis. It covers two areas: (1) fixing a config-vs-documentation drift in the CTX generation system — adding the missing `agents.md` document definition to `context.yaml`, correcting the AGENTS.md Generated Context Docs table (adding two undocumented GUI source documents and aligning the table with actual output), then regenerating `.context/`; and (2) extracting the near-verbatim summary-crafting guidelines from `ledger-bootstrapper.md` and `standalone-archiver.md` into a shared partial at `personas/shared/partials/summary-crafting-guide.md`, then replacing the duplicated inline text with `{{> summary-crafting-guide}}` includes.

## Architectural Context

The CTX Generator (`context.yaml` + per-module `module-context.yaml` files) produces Markdown snapshots of the codebase into `.context/`. The root config defines 5 documents; module configs add ~29 more. The AGENTS.md "Generated Context Docs" table documents these for agent navigation. Currently the table lists a `agents.md` document that has no config and doesn't exist, and omits two MCP server GUI documents that do exist.

The persona build system uses `@mistralys/persona-builder` with shared partials auto-discovered from `personas/shared/partials/` (configured via `sharedPartialsDir` in `persona-build.config.js`). Partials are included in content files via `{{> partial-name}}` syntax. The `ledger-support` suite has no suite-specific partials directory — it relies entirely on shared partials.

## Approach / Architecture

**CTX fix:** Add a document definition for `agents.md` to `context.yaml` sourcing `AGENTS.md`, update the AGENTS.md table to reflect reality (add missing rows, keep existing row now that the config will exist), then run `node scripts/cli.js ctx-generate`.

**Shared partial:** Create `summary-crafting-guide.md` containing only the three quality bullets. Each persona content file keeps its own intro sentence (including "The summary must be:"), example blockquote, skip guards, and tool-call section — only the shared bullet items are extracted. The `@mistralys/persona-builder` engine performs raw regex substitution with no indentation propagation (`resolvePartials` in `partials.ts`), so the partial content must work at column 0 in both files.

## Rationale

- The CTX table drift has persisted since the table was first written — fixing it now prevents agents from looking for a non-existent file and ensures the table is a reliable navigation aid.
- The summary-crafting guidelines are already flagged in two separate synthesis pipelines (WP-005 and WP-006 of the prior project). Extracting now prevents drift when the guidelines inevitably evolve (e.g., changing the "two complete sentences" threshold).

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Partial scope | Extract only the three quality bullets; keep intro sentence, "The summary must be:", skip guards, and examples per-persona | (a) Extract everything including "The summary must be:" and skip guards into a single partial; (b) Create two thin wrapper partials for different indentation contexts | Option (a) separates "The summary must be:" from the intro sentence, producing a visible paragraph break in the rendered output. Option (b) defeats the DRY purpose. The engine's lack of indentation propagation means a single partial works byte-identically only at column 0 (bootstrapper); for the archiver (column 3 context), the cosmetic indentation change is acceptable since agent behaviour is unaffected. |
| `.context/agents.md` fix | Add document definition to `context.yaml` | Remove the row from AGENTS.md table | The document is useful for agents ingesting the full workspace context — adding it is more valuable than removing the reference. |

## Pattern Alignment

- Shared partial extraction follows the established pattern in `personas/shared/partials/` (20 existing partials, all kebab-case `.md` files) — `personas/shared/partials/synthesis-knowledge-collection.md`.
- CTX document definition follows the consistent `type: text` header + `type: file` body pattern — `context.yaml` L13–L93.
- AGENTS.md table maintenance follows the Manifest Maintenance Rules in `AGENTS.md` ("Restructure workspace → regenerate `.context/`").

## Detailed Steps

### Step 1 — Add `agents.md` document definition to `context.yaml`

Add a new document definition to the `documents:` array in `context.yaml` (after the existing `shared-manifest.md` entry). Source: root `AGENTS.md`. Output: `agents.md`.

```yaml
  - description: 'AI Insights - Agent Operating System'
    outputPath: agents.md
    sources:
      - type: text
        content: |
          # AI Insights - Agent Operating System
          Root AGENTS.md: workspace architecture, manifest maintenance rules, efficiency rules, failure protocol, cross-system dependencies, cross-platform policy, and changelog convention.
      - type: file
        description: "Root AGENTS.md (agent operating system for the workspace)"
        sourcePaths:
          - AGENTS.md
```

### Step 2 — Update AGENTS.md Generated Context Docs table

In the `AGENTS.md` "Generated Context Docs" table, make two corrections:

1. **Add missing MCP server GUI rows.** After the `| .context/mcp-server/file-structure.md |` row, add:
   ```
   | `.context/mcp-server/source-gui-api-handlers.md` | MCP server GUI: API handler source |
   | `.context/mcp-server/source-gui-frontend.md` | MCP server GUI: frontend source |
   ```

2. **Verify the existing `.context/agents.md` row** — it should already be present with description "Root `AGENTS.md` content". No change needed since Step 1 adds the config that makes it real.

### Step 3 — Regenerate `.context/`

Run `node scripts/cli.js ctx-generate` from the workspace root. Verify:
- `.context/agents.md` now exists and contains the AGENTS.md content
- `.context/generated-at.txt` is updated
- All other documents regenerate without errors

### Step 4 — Create shared partial `summary-crafting-guide.md`

Create `personas/shared/partials/summary-crafting-guide.md` with the shared summary-crafting guidelines. Content:

```markdown
- **Factual and concise** — describe what the project does and why, not how it is implemented
- **Plain text only** — no Markdown formatting (no bold, bullets, backticks, or headers)
- **Focused on intent** — avoid implementation details, tool names, and technical specifics unless essential to understanding the project's purpose
```

The partial contains only the three quality bullets — not "The summary must be:" (which must remain at the end of each persona's intro sentence to avoid a paragraph break). The skip guards and examples remain in the per-persona content because they differ.

### Step 5 — Update `ledger-bootstrapper.md` to use the partial

In `personas/ledger-support/src/content/ledger-bootstrapper.md`, replace the three quality bullets (lines 76–78) with the partial include. The intro sentence (including "The summary must be:") and surrounding context (example, skip guards) remain unchanged.

**Before** (lines 74–78):
```markdown
…craft a `project_summary`: a 2–3 sentence plain-text description of the project's intent. The summary must be:

- **Factual and concise** — describe what the project does and why, not how it is implemented
- **Plain text only** — no Markdown formatting (no bold, bullets, backticks, or headers)
- **Focused on intent** — avoid implementation details, tool names, and technical specifics unless essential to understanding the project's purpose
```

**After:**
```markdown
…craft a `project_summary`: a 2–3 sentence plain-text description of the project's intent. The summary must be:

{{> summary-crafting-guide}}
```

This produces byte-identical output: the partial's three bullets are inserted at column 0, matching the original indentation.

### Step 6 — Update `standalone-archiver.md` to use the partial

In `personas/ledger-support/src/content/standalone-archiver.md`, replace the three quality bullets (lines 64–66) with the partial include. The intro sentence (including "The summary must be:") and surrounding context (example, skip guards) remain unchanged.

**Before** (lines 62–66):
```markdown
…craft a `project_summary`: a 2–3 sentence plain-text description of the project's intent. The summary must be:

   - **Factual and concise** — describe what the project does and why, not how it is implemented
   - **Plain text only** — no Markdown formatting (no bold, bullets, backticks, or headers)
   - **Focused on intent** — avoid implementation details, tool names, and technical specifics unless essential to understanding the project's purpose
```

**After:**
```markdown
…craft a `project_summary`: a 2–3 sentence plain-text description of the project's intent. The summary must be:

{{> summary-crafting-guide}}
```

**Note — cosmetic indentation change:** The original bullets are at 3-space indent (inside a numbered list item). The `resolvePartials` engine performs raw regex substitution with no indentation propagation, so the include must be placed at column 0 to produce consistent output. The rendered bullets will shift from 3-space to 0-space indentation — a cosmetic change that does not affect agent behaviour. The preceding `{{> summary-crafting-guide}}` marker in the source is at column 0 (not indented), ensuring all three bullet lines render at column 0 consistently.

### Step 7 — Update persona YAML changelogs

Add a new changelog entry to both persona YAML files to document the partial extraction:

- `personas/ledger-support/src/meta/ledger-bootstrapper.yaml` — add entry: `1.2.0 (2026-07-16): Extracted summary-crafting guidelines to shared partial`
- `personas/ledger-support/src/meta/standalone-archiver.yaml` — add entry: `1.5.0 (2026-07-16): Extracted summary-crafting guidelines to shared partial`

### Step 8 — Update `api-surface.md` shared partials table

In `personas/docs/agents/project-manifest/api-surface.md`, add a new row to the "Shared Partials" table for the new partial:

```
| `summary-crafting-guide.md` | Ledger Bootstrapper, Standalone Archiver | *(none)* |
```

Insert it alphabetically (after `synthesis-operational-protocol.md` or at the appropriate position in the table).

### Step 9 — Rebuild personas and verify

First, run `node scripts/build-personas.js --check` **before** building to verify the expected output delta against the existing generated files. This confirms which files changed (only the bootstrapper and archiver outputs should differ). Then run `node scripts/build-personas.js` to rebuild all persona output. Finally, run `--check` again to confirm 0 stale files.

### Step 10 — Regenerate `.context/` again (post-partial)

Run `node scripts/cli.js ctx-generate` a second time to pick up:
- The new `summary-crafting-guide.md` partial in `.context/personas/shared-partials.md`
- The updated `ledger-bootstrapper.md` and `standalone-archiver.md` content (if captured by any CTX document)
- The updated `api-surface.md` shared partials table

## Dependencies

- Step 1 must precede Step 3 (CTX config must exist before regeneration)
- Steps 4–6 are independent of Steps 1–3 (no ordering dependency between CTX fix and partial extraction)
- Step 7 must precede Step 9 (YAML changelog before persona rebuild)
- Step 8 is independent of Steps 4–7 (api-surface.md update has no build dependency)
- Step 9 must precede Step 10 (rebuilt personas before final CTX regeneration)

## Required Components

- `context.yaml` — add document definition (existing file, modification)
- `AGENTS.md` — update Generated Context Docs table (existing file, modification)
- `personas/shared/partials/summary-crafting-guide.md` — new file
- `personas/ledger-support/src/content/ledger-bootstrapper.md` — replace inline guidelines with partial include (existing file, modification)
- `personas/ledger-support/src/content/standalone-archiver.md` — replace inline guidelines with partial include (existing file, modification)
- `personas/ledger-support/src/meta/ledger-bootstrapper.yaml` — add changelog entry (existing file, modification)
- `personas/ledger-support/src/meta/standalone-archiver.yaml` — add changelog entry (existing file, modification)
- `personas/docs/agents/project-manifest/api-surface.md` — add shared partial to table (existing file, modification)
- `personas/ledger-support/{vs-code,claude-code,deep-agents}/ledger-bootstrapper.*` — regenerated output (6 files total across both personas)

## Assumptions

- The `@mistraljs/persona-builder` engine's `resolvePartials` performs raw regex substitution (`string.replace`) with no indentation propagation. A partial include marker's leading whitespace applies only to the first line of the inserted content; subsequent lines render at column 0. This is a verified engine behaviour (see `ai-persona-builder/src/engine/partials.ts` L43–48), not an assumption — it drives the design decision to place the archiver's include at column 0 and accept the cosmetic indentation change.
- The `ctx` CLI tool is available on PATH for CTX generation.

## Constraints

- Generated persona files must not be edited directly — only source templates and metadata are modified.
- Persona YAML `version:` and `last_updated:` are auto-derived from the `changelog:` block — no standalone fields may be added.

## Out of Scope

- Adding `trim()` or `max-length` guards to `project_summary` (synthesis deferred items 1–2, low priority).
- Exporting `ImportStandaloneSchema` (synthesis deferred item 3 / Gold Nugget 3, low priority).
- Standardizing the `document.fonts.ready` guard as a named helper (synthesis Gold Nugget 2, informational).
- Version bumps to `mcp-server/changelog.md` or `personas/changelog.md` (synthesis next step 3 — separate release workflow).
- Retroactive enrichment of existing standalone imports (synthesis next step 4 — operational task, not a code change).

## Acceptance Criteria

- AC-01: `.context/agents.md` exists after CTX regeneration and contains the root AGENTS.md content.
- AC-02: The AGENTS.md "Generated Context Docs" table lists all documents actually generated by `context.yaml` + module configs, including `agents.md`, `source-gui-api-handlers.md`, and `source-gui-frontend.md`.
- AC-03: `personas/shared/partials/summary-crafting-guide.md` exists and contains the three quality bullets (factual/concise, plain text, focused on intent).
- AC-04: `ledger-bootstrapper.md` uses `{{> summary-crafting-guide}}` instead of inline quality bullets; the rendered output is byte-identical to the pre-refactor output (verified by running `--check` before the rebuild).
- AC-05: `standalone-archiver.md` uses `{{> summary-crafting-guide}}` instead of inline quality bullets; the rendered output is functionally equivalent to the pre-refactor output. The only difference is cosmetic: bullet indentation changes from 3-space to 0-space because the persona builder engine (`resolvePartials`) performs raw regex substitution with no indentation propagation.
- AC-06: `node scripts/build-personas.js --check` passes with 0 stale files after the rebuild.
- AC-07: Both persona YAML changelogs have a new entry documenting the partial extraction.
- AC-08: The `personas/docs/agents/project-manifest/api-surface.md` shared partials table includes a row for `summary-crafting-guide.md`.

## Testing Strategy

The persona build system's `--check` flag is the primary verification mechanism — it compares generated output byte-for-byte against existing files. If the partial include produces different output than the original inline text, the check will fail. CTX generation success is verified by file existence and content inspection.

## Test Plan

- `node scripts/build-personas.js --check` (run **before** the rebuild, while pre-refactor generated files are on disk) — detects the expected output delta; only bootstrapper and archiver outputs should differ (covers AC-04, AC-05)
- `node scripts/build-personas.js` — full rebuild with updated source templates
- `node scripts/build-personas.js --check` (run **after** the rebuild) — confirms 0 stale files (covers AC-06)
- Manual verification: `.context/agents.md` exists and is non-empty (covers AC-01)
- Manual verification: AGENTS.md table row count matches actual `.context/` file count (covers AC-02)
- Manual verification: `api-surface.md` shared partials table includes `summary-crafting-guide.md` (covers AC-08)

## Documentation Updates

- `AGENTS.md` — Generated Context Docs table: add 2 missing GUI source doc rows (Step 2). CLAUDE.md auto-propagates via `@AGENTS.md` include.
- `personas/docs/agents/project-manifest/api-surface.md` — add `summary-crafting-guide.md` row to the shared partials table (Step 8).

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | `project_summary` whitespace-only `trim()` guard | Synthesis deferred #1 | Not a practical concern for agent-provided fields; no user-facing impact | Reconsider if `project_summary` becomes user-editable |
| 2 | `project_summary` max-length constraint | Synthesis deferred #2 | Consistent with `ledger_initialize_project` behavior; acceptable at current scale | Reconsider if GUI truncation issues arise |
| 3 | Export `ImportStandaloneSchema` for integration tests | Synthesis deferred #3 / Gold Nugget 3 | Low urgency at current test-suite scale | Reconsider when integration test complexity grows |
| 4 | Standardize `document.fonts.ready` guard as named helper | Synthesis Gold Nugget 2 | Informational pattern note; current inline usage is sufficient | Reconsider if additional deferral points are added to `project-detail.js` |
| 5 | Version bumps (mcp-server minor, personas patch) | Synthesis next step 3 | Separate release workflow, not a code change | Run `node scripts/cli.js check-versions` before next release |
| 6 | Retroactive standalone import enrichment | Synthesis next step 4 | Operational task, not code — deploy Standalone Archiver agent | Can be done anytime via the archiver agent |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Archiver cosmetic indentation change** — The archiver's quality bullets were originally at 3-space indent (inside a numbered list item). Because the persona builder engine (`resolvePartials`) performs raw regex substitution with no indentation propagation, the partial must be included at column 0. This shifts the bullets from 3-space to 0-space indentation in the rendered output. | This is a known, accepted cosmetic difference. The bullet content is identical; only the Markdown nesting level changes. Agent behaviour is unaffected — agents do not rely on list-item indentation structure in their instructions. AC-05 explicitly documents this as "functionally equivalent." |
| **CTX tool not on PATH** — `ctx-generate` requires the `ctx` CLI tool to be installed. | If `ctx` is not available, skip Steps 3 and 9 and note the dependency in the WP. The config and table changes are still valid without regeneration. |
