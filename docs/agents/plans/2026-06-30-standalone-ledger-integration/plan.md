# Plan

## Plan Audit Cycles
- Audits: 7 — Plan Auditor v1.5.0
- Architectural Reviews: 2 — Plan Architect Reviewer v1.6.0

## Prior Project Context
The ai-insights repository has 102 tracked projects. The strategic vision emphasizes ease-of-use and low friction (short-term), wider availability (mid-term), and a "personas first" philosophy where integrated tools exist only to support the personas (long-term). This plan aligns with the short-term goal by eliminating a friction point: standalone plan executions are currently invisible to the ledger, requiring manual tracking. It also aligns with the long-term vision by extending the ledger's utility as a historical record without burdening the standalone developer persona with MCP dependencies.

No prior insights were found on standalone integration or import tooling.

## Summary
Implement end-to-end integration of standalone developer plan executions into the project ledger. This involves: (1) a new `ledger_import_standalone` MCP tool that creates a proper ledger project with a single completed work package from a standalone plan folder, (2) a new `standalone-archiver` ledger-support persona that calls this tool and dispatches the Knowledge Archiver for insight extraction, (3) a subagent dispatch step in the standalone developer persona so archival happens automatically after synthesis, (4) a CLI `import-standalone` command for manual and batch imports, and (5) supporting changes to the runner enum, GUI labels, and synthesis format alignment.

## Architectural Context

### MCP Server Storage Layer
Projects are stored as JSON files in `{ledgerRoot}/{repoName}/{slug}/` containing `.meta.json` (fast-path cache for GUI), `project-ledger.json` (root index with WP summaries), and per-WP detail files. All writes use `atomicWriteJson()` for crash safety. Dual-file updates require `withLock(store.storageDir)`. The `LedgerStore` class (`mcp-server/src/storage/ledger-store.ts`) is the workhorse for all project I/O.

### Runner Classification
The `runner` field uses a Zod enum with 4 values (`vscode`, `claude-code`, `orchestrator`, `unknown`) defined in `mcp-server/src/schema/root-index.ts` and `mcp-server/src/schema/project-meta.ts`. A TypeScript type alias in `mcp-server/src/utils/runner.ts` mirrors this. The GUI frontend defines `RUNNER_LABELS` and `RUNNER_ORDER` in `mcp-server/gui/public/views/project-list.js` for display and sorting.

### Project Lifecycle Guards
`ledger_complete_synthesis` requires `totalWps > 0` and `pendingWps === 0` — a project with zero work packages cannot complete via this path. The `computeHealedStatus` function enforces `synthesis_generated && totalWps > 0 && pendingWps === 0` for `COMPLETE` status. By creating imported projects with a single completed WP, the import tool satisfies all existing guards without requiring any exemptions or bypasses.

### Standalone Developer Persona
The standalone developer (`personas/standalone/src/meta/developer.yaml` + `personas/standalone/src/content/developer.md`) writes `synthesis.md` to the plan folder with a structured format including `### Code Insights` entries in the parseable format `[{PRIORITY}] ({TYPE}) {FILE_OR_MODULE}: {Observation}`. The persona currently has no MCP tools and no subagent declarations.

### Ledger-Support Persona Suite
The `personas/ledger-support/` suite contains 9 personas with MCP tool access. These are dispatched as subagents by ledger workflow personas (e.g., the Synthesis persona dispatches the Knowledge Archiver). Each persona has YAML metadata in `src/meta/` and content in `src/content/`.

### Subagent Dispatch Pattern
The established pattern uses three target-conditional blocks (VS Code `runSubagent`, Claude Code `Task`, Deep Agents `task`) as demonstrated in `personas/ledger/src/content/9-synthesis.md` Step 8. Only 2 standalone personas currently use subagents (`plan-refiner`, `workspace-architect`), proving the pattern is supported in the standalone suite.

### CLI Command Pattern
`scripts/cli.js` registers commands via a `COMMANDS` array with `{id, key, label, category, description, run}` objects. The `createMenu()` factory from `@mistralys/cli-menu` receives this array.

## Approach / Architecture

The solution has five layers, each independently useful:

1. **Runner enum extension** — Add `'standalone'` as a 5th runner value across all definition sites. This is the foundation — it allows imported projects to be visually distinguished in the GUI.

2. **New MCP tool `ledger_import_standalone`** — The core backend. Accepts a plan folder path, validates that `plan.md` and `synthesis.md` exist, creates the storage directory, writes a `project-ledger.json` with a single completed WP (1 WP with `status: 'COMPLETE'`, a completed `implementation` pipeline at `PASS`, and `active_pipeline_stages: ['implementation']`), writes the WP detail file, sets `synthesis_generated: true`, `runner: 'standalone'`, archives both documents, and writes `.meta.json`. Insight extraction is **not** handled here — that is delegated to the Knowledge Archiver (see layer 3). Lives in a new tool module `mcp-server/src/tools/standalone-import.ts` to keep `project-lifecycle.ts` focused. All storage writes (root index, WP detail, meta sync, document archive) are delegated to a new `LedgerStore.importStandaloneProject()` method, satisfying Constraint 2c which prohibits tool code from calling `@internal` storage primitives directly.

3. **Standalone archiver persona** — A ledger-support persona (`standalone-archiver`) that (a) calls `ledger_import_standalone` to create the ledger project, then (b) dispatches the existing `ledger-knowledge-archiver` as a subagent to extract and triage code insights from the now-ledger-backed project. This two-step approach reuses the Knowledge Archiver's judgment-based insight extraction — the same quality of deduplication, relevance triage, and rewriting that ledger projects receive.

4. **Standalone developer subagent dispatch** — A new final step in the standalone developer persona that dispatches the `standalone-archiver` after writing `synthesis.md`. Uses the established target-conditional pattern. Failure is non-blocking — the developer's deliverables are already written.

5. **CLI `import-standalone` command** — A Node.js script for manual single-plan and batch imports. Imports the compiled handler from `mcp-server/dist/tools/standalone-import.js` (following the dist-freshness check pattern established by `scripts/run-orchestrator.js`) and calls the import function directly — no MCP protocol overhead, no schema duplication. Note: the CLI handles project creation only — insight extraction requires invoking the Knowledge Archiver persona separately (or will happen automatically when the standalone developer dispatches the archiver subagent).

### Synthesis Format Alignment
Add an `### Outcome Summary` section to the standalone developer synthesis template (between `### Completion Status` and `### Implementation Summary`) to provide a clean 2-3 sentence summary for ledger extraction. This is additive — no existing workflows break.

### Single-WP Project Strategy
The import tool creates a proper ledger project with a single work package (WP-001) representing the entire standalone implementation. The WP has:
- `status: 'COMPLETE'` with `assigned_to: 'Developer'`
- `active_pipeline_stages: ['implementation']` (single-stage pipeline)
- A single `implementation` pipeline at `PASS` with a summary derived from the synthesis
- `acceptance_criteria: [{ criterion: 'Plan implemented and verified', met: true }]`

This means the project satisfies all existing lifecycle guards:
- `computeHealedStatus` sees `totalWps: 1`, `pendingWps: 0`, `synthesis_generated: true` → no healing triggered
- `progress_pct` computes to `100` — no division-by-zero risk
- The Knowledge Archiver sees a normal project with WP data to cross-reference

The `runner: 'standalone'` field distinguishes imported projects from ledger-workflow projects in the GUI.

## Rationale

- **MCP tool over CLI-only script:** The MCP tool uses the existing `LedgerStore` directly, avoiding schema duplication. It's also callable from any MCP client, not just the CLI.
- **Subagent dispatch over direct MCP in developer:** The standalone developer persona's identity is MCP-independent. Adding MCP tools to it would blur the standalone/ledger boundary. A subagent dispatch is non-intrusive — failure doesn't affect the developer's deliverables.
- **Single completed WP over zero WPs:** A single WP representing the entire standalone implementation is a valid summary of the work performed. It avoids the zero-WP edge case entirely — no `computeHealedStatus` exemptions, no GUI progress guards, and the Knowledge Archiver sees a normal project. The `runner: 'standalone'` field provides the distinction that the work was done outside the ledger workflow.
- **New tool module over extending `project-lifecycle.ts`:** `project-lifecycle.ts` already handles 5 tools. Standalone import has distinct validation logic (no stale-server check, no WP guards) and a different data flow. A separate module keeps concerns clean. Constraint 2c compliance is achieved by delegating all storage writes to a new `LedgerStore.importStandaloneProject()` method rather than calling `@internal` primitives from tool code.
- **Knowledge Archiver for insight extraction over regex in MCP tool:** The ledger Synthesis persona (#9) delegates insight extraction to the Knowledge Archiver subagent because it requires judgment — deduplication, relevance triage, and rewriting. The standalone archiver reuses this same agent after creating the ledger project, ensuring identical insight quality. Regex extraction would be cheaper but would produce unreviewed, potentially low-value or duplicate entries.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Import backend | MCP tool (`ledger_import_standalone`) | CLI script (Pattern 4), Archival persona (Pattern 2) | MCP tool reuses storage layer directly; CLI duplicates schemas; persona adds LLM cost for mechanical work |
| CLI import-logic source | Import compiled handler from `mcp-server/dist/tools/standalone-import.js` with dist-freshness check | Direct writes to storage from CLI script | Importing compiled output reuses `LedgerStore` and `atomicWriteJson` — the abstraction that exists to prevent schema duplication; direct writes create a second write path that can drift from the MCP tool's schema |
| Automation trigger | Subagent dispatch from developer | Manual post-hoc import only, MCP tools on developer directly | Subagent preserves standalone independence; manual-only creates friction; MCP on developer blurs boundary |
| Project representation | Single completed WP-001 | Zero WPs ("born complete") | Single WP satisfies all lifecycle guards without exemptions; zero WPs triggers `computeHealedStatus` Rule 6c regression and requires GUI NaN guards |
| Tool module location | New `standalone-import.ts` (storage writes delegated to `LedgerStore.importStandaloneProject()`) | Extend `project-lifecycle.ts`; call `@internal` writes directly from tool code | Separation of concerns preserved by keeping tool logic in its own module; Constraint 2c prohibits tool code from calling `@internal` storage primitives directly, so writes are delegated to a new `LedgerStore` method |
| Insight extraction | Knowledge Archiver subagent (LLM) | Regex in MCP tool, no extraction | Knowledge Archiver provides judgment-based triage matching ledger quality; regex is cheaper but produces unreviewed entries; no extraction loses knowledge |

## Pattern Alignment

- **Tool module per concern** (`mcp-server/src/tools/*.ts`) — follows the existing pattern where each tool module covers a cohesive set of operations (e.g., `knowledge.ts`, `project-lifecycle.ts`, `work-package.ts`). New `standalone-import.ts` follows this convention.
- **Storage via `LedgerStore`** (`mcp-server/src/storage/ledger-store.ts`) — the new tool will construct a `LedgerStore` and use its methods for all file I/O, consistent with all other tools.
- **Atomic writes with `atomicWriteJson`** (`mcp-server/src/storage/atomic-writer.ts`) — all JSON file writes use the atomic write utility, per Constraint 1. Per Constraint 2c, `standalone-import.ts` must not call this function directly; writes flow through `LedgerStore.importStandaloneProject()`.
- **Locking via `withLock(store.storageDir)`** — the import operation writes multiple files within a single lock scope, managed internally by `LedgerStore.importStandaloneProject()`, per Constraint 2. Tool code in `standalone-import.ts` does not call `withLock` directly.
- **Ledger-support persona suite** (`personas/ledger-support/src/`) — the new `standalone-archiver` persona follows the existing YAML metadata + Markdown content pattern used by all 9 existing ledger-support personas.
- **Subagent dispatch pattern** (`personas/ledger/src/content/9-synthesis.md` Step 8) — the target-conditional dispatch block follows the exact pattern used by the Synthesis persona for the Knowledge Archiver, and by standalone personas `plan-refiner` and `workspace-architect`.
- **CLI command registration** (`scripts/cli.js` → `COMMANDS` array) — the new `import-standalone` command follows the existing `{id, key, label, category, description, run}` pattern.
- **Single-stage WP** — imported projects use `active_pipeline_stages: ['implementation']` (a single stage) rather than the 4-stage default. This is a supported configuration — the `active_pipeline_stages` field exists precisely for this purpose — and honestly represents that only implementation occurred outside the ledger workflow.

## Detailed Steps

### Step 1: Add `'standalone'` runner value
1a. Extend the runner Zod enum in `mcp-server/src/schema/root-index.ts` from `['vscode', 'claude-code', 'orchestrator', 'unknown']` to `['vscode', 'claude-code', 'orchestrator', 'standalone', 'unknown']`.
1b. Mirror the change in `mcp-server/src/schema/project-meta.ts` (same enum).
1c. Update the `RunnerType` type alias in `mcp-server/src/utils/runner.ts`.
1d. Add `'standalone': 'Standalone'` to `RUNNER_LABELS` in `mcp-server/gui/public/views/project-list.js`.
1e. Add `'standalone'` to the `RUNNER_ORDER` array in the same file (before `'unknown'`).
1f. Add a `.badge-runner-standalone` CSS rule to `mcp-server/gui/public/styles.css` with the required CSS custom-property token pair (`--color-badge-runner-standalone-bg` / `--color-badge-runner-standalone-fg`) and a dark-mode override block, following the exact structure of the four existing runner badge rules (each has a root-level token definition and a `[data-theme=dark]` override). Choose a visually distinct colour from the existing four runner colours.
1g. In `mcp-server/src/storage/ledger-store.ts` at L524, update the hardcoded runner union cast: replace the inline string union `'vscode' | 'claude-code' | 'orchestrator' | 'unknown'` with `RunnerType` (importing from `../utils/runner.ts`), or extend it to include `| 'standalone'`. This prevents `runner: 'standalone'` from being narrowed to the stale four-value union in type-checked paths through `syncProjectMeta`. TypeScript will not raise a compile error without this fix — the narrowing is silent.

### Step 2: Add `## Outcome Summary` to standalone developer synthesis template
3a. In `personas/standalone/src/content/developer.md`, add `### Outcome Summary` between `### Completion Status` and `### Implementation Summary` in the synthesis template. Template: `{2-3 sentence summary of what was accomplished, the approach taken, and any notable results}`.
2b. Rebuild personas: `node scripts/build-personas.js` (runs a full three-suite rebuild; the `--suite` filter flag is documented but not implemented in the wrapper script).

### Step 3: Implement `ledger_import_standalone` MCP tool
3a. Create `mcp-server/src/tools/standalone-import.ts` with:
  - **Input schema (Zod):**
    - `project_path: z.string()` — absolute path to the plan folder (containing `plan.md` and `synthesis.md`)
    - `cwd_path: z.string().optional()` — workspace root for auto-detection (optional, follows existing pattern)
  - **Validation:**
    - Validate plan folder path matches `YYYY-MM-DD-{name}` pattern (import `validatePlanPath` from `../utils/path-validator.ts` — it is defined there, not exported from `project-lifecycle.ts`)
    - Verify `plan.md` exists at `project_path/plan.md`
    - Verify `synthesis.md` exists at `project_path/synthesis.md`
    - Reject if a ledger project already exists for this slug (via `store.rootIndexExists()`)
  - **Synthesis parsing:** Parse `synthesis.md` to extract:
    - `outcome_summary` — from `### Outcome Summary` section (fallback: first bullet of `### Implementation Summary`)
  - **Storage writes — delegated to `LedgerStore.importStandaloneProject(detail)`:** This new `LedgerStore` method (not tool code) acquires the write lock, calls `writeRootIndex()` and `writeWorkPackage()` internally, and auto-syncs `.meta.json`. This satisfies Constraint 2c, which prohibits tool code from calling `@internal` storage primitives directly. The `detail` parameter carries all computed fields:
    - `project-ledger.json`: `plan_file: 'plan.md'`, `status: 'COMPLETE'`, `total_work_packages: 1`, `pending_work_packages: 0`, `work_packages: [<WP-001 summary with passed_stages: 1>]`, `project_comments: []`, `synthesis_generated: true`, `synthesis_generated_at: now()`, `outcome_summary`, `runner: 'standalone'`, `ledger_version: SPEC_VERSION`, `server_version: SERVER_VERSION`
    - `WP-001.json`:
      ```json
      {
        "work_package_id": "WP-001",
        "work_package_file": "work/WP-001.md",
        "status": "COMPLETE",
        "assigned_to": "Developer",
        "dependencies": [],
        "acceptance_criteria": [
          { "criterion": "Plan implemented and verified", "met": true }
        ],
        "active_pipeline_stages": ["implementation"],
        "revision": 0,
        "pipelines": [{
          "type": "implementation",
          "status": "PASS",
          "started_at": "<date_created>",
          "completed_at": "<now>",
          "summary": ["Standalone implementation completed outside ledger workflow"],
          "comments": []
        }],
        "rework_counts": {},
        "handoff_notes": []
      }
      ```
    - `.meta.json` auto-synced by `writeRootIndex()` (internal to the `LedgerStore` method)
  - **Archive:** Call `store.archiveDocuments(['plan.md', 'synthesis.md'])` to copy files to storage
  - **Response:** Return summary: slug, outcome_summary, archived files, and the `project_storage_path` (so the caller can pass it to the Knowledge Archiver)

3b. Register the tool in `mcp-server/src/index.ts`: add an import for the new tool module and call `standaloneImportTools.register(server)`, following the same pattern as the existing tool modules (see lines 79–87). Also append `ledger_import_standalone` to the hardcoded tool name list in the `console.error('[project-ledger-mcp] Registered tools: …')` startup log call at L131–134 — an inline comment states this list must be kept in sync manually when tools are added or removed.

3c. Export the outcome summary parser as a separate function (`parseOutcomeSummary`) in a utility file `mcp-server/src/utils/synthesis-parser.ts` for testability. This parser only extracts the outcome summary text — insight extraction is handled by the Knowledge Archiver persona.

### Step 4: Create the `standalone-archiver` ledger-support personaStep 4 creates the standalone-archiver ledger-support persona.
5a. Create `personas/ledger-support/src/meta/standalone-archiver.yaml`:
```yaml
slug: standalone-archiver
name: "Standalone Archiver"
description: "Import a completed standalone plan into the project ledger for archival and insight extraction."
vs_file_name: standalone-archiver.agent.md
id: ledger-support-standalone-archiver
cc_file_name: standalone-archiver.md
da_file_name: standalone-archiver.md
changelog: |
  1.0.0 (2026-06-30): Initial release
tools: [vscode, read, search, agent, central_pm/ledger_import_standalone]
cc_tools: [Read, Grep, Task]
subagents: [ledger-knowledge-archiver]
```
> **Note on `cc_tools`:** The `mcp__central_pm__*` prefixed form is not used in any other ledger-support persona (see `ledger-doctor.yaml`, `ledger-knowledge-archiver.yaml`); MCP server tools are available through the registered server without being explicitly enumerated. `has_mcp` / `mcp_tools` fields are omitted — they exist only in ledger-suite YAML and are not consumed by ledger-support content templates.

5b. Create `personas/ledger-support/src/content/standalone-archiver.md` with a two-step workflow:
  - **Mission:** Accept a plan folder path, import it into the ledger, and extract insights.
  - **Step 1 — Import:** Call `ledger_import_standalone` with the provided `project_path`. If the tool returns "already exists", report gracefully and skip to completion. Capture the `project_storage_path` from the response.
  - **Step 2 — Extract insights:** Dispatch the `ledger-knowledge-archiver` subagent, passing the `cwd_path` (workspace root) and `project_storage_path` from Step 1. This reuses the same judgment-based insight extraction that ledger projects receive — the Knowledge Archiver reads the archived `synthesis.md`, triages code insights, deduplicates against existing knowledge, and writes qualifying entries to the repository-scoped knowledge store.
  - **Error handling:** If the Knowledge Archiver subagent fails, log the failure but report the import as successful — the project is already in the ledger. Insight extraction can be retried by running the Knowledge Archiver manually on the imported project.
  - Uses the standard target-conditional subagent dispatch pattern (VS Code `runSubagent` / Claude Code `Task` / Deep Agents `task`).

4c. Rebuild personas: `node scripts/build-personas.js` (full three-suite rebuild; `--suite` filter not implemented in wrapper).

### Step 5: Add subagent dispatch to standalone developer persona
5a. In `personas/standalone/src/meta/developer.yaml`:
  - Add `agent` to the `tools` list
  - Add `subagents: [standalone-archiver]`

5b. In `personas/standalone/src/content/developer.md`, add a new final workflow step before "Finish" (after writing synthesis):
  - **Step title:** "Archive to Ledger (Optional)"
  - **Content:** Target-conditional subagent dispatch block following the pattern from `personas/ledger/src/content/9-synthesis.md` Step 8:
    - VS Code: `runSubagent` with `agentName: "Standalone Archiver"`, passing the plan folder path
    - Claude Code: `Task` tool with the archiver agent
    - Deep Agents: `task` tool with `subagent_type` set to the archiver slug
  - **Failure handling:** Explicit note that if the subagent fails (MCP server unavailable, project already imported), the developer should continue normally — the import can be retried via CLI.

5c. Rebuild personas: `node scripts/build-personas.js` (full three-suite rebuild; `--suite` filter not implemented in wrapper).

### Step 6: Implement CLI `import-standalone` command
6a. Create `scripts/import-standalone.js` with:
  - **Single-plan mode:** `node scripts/cli.js import-standalone --path <plan-folder-path>`
    - Perform a dist-freshness check following the pattern of `scripts/run-orchestrator.js`: verify `mcp-server/dist/tools/standalone-import.js` exists and is up to date relative to the TypeScript source; if stale, emit a clear error directing the user to run `npm run build` in `mcp-server/`. Import the compiled module from `mcp-server/dist/` and call the handler function directly — no MCP protocol overhead and no schema duplication.
  - **Batch mode:** `node scripts/cli.js import-standalone --batch [--base-dir <path>]`
    - Scan `docs/agents/plans/` (or `--base-dir`) for folders containing `synthesis.md`
    - Cross-reference against existing ledger projects (via `LedgerStore.listAllProjects()`)
    - List untracked plans with confirmation prompt: `Found N untracked plans. Import all? [y/N]`
    - Import each confirmed plan sequentially
  - **Flags:** `--dry-run` to preview without writing

6b. In `scripts/cli.js`, define the delegation function (following the pattern of `cmdOrchestrator` and `cmdReadLog`):
```javascript
function cmdImportStandalone(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'import-standalone.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}
```

6c. Register the command in `scripts/cli.js` → `COMMANDS` array:
```javascript
{
  id: 'import-standalone',
  key: 'l',
  label: 'Import Standalone Plan',
  category: 'MCP Server',
  description: 'Import a completed standalone plan into the project ledger',
  helpVariants: [
    ['--path <dir>', 'Path to the standalone plan folder'],
    ['--batch', 'Scan for and import all untracked standalone plans'],
    ['--base-dir <dir>', 'Base directory to scan (default: docs/agents/plans/)'],
    ['--dry-run', 'Preview what would be imported without writing'],
  ],
  run: cmdImportStandalone,
}
```
> **Category note:** This command uses `category: 'MCP Server'` — the closest existing category for a ledger-backed operation. No existing command uses a `'Ledger'` category; introducing one would create a new menu section not acknowledged by existing consumers.

### Step 7: Update MCP tool registration and API surface documentation
7a. Ensure the new tool is registered in the MCP server's tool index so it appears in tool listings.
7b. Update `mcp-server/docs/agents/project-manifest/api-surface.md` with the new tool's schema and behavior documentation.

### Step 8: Verify GUI project detail page for imported projects
8a. Verify that the project detail page (`mcp-server/gui/public/views/project-detail.js`) renders correctly for a single-WP, single-stage imported project:
  - Plan content is linked and viewable via the plan link.
  - Synthesis content is linked and viewable via the synthesis link row (`#synthesis-link-row`).
  - WP-001 appears in the work package table with `COMPLETE` status badge and a single `implementation` pipeline track.
  - Timing info section renders without errors (duration, active time, pipeline run count).
  - No layout errors, NaN values, or missing data in any section.
8b. If any detail-page element renders incorrectly for single-WP/single-stage projects (e.g., pipeline track assumptions, empty arrays), add minimal defensive guards in the rendering helpers (`project-detail-helpers.js`).

## Dependencies

- Step 1 (runner enum) must complete before Step 3 (MCP tool uses `'standalone'` runner value)
- Step 2 (synthesis format) should complete before Step 3 (MCP tool parses `### Outcome Summary`)
- Step 3 (MCP tool) must complete before Steps 4, 6 (persona and CLI both depend on the tool)
- Step 4 (archiver persona) must complete before Step 5 (developer dispatches to it)
- Step 6 (CLI command) depends on Step 3 (imports the tool's logic)
- Step 7 (documentation) should run after Step 3
- Step 8 (GUI detail verification) should run after Step 3 (needs a real imported project to test against)

Parallelizable: Steps 1+2 can run concurrently. Steps 4+6 can run concurrently after Step 3.

## Required Components

### New Files
- `mcp-server/src/tools/standalone-import.ts` — MCP tool handler and schema
- `mcp-server/src/utils/synthesis-parser.ts` — Outcome summary parser (extracts outcome_summary from synthesis.md)
- `personas/ledger-support/src/meta/standalone-archiver.yaml` — Archiver persona metadata
- `personas/ledger-support/src/content/standalone-archiver.md` — Archiver persona content (two-step: import + Knowledge Archiver dispatch)
- `scripts/import-standalone.js` — CLI import command implementation
- `mcp-server/tests/tools/standalone-import.test.ts` — Tool unit tests
- `mcp-server/tests/utils/synthesis-parser.test.ts` — Parser unit tests

### Modified Files
- `mcp-server/src/schema/root-index.ts` — Add `'standalone'` to runner enum
- `mcp-server/src/schema/project-meta.ts` — Mirror runner enum change
- `mcp-server/src/utils/runner.ts` — Update `RunnerType` type alias
- `mcp-server/gui/public/views/project-list.js` — Add runner label, update runner order
- `mcp-server/gui/public/styles.css` — Add `.badge-runner-standalone` CSS rule with `--color-badge-runner-standalone-bg/-fg` token pair and dark-mode override
- `mcp-server/src/index.ts` — Register new tool (add import + `standaloneImportTools.register(server)` call)
- `mcp-server/src/storage/ledger-store.ts` — Add `importStandaloneProject()` method (acquires write lock, calls `@internal` writeRootIndex + writeWorkPackage, auto-syncs `.meta.json`); update L524 runner union cast to include `'standalone'` (or replace with `RunnerType`)
- `personas/standalone/src/meta/developer.yaml` — Add `agent` tool, add `subagents: [standalone-archiver]`
- `personas/standalone/src/content/developer.md` — Add Outcome Summary template section, add subagent dispatch step
- `scripts/cli.js` — Register `import-standalone` command
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Document new tool

## Assumptions

- The Knowledge Archiver can process imported projects in Mode A (live subagent). It calls `ledger_get_project_status` (which returns a single-WP COMPLETE project — valid under all existing lifecycle guards), reads `synthesis.md` from `project_storage_path`, and cross-references the single WP via `ledger_get_work_package`. Its "Synthesis Is the Primary Source" philosophy means it primarily uses the synthesis document, with WP data as supplementary evidence.
- The `LedgerStore` constructor will accept a plan path for a standalone plan folder — it derives `slug` from the path basename and `repoName` from the parent, both of which work for `docs/agents/plans/YYYY-MM-DD-name` paths.
- The `standalone-archiver` persona will be available as a subagent in all three targets (VS Code, Claude Code, Deep Agents) after building the ledger-support suite.

## Constraints

- **No MCP tools on the standalone developer.** The developer persona must remain MCP-independent. All ledger interaction goes through the subagent.
- **Single implementation-only WP.** Imported projects have exactly 1 WP with `active_pipeline_stages: ['implementation']`. This represents the standalone implementation as a single completed unit of work.
- **Duplicate import rejection.** If a ledger project already exists for the given slug, the import tool must reject with a clear error. No silent overwrites.
- **Cross-platform compatibility.** All file paths must use `path.join()`/`path.resolve()`. The CLI script must work on Windows, macOS, and Linux.
- **Atomic writes only.** All JSON file writes must use `atomicWriteJson()` per Constraint 1.

## Out of Scope

- **Retroactive WP creation from standalone plans.** Decomposing a standalone plan's steps into individual WPs is a larger effort with limited value for historical imports.
- **Changes to the Knowledge Archiver persona.** The archiver is dispatched as-is on a valid single-WP project. No modifications needed.
- **Standalone plan format enforcement.** The import tool will parse best-effort; malformed synthesis files produce fewer extracted fields rather than errors. The Knowledge Archiver handles insight extraction via LLM and adapts naturally to format variation.
- **Automatic archival scheduling.** Imported projects use `COMPLETE` status and follow the existing auto-archive timer.
- **Schema changes to `workflow-manifest.json`.** The runner enum is not manifest-governed; no manifest changes are needed.
- **Changes to the `ledger_complete_synthesis` guard.** The import tool bypasses this entirely by writing storage directly.

## Acceptance Criteria

1. A new `'standalone'` runner value is accepted by the `RootIndex` and `ProjectMeta` Zod schemas.
2. The GUI displays "Standalone" as the runner label for imported projects, with correct filter dropdown behavior.
3. `ledger_import_standalone` creates a valid `COMPLETE` project with a single completed WP from a standalone plan folder containing `plan.md` and `synthesis.md`.
4. The imported project's WP-001 has `status: 'COMPLETE'`, `active_pipeline_stages: ['implementation']`, and a single `implementation` pipeline at `PASS`.
5. `ledger_import_standalone` rejects folders missing `plan.md` or `synthesis.md` with a clear error.
6. `ledger_import_standalone` rejects duplicate imports (same slug already exists in ledger).
7. The `standalone-archiver` dispatches the Knowledge Archiver subagent after import, enabling judgment-based insight extraction from the standalone synthesis.
8. The `standalone-archiver` persona exists in the ledger-support suite and successfully calls the import tool, then dispatches the Knowledge Archiver.
9. The standalone developer persona dispatches the archiver subagent after writing `synthesis.md`.
10. If the archiver subagent fails, the standalone developer continues normally — no deliverables are lost.
11. The CLI `import-standalone` command imports a single plan in `--path` mode.
12. The CLI `import-standalone` command scans and batch-imports untracked plans in `--batch` mode.
13. All new code has unit test coverage.
14. The standalone developer synthesis template includes `### Outcome Summary`.
15. `computeHealedStatus` does not alter the imported project's `COMPLETE` status (totalWps=1 satisfies all healing rules).
16. The GUI project detail page renders correctly for imported projects — plan link, synthesis link, WP-001 row with status badge and pipeline track, and timing info are all visible without layout errors or missing data.

## Testing Strategy

Testing is split across three domains: MCP tool unit tests, synthesis parser unit tests, and CLI integration tests. All tests use Vitest and follow existing patterns in `mcp-server/tests/`.

The MCP tool tests use in-memory or temp-dir storage to avoid touching the real ledger. The synthesis parser tests use fixture files with known content. The CLI tests verify command-line argument parsing and output formatting.

GUI detail page rendering for single-WP imported projects is verified via the existing `client-rendering.test.ts` test infrastructure — that file loads `project-detail-helpers.js` and `work-package.js` via `vm.runInThisContext` and exercises `buildWpDetailBar` and `buildPipelineTrack` directly. A new test case feeds a single-WP, single-stage project fixture through those helpers and asserts that all key elements (plan link, synthesis link row, WP row, pipeline track, timing info) are present and free of NaN or empty-state errors. Runner label and filter dropdown changes are verified in `project-list.test.ts`.

## Test Plan

- `mcp-server/tests/utils/synthesis-parser.test.ts` — **Outcome summary parser unit tests**
  - Parses `### Outcome Summary` from well-formed synthesis — covers AC 4
  - Falls back to `### Implementation Summary` first bullet when no Outcome Summary — covers AC 4
  - Returns null for an empty file — covers AC 4
  - Returns null when neither section exists — covers AC 4

- `mcp-server/tests/tools/standalone-import.test.ts` — **Import tool unit tests**
  - Creates valid COMPLETE project from folder with plan.md + synthesis.md — covers AC 3
  - Creates WP-001.json with `status: 'COMPLETE'`, single implementation pipeline at PASS — covers AC 4
  - Sets `runner: 'standalone'`, `total_work_packages: 1`, `synthesis_generated: true` — covers AC 1, 3
  - Archives plan.md and synthesis.md to storage directory — covers AC 3
  - Returns `project_storage_path` in response for Knowledge Archiver dispatch — covers AC 7
  - `computeHealedStatus` does not alter the imported project (totalWps=1, pendingWps=0, synthesis=true) — covers AC 3
  - Rejects when plan.md is missing — covers AC 5
  - Rejects when synthesis.md is missing — covers AC 5
  - Rejects when project already exists (duplicate slug) — covers AC 6
  - Written project-ledger.json passes RootIndexSchema validation — covers AC 3
  - Written WP-001.json passes WorkPackageDetailSchema validation — covers AC 4
  - Written .meta.json passes ProjectMetaSchema validation — covers AC 3
  - Rejects invalid plan path (not YYYY-MM-DD-name pattern) — covers AC 5

- `mcp-server/tests/schema/project-meta-runner.test.ts` (existing) — **Runner enum validation**
  - Verify `'standalone'` is accepted by both `ProjectMetaSchema` and `RootIndexSchema` — covers AC 1
  > Follows the established pattern in this file where all runner values are tested across both schemas together.

- `mcp-server/tests/gui/project-list.test.ts` (existing) — **Runner label and filter dropdown display**
  - `runnerBadge('standalone')` output contains `badge-runner-standalone` and the label `'Standalone'` — covers AC 2
  - `buildRunnerOptions({standalone: 1})` output includes `<option>` with value `standalone` — covers AC 2

- `mcp-server/tests/gui/client-rendering.test.ts` (existing) — **Detail page rendering for single-WP projects**
  - Renders WP-001 row with COMPLETE badge and single implementation pipeline track for a standalone-imported project fixture — covers AC 16
  - Renders synthesis link row as visible when `synthesis_generated: true` — covers AC 16
  - Renders timing info without NaN or missing values for a single-pipeline project — covers AC 16

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `ledger_import_standalone` tool documentation (schema, behavior, response shape)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `LedgerStore.importStandaloneProject(detail)` to the Storage API section — document signature, parameter shape (`StandaloneImportDetail`), lock behaviour, and return type (required by AGENTS.md manifest maintenance rule: "Modify public method signature → `api-surface.md`")
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `src/tools/standalone-import.ts`, `src/utils/synthesis-parser.ts`, and test files
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — Add `standalone` row to the runner badge token table (`--color-badge-runner-standalone-bg/-fg`, CSS class `.badge-runner-standalone`)
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Add standalone import data flow (plan folder → MCP tool → storage; then Knowledge Archiver → knowledge store)
- `personas/docs/agents/project-manifest/constraints.md` — No changes needed (no new constraints introduced)
- Root `AGENTS.md` — Add `standalone-archiver` to cross-system dependencies table (standalone developer → standalone-archiver → MCP tool + Knowledge Archiver subagent chain)
- Root `AGENTS.md` — Add `scripts/import-standalone.js` to root-level tooling table
- Root `AGENTS.md` — Update Project Statistics table if new tool count changes
- `personas/docs/agents/project-manifest/data-flows.md` — Document the new `standalone-archiver` two-step flow (import tool call → Knowledge Archiver subagent dispatch)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`computeHealedStatus` alters imported project** | Eliminated by the single-WP strategy. With `totalWps: 1`, `pendingWps: 0`, and `synthesis_generated: true`, all healing rules are satisfied — no status regression occurs. A dedicated test case confirms this. |
| **Standalone developer synthesis format drifts** | The outcome summary parser falls back gracefully — missing sections produce `null` outcome_summary. The import still succeeds with degraded metadata. Insight extraction is LLM-driven via the Knowledge Archiver and adapts to format changes naturally. |
| **MCP server unavailable when subagent dispatches** | The subagent fails but the developer's deliverables (code + synthesis.md) are unaffected. The import can be retried via CLI `import-standalone --path`. |
| **`LedgerStore` repo-name derivation for standalone plan paths** | The store derives `slug` from `path.basename(planPath)` and `repoName` by walking 4 ancestor levels up from the plan folder. For standard project paths (`{workspace-root}/docs/agents/plans/{slug}`), this correctly yields `repoName` equal to the workspace root directory name (e.g., `'ai-insights'`) — the expected and correct namespace. The tool should verify `repoName` derivation during integration testing. |
| **Progress display for imported projects** | With `total_work_packages: 1` and `pending_work_packages: 0`, progress computes to 100% — no NaN risk. No GUI guards needed. |
| **Batch import of historical plans creates unexpected ledger noise** | The `--dry-run` flag allows previewing before committing. The CLI requires explicit confirmation (`[y/N]`). |
| **Knowledge Archiver on single-WP imported projects** | The archiver receives a valid project with `.meta.json`, `project-ledger.json`, `WP-001.json`, and `synthesis.md` — all the files it expects. The single WP provides minimal but valid cross-referencing material. The archiver's "Synthesis Is the Primary Source" philosophy means it primarily extracts from `synthesis.md` regardless of WP count. |
| **GUI detail page rendering for single-WP/single-stage projects** | The detail page renders WP rows, pipeline tracks, and timing info dynamically. A project with only 1 WP and 1 pipeline stage may expose assumptions (e.g., multi-stage progress bars, empty pipeline arrays). Step 8 explicitly verifies this and adds minimal guards if needed. Test coverage in `project-detail-helpers.test.ts` confirms rendering correctness. |
