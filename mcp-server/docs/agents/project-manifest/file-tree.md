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
│   ├── api.ts               # REST API route handlers; runner_counts: Record-string-number; handleListProjects normalizes runner to unknown, supports sorting by runner; includes handleListChunks, handleGetChunkFile (chunk endpoints); includes orchestrator lifecycle handlers: handleOrchestratorStart, handleGetOrchestratorQueue, handleOrchestratorKill, handleOrchestratorDismiss, handleGetRunMetadata (reads plan_dir/.orchestrator-run.json — serves run provenance for the Resume Run button); knowledge handlers are NOT in this file — they were extracted to gui/api-knowledge.ts (WP-003)
│   ├── api-knowledge.ts     # GUI REST handlers for the /api/knowledge/* endpoints — extracted from gui/api.ts (WP-003); exports: KnowledgeUpdateBodySchema, KnowledgeMoveBodySchema, KnowledgeListParams interface, parseKnowledgeId helper, handleListKnowledge, handleUpdateKnowledge, handleDeleteKnowledge, handlePromoteKnowledge, handleMoveKnowledge; handlePromoteKnowledge and handleMoveKnowledge delegate to KnowledgeStoreManager.moveInsight() (atomic, no add→delete compose); re-exports ApiError for convenience; when query param is present, handleListKnowledge forwards tags, limit, and offset to searchInsights() — full-text search, tag filtering (AND semantics), and pagination can be combined in a single call
│   ├── api-repos.ts         # GUI REST handlers for the /api/repos and /api/repos/:repoId endpoints (WP-006); follows the domain-split pattern established by api-knowledge.ts; exports: RepoCreateBodySchema (@internal — test use only), RepoUpdateBodySchema (@internal — test use only), RepoListItem interface (list/get projection with has_vision boolean), handleListRepos, handleGetRepo, handleCreateRepo, handleUpdateRepo, handleDeleteRepo; re-exports ApiError for convenience; assertNoFolderNameConflicts() private helper enforces global folder_name uniqueness across all registry entries; toListItem() pure projection omits the vision object from list responses and computes has_vision = (at least one horizon field is non-null); handleCreateRepo returns HTTP 201 (intentional — wired in server.ts); handleDeleteRepo removes only the declaration, never project files
│   ├── chunk-renderer.ts    # renderChunksToMarkdown(jsonlContent) — pure JSONL→Markdown renderer; merges AIMessageChunk token fragments by id; groups by namespace; mirrors serialize_messages_to_markdown() output format
│   ├── server.ts            # Standalone Node.js HTTP server (node:http); two-tier routing: matchRoute() handles body-free routes (GET /api/knowledge, DELETE /api/knowledge/:id, POST /api/knowledge/:id/promote, GET /api/repos, GET /api/repos/:repoId, DELETE /api/repos/:repoId, plus all /:slug and /:repo/:slug GET routes); handleRequest() handles body-parsing routes (PATCH /api/knowledge/:id, POST /api/knowledge/:id/move, POST /api/repos [returns 201], PUT /api/repos/:repoId, PUT /api/config, POST /api/projects/:slug/reset, POST /api/orchestrator/start) and path-parameter extraction routes; resolveRepoName() private helper reads .meta.json to resolve canonical repository_name from a /:repo/:slug URL pair; serves static files from gui/public/
│   └── public/              # Static assets served by gui/server.ts
│       ├── index.html       # Dashboard SPA shell; nav links: Projects (#/), Insights (#/insights), Knowledge (#/knowledge), Orchestrator (#/orchestrator), Configuration (#/config); scripts load in dependency order: api-client → theme → router → utils → views → orchestrator-widgets → orchestrator.js → stale-check → app; loads theme-init.js in <head> for FOUC prevention (no inline scripts — CSP enforces script-src 'self')
│       ├── theme-init.js    # ES5 IIFE; reads localStorage key mcp-theme and sets data-theme="dark" on documentElement before first paint; plain ES5 (var, IIFE) intentional — no build step required; CSP script-src 'self' means this must remain a static file, not an inline script
│       ├── styles.css       # Full CSS; runner badge block: .badge-runner base class, .badge-runner-orchestrator, .badge-runner-vscode, .badge-runner-claude-code, .badge-runner-unknown with dark-mode overrides; orchestrator widget block: .orchestrator-status-card/header/body/elapsed/pid/progress-summary (OrchestratorWidgets.renderStatusCard), .orchestrator-kill-btn/.orchestrator-dismiss-btn (OrchestratorWidgets.renderKillButton/renderDismissButton — visual delegated to .btn.btn-danger/.btn.btn-secondary), .log-preview-entry (OrchestratorWidgets.renderLogPreview), .orchestrator-cli-reference h4/pre (OrchestratorWidgets.renderCliReference), .orch-status-cell (orchestrator.js queue table), .orch-active-run-section/.orch-cli-kill-hint (views/project-detail.js orchestrator section), `#orch-resume-cell` (resume button container; padding-bottom 8 px; WP-004), .btn-resume/.btn-resume:hover/.btn-resume:disabled (outlined primary-color resume button — hover fills background, disabled reduces opacity; WP-004), .section-title/.btn-icon (general utilities used by orchestrator views); dark-mode overrides for .orchestrator-status-card, .orchestrator-cli-reference, .log-preview-entry
│       ├── api-client.js    # API IIFE; buildQueryString(params) helper used by getProjects
│       ├── theme.js         # Theme IIFE; localStorage key mcp-theme; init() applies saved theme
│       ├── router.js        # Router IIFE; hash-based routing; dispatches '/' → renderProjectList, '/projects/*' → detail/plan/synthesis/WP/run-log views (pattern-matched first), then named singleton routes: '/config' → renderConfig, '/insights' → renderInsights, '/knowledge' → renderKnowledge, '/orchestrator' → renderOrchestrator; setPolling/clearPolling manage per-view auto-refresh; updateNavActive toggles active class on the matching nav link on each hash change
│       ├── utils.js         # Shared helpers: makeProjectCacheKey(repo, slug) [returns repo+'/'+slug; used by ProjectNameCache callers and breadcrumb().project()], escapeHtml, formatDate, statusBadge, formatDuration, showLoading, showError; ProjectNameCache IIFE — bounded 200-entry FIFO singleton; composite `repo/slug` key→displayName store used by breadcrumb().project(); API: set(key, name), get(key) [slug-fallback on miss], _size() [test-only]; breadcrumb() fluent builder: .projects()/.project(repo, slug)/.leaf(label)/.leafSpan(label, id)/.html()
│       ├── app.js           # Bootstrap entry point: Theme.init(); Router.init(); StaleCheck.init()
│       ├── stale-check.js   # StaleCheck IIFE; init() polls API.getServerInfo() immediately then every 30 s; injects .stale-banner into document.body before <header> on stale:true; stops polling after banner; silently continues on network errors
│       ├── views/
│   │   ├── project-list.js    # renderProjectList — status filter, search, sortable columns, archive/unarchive/delete row buttons, pagination, 10s polling; all project row links and action-menu View links use namespaced `#/projects/{repo}/{slug}` form (WP-009); API delete/archive/unarchive calls pass (repo, slug); projects with null repository_name render as read-only rows (no link, no View action) with a console.warn — action buttons still appear but are silently skipped with console.error on click; ProjectNameCache populated with `repo/slug` key per row; runner filter dropdown (RUNNER_STORAGE key mcp-runner-filter, buildRunnerOptions() dynamically filters runner_counts to count only — fixed: previously hardcoded all 4 types; preserves stale localStorage selections as zero-count entry); runnerBadge() renders .badge.badge-runner.badge-runner-{type} — fixed: previously emitted badge-unknown instead of badge-runner-unknown; runnerLabel() unused — cleanup candidate; sortable Runner column
│   │   ├── project-detail.js  # extractSynopsis, renderPlan(app, repo, slug), renderSynthesis(app, repo, slug), renderProjectDetail(app, repo, slug); STAGE_ABBREV, buildPipelineTrack; showResetModal(repo, slug, diagnosis, options); archive banner; all API calls and internal links use namespaced (repo, slug) form (WP-013)
│   │   ├── work-package.js    # WP_DEFAULT_STAGES, buildWpDetailBar, renderWorkPackageDetail
│   │   ├── config.js          # renderConfig — auto_handoff_enabled, max_handoff_depth, auto_archive_days
│   │   ├── insights.js        # renderInsights — project health stats; 15 s polling
│   │   ├── knowledge.js       # renderKnowledge — Knowledge page (#/knowledge); tab navigation (Global/Repository scopes); client-side filtering by category, repository_name (Repository tab only), and free-text query; formatConfidence() helper with named bucket constants (0.0–0.3 low / 0.3–0.7 medium / 0.7–1.0 high); card-level Edit (inline form with in-card error display), Delete (inline confirmation), Promote to Global, and Move to Repository actions; buildKnowledgeHtml() — renders insight cards with escapeHtml() on all dynamic values; no polling (knowledge is human-curated)
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
│   │   ├── enums.ts             # Status enums derived from shared/workflow-manifest.json
│   │   ├── knowledge.ts         # InsightScope ('global'|'repository'), SLUG_REGEX, InsightSchema / Insight (fields: id, scope, repository_name?, origin_plan?, title, content, category, tags, source, created_at, updated_at?, confidence, superseded_by?), KnowledgeStoreSchema / KnowledgeStore — Zod schemas for the knowledge accumulation system (WP-001)
│   │   ├── project-meta.ts      # ProjectMetaSchema / ProjectMeta — per-project .meta.json
│   │   ├── repository-registry.ts  # StrategicVisionSchema / StrategicVision (three-horizon nullable string fields), RepositoryEntrySchema / RepositoryEntry (id, label, folder_names, vision, created_at, last_modified), RepositoryRegistrySchema / RepositoryRegistry ({ repositories: RepositoryEntry[] }) — Zod schemas for the .repositories.json central registry; empty repositories array is valid (first-run scenario)
│   │   ├── root-index.ts        # RootIndex schema
│   │   ├── validators.ts        # Business rule validators
│   │   ├── workflow-manifest-schema.ts  # Zod schema for shared/workflow-manifest.json
│   │   └── work-package.ts      # WorkPackageDetail schema
│   │
│   ├── storage/                 # File I/O abstractions
│   │   ├── atomic-writer.ts     # Atomic write-to-temp-then-rename
│   │   ├── file-lock.ts         # File locking with proper-lockfile
│   │   ├── knowledge-store.ts   # KnowledgeStoreManager — all CRUD/query operations for the .knowledge/ store: addInsight, searchInsights, listInsights, updateInsight, deleteInsight, moveInsight; atomic cross-store move via single withLock(knowledgeDir()) span (WP-002); reads are lock-free (WP-001/002)
│   │   ├── ledger-store.ts      # Central storage abstraction; static methods: listAllProjects() (two-level namespace scan), detectProjectByCwd(), listProjectsByFolderNames(folderNames, ledgerRoot?) — targeted O(folders×projects) scan used by repository-context.ts; instance methods: read/write root index, WP detail, project meta, archiving, atomic sync helpers
│   │   ├── migrate-namespaced.ts  # One-shot startup migration: flat {slug}/ → namespaced {repoName}/{slug}/; exports migrateToNamespacedLayout()
│   │   └── repository-registry.ts  # Plain-function storage module for the central .repositories.json registry; exports loadRegistry(ledgerRoot) — reads and parses the registry, returns { repositories: [] } on absent file, malformed JSON, or schema validation failure (all three error paths silently degrade to an empty registry — intentional lossy-fallback contract); saveRegistry(ledgerRoot, registry) — validates via RepositoryRegistrySchema then writes atomically under withLock(ledgerRoot); findByFolderName(registry, folderName) — pure synchronous O(n×m) lookup, no I/O; getAllFolderNames(entry) — returns a defensive copy of entry.folder_names; consumed by WP-005 (repository-context.ts) and WP-006 (api-repos.ts) via resolveLedgerRoot()
│   │
│   ├── tools/                   # MCP tool implementations
│   │   ├── help.ts              # ledger_help
│   │   ├── help-content.ts      # TOOL_HELP: static documentation strings for all 30 MCP tools
│   │   ├── knowledge.ts         # ledger_add_insight, ledger_search_insights, ledger_list_insights, ledger_update_insight — knowledge accumulation tools; formatInsightId() helper (KN-NNNN format) (WP-001/003)
│   │   ├── observations.ts      # ledger_add_observation, ledger_add_project_comment
│   │   ├── pipeline.ts          # ledger_start_pipeline, ledger_complete_pipeline, ledger_cancel_pipeline, ledger_update_pipeline_progress
│   │   ├── project-lifecycle.ts # ledger_detect_project, ledger_get_project_status, ledger_initialize_project, ledger_list_projects, ledger_complete_synthesis
│   │   ├── repository-context.ts  # ledger_get_repository_context — returns a compact project timeline with curated outcome summaries, knowledge-base insights, and strategic vision for a repository; exports register(server) and _internal (test-only: GetRepositoryContextSchema, getRepositoryContext, safeListRepositoryInsights); handler: resolves repository name (repository_name takes precedence over cwd_path), consults .repositories.json registry, aggregates projects from all declared folder_names via LedgerStore.listProjectsByFolderNames(), sorts by date_created desc, caps at max_projects, optionally queries global + repository-scoped knowledge store via safeListRepositoryInsights() (slug-validation errors suppressed — returns [] for invalid SLUG_REGEX names and the reserved "global" name; genuine I/O errors are re-thrown); deduplicates combined insights by numeric id (global-first, first-seen wins); field always present in response: relevant_insights[] (empty array when include_insights: false) (WP-005)
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
│       ├── timestamp.ts           # Timestamp formatting
│       ├── workspace-versions.ts  # captureWorkspaceVersions() — reads mcpServer, personas, orchestrator versions from disk
│       └── wp-id.ts             # Work package ID formatting (WP-###)
│
└── tests/                       # Test suites
    ├── gui-server.test.ts       # 10 tests for resolveRepoName() in gui/server.ts: 9 guard-failure cases (traversal, empty, uppercase, hyphens, separators for both repoUrlParam and slugUrlParam) + 1 positive case confirming the guard passes valid inputs
    ├── helpers/                 # Shared test utilities (NEVER write to production storage)
    │   ├── create-temp-store.ts # createTempStore() / cleanupTempStore() helpers
    │   ├── fixtures.ts          # makeWorkPackageDetail(), makePipeline(), makeWorkPackageSummary()
    │   └── test-utils.ts        # injectLedgerDir(), nowFloor()
    │
    ├── gui/                     # GUI and config module tests
    │   ├── api-run-metadata.test.ts  # 17 tests across two describe blocks: (1) 10 handler-level tests for handleGetRunMetadata: HTTP 200 with parsed metadata (AC-1), HTTP 404 when file absent (AC-2), HTTP 404 when project has no plan_path (AC-3), HTTP 400 for unsafe slug (AC-4), file path constructed as path.join(planPath, '.orchestrator-run.json') (AC-5) — real temp dirs + LedgerStore fixtures; (2) 7 HTTP-level integration tests for the namespaced GET /api/projects/:repo/:slug/run-metadata route (added WP-002): 2 happy-path 200 tests (AC-NS-1), 2 not-found 404 tests for unknown repo/slug (AC-NS-2), 3 path-traversal 404 tests for '..' in repo or slug segments and URL-encoded slash (AC-NS-3) — uses handleRequest() via a real HTTP server, mirroring the run-log-server.test.ts pattern; writeNamespacedProject() fixture enforces YYYY-MM-DD-name planPath basename constraint required by LedgerStore constructor
    │   ├── api-client.test.ts  # jsdom + vm.runInThisContext unit tests for gui/public/api-client.js — covers run log, server-info, orchestrator, and knowledge API methods; ⚠ 5 knowledge-related tests currently FAILING: the test file still uses the old project_slug / source_project_slug field names and scope:'project' terminology from before the repository-scope migration (WP-008); api-client.js was updated to repository_name / source_repository_name in WP-008 commit 3ede3e3 but this test file was not updated at the same time — tracked as a backlog item (acknowledged in WP-010 QA and code review); ⚠ missing coverage: `getRunMetadata(slug)` and the three-argument form `orchestratorStart(planPath, dryRun, resumeThreadId)` are not tested in this file — both were added in WP-004; tracked as a follow-up test gap (noted in WP-004 QA and code review)
    │   ├── stale-check.test.ts  # 10 unit tests for StaleCheck IIFE (jsdom + vm.runInThisContext + fake timers): immediate poll, 30 s interval, banner insertion before <header>, changed-component listing, polling stop after banner, silent error handling
    │   ├── api-reset.test.ts    # Integration tests for handleResetProject (13 tests)
    │   ├── api-wp-overview.test.ts  # Unit tests for handleGetWorkPackageOverview (21 tests)
    │   ├── api.test.ts          # Unit tests for gui/api.ts; includes 6 handleListProjects runner filter tests (WP-005 verification of WP-003 ACs): runner field present and 'unknown' default for projects without stored runner (AC1), runner_counts object shape and values (AC1), runner=orchestrator filter returns only matching projects (AC2), runner_counts unaffected by active runner filter (AC3), runner:'unknown' filter returns projects with no stored runner field (AC4), unrecognized runner query returns empty set without 500 error (AC5), and combined status+runner filter
    │   ├── auto-archive.test.ts # Unit tests for src/gui/auto-archive.ts (14 tests)
    │   ├── client-rendering.test.ts
    │   ├── config.test.ts       # Unit tests for src/gui/config.ts
    │   ├── dialogue-qa.test.ts
    │   ├── handoff-config-integration.test.ts  # Integration: runtime config changes affect buildHandoffResponse
    │   ├── log-resolver.test.ts
    │   ├── api-orchestrator.test.ts  # 23 unit tests for the 4 orchestrator API handlers: planPath validation (missing, number, null, non-object body), dryRun forwarding (true/false/default), queue enrichment shape, kill result { killed: boolean }, dismiss void resolution, assertSafeQueueId guard (empty/slash/double-dot rejection)
    │   ├── api-knowledge.test.ts  # Unit tests for gui/api-knowledge.ts handlers (WP-003); imports from ../../gui/api-knowledge.js; complements knowledge-api.test.ts
│   ├── api-repos.test.ts      # 46 tests for gui/api-repos.ts handlers (WP-006): AC-1 (GET /api/repos — returns RepoListItem[] with has_vision boolean), AC-2 (POST /api/repos — SLUG_REGEX validation, unique id, unique folder_names, HTTP 201), AC-3 (PUT /api/repos/:repoId — partial update, self-conflict allowed, last_modified stamped), AC-4 (DELETE /api/repos/:repoId — removes entry only, releases folder_names, no project data deleted), AC-5 (GET /api/repos/:repoId — returns RepositoryEntry or 404), AC-6 (folder_name uniqueness — assertNoFolderNameConflicts rejects create/update that would conflict across entries); real temp dirs + RegistryRegistry fixtures; zero mocks for storage layer
    │   ├── knowledge-api.test.ts  # Unit tests for the 5 knowledge REST handlers (handleListKnowledge, handleUpdateKnowledge, handleDeleteKnowledge, handlePromoteKnowledge, handleMoveKnowledge): imports handlers from ../../gui/api-knowledge.js (updated WP-003); real temp directories + KnowledgeStoreManager fixtures; covers scope disambiguation (global vs repository), ID validation (parseKnowledgeId — non-integer, zero, float rejection), VALIDATION_ERROR/NOT_FOUND paths, promote/move cross-store ID-change semantics; WP-001 added 3 scope-validation tests for handleListKnowledge; WP-004 added 4 repository_name format-validation tests (AC-1 through AC-4 rework) for handleDeleteKnowledge and handlePromoteKnowledge
    │   ├── knowledge-repository-scope.test.ts  # Integration tests for repository-scope knowledge functionality across two layers (WP-010, updated WP-001/WP-004): storage layer — repositoryStorePath path generation and reserved-name guard, addInsight with repository scope, readRepositoryStore empty/populated, listInsights unfiltered/scope-filtered/name-filtered, searchInsights with repository_name, updateInsight and deleteInsight with repository scope, moveInsight global→repo/repo→repo/same-name rejection, origin_plan preservation through add+update+move; GUI REST handlers — handleListKnowledge with repository_name, handleUpdateKnowledge with repository scope, handleDeleteKnowledge success and missing-repository_name, handlePromoteKnowledge from repository (success) and from global (rejection), handleMoveKnowledge global→repo/same-repo rejection/missing-target rejection, scope:'project' rejection by all 5 handlers (VALIDATION_ERROR — handleListKnowledge now throws VALIDATION_ERROR for unrecognised scope per WP-001; handleDeleteKnowledge and handlePromoteKnowledge throw VALIDATION_ERROR for malformed repository_name per WP-004); real temp dirs + KnowledgeStoreManager — no mocks; follows knowledge-api.test.ts patterns
    │   ├── server-knowledge-routes.test.ts  # 40 HTTP-level routing integration tests for the 5 knowledge endpoints in gui/server.ts: verifies body-free routes (GET, DELETE, POST /promote) are dispatched via matchRoute() and body-parsing routes (PATCH, POST /move) via handleRequest() special cases; covers AC-1 through AC-7 — oversized body (413), invalid JSON (400), missing/invalid scope (400), float/zero/non-numeric IDs (400), missing repository_name when scope=repository (400), 404 for absent insights, route isolation (no interference with /api/insights, /api/projects)
    │   ├── orchestrator-manager.test.ts  # 77 tests: getQueue() lifecycle transitions (AC-1 through AC-6), formatProgressEntry() (11 event types), progress resolution (WP-005); killQueueEntry()/dismissQueueEntry() lifecycle gates, SIGTERM→SIGKILL flow, TOCTOU ESRCH handling, queue-file removal, lock-file cleanup; PID validation (negative/zero/float rejection) (WP-006); 7 lastAction/logFilename population cases (WP-003 AC-6)
    │   ├── orchestrator-widgets.test.ts  # 41 tests: OrchestratorWidgets functions, all 7 ACs + 7 refined variants; vm.runInThisContext + jsdom, fake timers for renderLogPreview (WP-010)
    │   ├── project-list.test.ts  # 5 jsdom + vm.runInThisContext unit tests for views/project-list.js — buildTable() rendering; loads utils.js, api-client.js, project-list.js via vm.runInThisContext; covers: clickable link for projects with repository_name (AC-7), read-only name cell for null repository_name (AC-7), ProjectNameCache populated with composite repo/slug key (AC-7), action-menu wrapper carries data-repo and data-slug attributes (AC-7), action-menu handler skips when data-repo is empty (AC-7); fake fetch stub; no real HTTP calls
    │   ├── project-detail-runs.test.ts
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
    │   ├── validators.test.ts
    │   └── work-package-schema.test.ts  # Zod parse-level tests (24 tests)
    │
    ├── storage/                 # Storage layer tests
        ├── knowledge-store-exclusion.test.ts  # Tests that knowledge store paths are excluded from project storage operations
        ├── knowledge-store.test.ts  # KnowledgeStoreManager unit tests
        ├── ledger-store.test.ts # LedgerStore unit tests
        ├── list-all-projects.test.ts  # Tests for ledger_list_all_projects scan across all repo namespaces
        ├── migrate-namespaced.test.ts  # 10 tests: clean run, unknown fallbacks, idempotency, sentinel cleanup, move-failure, crash-resume
        ├── project-meta.test.ts  # 15 integration tests: writeProjectMeta (first write, status update, outcome_summary round-trip), readProjectMeta (validated return, missing file, malformed JSON, schema failure), auto-sync via writeRootIndex and updateWorkPackageWithSync; plus listAllProjects scan tests
        ├── repository-registry.test.ts  # 23 unit tests for src/storage/repository-registry.ts: AC-1 absent-file fallback, AC-2 valid parse + typed return, AC-3 atomic write via atomicWriteJson + withLock round-trip, AC-4 findByFolderName across all positions (first/middle/last), AC-5 null return on no match; plus edge cases: malformed JSON fallback, schema validation failure fallback, directory auto-creation, case-sensitive matching, defensive copy from getAllFolderNames(), degenerate duplicate folder name (returns first match), schema rejection on save with invalid slug
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
    │   ├── list-projects.test.ts
    │   ├── meta-enrichment.test.ts
    │   ├── observations.test.ts
    │   ├── pipeline-duration.test.ts
    │   ├── pipeline.test.ts
    │   ├── project-lifecycle.test.ts
    │   ├── reopen-cancelled-wp.test.ts  # 22 tests for ledger_reopen_cancelled_wp: PM-only guard, non-CANCELLED status guards, core side effects (dep-aware READY/BLOCKED branching, field clearing, counter adjustment, audit comment, pipeline history preservation), cascade reblock (READY and IN_PROGRESS downstream dependents), and state machine invariant preservation
    │   ├── rework-circuit-breaker.test.ts
    │   ├── runner-integration.test.ts  # 9 integration tests (WP-005 verification of WP-002 ACs): runner fields in root index response and on disk (AC1), runner fields in .meta.json (AC2), graceful 'unknown' default when getClientInfo() returns undefined (AC3), no runner info written to stdout (AC5); uses vi.mock hoisting to control getClientInfo() return value per test group; covers all four runner types (orchestrator, vscode, claude-code, unknown)
    │   ├── schema-integrity.test.ts
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

