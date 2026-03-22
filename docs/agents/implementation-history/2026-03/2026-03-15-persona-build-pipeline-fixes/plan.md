# Plan

## Summary

Follow-up plan addressing four actionable items from the `2026-03-14-9-agent-personas-rework-1` synthesis. All four items target the persona build pipeline (`scripts/build-personas.js`) and persona documentation — no MCP server code changes required.

The four items are:

1. **VS Code output file naming** — The build script derives output filenames from the YAML source filename (`slug.md`), but constraint 13 and every persona's `vs_file_name` YAML field declare `.agent.md` as the correct extension. The output files must use the YAML-declared name.
2. **`mcpServers` auto-injection for standalone Claude Code personas** — The `FRONTMATTER_STANDALONE_CC` template lacks `mcpServers`, making MCP-dependent standalone personas (e.g., `ledger-bootstrapper`) non-functional in Claude Code. Implement the Option 1 design from WP-007.
3. **Inline WP-007 recommendation content into `standalone/README.md`** — The README links to a plan artifact (`WP-007-recommendation.md`) that will be archived. Integrate the relevant design content directly into the README.
4. **Constraints.md housekeeping** — Renumber constraints into a monotonic top-to-bottom sequence and fill the missing constraint 38 gap.

## Architectural Context

### Build Pipeline (`scripts/build-personas.js`)

The build script assembles 48 persona files (9 ledger × 2 targets + 15 standalone × 2 targets) from YAML metadata + Markdown content templates. Key relevant sections:

- **Output filename derivation** — Currently `contentBasename = yamlFile.replace(/\.yaml$/, '.md')` is used for both the input content file lookup and the output file path. This `contentBasename` is reused at file-write time: `outputFile = path.join(outputDir, contentBasename)`.
- **Frontmatter templates** — Four templates exist: `FRONTMATTER_LEDGER_VSCODE`, `FRONTMATTER_LEDGER_CC`, `FRONTMATTER_STANDALONE_VSCODE`, `FRONTMATTER_STANDALONE_CC`. Only the ledger CC template includes `mcpServers`.
- **Tools serialization** — `serializeTools()` and `serializeToolsList()` handle tool string formatting. No function currently extracts MCP server names from tool paths.

### Sync Pipeline (`scripts/sync-personas.js`)

The sync script deploys built personas to VS Code's prompts directory. It already reads `vs_file_name` from YAML frontmatter via `extractVSFileName()` and uses that as the deployment target filename. This means the sync step correctly renames `slug.md` → `slug.agent.md` on deployment — but the source files in the repo have the wrong names, creating a mismatch between what's in version control and what constraint 13 specifies.

### Constraint 13

> "Standalone `vs_file_name` uses the `.agent.md` extension (e.g. `researcher.agent.md`). The output file on disk is named by the `vs_file_name` value (e.g. `researcher.agent.md`), not by the slug."

This constraint is currently violated by the build script. The fix aligns the build output with the documented constraint for both ledger and standalone suites.

### Constraints.md Structure

The file has constraints numbered 1–45 but with non-sequential ordering across sections:
- 1–35: Core rules through cross-system dependencies
- 44–45: Recently added (canonical pipeline ordering, WP-ID auto-generation)
- 36–43: Intentional differences and pre-commit guards (appear after 44–45)
- Constraint 38 is missing from the sequence entirely (jumps 37 → 39)

## Approach / Architecture

### WP-1: VS Code Output Filename Fix

Separate the **input path** (content template lookup) from the **output path** (generated file write) in `buildForTarget()`. The input path continues to use `contentBasename` (derived from YAML filename). The output path switches to `vs_file_name` (for VS Code targets) or `cc_file_name` (for Claude Code targets) read from the persona YAML metadata.

This applies to **both suites** (ledger and standalone) since both declare `.agent.md` in their YAML `vs_file_name` fields. Affected files:

| Suite | Current output | Correct output |
|-------|---------------|----------------|
| Ledger VS Code (9 files) | `1-planner.md` | `1-planner.agent.md` |
| Standalone VS Code (15 files) | `researcher.md` | `researcher.agent.md` |
| Claude Code (both suites) | No change — `cc_file_name` already uses `.md` |

After the build pipeline change, a `--suite all --strict` rebuild will produce the new filenames and delete or replace the old ones.

### WP-2: `mcpServers` Auto-Injection

Add an `extractMcpServers(tools)` helper that identifies MCP tool entries (those containing `/`) and extracts unique server names. In the standalone CC template resolution, conditionally inject `mcpServers` when the extracted set is non-empty. This follows the Option 1 design from WP-007 — no new YAML fields, no new templates, fully constraint-21-compliant.

### WP-3: Inline WP-007 Content & Update README

After WP-2 implements the fix, update `personas/standalone/README.md`:
- Replace the "Claude Code Limitations" section to reflect that `mcpServers` is now auto-injected
- Remove the link to `WP-007-recommendation.md`
- Inline the key design rationale (how server names are derived from `tools` entries) so the README is self-contained

### WP-4: Constraints Housekeeping

Renumber all constraints in `personas/docs/agents/project-manifest/constraints.md` into a single monotonic top-to-bottom sequence. Fill the constraint 38 gap. Move constraints 44–45 to their correct numerical position (or renumber everything for clean sequential flow).

## Rationale

- **VS Code naming fix** is the highest-integrity item: the build output currently violates a documented constraint. Using `vs_file_name`/`cc_file_name` from YAML for output naming is the correct approach because (a) these fields exist specifically for this purpose, (b) `sync-personas.js` already uses `vs_file_name` for deployment, and (c) constraint 13 explicitly states this is the expected behavior.
- **`mcpServers` injection** uses Option 1 because it's self-consistent with existing architecture — the server name is already encoded in the `tools` list, so no new conventions are needed. The design was fully vetted in WP-007.
- **Inlining WP-007 content** prevents a brittle link to plan artifacts that will be archived. The user explicitly requested this approach.
- **Constraints renumbering** is low-risk housekeeping that improves navigability for future agent sessions.

## Detailed Steps

### WP-1: VS Code Output Filename Fix

1. In `scripts/build-personas.js`, locate the output filename construction in `buildForTarget()` (where `contentBasename` is used for the output file path).
2. Add logic to determine the output basename from the persona YAML metadata:
   - For VS Code targets: use `persona.vs_file_name` (validated as non-empty)
   - For Claude Code targets: use `persona.cc_file_name` (validated as non-empty)
   - `contentBasename` continues to be used only for locating the input content template file
3. Add validation: if `vs_file_name` (VS Code) or `cc_file_name` (Claude Code) is missing from the persona YAML, emit an error and exit (fail-fast).
4. Delete old `.md` output files from `personas/ledger/vs-code/` and `personas/standalone/vs-code/` (the 24 files with wrong extensions).
5. Run `node scripts/build-personas.js --suite all --strict` to generate all 48 files with correct naming.
6. Run `node scripts/build-personas.js --check --suite all --strict` to validate freshness.
7. Update `personas/docs/agents/project-manifest/file-tree.md` to reflect the new `.agent.md` filenames in the `vs-code/` output directories.

### WP-2: `mcpServers` Auto-Injection

1. In `scripts/build-personas.js`, add the `extractMcpServers(tools)` helper function that filters tool entries containing `/` and extracts unique server prefixes.
2. In the standalone CC build path (where `FRONTMATTER_STANDALONE_CC` variables are resolved), compute `mcpServers` from the persona's `tools` list using the new helper.
3. Conditionally inject the `mcpServers` block into the frontmatter output when the server set is non-empty.
4. Rebuild standalone CC personas: `node scripts/build-personas.js --suite standalone --target cc --strict`.
5. Verify `ledger-bootstrapper.md` in `personas/standalone/claude-code/` now contains `mcpServers: - central_pm` in its frontmatter.
6. Verify personas without MCP tools (e.g., `researcher.md`) do **not** have a `mcpServers` block.

### WP-3: Inline WP-007 Content into `standalone/README.md`

1. Read `personas/standalone/README.md` and locate the "Claude Code Limitations" section.
2. Update the section to reflect that `mcpServers` auto-injection is now implemented:
   - Explain the derivation mechanism (server names extracted from `tools` entries matching `{server}/*`)
   - Note constraint-21 compliance
   - Remove the "Current workaround" paragraph (or reframe as historical context if preferred)
   - Remove the link to `WP-007-recommendation.md`
3. Inline the essential design rationale so the README is self-contained (no external links to plan artifacts).

### WP-4: Constraints Housekeeping

1. Read `personas/docs/agents/project-manifest/constraints.md` in full.
2. Renumber all constraints into a monotonic top-to-bottom sequence (1, 2, 3, … N):
   - Maintain the existing section structure (sections don't move, only numbers change).
   - Fill the constraint 38 gap.
   - Place constraints 44–45 in their correct position relative to the document flow.
3. If any other persona manifest documents or source files reference constraint numbers by ID (e.g., "per constraint 13"), update those references to match the new numbering.
4. Verify no cross-references are broken in: `personas/ledger/README.md`, `personas/standalone/README.md`, `personas/docs/agents/project-manifest/*.md`, `AGENTS.md`.

### WP-5: Final Validation Build

1. Run `node scripts/build-personas.js --suite all --strict` — full 48-persona rebuild.
2. Run `node scripts/build-personas.js --check --suite all --strict` — freshness validation (exit 0).
3. Run `node scripts/check-known-roles.js` — role sync check (9/9).
4. Run `npm test` in `mcp-server/` — MCP server regression suite (verify zero failures).
5. Spot-check 2–3 generated VS Code files to confirm `.agent.md` extension and correct frontmatter.
6. Spot-check `ledger-bootstrapper.md` in `personas/standalone/claude-code/` to confirm `mcpServers` block.

## Dependencies

- WP-2 depends on WP-1 (both modify `build-personas.js`; WP-1's filename logic change should land first to avoid merge conflicts in the function).
- WP-3 depends on WP-2 (README update reflects the implemented fix).
- WP-4 is independent of WP-1/WP-2/WP-3.
- WP-5 depends on all prior WPs.

## Required Components

### Modified Files
- `scripts/build-personas.js` — Output filename logic + `extractMcpServers()` helper + conditional `mcpServers` injection (WP-1, WP-2)
- `personas/standalone/README.md` — Inline WP-007 content, update Claude Code Limitations section (WP-3)
- `personas/docs/agents/project-manifest/constraints.md` — Renumber constraints (WP-4)
- `personas/docs/agents/project-manifest/file-tree.md` — Update VS Code output filenames (WP-1)
- `personas/changelog.md` — Version bump entry (WP-5)

### Generated Files (rebuilt, not manually edited)
- `personas/ledger/vs-code/*.agent.md` — 9 files renamed from `.md` to `.agent.md`
- `personas/standalone/vs-code/*.agent.md` — 15 files renamed from `.md` to `.agent.md`
- `personas/standalone/claude-code/ledger-bootstrapper.md` — Now includes `mcpServers` block

### Deleted Files
- `personas/ledger/vs-code/*.md` — 9 old files with wrong extension (replaced by `.agent.md`)
- `personas/standalone/vs-code/*.md` — 15 old files with wrong extension (replaced by `.agent.md`)

## Assumptions

- The `vs_file_name` and `cc_file_name` fields are present in all 24 persona YAML files (9 ledger + 15 standalone). If any are missing, WP-1 will surface this during the validation step.
- The `sync-personas.js` script does not need changes — it already reads `vs_file_name` from frontmatter and uses it as the deployment target name. The source files having `.agent.md` names will make the source-to-deployment mapping more transparent.
- No MCP server code changes are needed — this is entirely a persona build system change.
- Constraint 13's text already describes the correct behavior; only the build pipeline needs to be brought into compliance.

## Constraints

- **Constraint 21:** Standalone `_shared.yaml` must not contain `mcp_server_name` or `roster`. The `mcpServers` injection (WP-2) derives server names from per-persona `tools` entries, not from shared metadata — fully compliant.
- **Constraint 13:** Output files on disk must be named by `vs_file_name`, not by slug. WP-1 enforces this.
- **No manual edits to generated output files.** All output changes come from rebuilding via `build-personas.js`.
- Constraints renumbering (WP-4) must update all cross-references to avoid broken number citations.

## Out of Scope

- Ledger persona YAML field changes — all YAML metadata is already correct.
- MCP server code or test changes — this plan is persona-build-system only.
- Changes to `sync-personas.js` — it already handles `vs_file_name` correctly.
- Claude Code file extensions — `cc_file_name` already uses `.md` and this is correct per convention.
- New persona creation or content changes.

## Acceptance Criteria

- `node scripts/build-personas.js --suite all --strict` exits 0 and produces 48 files.
- `node scripts/build-personas.js --check --suite all --strict` exits 0 (freshness validated).
- All 9 ledger VS Code output files have `.agent.md` extension (e.g., `1-planner.agent.md`).
- All 15 standalone VS Code output files have `.agent.md` extension (e.g., `researcher.agent.md`).
- No `.md` files remain in `personas/ledger/vs-code/` or `personas/standalone/vs-code/` (except `.gitkeep`).
- `personas/standalone/claude-code/ledger-bootstrapper.md` contains `mcpServers` with `central_pm`.
- Standalone CC personas without MCP tools (e.g., `researcher.md`) do **not** contain a `mcpServers` block.
- `personas/standalone/README.md` contains no links to plan artifacts; WP-007 design content is inlined.
- `personas/docs/agents/project-manifest/constraints.md` has monotonic top-to-bottom constraint numbering with no gaps.
- All cross-references to constraint numbers are updated to match the new numbering.
- `node scripts/check-known-roles.js` — 9/9 roles in sync.
- MCP server regression suite passes (0 failures).

## Testing Strategy

- **Build validation:** `--suite all --strict` and `--check --suite all --strict` cover all 48 generated files.
- **Filename verification:** Directory listing of `personas/{suite}/vs-code/` confirms `.agent.md` extensions.
- **Frontmatter inspection:** Spot-check generated CC files for correct `mcpServers` presence/absence.
- **Cross-reference audit:** Search for constraint number references across persona documentation and verify they match renumbered values.
- **Regression:** Full MCP server test suite ensures persona changes haven't affected server behavior.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Old `.md` files left behind in VS Code output directories** | Explicitly delete old files before rebuild. Verify with directory listing post-build. |
| **`sync-personas.js` behavior changes due to source filename change** | The sync script reads `vs_file_name` from frontmatter, not from the source filename. Source rename is transparent to sync. Verify with a dry-run sync after rebuild. |
| **Missing `vs_file_name` or `cc_file_name` in some persona YAML** | WP-1 adds fail-fast validation. Any missing field will surface immediately as a build error. |
| **Constraint renumbering breaks cross-references** | WP-4 includes a grep-based audit of all references to constraint numbers across the documentation tree. |
| **`extractMcpServers()` extracts false positives from tool names containing `/`** | The only tool entries with `/` in the current YAML metadata are MCP tool paths (`server/*`). Add a comment documenting the convention. |
