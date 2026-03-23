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

import { resolveLedgerRoot } from '../src/utils/ledger-root.js';
import { readConfigFromDisk, startConfigWatcher, getConfig } from '../src/gui/config.js';
import { startAutoArchiveTimer } from '../src/gui/auto-archive.js';
import { resolveOrchestratorLogsDir } from '../src/gui/log-resolver.js';
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
  ApiError,
} from './api.js';

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

function apiErrorToStatus(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN':
      return 403;
    case 'VALIDATION_ERROR':
      return 400;
    default:
      return 500;
  }
}

// ---------------------------------------------------------------------------
// Body reading
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

type RouteHandler = () => Promise<unknown>;

/**
 * Matches a method + URL path to an API handler.
 * Returns a handler thunk or null if no route matches.
 */
function matchRoute(
  method: string,
  url: string,
  ledgerRoot: string,
  logsDir: string
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

  // GET /api/projects/:slug/runs
  // rest.length === 3, rest[2] === 'runs' — does not shadow work-packages (different rest[2] value)
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'runs'
  ) {
    const slug = decodeURIComponent(rest[1]!);
    return () => handleListRunLogs(slug, logsDir);
  }

  // GET /api/projects/:slug/runs/:filename
  // rest.length === 4, rest[2] === 'runs' — does not shadow work-packages/:wpId (different rest[2] value)
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
    const afterLine = afterParam !== null ? parseInt(afterParam, 10) : undefined;
    return () => handleGetRunLog(slug, filename, logsDir, afterLine);
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
  // This comment serves as a route-map reference for maintainability.

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
      ...corsHeaders(port),
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
  logsDir: string
): Promise<void> {
  const method = req.method?.toUpperCase() ?? 'GET';
  const url = req.url ?? '/';
  const [path] = url.split('?') as [string];
  const segments = path.split('/').filter(Boolean);
  const isApiRequest = segments[0] === 'api';

  // Handle OPTIONS preflight
  if (method === 'OPTIONS') {
    res.writeHead(200, corsHeaders(port));
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
      const rawBody = await readBody(req);
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        sendError(res, 400, 'VALIDATION_ERROR', 'Invalid JSON body.', port);
        return;
      }
      const result = await handleUpdateConfig(configPath, body);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in PUT /api/config: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
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
    const slug = decodeURIComponent(path.slice('/api/projects/'.length));
    try {
      const rawBody = await readBody(req);
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        sendError(res, 400, 'VALIDATION_ERROR', 'Invalid JSON body.', port);
        return;
      }
      const result = await handleRenameProject(ledgerRoot, slug, body);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in PATCH /api/projects/:slug: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/projects/:slug/reset — special case: requires body parsing
  if (method === 'POST') {
    const postSegments = path.split('/').filter(Boolean);
    if (
      postSegments.length === 4 &&
      postSegments[0] === 'api' &&
      postSegments[1] === 'projects' &&
      postSegments[3] === 'reset'
    ) {
      const slug = decodeURIComponent(postSegments[2]!);
      try {
        const rawBody = await readBody(req);
        let body: unknown;
        try {
          body = JSON.parse(rawBody);
        } catch {
          sendError(res, 400, 'VALIDATION_ERROR', 'Invalid JSON body.', port);
          return;
        }
        const result = await handleResetProject(ledgerRoot, slug, body);
        sendJson(res, 200, result, port);
      } catch (err) {
        if (err instanceof ApiError) {
          sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
        } else {
          process.stderr.write(`[server] Unhandled error in POST /api/projects/:slug/reset: ${String(err)}\n`);
          sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
        }
      }
      return;
    }
  }

  // General API route matching
  const handler = matchRoute(method, url, ledgerRoot, logsDir);
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

  // Resolve the orchestrator logs directory once at startup and close over it.
  // When orchestrator_logs_dir is absent from config, resolveOrchestratorLogsDir
  // returns the default path (~/.ai-insights/orchestrator-logs) silently.
  const logsDir = resolveOrchestratorLogsDir(getConfig().orchestrator_logs_dir);

  // Start the auto-archive background service. Reads auto_archive_days from
  // config; no-op if the setting is 0.
  startAutoArchiveTimer(ledgerRoot);

  const server = createServer((req, res) => {
    handleRequest(req, res, ledgerRoot, configPath, port, logsDir).catch((err) => {
      process.stderr.write(`[server] Unhandled error: ${String(err)}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
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
