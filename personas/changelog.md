# Personas Changelog

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
