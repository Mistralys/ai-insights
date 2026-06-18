# Menu Guide

The interactive menu is the single entry point for all workspace operations. It handles first-time setup, keeps the environment healthy, and gives you direct access to every tool in the workspace.

## Launching the Menu

```bash
./menu.sh          # macOS / Linux
menu.cmd           # Windows
```

On first launch, the menu detects an unconfigured environment and redirects to the setup wizard automatically. Subsequent launches go straight to the menu.

## Health Dashboard

Every time the menu opens, it runs a set of instant health checks and displays the results in the status line. A green `✓` means the check passed; a red `✗` includes a hint for how to fix it.

| Check | What It Verifies |
|-------|-----------------|
| MCP Server dist built | `mcp-server/dist/index.js` exists |
| Orchestrator venv present | `orchestrator/.venv/` exists |
| Git hooks installed | `.githooks/` is active in `.git/config` |
| Node.js ≥ 18 | Current Node.js version meets the minimum requirement |

The **Doctor** command runs a fuller set of checks including dependency freshness and persona staleness — see below.

## Menu Items

### Setup & Configuration

| Item | Command | Description |
|------|---------|-------------|
| **First-time setup** | `setup` | Full workspace setup wizard — installs MCP server, personas, orchestrator venv, global MCP registration, and git hooks |
| **Install MCP (Global)** | `install-mcp` | Register the MCP server in VS Code / Claude Code user config via a stable shim |
| **Install git hooks** | `git-hooks` | Activate the pre-commit guards (persona freshness, version sync, ruff lint) |

### Personas

| Item | Command | Description |
|------|---------|-------------|
| **Sync personas** | `sync-personas` | Build persona files and deploy to VS Code and Claude Code |
| **Package personas** | `package-personas` | Build and ZIP standalone personas for distribution |
| **Clean agent folder** | `clean-agents` | Remove persona files from all publish locations |

### MCP Server

| Item | Command | Description |
|------|---------|-------------|
| **Launch GUI dashboard** | `gui` | Start the MCP GUI server and open the dashboard in your browser |

### Orchestrator

| Item | Command | Description |
|------|---------|-------------|
| **Pre-flight checks** | `preflight` | Verify orchestrator readiness: venv, `.env` config, API keys, and dist freshness |
| **Preview stage prompts** | `preview-prompts` | Render and review the prompts used by each pipeline stage |
| **Run orchestrator** | `orchestrator` | Execute the full ledger pipeline against a plan file |
| **Read orchestrator log** | `read-log` | Query and filter JSONL run logs in a readable format |
| **Kill stale processes** | `kill-orchestrator` | Find and terminate orphaned orchestrator processes |

### Validation & Utilities

| Item | Command | Description |
|------|---------|-------------|
| **Doctor** | `doctor` | Full environment health check across all tiers (instant + fast + slow) |
| **Build & Maintain** | `build-maintain` | Sync module versions, build personas, and regenerate context docs |
| **Bundle docs** | `bundle-docs` | Compile NotebookLM and workflow specification doc bundles |
| **CTX generate** | `ctx-generate` | Regenerate `.context/` snapshots via the CTX Generator |
| **Check version sync** | `check-versions` | Verify that changelog versions match `package.json` / `pyproject.toml` |

## Direct Commands

Every menu item can be invoked directly without entering the interactive menu:

```bash
./menu.sh <command> [options]
```

### Examples

```bash
./menu.sh setup                           # interactive setup wizard
./menu.sh setup --all                     # non-interactive full setup
./menu.sh setup --components mcp-server   # run a specific setup component
./menu.sh sync-personas                   # build + deploy personas
./menu.sh install-mcp                     # register MCP server globally
./menu.sh install-mcp --dry-run           # preview changes without writing
./menu.sh gui                             # launch GUI dashboard
./menu.sh preflight                       # check orchestrator readiness
./menu.sh preflight --plan plan.md        # also verify the plan file exists
./menu.sh orchestrator --plan plan.md     # run the orchestrator pipeline
./menu.sh read-log                        # view the latest run log
./menu.sh read-log --summary              # one-line run overview with token totals
./menu.sh kill-orchestrator               # terminate stale processes
./menu.sh kill-orchestrator --force       # kill without confirmation
./menu.sh clean-agents --force            # remove persona files without confirmation
./menu.sh preview-prompts --list          # list available stage names
./menu.sh doctor                          # full health check
./menu.sh build-maintain                  # sync versions + build + ctx-generate
./menu.sh help                            # list all available commands
```

## Skipping First-Run Detection

For CI or automated use, pass `--skip-setup-check` to bypass the first-run wizard redirect:

```bash
node scripts/cli.js --skip-setup-check <command>
```
