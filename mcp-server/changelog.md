# Project Ledger MCP Server - Changelog

## v1.0.1 - 2026-02-16

### Added
- **Version Display**: MCP server now logs its version at startup in STDERR output (e.g., `Server v1.0.1 started successfully`). This helps identify which version is running in a project.
- **Version Sync Script**: Added `npm run sync-version` script that extracts the version from `changelog.md` (keeping it as the source of truth) and updates `package.json` automatically. Runs before `npm run dev` via `predev` hook.

### Fixed
- **Handoff Status Logic**: Fixed `ledger_get_handoff_status` to only report `BLOCKED` status when *all* work packages are blocked. Previously, it would report `BLOCKED` even when some work packages had `READY` or `IN_PROGRESS` status, which was confusing for agents like Project Manager where having blocked work packages with unmet dependencies is normal and expected. Now, if any work packages can proceed (status `READY` or `IN_PROGRESS`), the agent-specific handoff logic is used instead.

## v1.0.0 - Initial Release
- Release with the first 13 tools.
