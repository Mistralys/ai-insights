# AI Insights

## Agent Personas

Workflows for agentic coding using custom prompts.

- [Ledger-Enabled](/personas/ledger/README.md) - For keeping state between sessions.
- [Standalone](/personas/standalone/) - Independent single-purpose agents (no MCP dependency).

### Deploying Personas to AI IDEs

To automatically build and copy persona files to your AI IDE, use the sync script:

```bash
# Deploy to both VS Code and Claude Code (default)
node scripts/sync-personas.js

# Deploy to VS Code only
node scripts/sync-personas.js --target vscode

# Deploy to Claude Code only
node scripts/sync-personas.js --target claude-code

# Preview what would be copied without making changes (dry run)
node scripts/sync-personas.js --dry-run

# Copy VS Code personas to a custom directory
node scripts/sync-personas.js --custom-path "/path/to/custom/dir"
```

**VS Code** — The script automatically detects your operating system and uses the correct User prompts directory:
- **Windows**: `%APPDATA%\Code\User\prompts`
- **macOS**: `~/Library/Application Support/Code/User/prompts`
- **Linux**: `~/.config/Code/User/prompts`

**Claude Code** — Personas are always deployed to `~/.claude/agents/` (cross-platform standard).

After syncing, the script validates frontmatter in the deployed personas. A clean run prints:

```
✓ All 7 VS Code persona file(s) passed frontmatter validation
✓ All 7 Claude Code persona file(s) passed frontmatter validation
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

## Orchestrator

The orchestrator is a **headless, deterministic alternative** to running the agent workflow interactively through an AI IDE. It executes the same MCP-server-backed, persona-driven pipeline entirely from the command line — no IDE required.

- [Orchestrator README](/orchestrator/README.md) - Full setup and usage guide.

**Quick start:**
```bash
cd orchestrator
pip install -e ".[anthropic]"   # or ".[google]"
cp .env.example .env            # fill in your API key
orchestrate path/to/plan.md
```

> **Relationship to the IDE workflow:** Both workflows use the same MCP server and persona prompts. The orchestrator is an alternative execution mode; the IDE-based workflow remains fully functional.

## LLM Discussion Archive

- [Discussions](/discussions/)

## Prompt Archive

- [Reusable Prompts](/prompts/)
