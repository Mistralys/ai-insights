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
 * `details` is server-side only — it exists for tests and logs, and
 * `gui/server.ts`'s `sendError()` never serializes it onto the wire (the
 * response body is always `{ error: { code, message } }`). A `details`
 * payload built from raw Zod issues can carry a request's received value,
 * which may be a secret, so it must never reach the client. Use
 * `describeZodIssues()` to put a readable, value-free summary into
 * `message` instead.
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import type { ZodIssue } from 'zod';

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

// ---------------------------------------------------------------------------
// describeZodIssues
// ---------------------------------------------------------------------------

/** Issue codes whose default Zod message quotes the received value verbatim. */
const VALUE_ECHOING_ISSUE_CODES: ReadonlySet<string> = new Set([
  'invalid_enum_value',
  'invalid_literal',
  'invalid_union_discriminator',
]);

/** Fixed, value-free replacement for a value-echoing issue's default message. */
const VALUE_ECHOING_FALLBACK_MESSAGE = 'received value does not match the allowed values.';

export interface DescribeZodIssuesOptions {
  /** Label used for an issue whose `path` is empty (the request body itself). Defaults to `'body'`. */
  rootLabel?: string;
}

function formatIssuePath(issue: ZodIssue, rootLabel: string): string {
  return issue.path.length > 0 ? issue.path.join('.') : rootLabel;
}

/** Renders a single Zod issue as `"<path>: <message>"`, never echoing the received value. */
function describeIssue(issue: ZodIssue, rootLabel: string): string {
  const path = formatIssuePath(issue, rootLabel);
  const message = VALUE_ECHOING_ISSUE_CODES.has(issue.code)
    ? VALUE_ECHOING_FALLBACK_MESSAGE
    : issue.message;
  return `${path}: ${message}`;
}

/**
 * Summarizes a Zod `safeParse` failure's `issues` array into a single,
 * human-readable string suitable for an `ApiError`'s `message` — never
 * `details`, which is server-side only (see this file's header).
 *
 * Only the first issue is described in full; when more issues are present,
 * an `"(and N more)"` suffix is appended so the caller knows there is more
 * to fix without the message growing unbounded. `invalid_enum_value`,
 * `invalid_literal`, and `invalid_union_discriminator` get a fixed,
 * value-free message instead of Zod's default, since Zod quotes the
 * received value for those codes — and a rejected field may hold a secret.
 *
 * Returns `'Invalid request.'` when `issues` is empty (should not occur for
 * a genuine `safeParse` failure, but kept as a safe fallback).
 */
export function describeZodIssues(
  issues: readonly ZodIssue[],
  options?: DescribeZodIssuesOptions
): string {
  if (issues.length === 0) {
    return 'Invalid request.';
  }

  const rootLabel = options?.rootLabel ?? 'body';
  const first = issues[0] as ZodIssue;
  const extraCount = issues.length - 1;
  const description = describeIssue(first, rootLabel);

  return extraCount > 0 ? `${description} (and ${extraCount} more)` : description;
}
