# Plan — Synthesis Strategic Recommendations Cleanup

## Summary

Implement the six open strategic recommendations ("Gold Nuggets") identified in the Multi-IDE Persona Support project synthesis. These are low-to-medium priority maintenance improvements that reduce code duplication, remove dead code, improve DRYness, and add clarifying comments and documentation fixes across the personas build and sync pipeline. Gold Nugget #4 (document nested `{{#if}}` limitation) was already completed during the prior project and is excluded.

## Architectural Context

The personas sub-project uses a template engine (`scripts/build-personas.js`) that reads YAML metadata from `personas/ledger/src/meta/` and Markdown content templates from `personas/ledger/src/content/`, then generates 14 persona files across two output directories (`personas/ledger/vs-code/` and `personas/ledger/claude-code/`). A sync script (`scripts/sync-personas.js`) deploys generated files to OS-level IDE directories.

Key files involved in this plan:

| File | Role |
|------|------|
| `personas/ledger/src/meta/_shared.yaml` | Shared YAML metadata (version, mcp_server_name, CC settings) |
| `personas/ledger/src/meta/1-planner.yaml` … `7-synthesis.yaml` | Per-persona YAML metadata (role, tools, file names) |
| `scripts/build-personas.js` | Template engine — `cc_name` computed at line 319 |
| `scripts/sync-personas.js` | Sync engine — contains `extractVSFileName()`, `extractCCFileName()`, `findMarkdownFiles()`, `parseFrontmatter()` |
| `personas/docs/agents/project-manifest/api-surface.md` | Documents sync script functions (includes stale `findMarkdownFiles` entry) |
| `personas/docs/agents/project-manifest/constraints.md` | Constraint numbering (currently uses hybrid 9a, 11a, 11b system) |

## Approach / Architecture

Six independent, low-risk changes grouped into three work packages for efficient batching:

1. **WP-001 — Consolidate `cc_tools` and derive `cc_name` from YAML** (Gold Nuggets #1 + #5): Add `default_cc_tools` to `_shared.yaml`, update `build-personas.js` to use it as a fallback, and derive `cc_name` from `cc_file_name` rather than computing it. Removes identical 9-item arrays from 7 YAML files and makes `cc_name` verifiable against source YAML.

2. **WP-002 — Sync script cleanup** (Gold Nuggets #2, #3, #7): Collapse `extractVSFileName()`/`extractCCFileName()` into thin wrappers around `parseFrontmatter()`, delete the dead `findMarkdownFiles()` function, and add a clarifying comment at the `--dry-run` forwarding point in `main()`. Update `api-surface.md` to remove the `findMarkdownFiles` entry and reflect the simplified extract functions.

3. **WP-003 — Constraints numbering cleanup** (Gold Nugget #6): Renumber all constraints in `personas/docs/agents/project-manifest/constraints.md` to sequential integers (1–26), eliminating the hybrid 9a, 11a, 11b numbering introduced by multi-WP insertions.

## Rationale

- **WP batching**: Gold Nuggets #1 and #5 both modify the YAML-to-context pipeline in `build-personas.js` and touch the same YAML files — combining them avoids redundant rebuilds and test passes. Gold Nuggets #2, #3, and #7 all target `sync-personas.js` — combining them keeps the refactor atomic. Gold Nugget #6 is documentation-only and stands alone.
- **`default_cc_tools` follows the `default_version` pattern** already established in `_shared.yaml`, making it a natural extension rather than a new convention.
- **`cc_name` from `cc_file_name`** eliminates an implicit contract (the computed value must happen to match the YAML field) and replaces it with an explicit derivation: strip `.md` from `cc_file_name`.
- **Collapse extract functions**: Both `extractVSFileName()` (~25 lines) and `extractCCFileName()` (~25 lines) duplicate the frontmatter parsing that `parseFrontmatter()` already centralizes. Replacing them with one-liners that call `parseFrontmatter()` and read the appropriate field removes ~45 lines and makes future frontmatter changes single-point edits.

## Detailed Steps

### WP-001: Consolidate `cc_tools` and derive `cc_name`

1. Add a `default_cc_tools` array to `personas/ledger/src/meta/_shared.yaml` containing the 9 shared tools: `[Bash, Read, Edit, Write, Grep, Glob, Task, WebFetch, WebSearch]`.
2. In each of the 7 per-persona YAML files (`1-planner.yaml` through `7-synthesis.yaml`), remove the `cc_tools` key entirely (the shared default will apply). If a persona later needs differentiation, re-adding `cc_tools` to that persona's YAML will override the default.
3. In `scripts/build-personas.js` (around line 323), update the `cc_tools_json` computation to fall back to `sharedMeta.default_cc_tools` when `persona.cc_tools` is absent:
   ```js
   const ccTools = persona.cc_tools || sharedMeta.default_cc_tools || [];
   const cc_tools_json = serializeTools(ccTools);
   ```
4. In `scripts/build-personas.js` (line 319), replace the computed `cc_name` with a derivation from `cc_file_name`:
   ```js
   const cc_name = persona.cc_file_name.replace(/\.md$/, '');
   ```
5. Run `node scripts/build-personas.js --check` to verify all 14 output files are unchanged.
6. Update `personas/docs/agents/project-manifest/api-surface.md` — metadata schema section — to document `default_cc_tools` and the `cc_name` derivation.
7. Update `personas/docs/agents/project-manifest/constraints.md` — add a note that `cc_tools` in per-persona YAML overrides `default_cc_tools` in `_shared.yaml`.

### WP-002: Sync script cleanup

1. In `scripts/sync-personas.js`, replace the body of `extractVSFileName()` (lines 82–103) with:
   ```js
   function extractVSFileName(filePath) {
     const fields = parseFrontmatter(filePath);
     return fields?.vs_file_name || null;
   }
   ```
2. Replace the body of `extractCCFileName()` (lines 112–137) with:
   ```js
   function extractCCFileName(filePath) {
     const fields = parseFrontmatter(filePath);
     return fields?.name ? fields.name.trim() + '.md' : null;
   }
   ```
3. Delete the `findMarkdownFiles()` function (lines 143–160) entirely — it is no longer referenced anywhere in the codebase.
4. Add a comment at the `--dry-run` forwarding line in `main()` (around line 498 where `if (dryRun) buildArgs.push('--dry-run');`):
   ```js
   // NOTE: --dry-run is forwarded to build-personas.js, which previews but
   // does not regenerate output files. syncFromDir() then reads from the
   // existing output directories. On a clean checkout where output dirs
   // don't exist yet, a dry-run will report stale or empty content.
   ```
5. In `personas/docs/agents/project-manifest/api-surface.md`, remove the `findMarkdownFiles` row from the Sync Script Functions table, and update the `extractVSFileName` / `extractCCFileName` descriptions to note they delegate to `parseFrontmatter()`.
6. Run the existing validation: `node scripts/sync-personas.js --dry-run` to confirm behavior is unchanged.

### WP-003: Constraints numbering cleanup

1. Renumber all constraints in `personas/docs/agents/project-manifest/constraints.md` to use sequential integers 1–26, replacing the current hybrid scheme (where 9a → 10, original 10 → 11, 11a → 13, 11b → 14, and so on with all subsequent numbers shifted).
2. Verify no other file in the workspace references constraint numbers by number (search for "constraint #" or "constraint 9a" etc.). If any do, update those references.
3. Run `node scripts/build-personas.js --check` to confirm the documentation-only change has no build impact.

## Dependencies

- WP-001 and WP-002 are independent of each other and can be executed in parallel.
- WP-003 is independent of both WP-001 and WP-002.
- All three WPs depend on the completed Multi-IDE Persona Support project (already COMPLETE).

## Required Components

### Modified files

| WP | File | Change |
|----|------|--------|
| WP-001 | `personas/ledger/src/meta/_shared.yaml` | Add `default_cc_tools` array |
| WP-001 | `personas/ledger/src/meta/1-planner.yaml` … `7-synthesis.yaml` | Remove `cc_tools` key |
| WP-001 | `scripts/build-personas.js` | `cc_tools_json` fallback + `cc_name` derivation |
| WP-001 | `personas/docs/agents/project-manifest/api-surface.md` | Document `default_cc_tools`, `cc_name` derivation |
| WP-001 | `personas/docs/agents/project-manifest/constraints.md` | Add `cc_tools` override note |
| WP-002 | `scripts/sync-personas.js` | Simplify extract functions, remove dead code, add comment |
| WP-002 | `personas/docs/agents/project-manifest/api-surface.md` | Remove `findMarkdownFiles`, update extract function docs |
| WP-003 | `personas/docs/agents/project-manifest/constraints.md` | Renumber to sequential integers |

### No new files or external services required.

## Assumptions

- The `cc_tools` list is currently identical across all 7 personas. This was verified during WP-002 of the prior project and confirmed via the synthesis.
- No persona currently needs a differentiated `cc_tools` list. The override mechanism (`persona.cc_tools || sharedMeta.default_cc_tools`) preserves the ability to differentiate in the future.
- `cc_file_name` is present and well-formed in all 7 per-persona YAMLs (verified by prior project's acceptance tests).
- No file outside `constraints.md` references constraint numbers by their hybrid identifiers (9a, 11a, 11b).

## Constraints

- Generated output files (`personas/ledger/vs-code/`, `personas/ledger/claude-code/`) must remain byte-identical after WP-001 and WP-002 changes. These are refactors, not behavioral changes.
- `build-personas.js --check` must pass after every WP.
- Follow the Edit → Build → Verify workflow per constraint #3 in `constraints.md`.

## Out of Scope

- **Gold Nugget #4** (document nested `{{#if}}` limitation) — already completed in the prior project.
- **Adding a third IDE target** (Cursor, Windsurf) — mentioned in synthesis Next Steps but is a separate feature, not a cleanup recommendation.
- **`--target claude-code` help text for sync-personas.js** — already present in the `--help` output (verified: lines 489–503 of `sync-personas.js`).
- **Running `node scripts/sync-personas.js`** for live deployment — the user will handle this separately.

## Acceptance Criteria

### WP-001
- AC1: `_shared.yaml` contains a `default_cc_tools` array with 9 tools.
- AC2: None of the 7 per-persona YAMLs contain a `cc_tools` key.
- AC3: `build-personas.js` uses `persona.cc_tools || sharedMeta.default_cc_tools` for `cc_tools_json`.
- AC4: `cc_name` is derived as `persona.cc_file_name.replace(/\.md$/, '')`.
- AC5: `node scripts/build-personas.js --check` passes — all 14 output files are identical to current state.
- AC6: `api-surface.md` documents `default_cc_tools` and the `cc_name` derivation.

### WP-002
- AC1: `extractVSFileName()` delegates to `parseFrontmatter()` (≤5 lines).
- AC2: `extractCCFileName()` delegates to `parseFrontmatter()` (≤5 lines).
- AC3: `findMarkdownFiles()` function is removed from `sync-personas.js`.
- AC4: `findMarkdownFiles` entry is removed from `api-surface.md`.
- AC5: `--dry-run` forwarding comment is present in `main()`.
- AC6: `node scripts/sync-personas.js --dry-run` produces identical output to current behavior.

### WP-003
- AC1: All constraints in `constraints.md` use sequential integer numbering (1–N), with no 9a, 11a, 11b identifiers remaining.
- AC2: No file in the workspace has a broken reference to a now-renumbered constraint.

## Testing Strategy

- **Build verification**: `node scripts/build-personas.js --check` after WP-001 and WP-002 — must confirm all 14 files are up-to-date and byte-identical.
- **Sync dry-run**: `node scripts/sync-personas.js --dry-run` after WP-002 — must produce the same copy manifest as before the refactor.
- **Diff verification**: For WP-001, diff each generated output file before/after to confirm zero changes.
- **Grep verification**: For WP-002 AC3, `grep -n findMarkdownFiles scripts/sync-personas.js` must return zero results. For WP-003 AC1, `grep -n '9a\|11a\|11b' personas/docs/agents/project-manifest/constraints.md` must return zero results.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`cc_name` derivation produces different value than current computation** | Both produce the same value by construction (e.g., `cc_file_name: 2-project-manager.md` → strip `.md` → `2-project-manager`; computed: `2-project-manager`). Verify with `--check` after change. |
| **Future persona needs differentiated `cc_tools`** | The `persona.cc_tools \|\| sharedMeta.default_cc_tools` fallback preserves per-persona override capability — just re-add `cc_tools` to that persona's YAML. |
| **`parseFrontmatter()` returns different values than old extract functions** | Both use the same regex-based parsing. The only difference is the old functions read the file themselves while `parseFrontmatter()` also reads the file. Dry-run comparison will catch discrepancies. |
| **Constraint renumbering breaks external references** | Grep the workspace for constraint number references before renumbering. The hybrid numbers (9a, 11a, 11b) are unlikely to be referenced outside the constraints file itself. |
