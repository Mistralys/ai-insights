# Plan: Synthesis Agent — Knowledge Collection Delegation

**Created:** 2026-05-30  
**Status:** Ready for implementation — all open questions resolved.

---

## Background

The Synthesis agent currently embeds the full knowledge extraction protocol as
`{{> synthesis-knowledge-collection}}` — a ~100-line partial covering candidate
identification, scope assessment, second-pass cold filter, confidence scoring,
deduplication, and committing. The Knowledge Archiver already implements this
protocol in full, with a stricter version (stronger scarcity enforcement, better
separation of global vs. project scope). The embedded version in the Synthesis
agent is a duplicate that diverges over time and stretches the agent's
responsibility.

After this change: the Synthesis agent writes the report, then hands off to the
Knowledge Archiver with the project folder path. The Knowledge Archiver does the
extraction work and returns an extraction report. The Synthesis agent reviews the
report and calls `ledger_complete_synthesis`.

---

## Phase 1 — Redesign the Knowledge Archiver as a Two-Mode Persona

The Knowledge Archiver needs to operate interchangeably with two different data
sources. This is a proper Operating Modes redesign, not a constraint relaxation.

### Context: why two modes

| Mode | Trigger | Data source |
|------|---------|-------------|
| **A — Live (Subagent)** | Invoked by Synthesis agent | Project path (`cwd_path`); MCP tools for WP detail and project data; `synthesis.md` on disk |
| **B — Archive (Retrospective)** | Invoked manually for historical projects | Ledger storage path containing `.meta.json`, `project-ledger.json`, `WP-###.json`, `synthesis.md` |

> **Note:** Mode B is transitional. It exists to allow reprocessing of projects
> that completed before this delegation pattern existed. Once those archived
> projects have been processed, the agent will use Mode A exclusively.

### 1a. `personas/standalone/src/content/knowledge-archiver.md`

This is a structural redesign across several sections:

**Mission**

Generalize from "archived ledger project folders" to "ledger project folders".
The identity line becomes:

> **Identity: Head of Operations — Retrospective Knowledge Analyst.**
>
> Extract and commit reusable insights from completed ledger projects. Work from
> either a live project (via MCP tools) or an archived project folder (via disk
> files) to identify patterns, pitfalls, principles, and architectural decisions
> with genuine reuse value — then commit non-duplicate findings to the knowledge
> base using rigorous selection discipline.

**Operating Modes section (new — insert after Mission)**

Add a named-mode table and per-mode description following the Design Guide's
Operating Modes pattern:

- **Mode A — Live (Subagent):** Trigger = invoked by Synthesis agent with
  `cwd_path`. Data access = MCP tools (`ledger_get_project_status`,
  `ledger_list_work_packages`, `ledger_get_work_package`) for project and WP
  data; `synthesis.md` exists on disk at `dirname(plan_path)` and is guaranteed
  to be present. Knowledge tools (`ledger_search_insights`,
  `ledger_add_insight`) are used for both modes.

- **Mode B — Archive (Retrospective):** Trigger = invoked manually with a
  ledger storage folder path. Data access = disk files only (`.meta.json`,
  `project-ledger.json`, `WP-###.json`, `synthesis.md`). No live MCP reads. If
  `.meta.json` or `project-ledger.json` cannot be found, stop and ask for the
  correct path.

**Inputs section**

Replace the current single-input description with two mode-specific sub-sections:

- *Mode A:* `cwd_path` (workspace root directory) and `project_storage_path`
  (= `dirname(plan_path)`) — both provided by the Synthesis agent. The Synthesis
  agent has `plan_path` from pre-flight and derives `project_storage_path` before
  invoking the Knowledge Archiver. `synthesis.md` is read from disk at
  `project_storage_path`.
- *Mode B:* Absolute path to a completed ledger project storage folder. Expected
  files: `.meta.json` (required), `project-ledger.json` (required),
  `synthesis.md` (preferred), `plan.md` (preferred), `WP-###.json` (preferred),
  `orchestrator/chunks/*.jsonl` (optional).

The Capabilities sub-section gains a mode column:

| Capability | Mode A | Mode B |
|------------|--------|--------|
| Filesystem access | `synthesis.md` (read only) | All archive files (read only) |
| `ledger_get_project_status` | ✓ | — |
| `ledger_list_work_packages` | ✓ | — |
| `ledger_get_work_package` | ✓ | — |
| `ledger_search_insights` | ✓ | ✓ |
| `ledger_add_insight` | ✓ | ✓ |

**Tool Integration section**

Replace the current single-tool table with a mode-aware table. Add the live read
tools (`ledger_get_project_status`, `ledger_list_work_packages`,
`ledger_get_work_package`) with a "Mode A only" annotation. Remove the
constraint "This persona operates on archived data only — no live ledger reads
or mutations" entirely. Replace with:

> Never call live ledger mutation tools (e.g. `ledger_complete_synthesis`,
> `ledger_update_work_package`). Read-only MCP access is permitted in Mode A;
> in Mode B, use disk files only.

**Source Reading Strategy section**

Split into two sub-sections — one per mode:

- *Mode A:* (1) Call `ledger_get_project_status` to load project overview and
  WP list; (2) read `synthesis.md` from disk; (3) call `ledger_get_work_package`
  for each WP to load pipeline data, agent comments, and failure notes; (4)
  optionally scan orchestrator chunk logs on disk if needed for deeper evidence.

- *Mode B:* Existing reading order unchanged (`.meta.json` → `synthesis.md` →
  `plan.md` → `project-ledger.json` → `WP-###.json` → chunk logs).

**Constraints — "No live ledger operations" bullet**

Remove entirely. Replace with:

> **Mode B only: no live MCP reads.** In Mode B, the archive files are the sole
> source of truth. Do not call `ledger_get_project_status`, `ledger_get_work_package`,
> or any other live ledger tool. If a needed artifact is missing from disk, ask
> the caller to provide it — do not fall back to MCP.

**Workflow**

Update Step 1 ("Verify Path") to be mode-aware:
- Mode A: no stop-on-missing check needed — `synthesis.md` is guaranteed by
  the Synthesis agent. Proceed directly to reading.
- Mode B: existing path-verification check unchanged.

### 1b. `personas/standalone/src/meta/knowledge-archiver.yaml`

- Update `description`: change `"Extract and commit reusable knowledge from archived ledger project folders into the knowledge base."` to `"Extract and commit reusable knowledge from completed ledger project folders into the knowledge base."` — removes the "archived" constraint that Mode A violates.
- Add live read tools to `tools` / `mcp_tools` list:
  `ledger_get_project_status`, `ledger_list_work_packages`, `ledger_get_work_package`
  (these are Mode A only; annotate with a `note` sub-key in the YAML if the MCP
  tools table partial supports a free-text annotation field). **Prerequisite:**
  confirm whether the partial supports a `note` field before drafting YAML. If no
  mechanism exists, the Mode A annotation belongs in the Tool Integration prose
  only — not in the auto-generated table.
- Bump version: `1.3.1` → `1.4.0`
- Update `last_updated`: `2026-05-30`

---

## Phase 2 — Adapt the Synthesis Agent

### 2a. `personas/ledger/src/content/9-synthesis.md`

- Remove the `{{> synthesis-knowledge-collection}}` partial include.
- Replace it with an inline **Knowledge Collection** section using the same
  target-conditional pattern the PM uses for each of its subagent invocations.
  The section header is `## Knowledge Collection`.
  The complete replacement block (verbatim in the content file, immediately
  after the removal of `{{> synthesis-knowledge-collection}}`):

  ```markdown
  ## Knowledge Collection

  Before completing synthesis, delegate knowledge extraction to the
  Knowledge Archiver. Pass both `cwd_path` (the workspace root, available from
  pre-flight) and `project_storage_path` (= `dirname(plan_path)`, derived from
  the pre-flight `plan_path` value). The Knowledge Archiver uses `cwd_path` for
  live MCP reads and `project_storage_path` to locate `synthesis.md` on disk.
  ```

- Update Workflow **Step 8** to the following (modeled exactly after the PM
  subagent call pattern — 4-branch target-conditional + "Important" callout +
  "Expected output"):

  ```markdown
  8. **Knowledge Collection:** Invoke the Knowledge Archiver:
  {{#if target_vscode}}
     Invoke `runSubagent` with the following arguments:
     - `agentName`: `"{{agent_standalone_knowledge_archiver}}"`
     - `description`: `"Extract and commit insights from completed project"`
     - `prompt`: Pass `cwd_path` (workspace root) and `project_storage_path`
       (= `dirname(plan_path)` from pre-flight). The Knowledge Archiver uses
       `cwd_path` for live MCP reads and `project_storage_path` to locate
       `synthesis.md` on disk.
  {{else if target_claude_code}}
     Use the `Task` tool with `description: Use the custom agent
     "{{agent_standalone_knowledge_archiver}}"`. Pass: `cwd_path` (workspace
     root) and `project_storage_path` (= `dirname(plan_path)` from pre-flight).
  {{else if target_deep_agents}}
     Use the `task` tool with the following arguments:
     - `subagent_type`: `"{{agent_slug_standalone_knowledge_archiver}}"`
     - `task`: Pass `cwd_path` (workspace root) and `project_storage_path`
       (= `dirname(plan_path)` from pre-flight). The Knowledge Archiver uses
       `cwd_path` for live MCP reads and `project_storage_path` to locate
       `synthesis.md` on disk.
  {{else}}
     Call the **{{agent_standalone_knowledge_archiver}}** subagent with:
     `cwd_path` (workspace root) and `project_storage_path`
     (= `dirname(plan_path)` from pre-flight).
  {{/if}}

     > **Important:** The sub-agent has its own built-in persona, so does not
     > need any instructions. The data is sufficient.

     Expected output: An extraction report summarizing insights committed to the
     knowledge base. Review it before proceeding to Step 9.
  ```

  > **Note on template variables:**
  > - `{{agent_standalone_knowledge_archiver}}` resolves to the Knowledge
  >   Archiver's display name (e.g. `Knowledge Archiver v1.4.0`) — used for
  >   VS Code and Claude Code targets.
  > - `{{agent_slug_standalone_knowledge_archiver}}` resolves to the slug
  >   `standalone-knowledge-archiver` — used for the Deep Agents target and
  >   validated by the build system against the `subagents` list in `9-synthesis.yaml`.

### 2b. `personas/ledger/src/meta/9-synthesis.yaml`

- Remove `ledger_search_insights` and `ledger_add_insight` from `mcp_tools`.
- Add `subagents: [standalone-knowledge-archiver]`.
- Bump version: `3.5.3` → `3.6.0`
- Update `last_updated`: `2026-05-30`

---

## Phase 3 — Delete the Redundant Partial

**`personas/shared/partials/synthesis-knowledge-collection.md`** — delete. It is
only included in one place (verified: `personas/ledger/src/content/9-synthesis.md`),
it is orphaned after Phase 2, and retaining dead partials causes confusion.

---

## Phase 4 — Update Cross-System Documentation

**`AGENTS.md`** — Update the "Knowledge Collection" row in the Cross-System
Dependencies table:

| Field | Old | New |
|---|---|---|
| Source of truth | `personas/shared/partials/synthesis-knowledge-collection.md` | `personas/standalone/src/content/knowledge-archiver.md` |
| Must stay in sync with | `9-synthesis.yaml` → `mcp_tools` | `9-synthesis.yaml` → `subagents` field; `mcp-server/src/tools/knowledge.ts` (the underlying tools, now called by Knowledge Archiver) |

`CLAUDE.md` is auto-generated from `AGENTS.md` — no separate update needed.

> **Post-implementation:** Run `node scripts/cli.js ctx-generate` to regenerate
> `.context/` docs. The deletion of `synthesis-knowledge-collection.md` and the
> `AGENTS.md` update will leave `.context/agents.md`,
> `.context/personas/shared-partials.md`, and `.context/personas/file-structure.md`
> stale until regenerated. The pre-commit hook warns on CTX staleness but does
> not block.

---

## Phase 5 — Changelog

Add entries to `personas/changelog.md` for both changed personas (Synthesis
v3.6.0, Knowledge Archiver v1.4.0).

---

## Files Changed

| File | Change |
|---|---|
| `personas/standalone/src/content/knowledge-archiver.md` | Two-mode redesign (Mission, Operating Modes, Inputs, Tool Integration, Source Reading Strategy, Constraints, Workflow) |
| `personas/standalone/src/meta/knowledge-archiver.yaml` | Update `description` field; add live read tools; version bump |
| `personas/ledger/src/content/9-synthesis.md` | Replace `{{> synthesis-knowledge-collection}}` with delegation section |
| `personas/ledger/src/meta/9-synthesis.yaml` | Remove knowledge tools; add subagent; version bump |
| `personas/shared/partials/synthesis-knowledge-collection.md` | **Delete** |
| `AGENTS.md` | Update cross-system dependencies table |
| `personas/changelog.md` | Two changelog entries |

---

## Open Questions

### Q1 — What to pass to the Knowledge Archiver (Mode A)

**Decision:** Pass both `cwd_path` and `project_storage_path`.

The Knowledge Archiver's Mode A tool list (`ledger_get_project_status`,
`ledger_list_work_packages`, `ledger_get_work_package`) does not include
`ledger_detect_project`, so KA cannot self-discover `plan_path` — and therefore
cannot locate `synthesis.md` on disk. Adding `ledger_detect_project` to Mode A
just to discover a path the Synthesis agent already has is unnecessary overhead.

Synthesis has `plan_path` from pre-flight. It derives `project_storage_path =
dirname(plan_path)` and passes both values when invoking the Knowledge Archiver.
This keeps the Mode A tool set minimal and makes the delegation interface explicit.

### Q2 — Orchestrator subagent support

**Decision:** Include `subagents:` field; defer behavioral verification.

Adding `subagents: [standalone-knowledge-archiver]` to `9-synthesis.yaml` causes
`load_subagents()` in the orchestrator to wire the Knowledge Archiver for the
Synthesis stage. The orchestrator's subagent dispatch is designed for pipeline
stages, not for the mid-workflow delegation pattern used here.

The `subagents:` field will be added to `9-synthesis.yaml` as specified (it is
harmless to list and required for IDE persona tool tables). Validating or adapting
orchestrator-side behavior for this delegation pattern is explicitly out of scope
for this plan. Track as a follow-up.
