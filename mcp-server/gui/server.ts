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
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveLedgerRoot } from '../src/utils/ledger-root.js';
import { readConfigFromDisk, startConfigWatcher } from '../src/gui/config.js';
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
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
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
  ledgerRoot: string
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
    return () => handleListProjects(ledgerRoot);
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

  // DELETE /api/projects/:slug
  if (method === 'DELETE' && rest.length === 2 && rest[0] === 'projects') {
    const slug = rest[1]!;
    return () => handleDeleteProject(ledgerRoot, slug);
  }

  // GET /api/config and PUT /api/config are handled before matchRoute() is called
  // (they require configPath which is not passed to this function)

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
  const resolved = filePath;
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

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ledgerRoot: string,
  configPath: string,
  port: number
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

  // General API route matching
  const handler = matchRoute(method, url, ledgerRoot);
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

  const server = createServer((req, res) => {
    handleRequest(req, res, ledgerRoot, configPath, port).catch((err) => {
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

main().catch((err) => {
  process.stderr.write(`[server] Fatal startup error: ${String(err)}\n`);
  process.exit(1);
});
