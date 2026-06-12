# Public API Surface — MCP Server GUI

---

## 1. Backend REST API

All routes are prefixed with `/api`. Response envelope on success: raw JSON value. Error envelope: `{ error: { code, message } }`.

### Error Codes → HTTP Status

| Code | Status |
|------|--------|
| `NOT_FOUND` | 404 |
| `FORBIDDEN` | 403 |
| `VALIDATION_ERROR` | 400 |
| `CONFLICT` | 409 |
| `PAYLOAD_TOO_LARGE` | 413 |
| *(unhandled)* | 500 |

---

### 1.1 Projects

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/projects` | `handleListProjects` | Paginated list with filtering, sorting, search. |
| `GET` | `/api/projects/:repo/:slug` | `handleGetProject` | Full project detail (root index + meta). |
| `GET` | `/api/projects/:repo/:slug/plan` | `handleGetPlanDocument` | Plan Markdown content. |
| `GET` | `/api/projects/:repo/:slug/synthesis` | `handleGetSynthesisDocument` | Synthesis Markdown content. |
| `GET` | `/api/projects/:repo/:slug/health` | `handleGetProjectHealth` | Health summary. |
| `GET` | `/api/projects/:repo/:slug/run-metadata` | `handleGetRunMetadata` | `.orchestrator-run.json` sidecar. |
| `GET` | `/api/projects/:repo/:slug/work-packages` | `handleListWorkPackages` | All WPs for a project. |
| `GET` | `/api/projects/:repo/:slug/work-packages/overview` | `handleGetWorkPackageOverview` | Aggregate WP status summary. |
| `GET` | `/api/projects/:repo/:slug/work-packages/:wpId` | `handleGetWorkPackage` | Single WP detail. |
| `GET` | `/api/projects/:repo/:slug/dialogues` | `handleListDialogues` | Dialogue file list (optional `?wp=` filter). |
| `GET` | `/api/projects/:repo/:slug/dialogues/:filename` | `handleGetDialogueFile` | Single dialogue content. |
| `GET` | `/api/projects/:repo/:slug/chunks` | `handleListChunks` | Chunk file list (optional `?wp=` filter). |
| `GET` | `/api/projects/:repo/:slug/chunks/:filename` | `handleGetChunkFile` | Raw chunk JSONL content. |
| `GET` | `/api/projects/:repo/:slug/chunks/:filename/rendered` | `handleGetChunkFile` + `renderChunksToMarkdown` | Rendered chunk as Markdown. |
| `GET` | `/api/projects/:repo/:slug/runs` | `handleListRunLogs` | Orchestrator run log file list. |
| `GET` | `/api/projects/:repo/:slug/runs/:filename` | `handleGetRunLog` | Log entries (supports `?after=N` for streaming). |
| `DELETE` | `/api/projects/:repo/:slug` | `handleDeleteProject` | Permanently delete a project. |
| `PATCH` | `/api/projects/:repo/:slug` | `handleRenameProject` | Rename title or slug. Body: `{ title?: string, slug?: string }`. |
| `POST` | `/api/projects/:repo/:slug/archive` | `handleArchiveProject` | Set status to ARCHIVED. |
| `POST` | `/api/projects/:repo/:slug/unarchive` | `handleUnarchiveProject` | Restore from ARCHIVED. |
| `POST` | `/api/projects/:repo/:slug/complete` | `handleMarkProjectComplete` | Mark project COMPLETE. |
| `POST` | `/api/projects/:repo/:slug/reset` | `handleResetProject` | Reset project (dry_run or apply). Body: `{ dry_run: boolean, decisions?: [] }`. |

#### GET /api/projects Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number (1-indexed). |
| `limit` | number | 50 | Items per page (max 200). |
| `status` | string | `'ACTIVE'` | `'ACTIVE'`, `'ALL'`, or a specific status value. |
| `search` | string | — | Case-insensitive substring match on slug, name, repo. |
| `sort` | string | `'last_updated'` | Column: `project`, `repository`, `status`, `total_work_packages`, `done`, `date_created`, `last_updated`, `runner`. |
| `dir` | string | `'desc'` | `'asc'` or `'desc'`. |
| `runner` | string | — | Filter: `'orchestrator'`, `'vscode'`, `'claude-code'`, `'unknown'`. |

#### GET /api/projects Response Envelope (`ProjectListEnvelope`)

```typescript
{
  projects: ProjectSummary[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  status_counts: Record<string, number>;
  runner_counts: Record<string, number>;
}
```

---

### 1.2 Orchestrator

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/orchestrator/queue` | `handleGetOrchestratorQueue` | Current queue entries with effective status. |
| `GET` | `/api/orchestrator/run-status/:filename` | `handleGetRunStatus` | Status from a specific log file. |
| `POST` | `/api/orchestrator/start` | `handleOrchestratorStart` | Run preflight + spawn orchestrator. Body: `{ planPath, dryRun?, resumeThreadId? }`. |
| `POST` | `/api/orchestrator/kill/:id` | `handleOrchestratorKill` | SIGTERM → SIGKILL escalation. |
| `POST` | `/api/orchestrator/dismiss/:id` | `handleOrchestratorDismiss` | Remove dead entry from queue. Returns 204. |

---

### 1.3 Knowledge

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/knowledge` | `handleListKnowledge` | List/search insights. Query: `?scope&category&tags&repository_name&query&limit&offset`. |
| `PATCH` | `/api/knowledge/:id` | `handleUpdateKnowledge` | Update insight fields. Body validated by `KnowledgeUpdateBodySchema`. |
| `DELETE` | `/api/knowledge/:id` | `handleDeleteKnowledge` | Delete insight. Query: `?scope&repository_name`. |
| `POST` | `/api/knowledge/:id/promote` | `handlePromoteKnowledge` | Promote repository insight to global. Query: `?scope&repository_name`. |
| `POST` | `/api/knowledge/:id/move` | `handleMoveKnowledge` | Move insight between stores. Body validated by `KnowledgeMoveBodySchema`. |

---

### 1.4 Configuration & Server Info

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/config` | `handleGetConfig` | Current GUI configuration. |
| `PUT` | `/api/config` | `handleUpdateConfig` | Update GUI configuration. Body validated by `GuiConfigPartialSchema`. |
| `GET` | `/api/server-info` | *(inline)* | Boot vs disk versions + stale flag. |

---

## 2. Frontend Global Namespaces

### 2.1 `API` (api-client.js)

Client-side REST API wrapper. All methods return Promises.

| Method | Signature | Endpoint |
|--------|-----------|----------|
| `getProjects` | `(params?) → Promise<ProjectListEnvelope>` | `GET /api/projects` |
| `getProject` | `(repo, slug) → Promise<ProjectDetail>` | `GET /api/projects/:repo/:slug` |
| `getWorkPackages` | `(repo, slug) → Promise<WP[]>` | `GET /api/projects/:repo/:slug/work-packages` |
| `getWorkPackage` | `(repo, slug, wpId) → Promise<WPDetail>` | `GET /api/projects/:repo/:slug/work-packages/:wpId` |
| `deleteProject` | `(repo, slug) → Promise<null>` | `DELETE /api/projects/:repo/:slug` |
| `archiveProject` | `(repo, slug) → Promise<object>` | `POST …/archive` |
| `unarchiveProject` | `(repo, slug) → Promise<object>` | `POST …/unarchive` |
| `markProjectComplete` | `(repo, slug) → Promise<object>` | `POST …/complete` |
| `getRunLogs` | `(repo, slug) → Promise<object[]>` | `GET …/runs` |
| `getRunLogEntries` | `(repo, slug, filename, afterLine?) → Promise<object>` | `GET …/runs/:filename` |
| `getRunMetadata` | `(repo, slug) → Promise<object>` | `GET …/run-metadata` |
| `getPlanDocument` | `(repo, slug) → Promise<object>` | `GET …/plan` |
| `getSynthesisDocument` | `(repo, slug) → Promise<object>` | `GET …/synthesis` |
| `getProjectHealth` | `(repo, slug) → Promise<object>` | `GET …/health` |
| `getWorkPackageOverview` | `(repo, slug) → Promise<object>` | `GET …/work-packages/overview` |
| `renameProject` | `(repo, slug, title) → Promise<object>` | `PATCH …` |
| `renameSlug` | `(repo, slug, newSlug) → Promise<object>` | `PATCH …` |
| `analyzeProjectReset` | `(repo, slug) → Promise<object>` | `POST …/reset` (dry_run) |
| `applyProjectReset` | `(repo, slug, decisions) → Promise<object>` | `POST …/reset` (apply) |
| `getDialogues` | `(repo, slug, wpId?) → Promise<object[]>` | `GET …/dialogues` |
| `getDialogueContent` | `(repo, slug, filename) → Promise<string>` | `GET …/dialogues/:filename` |
| `getChunks` | `(repo, slug, wpId?) → Promise<object[]>` | `GET …/chunks` |
| `getChunkRendered` | `(repo, slug, filename) → Promise<string>` | `GET …/chunks/:filename/rendered` |
| `getConfig` | `() → Promise<object>` | `GET /api/config` |
| `updateConfig` | `(data) → Promise<object>` | `PUT /api/config` |
| `getInsights` | `() → Promise<object>` | `GET /api/insights` |
| `getServerInfo` | `() → Promise<object>` | `GET /api/server-info` |
| `orchestratorStart` | `(planPath, dryRun, resumeThreadId?) → Promise<object>` | `POST /api/orchestrator/start` |
| `orchestratorGetQueue` | `() → Promise<object>` | `GET /api/orchestrator/queue` |
| `orchestratorGetRunStatus` | `(slug) → Promise<object>` | `GET /api/orchestrator/run-status/:filename` |
| `orchestratorKill` | `(id) → Promise<object>` | `POST /api/orchestrator/kill/:id` |
| `orchestratorDismiss` | `(id) → Promise<null>` | `POST /api/orchestrator/dismiss/:id` |
| `getKnowledge` | `(params?) → Promise<object>` | `GET /api/knowledge` |
| `updateKnowledge` | `(id, scope, repositoryName, data) → Promise<object>` | `PATCH /api/knowledge/:id` |
| `deleteKnowledge` | `(id, scope, repositoryName?) → Promise<null>` | `DELETE /api/knowledge/:id` |
| `promoteKnowledge` | `(id, scope, repositoryName?) → Promise<object>` | `POST /api/knowledge/:id/promote` |
| `moveKnowledge` | `(id, body) → Promise<object>` | `POST /api/knowledge/:id/move` |

---

### 2.2 `Router` (router.js)

| Method | Signature | Description |
|--------|-----------|-------------|
| `init` | `() → void` | Attach `hashchange` listener; dispatch current hash. |
| `navigate` | `(hash: string) → void` | Programmatic navigation. |
| `_setPolling` | `(fn, delayMs) → void` | Set a polling interval (cleared on route change). |
| `_clearPolling` | `() → void` | Manually clear the active polling interval. |

---

### 2.3 `Theme` (theme.js)

| Method | Signature | Description |
|--------|-----------|-------------|
| `init` | `() → void` | Read stored preference, apply theme, bind toggle button. |
| `toggle` | `() → void` | Switch between dark/light and persist. |

---

### 2.4 `StaleCheck` (stale-check.js)

| Method | Signature | Description |
|--------|-----------|-------------|
| `init` | `() → void` | Start 30-second polling of `/api/server-info`; show banner on mismatch. |

---

### 2.5 `OrchestratorWidgets` (js/orchestrator-widgets.js)

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `renderStatusCard` | `(entry) → string` | HTML | Status card for a queue entry (badge + elapsed + PID + progress). |
| `renderKillButton` | `(entryId, onDone) → HTMLButtonElement` | DOM node | Confirmation-gated kill button. |
| `renderDismissButton` | `(entryId, onDone) → HTMLButtonElement` | DOM node | Dismiss button for dead entries. |
| `renderLogPreview` | `(container, repo, slug, filename) → cleanup()` | Function | Auto-polling log preview (3s interval). Returns cleanup function. |
| `renderProgressBadge` | `(lastAction) → string` | HTML | Small icon+label badge for a JSONL action type. |
| `renderCliReference` | `() → string` | HTML | Static CLI commands reference card. |
| `formatLogAction` | `(entry) → string` | String | Human-friendly label for a JSONL log entry. |

---

### 2.6 Global Utility Functions (utils.js)

| Function | Signature | Description |
|----------|-----------|-------------|
| `escapeHtml` | `(str) → string` | HTML-escape a string (null-safe). |
| `formatDate` | `(isoString) → string` | Relative date formatting ("Today, 14:30", "Yesterday", weekday, or full date). |
| `formatDuration` | `(ms) → string` | Duration formatting ("2h 15m", "< 1s"). |
| `statusBadge` | `(status) → string` | Returns `<span class="badge badge-{status}">…</span>` HTML. |
| `showLoading` | `(container) → void` | Set container innerHTML to loading spinner. |
| `showError` | `(container, message) → void` | Set container innerHTML to error banner. |
| `breadcrumb` | `() → BreadcrumbBuilder` | Fluent builder: `.projects().project(repo, slug).leaf(label).html()`. |
| `makeProjectCacheKey` | `(repo, slug) → string` | Returns `repo + '/' + slug`. |

### `ProjectNameCache` (utils.js)

LRU-like display name cache (max 200 entries, FIFO eviction).

| Method | Signature | Description |
|--------|-----------|-------------|
| `set` | `(key, name) → void` | Store a display name (key = `repo/slug`). |
| `get` | `(key) → string\|null` | Retrieve cached name; falls back to slug portion of key. |
| `_size` | `() → number` | Current cache size (testing only). |

---

### 2.7 View Render Functions (views/*.js)

Each view file exposes a global function called by `Router.dispatch()`:

| Function | File | Hash Route |
|----------|------|------------|
| `renderProjectList` | `project-list.js` | `#/` |
| `renderProjectDetail` | `project-detail.js` | `#/projects/:repo/:slug` |
| `renderPlan` | `project-detail.js` | `#/projects/:repo/:slug/plan` |
| `renderSynthesis` | `project-detail.js` | `#/projects/:repo/:slug/synthesis` |
| `renderWorkPackageDetail` | `work-package.js` | `#/projects/:repo/:slug/wp/:wpId` |
| `renderRunLog` | `run-log.js` | `#/projects/:repo/:slug/runs/:filename` |
| `renderOrchestrator` | `orchestrator.js` | `#/orchestrator` |
| `renderConfig` | `config.js` | `#/config` |
| `renderInsights` | `insights.js` | `#/insights` |
| `renderKnowledge` | `knowledge.js` | `#/knowledge` |

---

### 2.8 `UI` (components.js)

Shared UI render helpers. Loaded after `utils.js`; requires `escapeHtml()` to be available as a global. Follows the same IIFE-namespace pattern as `OrchestratorWidgets`.

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `badge` | `(type: string, label: string) → string` | HTML | Renders `<span class="badge badge-{type}">{label}</span>`. `type` is normalised (lowercase, spaces/underscores → hyphens). `label` is HTML-escaped. |
| `banner` | `(type: string, message: string) → string` | HTML | Renders `<p class="{type}-banner">{message}</p>`. `type` is normalised. `message` is HTML-escaped. Supported types: `error`, `success`, `info`, `stale`. |
| `emptyState` | `(message: string) → string` | HTML | Renders `<p class="text-muted mt-16">{message}</p>`. `message` is HTML-escaped. |

**Security note:** `_normaliseType()` is not HTML-escaped — the normalised type string is interpolated directly into class attribute values. All current callers pass server-controlled enum strings. If `UI.badge()` or `UI.banner()` is ever called with user-supplied input, the `type` argument must be sanitised at the call site.

**Exception:** `run-log.js` line ~271 retains one intentional inline badge (the cross-WP `tool_call` badge) because it requires a `title` tooltip attribute that `UI.badge()` does not support.

---

## 3. CSS Component Library

→ **See [ui-components.md](ui-components.md)** for the full CSS class inventory (theming tokens, buttons, `.btn-group`, badges, cards, tables, forms, state feedback, and all view-specific classes).
