# Live Workspace

What a workspace that hosts the running Ledger MCP server can break by being edited, and which files and folders carry that risk. The agentic development workflow itself, with its ledger tools, depends on that server, so a change here can affect the session making it.

The workspace folder is named *STABLE* in the owner's checkout. The workspace-level description in the parent folder's `AGENTS.md` (outside this repository) states the owner's practice: STABLE is used for regular persona maintenance and smaller improvements and fixes, and bigger projects use a dedicated DEV workspace so the stable one keeps running. That is a stated practice, not something the code enforces. The code does support the distinction in two places: the installed server is launched from one specific checkout, and the GUI reserves port 3420 for the live copy and 3460 for a development copy. The binding rule derived from this is in [constraints.md](constraints.md#live-workspace).

## How the Live Server Is Wired

| Piece | Behaviour |
|-------|-----------|
| **Launcher shim** | `node scripts/cli.js install-mcp` writes `~/.ai-insights/bin/launch-server.js` and a sibling `config.json` holding the checkout's path. The shim spawns `mcp-server/dist/index.js` of that checkout over STDIO. It exits with an error when the configured path no longer exists, and the server fails to start when `dist/index.js` is missing. |
| **Client registration** | The same command merges the `central_pm` server into `~/.copilot/mcp-config.json` and, where the `claude` CLI is on `PATH`, registers it with Claude Code. Both point at the shim, not at a checkout, so the checkout named in `config.json` is the live one. |
| **Build output** | `mcp-server/dist/` is gitignored and written by `npm run build`. Several root scripts also rebuild it silently when `mcp-server/src/` is newer: the ledger-directory discovery used by root scripts, standalone import and the orchestrator launcher (through `scripts/lib/mcp-dist-freshness.js`), and the bootstrap guard `scripts/preflight-bootstrap.js` (its own check). |
| **Startup reads** | At process start the server parses and validates `shared/workflow-manifest.json` (a malformed file stops startup with a validation error), loads `personas/name-mapping.json`, scans the VS Code agents folder (`~/.copilot/agents/` by default, or `--agents-dir`) for `*.agent.md` files to build the agent registry, and runs the one-time storage migration on each configured store. |
| **Ledger storage** | Defaults to `mcp-server/storage/ledger/` (gitignored), or the path given with `--ledger-dir`. When `~/.ai-insights/stores.json` exists the server runs in multi-store mode and the stores it lists are the live data; its absence means single-store mode. |

## What Can Break the Running Server or Workflow

| Change or action | Effect |
|------------------|--------|
| Editing `mcp-server/src/` and running `npm run build` (or any root script that triggers a rebuild) | Replaces `dist/`. A server process already running keeps the code it started with; the next start, such as a new agent session, runs the new build. A type error leaves the previous `dist/` in place because the build writes nothing on error. Deleting `dist/` stops every new start. |
| Editing `shared/workflow-manifest.json` | Takes effect at the next server start, not in running processes. An invalid edit prevents the next start. It also drives role names, pipelines and status enums in the personas and orchestrator, so the [sync points](cross-system-dependencies.md#dependency-table) apply. |
| A persona build that rewrites `personas/name-mapping.json` | Read at server start. Changed agent names or versions reach the server at its next start, and stale or machine-local model fields in the file affect what it loads (see [Known Contradictions](generated-artefacts.md#known-contradictions)). `npm test` in `mcp-server/` triggers such a build through its `pretest` hook. |
| `node scripts/sync-personas.js` | Overwrites persona files in `~/.copilot/agents/` and `~/.claude/agents/` (and skills in `~/.claude/skills/`), which are the files the live workflow dispatches. The server's agent registry is built from the VS Code folder at start. A broken persona build deployed here changes every agent a new session launches. |
| `node scripts/cli.js clean-agents` | Deletes persona files from every publish location. With the VS Code folder emptied, the registry built at the next server start finds no agents. |
| Writing to `mcp-server/storage/ledger/` or a configured store by hand, or running a one-time migration script (`migrate-knowledge-uuids.js`, `backfill-duration.js`) | Changes live project data. Test code must construct its `LedgerStore` on a temporary directory for this reason; see [constraints-testing.md](../../../mcp-server/docs/agents/project-manifest/constraints-testing.md). |
| Running a GUI on port 3420 from a development checkout | Shadows or is shadowed by the live GUI, so agents mid-workflow may read the wrong server's data. Use 3460; see the [GUI Port Convention](../../../mcp-server/gui/docs/agents/project-manifest/constraints.md#23-gui-port-convention--live-3420-vs-dev-3460). |
| Running the orchestrator | Spawns its own MCP server process from `dist/` and writes `orchestrator/logs/` and `orchestrator/checkpoints/` (both gitignored). It does not touch the live process, but it rebuilds `dist/` when stale. |

## Where the Code Supports Isolation

- Running `npm run dev` or `node dist/index.js --ledger-dir <path>` against a scratch ledger directory leaves the live storage untouched.
- A GUI started with `--port 3460` and a `--ledger-dir` runs beside the live one.
- Vitest suites use temporary directories, not the live storage.
- `node scripts/sync-personas.js --dry-run` and `node scripts/build-personas.js --check` write nothing to the deploy folders.

Nothing in the code detects which workspace is the live one, so keeping a risky change out of the live checkout is a matter of working in a separate checkout.
