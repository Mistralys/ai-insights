# File Tree — MCP Server GUI

```
gui/
├── server.ts                    # HTTP server: routing, static files, CORS, security headers
├── api.ts                       # REST API handlers (projects, work packages, orchestrator, config)
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
| `public/views/config-model-registry.js` | ~606 | Model Registry tab module (all mr* state + functions) |
