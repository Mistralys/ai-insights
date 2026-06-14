# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.5.0
- Architectural Reviews: 2 — Plan Architect Reviewer v1.6.0

## Prior Project Context
The most recent completed project (`2026-06-13-changelog-derived-versioning`) introduced changelog-derived versioning with `resolveChangelogMeta()` across the persona builder and all 37 persona files. The `ledger-support` suite's personas will inherit this mechanism — each persona's `changelog:` field drives `version` and `last_updated` automatically. No versioning-related changes are needed for the move.

## Summary
Move the 9 ledger-related standalone personas (all sharing the `ledger-` prefix) from `personas/standalone/` into a new third suite at `personas/ledger-support/`. This separates ledger workflow utilities that depend on the `central_pm` MCP server from truly independent standalone agents. The persona builder library already supports arbitrary suites via the `suites` map in `BuildConfig`, so **no library changes are needed** — the work is entirely configuration and consumer updates on the ai-insights side.

## Architectural Context
The persona build system uses `@mistralys/persona-builder`, configured via `personas/persona-build.config.js`. The `suites` map currently defines two suites (`ledger` and `standalone`), each with `srcDir`, output directories, and a `personaMode`. The builder's `buildSuite()` and `buildAgentNameMap()` functions iterate all configured suites — adding a third is a config-level change.

Key downstream consumers that hardcode `personas/standalone/` paths:
- `scripts/sync-personas.js` — sync functions per suite for VS Code and Claude Code deployment
- `scripts/package-personas.js` — packaging entries for distribution archives
- `orchestrator/src/utils/subagents.py` — path constants for subagent YAML and deep-agents resolution
- `.gitignore` — ignore rules for generated output directories

The 9 personas to move all share the `ledger-` slug prefix. Four of them (`ledger-bootstrapper`, `ledger-wp-decomposer`, `ledger-dependency-sequencer`, `ledger-pipeline-configurator`) are declared as subagents in the PM's ledger persona YAML and resolved by the orchestrator at runtime.

## Approach / Architecture
Add a third suite entry `'ledger-support'` to `persona-build.config.js` with `personaMode: 'standalone'` (same mode — slug-based, no `role` field). Move the 9 ledger-related source files (meta YAML + content Markdown) from `standalone/src/` to `ledger-support/src/`. Create a dedicated `_shared.yaml` for the new suite that carries `mcp_server_name: central_pm` as a shared default, eliminating per-persona hardcoding.

Update all downstream consumers to handle the third suite: sync script, package script, orchestrator subagent resolver, `.gitignore`, and documentation.

## Rationale
- **Clean separation:** Ledger workflow utilities (MCP-dependent, used as subagents) are structurally distinct from general-purpose standalone agents (no MCP dependency, no ledger affinity).
- **Shared `_shared.yaml`:** Currently 5 of the 9 personas hardcode `mcp_server_name: central_pm` individually because the standalone `_shared.yaml` constraint (C19) forbids it. A dedicated suite removes this workaround — the shared YAML carries the MCP server name once.
- **No library changes:** The persona builder already supports N suites. This is purely a config + consumer change.
- **Future-proofing:** Adding a fourth suite later follows the same pattern.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Suite separation strategy | New third suite via build config | Subdirectories within standalone; Naming convention only | Third suite requires no library changes and provides full structural separation (distinct source + output). Subdirectories would require library changes to support recursive YAML discovery. Convention-only doesn't address the organizational concern. |
| Sync script approach | Thin sync wrappers + parameterized validation functions | Fully duplicated per-suite functions; Generalize sync to iterate suites from config | Sync wrappers are 3-line delegates (tolerable duplication). Validation functions are ~30 lines of identical rule logic — parameterizing them to accept a suite label avoids copy-pasting while keeping the sync wrappers pattern-consistent. Full generalization is a follow-up. |
| Orchestrator path resolution | Add second search path to subagents.py | Data-driven path resolution from manifest | Adding a second constant is simple and sufficient at current scale (~4 subagent declarations). Manifest-driven resolution is over-engineering for the current need. |
| `id` prefix for moved personas | Preserve `standalone-*` ids; new personas use `ledger-support-{slug}` | Rename moved ids to `ledger-support-*`; Use `standalone-*` for all slug-mode personas | C24 mandates id stability — renaming breaks VS Code `@id` routing. New personas use `ledger-support-{slug}` for consistency with suite membership, accepting that moved personas retain their legacy `standalone-*` prefix as a permanent historical artifact. |

## Pattern Alignment
- **Suite config pattern** (`personas/persona-build.config.js` — `suites` map): Followed exactly. The new entry mirrors the `standalone` suite structure with its own `srcDir`, `outVscode`, `outClaudeCode`, and `outputDirs`.
- **Sync script per-suite pattern** (`scripts/sync-personas.js` — dedicated sync + validation functions per suite): Partially followed. New `syncLedgerSupportVSCode()` and `syncLedgerSupportClaudeCode()` sync wrappers mirror the existing standalone pattern (thin delegates to `syncFromDir()`). Departed for validation: instead of duplicating the ~30-line validation functions, the existing `validateStandaloneVSCodeFrontmatter()` / `validateStandaloneCCFrontmatter()` are refactored into parameterized `validateSlugModeVSCodeFrontmatter(dir, suiteLabel)` / `validateSlugModeCCFrontmatter(dir, suiteLabel)`, called by both standalone and ledger-support sync functions. This avoids copy-pasting identical rule logic — both suites use the same slug-based validation rules.
- **`.gitignore` per-suite pattern**: Followed. Three new ignore rules mirror the existing standalone rules.
- **`_shared.yaml` per suite**: Followed. Each suite has its own shared metadata file.
- **Constraint C19** (`personas/docs/agents/project-manifest/constraints.md`): Departed — the constraint states "Standalone `_shared.yaml` must not contain `mcp_server_name`." The new `ledger-support` suite's `_shared.yaml` WILL contain `mcp_server_name: central_pm` because these personas are not independent standalone agents. The constraint must be updated to scope its prohibition to the `standalone` suite only, not all non-ledger suites.

## Detailed Steps

### Step 1: Create the `ledger-support` directory structure
Create the following directories:
- `personas/ledger-support/src/meta/`
- `personas/ledger-support/src/content/`

The output directories (`vs-code/`, `claude-code/`, `deep-agents/`) will be created automatically by the build system.

### Step 2: Create `personas/ledger-support/src/meta/_shared.yaml`
Create a `_shared.yaml` for the new suite containing:
```yaml
author: Sebastian Mordziol
default_version: "1.0.0"
mcp_server_name: central_pm
cc_permission_mode: "acceptEdits"
cc_model: "inherit"
cc_memory: "project"
default_cc_tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Task
  - WebFetch
  - WebSearch
  - TodoRead
  - TodoWrite
```

This is identical to `standalone/_shared.yaml` plus `mcp_server_name: central_pm`.

### Step 3: Move the 9 ledger-related persona source files
Move meta YAML and content Markdown files from `standalone/src/` to `ledger-support/src/`.

**Important — `id` field stability:** All 9 personas carry `id` values prefixed with `standalone-` (e.g., `id: standalone-ledger-bootstrapper`). Per constraint C24, these ids must **never change** once published — they are VS Code `@id` routing keys. Preserve all existing `id` values exactly as-is after the move. The `standalone-*` prefix becomes a permanent historical artifact for these 9 personas. New personas created in the `ledger-support` suite in the future must use the `ledger-support-{slug}` prefix convention (see Step 14 for C24 update).

**Meta files** (`src/meta/`):
1. `ledger-bootstrapper.yaml`
2. `ledger-claude-coordinator.yaml`
3. `ledger-dependency-sequencer.yaml`
4. `ledger-doctor.yaml`
5. `ledger-knowledge-archiver.yaml`
6. `ledger-knowledge-curator.yaml`
7. `ledger-orchestrator-runner.yaml`
8. `ledger-pipeline-configurator.yaml`
9. `ledger-wp-decomposer.yaml`

**Content files** (`src/content/`):
1. `ledger-bootstrapper.md`
2. `ledger-claude-coordinator.md`
3. `ledger-dependency-sequencer.md`
4. `ledger-doctor.md`
5. `ledger-knowledge-archiver.md`
6. `ledger-knowledge-curator.md`
7. `ledger-orchestrator-runner.md`
8. `ledger-pipeline-configurator.md`
9. `ledger-wp-decomposer.md`

### Step 4: Remove per-persona `mcp_server_name` from moved YAMLs
After moving, remove `mcp_server_name: central_pm` from the 5 persona YAMLs that hardcode it (`ledger-bootstrapper`, `ledger-claude-coordinator`, `ledger-doctor`, `ledger-knowledge-archiver`, `ledger-knowledge-curator`), since this value is now inherited from the suite's `_shared.yaml`.

### Step 5: Add the `ledger-support` suite to `persona-build.config.js`
Add a third suite entry to the `suites` map in `personas/persona-build.config.js`:
```js
'ledger-support': {
  srcDir:        path.join(ROOT, 'personas', 'ledger-support', 'src'),
  outVscode:     path.join(ROOT, 'personas', 'ledger-support', 'vs-code'),
  outClaudeCode: path.join(ROOT, 'personas', 'ledger-support', 'claude-code'),
  outputDirs: {
    'deep-agents': path.join(ROOT, 'personas', 'ledger-support', 'deep-agents'),
  },
  personaMode: 'standalone',
},
```

### Step 6: Add `.gitignore` rules for `ledger-support` output
Add three new ignore rules alongside the existing standalone rules:
```
/personas/ledger-support/claude-code/*.md
/personas/ledger-support/vs-code/*.md
/personas/ledger-support/deep-agents/*.md
```

### Step 7: Update `scripts/sync-personas.js`
1. **Parameterize validation functions:** Rename `validateStandaloneVSCodeFrontmatter(dir)` → `validateSlugModeVSCodeFrontmatter(dir, suiteLabel)` and `validateStandaloneCCFrontmatter(dir)` → `validateSlugModeCCFrontmatter(dir, suiteLabel)`. All hardcoded `'standalone'` references within the function bodies must use the `suiteLabel` parameter — this includes the console header/footer labels, the `relPath` construction (`path.join(suiteLabel, 'vs-code', file)` / `path.join(suiteLabel, 'claude-code', file)`) used in warning messages, and the success summary. The validation rules themselves (slug-based, no `role` field) are identical across suites. Update existing `syncStandaloneVSCode()` and `syncStandaloneClaudeCode()` to call the renamed functions with `'standalone'` as the suite label.
2. Add `syncLedgerSupportVSCode(dryRun, customPath)` function — mirrors `syncStandaloneVSCode()` but sources from `personas/ledger-support/vs-code/` and calls `validateSlugModeVSCodeFrontmatter(dir, 'ledger-support')`.
3. Add `syncLedgerSupportClaudeCode(dryRun)` function — mirrors `syncStandaloneClaudeCode()` but sources from `personas/ledger-support/claude-code/` and calls `validateSlugModeCCFrontmatter(dir, 'ledger-support')`.
4. Update the `--suite` argument in the `main()` function's `buildArgs` from `'ledger,standalone'` to `'ledger,standalone,ledger-support'`.
5. Add calls to `syncLedgerSupportVSCode()` and `syncLedgerSupportClaudeCode()` in the main sync flow (after the standalone sync calls).

### Step 8: Update `scripts/package-personas.js`
1. **Update the build invocation** to include the `ledger-support` suite. The current `execSync()` call is scoped to `--suite standalone` — change it to `--suite standalone,ledger-support` so the ledger-support output directories are populated before packaging.
2. Add two packaging entries for the new suite's output directories:
   ```js
   { dir: 'personas/ledger-support/vs-code',     label: 'VS Code (Ledger Support)',     slug: 'ledger-support-vscode'     },
   { dir: 'personas/ledger-support/claude-code', label: 'Claude Code (Ledger Support)', slug: 'ledger-support-claudecode' },
   ```
3. **Distribution:** Package `ledger-support` personas in **separate archives** from standalone. They have an MCP server dependency (`central_pm`) that standalone personas do not — bundling them together would undermine the separation this plan creates. The two new packaging entries above already produce distinct archive slugs (`ledger-support-vscode`, `ledger-support-claudecode`).

### Step 9: Update `orchestrator/src/utils/subagents.py`
Update the subagent path resolution to search the `ledger-support` suite directory. Change the hardcoded constants and lookup logic:

1. Add new path constants:
   ```python
   _LEDGER_SUPPORT_META_RELATIVE = Path("personas") / "ledger-support" / "src" / "meta"
   _LEDGER_SUPPORT_DEEP_AGENTS_RELATIVE = Path("personas") / "ledger-support" / "deep-agents"
   ```

2. Update the resolution logic in `load_subagents()` to search `ledger-support` first, then fall back to `standalone`:
   ```python
   # Try ledger-support first, then standalone
   for meta_rel, da_rel in [
       (_LEDGER_SUPPORT_META_RELATIVE, _LEDGER_SUPPORT_DEEP_AGENTS_RELATIVE),
       (_STANDALONE_META_RELATIVE, _STANDALONE_DEEP_AGENTS_RELATIVE),
   ]:
       yaml_path = workspace_root / meta_rel / f"{slug}.yaml"
       if yaml_path.exists():
           # resolve from this suite
           ...
   ```

### Step 10: Update `orchestrator/tests/test_subagents.py`
Update test fixtures to create persona files in `personas/ledger-support/` instead of (or in addition to) `personas/standalone/` for the ledger-related slug fixtures.

**Note:** The `TestRealWorkspace` integration test class (e.g. `test_pm_returns_four_specs`) uses the real workspace — no fixture changes needed for those tests. They will automatically validate end-to-end path resolution after the Step 9 Python code change lands. Step 9 must be completed before running these integration tests.

### Step 11: Create `personas/ledger-support/README.md`
Create a README for the new suite documenting its purpose (ledger workflow utility agents), the relationship to the main ledger pipeline, the PM sub-agent cluster, and the persona catalog.

### Step 12: Update `personas/standalone/README.md`
Update to reflect the reduced set of 19 personas. Remove the "PM Sub-Agent Cluster" section and the 4 PM sub-agent entries from the catalog. Remove the ledger-related entries from the "Ledger Workflow Utilities" section (or the entire section). Update the persona count.

### Step 13: Update `personas/module-context.yaml`
Add a new CTX document entry for the `ledger-support` suite guide (sourcing `ledger-support/README.md`) and a metadata document (sourcing `ledger-support/src/meta/`). Remove moved persona metadata entries from the standalone metadata document source if needed.

### Step 14: Update documentation — Personas manifest
Update the following files in `personas/docs/agents/project-manifest/`:

- **`constraints.md`**: Update constraint C19 to scope the `mcp_server_name` prohibition to the `standalone` suite only. Add `ledger-support` directories to the directory layout table (C2a). Update the shadowing risk note to reference `ledger-support/_shared.yaml` instead of per-persona hardcoding. Update generated output directory references in constraint C1/C45. **Update constraint C24** to document the `id` namespace policy: moved personas retain their `standalone-*` ids permanently (stability rule); new personas created in `ledger-support/` use the `ledger-support-{slug}` prefix convention.
- **`constraints-cross-system.md`**: Update the subagent sync contract to reference both `standalone` and `ledger-support` suite paths.
- **`constraints-build-system.md`**: Update the resolution instructions referencing `personas/standalone/`.
- **`api-surface.md`**: Update the sync function documentation, subagent metadata schema section, frontmatter template descriptions, and the standalone suite description. Add `ledger-support` as a documented suite.
- **`data-flows.md`**: Update the ASCII art output directory diagram to include `ledger-support/` output dirs.
- **`variables.md`**: Update example paths if they reference standalone for ledger-related personas.

### Step 15: Update documentation — Orchestrator manifest
Update the following files in `orchestrator/docs/`:

- **`agents/project-manifest/constraints.md`**: Update the subagent sync contract.
- **`agents/project-manifest/api-surface.md`**: Update the `load_subagents()` function signature docs.
- **`architecture.md`**: Update the subagent resolution table and function docs.
- **`public-api.md`**: Update the `load_subagents()` API docs.

### Step 16: Update root documentation
- **`AGENTS.md`**: Update the "Which Manifest?" table, cross-system dependencies section (subagent paths), directory layout references, the `.context/` table, the "Workspace Architecture" table description (mentions "ledger and standalone" — add `ledger-support`), and the "Project Statistics" table Personas description. `CLAUDE.md` is auto-generated from `AGENTS.md` and will be regenerated.
- **`README.md`**: Update the suite table to include `personas/ledger-support/`.
- **`personas/docs/persona-build-system.md`**: Update the suite table.

### Step 17: Build and verify
1. Run `node scripts/build-personas.js` to build all three suites.
2. Verify the output directories are populated correctly: `personas/ledger-support/vs-code/`, `personas/ledger-support/claude-code/`, `personas/ledger-support/deep-agents/`.
3. Run `node scripts/build-personas.js --check --strict` to confirm byte-identical output.
4. Run the orchestrator subagent tests: `cd orchestrator && python -m pytest tests/test_subagents.py`.
5. Run MCP server tests: `cd mcp-server && npm test`.
6. Run root-level tests: `npm test` from workspace root.

### Step 18: Regenerate `.context/` docs
Run `node scripts/cli.js ctx-generate` to regenerate all `.context/` files, then run `node scripts/normalize-ctx-paths.js` to normalize paths.

## Dependencies
- `@mistralys/persona-builder` library — no changes required (existing multi-suite support)
- `shared/workflow-manifest.json` — no changes required (role names unchanged)
- `personas/name-mapping.json` — no changes required (only tracks ledger numbered personas)

## Required Components
- `personas/persona-build.config.js` — add third suite entry (existing file)
- `personas/ledger-support/src/meta/_shared.yaml` — **new file**
- `personas/ledger-support/src/meta/*.yaml` — moved from `standalone/src/meta/` (9 files)
- `personas/ledger-support/src/content/*.md` — moved from `standalone/src/content/` (9 files)
- `personas/ledger-support/README.md` — **new file**
- `scripts/sync-personas.js` — add sync + validation functions (existing file)
- `scripts/package-personas.js` — add build + packaging entries (existing file)
- `orchestrator/src/utils/subagents.py` — add ledger-support path resolution (existing file)
- `orchestrator/tests/test_subagents.py` — update test fixtures (existing file)
- `.gitignore` — add output ignore rules (existing file)

## Assumptions
- The `recipe-curator` persona stays in `standalone/` — it does not have the `ledger-` prefix and its ledger affinity is unconfirmed.
- The `personaMode` for the new suite is `'standalone'` (slug-based, no `role` field) — same as the existing standalone suite.
- No personas have suite-specific partials in `personas/standalone/src/partials/` that would need moving. If any exist, they should be moved to `personas/ledger-support/src/partials/`.
- The cross-suite `agent_*` template variables continue to include all suites automatically (builder behavior — verified in research).

## Constraints
- The persona builder library (`@mistralys/persona-builder`) must not be modified.
- File moves must preserve Git history where possible (use `git mv`).
- Generated output directories (`vs-code/`, `claude-code/`, `deep-agents/`) are gitignored and must not be committed.
- The `ledger-support` suite uses the same frontmatter templates as the `standalone` suite (config-level defaults apply to both).
- Moved personas must preserve their existing `standalone-*` `id` values (C24 stability rule — VS Code `@id` routing key). New personas in `ledger-support/` use the `ledger-support-{slug}` prefix.

## Out of Scope
- Generalizing the sync script to iterate suites from config (follow-up improvement).
- Making the orchestrator's subagent path resolution fully data-driven from the manifest.
- Moving `recipe-curator` — requires content review to confirm ledger affinity.
- Adding a fourth suite or refactoring the suite architecture beyond what's needed for this move.

## Acceptance Criteria
- All 9 `ledger-*` personas build successfully from `personas/ledger-support/src/` and produce correct output in `personas/ledger-support/vs-code/`, `personas/ledger-support/claude-code/`, and `personas/ledger-support/deep-agents/`.
- The remaining 19 personas in `personas/standalone/` build successfully and are unchanged in output.
- `node scripts/build-personas.js --check --strict` passes with zero warnings.
- The orchestrator resolves subagent personas from `personas/ledger-support/` correctly.
- `orchestrator/tests/test_subagents.py` passes.
- `node scripts/sync-personas.js --dry-run` shows all three suites being synced.
- Root-level tests pass (`npm test`).
- MCP server tests pass (`cd mcp-server && npm test`).
- The `ledger-support` suite's `_shared.yaml` carries `mcp_server_name: central_pm` and individual persona YAMLs no longer hardcode it.
- All documentation files referenced in the Detailed Steps are updated.
- `.context/` files are regenerated and reflect the new structure.

## Testing Strategy
This is primarily a structural/configuration change with no new logic. Testing focuses on:
1. **Build verification:** The persona build system produces correct output for all three suites.
2. **Strict check:** `--check --strict` confirms byte-identical output.
3. **Orchestrator integration:** Subagent resolution finds personas in the new location.
4. **Regression:** Existing standalone and ledger personas are unaffected.

## Test Plan
- `node scripts/build-personas.js --check --strict` — Verifies all three suites build cleanly with no drift — covers AC "build successfully" and "zero warnings"
- `orchestrator/tests/test_subagents.py` — Verifies subagent resolution from `ledger-support/` paths — covers AC "orchestrator resolves subagent personas"
- `npm test` (workspace root) — Verifies root-level script tests pass — covers AC "root-level tests pass"
- `cd mcp-server && npm test` — Verifies MCP server tests pass — covers AC "MCP server tests pass"
- `node scripts/sync-personas.js --dry-run` — Verifies all three suites appear in sync output — covers AC "three suites being synced"

## Documentation Updates
- `personas/docs/agents/project-manifest/constraints.md` — Update C19 scope, C1/C45 directory list, C2a directory layout table, shadowing risk note
- `personas/docs/agents/project-manifest/constraints-cross-system.md` — Update subagent sync contract paths
- `personas/docs/agents/project-manifest/constraints-build-system.md` — Update resolution instructions
- `personas/docs/agents/project-manifest/api-surface.md` — Add ledger-support suite documentation, update sync function docs (reflect parameterized validation function rename)
- `personas/docs/agents/project-manifest/data-flows.md` — Update output directory diagram
- `personas/docs/agents/project-manifest/variables.md` — Update example paths
- `personas/docs/persona-build-system.md` — Update suite table
- `personas/standalone/README.md` — Remove ledger-related entries, update persona count
- `personas/ledger-support/README.md` — **New** — Suite documentation
- `orchestrator/docs/agents/project-manifest/constraints.md` — Update subagent sync contract
- `orchestrator/docs/agents/project-manifest/api-surface.md` — Update `load_subagents()` docs
- `orchestrator/docs/architecture.md` — Update subagent resolution table
- `orchestrator/docs/public-api.md` — Update `load_subagents()` docs
- `AGENTS.md` — Update cross-system deps, directory layout references, Which Manifest table
- `README.md` — Update suite table
- `personas/module-context.yaml` — Add ledger-support CTX document entries
- `.context/` — Regenerate via `ctx-generate` (auto-generated, not hand-edited)

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Orchestrator subagent resolution fails after move** | The fallback search strategy (try `ledger-support` first, then `standalone`) ensures backward compatibility during transition. Test with `test_subagents.py`. |
| **Build system doesn't discover the new suite** | The suite key in `persona-build.config.js` is the only config needed — verified by the research that `buildSuite()` iterates all configured suites. Run `--check --strict` to confirm. |
| **Sync script misses the new suite** | Explicit new sync function calls in `main()` and updated `--suite` argument ensure coverage. `--dry-run` verification before live sync. |
| **Cross-suite agent name map breaks** | `buildAgentNameMap()` pre-scans all configured suites — verified in research. Agent name variables (`agent_*`) will include ledger-support personas automatically. |
| **Git history lost on file move** | Use `git mv` for all file moves to preserve history tracking. |
| **Stale `.context/` docs after move** | Regenerate via `ctx-generate` as the final step. |
| **Developer changes moved persona `id` values** | Step 3 explicitly documents the C24 stability rule. Step 14 updates C24 with the namespace convention for both moved and new personas. |
| **Package script produces empty ledger-support archives** | Step 8 updates the build invocation to include `--suite ledger-support` before packaging. |
