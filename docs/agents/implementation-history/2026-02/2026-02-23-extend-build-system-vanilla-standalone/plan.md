# Plan

## Summary

Extend the existing ledger persona build system to cover the **vanilla** (7-agent, no-MCP) and **standalone** (isolated utility agents) persona families. Vanilla personas will gain a full `src/`-backed build pipeline with per-IDE output (`vs-code/` + `claude-code/`), mirroring the ledger pattern; they are **manual-use only** and are not synced to any IDE directory. Vanilla also has its role names and identities realigned with the ledger variants — correcting the drift that has accumulated over time. Standalone personas will gain a lighter frontmatter-only build: a single body source file plus a YAML file per agent, with the build system generating IDE-specific output (continuing to sync via the existing standalone sync functions). To prevent future drift between ledger and vanilla, **shared non-MCP content** will be extracted to a new `personas/shared/partials/` directory that both suites reference. A `--suite` flag is added to `build-personas.js`; `sync-personas.js`'s build invocation is updated to rebuild standalone output on every sync run.

---

## Architectural Context

### Existing ledger build pipeline

The current build system lives entirely in `scripts/build-personas.js` and operates on `personas/ledger/src/`:

- `src/meta/_shared.yaml` — suite-level metadata (author, roster, CC defaults, MCP server name)
- `src/meta/N-name.yaml` — per-persona metadata (number, role, tools, feature flags, `vs_file_name`, `cc_file_name`)
- `src/content/N-name.md` — body template with `{{> partial}}`, `{{#if flag}}`, `{{variable}}` syntax
- `src/partials/` — reusable Markdown fragments (mostly MCP-specific; one generic: `agent-roster.md`)

Build outputs:
- `personas/ledger/vs-code/N-name.md` — VS Code personas (VS Code frontmatter + auto-header + body)
- `personas/ledger/claude-code/N-name.md` — Claude Code personas (CC frontmatter + auto-header + body)

`scripts/sync-personas.js` spawns `build-personas.js` then copies generated files to the IDE-specific system directories. It has four sync functions: `syncVSCode()`, `syncStandaloneVSCode()`, `syncClaudeCode()`, `syncStandaloneClaudeCode()`.

### Current vanilla state

`personas/vanilla/` contains 7 hand-authored flat `.md` files (`1-planner.md` … `7-synthesis.md`) plus a `README.md`. These files have VS Code-style YAML frontmatter but no `vs_file_name` or `role` field, so they are never synced. They have diverged from ledger over time; they share the same workflow structure but omit all MCP-specific content and use original role names ("Planning Agent", "Project Manager Agent", etc.).

### Current standalone state

`personas/standalone/vs-code/` and `personas/standalone/claude-code/` each contain 6 hand-authored `.md` files for utility agents (researcher, manifest-curator, module-intent-architect, readme-curator, agents-md-curator, unit-test-auditor). These are already IS-synced by `syncStandaloneVSCode()` / `syncStandaloneClaudeCode()`. The VS Code and Claude Code variants of each persona differ only in frontmatter; the body is identical. There is no source template system — each file is maintained manually in both output directories.

### Divergence between vanilla and ledger

Analysing the 7 vanilla personas against the 7 ledger content templates, the main structural differences are:

| Category | Ledger only | Vanilla | Extractable to shared/ |
|---|---|---|---|
| MCP preflight / handoff blocks | ✓ | — | No (MCP-specific) |
| `mcp-intro`, `role-boundaries` partials | ✓ | — | No |
| Ledger-specific inputs (Project Ledger via MCP) | ✓ | — | No |
| Code Insight Observer / ledger observations | ✓ | — | No |
| Agent roster block | Both | Both | **Yes** |
| Operational protocol (steps) | Both | Both | **Yes** |
| Strict constraints / core rules | Both | Both | **Yes** |
| Output format / output template | Both | Both | **Yes** |
| Workflow (numbered steps) | Both | Both | **Yes** |

---

## Approach / Architecture

### Suite concept

Introduce a **suite** abstraction. A suite is a named family of personas sharing a common source tree structure. Three suites: `ledger`, `vanilla`, `standalone`.

```
personas/
  shared/
    partials/           ← NEW: cross-suite non-MCP partials
  ledger/
    src/                ← existing
    vs-code/            ← generated (unchanged)
    claude-code/        ← generated (unchanged)
  vanilla/
    src/                ← NEW: meta/ + content/ + partials/
    vs-code/            ← NEW: generated output
    claude-code/        ← NEW: generated output
  standalone/
    src/                ← NEW: meta/ + content/ (no partials dir needed)
    vs-code/            ← existing → now generated
    claude-code/        ← existing → now generated
```

### Partial resolution order (per suite)

The build script resolves partials by searching directories in priority order, first-match wins:

1. Suite-specific partials dir (e.g., `ledger/src/partials/`, `vanilla/src/partials/`)
2. `shared/partials/`

This allows suites to override a shared partial if they need it.

### Build script: `--suite` flag

`scripts/build-personas.js` gains a `--suite ledger|vanilla|standalone|all` flag (default: `ledger` to preserve backward compatibility). All existing flags (`--target`, `--check`, `--dry-run`) continue to work per-suite.

```
node scripts/build-personas.js                              # ledger only (backward compat)
node scripts/build-personas.js --suite all                  # all three suites
node scripts/build-personas.js --suite vanilla              # vanilla only
node scripts/build-personas.js --suite standalone           # standalone only
node scripts/build-personas.js --suite vanilla --target claude-code
```

### Vanilla frontmatter templates

Since vanilla personas have no MCP dependency, their frontmatter is simpler:

**VS Code variant:**
```yaml
---
name: 'N - RoleTitle vX.Y.Z'
description: 'Step N/7 in the agent workflow (vanilla).'
role: RoleName
author: ...
version: ...
last_updated: ...
tools: [...]
---
```
No `vs_file_name` field — vanilla personas are manual-use only and are not synced to any IDE system directory.

**Claude Code variant:**
```yaml
---
name: N-name-vanilla
description: 'RoleTitle — Short'
role: RoleName
author: ...
version: ...
last_updated: ...
tools: [...]
permissionMode: acceptEdits
model: inherit
memory: project
---
```
`name` uses the `-vanilla` suffix (e.g., `1-planner-vanilla`) so that if a user manually copies the file to `~/.claude/agents/` it does not overwrite the ledger variant. No `mcpServers` block — vanilla personas do not require the MCP server.

### Standalone frontmatter templates

Standalone personas have no numbered pipeline position. Frontmatter-only differences:

**VS Code variant:** `name`, `description`, `author`, `version`, `last_updated`, `vs_file_name`, `tools`
**Claude Code variant:** `name` (plain kebab-case), `description`, `author`, `version`, `last_updated`, `tools`, `permissionMode`, `model`, `memory`

Body content is identical across targets and is authored directly in `src/content/`. The build engine still applies partial resolution, conditionals, and variable interpolation on the body — this allows small shared fragments even for standalone personas.

### Sync script extensions

Vanilla personas are **manual-use only** — `sync-personas.js` is not extended for vanilla. Users copy-paste directly from the generated `vanilla/vs-code/` or `vanilla/claude-code/` directories.

The only sync script change is updating the spawned `build-personas.js` invocation from implicit `--suite ledger` to `--suite ledger,standalone`, so standalone output is always rebuilt before sync. The existing `syncStandaloneVSCode()` and `syncStandaloneClaudeCode()` functions remain unchanged and continue to read from `standalone/vs-code/` and `standalone/claude-code/` (now generated output).

### Content sync: shared partials extraction

The following non-MCP content sections are extracted from the ledger content templates into `personas/shared/partials/`:

| Partial filename | Content |
|---|---|
| `agent-roster.md` | Agent roster block (moved from `ledger/src/partials/`) |
| `planner-output-template.md` | The `plan.md` Markdown output template |
| `planner-core-rules.md` | Planner's Scope & Boundaries, Hallucination Prevention, Completeness rules |
| `pm-output-format.md` | Work packages document format description |
| `developer-operational-protocol.md` | The numbered implementation steps |
| `developer-strict-constraints.md` | Scope guardrails, atomic changes, no placeholders, etc. |
| `developer-output-format.md` | `impl.md` structure and required sections |
| `qa-operational-protocol.md` | QA validation steps |
| `qa-output-format.md` | QA report format |
| `reviewer-operational-protocol.md` | Review steps |
| `reviewer-output-format.md` | Code review report format |
| `docs-operational-protocol.md` | Documentation update steps |
| `docs-output-format.md` | Documentation report format |
| `synthesis-operational-protocol.md` | Synthesis aggregation steps |
| `synthesis-output-format.md` | Project status report format |

After extraction, ledger content templates reference these via `{{> partial-name}}` exactly as today. Vanilla content templates use the same references — their content becomes a thin wrapper: mission section (no MCP identity) + `{{> agent-roster}}` + inputs section + `{{> shared-protocol}}` + `{{> shared-output-format}}` + workflow section.

---

## Rationale

- **`--suite` flag over separate scripts**: One build script with a suite parameter keeps the pipeline logic DRY. It avoids duplicating the partial resolver, variable interpolator, and frontmatter templates. Adding a new suite is a config change, not a script rewrite.
- **`shared/` directory over referencing `ledger/src/partials/` directly**: Coupling vanilla to the ledger source tree would make it unclear which partials are "ledger-specific" vs "truly shared". A dedicated `shared/` directory makes the boundary explicit and grep-visible.
- **Vanilla gets per-IDE output (not a single flat file)**: Consistent with ledger. Enables proper CC frontmatter (`permissionMode`, `model`, `memory`). Vanilla personas are **manual-use only**: they are not synced to any IDE system directory — users copy-paste from `vanilla/vs-code/` or `vanilla/claude-code/` directly. Vanilla therefore omits `vs_file_name` from frontmatter.
- **Vanilla role names align with ledger**: Vanilla personas adopt the same identities and titles as ledger (e.g., "Chief Product Officer", "Staff Software Engineer"). The divergence that accumulated over time is corrected in this implementation. The only intentional difference between the two suites is the absence of MCP content in vanilla.
- **Standalone uses frontmatter-only templating**: Standalone personas don't share a workflow or roster — there's nothing to conditionally include or iterate over. The single body source file model is simpler and fits the use case. Partial support is still available for the rare case where two standalone personas share a section.
- **Backward compatibility for default `--suite`**: `build-personas.js` without `--suite` defaults to `ledger`, preserving all existing CI checks and developer muscle memory.

---

## Detailed Steps

### WP-001: Shared partials extraction

1. Create `personas/shared/partials/` directory with `.gitkeep`.
2. Move `personas/ledger/src/partials/agent-roster.md` to `personas/shared/partials/agent-roster.md`.
3. For each of the 7 ledger content templates, identify the sections that are non-MCP and present in the equivalent vanilla persona. Extract those sections into appropriately-named shared partials (see table above).
4. Replace the extracted sections in ledger content templates with `{{> shared-partial-name}}`.
5. Run `node scripts/build-personas.js --check` to confirm all ledger output is still identical after the refactor.

### WP-002: Vanilla source tree setup

1. Create `personas/vanilla/src/meta/` and `personas/vanilla/src/content/` directories.
2. Write `personas/vanilla/src/meta/_shared.yaml` with:
   - `author`, `last_updated`, `default_version`
   - `roster[]` — same role titles and short descriptions as the ledger `_shared.yaml` (e.g., "Chief Product Officer (Planning & Strategy)", "Staff Software Engineer (Implementation & Verification)", etc.)
   - `default_cc_tools[]` — same list as ledger shared
   - `cc_permission_mode`, `cc_model`, `cc_memory`
3. Write one YAML per persona under `src/meta/` (`1-planner.yaml` … `7-synthesis.yaml`) with: `number`, `role` (matching `KNOWN_ROLES`), `cc_file_name` (`N-name-vanilla.md` — `-vanilla` suffix to avoid collision when manually placed in `~/.claude/agents/`), `version`, `tools`. **Omit `vs_file_name`** — vanilla is not synced.
4. Write 7 content templates under `src/content/` using the shared partials for all common sections and minimal vanilla-specific mission text. Mission text must use the same identity/title as the ledger variant (e.g., "**Identity: Chief Product Officer (CPO).**") — strip only the MCP-specific identity note ("Your role identifier for all MCP tool calls is…"). No MCP content anywhere in vanilla content templates.
5. Scaffold `personas/vanilla/src/partials/` with `.gitkeep` (empty for now; placeholder for future vanilla-only partials).

### WP-003: Standalone source tree setup

1. Create `personas/standalone/src/meta/` and `personas/standalone/src/content/` directories.
2. Write one YAML per standalone persona under `src/meta/` — one YAML per of the 6 existing standalone agents. Fields: `slug` (kebab-case basename), `name` (human-readable VS Code display name), `description`, `vs_file_name`, `cc_file_name`, `version`, `last_updated`, `tools`, `cc_tools` (if different from shared default).
3. Write a `_shared.yaml` with `author`, `last_updated`, `cc_permission_mode`, `cc_model`, `cc_memory`, `default_cc_tools`.
4. Write 6 body content files under `src/content/` — initially matching the existing body of the VS Code variants verbatim (the current source of truth for body text).
5. The existing hand-authored `standalone/vs-code/*.md` and `standalone/claude-code/*.md` will become generated output after WP-004 is complete.

### WP-004: Build script extension (`--suite`)

1. Add `VALID_SUITES` constant: `['ledger', 'vanilla', 'standalone', 'all']`. Default suite: `ledger`.
2. Define a suite config map:
   ```js
   const SUITE_CONFIGS = {
     ledger:     { srcDir: '...ledger/src',    outVscode: '...ledger/vs-code',    outCC: '...ledger/claude-code',    personaMode: 'numbered' },
     vanilla:    { srcDir: '...vanilla/src',   outVscode: '...vanilla/vs-code',   outCC: '...vanilla/claude-code',   personaMode: 'numbered' },
     standalone: { srcDir: '...standalone/src',outVscode: '...standalone/vs-code',outCC: '...standalone/claude-code',personaMode: 'standalone' },
   };
   ```
3. Update `partials` loading to merge `shared/partials/` (base) with suite-specific partials (override), producing a single flat map.
4. Add vanilla frontmatter templates (`FRONTMATTER_VANILLA_VSCODE`, `FRONTMATTER_VANILLA_CC`) — similar to ledger but omitting MCP fields.
5. Add standalone frontmatter templates (`FRONTMATTER_STANDALONE_VSCODE`, `FRONTMATTER_STANDALONE_CC`) — no `role` (`role` is optional for standalone), no `mcpServers`.
6. Generalize `buildForTarget()` to accept a suite config parameter; select the appropriate frontmatter template based on suite + target.
7. For `personaMode: 'standalone'`: YAML files use `slug` instead of numbered prefix; `cc_name` is derived from `cc_file_name` without numeric prefix validation.
8. Update `AUTO_HEADER` to reference the correct source path per suite (e.g., `Source: personas/vanilla/src/`).
9. Update the main build loop: expand `--suite all` to iterate all three suites.

### WP-005: Sync script extension

Vanilla personas are **manual-use only** — they are not synced to any IDE directory. WP-005 therefore covers only the standalone suite.

1. Update the build invocation inside `sync-personas.js`: change the spawned `build-personas.js` call from implicit `--suite ledger` to `--suite ledger,standalone` (so standalone output is always rebuilt before sync, but vanilla is excluded from automated sync).
2. Standalone VS Code and Claude Code sync functions (`syncStandaloneVSCode()`, `syncStandaloneClaudeCode()`) already exist — confirm they read from the now-generated `standalone/vs-code/` and `standalone/claude-code/` output directories and require no other changes.
3. No new sync functions for vanilla. Users consume vanilla output directly from `personas/vanilla/vs-code/` or `personas/vanilla/claude-code/` by copy-paste.

### WP-006: Manifest & documentation updates

1. Update `personas/docs/agents/project-manifest/file-tree.md` — add `vanilla/src/`, `vanilla/vs-code/`, `vanilla/claude-code/`, `standalone/src/`, `shared/partials/`.
2. Update `personas/docs/agents/project-manifest/api-surface.md` — document `--suite` flag, new frontmatter templates, suite config map, standalone `personaMode`.
3. Update `personas/docs/agents/project-manifest/data-flows.md` — extend build pipeline diagram for multi-suite flow.
4. Update `personas/docs/agents/project-manifest/constraints.md` — add constraints for shared partials editing rules, vanilla/standalone source editing rules, never-edit-generated guards for new suites.
5. Update `personas/docs/agents/project-manifest/README.md` — update quick reference commands to include `--suite`.
6. Update root `AGENTS.md` — extend the "generated output" entries in the navigation reference to include vanilla and standalone output directories.

---

## Dependencies

- WP-001 (shared partials) must complete before WP-002 (vanilla content templates use shared partials).
- WP-002 and WP-003 (source trees) must complete before WP-004 (build script needs source to test against).
- WP-004 (build script) must complete before WP-005 (sync script build invocation update for standalone).
- WP-006 (docs) is independent but should be done last to reflect the final state.

**Sequencing:**
```
WP-001 → WP-002 ┐
                  ├→ WP-004 → WP-005 → WP-006
         WP-003 ┘
```

---

## Required Components

### New files

| File | Type |
|---|---|
| `personas/shared/partials/.gitkeep` | Placeholder |
| `personas/shared/partials/agent-roster.md` | Moved from `ledger/src/partials/` |
| `personas/shared/partials/planner-output-template.md` | Extracted |
| `personas/shared/partials/planner-core-rules.md` | Extracted |
| `personas/shared/partials/pm-output-format.md` | Extracted |
| `personas/shared/partials/developer-operational-protocol.md` | Extracted |
| `personas/shared/partials/developer-strict-constraints.md` | Extracted |
| `personas/shared/partials/developer-output-format.md` | Extracted |
| `personas/shared/partials/qa-operational-protocol.md` | Extracted |
| `personas/shared/partials/qa-output-format.md` | Extracted |
| `personas/shared/partials/reviewer-operational-protocol.md` | Extracted |
| `personas/shared/partials/reviewer-output-format.md` | Extracted |
| `personas/shared/partials/docs-operational-protocol.md` | Extracted |
| `personas/shared/partials/docs-output-format.md` | Extracted |
| `personas/shared/partials/synthesis-operational-protocol.md` | Extracted |
| `personas/shared/partials/synthesis-output-format.md` | Extracted |
| `personas/vanilla/src/meta/_shared.yaml` | New |
| `personas/vanilla/src/meta/1-planner.yaml` … `7-synthesis.yaml` | New (7 files) |
| `personas/vanilla/src/content/1-planner.md` … `7-synthesis.md` | New (7 files) |
| `personas/vanilla/src/partials/.gitkeep` | Placeholder |
| `personas/standalone/src/meta/_shared.yaml` | New |
| `personas/standalone/src/meta/<slug>.yaml` (× 6) | New |
| `personas/standalone/src/content/<slug>.md` (× 6) | New |

### Modified files

| File | Change |
|---|---|
| `scripts/build-personas.js` | Add `--suite` flag, multi-suite loop, new frontmatter templates, merged partial loading |
| `scripts/sync-personas.js` | Update build invocation to include standalone suite; no vanilla sync functions added |
| `personas/ledger/src/partials/*.md` | Replace `agent-roster.md` with reference to shared (remove from suite partials); update content templates to use `{{> shared-xxx}}` for extracted sections |
| `personas/ledger/src/content/*.md` | Replace extracted sections with partial references |
| `personas/docs/agents/project-manifest/*.md` | Documentation updates (6 files across WP-006) |
| Root `AGENTS.md` | Navigation reference updates |

### Directories created

- `personas/shared/partials/`
- `personas/vanilla/src/meta/`
- `personas/vanilla/src/content/`
- `personas/vanilla/src/partials/`
- `personas/vanilla/vs-code/` (created by build)
- `personas/vanilla/claude-code/` (created by build)
- `personas/standalone/src/meta/`
- `personas/standalone/src/content/`

---

## Assumptions

- Vanilla personas use the **same role names, identities, and titles as the ledger variants** (e.g., "Chief Product Officer" for the Planner, "Staff Software Engineer" for the Developer). The content drift accumulated since the vanilla/ledger split is corrected in this implementation. The sole intentional product difference between suites is the absence of MCP content in vanilla.
- Vanilla `role` field values in frontmatter match `KNOWN_ROLES` (same as ledger). `role` identifier and displayed title are now identical between suites.
- Vanilla personas have **no `vs_file_name` field** in generated frontmatter. They are not registered for IDE sync — manual copy-paste only.
- Standalone persona slugs for Claude Code (`name` field) match the existing cc filenames without the `.md` extension (e.g., `manifest-curator`, `researcher`).
- The existing `standalone/vs-code/` and `standalone/claude-code/` file bodies are the authoritative source for body content migration to `standalone/src/content/`.
- `js-yaml` (already a dependency of the `personas/` package) is used by the build script; no new dependencies required.
- The 6 shared partials per persona listed in the plan represent an approximate split; the exact text boundary is decided by the Developer during implementation by comparing ledger content vs vanilla content line-by-line.

---

## Constraints

- Backward compatibility: `node scripts/build-personas.js` without arguments must continue to build only ledger personas and produce identical output to the current build. No regression to existing CI checks.
- Partial resolution order: suite-specific partials take precedence over shared partials (suite can override a shared partial without editing it).
- `agent-roster.md` is the only ledger partial that moves to `shared/`; all MCP-specific partials (`mcp-*.md`, `handoff-block-*.md`, `role-boundaries.md`, `incident-logging.md`) stay in `ledger/src/partials/`.
- Generated vanilla files must carry the auto-generated header (`<!-- AUTO-GENERATED … Source: personas/vanilla/src/ -->`).
- Generated standalone files must carry the auto-generated header (`<!-- AUTO-GENERATED … Source: personas/standalone/src/ -->`).
- Vanilla personas must **not** include a `vs_file_name` field in their frontmatter — they are intentionally excluded from IDE sync.
- Vanilla CC `cc_file_name` must use the `-vanilla` suffix (e.g., `1-planner-vanilla.md`, producing `name: 1-planner-vanilla`) to prevent accidental overwrite of ledger variants if users manually deploy vanilla personas to `~/.claude/agents/`.

---

## Out of Scope

- Changes to the `mcp-server/` sub-project.
- Adding new persona agents beyond the existing 7 ledger + vanilla + 6 standalone.
- Adding `{{#each}}` or nested conditional support to the template engine.
- Updating the `personas/vanilla/README.md` to reflect new role names — that is a separate documentation-only follow-up.
- A standalone `README.md` build.

---

## Acceptance Criteria

- `node scripts/build-personas.js --suite ledger --check` exits 0 with all ledger output up-to-date after WP-001 refactor.
- `node scripts/build-personas.js --suite vanilla` generates 14 files across `personas/vanilla/vs-code/` (7) and `personas/vanilla/claude-code/` (7). All files carry the auto-generated header and have valid YAML frontmatter.
- `node scripts/build-personas.js --suite standalone` generates 12 files across `personas/standalone/vs-code/` (6) and `personas/standalone/claude-code/` (6). All files carry the auto-generated header.
- `node scripts/build-personas.js --suite all --check` exits 0 when all outputs are up-to-date.
- `node scripts/build-personas.js` (no `--suite`) continues to produce identical ledger output to the current build (regression check).
- Vanilla VS Code files have `role:` matching a `KNOWN_ROLES` entry, use ledger-aligned identity titles in their mission text, **do not** have a `vs_file_name` field, and contain no MCP-related content.
- Vanilla Claude Code files have `permissionMode`, `model`, `memory`, a `name` ending in `-vanilla`, and **no** `mcpServers` block.
- Standalone VS Code files have `vs_file_name` and no `role` field.
- Standalone Claude Code files have `permissionMode`, `model`, `memory` and **no** `mcpServers` block.
- Every shared partial is referenced by at least one ledger content template AND at least one vanilla content template — confirming the sharing is real.
- `node scripts/sync-personas.js --dry-run` prints copy actions for ledger and standalone (not vanilla) without errors.

---

## Testing Strategy

- After WP-001: run `--suite ledger --check` to confirm zero regression in ledger output.
- After WP-004: automated acceptance test script (analogous to the `_qa-test-wpXXX.js` pattern used in previous implementations) that:
  - Asserts 7 files in each of `vanilla/vs-code/` and `vanilla/claude-code/`.
  - Asserts 6 files in each of `standalone/vs-code/` and `standalone/claude-code/`.
  - Validates frontmatter fields for each suite and target.
  - Confirms absence of unresolved `{{variable}}` markers in all generated output.
  - Confirms presence of auto-generated header in all generated output.
  - Confirms shared partials are referenced in both ledger and vanilla content templates.
- After WP-005: `--dry-run` output inspection to verify copy paths and filenames for ledger and standalone sync functions. Confirm vanilla directories do not appear in sync output.
- Manual spot-check: open one generated vanilla persona in a text editor and confirm the identity/title matches its ledger counterpart and contains no MCP content.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Ledger output regresses during shared partials extraction (WP-001)** | Run `--suite ledger --check` after every individual partial extraction. Use `--check` as a gate; do not proceed to WP-002 until all ledger output is identical to current. |
| **Shared partials don't cover all divergence between vanilla and ledger** | The shared partials represent the mechanical / structural content (templates, rules, protocol). Intentional narrative differences (role identity, ledger-specific steps) stay suite-local. Any remaining differences are documented as intentional in constraints.md. |
| **Standalone body content differs between vs-code and claude-code variants** | Before creating source files (WP-003), diff all 6 VS Code vs Claude Code standalone pairs. Where differences exist, the VS Code variant is the canonical source; differences become content notes for the developer. |
| **`sync-personas.js` build invocation becomes suite-unaware** | In WP-005 explicitly update the spawned `build-personas.js` call to `--suite all`, and add an integration test in the QA step to verify all three suite output dirs are populated after a sync --dry-run. |
| **Vanilla CC names conflict with ledger CC names if manually deployed** | Vanilla is not synced, so there is no automated collision risk. The `-vanilla` suffix on `cc_file_name` (e.g., `1-planner-vanilla.md` → `name: 1-planner-vanilla`) is a defensive measure: if a user manually copies a vanilla persona to `~/.claude/agents/`, it will coexist with the ledger variant rather than overwrite it. |
