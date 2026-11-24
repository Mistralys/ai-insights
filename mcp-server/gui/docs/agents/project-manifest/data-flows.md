# Key Data Flows — MCP Server GUI

---

## 1. Server Startup

```
main()
  ├── Parse CLI args (--port, --ledger-dir)
  ├── resolveLedgerRoot() → ledgerRoot path
  ├── readConfigFromDisk(configPath) → populate config cache
  ├── startConfigWatcher(configPath) → fs.watch for external changes
  ├── startAutoArchiveTimer() → periodic project archival
  ├── captureWorkspaceVersions() → snapshot boot versions (for stale detection)
  ├── initProviderRegistry({ pluginDir: resolveErrorCodePluginDir() })
  │     → built-in + plugin error-code providers; load errors logged, startup continues
  │     → mirrors the same call at MCP server startup (src/index.ts), so both
  │       processes' registries reflect the same built-in and plugin set
  └── createServer(handleRequest).listen(port)
        → Log "MCP GUI server running at http://localhost:{port}"
```

---

## 2. Request Lifecycle

```
Incoming HTTP Request
  │
  ├── OPTIONS → 200 (CORS preflight)
  │
  ├── Non-API path (no /api prefix)
  │   └── serveStatic(req, res)
  │       ├── Resolve file path in PUBLIC_DIR
  │       ├── Prevent path traversal (resolved must start with PUBLIC_DIR)
  │       ├── Read file → send with MIME type + security headers
  │       └── Not found → 404 JSON error
  │
  └── API path (/api/...)
      └── dispatchRoute(req, res, method, url, port, buildRoutes(...))
          ├── parseQueryString(url) → URLSearchParams (passed as 3rd handler arg)
          ├── Match Route[] table (method + path/RegExp; noBody:true skips body read)
          │   ├── Section A — body-parsing routes (PUT, PATCH, POST)
          │   ├── Section B — keyword-specific body-free routes (noBody:true; must precede §C)
          │   └── Section C — catch-all body-free routes (noBody:true)
          ├── route.guards (when present) run in array order — each may throw ApiError to reject
          │     e.g. the error-code routes' requireLoopbackRequest / requireJsonContentType (constraints.md §7)
          ├── readJsonBody(req) — enforce 1 MiB limit (skipped when noBody:true)
          ├── route.handler(body, groups?, query?) → result
          └── sendJson(res, statusCode ?? 200, result) | writeHead(204) + res.end()
          No match → 404 JSON error

Error handling (any path, including a guard's throw):
  ApiError           → sendError(res, statusFromCode, code, message)
  PayloadTooLargeError → sendError(res, 413, ...)
  Unhandled          → stderr log + sendError(res, 500, 'INTERNAL_ERROR', ...)
```

---

## 3. Client-Side SPA Boot Sequence

```
Browser loads index.html
  │
  ├── <head>: theme-init.js executes synchronously
  │   └── Read localStorage('mcp-theme')
  │       └── Set <html data-theme="dark"> (or remove for light)
  │       → Prevents flash of unstyled content (FOUC)
  │
  ├── <body>: Scripts load in order (all synchronous)
  │   ├── marked.min.js → window.marked
  │   ├── api-client.js → window.API
  │   ├── theme.js → window.Theme
  │   ├── router.js → window.Router
  │   ├── utils.js → window.escapeHtml, formatDate, breadcrumb, showLoading,
  │   │             showError (→ UI.banner('error', …) since rework-1), etc.
  │   ├── components.js → window.UI
  │   ├── views/project-detail-helpers.js → helpers (STAGE_ABBREV, buildPipelineTrack, etc.)
  │   ├── views/project-detail-orch.js   → renderOrchToolbar, renderRunsList, etc.
  │   ├── views/project-detail-modal.js  → PIPELINE_STAGES, showResetModal
  │   ├── views/project-detail.js + other views/*.js → window.renderProjectList, etc.
  │   │   (project-detail sub-modules must be loaded before project-detail.js — see §3a)
  │   ├── orchestrator-widgets.js → window.OrchestratorWidgets
  │   ├── stale-check.js → window.StaleCheck
  │   └── app.js → Bootstrap
  │
  └── app.js executes:
      ├── Theme.init() → bind toggle button, apply stored theme
      ├── Router.init() → listen hashchange, dispatch current hash
      └── StaleCheck.init() → start 30s polling of /api/server-info
```

---

## 3a. project-detail Module Load Order

`project-detail.js` is decomposed into four files that must be loaded in dependency order. `index.html` and all 9 GUI test files enforce this sequence:

```
project-detail-helpers.js   — pure helpers; no dependencies on other project-detail files
  ↓
project-detail-orch.js      — orchestrator section; depends on helpers
  ↓
project-detail-modal.js     — Reset Project modal; depends on helpers
  ↓
project-detail.js           — main; depends on all three sub-modules above
```

**Shared-state invariant:** `_pdLogPreviewCleanups` is declared and initialised as a `var` in `project-detail.js` and immediately promoted to `globalThis._pdLogPreviewCleanups` so that `project-detail-orch.js` can push cleanups into, and drain, the same array instance. Both drain sites use `.length = 0` (in-place mutation). A `= []` reassignment would break array identity across the module boundary — see `constraints.md §3`.

---

## 4. Hash-Based Routing

```
User clicks link or navigates
  │
  └── hashchange event fires
      │
      └── Router.dispatch(window.location.hash)
          ├── Clear any active polling interval
          ├── Update nav link .active state
          ├── Match hash against route patterns:
          │   ├── "/" or ""                          → renderProjectList(app)
          │   ├── /projects/:repo/:slug/plan        → renderPlan(app, repo, slug)
          │   ├── /projects/:repo/:slug/synthesis   → renderSynthesis(app, repo, slug)
          │   ├── /projects/:repo/:slug             → renderProjectDetail(app, repo, slug)
          │   ├── /projects/:repo/:slug/wp/:wpId    → renderWorkPackageDetail(app, repo, slug, wpId)
          │   ├── /projects/:repo/:slug/runs/:file  → renderRunLog(app, repo, slug, file)
          │   ├── /config                           → renderConfig(app)
          │   ├── /knowledge                        → renderKnowledge(app)
          │   ├── /orchestrator                     → renderOrchestrator(app)
          │   └── (no match)                        → error banner "Page not found"
          └── View render function:
              ├── showLoading(app)
              ├── Fetch data via API.*
              ├── Build HTML string
              ├── Set app.innerHTML = html
              └── (Optional) Set up polling via Router._setPolling()
```

---

## 5. Stale Instance Detection

```
StaleCheck.init()
  └── setInterval(30s):
      ├── GET /api/server-info
      │   → { stale, bootVersions, diskVersions }
      │
      ├── If stale === false → no action
      │
      └── If stale === true:
          ├── Stop polling (one-shot detection)
          ├── Compare boot vs disk per component
          │   (mcpServer, personas, orchestrator)
          └── Insert sticky .stale-banner at top of <body>
              with list of changed components
```

---

## 6. Orchestrator Queue Flow

```
GET /api/orchestrator/queue
  │
  └── getQueue(logsDir, ledgerRoot)
      ├── readQueueFile(logsDir) → RawQueueEntry[]
      ├── For each entry:
      │   ├── isProcessAlive(pid) → boolean
      │   ├── getProjectLedgerStatus(slug, repo?, ledgerRoot) → ledger exists?
      │   ├── computeEffectiveStatus(raw, alive, hasProject, stageActivity)
      │   │   → 'pending' | 'started' | 'dead'
      │   └── Exclude if synthesis_generated === true (AC-6)
      └── Return QueueEntry[] with effectiveStatus + enrichment

POST /api/orchestrator/start
  │
  ├── Validate body: { planPath, dryRun?, resumeThreadId? }
  ├── Run 7 preflight checks (venv, dist, .env, no lock, etc.)
  │   → PreflightResult[]
  ├── If any check fails → return { ok: false, preflight: [...] }
  └── If all pass:
      ├── Spawn detached python orchestrator process
      └── Return { ok: true, preflight: [...], pid }

POST /api/orchestrator/kill/:id
  │
  ├── Find queue entry by id
  ├── Send SIGTERM to pid
  ├── Wait 3s
  ├── If still alive → SIGKILL
  ├── Remove .orchestrator.lock
  └── Remove entry from queue file (atomic write)
```

---

## 7. Knowledge CRUD Flow

```
GET /api/knowledge?scope=global&category=patterns
  │
  └── handleListKnowledge(ledgerRoot, params)
      ├── Validate scope via InsightScope.safeParse()
      ├── KnowledgeStoreManager.listInsights(ledgerRoot, filters)
      └── Return filtered insight array

PATCH /api/knowledge/:id
  │
  ├── parseKnowledgeId(rawId) → validate positive integer
  ├── KnowledgeUpdateBodySchema.parse(body) → validate fields
  ├── KnowledgeStoreManager.updateInsight(ledgerRoot, scope, repoName, id, data)
  └── Return updated insight

POST /api/knowledge/:id/move
  │
  ├── parseKnowledgeId(rawId)
  ├── KnowledgeMoveBodySchema.parse(body) → validate source/dest
  ├── KnowledgeStoreManager.moveInsight(ledgerRoot, source, dest, id)
  │   → Atomic: delete from source store + insert into target store (new ID assigned)
  └── Return moved insight (with new ID)
```

---

## 8. Run Log Streaming

```
renderRunLog(app, repo, slug, filename)
  │
  ├── Initial fetch: API.getRunLogEntries(repo, slug, filename, null)
  │   → { entries: [...], totalLines: N }
  │
  ├── Render all entries as .run-event cards (severity-colored)
  │
  └── Set up polling (Router._setPolling, every 3s):
      ├── API.getRunLogEntries(repo, slug, filename, afterLine=lastTotalLines)
      │   → Only new entries since last fetch
      ├── Append new .run-event cards to container
      └── Update afterLine = totalLines

Server side (handleGetRunLog):
  ├── Read JSONL file
  ├── If ?after=N → skip first N lines
  └── Return { entries: [...], totalLines: lineCount }
```

---

## 9. Project Detail In-Place DOM Patching

`renderProjectDetail` uses targeted DOM patching to avoid full-page flicker during poll cycles. Two strategies are applied depending on which data changed:

```
pollQueue() fires (every ~3 s while project detail is visible)
  │
  ├── Compute _orchRunsStructureKey(sorted, activeFilename)
  │   → JSON string of sorted run filenames + activeFilename
  │
  ├── If key === lastRunsStructureKey (data-only change):
  │   │   Same run list structure, same active run — only the status
  │   │   card content may have changed (elapsed time, PID, progress).
  │   │
  │   └── _patchOrchStatusCard(matchingQueueEntry)
  │       ├── Re-render OrchestratorWidgets.renderStatusCard()
  │       ├── Replace innerHTML of #orch-status-card-container only
  │       │   → Log preview widget (#orch-project-log-preview) is a
  │       │     sibling — it is NOT touched
  │       └── _pdLogPreviewCleanups array is NOT drained
  │           → Existing log preview widget stays alive
  │
  └── If key !== lastRunsStructureKey (structural change):
          Run appeared / run became inactive / first tick (key is null).
          │
          └── renderRunsList(matchingQueueEntry)
              ├── Drain _pdLogPreviewCleanups (destroy existing widgets)
              ├── Walk DOM from runsEl to find nearest scrollable ancestor
              │   (window.getComputedStyle overflowY === 'auto'|'scroll')
              │   → Falls back to document.documentElement if none found
              ├── Save scrollTop of scroll anchor
              ├── Rebuild runsEl.innerHTML (full structural re-render)
              │   └── Active run section wraps status card in
              │       <div id="orch-status-card-container">
              ├── Restore scrollTop to saved value
              └── Start new log preview widget (renderLogPreview)
                  → Cleanup fn pushed into _pdLogPreviewCleanups
                    (guarded by `if (cleanup)` — defensive against null returns)
```

**Key invariants:**
- `lastRunsStructureKey` is initialised to `null` so the first poll tick always takes the structural path and performs a full `renderRunsList`.
- `_pdLogPreviewCleanups` is drained at exactly two sites: (1) `renderRunsList` before the innerHTML rebuild, and (2) `renderProjectDetail` at the very start of a new full-page render (pre-route-visit drain). No other drain site should exist.
- `_pdLogPreviewCleanups` is only drained on structural rebuilds — the log preview widget survives data-only status card updates.
- `renderOrchToolbar` is called on every tick (both paths) to keep Kill/Resume button state current.

---

## 10. Project Name Cache Flow

```
View fetches project detail
  │
  ├── API.getProject(repo, slug) → { meta, project_name, ... }
  │
  ├── ProjectNameCache.set(makeProjectCacheKey(repo, slug), project_name)
  │   → Stored for breadcrumb display
  │
  └── breadcrumb().project(repo, slug)
      └── ProjectNameCache.get(key)
          ├── If cached → return display name
          └── If not cached → return slug portion (fallback)
```

---

## 11. Structured Dialogue Rendering

```
User opens a chunk dialogue in the work-package detail view
  │
  └── _loadDialogueContent(repo, slug, filename)
      │
      ├── API.getChunkStructured(repo, slug, filename)
      │   └── GET /api/projects/:repo/:slug/chunks/:filename/rendered?format=structured
      │       │
      │       └── server.ts (dispatchRoute)
      │           ├── URLSearchParams.get('format') === 'structured'
      │           ├── handleGetChunkFile(ledgerRoot, slug, filename, repoName)
      │           │   → { content: string }  (raw JSONL text)
      │           └── renderChunksToStructured(content)
      │               │
      │               ├── parseChunkLine() × N  → raw records[]
      │               ├── accumulateChunks(records) → Map<NamespaceKey, MergedMessage[]>
      │               ├── buildToolCallIndex()     → Map<toolCallId, toolName>
      │               ├── buildFullToolResultIndex() → Map<toolCallId, {toolName, content}>
      │               └── collectStructuredNamespaceBlocks() × namespace
      │                   → DialogueBlock[]  (main agent first, sub-agents next)
      │
      │   Response: { blocks: DialogueBlock[] }
      │
      └── _renderDialogueBlocks(blocks)
          │   Iterates blocks and dispatches to per-type helpers:
          │
          ├── block.type === 'text'
          │   └── window.marked.parse(block.content) → Markdown HTML
          │
          ├── block.type === 'tool-call'
          │   └── _buildDialogueToolCallBlock(block)
          │       ├── Header: .dialogue-tool-toggle  (name + detail lines)
          │       ├── Body:   .dialogue-tool-details  (hidden by default)
          │       │   ├── .dialogue-tool-args     (JSON args, scrollable)
          │       │   └── .dialogue-tool-result   (ToolMessage content, if present)
          │       └── Returns .dialogue-tool-call <div>
          │
          ├── block.type === 'subagent-heading'
          │   └── .dialogue-subagent-heading <div>  (label text)
          │
          └── block.type === 'checklist'
              └── _buildDialogueChecklistBlock(block)
                  ├── One <li> per item with disabled <input type="checkbox">
                  ├── .checked class applied when item.checked === true
                  └── Returns .dialogue-checklist <div>

After innerHTML is set:
  └── _attachDialogueEvents(container)
      └── Delegated click on container
          └── If target is .dialogue-tool-toggle:
              ├── Toggle hidden on sibling .dialogue-tool-details
              └── Toggle .expanded on child .dialogue-tool-arrow
```

**Backward-compatible endpoint:** Omitting `?format=structured` returns
`{ content: string }` (Markdown from `renderChunksToDialogue()`), preserving
compatibility with any consumer that does not pass the parameter.

---

## 12. Project Detail Synopsis & Outcome Rendering

The project detail page renders two contextual summary blocks after the project metadata card. Both are emitted by inline IIFEs inside `project-detail.js` and use `escapeHtml()` for XSS-safe output.

```
renderProjectDetail() — synopsis/outcome block rendering
  │
  ├── Plan synopsis IIFE → .plan-synopsis#plan-synopsis
  │   │
  │   ├── If project.project_summary is truthy:
  │   │   └── synopsisContent = '<p>' + escapeHtml(project_summary) + '</p>'
  │   │       → Plain-text rendering (no Markdown processing)
  │   │
  │   ├── Else if planResult.content is available:
  │   │   └── synopsisContent = marked.parse(extractSynopsis(planResult.content))
  │   │       → Markdown rendering via extractSynopsis() + marked.parse()
  │   │
  │   └── If synopsisContent is non-empty, render:
  │       .plan-synopsis#plan-synopsis
  │         └── .plan-synopsis__body
  │               └── .plan-synopsis__content (synopsisContent)
  │         └── .plan-synopsis__link  "View full plan →"
  │
  ├── Synthesis link row → #synthesis-link-row
  │   ├── If synthesis_generated: .synthesis-link-row (visible, with link)
  │   └── Else: <div id="synthesis-link-row" style="display:none">
  │       (pre-rendered empty container for poll-driven reveal on live projects)
  │
  └── Outcome synopsis IIFE → .outcome-synopsis
      ├── If synthesis_generated === true AND outcome_summary is truthy:
      │   └── .outcome-synopsis
      │         └── .outcome-synopsis__content  escapeHtml(outcome_summary)
      │             white-space: pre-wrap — preserves embedded newlines
      └── Else: nothing rendered (no empty container)

Toggle IIFE (runs after innerHTML is set, targets #plan-synopsis):
  │
  ├── Measures .plan-synopsis__body scrollHeight vs clientHeight
  ├── If content fits → add .plan-synopsis--fits (suppresses fade gradient)
  └── If content overflows:
      ├── Inject .plan-synopsis__toggle button
      └── Click handler toggles .plan-synopsis--expanded / collapses
```

**Key notes:**
- The toggle IIFE applies to both rendering paths (both produce `#plan-synopsis` with `.plan-synopsis__body`); the DOM structure is identical regardless of whether `project_summary` or `extractSynopsis()` produced the content.
- The `.outcome-synopsis` block has no toggle. Outcome summaries are expected to be concise (1–3 sentences from the Synthesis persona's `outcome_summary` field).
- The `.outcome-synopsis` block uses `--color-complete` (green `#16a34a`) for its left-border accent, differentiating it from `.plan-synopsis` which uses `--color-ready` (blue `#2563eb`).

---

## 13. Store Management Data Flow

All store write endpoints follow the same pattern: validate → load config → mutate → `saveStoresConfig()` → `reloadStoreContext()` → return updated list. The sequence below shows the full Add Store flow; all other write endpoints follow the same backend skeleton.

```
User clicks “Add Store” in config-stores.js Stores tab
  │
  ├── csWireEvents() captures click on Add Store button
  │       └── csRenderStoreModal('add', null) → insertAdjacentHTML into document.body
  │           └── Modal: ID + Path fields, Directory mode radio (Create / Use Existing), Label
  │
  ├── User fills form and clicks Save (or presses Enter)
  │
  ├── Client-side validation (SLUG_REGEX, absolute path, non-empty label)
  │   └── On error → inline field error messages; button re-enabled
  │
  ├── API call (directory mode determines endpoint):
  │   ├── “Create new directory” → API.addStore({ id, path, label })
  │   └── “Use existing directory” → API.importStore({ id, path, label })
  │
  └── Backend (handleAddStore / handleImportStore in api-stores.ts):
      ├── Server-side validation (reserved IDs, duplicate ID, duplicate path, directory exists)
      │   └── On error → 400 / 409; modal re-enables Save button + shows inline error
      ├── loadStoresConfig() → StoresConfig | null
      ├── Mutate config: add new StoreEntry
      ├── (handleAddStore only) mkdirSync(expandedPath, { recursive: true })
      ├── (handleAddStore only) Create empty .repositories.json if absent
      ├── saveStoresConfig(config)   ←── atomic write under file lock
      └── reloadStoreContext()        ←── hot-reload: re-reads stores.json, constructs fresh
          │                                    StoreRouter(config, { skipDirCreate: true })
          │                                    and MultiStoreManager(router),
          │                                    calls setStoreContext() — module singletons overwritten
          └── handleGetStoresEnriched()  ←── build enriched response from updated context
              └── return StoreListItem[]  ←── HTTP 200

Frontend on success:
  └── csRefreshTab(stores)   ←── re-render table from response
      └── csCloseModal()
          └── (importStore only) if response.warning: UI.banner('info', warning)
```

**Immediate-write pattern — key invariants:**
- The Stores tab never accumulates pending changes. Every user action (add, import, update label, remove, set default, reorder) is a discrete API write followed by a full re-render from the server response.
- `configDirty.stores` is always `false`. The `beforeTabSwitch` unsaved-changes guard is never triggered by the Stores tab.
- Tab-switch cleanup runs **unconditionally** (not inside the `if (configDirty[configActiveTab])` guard) because the Stores tab has no pending state to lose.
- `reloadStoreContext()` calls `setStoreContext()` with `skipDirCreate: true`. If a store path is temporarily unavailable (unmounted drive, offline NFS), the reload succeeds and the server continues in degraded mode — it does not throw a 500 that would leave the in-memory context stale.
- `handleRemoveStore` uses `loadStoresConfig()` after `saveStoresConfig()` to rebuild the enriched list from the updated file, not from the stale pre-mutation snapshot.

---

## 14. Error-Code Provider Config & Test Flow

The GUI's Error Codes settings tab (`views/config-error-codes.js`) is the frontend consumer of these routes. All five routes are guarded by `requireLoopbackRequest`; `PUT`/`POST` additionally by `requireJsonContentType` (constraints.md §7, "Request-Level Guards").

```
GET /api/error-codes/config
  └── handleGetErrorCodeConfig (gui/api-error-codes.ts)
      └── readErrorCodeConfig() (src/error-codes/config-store.ts) → { config, warning? }
            — the GUI-facing read path, distinct from loadErrorCodeConfig() used by PUT/POST
            below: a salvaged/corrupt/unreadable config.json surfaces its warning here
            instead of only to stderr. warning names field paths only (salvaged) or a
            fixed classification reason (corrupt/unreadable) — never a stored value or
            the raw JSON-parser message.
  └── Response: ErrorCodeConfigResponse — warning present only when config.json needed
        salvage or could not be used as stored; absent for a missing or valid file

PUT /api/error-codes/config  { provider_id, settings, clear_secrets? }
  └── handleUpdateErrorCodeConfig (gui/api-error-codes.ts)
      ├── PutErrorCodeConfigBodySchema — temporary_prefix must match TemporaryPrefixSchema (1–6 digits, no leading zero), else 400, nothing written
      ├── getProvider(provider_id) — must be currently registered, else 400
      ├── loadErrorCodeConfig() → current config
      ├── mergeSettingsUpdate(provider.settings, stored, settings, clear_secrets)
      │     ├── non-secret field: incoming value applied when the key is present
      │     ├── secret field, incoming absent/empty: keeps the stored value
      │     └── secret field, key in clear_secrets: cleared to ''
      ├── buildSettingsSchema(provider.settings).safeParse(merged) — invalid → 400, nothing written
      └── updateErrorCodeConfig(mutator) — read-modify-write under withLock(); a provider_id
            not targeted by this call is left byte-for-byte unchanged, which is how an
            uninstalled provider's settings survive the round trip
  └── Response: ErrorCodeConfigResponse — every secret masked to { set: boolean };
        only currently-registered providers' blocks appear

POST /api/error-codes/test  { provider_id, settings? }
  └── handleTestErrorCodeProvider (gui/api-error-codes.ts)
      ├── getProvider(provider_id) — must be currently registered, else 400
      ├── loadErrorCodeConfig() → stored settings for provider_id
      ├── mergeSettingsForTest(provider.settings, stored, settings)
      │     ├── every non-secret field unchanged → stored secrets merged in (secrets_merged: true)
      │     └── any non-secret field changed     → incoming settings tested as-is (secrets_merged: false)
      │           — a stored secret never reaches a provider whose destination just changed
      ├── buildSettingsSchema(provider.settings).safeParse(merged.settings) — invalid → 400
      ├── collectSecrets(provider.settings, validated) → redact() applied to every text field returned
      └── provider.test(ctx) ?? provider.peek(request, ctx) ?? { supported: false, message: "…offers no connection test" }
            — allocate() is never called by this route
  └── Response: { supported, secrets_merged, ok?, reason?, detail?, value?, message? }
```

**Tab-side guards (`views/config-error-codes.js`).** Every async callback of the tab — the lazy load (`ecRenderTab`), Save (`ecHandleSave`) and Test connection (`ecHandleTestClick`) — captures `var visit = ecVisit` before its request and returns early when `visit !== ecVisit`. `ecResetState()` (called by `config.js` on every exit from the tab and on page re-render) increments `ecVisit`, so a response that arrives after the user left can neither replace the shared `#config-tab-content` with the Error Codes form nor repopulate the state that was just cleared. A late Save still clears `ecSaveInFlight` first (it spans visits); a late Test leaves `ecTestInFlight` alone. The lazy load's temporary-codes fetch has its own `.catch`, so a corrupt or unreadable log shows a banner in its card instead of blocking the whole tab. The client validates the temporary prefix against `EC_TEMPORARY_PREFIX_PATTERN` before sending; the server's schema stays authoritative. `ecConfigWarning` (the config response's `warning`, distinct from `ecTemporaryWarning`) is set from the lazy load's `GET` response and re-set from `ecHandleSave`'s `PUT` response (which is always `undefined`, since a successful save just wrote a fully-validated file — so a successful save always clears a prior warning); `ecResetState()` clears it on tab exit along with every other `ec*` field.

**Key invariants:**
- The fail-closed merge (`mergeSettingsForTest`) is the one place the server combines a stored secret with client-supplied settings — see the rationale in `src/error-codes/settings-schema.ts`'s docblock and in the plan that introduced it (WP-011's "Rejected Approaches").
- `GET /api/error-codes/providers` and `GET /api/error-codes/config` never execute provider code — they only read the registry (`listProviders()`, `listProviderLoadErrors()`) and the config file.
- Both the MCP server (`src/index.ts`) and the GUI server (`gui/server.ts`) call `initProviderRegistry()` independently at their own startup against the same `resolveErrorCodePluginDir()` — the GUI's providers list reflects exactly the same built-in/plugin set the MCP server's `ledger_generate_error_code` tool allocates through.

## 15. Configuration Tab-Switch Flow (`CONFIG_TABS`)

The tab-bar click handler in `views/config.js` routes every tab switch through the `CONFIG_TABS` descriptor array (`{ key, label, render, leave, reset }` per tab — see constraints.md §25 "Config Tab Modules") rather than branching on the tab key itself:

```
User clicks a tab button
  └── tab-bar click handler (config.js)
        ├── configDirty[configActiveTab] === true?
        │     └── confirm() — unsaved-changes guard
        │           ├── Cancel  → stay on current tab, no further action
        │           └── OK      → discarded = true
        ├── leavingTab = configFindTab(configActiveTab)
        ├── leavingTab.leave(discarded)              ← runs unconditionally, discarded defaults to false
        │     ├── always-reset tabs (Stores, Error Codes):
        │     │     leave === reset → unconditional reset, regardless of discarded
        │     │     (increments csVisit / ecVisit, clears module state)
        │     └── reset-only-on-discard tabs (Persona Models, Model Registry):
        │           always increments pmVisit / mrVisit (invalidating any in-flight
        │           request's stale check); resets module state only when discarded
        │           is true — render's arguments are not refreshed after a save, so
        │           resetting unconditionally would re-initialise from stale data
        ├── configActiveTab = <clicked tab key>
        └── renderConfigTabContent() → configFindTab(configActiveTab).render(...)
              ← dispatches purely off CONFIG_TABS; no per-tab branch in config.js itself

On full page load / reload:
renderConfigPage(app, config, models, personas, assignments, stores)
  ├── resets every configDirty key to false
  └── CONFIG_TABS.forEach(tab => tab.reset())    ← every tab reset unconditionally,
        since fresh server data is always about to replace whatever state existed
```

**Why a visit-spanning flag is not reset by `leave`/`reset`:** `pmIsBuilding` (Persona Models' rebuild-in-progress flag) and `ecSaveInFlight`/`ecTestInFlight` (Error Codes' request-in-flight flags) intentionally survive a tab switch, so a rebuild or save started on one visit still completes and updates its own flag correctly if the user returns. Each is cleared by its own async callback — never by `leave`/`reset` — before that callback's own visit-token stale check runs, so the flag never gets stuck `true` even when the response that would normally clear it arrives after the tab was left.

**Key invariant:** adding a sixth Configuration tab requires only a new `CONFIG_TABS` descriptor — `renderConfigTabContent()` and the tab-bar click handler both dispatch purely off the array via `configFindTab()`, with no separate branch to update.

---

## 16. Setup Notices Detection (Backend)

`personas/name-mapping.json` is a generated build artefact (see `src/utils/name-mapping.ts`); a fresh clone or a pull that touched the model registry leaves it absent until the next persona build. `gui/setup-notices.ts` is the backend half of surfacing that gap to the user; the frontend banner that calls this endpoint is `public/setup-notices.js`, covered in [§17](#17-setup-notices-banner-frontend) below.

```
GET /api/setup-notices
  └── handleGetSetupNotices()
        └── detectSetupNotices()                 ← pure, synchronous, no I/O beyond a stat()
              └── isNameMappingPresent()          (src/utils/name-mapping.ts)
                    ├── false → push { id: "personas-not-built", title, message,
                    │           action: { kind: "rebuild-personas" } }
                    └── true  → push nothing
        → { notices: SetupNotice[] }              ([] when nothing is amiss)
```

The response is array-shaped even though only one notice exists today, so a second notice can be introduced later — e.g. a stale model registry, a missing store directory — with no client-side contract change. A `SetupNoticeProvider` registry is deferred until a second consumer exists in scope.

**Path-derivation ownership:** `gui/api-models.ts`'s private `nameMappingPath()` and `gui/setup-notices.ts`'s `isNameMappingPresent()` both resolve `personas/name-mapping.json` exclusively through `resolveNameMappingPath()` in `src/utils/name-mapping.ts` — the single owner of that derivation inside `mcp-server`. Neither file re-derives the path independently, which is what keeps them from drifting apart.

---

## 17. Setup Notices Banner (Frontend)

`public/setup-notices.js` (`SetupNotices` namespace) is the client half of §16. It is modelled on `stale-check.js`'s IIFE/polling shape but kept as a **separate module** — the two banners track different lifecycles ("relaunch needed", one-shot and never clears, versus "build something", recurring and clears once the gap closes) — and is **one-way coupled** to `views/config-persona-models.js`: only that view calls `SetupNotices.refresh()`; `SetupNotices` never reaches into any view module and dispatches no window event.

```
app.js
  └── SetupNotices.init()                          ← called after StaleCheck.init()
        ├── _ensureContainer()                      inserts #setup-notices (role=status,
        │                                            aria-live=polite) before body>header,
        │                                            after .stale-banner when present
        ├── document.addEventListener('visibilitychange', _onVisibilityChange)  (once)
        ├── _startPolling()                          ← interval always starts here, so a
        │                                              failed first fetch still gets retried
        └── refresh()
              └── API.getSetupNotices()  → GET /api/setup-notices
                    ├── success → _notices = data.notices; prune _buildState for
                    │             ids no longer present; _render();
                    │             notices.length > 0 ? _startPolling() : _stopPolling()
                    └── failure → swallowed; polling/notices/state left untouched

_render() — per notice (DOM only, textContent for every server string):
  .setup-banner
    ├── <strong> title, <span> message
    ├── action.kind === 'rebuild-personas' → <button class="setup-banner-btn">
    │     building  → disabled, <span class="spinner" aria-hidden="true"> + "Building…"
    │     conflict  → disabled, "Build already running…"           (409 from rebuildPersonas())
    │     otherwise → "Build personas", click → _doBuild(notice.id)
    └── state.error → <details class="setup-banner-error"><summary>Build failed</summary>
          <p>Run <code>node scripts/cli.js setup</code> …</p>
          <pre class="pm-build-error-pre">{error output}</pre>          ← reused class

_doBuild(noticeId)
  └── API.rebuildPersonas()  → POST /api/personas/rebuild
        ├── success → refresh()                      (the resolved notice drops out on its own)
        └── failure → err.code === 'CONFLICT' ? state.conflict = true : state.error = message
```

**Polling lifecycle:** the interval (`POLL_INTERVAL_MS = 30000`, same cadence as `StaleCheck`) runs whenever `_startPolling()` was last called and not since stopped; `refresh()`'s own success branch is the only place that decides to stop it (empty list) or (re)start it (non-empty list) — a network failure never touches polling state either way. `document.hidden` stops the interval outright via the `visibilitychange` listener; becoming visible again restarts the interval and performs an immediate `refresh()` so a build that finished while the tab was hidden (e.g. CLI-triggered) is picked up without waiting for the next tick. A 409 (`conflict`) does not stop polling — the notice is still active, so the next tick keeps checking until the other build finishes.

**One-way tab → banner call:** `views/config-persona-models.js`'s `pmDoRebuild()` calls `window.SetupNotices.refresh()` (guarded — the view must tolerate the module being absent) immediately after its own `pmIsBuilding = false`, unconditionally — before its `pmVisit` staleness check — so the banner clears even when the Persona Models tab itself was left without discarding. No event travels the other way: `SetupNotices` has no knowledge of `config-persona-models.js`, and no `CustomEvent` is dispatched on `window`.

**Styling:** `.setup-banner` reuses the `--color-banner-stale-{bg,fg,border}` tokens (same as `.stale-banner`), but is `position: static` (non-sticky) so it never fights `.stale-banner` for the sticky top slot — `_ensureContainer()` places `#setup-notices` immediately after `.stale-banner` in the DOM when one exists. `.setup-banner button:focus-visible` uses `--color-banner-stale-fg` (not `-border`) for its outline — hand-computed contrast against the banner's own background clears the 3:1 floor in both themes (`-border` alone does not, in the light theme). No new `@keyframes` are introduced; the building state reuses the existing `.spinner` animation.

