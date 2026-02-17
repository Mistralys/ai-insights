# Project Ledger MCP Server - Changelog

## v1.1.0 - Help Tool
- New `ledger_help` tool to help some models along that can get confused using the ledger.
- All tools now have more helpful descriptions.

## v1.0.1 - Version Information
- MCP server now logs its version at startup in STDERR output.
- Added a script that extracts the version from `changelog.md` and updates `package.json` automatically.
- Fixed `ledger_get_handoff_status` to only report `BLOCKED` status when *all* work packages are blocked. 

## v1.0.0 - Initial Release
- Release with the first 13 tools.
