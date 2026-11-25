---
title: Development Guide
---

# Development Guide

## Workspace Directory Layout

The root `package.json` depends on `@mistralys/cli-menu` (currently `^1.1.0` from npm).

For **local development** of `cli-menu` alongside `ai-insights`, clone it as a sibling directory and switch the dependency to a `file:` path:

```
parent/
├── ai-insights/   ← this repository
└── cli-menu/      ← optional sibling for local dev
```

The preflight bootstrap script (`scripts/preflight-bootstrap.js`) handles sibling linking automatically when both repos are present.

## Pre-Commit Hook

```bash
node scripts/install-hooks.js
```

This enables a pre-commit guard that fails the commit if any generated persona file is stale (out of sync with its source template).

## Global CLI (Optional)

The root `package.json` declares a `bin` entry that maps the `ai-insights` command to `scripts/cli.js`. Running `npm link` from the repository root registers a global symlink, letting you invoke the CLI from any directory:

```bash
npm link          # register symlink (run once, from the ai-insights/ root)
ai-insights       # opens the interactive menu
ai-insights sync-personas
ai-insights doctor
ai-insights install-mcp --dry-run
ai-insights agent
ai-insights link-cli
```

This is equivalent to `node scripts/cli.js <command>` in every respect.
To remove the global symlink, run `npm unlink` from the `ai-insights/` root.

Since the menu itself only becomes reachable as the global `ai-insights` command *after* `npm link` has run, this first invocation is necessarily a manual, outside-the-menu step — see the note under [Setup & Configuration](menu-guide.md#setup--configuration) in the Menu Guide. Once linked, the menu's `setup` wizard and `link-cli` command (`node scripts/cli.js link-cli`) detect and re-run `npm link` if the registration is ever lost (e.g. after clearing `node_modules` globally), so you rarely need to type the raw `npm link` command more than once.

## Browser Tool for Agents

Agents that need to drive a real browser (render the GUI, click through a flow, take screenshots) use the Playwright CLI through one stable global command, `ai-insights-browser`:

```bash
ai-insights setup --components browser   # npm install in tools/browser/ + download Chromium + npm link
ai-insights-browser -s=my-task open http://localhost:4200
ai-insights-browser -s=my-task snapshot
ai-insights-browser -s=my-task close
ai-insights-browser --help
```

The command forwards its arguments to the Playwright CLI, but first applies these guards and defaults so agents do not have to remember them:

- **A named session is required.** Playwright's unnamed `default` session is shared by every agent and terminal on the machine, regardless of working directory. Without `-s=NAME`, `-s NAME`, `--session=NAME`, `--session NAME` or the `PLAYWRIGHT_CLI_SESSION` environment variable, the command exits 1 and explains the fix. `attach NAME` also counts as named: Playwright names that session after the bound browser, so `attach my-browser` runs in the private session `my-browser`. `attach` without a name (for example `attach --cdp=chrome` or `attach --extension`) still needs `-s`. Put the name before any option that takes a value: in `attach --idle-timeout 500 my-browser` the name is not recognised, so use `--idle-timeout=500` or name the session with `-s`. `--help`, `--version`, `list`, `install`, `install-browser`, `close-all`, `kill-all` and a call with no command are exempt. To use the shared session on purpose, name it: `-s=default` (or `PLAYWRIGHT_CLI_SESSION=default`).
- **Output stays out of the project.** Unless `PLAYWRIGHT_MCP_OUTPUT_DIR` is already set, the command sets it to `{os.tmpdir()}/ai-insights-browser/{session}` (for example `C:\Users\<you>\AppData\Local\Temp\ai-insights-browser\my-task` on Windows, `/tmp/ai-insights-browser/my-task` on Linux), so snapshot files and unnamed screenshots no longer land in a `.playwright-cli/` folder in the current directory. Characters outside `A-Z a-z 0-9 . _ -` in the session name become `_` in the folder name. A value you set yourself is never overridden; Playwright reads it on the `open` call, and it holds for the rest of that session.
- **File references are absolute paths.** Unless `PLAYWRIGHT_MCP_FILE_PATHS` is already set, the command sets it to `absolute`, so every file Playwright reports (snapshot and screenshot links, PDFs, videos, traces, downloads, saved response bodies, and the paths in the generated-code block) is printed as an absolute path, also with `--raw` and `--json`. A relative `--filename` is still resolved against the current directory and reported absolute. Like the output directory, Playwright reads the setting when the session starts (`open` or `attach`): a session opened before this change, or outside this command, keeps relative paths until it is reopened. The `Agent skill:` line of the global `--help` (shown to Claude Code and Copilot CLI) is made absolute by the command itself.
- **`--inline-snapshot` is opt-in.** The Playwright CLI writes the snapshot of every action command (`open`, `click`, `fill`, `reload`, ...) to a file and prints only its link; only `snapshot` and `find` print the tree. Adding the shim-only flag `--inline-snapshot` in any position (`ai-insights-browser -s=my-task click e5 --inline-snapshot` and `-s=my-task --inline-snapshot click e5` are the same; stripped before forwarding; a `--` ends the options, so a flag after it is left alone), or setting `AI_INSIGHTS_BROWSER_INLINE_SNAPSHOT=1` (or `true`) for the whole shell, makes the command buffer the output and do two things: print `ai-insights-browser: ok` or `ai-insights-browser: failed (exit N)` as the first line, so the result survives `head` or `grep`, and replace the snapshot link with the tree itself (a ` ```yaml ` fence; bare with `--raw`; a string in `--json` output, where the status is a leading `status` key instead; if `--json` output is not a JSON object, stdout stays as it is and the status line goes to stderr). `snapshot --filename` keeps its link, since the caller asked for a file, and a snapshot file that cannot be read keeps its link and prints a warning on stderr. Without the flag, output streams through unchanged. The inline tree is the whole page after every action, so use it for short flows where the extra `snapshot` call per step is the bigger cost; the file-link default suits long sessions. A pipeline (`... | head`) reports the last command's exit status, not the shim's, so the `ai-insights-browser: failed (exit N)` line is the reliable signal there.
- **The global `--help` lists these additions.** It buffers the Playwright CLI's help and appends the shim's own notes (session requirement, `--inline-snapshot`, `--force`) with the path of this document.
- **Session-wide teardown needs `--force`.** `close-all` and `kill-all` end every session on the machine, other agents' included, so they exit 1 unless `--force` is passed. The shim removes `--force` before forwarding. To end only your own session, use `-s=NAME close`.

- The Playwright CLI (`@playwright/cli`) is installed in `tools/browser/`, so it is independent of any global Playwright or `playwright-cli` install. Bump its version in `tools/browser/package.json`.
- `ai-insights-browser` is a second `bin` entry of the root `package.json` (`scripts/ai-insights-browser.js`), registered by the same `npm link` as `ai-insights`. If you linked the CLI before this command existed, run `ai-insights link-cli` (or the setup `browser` component) once more.
- The Playwright CLI requires Node.js >= 20.
- The health checks `browser-tool-installed`, `browser-deps-fresh`, `browser-binaries-installed` and `browser-shim-on-path` report the state in `doctor` and the menu; each names its fix.

## CI — Automated Quality Gate

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request to `main`. It runs five independent jobs:

| Job | What it checks |
|-----|---------------|
| `mcp-server-tests` | MCP server Vitest suite (Node.js 20) |
| `orchestrator-tests` | Orchestrator pytest suite (Python 3.11) |
| `ruff` | Orchestrator source linting (`ruff check src/`) |
| `manifest-validation` | `shared/workflow-manifest.json` schema + semantic checks |
| `persona-build-check` | Detects stale generated persona output (`build-personas.js --check`) |

Each job fails independently. npm and pip dependencies are cached to reduce cold-start times. All GitHub Actions refs are pinned to SHA digests (with inline version-tag comments) for supply-chain hardening. No deployment, artifact publishing, or release steps are included.

## Shared Manifest

`shared/workflow-manifest.json` is the single source of truth for the workflow specification: all 9 agent roles, 6 pipeline types, status enums, and workflow constants. All sub-projects derive their constant definitions from this file. It is validated by `shared/workflow-manifest.schema.json`.

## Key Scripts (Advanced)

> **For most operations, prefer the CLI menu:** `./menu.sh` (macOS/Linux) or `menu.cmd` (Windows). The table below documents the underlying `node` commands for CI, scripting, and advanced use.

| Script | Menu Equivalent | Purpose |
|--------|----------------|---------|
| `node scripts/cli.js` | `./menu.sh` | Interactive command center — menu-driven or direct CLI |
| `node scripts/sync-personas.js` | `./menu.sh sync-personas` | Build + deploy personas; validate frontmatter |
| `node scripts/build-personas.js` | (part of setup/build) | Build personas only (no deploy) |
| `node scripts/build-personas.js --check` | — | Detect stale persona output (non-zero if stale) |
| `node scripts/check-known-roles.js` | — | Verify role parity between personas and MCP server |
| `node scripts/package-personas.js` | `./menu.sh package-personas` | Package standalone personas into distributable ZIPs |
| `node scripts/bundle-docs.js` | `./menu.sh bundle-docs` | Compile project docs into bundles (e.g. for NotebookLM) |
| `node scripts/cli.js doctor` | `./menu.sh doctor` | Run all health checks; exits 1 on any failure |
| `node scripts/cli.js install-mcp` | `./menu.sh install-mcp` | Register `central_pm` in `~/.copilot/mcp-config.json` (Copilot CLI + VS Code) via stable shim |
| `node scripts/run-gui.js` | `./menu.sh gui` | Launch the MCP server GUI dashboard |
| `node scripts/preflight-orchestrator.js` | `./menu.sh preflight` | Pre-flight readiness checks (venv, `.env`, dist, conflicts) |
| `node scripts/run-orchestrator.js` | `./menu.sh orchestrator` | Launch the orchestrator (rebuilds MCP server if stale) |
| `node scripts/audit-orchestrator.js` | `./menu.sh audit-orchestrator` | Scan the orchestrator venv for known security advisories (`pip-audit`) |
| `node scripts/kill-orchestrator.js` | `./menu.sh kill-orchestrator` | Detect and terminate stale orchestrator processes |
| `node scripts/read-log.js` | `./menu.sh read-log` | Structured JSONL log reader — query, filter, and summarize orchestrator run logs |
| `node scripts/extract-dialogue.js <target>` | — | Extract readable prose text from chunk `.jsonl` files; writes a `.md` alongside the source (same directory, same base name). Supports single-file and directory batch modes, `--force`, `--dry-run`, `--help`. Registered in `cli.js` as a hidden orchestrator command (`node scripts/cli.js extract-dialogue`). |

## Changelog Workflow

This workspace uses a **hub-and-spoke changelog model**: each sub-project (`mcp-server/`, `orchestrator/`, `personas/`) has its own `changelog.md`, and the root `changelog.md` summarizes the highlights into versioned, Git-tagged releases. See [Changelog Convention](../agents/project-manifest/constraints.md#changelog-convention) in the hub manifest for the full rules.

When preparing a release, run the [changelog prompt](../../.github/prompts/changelog.prompt.md) — it invokes the **Changelog Curator** agent to generate entries from Git history and update all four changelog files.

To move older releases out of the changelogs, run the [archive prompt](../../.github/prompts/changelog-archive.prompt.md) as a separate session. Archives live under `docs/changelog-history/`, one sub-folder per changelog (see [Archive Locations](../agents/project-manifest/constraints.md#archive-locations)).
