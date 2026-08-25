# MCP Server - Manifest (File Tree)
<INSTRUCTION>
# MCP Server - Manifest: File Tree
Annotated directory listing of every source file with its role and relationships. Use to locate files before reading them.

</INSTRUCTION>
------------------------------------------------------------
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── project-manifest/
                └── file-tree.md

```
###  Path: `/mcp-server/docs/agents/project-manifest/file-tree.md`

```md
# File Tree

```
mcp-server/
├── .gitignore                   # Gitignore (excludes storage/ledger/ runtime data)
├── .npmrc                       # npm configuration
├── package.json                 # Project metadata and dependencies
├── tsconfig.json                # TypeScript compiler configuration
├── vitest.config.ts             # Vitest test framework configuration
│
├── storage/                     # Runtime-generated data (gitignored except .gitkeep)
│   └── ledger/
│       ├── .gitkeep             # Ensures directory is tracked in version control
│       ├── .repositories.json   # Central repository registry — managed by src/storage/repository-registry.ts; absent on first run (loadRegistry returns { repositories: [] }); populated by api-repos.ts (WP-006) when users create repository entries
│       ├── gui-config.json      # Runtime-generated GUI config (auto_handoff_enabled, max_handoff_depth, ledger_root) — created on first GUI or MCP server start
│       ├── .migration-state.json  # Written after migration completes; contains { storage_version: 2 }; absent on first run
│       ├── .migration-in-progress # Transient sentinel file written before any dir moves; removed on success (enables crash recovery)
│       ├── ai-insights/         # Example repo-namespace dir — derived from project-root dirname via deriveRepoName()
│       │   └── 2026-05-01-my-plan/  # Per-project subfolder — runtime-generated
│       │       ├── .meta.json       # Project metadata (slug, status, timestamps)
│       │       ├── .lock            # Lock file for concurrent-write protection
│       │       ├── project-ledger.json  # Root index
│       │       ├── WP-001.json      # Work package detail files
│       │       ├── plan.md          # Archived copy of the project plan (created by ledger_initialize_project; read by GET /api/projects/:slug/plan) — optional; absent when source was missing at init time
│       │       └── synthesis.md     # Archived copy of the synthesis report (created by ledger_complete_synthesis; optional, absent until synthesis runs and synthesis.md exists in the plan folder)
│       ├── other-repo/          # Second repo-namespace dir (another repository on the same machine)
│       │   └── {slug}/              # Each repo manages its own slug namespace independently
│       │       └── …
│       ├── unknown/             # Fallback namespace — used when repo-root name fails slug validation
│       └── .knowledge/          # Knowledge store — lives at {ledgerRoot}/.knowledge/; excluded from project enumeration (dot-prefix filter)
│           ├── .lock                              # Lock file for all knowledge write operations
│           ├── global-insights.json               # Insights with scope: 'global' (cross-repository knowledge)
│           └── {repo-name}-insights.json          # Insights scoped to a specific repository (scope: 'repository')
│
├── scripts/                     # Node.js utility scripts (run directly with `node`)
│   ├── sync-version.js          # Syncs version from changelog.md → package.json
│   ├── move-unknown-project.js  # Moves a project from the unknown/ namespace to its correct repo namespace; updates .meta.json; use when repository_name was not set at init time
│   └── rename-repository.js     # Renames a repository namespace across all ledger storage; moves all project folders and updates each .meta.json to reflect the new repo name; use when a repository's root directory has been renamed (--from, --to, --ledger-dir, --dry-run flags)
│
├── gui/                         # GUI server process code
│   ├── api.ts               # REST API route handlers; runner_counts: Record-string-number; handleListProjects normalizes runner to unknown, supports sorting by runner; in multi-store mode (WP-011) handleListProjects delegates to getMultiStoreManager().listAllProjects() returning TaggedProjectMeta[] with store_path; getStorePath(meta) closure returns meta.store_path in multi-store or ledgerRoot in legacy for per-store LedgerStore construction; includes handleListChunks, handleGetChunkFile, handleGetChunkText (chunk endpoints — handleGetChunkText serves GET /api/projects/:repo/:slug/chunks/:filename/text, returning { content: string, cached: boolean } via renderChunksToText() with transparent .md caching alongside the .jsonl); includes orchestrator lifecycle handlers: handleOrchestratorStart, handleGetOrchestratorQueue, handleOrchestratorKill, handleOrchestratorDismiss, handleGetRunMetadata (reads plan_dir/.orchestrator-run.json — serves run provenance for the Resume Run button); knowledge handlers are NOT in this file — they were extracted to gui/api-knowledge.ts (WP-003); store handlers are NOT in this file — they were extracted to gui/api-stores.ts (gui-store-management plan)
│   ├── api-knowledge.ts     # GUI REST handlers for the /api/knowledge/* endpoints — extracted from gui/api.ts (WP-003); exports: KnowledgeUpdateBodySchema, KnowledgeMoveBodySchema, KnowledgeListParams interface, parseKnowledgeId helper, handleListKnowledge, handleUpdateKnowledge, handleDeleteKnowledge, handlePromoteKnowledge, handleMoveKnowledge; handlePromoteKnowledge and handleMoveKnowledge delegate to KnowledgeStoreManager.moveInsight() (atomic, no add→delete compose); re-exports ApiError for convenience; when query param is present, handleListKnowledge forwards tags, limit, and offset to searchInsights() — full-text search, tag filtering (AND semantics), and pagination can be combined in a single call
│   ├── api-repos.ts         # GUI REST handlers for the /api/repos and /api/repos/:repoId endpoints (WP-006); follows the domain-split pattern established by api-knowledge.ts; exports: RepoCreateBodySchema (@internal — test use only), RepoUpdateBodySchema (@internal — test use only), RepoListItem interface (list/get projection with has_vision boolean), handleListRepos, handleGetRepo, handleCreateRepo, handleUpdateRepo, handleDeleteRepo; re-exports ApiError for convenience; assertNoFolderNameConflicts() private helper enforces global folder_name uniqueness across all registry entries; toListItem() pure projection omits the vision object from list responses and computes has_vision = (at least one horizon field is non-null); handleCreateRepo returns HTTP 201 (intentional — wired in server.ts); handleDeleteRepo removes only the declaration, never project files
│   ├── api-stores.ts        # GUI REST handlers for all /api/stores/* endpoints (gui-store-management plan); exports: handleGetStoresEnriched (enriched GET with Git status, ahead/behind, sync metadata), handleAddStore, handleImportStore, handleUpdateStore, handleRemoveStore, handleSetDefaultStore, handleReorderStores, handleGetStoreConflicts; all write handlers call reloadStoreContext() after saveStoresConfig(); Git detection per store runs concurrently via Promise.all with 5 s timeout; handleAddStore rejects reserved IDs ('import', 'order', 'conflicts'), duplicate IDs, duplicate paths, and relative paths
│   ├── api-models.ts        # GUI REST handlers for the /api/models, /api/model-assignments, and /api/personas endpoints (model-settings plan); exports: PersonaEntry interface, handleGetModels, handleSaveModels, handleLoadDefaults, handleGetAssignments, handleUpdateAssignments, handleReplaceAssignedModel, handleGetPersonas, handleRebuildPersonas; re-exports ApiError; SaveModelsBodySchema (accepts id-optional entries — auto-assigns UUIDv4 on save); concurrency guard for persona rebuild (module-level buildInProgress flag); computeStale() private helper computes staleness by comparing max(mtime(assignments.json), mtime(local.json)) vs mtime(name-mapping.json); _resetBuildInProgress() exported for test use only
│   ├── chunk-accumulator.ts # Shared accumulation layer (split from chunk-renderer.ts): all types (JsonValue, ToolCallChunk, MergedToolCall, ContentBlock, MergedMessage, NamespaceKey), JSONL parsing (isValidHeader, parseChunkLine), chunk merging (chunkId, chunkType, mergeContent, mergeToolCallChunks, mergeUsageMetadata), namespace helpers (namespaceKey, namespaceLabel), accumulateChunks(); pure-function module, no I/O. NOTE: scripts/extract-dialogue.js is an intentional parallel implementation of the chunk parsing logic — it reads the same .jsonl format using a stdlib-only Node.js implementation that avoids build coupling with the TypeScript source. Any evolution of the chunk format (e.g. new wire shapes, header fields, or namespace conventions) must be reflected independently in both chunk-accumulator.ts and scripts/extract-dialogue.js.
│   ├── chunk-renderer.ts    # Rendering layer: imports from chunk-accumulator.ts; exports renderChunksToMarkdown(jsonlContent) — verbose format with ## Role headings, JSON fenced tool-call blocks, and token-usage footer; renderChunksToDialogue(jsonlContent) — compact chat-like format with plain-paragraph AI text, per-tool single-line tool-call summaries, hidden ToolMessages (execute/task results shown inline), and sub-agent ### headings; exports DialogueBlock discriminated union type (text | tool-call | checklist | subagent-heading — tool-call has optional result field for non-inline tools); exports renderChunksToStructured(jsonlContent) — typed alternative to renderChunksToDialogue() that returns DialogueBlock[] for frontend-controlled rendering (collapsible tool calls, interactive checklists); exports renderChunksToText(jsonlContent) — prose-only extraction (AI text turns only, no tool calls or tool results) used by handleGetChunkText() for the /text endpoint; single-namespace input → flat prose, dual-namespace → ## Outer Agent / ## Inner Agent sections; returns '*No dialogue recorded./n' for empty input; module-private buildFullToolResultIndex() indexes ALL ToolMessage entries (unlike buildToolResultIndex() which filters to inline tools only)
│   ├── server.ts            # Standalone Node.js HTTP server (node:http); multi-store startup (WP-011): loadStoresConfig() → StoreRouter → MultiStoreManager → setStoreContext(); GUI config path via resolveGuiConfigPath() — ~/.ai-insights/gui-config.json in multi-store mode, {ledgerRoot}/gui-config.json in legacy mode; GET /api/repos delegates to getMergedRegistry() in multi-store mode via taggedEntryToRepoListItem() helper; POST/PUT/DELETE /api/repos still target ledgerRoot only (known WP-011 scope limitation); unified routing via buildRoutes() (declarative Route[] table composed from six non-exported domain sub-builders: buildConfigRoutes, buildOrchestratorRoutes, buildRepoRoutes, buildKnowledgeRoutes, buildModelRoutes, buildProjectRoutes) + dispatchRoute() dispatcher — organized into Section A (body-parsing routes), Section B (keyword-specific body-free routes, noBody: true), Section C (catch-all body-free routes, noBody: true); Section B must precede Section C (load-bearing ordering constraint — see constraints.md §9); getRouteDescriptors() exported zero-argument factory calls buildRoutes with sentinel args for structural testing; route table structural invariants validated by tests/gui/route-table.test.ts; resolveRepoName() exported helper reads .meta.json to resolve canonical repository_name from a /:repo/:slug URL pair; serves static files from gui/public/
│   └── public/              # Static assets served by gui/server.ts
│       ├── index.html       # Dashboard SPA shell; nav links: Projects (#/), Knowledge (#/knowledge), Orchestrator (#/orchestrator), Configuration (#/config); scripts load in dependency order: api-client → theme → router → utils → components → views → orchestrator-widgets → orchestrator.js → stale-check → app; loads theme-init.js in <head> for FOUC prevention (no inline scripts — CSP enforces script-src 'self')
│       ├── theme-init.js    # ES5 IIFE; reads localStorage key mcp-theme and sets data-theme="dark" on documentElement before first paint; plain ES5 (var, IIFE) intentional — no build step required; CSP script-src 'self' means this must remain a static file, not an inline script
│       ├── styles.css       # Full CSS; runner badge block: .badge-runner base class, .badge-runner-orchestrator, .badge-runner-vscode, .badge-runner-claude-code, .badge-runner-unknown with dark-mode overrides; orchestrator widget block: .orchestrator-status-card/header/body/elapsed/pid/progress-summary (OrchestratorWidgets.renderStatusCard), .orchestrator-kill-btn/.orchestrator-dismiss-btn (OrchestratorWidgets.renderKillButton/renderDismissButton — visual delegated to .btn.btn-danger/.btn.btn-secondary), .log-preview-entry (OrchestratorWidgets.renderLogPreview), .orchestrator-cli-reference h4/pre (OrchestratorWidgets.renderCliReference), .orch-status-cell (orchestrator.js queue table), .orch-active-run-section/.orch-cli-kill-hint (views/project-detail.js orchestrator section), `#orch-resume-cell` (resume button container; padding-bottom 8 px; WP-004), .btn-resume/.btn-resume:hover/.btn-resume:disabled (outlined primary-color resume button — hover fills background, disabled reduces opacity; WP-004), .section-title/.btn-icon (general utilities used by orchestrator views); dark-mode overrides for .orchestrator-status-card, .orchestrator-cli-reference, .log-preview-entry
│       ├── api-client.js    # API IIFE; buildQueryString(params) helper used by getProjects; Repos group: listRepos(includeUndeclared?), getRepo(repoId), createRepo(data), updateRepo(repoId, data), deleteRepo(repoId), moveRepo(repoId, targetStoreId) → POST /api/repos/{repoId}/move with { target_store_id } (WP-003); all Repos methods URI-encode repoId and carry @throws {{ code: string, message: string }} JSDoc; Stores group (WP-014): getStores() → GET /api/stores (list with project/repo counts), getStoreConflicts() → GET /api/stores/conflicts (cross-store registry conflicts with winner indicator); Model Registry and Persona groups (getModels, saveModels, loadDefaultModels, getPersonas, getAssignments, updateAssignments, replaceAssignedModel, rebuildPersonas) carry @throws {{ code: string, message: string }} JSDoc
│       ├── theme.js         # Theme IIFE; localStorage key mcp-theme; init() applies saved theme
│       ├── router.js        # Router IIFE; hash-based routing; dispatches '/' → renderProjectList, '/projects/*' → detail/plan/synthesis/WP/run-log views (pattern-matched first), then named singleton routes: '/config' → renderConfig, '/knowledge' → renderKnowledge, '/orchestrator' → renderOrchestrator, '/strategy' → renderStrategyList; unknown hashes fall through to a 404 error banner; setPolling/clearPolling manage per-view auto-refresh; updateNavActive toggles active class on the matching nav link on each hash change
│       ├── utils.js         # Shared helpers: makeProjectCacheKey(repo, slug) [returns repo+'/'+slug; used by ProjectNameCache callers and breadcrumb().project()], escapeHtml, formatDate, statusBadge (delegates to UI.badge() — added WP-001), formatDuration, showLoading, showError; ProjectNameCache IIFE — bounded 200-entry FIFO singleton; composite `repo/slug` key→displayName store used by breadcrumb().project(); API: set(key, name), get(key) [slug-fallback on miss], _size() [test-only]; breadcrumb() fluent builder: .projects()/.project(repo, slug)/.leaf(label)/.leafSpan(label, id)/.html()
│       ├── modal.js         # Shared modal lifecycle utility; globals: openModal(html, triggerEl) — appends modal HTML, stores trigger element, returns overlay; closeModal(overlay) — removes overlay from DOM, restores focus to stored trigger element; wireModalEvents(overlay, opts) — wires focus trap (Tab/Shift+Tab), Escape key, overlay click, .cs-modal-close/.cs-modal-cancel-btn close buttons, and Enter-to-submit; opts: { onClose, onSubmit, excludeTextarea? }; must be loaded before config-stores.js and strategy.js (both depend on all three globals)
│       ├── components.js    # UI IIFE — shared render helpers; depends on escapeHtml() from utils.js (loaded before this file); exposes: UI.badge(type, label) → <span class="badge badge-{type}">{label}</span> (WP-001); UI.banner(type, message) → <p class="{type}-banner">{message}</p> (supports: error, success, info, stale) (WP-001); UI.emptyState(message) → <p class="text-muted mt-16">{message}</p> (WP-001); UI.card(title, body, opts?) → <div class="card">…</div> — title escaped, body verbatim, opts: id/dataId (escaped), style/accentColor/titleStyle (verbatim CSS), extraClass (WP-006); UI.filterBar(containerId, filters) → { html, bind } — returns wrapper HTML + bind(onChange) for change/input event wiring; filter descriptors: type:'select'|'text', id, label, options/optionsHtml, placeholder, value, cssClass; bind() uses document.getElementById (WP-007); internal _normaliseType(type) lowercases and replaces spaces/underscores with hyphens (return value not HTML-escaped — safe for server-controlled status strings only)
│       ├── app.js           # Bootstrap entry point: Theme.init(); Router.init(); StaleCheck.init()
│       ├── stale-check.js   # StaleCheck IIFE; init() polls API.getServerInfo() immediately then every 30 s; injects .stale-banner into document.body before <header> on stale:true; stops polling after banner; silently continues on network errors
│       ├── views/
│   │   ├── project-list.js    # renderProjectList — status filter, search, sortable columns, archive/unarchive/delete row buttons, pagination, 10s polling; all project row links and action-menu View links use namespaced `#/projects/{repo}/{slug}` form (WP-009); API delete/archive/unarchive calls pass (repo, slug); projects with null repository_name render as read-only rows (no link, no View action) with a console.warn — action buttons still appear but are silently skipped with console.error on click; ProjectNameCache populated with `repo/slug` key per row; runner filter dropdown (RUNNER_STORAGE key mcp-runner-filter, buildRunnerOptions() dynamically filters runner_counts to count only — fixed: previously hardcoded all 4 types; preserves stale localStorage selections as zero-count entry); runnerBadge() renders .badge.badge-runner.badge-runner-{type} — fixed: previously emitted badge-unknown instead of badge-runner-unknown; runnerLabel() unused — cleanup candidate; sortable Runner column
│   │   ├── project-detail.js  # extractSynopsis, renderPlan(app, repo, slug), renderSynthesis(app, repo, slug), renderProjectDetail(app, repo, slug); STAGE_ABBREV, buildPipelineTrack; showResetModal(repo, slug, diagnosis, options); archive banner; all API calls and internal links use namespaced (repo, slug) form (WP-013); patch helpers: _patchSynthesisLink(visible, repo, slug) — reveals/hides synthesis link in place; _patchOutcomeSynopsis(visible, outcomeSummary) — reveals/hides #outcome-synopsis container in place during data-only poll cycles (WP-004; mirrors _patchSynthesisLink pattern); calls renderDialoguesSection() after DOM is set for the project-level Dialogues section
│   │   ├── project-detail-helpers.js  # Module-level helpers exposed on globalThis: _findScrollAnchor(el, _getStyle) — walks up the DOM to find the nearest scrollable ancestor (injectable _getStyle for jsdom tests; falls back to document.documentElement); renderRunsList(runsEl, sorted, repo, slug, activeFilename, matchingQueueEntry) — rebuilds orchestrator runs list in-place with scroll preservation and log-preview drain/restart; _snapshotProjectState(project, overviewResult) — captures synthesis_generated, outcome_summary, and WP state for diff comparison; _diffProjectState(prev, next) — detects changes to synthesis_generated, outcome_summary, and WP counts and classifies them as data-only or structural
│   │   ├── project-detail-dialogues.js  # buildDialogueHTML(blocks) (WP-006) — transforms DialogueBlock[] into interactive HTML: text blocks as escapeHtml+marked.parseInline paragraphs, tool-call blocks as collapsed-by-default cards (toggle button + always-visible ↳ detail lines + hidden args/result body), checklist blocks, subagent-heading h3s; all strings escaped via escapeHtml(); ES5-only; renderDialoguesSection(sectionEl, repo, slug) — fetches all chunks/dialogues (no WP filter), merges (chunks take priority), groups by source+stage, renders overview table; clicking a revision button opens _openDialogueModal(): useChunks=true → getChunkStructured() → buildDialogueHTML() with delegated expand/collapse listener; useChunks=false → getDialogueContent() → marked.parse() (legacy path); sub-module loaded before project-detail.js
│   │   ├── work-package.js    # WP_DEFAULT_STAGES, buildWpDetailBar, renderWorkPackageDetail
│   │   ├── config-stores.js   # Stores tab module (WP-006); loaded before config.js; module-level state: csStores, csOriginal, csReorderMode, csModalMode, csModalStoreId, csModalCreateDir, csClickHandler (stale-listener guard); renderStoresTab(stores) — 9-column table (Default ★, Label, ID, Path+copy, Type badge, Projects, Repositories, Sync badge, Actions) with empty state; csRenderReorderView(stores) — move-up/down reorder sub-view; csRenderStoreModal(mode, store) — add/edit modal delegating lifecycle to shared modal.js (openModal/wireModalEvents/closeModal); csWireEvents() — delegated click handler stored in csClickHandler with removeEventListener guard to prevent listener accumulation on persistent config-tab-content; csRefreshTab(), csRefreshWithStores(stores, warning) — import warning notification banner; validation: csValidateId (SLUG_REGEX + reserved IDs ['import','order','conflicts']), csValidatePath (absolute or ~/... paths), csValidateLabel (whitespace-only rejection); depends on modal.js (loaded before this file)
│   │   ├── config.js          # renderConfig — four-tab configuration page (Stores, General, Persona Models, Model Registry); Stores tab: delegates to renderStoresTab/csWireEvents from config-stores.js companion module (loaded first); Stores cleanup runs unconditionally on tab leave — removeEventListener before csClickHandler = null; General tab: auto_handoff_enabled, max_handoff_depth, capture_dialogues, auto_archive_days; Persona Models tab: pmModels/pmPersonas/pmAssignments module state, pmBuildTabHtml/pmWireEvents/pmDoSave/pmDoRebuild, suite-grouped persona table, default model click-to-edit, dirty indicators (.pm-dirty-dot), stale-banner, Replace Model inline form, fixed action bar; Model Registry tab: mrModels/mrOriginal/mrEditingId state, renderModelRegistryTab/mrWireEvents; configDirty object has four keys (general, personaModels, modelRegistry, stores); renderConfig loads GET /api/stores as a fifth parallel request; renderConfigPage resets all cs* state vars on fresh load
│   │   ├── insights.js        # renderInsights — project health stats; 15 s polling
│   │   ├── knowledge.js       # renderKnowledge — Knowledge page (#/knowledge); tab navigation (Global/Repository scopes); client-side filtering by category, repository_name (Repository tab only), and free-text query; formatConfidence() helper with named bucket constants (0.0–0.3 low / 0.3–0.7 medium / 0.7–1.0 high); card-level Edit (inline form with in-card error display), Delete (inline confirmation), Promote to Global, and Move to Repository actions; buildKnowledgeHtml() — renders insight cards with escapeHtml() on all dynamic values; no polling (knowledge is human-curated)
│   │   ├── strategy.js        # renderStrategyList — Strategy page (#/strategy); fetches listRepos + getStores + getStoreConflicts via Promise.all; single-store mode: repo list with Store column + "Show undeclared" checkbox toggle + Add Repository button; multi-store mode: tab bar (Repositories | Conflicts), Store column in table (shows store label), Store dropdown on Add/Edit form; renderRepoModal(repo, triggerElement, onSaved) — add/edit modal delegating lifecycle to shared modal.js (openModal/wireModalEvents/closeModal); buildTableHtml(repos, isMultiStore) — conditional Store column; refreshTable race guard (refreshSeq counter); Conflicts tab with buildConflictsHtml() per-repo conflict cards (Active/Shadowed badges, vision summary, last-modified), resolveConflict(), updateConflictBadge(count); conflictsIndex and storesSnapshot module-level caches; #add-repo-form written once and never overwritten by refreshTable() or refreshConflicts() to preserve in-flight form state; all dynamic values XSS-escaped via escapeHtml(); depends on modal.js (loaded before this file)
│   │   └── orchestrator.js    # renderOrchestrator — plan path input, preflight checklist (Section A), Start Run button gated on allChecksPassed (Section B), live queue table with 5 s polling via Router._setPolling, per-row expand/collapse inline log preview; cleanup managed via _orchLogPreviewCleanups array; CLI reference card footer (WP-011); renderQueueTable delegates to four closure-scoped helpers: _clearSuccessBanner (removes success banner when queue is non-empty; leaves error banners intact), _buildQueueHtml (builds table HTML string), _bindQueueActions (injects Kill/Dismiss/View-Project buttons and toggle listeners), _mountLogPreviews (starts live log-preview widgets for expanded rows) (WP-006)
│       ├── js/
│   │   └── orchestrator-widgets.js  # OrchestratorWidgets IIFE — shared orchestrator UI components: kill/dismiss row buttons, formatLogAction (maps JSONL entry → human-friendly label; null/undefined-safe; WP-002), renderLogPreview(container, repo, slug, filename) → cleanup fn (4-arg form; passes repo+slug to API.getRunLogEntries; WP-013), renderCliReference; depends on API (api-client.js) and escapeHtml (utils.js) (WP-011)
│       └── libs/
│           └── marked.min.js  # Vendored Markdown parser (marked v15.0.12, ~40 KB)
│
├── src/                         # Source code
│   ├── index.ts                 # MCP server entry point and tool registration
│   │
│   ├── gui/                     # Shared GUI/config module
│   │   ├── auto-archive.ts      # Auto-archive service
│   │   ├── config.ts            # Runtime config: GuiConfigSchema, getConfig(), readConfigFromDisk(), writeConfig()
│   │   ├── errors.ts            # Shared ApiError class (avoids circular dep between log-resolver ↔ gui/api.ts)
│   │   ├── log-resolver.ts      # RunLogEntry type; findRunLogs (sorted + self-healing stale runs); readLogEntries; resolveOrchestratorLogsDir; migrateOrphanedLogs
│   │   ├── model-registry.ts    # File-based model registry and assignment system for the persona model configuration feature; exports: ModelEntrySchema, ModelRegistrySchema, ModelAssignmentsSchema (Zod schemas + inferred types); getModelRegistryPath() → '{WORKSPACE_ROOT}/personas/model-registry'; readModels() (auto-initializes local.json from default.json on first access); writeModels(models) (schema + slug-uniqueness + reserved-slug + deletion-guard — re-throws PARSE_ERROR/VALIDATION_ERROR for corrupt local.json so callers cannot bypass the guard; see API surface doc for full error contract); readAssignments() / writeAssignments(data); loadDefaults() → { models, conflicts } (id-based merge, slug-collision detection); isModelReferenced(modelId) → { referenced, usages }; getResolvedAssignments() → { default_model_slug, persona_models } (UUID-to-slug resolution, graceful degradation for unresolvable UUIDs); all writes use atomicWriteJson; STDIO-discipline: only writes to stderr (WP-002 model-settings plan)
│   │   ├── orchestrator-manager.ts  # Queue mutation (killQueueEntry, dismissQueueEntry), preflight checks, startOrchestrator, getRunStatus, runStatusFilename; re-exports getQueue, all types, QUEUE_FILENAME from queue/ sub-modules for backward compat (WP-005, WP-006, WP-007, WP-A, WP-B)
│   │   ├── queue/               # Run-queue helpers: types, reading, validation, progress resolution, status computation (WP-001, WP-003, WP-004, WP-A, WP-B)
│   │   │   ├── types.ts             # Shared type definitions and QUEUE_FILENAME constant: RawQueueEntry, QueueEntry, KillResult, PreflightResult, StartResult, RunStatus — leaf module, no intra-queue deps beyond compute-effective-status.ts (WP-A)
│   │   │   ├── validate-entry.ts    # Entry validator and normalizer for the run queue — extracted from get-queue.ts; exports: isRawQueueEntry() (type-guard / validator; validates all 5 RawQueueEntry rules; side effect: normalizes missing/non-string/empty-string/whitespace-only expectedRepo to null in-place so Array.filter(isRawQueueEntry) yields fully-typed RawQueueEntry[] without a second mapping pass; empty-string and whitespace-only values treated as absent and normalized to null — WP-001 security hardening); normalizeQueueEntry() (pure helper for callers that hold pre-validated entries without running them through the guard — coerces undefined expectedRepo to null); no I/O (WP-001, WP-003, WP-004)
│   │   │   ├── get-queue.ts         # Queue reading: imports isRawQueueEntry from validate-entry.ts; readQueueFile, getProjectLedgerStatus (private); isProcessAlive, readQueueFile, getProjectLedgerStatus (exported for orchestrator-manager.ts); getQueue (public API) (WP-B)
│   │   │   ├── compute-effective-status.ts  # Pure status computation; computeEffectiveStatus(alive, projectExists, hasLogActivity?): EffectiveStatus — 4 priority-ordered transition rules; zero I/O (WP-004)
│   │   │   ├── format-progress-entry.ts  # Pure JSONL-entry → string mapper; no I/O; formatProgressEntry(); empty-string tool_name treated as absent (WP-D)
│   │   │   └── resolve-progress.ts  # ProgressResolution interface + resolveProgress() async resolver; EMPTY_RESOLUTION frozen sentinel; re-exports formatProgressEntry as a convenience barrel (two-level re-export chain: format-progress-entry → resolve-progress → orchestrator-manager) (WP-D)
│   │   └── handlers/
│   │       └── run-log-handlers.ts  # handleListRunLogs (optional legacyLogsDir migration), handleGetRunLog — thin wrappers adding slug validation over log-resolver.ts
│   │
│   ├── schema/                  # Zod schemas and type definitions
│   │   ├── common.ts            # Cross-domain shared constants: SLUG_REGEX — canonical source of truth for slug validation; zero imports (no circular-import risk regardless of consumer count); used by InsightSchema, StoreEntrySchema, RepositoryEntrySchema, and gui/api-repos.ts (WP-001, rework-1)
│   │   ├── enums.ts             # Status enums derived from shared/workflow-manifest.json
│   │   ├── knowledge.ts         # InsightScope ('global'|'repository'), InsightSchema / Insight (fields: id, scope, repository_name?, origin_plan?, title, content, category, tags, source, created_at, updated_at?, confidence, superseded_by?), KnowledgeStoreSchema / KnowledgeStore — Zod schemas for the knowledge accumulation system; re-exports SLUG_REGEX from schema/common.ts (@deprecated — migrate new consumers to common.ts directly; two legacy consumers remain: src/storage/knowledge-store.ts and src/tools/knowledge.ts) (WP-001)
│   │   ├── project-meta.ts      # ProjectMetaSchema / ProjectMeta — per-project .meta.json
│   │   ├── repository-registry.ts  # StrategicVisionSchema / StrategicVision (three-horizon nullable string fields), RepositoryEntrySchema / RepositoryEntry (id, label, folder_names, vision, created_at, last_modified), RepositoryRegistrySchema / RepositoryRegistry ({ repositories: RepositoryEntry[] }) — Zod schemas for the .repositories.json central registry; empty repositories array is valid (first-run scenario)
│   │   ├── root-index.ts        # RootIndex schema
│   │   ├── store-config.ts      # Zod schemas for the multi-store configuration (cross-device ledger sync plan, WP-001): StoreSyncMetaSchema / StoreSyncMeta (optional informational sync metadata — provider, remote_path, notes; never acted upon by the server), StoreEntrySchema / StoreEntry (id validated by SLUG_REGEX from schema/common.ts, path: non-empty string expanded at runtime by expandStorePath(), optional label and sync), StoresConfigSchema / StoresConfig — top-level schema for ~/.ai-insights/stores.json; enforces at least one store, unique IDs (Zod refine), and default_store referencing an existing store id (Zod refine); stores array order defines store priority for write routing (first matching store wins)
│   │   ├── validators.ts        # Business rule validators
│   │   ├── workflow-manifest-schema.ts  # Zod schema for shared/workflow-manifest.json
│   │   └── work-package.ts      # WorkPackageDetail schema
│   │
│   ├── storage/                 # File I/O abstractions
│   │   ├── atomic-writer.ts     # Atomic write-to-temp-then-rename
│   │   ├── file-lock.ts         # File locking with proper-lockfile
│   │   ├── knowledge-store.ts   # KnowledgeStoreManager — all CRUD/query operations for the .knowledge/ store: addInsight, searchInsights, listInsights, updateInsight, deleteInsight, moveInsight; atomic cross-store move via single withLock(knowledgeDir()) span (WP-002); reads are lock-free (WP-001/002)
│   │   ├── ledger-store.ts      # Central storage abstraction; exports: ImportStandaloneDetail interface (parameter type for importStandaloneProject), SlugConflictError; static methods: listAllProjects() (two-level namespace scan), detectProjectByCwd(), listProjectsByFolderNames(folderNames, ledgerRoot?) — targeted O(folders×projects) scan used by repository-context.ts; instance methods: read/write root index, WP detail, project meta, archiving, atomic sync helpers; importStandaloneProject(detail) — bootstraps a full COMPLETE standalone project record (root index + WP-001 detail + .meta.json sync + document archival) within a single lock scope
│   │   ├── migrate-namespaced.ts  # One-shot startup migration: flat {slug}/ → namespaced {repoName}/{slug}/; exports migrateToNamespacedLayout()
│   │   ├── multi-store-manager.ts  # Collated read-only operations across all stores in a StoreRouter; exports MultiStoreManager class with listAllProjects(status?), detectProjectByCwd(cwdPath), getMergedRegistry(), getRegistryConflicts(), searchKnowledge(query, options?), listKnowledge(options?); exports tagged types TaggedProjectMeta (ProjectMeta + store_id/store_label/store_path — store_path required by handleListProjects to construct a per-store LedgerStore), TaggedRepositoryEntry (RepositoryEntry + store_id), RegistryConflict (repo_name/entries/winner_store_id), and MultiStoreDetectResult union (extends DetectProjectResult with MULTI_STORE_AMBIGUOUS); operates transparently in legacy mode — when StoreRouter is in legacy mode its single default store is used, results tagged with store_id: 'default' (cross-device ledger sync plan, WP-004)
│   │   ├── repository-registry.ts  # Plain-function storage module for the central .repositories.json registry; exports loadRegistry(storePath) — reads and parses the registry, returns { repositories: [] } on absent file, malformed JSON, or schema validation failure (all three error paths silently degrade to an empty registry — intentional lossy-fallback contract); saveRegistry(storePath, registry) — validates via RepositoryRegistrySchema then writes atomically under withLock(storePath); findByFolderName(registry, folderName) — pure synchronous O(n×m) lookup, no I/O; getAllFolderNames(entry) — returns a defensive copy of entry.folder_names; consumed by WP-005 (repository-context.ts) and WP-006 (api-repos.ts) via resolveLedgerRoot(); storePath param renamed from ledgerRoot in WP-002 (cross-device-ledger-sync plan) to support multiple independent stores
│   │   ├── store-context.ts     # Shared singleton accessor for the initialized StoreRouter and MultiStoreManager (cross-device ledger sync plan, WP-005); exports setStoreContext(router, manager) — called once per process startup; getStoreRouter() — returns the StoreRouter, throws with a descriptive '[store-context]' prefix error if called before setStoreContext(); getMultiStoreManager() — returns the MultiStoreManager, same throw guard; isStoreContextInitialized() — returns true when setStoreContext() has been called (WP-007); used as a guard in tool handlers to prevent multi-store code paths from activating in test environments that do not call setStoreContext(); pattern mirrors client-info.ts (_mcpServer set-once singleton); required by the two-process architecture: src/index.ts (MCP STDIO server) and gui/server.ts (HTTP GUI server) are separate OS processes and cannot share module-level state via index.ts, so tool files import from store-context.ts to avoid circular imports
│   │   ├── store-registry.ts    # User-level multi-store config I/O module (cross-device ledger sync plan, WP-001); exports resolveStoresConfigPath() → ~/.ai-insights/stores.json; expandStorePath(pathStr) — expands ~/... and ~ to os.homedir(), normalizes with path.resolve(); resolveGuiConfigPath(storeConfig, ledgerRoot) — returns ~/.ai-insights/gui-config.json when storeConfig is non-null (multi-store mode), or {ledgerRoot}/gui-config.json when null (single-store/legacy mode); loadStoresConfig(configPath?) — returns null on absent file, malformed JSON, or schema validation failure (warns to stderr on the latter two); saveStoresConfig(config, configPath?) — validates via StoresConfigSchema, writes atomically under withLock(~/.ai-insights/); consumed by src/index.ts and gui/server.ts for GUI config path resolution
│   │   └── store-router.ts      # Routes read/write operations to the correct store by iterating per-store repository registries in config order; exports StoreRouter class with isMultiStoreMode(), resolveDefaultStore(), getAllStorePaths(), getAllStores(), resolveStoreForRepo(), resolveStoreForWrite(); getAllStores() returns [{id, path, label}] in store-priority order — consumed by MultiStoreManager (WP-004); constructor auto-creates each configured store path via mkdirSync({ recursive: true }); provides legacy-mode fallback (delegates to resolveLedgerRoot()) when config is null (cross-device ledger sync plan, WP-003/WP-004)
│   │
│   ├── tools/                   # MCP tool implementations
│   │   ├── help.ts              # ledger_help
│   │   ├── ping.ts              # ledger_ping — lightweight health check; returns status, server_version, stale (boolean|null), uptime_seconds; exports _internal and register()
│   │   ├── help-content.ts      # TOOL_HELP: static documentation strings for all 30 MCP tools
│   │   ├── knowledge.ts         # ledger_add_insight, ledger_search_insights, ledger_list_insights, ledger_update_insight, ledger_delete_insight — knowledge accumulation tools; IDs are UUID v4 strings generated via crypto.randomUUID(); in multi-store mode, search/list iterate stores directly to capture owning storeId per insight (WP-001/003)
│   │   ├── observations.ts      # ledger_add_observation, ledger_add_project_comment
│   │   ├── pipeline.ts          # ledger_start_pipeline, ledger_complete_pipeline, ledger_cancel_pipeline, ledger_update_pipeline_progress
│   │   ├── project-lifecycle.ts # ledger_detect_project, ledger_get_project_status, ledger_initialize_project, ledger_list_projects, ledger_complete_synthesis
│   │   ├── standalone-import.ts # ledger_import_standalone — imports a completed standalone developer plan execution into the project ledger; Zod schema (project_path/cwd_path/project_summary); validation pipeline (path present → basename convention → plan.md → synthesis.md → optional usage-scenarios.md detection → duplicate slug); delegates writes to LedgerStore.importStandaloneProject(); archives authored source files only (never scenario-coverage.md); exports _internal and register()
│   │   ├── repository-context.ts  # ledger_get_repository_context — returns a compact project timeline with curated outcome summaries, knowledge-base insights, and strategic vision for a repository; exports register(server) and _internal (test-only: GetRepositoryContextSchema, getRepositoryContext, safeListRepositoryInsights, safeListAllStoreRepositoryInsights); handler: resolves repository name (repository_name takes precedence over cwd_path); in multi-store mode (WP-008) — registry uses getMergedRegistry() (store-order priority), projects scanned across all stores via getAllStorePaths() with plan_path dedup, insights from safeListAllStoreRepositoryInsights() via MultiStoreManager.listKnowledge(); in legacy mode — consults single .repositories.json, aggregates projects from declared folder_names via LedgerStore.listProjectsByFolderNames(), queries knowledge via safeListRepositoryInsights(); both helpers suppress slug-validation errors and re-throw I/O errors; sorts by date_created desc, caps at max_projects; deduplicates combined insights by UUID id (global-first, first-seen wins); relevant_insights[] always present (empty when include_insights: false) (WP-005, WP-008)
│   │   ├── work-package.ts      # WP CRUD tools
│   │   ├── workflow.ts          # Thin aggregator
│   │   ├── workflow-handoff.ts              # ledger_get_handoff_status
│   │   ├── workflow-next-action.ts          # ledger_get_next_action
│   │   └── workflow-next-action-batch.ts    # Batch/collector sub-module
│   │
│   └── utils/                   # Utility functions
│       ├── workflow-helpers.ts  # Shared constants and stateless helpers
│       ├── agent-registry.ts    # Discovers VS Code agent handles and IDs
│       ├── client-info.ts       # Module-level MCP server reference for extracting client info
│       ├── constants.ts         # Shared constants and interfaces; derives role/pipeline constants from shared/workflow-manifest.json; loads AGENT_NAMES (TargetNames, NameMappingEntry) from personas/name-mapping.json
│       ├── if-defined.ts        # ifDefined() type guard helper
│       ├── ledger-root.ts       # resolveLedgerRoot(), projectSlugFromPath(), inferProjectRootFromPlanPath()
│       ├── path-validator.ts    # Pure path-segment validation; assertSafeSegment() slug-segment predicate; no storage deps
│       ├── project-resolver.ts  # resolveProjectPath() + formatCandidateList(); requires LedgerStore
│       ├── pipeline-maps.ts     # Shared routing constants and utility functions
│       ├── project-reset.ts     # Semi-intelligent project reset
│       ├── read-project-name.ts # Resolves project name from package.json / composer.json / pyproject.toml
│       ├── runner.ts            # classifyRunner(clientInfo) — normalises raw MCP clientInfo.name into a stable RunnerType enum; exports RunnerType, RunnerInfo, ClientInfo types; used by initializeProject to stamp runner metadata on new projects
│       ├── server-version.ts      # Reads MCP server version from package.json
│       ├── store-resolution.ts    # extractLedgerRoot(), resolveMultiStoreLedgerRoot() — shared multi-store ledger root resolution utility; imports only store-context.ts and ledger-root.ts
│       ├── synthesis-parser.ts    # parseOutcomeSummary() — extracts ### Outcome Summary from a synthesis Markdown string; falls back to first bullet of ### Implementation Summary; returns null when neither section yields content; pure utility, zero dependencies
│       ├── timestamp.ts           # Timestamp formatting
│       ├── workspace-versions.ts  # captureWorkspaceVersions() — reads mcpServer, personas, orchestrator versions from disk
│       └── wp-id.ts             # Work package ID formatting (WP-###)
│
└── tests/                       # Test suites
    ├── gui-server.test.ts       # 10 tests for resolveRepoName() in gui/server.ts: 9 guard-failure cases (traversal, empty, uppercase, hyphens, separators for both repoUrlParam and slugUrlParam) + 1 positive case confirming the guard passes valid inputs
    ├── route-table.test.ts      # Structural invariant tests for the unified route table returned by getRouteDescriptors() in gui/server.ts: every route has a valid HTTP method (GET/POST/PUT/PATCH/DELETE); every RegExp route uses only named capture groups (no positional groups); no two routes share the same method+path combination
    ├── helpers/                 # Shared test utilities (NEVER write to production storage)
    │   ├── create-temp-store.ts # createTempStore() / cleanupTempStore() helpers
    │   ├── fixtures.ts          # makeWorkPackageDetail(), makePipeline(), makeWorkPackageSummary()
    │   └── test-utils.ts        # injectLedgerDir(), nowFloor()
    │
    ├── gui/                     # GUI and config module tests
    │   ├── helpers/             # Shared GUI test fixtures
    │   │   ├── api-stubs.ts     # ProjectDetailApiStubs interface + createApiStubs(overrides?) factory — single source of truth for the 8 API stub keys used by the four renderWithAPI helpers in project-detail-*.test.ts files; mirrors the makeProject factory-with-overrides pattern
    │   │   ├── create-namespaced-project.ts  # createNamespacedProject() fixture builder for namespaced storage layout tests (real on-disk LedgerStore); used by api-run-metadata.test.ts and similar handler integration tests
    │   │   ├── create-namespaced-project.test.ts  # Unit tests for the createNamespacedProject helper itself
    │   │   └── make-project.ts  # makeProject(opts) — canonical fixture factory used by all eight project-detail-*.test.ts files; accepts { meta?, work_packages?, synthesis_generated?, timing?, ...rootOverrides } and returns a well-typed project fixture with correct meta/root separation
    │   ├── api-run-metadata.test.ts  # 17 tests across two describe blocks: (1) 10 handler-level tests for handleGetRunMetadata: HTTP 200 with parsed metadata (AC-1), HTTP 404 when file absent (AC-2), HTTP 404 when project has no plan_path (AC-3), HTTP 400 for unsafe slug (AC-4), file path constructed as path.join(planPath, '.orchestrator-run.json') (AC-5) — real temp dirs + LedgerStore fixtures; (2) 7 HTTP-level integration tests for the namespaced GET /api/projects/:repo/:slug/run-metadata route (added WP-002): 2 happy-path 200 tests (AC-NS-1), 2 not-found 404 tests for unknown repo/slug (AC-NS-2), 3 path-traversal 404 tests for '..' in repo or slug segments and URL-encoded slash (AC-NS-3) — uses handleRequest() via a real HTTP server, mirroring the run-log-server.test.ts pattern; writeNamespacedProject() fixture enforces YYYY-MM-DD-name planPath basename constraint required by LedgerStore constructor
    │   ├── api-client.test.ts  # jsdom + vm.runInThisContext unit tests for gui/public/api-client.js — covers run log, server-info, orchestrator, knowledge, and model registry API methods; module-level afterEach deletes globalThis.fetch after every test to prevent mock bleed between tests (afterEach imported from vitest; added model-settings-rework-2); ⚠ missing coverage: `getRunMetadata(slug)` and the three-argument form `orchestratorStart(planPath, dryRun, resumeThreadId)` are not tested in this file — both were added in WP-004; tracked as a follow-up test gap (noted in WP-004 QA and code review)
    │   ├── stale-check.test.ts  # 10 unit tests for StaleCheck IIFE (jsdom + vm.runInThisContext + fake timers): immediate poll, 30 s interval, banner insertion before <header>, changed-component listing, polling stop after banner, silent error handling
    │   ├── api-reset.test.ts    # Integration tests for handleResetProject (13 tests)
    │   ├── api-wp-overview.test.ts  # Unit tests for handleGetWorkPackageOverview (21 tests)
    │   ├── api.test.ts          # Unit tests for gui/api.ts; includes 6 handleListProjects runner filter tests (WP-005 verification of WP-003 ACs): runner field present and 'unknown' default for projects without stored runner (AC1), runner_counts object shape and values (AC1), runner=orchestrator filter returns only matching projects (AC2), runner_counts unaffected by active runner filter (AC3), runner:'unknown' filter returns projects with no stored runner field (AC4), unrecognized runner query returns empty set without 500 error (AC5), and combined status+runner filter
    │   ├── auto-archive.test.ts # Unit tests for src/gui/auto-archive.ts (14 tests)
    │   ├── auto-archive-multi-store.test.ts  # 2 integration tests for multi-store auto-archive scanning (WP-002): eligible project in a non-default store is archived; non-default store is not skipped when it is the only store with eligible projects; backdateProject() helper patches last_updated in .meta.json without the store API to isolate threshold logic
    │   ├── multi-store-api.test.ts  # 5 integration tests for resolveProjectStore and dependent GUI handlers in multi-store mode (WP-002): project found in non-default store, project not found returns 404, no phantom directories created in default store by a read-only handler call on a non-default-store project, run-log route resolves correct store, resolveProjectStore falls back to single-store mode correctly
    │   ├── client-rendering.test.ts
    │   ├── config.test.ts       # Unit tests for src/gui/config.ts
    │   ├── dialogue-qa.test.ts
    │   ├── api-dialogue-parse.test.ts  # Unit and integration tests for updated DIALOGUE_PARSE_RE / CHUNK_PARSE_RE (project- prefix support) and wpId="project" filter acceptance in handleListDialogues / handleListChunks; real temp dirs
    │   ├── project-detail-dialogues.test.ts  # jsdom + vm.runInThisContext tests for renderDialoguesSection(): empty state, project-level Source badge, WP-level source cell, chunk priority over Markdown, expand/collapse interaction, error state, table structure (column headers, grouping)
    │   ├── handoff-config-integration.test.ts  # Integration: runtime config changes affect buildHandoffResponse
    │   ├── log-resolver.test.ts
    │   ├── api-orchestrator.test.ts  # 23 unit tests for the 4 orchestrator API handlers: planPath validation (missing, number, null, non-object body), dryRun forwarding (true/false/default), queue enrichment shape, kill result { killed: boolean }, dismiss void resolution, assertSafeQueueId guard (empty/slash/double-dot rejection)
    │   ├── api-knowledge.test.ts  # Unit tests for gui/api-knowledge.ts handlers (WP-003); imports from ../../gui/api-knowledge.js; complements knowledge-api-multi-store.test.ts
│   ├── model-registry.test.ts # Unit tests for src/gui/model-registry.ts (model-settings plan): readModels (auto-init from default.json, ENOENT path, parse/validation errors), writeModels (schema validation, slug uniqueness, reserved-slug guard, deletion guard — referenced UUID returns { saved: false, referencedModels }, unreferenced UUID proceeds, corrupt local.json re-throw), readAssignments (ENOENT default, parse error, validation error), writeAssignments (validation error), loadDefaults (id-based merge — local wins, slug collision recorded, new entries appended, conditional write), isModelReferenced (default usage, persona usage, combined, absent file returns false), getResolvedAssignments (UUID→slug resolution, missing default_model_uuid, unresolvable UUID omitted, absent files graceful degradation); real temp dirs; no mocks
│   ├── api-models.test.ts     # Unit and integration tests for gui/api-models.ts handlers (model-settings plan): handleGetModels (auto-init from defaults), handleSaveModels (UUID auto-assign, slug uniqueness, deletion guard — referenced model returns 409 conflict shape), handleLoadDefaults (id-based merge, slug-collision conflict reporting), handleGetAssignments (stale flag computation), handleUpdateAssignments (persona key validation against name-mapping.json, model UUID validation against local.json), handleReplaceAssignedModel (same-model rejection, unreferenced old_model rejection, full swap), handleGetPersonas (empty on missing file), handleRebuildPersonas (success path, failure path with exitCode, concurrency guard via buildInProgress flag); real temp dirs; no mocks for storage layer
│   ├── api-repos.test.ts      # 46 tests for gui/api-repos.ts handlers (WP-006): AC-1 (GET /api/repos — returns RepoListItem[] with has_vision boolean), AC-2 (POST /api/repos — SLUG_REGEX validation, unique id, unique folder_names, HTTP 201), AC-3 (PUT /api/repos/:repoId — partial update, self-conflict allowed, last_modified stamped), AC-4 (DELETE /api/repos/:repoId — removes entry only, releases folder_names, no project data deleted), AC-5 (GET /api/repos/:repoId — returns RepositoryEntry or 404), AC-6 (folder_name uniqueness — assertNoFolderNameConflicts rejects create/update that would conflict across entries); real temp dirs + RegistryRegistry fixtures; zero mocks for storage layer
│   ├── api-repos-store.test.ts # 34 store-aware repository tests (WP-013 + WP-004): AC-1–AC-4 (createRepo with store_id routing, invalid store_id, handleListRepos merged view, single-store implicit); handleMoveRepo suite — happy path (entry moves between registries, last_modified updated), same-store no-op (mtime guard proves no writes), invalid target_store_id, NOT_FOUND, single-store mode rejection, ID conflict, folder_name conflict; handleGetRepo enrichment — multi-store returns store_id; single-store omits store_id; vi.mock for store-context, real temp dirs for I/O
    │   ├── knowledge-api-multi-store.test.ts  # Unit tests for the 5 knowledge REST handlers (handleListKnowledge, handleUpdateKnowledge, handleDeleteKnowledge, handlePromoteKnowledge, handleMoveKnowledge): imports handlers from ../../gui/api-knowledge.js (updated WP-003); real temp directories + KnowledgeStoreManager fixtures; covers scope disambiguation (global vs repository), ID validation (parseKnowledgeId — non-integer, zero, float rejection), VALIDATION_ERROR/NOT_FOUND paths, promote/move cross-store ID-change semantics; WP-001 added 3 scope-validation tests for handleListKnowledge; WP-004 added 4 repository_name format-validation tests (AC-1 through AC-4 rework) for handleDeleteKnowledge and handlePromoteKnowledge; multi-store handler scope (WP-007)
    │   ├── knowledge-repository-scope.test.ts  # Integration tests for repository-scope knowledge functionality across two layers (WP-010, updated WP-001/WP-004): storage layer — repositoryStorePath path generation and reserved-name guard, addInsight with repository scope, readRepositoryStore empty/populated, listInsights unfiltered/scope-filtered/name-filtered, searchInsights with repository_name, updateInsight and deleteInsight with repository scope, moveInsight global→repo/repo→repo/same-name rejection, origin_plan preservation through add+update+move; GUI REST handlers — handleListKnowledge with repository_name, handleUpdateKnowledge with repository scope, handleDeleteKnowledge success and missing-repository_name, handlePromoteKnowledge from repository (success) and from global (rejection), handleMoveKnowledge global→repo/same-repo rejection/missing-target rejection, scope:'project' rejection by all 5 handlers (VALIDATION_ERROR — handleListKnowledge now throws VALIDATION_ERROR for unrecognised scope per WP-001; handleDeleteKnowledge and handlePromoteKnowledge throw VALIDATION_ERROR for malformed repository_name per WP-004); real temp dirs + KnowledgeStoreManager — no mocks; follows knowledge-api-multi-store.test.ts patterns
    │   ├── server-knowledge-routes.test.ts  # 40 HTTP-level routing integration tests for the 5 knowledge endpoints in gui/server.ts: verifies body-free routes (GET, DELETE, POST /promote) are dispatched via the unified dispatchRoute() and body-parsing routes (PATCH, POST /move) are also handled by dispatchRoute() via the Route table; covers AC-1 through AC-7 — oversized body (413), invalid JSON (400), missing/invalid scope (400), float/zero/non-numeric IDs (400), missing repository_name when scope=repository (400), 404 for absent insights, route isolation (no interference with /api/insights, /api/projects)
    │   ├── orchestrator-manager.test.ts  # 77 tests: getQueue() lifecycle transitions (AC-1 through AC-6), formatProgressEntry() (11 event types), progress resolution (WP-005); killQueueEntry()/dismissQueueEntry() lifecycle gates, SIGTERM→SIGKILL flow, TOCTOU ESRCH handling, queue-file removal, lock-file cleanup; PID validation (negative/zero/float rejection) (WP-006); 7 lastAction/logFilename population cases (WP-003 AC-6)
    │   ├── orchestrator-widgets.test.ts  # 41 tests: OrchestratorWidgets functions, all 7 ACs + 7 refined variants; vm.runInThisContext + jsdom, fake timers for renderLogPreview (WP-010)
    │   ├── project-list.test.ts  # 5 jsdom + vm.runInThisContext unit tests for views/project-list.js — buildTable() rendering; loads utils.js, api-client.js, project-list.js via vm.runInThisContext; covers: clickable link for projects with repository_name (AC-7), read-only name cell for null repository_name (AC-7), ProjectNameCache populated with composite repo/slug key (AC-7), action-menu wrapper carries data-repo and data-slug attributes (AC-7), action-menu handler skips when data-repo is empty (AC-7); fake fetch stub; no real HTTP calls
    │   ├── project-detail-runs.test.ts
    │   ├── project-detail-diff.test.ts  # 23 unit tests for _diffProjectState and _snapshotProjectState in views/project-detail-helpers.js: diff detection for synthesis_generated (false→true, true→false), WP count changes (structural), outcome_summary (null→value, value→null — data-only), and snapshot field values; uses jsdom + vm.runInThisContext; Snapshot type includes outcome_summary field (Fix-Forward from WP-004 code review)
    │   ├── project-detail-helpers.test.ts  # 9 unit tests for WP-004 module-level helpers: _findScrollAnchor (scrollable ancestor found, falls back to document.documentElement, multi-level walk) and renderRunsList (single run item DOM, drain fires before rebuild, scroll position restored, active-run section + status card, log preview started/skipped); uses injectable _getStyle for testable scroll-ancestor detection in jsdom
    │   ├── config-helpers.test.ts  # 45 unit tests for pure-function helpers extracted from config-model-registry.js and config-persona-models.js (model-settings-rework-1 plan): mrDeriveSlug (12 cases: basic lowercasing, space-to-hyphen, special char stripping, consecutive hyphens, leading/trailing hyphens, unicode, empty string), mrValidateSlug (14 cases: valid slug, empty string, whitespace-only string — returns 'Slug is required.' rather than the regex error, null, undefined, reserved 'inherit', mixed-case, special chars, numeric-only allowed, leading/trailing/consecutive hyphens), mrHasChanges (11 cases: identical arrays, single field change, deleted entry, length difference, null mrModels/mrOriginal, index-based comparison), pmCloneAssignments (8 cases: basic clone, independence from source, nested persona_models clone, null/undefined default_model_uuid, empty personas_models); uses @vitest-environment jsdom + vm.runInThisContext() loading pattern (consistent with client-rendering.test.ts); module-level globals (mrModels, mrOriginal) reset via beforeEach to isolate mrHasChanges tests; minimal API/configDirty stubs via existence guard (typeof check) to avoid double-registration conflicts with setup-gui-globals.ts
    │   ├── queue/               # Unit tests for src/gui/queue/ modules (WP-001, WP-003, WP-004, WP-A, WP-B, WP-C, WP-D)
    │   │   ├── compute-effective-status.test.ts  # 6 pure unit tests: AC-1/2/3 transitions, default hasLogActivity=false, projectExists-always-wins across all 4 alive/hasLogActivity combinations (WP-004)
    │   │   ├── format-progress-entry.test.ts  # Unit tests for formatProgressEntry() (11 event types + empty tool_name WP-D)
    │   │   ├── resolve-progress.test.ts  # 29 unit tests covering all 5 acceptance criteria + 3 edge-case tests (malformed JSONL, all-malformed, 0-byte log) (WP-001, WP-C)
    │   │   └── validate-entry.test.ts  # 27 pure-function unit tests (TC-01–TC-27); covers isRawQueueEntry() across all 5 validation rules: valid entry, null/primitive/object rejection, non-string id/planPath, zero/negative/float pid, empty/whitespace-only/missing expectedSlug, missing/non-string startedAt (TC-01–TC-19); plus expectedRepo normalization via isRawQueueEntry(): missing field → null, string preserved, explicit null preserved (TC-20–TC-22); plus empty-string/whitespace-only expectedRepo → null normalization (TC-26–TC-27; WP-001 security hardening); plus normalizeQueueEntry(): undefined → new spread with null, string → same reference, null → same reference (TC-23–TC-25); no I/O setup (WP-001, WP-003, WP-004)
    │   ├── run-log-handlers.test.ts
    │   ├── run-log-server.test.ts
    │   ├── run-log.test.ts
    │   └── security-headers.test.ts
    │
    ├── integration/             # End-to-end workflow tests
    │   ├── auto-handoff.test.ts
    │   └── full-workflow.test.ts
    │
    ├── schema/                  # Schema validation tests
    │   ├── project-archiving-schema.test.ts
    │   ├── project-meta-runner.test.ts  # 10 backward-compatibility tests (WP-005 verification of WP-001 AC5): ProjectMetaSchema and RootIndexSchema accept runner fields when present (orchestrator, vscode, claude-code), accept empty strings for runner_client/runner_version, reject invalid enum values, and parse cleanly without runner fields (legacy fixture and full real-world legacy project-ledger.json simulation)
    │   ├── repository-registry.test.ts  # Schema-level tests for RepositoryEntrySchema, RepositoryRegistrySchema, and StrategicVisionSchema
    │   ├── root-index.test.ts   # RootIndexSchema and WorkPackageSummarySchema tests (20 tests)
    │   ├── store-config.test.ts # Unit tests for StoreEntrySchema and StoresConfigSchema (cross-device ledger sync plan, WP-001): valid two-store config accepted, missing required fields rejected, duplicate store IDs rejected, default_store referential integrity rejected when ID does not exist, StoreSyncMetaSchema optional fields
    │   ├── validators.test.ts
    │   └── work-package-schema.test.ts  # Zod parse-level tests (24 tests)
    │
    ├── startup/                 # Startup-time static analysis tests
    │   └── tool-log-sync.test.ts  # Asserts the hardcoded startup log in src/index.ts contains exactly the tool names registered via server.registerTool() across all src/tools/*.ts modules; catches drift without bootstrapping the server at runtime
    │
    ├── storage/                 # Storage layer tests
        ├── cross-device-portability.test.ts  # 6 tests for cross-device portability (AC-5, AC-6 of WP-004): searchKnowledge() cross-store dedup by UUID insight id (first-seen wins), listKnowledge() cross-store dedup, and dynamic store discovery — adding a new store path to StoreRouter immediately exposes its .repositories.json and projects via listAllProjects() and getMergedRegistry() without any additional registration step (cross-device ledger sync plan, WP-004)
        ├── knowledge-store-exclusion.test.ts  # Tests that knowledge store paths are excluded from project storage operations
        ├── knowledge-store.test.ts  # KnowledgeStoreManager unit tests
        ├── ledger-store.test.ts # LedgerStore unit tests
        ├── list-all-projects.test.ts  # Tests for ledger_list_all_projects scan across all repo namespaces
        ├── migrate-namespaced.test.ts  # 10 tests: clean run, unknown fallbacks, idempotency, sentinel cleanup, move-failure, crash-resume
        ├── multi-store-conflicts.test.ts  # 8 tests for multi-store registry operations (AC-3, AC-4 of WP-004): getMergedRegistry() store-order priority — first store's entry for a duplicate repo id is returned, second store's suppressed; getRegistryConflicts() correctly designates winner_store_id; returns empty array when no cross-store duplicates exist (cross-device ledger sync plan, WP-004)
        ├── multi-store-manager.test.ts  # 11 tests for multi-store project listing and detection (AC-1, AC-2 of WP-004): listAllProjects() tags each project with store_id/store_label/store_path, detectProjectByCwd() returns MULTI_STORE_AMBIGUOUS with tagged candidates on cross-store cwd collision, forwards intra-store AMBIGUOUS only when no FOUND exists; plus regression — a valid FOUND from store-1 is not discarded by an intra-store AMBIGUOUS from store-2 (cross-device ledger sync plan, WP-004)
        ├── project-meta.test.ts  # 15 integration tests: writeProjectMeta (first write, status update, outcome_summary round-trip), readProjectMeta (validated return, missing file, malformed JSON, schema failure), auto-sync via writeRootIndex and updateWorkPackageWithSync; plus listAllProjects scan tests
        ├── repository-registry.test.ts  # 23 unit tests for src/storage/repository-registry.ts: AC-1 absent-file fallback, AC-2 valid parse + typed return, AC-3 atomic write via atomicWriteJson + withLock round-trip, AC-4 findByFolderName across all positions (first/middle/last), AC-5 null return on no match; plus edge cases: malformed JSON fallback, schema validation failure fallback, directory auto-creation, case-sensitive matching, defensive copy from getAllFolderNames(), degenerate duplicate folder name (returns first match), schema rejection on save with invalid slug
        ├── store-registry.test.ts      # Unit tests for src/storage/store-registry.ts (cross-device ledger sync plan, WP-001): resolveStoresConfigPath() path construction, expandStorePath() with ~/foo/• ~/• absolute/• relative paths, resolveGuiConfigPath() multi-store and single-store (null) modes, loadStoresConfig() null on absent file + null+stderr-warning on malformed JSON + null+stderr-warning on schema validation failure, saveStoresConfig() write-then-read round-trip via atomicWriteJson + withLock
        ├── store-router.test.ts        # 21 unit tests for StoreRouter (cross-device ledger sync plan, WP-003): all 6 ACs — legacy-mode delegation, store-order priority, first/second-only/both-stores routing, "not registered in any store" error; plus resolveStoreForRepo null return, resolveDefaultStore, getAllStorePaths defensive copy, isMultiStoreMode true/false; mkdirSync called for each configured store path on construction
        ├── store-context.test.ts       # 8 unit tests for store-context.ts singleton accessor (cross-device ledger sync plan, WP-005): getStoreRouter() and getMultiStoreManager() throw before init (tested in a 'before setStoreContext()' describe block that must remain first in the file — Vitest runs describe blocks sequentially so the singleton is undefined only because no setStoreContext() call has run yet); after-init tests: getStoreRouter()/getMultiStoreManager() return the set instances, legacy mode isMultiStoreMode()=false, multi-store mode isMultiStoreMode()=true, idempotent re-initialization (later calls overwrite), StoreRouter auto-creates configured directories on construction
        └── slug-resolution.test.ts  # Tests for slug resolution across project namespaces
    │
    ├── tools/                   # Tool-level tests
    │   ├── begin-work.test.ts
    │   ├── cancelled-status.test.ts
    │   ├── cascade-reblock.test.ts
    │   ├── claim-guard.test.ts
    │   ├── complete-pipeline-guards.test.ts
    │   ├── enrichment-resilience.test.ts
    │   ├── knowledge-help.test.ts   # Tests for ledger_list_insights help/diagnostic tool
    │   ├── knowledge.test.ts        # Tests for ledger_add_insight, ledger_search_insights, ledger_update_insight tools
    │   ├── knowledge-multi-store.test.ts  # 10 integration tests for multi-store knowledge routing (cross-device ledger sync plan, WP-009): addInsight global scope writes to default store (AC2), addInsight repository scope routes to claiming store (AC1), unregistered repo error (AC1), searchInsights cross-store merge with dedup (AC3), listInsights cross-store merge (AC4), updateInsight and deleteInsight iterate stores to locate insight (AC5)
    │   ├── list-projects.test.ts
    │   ├── meta-enrichment.test.ts
    │   ├── observations.test.ts
    │   ├── pipeline-duration.test.ts
    │   ├── pipeline.test.ts
    │   ├── project-lifecycle.test.ts
    │   ├── project-lifecycle-multi-store.test.ts  # 13 integration tests for multi-store project lifecycle (cross-device ledger sync plan, WP-007): ledger_list_projects tags projects from all stores with store_id/store_label (AC1), ledger_initialize_project routes to the correct store via StoreRouter (AC2), unregistered repo returns "not registered in any store" error (AC3), detectProject returns MULTI_STORE_AMBIGUOUS with tagged candidates on cross-store cwd collision (AC4), single-store / legacy mode behavior is unchanged (AC5)
    │   ├── reopen-cancelled-wp.test.ts  # 22 tests for ledger_reopen_cancelled_wp: PM-only guard, non-CANCELLED status guards, core side effects (dep-aware READY/BLOCKED branching, field clearing, counter adjustment, audit comment, pipeline history preservation), cascade reblock (READY and IN_PROGRESS downstream dependents), and state machine invariant preservation
    │   ├── rework-circuit-breaker.test.ts
    │   ├── runner-integration.test.ts  # 9 integration tests (WP-005 verification of WP-002 ACs): runner fields in root index response and on disk (AC1), runner fields in .meta.json (AC2), graceful 'unknown' default when getClientInfo() returns undefined (AC3), no runner info written to stdout (AC5); uses vi.mock hoisting to control getClientInfo() return value per test group; covers all four runner types (orchestrator, vscode, claude-code, unknown)
    │   ├── schema-integrity.test.ts
    │   ├── standalone-import.test.ts  # 18 tests for ledger_import_standalone: successful import (project creation, WP-001 structure, archival, cwd_path fallback, project_path precedence), all four validation error paths (no path, bad basename, missing plan.md, missing synthesis.md), duplicate slug rejection, outcome summary extraction with fallback, repo name derivation, and project_summary (root index persistence, .meta.json persistence, backward compatibility when omitted, schema rejection of empty strings)
    │   ├── start-pipeline-guards.test.ts
    │   ├── synthesis-terminal.test.ts
    │   ├── version-freshness.test.ts
    │   ├── work-package.test.ts
    │   ├── workflow-batch-actions.test.ts
    │   ├── workflow-handoff.test.ts
    │   ├── workflow-next-action.test.ts
    │   └── workflow-rework-loop.test.ts
    │
    └── utils/                   # Utility function tests
        ├── agent-registry.test.ts
        ├── derive-repo-name.test.ts
        ├── if-defined.test.ts
        ├── ledger-root.test.ts
        ├── path-validator.test.ts
        ├── project-resolver.test.ts
        ├── pipeline-maps.test.ts
        ├── progress.test.ts
        ├── project-reset.test.ts
        ├── runner.test.ts       # 10 unit tests for classifyRunner() (WP-005 verification of WP-001 ACs): all four output variants (vscode, claude-code, orchestrator, unknown), undefined input without throw, empty-string name, unrecognized client name, case-insensitive substring matching (vscode keyword, Claude uppercase, langchain variants), and raw runner_client/runner_version value preservation
        ├── store-resolution.test.ts  # 11 unit tests for extractLedgerRoot and resolveMultiStoreLedgerRoot: string input, object input, null input, undefined input, RequestHandlerExtra-shaped object (constraint-58 guard), test override short-circuit, store-context-not-initialized fallback, single-store mode fallback, registered repo resolution, unregistered repo fallback, and null project root
        ├── synthesis-parser.test.ts  # 17 unit tests for parseOutcomeSummary(): present (AC-1), fallback to first Implementation Summary bullet (AC-2), both absent returns null (AC-3), malformed input (AC-4), plus edge cases (empty section, multi-paragraph, whitespace-only body, asterisk bullets, h4 sub-headings, no-newline EOF); uses doc() helper to reduce boilerplate
        ├── timestamp.test.ts
        ├── workflow-helpers.test.ts
        ├── workflow-manifest.test.ts  # Structural invariants (34 tests)
        └── wp-id.test.ts
```

---

## Directory Annotations

### `src/schema/`

Centralized data structure definitions using Zod. All schemas are validated at runtime on reads and writes. TypeScript types are inferred from schemas, ensuring type/schema consistency.

### `src/storage/`

File I/O layer with atomicity and locking guarantees. `LedgerStore` is the primary abstraction — all tools should use it rather than reading/writing files directly.

### `src/tools/`

Each file exports a `register(server: McpServer)` function that registers one or more MCP tools. Tools are grouped by functional category (lifecycle, work packages, pipelines, observations, workflow).

The workflow tools are split across four files: `workflow.ts` (thin aggregator), `workflow-next-action.ts` (per-role single-action logic for `ledger_get_next_action`), `workflow-next-action-batch.ts` (batch/collector sub-module), and `workflow-handoff.ts` (`ledger_get_handoff_status`). Shared constants and pure helpers live in `src/utils/workflow-helpers.ts`.

## Generated/Ignored Directories

The following directories are not version-controlled:
- node_modules/ — npm dependencies
- dist/ — TypeScript compilation output
- storage/ledger/{repoName}/{slug}/ — per-project ledger runtime data (repo-namespaced since WP-002)


```
_SOURCE: GUI-layer file tree (annotated listing of GUI source files and their roles)_
# GUI-layer file tree (annotated listing of GUI source files and their roles)
```
// Structure of documents
└── mcp-server/
    └── gui/
        └── docs/
            └── agents/
                └── project-manifest/
                    └── file-tree.md

```
###  Path: `/mcp-server/gui/docs/agents/project-manifest/file-tree.md`

```md
# File Tree — MCP Server GUI

```
gui/
├── server.ts                    # HTTP server: routing, static files, CORS, security headers
├── api.ts                       # REST API handlers (projects, work packages, orchestrator, config)
├── api-stores.ts                # REST API handlers for /api/stores/* endpoints (gui-store-management plan); exports: handleGetStoresEnriched, handleAddStore, handleImportStore, handleUpdateStore, handleRemoveStore, handleSetDefaultStore, handleReorderStores, handleGetStoreConflicts; all write handlers call reloadStoreContext() after saveStoresConfig(); Git enrichment runs concurrently via Promise.all with 5 s timeout; handleGetStoreConflicts moved from api.ts
├── api-knowledge.ts             # REST API handlers (knowledge CRUD, promote, move)
├── api-models.ts                # REST API handlers (model registry, assignments, personas)
├── orchestrator-manager.ts      # Queue reader, preflight checks, process spawn/kill/dismiss
├── chunk-accumulator.ts         # Shared accumulation layer: all types (JsonValue, ToolCallChunk, MergedToolCall, ContentBlock, MergedMessage, NamespaceKey), JSONL parsing (isValidHeader, parseChunkLine), chunk merging (chunkId, chunkType, mergeContent, mergeToolCallChunks, mergeUsageMetadata), namespace helpers (namespaceKey, namespaceLabel), and accumulateChunks(); pure-function module, no I/O
├── chunk-renderer.ts            # Rendering layer: imports all types and accumulateChunks() from chunk-accumulator.ts; exports renderChunksToMarkdown (verbose, ## Role headings + JSON tool-call blocks), renderChunksToDialogue (compact chat-like, plain paragraphs, per-tool summary lines, hidden ToolMessages), renderChunksToStructured (structured DialogueBlock[] array for interactive frontend rendering), and renderChunksToText (prose-only extraction — AI text turns only, no tool calls; used by handleGetChunkText() for the /text endpoint; shares output format with scripts/extract-dialogue.js); also exports the DialogueBlock discriminated union type (text | tool-call | subagent-heading | checklist); pure-function module, no I/O
├── docs/
│   └── agents/
│       └── project-manifest/    # This manifest
└── public/                      # Static SPA assets (served as-is, no build step)
    ├── index.html               # Single HTML entry point (script loading order defined here)
    ├── styles.css               # Complete CSS: component library, layout, theming (2671 lines)
    ├── app.js                   # Bootstrap: Theme.init(), Router.init(), StaleCheck.init()
    ├── router.js                # Hash-based SPA router (Router namespace)
    ├── api-client.js            # Client-side API wrapper (API namespace)
    ├── utils.js                 # Shared utilities: escapeHtml, formatDate, breadcrumb, etc.    ├── components.js              # Shared UI render helpers (UI namespace): badge, banner, emptyState    ├── theme.js                 # Theme toggle logic (Theme namespace)
    ├── theme-init.js            # Early theme application (prevents FOUC; runs in <head>)
    ├── stale-check.js           # Background polling for server version mismatch (StaleCheck namespace)
    ├── views/                   # One JS file per SPA view/page
    │   ├── project-list.js      # Projects table with filtering, sorting, pagination
    │   ├── project-detail-helpers.js  # project-detail sub-module: pure helpers (extractSynopsis,
    │   │                              #   STAGE_ABBREV, buildPipelineTrack, buildRunBadges,
    │   │                              #   _findScrollAnchor, _snapshotProjectState, _diffProjectState)
    │   │                              #   STAGE_ABBREV is also consumed by work-package.js
    │   ├── project-detail-orch.js     # project-detail sub-module: orchestrator section
    │   │                              #   (renderOrchToolbar, renderRunsList, _orchRunsStructureKey,
    │   │                              #   _patchOrchStatusCard); uses globalThis._pdLogPreviewCleanups
    │   ├── project-detail-modal.js    # project-detail sub-module: Reset Project modal
    │   │                              #   (PIPELINE_STAGES, showResetModal)
    │   ├── project-detail.js    # Single project: WP table, plan synopsis, run controls (main)
    │   │                        #   Loads after helpers → orch → modal (see index.html)
    │   ├── work-package.js      # Work package detail: pipelines, acceptance criteria, dialogues
    │   ├── run-log.js           # Orchestrator run log viewer (streaming JSONL events)
    │   ├── orchestrator.js      # Orchestrator management: queue, start run, preflight
    │   ├── config.js            # GUI configuration editor coordinator; three tabs: General (auto_handoff_enabled, max_handoff_depth, capture_dialogues, auto_archive_days), Persona Models (delegated to config-persona-models.js), Model Registry (delegated to config-model-registry.js); module-level state: configActiveTab, configDirty (per-tab dirty flags); unsaved-changes guard (beforeTabSwitch) fires on tab navigation; calls pmWireEvents() and renderPersonaModelsTab() defined in config-persona-models.js; calls mrWireEvents() and renderModelRegistryTab() defined in config-model-registry.js
    │   ├── config-persona-models.js  # Persona Models tab module (loaded before config.js); all pm* state and functions: pmModels, pmPersonas, pmAssignments, pmOriginal, pmIsBuilding, pmCollapsed, pmReplaceOpen; pmCloneAssignments, pmHasChanges, pmModelName, pmDirtyDot, pmBuildModelOptions, pmRefreshTab, pmBuildTabHtml, pmWireEvents, pmDoSave, pmDoRebuild, renderPersonaModelsTab; supports per-persona model overrides, default model assignment, collapse/expand by suite, inline model replacement, and persona rebuild trigger; dirty state written to configDirty.personaModels; depends on API, UI, escapeHtml, configDirty (defined in config.js — safe forward-reference, accessed only inside function bodies)
    │   ├── config-stores.js     # Stores tab module (loaded before config.js); cs* state: csStores, csOriginal, csReorderMode, csModalMode, csModalStoreId, csModalCreateDir; functions: renderStoresTab(stores), csWireEvents(), csRenderStoreModal(mode, store), csRenderReorderView(stores), csRefreshTab(), csCloseModal(); immediate-write pattern — each action (add, remove, set default, edit, reorder) commits directly to the API with no batch-save step; modal unifies Add and Import via csModalCreateDir radio toggle; configDirty.stores always false; depends on API, UI, escapeHtml, configDirty
    │   ├── config-model-registry.js  # Model Registry tab module (loaded before config.js); all mr* state and functions: mrModels, mrOriginal, mrEditingId, MR_SLUG_REGEX; mrDeriveSlug, mrValidateSlug, mrCloneModels, mrHasChanges, mrDirtyDot, mrRenderRow, mrRenderEditRow, renderModelRegistryTab, mrRefreshTab, mrBuildTabHtml, mrWireEvents, mrRefreshDirtyDots (no-op stub — extension point), mrValidateAddSlug, mrShowAddSlugError, mrSyncSaveButton, mrDoSave, mrDoLoadDefaults; client-side duplicate-slug and empty-name guards; dirty state written to configDirty.modelRegistry; depends on API, UI, escapeHtml, crypto.randomUUID (browser built-in), configDirty (defined in config.js)
    │   ├── insights.js          # Cross-project comment aggregation view
    │   └── knowledge.js         # Knowledge base browser (global + repository scopes)
    ├── js/                      # Shared widget libraries
    │   └── orchestrator-widgets.js  # OrchestratorWidgets namespace (reusable UI components)
    └── libs/                    # Vendored third-party libraries
        └── marked.min.js        # Markdown parser (used for plan/synthesis/dialogue rendering)
```

---

## File Sizes (approximate)

| File | Lines | Role |
|------|-------|------|
| `server.ts` | ~1960 | Largest backend file — all routing logic lives here |
| `api.ts` | ~900 | Project/WP/config handlers |
| `api-knowledge.ts` | ~350 | Knowledge CRUD handlers |
| `api-models.ts` | ~590 | Model registry, assignment, and persona handlers |
| `orchestrator-manager.ts` | ~400 | Queue + preflight + spawn |
| `chunk-renderer.ts` | ~1100 | Pure JSONL → output (renderChunksToMarkdown + renderChunksToDialogue + renderChunksToStructured + renderChunksToText + DialogueBlock type) |
| `public/styles.css` | ~2670 | Complete CSS component library |
| `public/api-client.js` | ~350 | All API methods |
| `public/utils.js` | ~200 | Shared utility functions |
| `public/components.js` | ~80 | UI namespace (badge, banner, emptyState) |
| `public/js/orchestrator-widgets.js` | ~500 | Widget library |
| `public/views/project-detail-helpers.js` | ~240 | project-detail sub-module: pure helpers |
| `public/views/project-detail-orch.js` | ~310 | project-detail sub-module: orchestrator section |
| `public/views/project-detail-modal.js` | ~270 | project-detail sub-module: Reset Project modal |
| `public/views/project-detail.js` | ~1040 | project-detail main (trimmed; was ~1886 lines pre-decomposition) |
| `public/views/config.js` | ~191 | Config coordinator (General + tab routing; pm* extracted to config-persona-models.js, mr* to config-model-registry.js) |
| `public/views/config-persona-models.js` | ~619 | Persona Models tab module (all pm* state + functions) |
| `public/views/config-stores.js` | ~TBD | Stores tab module (all cs* state + functions; immediate-write pattern) |
| `public/views/config-model-registry.js` | ~606 | Model Registry tab module (all mr* state + functions) |

```