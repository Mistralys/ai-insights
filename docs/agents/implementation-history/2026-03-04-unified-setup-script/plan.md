# Plan — Unified Workspace CLI

## Summary

Create a single `scripts/cli.js` entry point that serves as both an **interactive command center** and a **direct CLI** for every operation in the workspace — from first-time setup to daily tasks like syncing personas, launching the GUI, packaging ZIPs, and running the orchestrator. The script replaces the need to remember 10 different `node scripts/X.js` invocations. It requires only Node.js; all other runtimes (Python) are detected and handled gracefully.

The existing `setup-orchestrator.js` will be removed after its logic is absorbed. All other existing scripts remain as standalone entry points for backward compatibility and because they are referenced from `package.json` scripts and CI workflows.

## Architectural Context

The workspace has **10 scripts** in `scripts/` today, each invoked individually:

| Script | Purpose | Flags |
|--------|---------|-------|
| [scripts/setup-orchestrator.js](scripts/setup-orchestrator.js) | Python venv + pip install + .env scaffold | `--provider`, `--dev`, `--checkpoint`, `--force` |
| [scripts/install-hooks.js](scripts/install-hooks.js) | Set git hooks path | — |
| [scripts/sync-personas.js](scripts/sync-personas.js) | Build + deploy personas to IDE | `--target`, `--dry-run`, `--custom-path` |
| [scripts/build-personas.js](scripts/build-personas.js) | Build personas only (no deploy) | `--suite`, `--target`, `--check`, `--dry-run`, `--strict` |
| [scripts/package-personas.js](scripts/package-personas.js) | Build + ZIP standalone personas | `--skip-build`, `--version` |
| [scripts/check-known-roles.js](scripts/check-known-roles.js) | Verify role parity between personas + MCP server | — |
| [scripts/bundle-docs.js](scripts/bundle-docs.js) | Compile doc bundles for NotebookLM / workflow spec | `--only`, `--dry-run` |
| [scripts/extract-changelog-entry.js](scripts/extract-changelog-entry.js) | Parse topmost changelog entry (used by CI) | — |
| [scripts/run-gui.js](scripts/run-gui.js) | Launch MCP GUI dashboard + open browser | `--port`, `--ledger-dir` |
| [scripts/run-orchestrator.js](scripts/run-orchestrator.js) | Auto-rebuild MCP server + launch orchestrator | Forwards all args to `orchestrate` |

Conventions:
- All `scripts/*.js` are **CommonJS** (`'use strict'`, `require()`).
- Cross-platform: `process.platform === 'win32'` checks, `path.join()` everywhere, `.cmd` suffixes for npm/pip on Windows.
- `.mcp.dist.json` has a placeholder path that requires rewriting with the real absolute path.

## Approach / Architecture

### Two Modes: Interactive Menu + Direct CLI

```
node scripts/cli.js                      ← Interactive mode (main menu)
node scripts/cli.js setup                ← Direct: run setup wizard
node scripts/cli.js setup --all          ← Direct: non-interactive full setup
node scripts/cli.js sync-personas        ← Direct: sync personas to IDE
node scripts/cli.js gui                  ← Direct: launch GUI dashboard
node scripts/cli.js orchestrator         ← Direct: launch orchestrator
node scripts/cli.js package-personas     ← Direct: build + ZIP personas
node scripts/cli.js bundle-docs          ← Direct: compile doc bundles
node scripts/cli.js check-roles          ← Direct: role parity check
node scripts/cli.js build-personas       ← Direct: build personas only
node scripts/cli.js help                 ← Show all commands
```

### Interactive Main Menu

When invoked with no arguments, the script shows a TUI main menu headed by a pseudo-3D ASCII art banner. Unicode box-drawing characters (`─`, `│`, `╭`, `╮`, `╰`, `╯`, etc.) are used freely for borders and dividers — all modern terminals (Windows Terminal, PowerShell, cmd with UTF-8, macOS Terminal, Linux) support them, and contemporary CLI tools (Claude Code, GitHub CLI, Vite) set the precedent.

```
       _    ___   ____              _         __    __
      / \  |_ _| |_ _| _ __   ___ (_)  __ _ | |__ | |_  ___
     / _ \  | |   | | | '_ \ / __|| | / _` || '_ \| __|/ __|
    / ___ \ | |  _| |_| | | |\__ \| || (_| || | | | |_ \__ \
   /_/   \_\___||_____|_| |_||___/|_| \__, ||_| |_|\__||___/
                                       |___/

  Setup & Configuration
    1. First-time setup          Full workspace setup wizard
    2. Scaffold .mcp.json        Generate IDE MCP config
    3. Install git hooks         Pre-commit persona guard

  Personas
    4. Sync personas             Build + deploy to VS Code / Claude Code
    5. Build personas            Build only (no deploy)
    6. Package personas          Build + ZIP standalone personas

  MCP Server
    7. Launch GUI dashboard      Open the ledger GUI in browser

  Orchestrator
    8. Run orchestrator          Auto-rebuild MCP server + launch

  Validation & Utilities
    9. Check role parity         Verify persona ↔ MCP server roles
    0. Bundle docs               Compile doc bundles

  [q] Quit

  Choose [0-9]:
```

The banner is rendered in cyan (`\x1b[36m`) with a dim version subtitle underneath showing the workspace version from `changelog.md`. The category headers use bright/bold white. This matches the color palette already used in `sync-personas.js`.

Each menu item runs its corresponding command. Items that accept sub-options (sync-personas, build-personas, etc.) prompt for them interactively when launched from the menu, or accept them as CLI flags when invoked directly.

### Architecture: Command Registry

```
scripts/cli.js
  │
  ├─ Command registry: array of { id, label, category, description, run(args) }
  │
  ├─ CLI parser: extract command name + remaining flags
  │     ├─ No command → interactive menu
  │     ├─ 'help' → print usage
  │     └─ <command> [...flags] → run(flags) directly
  │
  ├─ Interactive menu: single-keypress selection using readline raw mode
  │
  └─ Commands (each command is a self-contained function):
       ├─ setup       (multi-step setup wizard — absorbed orchestrator + hook logic)
       ├─ mcp-json    (scaffold .mcp.json from .mcp.dist.json)
       ├─ git-hooks   (git config core.hooksPath)
       ├─ sync-personas    (delegates to scripts/sync-personas.js with forwarded args)
       ├─ build-personas   (delegates to scripts/build-personas.js with forwarded args)
       ├─ package-personas (delegates to scripts/package-personas.js with forwarded args)
       ├─ gui              (delegates to scripts/run-gui.js with forwarded args)
       ├─ orchestrator     (delegates to scripts/run-orchestrator.js with forwarded args)
       ├─ check-roles      (delegates to scripts/check-known-roles.js)
       └─ bundle-docs      (delegates to scripts/bundle-docs.js with forwarded args)
```

### "setup" Command — The First-Time Wizard

This is the only command with multi-step interactive logic. It presents a toggleable checkbox menu (same as the previous plan):

```
Select components to set up:

  [x] 1. MCP Server       npm install + build
  [x] 2. Personas         npm install + build + sync to IDE
  [ ] 3. Orchestrator     Python venv + pip install
  [x] 4. .mcp.json        IDE MCP server config
  [x] 5. Git hooks        Pre-commit persona guard

  (done) = already set up — toggle to re-run

  [a] Toggle all   [Enter] Run   [q] Back
```

After execution, runs validation and prints a summary table.

Non-interactive: `node scripts/cli.js setup --all` or `node scripts/cli.js setup --components mcp-server,personas`.

### Delegation vs. Absorption

| Command | Strategy | Rationale |
|---------|----------|-----------|
| `setup` (MCP Server) | **Inline** `npm install` + `npm run build` | Trivial, 2 lines |
| `setup` (Orchestrator) | **Absorb** from `setup-orchestrator.js` | User wants single entry point; original script deleted |
| `setup` (.mcp.json) | **Inline** | Trivial file copy + path rewrite |
| `setup` (Git hooks) | **Inline** | One-liner |
| `sync-personas` | **Delegate** to `scripts/sync-personas.js` | 520 lines, complex, no benefit to duplicating |
| `build-personas` | **Delegate** to `scripts/build-personas.js` | 732 lines, complex |
| `package-personas` | **Delegate** to `scripts/package-personas.js` | 249 lines, has ZIP logic |
| `gui` | **Delegate** to `scripts/run-gui.js` | Long-running process, needs stdio piping |
| `orchestrator` | **Delegate** to `scripts/run-orchestrator.js` | Needs stdio pass-through |
| `check-roles` | **Delegate** to `scripts/check-known-roles.js` | Standalone validation |
| `bundle-docs` | **Delegate** to `scripts/bundle-docs.js` | Standalone utility |

Delegation uses `child_process.spawnSync` (for blocking commands) or `child_process.spawn` with `stdio: 'inherit'` (for long-running/interactive commands like `gui` and `orchestrator`).

## Rationale

- **Single mental model:** `node scripts/cli.js` is the only invocation a user ever needs to learn. The menu is self-documenting.
- **Direct CLI mode preserves scriptability:** Every menu item is also a first-class CLI subcommand, so automation and CI still work without the TUI.
- **Delegation keeps scripts DRY:** Complex scripts like `sync-personas.js` and `build-personas.js` remain unchanged and are invoked as child processes. No logic duplication.
- **Setup wizard absorbs orchestrator:** Eliminates `setup-orchestrator.js` as a separate concern. The first-time experience is one command.
- **Zero dependencies:** Only Node.js built-ins. The interactive menu uses `readline` in raw mode with ANSI escape codes.

## Detailed Steps

### Step 1: Create `scripts/cli.js`

**New file:** `scripts/cli.js` (~500–600 lines, CommonJS)

Top-level structure:
```
1.  Shebang + strict mode
2.  Constants (paths, colors, platform checks)
3.  Utility helpers (runCmd, runScript, log, color helpers)
4.  Command definitions (registry array)
5.  "setup" command implementation
    a. Component registry with detect/run/validate per component
    b. Orchestrator setup (absorbed from setup-orchestrator.js)
    c. .mcp.json scaffold
    d. Git hooks setup
    e. Checkbox menu for interactive mode
    f. Validation + summary
6.  CLI argument parser (extract subcommand + flags)
7.  Interactive main menu (raw stdin keypress handler)
8.  Entry point: dispatch to menu or direct command
```

### Step 2: Implement Command Registry

Each command is a plain object:

```javascript
const COMMANDS = [
  {
    id: 'setup',
    key: '1',
    label: 'First-time setup',
    category: 'Setup & Configuration',
    description: 'Full workspace setup wizard',
    run: (args) => runSetup(args),
  },
  {
    id: 'mcp-json',
    key: '2',
    label: 'Scaffold .mcp.json',
    category: 'Setup & Configuration',
    description: 'Generate IDE MCP server config',
    run: () => scaffoldMcpJson(),
  },
  // ... etc
];
```

### Step 3: Implement `runScript()` Helper

Delegation helper that spawns a sibling script:

```javascript
function runScript(scriptName, args = [], opts = {}) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  const result = spawnSync('node', [scriptPath, ...args], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
    ...opts,
  });
  if (result.status !== 0) {
    log(`✗ ${scriptName} exited with code ${result.status}`, 'red');
    process.exit(result.status ?? 1);
  }
}
```

For long-running commands (`gui`, `orchestrator`), use `spawn` (non-sync) with `stdio: 'inherit'` and forward exit code.

### Step 4: Implement the Setup Wizard

Absorb from `setup-orchestrator.js` and combine with the setup logic from the previous plan. The wizard has 5 components:

1. **MCP Server** — `npm install` + `npm run build` in `mcp-server/`
2. **Personas** — `npm install` in `personas/` + invoke `sync-personas.js`
3. **Orchestrator** — Find Python 3.11+ → create venv → upgrade pip → `pip install -e ".[anthropic,dev]"` → scaffold `.env`
4. **`.mcp.json`** — Copy `.mcp.dist.json`, rewrite placeholder path with real absolute path to `mcp-server/src/index.ts`
5. **Git hooks** — `git config core.hooksPath .githooks`

Interactive mode: checkbox menu with detection of already-completed components.
Non-interactive: `--all` runs everything, `--components x,y` runs selected.

After execution: validation pass with `✓`/`✗` summary.

### Step 5: Implement Interactive Main Menu

Use `readline` with `process.stdin.setRawMode(true)` to capture single keypresses:

- Display categorized numbered list of commands
- User presses a key (1–9, 0) → execute that command
- `q` quits
- After command completes, return to menu (unless it was a long-running process)

Menu items that accept sub-options show a follow-up prompt. For example, selecting "Sync personas" asks:

```
Sync target:
  1. Both VS Code + Claude Code (default)
  2. VS Code only
  3. Claude Code only
  [Enter] = default
```

### Step 6: Implement Each Delegating Command

Each is a thin function that calls `runScript()`:

```javascript
function cmdSyncPersonas(args) {
  runScript('sync-personas.js', args);
}

function cmdBuildPersonas(args) {
  runScript('build-personas.js', args);
}

function cmdPackagePersonas(args) {
  runScript('package-personas.js', args);
}

function cmdGui(args) {
  // Long-running: use spawn, not spawnSync
  runLongScript('run-gui.js', args);
}

function cmdOrchestrator(args) {
  runLongScript('run-orchestrator.js', args);
}

function cmdCheckRoles() {
  runScript('check-known-roles.js');
}

function cmdBundleDocs(args) {
  runScript('bundle-docs.js', args);
}
```

### Step 7: Delete `setup-orchestrator.js`

Remove `scripts/setup-orchestrator.js`. The user explicitly stated no backward compatibility is needed. Add a comment in `cli.js` noting the absorb.

### Step 8: Update Root README.md

Replace the current multi-step Quick Start with a primary entry:

```markdown
### Quick Start

```bash
node scripts/cli.js
```

Or run the full setup non-interactively:

```bash
node scripts/cli.js setup --all
```
```

Update the "Key scripts" table to lead with `cli.js` and note that all other scripts are also accessible through it.

### Step 9: Update AGENTS.md Root-Level Tooling Table

Add `scripts/cli.js` to the root-level tooling table and note the removal of `setup-orchestrator.js`.

## Dependencies

- **Node.js >= 18** — for `fs.rmSync` with `recursive`, modern readline, stable raw mode.
- **npm** — ships with Node.js.
- **Python 3.11+** — only for the orchestrator setup component; gracefully skipped when unavailable.
- **git** — for git hooks and role parity check; gracefully handled if missing.

## Required Components

| Component | Type | Path |
|-----------|------|------|
| `scripts/cli.js` | **New file** | `scripts/cli.js` |
| `scripts/setup-orchestrator.js` | **Delete** | (absorbed into `cli.js`) |
| `README.md` | **Modify** | Update Quick Start + Key scripts table |
| `AGENTS.md` | **Modify** | Update Root-Level Tooling table |

## Assumptions

1. Node.js >= 18 is installed and on PATH.
2. The script is run from the workspace root (verified by checking for `mcp-server/` directory).
3. Existing scripts (`sync-personas.js`, `build-personas.js`, etc.) remain functional and unchanged — `cli.js` delegates to them.
4. `extract-changelog-entry.js` is not exposed in the menu because it's a CI-only utility (if the user wants it added later, it's trivial).
5. When stdin is not a TTY (piped/CI), the script requires an explicit subcommand or prints usage and exits.

## Constraints

- **Zero external dependencies:** Only Node.js built-in modules.
- **CommonJS:** `'use strict'`, `require()` — matches existing script conventions.
- **Cross-platform:** Windows (PowerShell + cmd), macOS, Linux. Use `process.platform === 'win32'` checks; `path.join()` for all paths; `.cmd` suffixes for npm/pip on Windows.
- **Idempotent setup:** All setup components safe to re-run.
- **Non-destructive by default:** `.mcp.json` and `orchestrator/.env` are not overwritten unless `--force` or user confirms.
- **Delegated scripts are untouched:** `cli.js` does not modify any existing script.

## Out of Scope

- **`extract-changelog-entry.js` in menu** — CI-only utility, not user-facing. Can add later if desired.
- **Remote/update checking** — no `git pull` or version checking logic.
- **VS Code task/launch.json integration** — outside this script's concern.
- **Any changes to delegated scripts** — they remain standalone and unchanged.

## Acceptance Criteria

1. `node scripts/cli.js` (no args) shows an interactive main menu with all commands categorized.
2. Pressing a number key runs the corresponding command instantly.
3. `node scripts/cli.js setup` shows the interactive setup wizard with checkbox toggles.
4. `node scripts/cli.js setup --all` runs full setup non-interactively, exits 0 on success.
5. `node scripts/cli.js setup --components mcp-server,personas` runs only specified setup steps.
6. `node scripts/cli.js sync-personas` delegates to `sync-personas.js` correctly.
7. `node scripts/cli.js sync-personas --target vscode` forwards flags to the delegated script.
8. `node scripts/cli.js gui` launches the GUI dashboard (long-running, stdio inherited).
9. `node scripts/cli.js orchestrator plan.md --dry-run` forwards args to `run-orchestrator.js`.
10. `node scripts/cli.js help` prints a list of all commands with descriptions.
11. `scripts/setup-orchestrator.js` is deleted.
12. `.mcp.json` scaffold writes the correct absolute path to `mcp-server/src/index.ts`.
13. Setup validation prints `✓`/`✗` per component in a summary table.
14. Works on Windows PowerShell.
15. `README.md` updated with new Quick Start section.
16. `AGENTS.md` root-level tooling table updated.

## Testing Strategy

- **Full setup smoke test:** Delete `node_modules/`, `dist/`, `.venv/`, `.mcp.json` and run `node scripts/cli.js setup --all`. All 5 components should pass validation.
- **Idempotency:** Run setup twice. Second run should show `(done)` labels and skip redundant work.
- **Selective setup:** `node scripts/cli.js setup --components mcp-server` — only MCP server built.
- **Delegation smoke test:** Run each delegated command (`sync-personas`, `build-personas`, `package-personas`, `check-roles`, `bundle-docs`) and verify it produces the same output as invoking the underlying script directly.
- **Long-running commands:** `node scripts/cli.js gui` should start the server and open browser; Ctrl+C should exit cleanly.
- **No-Python test:** Run setup without Python on PATH — orchestrator component fails gracefully, others succeed.
- **Windows test:** Run on Windows PowerShell — verify paths, `.cmd` suffixes, venv `Scripts/` dir.
- **Non-TTY test:** `echo "" | node scripts/cli.js` should print usage or require `--all` / subcommand.
- **Flag forwarding:** `node scripts/cli.js sync-personas --target vscode --dry-run` should pass both flags through.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Python not found** | Graceful skip with actionable error message during setup; other components succeed |
| **Raw mode TTY quirks on Windows** | Use `readline` interface for single-keypress capture; fallback to line-based input if raw mode fails |
| **Delegated script changes its interface** | `cli.js` forwards args verbatim — it doesn't parse script-specific flags, so interface changes are transparent |
| **Menu item count grows over time** | Categorized layout + numeric keys scale to ~15 items before needing sub-menus; sufficient for foreseeable needs |
| **`setup-orchestrator.js` removal breaks references** | Search for all references (`README.md`, `AGENTS.md`, any `package.json` scripts) and update them |
| **Node.js < 18** | Pre-flight check aborts early with clear version requirement |
