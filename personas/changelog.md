# Personas Changelog

## v3.10.3 - Reviewer Feedback Tiers
- Personas: Reviewer now uses three-tier feedback (Blocking,
  Fix-Forward, Documentation-Forward) instead of binary pass/fail.
- Personas: Reviewer applies trivial non-behavioral fixes directly.
- Personas: Documentation agent checks reviewer-forwarded items.

## v3.10.2 - Orchestrator Runner: JSONL Event Coverage
- Personas: Orchestrator Runner v1.3.0 — restructured progress
  monitoring to use live terminal output as primary channel.
- Personas: Orchestrator Runner v1.3.0 — expanded event coverage
  to all 16 JSONL event types with duration fields reference.

## v3.10.1 - Release Engineer: Delegate Changelog & CTX
- Personas: Release Engineer v3.7.0 — delegates changelog curation
  to Changelog Curator sub-agent.
- Personas: Release Engineer v3.7.0 — delegates CTX updates to CTX
  Architect sub-agent.
- Partials: Updated release engineer operational protocol.

## v3.10.0 - AGENTS.md Curator: CLAUDE.md Companion
- Personas: AGENTS.md Curator v1.1.0 — now creates a CLAUDE.md companion file.
- Docs: Split constraints into build-system and cross-system sub-documents.
- Docs: Added persona versioning constraint.

## v3.9.3 - CTX Architect: Tree Exclusion Guidance
- Personas: CTX Architect v1.1.0 — added `notPath` vs `excludePatterns` warning
  for tree vs file source types (silent ignore bug).
- Personas: CTX Architect v1.1.0 — added constraint to always exclude package
  manager artifacts (`node_modules/`, `vendor/`, `.venv/`, etc.) from tree sources.

## v3.9.2 - Preflight & Docs Cleanup
- Personas: Simplified Orchestrator Runner preflight to a single script call.
- Docs: Removed `file-tree.md` from the persona manifest.

## v3.9.1 - Helper Unification & Strict-Mode Robustness
- Build: Unified `validateCcFileName` and `validateVsFileName` into a single `validateFileName` helper.
- Build: Fixed `--strict` false-positive by stripping fenced code blocks before scanning for unresolved markers.
- Personas: Updated Unit Test Auditor description to verb-forward, purpose-specific text.
- Docs: Added named anchors to all 47 constraints; updated cross-references.

## v3.9.0 - Build Pipeline Fixes & `mcpServers` Auto-Injection
- Build: Fixed VS Code output filenames to use YAML-declared `vs_file_name` instead of template basename.
- Build: Standalone Claude Code personas with MCP tools now receive `mcpServers` auto-injection in frontmatter.
- Personas: `ledger-bootstrapper` Claude Code build now includes `mcpServers: central_pm` in frontmatter.
- Docs: Renumbered all constraints to a clean sequential 1–47 scheme.
- Docs: Updated standalone README to document MCP server auto-injection.

## v3.8.1 - 9-Agent Personas (Post-Synthesis Polish)
- Docs: Added `personas/standalone/README.md` — user-facing guide for all 15 standalone personas.
- Docs: Added pipeline stage ordering and WP ID auto-generation constraints.
- Docs: Updated `personas/ledger/README.md` for the 9-agent workflow layout.
- Personas: Reviewer (6) mission statement now scopes security to the dedicated Security Auditor.
- Partials: Added explicit comment type documentation to `release-engineer-output-format.md`.

---

## v3.8.0 - 9-Agent Personas & PM Sub-Agents
- Personas: Added Security Auditor v3.6.1 at pipeline position 5 with OWASP A01–A10 coverage.
- Personas: Added Release Engineer v3.6.1 at pipeline position 7.
- Personas: Renumbered Reviewer (5→6), Documentation (6→8), and Synthesis (7→9).
- Personas: Project Manager now delegates WP decomposition to four focused sub-agents.
- Personas: Developer now requires all modified files listed in `artifacts.files_modified`.
- Personas: Reviewer security review scope delegated to Security Auditor.
- Personas: Added WP Decomposer, Dependency Sequencer, Pipeline Configurator, and Ledger Bootstrapper standalone sub-agents.
- Partials: Added shared partials for Security Auditor and Release Engineer protocols and output formats.

## v3.7.3 - Per-Persona Model Field
- Ledger: Added `default_model` to `_shared.yaml`; Planner and Project Manager use Claude Opus 4.6.
- Build: Added model field and resolution chain to persona frontmatter templates.
- Docs: Documented model resolution chain across manifest.

## v3.7.2 - CTX Architect Persona
- CTX Architect v1.0.0: New standalone persona for CTX Generator documentation workflows.
- Build: Extracted shared Claude Code frontmatter fields into a helper to eliminate duplication.
- Docs: Added Log-Prefix Convention section documenting severity prefixes.
- Docs: Updated frontmatter templates to reflect helper extraction.

## v3.7.1 - Developer
- Developer v3.6.1: Compressed overly verbose operational protocol.

## v3.7.0 - ID Update
- All Personas: Added `id` fields to all personas for `runSubagent` handoffs in VS Code.

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
