# Project Ledger MCP Server - Changelog

## v1.0.1 - 2026-02-16

### Fixed
- **Handoff Status Logic**: Fixed `ledger_get_handoff_status` to only report `BLOCKED` status when *all* work packages are blocked. Previously, it would report `BLOCKED` even when some work packages had `READY` or `IN_PROGRESS` status, which was confusing for agents like Project Manager where having blocked work packages with unmet dependencies is normal and expected. Now, if any work packages can proceed (status `READY` or `IN_PROGRESS`), the agent-specific handoff logic is used instead.

## v1.0.0 - Initial Release
- Release with the first 13 tools.
