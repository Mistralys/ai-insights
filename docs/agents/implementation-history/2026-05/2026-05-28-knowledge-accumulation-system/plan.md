# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.3.1
- Architectural Reviews: 1 — Plan Architect Reviewer v1.4.0

## Summary

Implement a **Knowledge Accumulation System** that enables the Synthesis agent to commit reusable insights ("gold nuggets") to persistent storage — either project-scoped or global — and allows all workflow agents to query this knowledge via dedicated MCP tools. The system introduces a new storage layer alongside the existing per-project ledgers, a set of 4 new MCP tools (`ledger_add_insight`, `ledger_search_insights`, `ledger_list_insights`, `ledger_update_insight`), an enhanced Synthesis persona role, and a one-time migration script that extracts insights from 250+ existing synthesis documents. A GUI Knowledge page is planned as a deferred follow-up (Phase 6) and does not gate initial delivery.

## Architectural Context

**Existing storage layout:**
- `mcp-server/storage/ledger/` — centralized ledger root
  - `gui-config.json` — runtime GUI config (flat file at root, skipped by `listAllProjects`)
  - `.gitkeep` — ensures directory is tracked
  - `{slug}/` — per-project directories containing `project-ledger.json`, WP detail files, `.meta.json`
  - Directories starting with `.` are excluded from project enumeration (`listAllProjects` in `mcp-server/src/storage/ledger-store.ts` line 692)

**Existing insights mechanism:**
- `project_comments[]` in `project-ledger.json` — typed comments (`incident`, `note`, `decision`) with priority, agent, timestamp
- GUI Insights page (`mcp-server/gui/public/views/insights.js`) aggregates all project comments across projects with type/priority/project filters
- `history/key-learnings.md` — informal personal notes file (unstructured, not referenced by any persona or tooling; not a system component)

**Existing Synthesis persona** (`personas/ledger/src/meta/9-synthesis.yaml`):
- Tools: `ledger_get_project_status`, `ledger_list_work_packages`, `ledger_get_work_package`, `ledger_add_project_comment`, `ledger_complete_synthesis`, `ledger_get_handoff_status`, `ledger_get_next_action`

**Key patterns:**
- All storage uses `atomicWriteJson()` for crash safety
- Read-modify-write sequences use `withLock(store.storageDir, ...)` for concurrency
- Zod schemas validate all data on read/write
- Tools registered via `server.registerTool()` in `mcp-server/src/tools/*.ts`
- `resolveLedgerRoot()` in `mcp-server/src/utils/ledger-root.ts` returns the canonical ledger storage path

## Approach / Architecture

### Storage Design

Introduce a dedicated `.knowledge/` directory at the ledger root (dot-prefix ensures it's excluded from project enumeration, consistent with `.archive/` convention):

```
storage/ledger/
├── .knowledge/                    # Knowledge accumulation store (NEW)
│   ├── .lock                      # Lock file for concurrent-write protection
│   ├── global-insights.json       # Global insights (cross-project)
│   └── {slug}-insights.json       # Per-project insights (one file per project)
├── gui-config.json
├── {slug}/                        # Existing per-project ledgers (unchanged)
└── ...
```

**Why a separate directory rather than embedding in project-ledger.json:**
1. Global insights have no project owner — they need a home outside any `{slug}/`
2. Keeps the knowledge store independent of project lifecycle (insights survive project archival)
3. Avoids bloating the root index that every tool call reads
4. Enables a single lock scope for all knowledge operations (no per-project lock contention)

### Insight Schema

```typescript
interface Insight {
  id: string;                        // Auto-generated: "KN-{NNNN}" (e.g., "KN-0001")
  scope: 'project' | 'global';
  project_slug?: string;             // Required when scope === 'project'
  title: string;                     // Short, searchable (1 sentence)
  content: string;                   // Detailed explanation (Markdown)
  category: string;                  // e.g., "coding-principle", "pattern", "pitfall", "architecture", "testing", "tooling", "workflow"
  tags: string[];                    // Freeform tags for discoverability
  source: {
    agent: string;                   // Agent that committed the insight
    project_slug?: string;           // Project where the insight was discovered
    work_package_id?: string;        // WP where it was discovered (optional)
    synthesis_file?: string;         // Source synthesis file (for migration)
  };
  created_at: string;                // ISO 8601
  updated_at?: string;               // ISO 8601 (set on updates)
  confidence: 'low' | 'medium' | 'high';  // How validated is this insight
  superseded_by?: string;            // ID of a newer insight that replaces this one
}

interface KnowledgeStore {
  version: string;                   // Schema version (e.g., "1.0.0")
  last_updated: string;              // ISO 8601
  next_id: number;                   // Counter for auto-generating IDs
  insights: Insight[];
}
```

**Note on forward-looking fields:** `confidence` and `superseded_by` are included for future extensibility. No current consumer enforces or acts on them programmatically. The Synthesis persona instructions will include a brief heuristic for setting confidence: **high** = validated across multiple projects with clear evidence; **medium** = observed in one project with strong evidence; **low** = inferred or speculative. The `superseded_by` field enables logical archival once insight curation workflows are established.

### MCP Tools vs. GUI Operations — Scope Boundary

**MCP tools** are operations that agents invoke via the MCP protocol during workflow execution. **GUI operations** are REST endpoints backed by `KnowledgeStoreManager` that serve the browser-based GUI for human users. This plan defines exactly **4 MCP tools**; all other CRUD operations (delete, promote, move) are GUI-only REST endpoints deferred to the GUI phase.

### MCP Tools (4 new)

| Tool | Purpose | Primary Users |
|------|---------|---------------|
| `ledger_add_insight` | Commit a new insight to project or global store | Synthesis (primary), any agent |
| `ledger_search_insights` | Full-text search + tag/category filter | All agents (especially Planner, Developer) |
| `ledger_list_insights` | List insights with scope/tag/category filters | All agents |
| `ledger_update_insight` | Update or supersede an existing insight | Synthesis |

### Synthesis Persona Enhancement

The Synthesis agent gains a second responsibility phase: after generating the synthesis document and before calling `ledger_complete_synthesis`, it identifies and commits reusable insights from the project's pipeline history.

### Migration Script

A Node.js script (`scripts/migrate-synthesis-insights.js`) that:
1. Scans all project storage directories for `synthesis.md` files
2. Sends each synthesis through a structured extraction prompt (or pattern-based extraction)
3. Commits extracted insights via the same storage layer the MCP tools use

## Rationale

- **Separation from project_comments:** Project comments serve operational purposes (system warnings, pipeline audit trails, incident reports). Knowledge insights are curated, tagged, and meant for long-term retrieval. Mixing them dilutes both signals.
- **Dot-prefix directory:** Consistent with existing `.archive/` convention; automatically excluded from project scanning without code changes.
- **Per-project insight files:** Keeps project-scoped insights close to their origin while allowing global insights to live independently. File-per-project avoids a single monolithic JSON that grows unbounded.
- **Single lock scope:** All knowledge operations lock `.knowledge/` rather than contending with per-project locks, eliminating deadlock risk between knowledge writes and project ledger writes. This is a deliberate simplification with a known scaling ceiling: concurrent writes to different project insight files serialize unnecessarily. Per-file locking is achievable later if orchestrator parallelization requires it.
- **ID format `KN-NNNN`:** Follows the existing `WP-###` convention; numeric counter provides stable, human-readable references.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Storage location | Dedicated `.knowledge/` directory at ledger root | (A) Embed in `project_comments` with a new type; (B) Separate SQLite database; (C) Markdown files in `history/` | (A) pollutes operational data, no global scope, hard to search; (B) adds a dependency, breaks the JSON-only convention; (C) unstructured, no schema, no MCP tool integration |
| File structure | One global file + one file per project | (A) Single monolithic `insights.json`; (B) One file per insight | (A) unbounded growth, lock contention; (B) thousands of tiny files, directory listing overhead |
| ID scheme | Sequential `KN-NNNN` with counter in store file | (A) UUIDs; (B) Content-hash IDs | Sequential IDs are human-readable and follow the `WP-###` precedent; UUIDs are harder to reference in conversations; content-hashes break on content edits |
| Migration approach | LLM-assisted batch extraction via skill | (A) Manual curation; (B) Pattern-based regex | 250+ documents is too many for manual; regex misses nuanced insights; LLM extraction captures semantic content and can distinguish project-specific vs. universal principles |
| Search mechanism | In-memory filter + substring match on load | (A) SQLite FTS5; (B) Embedding-based vector search | JSON filter is zero-dependency, consistent with existing codebase; FTS5/vector search adds complexity for a store that will likely stay under 10K entries |
| Migration invocation | Batch script processing all projects | (A) Single-project manual invocation per-project | Considered but retained batch approach: 250+ projects makes per-project manual invocation impractical; `--project <slug>` flag still supports single-project runs when needed |
| GUI phase timing | Deferred to follow-up (Phase 6) | (A) Include GUI CRUD in initial delivery | Core agent-facing value (accumulate + query) is delivered by Phases 1–4; GUI is ~15 files of orthogonal scope that does not gate the primary use case |

## Pattern Alignment

- **Atomic file writes:** Follows `atomicWriteJson()` pattern established in `mcp-server/src/storage/atomic-writer.ts`
- **File locking:** Follows `withLock()` pattern from `mcp-server/src/storage/file-lock.ts`
- **Zod schema validation:** Follows all existing schemas in `mcp-server/src/schema/`
- **Tool registration:** Follows `registerTool()` pattern in `mcp-server/src/tools/*.ts`
- **Ledger root resolution:** Follows `resolveLedgerRoot()` from `mcp-server/src/utils/ledger-root.ts`
- **Tool file organization:** New tools go in a dedicated file `mcp-server/src/tools/knowledge.ts`, following the single-responsibility pattern of `observations.ts`, `pipeline.ts`, etc.
- **Persona YAML metadata:** New tools added to `personas/ledger/src/meta/9-synthesis.yaml` → `mcp_tools` array
- **Workflow manifest:** No changes needed (knowledge tools are utility tools, not pipeline-bound)

## Detailed Steps

### Phase 1: Storage Layer

1. **Create Zod schemas** for `Insight` and `KnowledgeStore` in a new file `mcp-server/src/schema/knowledge.ts`
2. **Create `KnowledgeStoreManager`** class in `mcp-server/src/storage/knowledge-store.ts`:
   - Constructor takes `ledgerRoot`
   - `knowledgeDir()` → `join(ledgerRoot, '.knowledge')`
   - `globalStorePath()` → `join(knowledgeDir, 'global-insights.json')`
   - `projectStorePath(slug)` → `join(knowledgeDir, '{slug}-insights.json')`
   - `readGlobalStore()` / `readProjectStore(slug)` — read + validate, create empty if absent
   - `writeGlobalStore(data)` / `writeProjectStore(slug, data)` — atomic write under lock
   - `addInsight(insight)` — determine scope, read appropriate store, append, write
   - `searchInsights(query)` — load all stores, filter/match, return results
   - `listInsights(filters)` — load stores matching scope, apply filters
   - `updateInsight(id, updates)` — find insight by ID across stores, apply updates
   - `deleteInsight(id)` — find insight by ID across stores, remove, write
   - `nextId(store)` — increment counter and return formatted `KN-NNNN`
   - Lock scope: `withLock(knowledgeDir, ...)` for all writes

### Phase 2: MCP Tools

3. **Create `mcp-server/src/tools/knowledge.ts`** with 4 tool implementations:
   - `ledger_add_insight` — accepts scope, title, content, category, tags, confidence, optional source fields; Synthesis + any agent
   - `ledger_search_insights` — accepts `query` (substring match against title + content + tags), optional `scope`, `category`, `tags`, `project_slug`, `limit` filters
   - `ledger_list_insights` — accepts optional `scope`, `category`, `tags[]`, `project_slug`, `limit`, `offset` for pagination
   - `ledger_update_insight` — accepts `id`, optional `title`, `content`, `category`, `tags`, `confidence`, `superseded_by`, `scope`, `project_slug`; restricted to Synthesis + PM
4. **Register tools** in `mcp-server/src/index.ts` (import and call registration function)
   - **Update the startup log message** in `index.ts` (line ~109) to include the 4 new knowledge tool names in the printed tool list (maintenance note at lines 72–74 requires this).
5. **Add help content** for all 4 tools in `mcp-server/src/tools/help-content.ts`

### Phase 3: Synthesis Persona Enhancement

6. **Update `personas/ledger/src/meta/9-synthesis.yaml`** — add new tools to `mcp_tools` array:
   - `ledger_add_insight` — "Commit reusable insights discovered during synthesis to project or global knowledge store."
   - `ledger_search_insights` — "Search existing knowledge for related insights before committing new ones (avoid duplicates)."
7. **Create a new partial** `personas/shared/partials/synthesis-knowledge-collection.md` and add a `{{> synthesis-knowledge-collection}}` reference in `personas/ledger/src/content/9-synthesis.md` after the existing `{{> synthesis-operational-protocol}}` reference. The partial defines the "Knowledge Collection" phase of the workflow:
   - After completing the main synthesis document but before calling `ledger_complete_synthesis`
   - Identify gold nuggets from pipeline history: patterns that worked, pitfalls discovered, coding principles validated
   - For each nugget: determine scope (project vs. global), assign category and tags, assess confidence using the heuristic: **high** = validated across multiple projects; **medium** = observed in one project with clear evidence; **low** = inferred or speculative
   - Search existing insights to avoid duplicates (`ledger_search_insights`)
   - Commit new insights (`ledger_add_insight`)

### Phase 4: Agent Access (Read-Side Persona Updates)

> **Note:** The Planner persona (`1-planner.yaml`) is excluded from this phase. It currently has `has_mcp: false` and lacks the full MCP infrastructure (`central_pm/*` in `tools`, MCP preflight/intro partials). Enabling MCP for the Planner is a structural change to its generated output and is deferred to a separate "Planner MCP Enablement" plan.

8. **Update Developer persona** (`personas/ledger/src/meta/3-developer.yaml`) — add `ledger_search_insights`:
   - "Search knowledge store for coding principles and patterns relevant to the current implementation."
9. **Update QA, Security Auditor, Reviewer personas** — add `ledger_search_insights`:
    - "Search knowledge for prior findings and recurring patterns before starting verification."

### Phase 5: Migration (LLM-Assisted Batch Extraction)

10. **Create a migration batch skill** that processes the synthesis archive via LLM extraction:
    - **Entry point:** `scripts/migrate-synthesis-insights.js` — Node.js CJS script that orchestrates the batch
    - **Process per synthesis:**
      1. Reads `storage/ledger/{slug}/synthesis.md`
      2. Feeds the document to the LLM with a structured extraction prompt requesting: title, content, scope (project/global), category, tags, confidence assessment
      3. LLM returns a JSON array of candidate insights
      4. Script validates each candidate against the `Insight` Zod schema
      5. Runs deduplication check against already-committed insights (title similarity)
      6. Commits validated insights via `KnowledgeStoreManager`
    - **Extraction prompt template** embedded in the script — instructs the LLM to:
      - Identify reusable principles, patterns, pitfalls, and architectural decisions
      - Distinguish project-specific findings from universally applicable principles
      - Assign appropriate categories (`coding-principle`, `pattern`, `pitfall`, `architecture`, `testing`, `tooling`, `workflow`)
      - Skip status summaries, metrics, and project-specific timeline information
    - **Batch controls:** `--dry-run` (preview extracted insights as JSON without writing), `--project <slug>` (single project), `--verbose`, `--limit <N>` (process first N projects), `--resume` (skip projects already in the knowledge store)
    - **Invocation:** Can be run as a standalone CLI script or invoked as a skill from an agent session (the user triggers it; the agent processes the batch)
    - **Error handling:** Per-project failures are logged and skipped; the batch continues; a summary report is printed at completion (insights extracted, duplicates skipped, errors, projects processed/skipped)
    - **Source traceability:** Every migrated insight gets `source.synthesis_file` set to the relative path of the originating synthesis document

### Phase 6 (Deferred) — GUI Knowledge Page

> **Deferred to a follow-up plan.** The core agent-facing value (accumulate + query knowledge) is delivered by Phases 1–5. The GUI Knowledge page is ~15 files of orthogonal scope and does not gate initial delivery. The existing Insights page (`views/insights.js`, `/api/insights`) remains **untouched** — the Knowledge page is added as a sibling nav entry, not a replacement.

When implemented, this phase will:

11. **Add a Knowledge page** alongside the existing Insights page:
    - **Add a nav entry:** Add "Knowledge" as a new link in `mcp-server/gui/public/index.html` (the existing "Insights" link and page remain unchanged)
    - **New API endpoints:**
      - `GET /api/knowledge` — list all insights; supports query params: `scope`, `category`, `tags`, `project_slug`, `query` (text search), `limit`, `offset`
      - `PATCH /api/knowledge/:id` — edit an insight (title, content, category, tags, confidence)
      - `DELETE /api/knowledge/:id` — delete an insight permanently
      - `POST /api/knowledge/:id/promote` — promote a project-scoped insight to global (composed from `deleteInsight()` + `addInsight()` at the REST handler level)
      - `POST /api/knowledge/:id/move` — move an insight into a specific project (body: `{ project_slug }`) — composed from `deleteInsight()` + `addInsight()` at the REST handler level
    - **Create `views/knowledge.js`:**
      - Card-based display with title, content preview, scope badge (global/project), category pill, tag chips
      - Filter bar: scope (all/global/project), category dropdown, tag multi-select, project dropdown, free-text search
      - Inline edit: click a card to expand into an editable form (title, content as textarea, category, tags, confidence)
      - Action buttons per card: Edit, Delete (with confirmation modal), Promote to Global (only on project-scoped), Move to Project (opens project picker)
      - Pagination controls (limit/offset)
    - **Update `api-client.js`:** Add `getKnowledge(params)`, `updateInsight(id, data)`, `deleteInsight(id)`, `promoteInsight(id)`, `moveInsight(id, projectSlug)`
    - **Update `router.js`:** Add `/knowledge` route to render `renderKnowledge`
    - **Update `mcp-server/gui/api.ts`:** Add knowledge CRUD handlers backed by `KnowledgeStoreManager`
    - **Update `mcp-server/gui/server.ts`:** Add knowledge route mappings
    - **Update `styles.css`:** Add `.knowledge-filters` and card action button styles
    - **Note:** `promoteInsight()` and `moveInsight()` are convenience operations composed from the existing `deleteInsight()` + `addInsight()` primitives at the REST handler level — they are not needed in the `KnowledgeStoreManager` core.

### Phase 7: Documentation & Manifest Updates

12. Update documentation and manifests (see Documentation Updates section below)

## Dependencies

- Phase 2 depends on Phase 1 (tools need storage layer)
- Phase 3 depends on Phase 2 (persona needs tools registered)
- Phase 4 depends on Phase 2 (agents need read tools)
- Phase 5 depends on Phase 1 (migration needs storage layer)
- Phases 3–5 are parallelizable after Phase 2
- Phase 6 (deferred) depends on Phase 1 (GUI needs storage layer) — does not gate initial delivery

## Required Components

### New Files
- `mcp-server/src/schema/knowledge.ts` — Zod schemas for Insight, KnowledgeStore
- `mcp-server/src/storage/knowledge-store.ts` — KnowledgeStoreManager class
- `mcp-server/src/tools/knowledge.ts` — 4 MCP tool implementations + registration function
- `personas/shared/partials/synthesis-knowledge-collection.md` — Knowledge Collection workflow phase partial for Synthesis persona
- `scripts/migrate-synthesis-insights.js` — Migration script

### Modified Files
- `mcp-server/src/index.ts` — import and register knowledge tools; update startup log tool list
- `mcp-server/src/tools/help-content.ts` — add help entries for 4 new tools
- `personas/ledger/src/meta/9-synthesis.yaml` — add knowledge tools
- `personas/ledger/src/meta/3-developer.yaml` — add `ledger_search_insights`
- `personas/ledger/src/meta/4-qa.yaml` — add `ledger_search_insights`
- `personas/ledger/src/meta/5-security-auditor.yaml` — add `ledger_search_insights`
- `personas/ledger/src/meta/6-reviewer.yaml` — add `ledger_search_insights`
- `personas/ledger/src/content/9-synthesis.md` — add `{{> synthesis-knowledge-collection}}` partial reference

### Deferred Files (Phase 6 — GUI)
- `mcp-server/gui/public/views/knowledge.js` — GUI knowledge page (new, alongside existing `views/insights.js`)
- `mcp-server/gui/public/index.html` — add Knowledge nav link (existing Insights link unchanged)
- `mcp-server/gui/public/router.js` — add knowledge route
- `mcp-server/gui/public/api-client.js` — add knowledge CRUD methods
- `mcp-server/gui/api.ts` — add knowledge CRUD handlers
- `mcp-server/gui/server.ts` — add knowledge route mappings
- `mcp-server/gui/public/styles.css` — add knowledge page styles

## Assumptions

- The 250+ synthesis documents follow a reasonably consistent structure with identifiable sections (findings, recommendations, lessons learned)
- The knowledge store will remain under ~10K entries total, making JSON-file-per-project + in-memory filtering performant
- Insight deduplication is best-effort (title similarity check); exact duplicate prevention is more important than fuzzy matching
- The Synthesis agent can distinguish project-specific insights from cross-project principles based on content analysis
- The migration script does not need to be perfectly accurate — it produces a first pass that can be refined over time
- The migration requires an LLM API key (same key used by the orchestrator) and will consume tokens proportional to the total size of the synthesis archive
- The `confidence` and `superseded_by` schema fields are forward-looking: no current consumer enforces them programmatically; initial usage relies on the Synthesis persona's confidence heuristic (documented in persona content) and manual supersession via `ledger_update_insight`

## Constraints

- Must follow zero-new-dependency constraint (no SQLite, no vector DB — pure JSON + fs)
- Must use `atomicWriteJson()` for all writes (Constraint 1)
- Must use `withLock()` for all read-modify-write sequences (Constraint 2)
- Knowledge store lock is separate from per-project locks (no deadlock risk)
- Storage directory naming must use dot-prefix to avoid project enumeration (line 692 of `ledger-store.ts`)
- MCP tool naming must follow `ledger_` prefix convention
- Cross-platform: all path operations via `path.join()` / `path.resolve()`

## Out of Scope

- GUI Knowledge page (deferred to Phase 6 follow-up — does not gate initial delivery)
- Replacing or modifying the existing Insights page (`views/insights.js`, `/api/insights` — remains unchanged)
- Embedding-based semantic search (future enhancement if needed at scale)
- Automatic insight quality scoring / validation
- Insight voting or rating mechanism
- Real-time insight suggestions during agent work (agents must actively query)
- Insight versioning history (only current state + `superseded_by` pointer)
- Integration with external knowledge bases
- Automatic insight extraction during pipeline execution (only Synthesis does this post-hoc)
- Changes to `shared/workflow-manifest.json` (knowledge tools are utility tools, not workflow-bound)
- Planner MCP enablement — the Planner persona currently has `has_mcp: false` and lacks MCP infrastructure; enabling it requires setting `has_mcp: true`, `has_detect_project: true`, adding `central_pm/*` to `tools`, and adding MCP preflight/intro partial references. This is a structural change to the Planner's generated output and warrants its own focused "Planner MCP Enablement" plan.

## Acceptance Criteria

1. `ledger_add_insight` successfully creates insights in both project-scoped and global stores with correct schema validation
2. `ledger_search_insights` returns relevant results for text queries across both stores, with optional scope/tag/category filtering
3. `ledger_list_insights` returns paginated results with working filters
4. `ledger_update_insight` modifies existing insights and supports `superseded_by` linking
5. All 4 MCP tools appear in the MCP server's tool registry and respond to `ledger_help` queries
6. The Synthesis persona includes the Knowledge Collection workflow phase with instructions for insight identification, scoping, confidence heuristic, and commitment
7. Read-side personas (Developer, QA, Security Auditor, Reviewer) have `ledger_search_insights` listed in their tool sets (Planner excluded — see Out of Scope)
8. The migration script successfully processes synthesis documents and populates the knowledge store
9. All writes are atomic and concurrency-safe (lock + atomic write)
10. The `.knowledge/` directory is not enumerated as a project by `listAllProjects`
11. The existing Insights page (`/api/insights`, `views/insights.js`) remains fully functional and unchanged

### Deferred Acceptance Criteria (Phase 6 — GUI)

These criteria apply to the deferred GUI Knowledge page and are not part of the initial delivery:

- D1. The GUI Knowledge page displays insights with working filters (scope, category, tags, project, text search)
- D2. GUI supports inline editing of insights (title, content, category, tags, confidence)
- D3. GUI supports deleting insights with confirmation
- D4. GUI supports promoting a project-scoped insight to global scope
- D5. GUI supports moving an insight into a specific project
- D6. The Knowledge page coexists with the existing Insights page as a separate nav entry

## Testing Strategy

Unit tests for the storage layer (schema validation, CRUD operations, search/filter logic). Integration tests for MCP tools (end-to-end tool invocation via the server). The migration script includes a `--dry-run` mode for safe testing. GUI functionality is manually verified (consistent with existing GUI test approach).

## Test Plan

- `mcp-server/tests/schema/knowledge.test.ts` — Validates Insight and KnowledgeStore Zod schemas (valid/invalid data, edge cases) — Covers AC #1
- `mcp-server/tests/storage/knowledge-store.test.ts` — Tests KnowledgeStoreManager: create/read/write stores, ID generation, concurrent access, empty-store initialization, delete — Covers AC #1, #9
- `mcp-server/tests/tools/knowledge.test.ts` — Integration tests for all 4 MCP tools: add insight (project + global), search with various filters, list with pagination, update and supersede — Covers AC #1, #2, #3, #4, #5
- `mcp-server/tests/tools/knowledge-help.test.ts` — Verifies help content is registered for all 4 tools — Covers AC #5
- `mcp-server/tests/storage/knowledge-store-exclusion.test.ts` — Verifies `.knowledge/` is not enumerated by `listAllProjects` — Covers AC #10
- `mcp-server/tests/tools/schema-integrity.test.ts` — The existing schema-integrity test validates that all registered tools have matching schema entries. The new 4 knowledge tools will be automatically validated once registered; if the test uses a hardcoded tool list, it must be updated to include the 4 knowledge tools. — Covers AC #5

### Deferred Tests (Phase 6 — GUI)

- `mcp-server/tests/gui/knowledge-api.test.ts` — Tests GUI REST endpoints: list with filters, edit, delete, promote, move — Covers Deferred AC D1–D5

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add 4 new MCP tool signatures (ledger_add_insight, ledger_search_insights, ledger_list_insights, ledger_update_insight)
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add new files: `src/schema/knowledge.ts`, `src/storage/knowledge-store.ts`, `src/tools/knowledge.ts`
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Add Flow for knowledge accumulation (Synthesis → add insight → search dedup → commit)
- `mcp-server/docs/agents/project-manifest/constraints.md` — Add constraint for `.knowledge/` directory isolation and lock scope
- `AGENTS.md` (root) — Add knowledge tools to Cross-System Dependencies table; update Project Statistics (tool count)
- `personas/docs/agents/project-manifest/api-surface.md` — Document the new Synthesis knowledge collection phase
- `mcp-server/changelog.md` — New entry for knowledge accumulation system
- `personas/changelog.md` — New entry for Synthesis persona enhancement + read-side tool additions
- Root `README.md` — Add migration script to tooling table if appropriate

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Migration quality:** LLM extraction from synthesis docs may occasionally misclassify scope or produce overlapping insights | `--dry-run` mode for preview; `confidence: 'low'` default for migrated insights; `--limit` for incremental runs; manual curation pass after migration; `superseded_by` allows cleanup without deletion |
| **Migration cost:** 250+ documents × LLM API calls = non-trivial token spend | `--limit` and `--resume` flags allow incremental processing; `--dry-run` validates prompt effectiveness on a small sample before committing to full batch |
| **Store file growth:** Global insights file grows unbounded over time | Per-project files limit blast radius; pagination on read tools; `superseded_by` allows logical archival without deletion |
| **Search performance at scale:** In-memory substring matching on 10K+ insights may be slow | Current ceiling is manageable (~250 projects × ~5 insights = 1250); defer to indexed search if profiling shows issues |
| **Duplicate insights:** Different Synthesis runs may commit overlapping insights | `ledger_search_insights` step before commit (dedup prompt in persona); title similarity check in storage layer |
| **Lock contention:** Knowledge writes block knowledge reads | Lock scope is narrow (single JSON file write); reads without mutation don't need locks; distinct from per-project locks |
| **Persona bloat:** Adding tools to 6+ personas increases token overhead per agent session | Tools are deferred-loaded in VS Code; help text is concise; only Synthesis gets write tools |
