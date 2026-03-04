# Plan

## Summary

Extend the GUI dashboard to surface the archived synthesis document when it exists. When a project's `synthesis_generated` flag is `true` — meaning `ledger_complete_synthesis` was called and `synthesis.md` was archived into the ledger storage directory — the project detail page displays a **"View synthesis →" link**. Following that link navigates to a new `#/projects/:slug/synthesis` subpage that renders the archived `synthesis.md` as HTML using the already-vendored `marked` library. The change mirrors the existing plan document view exactly, deliberately reusing all established patterns.

## Architectural Context

### What is already in place

The parent plan (`2026-02-28-ledger-document-archiving`) introduced full archival support and the plan document view. As of that implementation, the following are already live:

| Component | Location | Notes |
|-----------|----------|-------|
| `PLAN_ARCHIVE_FILENAME = 'plan.md'` | [mcp-server/src/utils/constants.ts](mcp-server/src/utils/constants.ts#L27) | Constant used by the plan document endpoint |
| `SYNTHESIS_ARCHIVE_FILENAME = 'synthesis.md'` | [mcp-server/src/utils/constants.ts](mcp-server/src/utils/constants.ts#L28) | Already defined — no new constant needed |
| `LedgerStore.archiveDocuments()` | [mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts) | Archives named files from plan folder to ledger dir |
| `completeSynthesis()` archives `synthesis.md` | [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) | Sets `synthesis_generated = true` and copies the file |
| `rootIndex.synthesis_generated` | [mcp-server/src/schema/root-index.ts](mcp-server/src/schema/root-index.ts#L43) | Optional boolean, `true` only after synthesis completion |
| `handleGetProject()` returns `{ ...rootIndex, meta }` | [mcp-server/gui/api.ts](mcp-server/gui/api.ts#L293) | Spreads the root index — `synthesis_generated` is already in the response |
| `handleGetPlanDocument()` | [mcp-server/gui/api.ts](mcp-server/gui/api.ts#L411) | Reads `plan.md` from ledger dir — model for synthesis handler |
| `GET /api/projects/:slug/plan` | [mcp-server/gui/server.ts](mcp-server/gui/server.ts#L180) | Route at rest-array length 3 |
| `API.getPlanDocument(slug)` | [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js#L40) | API client method |
| `renderPlan(app, slug)` + `#/projects/:slug/plan` route | [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js#L84) | Full Markdown view with breadcrumb |
| `marked.min.js` vendored | [mcp-server/gui/public/libs/marked.min.js](mcp-server/gui/public/libs/marked.min.js) | Client-side Markdown renderer, already loaded |
| Plan synopsis card on project detail | [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js#L421) | Fetches plan, extracts `## Summary`, renders card |
| `.plan-content`, `.plan-synopsis` styles | [mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css#L653) | Plan rendering CSS |

### Server-side routing note

`server.ts` matches routes by `rest.length` first. Both `/:slug/plan` and the new `/:slug/synthesis` are length-3 segments. The code already has a comment flagging this:

> *"a future `/:slug/synthesis` at length 3 alongside `/:slug/plan`), make sure the more-specific pattern appears BEFORE the catch-all pattern at that length"*

The new synthesis route must be inserted **before** the `/:slug/work-packages` branch (also length 3) in the if-else chain.

### Key availability signal: `synthesis_generated`

The `handleGetProject()` response already contains `synthesis_generated` (spread from `rootIndex`). The project detail page can use this flag directly — **no additional HTTP call is needed** to decide whether to show the synthesis link. This is the primary difference from the plan synopsis, which requires fetching the document to extract the `## Summary` text. For the synthesis link, the flag alone is sufficient.

## Approach / Architecture

The implementation is strictly additive and mirrors the plan document pattern:

1. **Add `handleGetSynthesisDocument()`** to `gui/api.ts` — identical in structure to `handleGetPlanDocument()`, reading `SYNTHESIS_ARCHIVE_FILENAME` instead of `PLAN_ARCHIVE_FILENAME`.

2. **Add `GET /api/projects/:slug/synthesis`** route to `server.ts` — inserted immediately after the `/plan` route (same length-3 group, before work-packages).

3. **Add `API.getSynthesisDocument(slug)`** to the `API` client object in `app.js`.

4. **Add `#/projects/:slug/synthesis`** router entry — matched before `#/projects/:slug` (already the case by declaration order since the more-specific pattern is checked first).

5. **Add `renderSynthesis(app, slug)`** view function — identical to `renderPlan()` with breadcrumb label "Synthesis" and class `synthesis-content`.

6. **On the project detail page**, add a conditional synthesis link using `project.synthesis_generated`. No extra API call: if the flag is true, render a `"View synthesis →"` link styled via a new `.synthesis-link` style, positioned below the plan synopsis card. If `synthesis_generated` is falsy or absent, nothing is rendered.

7. **Add CSS** for `.synthesis-content` (rendered synthesis HTML) and `.synthesis-link` (the project detail link).

8. **Add tests** for the new API handler and GUI route.

9. **Update manifest documents**.

### Synthesis link vs. synopsis card

The plan view shows a full synopsis card (extracting `## Summary` from the plan Markdown) because the summary provides immediate value — it tells engineers what the project is about without clicking through. The synthesis document is a final project report written at completion. Showing a link is sufficient: users who want to read the synthesis can navigate to the dedicated view. Fetching the synthesis just to extract a snippet on the project detail page would add an unnecessary HTTP round-trip to every project detail load, even for `IN_PROGRESS` projects where the synthesis never exists.

## Rationale

- **Mirror the plan document pattern** (vs. inventing a new pattern): Zero new architectural decisions. Every engineer already knows how the plan view works; synthesis follows the same path.
- **Use `synthesis_generated` flag** (vs. speculative GET): The flag is already in the `GET /api/projects/:slug` response. No extra request, no race condition, no ambiguity.
- **Simple link on project detail** (vs. synopsis card): The synthesis document is a terminal artifact. A link is actionable and low-cost. A synopsis card would require an extra fetch on every project detail load, even for projects that have no synthesis.
- **`synthesis-content` CSS class** (vs. reusing `plan-content`): Separate class allows independent styling in the future without touching plan styles.

## Detailed Steps

### Step 1: Add `handleGetSynthesisDocument()` to `gui/api.ts`

Directly after the `handleGetPlanDocument()` function, add:

```typescript
// ---------------------------------------------------------------------------
// GET /api/projects/:slug/synthesis
// ---------------------------------------------------------------------------

/**
 * Returns the content of the archived synthesis.md for a project.
 * Throws NOT_FOUND if the project does not exist or has no archived synthesis.
 */
export async function handleGetSynthesisDocument(
  ledgerRoot: string,
  slug: string
): Promise<{ content: string }> {
  assertSafeSlug(slug);
  const store = new LedgerStore(slug, ledgerRoot);
  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  try {
    const synthesisContent = await readFile(
      join(ledgerRoot, slug, SYNTHESIS_ARCHIVE_FILENAME),
      'utf-8'
    );
    return { content: synthesisContent };
  } catch {
    notFound(`Synthesis document not found for project '${slug}'.`);
  }
}
```

Add `SYNTHESIS_ARCHIVE_FILENAME` to the existing import from `../src/utils/constants.js`.

### Step 2: Add the synthesis route to `gui/server.ts`

Import `handleGetSynthesisDocument` alongside the existing named imports. Then, immediately after the `GET /api/projects/:slug/plan` block, insert:

```typescript
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
```

This placement keeps the synthesis route in the same length-3 group as the plan route, before `work-packages`.

### Step 3: Add `API.getSynthesisDocument()` to `app.js`

In the `API` object, add alongside `getPlanDocument`:

```javascript
getSynthesisDocument: function (slug) { return request('GET', '/projects/' + encodeURIComponent(slug) + '/synthesis'); },
```

### Step 4: Add synthesis route to the Router in `app.js`

In the `dispatch()` function, immediately after the `planMatch` block:

```javascript
var synthesisMatch = path.match(/^\/projects\/([^/]+)\/synthesis$/);
if (synthesisMatch) {
  renderSynthesis(app, decodeURIComponent(synthesisMatch[1]));
  return;
}
```

### Step 5: Add `renderSynthesis()` view to `app.js`

Directly after the `renderPlan()` function, add:

```javascript
/* ----------------------------------------------------------
   4b-ii. View: Synthesis Document
   ---------------------------------------------------------- */
async function renderSynthesis(app, slug) {
  app.innerHTML = '<p class="loading">Loading synthesis\u2026</p>';
  try {
    var result = await API.getSynthesisDocument(slug);
    var html = marked.parse(result.content);
    app.innerHTML =
      '<div class="breadcrumb"><a href="#/projects">Projects</a> / ' +
      '<a href="#/projects/' + encodeURIComponent(slug) + '">' + escapeHtml(slug) + '</a> / Synthesis</div>' +
      '<div class="synthesis-content">' + html + '</div>';
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') {
      app.innerHTML =
        '<div class="breadcrumb"><a href="#/projects">Projects</a> / ' +
        '<a href="#/projects/' + encodeURIComponent(slug) + '">' + escapeHtml(slug) + '</a> / Synthesis</div>' +
        '<p class="empty-state">Synthesis document not available for this project.</p>';
    } else {
      app.innerHTML = '<p class="error-banner">Failed to load synthesis document.</p>';
    }
  }
}
```

### Step 6: Add synthesis link to the project detail page in `app.js`

In `renderProjectDetail()`, the `Promise.all` currently fetches `[API.getProject(slug), API.getPlanDocument(slug).catch(...)]`. No change is needed there — the synthesis link is driven by `project.synthesis_generated`, which is already in the project response.

In the `renderProjectDetail()` HTML assembly, after the plan synopsis block (the `(function() { ... synopsisHtml ... })()` IIFE), add another IIFE:

```javascript
(function () {
  if (!project.synthesis_generated) return '';
  return '<div class="synthesis-link-row">' +
    '<a href="#/projects/' + encodeURIComponent(slug) + '/synthesis" class="synthesis-link">View synthesis \u2192</a>' +
    '</div>';
})() +
```

### Step 7: Add CSS for synthesis view and link

In [mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css), after the plan-related styles, add:

```css
/* ──────────────────────────────────────────────────────────────
   Synthesis document view
   ────────────────────────────────────────────────────────────── */
.synthesis-content {
  /* Reuse plan-content typographic rules */
}

/* Inherits all typography rules from .plan-content */
.synthesis-content h1, .synthesis-content h2, .synthesis-content h3,
.synthesis-content h4, .synthesis-content h5, .synthesis-content h6,
.synthesis-content p, .synthesis-content ul, .synthesis-content ol,
.synthesis-content table, .synthesis-content pre, .synthesis-content code,
.synthesis-content blockquote, .synthesis-content hr {
  /* Delegate to plan-content selectors — both use identical rules */
}

/* ──────────────────────────────────────────────────────────────
   Synthesis link row (project detail page)
   ────────────────────────────────────────────────────────────── */
.synthesis-link-row {
  margin-bottom: 16px;
}

.synthesis-link {
  display: inline-block;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-primary);
  text-decoration: none;
  padding: 4px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-bg-card);
  transition: background 0.15s;
}

.synthesis-link:hover {
  background: var(--color-bg);
  text-decoration: none;
}
```

> **Implementation note on `.synthesis-content` typography:** Rather than duplicating the full set of `.plan-content` CSS rules, the simplest approach is to add `.synthesis-content` as a second selector to every existing `.plan-content` rule (multi-selector syntax). This keeps styles DRY. The exact implementation detail is left to the engineer.

### Step 8: Write tests for `handleGetSynthesisDocument()`

In [mcp-server/tests/gui/api.test.ts](mcp-server/tests/gui/api.test.ts), add tests parallel to the existing plan document tests:

1. **Happy path**: Write `synthesis.md` to a temp ledger dir, call `handleGetSynthesisDocument()`, verify `{ content: '<markdown>' }` is returned.
2. **Synthesis not found**: Call with a slug whose ledger dir exists but has no `synthesis.md` — verify `NOT_FOUND` is thrown.
3. **Project not found**: Call with a non-existent slug — verify `NOT_FOUND` is thrown.

### Step 9: Update manifest documents

| Document | Update |
|----------|--------|
| [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) | Add `handleGetSynthesisDocument()` signature and `GET /api/projects/:slug/synthesis` route; add `API.getSynthesisDocument()` client method |
| [mcp-server/docs/agents/project-manifest/data-flows.md](mcp-server/docs/agents/project-manifest/data-flows.md) | Add synthesis document view flow (parallel to the plan document flow) |
| [mcp-server/docs/agents/project-manifest/file-tree.md](mcp-server/docs/agents/project-manifest/file-tree.md) | No change needed — `synthesis.md` in the ledger dir is already documented by the parent plan |

## Dependencies

- No new npm dependencies.
- No new vendored files — `marked.min.js` is already present.
- Depends on the synthesis archival work from `2026-02-28-ledger-document-archiving` being complete (specifically: `completeSynthesis()` must archive `synthesis.md` and `SYNTHESIS_ARCHIVE_FILENAME` must be exported from `constants.ts`). Both are confirmed in-place.

## Required Components

| Component | Status | Location |
|-----------|--------|----------|
| `handleGetSynthesisDocument()` | **New** | [mcp-server/gui/api.ts](mcp-server/gui/api.ts) |
| `SYNTHESIS_ARCHIVE_FILENAME` import | **Modified** | [mcp-server/gui/api.ts](mcp-server/gui/api.ts) |
| Synthesis route (`GET /api/projects/:slug/synthesis`) | **New** | [mcp-server/gui/server.ts](mcp-server/gui/server.ts) |
| `handleGetSynthesisDocument` import | **Modified** | [mcp-server/gui/server.ts](mcp-server/gui/server.ts) |
| `API.getSynthesisDocument()` | **New** | [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) |
| `#/projects/:slug/synthesis` router entry | **New** | [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) |
| `renderSynthesis()` view | **New** | [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) |
| Synthesis link in `renderProjectDetail()` | **Modified** | [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) |
| `.synthesis-content`, `.synthesis-link`, `.synthesis-link-row` | **New** | [mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css) |
| GUI API tests for synthesis endpoint | **New** | [mcp-server/tests/gui/api.test.ts](mcp-server/tests/gui/api.test.ts) |
| `api-surface.md` | **Modified** | [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) |
| `data-flows.md` | **Modified** | [mcp-server/docs/agents/project-manifest/data-flows.md](mcp-server/docs/agents/project-manifest/data-flows.md) |

## Assumptions

- The synthesis archival work from `2026-02-28-ledger-document-archiving` is complete and `synthesis.md` is written to `storage/ledger/{slug}/` when `ledger_complete_synthesis` is called.
- `SYNTHESIS_ARCHIVE_FILENAME = 'synthesis.md'` is already exported from `mcp-server/src/utils/constants.ts` (confirmed).
- `synthesis_generated` is spread into the `GET /api/projects/:slug` response (confirmed via `handleGetProject` returning `{ ...rootIndex, meta }`).
- `marked.min.js` is already vendored and loaded in `index.html` (confirmed).

## Constraints

- **Route ordering** (Constraint — `server.ts` dispatch): The synthesis route must appear before the work-packages route in the if-else chain (both are length-3 `rest` arrays). It should sit immediately after the plan route.
- **STDIO discipline**: Not applicable here — no new server-side logging introduced.
- **No extra HTTP call on project detail**: The synthesis availability is signalled by `synthesis_generated`, not by probing the filesystem. The project detail page must not fire a speculative `getSynthesisDocument()` request just to check existence.
- **CSS DRY principle**: `.synthesis-content` typography rules must not be copy-pasted from `.plan-content`. Use multi-selector or extend the existing selectors.

## Out of Scope

- **Synthesis synopsis card** (extracting `## Summary` from `synthesis.md` for display on the project detail page): Not requested. A link is sufficient. Adding a synopsis card would require an extra HTTP call on every project detail load and is better deferred to a separate plan.
- **Retroactive links for projects completed before archival was introduced**: Projects initialized before the `archiveDocuments()` feature will have no `synthesis.md` in their ledger dir. The `NOT_FOUND` response is handled gracefully by showing the "Synthesis document not available" empty state.
- **Synthesis search or filtering across projects**: Out of scope.

## Acceptance Criteria

1. `GET /api/projects/:slug/synthesis` returns `{ "content": "<markdown>" }` for a project with an archived `synthesis.md`.
2. `GET /api/projects/:slug/synthesis` returns 404 for a project with no archived `synthesis.md`.
3. `GET /api/projects/:slug/synthesis` returns 404 for a non-existent project slug.
4. Navigating to `#/projects/:slug/synthesis` renders the synthesis document as formatted HTML with correct breadcrumb (`Projects / {slug} / Synthesis`).
5. Navigating to `#/projects/:slug/synthesis` for a project without an archived synthesis shows the "not available" empty state (no error banner).
6. The project detail page (`#/projects/:slug`) displays a "View synthesis →" link when `project.synthesis_generated === true`.
7. The project detail page renders normally (no synthesis link) when `synthesis_generated` is `false` or absent.
8. All existing tests continue to pass.
9. New tests cover the three cases for `handleGetSynthesisDocument()`.
10. Manifest documents are updated.

## Testing Strategy

- **API unit tests** for `handleGetSynthesisDocument()`: happy path, synthesis file missing, project missing — all in [mcp-server/tests/gui/api.test.ts](mcp-server/tests/gui/api.test.ts), mirroring the existing plan document test structure.
- **Regression**: Run the full Vitest suite after each file change; no existing test should fail since this is strictly additive.
- **Manual smoke test**: Start the GUI (`npm run gui`), navigate to a COMPLETE project that has an archived `synthesis.md`, verify:
  - The "View synthesis →" link appears on the project detail page.
  - The link navigates to `#/projects/{slug}/synthesis`.
  - The synthesis renders correctly as formatted HTML.
  - An `IN_PROGRESS` project shows no synthesis link.
  - A COMPLETE project without an archived synthesis (old project) shows no synthesis link.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`synthesis_generated` is `true` but `synthesis.md` was not archived** (e.g. the Synthesis agent called `ledger_complete_synthesis` before writing the file) | `handleGetSynthesisDocument()` returns 404; `renderSynthesis()` shows the "not available" empty state gracefully. No crash. |
| **Route shadowed by work-packages** (both length 3) | Mitigated by explicit placement in Step 2: synthesis route is declared before work-packages. The existing `server.ts` comment already flags this risk. |
| **Old projects lack `synthesis_generated` field** | `synthesis_generated` is `z.boolean().optional()` — falsy check handles both `false` and `undefined`. No synthesis link is shown for old projects. |
| **CSS duplication** | Addressed by multi-selector approach rather than copy-paste. |
