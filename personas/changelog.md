# Personas Changelog

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
