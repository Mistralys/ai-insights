# AI Insights Changelog

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
