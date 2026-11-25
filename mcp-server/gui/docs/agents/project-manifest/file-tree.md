# File Tree — MCP Server GUI

```
gui/
├── server.ts                    # HTTP server: routing, static files, CORS, security headers
├── api.ts                       # REST API handlers (projects, work packages, orchestrator, config)
├── api-stores.ts                # REST API handlers for /api/stores/* endpoints (gui-store-management plan); exports: handleGetStoresEnriched, handleAddStore, handleImportStore, handleUpdateStore, handleRemoveStore, handleSetDefaultStore, handleReorderStores, handleGetStoreConflicts; all write handlers call reloadStoreContext() after saveStoresConfig(); Git enrichment runs concurrently via Promise.all with 5 s timeout; handleGetStoreConflicts moved from api.ts
├── api-knowledge.ts             # REST API handlers (knowledge CRUD, promote, move)
├── api-tasks.ts                 # REST API handlers for /api/tasks* (list, create, update, delete, reorder); thin layer over src/storage/task-collection.ts; body schemas are .strict(); error messages never carry a filesystem path
├── api-models.ts                # REST API handlers (model registry, assignments, personas); private nameMappingPath() delegates to resolveNameMappingPath() in src/utils/name-mapping.ts — the single owner of that path derivation inside mcp-server
├── setup-notices.ts             # REST API handler for GET /api/setup-notices (untrack-name-mapping plan, WP-002); exports: SetupNotice type, detectSetupNotices() (pure, synchronous; today returns the single personas-not-built notice with a rebuild-personas action when isNameMappingPresent() is false), handleGetSetupNotices() (wraps detectSetupNotices() in { notices })
├── api-error-codes.ts           # REST API handlers for /api/error-codes/* endpoints (error-code-generator plan, WP-011); exports: handleListErrorCodeProviders, handleGetErrorCodeConfig, handleUpdateErrorCodeConfig, handleTestErrorCodeProvider, handleListTemporaryErrorCodesGui; every route is guarded by requireLoopbackRequest (route-guards.ts), PUT/POST additionally by requireJsonContentType; the test handler never calls a provider's allocate — only test, else peek
├── route-guards.ts              # RouteGuard implementations (error-code-generator plan, WP-011); exports: requireLoopbackRequest (socket-level req.socket.remoteAddress loopback check as the primary, non-spoofable gate, then Host, then Origin when present), requireJsonContentType; both throw ApiError to reject
├── orchestrator-manager.ts      # Queue reader, preflight checks, process spawn/kill/dismiss
├── chunk-accumulator.ts         # Shared accumulation layer: all types (JsonValue, ToolCallChunk, MergedToolCall, ContentBlock, MergedMessage, NamespaceKey), JSONL parsing (isValidHeader, parseChunkLine), chunk merging (chunkId, chunkType, mergeContent, mergeToolCallChunks, mergeUsageMetadata), namespace helpers (namespaceKey, namespaceLabel), and accumulateChunks(); pure-function module, no I/O
├── chunk-renderer.ts            # Rendering layer: imports all types and accumulateChunks() from chunk-accumulator.ts; exports renderChunksToMarkdown (verbose, ## Role headings + JSON tool-call blocks), renderChunksToDialogue (compact chat-like, plain paragraphs, per-tool summary lines, hidden ToolMessages), renderChunksToStructured (structured DialogueBlock[] array for interactive frontend rendering), and renderChunksToText (prose-only extraction — AI text turns only, no tool calls; used by handleGetChunkText() for the /text endpoint; shares output format with scripts/extract-dialogue.js); also exports the DialogueBlock discriminated union type (text | tool-call | subagent-heading | checklist); pure-function module, no I/O
├── docs/
│   └── agents/
│       └── project-manifest/    # This manifest
└── public/                      # Static SPA assets (served as-is, no build step)
    ├── index.html               # Single HTML entry point (script loading order defined here)
    ├── styles.css               # Complete CSS: component library, layout, theming (2671 lines)
    ├── app.js                   # Bootstrap: Theme.init(), Router.init(), StaleCheck.init(), SetupNotices.init()
    ├── router.js                # Hash-based SPA router (Router namespace)
    ├── api-client.js            # Client-side API wrapper (API namespace)
    ├── utils.js                 # Shared utilities: escapeHtml, formatDate, breadcrumb, etc.    ├── components.js              # Shared UI render helpers (UI namespace): badge, banner, emptyState    ├── theme.js                 # Theme toggle logic (Theme namespace)
    ├── theme-init.js            # Early theme application (prevents FOUC; runs in <head>)
    ├── safe-markdown.js         # SafeMarkdown namespace: escapes raw HTML, allow-lists link schemes, images become links (loaded directly after libs/marked.min.js)
    ├── stale-check.js           # Background polling for server version mismatch (StaleCheck namespace)
    ├── setup-notices.js         # Global setup-notices banner (SetupNotices namespace; untrack-name-mapping plan, WP-004): polls GET /api/setup-notices via API.getSetupNotices(), renders a #setup-notices live region (role=status/aria-live=polite) before <header> and after .stale-banner when present; one .setup-banner per notice with a "Build personas" button for rebuild-personas actions, a disabled "Building…"/"Build already running…" (409) state, and a <details>/<summary> failure block reusing .pm-build-error-pre; polling runs only while notices exist, pauses on document.hidden, resumes with an immediate refresh on visibility; exposes only init()/refresh() — views/config-persona-models.js's pmDoRebuild() calls the latter (guarded by window.SetupNotices) on a successful rebuild, the one-way coupling this module keeps with any view
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
    │   ├── config.js            # GUI configuration editor coordinator; CONFIG_TABS array is the single source of truth for which tabs exist and how to render/leave/reset each one (five descriptors: general, stores, personaModels, modelRegistry, errorCodes — { key, label, render, leave, reset }); configFindTab(key) looks up a descriptor; config.js never reads or writes another module's cs-/mr-/pm-/ec-prefixed fields directly — only through a descriptor's three functions; module-level state: configActiveTab, configDirty (per-tab dirty flags, including configDirty.errorCodes); the tab-bar click handler runs the unsaved-changes confirm() guard, then calls the left tab's leave(discarded) unconditionally; renderConfigPage() resets every configDirty key and calls every descriptor's reset(); adding a sixth tab means adding one CONFIG_TABS descriptor (see GUI constraint §25 "Config Tab Modules")
    │   ├── config-persona-models.js  # Persona Models tab module (loaded before config.js; registered in CONFIG_TABS as { render, leave: pmLeaveTab, reset: pmResetState }); all pm* state and functions: pmModels, pmPersonas, pmAssignments, pmOriginal, pmIsBuilding (spans visits — never reset by pmLeaveTab/pmResetState, always cleared by pmDoRebuild's own callback even when stale), pmCollapsed, pmReplaceOpen, pmVisit (monotonic visit token); pmCloneAssignments, pmHasChanges, pmModelName, pmDirtyDot, pmBuildModelOptions, pmRefreshTab, pmBuildTabHtml, pmWireEvents, pmDoSave, pmDoRebuild, renderPersonaModelsTab, pmLeaveTab(discarded) (increments pmVisit; resets pmModels/pmOriginal/pmCollapsed/pmReplaceOpen only when discarded is true, since page-load arguments are not refreshed after a save), pmResetState() (full reset, calls pmLeaveTab(true)); every async call site (pmDoSave, pmDoRebuild and its nested refresh, pmWireEvents callbacks) captures pmVisit and bails out when stale; supports per-persona model overrides, default model assignment, collapse/expand by suite, inline model replacement, and persona rebuild trigger; dirty state written to configDirty.personaModels; depends on API, UI, escapeHtml, configDirty (defined in config.js — safe forward-reference, accessed only inside function bodies); pmDoRebuild()'s success callback calls window.SetupNotices.refresh() (guarded) unconditionally — before its own pmVisit staleness check — so the global setup-notices banner clears even when the tab itself was left; the pre-build state's button/message read "Build personas" / "generated locally, not in Git" (untrack-name-mapping plan, WP-004), while the stale-banner and action-bar rebuild buttons keep "Rebuild Personas" (they address an already-built persona set, not the first-build gap)
    │   ├── config-stores.js     # Stores tab module (loaded before config.js; registered in CONFIG_TABS as { render, leave: csResetState, reset: csResetState } — Stores has no "keep state unless discarded" case, so leave and reset are the same function); cs* state: csStores, csOriginal, csReorderMode, csModalMode, csModalStoreId, csModalCreateDir, csVisit (monotonic visit token); functions: renderStoresTab(stores), csWireEvents(), csRenderStoreModal(mode, store), csRenderReorderView(stores), csRefreshTab(), csResetState() (increments csVisit, closes the modal via the shared closeModal(), removes csClickHandler, resets every cs* field); every async callback (csHandleModalSave, csRefreshTab, the delete/sync handlers in csWireEvents, csMoveStore) captures csVisit before its request and returns early in both .then and .catch when stale; immediate-write pattern — each action (add, remove, set default, edit, reorder) commits directly to the API with no batch-save step; modal unifies Add and Import via csModalCreateDir radio toggle; configDirty.stores always false; depends on API, UI, escapeHtml, configDirty
    │   ├── config-model-registry.js  # Model Registry tab module (loaded before config.js; registered in CONFIG_TABS as { render, leave: mrLeaveTab, reset: mrResetState }); all mr* state and functions: mrModels, mrOriginal, mrEditingId, MR_SLUG_REGEX, mrVisit (monotonic visit token); mrDeriveSlug, mrValidateSlug, mrCloneModels, mrHasChanges, mrDirtyDot, mrRenderRow, mrRenderEditRow, renderModelRegistryTab, mrRefreshTab, mrBuildTabHtml, mrWireEvents, mrRefreshDirtyDots (no-op stub — extension point), mrValidateAddSlug, mrShowAddSlugError, mrSyncSaveButton, mrDoSave, mrDoLoadDefaults (both guarded by mrVisit, capturing it before the request and checking it in both .then and .catch), mrLeaveTab(discarded) (increments mrVisit; resets mrModels/mrOriginal/mrEditingId only when discarded is true, mirroring Persona Models' stale-page-load-argument rationale), mrResetState() (full reset, calls mrLeaveTab(true)); client-side duplicate-slug and empty-name guards; dirty state written to configDirty.modelRegistry; depends on API, UI, escapeHtml, crypto.randomUUID (browser built-in), configDirty (defined in config.js)
    │   ├── config-tasks.js      # Tasks tab module (loaded before config.js; registered in CONFIG_TABS as { render: ctRenderTab, leave: ctResetState, reset: ctResetState }); ct* state: ctVisit, ctConfig, ctSaveInFlight; ctValidate mirrors the server schema; saves via API.updateConfig
    │   ├── config-error-codes.js  # Error Codes tab module (loaded before config.js; error-code-generator plan, WP-013; registered in CONFIG_TABS as { render, leave: ecResetState, reset: ecResetState }); ec* state and functions: ecProviders, ecConfig, ecConfigWarning (the config response's `warning` — salvaged/corrupt/unreadable config.json — rendered as an escaped error banner above the settings form, cleared by ecResetState() and after a successful save), ecTemporaryCodes, ecTemporaryWarning, ecTestInFlight, ecSaveInFlight, ecVisit (visit token guarding every async callback; the reference implementation all other config-*.js tab modules' own visit tokens follow); ecResetState() — the tab's own reset, called by CONFIG_TABS; EC_TEMPORARY_PREFIX_PATTERN (mirror of the server's prefix rule); descriptor-driven form renderer (ecRenderField) dispatching on every SettingField type (string/path/url/secret/integer/boolean/select, unknown type falls back to text); secret-field contract (password input, autocomplete="new-password", never pre-filled, Set/Not-set text indicator, Clear-stored-value checkbox feeding clear_secrets); plugins panel (directory + copy button, installed plugins, load errors, empty state); temporary-codes list; ecRenderTab, ecWireEvents, ecCleanup, ecHandleSave, ecHandleTestClick, ecHandleProviderChange; dirty state written to configDirty.errorCodes; Save/Test results written to a dedicated aria-live="polite" region; lazy-loads its data on first tab activation rather than joining renderConfig()'s Promise.all; depends on API, UI, escapeHtml, configDirty (defined in config.js — safe forward-reference, accessed only inside function bodies)
    │   ├── tasks-model.js       # TasksModel namespace: pure ES5 filtering, sorting, paging, reorder maths and palette navigation for the Tasks view; mirrors src/schema/task.ts and task-collection.ts (see constraints §28)
    │   ├── tasks-render.js      # TasksRender namespace: pure string builders for the Tasks view (filter bar, toolbar, rows, colour cell and palette, reference cell, draft, store menu, pagination, empty state); escapes with escapeHtml and SafeMarkdown, colours via tc-{id} classes only
    │   ├── tasks.js             # Tasks view controller (renderTasks(app)); load-all via API.getTasks(), client-side filter/sort/paging through TasksModel, markup from TasksRender; tasksPersist module state (filter, sort, page, page size); roving tabindex, keyboard map, inline edit, create flow, delete arm, completion, tags, store_errors banner, visibilitychange refetch; loaded after tasks-model.js and tasks-render.js
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
| `setup-notices.ts` | ~70 | Detects post-clone/post-pull setup gaps (e.g. personas not built) for the GUI banner |
| `api-error-codes.ts` | ~400 | Error-code provider config, test-connection, and temporary-code-log handlers |
| `route-guards.ts` | ~110 | Loopback and JSON-Content-Type request guards |
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
| `public/views/config.js` | ~191 | Config coordinator (General + tab routing; pm* extracted to config-persona-models.js, mr* to config-model-registry.js, ec* to config-error-codes.js) |
| `public/views/config-persona-models.js` | ~619 | Persona Models tab module (all pm* state + functions) |
| `public/views/config-stores.js` | ~TBD | Stores tab module (all cs* state + functions; immediate-write pattern) |
| `public/views/config-model-registry.js` | ~606 | Model Registry tab module (all mr* state + functions) |
| `public/views/config-tasks.js` | ~TBD | Tasks tab module (all ct* state + functions; ticket base URL, default queue and page size form, saved via `API.updateConfig`) |
| `public/views/tasks.js` | ~1140 | Tasks view controller (`renderTasks`; state, events, server calls) |
| `public/views/config-error-codes.js` | ~TBD | Error Codes tab module (all ec* state + functions; descriptor-driven settings form, plugins panel, temporary-codes list) |
