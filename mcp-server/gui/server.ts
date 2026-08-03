/**
 * GUI HTTP Server
 *
 * Standalone Node.js HTTP server that routes requests to API handlers
 * (gui/api.ts) and serves static files from gui/public/. This is a SEPARATE
 * process from the MCP server — stdout logging is allowed and expected.
 *
 * CLI Arguments:
 *   --port <n>           Listen port (default: 3420)
 *   --ledger-dir <path>  Ledger root path (handled by resolveLedgerRoot())
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveLedgerRoot, resolveProjectDir, ORCHESTRATOR_LOGS_DIR, WORKSPACE_ROOT } from '../src/utils/ledger-root.js';
import { loadStoresConfig, resolveGuiConfigPath } from '../src/storage/store-registry.js';
import { StoreRouter } from '../src/storage/store-router.js';
import { MultiStoreManager } from '../src/storage/multi-store-manager.js';
import { setStoreContext, isStoreContextInitialized, getStoreRouter } from '../src/storage/store-context.js';
import { SAFE_SLUG_REGEX } from '../src/utils/constants.js';
import { captureWorkspaceVersions } from '../src/utils/workspace-versions.js';
import type { WorkspaceVersions } from '../src/utils/workspace-versions.js';
import { readConfigFromDisk, startConfigWatcher } from '../src/gui/config.js';
import { startAutoArchiveTimer } from '../src/gui/auto-archive.js';
import {
  handleListRunLogs,
  handleGetRunLog,
} from '../src/gui/handlers/run-log-handlers.js';
import {
  handleListProjects,
  handleGetProject,
  handleGetPlanDocument,
  handleGetSynthesisDocument,
  handleListWorkPackages,
  handleGetWorkPackage,
  handleDeleteProject,
  handleGetConfig,
  handleUpdateConfig,
  handleResetProject,
  handleGetProjectHealth,
  handleGetWorkPackageOverview,
  handleRenameProject,
  handleArchiveProject,
  handleUnarchiveProject,
  handleMarkProjectComplete,
  handleListDialogues,
  handleGetDialogueFile,
  handleListChunks,
  handleGetChunkFile,
  handleGetChunkText,
  handleOrchestratorStart,
  handleGetOrchestratorQueue,
  handleOrchestratorKill,
  handleOrchestratorDismiss,
  handleOrchestratorDelete,
  handleGetRunStatus,
  handleGetRunMetadata,
  ApiError,
} from './api.js';
import {
  handleGetStoresEnriched,
  handleGetStoreConflicts,
  handleAddStore,
  handleImportStore,
  handleUpdateStore,
  handleRemoveStore,
  handleSetDefaultStore,
  handleReorderStores,
} from './api-stores.js';
import {
  handleListKnowledge,
  handleUpdateKnowledge,
  handleDeleteKnowledge,
  handlePromoteKnowledge,
  handleMoveKnowledge,
} from './api-knowledge.js';
import {
  handleListRepos,
  handleGetRepo,
  handleCreateRepo,
  handleUpdateRepo,
  handleDeleteRepo,
  type RepoListItem,
} from './api-repos.js';
import {
  handleGetModels,
  handleSaveModels,
  handleLoadDefaults,
  handleGetAssignments,
  handleUpdateAssignments,
  handleReplaceAssignedModel,
  handleGetPersonas,
  handleRebuildPersonas,
} from './api-models.js';
import { renderChunksToDialogue, renderChunksToStructured } from './chunk-renderer.js';

// ---------------------------------------------------------------------------
// Path resolution (ESM-safe)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PUBLIC_DIR = join(__dirname, 'public');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function getPort(): number {
  const args = process.argv;
  const idx = args.indexOf('--port');
  if (idx !== -1 && idx + 1 < args.length) {
    const p = parseInt(args[idx + 1]!, 10);
    if (!isNaN(p) && p > 0) return p;
  }
  return 3420;
}

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
};

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function corsHeaders(port: number): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': `http://localhost:${port}`,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
  };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendJson(
  res: ServerResponse,
  status: number,
  data: unknown,
  port: number
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders(port),
    ...securityHeaders(),
  });
  res.end(body);
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  port: number
): void {
  sendJson(res, status, { error: { code, message } }, port);
}

export function apiErrorToStatus(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN':
      return 403;
    case 'VALIDATION_ERROR':
      return 400;
    case 'CONFLICT':
      return 409;
    default:
      return 500;
  }
}

// ---------------------------------------------------------------------------
// Body reading
// ---------------------------------------------------------------------------

/** Maximum accepted request body size (1 MiB). */
export const MAX_BODY_BYTES = 1_048_576;

/** Thrown by {@link readBody} when the request body exceeds {@link MAX_BODY_BYTES}. */
export class PayloadTooLargeError extends Error {
  constructor() {
    super('Payload Too Large');
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Reads the full request body as a UTF-8 string, enforcing a size limit of
 * {@link MAX_BODY_BYTES} (1 MiB).
 *
 * @throws {PayloadTooLargeError} When the body exceeds the limit (detected
 *   either via Content-Length header pre-check or streaming byte count).
 *   **Callers must catch this error and return a 413 response.**
 *
 * @param req - The incoming HTTP request.
 * @returns The full body string.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    // Content-Length pre-check: reject immediately if the declared size exceeds the limit.
    const declaredLength = req.headers['content-length'];
    if (declaredLength !== undefined) {
      const n = parseInt(declaredLength, 10);
      if (!isNaN(n) && n > MAX_BODY_BYTES) {
        req.resume();  // drain body data from socket buffer
        reject(new PayloadTooLargeError());
        return;
      }
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let rejected = false;

    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        rejected = true;
        reject(new PayloadTooLargeError());
        // Drain remaining data so the 413 response can be sent cleanly.
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', (err) => {
      if (!rejected) reject(err);
    });
  });
}

/**
 * Reads and parses the request body as JSON, enforcing the same size limit as
 * {@link readBody}. Throws {@link PayloadTooLargeError} for oversized bodies
 * and {@link ApiError} with code `VALIDATION_ERROR` for invalid JSON.
 *
 * @param req - The incoming HTTP request.
 * @returns The parsed JSON value.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Invalid JSON body.');
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * The set of HTTP methods accepted by the route dispatcher.
 *
 * Narrowing `Route.method` to this union converts a previously runtime-only
 * validation (enforced by `route-table.test.ts`) into a compile-time guarantee.
 * The test continues to serve as defense-in-depth.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * A declarative body-parsing route entry for {@link buildRoutes} and
 * {@link dispatchRoute}.
 *
 * - `method` — HTTP method; must be one of the {@link HttpMethod} values
 *   (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, uppercase). The union type
 *   enforces this at compile time; `route-table.test.ts` provides
 *   defense-in-depth at test time.
 * - `path` — Exact string path or a RegExp with named capture groups.
 * - `handler` — Receives the parsed body (or `undefined` when `noBody` is
 *   set), any named capture groups extracted from the RegExp match, and the
 *   parsed query parameters from the request URL.
 * - `statusCode` — Response status code (default `200`). Use `204` for empty
 *   responses — the dispatcher writes the header and skips `sendJson()`.
 * - `noBody` — When `true`, skip `readJsonBody()`.
 */
export interface Route {
  method: HttpMethod;
  path: string | RegExp;
  handler: (body: unknown, groups?: Record<string, string>, query?: URLSearchParams) => Promise<unknown>;
  statusCode?: number;
  noBody?: boolean;
}

// ---------------------------------------------------------------------------
// Meta helpers
// ---------------------------------------------------------------------------

/**
 * Guards against path-traversal attacks on URL parameters that are used as
 * filesystem path segments.
 *
 * Rejects any segment that is empty or does not match {@link SAFE_SLUG_REGEX}
 * (`/^[a-z0-9][a-z0-9-]*$/`). Throws {@link ApiError} `NOT_FOUND` so that
 * callers receive the same status as a missing project — no information leak.
 *
 * @param segment - The raw URL parameter value to validate.
 */
function assertSafeSlug(segment: string): void {
  if (!segment || !SAFE_SLUG_REGEX.test(segment)) {
    throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
  }
}

/**
 * Reads the `.meta.json` for a namespaced project at
 * `{ledgerRoot}/{repoUrlParam}/{slugUrlParam}/.meta.json`.
 *
 * Returns the stored `repository_name` value, falling back to `repoUrlParam`
 * when the field is absent or null.
 *
 * When the meta file exists but contains malformed JSON, the function still
 * falls back to `repoUrlParam` — but writes a warning to `process.stderr`
 * (format: `[server] Warning: malformed .meta.json at {path} — falling back
 * to URL param '…'`) so operators can detect corrupt meta files during
 * troubleshooting. API callers always receive the fallback value in this case.
 *
 * Throws {@link ApiError} `NOT_FOUND` when the meta file does not exist —
 * indicating that the `{repo}/{slug}` combination is not a known project in
 * this ledger. This is the project-existence check for namespaced routes.
 * Using `NOT_FOUND` (rather than a 400 or `VALIDATION_ERROR`) is intentional
 * information-hiding: invalid-input and missing-project cases are
 * indistinguishable from the client side.
 *
 * Both `repoUrlParam` and `slugUrlParam` are validated via {@link assertSafeSlug}
 * before any filesystem access is attempted (defence-in-depth).
 */
export async function resolveRepoName(
  ledgerRoot: string,
  repoUrlParam: string,
  slugUrlParam: string,
): Promise<string> {
  assertSafeSlug(repoUrlParam);
  assertSafeSlug(slugUrlParam);

  // In multi-store mode, search all configured stores; fall back to default store otherwise.
  const storePaths =
    isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()
      ? getStoreRouter().getAllStorePaths()
      : [ledgerRoot];

  for (const storePath of storePaths) {
    const metaPath = join(storePath, repoUrlParam, slugUrlParam, '.meta.json');
    let raw: string;
    try {
      raw = await readFile(metaPath, 'utf-8');
    } catch {
      // .meta.json not found in this store — try next
      continue;
    }
    try {
      const meta = JSON.parse(raw) as { repository_name?: string | null };
      return meta.repository_name ?? repoUrlParam;
    } catch {
      // Malformed .meta.json — log and fall back to URL param
      process.stderr.write(`[server] Warning: malformed .meta.json at ${metaPath} — falling back to URL param '${repoUrlParam}'\n`);
      return repoUrlParam;
    }
  }

  throw new ApiError('NOT_FOUND', `Project not found: ${slugUrlParam}`);
}

/**
 * Extracts query-string parameters from a full URL string.
 * Returns a URLSearchParams instance (empty if no query string present).
 *
 * Edge-case behaviour:
 * - **Bare `?`** (e.g. `/api/foo?`): `url.slice(qIdx + 1)` is `""` → returns
 *   an empty `URLSearchParams`. Safe, no exceptions.
 * - **Percent-encoded values** (e.g. `?q=hello%20world`): `URLSearchParams`
 *   decodes them transparently — `params.get('q')` returns `"hello world"`.
 * - **Fragment / hash characters** (e.g. `?x=1#anchor`): the `#` and
 *   everything after it are passed through as literal characters inside the
 *   query value because no fragment stripping is performed. Browsers strip the
 *   fragment before sending the request, so in practice this situation does not
 *   arise for server-received URLs.
 */
function parseQueryString(url: string): URLSearchParams {
  const qIdx = url.indexOf('?');
  return new URLSearchParams(qIdx !== -1 ? url.slice(qIdx + 1) : '');
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  port: number
): Promise<void> {
  const urlPath = (req.url ?? '/').split('?')[0]!;
  const filePath =
    urlPath === '/' ? join(PUBLIC_DIR, 'index.html') : join(PUBLIC_DIR, urlPath.slice(1));

  // Security: prevent path traversal outside PUBLIC_DIR
  const resolved = resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendError(res, 404, 'NOT_FOUND', 'Not found.', port);
    return;
  }

  const ext = extname(filePath);
  const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': content.length,
      'Cache-Control': 'no-store',
      ...corsHeaders(port),
      ...securityHeaders(),
    });
    res.end(content);
  } catch {
    sendError(res, 404, 'NOT_FOUND', 'Not found.', port);
  }
}

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Domain sub-builders
//
// Each function returns Route[] for a single domain area and captures only the
// closure parameters it needs. All sub-builders are non-exported: they are
// composed exclusively by buildRoutes().
// ---------------------------------------------------------------------------

/**
 * Config/server-info routes.
 *
 * Section A:
 *   PUT  /api/config
 *   GET  /api/server-info
 *   GET  /api/config
 */
function buildConfigRoutes(
  configPath: string,
  bootVersions: WorkspaceVersions | null
): Route[] {
  return [
    // PUT /api/config
    { method: 'PUT', path: '/api/config',
      handler: async (body) => handleUpdateConfig(configPath, body) },
    // GET /api/server-info — needs bootVersions closure
    { method: 'GET', path: '/api/server-info', noBody: true,
      handler: async () => {
        const boot = bootVersions ?? captureWorkspaceVersions();
        const disk = captureWorkspaceVersions();
        const stale =
          boot.mcpServer !== disk.mcpServer ||
          boot.personas !== disk.personas ||
          boot.orchestrator !== disk.orchestrator;
        return { stale, bootVersions: boot, diskVersions: disk };
      } },
    // GET /api/config
    { method: 'GET', path: '/api/config', noBody: true,
      handler: async () => handleGetConfig(configPath) },
  ];
}

/**
 * Orchestrator routes (Section A body-parsing and Section B body-free).
 *
 * Section A:
 *   POST /api/orchestrator/start
 *   POST /api/orchestrator/kill/:id
 *   POST /api/orchestrator/dismiss/:id
 *   POST /api/orchestrator/delete/:id
 *
 * Section B:
 *   GET  /api/orchestrator/queue
 *   GET  /api/orchestrator/run-status/:filename
 */
function buildOrchestratorRoutes(
  ledgerRoot: string,
  orchestratorLogsDir: string
): Route[] {
  return [
    // POST /api/orchestrator/start
    { method: 'POST', path: '/api/orchestrator/start',
      handler: async (body) => handleOrchestratorStart(WORKSPACE_ROOT, body) },
    // POST /api/orchestrator/kill/:id
    { method: 'POST', path: /^\/api\/orchestrator\/kill\/(?<id>.+)$/, noBody: true,
      handler: async (_, groups) =>
        handleOrchestratorKill(
          decodeURIComponent(groups!.id!), orchestratorLogsDir, ledgerRoot
        ) },
    // POST /api/orchestrator/dismiss/:id — 204 No Content
    { method: 'POST', path: /^\/api\/orchestrator\/dismiss\/(?<id>.+)$/, noBody: true,
      statusCode: 204,
      handler: async (_, groups) => {
        await handleOrchestratorDismiss(
          decodeURIComponent(groups!.id!), orchestratorLogsDir, ledgerRoot
        );
        return undefined;
      } },
    // POST /api/orchestrator/delete/:id — 204 No Content
    { method: 'POST', path: /^\/api\/orchestrator\/delete\/(?<id>.+)$/, noBody: true,
      statusCode: 204,
      handler: async (_, groups) => {
        await handleOrchestratorDelete(
          decodeURIComponent(groups!.id!), orchestratorLogsDir
        );
        return undefined;
      } },
    // GET /api/orchestrator/queue
    { method: 'GET', path: '/api/orchestrator/queue', noBody: true,
      handler: async () => handleGetOrchestratorQueue(orchestratorLogsDir, ledgerRoot) },
    // GET /api/orchestrator/run-status/:filename
    { method: 'GET', path: /^\/api\/orchestrator\/run-status\/(?<filename>.+)$/, noBody: true,
      handler: async (_, groups) =>
        handleGetRunStatus(orchestratorLogsDir, decodeURIComponent(groups!.filename!)) },
  ];
}

/**
 * Repository routes (Section A body-parsing and Section B body-free).
 *
 * Section A:
 *   POST   /api/repos
 *   PUT    /api/repos/:repoId
 *
 * Section B:
 *   GET    /api/repos
 *   GET    /api/repos/:repoId
 *   DELETE /api/repos/:repoId
 */

function buildRepoRoutes(ledgerRoot: string): Route[] {
  return [
    // POST /api/repos — 201 Created
    { method: 'POST', path: '/api/repos', statusCode: 201,
      handler: async (body) => handleCreateRepo(ledgerRoot, body) },
    // PUT /api/repos/:repoId
    { method: 'PUT', path: /^\/api\/repos\/(?<repoId>[^/]+)$/,
      handler: async (body, groups) =>
        handleUpdateRepo(ledgerRoot, decodeURIComponent(groups!.repoId!), body) },
    // GET /api/repos — always delegates to handleListRepos() which handles
    //   both multi-store (tagged results) and single-store modes.
    { method: 'GET', path: '/api/repos', noBody: true,
      handler: async (_, _groups, query) =>
        handleListRepos(ledgerRoot, query?.get('include_undeclared') === 'true') },
    // GET /api/repos/:repoId
    { method: 'GET', path: /^\/api\/repos\/(?<repoId>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleGetRepo(ledgerRoot, decodeURIComponent(groups!.repoId!)) },
    // DELETE /api/repos/:repoId
    { method: 'DELETE', path: /^\/api\/repos\/(?<repoId>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleDeleteRepo(ledgerRoot, decodeURIComponent(groups!.repoId!)) },
  ];
}

/**
 * Knowledge routes (Section A body-parsing and Section B body-free).
 *
 * Section A:
 *   PATCH /api/knowledge/:id
 *   POST  /api/knowledge/:id/move
 *
 * Section B:
 *   GET    /api/knowledge
 *   DELETE /api/knowledge/:id
 *   POST   /api/knowledge/:id/promote
 */
function buildKnowledgeRoutes(ledgerRoot: string): Route[] {
  return [
    // PATCH /api/knowledge/:id
    { method: 'PATCH', path: /^\/api\/knowledge\/(?<id>[^/]+)$/,
      handler: async (body, groups) =>
        handleUpdateKnowledge(ledgerRoot, decodeURIComponent(groups!.id!), body) },
    // POST /api/knowledge/:id/move
    { method: 'POST', path: /^\/api\/knowledge\/(?<id>[^/]+)\/move$/,
      handler: async (body, groups) =>
        handleMoveKnowledge(ledgerRoot, decodeURIComponent(groups!.id!), body) },
    // GET /api/knowledge[?scope&category&tags&repository_name&query&limit&offset]
    { method: 'GET', path: '/api/knowledge', noBody: true,
      handler: async (_, _groups, query) => {
        const params = {
          scope: query?.get('scope') ?? undefined,
          category: query?.get('category') ?? undefined,
          tags: query?.get('tags') ?? undefined,
          repository_name: query?.get('repository_name') ?? undefined,
          query: query?.get('query') ?? undefined,
          limit: query?.get('limit') ?? undefined,
          offset: query?.get('offset') ?? undefined,
        };
        return handleListKnowledge(ledgerRoot, params);
      } },
    // DELETE /api/knowledge/:id[?scope&repository_name]
    { method: 'DELETE', path: /^\/api\/knowledge\/(?<id>[^/]+)$/, noBody: true,
      handler: async (_, groups, query) =>
        handleDeleteKnowledge(
          ledgerRoot,
          decodeURIComponent(groups!.id!),
          query?.get('scope') ?? undefined,
          query?.get('repository_name') ?? undefined,
        ) },
    // POST /api/knowledge/:id/promote[?scope&repository_name]
    { method: 'POST', path: /^\/api\/knowledge\/(?<id>[^/]+)\/promote$/, noBody: true,
      handler: async (_, groups, query) =>
        handlePromoteKnowledge(
          ledgerRoot,
          decodeURIComponent(groups!.id!),
          query?.get('scope') ?? undefined,
          query?.get('repository_name') ?? undefined,
        ) },
  ];
}

/**
 * Model/assignment/persona routes (Section A body-parsing and Section B body-free).
 *
 * Section A:
 *   PUT  /api/models
 *   POST /api/models/load-defaults
 *   PUT  /api/model-assignments
 *   POST /api/model-assignments/replace
 *   POST /api/personas/rebuild
 *
 * Section B:
 *   GET  /api/models
 *   GET  /api/model-assignments
 *   GET  /api/personas
 */
function buildModelRoutes(): Route[] {
  return [
    // PUT /api/models
    { method: 'PUT', path: '/api/models',
      handler: async (body) => handleSaveModels(body) },
    // POST /api/models/load-defaults
    { method: 'POST', path: '/api/models/load-defaults', noBody: true,
      handler: async () => handleLoadDefaults() },
    // PUT /api/model-assignments
    { method: 'PUT', path: '/api/model-assignments',
      handler: async (body) => handleUpdateAssignments(body) },
    // POST /api/model-assignments/replace
    { method: 'POST', path: '/api/model-assignments/replace',
      handler: async (body) => handleReplaceAssignedModel(body) },
    // POST /api/personas/rebuild — conditional ApiError on build failure
    { method: 'POST', path: '/api/personas/rebuild', noBody: true,
      handler: async () => {
        const result = await handleRebuildPersonas(WORKSPACE_ROOT);
        if (!result.success) throw new ApiError('BUILD_FAILED', result.output);
        return result;
      } },
    // GET /api/models
    { method: 'GET', path: '/api/models', noBody: true,
      handler: async () => handleGetModels() },
    // GET /api/model-assignments
    { method: 'GET', path: '/api/model-assignments', noBody: true,
      handler: async () => handleGetAssignments() },
    // GET /api/personas
    { method: 'GET', path: '/api/personas', noBody: true,
      handler: async () => handleGetPersonas() },
  ];
}

/**
 * Store routes (Section A body-parsing and Section B body-free).
 *
 * Section A — Body-parsing write routes:
 *   POST   /api/stores              — add a new store (creates directory)
 *   POST   /api/stores/import       — import existing directory as a store
 *   PUT    /api/stores/order         — reorder stores
 *   PUT    /api/stores/:storeId     — update store label
 *
 * Section B — Body-free routes:
 *   DELETE /api/stores/:storeId     — remove store (deregisters only)
 *   POST   /api/stores/:storeId/default — set the default store
 *   GET    /api/stores/conflicts    — cross-store conflicts (literal path)
 *   GET    /api/stores              — enriched store list (catch-all)
 *
 * ⚠️  ORDERING CONSTRAINT: Literal-path routes (/import, /order, /conflicts)
 *     MUST precede parameterised :storeId routes to avoid shadowing.
 *     GET /api/stores/conflicts MUST precede the GET /api/stores catch-all.
 */
function buildStoreRoutes(ledgerRoot: string): Route[] {
  return [
    // =========================================================================
    // Section A — Body-parsing store write routes
    // =========================================================================

    // POST /api/stores — add new store (201 Created)
    { method: 'POST', path: '/api/stores', statusCode: 201,
      handler: async (body) => handleAddStore(body) },
    // POST /api/stores/import — literal path must precede :storeId routes (201 Created)
    { method: 'POST', path: '/api/stores/import', statusCode: 201,
      handler: async (body) => handleImportStore(body) },
    // PUT /api/stores/order — literal path must precede :storeId routes
    { method: 'PUT', path: '/api/stores/order',
      handler: async (body) => handleReorderStores(body) },
    // PUT /api/stores/:storeId — update store label
    { method: 'PUT', path: /^\/api\/stores\/(?<storeId>[^/]+)$/,
      handler: async (body, groups) =>
        handleUpdateStore(decodeURIComponent(groups!.storeId!), body) },

    // =========================================================================
    // Section B — Body-free store routes
    // =========================================================================

    // DELETE /api/stores/:storeId — remove store (no directory deletion)
    { method: 'DELETE', path: /^\/api\/stores\/(?<storeId>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleRemoveStore(decodeURIComponent(groups!.storeId!)) },
    // POST /api/stores/:storeId/default — set default store
    { method: 'POST', path: /^\/api\/stores\/(?<storeId>[^/]+)\/default$/, noBody: true,
      handler: async (_, groups) =>
        handleSetDefaultStore(decodeURIComponent(groups!.storeId!)) },
    // GET /api/stores/conflicts — must precede the /api/stores catch-all
    { method: 'GET', path: '/api/stores/conflicts', noBody: true,
      handler: async () => handleGetStoreConflicts() },
    // GET /api/stores — enriched store list (catch-all, must be last)
    { method: 'GET', path: '/api/stores', noBody: true,
      handler: async () => handleGetStoresEnriched(ledgerRoot) },
  ];
}

/**
 * Project routes spanning all three sections.
 *
 * Section A — Body-parsing mutations on projects:
 *   PATCH /api/projects/:repo/:slug  (namespaced)
 *   PATCH /api/projects/:slug  (deprecated)
 *   POST  /api/projects/:repo/:slug/reset  (namespaced)
 *   POST  /api/projects/:slug/reset  (deprecated)
 *
 * Section B — Keyword-specific body-free routes (active namespaced + deprecated):
 *   GET  /api/projects
 *   GET  /api/projects/:repo/:slug/plan|synthesis|health|run-metadata|work-packages|...
 *   POST /api/projects/:repo/:slug/archive|unarchive|complete
 *   ... and deprecated /:slug/keyword analogues
 *
 * Section C — Catch-all body-free routes:
 *   DELETE /api/projects/:repo/:slug  (namespaced)
 *   GET    /api/projects/:repo/:slug  (namespaced, catch-all)
 *
 * ⚠️  ORDERING CONSTRAINT: Section B keyword routes MUST precede Section C
 *     catch-alls within this sub-builder. The caller (buildRoutes) preserves
 *     the overall Section A/B/C ordering by spreading sub-builder results in
 *     the correct order.
 */
function buildProjectRoutes(
  ledgerRoot: string,
  orchestratorLogsDir: string
): Route[] {
  return [

    // =========================================================================
    // Section A — Body-parsing project mutations
    // =========================================================================

    // PATCH /api/projects/:repo/:slug (namespaced)
    { method: 'PATCH', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)$/,
      handler: async (body, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleRenameProject(ledgerRoot, slug, body, repoName);
      } },
    // @deprecated — Use PATCH /api/projects/:repo/:slug instead.
    // PATCH /api/projects/:slug (retained for backward compat)
    { method: 'PATCH', path: /^\/api\/projects\/(?<slug>[^/]+)$/,
      handler: async (body, groups) =>
        handleRenameProject(ledgerRoot, decodeURIComponent(groups!.slug!), body) },
    // POST /api/projects/:repo/:slug/reset (namespaced)
    { method: 'POST', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/reset$/,
      handler: async (body, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleResetProject(ledgerRoot, slug, body, repoName);
      } },
    // @deprecated — Use POST /api/projects/:repo/:slug/reset instead.
    // POST /api/projects/:slug/reset (retained for backward compat)
    { method: 'POST', path: /^\/api\/projects\/(?<slug>[^/]+)\/reset$/,
      handler: async (body, groups) =>
        handleResetProject(ledgerRoot, decodeURIComponent(groups!.slug!), body) },

    // =========================================================================
    // Section B — Keyword-specific body-free routes
    //
    // ⚠️  These MUST be declared before Section C catch-alls (see ordering note
    //     in the JSDoc of buildRoutes). Adding a catch-all before these entries
    //     would silently shadow the deprecated keyword routes and break backward
    //     compat.
    // =========================================================================

    // GET /api/projects[?page&limit&status&search&sort&dir&runner]
    { method: 'GET', path: '/api/projects', noBody: true,
      handler: async (_, _groups, query) => {
        const params = {
          page: query?.get('page') ?? undefined,
          limit: query?.get('limit') ?? undefined,
          status: query?.get('status') ?? undefined,
          search: query?.get('search') ?? undefined,
          sort: query?.get('sort') ?? undefined,
          dir: query?.get('dir') ?? undefined,
          runner: query?.get('runner') ?? undefined,
        };
        return handleListProjects(ledgerRoot, params);
      } },

    // --- Namespaced /:repo/:slug keyword routes (active) ---
    // Placed in Section B because they have fixed keyword suffixes (e.g. /plan,
    // /synthesis) that make them more specific than the Section C catch-all.

    // GET /api/projects/:repo/:slug/plan
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/plan$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetPlanDocument(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug/synthesis
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/synthesis$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetSynthesisDocument(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug/health
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/health$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetProjectHealth(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug/run-metadata
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/run-metadata$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetRunMetadata(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug/work-packages
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/work-packages$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleListWorkPackages(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug/work-packages/overview
    // Must appear BEFORE /:repo/:slug/work-packages/:wpId — same prefix, more specific suffix.
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/work-packages\/overview$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetWorkPackageOverview(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug/work-packages/:wpId
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/work-packages\/(?<wpId>[^/]+)$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetWorkPackage(ledgerRoot, slug, groups!.wpId!, repoName);
      } },

    // GET /api/projects/:repo/:slug/dialogues[?wp=WP-001]
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/dialogues$/, noBody: true,
      handler: async (_, groups, query) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleListDialogues(ledgerRoot, slug, query?.get('wp') ?? undefined, repoName);
      } },

    // GET /api/projects/:repo/:slug/dialogues/:filename
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/dialogues\/(?<filename>[^/]+)$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetDialogueFile(ledgerRoot, slug, decodeURIComponent(groups!.filename!), repoName);
      } },

    // GET /api/projects/:repo/:slug/chunks[?wp=WP-001]
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/chunks$/, noBody: true,
      handler: async (_, groups, query) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleListChunks(ledgerRoot, slug, query?.get('wp') ?? undefined, repoName);
      } },

    // GET /api/projects/:repo/:slug/chunks/:filename/rendered[?format=structured]
    // Must appear BEFORE /:repo/:slug/chunks/:filename — same prefix, more specific suffix.
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/chunks\/(?<filename>[^/]+)\/rendered$/, noBody: true,
      handler: async (_, groups, query) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        const filename = decodeURIComponent(groups!.filename!);
        if (query?.get('format') === 'structured') {
          return handleGetChunkFile(ledgerRoot, slug, filename, repoName).then(({ content }) => ({
            blocks: renderChunksToStructured(content),
          }));
        }
        return handleGetChunkFile(ledgerRoot, slug, filename, repoName).then(({ content }) => ({
          content: renderChunksToDialogue(content),
        }));
      } },

    // GET /api/projects/:repo/:slug/chunks/:filename
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/chunks\/(?<filename>[^/]+)$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetChunkFile(ledgerRoot, slug, decodeURIComponent(groups!.filename!), repoName);
      } },

    // GET /api/projects/:repo/:slug/runs
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/runs$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        // Explicit SAFE_SLUG_REGEX guard before any path construction — makes the
        // path-traversal defence direct rather than relying on the indirect
        // resolveRepoName NOT_FOUND guard (defence-in-depth per Security Auditor).
        if (!SAFE_SLUG_REGEX.test(repo) || !SAFE_SLUG_REGEX.test(slug)) {
          throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
        }
        // logsDir uses the URL segments to locate the directory. Unlike other namespaced
        // routes, we do NOT call resolveRepoName here — log files must be readable for
        // active runs whose project ledger hasn't been initialised yet (no .meta.json).
        // In multi-store mode, resolve the correct store path via the repo registry.
        let storePathForLogs = ledgerRoot;
        if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
          const storeRef = await getStoreRouter().resolveStoreForRepo(repo);
          if (storeRef !== null) storePathForLogs = storeRef.storePath;
        }
        const logsDir = join(storePathForLogs, repo, slug, 'orchestrator', 'logs');
        return handleListRunLogs(slug, repo, logsDir, orchestratorLogsDir);
      } },

    // GET /api/projects/:repo/:slug/runs/:filename[?after=N]
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/runs\/(?<filename>[^/]+)$/, noBody: true,
      handler: async (_, groups, query) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        const filename = decodeURIComponent(groups!.filename!);
        // Explicit SAFE_SLUG_REGEX guard before any path construction (defence-in-depth).
        if (!SAFE_SLUG_REGEX.test(repo) || !SAFE_SLUG_REGEX.test(slug)) {
          throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
        }
        const afterParam = query?.get('after');
        const afterParsed = afterParam != null ? parseInt(afterParam, 10) : NaN;
        const afterLine = !isNaN(afterParsed) ? afterParsed : undefined;
        // logsDir uses the URL segments — do NOT call resolveRepoName here (see runs list note).
        // In multi-store mode, resolve the correct store path via the repo registry.
        let storePathForLogs = ledgerRoot;
        if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
          const storeRef = await getStoreRouter().resolveStoreForRepo(repo);
          if (storeRef !== null) storePathForLogs = storeRef.storePath;
        }
        const logsDir = join(storePathForLogs, repo, slug, 'orchestrator', 'logs');
        return handleGetRunLog(slug, repo, filename, logsDir, orchestratorLogsDir, afterLine);
      } },

    // POST /api/projects/:repo/:slug/archive
    { method: 'POST', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/archive$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleArchiveProject(ledgerRoot, slug, repoName);
      } },

    // POST /api/projects/:repo/:slug/unarchive
    { method: 'POST', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/unarchive$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleUnarchiveProject(ledgerRoot, slug, repoName);
      } },

    // POST /api/projects/:repo/:slug/complete
    { method: 'POST', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/complete$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleMarkProjectComplete(ledgerRoot, slug, repoName);
      } },

    // --- Deprecated non-namespaced /:slug keyword routes ---
    // Retained for backward compatibility. Each is adjacent to its active analogue
    // above for easy comparison. These MUST remain in Section B (before catch-alls).

    // @deprecated — Use GET /api/projects/:repo/:slug/plan instead.
    // GET /api/projects/:slug/plan
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/plan$/, noBody: true,
      handler: async (_, groups) =>
        handleGetPlanDocument(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/synthesis instead.
    // GET /api/projects/:slug/synthesis
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/synthesis$/, noBody: true,
      handler: async (_, groups) =>
        handleGetSynthesisDocument(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/health instead.
    // GET /api/projects/:slug/health
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/health$/, noBody: true,
      handler: async (_, groups) =>
        handleGetProjectHealth(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/run-metadata instead.
    // GET /api/projects/:slug/run-metadata
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/run-metadata$/, noBody: true,
      handler: async (_, groups) =>
        handleGetRunMetadata(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/work-packages instead.
    // GET /api/projects/:slug/work-packages
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/work-packages$/, noBody: true,
      handler: async (_, groups) =>
        handleListWorkPackages(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/work-packages/overview instead.
    // GET /api/projects/:slug/work-packages/overview
    // Must appear BEFORE /:slug/work-packages/:wpId — same prefix, more specific suffix.
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/work-packages\/overview$/, noBody: true,
      handler: async (_, groups) =>
        handleGetWorkPackageOverview(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/work-packages/:wpId instead.
    // GET /api/projects/:slug/work-packages/:wpId
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/work-packages\/(?<wpId>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleGetWorkPackage(ledgerRoot, decodeURIComponent(groups!.slug!), groups!.wpId!) },

    // @deprecated — Use GET /api/projects/:repo/:slug/dialogues instead.
    // GET /api/projects/:slug/dialogues[?wp=WP-001]
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/dialogues$/, noBody: true,
      handler: async (_, groups, query) =>
        handleListDialogues(ledgerRoot, decodeURIComponent(groups!.slug!), query?.get('wp') ?? undefined) },

    // @deprecated — Use GET /api/projects/:repo/:slug/dialogues/:filename instead.
    // GET /api/projects/:slug/dialogues/:filename
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/dialogues\/(?<filename>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleGetDialogueFile(ledgerRoot, decodeURIComponent(groups!.slug!), decodeURIComponent(groups!.filename!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/chunks instead.
    // GET /api/projects/:slug/chunks[?wp=WP-001]
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/chunks$/, noBody: true,
      handler: async (_, groups, query) =>
        handleListChunks(ledgerRoot, decodeURIComponent(groups!.slug!), query?.get('wp') ?? undefined) },

    // @deprecated — Use GET /api/projects/:repo/:slug/chunks/:filename/rendered instead.
    // GET /api/projects/:slug/chunks/:filename/rendered[?format=structured]
    // Must appear BEFORE /:slug/chunks/:filename — same prefix, more specific suffix.
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/chunks\/(?<filename>[^/]+)\/rendered$/, noBody: true,
      handler: async (_, groups, query) => {
        const slug = decodeURIComponent(groups!.slug!);
        const filename = decodeURIComponent(groups!.filename!);
        if (query?.get('format') === 'structured') {
          return handleGetChunkFile(ledgerRoot, slug, filename).then(({ content }) => ({
            blocks: renderChunksToStructured(content),
          }));
        }
        return handleGetChunkFile(ledgerRoot, slug, filename).then(({ content }) => ({
          content: renderChunksToDialogue(content),
        }));
      } },

    // @deprecated — Use GET /api/projects/:repo/:slug/chunks/:filename instead.
    // GET /api/projects/:slug/chunks/:filename
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/chunks\/(?<filename>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleGetChunkFile(ledgerRoot, decodeURIComponent(groups!.slug!), decodeURIComponent(groups!.filename!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/runs instead.
    // GET /api/projects/:slug/runs
    // Resolves the canonical namespaced storage directory first to avoid creating
    // ghost directories under the legacy flat path when archiveCompletedLogs runs.
    // Falls back to the legacy flat path for truly pre-namespace projects.
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/runs$/, noBody: true,
      handler: async (_, groups) => {
        const slug = decodeURIComponent(groups!.slug!);
        const flatProjectDir = join(ledgerRoot, slug);
        let projectStorageDir: string;
        try {
          projectStorageDir = await resolveProjectDir(slug, ledgerRoot);
        } catch {
          projectStorageDir = flatProjectDir;
        }
        const logsDir = join(projectStorageDir, 'orchestrator', 'logs');
        const isNamespaced = projectStorageDir !== flatProjectDir;
        const legacyLogsDir = isNamespaced ? join(flatProjectDir, 'orchestrator', 'logs') : flatProjectDir;
        const legacyLogsDir2 = isNamespaced ? flatProjectDir : undefined;
        return handleListRunLogs(slug, slug, logsDir, orchestratorLogsDir, legacyLogsDir, legacyLogsDir2);
      } },

    // @deprecated — Use GET /api/projects/:repo/:slug/runs/:filename instead.
    // GET /api/projects/:slug/runs/:filename[?after=N]
    // Resolves the canonical namespaced storage directory first (same as the list
    // route above) to avoid creating ghost directories under the legacy flat path.
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/runs\/(?<filename>[^/]+)$/, noBody: true,
      handler: async (_, groups, query) => {
        const slug = decodeURIComponent(groups!.slug!);
        const filename = decodeURIComponent(groups!.filename!);
        const afterParam = query?.get('after');
        const afterParsed = afterParam != null ? parseInt(afterParam, 10) : NaN;
        const afterLine = !isNaN(afterParsed) ? afterParsed : undefined;
        const flatProjectDir = join(ledgerRoot, slug);
        let projectStorageDir: string;
        try {
          projectStorageDir = await resolveProjectDir(slug, ledgerRoot);
        } catch {
          projectStorageDir = flatProjectDir;
        }
        const logsDir = join(projectStorageDir, 'orchestrator', 'logs');
        return handleGetRunLog(slug, slug, filename, logsDir, orchestratorLogsDir, afterLine);
      } },

    // @deprecated — Use DELETE /api/projects/:repo/:slug instead.
    // DELETE /api/projects/:slug
    { method: 'DELETE', path: /^\/api\/projects\/(?<slug>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleDeleteProject(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use POST /api/projects/:repo/:slug/archive instead.
    // POST /api/projects/:slug/archive
    { method: 'POST', path: /^\/api\/projects\/(?<slug>[^/]+)\/archive$/, noBody: true,
      handler: async (_, groups) =>
        handleArchiveProject(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use POST /api/projects/:repo/:slug/unarchive instead.
    // POST /api/projects/:slug/unarchive
    { method: 'POST', path: /^\/api\/projects\/(?<slug>[^/]+)\/unarchive$/, noBody: true,
      handler: async (_, groups) =>
        handleUnarchiveProject(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use POST /api/projects/:repo/:slug/complete instead.
    // POST /api/projects/:slug/complete
    { method: 'POST', path: /^\/api\/projects\/(?<slug>[^/]+)\/complete$/, noBody: true,
      handler: async (_, groups) =>
        handleMarkProjectComplete(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // =========================================================================
    // Section C — Catch-all body-free routes
    //
    // ⚠️  These MUST be declared after Section B (see ordering note in JSDoc).
    //     The namespaced GET /:repo/:slug catch-all would shadow all deprecated
    //     /:slug/keyword routes at the same segment count if placed before them.
    // =========================================================================

    // DELETE /api/projects/:repo/:slug (namespaced)
    { method: 'DELETE', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleDeleteProject(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug (namespaced, catch-all)
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetProject(ledgerRoot, slug, repoName);
      } },
  ];
}

/**
 * Builds the declarative route table consumed by {@link dispatchRoute}.
 *
 * All closure variables required by route handlers (`ledgerRoot`, `configPath`,
 * `orchestratorLogsDir`, `bootVersions`) are captured via the domain sub-builder
 * functions. Each sub-builder owns a single domain area and accepts only the
 * closure parameters it needs:
 *
 *   - {@link buildConfigRoutes}      — `PUT/GET /api/config`, `GET /api/server-info`
 *   - {@link buildOrchestratorRoutes} — `/api/orchestrator/*`
 *   - {@link buildRepoRoutes}         — `/api/repos/*`
 *   - {@link buildKnowledgeRoutes}    — `/api/knowledge/*`
 *   - {@link buildModelRoutes}        — `/api/models/*`, `/api/model-assignments/*`, `/api/personas/*`
 *   - {@link buildStoreRoutes}        — `/api/stores/*`
 *   - {@link buildProjectRoutes}      — `/api/projects/*`
 *
 * The composed array preserves the Section A/B/C ordering invariant:
 *
 *   Section A — Body-parsing routes (no `noBody` flag). Sub-builders place their
 *               Section A entries first; buildRoutes spreads them in domain order.
 *
 *   Section B — Keyword-specific body-free routes (`noBody: true`). Routes with
 *               a fixed keyword suffix (e.g. `/plan`, `/archive`) are more specific
 *               than the Section C catch-alls and MUST precede them.
 *
 *   Section C — Catch-all body-free routes. These are placed last by
 *               {@link buildProjectRoutes} and are spread last.
 *
 * ⚠️  ORDERING CONSTRAINT (load-bearing, not cosmetic):
 *     Section B MUST precede Section C across all sub-builders. The dispatcher
 *     walks the table in declaration order and returns on the first match. A
 *     Section C catch-all such as `GET /api/projects/:repo/:slug` would silently
 *     shadow all deprecated Section B keyword routes (`/:slug/plan`,
 *     `/:slug/synthesis`, etc.) if they were declared before them, permanently
 *     breaking backward compatibility with pre-namespace clients.
 */
export function buildRoutes(
  ledgerRoot: string,
  configPath: string,
  orchestratorLogsDir: string,
  bootVersions: WorkspaceVersions | null
): Route[] {
  return [
    ...buildConfigRoutes(configPath, bootVersions),
    ...buildOrchestratorRoutes(ledgerRoot, orchestratorLogsDir),
    ...buildRepoRoutes(ledgerRoot),
    ...buildKnowledgeRoutes(ledgerRoot),
    ...buildModelRoutes(),
    ...buildStoreRoutes(ledgerRoot),
    ...buildProjectRoutes(ledgerRoot, orchestratorLogsDir),
  ];
}

/**
 * Returns the full route table using sentinel dummy arguments, without
 * requiring callers to supply real filesystem paths.
 *
 * Intended for structural tests (e.g. `route-table.test.ts`) that inspect the
 * route table shape — method validity, named-capture-group compliance,
 * duplicate detection — without executing any handlers.
 *
 * Uses `/dev/null` as a safe sentinel for all path arguments and `null` for
 * `bootVersions`. The handlers captured inside each route are closures over
 * these sentinels; as long as no handler is actually invoked the sentinels have
 * no observable effect.
 *
 * @returns The full `Route[]` table, identical in structure to what
 *   {@link handleRequest} uses at runtime.
 */
export function getRouteDescriptors(): Route[] {
  return buildRoutes('/dev/null', '/dev/null', '/dev/null', null);
}

/**
 * Iterates the route table, matches the request, conditionally parses the body,
 * invokes the handler, and writes the response.
 *
 * Parses query parameters from the full `url` (including query string) via
 * {@link parseQueryString} and passes the resulting `URLSearchParams` as the
 * third argument to the matched handler.
 *
 * Returns `true` if a route was matched (caller should return immediately),
 * or `false` if no route matched (caller should fall through).
 */
export async function dispatchRoute(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  url: string,
  port: number,
  routes: Route[]
): Promise<boolean> {
  const [path] = url.split('?') as [string];
  const query = parseQueryString(url);
  for (const route of routes) {
    if (route.method !== method) continue;
    let groups: Record<string, string> | undefined;
    if (typeof route.path === 'string') {
      if (route.path !== path) continue;
    } else {
      const m = route.path.exec(path);
      if (!m) continue;
      groups = (m.groups ?? {}) as Record<string, string>;
    }
    try {
      const body = route.noBody ? undefined : await readJsonBody(req);
      const result = await route.handler(body, groups, query);
      if (route.statusCode === 204) {
        res.writeHead(204, { ...corsHeaders(port), ...securityHeaders() });
        res.end();
      } else {
        sendJson(res, route.statusCode ?? 200, result, port);
      }
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(
          `[server] Unhandled error in ${method} ${path}: ${String(err)}\n`
        );
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main request handler
// ---------------------------------------------------------------------------

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ledgerRoot: string,
  configPath: string,
  port: number,
  orchestratorLogsDir: string,
  bootVersions: WorkspaceVersions | null = null
): Promise<void> {
  const method = req.method?.toUpperCase() ?? 'GET';
  const url = req.url ?? '/';
  const [path] = url.split('?') as [string];
  const segments = path.split('/').filter(Boolean);
  const isApiRequest = segments[0] === 'api';

  // OPTIONS preflight
  if (method === 'OPTIONS') {
    res.writeHead(200, { ...corsHeaders(port), ...securityHeaders() });
    res.end();
    return;
  }

  // Static files
  if (!isApiRequest) {
    await serveStatic(req, res, port);
    return;
  }

  // All API traffic is dispatched via the unified declarative route table.
  // dispatchRoute() handles both body-parsing and body-free (noBody: true) routes.
  // If no route matches, fall through to 404.
  if (await dispatchRoute(
    req, res, method, url, port,
    buildRoutes(ledgerRoot, configPath, orchestratorLogsDir, bootVersions)
  )) {
    return;
  }

  sendError(res, 404, 'NOT_FOUND', 'Route not found.', port);
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const port = getPort();
  const ledgerRoot = resolveLedgerRoot();

  // Load multi-store configuration (returns null in single-store / legacy mode).
  // Mirror the same initialization sequence as index.ts.
  const storeConfig = await loadStoresConfig();
  const storeRouter = new StoreRouter(storeConfig);
  const multiStoreManager = new MultiStoreManager(storeRouter);
  setStoreContext(storeRouter, multiStoreManager);

  if (storeConfig !== null) {
    process.stdout.write(
      `[gui-server] Multi-store mode: ${storeConfig.stores.length} store(s) configured.\n`
    );
  } else {
    process.stdout.write('[gui-server] Single-store mode (no stores.json found).\n');
  }

  // Resolve gui-config.json: ~/.ai-insights/gui-config.json in multi-store mode,
  // join(ledgerRoot, 'gui-config.json') in single-store mode.
  const configPath = resolveGuiConfigPath(storeConfig, ledgerRoot);

  // Populate config cache from disk (defaults used if file missing)
  await readConfigFromDisk(configPath);
  startConfigWatcher(configPath);

  const orchestratorLogsDir = ORCHESTRATOR_LOGS_DIR;

  // Capture component versions at server startup. Passed into handleRequest()
  // so that subsequent GET /api/server-info calls can detect stale instances.
  const bootVersions = captureWorkspaceVersions();

  // Start the auto-archive background service. Reads auto_archive_days from
  // config; no-op if the setting is 0.
  startAutoArchiveTimer(ledgerRoot);

  const server = createServer((req, res) => {
    handleRequest(req, res, ledgerRoot, configPath, port, orchestratorLogsDir, bootVersions).catch((err) => {
      process.stderr.write(`[server] Unhandled error: ${String(err)}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...securityHeaders() });
        res.end(
          JSON.stringify({
            error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
          })
        );
      }
    });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(
        `[server] Port ${port} is already in use. Choose a different port with --port <n>. Exiting.\n`
      );
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(`GUI dashboard running at http://localhost:${port}`);
  });
}

// Only run main() when this file is the entry point (e.g. `tsx gui/server.ts`),
// not when it is imported by test code (e.g. to access the exported handleRequest).
const isEntryPoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntryPoint) {
  main().catch((err) => {
    process.stderr.write(`[server] Fatal startup error: ${String(err)}\n`);
    process.exit(1);
  });
}
