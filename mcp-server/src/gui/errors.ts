/**
 * Shared GUI error types.
 *
 * This module is the single source of truth for `ApiError`. Both `gui/api.ts`
 * and `src/gui/log-resolver.ts` import from here so that `instanceof ApiError`
 * checks in `gui/server.ts` work correctly across all route handlers.
 *
 * Error shape:  { code: string, message: string, details?: unknown }
 *   NOT_FOUND        → 404
 *   FORBIDDEN        → 403
 *   VALIDATION_ERROR → 400
 *   CONFLICT         → 409
 *   (unhandled)      → 500
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

/** Structured error thrown by all GUI API handlers and resolvers. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
