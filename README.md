# AI Insights

## Agent Personas

Workflows for agentic coding using custom prompts.

- [Ledger-Enabled](/personas/ledger/README.md) - For keeping state between sessions.
- [Vanilla](/personas/vanilla/README.md) - Dependency-less Markdown-based flow

### Syncing Personas to VS Code

To automatically copy persona files to VS Code's User prompts folder, use the sync script:

```bash
# Preview what would be copied (dry run)
node sync-personas.js --dry-run

# Copy persona files to VS Code
node sync-personas.js

# Copy to a custom directory
node sync-personas.js --custom-path "/path/to/custom/dir"
```

The script automatically detects your operating system and uses the correct VS Code User prompts directory:
- **Windows**: `%APPDATA%\Code\User\prompts`
- **macOS**: `~/Library/Application Support/Code/User/prompts`
- **Linux**: `~/.config/Code/User/prompts`

Only persona files with a `VS File Name` metadata field will be copied.

## Project Ledger MCP Server

- [Ledger MCP](/mcp-server/README.md) - Agent workflow ledger storage.

## LLM Discussion Archive

- [Discussions](/discussions/)

## Prompt Archive

- [Reusable Prompts](/prompts/)
