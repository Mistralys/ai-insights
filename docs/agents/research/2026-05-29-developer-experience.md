# Research Report

## Problem Statement

How can we make the ai-insights workspace easier to set up and use — both for first-time
project setup and daily usage across the three-project workspace (`ai-insights`,
`ai-persona-builder`, `cli-menu`)? The project already has an interactive CLI menu that
auto-bootstraps dependencies and a setup wizard, but the MCP server still requires "central"
configuration that users must understand and set up manually, the GUI dashboard requires manual
launching, and the interactive menu does not surface project health at a glance. What additional
automation, tooling, or UX improvements could reduce friction end-to-end?

## Problem Decomposition

1. **First-clone friction** — What steps must a new user complete before they can run anything?
   What remains manual after `node scripts/cli.js setup --all`?
2. **MCP server registration** — The ledger server is cross-project by design (single instance,
   shared state). Global/user-level registration is the architecturally correct config —
   per-project `.mcp.json` is a workaround, not the intended model.
3. **Multi-repo coordination** — How well are the sibling-directory dependencies handled?
4. **Cross-project portability** — With global registration, opening any project should give
   immediate ledger access without per-project setup.
5. **Interactive menu ergonomics** — Are the most common daily tasks immediately reachable?
6. **Discoverability** — Can users find commands and understand what they do without reading
   docs?
7. **Feedback & status** — Does the CLI surface project health at a glance? How does a user
   know everything is working after setup?
8. **GUI dashboard accessibility** — The dashboard requires a manual terminal launch. Can it
   become an always-available companion?
9. **Update/maintenance burden** — What happens when the user pulls new changes?

## Context & Constraints

- Three sibling repos in a VS Code multi-root workspace: `ai-insights`, `ai-persona-builder`,
  `cli-menu`.
- `ai-insights` depends on `@mistralys/cli-menu` (currently `^1.0.0` in `package.json`) and
  uses `@mistralys/persona-builder` for builds.
- `cli-menu` is zero-dependency by design — no npm packages allowed in production deps.
- All platforms (Windows/macOS/Linux) must be supported.
- `preflight-bootstrap.js` already auto-builds sibling repos if `dist/` is missing.
- The interactive menu is a single-keypress TUI — no arrow-key navigation for commands.
- The MCP server runs as a subprocess spawned by the IDE — it's not a standalone daemon.
- VS Code supports both workspace-level (`.vscode/mcp.json`) and user-level MCP config.
- Claude Code supports local, project, and user-scoped MCP registration via
  `claude mcp add --scope user`.
- The `central_pm` server name is a critical synchronization point — personas reference it by
  name.
- The GUI dashboard is a separate raw `node:http` server (vanilla HTML/JS/CSS SPA) on port
  3420. It shares the same ledger directory and code modules as the MCP server.
- The target audience is developers who use AI coding agents in their daily workflow.

## Prior Art & Known Patterns

### Pattern 1: Status Dashboard on Menu Render

- **Description:** Show a compact health summary (component states, versions, staleness) at the
  top of the interactive menu every time it renders, below the banner.
- **Where used:** Homebrew `brew doctor`, `rustup show`, `flutter doctor`.
- **Strengths:** Users see problems before they try to run a command. No extra "check" command
  needed.
- **Weaknesses:** Adds ~100 ms of synchronous file-stat checks per render. May clutter the menu
  for users who just want to pick a command.
- **Fit:** High. The `detect()` functions already exist on `SETUP_COMPONENTS`. Rendering a
  5-line status block is cheap.
- **Selected:** [Tier 1]

### Pattern 2: Global MCP Registration Script

- **Description:** A dedicated `install-mcp` CLI command that registers the MCP server at the
  user/global level for both VS Code and Claude Code, so it's available in every workspace
  without per-project `.mcp.json`.
- **Where used:** `claude mcp add --scope user`, VS Code user-level `mcp.json`. Analogous to
  how `gh auth login` configures credentials globally.
- **Strengths:** One-time setup. Works for all projects immediately. Architecturally correct —
  the ledger server is cross-project by design (single instance managing state for N projects),
  so global registration matches the server's actual role. Per-project `.mcp.json` was always a
  workaround.
- **Weaknesses:** Uses absolute paths — breaks if the repo moves. Must handle graceful fallback
  if the path becomes invalid.
- **Fit:** HIGH — this isn't just a convenience, it's the semantically correct configuration
  for a server designed to be shared across all workspaces.
- **Selected:** [Tier 1]

### Pattern 3: npx-Based Zero-Install Server

- **Description:** Publish the MCP server as an npm package so users can reference it as
  `"command": "npx", "args": ["@mistralys/project-ledger"]` — no local clone needed.
- **Where used:** `@modelcontextprotocol/server-memory`, `mcp-server-fetch`, and most
  npm-distributed MCP servers.
- **Strengths:** Eliminates the need to clone the repo. Auto-updates via npm. Universal config
  snippet (no absolute paths).
- **Weaknesses:** Requires publishing to npm. Dev/contrib workflow still needs the repo. Version
  drift between published server and local personas.
- **Fit:** HIGH for distribution, but a separate concern from the "developer working on the
  project" DX.
- **Selected:** [MAYBE] _Needs further thought_

### Pattern 4: Unified Workspace Bootstrap Script

- **Description:** A single `./bootstrap` (or `npm run bootstrap`) entry point that handles all
  first-time setup: clone missing siblings, install all deps, build, scaffold config files, and
  install hooks.
- **Where used:** Monorepo tools (Nx, Turborepo), Chromium's `fetch` + `gclient sync`.
- **Strengths:** One command does everything. No prerequisite knowledge needed.
- **Weaknesses:** `preflight-bootstrap.js` already exists but doesn't clone missing repos or
  offer any guidance when a sibling is absent.
- **Fit:** High. The bootstrap script exists but could be enhanced.
- **Selected:** [Tier 1]

### Pattern 5: npm Workspaces Root

- **Description:** Use npm workspaces (or pnpm workspaces) to declare the three repos as a
  single monorepo with linked packages, eliminating `file:` dependency hacks and sibling-clone
  requirements.
- **Where used:** Standard practice in JS monorepos (Lerna, Turborepo, pnpm).
- **Strengths:** `npm install` at the root resolves all cross-links. No manual clone needed.
  Hoisted `node_modules` reduces disk usage.
- **Weaknesses:** Requires restructuring the repo layout or adding a parent `package.json` that
  wraps all three. May conflict with independent publishing of `cli-menu` and `persona-builder`.
- **Fit:** Medium-low for now. Both `cli-menu` and `persona-builder` are published npm packages.
  The sibling `file:` paths are already gone (`^1.0.0` in `package.json`). Once published,
  the only blocker is that development-time changes to `cli-menu` don't propagate without a
  rebuild. `npm link` or conditional `overrides` would solve this more surgically.
- **Selected:** [NO] _Not a good fit for the project._

### Pattern 6: Diagnostic/Health-Check Command ("Doctor")

- **Description:** A comprehensive `doctor` command that performs a full environment audit:
  checks Node version, sibling repos, dist freshness, Python venv, `.mcp.json` validity, hook
  installation, persona staleness, MCP server reachability, and global config presence. Prints
  a clear pass/fail report with actionable fix suggestions.
- **Where used:** `brew doctor`, `flutter doctor`, `npx next info`, `npx expo doctor`.
- **Strengths:** Single command to verify everything works. Provides actionable fix commands.
  Great for troubleshooting. Agents can run it programmatically.
- **Weaknesses:** Doesn't fix the problem — only reports it. Duplicates some preflight logic.
- **Fit:** HIGH — extends the existing preflight pattern to be more user-facing. Most detection
  logic already exists in `SETUP_COMPONENTS[].detect()` and `preflight-orchestrator.js`.
- **Selected:** [Tier 1]

### Pattern 7: Shell Alias / Global CLI

- **Description:** Offer a global-install path (`npm install -g ai-insights-cli`) or document
  a shell alias so users can type `ai` instead of `node scripts/cli.js` or `./menu.sh`.
- **Where used:** Angular CLI (`ng`), Vue CLI (`vue`), Gatsby CLI, Create React App.
- **Strengths:** Shorter invocation. Feels like a first-class tool.
- **Weaknesses:** Global installs pollute the user's environment. Shell aliases vary by OS.
  `menu.sh` / `menu.cmd` already provide this, but aren't well-documented.
- **Fit:** Medium. The `menu.sh`/`menu.cmd` wrappers exist. Documenting and promoting them
  (or adding an npm `bin` field) would suffice.
- **Selected:** [Tier 2]

### Pattern 8: Subcommand Help with Examples

- **Description:** Enhance `--help` output with per-command examples, common recipes, and
  contextual guidance (like `git help commit` or `docker run --help`).
- **Where used:** Git, Docker, Kubernetes CLI (`kubectl explain`).
- **Strengths:** Self-documenting. Users don't have to leave the terminal.
- **Weaknesses:** Verbose help can overwhelm. Needs careful editing.
- **Fit:** Medium. The `helpVariants` system already shows alternative forms. Adding brief
  examples or a "common recipes" section would improve discoverability.
- **Selected:** [MAYBE] _Requires user feedback once the userbase grows_

### Pattern 9: VS Code Extension as Installer

- **Description:** Ship a VS Code extension that configures the MCP server in user settings,
  installs personas, and provides a status bar indicator.
- **Where used:** GitHub Copilot, Continue.dev, Cline — all ship as extensions that
  self-configure.
- **Strengths:** Zero terminal interaction needed. Integrates with VS Code's MCP API directly.
  Can show real-time status (server running, ledger active, current agent).
- **Weaknesses:** Significant development investment. Separate maintenance burden. Doesn't help
  Claude Code users.
- **Fit:** DISMISSED — the tool serves Claude Code and VS Code users equally, so a VS Code-only
  extension's development and maintenance overhead isn't warranted. The agent-plugin marketplace
  infrastructure is expected to mature over the coming months and absorb what this would solve.
  See *Dismissed Ideas*. Pattern 13 (`.vscode/tasks.json`) captures the high-value, IDE-native
  subset at near-zero cost.
- **Selected:** [NO] _See dismissed ideas._

### Pattern 10: Target-Project Init Command

- **Description:** An `init` command the user runs inside their target project to scaffold the
  ledger configuration (`.mcp.json`, initial plan template, `AGENTS.md` skeleton).
- **Where used:** `npm init`, `eslint --init`, `cline init`. Many tools have project-scoped
  initialization.
- **Strengths:** Makes "start using ledger in project X" a single command. Can be idempotent.
- **Weaknesses:** Requires the user to know to run it. Per-project config still needed if not
  using global MCP registration.
- **Fit:** DISMISSED — global MCP registration (Pattern 2) is certain to be implemented, which
  makes per-project `.mcp.json` scaffolding unnecessary. The ledger becomes available in every
  workspace without an `init` step. See *Dismissed Ideas*.
- **Selected:** [NO] _See dismissed ideas._

### Pattern 11: Self-Updating Wrapper Script

- **Description:** After `git pull`, the menu automatically detects changes and rebuilds
  affected components before presenting the menu.
- **Where used:** Homebrew's `brew update && brew upgrade`, `rustup update`.
- **Strengths:** User never runs stale code. No manual "rebuild after pull" step.
- **Weaknesses:** Slow startup on first run after update. May confuse users with unexpected
  builds.
- **Fit:** MEDIUM — `preflight-bootstrap.js` already partially does this for `cli-menu` and
  `ai-persona-builder`.
- **Selected:** [Tier 1]

### Pattern 12: Smart Defaults via Contextual Suggestions

- **Description:** Instead of a flat keypress list, show contextual suggestions based on project
  state (e.g. "Personas are stale — sync now? [y/n]").
- **Where used:** GitHub CLI (`gh`), Vercel CLI, Angular CLI schematics.
- **Strengths:** Guides the user toward the right action. Reduces cognitive load.
- **Weaknesses:** Harder to implement in a single-keypress TUI. Would need to change
  the menu architecture (currently a static render → keypress loop).
- **Fit:** Medium. A lighter variant would be a "suggested action" line at the bottom of the
  status block (no interactive prompt — just an informational hint).
- **Selected:** [Tier 2]

### Pattern 13: IDE Integration via `.vscode/tasks.json`

- **Description:** Check in a `.vscode/tasks.json` at the workspace root that exposes key
  commands (doctor, install-mcp, gui, sync-personas) as VS Code tasks. Users trigger them via
  `Cmd+Shift+P → Run Task` or assign keyboard shortcuts — zero code required.
- **Where used:** Every mature VS Code project (ESLint, Prettier, Angular, Rust Analyzer).
  Standard VS Code feature since 1.x.
- **Strengths:** Zero implementation cost (just a JSON file). Surfaces CLI commands directly in
  the IDE's native Command Palette. Users can bind keyboard shortcuts. Works alongside any
  future extension without conflict.
- **Weaknesses:** VS Code-only — doesn't help Claude Code or terminal-only users. Limited to
  predefined commands (no dynamic state display).
- **Fit:** HIGH — captures ~80% of Pattern 9's value (VS Code extension) at near-zero cost.
  No `.vscode/tasks.json` currently exists in the workspace.
- **Selected:** [Tier 2]

### Pattern 14: `post-merge` Git Hook for Auto-Rebuild

- **Description:** Add a `post-merge` hook to `.githooks/` that detects changed source files
  after `git pull` and auto-rebuilds affected `dist/` outputs (or prints a warning). Currently
  only `pre-commit` exists.
- **Where used:** Many monorepos use `post-merge` or `post-checkout` hooks for dependency
  installs (Husky recipes, Lefthook). Android and Chromium repos auto-sync after pulls.
- **Strengths:** Eliminates "forgot to rebuild after pull" failures. Runs automatically — no
  user action needed. Leverages the existing `.githooks/` infrastructure and
  `install-hooks.js`. Lighter than Pattern 11 (runs once after pull, not on every menu open).
- **Weaknesses:** Adds a few seconds to `git pull` when rebuilds are needed. May surprise users
  who aren't expecting post-pull output.
- **Fit:** HIGH — the `.githooks/` directory already exists with a `pre-commit` hook, and
  `install-hooks.js` already sets `core.hooksPath`. Adding `post-merge` is trivial.
- **Selected:** [Tier 3]

### Pattern 15: npm `bin` Field for `npx` Invocation

- **Description:** Add a `bin` field to `ai-insights/package.json` mapping a short command name
  (e.g. `ai-insights`) to `scripts/cli.js`, so the CLI can be launched as `npx ai-insights` from
  the workspace root — and as a bare `ai-insights` once installed globally or linked.
- **Where used:** Virtually every npm-distributed CLI (`eslint`, `prettier`, `vite`, `tsx`).
  The `bin` field is the standard mechanism for exposing an executable from a package.
- **Strengths:** Near-zero cost (a few lines of JSON + a shebang on `cli.js`). Gives the tool a
  first-class, memorable invocation without a separate global install step. Complements the
  existing `menu.sh` / `menu.cmd` wrappers rather than replacing them. Works cross-platform —
  npm generates the `.cmd` shim on Windows automatically.
- **Weaknesses:** `npx ai-insights` from the workspace root only resolves if the package is
  installed/linked; for a bare clone it still requires `npm install` first. The bare
  `ai-insights` form needs a global install or `npm link`, which reintroduces the
  environment-pollution caveat noted in Pattern 7.
- **Fit:** HIGH — trivial to add, and it makes the promoted `menu.sh` / `menu.cmd` story
  (Phase 1.5) feel like a real CLI. `cli.js` needs a `#!/usr/bin/env node` shebang and the
  executable bit (npm sets this on install).
- **Selected:** [Tier 1]

## Alternative & Creative Approaches

### Approach A: Status Lines in the Interactive Menu Header

- **Approach:** Extend `renderMenu()` in `cli-menu` to accept an optional `statusLines`
  config property — an array of functions that return colored status strings. The AI Insights
  CLI then supplies component health as `statusLines`, rendered between the banner and the
  command list.
- **Rationale:** Combines Pattern 1 (dashboard) with the existing architecture cleanly. The
  library stays zero-dependency and generic; the consumer provides the status logic.
- **Risk:** Very low. Adds a few lines to the renderer. No breaking change. Optional property.
- **Selected:** [ ]

### Approach B: Global Install Model

**One-time global install** (`node scripts/cli.js install --global`): Registers the MCP server
at user level in VS Code and Claude Code, and deploys personas globally. After this single step
the ledger is available in every workspace with no per-project configuration.

- **Rationale:** Mirrors how linters/formatters work — install once at the user level. The MCP
  server is *already* central by design; the config should match that mental model. (A
  per-project `activate`/`init` step was considered and dismissed — see Pattern 10 and
  *Dismissed Ideas* — because global registration makes per-project `.mcp.json` scaffolding
  redundant.)
- **Risk:** Absolute path fragility. Mitigation: the stable-shim indirection under Open
  Questions → *Path stability*, plus a health-check that warns if paths are invalid.
- **Selected:** [NO] _See dismissed ideas._

### Approach C: Smart Defaults with Zero-Config Detection

Enhance the MCP server startup to auto-discover its environment:
1. The server detects its own absolute path at startup.
2. If no `--agents-dir` is passed, it auto-scans known locations (already done).
3. A new `--self-register` flag makes the server write itself into VS Code user settings
   and/or Claude Code user config on first run.
4. A scheduled (or IDE-triggered) freshness check rebuilds if source files changed.

- **Rationale:** "Convention over configuration" — reduce explicit config steps to zero.
- **Risk:** Self-registration is spooky action-at-a-distance. Opt-in flag mitigates this.
- **Selected:** [Tier 2]

### Approach D: First-Run Wizard Trigger

- **Approach:** When the interactive menu detects that no setup has been completed (all
  `detect()` functions return `false`), automatically redirect to the setup wizard instead of
  showing the main menu. Show a banner like "First run detected — let's get you set up."
- **Rationale:** Eliminates the "I launched the menu but nothing works because I haven't run
  setup" failure mode.
- **Risk:** Slightly surprising for users who intentionally skip setup. Mitigate with a
  `--skip-setup-check` flag or a "press q to skip" escape hatch.
- **Selected:** [Tier 1]

### Approach E: `postinstall` Auto-Setup

- **Approach:** Add a `postinstall` script to `ai-insights/package.json` that runs setup
  checks and prints guidance (or auto-builds) after `npm install`.
- **Rationale:** After cloning and running `npm install`, the user immediately sees what's
  needed. No separate "read the README" step.
- **Risk:** `postinstall` scripts can be annoying in CI or when iterating on dependencies.
  Gate behind `process.stdout.isTTY` or an env flag.
- **Selected:** [MAYBE] _Needs more thought._

### Approach F: Embedded GUI via `--gui` Flag

- **Approach:** Add a `--gui` (or `--gui-port 3420`) flag to the MCP server entry point. When
  present, the MCP server also starts the dashboard HTTP listener on port 3420 in-process. The
  global MCP registration includes `--gui` by default — users get the dashboard for free.
- **Rationale:** Zero-config GUI — if the MCP server is running, the dashboard is available.
  No separate process. No manual launch. Process coupling is actually a *benefit*: when the
  MCP server rebuilds/restarts, the GUI restarts too — ensuring both always run the same code
  version with no drift.
- **Risk:** Port conflict handling required. Slightly increased MCP server memory footprint
  (~10–20 MB). Brief GUI downtime during IDE restarts (mitigated by the SPA's existing
  stale-instance detection polling). Feasible: the MCP stdio constraint only forbids
  non-JSON-RPC data on stdout — an HTTP listener on a TCP port is unrelated.
- **Security risk (blocking for default-on):** Auto-starting this server in *every* workspace
  changes its threat profile. The current `gui/server.ts` calls `server.listen(port)` with no
  host argument, so Node binds to all interfaces (`0.0.0.0`), not just loopback — and there is
  **no authentication** in front of mutating endpoints such as `handleDeleteProject`. A manual,
  short-lived dev server tolerates this; an always-on, network-reachable one registered globally
  does not. `--gui` must therefore be **opt-in** until the hardening in §1.4 lands (loopback
  bind + `Host`-header allowlist to defeat DNS-rebinding). See *GUI Security Considerations*
  below.

> **Note on global default:** Because each IDE window spawns its own MCP server, baking `--gui`
> into the global registration means N windows race for port 3420. The single-flight model in
> step 3 makes this safe and deterministic — first server wins, the rest defer — rather than
> scattering dashboards across adjacent ports.

- **Selected:** [Tier 2]

### Approach G: Workspace-Level npx Bootstrap

- **Approach:** Publish a thin `create-ai-insights` initializer package (like `create-next-app`
  or `create-vite`) that clones all three repos, runs `npm install` in each, builds, and opens
  VS Code with the multi-root workspace.
- **Rationale:** Zero-to-running in one command: `npx create-ai-insights ./my-workspace`.
- **Risk:** Medium. Maintaining a separate published package adds overhead. Only worthwhile if
  there's an external user base beyond the core developers.
- **Selected:** [Tier 3] _Only relevant for AI Insights development._

## Comparative Evaluation

| Criterion | Status in Menu (A) | Global MCP Install (B) | Doctor Command | GUI `--gui` Flag (F) | tasks.json (13) | post-merge Hook (14) | First-Run Wizard (D) | npm Zero-Install | Workspace Bootstrap (G) |
|---|---|---|---|---|---|---|---|---|---|
| **Complexity** | Low | Low | Low | Medium | Trivial | Low | Medium | Medium | High |
| **User impact** | High (passive, daily) | High (eliminates #1 pain) | Medium (on-demand) | High (always-on) | Medium (IDE users) | High (passive) | High (one-time) | High (no clone) | High (one-time) |
| **Daily benefit** | Every session | Every session | On-demand | Every session | Every session | After each pull | None after first | None after first | None after first |
| **Implementation effort** | ~2–4 hours | ~1–2 hours | ~2–3 hours | ~3–4 hours | ~30 min | ~1 hour | ~3–4 hours | ~1–2 days | ~1–2 days |
| **Risk** | Very low | Low (path breakage) | None | Low (port conflicts) | None | Very low | Low | Low (versioning) | Medium |
| **Platform concerns** | None | Cross-IDE paths | None | Port handling | VS Code only | Shell script compat | None | None | Shell scripts |
| **Helps new projects** | No | Yes (globally available) | No (diagnostic) | Yes (companion) | No | No | Yes (guides setup) | Yes (no local clone) | Yes |

## Recommendation

Implement improvements in a unified phased approach, combining daily-use ergonomics with
first-run automation and infrastructure improvements:

---

### Phase 1 — Immediate (low effort, high daily + first-run impact)

#### 1.0 Unified Health-Check Registry (foundation for 1.1, 1.3, and preflight)

Status lines (1.1), `doctor` (1.3), and the existing `preflight-orchestrator.js` all inspect
overlapping aspects of environment health — the report notes `doctor` "duplicates some preflight
logic." Rather than three parallel implementations, define **one** check registry and have each
feature select a subset.

**Implementation:**
1. Create `scripts/lib/health-checks.js` exporting an array of check descriptors:
   ```js
   { id, label, cost: 'instant' | 'fast' | 'slow', detect(): boolean | Promise, fix?: string }
   ```
   - `instant` (< 5 ms): file-existence stats (dist present, venv dir, hooks installed).
   - `fast` (< 50 ms): mtime comparisons, `.mcp.json`/global-config presence + parse.
   - `slow` (100 ms–2 s): persona staleness (`build-personas.js --check`), MCP reachability.
2. **Status lines** render only `instant` checks — safe on every menu render.
3. **`doctor`** runs every check (all tiers) and prints `fix` hints for failures.
4. **`preflight`** runs the orchestrator-relevant subset.
5. This mechanically resolves the "status line performance" open question: the `cost` tier, not
   ad-hoc judgement, decides what is safe to run where.

#### 1.1 Status Lines in the Interactive Menu (Approach A)

Add an optional `statusLines` property to `MenuConfig` in `cli-menu`. The AI Insights CLI
supplies quick-stat functions that check: MCP server built? Personas fresh? Python venv
exists? Hooks installed? Global MCP registered? Display as a compact block of colored
checkmarks below the version line.

**Implementation:**
1. Add `statusLines?: Array<() => string>` to `MenuConfig` in `cli-menu/src/types.ts`.
2. In `cli-menu/src/menu/renderer.ts`, after the version line, iterate `config.statusLines`
   and write each result.
3. In `ai-insights/scripts/cli.js`, supply `statusLines` that call existing `detect()`
   functions from `SETUP_COMPONENTS` and format as `✓ MCP Server` / `✗ Personas (stale)`.
   Include a GUI line surfacing the dashboard URL when reachable
   (`GUI ● http://localhost:3420`) — the embedded server only logs this to stderr, which is
   invisible under MCP, so the status block is the natural place to make it discoverable.

#### 1.2 Global MCP Registration Command (Pattern 2)

`node scripts/cli.js install-mcp` — the architecturally correct primary setup path.

**Implementation:**
1. Create `scripts/install-mcp-global.js` with functions for each IDE:
   - `installVSCode()`: Read existing user `mcp.json` (or create), merge in `central_pm`
     entry with `--gui` flag. Paths: `~/Library/Application Support/Code/User/mcp.json`
     (macOS), `~/.config/Code/User/mcp.json` (Linux), `%APPDATA%/Code/User/mcp.json` (Win).
   - `installClaudeCode()`: Spawn `claude mcp add --scope user --transport stdio central_pm
     -- npx tsx {abs_path}`.
   - `uninstall()`: Remove the entry / run `claude mcp remove --scope user central_pm`.
2. Register in `cli.js` as a new command (`id: 'install-mcp'`,
   `category: 'Setup & Configuration'`).
3. Add to the setup wizard as an optional step after `mcp-json`.
4. The existing `mcp-json` setup component becomes a secondary "workspace override" option.

**Config-safety requirements (this command mutates the user's global IDE config):**
- **`--dry-run` / `--print`:** Compute and display the exact JSON diff without writing, so the
   user (or a test) can inspect the change before it lands.
- **Timestamped backup:** Copy the existing `mcp.json` to `mcp.json.bak-<timestamp>` before
   merging.
- **Strict idempotency:** Merge only the `central_pm` key; never reorder, overwrite, or drop
   other servers' entries. Re-running the command must be a no-op when already installed.
- **Path indirection:** Write the launcher path via the stable shim described under Open
   Questions → *Path stability*, not a raw absolute repo path.

#### 1.3 Doctor Command (Pattern 6)

`node scripts/cli.js doctor` — comprehensive environment audit.

**Implementation:**
- Merge existing `preflight-orchestrator.js` checks with new ones: MCP server reachable?
  Personas deployed? Global MCP config present? Correct Node.js version? All sibling repos
  present? Hooks installed?
- Output a Flutter-doctor-style checklist with ✓/✗ and actionable fix commands.
- Add to the interactive menu as a top-level item.

#### 1.4 Embedded GUI via `--gui` Flag (Approach F)

Add `--gui` to the MCP server entry point. When the IDE spawns the MCP server, it also starts
the dashboard HTTP listener.

**Implementation:**
1. In `mcp-server/src/index.ts`, after `server.connect(transport)`:
   ```typescript
   if (args.includes('--gui')) {
     const port = parseGuiPort(args) ?? 3420;
     import('../gui/server-embedded.js').then(m => m.startEmbeddedGui(port));
   }
   ```
2. Create `gui/server-embedded.ts` — exports `startEmbeddedGui(port: number)`. It must:
   - Bind to **loopback only**: `server.listen(port, '127.0.0.1')` (the current `gui/server.ts`
     omits the host arg and binds `0.0.0.0`).
   - Enforce a **`Host`-header allowlist** (`localhost:<port>` / `127.0.0.1:<port>`) on every
     request, rejecting mismatches with `403` to defeat DNS-rebinding against the mutating
     `POST` routes.
   - Log to stderr (never stdout — MCP JSON-RPC constraint).
3. **Single-flight, not adjacent-port fallback.** On `EADDRINUSE`, do *not* hop to 3421–3429
   (that fragments the dashboard across ports when multiple IDE windows are open). Instead,
   health-ping `http://127.0.0.1:3420/api/insights`: if it answers as *our* dashboard, silently
   no-op (another window already owns it); otherwise log a single stderr warning and skip. This
   keeps exactly one canonical GUI at a stable URL regardless of how many MCP servers spawn.
4. **Keep `--gui` opt-in until the loopback bind + `Host` allowlist (step 2) ship.** Only after
   that hardening should the `install-mcp` command add `--gui` to the global registration by
   default. Provide `--no-gui` as the explicit opt-out.
5. Existing standalone `gui` command retains value for debugging/custom setups.

> **Note on global default:** Because each IDE window spawns its own MCP server, baking `--gui`
> into the global registration means N windows race for port 3420. The single-flight model in
> step 3 makes this safe and deterministic — first server wins, the rest defer — rather than
> scattering dashboards across adjacent ports.

#### 1.5 Promote `menu.sh` / `menu.cmd`

Add a "Quick Launch" section to the README showing the shell scripts. Also add an npm `bin`
field so `npx ai-insights` works from the workspace root (Pattern 15).

#### 1.6 `.vscode/tasks.json` (Pattern 13)

Check in a `.vscode/tasks.json` that exposes the most common operations as native VS Code
tasks.

**Implementation:**
1. Create `.vscode/tasks.json` with task definitions for: `doctor`, `install-mcp`,
   `sync-personas`, `gui`, `build-mcp`, and `orchestrator preflight`.
2. Use `"type": "shell"` with `node scripts/cli.js <command>` invocations.
3. Mark `doctor` as the default build task (`"group": { "kind": "build", "isDefault": true }`).
4. Add `"presentation": { "reveal": "always" }` so output is visible.
5. Users immediately get these commands in `Cmd+Shift+P → Run Task`.

---

### Phase 2 — Short-term (medium effort, first-run + maintenance impact)

#### 2.1 First-Run Auto-Redirect (Approach D)

When the menu detects zero components are set up, print a banner and redirect to the setup
wizard. Escape with `q`. Includes scope selection: "Register MCP server globally
(recommended) or workspace-only?"

#### 2.2 Enhanced Bootstrap (Pattern 4 extended)

Extend `preflight-bootstrap.js` to:
- Print clear instructions when `../cli-menu` or `../ai-persona-builder` are missing —
  including the exact `git clone` commands.
- Check if `mcp-server/dist/` is stale relative to `mcp-server/src/` (compare mtimes). If
  stale, rebuild automatically before presenting the menu.
- Only relevant for development mode; published deps don't need siblings.

#### 2.3 `postinstall` Guidance (Approach E)

After `npm install`, print a one-liner: "Run `./menu.sh` (or `node scripts/cli.js`) to
complete setup." Gate behind `process.stdout.isTTY`.

#### 2.4 `post-merge` Auto-Rebuild Hook (Pattern 14)

Add `.githooks/post-merge` to auto-rebuild stale `dist/` directories after `git pull`.

**Implementation:**
1. Create `.githooks/post-merge` (bash script, ~20 lines).
2. Compare `mcp-server/src/` mtime against `mcp-server/dist/` — if source is newer, run
   `npm run build` in `mcp-server/`.
3. Same check for `../cli-menu/src/` vs `../cli-menu/dist/` and
   `../ai-persona-builder/src/` vs `../ai-persona-builder/dist/` (if sibling exists).
4. Print a summary: "Rebuilt: mcp-server dist" or "All dist/ outputs are fresh."
5. Gate heavy rebuilds behind a quick file-stat comparison (< 50 ms overhead when nothing
   changed).
6. No changes to `install-hooks.js` needed — it already points `core.hooksPath` at
   `.githooks/`, so the new file is picked up automatically.

---

### Phase 3 — Long-term (when distribution matters)

#### 3.1 npm-Published MCP Server (Pattern 3)

Publish as `@mistralys/project-ledger-mcp` so external users don't need to clone this repo.
Config becomes: `"command": "npx", "args": ["@mistralys/project-ledger-mcp", "--gui"]` — no
absolute paths. Requires decoupling the server from the monorepo's build system.

#### 3.2 Per-Command Examples in Help (Pattern 8)

Extend `helpVariants` with brief example lines for the most common commands
(`sync-personas`, `gui`, `orchestrator`).

---

### Proof-of-Concept Outline (Phase 1 Validation)

To validate the highest-priority items quickly:

**Status lines (1.1):**
1. Add `statusLines?: Array<() => string>` to `MenuConfig` in `cli-menu/src/types.ts`.
2. In `cli-menu/src/menu/renderer.ts`, after the version line, iterate and write each result.
3. In `ai-insights/scripts/cli.js`, supply `statusLines` calling existing `detect()`.
4. Run `./menu.sh` — verify the status block appears below the version.

**Global MCP install (1.2):**
1. Create `scripts/install-mcp-global.js` with `installVSCode()` + `installClaudeCode()`.
2. Register in `cli.js` as a new command.
3. Run `node scripts/cli.js install-mcp` — verify user-level `mcp.json` updated.
4. Open a fresh project — verify `central_pm` is available without `.mcp.json`.

**Embedded GUI (1.4):**
1. Add `--gui` arg parsing to `mcp-server/src/index.ts`.
2. Create `gui/server-embedded.ts` with `startEmbeddedGui(port)`.
3. Update `.mcp.dist.json` to include `--gui` in args.
4. Restart IDE — verify `localhost:3420` serves the dashboard automatically.

## GUI Dashboard Analysis

### Current State

The GUI dashboard is a **separate process** from the MCP server — a raw `node:http` server
(no framework) that serves a vanilla HTML/JS/CSS SPA on port 3420. It shares the same ledger
directory and code modules as the MCP server but runs independently.

**Current launch path:**
1. User opens terminal
2. Runs `node scripts/cli.js gui` (or picks it from the menu)
3. Script spawns `tsx gui/server.ts`, waits for ready message, opens browser

**Pain points:**
- Must be started manually every time
- Requires a dedicated terminal window to stay open
- Easily forgotten — users lose visibility into ledger state
- No indication in the IDE that the GUI is available/running

### Alternative GUI Patterns Evaluated

| Pattern | Description | Fit |
|---------|-------------|-----|
| **G1: MCP spawns GUI (sidecar)** | HTTP listener inside MCP process | HIGH — zero-config |
| **G2: launchd/systemd service** | OS-level user service, always-on | MEDIUM — complex |
| **G3: VS Code Simple Browser** | In-editor panel for `localhost:3420` | LOW alone — complement |
| **G4: `--gui` flag (opt-in G1)** | MCP server starts GUI when flag present | **HIGH — recommended** |
| **G5: Tray/Menu Bar app** | Native system tray management | LOW — over-engineered |

### GUI Recommendation

**Pattern G4 (`--gui` flag)** is the clear winner — it combines G1's "it just works" quality
with explicit opt-in control. Once the security hardening below is in place, global MCP
registration can include `--gui`, making the GUI an invisible companion. Users bookmark
`localhost:3420` once and never think about it again. **Until then, `--gui` ships opt-in.**

### GUI Security Considerations

Moving the GUI from a manually-launched dev tool to an always-on, globally-registered companion
elevates its threat profile. Three issues must be resolved before `--gui` can be default-on:

1. **Bind to loopback only.** `gui/server.ts` currently calls `server.listen(port)` with no
   host argument — Node binds to `0.0.0.0` (all interfaces), exposing the dashboard to the
   local network. Change to `server.listen(port, '127.0.0.1')`.
2. **Block DNS-rebinding.** Even on loopback, a malicious web page the user visits can
   `fetch('http://localhost:3420/...')` and reach the mutating `POST` routes (including
   `handleDeleteProject`). Add a `Host`-header allowlist check (accept only `localhost:<port>`
   / `127.0.0.1:<port>`) and reject mismatches with `403`. This is the standard mitigation
   used by local dev servers (e.g. webpack-dev-server `allowedHosts`).
3. **No silent destructive surface.** Because the server can delete ledger projects, treat any
   future exposure beyond loopback (e.g. remote/devcontainer scenarios) as requiring an auth
   token. Out of scope for local-only use, but documented here so it isn't forgotten.

These are independent of the *availability* concern (port conflicts) covered under Open
Questions — they concern *exposure*, not reachability.

**Complementary:** Document a VS Code task/shortcut that runs `Simple Browser: Show` →
`http://localhost:3420` for in-editor access without a browser tab.

**Retained:** The standalone `node scripts/cli.js gui` command remains useful for debugging,
custom port/ledger-dir overrides, and users without global MCP registration.

## Open Questions

- **Path stability (resolved — stable-shim indirection):** Registering the global MCP server
  with a raw absolute repo path breaks silently if the user moves `ai-insights/`. **Resolution:**
  `install-mcp` writes a tiny launcher shim into a stable location (`~/.ai-insights/bin/`) whose
  only job is to read the real repo path from `~/.ai-insights/config.json` and exec the server.
  The global IDE config points at the *shim*, never the repo. Moving the repo → re-run
  `install-mcp`, which updates one line in `config.json`; no global-config edits needed. The
  server should also validate its resolved path on startup and log a clear stderr warning if it
  no longer exists. This indirection doubles as the migration path to the npx-published server
  (Phase 3.1) — only the shim's exec target changes.
- **~~Multiple installs:~~** *(Resolved — not a requirement.)* The project is designed for a
  single install. Users work on one active branch at a time; there is no use case for
  simultaneous STABLE and DEV registrations. The global registration targets one path only.
- **Claude Code availability:** Does `claude mcp add` exist as a CLI command on all platforms,
  or is it Claude Code desktop-only? Need to verify availability before attempting.
- **VS Code user mcp.json format:** The user-level MCP config format may differ from
  workspace-level. Need to verify the exact schema (`servers` vs `mcpServers` key).
- **Status line performance (resolved):** Handled by the cost-tiered health-check registry
  (§1.0). Status lines run only `instant` checks; `slow` checks (e.g. `build-personas.js
  --check`) are reserved for `doctor`. No per-render caching needed because `instant` checks are
  < 5 ms.
- **Published vs development mode:** Once `cli-menu` and `persona-builder` are consumed as
  published npm packages, the sibling-directory requirement disappears for end users. Should
  the bootstrap/doctor logic handle both modes?
- **Scope of `doctor`:** Should it validate orchestrator `.env` API keys (like
  `preflight --check-api-key`), or keep that behind `preflight` to avoid credential issues?
- **Global install (Phase 1.2) vs. npx-published server (Phase 3.1) — same problem, two
  solutions:** Both target path/config friction. The npx approach solves absolute-path
  fragility *natively* (universal config snippet, no local clone), so it partly supersedes the
  global-install shim. They are not independent recommendations: the stable-shim indirection
  (above) is explicitly designed so Phase 3.1 becomes a drop-in swap of the shim's exec target.
  Decision point: ship global-install now for the development/single-clone workflow, and treat
  npx as the eventual distribution story rather than a parallel track.
- **GUI port conflicts (resolved — single-flight):** Covered by the single-flight model in
  §1.4: on `EADDRINUSE`, health-ping 3420; if it's our dashboard, no-op; otherwise log a stderr
  warning and skip. No adjacent-port hopping (which would fragment the UX across ports when
  multiple IDE windows are open).
- **GUI reconnection UX:** The SPA already polls every 10 seconds (stale-instance detection).
  Consider adding a "Reconnecting…" overlay rather than showing stale data during brief gaps.
- **GUI default-on readiness:** `--gui` stays opt-in until the loopback bind + `Host`-header
  allowlist (§1.4 / GUI Security Considerations) ship. What is the acceptance test that gates
  flipping it to default-on in the global registration?
- **Persona freshness after updates:** After `git pull`, deployed personas may be stale. Should
  the doctor/preflight also check if globally-deployed persona files are older than source
  templates?
- **cli-menu versioning:** Adding `statusLines` is a non-breaking additive change (optional
  property). Ships as a minor to `cli-menu` v1.x.

## Dismissed Ideas

The following suggestions were evaluated and rejected:

| Idea | Source | Rationale for Dismissal |
|------|--------|-------------------------|
| **DevContainers** | External review | Low priority for a single-contributor project. The multi-root workspace (3 separate git repos as siblings) makes devcontainer configuration non-trivial — you'd need a composite container referencing external volumes or multi-repo clone strategies. The existing `setup --all` wizard and `preflight-bootstrap.js` already eliminate most environment issues at lower complexity. |
| **npm/pnpm Workspaces** | External review | `@mistralys/cli-menu` is already consumed via `^1.0.0` (published npm), not `file:` paths. `@mistralys/persona-builder` isn't even in the root `package.json`. Sibling repos are only needed during active development of those packages, which `preflight-bootstrap.js` already handles. Adding a workspaces root would introduce hoisted `node_modules` interactions and potential conflicts with independent publishing — complexity without proportional benefit. |
| **Async TUI status with loading indicators** | External review | Would require cursor manipulation and in-place terminal updates in a zero-dependency library (`cli-menu`). Over-engineered for the use case. The research already constrains `statusLines` to fast file-stat checks (< 50 ms) and defers heavy staleness detection to the `doctor` command. |
| **Version/environment toggler (`mcp-use`)** | External review | Assumes multiple simultaneous installs — not a requirement. The project is designed for a single active install at a time. Branch switching (`git checkout`) is the workflow; there's no need for an `nvm`-style toggler. |
| **GUI decoupling for development** | External review | Already addressed — the standalone `node scripts/cli.js gui` command is explicitly retained for debugging, custom port/ledger-dir overrides, and development workflows where the MCP server may crash frequently. |
| **VS Code Extension (Pattern 9)** | Maintainer | The tool caters to Claude Code and VS Code users equally; a VS Code-only extension's development and maintenance overhead isn't warranted. The agent-plugin marketplace infrastructure is expected to mature over the coming months and solve what an extension would address on its own. Pattern 13 (`.vscode/tasks.json`) already captures the high-value IDE-native subset at near-zero cost. |
| **Target-Project Init Command (Pattern 10)** | Maintainer | Global MCP registration (Pattern 2) is certain to be implemented, making per-project `.mcp.json` scaffolding redundant — the ledger is available in every workspace without an `init` step. The narrow remaining case (committing a workspace-level `.mcp.json` to VCS) doesn't justify a dedicated command. |

## References

- Current setup implementation: `ai-insights/scripts/cli.js` (SETUP_COMPONENTS array)
- Current preflight bootstrap: `ai-insights/scripts/preflight-bootstrap.js`
- CLI Menu library types: `cli-menu/src/types.ts` (MenuConfig, SetupComponent)
- CLI Menu renderer: `cli-menu/src/menu/renderer.ts`
- MCP server entry point: `mcp-server/src/index.ts`
- GUI server: `mcp-server/gui/server.ts`
- Existing publish-locations: `ai-insights/scripts/publish-locations.js`
- Flutter Doctor pattern: https://docs.flutter.dev/get-started/install
- Homebrew Doctor: https://docs.brew.sh/Manpage
- npm Workspaces: https://docs.npmjs.com/cli/v10/using-npm/workspaces
- VS Code MCP documentation: User-level config via `MCP: Open User Configuration` command
- Claude Code MCP scopes: `claude mcp add --scope user|project|local`
- Model Context Protocol Specification (2025-03-26)
