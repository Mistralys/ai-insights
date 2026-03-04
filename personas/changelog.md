# Personas Changelog

## v3.6.3 - Strict Mode Limitations Documentation (2026-02-23)
- **GN-4 documented in `constraints.md`:** Added sub-note to constraint 9 describing the `--strict` regex code-fence false-positive risk — the scan would flag literal `{{…}}` inside fenced code blocks. No current persona triggers this; mitigation path noted.
- **GN-5 documented in `constraints.md`:** Added sub-note to constraint 9 describing the `--check` + `--strict` exit ordering — when `--check` fires first and exits 1, the `[STRICT]` scan output is skipped. CI guidance: run `--check` as a separate step if strict failure details are needed.
- **GN-6: Quick commands sections added:** `personas/ledger/README.md` and `personas/vanilla/README.md` both now include a `--strict` entry with a one-line description in their quick-command blocks. The vanilla README received a new Quick commands section (it had none before).
- **`api-surface.md` updated:** `--strict` CLI flag description now cross-references constraint 9 GN-4 and GN-5 for the known limitations.
- **Inline comment in `scripts/build-personas.js`:** The `--strict` scan block now has an inline comment documenting the code-fence false-positive risk.

## v3.6.2 - cc_file_name Validation Guard (2026-02-23)
- **Fail-fast guard for `cc_file_name`:** `scripts/build-personas.js` now emits `[ERROR] cc_file_name is required for persona '…' in suite '…'` and calls `process.exit(1)` when any per-persona YAML is processed without a `cc_file_name` field. Applies to both `numbered` and `standalone` persona modes.
- **Removed silent fallback:** The defensive ternary (`persona.cc_file_name ? … : ''`) at both usage sites in `buildForTarget()` has been replaced with a direct `.replace()` call after the guard, eliminating the "empty string" silent-failure mode.
- **Updated `api-surface.md`:** All three `cc_file_name` schema rows (ledger, vanilla, standalone) now document the required-field behavior and `[ERROR]` + `process.exit(1)` exit, consistent with `default_version`.

## v3.6.1 - Remove Vanilla Flat Files (2026-02-23)
- **Deleted legacy flat persona files:** Removed `personas/vanilla/1-planner.md` through `personas/vanilla/7-synthesis.md` — seven hand-authored copies that pre-dated the template system and contained stale role names. The canonical outputs are `personas/vanilla/vs-code/` and `personas/vanilla/claude-code/`.
- **Updated `personas/vanilla/README.md`:** Added a prominent "Canonical Output Directories" redirect section near the top making the new source-of-truth directories explicit. Updated all 14 inline links in Quick Reference and stage-detail sections to point to `vs-code/` equivalents.
- **No template sources changed:** All `personas/vanilla/src/` files are untouched; the build pipeline and generated outputs are unaffected.

## v3.6.0 - Multi-IDE Persona Support (2026-02-23)
- **Multi-IDE output directories:** Build system now generates two separate output directories: `personas/ledger/vs-code/` (VS Code frontmatter with `tools`, `vs_file_name`) and `personas/ledger/claude-code/` (Claude Code frontmatter with `name`, `permissionMode`, `model`, `memory`, `mcpServers`). The old flat `ledger/*.md` output is replaced entirely.
- **`--target` CLI flag:** Both `build-personas.js` and `sync-personas.js` now accept `--target vscode`, `--target claude-code`, or `--target all` (default) to build/sync a single IDE or both simultaneously.
- **`{{else}}` template engine support:** Conditionals now support an optional `{{else}}` branch: `{{#if flag}}…{{else}}…{{/if}}`. Used by all agent content templates to select platform-specific partials.
- **Platform-specific partials:** Split `handoff-block.md` into `handoff-block-vscode.md` and `handoff-block-claude-code.md`; split `mcp-preflight-header.md` into `mcp-preflight-header-vscode.md` and `mcp-preflight-header-claude-code.md`. Content templates select the correct partial via `{{#if target_vscode}}…{{else}}…{{/if}}`.
- **Claude Code frontmatter template (`FRONTMATTER_CLAUDE_CODE`):** New template emits `name` (kebab slug), `permissionMode`, `model`, `memory`, and `mcpServers` fields required by Claude Code agent definitions.
- **New metadata fields:** `cc_file_name` and `cc_tools` added to all 7 per-persona YAML files; `cc_permission_mode`, `cc_model`, and `cc_memory` added to `_shared.yaml`.
- **Computed variables:** `cc_name`, `cc_description`, and `cc_tools_json` added to the build context for Claude Code frontmatter rendering.
- **Standalone Claude Code personas:** New `personas/standalone/claude-code/` directory with CC variants of all 6 standalone personas. `sync-personas.js` now calls `syncStandaloneClaudeCode()` when the Claude Code target is active.
- **`sync-personas.js` improvements:** Added `syncClaudeCode()`, `syncStandaloneClaudeCode()`, `getClaudeCodeAgentsDir()`, `extractCCFileName()`, `validateCCFrontmatter()`, and `validateStandaloneCCFrontmatter()` functions. Reads from explicit subdirectories rather than walking the full `ledger/` tree.

## v3.5.0 - Role Boundaries & Mandatory Handoffs (2026-02-22)
- **New partial `role-boundaries.md`:** Shared fragment instructing agents to (1) only use MCP tools listed in their table and (2) only work on WPs assigned to their role via `ledger_get_next_action`. Included in all 6 MCP-enabled personas (2–7).
- **Updated `handoff-block.md`:** Changed heading from "Handoff:" to "Handoff (mandatory):" and added explicit instruction that the handoff call must happen before ending the turn. Applies to agents 3–6.
- **Project Manager (2):** Updated inline handoff step to use "(mandatory)" language matching the shared partial.
- **Developer (3):** Added explicit "Repeat" loop step in workflow (check next action → implement → repeat). Added "Role Scope" and "No Status Overrides" strict constraints.
- **All MCP personas (2–7):** Now include `{{> role-boundaries}}` after `{{> mcp-intro}}`.
- Addresses workflow failure root cause from `2026-02-22-workflow-file-split` project where Developer agent batch-processed all WPs, claimed cross-role WPs, and called tools outside its listed set.

## v3.3.0 - Two-Phase Pre-flight Check with Auto-Detect (2026-02-21)
- Ledger Personas (3–7): Replaced the single-step pre-flight check with a two-phase sequence.
- **Phase 1 (Detect):** When `project_path` is not explicitly provided, agents now call `ledger_detect_project` with `cwd_path` to automatically resolve the active project path from the workspace root.
- **Phase 2 (Verify):** Agents then call `ledger_get_project_status` to confirm the MCP server is reachable.
- `ledger_detect_project` added to the Tools table in all five updated persona files.
- `2-project-manager.md` is unchanged — it always receives an explicit path from the planner.
- `sync-personas.js` run after changes to propagate all five personas to VS Code user prompts directory.

## v3.1.2 - Role Value Cross-Validation (2026-02-20)
- `sync-personas.js`: `validateLedgerFrontmatter()` now cross-validates the `role:` value against a `KNOWN_ROLES` constant. When `role:` is present but its value does not match any known agent role, a `console.warn` is emitted naming both the file path and the unrecognised value. Exit code remains `0`; warnings are advisory only.
- `KNOWN_ROLES` is defined at the top of the file with a comment to keep it in sync with `src/utils/constants.ts` in the MCP server.

## v3.1.1 - Automatic Handoffs in Ledger Personas
- Ledger Personas: Added **Automatic Handoff** instruction paragraph to the Workflow section of all 6 active ledger personas (`2-project-manager.md` through `7-synthesis.md`).
- When `ledger_get_handoff_status` returns an `auto_handoff` object, agents now invoke `runSubagent` with `auto_handoff.agent_name` and `auto_handoff.prompt` to pass control to the next agent automatically.
- Falls back to the manual `CURRENT AGENT / NEXT AGENT / STATUS` block when `auto_handoff` is absent (e.g. registry not loaded, or no agent configured for the next role).
- `1-planner.md` is deliberately excluded — no ledger exists at the Planner stage.
- No hardcoded agent handles in any routing instruction; all routing is driven by the MCP server response.
- `sync-personas.js`: Added `validateLedgerFrontmatter()` — after syncing, the script validates that every ledger persona file has both `role:` and `name:` fields in YAML frontmatter. Missing fields emit advisory warnings without blocking the sync.

## v3.1.0 - Role Field in Persona Frontmatter
- Ledger Personas: Added `role:` field to the YAML frontmatter of all 7 ledger persona files (`1-planner.md` through `7-synthesis.md`).
- The `role:` value maps each persona to its canonical workflow identifier — values exactly match the `AGENT_ROLES` constant in `src/tools/workflow.ts`.
- Enables the planned Agent Registry (WP-002) to build agent handle maps at runtime for automatic handoffs.
- Only `personas/ledger/` files are affected; `vanilla/` and `standalone/` remain unchanged.

## v3.0.2 - Pre-Flight Optimization
- Ledger Personas: Optimized pre-flight so agents know how to search for the ledger tools.

## v3.0.1 - MCP Ledger
- Ledger Personas: Tweaked pre-flight wording to avoid "Tools not found" messages.

## v3.0.0 - MCP Ledger
- Ledger Personas: The ledger is now handled via the dedicated MCP server.
- Ledger MCP: Created the ledger MCP server.
- Ledger Personas: Refined the pre-flight check.

## v2.1.1 - Developer fixes
- Developer Persona: Small fixes.
- Worker Personas: Added error logging (Developer, QA, Documentation).

## v2.1.0 - Split Work Packages
- Work packages now use a split-file architecture: `work.md` is a summary index, individual specifications live in `work/WP-###.md`.
- Project Manager creates `work/` subfolder with per-WP specification files alongside the summary index.
- Consumer personas (Developer, Validator, Reviewer, Documentation, Synthesis) now reference `work/WP-###.md` instead of the monolithic `work.md`.
- Updated README file structure diagram and all stage instructions.

## v2.0.0 - Ledger Architecture (Breaking)
- **Breaking Change**: Ledger now uses a split-file architecture instead of a single monolithic JSON file.
- Root `project-ledger.json` is now a lightweight index with work package summaries (id, status, dependencies, file path).
- Each work package has its own detail file at `.ledger/WP-###.json` containing full pipeline, acceptance criteria, and artifact data.
- Renamed root index from `ledger.json` to `project-ledger.json` for discoverability (LLMs naturally expect this name).

## v1.0.8 - Code Improvement Tracking
- Developer Persona: Made commenting code a foundational role.

## v1.0.7 - Testing and Analysis
- Developer Persona: Provided with testing and analysis capabilities.

## v1.0.6 - Autoloader/Dependency Update Step
- Developer Persona: Added step to regenerate autoloaders or update package manifests when new classes/modules are added.

## v1.0.5 - Plan Folders
- Now creating a folder per project, simplified file names (e.g. `plan.md`).
- Moved ledger to the ledger personas folder.
- Fixed paths in the ledger.

## v1.0.4 - Agent Identification
- Added `AGENT: Name` in ending status messages.

## v1.0.3 - Git Command Fix
- Added Planner and developer constraint not to use Git write commands.

## v1.0.2 - QA Handoff Fix
- Ledger: QA agent handoff clarified for open work packages not assigned to the DEV agent.

## v1.0.1 - Fixed VSCode frontmatter
- Removed unsupported VSCode YAML properties.
- Moved metadata to an HTML comment block.
- Added version string to the YAML `name`.

## v1.0.0 - Initial release
- Finalized all workflow prompts with YAML frontmatter.

# Ledger Personas

## 1 - Planner
- **v1.3.1:** Added clause for naming synthesis rework plans.
- **v1.3.0:** Initial changelogged version.

## 2 - Project Manager
- **v3.5.1:** Simplified preflight and some verbose sections.
- **v3.5.0:** Initial changelogged version.

## 3 - Developer
- **v3.5.2:** Simplified preflight and some verbose sections.
- **v3.5.1:** Added capabilities and rework sections, added missing add observation tool.
- **v3.5.0:** Initial changelogged version.

## 4 - QA
- **v3.5.3:** Simplified preflight and some verbose sections.
- **v3.5.2:** Added incident logging block and REWORK_QA handling section.
- **v3.5.1:** Enabled incident logging.
- **v3.5.0:** Initial changelogged version.

## 5 - Reviewer
- **v3.5.4:** Simplified preflight and some verbose sections.
- **v3.5.3:** Removed phantom REWORK_REVIEW action from workflow and YAML; added acceptance_criteria_updates to output format and workflow step 5.
- **v3.5.2:** Added incident logging block.
- **v3.5.1:** Enabled incident logging.
- **v3.5.0:** Initial changelogged version.

## 6 - Documentation
- **v3.5.3:** Simplified preflight and some verbose sections.
- **v3.5.2:** Fixed REWORK_DOCS→REWORK action name; added ledger_update_work_package_status tool for FINALIZE_WP edge case; added Rework Handling section; fixed incident logging conditional bypass.
- **v3.5.1:** Removed unneeded handoff status tool.
- **v3.5.0:** Initial changelogged version.

## 7 - Synthesis
- **v3.5.2:** Simplified preflight and some verbose sections.
- **v3.5.1:** Ledger help tool as note only.
- **v3.5.0:** Initial changelogged version.

# Standalone Personas

## Changelog Curator
- **v1.1.0:** Tweaked verbosity of entries with refined rationales.
- **v1.0.0:** Initial release.

## Module Intent Architect
- **v1.0.2:** Better described the possibility to generate additional documentation.
- **v1.0.1:** Initital pre-changelog release.

## Orchestrator Runner
- **v1.0.1:** Minor updates and fixes.
- **v1.0.0:** Initial release.

## README Curator
- **v1.2.1:** Added a helper section with rewriting entire README files.
- **v1.2.0:** Rewrite to produce a better human-oriented README.
- **v1.1.0:** Pre-changelog initial release.

## WHATSNEW Curator
- **v1.0.0:** Initial release.
