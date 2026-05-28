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
  handleGetInsights,
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
  handleOrchestratorStart,
  handleGetOrchestratorQueue,
  handleOrchestratorKill,
  handleOrchestratorDismiss,
  handleGetRunStatus,
  ApiError,
} from './api.js';
import { renderChunksToMarkdown } from './chunk-renderer.js';

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
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
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

type RouteHandler = () => Promise<unknown>;

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
  const metaPath = join(ledgerRoot, repoUrlParam, slugUrlParam, '.meta.json');
  let raw: string;
  try {
    raw = await readFile(metaPath, 'utf-8');
  } catch {
    throw new ApiError('NOT_FOUND', `Project not found: ${slugUrlParam}`);
  }
  try {
    const meta = JSON.parse(raw) as { repository_name?: string | null };
    return meta.repository_name ?? repoUrlParam;
  } catch {
    // Malformed .meta.json — project directory exists, fall back to URL param.
    // Log to stderr so operators can detect corrupt meta files during troubleshooting.
    process.stderr.write(`[server] Warning: malformed .meta.json at ${metaPath} — falling back to URL param '${repoUrlParam}'\n`);
    return repoUrlParam;
  }
}

/**
 * Matches a method + URL path to an API handler.
 * Returns a handler thunk or null if no route matches.
 */
function matchRoute(
  method: string,
  url: string,
  ledgerRoot: string,
  orchestratorLogsDir: string
): RouteHandler | null {
  const [path] = url.split('?') as [string];
  const segments = path.split('/').filter(Boolean);

  // All API routes must start with 'api'
  if (segments[0] !== 'api') return null;

  const rest = segments.slice(1);

  // Route dispatch note:
  // Routes are matched by segment count (rest.length) first, then by segment values.
  // Because the dispatcher walks the if-else chain in declaration order, two routes
  // that share the same rest.length value are ordered by their position here — the
  // first matching branch wins and subsequent branches at the same length are shadowed.
  // When adding a new route with the same rest.length as an existing one (e.g. a future
  // /:slug/synthesis at length 3 alongside /:slug/plan), make sure the more-specific
  // pattern appears BEFORE the catch-all pattern at that length, or it will never match.

  // GET /api/insights
  if (method === 'GET' && rest.length === 1 && rest[0] === 'insights') {
    return () => handleGetInsights(ledgerRoot);
  }

  // GET /api/orchestrator/queue
  if (method === 'GET' && rest.length === 2 && rest[0] === 'orchestrator' && rest[1] === 'queue') {
    return () => handleGetOrchestratorQueue(orchestratorLogsDir, ledgerRoot);
  }

  // GET /api/orchestrator/run-status/:filename
  if (method === 'GET' && rest.length === 3 && rest[0] === 'orchestrator' && rest[1] === 'run-status') {
    const filename = decodeURIComponent(rest[2]!);
    return () => handleGetRunStatus(orchestratorLogsDir, filename);
  }

  // GET /api/projects
  if (method === 'GET' && rest.length === 1 && rest[0] === 'projects') {
    const qIdx = url.indexOf('?');
    const qStr = qIdx !== -1 ? url.slice(qIdx + 1) : '';
    const sp = new URLSearchParams(qStr);
    const params = {
      page: sp.get('page') ?? undefined,
      limit: sp.get('limit') ?? undefined,
      status: sp.get('status') ?? undefined,
      search: sp.get('search') ?? undefined,
      sort: sp.get('sort') ?? undefined,
      dir: sp.get('dir') ?? undefined,
      runner: sp.get('runner') ?? undefined,
    };
    return () => handleListProjects(ledgerRoot, params);
  }

  // GET /api/projects/:slug/plan
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'plan'
  ) {
    const slug = rest[1]!;
    return () => handleGetPlanDocument(ledgerRoot, slug);
  }

  // GET /api/projects/:slug/synthesis
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'synthesis'
  ) {
    const slug = rest[1]!;
    return () => handleGetSynthesisDocument(ledgerRoot, slug);
  }

  // GET /api/projects/:slug/health
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'health'
  ) {
    const slug = rest[1]!;
    return () => handleGetProjectHealth(ledgerRoot, slug);
  }

  // GET /api/projects/:slug
  if (method === 'GET' && rest.length === 2 && rest[0] === 'projects') {
    const slug = rest[1]!;
    return () => handleGetProject(ledgerRoot, slug);
  }

  // GET /api/projects/:slug/work-packages
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'work-packages'
  ) {
    const slug = rest[1]!;
    return () => handleListWorkPackages(ledgerRoot, slug);
  }

  // GET /api/projects/:slug/work-packages/overview
  // IMPORTANT: this route has rest.length === 4 and must appear BEFORE the
  // generic /:wpId handler at the same length, otherwise 'overview' would be
  // treated as a WP ID.
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[2] === 'work-packages' &&
    rest[3] === 'overview'
  ) {
    const slug = rest[1]!;
    return () => handleGetWorkPackageOverview(ledgerRoot, slug);
  }

  // GET /api/projects/:slug/dialogues/:filename
  // rest.length === 4, rest[2] === 'dialogues' — must appear before the generic
  // work-packages/:wpId handler at the same length.
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[2] === 'dialogues'
  ) {
    const slug = rest[1]!;
    const filename = decodeURIComponent(rest[3]!);
    return () => handleGetDialogueFile(ledgerRoot, slug, filename);
  }

  // GET /api/projects/:slug/work-packages/:wpId
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[2] === 'work-packages'
  ) {
    const slug = rest[1]!;
    const wpId = rest[3]!;
    return () => handleGetWorkPackage(ledgerRoot, slug, wpId);
  }

  // GET /api/projects/:slug/dialogues[?wp=WP-001]
  // rest.length === 3, rest[2] === 'dialogues' — does not shadow other rest[2] routes
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'dialogues'
  ) {
    const slug = rest[1]!;
    const qIdx = url.indexOf('?');
    const qStr = qIdx !== -1 ? url.slice(qIdx + 1) : '';
    const sp = new URLSearchParams(qStr);
    const wpId = sp.get('wp') ?? undefined;
    return () => handleListDialogues(ledgerRoot, slug, wpId);
  }

  // GET /api/projects/:slug/chunks
  // rest.length === 3, rest[2] === 'chunks' — analogous to the dialogues list route
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'chunks'
  ) {
    const slug = rest[1]!;
    const qIdx = url.indexOf('?');
    const qStr = qIdx !== -1 ? url.slice(qIdx + 1) : '';
    const sp = new URLSearchParams(qStr);
    const wpId = sp.get('wp') ?? undefined;
    return () => handleListChunks(ledgerRoot, slug, wpId);
  }

  // GET /api/projects/:slug/chunks/:filename/rendered
  // rest.length === 5, rest[2] === 'chunks', rest[4] === 'rendered'
  // Placement note: this route (rest.length === 5) and the raw-file route below
  // (rest.length === 4) have different segment counts, so there is no ordering
  // requirement between them — the dispatcher can never confuse the two.  This
  // block is placed here (before the length-4 route) solely to keep all three
  // chunk routes visually adjacent and in URL-specificity order.
  if (
    method === 'GET' &&
    rest.length === 5 &&
    rest[0] === 'projects' &&
    rest[2] === 'chunks' &&
    rest[4] === 'rendered'
  ) {
    const slug = rest[1]!;
    const filename = decodeURIComponent(rest[3]!);
    return () =>
      handleGetChunkFile(ledgerRoot, slug, filename).then(({ content }) => ({
        content: renderChunksToMarkdown(content),
      }));
  }

  // GET /api/projects/:slug/chunks/:filename
  // rest.length === 4, rest[2] === 'chunks' — analogous to dialogues/:filename
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[2] === 'chunks'
  ) {
    const slug = rest[1]!;
    const filename = decodeURIComponent(rest[3]!);
    return () => handleGetChunkFile(ledgerRoot, slug, filename);
  }

  // ---------------------------------------------------------------------------
  // Namespaced /:repo/:slug routes — added in WP-009.
  // Each route validates repo and slug separately via SAFE_SLUG_REGEX (same
  // enforcement as assertSafeSlug but applied before any handler call, giving
  // explicit path-traversal defence at the routing layer).
  // resolveRepoName() reads .meta.json to obtain the canonical repository_name
  // and also serves as the project-existence check (throws NOT_FOUND when the
  // meta file is absent).
  //
  // Ordering note: all keyword-specific /:slug/xxx routes at rest.length===3
  // appear ABOVE the /:repo/:slug catch-all at the same length. The catch-all
  // uses explicit keyword exclusion to prevent shadowing.
  // ---------------------------------------------------------------------------

  // GET /api/projects/:repo/:slug/plan
  // rest.length === 4, rest[3] === 'plan' — does not conflict with /:slug/keyword (length 3)
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'plan' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetPlanDocument(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/synthesis
  // rest.length === 4, rest[3] === 'synthesis'
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'synthesis' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetSynthesisDocument(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/health
  // rest.length === 4, rest[3] === 'health'
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'health' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetProjectHealth(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/work-packages
  // rest.length === 4, rest[3] === 'work-packages'
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'work-packages' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleListWorkPackages(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/dialogues[?wp=WP-001]
  // rest.length === 4, rest[3] === 'dialogues'
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'dialogues' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const qIdx = url.indexOf('?');
    const qStr = qIdx !== -1 ? url.slice(qIdx + 1) : '';
    const sp = new URLSearchParams(qStr);
    const wpId = sp.get('wp') ?? undefined;
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleListDialogues(ledgerRoot, slug, wpId, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/chunks[?wp=WP-001]
  // rest.length === 4, rest[3] === 'chunks'
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'chunks' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const qIdx = url.indexOf('?');
    const qStr = qIdx !== -1 ? url.slice(qIdx + 1) : '';
    const sp = new URLSearchParams(qStr);
    const wpId = sp.get('wp') ?? undefined;
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleListChunks(ledgerRoot, slug, wpId, repoName);
    };
  }

  // POST /api/projects/:repo/:slug/archive
  // rest.length === 4, rest[3] === 'archive'
  if (
    method === 'POST' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'archive' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleArchiveProject(ledgerRoot, slug, repoName);
    };
  }

  // POST /api/projects/:repo/:slug/unarchive
  // rest.length === 4, rest[3] === 'unarchive'
  if (
    method === 'POST' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'unarchive' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleUnarchiveProject(ledgerRoot, slug, repoName);
    };
  }

  // POST /api/projects/:repo/:slug/complete
  // rest.length === 4, rest[3] === 'complete'
  if (
    method === 'POST' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'complete' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleMarkProjectComplete(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/work-packages/overview
  // rest.length === 5, rest[3] === 'work-packages', rest[4] === 'overview'
  // Must appear BEFORE /:repo/:slug/work-packages/:wpId at the same rest.length.
  if (
    method === 'GET' &&
    rest.length === 5 &&
    rest[0] === 'projects' &&
    rest[3] === 'work-packages' &&
    rest[4] === 'overview' &&
    rest[2] !== 'work-packages'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetWorkPackageOverview(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/dialogues/:filename
  // rest.length === 5, rest[3] === 'dialogues'
  // Must appear BEFORE /:repo/:slug/work-packages/:wpId to keep ordering consistent.
  if (
    method === 'GET' &&
    rest.length === 5 &&
    rest[0] === 'projects' &&
    rest[3] === 'dialogues' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const filename = decodeURIComponent(rest[4]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetDialogueFile(ledgerRoot, slug, filename, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/work-packages/:wpId
  // rest.length === 5, rest[3] === 'work-packages'
  if (
    method === 'GET' &&
    rest.length === 5 &&
    rest[0] === 'projects' &&
    rest[3] === 'work-packages' &&
    rest[2] !== 'work-packages'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const wpId = rest[4]!;
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetWorkPackage(ledgerRoot, slug, wpId, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/chunks/:filename/rendered
  // rest.length === 6, rest[3] === 'chunks', rest[5] === 'rendered'
  if (
    method === 'GET' &&
    rest.length === 6 &&
    rest[0] === 'projects' &&
    rest[3] === 'chunks' &&
    rest[5] === 'rendered' &&
    rest[2] !== 'chunks'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const filename = decodeURIComponent(rest[4]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetChunkFile(ledgerRoot, slug, filename, repoName).then(({ content }) => ({
        content: renderChunksToMarkdown(content),
      }));
    };
  }

  // GET /api/projects/:repo/:slug/chunks/:filename
  // rest.length === 5, rest[3] === 'chunks'
  if (
    method === 'GET' &&
    rest.length === 5 &&
    rest[0] === 'projects' &&
    rest[3] === 'chunks' &&
    rest[2] !== 'chunks'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const filename = decodeURIComponent(rest[4]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetChunkFile(ledgerRoot, slug, filename, repoName);
    };
  }

  // DELETE /api/projects/:repo/:slug
  // rest.length === 3, method === 'DELETE' — no conflict with DELETE /:slug (rest.length === 2)
  if (
    method === 'DELETE' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleDeleteProject(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug
  // rest.length === 3 — catch-all; must appear AFTER all /:slug/keyword routes at
  // rest.length === 3 and uses explicit keyword exclusion to prevent shadowing them.
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetProject(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:slug/runs
  // rest.length === 3, rest[2] === 'runs' — does not shadow work-packages (different rest[2] value)
  // Resolves the canonical namespaced storage directory first to avoid creating
  // ghost directories under the legacy flat path when archiveCompletedLogs runs.
  // Falls back to the legacy flat path for truly pre-namespace projects.
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'runs'
  ) {
    const slug = decodeURIComponent(rest[1]!);
    return async () => {
      const flatProjectDir = join(ledgerRoot, slug);
      let projectStorageDir: string;
      try {
        projectStorageDir = await resolveProjectDir(slug, ledgerRoot);
      } catch {
        // NOT_FOUND or AMBIGUOUS — fall back to the legacy flat layout.
        projectStorageDir = flatProjectDir;
      }
      const logsDir = join(projectStorageDir, 'orchestrator', 'logs');
      // For namespaced projects, supply the old flat paths as legacy migration
      // sources so logs written under the pre-namespace layout are carried over.
      // For flat projects, preserve the original behaviour (migrate from the root).
      const isNamespaced = projectStorageDir !== flatProjectDir;
      const legacyLogsDir = isNamespaced ? join(flatProjectDir, 'orchestrator', 'logs') : flatProjectDir;
      const legacyLogsDir2 = isNamespaced ? flatProjectDir : undefined;
      return handleListRunLogs(slug, slug, logsDir, orchestratorLogsDir, legacyLogsDir, legacyLogsDir2);
    };
  }

  // GET /api/projects/:repo/:slug/runs
  // rest.length === 4, rest[3] === 'runs' — namespaced route; rest[2] !== 'runs' distinguishes from /:slug/runs/:filename
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'runs' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      // Explicit SAFE_SLUG_REGEX guard before any path construction — makes the
      // path-traversal defence direct rather than relying on the indirect
      // resolveRepoName NOT_FOUND guard (defence-in-depth per Security Auditor).
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', `Invalid repo or slug parameter.`);
      }
      // logsDir uses the URL segments (which locate the directory on disk); repoName
      // is resolved from .meta.json so it comes from the stored repository_name, not
      // a raw URL param (AC3). resolveRepoName also enforces 404 for unknown projects.
      const logsDir = join(ledgerRoot, repoUrlParam, slug, 'orchestrator', 'logs');
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleListRunLogs(slug, repoName, logsDir, orchestratorLogsDir);
    };
  }

  // GET /api/projects/:slug/runs/:filename
  // rest.length === 4, rest[2] === 'runs' — does not shadow work-packages/:wpId (different rest[2] value)
  // Resolves the canonical namespaced storage directory first (same as the list
  // route above) to avoid creating ghost directories under the legacy flat path.
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[2] === 'runs'
  ) {
    const slug = decodeURIComponent(rest[1]!);
    const filename = decodeURIComponent(rest[3]!);
    const qIdx = url.indexOf('?');
    const qStr = qIdx !== -1 ? url.slice(qIdx + 1) : '';
    const sp = new URLSearchParams(qStr);
    const afterParam = sp.get('after');
    const afterLine = afterParam !== null && !isNaN(parseInt(afterParam, 10)) ? parseInt(afterParam, 10) : undefined;
    return async () => {
      const flatProjectDir = join(ledgerRoot, slug);
      let projectStorageDir: string;
      try {
        projectStorageDir = await resolveProjectDir(slug, ledgerRoot);
      } catch {
        projectStorageDir = flatProjectDir;
      }
      const logsDir = join(projectStorageDir, 'orchestrator', 'logs');
      return handleGetRunLog(slug, slug, filename, logsDir, orchestratorLogsDir, afterLine);
    };
  }

  // GET /api/projects/:repo/:slug/runs/:filename
  // rest.length === 5, rest[3] === 'runs' — namespaced route
  if (
    method === 'GET' &&
    rest.length === 5 &&
    rest[0] === 'projects' &&
    rest[3] === 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const filename = decodeURIComponent(rest[4]!);
    const qIdx = url.indexOf('?');
    const qStr = qIdx !== -1 ? url.slice(qIdx + 1) : '';
    const sp = new URLSearchParams(qStr);
    const afterParam = sp.get('after');
    const afterLine = afterParam !== null && !isNaN(parseInt(afterParam, 10)) ? parseInt(afterParam, 10) : undefined;
    return async () => {
      // Explicit SAFE_SLUG_REGEX guard before any path construction — makes the
      // path-traversal defence direct rather than relying on the indirect
      // resolveRepoName NOT_FOUND guard (defence-in-depth per Security Auditor).
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', `Invalid repo or slug parameter.`);
      }
      // logsDir uses the URL segments (which locate the directory on disk); repoName
      // is resolved from .meta.json so it comes from the stored repository_name, not
      // a raw URL param (AC3). resolveRepoName also enforces 404 for unknown projects.
      const logsDir = join(ledgerRoot, repoUrlParam, slug, 'orchestrator', 'logs');
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetRunLog(slug, repoName, filename, logsDir, orchestratorLogsDir, afterLine);
    };
  }

  // DELETE /api/projects/:slug
  if (method === 'DELETE' && rest.length === 2 && rest[0] === 'projects') {
    const slug = rest[1]!;
    return () => handleDeleteProject(ledgerRoot, slug);
  }

  // POST /api/projects/:slug/archive
  if (
    method === 'POST' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'archive'
  ) {
    const slug = rest[1]!;
    return () => handleArchiveProject(ledgerRoot, slug);
  }

  // POST /api/projects/:slug/unarchive
  if (
    method === 'POST' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'unarchive'
  ) {
    const slug = rest[1]!;
    return () => handleUnarchiveProject(ledgerRoot, slug);
  }

  // POST /api/projects/:slug/complete
  if (
    method === 'POST' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'complete'
  ) {
    const slug = rest[1]!;
    return () => handleMarkProjectComplete(ledgerRoot, slug);
  }

  // GET /api/config and PUT /api/config are handled before matchRoute() is called
  // (they require configPath which is not passed to this function)

  // POST /api/projects/:slug/reset — handled separately in handleRequest()
  // because it requires body parsing (like PUT /api/config).

  // POST /api/orchestrator/start — handled separately in handleRequest()
  // because it requires body parsing.
  // POST /api/orchestrator/kill/:id and POST /api/orchestrator/dismiss/:id —
  // handled separately in handleRequest() (path-parameter extraction via path.slice).

  // This comment block serves as a route-map reference for maintainability.

  return null;
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

  // Handle OPTIONS preflight
  if (method === 'OPTIONS') {
    res.writeHead(200, { ...corsHeaders(port), ...securityHeaders() });
    res.end();
    return;
  }

  // Static file serving
  if (!isApiRequest) {
    await serveStatic(req, res, port);
    return;
  }

  // PUT /api/config — special case: requires body parsing
  if (method === 'PUT' && path === '/api/config') {
    try {
      const body = await readJsonBody(req);
      const result = await handleUpdateConfig(configPath, body);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in PUT /api/config: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // GET /api/server-info — special case: needs bootVersions closure from main()
  if (method === 'GET' && path === '/api/server-info') {
    try {
      const boot = bootVersions ?? captureWorkspaceVersions();
      const disk = captureWorkspaceVersions();
      const stale =
        boot.mcpServer !== disk.mcpServer ||
        boot.personas !== disk.personas ||
        boot.orchestrator !== disk.orchestrator;
      sendJson(res, 200, { stale, bootVersions: boot, diskVersions: disk }, port);
    } catch (err) {
      process.stderr.write(`[server] Unhandled error in GET /api/server-info: ${String(err)}\n`);
      sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
    }
    return;
  }

  // GET /api/config — special case: needs configPath
  if (method === 'GET' && path === '/api/config') {
    try {
      const result = await handleGetConfig(configPath);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in GET /api/config: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // PATCH /api/projects/:slug — special case: requires body parsing
  if (method === 'PATCH' && path.startsWith('/api/projects/')) {
    const rawPath = path.slice('/api/projects/'.length);
    const patchSegs = rawPath.split('/').filter(Boolean);
    try {
      const body = await readJsonBody(req);
      let result: unknown;
      if (patchSegs.length === 2) {
        // Namespaced: PATCH /api/projects/:repo/:slug
        const repoUrlParam = decodeURIComponent(patchSegs[0]!);
        const slug = decodeURIComponent(patchSegs[1]!);
        if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
          sendError(res, 404, 'NOT_FOUND', 'Invalid repo or slug parameter.', port);
          return;
        }
        const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
        result = await handleRenameProject(ledgerRoot, slug, body, repoName);
      } else {
        // Flat: PATCH /api/projects/:slug
        const slug = decodeURIComponent(rawPath);
        result = await handleRenameProject(ledgerRoot, slug, body);
      }
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in PATCH /api/projects/...: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/projects/:slug/reset — special case: requires body parsing
  if (method === 'POST') {
    const postSegments = path.split('/').filter(Boolean);
    // Flat: POST /api/projects/:slug/reset — postSegments.length === 4
    if (
      postSegments.length === 4 &&
      postSegments[0] === 'api' &&
      postSegments[1] === 'projects' &&
      postSegments[3] === 'reset'
    ) {
      const slug = decodeURIComponent(postSegments[2]!);
      try {
        const body = await readJsonBody(req);
        const result = await handleResetProject(ledgerRoot, slug, body);
        sendJson(res, 200, result, port);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
        } else if (err instanceof ApiError) {
          sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
        } else {
          process.stderr.write(`[server] Unhandled error in POST /api/projects/:slug/reset: ${String(err)}\n`);
          sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
        }
      }
      return;
    }
    // Namespaced: POST /api/projects/:repo/:slug/reset — postSegments.length === 5
    if (
      postSegments.length === 5 &&
      postSegments[0] === 'api' &&
      postSegments[1] === 'projects' &&
      postSegments[4] === 'reset'
    ) {
      const repoUrlParam = decodeURIComponent(postSegments[2]!);
      const slug = decodeURIComponent(postSegments[3]!);
      try {
        if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
          sendError(res, 404, 'NOT_FOUND', 'Invalid repo or slug parameter.', port);
          return;
        }
        const body = await readJsonBody(req);
        const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
        const result = await handleResetProject(ledgerRoot, slug, body, repoName);
        sendJson(res, 200, result, port);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
        } else if (err instanceof ApiError) {
          sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
        } else {
          process.stderr.write(`[server] Unhandled error in POST /api/projects/:repo/:slug/reset: ${String(err)}\n`);
          sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
        }
      }
      return;
    }
  }

  // POST /api/orchestrator/start — body parsing required
  if (method === 'POST' && path === '/api/orchestrator/start') {
    try {
      const body = await readJsonBody(req);
      const result = await handleOrchestratorStart(WORKSPACE_ROOT, body);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in POST /api/orchestrator/start: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/orchestrator/kill/:id
  if (method === 'POST' && path.startsWith('/api/orchestrator/kill/')) {
    const id = decodeURIComponent(path.slice('/api/orchestrator/kill/'.length));
    try {
      const result = await handleOrchestratorKill(id, orchestratorLogsDir, ledgerRoot);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in POST /api/orchestrator/kill/:id: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/orchestrator/dismiss/:id — responds with 204 No Content
  if (method === 'POST' && path.startsWith('/api/orchestrator/dismiss/')) {
    const id = decodeURIComponent(path.slice('/api/orchestrator/dismiss/'.length));
    try {
      await handleOrchestratorDismiss(id, orchestratorLogsDir, ledgerRoot);
      res.writeHead(204, { ...corsHeaders(port), ...securityHeaders() });
      res.end();
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in POST /api/orchestrator/dismiss/:id: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // General API route matching
  const handler = matchRoute(method, url, ledgerRoot, orchestratorLogsDir);
  if (!handler) {
    sendError(res, 404, 'NOT_FOUND', 'Route not found.', port);
    return;
  }

  try {
    const result = await handler();
    sendJson(res, 200, result, port);
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
    } else {
      process.stderr.write(`[server] Unhandled error: ${String(err)}\n`);
      sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
    }
  }
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const port = getPort();
  const ledgerRoot = resolveLedgerRoot();
  const configPath = join(ledgerRoot, 'gui-config.json');

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
