# Project Ledger MCP Server

**A Model Context Protocol server that keeps AI coding agents in sync across sessions.**

---

## What Is This?

The Project Ledger MCP Server manages persistent project state for multi-agent AI workflows. It acts as a shared source of truth so agents can track progress, coordinate handoffs, and preserve context — even when you start a new chat session.

### The Problem It Solves

- **Context loss** — each new chat session starts from scratch
- **Duplicate work** — agents redo completed tasks or miss dependencies
- **Data corruption** — manual JSON editing causes schema violations
- **Race conditions** — multiple agents editing the same files simultaneously

### How It Helps

- **Persists state** as validated JSON on disk across sessions
- **Prevents corruption** with atomic writes and file locking
- **Coordinates agents** by telling each one what to do next
- **Tracks knowledge** across projects for future planning

---

## Features

- **Atomic operations** — write-to-temp-then-rename prevents partial writes
- **File locking** — distributed locks with stale detection and retry logic
- **Schema validation** — all data validated with Zod on every read/write
- **Auto-handoff** — agents are automatically routed to the next stage
- **Infinite-loop protection** — depth counter prevents runaway handoff chains
- **Knowledge base** — persistent cross-project insights with full-text search
- **Task list** — a global, colour-coded task collection merged across stores, managed with six `ledger_*_task` tools
- **Strategic vision** — repository-level planning with three-horizon goals
- **Self-healing counters** — auto-corrects counter drift on status queries
- **GUI dashboard** — web UI for monitoring, search, filtering, and dark mode
- **Multi-store mode** — register multiple independent ledger roots; separate projects by machine, team, or concern
- **Pluggable error-code allocation** — `ledger_generate_error_code` hands out error-code bases through a user-configured, third-party-extensible provider; falls back to a logged temporary code on any failure

---

## Requirements

- **Node.js** >= 18 (ESM-compatible)
- **npm** or compatible package manager

---

## Quick Start

From the workspace root, use the interactive menu:

```bash
./menu.sh          # macOS / Linux
menu.cmd           # Windows
```

On first launch the menu auto-detects missing components and runs the setup wizard — this installs dependencies, builds the MCP server, and registers it in your IDE. **No manual `npm install` or `npm run build` needed.**

The menu also displays a live health status showing whether the MCP server dist is current. If source files have changed, the orchestrator launcher will rebuild automatically before starting a run.

### Registering the Server in Your IDE

The first-time setup wizard handles this automatically. To re-register later:

```bash
./menu.sh install-mcp              # register in VS Code + Claude Code
./menu.sh install-mcp --dry-run    # preview without writing
```

This installs a stable shim at `~/.ai-insights/bin/launch-server.js` and registers the `central_pm` server in your IDE's user-level MCP configuration. No manual path editing required.

### Launching the GUI Dashboard

```bash
./menu.sh gui
```

Opens [http://localhost:3420](http://localhost:3420) — a web dashboard for monitoring projects, viewing work packages, browsing orchestrator dialogues, managing the knowledge base, and launching orchestrator runs directly from the browser.

---

## Error Codes

Agents call `ledger_generate_error_code` to allocate a new error-code base number — a numeric prefix for a class or module's component codes (`{base}01`, `{base}02`, …) — without picking the number themselves. The base is sourced through whichever provider you've configured in the GUI's Error Codes tab:

- **`file`** (built-in, zero setup) — keeps a sequence in a locked local JSON file, scoped globally or per repository.
- **`errorcode-incrementor`** (built-in) — allocates against an HTTP backend you control.
- **Third-party plugins** — dropped into `~/.ai-insights/plugins/error-codes/`, loaded at server startup against the versioned provider contract in `src/error-codes/provider-api.ts`. See [`docs/error-code-providers.md`](docs/error-code-providers.md) for the plugin-authoring guide.

Every allocation call is safe to make even when the provider is down: on any provider, network, or configuration failure, the server falls back to a temporary code (`{prefix}` + six digits, e.g. `777000001`) instead of failing the call outright, and logs it for later replacement — `ledger_list_temporary_error_codes` lists what's still outstanding. If the temporary-code log itself is ever damaged, the server keeps a copy of the damaged file, continues numbering above every code still visible in it, and reports the recovery as a `warning` in the result, so the fallback guarantee holds and no code is reissued. See [`ledger_help`](#quick-start)'s `ledger_generate_error_code` and `ledger_list_temporary_error_codes` entries, or [`docs/agents/project-manifest/api-surface.md`](docs/agents/project-manifest/api-surface.md#error-code-tools), for the full response shape.

---

## Troubleshooting

### "MCP server unavailable"

1. Verify `.mcp.json` exists and points to the correct path
2. Ensure dependencies are installed: `cd mcp-server && npm install`
3. Restart your AI IDE to reload MCP configuration

### MCP Tool Call Fails

1. Check that `project_path` arguments are absolute paths
2. Verify ledger files haven't been manually edited or corrupted
3. Look for schema validation errors in the error message

### Lock Acquisition Timeout

1. Another process may be holding the lock — wait and retry
2. If a process crashed, delete the `.lock` file inside `storage/ledger/{slug}/`
3. Use `./menu.sh kill-orchestrator` to clean up stale processes

### `ledger_generate_error_code` Returned a Temporary Code

Check the response's `fallback_reason`:

1. `misconfigured` — the active provider isn't installed, or its stored settings are invalid. Open the GUI's Error Codes tab and fix the provider configuration, then re-run the allocation.
2. `unavailable` — the provider's backend could not be reached (network/DNS/timeout). Check connectivity to that backend and retry.
3. `throttled` — the provider asked to back off; the server already retried once automatically before falling back. Retry later.
4. `rejected` or `invalid_response` — the provider's backend explicitly refused the request, or responded in an unexpected shape. Check that backend's own logs.
5. `failed` — an uncaught error from the provider; check the MCP server's stderr log for the redacted `detail`.
6. `requested` — expected: the caller passed `temporary: true` on purpose.

In every case, call `ledger_list_temporary_error_codes` once the provider is working again to find and replace the temporary code with a real base.

### Error-Code Plugin Fails to Load

A third-party provider plugin under `~/.ai-insights/plugins/error-codes/` that fails to load (invalid shape, unsupported `apiVersion`, an `id` clashing with a built-in provider) is logged to stderr at startup as `[error-codes] Failed to load provider plugin from {path}: {message}` and then skipped — it never stops server startup, and the built-in provider under that `id` keeps working. Fix the plugin per the message and restart the MCP server to reload it.

---

## Development

### Running Tests

```bash
cd mcp-server
npm test              # run all tests once
npm run test:watch    # run tests in watch mode
```

### Building

```bash
npm run build    # compile TypeScript to dist/
npm run dev      # run server with tsx (auto-reload)
```

### Versioning

This project uses `changelog.md` as the source of truth. After updating the changelog:

```bash
npm run sync-version  # extracts version from changelog → package.json
```

### Manual IDE Configuration (Advanced)

If you prefer to configure your IDE manually rather than using `./menu.sh install-mcp`:

Add the server to your `.mcp.json` (or MCP configuration file):

```json
{
  "mcpServers": {
    "project-ledger": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/ai-insights/mcp-server/src/index.ts"]
    }
  }
}
```

**Optional: Custom agents directory** — to enable auto-handoff, pass `--agents-dir`:

```json
{
  "mcpServers": {
    "project-ledger": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/ai-insights/mcp-server/src/index.ts",
        "--agents-dir",
        "/absolute/path/to/your/prompts"
      ]
    }
  }
}
```

By default the server reads the VS Code agents folder, `~/.copilot/agents/`, the same location persona sync deploys to (defined in `shared/publish-locations.json`).

---

## Learn More

| Resource | Description |
|----------|-------------|
| [Project Manifest](docs/agents/project-manifest/) | Comprehensive technical documentation hub |
| [API Surface](docs/agents/project-manifest/api-surface.md) | All MCP tool signatures and parameters |
| [Tech Stack & Patterns](docs/agents/project-manifest/tech-stack.md) | Runtime, frameworks, and architectural patterns |
| [Data Flows](docs/agents/project-manifest/data-flows.md) | How data moves through the system |
| [Constraints](docs/agents/project-manifest/constraints.md) | Architectural invariants and conventions |
| [Multi-Store Guide](../docs/references/multi-store-guide.md) | Setup, CLI reference, and migration walkthrough |
| [Workflow & Ledger Guide](../docs/references/workflow-and-ledger.md) | End-to-end explanation of how the ledger and orchestrator work together |
| [File Tree](docs/agents/project-manifest/file-tree.md) | Annotated directory structure for contributors |
| [Agent Personas](../personas/ledger/) | The 9 agents that use this server |
| [Orchestrator](../orchestrator/) | Headless pipeline executor |
