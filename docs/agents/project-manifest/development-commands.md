# Development Commands

The commands for installing, building, testing, linting and running each part of the workspace, the toolchain versions they assume, and the checks that belong to each kind of change. Every command here was checked against the `package.json` files, `orchestrator/pyproject.toml`, the CI workflow and `scripts/`. Where a part has no command for a step, the table says so.

Root-level scripts and their options are inventoried in [root-tooling.md](root-tooling.md). The synchronisation points the checks protect are in [cross-system-dependencies.md](cross-system-dependencies.md). Which commands write tracked files is in [generated-artefacts.md](generated-artefacts.md).

## Toolchain Versions

| Toolchain | Version facts in the repository |
|-----------|---------------------------------|
| **Node.js** | No version is pinned: no `engines` field in any `package.json`, no `.nvmrc`. The GitHub Actions workflow runs Node 20. The root and MCP server READMEs state Node.js >= 18, and the MCP server's `@types/node` targets 22. The sources do not settle a single value, so Node 20 or newer is the safe working range <!-- TODO: verify — the owner has not recorded a supported minimum -->. |
| **Python** | `orchestrator/pyproject.toml` declares `requires-python = ">=3.11"`; CI runs Python 3.11. |
| **Package managers** | npm for the root, `mcp-server/` and `personas/` (CI installs with `npm ci`); pip inside `orchestrator/.venv` for the orchestrator. |

There is no workspace-wide install command. Each part below has its own `node_modules/` or virtual environment, and the root `node_modules/` is separate from both module ones. `node scripts/preflight-bootstrap.js`, which `menu.sh` and `menu.cmd` launch first, installs the root dependencies on a first run.

## Commands by Part

Run each command from the directory named in the heading. "None" means the part has no such tool configured, not that the step is optional in spirit.

### Workspace Root

Run from the workspace root.

| Step | Command |
|------|---------|
| Install | `npm install` |
| Build | None. The root has no build of its own; the persona build is `node scripts/build-personas.js`. |
| Test | `npm test` (Vitest over `scripts/tests/`; also covers the persona build checks and the `scripts/lib/` modules) |
| Run a single test | `npx vitest run scripts/tests/<file>.test.js` |
| Lint | None |
| Typecheck | None (plain JavaScript) |
| Interactive command center | `node scripts/cli.js`, or `./menu.sh` (macOS, Linux) / `menu.cmd` (Windows) |
| Build & Maintain | `node scripts/cli.js build-maintain` |

Build & Maintain syncs the module versions from their changelogs, builds every persona suite, regenerates the agents overview and runs CTX generation. The full list of files it writes, and the side effects of the other build commands, is in [Commands That Touch More Than They Generate](generated-artefacts.md#commands-that-touch-more-than-they-generate). The rule for when to run it before a commit is in [Purpose and Branch Policy](generated-artefacts.md#purpose-and-branch-policy).

### MCP Server (`mcp-server/`)

Run from `mcp-server/`.

| Step | Command |
|------|---------|
| Install | `npm install` |
| Build | `npm run build` (`tsc`, output in `dist/`; a type error writes nothing because of `noEmitOnError`) |
| Test | `npm test` (Vitest). The `pretest` hook first runs `node ../scripts/build-personas.js` and then `node ../scripts/build-personas.js --check`, so every full test run rebuilds the persona output and can rewrite tracked files such as `personas/name-mapping.json`. |
| Run a single test | `npx vitest run tests/<path>/<file>.test.ts`, optionally with `-t "<test name>"`. Calling Vitest directly skips the `pretest` persona rebuild. |
| Watch / coverage | `npm run test:watch`; `npm run test:coverage` (writes the ignored `coverage/` folder) |
| Lint | None (no ESLint or Prettier configuration) |
| Typecheck | `npx tsc --noEmit`. There is no script for it; it reads the same `tsconfig.json` as the build, which includes `src/**/*` only. |
| Role check | `npm run check:roles` |
| Run locally (development) | `npm run dev` (`tsx src/index.ts`, STDIO transport; the `predev` hook syncs the version first) |
| Run the built server | `node dist/index.js`, optionally `--ledger-dir <path>` |

The built server is a STDIO process started by an MCP client, not a long-running service you open in a browser. How the installed copy is registered with IDE clients is described in [live-workspace.md](live-workspace.md).

### MCP Server GUI (`mcp-server/gui/`)

The GUI has no `package.json` of its own. It is TypeScript run through `tsx`, and its dependencies, scripts and tests belong to `mcp-server/`.

| Step | Command |
|------|---------|
| Install | The `mcp-server/` install above |
| Build | None. The server runs through `tsx` and the frontend in `gui/public/` is served as written, with no build step. |
| Test | The `mcp-server/` suite (GUI tests live in `mcp-server/tests/gui/` and `mcp-server/tests/gui-server.test.ts`) |
| Run a single test | As for the MCP server, for example `npx vitest run tests/gui/<file>.test.ts` from `mcp-server/` |
| Lint | None |
| Typecheck | None. `mcp-server/tsconfig.json` includes `src/**/*` only, so `gui/*.ts` is not type-checked by the build or by `tsc --noEmit`. |
| Start | From the workspace root: `node scripts/cli.js gui` (prompts for a port) or `node scripts/run-gui.js [--port <n>]`; from `mcp-server/`: `npm run gui` |

The GUI's default port is 3420, which `scripts/run-gui.js` documents as reserved for the live workspace. A GUI started from a development checkout takes `--port 3460`; the convention is in the GUI manifest's [GUI Port Convention](../../../mcp-server/gui/docs/agents/project-manifest/constraints.md#23-gui-port-convention--live-3420-vs-dev-3460).

### Personas (`personas/`)

The personas module has no test framework and no linter of its own. The build logic is the external `@mistralys/persona-builder` library, driven by the root scripts. The workspace-root Vitest suite covers the `scripts/lib/` validation modules the build uses.

| Step | Command |
|------|---------|
| Install | `cd personas && npm install` |
| Build | `node scripts/build-personas.js` from the workspace root (or `npm run build` in `personas/`, which calls the same script). It builds every suite and every output target; there is no flag to narrow it. |
| Check (validate without writing) | `node scripts/build-personas.js --check` (`--dry-run` is an alias). It renders in memory and fails only on error-severity validation results; it never compares against files on disk. |
| Test | The workspace-root `npm test` |
| Run a single test | `npx vitest run scripts/tests/<file>.test.js` from the workspace root |
| Lint / typecheck | None (JavaScript CommonJS, no transpilation) |
| Deploy to IDE agent folders | `node scripts/sync-personas.js` (builds first; see [live-workspace.md](live-workspace.md) for what it overwrites) |

### Orchestrator (`orchestrator/`)

Run from `orchestrator/` with its virtual environment active (`.venv/bin/activate` on macOS and Linux, `.venv\Scripts\activate` on Windows).

| Step | Command |
|------|---------|
| Install | `python -m venv .venv`, activate it, then `pip install -e ".[anthropic,dev]"` (add the `google` extra for Gemini). The `dev` extra carries pytest, pytest-asyncio, ruff and pip-audit. |
| Build | None. It is a source install; `pyproject.toml` defines the `orchestrate` entry point. |
| Test | `pytest` (configuration in `pyproject.toml`: `tests/` is the test path, asyncio mode is `auto`) |
| Run a single test | `pytest tests/<file>.py::<TestClass>::<test_name>`, or `pytest tests/<file>.py` for one file. Markers `integration`, `live` and `deepagent` select groups with `-m`. |
| Lint | `ruff check src/` (the CI step and the pre-commit hook both run exactly this) |
| Typecheck | None (no mypy or pyright configuration) |
| Run | `orchestrate <plan.md> [options]` with the environment active; from the workspace root `node scripts/run-orchestrator.js <plan.md>` or `node scripts/cli.js orchestrator --plan <path>`, which rebuild a stale `mcp-server/dist/` first |
| Pre-flight | `node scripts/cli.js preflight` |
| Dependency audit | `node scripts/cli.js audit-orchestrator` |

The orchestrator spawns the MCP server from `mcp-server/dist/`, which is why its launchers check that the build is current.

## Verification by Change Type

Which checks to run after which kind of change. This section builds on the [Validation Scripts](cross-system-dependencies.md#validation-scripts) table, which lists the scripts that check individual sync points; the rows below name which of them a change calls for, plus the module test suites and the documents the change obliges. The documents that must be updated alongside a change are listed in the root `AGENTS.md` under *Manifest Maintenance Rules*.

| Change | Checks to run |
|--------|---------------|
| **Persona source** (YAML under any `personas/*/src/meta/`, content, partials, shared partials) | `node scripts/build-personas.js` (real build, so the generated files and `personas/name-mapping.json` are rewritten), then `node scripts/build-personas.js --check`; the workspace-root `npm test`. When a persona's `role`, `id`, `cc_file_name`, `vs_file_name` or `subagents` changed, walk the matching rows of the [Dependency Table](cross-system-dependencies.md#dependency-table). Run `node scripts/generate-agents-overview.js --check` when overview metadata changed. Deploying with `node scripts/sync-personas.js` is a separate decision; see [live-workspace.md](live-workspace.md). |
| **Persona version or changelog block** | The persona build above, then `node scripts/check-version-sync.js` |
| **Workflow logic** (state machines, routing, handoffs, edge cases) | Change the [workflow specification](../../../mcp-server/docs/agents/workflow-specification/README.md) first, then the implementation, then the tests, then [`constraints-workflow.md`](../../../mcp-server/docs/agents/project-manifest/constraints-workflow.md). Run `npm test` and `npx tsc --noEmit` in `mcp-server/`. |
| **`shared/workflow-manifest.json`** (roles, pipelines, status enums) | `node scripts/validate-workflow-manifest.js`; `npm run check:roles` in `mcp-server/`; `npm test` in `mcp-server/`; the persona build, because persona `role` values are validated against it. The running server only sees the change after a restart (see [live-workspace.md](live-workspace.md)). |
| **MCP server code** (`mcp-server/src/`) | `npm run build` (type errors stop it), `npx tsc --noEmit`, `npm test` in `mcp-server/`. Update the module manifest documents the change touches. |
| **GUI** (`mcp-server/gui/`) | The `mcp-server/` test suite. The GUI is not type-checked by `tsc`, so start it on port 3460 and exercise the changed view <!-- TODO: verify — the repository states no manual GUI verification step -->. |
| **Root script or shared library** (`scripts/`, `scripts/lib/`) | The workspace-root `npm test`, plus a run of the changed script with `--dry-run` or `--check` where it offers one. Update [root-tooling.md](root-tooling.md) and the root `README.md`. |
| **Orchestrator** (`orchestrator/src/`) | `ruff check src/` and `pytest` in `orchestrator/`. A change to its prompts, persona-file lookups or model slugs also calls for the matching rows of the Dependency Table. |
| **Changelog entry or archive** | `node scripts/check-version-sync.js` (module changelog versus package manifest); the personas build warns when the newest `personas/changelog.md` entry is oversized. The rules are in [Changelog Convention](constraints.md#changelog-convention). |
| **Manifest or documentation only** | No build. Where the change edited a document that CTX imports, the generated `.context/` output is stale until the owner regenerates it. |

The pre-commit hook runs the persona `--check`, the version sync check and `ruff check orchestrator/src/` on staged orchestrator Python, as described in [Purpose and Branch Policy](generated-artefacts.md#purpose-and-branch-policy). Passing the hook does not substitute for the test suites above.
