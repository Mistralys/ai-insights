# Plan

## Summary

Introduce a single, central JSON configuration file (`ai-insights.config.json`) at the workspace root that consolidates **all** settings for the MCP server, the GUI dashboard, and the orchestrator — including API keys. The primary goal is to make the **ledger storage directory** configurable (so project ledger data can live anywhere on the filesystem) and to eliminate the need to maintain separate configuration files entirely (`.env` file, `gui-config.json`, CLI arguments). All three consumers — MCP server, GUI server, orchestrator — will read from the same file with a single, well-defined schema. The `.env` file is retired; the actual `ai-insights.config.json` is gitignored (only the `.dist` template is versioned), providing the same protection against accidental credential commits.

## Architectural Context

### Current Configuration Landscape

| Consumer | Config Mechanism | Storage Path Source | Other Settings |
|----------|-----------------|---------------------|----------------|
| **MCP server** (`src/index.ts`) | `--ledger-dir` CLI arg | `resolveLedgerRoot()` in `src/utils/ledger-root.ts`: CLI flag → default `mcp-server/storage/ledger/` | Agents dir via `--agents-dir` CLI arg |
| **GUI server** (`gui/server.ts`) | `--ledger-dir` + `--port` CLI args | Shares `resolveLedgerRoot()` | `gui-config.json` inside ledger root for runtime settings (auto-handoff, archive days, etc.) |
| **Orchestrator** (`orchestrator/src/config.py`) | `.env` file + CLI args | Hardcoded: `workspace_root / "mcp-server" / "storage" / "ledger" / {slug}` | `.env` for API keys, checkpoint dir, log level, etc. |

> **After this change:** The `.env` file is eliminated. All settings (including API keys) move to `ai-insights.config.json`.

### Key Files

- `mcp-server/src/utils/ledger-root.ts` — resolves ledger root from `--ledger-dir` or default
- `mcp-server/src/gui/config.ts` — reads/writes `gui-config.json` (runtime GUI settings)
- `mcp-server/gui/server.ts` — GUI HTTP server, uses `resolveLedgerRoot()`
- `mcp-server/src/index.ts` — MCP server entry point, calls `resolveLedgerRoot()`
- `orchestrator/src/config.py` — `Config` dataclass and `load_config()`
- `orchestrator/src/nodes/__init__.py` — `_derive_slug_dir()` hardcodes `mcp-server/storage/ledger/`
- `orchestrator/src/cli.py` — hardcodes log copy path: `mcp-server/storage/ledger/{slug}/orchestrator/logs/`
- `orchestrator/.env.example` — template for orchestrator environment variables
- `.mcp.dist.json` — template for IDE MCP server configuration

### Patterns & Conventions

- The MCP server uses **atomic JSON writes** (`atomicWriteJson`) for all file I/O.
- The GUI `gui-config.json` uses a Zod schema (`GuiConfigSchema`) and a file watcher for live reload.
- The orchestrator uses Python's `dotenv` for `.env` loading and a `@dataclass` Config.
- Cross-platform path handling is mandatory (see AGENTS.md Cross-Platform Policy).

## Approach / Architecture

### Central Config File: `ai-insights.config.json`

A new JSON file at the workspace root with a well-defined schema. All three consumers read this file at startup. The `.env` file is retired — API keys move into the central config. The actual `ai-insights.config.json` is gitignored, so credentials are never versioned. Only the `.dist` template (with placeholder values) is tracked in Git.

#### Proposed Schema

```json
{
  "$schema": "./shared/ai-insights.config.schema.json",
  "ledger_root": "/absolute/path/to/ledger/storage",
  "api_keys": {
    "anthropic": "sk-ant-...",
    "google": ""
  },
  "orchestrator": {
    "checkpoint_dir": "./orchestrator/checkpoints",
    "log_level": "INFO",
    "max_iterations": 100,
    "heartbeat_interval_s": 120,
    "capture_dialogues": true,
    "stream_max_retries": 2,
    "stream_retry_base_delay_s": 10.0
  },
  "gui": {
    "port": 3420,
    "auto_handoff_enabled": true,
    "max_handoff_depth": 100,
    "auto_archive_days": 6,
    "capture_dialogues": true
  }
}
```

**Key design decisions:**

1. **`ledger_root` is top-level** — it is the shared concern consumed by all three applications.
2. **Relative paths are resolved from the workspace root**, not from the config file location (since they are the same).
3. **When `ledger_root` is omitted or empty**, the default remains `mcp-server/storage/ledger/` (backward compatible).
4. **API keys live in `api_keys`** — the config file is gitignored, providing the same protection as `.env`. The `.dist` template ships with placeholder values.
5. **`gui-config.json` continues to exist** for runtime-mutable GUI settings (the GUI dashboard writes to it). The central config provides initial/default values; `gui-config.json` overrides at runtime.
6. **`--ledger-dir` CLI arg continues to work** as a final override (highest priority).
7. **`.env` is retired** — `python-dotenv` loading is removed from the orchestrator. Environment variables can still override config values for CI/Docker use cases (env var > config file > default).

#### Resolution Precedence (Ledger Root)

```
1. --ledger-dir CLI argument        (highest — explicit override)
2. ai-insights.config.json → ledger_root
3. Default: mcp-server/storage/ledger/  (lowest — backward compatible)
```

#### Resolution Precedence (Orchestrator Settings)

```
1. CLI arguments (--max-iterations, --log-level)   (highest)
2. Environment variables (for CI/Docker overrides)  
3. ai-insights.config.json → orchestrator.*         
4. Hardcoded defaults                                (lowest)
```

> The `.env` file is no longer loaded. Environment variables still work (for CI/container use cases) but are set externally, not via dotenv.

### Consumers

| Consumer | Reads `ai-insights.config.json` via | Falls back to |
|----------|-------------------------------------|---------------|
| MCP server | New `resolveConfig()` in TypeScript | Current defaults |
| GUI server | Same TypeScript function | Current defaults |
| Orchestrator | New `_load_workspace_config()` in Python | Environment variables → defaults |

## Rationale

- **Single file to edit:** Users currently need to coordinate `--ledger-dir` CLI args (or `.mcp.json` args arrays), `.env` files, and `gui-config.json`. A single JSON file eliminates this.
- **Portable storage:** Making `ledger_root` configurable allows users to store ledger data on a different disk, a shared network path, or outside the workspace tree entirely.
- **Backward compatible:** Every new config value has a sensible default matching current behavior. Existing setups without `ai-insights.config.json` continue to work unchanged.
- **One file for everything:** API keys, paths, and runtime settings live in a single gitignored file. The `.dist` template with placeholders is versioned — same protection as `.env` but without a second file to manage.
- **Environment variables still work:** For CI/Docker, settings can be injected via environment variables (they override config file values). No `python-dotenv` or `.env` file required.
- **JSON Schema validation:** A schema file enables IDE autocompletion and validation when editing the config.

## Detailed Steps

### 1. Create the JSON Schema

Create `shared/ai-insights.config.schema.json` (JSON Schema Draft-07) defining the structure above. All properties optional with documented defaults.

### 2. Create `ai-insights.config.dist.json`

A template config file at the workspace root (like `.mcp.dist.json`). This is the file users copy and customize. Add to `.gitignore` to ignore the user's `ai-insights.config.json`.

### 3. Update `resolveLedgerRoot()` in the MCP server

**File:** `mcp-server/src/utils/ledger-root.ts`

- Add a new function `loadWorkspaceConfig()` that reads `{workspaceRoot}/ai-insights.config.json`.
- Modify `resolveLedgerRoot()` to check the config file between CLI args and the default:
  1. `--ledger-dir` CLI arg (unchanged)
  2. `ai-insights.config.json` → `ledger_root` (new)
  3. Default `mcp-server/storage/ledger/` (unchanged)
- Export `loadWorkspaceConfig()` so the GUI server and config module can also access the parsed config.
- Handle missing file gracefully (file doesn't exist → skip, use defaults).
- Validate with Zod schema to catch malformed configs early (log warning to stderr).

### 4. Update `gui-config.json` initialization

**File:** `mcp-server/src/gui/config.ts`

- When creating the initial `gui-config.json` (self-healing path), seed it with values from `ai-insights.config.json → gui` if available.
- The `ledger_root` field in `gui-config.json` continues to be populated with the resolved ledger root (read-only, informational).

### 5. Update the GUI server

**File:** `mcp-server/gui/server.ts`

- Read `ai-insights.config.json → gui.port` as a default for `--port` (CLI arg still overrides).
- The ledger root already flows through `resolveLedgerRoot()` (updated in step 3).

### 6. Update the orchestrator `load_config()`

**File:** `orchestrator/src/config.py`

- Add a `_load_workspace_config()` function that reads `{workspace_root}/ai-insights.config.json`.
- Remove `python-dotenv` loading (no more `.env` file).
- Read API keys from `config → api_keys.anthropic` / `api_keys.google` and set them as environment variables (`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`) so the LLM SDKs pick them up transparently.
- For each orchestrator setting, check: CLI arg → environment variable → config file → default.
- Parse `ledger_root` from the config file and store it on the `Config` dataclass as a new field.

### 7. Update `_derive_slug_dir()` in the orchestrator

**File:** `orchestrator/src/nodes/__init__.py`

- Accept an optional `ledger_root` parameter (from `Config`).
- When provided, use it instead of the hardcoded `workspace_root / "mcp-server" / "storage" / "ledger"`.
- When not provided, fall back to the current hardcoded path (backward compat).

### 8. Update orchestrator log copy path

**File:** `orchestrator/src/cli.py`

- The log copy path (`mcp-server/storage/ledger/{slug}/orchestrator/logs/`) must also use the resolved `ledger_root` from config instead of the hardcoded path.

### 9. Pass `ledger_root` to MCP server subprocess

When the orchestrator launches the MCP server as a subprocess, it should pass the resolved `ledger_root` via `--ledger-dir` so both processes use the same storage directory.

**File:** `orchestrator/src/config.py` (where `mcp_server_cmd` is built)

- Append `["--ledger-dir", str(resolved_ledger_root)]` to `mcp_server_cmd` when a non-default ledger root is configured.

### 10. Remove `.env` dependency from the orchestrator

**Files:** `orchestrator/src/config.py`, `orchestrator/src/cli.py`

- Remove `load_dotenv()` calls and the `python-dotenv` import.
- Keep `python-dotenv` in `pyproject.toml` as an optional dependency (for users who prefer env files in CI), but it is no longer called by default.
- Delete `orchestrator/.env.example` and replace it with a note in the README pointing to `ai-insights.config.dist.json`.
- Environment variables still work as overrides (the code reads `os.environ` directly), but they are no longer loaded from `.env` automatically.

### 11. Update `.gitignore`

Add `ai-insights.config.json` to the root `.gitignore` (the actual config with user paths should not be versioned; only the `.dist` template is versioned).

### 12. Update `scripts/cli.js`

- `init-mcp` command: also generate `ai-insights.config.json` from the `.dist` template if it doesn't exist.
- Add a brief note in the interactive menu about the central config file.

### 13. Add `Config.ledger_root` to the orchestrator dataclass

**File:** `orchestrator/src/config.py`

- Add `ledger_root: Path` field to the `Config` dataclass.
- Resolve it in `load_config()`: workspace config → default.
- Use it wherever `mcp-server/storage/ledger/` is currently hardcoded.

### 14. Update `preflight-orchestrator.js`

**File:** `scripts/preflight-orchestrator.js`

- If `ai-insights.config.json` exists, validate it against the schema and report the resolved ledger root in the preflight output.

### 15. Write tests

- **MCP server:** Test `resolveLedgerRoot()` with config file present, absent, and with CLI override.
- **Orchestrator:** Test `_load_workspace_config()` parsing and precedence.
- **Orchestrator:** Test `_derive_slug_dir()` with custom ledger root.

## Dependencies

- No new npm dependencies. The MCP server already has `zod` for schema validation.
- No new Python dependencies. The orchestrator already has `json` in stdlib. `python-dotenv` becomes optional (no longer called by default).
- JSON Schema file is standalone (no runtime dependency).

## Required Components

### New Files

| File | Purpose |
|------|---------|
| `shared/ai-insights.config.schema.json` | JSON Schema for the central config file |
| `ai-insights.config.dist.json` | Template config file (versioned) |

### Modified Files

| File | Change |
|------|--------|
| `mcp-server/src/utils/ledger-root.ts` | Add config file reading to resolution chain |
| `mcp-server/src/gui/config.ts` | Seed `gui-config.json` defaults from central config |
| `mcp-server/gui/server.ts` | Read GUI port from central config |
| `orchestrator/src/config.py` | Add `_load_workspace_config()`, new `ledger_root` field, remove `dotenv` loading, read API keys from config |
| `orchestrator/src/nodes/__init__.py` | Parameterize `_derive_slug_dir()` |
| `orchestrator/src/cli.py` | Use resolved ledger root for log copy path, remove `dotenv` import |
| `.gitignore` | Add `ai-insights.config.json` |
| `scripts/cli.js` | Generate config file in `init-mcp` |
| `scripts/preflight-orchestrator.js` | Validate central config if present |

## Assumptions

- The workspace root is always the parent of `mcp-server/` and `orchestrator/`. This assumption is already baked into both sub-projects.
- API keys are stored in the central config file. Since the file is gitignored, this is equivalent to `.env` in terms of VCS safety.
- `gui-config.json` remains the live-mutable config for runtime GUI settings (the dashboard writes to it via the API). The central config provides seed/default values only.
- The `--ledger-dir` CLI argument remains the highest-priority override for all consumers.
- LLM provider SDKs (Anthropic, Google) read API keys from environment variables. The orchestrator sets these from the config file at startup, before initializing any LLM client.

## Constraints

- **Cross-platform paths:** The `ledger_root` value in the config file must be an absolute path or a path relative to the workspace root. Path resolution must use `path.resolve()` (Node.js) and `Path.resolve()` (Python) — never string concatenation.
- **Backward compatibility:** An installation without `ai-insights.config.json` must behave identically to today. Every config value must have a default matching current behavior. Environment variables continue to work as overrides.
- **Config file is gitignored:** The actual `ai-insights.config.json` (containing API keys and local paths) must never be committed. Only the `.dist` template is versioned.
- **Atomic writes:** If the MCP server or GUI ever needs to write back to `ai-insights.config.json`, it must use `atomicWriteJson`. (Currently read-only; `gui-config.json` handles mutable state.)

## Out of Scope

- **Migration tool** to convert existing `.env` / `gui-config.json` into the central config — users can set it up manually from the `.dist` template.
- **Hot-reload of `ai-insights.config.json`** — the file is read once at startup. Changing it requires restarting the MCP server / orchestrator. (The GUI's runtime config in `gui-config.json` already has a file watcher for hot-reload.)
- **GUI dashboard UI for editing the central config** — the existing config view handles `gui-config.json` only.
- **Persona-related settings** — model slugs and persona metadata remain in their YAML source files.

## Acceptance Criteria

- A user can set `"ledger_root": "/data/my-ledgers"` in `ai-insights.config.json` and all three consumers (MCP server, GUI, orchestrator) store/read ledger data from that directory.
- Without `ai-insights.config.json`, all applications behave identically to today (full backward compatibility).
- `--ledger-dir` CLI arg overrides the config file value.
- Orchestrator settings in the config file are respected but overridable by environment variables and CLI args.
- API keys in the config file are injected as environment variables at startup so LLM SDKs work transparently.
- The `.env` file is no longer loaded or required.
- `ai-insights.config.dist.json` is versioned; `ai-insights.config.json` is gitignored.
- JSON Schema provides IDE autocompletion when editing the config file.
- All existing tests continue to pass.
- New tests verify config resolution precedence for both MCP server and orchestrator.

## Testing Strategy

- **Unit tests (MCP server):** Mock filesystem to test `resolveLedgerRoot()` with various combinations of CLI arg, config file, and default. Test config file parsing with valid, invalid, and missing files.
- **Unit tests (orchestrator):** Test `_load_workspace_config()` with valid, invalid, and missing JSON. Test `_derive_slug_dir()` with and without custom ledger root. Test precedence: CLI → env var → config file → default. Test API key injection into environment.
- **Integration smoke test:** Start the MCP server with a custom `ledger_root` via config file, initialize a project, verify files appear in the custom directory.
- **Existing test suites:** Run full MCP server (`npm test`) and orchestrator (`pytest`) test suites to verify no regressions.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Config file parsing errors crash the server** | Graceful fallback: if `ai-insights.config.json` is malformed or fails schema validation, log a warning to stderr and use defaults. Never crash on a bad config file. |
| **Path resolution differences across OS** | Use `path.resolve()` (Node.js) and `Path.resolve()` (Python). Test with both absolute and relative paths. |
| **Orchestrator and MCP server disagree on ledger root** | The orchestrator passes `--ledger-dir` to the MCP subprocess when a non-default root is configured, ensuring both use the same path. |
| **Users accidentally commit `ai-insights.config.json` with API keys** | `.gitignore` entry prevents this. The `.dist` template uses placeholder values (`sk-ant-...`). The `scripts/cli.js` init command warns if the file is tracked by Git. |
| **Precedence confusion** | Document the resolution order clearly in the config schema description and in the README. |
