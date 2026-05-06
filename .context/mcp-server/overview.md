# MCP Server - Overview
_SOURCE: Overview_
# Overview
```
// Structure of documents
└── mcp-server/
    └── README.md

```
###  Path: `/mcp-server/README.md`

```md
# Project Ledger MCP Server

**A Model Context Protocol server that keeps AI coding agents in sync across sessions**

---

## What Is This?

The **Project Ledger MCP Server** is a specialized backend service that manages persistent project state for multi-agent AI workflows. It acts as a "source of truth" that agents can read from and write to, ensuring that work progress, decisions, and context are preserved across chat sessions.

Think of it as a **structured database for AI agents**, where each agent can:
- Check what work has been completed
- See what's currently in progress
- Understand dependencies between tasks
- Record their findings and observations
- Coordinate handoffs to the next agent in the workflow

---

## Why Does This Exist?

### The Problem

When building complex features with AI agents across multiple sessions, you face these challenges:

1. **Context Loss**: Each new chat session starts from scratch. Agents can't remember what happened before.
2. **Duplicate Work**: Without coordination, agents might redo completed tasks or miss dependencies.
3. **Inconsistent State**: Manual JSON editing leads to typos, schema violations, and file corruption.
4. **Race Conditions**: Multiple agents editing the same files simultaneously can cause conflicts.

### The Solution

The MCP server solves these problems by:

- **Persisting State**: Maintains a structured JSON ledger on disk that survives between sessions
- **Enforcing Validation**: Uses strict schemas (Zod) to prevent invalid data from being written
- **Preventing Corruption**: Uses atomic writes and file locking to ensure data consistency
- **Providing Coordination**: Offers workflow tools that tell agents what to do next based on project state

---

## How It Works

### Architecture

The server exposes **22 MCP tools** that agents invoke to manage project state:

```
┌─────────────────────────────────────────────────┐
│          AI Agent (Developer/QA/etc.)           │
└──────────────────┬──────────────────────────────┘
                   │ MCP Protocol (STDIO)
                   │
┌──────────────────▼──────────────────────────────┐
│         Project Ledger MCP Server               │
│  ┌─────────────────────────────────────────┐    │
│  │  Tools: create_work_package,            │    │
│  │         start_pipeline,                 │    │
│  │         get_next_action, etc.           │    │
│  └─────────────────┬───────────────────────┘    │
│                    │                            │
│  ┌─────────────────▼───────────────────────┐    │
│  │  LedgerStore: Atomic I/O + Validation   │    │
│  └─────────────────┬───────────────────────┘    │
└────────────────────┼────────────────────────────┘
                     │
         ┌───────────┴──────────┐
         │   JSON Files on Disk │
         ├──────────────────────┤
         │ storage/ledger/      │
         │   {slug}/             │ ← Per-project subfolder
         │     .meta.json        │ ← Project metadata
         │     project-ledger.json│ ← Root index
         │     WP-001.json       │ ← Work package 1
         │     WP-002.json       │ ← Work package 2
         │     plan.md           │ ← Archived plan document
         │     synthesis.md      │ ← Archived synthesis report
         │     orchestrator/     │
         │       dialogues/      │ ← Agent dialogue capture (.md)
         │       chunks/         │ ← Streaming chunk capture (.jsonl)
         │     ...               │
         └──────────────────────┘
```

> Ledger files are stored at `{mcp-server}/storage/ledger/{slug}/`, **not** inside plan folders.
> Plan folders remain purely human-readable Markdown. Use `ledger_list_projects` to enumerate all tracked projects.

### Data Model

The server manages three types of files, all stored under the centralized ledger root:

1. **Project Metadata** (`storage/ledger/{slug}/.meta.json`): Lightweight per-project summary
   - Slug, original plan path, current status, timestamps
   - Written automatically whenever the root index is updated
   - Used by `ledger_list_projects` to enumerate all projects without loading full root indexes

2. **Root Index** (`storage/ledger/{slug}/project-ledger.json`): High-level project metadata
   - Project status (READY, IN_PROGRESS, COMPLETE, BLOCKED)
   - Work package summaries (status, assigned agent, dependencies)
   - Project-level comments and incidents
   - Auto-handoff loop-guard counter (`auto_handoff_depth`, server-managed, max 10 before fallback to manual routing)
   - Synthesis completion flag (`synthesis_generated`, set by `ledger_complete_synthesis`)

3. **Work Package Details** (`storage/ledger/{slug}/WP-###.json`): Per-task implementation details
   - Acceptance criteria and completion status
   - Pipeline history (implementation, QA, review, documentation)
   - Artifacts (files modified, commit hashes, test results)
   - Observations and technical debt notes

4. **Orchestrator Capture Files** (`storage/ledger/{slug}/orchestrator/`): Files written by the orchestrator during a run
   - `orchestrator/dialogues/` — Agent dialogue files (`{WP_ID}-{stage}-r{N}.md`), written by `write_dialogue()`; served by `handleListDialogues` / `handleGetDialogueFile`
   - `orchestrator/chunks/` — Streaming chunk capture files (`{WP_ID}-{stage}-r{N}.jsonl`), written by `ChunkWriter`; served by `handleListChunks` / `handleGetChunkFile`

5. **Archived Documents** (`storage/ledger/{slug}/plan.md`, `synthesis.md`): Read-only snapshots of key project documents
   - `plan.md` — copied from the project folder when `ledger_initialize_project` is called
   - `synthesis.md` — copied when `ledger_complete_synthesis` is called
   - Both are served as formatted HTML by the GUI (`#/projects/:slug/plan` and `#/projects/:slug/synthesis`)
   - Copies are best-effort; each tool response includes `archived_documents[]` and, when relevant, `archive_skipped[]`

All four file types are kept in sync automatically — when an agent updates a work package, the server updates both JSON files and the `.meta.json` in a single atomic operation.

---

## Setup

### Prerequisites

- **Node.js** (ESM-compatible version)
- **npm** or compatible package manager

### Installation

1. **Install dependencies**:
   ```bash
   cd mcp-server
   npm install
   ```

2. **Configure Claude Desktop or Claude Code**:
   
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

   **Important**: Use the **absolute path** to the `src/index.ts` file on your system.

   **Optional: Custom agents directory**

   To enable auto-handoff, the server needs to locate your `*.agent.md` persona files. By default it auto-detects the VS Code User prompts folder for the current platform:

   | Platform | Default path |
   |---|---|
   | macOS | `~/Library/Application Support/Code/User/prompts/` |
   | Linux | `~/.config/Code/User/prompts/` |
   | Windows | `%APPDATA%/Code/User/prompts/` |

   If your persona files live elsewhere, pass `--agents-dir` explicitly:

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

   If the directory is missing or contains no `*.agent.md` files, the server logs a warning and starts normally — auto-handoff is disabled but all other tools continue to work.

3. **Restart your AI IDE** to load the MCP server

4. **Verify**:
   - The server starts automatically when Claude Code/Desktop launches
   - Agents will perform a pre-flight check (`ledger_get_project_status`) before starting work
   - If the server is unreachable, agents will report configuration errors
   - On startup, the server logs agent discovery results to stderr:
     - ✅ Success: `[project-ledger-mcp] Agent registry: 9 agents discovered from /path/to/prompts`
     - ⚠️ Not found: `[project-ledger-mcp] agents_dir not found: /path. Auto-handoff disabled.`

---

## Usage

### For Agent Workflows

The MCP server is designed to work with the [Ledger-Enabled Agent Workflow](../personas/ledger/README.md). Agents use the server automatically — you don't need to invoke tools manually.

**Typical Agent Session:**

1. **Agent checks project status** via `ledger_get_project_status`
2. **Agent reads work package details** via `ledger_get_work_package`
3. **Agent performs work** (writes code, runs tests, etc.)
4. **Agent updates ledger** via MCP tools:
   - `ledger_start_pipeline` — Begins implementation/QA/review
   - `ledger_complete_pipeline` — Records results and artifacts
   - `ledger_add_observation` — Notes technical debt or improvements
   - `ledger_update_work_package_status` — Marks tasks complete

5. **Agent asks for next action** via `ledger_get_next_action` or `ledger_get_handoff_status`

   `ledger_get_handoff_status` may return an `auto_handoff` object:
   ```json
   {
     "current_agent": "Developer",
     "next_agent": "QA",
     "status": "HANDOFF",
     "auto_handoff": {
       "agent_name": "4 - QA v3.6.1",
       "agent_id": "ledger-4-qa",
       "cc_agent_name": "4-qa",
       "vs_agent_name": "4 - QA v3.6.1",
       "da_agent_name": "4-qa",
       "prompt": "@ledger-4-qa\nProject path: /path/to/plan"
     }
   }
   ```
   When present, the IDE can invoke the next agent automatically without human routing. When absent, use the standard `CURRENT AGENT / NEXT AGENT / STATUS` block for manual routing.

### Example: Developer Agent Flow

```
User: "Implement WP-003"

Agent:
1. Calls ledger_get_work_package(WP-003)
   └─ Reads: Acceptance criteria, dependencies, current status

2. Validates dependencies are complete

3. Calls ledger_claim_work_package(WP-003, agent="Developer")
   └─ Updates: Status READY → IN_PROGRESS

4. Calls ledger_start_pipeline(type="implementation")
   └─ Creates: New pipeline entry with status IN_PROGRESS

5. Implements the feature (writes code)

6. Calls ledger_complete_pipeline(
     status="PASS",
     summary=["Added authentication middleware", "Updated routes"],
     artifacts={files_modified: ["src/auth.ts", "src/routes.ts"]},
     acceptance_criteria_updates=[{criterion: "Auth required", met: true}]
   )
   └─ Updates: Pipeline status, artifacts, acceptance criteria

7. After QA, review, and documentation pipelines pass, the Documentation Agent calls
   ledger_update_work_package_status(status="COMPLETE", agent="Documentation Agent")
   └─ Updates: WP-003 status to COMPLETE (if all criteria met)
```

### For Manual Inspection

You can read the ledger files directly — they're human-readable JSON:

```bash
# View project overview
cat storage/ledger/2026-02-11-feature-name/project-ledger.json

# View work package details
cat storage/ledger/2026-02-11-feature-name/WP-001.json

# View project metadata
cat storage/ledger/2026-02-11-feature-name/.meta.json
```

**Warning**: Never edit ledger files manually. Always let agents use MCP tools to ensure consistency.

---

## GUI Dashboard

A lightweight web dashboard for monitoring and managing projects tracked in the ledger.

**Start the GUI server:**
```sh
npm run gui
```
Then open [http://localhost:3420](http://localhost:3420) in your browser.

**Custom port or ledger directory:**
```sh
npx tsx gui/server.ts --port 4000 --ledger-dir /path/to/ledger
```

**Features:**
- View all projects and their current status
- **Project name column** — resolves the human-readable name from `package.json`, `composer.json`, or `pyproject.toml` in the project root; shows `—` when none is found
- **% Done column** — compact inline progress bar + percentage derived from `(done / total) × 100`; shows `—` for projects with no work packages
- **Slug display** — date prefix (`YYYY-MM-DD-`) stripped in the cell; full slug accessible via browser tooltip (hover the link)
- **Server-driven sort** — click any column header in the Projects list (Project, Repository, % Done, Status, Created, Updated) to request a **server-side** sort; active column shows a ▲ / ▼ arrow indicator; clicking the same header toggles direction; sort preference (column + direction) persists across page reloads via `localStorage` (keys `mcp-sort-key` / `mcp-sort-dir`); defaults to Updated descending; page resets to 1 on sort change
- **Pagination** — the Projects list is paginated server-side; **Previous / page-number / Next** controls appear below the table; a **page-size selector** (25 / 50 / 100) lets you control how many rows are shown and persists to `localStorage` (key `mcp-page-limit`), defaulting to 50; a **"Showing X–Y of Z projects"** summary is always displayed; the 10-second auto-refresh poll refreshes the **current page** with current filter and sort params (not always page 1)
- **Search & filter** — text input in the filter bar triggers a **debounced (300 ms) server-side search** by slug or project name; page resets to 1 on each new query; the status dropdown filters results server-side and shows **per-status project counts** (e.g. `Ready (3)`, `In Progress (2)`); status preference persists via `localStorage` (key `mcp-status-filter`), defaulting to `ACTIVE`
- Drill down into project and work package details
- View project-level comments and incidents (sorted newest-first) on the Project Detail page
- **View archived plan** — **View full plan →** link on the Project Detail page (shown when a plan synopsis is available); renders as formatted HTML at `#/projects/:slug/plan`
- **View archived synthesis** — **View synthesis →** link on the Project Detail page (shown when `synthesis_generated === true`); renders the final synthesis report as formatted HTML at `#/projects/:slug/synthesis`
- **Pipeline stage badge track** — the work-packages table in the Project Detail view replaces the redundant Title column with a colored stage badge track per WP; badges are colored by pipeline status (grey=pending, blue=in-progress, green=pass, red=fail) and show abbreviated agent-role labels with full-name tooltips; stages with rework > 0 display an overlay count badge; falls back to a plain WP ID cell when the overview data is unavailable
- **Pipeline progression bar** — the WP Detail view renders a "Pipeline Progression" card above the Pipelines section, showing the WP's active stages as status-colored badges; derives all data from the already-fetched WP detail (no extra API call); all stages default to pending when no pipelines have run yet
- **Per-pipeline duration badge** — each pipeline entry in the WP Detail view shows a duration badge (e.g. `2m 15s`) when `duration_ms` is present; pipelines without timing data render without a badge (backward-compatible with older pipeline records)
- **WP aggregate timing** — the WP Detail view displays an "Active time" total (sum of all pipeline `duration_ms` values) and a "Wall-clock" span (time from first pipeline `started_at` to last `completed_at`); the section is shown conditionally only when at least one pipeline has timing data
- **Dialogues card** — the WP Detail view fetches and displays agent dialogue files captured by the orchestrator; **chunk files (streaming capture) are preferred over Markdown dialogue files** — the view issues parallel requests for both and uses chunk data when available, falling back to Markdown dialogues for older runs that predate streaming capture; dialogues are grouped by stage name with one pill button per revision; the latest revision is visually highlighted; clicking a button fetches and renders the Markdown content inline via the `/chunks/:filename/rendered` endpoint (chunk files) or the `/dialogues/:filename` endpoint (Markdown files); collapse/toggle and error handling follow the same pattern for both content types; the card appears after Handoff Notes at the bottom of the page
- **Project-level timing** — the Project Detail page shows a "Duration" field (elapsed time since project creation) and an "Active time" field (aggregate of all pipeline durations across all WPs); computed server-side by `handleGetProject` reading all WP detail files in parallel
- Browse all project comments across every project on the **Insights page** (`#/insights`) — filter by type, priority, or project; auto-refreshes every 15 seconds
- **Orchestrator view** (`#/orchestrator`) — launch and monitor orchestrator runs from the GUI: enter an absolute path to a `plan.md`, click **Run Preflight** to validate environment readiness (renders a pass/fail checklist per check), then click **Start Run** (enabled only when all preflight checks pass) to launch a run; a live **Run Queue** table polls every 5 seconds and shows each entry's status badge, elapsed time, and progress summary; rows are expandable for an inline log preview; pending entries show a Kill button, dead entries show a Dismiss button, and started entries link to their project detail page; a **CLI Reference** card at the bottom lists the equivalent shell commands; the view is reachable from the top nav bar and via direct URL (`#/orchestrator`)
- Delete completed projects permanently
- Toggle auto-handoff, adjust the max handoff depth, and toggle dialogue capture at runtime (no restart required)
- **Dark mode** — theme toggle button (🌙 / ☀️) in the nav header persists the preference to `localStorage`; defaults to dark on first visit. FOUC-prevention inline script in `<head>` applies the saved theme before first paint
- **Stale-instance detection** — `stale-check.js` polls the `/api/server-info` endpoint every 30 seconds and inserts a persistent `stale-banner` at the top of the page when the GUI detects that on-disk component versions (MCP Server, Personas, Orchestrator) differ from the versions present at boot time; the banner names each changed component and prompts the user to relaunch; polling stops once the banner is shown; the module is idempotent (safe to call `StaleCheck.init()` multiple times)

> The GUI server is a **separate process** from the MCP server. Both can run simultaneously and share the same ledger directory. The MCP server monitors `gui-config.json` for configuration changes via `fs.watch()` — changes take effect immediately without restarting.

### GUI Backend Modules

The GUI backend is composed of focused utility modules in `src/gui/`:

| Module | Purpose |
|--------|---------|
| `config.ts` | Reads and watches `gui-config.json`; exposes typed configuration to the API layer |
| `auto-archive.ts` | Background job that auto-archives completed projects after a configurable delay |
| `log-resolver.ts` | Locates and reads orchestrator run log files (JSONL); provides `resolveOrchestratorLogsDir`, `findRunLogs`, and `readLogEntries` — see below |
| `api.ts` (dialogue handlers) | `handleListDialogues` and `handleGetDialogueFile` serve the project's `orchestrator/dialogues/` directory — see below |
| `api.ts` (chunk handlers) | `handleListChunks` and `handleGetChunkFile` serve the project's `orchestrator/chunks/` directory — see below |
| `chunk-renderer.ts` | Pure JSONL-to-Markdown renderer; exports `renderChunksToMarkdown(jsonlContent: string): string` — no I/O, no side effects; powers the `/chunks/:filename/rendered` endpoint — see below |

#### `log-resolver.ts` — Orchestrator Run Log Resolver

Provides three exported functions for reading orchestrator run logs:

- **`resolveOrchestratorLogsDir(configured: string | undefined): string`** — Returns `configured` if it is a non-empty string; otherwise falls back to `~/.ai-insights/orchestrator-logs`.
- **`findRunLogs(logsDir: string, slug: string): Promise<string[]>`** — Lists files in `logsDir` whose names match `<prefix>-{slug}.jsonl`. Files without a non-empty prefix are excluded. Returns an empty array when the directory does not exist.
- **`readLogEntries(logsDir: string, filename: string, afterLine?: number): Promise<{ entries: unknown[]; totalLines: number }>`** — Reads and parses a JSONL log file. Malformed lines are silently skipped. `totalLines` always reflects the full line count; `entries` contains parsed objects from line `afterLine + 1` onward.

**Security:** `readLogEntries` enforces a dual-layer path-traversal defence:
1. **Filename allowlist** — rejects any filename that contains `..`, `/`, or characters outside `[A-Za-z0-9._-]`.
2. **Resolved-path escape check** — `path.resolve()` verifies the resolved path stays within `logsDir`, preventing CWD-relative or symlink escapes.

Both layers throw `ApiError FORBIDDEN` on violation. Errors are written to **stderr only** (STDIO discipline preserved).

> **Known limitation:** `resolveOrchestratorLogsDir` and `findRunLogs` do not currently validate that the supplied path is absolute. If a relative path is stored in `gui-config.json`, `findRunLogs` may resolve it against the process CWD. `readLogEntries` is immune to this (its escape-check uses `path.resolve()`). A `path.isAbsolute()` guard is planned before these functions are wired into any HTTP-facing endpoint.

#### Dialogue API handlers — `GET /api/projects/:slug/dialogues[?wp=WP-001]` and `GET /api/projects/:slug/dialogues/:filename`

Two API handlers in `gui/api.ts` expose the agent dialogue files written by the orchestrator's dialogue capture feature:

- **`handleListDialogues(ledgerRoot, slug, wpId?): Promise<DialogueEntry[]>`** — Returns a sorted array of `DialogueEntry` objects (`{ filename, wp_id, stage }`) from `storage/ledger/{slug}/orchestrator/dialogues/`. Returns `[]` when the directory is absent (no error thrown). The `wp_id` and `stage` fields are parsed from the filename convention `{WP_ID}-{stage}-r{N}.md`; filenames that do not match the convention produce empty strings for those fields. Optional `wpId` argument filters to filenames that start with `{wpId}-` (e.g. `'WP-001'` returns only `WP-001-*.md` files).
- **`handleGetDialogueFile(ledgerRoot, slug, filename): Promise<string>`** — Returns the raw Markdown content of a single dialogue file. Throws `ApiError NOT_FOUND` when the filename is rejected by the allowlist or the file does not exist.

**Security:** `handleGetDialogueFile` enforces a dual-layer path-traversal defence identical in structure to `readLogEntries`:
1. **Filename allowlist** — `DIALOGUE_FILENAME_RE = /^[A-Za-z0-9_-]+\.md$/` rejects any filename containing `.`, `/`, or other special characters. The `filename` path segment is decoded with `decodeURIComponent()` in `server.ts` before the check, so percent-encoded traversals (e.g. `%2E%2E%2Fsecret.md`) are also rejected.
2. **Resolved-path escape check** — `path.resolve()` verifies the resolved file path stays within the project's `orchestrator/dialogues/` directory.

Both layers throw `ApiError NOT_FOUND` on violation (no leaking of filesystem layout).

#### GUI Frontend — Dialogues card (`views/work-package.js`)

The WP Detail view includes a **Dialogues card** rendered asynchronously after the Handoff Notes section. Two new methods on the `API` object (in `api-client.js`) back this feature:

- **`API.getDialogues(slug, wpId)`** — `GET /api/projects/:slug/dialogues?wp={wpId}`. Returns a parsed JSON array of `{ filename, stage, wp_id }` objects. Hand-rolls its `?wp=` query string (consistent with `getRunLogEntries`).
- **`API.getDialogueContent(slug, filename)`** — `GET /api/projects/:slug/dialogues/:filename`. Returns raw Markdown text via `res.text()`. Uses a direct `fetch()` call rather than the internal `request()` helper, which calls `res.json()`.

**Rendering flow:**

1. A `<div id="wp-dialogues-section">` placeholder is injected synchronously into `app.innerHTML` at the bottom of the WP detail DOM (after `handoffHtml`). A closure reference (`dialoguesEl`) is captured before the async call resolves.
2. `API.getDialogues()` is called. If the response is empty, a "No dialogues available" message is rendered in the placeholder.
3. For a non-empty response, dialogues are grouped by `stage` (insertion order preserved). Each stage renders as a row with a label and pill buttons — one per revision (`stage-r0`, `stage-r1`, …). The last revision gets the `.dialogue-btn-latest` class (bold, blue-bordered).
4. A single delegated `click` listener on `dialoguesEl` handles all button presses via `e.target.closest('.dialogue-btn')`.
5. Clicking a button calls `API.getDialogueContent()` and renders the result with `marked.parse()` inside a `.dialogue-content` container. The output is set via `innerHTML` (trusted HTML — consistent with plan/synthesis rendering; no sanitization).
6. An `activeBtn` closure variable tracks the currently expanded button for collapse/toggle behaviour: clicking a different button collapses the current one; clicking the same button again toggles it off.
7. `getDialogueContent` errors render an inline `.text-danger` message. `getDialogues` errors render a `.text-danger` message inside the Dialogues card. Neither error propagates to the surrounding WP view.

> **Accessibility (future):** `.dialogue-btn` buttons do not set `aria-expanded`. A future pass should toggle it alongside `.dialogue-btn-active`.

#### Chunk API handlers — `GET /api/projects/:slug/chunks[?wp=WP-001]` and `GET /api/projects/:slug/chunks/:filename`

Two API handlers in `gui/api.ts` expose the streaming chunk files written by the orchestrator's `ChunkWriter`. They mirror the dialogue handlers exactly, differing only in directory path and file extension.

**Exported types:**

```typescript
interface ChunkEntry {
  filename: string;  // e.g. 'WP-001-implementation-r0.jsonl'
  wp_id:    string;  // e.g. 'WP-001' (empty string when filename does not match the convention)
  stage:    string;  // e.g. 'implementation' (empty string when filename does not match)
}
```

**Handlers:**

- **`handleListChunks(ledgerRoot, slug, wpId?): Promise<ChunkEntry[]>`** — Returns a sorted array of `ChunkEntry` objects from `storage/ledger/{slug}/orchestrator/chunks/`. Returns `[]` when the directory is absent (ENOENT/ENOTDIR), with no error thrown. The `wp_id` and `stage` fields are parsed from the filename convention `{WP_ID}-{stage}-r{N}.jsonl`; filenames that do not match the convention produce empty strings for those fields. The optional `wpId` argument must match `WP_ID_RE = /^WP-\d+$/`; invalid values (e.g. injection attempts) silently return `[]` rather than an error. When valid, only filenames starting with `{wpId}-` are returned.

- **`handleGetChunkFile(ledgerRoot, slug, filename): Promise<{ content: string }>`** — Returns the raw JSONL content of a single chunk file. Throws `ApiError NOT_FOUND` (404) when the filename is rejected by the allowlist or the file does not exist.

**Security:** `handleGetChunkFile` enforces the same dual-layer path-traversal defence as `handleGetDialogueFile`:
1. **Filename allowlist** — `CHUNK_FILENAME_RE = /^[A-Za-z0-9_-]+\.jsonl$/` rejects any filename containing `.`, `/`, spaces, or other special characters (including `..` traversal attempts).
2. **Resolved-path escape check** — `path.resolve()` verifies the resolved file path stays inside the project's `orchestrator/chunks/` directory (defence-in-depth against symlink and encoding escapes).

Both layers throw `ApiError NOT_FOUND` on violation. Rejection events are written to `console.warn` (stderr only — STDIO discipline preserved).

**Cross-language coupling:** `CHUNKS_DIR = 'orchestrator/chunks' as const` (exported from `src/utils/constants.ts`) must exactly match the path used by the Python orchestrator's `ChunkWriter`. Changing either side without updating the other will break chunk file discovery.

#### `chunk-renderer.ts` — JSONL-to-Markdown renderer

A pure TypeScript module (no I/O, no side effects) that converts a raw JSONL chunk file into rendered Markdown. Imported directly by `server.ts` to back the `/rendered` endpoint — there is no separate HTTP handler; the composition happens inline in the route dispatcher:

```typescript
handleGetChunkFile(ledgerRoot, slug, filename).then(({ content }) => ({
  content: renderChunksToMarkdown(content),
}))
```

**Public API:**

- **`renderChunksToMarkdown(jsonlContent: string): string`** — Parses a JSONL chunk file produced by the Python `ChunkWriter`, merges token-level `AIMessageChunk` data into complete messages (accumulating `content`, `tool_calls`, and `usage_metadata`), groups messages by namespace (main agent first, then sub-agents under `### Subagent:` headings), and renders Markdown consistent with the orchestrator's `serialize_messages_to_markdown()` output format.

**JSONL format (chunk_format: 1):**

Each file begins with a header line (`{"chunk_format": 1, ...}`) followed by one event per line. Events may arrive in two equivalent wire shapes:
- **Object shape:** `{"ns": namespace, "msg": AIMessageChunk.model_dump(), "metadata": {...}}`
- **Array shape:** `[namespace, AIMessageChunk.model_dump(), metadata]`

Both shapes are normalised to a common internal representation before processing.

**Routing:** `GET /api/projects/:slug/chunks/:filename/rendered`
- `rest.length === 5`, `rest[2] === 'chunks'`, `rest[4] === 'rendered'`
- Placed before the `/:filename` route (rest.length 4) in `server.ts` for visual grouping; because the two routes have *different* `rest.length` values, the dispatcher can never confuse them — placement is purely cosmetic.
- Returns `{ content: string }` — the rendered Markdown string.
- Inherits all security guards from `handleGetChunkFile` (CHUNK_FILENAME_RE allowlist + path-prefix escape check).

#### GUI Frontend — Chunks card (`views/work-package.js`)

The WP Detail view's **Dialogues card** was updated in WP-006 to prefer streaming chunk files over Markdown dialogue files. Two new methods on the `API` object (in `api-client.js`) back the chunk path:

- **`API.getChunks(slug, wpId)`** — `GET /api/projects/:slug/chunks?wp={wpId}`. Returns a parsed JSON array of `{ filename, stage, wp_id }` objects (`ChunkEntry[]`). Always appends `?wp=`, consistent with `getDialogues`.
- **`API.getChunkRendered(slug, filename)`** — `GET /api/projects/:slug/chunks/{filename}/rendered`. Returns rendered Markdown text via `data.content` (JSON unwrap, same pattern as `getDialogueContent`).

**Chunk-first rendering flow:**

1. `renderWorkPackageDetail()` issues `Promise.all([API.getChunks(...).catch(() => []), API.getDialogues(...)])` in parallel. The `catch` on `getChunks` silently swallows errors (absent `chunks/` directory is expected for older runs that predate streaming capture).
2. When `chunks.length > 0`, `useChunks = true` and `entries = chunks`; otherwise `entries = dialogues` (fallback path).
3. Each entry button receives `data-use-chunks="1"` (chunk path) or `data-use-chunks="0"` (dialogue path). The `click` listener reads this attribute and calls `API.getChunkRendered()` or `API.getDialogueContent()` accordingly.
4. The rendered Markdown is parsed with `marked.parse()` and injected into `.dialogue-content` as HTML. Error handling follows the same inline `.text-danger` pattern as the dialogue path.

> **Backward compatibility:** Projects created before the streaming capture feature have no `orchestrator/chunks/` directory. The silent `catch(() => [])` on `getChunks` ensures these projects fall back cleanly to the existing Markdown dialogue display with no UI change.

---

## Available Tools

The server exposes 22 MCP tools organized by category:

### Project Lifecycle
- `ledger_get_project_status` — Read project overview
- `ledger_initialize_project` — Create new ledger
- `ledger_list_projects` — List all tracked projects (optionally filter by status)
- `ledger_detect_project` — Auto-detect project from a workspace path
- `ledger_complete_synthesis` — Mark synthesis as generated; transitions project to COMPLETE if all WPs are done

### Work Packages
- `ledger_get_work_package` — Read full WP details
- `ledger_list_work_packages` — List/filter work packages
- `ledger_create_work_package` — Create new work package
- `ledger_claim_work_package` — Start working on a WP
- `ledger_update_work_package_status` — Update WP status
- `ledger_reset_rework_count` — Reset rework counter for a pipeline type on a WP (PM-only)
- `ledger_update_acceptance_criteria` — Add, remove, or modify acceptance criteria on a WP (PM-only)

### Pipelines
- `ledger_begin_work` — Claim a READY WP and start its pipeline in a single atomic call (replaces `ledger_claim_work_package` + `ledger_start_pipeline` two-step)
- `ledger_start_pipeline` — Begin implementation/QA/review/docs phase
- `ledger_complete_pipeline` — Record results and artifacts
- `ledger_cancel_pipeline` — Cancel a stale IN_PROGRESS pipeline (marks it FAIL)
- `ledger_update_pipeline_progress` — Update summary of an IN_PROGRESS pipeline without completing it

### Observations
- `ledger_add_observation` — Add comment to pipeline
- `ledger_add_project_comment` — Add project-level comment

### Workflow Coordination
- `ledger_get_next_action` — Ask "what should I do next?" (includes stale pipeline detection); pass `max_results` to get up to N actionable WPs in one call
- `ledger_get_handoff_status` — Compute handoff status for current agent

### Help & Documentation
- `ledger_help` — Get usage documentation, examples, and required parameters for all tools (pass no args for overview, or `tool_name` for a specific tool)

For detailed API signatures and parameters, see the [API Surface](docs/agents/project-manifest/api-surface.md).

---

## Key Features

### ✅ Atomic Operations

All writes use the **write-to-temp-then-rename** pattern:
- Prevents readers from seeing partial writes
- Ensures JSON files are never corrupted

### ✅ File Locking

Distributed file locking with `proper-lockfile`:
- Prevents race conditions when multiple agents run concurrently
- Automatic stale lock detection (10 second timeout)
- Retry logic with exponential backoff

### ✅ Schema Validation

All data validated with Zod before reading or writing:
- Catches schema violations early
- TypeScript types inferred from schemas
- Runtime validation on every I/O operation

### ✅ Dual-File Sync

Work package updates are atomic across both files:
- Root index and WP detail always stay consistent
- Single lock protects both files during update
- No possibility of split-brain state

### ✅ Agent Auto-Discovery

At startup the server scans the configured agents directory for `*.agent.md` files:
- Reads each file's front-matter to extract the agent role name
- Populates an in-process registry used by `ledger_get_handoff_status` to route automatic handoffs
- Controlled via `--agents-dir <path>` or platform-specific defaults (see [Setup](#setup))
- If discovery fails or the directory is missing, auto-handoff is silently disabled and all other tools continue to work normally

### ✅ Infinite-Loop Protection

`ledger_get_handoff_status` tracks how many consecutive automatic handoffs have been emitted:
- `auto_handoff_depth` is stored in the root index and incremented on every `auto_handoff` emission
- The ceiling is `MAX_HANDOFF_DEPTH = 10`; once reached, `auto_handoff` is omitted and the IDE falls back to manual routing
- Reaching project `COMPLETE` resets the counter to `0` for the next planning cycle
- The counter is server-managed — no agent needs to pass or track it

### ✅ Self-Healing Counters

`ledger_get_project_status` automatically corrects counter drift:
- Recomputes totals from actual work package data
- Silently fixes inconsistencies
- Provides fault tolerance against bugs

---

## Troubleshooting

### "MCP server unavailable"

**Symptoms**: Agents report they cannot reach the server

**Solutions**:
1. Verify `.mcp.json` exists and points to correct path
2. Ensure dependencies are installed: `cd mcp-server && npm install`
3. Check the path uses forward slashes or proper escaping
4. Restart your AI IDE to reload MCP configuration

### MCP Tool Call Fails

**Symptoms**: Error messages from server during operation

**Solutions**:
1. Check that `project_path` arguments are absolute paths
2. Verify ledger files haven't been manually edited or corrupted
3. Look for schema validation errors in the error message
4. Check file permissions (server needs write access)

### Lock Acquisition Timeout

**Symptoms**: "Failed to acquire lock after 50 retries"

**Solutions**:
1. Another process may be holding the lock — wait and retry
2. If a process crashed, manually delete the `.lock` file inside `storage/ledger/{slug}/`
3. Check that lock timeout (10s) hasn't been exceeded

---

## Development

### Versioning

This project uses **`changelog.md` as the source of truth** for versioning:

1. **When releasing a new version**, update the changelog first:
   ```markdown
   ## v1.0.2 - 2026-02-20
   
   ### Added
   - New feature...
   ```

2. **Sync the version** to `package.json`:
   ```bash
   npm run sync-version
   ```
   This script extracts the version from `changelog.md` and updates `package.json` automatically.

3. **The MCP server displays its version** at startup in STDERR:
   ```
   [project-ledger-mcp] Server v1.0.2 started successfully
   ```

The `sync-version` script runs automatically before `npm run dev` via the `predev` hook.

### npm Scripts

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript source to `dist/` |
| `npm run dev` | Run server with `tsx` (auto-reload) |
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run sync-version` | Sync version from `changelog.md` to `package.json` |
| `npm run check:roles` | Assert `KNOWN_ROLES` / `AGENT_ROLES` parity (see below) |

### Checking Role Parity

`scripts/sync-personas.js` maintains a hard-coded `KNOWN_ROLES` array that must stay in sync with `AGENT_ROLES` in `src/utils/constants.ts`. Run the parity check after adding or renaming any agent role:

```bash
# Build first (outputs to dist/)
npm run build

# Then check
npm run check:roles
```

`check:roles` computes the symmetric difference between the two arrays. A clean run prints:

```
[check-known-roles] OK: KNOWN_ROLES and AGENT_ROLES are in sync (9 roles).
```

If the arrays diverge it exits 1 with a labelled diff:

```
[check-known-roles] FAIL: KNOWN_ROLES / AGENT_ROLES are out of sync.

  Missing from KNOWN_ROLES (present in AGENT_ROLES):
    - "NewRole"
  Extra in KNOWN_ROLES (not in AGENT_ROLES):
    - "OldRole"
```

The script lives at `scripts/check-known-roles.js` in the workspace root and has no npm dependencies beyond Node.js built-ins.

### Running the test suite

```bash
npm test              # Run all tests once
npm run test:watch   # Run tests in watch mode
```

> **Prerequisite:** `npm test` runs a `pretest` hook that calls `../scripts/build-personas.js`
> to regenerate persona output files. This script depends on `@mistralys/persona-builder`
> being compiled. If you see a `Cannot find module` error on the first run, execute
> `npm run build` from the sibling `ai-persona-builder/` workspace first, then retry.

The test suite includes unit tests for all modules and **integration tests** for the auto-handoff chain. Integration tests use real `LedgerStore` instances against temp directories and a mock agents directory — no real VS Code installation or filesystem paths are required.

Key integration test file: `tests/integration/auto-handoff.test.ts` (23 tests covering the full PM → Developer → QA → Reviewer → Documentation → Synthesis chain, depth limit enforcement, rework cycles, and graceful degradation without an agent registry).

### Development Mode

```bash
npm run dev          # Run server with tsx (auto-reload)
```

### Project Structure

See [File Tree](docs/agents/project-manifest/file-tree.md) for detailed structure.

Key directories:
- `src/schema/` — Zod schemas and validators
- `src/storage/` — File I/O and locking
- `src/tools/` — MCP tool implementations
- `tests/` — Unit and integration tests

---

## Technical Documentation

For developers and curious users who want to understand the internals:

- **[Project Manifest](docs/agents/project-manifest/)** — Comprehensive technical documentation
  - [Tech Stack & Patterns](docs/agents/project-manifest/tech-stack.md)
  - [Public API Surface](docs/agents/project-manifest/api-surface.md)
  - [Key Data Flows](docs/agents/project-manifest/data-flows.md)
  - [Constraints & Conventions](docs/agents/project-manifest/constraints.md)

---

## Related Documentation

- **[Ledger-Enabled Agent Workflow](../personas/ledger/)** — How to use this server with AI agents
- **[Ledger Schema Reference](../personas/ledger/project-ledger-schema.md)** — JSON structure specification
- **[Agent Personas](../personas/ledger/)** — The 9 agents that use this server

---

## License

Same as the parent ai-insights project.
```