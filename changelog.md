# AI Insights Changelog

## v1.7.1 - Ledger Bugfix and GUI Improvements
- Ledger GUI: Renaming projects, repository name column.
- Ledger: Fixed broken VS Code agent handoffs.
- Ledger: Fixed project path handling.
- Personas v3.7.1: Improved developer.

## v1.7.0 - CLI and more
- CLI: Added a handy CLI menu.
- Personas: Fixed VS Code subagent call syntax.
- MCP: Tool handling improvements.

## v1.6.1 - Ledger Personas Improvements
- Personas: Simplified the preflight check.
- Personas: Avoiding the first tool call missing the agent role.
- Personas: Improved document formatting with clear sections.
- Personas: Restructured some overly verbose texts into lists.

## v1.6.0 - Ledger Spec Sync & Persona Refinements
- MCP: Synchronized workflow, pipeline, handoff, and work-package tools to the specification.
- MCP: Fixed workflow bug and root folder handling.
- Orchestrator: Delegated all agent logic to the ledger via tool wrappers.
- Orchestrator: Added setup script and replaced the run script.
- Personas: Added orchestrator runner persona.
- Personas: Updated ledger workflow.
- Personas: Readme curator now helps rewrite project readmes.
- Personas: Added philosophy of persona content.
- Personas: Fixed Reviewer logic bug and missing incident logging.
- Personas: QA: Added rework handling information.
- Personas: Simplified tool calls.
- Docs: Added persona tool usage matrix.
- Git: Added pre-commit persona freshness hook.

## v1.5.0 - Ledger Enhancements
- Ledger: Added archiving of the plan and synthesis documents.
- Ledger: GUI: Viewing the archived documents.
- Ledger: GUI: Added full text filter.
- Ledger: GUI: Added completion percentage.
- Ledger: GUI: More Readable Project Name.

## v1.4.0 - LangGraph Orchestrator Tool
- Personas: Added the WHATSNEW curator.
- Personas: Tweaked the sensibility of the changelog curator.
- Orchestrator: Added the CLI orchestrator tool.
- Docs: Added orchestrator troubleshooting entries.

## v1.3.0 - Multi-IDE Persona Builds
- Personas: Added a build process and templating.
- Personas: Now generating Markdown files for VS Code and Claude Code.
- Personas: Files now have to be built locally (`node scripts/sync-personas.js`).
- Personas: Rewrote the README curator to produce better human-centered documents.
- Personas: Improved the Module Intent Architect to create more relevant files.
- Personas: Added the Changelog Curator.
- Personas: Added the Composer Curator.
- Personas: Retired the unused "Vanilla" personas.
- Ledger: Fixed a logic exception in the Developer persona flow.
- Ledger: GUI: Added the "Insights" tab with a comments overview.

## v1.2.0 - Ledger GUI & Handoff Consolidation
- Ledger: Added a GUI to see projects and work package statuses (`node scripts/run-gui.js`).
- Personas: Consolidated handoffs to avoid agents going off script.

## v1.1.0 — Central Ledger & Refined Personas

- Personas: The planner now cross-references the codebase and asks pertinent questions.
- Ledger: The ledger files are now stored centrally - no `.ledger` folders needed anymore.
- Ledger: Agents can identify their project without the plan or work document added as context.
- Personas: All ledger-enabled personas are now built from templates for consistency.
- Ledger: Personas now leverage VS Code's tools to hand off work between themselves. 
- Personas: Tweaked and fixed logic gates and handoffs.
- Core: Maintenance scripts consolidated under a single `scripts/` folder.

## v1.0.0 - Initial release
- Personas with MCP ledger.
