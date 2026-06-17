# File Tree — MCP Server GUI

```
gui/
├── server.ts                    # HTTP server: routing, static files, CORS, security headers
├── api.ts                       # REST API handlers (projects, work packages, orchestrator, config)
├── api-knowledge.ts             # REST API handlers (knowledge CRUD, promote, move)
├── orchestrator-manager.ts      # Queue reader, preflight checks, process spawn/kill/dismiss
├── chunk-renderer.ts            # JSONL chunk → Markdown renderer (pure function, no I/O)
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
    │   ├── config.js            # GUI configuration editor
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
| `server.ts` | ~1750 | Largest backend file — all routing logic lives here |
| `api.ts` | ~900 | Project/WP/config handlers |
| `api-knowledge.ts` | ~350 | Knowledge CRUD handlers |
| `orchestrator-manager.ts` | ~400 | Queue + preflight + spawn |
| `chunk-renderer.ts` | ~350 | Pure JSONL → Markdown |
| `public/styles.css` | ~2670 | Complete CSS component library |
| `public/api-client.js` | ~350 | All API methods |
| `public/utils.js` | ~200 | Shared utility functions |
| `public/components.js` | ~80 | UI namespace (badge, banner, emptyState) |
| `public/js/orchestrator-widgets.js` | ~500 | Widget library |
| `public/views/project-detail-helpers.js` | ~240 | project-detail sub-module: pure helpers |
| `public/views/project-detail-orch.js` | ~310 | project-detail sub-module: orchestrator section |
| `public/views/project-detail-modal.js` | ~270 | project-detail sub-module: Reset Project modal |
| `public/views/project-detail.js` | ~1040 | project-detail main (trimmed; was ~1886 lines pre-decomposition) |
