---
title: Development Guide
---

# Development Guide

## Workspace Directory Layout

`ai-insights` consumes two published npm packages that are also developed in this workspace:

| Package | Consumer | Sibling repo directory |
|---------|----------|------------------------|
| `@mistralys/persona-builder` | `personas/package.json` | `../ai-persona-builder` |
| `@mistralys/cli-menu` | root `package.json` | `../cli-menu` |

For **local development** of either package, clone it as a direct sibling of `ai-insights`:

```
parent/
├── ai-insights/         ← this repository
├── ai-persona-builder/  ← optional sibling for local dev
└── cli-menu/            ← optional sibling for local dev
```

## DEV / PROD Dependency Modes

The workspace runs in one of two dependency modes:

| Mode | Resolution | Valid for commits? |
|------|-----------|--------------------|
| **PROD** (default) | Dependencies installed from the npm registry via `package-lock.json` | Yes |
| **DEV** | One or both sibling packages symlinked into `node_modules/` via `npm link` | **No** — blocked by the pre-commit hook |

Switching modes is fully reversible and never touches tracked files: `npm link` only writes into
the gitignored `node_modules/` tree, so `package.json` and `package-lock.json` remain untouched.

```bash
node scripts/cli.js dev-link                              # link every available sibling
node scripts/cli.js dev-link --package persona-builder    # link one package only
node scripts/cli.js dev-link --package cli-menu --skip-build
node scripts/cli.js dev-unlink                            # back to PROD mode
node scripts/dev-link.js status                           # print the current mode
```

`dev-link` builds the sibling repo once (`npm run build`) before linking. Pass `--skip-build`
when its `dist/` is already fresh. For continuous rebuilds while editing the sibling, run
`npm run dev` (tsup watch mode) in the sibling repo in a separate terminal — the symlink picks
up each rebuild without any further action in `ai-insights`.

When a sibling repo is not present at the expected path, `dev-link` warns and skips it rather
than failing.

### Mode Marker and Guards

Linking writes a gitignored `.dev-links.json` marker to the workspace root recording which
packages are linked and when. Four consumers read it:

- **CLI status line** — the `dev-links-inactive` health check reports DEV mode as a failing
  check so the active mode is visible on every menu render.
- **Pre-commit hook** — `scripts/lib/precommit-guards.js`'s `devModeInactive()` guard blocks any
  commit while the marker exists, with a message pointing at `dev-unlink`. It resolves the
  `dev-links-inactive` check from `HEALTH_CHECKS` by id rather than re-deriving the marker path.
  Forgetting to unlink is therefore a safe failure.
- **Bootstrap script** — `scripts/preflight-bootstrap.js` resolves the same `dev-links-inactive`
  check by id (hard-throwing if the id is ever renamed) and prints a `[Bootstrap]`-prefixed
  advisory naming `dev-unlink` before any install/rebuild work runs. This surfaces the reminder
  on every `menu.sh` / `menu.cmd` launch, not just at commit time. The advisory never changes the
  script's exit code.
- **`dev-unlink`** — reads the marker to know what to restore, then removes it.

The same guard module's `noFileProtocolInLocks()` additionally rejects any staged
`package-lock.json` that *adds* a `file:` resolved path. This is the same contamination that the
`release-check` skill's step 3a rejects at release time; the guard simply catches it earlier.
Never point `package.json` at a local path to test sibling changes — `npm link` is the only
sanctioned mechanism.

### Agent Workflow

When an agent receives a request that requires changes to `ai-persona-builder` or `cli-menu`
source code, the agent must:

1. Check whether DEV mode is already active — read `.dev-links.json`, or run
   `node scripts/dev-link.js status`.
2. If not active, run `node scripts/cli.js dev-link --package <name>` to symlink the affected
   sibling package **before** making any changes.
3. After changing the sibling, rebuild it (`npm run build` in the sibling directory) and verify
   the change propagates — e.g. `node scripts/build-personas.js --check` for persona-builder.
4. Do **not** unlink automatically. Leave the workspace in DEV mode so the user can verify.
5. Remind the user that DEV mode is active and that `node scripts/cli.js dev-unlink` must be run
   before committing.

## Pre-Commit Hook

```bash
node scripts/install-hooks.js
```

`.githooks/pre-commit` is a thin, cross-platform shell shim: it extends `PATH` so `node` can be
found inside a Git hook environment, then delegates everything else to
`node scripts/precommit-guards.js`. That runner iterates the declarative `GUARDS` registry in
`scripts/lib/precommit-guards.js`, a pure-ish Node module (no `grep`/`sed`/other Unix-only
utilities) that runs identically on Windows, macOS, and Linux and is covered by
`scripts/tests/precommit-guards.test.js`. The guards, in order:

| Guard | Blocking? | Checks |
|-------|-----------|--------|
| `personaFreshness` | Yes | Stale generated persona output (`build-personas.js --check`) |
| `versionSync` | Yes | Changelog/package-manifest version drift (`check-version-sync.js`) |
| `devModeInactive` | Yes | DEV mode active (`.dev-links.json` exists) |
| `noFileProtocolInLocks` | Yes | Staged `package-lock.json` adds a `file:` resolved path |
| `ruffLint` | Yes once resolved | Staged `orchestrator/src/**.py` fails `ruff check`; prints a non-blocking warning instead when no `ruff` binary can be found |
| `contextStaleness` | No (advisory) | Source changed under `.context/`-tracked directories without a matching `.context/` update |
| `changelogDrift` | No (advisory) | A sub-project changelog changed without the root `changelog.md` |

The runner short-circuits on the first blocking failure and exits 1; advisory guards print their
warnings but never change the exit code.

## Global CLI (Optional)

The root `package.json` declares a `bin` entry that maps the `ai-insights` command to `scripts/cli.js`. Running `npm link` from the repository root registers a global symlink, letting you invoke the CLI from any directory:

```bash
npm link          # register symlink (run once, from the ai-insights/ root)
ai-insights       # opens the interactive menu
ai-insights sync-personas
ai-insights doctor
ai-insights install-mcp --dry-run
```

This is equivalent to `node scripts/cli.js <command>` in every respect.
To remove the global symlink, run `npm unlink` from the `ai-insights/` root.

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
| `node scripts/cli.js ctx-generate` | `./menu.sh ctx-generate` | Generate context documentation via [CTX Generator](https://github.com/context-hub/generator) |
| `node scripts/cli.js doctor` | `./menu.sh doctor` | Run all health checks; exits 1 on any failure |
| `node scripts/dev-link.js link\|unlink\|status` | `./menu.sh dev-link` / `dev-unlink` | Switch between DEV (sibling symlinks) and PROD (npm registry) dependency modes |
| `node scripts/precommit-guards.js` | — | Run the pre-commit guard suite standalone (same guards `.githooks/pre-commit` delegates to) |
| `node scripts/cli.js install-mcp` | `./menu.sh install-mcp` | Register `central_pm` in VS Code user-level `mcp.json` via stable shim |
| `node scripts/run-gui.js` | `./menu.sh gui` | Launch the MCP server GUI dashboard |
| `node scripts/preflight-orchestrator.js` | `./menu.sh preflight` | Pre-flight readiness checks (venv, `.env`, dist, conflicts) |
| `node scripts/run-orchestrator.js` | `./menu.sh orchestrator` | Launch the orchestrator (rebuilds MCP server if stale) |
| `node scripts/kill-orchestrator.js` | `./menu.sh kill-orchestrator` | Detect and terminate stale orchestrator processes |
| `node scripts/read-log.js` | `./menu.sh read-log` | Structured JSONL log reader — query, filter, and summarize orchestrator run logs |
| `node scripts/extract-dialogue.js <target>` | — | Extract readable prose text from chunk `.jsonl` files; writes a `.md` alongside the source (same directory, same base name). Supports single-file and directory batch modes, `--force`, `--dry-run`, `--help`. Registered in `cli.js` as a hidden orchestrator command (`node scripts/cli.js extract-dialogue`). |

## Changelog Workflow

This workspace uses a **hub-and-spoke changelog model**: each sub-project (`mcp-server/`, `orchestrator/`, `personas/`) has its own `changelog.md`, and the root `changelog.md` summarizes the highlights into versioned, Git-tagged releases. See the Changelog Convention section in [AGENTS.md](../../AGENTS.md) for the full rules.

When preparing a release, run the [changelog prompt](../../.github/prompts/changelog.prompt.md) — it invokes the **Changelog Curator** agent to generate entries from Git history and update all four changelog files.
