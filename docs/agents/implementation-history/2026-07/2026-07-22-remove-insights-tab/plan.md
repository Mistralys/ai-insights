# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Summary

Remove the "Insights" global nav tab and all of its supporting code from the GUI. The tab aggregates `project_comments` from all projects into a cross-project view, but this data is already accessible per-project under "Project Comments" on each project's detail page. The Knowledge tab (`/knowledge`) serves as the forward-looking replacement for cross-cutting insight discovery. No data is lost, no MCP tools change, and no orchestrator or personas code is affected. The change is entirely contained within the GUI frontend, its backend handler, and the associated tests and manifest documentation.

## Architectural Context

The GUI is a vanilla-JS SPA served by `mcp-server/gui/server.ts`. Routes are hash-based (`#/path`) and dispatched by `mcp-server/gui/public/router.js`. Each top-level view is a standalone JS file in `public/views/` loaded via a `<script>` tag in `index.html`. The backend is a single-file HTTP handler (`gui/api.ts`) exporting typed async functions; `server.ts` imports them and maps URL patterns to handler calls.

The "Insights" tab (`/insights` → `renderInsights`) calls `GET /api/insights`, which is implemented by `handleGetInsights()` in `gui/api.ts`. That handler reads all projects in parallel, flattens their `project_comments` arrays into a single `InsightEntry[]`, and returns it sorted by timestamp descending.

The "Project Comments" section on the project detail page (`views/project-detail.js` L617–644) renders the same `project.project_comments` data inline — so every comment already appears in the project-scoped view without the global tab.

## Approach / Architecture

Delete the view file and remove all references to it across the frontend. Remove the backend handler, its type, and its route. Remove the corresponding tests and manifest documentation entries. Regenerate the auto-generated `.context/` snapshot to eliminate stale references.

No new code is introduced. Every step is a deletion or a targeted removal from an existing file.

## Rationale

The Insights tab is a convenience aggregate view. Because the same data is available scoped to each project, the tab provides diminishing value and creates redundant navigation — especially now that the Knowledge tab offers a richer, curated cross-cutting view. Removing it simplifies the nav, eliminates dead backend code, and reduces test surface area.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Keep Insights view as a hidden route | Remove entirely | Keep `views/insights.js` but remove nav link only | Leaving the handler and view in place preserves dead code and test overhead with no benefit; clean deletion is lower maintenance |
| Redirect `/insights` to `/knowledge` | No redirect | Add a router redirect from `/insights` → `/knowledge` | No external links or bookmarks depend on this route (SPA hash URL, internal only); a redirect adds code for zero practical value |

## Pattern Alignment

- Follows the existing pattern for view removal: delete the `views/foo.js` file, remove its `<script>` tag from `index.html`, remove the nav link, and remove the router branch. This is the inverse of how views were originally added.
- Backend handler removal follows the established pattern: remove the named export from `api.ts`, remove it from the import list in `server.ts`, and remove the `if` block in `matchRoute()`.

## Detailed Steps

1. **`mcp-server/gui/public/index.html`** — Remove the `<a href="#/insights">Insights</a>` nav anchor. Remove the `<script src="/views/insights.js?v=2"></script>` script tag.

2. **`mcp-server/gui/public/router.js`** — Remove the `if (path === '/insights') { renderInsights(app); return; }` branch (3 lines).

3. **`mcp-server/gui/public/api-client.js`** — Remove the `getInsights` entry (the `getInsights: function () { return request('GET', '/insights'); }` line plus its JSDoc comment block above it).

4. **`mcp-server/gui/public/views/insights.js`** — Delete the file entirely.

5. **`mcp-server/gui/api.ts`** — Remove the `InsightEntry` interface (L222–235) and the `handleGetInsights` function (L237–289), including the JSDoc block above the function. Also remove `IncidentContext` from the named import at L37 — it is only referenced within `InsightEntry` and will become an unused import (causing a compile error with `noUnusedLocals: true`). The remaining import should be `import type { WorkPackageDetail } from '../src/schema/work-package.js';`.

6. **`mcp-server/gui/server.ts`** — Remove `handleGetInsights` from the named import at the top of the file. Remove the `// GET /api/insights` comment and the three-line `if` block (L373–376). Remove the `//   GET    /api/insights` entry from the route inventory comment block (L1329).

7. **`mcp-server/tests/gui/api.test.ts`** — Remove `handleGetInsights` from the named import (L24). Remove the `describe('handleGetInsights', …)` block (L469–589). Remove the `describe('handleGetInsights — repository_name', …)` block (L593–632).

8. **`mcp-server/docs/agents/project-manifest/api-surface.md`** — Remove the `InsightEntry` interface block and its preceding comment (L3735–3751, ~17 lines). Remove the `handleGetInsights` declaration line and its preceding description comment (~5 lines). Also remove the `| GET | \`/api/insights\` | \`handleGetInsights\` | |` row from the HTTP route inventory table (L4466) — required by AC-07.

9. **`mcp-server/gui/docs/agents/project-manifest/api-surface.md`** — Remove the `| \`getInsights\` | … |` table row from the API client method table (L206). Also remove the `| renderInsights | insights.js | #/insights |` row from the View Functions table (L302).

10. **`mcp-server/gui/docs/agents/project-manifest/data-flows.md`** — Remove the `│   ├── /insights → renderInsights(app)` line from the router dispatch diagram (L128).

11. **`mcp-server/gui/docs/agents/project-manifest/file-tree.md`** — Remove the `insights.js` file entry (L40).

12. **`mcp-server/docs/agents/project-manifest/file-tree.md`** — Remove the `insights.js` file entry (L65). Trim `Insights (#/insights)` from the `index.html` annotation (L48). Remove `/insights → renderInsights` from the `router.js` annotation (L53).

13. **Regenerate `.context/`** — Run `node scripts/cli.js ctx-generate` to rebuild the auto-generated snapshot files, eliminating stale `handleGetInsights` and `InsightEntry` references from `.context/mcp-server/manifest-api-surface.md` and `.context/mcp-server/source-gui-api-handlers.md`. This step requires `ctx` to be on PATH.

## Dependencies

- Steps 1–12 are independent and can be executed in any order.
- Step 13 (CTX regeneration) must follow all other steps so the snapshot reflects the final state.

## Required Components

- `mcp-server/gui/public/index.html` — modify
- `mcp-server/gui/public/router.js` — modify
- `mcp-server/gui/public/api-client.js` — modify
- `mcp-server/gui/public/views/insights.js` — **delete**
- `mcp-server/gui/api.ts` — modify
- `mcp-server/gui/server.ts` — modify
- `mcp-server/tests/gui/api.test.ts` — modify
- `mcp-server/docs/agents/project-manifest/api-surface.md` — modify
- `mcp-server/docs/agents/project-manifest/file-tree.md` — modify
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — modify
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — modify
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — modify
- `.context/` (auto-generated) — regenerate

## Assumptions

- No external consumers call `GET /api/insights` directly. The endpoint is internal to the SPA.
- No deep-linked bookmarks to `#/insights` exist that users depend on.
- `project_comments` data is not being removed — it remains stored in each project's `project-ledger.json` and is fully accessible via the project detail page.

## Constraints

- The `.context/` files must not be hand-edited; they are owned by the CTX generator.

## Out of Scope

- Modifying the project detail page's "Project Comments" section (it remains unchanged — this is the data's primary access point going forward).
- Any changes to the MCP tools (`ledger_add_project_comment`, etc.), the orchestrator, or persona files — none of these reference the GUI Insights tab.
- Adding a redirect from `#/insights` to `#/knowledge`.

## Acceptance Criteria

- AC-01: The "Insights" link no longer appears in the GUI navigation bar.
- AC-02: Navigating to `#/insights` produces a "Page not found" error (or any non-Insights rendering), confirming the route is dead.
- AC-03: `GET /api/insights` returns a 404 response.
- AC-04: `views/insights.js` no longer exists in the repository.
- AC-05: The test suite passes with no failures after removing the `handleGetInsights` describe blocks.
- AC-06: Project comments remain visible on individual project detail pages under "Project Comments".
- AC-07: `mcp-server/docs/agents/project-manifest/api-surface.md` contains no references to `InsightEntry` or `handleGetInsights`.

## Testing Strategy

Run the existing Vitest suite after all edits to confirm no regressions. The test file itself will be trimmed of the two `describe` blocks that tested the deleted handler. No new tests are needed — this is a pure deletion.

## Test Plan

- `mcp-server/tests/gui/api.test.ts` — After removing the two `handleGetInsights` describe blocks and the import, run `npm test` from `mcp-server/` to confirm all remaining tests pass — covers AC-05.
- Manual browser verification: navigate to `http://localhost:3420/#/insights` and confirm the nav link is absent and the route renders a not-found message — covers AC-01 and AC-02.
- `curl http://localhost:3420/api/insights` — confirm 404 response — covers AC-03.

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Remove `InsightEntry` interface, `handleGetInsights` entries, and route inventory table row (Step 8) — covers AC-07.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Remove `insights.js` entry and trim `index.html`/`router.js` annotations (Step 12).
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — Remove `getInsights` table row and `renderInsights` view functions row (Step 9).
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — Remove router dispatch entry for `/insights` (Step 10).
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — Remove `insights.js` file entry (Step 11).
- `.context/` — Regenerate via `node scripts/cli.js ctx-generate` (Step 13); no manual edits.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`ctx-generate` is unavailable** (requires `ctx` on PATH) | The `.context/` files are not required for the GUI or tests to work; stale references there are cosmetic only. Skip Step 10 and note it as deferred if `ctx` is not installed. |
| **Missed reference to `InsightEntry`** | TypeScript will surface any remaining usages as compile errors after `gui/api.ts` is modified. Run `npm run build` from `mcp-server/` to confirm clean compilation. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** All changes are confined to a single module (GUI), follow well-understood deletion patterns, and require no cross-project coordination or formal pipeline stages.
