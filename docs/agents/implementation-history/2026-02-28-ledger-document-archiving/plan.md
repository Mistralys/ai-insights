# Plan

## Summary

Give the project ledger a secondary archiving role by automatically copying the plan and synthesis Markdown documents from the plan folder into the ledger's centralized storage directory (`mcp-server/storage/ledger/{slug}/`). The **plan document is archived at initialization** (when `ledger_initialize_project` is called), safeguarding it from the very start of the project. The **synthesis document is archived at synthesis completion** (when `ledger_complete_synthesis` is called), since it doesn't exist until that point. This preserves project context alongside the structured JSON data, ensuring the documents remain accessible even after the plan folder is cleaned up or the branch is deleted.

Additionally, the GUI dashboard is extended to surface archived plan documents:
- A **new "Plan" subpage** per project renders the archived `plan.md` as HTML using a client-side Markdown library.
- The project detail page displays a **plan synopsis** (extracted from the plan's `## Summary` section) in the work packages overview, giving immediate context about what the project is about.

## Architectural Context

### Current state

- **Plan folder** (`{project-root}/docs/agents/plans/{slug}/`): Contains human-authored Markdown — `plan.md`, `synthesis.md`, `work.md`, etc. These folders are transient; they are cleaned up after a project completes and are not always committed to the repository.
- **Ledger storage** (`mcp-server/storage/ledger/{slug}/`): Contains machine-generated JSON — `.meta.json`, `project-ledger.json`, and `WP-###.json` files. This directory is gitignored but persists locally across projects.
- **`ledger_initialize_project`** ([mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts#L243)): Creates a new project ledger with root index. Called by the PM agent right after planning. The plan document exists at this point and should be archived immediately.
- **`ledger_complete_synthesis`** ([mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts#L373)): Sets `synthesis_generated = true` on the root index and transitions the project to `COMPLETE`. Called by the Synthesis agent *after* writing the synthesis document to the plan folder.
- **Root index schema** ([mcp-server/src/schema/root-index.ts](mcp-server/src/schema/root-index.ts)): Contains `plan_file` (relative filename, e.g. `"plan.md"`), which tells us the plan document name.
- **LedgerStore** ([mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts)): Central storage abstraction — `store.planPath` is the absolute plan folder path; `store.storageDir` is the absolute ledger storage path.
- **Constraint 4**: "No machine-generated files may be written inside plan folders." This change goes the *other direction* (human-authored Markdown → ledger storage), so constraint 4 is not violated.
- **GUI dashboard** ([mcp-server/gui/](mcp-server/gui/)): Vanilla JS SPA (`app.js`, `styles.css`, `index.html`) served by a standalone Node.js HTTP server (`server.ts`). Routes are hash-based (`#/projects/:slug`, `#/projects/:slug/wp/:wpId`, etc.). API handlers live in `api.ts`. The dashboard currently has no Markdown rendering capability and no subpage for viewing plan content.
- **Project detail view** ([mcp-server/gui/public/app.js](mcp-server/gui/public/app.js#L336) — `renderProjectDetail()`): Shows project metadata, a work packages table, and project comments. Does not currently display plan content.

### Key files involved

| File | Role |
|------|------|
| [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) | Contains `initializeProject()` and `completeSynthesis()` — both functions to modify |
| [mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts) | `LedgerStore` class — add archive copy method here |
| [mcp-server/src/schema/root-index.ts](mcp-server/src/schema/root-index.ts) | Root index schema — already has `plan_file` field |
| [mcp-server/tests/tools/project-lifecycle.test.ts](mcp-server/tests/tools/project-lifecycle.test.ts) | Existing tests for both tools to extend |
| [mcp-server/gui/api.ts](mcp-server/gui/api.ts) | API handlers — add `handleGetPlanDocument()` here |
| [mcp-server/gui/server.ts](mcp-server/gui/server.ts) | HTTP server — add route for plan document endpoint |
| [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) | SPA frontend — add plan view and synopsis in project detail |
| [mcp-server/gui/public/index.html](mcp-server/gui/public/index.html) | HTML shell — add `<script>` tag for Markdown library |
| [mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css) | Styles — add plan rendering styles |
| [mcp-server/docs/agents/project-manifest/](mcp-server/docs/agents/project-manifest/) | Manifest documents to update |

## Approach / Architecture

Extend **two existing tools** rather than creating new ones, archiving each document at its natural lifecycle moment:

- **Plan document → archived at `ledger_initialize_project`** — the plan exists before the PM initializes the ledger, so it can be safeguarded from the very start.
- **Synthesis document → archived at `ledger_complete_synthesis`** — the synthesis is written by the Synthesis agent immediately before calling this tool.

### Design

1. **Add an `archiveDocuments()` method to `LedgerStore`** that copies specified Markdown files from the plan folder to the ledger storage directory. This keeps file I/O logic in the storage layer where it belongs.

2. **Extend `initializeProject()`** to call `archiveDocuments([args.plan_file])` after writing the root index and `.meta.json`. This copies the plan document into the ledger storage at project creation time, before any work packages are created.

3. **Extend `completeSynthesis()`** to call `archiveDocuments([args.synthesis_file])` after updating the root index. This copies the synthesis document at project completion time.

4. **Add an optional `synthesis_file` parameter** to `ledger_complete_synthesis` (defaults to `"synthesis.md"`) so the Synthesis agent can specify a non-standard synthesis filename if needed. No new parameter is needed for `ledger_initialize_project` because the plan filename is already provided as the required `plan_file` argument.

5. **Graceful degradation**: If a source file doesn't exist, log a warning to stderr and continue — the archival is best-effort, not a hard requirement for initialization or synthesis completion.

6. **Report archived files** in both tools' response payloads so the calling agent has visibility into what was preserved.

### File naming in the ledger

Archived Markdown files keep their original names (e.g. `plan.md`, `synthesis.md`). Since the ledger folder currently contains only `.json` files, the `.md` extension provides natural disambiguation with zero risk of naming collisions.

## Rationale

- **Archive plan at initialization** (vs. at synthesis): The plan folder could be cleaned up or the branch deleted at any point during the project lifecycle. Archiving at initialization safeguards the plan from the very start, eliminating the risk of loss during long-running projects.
- **Archive synthesis at completion** (vs. at initialization): The synthesis document does not exist when the project is initialized — it is written by the Synthesis agent at the end of the workflow. `ledger_complete_synthesis` is the natural and only correct trigger point.
- **Extending existing tools** (vs. a new tool): Archiving is semantically tied to the specific lifecycle moments. A separate tool would require persona changes and add fragile API surface area. Backward compatibility is preserved because the new parameter is optional and the archival is best-effort.
- **Storing in the ledger folder** (vs. a separate archive directory): The ledger folder already represents the project's persistent record. Adding the source documents alongside the JSON data creates a self-contained project archive without new directory conventions.
- **`fs.copyFile`** (vs. read + write): More efficient for potentially large Markdown files, and preserves the source file in place for any post-synthesis workflow that still needs it.
- **Best-effort archival** (vs. mandatory): The primary purpose of each tool is its core function (initialization / synthesis completion). Archival failure (e.g. file already deleted) should not prevent either from succeeding.

## Detailed Steps

### Step 1: Add `archiveDocuments()` to LedgerStore

In [mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts), add a new public method:

```typescript
async archiveDocuments(filenames: string[]): Promise<{ archived: string[]; skipped: string[] }> {
  const archived: string[] = [];
  const skipped: string[] = [];

  for (const filename of filenames) {
    const src = join(this.planPath, filename);
    const dest = join(this.storageDir, filename);
    try {
      await copyFile(src, dest);
      archived.push(filename);
    } catch {
      console.error(`[project-ledger-mcp] Archive skipped (source not found): ${src}`);
      skipped.push(filename);
    }
  }

  return { archived, skipped };
}
```

- Import `copyFile` from `fs/promises` (add to existing import).
- The method takes an array of filenames (relative to the plan folder).
- Returns a report of what was archived and what was skipped.

### Step 2: Extend `initializeProject()` to archive the plan document

In [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts#L243), after writing the root index and `.meta.json` (steps 4 and 5 in the existing code), add the archive call:

```typescript
// 6. Archive the plan document into the ledger storage directory
const archiveResult = await store.archiveDocuments([args.plan_file]);
```

Include the archive result in the response payload by extending the returned JSON:

```typescript
return {
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify({
        ...rootIndex,
        archived_documents: archiveResult.archived,
        archive_skipped: archiveResult.skipped.length > 0 ? archiveResult.skipped : undefined,
      }, null, 2),
    },
  ],
};
```

Note: There is no lock scope needed here because `initializeProject` already guards against concurrent initialization via the `rootIndexExists()` check, and the ledger directory has just been created.

### Step 3: Add `synthesis_file` parameter to `ledger_complete_synthesis`

In the `CompleteSynthesisSchema` in [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts#L367):

```typescript
const CompleteSynthesisSchema = z.object({
  project_path: z.string().describe('Absolute path to the project plan directory'),
  synthesis_file: z.string().optional().default('synthesis.md')
    .describe('Filename of the synthesis document (default: "synthesis.md")'),
});
```

### Step 4: Extend `completeSynthesis()` to archive the synthesis document

After the root index write (still inside the lock scope), call `archiveDocuments()`:

```typescript
// Inside the withLock callback, after store.writeRootIndex(rootIndex):
const archiveResult = await store.archiveDocuments([args.synthesis_file]);
```

Include the archive result in the response payload:

```typescript
result = {
  content: [{
    type: 'text' as const,
    text: JSON.stringify({
      synthesis_generated: true,
      project_status: rootIndex.status,
      message: 'Synthesis marked as generated.',
      archived_documents: archiveResult.archived,
      archive_skipped: archiveResult.skipped.length > 0 ? archiveResult.skipped : undefined,
      next_steps: [
        'Your work is complete. Call ledger_get_handoff_status (current_agent: "Synthesis") to end the workflow.',
      ],
    }, null, 2),
  }],
};
```

Note: The plan document is **not** re-archived here — it was already archived at initialization. Only the synthesis document is copied at this stage.

### Step 5: Update help content

In [mcp-server/src/tools/help-content.ts](mcp-server/src/tools/help-content.ts), update the entries for:

- **`ledger_initialize_project`**: Document the new plan archival behavior.
- **`ledger_complete_synthesis`**: Document the new synthesis archival behavior and `synthesis_file` parameter.

### Step 6: Write tests

**For `initializeProject()` in [mcp-server/tests/tools/project-lifecycle.test.ts](mcp-server/tests/tools/project-lifecycle.test.ts):**

1. **Plan archive on init**: Create a plan file in the plan folder, call `initializeProject`, verify `plan.md` appears in the ledger storage dir with identical content.
2. **Plan missing on init**: Call `initializeProject` when the plan file doesn't exist — verify the tool still succeeds with the file reported as `skipped`.
3. **Archive info in response**: Verify the response JSON includes `archived_documents` and/or `archive_skipped` fields.

**For `completeSynthesis()` in the same file:**

4. **Synthesis archive on complete**: Create a synthesis file in the plan folder, call `completeSynthesis`, verify `synthesis.md` appears in the ledger storage dir.
5. **Missing synthesis file**: No synthesis file exists — verify the tool still succeeds with the file reported as `skipped`.
6. **Custom `synthesis_file`**: Pass `synthesis_file: "report.md"` — verify that file is copied instead of `synthesis.md`.
7. **Plan NOT re-archived at synthesis**: Verify that only the synthesis file is copied at this stage (plan was already archived at init).

**For `LedgerStore.archiveDocuments()` in [mcp-server/tests/storage/ledger-store.test.ts](mcp-server/tests/storage/ledger-store.test.ts):**

8. **Copy succeeds**: Write a temp file, call `archiveDocuments`, verify destination exists with identical content.
9. **Source missing**: Call with a non-existent filename, verify it's in the `skipped` array and no error is thrown.

### Step 7: Update manifest documents

| Document | Update |
|----------|--------|
| [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) | Add `synthesis_file` parameter to `ledger_complete_synthesis` signature; document archive behavior in `ledger_initialize_project`; add `archiveDocuments()` to `LedgerStore` public methods; document archive response fields for both tools; add `handleGetPlanDocument()` API handler |
| [mcp-server/docs/agents/project-manifest/data-flows.md](mcp-server/docs/agents/project-manifest/data-flows.md) | Update Flow 1 (Project Initialization) to include plan archive step; update Flow 12 (Synthesis Completion) to include synthesis archive step |
| [mcp-server/docs/agents/project-manifest/file-tree.md](mcp-server/docs/agents/project-manifest/file-tree.md) | Note that `{slug}/plan.md` and `{slug}/synthesis.md` may exist alongside JSON files |
| [mcp-server/docs/agents/project-manifest/constraints.md](mcp-server/docs/agents/project-manifest/constraints.md) | Clarify that `.md` archive files in the ledger storage directory are read-only copies and should not be modified in place |

---

### Step 8: Add API endpoint to serve the archived plan document

In [mcp-server/gui/api.ts](mcp-server/gui/api.ts), add a new handler:

```typescript
export async function handleGetPlanDocument(
  ledgerRoot: string,
  slug: string
): Promise<{ content: string }> {
  const store = new LedgerStore(slug, ledgerRoot);
  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  try {
    const planContent = await readFile(join(ledgerRoot, slug, 'plan.md'), 'utf-8');
    return { content: planContent };
  } catch {
    notFound(`Plan document not found for project '${slug}'.`);
  }
}
```

In [mcp-server/gui/server.ts](mcp-server/gui/server.ts), add the route:

```
GET /api/projects/:slug/plan → handleGetPlanDocument(ledgerRoot, slug)
```

This returns the raw Markdown content as a JSON wrapper `{ "content": "..." }` so the frontend can render it. Returning JSON (rather than raw `text/markdown`) keeps the API consistent with all other endpoints.

### Step 9: Add a Markdown rendering library (client-side)

The GUI is a vanilla JS SPA with no build step. Add **[marked](https://github.com/markedjs/marked)** as a client-side Markdown-to-HTML renderer:

- Download `marked.min.js` (single file, ~40 KB, no dependencies) into [mcp-server/gui/public/libs/marked.min.js](mcp-server/gui/public/libs/marked.min.js).
- Add `<script src="/libs/marked.min.js"></script>` to [mcp-server/gui/public/index.html](mcp-server/gui/public/index.html) before `app.js`.
- Add `.js` extension to the MIME type table in `server.ts` (already present: `'.js': 'application/javascript'`).

**Why `marked`:**
- Zero dependencies, single file, works without a build step.
- Well-maintained (800+ contributors, 33k+ stars).
- Supports GFM (GitHub Flavored Markdown) tables, task lists, and fenced code blocks — matching the format used in plan documents.
- Compatible with the dashboard's no-framework, vanilla JS approach.
- Does not require sanitization for our use case since the Markdown source is trusted (generated by the Planner agent).

**Alternative considered:** `markdown-it` — heavier (~100 KB), more extensible but overkill for rendering a single trusted document.

### Step 10: Add the Plan subpage view to the SPA

In [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js), add:

1. **API client method**: `API.getPlanDocument(slug)` — calls `GET /api/projects/:slug/plan`.

2. **Router entry**: Match `#/projects/:slug/plan` and call `renderPlan(app, slug)`.

3. **`renderPlan(app, slug)` view function**:
   - Fetch the plan document via `API.getPlanDocument(slug)`.
   - Parse the Markdown to HTML using `marked.parse(content)`.
   - Render with a breadcrumb (`Projects / {slug} / Plan`), the rendered HTML inside a `.plan-content` container, and a back link.
   - Handle the `NOT_FOUND` error gracefully (show "Plan document not available" message — for projects initialized before this feature).

### Step 11: Extract and display the plan synopsis on the project detail page

On the project detail page (`renderProjectDetail()`), show the plan's summary section above the work packages table:

1. **Fetch the plan document** alongside the existing project data call (via `Promise.all`).

2. **Extract the synopsis**: Parse the Markdown text to find the `## Summary` section — extract everything between `## Summary` and the next `##` heading (or end of file). This is a simple regex operation on the raw Markdown text:

   ```javascript
   function extractSynopsis(markdown) {
     var match = markdown.match(/## Summary\s*\n([\s\S]*?)(?=\n## |\n---|\s*$)/);
     return match ? match[1].trim() : null;
   }
   ```

3. **Render the synopsis** as a card above the WP table, using `marked.parse()` for inline Markdown formatting (bold, links, code spans). Include a "View full plan →" link to `#/projects/{slug}/plan`.

4. **Graceful fallback**: If the plan document is not available (404), the synopsis section is simply omitted — the page renders exactly as it does today.

### Step 12: Add plan rendering styles

In [mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css), add styles for:

- `.plan-content` — container for the rendered plan HTML: typographic defaults for headings, paragraphs, lists, tables, code blocks, and horizontal rules within the plan context. Use the established CSS custom properties (e.g. `var(--color-border)`, `var(--color-bg)`, `var(--radius)`).
- `.plan-synopsis` — compact card style for the synopsis display on the project detail page: subtle background, left border accent, max-height with overflow for very long summaries.

### Step 13: Write GUI tests

In [mcp-server/tests/gui/api.test.ts](mcp-server/tests/gui/api.test.ts), add tests for:

1. **`handleGetPlanDocument` — happy path**: Write a `plan.md` to a temp ledger dir, call the handler, verify it returns `{ content: <markdown> }`.
2. **`handleGetPlanDocument` — not found**: Call with a slug that has no `plan.md`, verify it throws `NOT_FOUND`.
3. **`handleGetPlanDocument` — project not found**: Call with a non-existent slug, verify it throws `NOT_FOUND`.

## Dependencies

- **`fs/promises.copyFile`** (built-in Node.js API) — for archiving documents. No new npm dependency.
- **`marked`** (client-side JS library, ~40 KB) — for rendering Markdown to HTML in the GUI. Vendored as a static file in `gui/public/libs/`, not an npm dependency. This keeps the GUI's zero-npm-dependency design intact.

## Required Components

| Component | Status | Location |
|-----------|--------|----------|
| `LedgerStore.archiveDocuments()` | **New** | [mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts) |
| `initializeProject()` | **Modified** | [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts#L243) |
| `CompleteSynthesisSchema` | **Modified** | [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts#L367) |
| `completeSynthesis()` | **Modified** | [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts#L373) |
| Help text for `ledger_initialize_project` | **Modified** | [mcp-server/src/tools/help-content.ts](mcp-server/src/tools/help-content.ts) |
| Help text for `ledger_complete_synthesis` | **Modified** | [mcp-server/src/tools/help-content.ts](mcp-server/src/tools/help-content.ts) |
| Init + Synthesis tool tests | **Modified** | [mcp-server/tests/tools/project-lifecycle.test.ts](mcp-server/tests/tools/project-lifecycle.test.ts) |
| LedgerStore archive tests | **New** | [mcp-server/tests/storage/ledger-store.test.ts](mcp-server/tests/storage/ledger-store.test.ts) |
| `handleGetPlanDocument()` | **New** | [mcp-server/gui/api.ts](mcp-server/gui/api.ts) |
| Plan document route | **Modified** | [mcp-server/gui/server.ts](mcp-server/gui/server.ts) |
| `API.getPlanDocument()` | **New** | [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) |
| `renderPlan()` view | **New** | [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) |
| `extractSynopsis()` utility | **New** | [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) |
| `renderProjectDetail()` | **Modified** | [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) |
| `marked.min.js` | **New (vendored)** | [mcp-server/gui/public/libs/marked.min.js](mcp-server/gui/public/libs/marked.min.js) |
| `<script>` tag for marked | **Modified** | [mcp-server/gui/public/index.html](mcp-server/gui/public/index.html) |
| Plan rendering styles | **New** | [mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css) |
| GUI API tests for plan endpoint | **New** | [mcp-server/tests/gui/api.test.ts](mcp-server/tests/gui/api.test.ts) |
| 4 manifest documents | **Modified** | [mcp-server/docs/agents/project-manifest/](mcp-server/docs/agents/project-manifest/) |

## Assumptions

- The plan document exists in the plan folder when `ledger_initialize_project` is called. This is the established convention — the Planner creates the plan, then the PM initializes the ledger.
- The Synthesis agent writes the synthesis document to the plan folder *before* calling `ledger_complete_synthesis`. This is the established convention confirmed by the current personas and workflow.
- The plan filename is provided via the `plan_file` parameter to `ledger_initialize_project` (always required).
- `"synthesis.md"` is the de-facto standard synthesis filename. The optional parameter provides an escape hatch without requiring a codebase-wide convention change.
- The ledger storage directory already exists when `completeSynthesis` runs (it was created during `ledger_initialize_project`).

## Constraints

- **STDIO discipline** (Constraint 7): Warning logs for skipped files must go to `stderr`, not `stdout`.
- **Atomic write concern**: `fs.copyFile` is not atomic in the same way as `atomicWriteJson`. However, since `.md` files in the ledger are read-only archives (never read-modify-written), a partial copy has no corruption risk — a subsequent `completeSynthesis` call (idempotent) would overwrite it.
- **Locking**: The synthesis archive step runs inside the existing `withLock` scope. The initialization archive step does not need locking because the ledger directory has just been created and no concurrent access is possible.
- **No schema validation on `.md` files**: The archived Markdown is opaque to the server — it is stored as-is without parsing or validation.

## Out of Scope

- **Archiving `work.md` or other documents**: The user specifically requested plan and synthesis. Additional documents can be added later by extending the `filesToArchive` array.
- **Retroactive archiving of existing COMPLETE projects**: This plan only affects future `ledger_complete_synthesis` calls. A backfill script could be added separately.
- **Compression or deduplication**: Files are copied as-is. At typical Markdown sizes (< 50 KB), compression adds complexity without meaningful benefit.
- **Rendering synthesis documents in the GUI**: The synthesis view can be added later when the synthesis document is also archived. This plan focuses on the plan document view.

## Acceptance Criteria

### Archival

1. Calling `ledger_initialize_project` archives the plan document (specified by `plan_file`) into `mcp-server/storage/ledger/{slug}/`.
2. Calling `ledger_complete_synthesis` archives the synthesis document (`synthesis.md` or the specified `synthesis_file`) into `mcp-server/storage/ledger/{slug}/`.
3. The archived files have identical content to the source files in the plan folder.
4. If the plan file does not exist at initialization, the tool still succeeds and reports the file as skipped.
5. If the synthesis file does not exist at synthesis completion, the tool still succeeds and reports the file as skipped.
6. Both tools' responses include `archived_documents` (list of successfully copied filenames) and `archive_skipped` (list of missing filenames, only present when non-empty).
7. A custom `synthesis_file` value is respected when provided to `ledger_complete_synthesis`.
8. All existing tests continue to pass (backward compatibility).
9. New tests cover the archive happy path, partial-missing scenarios, and custom filename for both tools.

### GUI

10. `GET /api/projects/:slug/plan` returns `{ "content": "<markdown>" }` for projects with an archived plan document.
11. `GET /api/projects/:slug/plan` returns 404 for projects without an archived plan document.
12. Navigating to `#/projects/:slug/plan` renders the plan document as formatted HTML with proper heading hierarchy, tables, lists, and code blocks.
13. The project detail page (`#/projects/:slug`) displays the plan synopsis (text of `## Summary`) above the work packages table when an archived plan exists.
14. The project detail page renders normally (no synopsis section) for projects without an archived plan.
15. The synopsis section includes a "View full plan →" link to the plan subpage.

### Manifest

16. Manifest documents are updated to reflect all new behavior.

## Testing Strategy

- **Unit tests** for `LedgerStore.archiveDocuments()`: test copy success, source missing, and mixed scenarios using temp directories.
- **Integration tests** for `initializeProject()`: create a plan file in the temp plan folder, run the tool, verify the plan `.md` file appears in the ledger storage dir and the response payload includes archive info.
- **Integration tests** for `completeSynthesis()`: create a synthesis file in the temp plan folder, run the tool, verify the synthesis `.md` file appears in the ledger storage dir and the response payload includes archive info.
- **API tests** for `handleGetPlanDocument()`: test happy path (returns content), not-found (no plan.md), and project-not-found (non-existent slug).
- **Backward compatibility**: Run all existing tests to confirm no regressions. The optional `synthesis_file` parameter defaults to `"synthesis.md"`, preserving existing behavior.
- **Edge cases**: Source file missing at each stage — each tool must still succeed with the file reported as `skipped`.
- **Manual smoke test**: Start the GUI (`npm run gui`), navigate to a project with an archived plan, verify the plan renders correctly and the synopsis appears on the project detail page.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Plan file missing at initialization** | Best-effort archival: file is reported as `skipped`, initialization still succeeds. In practice, the plan always exists because the Planner creates it before the PM initializes the ledger. |
| **Plan folder deleted before synthesis runs** | The plan was already archived at initialization, so it is safely preserved. Only the synthesis document needs the plan folder to still exist at synthesis time. |
| **Large Markdown files slow down synthesis completion** | `fs.copyFile` is efficient (kernel-level copy on most platforms). Plan/synthesis docs are typically < 50 KB — negligible I/O cost. |
| **Naming collision with future JSON files** | `.md` extension provides clear namespace separation from `.json` files. No current or planned JSON file uses a `.md` extension. |
| **Idempotent re-call overwrites archive** | Acceptable: `completeSynthesis` is documented as idempotent. Re-archiving the same source files produces identical results. |
| **`fs.copyFile` not atomic** | Acceptable for read-only archive files. A partial copy from a crash is overwritten on the next idempotent call. |
| **Vendored `marked.min.js` goes stale** | Acceptable trade-off: the library is mature and stable. Version is pinned by the vendored file. Update manually when needed. |
| **XSS from rendered Markdown** | The Markdown source is trusted (generated by the Planner agent, stored in the ledger). If untrusted sources are ever added, enable `marked`'s built-in sanitizer or add DOMPurify. |
| **Synopsis extraction regex fails on non-standard plans** | Graceful fallback: if no `## Summary` is found, the synopsis section is simply omitted. |
