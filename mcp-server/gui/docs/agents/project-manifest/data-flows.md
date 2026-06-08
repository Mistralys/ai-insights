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
      ├── Body-parsing routes (PUT, PATCH, POST with body)
      │   ├── readJsonBody(req) — enforce 1 MiB limit
      │   ├── Call handler with parsed body
      │   └── sendJson(res, 200, result)
      │
      └── Body-free routes
          ├── matchRoute(method, url, ledgerRoot, orchestratorLogsDir)
          │   ├── Parse URL segments
          │   ├── Match against route table (segment count + values)
          │   └── Return handler thunk or null
          ├── handler() → result
          └── sendJson(res, 200, result)

Error handling (any path):
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
  │   ├── utils.js → window.escapeHtml, formatDate, breadcrumb, etc.
  │   ├── views/*.js → window.renderProjectList, etc.
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
          │   ├── /insights                         → renderInsights(app)
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

## 9. Project Name Cache Flow

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
