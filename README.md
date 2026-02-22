# AI Insights

## Agent Personas

Workflows for agentic coding using custom prompts.

- [Ledger-Enabled](/personas/ledger/README.md) - For keeping state between sessions.
- [Vanilla](/personas/vanilla/README.md) - Dependency-less Markdown-based flow

### Syncing Personas to VS Code

To automatically copy persona files to VS Code's User prompts folder, use the sync script:

```bash
# Preview what would be copied (dry run)
node scripts/sync-personas.js --dry-run

# Copy persona files to VS Code
node scripts/sync-personas.js

# Copy to a custom directory
node scripts/sync-personas.js --custom-path "/path/to/custom/dir"
```

The script automatically detects your operating system and uses the correct VS Code User prompts directory:
- **Windows**: `%APPDATA%\Code\User\prompts`
- **macOS**: `~/Library/Application Support/Code/User/prompts`
- **Linux**: `~/.config/Code/User/prompts`

Only persona files with a `VS File Name` metadata field will be copied.

After syncing, the script validates frontmatter in all ledger personas (`personas/ledger/`) and warns if any file is missing the required `role:` or `name:` fields. Warnings are advisory and do not block the sync. A clean run prints:

```
✓ All 8 ledger persona file(s) passed frontmatter validation
```

### Validating Role Parity

`scripts/sync-personas.js` maintains a hard-coded `KNOWN_ROLES` array that must stay in sync with `AGENT_ROLES` in `mcp-server/src/utils/constants.ts`. A drift check script is provided:

```bash
# From the workspace root (requires the MCP server to be built first)
node scripts/check-known-roles.js

# Or from inside mcp-server/
npm run check:roles
```

Exits 0 when `KNOWN_ROLES` and `AGENT_ROLES` are identical; exits 1 with a labelled diff if they diverge. If the compiled output is missing, the script prints a clear error with build instructions. Build the server first with:

```bash
cd mcp-server && npm run build
```

## Project Ledger MCP Server

- [Ledger MCP](/mcp-server/README.md) - Agent workflow ledger storage.

## LLM Discussion Archive

- [Discussions](/discussions/)

## Prompt Archive

- [Reusable Prompts](/prompts/)
