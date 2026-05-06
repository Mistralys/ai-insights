# Plan

## Summary

Follow-up hardening and documentation pass on the GUI HTTP layer, addressing all actionable
items from the `2026-05-05-gui-orchestrator-integration-rework-1` synthesis report. The scope
covers one medium-severity security fix (backslash guard on `assertSafeSlug()`), a broader
allowlist-regex refactor of all three path-guard functions, a defensive `req.resume()` fix
for the Content-Length pre-check path, and four documentation debt items.

## Architectural Context

The GUI HTTP server (`mcp-server/gui/server.ts`) is a standalone Node.js HTTP server that
routes requests to API handlers in `mcp-server/gui/api.ts`. Key modules:

- **`gui/api.ts`** — Route handlers + three path-guard functions (`assertSafeSlug`,
  `assertSafeWpId`, `assertSafeQueueId`) used across 16+ call sites.
- **`gui/server.ts`** — HTTP listener, body-size cap (`readBody()`), error-to-status mapping
  (`apiErrorToStatus()`), route dispatch.
- **`gui/orchestrator-manager.ts`** — Orchestrator queue reader/launcher with the extracted
  `computeEffectiveStatus()` helper.
- **`mcp-server/docs/agents/project-manifest/api-surface.md`** — Public API manifest.

All guard functions currently use an additive **blocklist** approach (check for `/`, `..`,
and optionally `\`). Two of the three guards were patched in the prior session; one
(`assertSafeSlug`) was missed.

**Existing allowlist constant:** `mcp-server/src/utils/constants.ts` already exports
`SAFE_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/` — a strict slug format validator that is
inherently traversal-safe (no dots, slashes, or backslashes can pass). It is already
imported by `gui/api.ts` (line 25) and used for slug format validation on rename (line 1030).
This constant should be reused for `assertSafeSlug()` rather than defining a new pattern.

## Approach / Architecture

1. **Immediate fix:** Add `slug.includes('\\')` to `assertSafeSlug()` to close the
   Windows path-traversal gap.
2. **Allowlist hardening:** Replace the blocklist logic in all three guard functions with
   strict allowlist regexes. Reuse the existing `SAFE_SLUG_REGEX` (`/^[a-z0-9][a-z0-9-]*$/`)
   for `assertSafeSlug()` and define a new `SAFE_ID_PATTERN` (`/^[A-Za-z0-9][\w-]*$/`) for
   `assertSafeWpId()` and `assertSafeQueueId()`. This eliminates the entire class of
   "missed a blocklist entry" bugs while reusing existing validated constants.
3. **`req.resume()` symmetry:** Add `req.resume()` to the Content-Length pre-check rejection
   path in `readBody()` to match the streaming path's drain behaviour.
4. **Documentation debt:** Address all four items listed in the synthesis.

**Two-layer validation model:**
- **Security layer (this plan):** The guard functions reject any input that could cause path
  traversal. They are the trust boundary.
- **Format layer (existing):** `SAFE_SLUG_REGEX` also enforces naming conventions
  (lowercase kebab-case). For slugs, both layers are satisfied by one regex. For WP/queue
  IDs (which use uppercase like `WP-001`), a separate security-only pattern is needed.

## Rationale

- **Allowlist > blocklist:** The `assertSafeSlug` gap is a textbook failure mode of
  blocklist-based validation. An allowlist regex is simpler to audit and eliminates future
  gaps.
- **Reuse existing constant:** `SAFE_SLUG_REGEX` is already defined, tested, and used
  elsewhere in the codebase. Reusing it for slug guards avoids defining redundant patterns
  and ensures consistency with the slug naming convention enforced on creation/rename.
- **Separate patterns for IDs:** WP IDs use uppercase (`WP-001`) and queue IDs may differ
  from slug format. A dedicated `SAFE_ID_PATTERN` (`/^[A-Za-z0-9][\w-]*$/`) handles these
  while still requiring an alphanumeric start (blocking `..`, `.`, and all traversal).
- **`req.resume()` drain:** While benign on a local dev server, the asymmetry is a latent
  footgun if the server ever gains keep-alive semantics. Fixing it now is trivial and makes
  the two rejection paths symmetric.
- **Documentation:** The prior session's work left manifest entries incomplete. Fixing them
  now keeps the project manifests authoritative.

## Detailed Steps

### Step 1: Add backslash guard to `assertSafeSlug()` (immediate fix)

File: `mcp-server/gui/api.ts` (line 97)

Add `slug.includes('\\')` to the existing condition:

```typescript
function assertSafeSlug(slug: string): void {
  if (!slug || slug.includes('/') || slug.includes('\\') || slug.includes('..')) {
    notFound(`Invalid project slug: '${slug}'.`);
  }
}
```

### Step 2: Replace blocklist with allowlist regexes in all three guards

Reuse the existing `SAFE_SLUG_REGEX` for slug validation and define a new `SAFE_ID_PATTERN`
for WP/queue IDs. The slug regex (`/^[a-z0-9][a-z0-9-]*$/`) is inherently traversal-safe:
it requires a leading alphanumeric and only permits lowercase letters, digits, and hyphens.
The ID regex (`/^[A-Za-z0-9][\w-]*$/`) requires a leading alphanumeric, blocking `..`, `.`,
and all path separators by design.

**Why not a single pattern for all three?** A naive unified regex like `/^[\w.-]+$/` would
match `..` (two dots are valid members of `[.-]`), reintroducing path traversal. Requiring
an alphanumeric start eliminates this class of bugs.

```typescript
// SAFE_SLUG_REGEX is already imported from '../src/utils/constants.js' (line 25)
// It covers: /^[a-z0-9][a-z0-9-]*$/

/** Allowlist for WP IDs and queue entry IDs: must start with alnum, then word chars or hyphens. */
const SAFE_ID_PATTERN = /^[A-Za-z0-9][\w-]*$/;

function assertSafeSlug(slug: string): void {
  if (!slug || !SAFE_SLUG_REGEX.test(slug)) {
    notFound(`Invalid project slug: '${slug}'.`);
  }
}

function assertSafeWpId(wpId: string): void {
  if (!wpId || !SAFE_ID_PATTERN.test(wpId)) {
    notFound(`Invalid work-package ID: '${wpId}'.`);
  }
}

function assertSafeQueueId(id: string): void {
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    notFound(`Invalid queue entry ID: '${id}'.`);
  }
}
```

Update all three JSDoc blocks to document the allowlist strategy and reference the
respective regex constant.

### Step 3: Update existing tests for allowlist semantics

Files:
- `mcp-server/tests/gui/api-orchestrator.test.ts`
- `mcp-server/tests/gui/api.test.ts`

Verify existing path-traversal tests still pass. All existing vectors (`/`, `..`, `\`) are
still rejected:
- `SAFE_SLUG_REGEX` rejects them because they contain non-`[a-z0-9-]` characters.
- `SAFE_ID_PATTERN` rejects `..` and `.` because they don't start with `[A-Za-z0-9]`;
  rejects `/` and `\` because they aren't in `[\w-]`.

Add tests that verify:
- A slug containing a space, `@`, or uppercase letter is rejected by `assertSafeSlug()`.
- A WP ID containing `/`, `\`, `..`, space, or `@` is rejected by `assertSafeWpId()`.
- A bare `.` or `..` is rejected by all three guards.

### Step 4: Add `req.resume()` to Content-Length pre-check path

File: `mcp-server/gui/server.ts` (line ~184)

```typescript
if (declaredLength !== undefined) {
  const n = parseInt(declaredLength, 10);
  if (!isNaN(n) && n > MAX_BODY_BYTES) {
    req.resume();  // ← drain body data from socket buffer
    reject(new PayloadTooLargeError());
    return;
  }
}
```

Add a targeted test verifying the pre-check path drains the socket (or at minimum that the
response is sent cleanly without hanging).

### Step 5: Add `readBody()` JSDoc contract

File: `mcp-server/gui/server.ts` (above `function readBody(...)`)

```typescript
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
```

### Step 6: Add `apiErrorToStatus()` entry to `api-surface.md`

File: `mcp-server/docs/agents/project-manifest/api-surface.md`

Under the `gui/server.ts` section, add:

```markdown
#### `apiErrorToStatus(code: string): number`

Maps an `ApiError` error code to its HTTP status code. Exported for unit testing.

| Error Code | HTTP Status |
|------------|-------------|
| `NOT_FOUND` | 404 |
| `FORBIDDEN` | 403 |
| `VALIDATION_ERROR` | 400 |
| `CONFLICT` | 409 |
| *(default)* | 500 |
```

### Step 7: Add `computeEffectiveStatus()` cross-reference to module header

File: `mcp-server/gui/orchestrator-manager.ts` (module header comment)

Add a `@see` reference pointing to `computeEffectiveStatus()` at the end of the lifecycle
state transitions table, making the canonical implementation easy to find from the doc.

### Step 8: Update `assertSafeSlug()` JSDoc (post-allowlist)

File: `mcp-server/gui/api.ts`

Update the JSDoc to describe the allowlist approach and reference the existing constant:

```typescript
/**
 * Guards against path-traversal attacks on the project slug URL parameter.
 *
 * Rejects any slug that does not match {@link SAFE_SLUG_REGEX}
 * (`/^[a-z0-9][a-z0-9-]*$/`). This reuses the same slug format enforced on
 * project creation and rename, ensuring only lowercase alphanumeric characters
 * and hyphens are accepted — eliminating path separators and traversal
 * sequences by design.
 *
 * @param slug - The raw slug string extracted from the request URL.
 */
```

Apply equivalent updates to `assertSafeWpId()` and `assertSafeQueueId()` JSDoc blocks,
referencing `SAFE_ID_PATTERN` instead.

## Dependencies

- Step 2 supersedes Step 1 (but Step 1 is listed as the immediate fix if the allowlist
  refactor is deferred).
- Steps 3 and 8 depend on Step 2 being complete.
- Steps 4–7 are independent of Steps 1–3 and can be parallelised.

## Required Components

- `mcp-server/gui/api.ts` — Guard function refactor + JSDoc updates
- `mcp-server/gui/server.ts` — `req.resume()` fix + `readBody()` JSDoc
- `mcp-server/gui/orchestrator-manager.ts` — Module header cross-reference
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Manifest update
- `mcp-server/tests/gui/api-orchestrator.test.ts` — Additional allowlist test
- `mcp-server/tests/gui/api.test.ts` — Additional allowlist test
- `mcp-server/tests/gui/server-body-limit.test.ts` — `req.resume()` path test

## Assumptions

- The slug format in production uses only `[a-z0-9-]` characters (lowercase kebab-case).
  This is enforced by `SAFE_SLUG_REGEX` on creation and rename, so existing slugs are
  guaranteed to match.
- WP IDs follow the `WP-NNN` pattern (uppercase + digits + hyphens) which matches
  `SAFE_ID_PATTERN`. Queue entry IDs are also alphanumeric-start strings.
- The existing test suite covers the `/`, `..`, and `\` vectors; only the allowlist's
  additional rejection surface requires new test cases.
- `req.resume()` before `reject()` is safe in the Node.js `IncomingMessage` lifecycle (it
  is — the stream will emit remaining data events which are discarded since no `data`
  listener is yet attached at the pre-check stage).

## Constraints

- Zero new production dependencies.
- All changes are within the `gui/` layer (no MCP server core changes).
- `SAFE_SLUG_REGEX` is already used for slug validation on rename — so all existing slugs
  already satisfy it. No regression possible for slug guards.
- `SAFE_ID_PATTERN` must not reject existing valid WP/queue IDs — verify against stored
  ledger directory names if available.
- Tests must pass on all platforms (no `\\` literal in test assertions that would break on
  Unix).

## Out of Scope

- The `readBody()` caller unification (Strategic Recommendation 2) — deferred until route
  count exceeds five.
- The locking-parity gap resolution (already documented in WP-007 JSDoc).
- Broader HTTP security headers (CORS, CSP, etc.) — separate concern.

## Acceptance Criteria

- `assertSafeSlug()` uses the existing `SAFE_SLUG_REGEX` constant for validation.
- `assertSafeWpId()` and `assertSafeQueueId()` use the new `SAFE_ID_PATTERN` constant.
- A slug containing `\`, `/`, `..`, `.`, space, `@`, or uppercase is rejected by
  `assertSafeSlug()`.
- A WP/queue ID that is bare `..`, bare `.`, or contains `/` or `\` is rejected.
- The Content-Length pre-check path in `readBody()` calls `req.resume()` before rejecting.
- `readBody()` has a JSDoc block documenting the `PayloadTooLargeError` caller contract.
- `apiErrorToStatus()` has a named entry in `api-surface.md` (including FORBIDDEN → 403).
- `orchestrator-manager.ts` module header references `computeEffectiveStatus()`.
- All three guard function JSDoc blocks describe the allowlist pattern.
- All existing tests continue to pass; new tests cover allowlist edge cases.
- `npm test` in `mcp-server/` passes with 0 failures.

## Testing Strategy

| Area | Approach |
|------|----------|
| Allowlist guards | Unit tests: valid IDs pass, invalid characters (space, `@`, `\`, `/`, `..`, empty) are rejected |
| `req.resume()` path | Integration test: send a request with Content-Length > 1 MiB, verify 413 returned cleanly |
| Regression | Full `npm test` run — existing 2,108+ tests must remain green |
| Cross-platform | Ensure test strings work on both Unix and Windows (no OS-specific path assumptions) |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Allowlist rejects a valid existing slug** | `SAFE_SLUG_REGEX` is already used on create/rename — all existing slugs already pass it. Zero regression risk for slugs. |
| **`SAFE_ID_PATTERN` rejects a valid existing WP/queue ID** | WP IDs use `WP-NNN` format (alphanumeric start + word chars + hyphens). Queue IDs are similarly constrained. Verify against stored data before merging. |
| **`req.resume()` causes unexpected behaviour at pre-check stage** | The `data` event handler is not yet attached at that point — `resume()` simply puts the stream into flowing mode so data is discarded. This is documented Node.js behaviour. |
| **Tests assume blocklist semantics** | Review all existing guard tests to ensure they test rejection (which still works under allowlist) rather than acceptance of specific blocked chars. |
| **Regex allows traversal sequences made of permitted characters** | Both regexes require an alphanumeric first character, which blocks `..` and `.` by design. Verified: `/^[a-z0-9][a-z0-9-]*$/.test('..')` → `false`; `/^[A-Za-z0-9][\w-]*$/.test('..')` → `false`. |
