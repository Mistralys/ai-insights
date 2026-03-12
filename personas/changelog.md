# Personas Changelog

## v3.7.3 - Per-Persona Model Field
- Ledger: Added `default_model: "Claude Sonnet 4.6"` to `_shared.yaml` as suite-wide model default.
- Ledger: Planner (1) and Project Manager (2) now specify `model: "Claude Opus 4.6"` in per-persona YAML; Agents 3–7 inherit `default_model`.
- Build: Added `model: '{{model}}'` to `FRONTMATTER_LEDGER_VSCODE` template.
- Build: Added model resolution chain in `buildForTarget()`: per-persona `model` → `default_model` → `cc_model` → `'inherit'`.
- Build: Unified `cc_model` derivation — now resolved from the computed `model` value rather than passing through `_shared.cc_model` directly.
- Docs: Documented `default_model`, `model`, and `cc_model` resolution chain across manifest API surface, constraints, and data-flows.

## v3.7.2 - CTX Architect Persona
- CTX Architect v1.0.0: New standalone persona for CTX Generator documentation workflows.
- Build: Extracted shared Claude Code frontmatter fields into a helper to eliminate duplication.
- Docs: Added Log-Prefix Convention section documenting severity prefixes.
- Docs: Updated frontmatter templates to reflect helper extraction.

## v3.7.1 - Developer
- Developer v3.6.1: Compressed overly verbose operational protocol.

## v3.7.0 - ID Update
- VS Code: Using IDs for agent handoffs in `runSubagent` tool.
- Planner v1.3.2: Added ID.
- Project Manager v3.6.0: Added ID + handoff fix.
- Developer v3.6.0: Added ID + handoff fix.
- QA v3.6.0: Added ID + handoff fix.
- Reviewer v3.6.0: Added ID + handoff fix.
- Documentation v3.6.0: Added ID + handoff fix.
- Synthesis v3.5.3: Added ID.
- AgentsMD Curator v1.0.1: Added ID.
- Changelog Curator v1.1.1: Added ID.
- Composer Curator v1.0.1: Added ID.
- Manifest Curator v1.0.4: Added ID.
- Module Intent Archictect v1.0.3: Added ID.
- Orchestator Runner v1.0.2: Added ID.
- Readme Curator v1.2.2: Added ID.
- Researcher v1.0.2: Added ID.
- Unit Test Auditor v1.0.2: Added ID.
- Whatsnew Curator v1.0.1: Added ID.

## v3.6.3 - Strict Mode Limitations (2026-02-23)
- Docs: Documented strict-mode code-fence false-positive risk.
- Docs: Documented `--check` + `--strict` exit ordering behavior.
- Docs: Added `--strict` to quick-commands sections in suite READMEs.
- Build: Added inline comment documenting code-fence false-positive.

## v3.6.2 - cc_file_name Validation Guard (2026-02-23)
- Build: Added fail-fast guard when `cc_file_name` is missing from persona YAML.
- Build: Removed silent empty-string fallback for missing `cc_file_name`.
- Docs: Updated `cc_file_name` schema rows to document required-field behavior.

## v3.6.1 - Remove Vanilla Flat Files (2026-02-23)
- Vanilla: Deleted seven legacy flat persona files predating the template system.
- Docs: Updated vanilla README with canonical output directory redirect.

## v3.6.0 - Multi-IDE Persona Support (2026-02-23)
- Build: Added dual output directories for VS Code and Claude Code frontmatter.
- Build: Added `--target` CLI flag (`vscode`, `claude-code`, `all`).
- Template: Added `{{else}}` branch support to conditionals.
- Partials: Split handoff and preflight partials into platform-specific variants.
- Build: Added Claude Code frontmatter template with all required CC fields.
- Metadata: Added `cc_file_name`, `cc_tools` to persona YAML; CC settings to shared.
- Build: Added `cc_name`, `cc_description`, `cc_tools_json` computed variables.
- Standalone: Added Claude Code variants of all 6 standalone personas.
- Sync: Added Claude Code sync, validation, and directory-resolution functions.

## v3.5.4 - Preflight Simplification (2026-02-22)
- Project Manager v3.5.1: Simplified preflight and verbose sections.
- Developer v3.5.2: Simplified preflight and verbose sections.
- QA v3.5.3: Simplified preflight and verbose sections.
- Reviewer v3.5.4: Simplified preflight and verbose sections.
- Documentation v3.5.3: Simplified preflight and verbose sections.
- Synthesis v3.5.2: Simplified preflight and verbose sections.

## v3.5.3 - Reviewer Workflow Fix (2026-02-22)
- Reviewer v3.5.3: Removed phantom REWORK_REVIEW action; added acceptance criteria field.

## v3.5.2 - Incident Logging & Rework Handling (2026-02-22)
- QA v3.5.2: Added incident logging block and REWORK_QA handling.
- Reviewer v3.5.2: Added incident logging block.
- Documentation v3.5.2: Fixed REWORK action name; added rework handling and status tool.

## v3.5.1 - Persona Capabilities & Logging (2026-02-22)
- Developer v3.5.1: Added capabilities and rework sections; added observation tool.
- QA v3.5.1: Enabled incident logging.
- Reviewer v3.5.1: Enabled incident logging.
- Documentation v3.5.1: Removed unneeded handoff status tool.
- Synthesis v3.5.1: Demoted ledger help tool to note-only.
- Planner v1.3.1: Added clause for naming synthesis rework plans.

## v3.5.0 - Role Boundaries & Mandatory Handoffs (2026-02-22)
- Partials: Added `role-boundaries` fragment restricting tool use and WP scope.
- Partials: Changed handoff heading to "Handoff (mandatory)".
- Developer v3.5.0: Added repeat-loop workflow step and role scope constraints.
- All Ledger Personas v3.5.0, Planner v1.3.0: Initial changelogged versions.

## v3.4.1 - Standalone Persona Updates
- README Curator v1.2.1: Added helper section for rewriting entire READMEs.
- README Curator v1.2.0: Rewritten to produce better human-oriented output.
- Module Intent Architect v1.0.2: Improved documentation generation guidance.
- Changelog Curator v1.1.0: Refined entry verbosity rationales.
- Orchestrator Runner v1.0.1: Minor updates and fixes.

## v3.4.0 - Standalone Personas
- Changelog Curator v1.0.0: Initial release.
- Module Intent Architect v1.0.1: Initial pre-changelog version.
- Orchestrator Runner v1.0.0: Initial release.
- README Curator v1.1.0: Initial pre-changelog version.
- WHATSNEW Curator v1.0.0: Initial release.

## v3.3.0 - Two-Phase Pre-flight with Auto-Detect (2026-02-21)
- Ledger Personas 3–7: Replaced single-step pre-flight with detect + verify.
- Ledger Personas 3–7: Added `ledger_detect_project` to tools tables.

## v3.1.2 - Role Value Cross-Validation (2026-02-20)
- Sync: Added `KNOWN_ROLES` cross-validation for role frontmatter values.

## v3.1.1 - Automatic Handoffs
- Ledger Personas 2–7: Added automatic handoff via `ledger_get_handoff_status`.
- Sync: Added `validateLedgerFrontmatter()` for role/name field validation.

## v3.1.0 - Role Field in Persona Frontmatter
- Ledger Personas 1–7: Added `role:` field mapping to `AGENT_ROLES` constants.

## v3.0.2 - Pre-Flight Optimization
- Ledger Personas: Improved pre-flight tool discovery instructions.

## v3.0.1 - Pre-Flight Wording
- Ledger Personas: Tweaked pre-flight to avoid "Tools not found" messages.

## v3.0.0 - MCP Ledger
- Ledger Personas: Migrated ledger to dedicated MCP server.
- Ledger Personas: Refined pre-flight check sequence.

## v2.1.1 - Developer Fixes
- Developer: Small fixes.
- Developer, QA, Documentation: Added error logging.

## v2.1.0 - Split Work Packages
- Workflow: Introduced split-file architecture with per-WP specification files.
- Project Manager: Creates per-WP files in `work/` subfolder.
- Consumer Personas: Updated to reference individual WP files.

## v2.0.0 - Ledger Architecture (Breaking-S)
- Ledger: Switched to split-file architecture with per-WP detail files.
- Ledger: Renamed root index to `project-ledger.json`.

### Breaking Changes

The ledger switched from a single JSON file to a split-file architecture. The root
`project-ledger.json` is now a lightweight index; full WP data lives in `.ledger/WP-###.json`.

## v1.0.8 - Code Improvement Tracking
- Developer: Made commenting code a foundational role.

## v1.0.7 - Testing and Analysis
- Developer: Added testing and analysis capabilities.

## v1.0.6 - Autoloader Update Step
- Developer: Added step to regenerate autoloaders after adding new classes.

## v1.0.5 - Plan Folders
- Workflow: Per-project folders with simplified file names.
- Ledger: Moved to ledger personas folder; fixed paths.

## v1.0.4 - Agent Identification
- All Personas: Added `AGENT: Name` to ending status messages.

## v1.0.3 - Git Command Fix
- Planner, Developer: Added constraint against Git write commands.

## v1.0.2 - QA Handoff Fix
- QA: Clarified handoff for open WPs not assigned to Developer.

## v1.0.1 - VS Code Frontmatter Fix
- All Personas: Removed unsupported YAML properties; moved metadata to HTML comment.
- All Personas: Added version string to YAML `name`.

## v1.0.0 - Initial Release
- All Personas: Finalized workflow prompts with YAML frontmatter.
