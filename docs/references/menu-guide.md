# Menu Guide

The interactive menu is the single entry point for all workspace operations. It handles first-time setup, keeps the environment healthy, and gives you direct access to every tool in the workspace.

## Launching the Menu

```bash
./menu.sh          # macOS / Linux
menu.cmd           # Windows
```

On first launch, the menu detects an unconfigured environment and redirects to the setup wizard automatically. Subsequent launches go straight to the menu.

> **Prerequisite for the global `ai-insights` command:** `./menu.sh` works with no setup, but the global `ai-insights` command (used throughout this guide's examples) requires a one-time `npm link` from the repository root first — this can't be done through the menu itself, since the menu isn't reachable as a global command until after that step runs. See [Global CLI](development.md#global-cli-optional) in the Developer Guide. Once linked, the **Setup & Configuration** → **Link global CLI** item (or `setup`) keeps the registration current.

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
| **First-time setup** | `setup` | Full workspace setup wizard — installs MCP server, personas, orchestrator venv, global MCP registration, global CLI link, and git hooks |
| **Install MCP (Global)** | `install-mcp` | Register the MCP server in VS Code / Claude Code user config via a stable shim |
| **Link global CLI** | `link-cli` | `npm link` — make the `ai-insights` command available from any directory |
| **Install git hooks** | `git-hooks` | Activate the pre-commit guards (persona freshness, version sync, ruff lint) |

### Personas

| Item | Command | Description |
|------|---------|-------------|
| **Sync personas** | `sync-personas` | Build persona files and deploy to VS Code and Claude Code |
| **Launch an agent** | `agent` | Pick a deployed persona from a type-to-filter list and launch it with `claude --agent`, from your current directory. The picker clears the screen on open and reopens automatically once the `claude` session exits, so switching agents is a continuous loop — press Escape/Ctrl+C (or submit empty input) at the picker to return to this menu |
| **Package personas** | `package-personas` | Build and ZIP standalone personas for distribution |
| **Clean agent folder** | `clean-agents` | Remove persona files from all publish locations |

### Skills

| Item | Command | Description |
|------|---------|-------------|
| **Build skills** | `build-skills` | Compile skill source files to `dist/vscode-skills/` and `dist/claude-skills/` |
| **Publish skills** | `publish-skills` | Build and deploy skills to `.github/skills/` and `~/.claude/skills/` |

### MCP Server

| Item | Command | Description |
|------|---------|-------------|
| **Launch GUI dashboard** | `gui` | Start the MCP GUI server and open the dashboard in your browser |
| **Declare project ledger** | `ledger` | Declare, edit, or sync the current directory's `.ledger/` strategic-vision mirror — see [Declaring a project ledger](#declaring-a-project-ledger) below |

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

## Declaring a project ledger

`ledger` declares a consumer project against a registered repository so its per-repository strategic vision (otherwise only readable via the `ledger_get_repository_context` MCP tool) is mirrored into a read-only `.ledger/` folder inside that project. Unlike `store` (a workspace-maintainer command, reachable only via direct invocation), `ledger` is menu-visible because its intended audience — a developer standing in a consumer project with the `ai-insights` binary linked — is expected to reach it from the menu rather than recall a sub-verb.

| Verb | Command | Description |
|------|---------|-------------|
| **Declare** | `ledger init` | Declare the current directory against a registered repository, writing `.ledger/settings.json` and `.ledger/README.md` |
| **Edit** | `ledger edit` | Change which outputs are enabled on an existing declaration |
| **Sync** | `ledger sync` | Regenerate declared outputs, or check for drift with `--check` |

Running `ledger` with no sub-verb — from the menu, or as a bare `ai-insights ledger` on a TTY — infers the verb from the current directory: `init` if undeclared, `edit` if already declared here or in an ancestor directory (with a confirmation prompt offering to declare here instead), or an error if the existing declaration is invalid. With stdin not a TTY, a verbless invocation exits non-zero and names all three verbs instead of guessing.

```bash
./menu.sh ledger                                          # infers init or edit, interactively
./menu.sh ledger init --repository-id <id> --enable <output-id>
./menu.sh ledger init --dry-run                           # preview writes without touching disk
./menu.sh ledger edit --enable <output-id> --disable <output-id>
./menu.sh ledger sync                                     # regenerate declared outputs
./menu.sh ledger sync --check                              # exit 1 if outputs are stale, without writing
```

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
./menu.sh agent                           # pick a persona and launch it with claude --agent
./menu.sh agent --filter <term>           # pre-fill the filter query
./menu.sh build-skills                    # compile skill source files
./menu.sh build-skills --dry-run          # validate skill outputs without writing to dist/
./menu.sh publish-skills                  # build + deploy skills to IDE directories
./menu.sh publish-skills -- --dry-run     # build + preview deployment without writing to IDE directories
./menu.sh install-mcp                     # register MCP server globally
./menu.sh install-mcp --dry-run           # preview changes without writing
./menu.sh link-cli                        # npm link — make `ai-insights` available globally
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
