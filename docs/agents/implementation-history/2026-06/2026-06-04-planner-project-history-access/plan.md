# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: 4 — Plan Architect Reviewer v1.6.0

## Summary

Give the Planner agent (step 1 in the pipeline) access to prior project history within the same repository — enabling it to learn from previous plans, avoid repeated mistakes, and produce context-informed plans. This is achieved via a new `ledger_get_repository_context` MCP tool that returns a compact project timeline with curated outcome summaries, relevant knowledge-base insights, and an optional user-authored strategic vision. The Synthesis agent is extended to author a concise `outcome_summary` at project completion, and a GUI panel allows users to maintain a three-horizon strategic vision per repository.

## Architectural Context

**Ledger storage layout:** Projects are stored at `{ledgerRoot}/{repoName}/{slug}/`, each containing `project-ledger.json` (root index), `.meta.json` (lightweight cache), `plan.md`, and optionally `synthesis.md`.

**Existing tools pattern:** MCP tools are implemented as handler functions + Zod input schemas in `mcp-server/src/tools/*.ts`, registered via a `register(server)` export. The `ledger_list_projects` tool in `mcp-server/src/tools/project-lifecycle.ts` uses `LedgerStore.listAllProjects()` to scan `.meta.json` files.

**Knowledge store:** `mcp-server/src/storage/knowledge-store.ts` manages `.knowledge/` at the ledger root. `mcp-server/src/tools/knowledge.ts` exposes `ledger_add_insight` and `ledger_search_insights`.

**Planner persona:** Currently `has_mcp: false` in `personas/ledger/src/meta/1-planner.yaml`. Uses tools: vscode, execute, read, edit, search, web, agent, todo. Content template at `personas/ledger/src/content/1-planner.md`.

**Synthesis persona:** `has_mcp: true`, calls `ledger_complete_synthesis` (in `mcp-server/src/tools/project-lifecycle.ts`) which sets `synthesis_generated: true` and transitions project to `COMPLETE`.

**GUI:** `mcp-server/gui/server.ts` serves a SPA from `mcp-server/gui/public/`. API handlers live in `mcp-server/gui/api.ts` and `mcp-server/gui/api-knowledge.ts`. Views in `mcp-server/gui/public/views/`.

**Schemas:** `mcp-server/src/schema/project-meta.ts` defines `ProjectMetaSchema` (slug, plan_path, status, dates, optional enrichment fields). `mcp-server/src/schema/root-index.ts` defines `RootIndexSchema`.

## Approach / Architecture

The implementation has six work streams:

1. **Schema extension** — Add `outcome_summary` field to `ProjectMetaSchema` and `RootIndexSchema`.
2. **Synthesis tool extension** — Extend `ledger_complete_synthesis` to accept and persist `outcome_summary`.
3. **New MCP tool** — `ledger_get_repository_context` in a new `mcp-server/src/tools/repository-context.ts`, returning project timeline + insights + strategic vision.
4. **Repository registry + Strategy GUI** — Central `.repositories.json` at the ledger root declaring opt-in repository metadata (label, folder name aliases, strategic vision). GUI "Strategy" screen for managing repositories and their vision.
5. **Persona updates** — Enable MCP on the Planner, add workflow steps, update Synthesis persona instructions.
6. **Integration wiring** — Help content documentation and workflow manifest updates.

The new tool is a pure metadata reader — it reads `.meta.json` files (already cached) and the repository registry. No synthesis file parsing at query time. The Synthesis agent authors the `outcome_summary` at completion (write path), keeping the read path lightweight.

### Repository Registry Design

A centralized `{ledgerRoot}/.repositories.json` file serves as the opt-in registry of declared repositories:

```json
{
  "repositories": [
    {
      "id": "ai-insights",
      "label": "AI Insights",
      "folder_names": ["ai-insights", "ai-insights-dev"],
      "vision": {
        "short_term": "Markdown string or null",
        "mid_term": "Markdown string or null",
        "long_term": "Markdown string or null"
      },
      "created_at": "2026-06-04T14:30:00Z",
      "last_modified": "2026-06-04T14:30:00Z"
    }
  ]
}
```

**Key invariants:**
- `id` is a stable slug identifier (validated by `SLUG_REGEX`), used as the primary key.
- `label` is a human-readable display name shown in the GUI wherever a repository is referenced.
- `folder_names` is an array of folder name aliases (auto-detected `repository_name` values) that map to this declared repository. A folder name may only appear in one repository entry (unique constraint).
- `vision` contains the three-horizon strategic vision fields (all nullable).
- **Nothing changes for project detection:** `deriveRepoName()` still produces a folder name from the path. The registry is consulted for enrichment (label, vision) — not for storage layout. Projects remain stored at `{ledgerRoot}/{folderName}/{slug}/`.
- **Cross-folder aggregation:** When a declared repository has multiple folder names (e.g., `["repo-dev", "repo-prod"]`), projects stored under any of those folder names are treated as belonging to the same logical repository. This solves the parallel-clone problem where the same codebase was cloned under different directory names, producing separate storage namespaces in the ledger. The `ledger_get_repository_context` tool aggregates projects across all declared folder names; the GUI project list groups them under the same label; the knowledge store can be queried for any of the folder names and return results for the logical repository.
- **Undeclared repositories continue to work:** If a project's detected folder name matches no registry entry, the system behaves exactly as before (raw folder name displayed, no vision available, no cross-folder aggregation).
- **Registry is exclusively user-authored** — never written by agents. Managed via the GUI Strategy screen.

## Rationale

- **Server-side shaping** keeps token usage predictable regardless of project count; the Planner receives a bounded response.
- **Outcome summary as curated metadata** (rather than parsing `synthesis.md`) ensures the summary is deliberately authored by the Synthesis agent with the correct level of abstraction.
- **Three-horizon strategic vision** provides forward-looking context that no automated system can generate — it must be user-authored.
- **Central repository registry** allows human-readable labels and folder-name aliasing without changing the storage layout or detection mechanism. Opt-in: undeclared repos work as before.
- **Cross-folder aggregation** solves the parallel-clone problem: projects stored under different folder names (e.g., `repo-dev` and `repo-prod`) that represent the same codebase are unified under one logical repository when declared. The Planner sees the full project history regardless of which clone created each project.
- **Separation from knowledge store** — project chronology (temporal, identity-bearing) is distinct from reusable insights (atemporal, generalizable). They serve different planning questions.
- **Minimal Planner persona change** — adding 2 MCP tools is the smallest change that gives the Planner full historical + strategic context.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| History access mechanism | New MCP tool (`ledger_get_repository_context`) | Sub-agent delegation (Planner sends Explore agent to read files); Knowledge store expansion (add `"planning-context"` category) | Sub-agent is token-inefficient and non-deterministic; knowledge store conflates temporal project data with atemporal principles |
| Outcome summary source | Curated by Synthesis agent at completion time | Parse `synthesis.md` at query time; Auto-extract first paragraph | Runtime parsing adds I/O cost to every read; auto-extraction produces variable quality |
| Strategic vision format | JSON with 3 Markdown string fields | Single Markdown file with heading delimiters; YAML | JSON is GUI-friendly (field-level read/write); Markdown requires parsing; YAML adds no benefit over JSON here |
| Repository metadata storage | Centralized `{ledgerRoot}/.repositories.json` | Per-repo `.repository.json` files; Database | Central file is simpler to manage (single read for all repos), user-authored (no concurrency pressure), and easy to backup/edit; per-repo files add I/O for listing; DB is overkill |
| Repository declaration model | Opt-in registry with folder-name aliasing | Auto-declare from detected folder names; Replace folder-name detection | Opt-in preserves backward compat (undeclared repos keep working); auto-declare creates entries users may not want; replacing detection would be a breaking change |
| Registry manager shape | Plain-function module (`loadRegistry`, `saveRegistry`, `findByFolderName`) | Class (`RepositoryRegistryManager`); Inline read/write in each handler | Registry has no in-memory state, caching, or lifecycle — a class adds instantiation boilerplate for zero benefit. Function module matches existing `atomicWriteJson` / `withLock` helpers pattern. Inline would duplicate file-path resolution. |
| Strategy list data source (V1) | Declared-only (pure registry read) | Merged declared + undeclared (filesystem scan to discover all namespace dirs) | Declared-only avoids duplicating the directory-walking logic in `listAllProjects()` and keeps the handler trivial. Users know their folder names — a form input suffices. Filesystem discovery is a valid UX enhancement for a follow-up. |

## Pattern Alignment

- **Tool registration:** Follows the `register(server)` pattern in `mcp-server/src/tools/project-lifecycle.ts` — Zod schema, handler function, exported register function.
- **Schema evolution:** Adds optional fields to existing schemas (backward-compatible), same pattern as `runner`, `runner_client`, `runner_version` additions.
- **GUI API domain split:** Follows the domain-split pattern established by `mcp-server/gui/api-knowledge.ts` — each API domain gets its own handler file (`api-repos.ts`), imported from `server.ts`. Pure async functions returning result objects.
- **Ledger-root dot-files for system data:** `.repositories.json` follows the same convention as `.knowledge/` — a dot-prefixed path at the ledger root for system-level data excluded from project enumeration.
- **`.meta.json` enrichment:** Same pattern as `total_work_packages`, `progress_pct` cached fields.
- **Persona YAML:** Follows existing structure in `personas/ledger/src/meta/9-synthesis.yaml` for `mcp_tools` arrays and `has_mcp` flag.
- **Plain-function storage module:** `repository-registry.ts` uses exported functions rather than a class, matching the `atomicWriteJson` / `withLock` helpers pattern already in `src/storage/`. The registry has no in-memory state across calls, no caching semantics, and no lifecycle — a class would add instantiation boilerplate without benefit.

## Detailed Steps

### Stream 1: Schema Extension

1. Add `outcome_summary: z.string().nullable().optional()` to `ProjectMetaSchema` in `mcp-server/src/schema/project-meta.ts`.
2. Add `outcome_summary: z.string().nullable().optional()` to `RootIndexSchema` in `mcp-server/src/schema/root-index.ts`.
3. Add `outcome_summary` to the `MetaCacheUpdates` interface in `mcp-server/src/storage/ledger-store.ts`.
4. Ensure `writeProjectMeta()` in `LedgerStore` propagates `outcome_summary` to `.meta.json`.

### Stream 2: Synthesis Tool Extension

5. Add `outcome_summary` parameter to `CompleteSynthesisSchema` in `mcp-server/src/tools/project-lifecycle.ts` — required string, 2–3 sentences, describing what was accomplished and the approach taken. Use `.describe('A 2–3 sentence summary of what was accomplished, the approach taken, and any notable results or limitations. Required for all new project completions.')` so that Zod validation errors produce a human-readable hint (matching the existing `.describe()` pattern on other fields in this schema) rather than a bare "Required" message.
6. Inside `completeSynthesis()`, persist `outcome_summary` to the root index before writing.
7. Ensure `writeRootIndex()` propagates `outcome_summary` into the `.meta.json` enrichment cache (via `MetaCacheUpdates`).

### Stream 3: New MCP Tool — `ledger_get_repository_context`

8. Add a targeted static method `LedgerStore.listProjectsByFolderNames(folderNames: string[], ledgerRoot?: string): Promise<ProjectMeta[]>` that reads only the specified namespace directories rather than scanning the entire ledger root. For each folder name, it reads `{ledgerRoot}/{folderName}/` and iterates its subdirectories for `.meta.json` files — same depth-2 logic as `listAllProjects()` but scoped to the declared folders. This is O(declared folders × projects-per-folder) instead of O(all repos × all projects). Falls back gracefully (empty array for non-existent directories).
9. Create `mcp-server/src/tools/repository-context.ts` with:
   - Input schema: `{ cwd_path?: string, repository_name?: string, include_insights?: boolean (default: true), max_projects?: number (default: 5) }`
   - Handler: derives `repository_name` (via `deriveRepoName(cwd_path)` or explicit param), then consults the repository registry to find the declared repository whose `folder_names` contains the derived name.
   - **If a registry match is found:** collects projects from ALL `folder_names` in the matched entry (cross-folder aggregation). Calls `LedgerStore.listProjectsByFolderNames(entry.folder_names)` for targeted reads (avoids full ledger scan). Sorts by `date_created` descending, caps at `max_projects`. Returns the entry's `label` and `vision`.
   - **If no registry match:** calls `LedgerStore.listProjectsByFolderNames([derivedName])` to read only the single namespace directory. Returns `null` for label and vision.
   - Optionally queries `KnowledgeStoreManager` for repository-scoped insights (queries all `folder_names` if declared, single name if not).
   - Returns structured response: `{ repository_name, repository_id, repository_label, total_projects, strategic_vision, projects[], relevant_insights[] }`.
10. Create a Zod schema for `.repositories.json` in `mcp-server/src/schema/repository-registry.ts`:
   ```typescript
   StrategicVisionSchema = z.object({
     short_term: z.string().nullable(),
     mid_term: z.string().nullable(),
     long_term: z.string().nullable(),
   });

   RepositoryEntrySchema = z.object({
     id: z.string().regex(SLUG_REGEX),
     label: z.string(),
     folder_names: z.array(z.string()),
     vision: StrategicVisionSchema,
     created_at: z.string(),
     last_modified: z.string(),
   });

   RepositoryRegistrySchema = z.object({
     repositories: z.array(RepositoryEntrySchema),
   });
   ```
11. Create a plain-function module `mcp-server/src/storage/repository-registry.ts` (no class — the registry has no in-memory state or lifecycle, matching the `atomicWriteJson` / `withLock` helpers pattern in `src/storage/`):
    - `loadRegistry(ledgerRoot): Promise<RepositoryRegistry>` — resolves `{ledgerRoot}/.repositories.json`, reads and parses (returns `{ repositories: [] }` if absent or unparseable).
    - `saveRegistry(ledgerRoot, registry): Promise<void>` — atomic write with file locking.
    - `findByFolderName(registry, folderName): RepositoryEntry | null` — pure lookup helper; returns the entry whose `folder_names` array includes the given name.
    - `getAllFolderNames(entry): string[]` — convenience accessor returning all folder names for a declared repository.
    - Both `api-repos.ts` and `repository-context.ts` call these functions directly with `resolveLedgerRoot()` — no constructor, no `this` references.
12. Register the tool in `repository-context.ts` via a `register(server)` export.
13. Wire the new `register` call into the tool registration entry point (wherever tools are assembled — likely `mcp-server/src/index.ts` or a tool registry file).

### Stream 4: Repository Registry + Strategy GUI

14. Create `mcp-server/gui/api-repos.ts` with repository CRUD handlers using the plain-function registry module (follows domain-split pattern from `api-knowledge.ts`):
    - `handleListRepos` — `GET /api/repos`: Loads the repository registry via `loadRegistry(ledgerRoot)`. Returns **only declared repositories** from the registry file: `Array<{ id: string, name: string, label: string, folder_names: string[], has_vision: boolean }>`. The "Add Repository" form in the GUI asks for folder name(s) directly — the user already knows their clone directory names. *(Undeclared-repo discovery via filesystem scan is deferred to a follow-up — avoids duplicating the directory-walking logic already in `listAllProjects()` and keeps the handler a pure registry read.)*
    - `handleGetRepo` — `GET /api/repos/:repoId`: Returns the full repository entry (including vision fields) from the registry. If `:repoId` is not in the registry, returns 404.
    - `handleCreateRepo` — `POST /api/repos`: Creates a new repository declaration. Body: `{ id, label, folder_names, vision? }`. Validates `id` against `SLUG_REGEX`, ensures `id` is unique, ensures no `folder_names` conflict with other entries. Sets `created_at` and `last_modified` to current timestamp. Writes updated registry via `saveRegistry(ledgerRoot, registry)`.
    - `handleUpdateRepo` — `PUT /api/repos/:repoId`: Updates an existing repository declaration (label, folder_names, vision fields). Validates body; sets `last_modified` to current timestamp. Enforces unique constraint on `folder_names` across all entries.
    - `handleDeleteRepo` — `DELETE /api/repos/:repoId`: Removes a repository declaration from the registry. Does NOT delete projects or storage — only the metadata declaration.
15. Add route handling in `mcp-server/gui/server.ts` for the new endpoints — imports from both `api.ts` and `api-repos.ts`.
16. Add API client methods in `mcp-server/gui/public/api-client.js`: `listRepos()`, `getRepo(repoId)`, `createRepo(data)`, `updateRepo(repoId, data)`, `deleteRepo(repoId)`.
17. Add two new routes to the SPA router in `mcp-server/gui/public/router.js`:
    - `#/strategy` → renders the Strategy repository list.
    - `#/strategy/:repoId` → renders the Strategy detail/editor for a specific repository.
18. Create `mcp-server/gui/public/views/strategy.js` with two view functions:
    - **`renderStrategyList(app)`** — the "Strategy" landing page:
      - Calls `API.listRepos()` to fetch all declared repositories.
      - Renders a table showing: label, folder names, vision status (icon/badge).
      - Declared repositories link to `#/strategy/{repoId}`.
      - "Add Repository" button to declare a new repository (form accepts id, label, folder names).
    - **`renderStrategyDetail(app, repoId)`** — the repository detail/editor:
      - Calls `API.getRepo(repoId)` to load current data.
      - **Metadata section:** Editable `label` field, editable `folder_names` list (add/remove aliases).
      - **Vision section:** Three labeled `<textarea>` fields (Short-term, Mid-term, Long-term) with Markdown preview toggle.
      - Save button calls `PUT /api/repos/:repoId`.
      - Displays `last_modified` timestamp.
      - Breadcrumb: Strategy → {label}.
19. Add a "Strategy" link to the top-level navigation in `mcp-server/gui/public/index.html` (alongside Projects, Insights, Knowledge, etc.).
20. Update the project list view (`mcp-server/gui/public/views/project-list.js`) to resolve folder names to declared repository labels:
    - On load, fetch the repository registry (or cache from `API.listRepos()`).
    - In the "Repository" column, display the declared label (if matched) instead of the raw folder name. Projects from different folder names that belong to the same declared repository show the same label.
    - Optionally link the label to `#/strategy/{repoId}`.

### Stream 5: Persona Updates

21. Update `personas/ledger/src/meta/1-planner.yaml`:
    - Set `has_mcp: true`.
    - Add `mcp_tools` array with `ledger_get_repository_context` and `ledger_search_insights`.
    - Add `central_pm/*` to the `tools` array.
22. Update `personas/ledger/src/content/1-planner.md`:
    - Add a workflow step between steps 2 and 3: "**Gather project history.** Call `ledger_get_repository_context` with `cwd_path` to retrieve the repository's project timeline, relevant insights, and strategic vision. Use prior project outcomes to inform your approach. If the tool returns an error or empty result (e.g., fresh workspace with no ledger history, MCP server unreachable), proceed without historical context — this step is informational, not blocking."
    - Add an optional plan template section "## Prior Project Context" for the Planner to summarize how history influenced the current plan.
23. Update `personas/ledger/src/meta/9-synthesis.yaml`:
    - Add guidance about the `outcome_summary` parameter in the `ledger_complete_synthesis` tool entry.
24. Update `personas/ledger/src/content/9-synthesis.md` (or relevant partial):
    - Add an instruction step before calling `ledger_complete_synthesis`: "Write a 2–3 sentence outcome summary capturing what was accomplished, the approach taken, and any notable results or limitations. Pass this as `outcome_summary`."
25. Run `node scripts/build-personas.js` to regenerate all persona output files.

### Stream 6: Integration Wiring

26. Update `mcp-server/src/tools/help-content.ts` with documentation for the new `ledger_get_repository_context` tool.
27. Add the tool name to the `shared/workflow-manifest.json` if tool names are tracked there (verify first).

## Dependencies

- Stream 2 depends on Stream 1 (schema fields must exist before the tool persists them).
- Stream 3 depends on Stream 1 (reads `outcome_summary` from metadata). Within Stream 3, step 9 (tool handler) depends on steps 8 (targeted query method), 10–11 (registry schema + manager) being implemented first.
- Stream 4 (GUI) depends on Stream 3 steps 10–11 (registry schema and manager).
- Stream 5 depends on Stream 2 and Stream 3 being implemented (tools must exist before persona references them).

## Required Components

### New Files
- `mcp-server/src/tools/repository-context.ts` — new MCP tool implementation
- `mcp-server/src/schema/repository-registry.ts` — Zod schemas for `.repositories.json` (RepositoryEntrySchema, RepositoryRegistrySchema, StrategicVisionSchema)
- `mcp-server/src/storage/repository-registry.ts` — Plain-function registry module (loadRegistry, saveRegistry, findByFolderName)
- `mcp-server/gui/api-repos.ts` — GUI API handlers for repository CRUD (domain-split pattern)
- `mcp-server/gui/public/views/strategy.js` — GUI Strategy screen (repository list + detail/editor)
- `mcp-server/tests/tools/repository-context.test.ts` — unit tests for new tool
- `mcp-server/tests/schema/repository-registry.test.ts` — schema validation tests
- `mcp-server/tests/storage/repository-registry.test.ts` — registry manager tests
- `mcp-server/tests/gui/api-repos.test.ts` — GUI API endpoint tests

### Modified Files
- `mcp-server/src/schema/project-meta.ts` — add `outcome_summary` field
- `mcp-server/src/schema/root-index.ts` — add `outcome_summary` field
- `mcp-server/src/storage/ledger-store.ts` — add `outcome_summary` to `MetaCacheUpdates`, propagate in `writeProjectMeta()`; add `listProjectsByFolderNames()` static method for targeted directory reads
- `mcp-server/src/tools/project-lifecycle.ts` — extend `CompleteSynthesisSchema` and `completeSynthesis()`
- `mcp-server/src/tools/help-content.ts` — add help entry for new tool
- `mcp-server/gui/server.ts` — add route matching for `/api/repos`, `/api/repos/:repoId`; import from `api-repos.ts`
- `mcp-server/gui/public/api-client.js` — add `listRepos()`, `getRepo()`, `createRepo()`, `updateRepo()`, `deleteRepo()`
- `mcp-server/gui/public/router.js` — add `#/strategy` and `#/strategy/:repoId` routes
- `mcp-server/gui/public/index.html` — add "Strategy" nav link
- `mcp-server/gui/public/views/project-list.js` — resolve folder names to declared repository labels
- `personas/ledger/src/meta/1-planner.yaml` — enable MCP, add tools
- `personas/ledger/src/content/1-planner.md` — add project history workflow step
- `personas/ledger/src/meta/9-synthesis.yaml` — add outcome_summary guidance
- `personas/ledger/src/content/9-synthesis.md` — add outcome_summary instruction

## Assumptions

- The Planner's VS Code agent mode already has access to the `central_pm` MCP server (adding `central_pm/*` to tools enables it).
- `deriveRepoName()` in `mcp-server/src/utils/ledger-root.ts` works with `cwd_path` input (confirmed — used by `LedgerStore` constructor and `detectProjectByCwd`).
- `KnowledgeStoreManager` can be instantiated with just the ledger root and queried for repository-scoped insights (confirmed from `mcp-server/src/tools/knowledge.ts`).
- The GUI SPA router can accommodate a new route for the vision editor (confirmed — uses a client-side router in `mcp-server/gui/public/router.js`).
- Projects completed before this feature will have `outcome_summary: null` — the tool gracefully handles this.

## Constraints

- **Token budget:** The tool response must be bounded. `max_projects` defaults to 5; each project entry is ~100 tokens (slug, title, status, date, WP count, outcome_summary). Strategic vision is capped at ~1500 words total across fields (soft guidance in GUI).
- **Cross-platform:** All file I/O uses `path.join()`; no OS-specific assumptions. The `.repositories.json` path uses the same ledger root resolution as all other storage.
- **Backward compatibility:** All new schema fields are `optional()` — existing projects and `.meta.json` files remain valid without migration. Undeclared repositories continue to work exactly as before.
- **Synthesis `outcome_summary` is required going forward:** New completions must provide it. This is a non-breaking change (old code never called with this param; schema evolves forward).
- **No auto-backfill:** Existing completed projects will have `outcome_summary: null`. A manual backfill script is out of scope for v1.
- **Registry is user-authored only:** No agent or automated process writes to `.repositories.json`. Concurrency is limited to the GUI (single user).
- **Folder name uniqueness:** A folder name may only appear in one repository entry. The API validates this constraint on create/update.

## Out of Scope

- Keyword/semantic filtering of projects in the history tool (future enhancement).
- Giving the Project Manager access to this tool (follow-up work).
- Backfill migration for existing completed projects' `outcome_summary`.
- Strategic vision staleness warnings in the Planner persona (simple follow-up).
- Rich Markdown editor in GUI (textarea + preview is sufficient for v1).
- CLI command for initializing repositories (`init-repo` — trivial follow-up).
- Length enforcement on strategic vision fields (soft guidance only for v1).
- Additional repository metadata fields beyond label, folder_names, and vision (extensible later).
- Renaming or merging repositories in the registry (v2 feature).
- Automatic repository declaration suggestions based on detected folder names (possible UX enhancement).
- Undeclared-repo discovery scan in `handleListRepos` — filesystem scan to auto-discover undeclared repositories and merge them into the Strategy list. Deferred to follow-up to avoid duplicating directory-walking logic from `listAllProjects()`.

## Acceptance Criteria

1. `ledger_get_repository_context` returns a structured response with `repository_name`, `repository_id` (from registry or null), `repository_label` (from registry or null), `total_projects`, `strategic_vision` (from registry or null), `projects[]` (sorted by date descending, capped at `max_projects`), and `relevant_insights[]` when `include_insights: true`.
2. When a declared repository has multiple `folder_names`, `ledger_get_repository_context` aggregates projects from ALL matching folder names into a single response (cross-folder aggregation).
3. `ledger_complete_synthesis` accepts `outcome_summary` string and persists it to root index and `.meta.json`.
4. Projects completed after this change have `outcome_summary` populated; older projects return `null`.
5. `{ledgerRoot}/.repositories.json` stores declared repository metadata (id, label, folder_names, vision). Full CRUD via GUI API endpoints (`GET/POST /api/repos`, `GET/PUT/DELETE /api/repos/:repoId`).
6. GUI has a top-level "Strategy" screen (`#/strategy`) showing declared repositories from the registry; clicking a repository navigates to `#/strategy/:repoId` with metadata editing (label, folder names) and a three-field vision editor (short-term, mid-term, long-term). A form allows declaring new repositories by providing id, label, and folder names.
7. GUI project list resolves detected folder names to declared repository labels where a match exists. Projects from different folder names under the same declared repository display the same label.
8. Folder names are unique across all repository entries (enforced by the API).
9. Planner persona has `has_mcp: true` and lists `ledger_get_repository_context` + `ledger_search_insights` in `mcp_tools`.
10. Planner persona content includes the project-history workflow step.
11. Synthesis persona content instructs the agent to author `outcome_summary` at completion.
12. All new code has unit test coverage.
13. All changes work on Windows, macOS, and Linux.

## Testing Strategy

Unit tests cover each component in isolation:
- Schema validation (new fields, backward compat with missing fields, registry schema)
- Repository registry manager (load, save, lookup by folder name, uniqueness enforcement)
- Repository context tool (various scenarios: empty repo, populated, no registry, registry with match, partial data)
- GUI API endpoints (repository CRUD, validation, folder name conflicts)
- Synthesis tool extension (outcome_summary persistence, propagation to meta cache)

Integration testing via the existing Vitest setup in `mcp-server/tests/`.

## Test Plan

- `mcp-server/tests/schema/repository-registry.test.ts` — Validates `RepositoryRegistrySchema`, `RepositoryEntrySchema`, `StrategicVisionSchema` accept valid JSON, reject invalid, handle nullable vision fields — covers AC #5
- `mcp-server/tests/storage/repository-registry.test.ts` — Tests: `loadRegistry()` returns empty array when file absent; `loadRegistry()` parses valid file; `saveRegistry()` writes atomically; `findByFolderName()` matches correctly across multiple folder names in an entry; `findByFolderName()` returns null on no match; `getAllFolderNames()` returns complete list — covers AC #5, #8
- `mcp-server/tests/tools/repository-context.test.ts` — Tests: empty repository returns empty projects array; repository with N projects returns sorted, capped list; `outcome_summary` present and null cases; `include_insights: false` omits insights; no registry file returns `null` for label/vision; registry match returns label and vision; `max_projects` cap is respected; **cross-folder aggregation: declared repo with folder_names ["a", "b"] aggregates projects from both storage paths into one response**; uses targeted `listProjectsByFolderNames` (does not scan unrelated directories) — covers AC #1, #2, #4
- `mcp-server/tests/storage/ledger-store.test.ts` (extend existing) — Tests: `listProjectsByFolderNames(["a"])` reads only the `a/` namespace directory; `listProjectsByFolderNames(["a", "b"])` reads both; non-existent folder name returns empty array gracefully — covers AC #2
- `mcp-server/tests/tools/project-lifecycle.test.ts` (extend existing) — Tests: `completeSynthesis` with `outcome_summary` persists to root index; `outcome_summary` propagates to `.meta.json`; `outcome_summary` is required (validation error if missing) — covers AC #3
- `mcp-server/tests/gui/api-repos.test.ts` — Tests: `GET /api/repos` returns declared repositories from registry; `POST /api/repos` creates entry with validation; `PUT /api/repos/:repoId` updates entry; rejects duplicate folder names; `DELETE /api/repos/:repoId` removes entry; `GET /api/repos/:repoId` returns full entry or 404 — covers AC #5, #6, #8
- `mcp-server/tests/schema/project-meta.test.ts` (extend existing) — Tests: schema accepts objects with and without `outcome_summary` — covers AC #4 backward compat

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `ledger_get_repository_context` tool signature; update `ledger_complete_synthesis` signature with `outcome_summary` param; document repository registry module public functions (`loadRegistry`, `saveRegistry`, `findByFolderName`)
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `src/tools/repository-context.ts`, `src/schema/repository-registry.ts`, `src/storage/repository-registry.ts`, `gui/api-repos.ts`
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Add write-path (Synthesis → outcome_summary → meta) and read-path (Planner → repository-context → response); document registry data flow (GUI → API → `.repositories.json` → MCP tool)
- `personas/docs/agents/project-manifest/constraints.md` — Note that Planner now has MCP access
- `AGENTS.md` (root) — Update Cross-System Dependencies table: add `outcome_summary` flow (Synthesis → `.meta.json` → `ledger_get_repository_context`); add repository registry dependency (`.repositories.json` → GUI + MCP tool + project-list label resolution)
- `mcp-server/src/tools/help-content.ts` — Add help documentation for `ledger_get_repository_context`

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Planner context bloat from large project histories** | `max_projects` cap (default 5) bounds response size; `outcome_summary` is deliberately concise (2–3 sentences) |
| **Breaking existing Synthesis flow by requiring `outcome_summary`** | Make the parameter required only at the schema level; existing tests are updated; rollout is forward-only (no backfill) |
| **Strategic vision never filled in by users** | Tool returns `null` gracefully; Planner operates without it; feature provides value even without vision (project history alone is useful) |
| **Registry file corruption or invalid JSON** | `loadRegistry()` returns empty registry on parse failure (logged); atomic writes via `saveRegistry()` using `atomicWriteJson` prevent partial writes |
| **Folder name conflict across repositories** | API enforces unique constraint on `folder_names` across all entries; returns 400 with clear error message on conflict |
| **Cross-platform path issues with `.repositories.json`** | All paths constructed via `path.join()` from the existing `ledgerRoot` resolution; same mechanism as all other ledger files |
| **GUI CORS/security concerns with the new endpoints** | Follows existing security header pattern in `server.ts`; `assertSafeSegment()` prevents path traversal in repo IDs; same-origin policy via port-bound CORS headers |
| **`outcome_summary` quality varies across Synthesis runs** | Persona instructions provide clear template ("2–3 sentences: what was accomplished, approach, notable results"); quality improves over time as the instruction is refined |
| **Planner MCP tool failure in fresh workspaces** | Persona instructions include graceful degradation: "If the tool returns an error or empty result, proceed without historical context." This prevents looping or stalling when no ledger exists yet or the MCP server is unreachable. |
