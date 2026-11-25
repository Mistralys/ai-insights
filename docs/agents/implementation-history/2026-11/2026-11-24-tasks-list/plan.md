
# Plan

## Plan Audit Cycles
- Audits: 3 (Sonnet 5.5 ×3) — Plan Auditor v1.13.1
- Architectural Reviews: 1 (Sonnet 5.5 ×1) — Plan Architect Reviewer v2.5.2

## Prior Project Context

- **Prototype session `2026-11-23-tasks-ui-prototype` (COMPLETE).** Its `tasks-prototype.html` was approved by the user with no corrections and is the binding UI and interaction reference for Steps 13–16. Its `request.md` is the requirements source. Its synthesis "Interface Insights" contribute: the confirmed reference-cell behaviour, roving tabindex, the 700 ms completion leave, the priority model, `marked` with sanitising instead of the inline renderer, the expand-dot rule, and four follow-ups (focus ring and border contrast, reference column width, "where did it go" feedback, nav wrapping). All are carried into this plan. That folder stays read-only.
- **Prototype rework "Colour Dots" (same folder, after approval).** The user added user-chosen colour dots from a fixed 16-colour palette and a multi-select colour filter to `request.md` and the prototype. The *(rework)* Interface Insights fix the shape this plan adopts: the dot sits between the reference and the text (`[~xQOT.+-]`); a task stores a palette **id**, never a hex value; the palette is a non-modal popover with arrow-key grid navigation; the filter combines colours as OR, with a "No colour" option and "Any" to clear. The rework also recorded a prototype bug the real view must not repeat: the palette rebuilds itself on a toggle, so the click reached the document's outside-click closer with a detached target and closed the palette.
- **Error-code generator (`origin/main`, MCP v2.12.0).** It introduced the registry-derived tool registration (`src/tools/registry.ts`), the `CONFIG_TABS` tab registry (GUI constraint §25), route guards (`gui/route-guards.ts`) and the corruption-safe state reader (`src/storage/json-state-file.ts`). This plan reuses all four rather than adding parallel mechanisms.
- **Strategic vision.** Short-term goal: low-friction daily use. Long-term goal: "Personas First", where tools exist to support personas. The task tools exist so that the Task Curator can do its job, and the Tasks tab is a daily surface for the user.
- **Insights applied:** `f389f9ce` (plain-function storage helpers), `2e5304cf` and `b2806461` (validation at the handler layer, the same on every branch), `0eff2a76` and `bed501c2` (jsdom/vm test harness rules) and `660d8039` (partials at column 0). Insight `53454e24` (regenerating `.context/`) was considered and dropped: CTX generation has been removed from the repository, so the insight no longer applies to this plan.

## Summary

Add task management to the AI Insights Ledger. The work has five parts:

- A per-store task file, merged into one global collection the way global knowledge is.
- Six `ledger_*_task` MCP tools covering full CRUD and multi-term search.
- A **Tasks** main tab in the GUI that reproduces the approved prototype: compact single-line rows, inline editing, keyboard-first navigation, reordering, the create flow, two-step delete, tag chips, and user-chosen colour dots from a fixed 16-colour palette with a multi-select colour filter.
- A **Tasks** tab in Configuration for the ticket base URL, the default queue and the default entries per page.
- A new **Ledger Task Curator** persona. Synthesis dispatches it next to the Knowledge Archiver to close tasks the finished work completed. Users and other agents can also call it to manage tasks.

## Architectural Context

- **Storage** (`mcp-server/src/storage/`). Each configured store is a directory. `StoreRouter.getAllStores()` lists the stores in priority order; in legacy single-store mode it returns one `default` store. Knowledge lives in a dot-directory per store (`.knowledge/`) with its own lock scope. `MultiStoreManager` collates across stores and is read-only. The file I/O rules are `atomicWriteJson()` (`atomic-writer.ts`), `withLock(dir)` (`file-lock.ts`), `now()` (`utils/timestamp.ts`), and `readJsonStateFile()` / `keepCorruptCopy()` (`json-state-file.ts`, origin/main) for state files that must never be overwritten after a failed read.
- **Settings.** `src/gui/config.ts` → `GuiConfigSchema` defines one server-wide `gui-config.json`. Both the MCP process and the GUI process read it through `readConfigFromDisk()` and keep it current with `startConfigWatcher()`, so `getConfig()` is fresh in both.
- **MCP tools** (`mcp-server/src/tools/`). Each domain has one module with Zod input schemas and a `register(server)` function. `registry.ts` (origin/main) lists every module in `TOOL_MODULES`, and `tests/tools/tool-registry.test.ts` fails when a module is missing from it. Help text lives in `help-content.ts` → `TOOL_HELP`.
- **GUI backend** (`mcp-server/gui/`). There is one handler module per domain (GUI constraint §21). Routes are declared in `server.ts` sub-builders composed by `buildRoutes()`; Section C catch-alls come last (§9). Routes can carry `guards` (origin/main: `requireLoopbackRequest`, `requireJsonContentType`).
- **GUI frontend** (`mcp-server/gui/public/`). Vanilla ES5 with no build step, one global namespace per file, string-built HTML through `escapeHtml`, and `?v=N` cache busting (§1–§3, §13, §14). `router.js` dispatches named singleton routes to `render*(app)`. `views/config.js` (origin/main) is a `CONFIG_TABS` registry (§25). `libs/marked.min.js` is marked v15 and exports `marked.Marked`.
- **Personas** (`personas/`). Source lives in `src/content/*.md` + `src/meta/*.yaml` per suite and is built for VS Code, Claude Code and Deep Agents. Synthesis (`personas/ledger/src/content/9-synthesis.md`, step 8) dispatches the Knowledge Archiver per target, with a project-comment fallback when the dispatch tool is unavailable. The orchestrator wires sub-agents from the ledger YAML `subagents` list (`orchestrator/src/utils/subagents.py` → `load_subagents()`) with no code change.

## Approach / Architecture

```
                ┌───────────────────────── per store ─────────────────────────┐
                │ {storePath}/.tasks/tasks.json   (lock: {storePath}/.tasks)   │
                └──────────────────────────────▲──────────────────────────────┘
                                               │ task-store.ts (plain functions: read / mutate one store)
                                               │
                       task-collection.ts (plain functions over StoreRef[]: list, search, get,
                       create, update, delete, reorder; tags TaskView with store + ticket link)
                          ▲                                   ▲
         src/tools/tasks.ts (6 MCP tools)          gui/api-tasks.ts (REST, guarded mutations)
                          ▲                                   ▲
              Task Curator persona                 views/tasks*.js  +  views/config-tasks.js
          (Synthesis / Coordinator /                   (Tasks tab)        (Configuration → Tasks)
           Standalone Developer dispatch)
                                    shared: schema/task.ts (incl. TASK_COLOR_IDS), utils/ticket-reference.ts, gui/config.ts task settings
```

1. **One storage layer, two consumers.** `src/storage/task-collection.ts` is the only code that iterates stores for tasks. The MCP tools and the GUI API both call it, so the duplicated multi-store iteration seen in the knowledge domain (`tools/knowledge.ts` and `gui/api-knowledge.ts`) is not repeated.
2. **The store is a location, not a field.** A task's store is derived from the file it was read from and returned as `store_id` / `store_label` on a `TaskView`. It is never persisted, so re-labelling or re-importing a store cannot leave stale ids inside the data. A task cannot change stores once created; the request forbids it.
3. **Server-side reference logic.** Normalisation, label and URL are computed once in `src/utils/ticket-reference.ts`. Every `TaskView` carries `ticket_label` and `ticket_url`, so the ES5 frontend does not duplicate the rules. It sends raw input and renders what comes back.
4. **Client-side list model.** `GET /api/tasks` returns the whole collection, the store list and the task settings in one payload, matching the Knowledge view's load-all pattern. Filtering, sorting, pagination, cross-page keyboard moves and the "where did it go" message all run in a pure `TasksModel` module, as in the prototype.
5. **Prototype priority model.** Priority is an integer and a new task gets max + 1 across all stores. A move swaps priorities with the neighbour in the filtered list. Drag & drop reassigns the existing priorities of the reordered page subset. The client sends the resulting `{id, priority}` assignments to one reorder endpoint. The server groups them by store and writes each store under its own lock, one after another. It never takes a lock that spans stores. The sort tie-breaker (priority desc, created_at desc, id asc) keeps a partially applied cross-store reorder harmless.
6. **Colour is a palette id with three layered owners.** The server owns the set of valid ids (`TASK_COLOR_IDS` in `schema/task.ts`) and validates every write against it. The frontend owns the ordered display list with names (`TasksModel.PALETTE`). `styles.css` owns the actual colours as per-theme custom properties (`--task-color-{id}`). A pin test keeps the three in step. Re-tuning a colour for a theme is then a CSS-only change, and no stored task ever needs migrating.
7. **The persona owns the workflow; tools stay generic.** Agent-facing behaviour (when to close a task, the evidence threshold, never deleting without confirmation) lives in the Task Curator persona. The tools enforce data validity only.

## Rationale

- **Reuse of origin/main seams.** `TOOL_MODULES`, `CONFIG_TABS`, `Route.guards` and `readJsonStateFile` were each built so that the next feature would be a one-line or one-descriptor addition. Using them keeps the maintenance surface flat.
- **`.tasks/tasks.json` rather than `{storePath}/tasks.json`.** The dot-directory gets its own lock scope (`{storePath}/.tasks/.lock`) instead of sharing the store-root lock with `.repositories.json`. It is skipped by project enumeration for free, the same way `.knowledge/` is. It also leaves room for the next files this domain will grow (an archive of completed tasks is the obvious one) without cluttering the store root. The file is still the "dedicated `tasks.json` per store" the request asks for.
- **Corrupt files are never overwritten.** Stores are user-synced, often with Git, and a merge conflict leaves markers in the JSON. A store whose task file cannot be parsed or validated is skipped on read and reported in `store_errors`, and writes to it fail with an error naming the file. A "start from empty" policy would silently destroy the user's tasks on the next write. This is the rule `json-state-file.ts` exists to enforce.
- **Settings in `gui-config.json`.** The three settings are server-wide display and normalisation preferences, the case `constraints-storage.md` → *`gui-config.json` Is Server-Wide* covers. Both processes already watch the file, so a base-URL change reaches agent tool responses without a restart.
- **Two search semantics, on purpose.** The GUI search uses AND across terms, as in the approved prototype: the user narrows a list. `ledger_search_tasks` uses OR across terms, ranked by match count, as `ledger_search_insights` does: the Curator has to recall candidates from synthesis vocabulary and then judge them.
- **`completion_source`.** This is a new optional field beyond the request's property list. It records the plan slug (or another short reason) when an agent closes a task. Without it, the user cannot tell why a task closed itself during synthesis. Its consumers are the Task Curator (writer) and the expanded-row metadata (reader).
- **Colour: id stored, unknown ids tolerated.** Writes accept only a palette id or `''`. Reads stay permissive: a stored id that is no longer in the palette (a hand-edited file, or a future palette change) is kept on disk, displayed as "no colour", and matched by the "No colour" filter. The same rule (`colorKey`) runs on the server and in `TasksModel`, so the GUI and the tools agree on what "No colour" means.
- **Colour filter on the list tool only.** `ledger_list_tasks` takes an optional `colors` array with the GUI's OR semantics. Users identify tasks by colour ("my red tasks"), which is a list request, and the Task Curator is the user's point of contact for task requests, so it needs the same filter the user has. `ledger_search_tasks` does not take `colors`: it is query-driven recall for the Curator's synthesis reconciliation, which has no use for colour, and an agent that wants both can filter the returned `color` field. The filter is one predicate inside the shared `matchesFilters()` of `task-collection.ts` (Step 7).
- **Filter and sort parity across the two implementations.** The browser cannot import TypeScript (no build step), so `TasksModel` re-implements the comparator and the status, tag and colour predicates that `task-collection.ts` implements for the tools. The reorder tie-breaker depends on both sides agreeing on sort order, so a parity test runs both implementations over one shared fixture instead of pinning only `normaliseTag` and `colorKey`. The search semantics (OR on the server, AND in the GUI) differ on purpose and are not pinned against each other.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Task file location | `{storePath}/.tasks/tasks.json`, lock on `.tasks/` | `{storePath}/tasks.json` with the store-root lock; tasks inside `.knowledge/` | The root file shares a lock with `.repositories.json` and has nowhere to grow. Folding tasks into `.knowledge/` couples two domains under one lock. A dedicated dot-directory matches `.knowledge/` exactly. |
| Store identity | Derived from file location, returned on `TaskView` | Persist `store_id` in each task | A persisted id goes stale when a store is re-imported under another id. Deriving it costs nothing, because reads are already per store. |
| Priority / reorder | Integer priority, swap and subset reassignment, per-store sequential writes with a deterministic tie-breaker | Fractional midpoint ranks (one write per move); a central ordering file under `~/.ai-insights/` | Midpoint ranks lose float precision under repeated moves into the same gap and then need a cross-store rebalance anyway. A central file breaks store portability across devices. The prototype model is the one the user approved. |
| Cross-store write rule | Documented exception: a reorder batch is several independent single-store writes | Forbid cross-store reorders (move only within one store) | Tasks from several stores interleave in one list. Forbidding cross-store moves would make some drags silently impossible. Every individual write stays single-store and locked. |
| Store parameter on MCP tools | Optional `store_id` on add, list and search (defaults to the default store / all stores) | Derive the store from `cwd_path` / repository like ledger tools | Tasks are not tied to repositories in the request; the user picks a store explicitly. This is a documented exception to *Multi-Store Routing Requires No New Tool Parameters*. |
| Reference rules location | `src/utils/ticket-reference.ts`, results shipped on `TaskView` | Duplicate the logic in ES5 in the frontend | Duplication needs a pin test and still drifts. Server-computed `ticket_url` keeps one implementation; the cost is a round-trip on reference edits, which already save to the server. |
| List loading | Load all tasks once; filter, sort and paginate client-side | Server-side filtered and paginated endpoint | Cross-page `Alt+↑/↓`, cross-page arrow navigation and "shown on page N" need the full ordered list. Expected volume is hundreds of tasks, as with the Knowledge view. Recorded as a risk with a threshold. |
| Markdown | `SafeMarkdown` module using a private `marked.Marked` instance (raw HTML escaped, link scheme allow-list, images as links) | Pre-escape then `marked` (dialogue view pattern); add DOMPurify | Pre-escaping double-escapes code spans and still lets `javascript:` links through. DOMPurify would be a second vendored library. A renderer override closes both holes with what is already bundled. |
| Task settings storage | Three flat keys in `GuiConfigSchema` | Nested `tasks: {…}` object; separate `~/.ai-insights/tasks/config.json` | `writeConfig()` merges shallowly, so a nested object would be replaced whole on partial updates. A separate file needs its own watcher; the error-code config needed one only for secrets and plugins. |
| Mutation route protection | `requireLoopbackRequest` on all task mutation routes, plus `requireJsonContentType` on body routes; GET unguarded | Guard nothing (like knowledge); guard GET too | Mutations change user data and the GUI binds every interface without authentication. Read access stays consistent with the rest of the GUI. |
| Persona shape | One ledger-support persona with two modes (Synthesis Reconciliation, Task Management) | Separate "task archiver" and "task curator" personas mirroring knowledge | The request names one point of contact for users and agents. The knowledge split exists because extraction and auditing are different crafts, while closing and managing tasks share one judgement. |
| Stored colour value | Palette id (`'violet'`), `''` for none | Hex value; palette index number | A hex value ties stored data to one theme's rendering, so re-tuning a colour (the dark-theme follow-up) would need a data migration. An index breaks silently when the palette is reordered. An id is stable and readable in the JSON file. |
| Where the colour values live | Ids in `schema/task.ts`; ordered id + name list in `TasksModel.PALETTE`; hex values as `--task-color-{id}` tokens in `styles.css` (`:root` and `[data-theme="dark"]`); a pin test across all three | Hex in a JS constant as in the prototype; server ships the full palette in `GET /api/tasks` | A JS hex constant cannot vary per theme without duplicating theme logic in JS. Shipping the palette from the server would put display colours in TypeScript, far from the theme tokens that should own them. CSS tokens follow the GUI's existing per-theme pattern. |
| Clearing a colour | `color: ''` | `color: null` (as `reference` does) | The prototype and the request's stored shape use the empty string, and a single "no colour" representation keeps the filter rule simple. `null` is rejected with a message naming `''`. |
| Colour filter semantics | OR across the selected colours, `'none'` token for "No colour" | AND (as tags) | A task has one colour, so AND over two colours is always empty. Matches the prototype and the request ("matches any of the selected colors"). |
| Colour filter on MCP tools | Optional `colors` on `ledger_list_tasks` only | `colors` on both list and search; no colour filter on tools (agents filter the JSON themselves) | Without it, the Curator must page through every task to answer "show my red tasks", and list pagination makes that error-prone. The stated use case is a list request. Search is query-driven recall for synthesis reconciliation, so a colour parameter there would add tool surface with no consumer. |
| Filter and sort duplication | Two implementations (`compareTasks`/`matchesFilters` on the server, `TasksModel` in the browser) with a shared-fixture parity test | Pin only `normaliseTag` and `colorKey`; serve a pre-sorted list and drop the client comparator | The browser cannot import TypeScript, so the duplication stays. Pinning only two helpers leaves sort order and predicates free to drift, which breaks the reorder tie-breaker. The client still needs all three sorts, so dropping its comparator only removes one of them. |
| Global style changes packaging | A standalone work package (Step 10a) with its own changelog line and cross-view check, ahead of the Tasks view | Bundle with the palette tokens in one step; scope the tokens and rings to `#tasks-root` | Bundling hides a change that touches every view inside a feature review. Scoping to `#tasks-root` leaves the accessibility gaps in the other views and adds selectors to remove later. A separate package is reviewable, testable and revertable on its own at the same CSS cost. |
| Palette element ownership | One palette element per render, inside `#tasks-root`, two modes (`set`, `filter`) | A palette per row; a palette appended to `document.body` | Per-row palettes multiply markup by the page size. A body-level element outlives the route and needs its own teardown. One element inside the root disappears with the view. |
| Frontend decomposition | `tasks-model.js` (pure), `tasks-render.js` (HTML builders), `tasks.js` (controller) | One `views/tasks.js` file like the prototype | The prototype's ~1000 lines of script mixed state rules, markup and events. The split lets the model and markup be tested under jsdom without driving the DOM, and keeps each file one namespace. |

## Pattern Alignment

- **Follows** the per-store dot-directory plus single lock scope of `mcp-server/src/storage/knowledge-store.ts` (`.knowledge/`).
- **Follows** UUID v4 ids (`constraints-storage.md` → *Insight IDs Are UUID v4 Strings*).
- **Follows** plain-function storage modules (`mcp-server/src/storage/repository-registry.ts`; insight `f389f9ce`). **Departs** from the `KnowledgeStoreManager` class shape, because task storage holds no instance state.
- **Follows** the corruption-safe read of `mcp-server/src/storage/json-state-file.ts` (origin/main). **Departs** from `KnowledgeStoreManager._readStore()`, which throws and so fails every cross-store read on one bad file.
- **Follows** the dual-schema pattern: strict tool and REST input schemas, permissive storage schema (`constraints-storage.md` → *Dual-Schema Pattern*).
- **Departs** from *Multi-Store Collation Is Read-Only* (reorder batches) and *Multi-Store Routing Requires No New Tool Parameters* (`store_id`). Both are justified above and recorded as named exceptions in `constraints-storage.md` (Step 22).
- **Follows** registry-derived tool registration (`mcp-server/src/tools/registry.ts`, origin/main) and per-tool help strings (`src/tools/help-content.ts`).
- **Follows** the handler domain split (GUI §21), sub-builder route composition (§9), `statusCode: 201` for creation (`POST /api/repos`), and route guards (`buildErrorCodeRoutes()` in `gui/server.ts`, origin/main).
- **Follows** the GUI frontend conventions §1–§5, §13, §14, §19, §20, the listener-lifecycle guard of §2, and `CONFIG_TABS` with the five integration points of §25 (origin/main), including the lazy load and the visit token (`config-error-codes.js` → `ecVisit`).
- **Follows** per-theme colour tokens as CSS custom properties in `:root` / `[data-theme="dark"]` (`mcp-server/gui/public/styles.css`) for the 16 palette colours. **Departs** from the prototype's JS `PALETTE` hex constant (`tasks-prototype.html`), which cannot vary per theme.
- **Follows** the plan's own server/client pin-test pattern (`normaliseTag`) for the palette ids and the `colorKey` rule.
- **Follows** the Knowledge view's load-all, filter-in-memory model (`views/knowledge.js`) and the pagination markup of `views/project-list.js`.
- **Follows** synthesis-time sub-agent dispatch with a depth-limit fallback (`personas/ledger/src/content/9-synthesis.md` step 8) and the ledger-support persona metadata shape (`personas/ledger-support/src/meta/ledger-knowledge-curator.yaml`).

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/gui/config.ts` → `DEFAULT_CONFIG` | Hand-written literal duplicating every `.default()` in `GuiConfigSchema`; this plan adds three keys. | Promoted to step 5 | Derive it with `GuiConfigSchema.parse({})`, the pattern `src/error-codes/config-store.ts` (origin/main) already uses, so a new key is edited in one place. |
| `mcp-server/gui/public/styles.css` focus and border tokens | No `:focus-visible` rule; `--color-border` is about 1.2:1 on white, below the 3:1 non-text floor for input borders. | Promoted to step 10a | The synthesis follow-up asks for both to move into `styles.css`. The Tasks view depends on them, and every other view gains the focus ring. Delivered as its own work package so the change that touches every view is reviewed, verified and revertable apart from the Tasks feature. |
| `mcp-server/gui/public/styles.css` header nav | Wraps into three rows at 375 px; a sixth link (Tasks) makes it worse. | Promoted to step 10a | Adding the nav link is part of this plan. A no-wrap, horizontally scrollable nav at narrow widths is a few CSS rules, delivered in the same standalone package as the other global style changes. |
| `marked` consumers (`views/project-detail-dialogues.js`) | Two safety approaches (pre-escape and none) and no link-scheme filter. | Promoted (new shared module) to step 11; migrating the dialogue view: Rejected | The Tasks view gets the shared `SafeMarkdown` module. Migrating the dialogue renderer is outside this plan's blast radius and has its own rendering tests to re-baseline. |
| `mcp-server/src/tools/knowledge.ts` / `gui/api-knowledge.ts` multi-store iteration | Duplicated loops instead of `MultiStoreManager`. | Rejected | The knowledge domain is not touched by this plan. The task domain avoids the duplication by design (shared `task-collection.ts`). |
| `KnowledgeStoreManager._readStore()` corruption policy | Throws on malformed JSON and fails all cross-store reads. | Rejected | Out of blast radius. The task store adopts the `json-state-file.ts` policy from the start. |
| `views/config.js` tab dispatch | Was a hand-maintained if/else chain on local `main`. | Rejected (already resolved) | `origin/main` replaced it with the `CONFIG_TABS` registry; this plan adds one descriptor. |
| `personas/ledger-support/src/meta/ledger-claude-coordinator.yaml` → `subagents` | Lists the pipeline roles and `ledger-doctor` but not `ledger-knowledge-archiver`, which the coordinator content dispatches. | Promoted to step 20 | Step 20 edits this list and the Archiver dispatch section anyway; declaring both dispatched sub-agents keeps IDE tool tables and the orchestrator view accurate. |
| `docs/agents/project-manifest/cross-system-dependencies.md` row "Insight mutation ownership" | Claims Synthesis and the Standalone Developer dispatch `ledger-knowledge-curator` and declare it in `subagents`; no branch's persona sources do. | Promoted to step 22 | This plan edits exactly those dispatch sections and that table. The row must describe the dispatch that exists (the Archiver) next to the new Task Curator row. |

## Detailed Steps

1. **Confirm the baseline.** Verify the working tree contains `mcp-server/src/tools/registry.ts`, `mcp-server/gui/route-guards.ts`, `mcp-server/src/storage/json-state-file.ts` and the `CONFIG_TABS` array in `mcp-server/gui/public/views/config.js`. These are the origin/main seams this plan builds on. If any is missing, stop and report that the checkout is not based on `origin/main` (see Human Actions #1).

2. **Task schema (new: `mcp-server/src/schema/task.ts`).**
   - Storage schema `TaskSchema`: `id` (`z.string().uuid()`); `reference` (`z.string().max(64).nullable().optional()`); `text` (`z.string()`); `tags` (`z.array(z.string())`); `priority` (`z.number().int()`); `completed` (`z.boolean()`); `created_at` (`z.string()`); `completed_at` (`z.string().nullable().optional()`); `completion_source` (`z.string().max(200).nullable().optional()`); `color` (`z.string().max(32).optional()`); `updated_at` (`z.string().optional()`). Storage schemas stay permissive: `color` accepts any short string on read so an id that is no longer in the palette never makes a file invalid.
   - File schema `TaskFileSchema` `{ version: z.literal(1), last_updated: z.string(), tasks: z.array(TaskSchema) }`.
   - Strict shared input pieces, used by both the tools and the REST bodies:
     - `TaskTextInput`: trimmed of trailing whitespace, non-empty, max 20 000 characters, first line non-empty.
     - `TaskTagsInput`: max 20 tags, each normalised by `normaliseTag()`.
     - `TaskReferenceInput`: raw string, max 64 characters, or `null` to clear.
     - `TaskColorInput`: `z.enum([...TASK_COLOR_IDS, ''])` — a palette id, or `''` for no colour. The error message lists the valid ids.
     - `TaskColorFilterInput`: array (1–17 entries) of palette ids or `'none'`, deduplicated.
   - `TASK_COLOR_IDS`: the 16 palette ids as a `readonly` tuple, in the prototype's order: `red, orange, amber, yellow, lime, green, teal, cyan, blue, indigo, violet, fuchsia, pink, brown, slate, gray`. Export the `TaskColorId` type. This is the only server-side palette definition; it holds no display values.
   - `colorKey(task)`: the task's colour if it is in `TASK_COLOR_IDS`, otherwise `'none'` (covers `''`, a missing field and unknown ids). Filtering uses it on both sides (Step 14 mirrors it).
   - `normaliseTag(raw)` and `TAG_PATTERN`: lowercase, whitespace runs become `-`, commas removed, result must match `/^[a-z0-9][a-z0-9-]{0,31}$/`. This is the prototype's `normTag` rule plus a length bound.
   - `TaskView` type: `Task & { color: string, store_id, store_label, ticket_label, ticket_url }`. `color` is always present on a view (`''` when the stored record has none); the stored id is passed through unchanged, even when unknown.
   - `TaskStatusFilter` enum: `open | completed | all`.
   - `TaskSort` enum: `priority | created | completed`.
   - Export a `compareTasks(sort)` comparator:
     - `priority`: priority desc, then created_at desc, then id asc.
     - `created`: created_at desc, then id.
     - `completed`: completed_at desc with open tasks last, ties by priority desc.

3. **Ticket reference module (new: `mcp-server/src/utils/ticket-reference.ts`).** Pure functions with no I/O:
   - `normaliseReference(raw, queue): { ok: true, value: string | null } | { ok: false, message }`. Trims and removes inner whitespace; empty gives `null`. `^\d+$` is kept. `^([A-Za-z][A-Za-z0-9_]*)-(\d+)$` is uppercased to `QUEUE-123`, and when it starts with the configured queue (case-insensitive, queue non-empty) only the number is stored. Anything else is invalid, with the message "Reference must be a number (4578) or QUEUE-number (ABC-12)."
   - `ticketLabel(ref, queue)`: queue + ref for numeric refs, ref otherwise, `''` for none.
   - `ticketUrl(ref, settings)`: `null` unless the base URL is a valid `http:`/`https:` URL; otherwise `base + ticketLabel(ref)`.
   - `isSafeTicketBaseUrl(url)`: the scheme check shared with the settings schema.

4. **Task settings shape.** Add `tasks_ticket_base_url`, `tasks_ticket_queue` and `tasks_page_size` to `GuiConfigSchema` in `mcp-server/src/gui/config.ts`:
   - `tasks_ticket_base_url`: `z.string().max(2048).refine(v => v === '' || isSafeTicketBaseUrl(v))`, default `''`.
   - `tasks_ticket_queue`: `z.string().max(32).regex(/^([A-Za-z][A-Za-z0-9_]*-?)?$/)`, default `''`.
   - `tasks_page_size`: `z.number().int().min(5).max(200)`, default `20`.

   `GuiConfigPartialSchema` picks the keys up automatically. Add a `getTaskSettings(): TaskSettings` accessor that maps the three keys to `{ ticket_base_url, ticket_queue, page_size }`; it is the single place the rest of the code reads them.

5. **Derive `DEFAULT_CONFIG`.** In `mcp-server/src/gui/config.ts`, replace the `DEFAULT_CONFIG` literal with `GuiConfigSchema.parse({})` (structural improvement). Keep the exported name and type so existing importers compile unchanged.

6. **Per-store task file (new: `mcp-server/src/storage/task-store.ts`).** Plain functions:
   - `taskDir(storePath)`: `{storePath}/.tasks`.
   - `taskFilePath(storePath)`: `{storePath}/.tasks/tasks.json`.
   - `readTaskFile(storePath)`: `{ status: 'ok', file } | { status: 'invalid', path, message }`. It uses `readJsonStateFile()`: `missing` gives an empty file, `unparsable` or a schema failure gives `invalid`, and other I/O errors rethrow.
   - `mutateTaskFile(storePath, fn)`: runs the whole read-modify-write inside `withLock(taskDir(storePath))`. It refuses an `invalid` file with a `TaskFileInvalidError` naming the path, and never overwrites it. On success it sets `last_updated = now()`, validates with `TaskFileSchema` and writes with `atomicWriteJson()`.

   `@remarks` blocks document the fallback contract (`constraints-storage.md` → *Graceful Degradation*).

7. **Cross-store collection (new: `mcp-server/src/storage/task-collection.ts`).** Plain functions over `TaskStoreRef[] = Array<{ id, path, label }>`.
   - `resolveTaskStores()` returns `getStoreRouter().getAllStores()` when the store context is initialised, else the legacy `[{ id: 'default', path: resolveLedgerRoot(), label: 'Default Store' }]`. `resolveDefaultTaskStore()` uses `getStoreRouter().resolveDefaultStore()` the same way.
   - `loadAllTasks(stores, settings) → { tasks: TaskView[], store_errors: Array<{ store_id, message }> }`: reads every store, skipping and reporting invalid ones, and tags each task with its store and ticket fields. On an id duplicated across stores, the first store wins (safety net, as with knowledge).
   - `matchesFilters(task, { status, tags, colors, store_id, reference })`: an exported pure predicate, the single server-side implementation of the filter rules. Tags filter with AND and exact match after normalisation; `colors` matches when `colorKey(task)` is any of the selected values (OR, `'none'` for no colour; an absent or empty `colors` matches everything); `reference` matches the normalised reference. It is exported so the parity test (Test Plan, `tasks-parity.test.ts`) can run it against `TasksModel.visibleTasks`.
   - `listTasks(stores, settings, { status, tags, colors, store_id, reference, sort, limit, offset })`: applies `matchesFilters`, then `compareTasks(sort)`, then pagination.
   - `searchTasks(stores, settings, query, filters)`: `filters` is `{ status, tags, store_id, reference, sort, limit, offset }` with no `colors`. It applies `matchesFilters` (without colours), then lowercased whitespace tokens, OR semantics over the text, `ticket_label` and tags, ranked by match count, then the sort; an empty query behaves as list.
   - `getTask(stores, settings, id)`.
   - `createTask(stores, settings, storeId, input)`: unknown store gives `TaskStoreNotFoundError` with the valid ids. Priority is max over all readable stores + 1 (1 when empty), new UUID, `created_at = now()`, `completed: false`, `color` from the input or `''`.
   - `updateTask(stores, settings, id, patch)`: locates the owning store, then mutates under that store's lock.
     - `completed` false → true sets `completed_at = now()`; true → false clears `completed_at` and `completion_source`.
     - `reference: null` clears; a string is re-normalised against the current queue.
     - Text and tags go through the input normalisers.
     - `color` replaces the stored value (`''` clears it). Only a validated `TaskColorInput` reaches this function.
     - `completion_source` is stored when the task is completed in the same call or is already completed (`null` when absent), and is cleared on reopen. It is rejected with a `TaskValidationError` when supplied for a task that is open and stays open in that call.
     - `priority` replaces the stored integer.
     - Sets `updated_at`.
   - `deleteTask(stores, id)`.
   - `reorderTasks(stores, settings, assignments: Array<{ id, priority }>)`: validates that every id exists, groups by owning store, applies each group in one `mutateTaskFile` call, store by store. It returns `{ updated: TaskView[], failed: Array<{ store_id, message }> }` and never holds two store locks at once.

   Typed errors (`TaskNotFoundError`, `TaskStoreNotFoundError`, `TaskFileInvalidError`, `TaskValidationError`) let both consumers map them without matching on message text.

8. **MCP tools (new: `mcp-server/src/tools/tasks.ts`).** Zod input schemas with `.describe()` on every parameter, handlers calling `task-collection.ts`, an `_internal` test export, and `register(server)` for:
   - `ledger_add_task`: `text` (required), `reference?`, `tags?`, `color?` (palette id, default no colour), `store_id?` (default store).
   - `ledger_get_task`: `id`.
   - `ledger_list_tasks`: `status?` (default `open`), `tags?`, `colors?` (palette ids and/or `'none'`, OR), `store_id?`, `reference?`, `sort?` (default `priority`), `limit?`, `offset?`.
   - `ledger_search_tasks`: `query` (required, space-separated terms, OR, ranked), plus the list filters `tags?`, `store_id?`, `reference?`, `sort?`, `limit?`, `offset?`, and `status` default `open`. It takes no `colors` parameter (agents read `color` from the returned tasks), and search terms do not match colour names.
   - `ledger_update_task`: `id`, `text?`, `reference?` (`null` clears), `tags?` (replaces the set), `color?` (palette id, `''` clears), `completed?`, `completion_source?`, `priority?`.

   Every returned `TaskView` carries `color`. The `.describe()` text of `color` and `colors` lists the 16 ids, built from `TASK_COLOR_IDS` so it cannot drift. An invalid colour returns `isError: true` naming the valid ids.
   - `ledger_delete_task`: `id`.

   Responses are pretty-printed `TaskView` JSON. List and search add `store_errors` when any store was skipped. Errors use `isError: true` with the typed error's message; an unknown `store_id` lists the valid ids. Settings come from `getTaskSettings()`.

9. **Register the tools and their help.**
   - Add `{ id: 'tasks', register: taskTools.register }` to `TOOL_MODULES` in `mcp-server/src/tools/registry.ts`.
   - Add the six rows to the `overview` table and one `# ledger_*_task` entry per tool in `mcp-server/src/tools/help-content.ts`. The entries document parameters, OR search semantics, the `store_id` default, `completion_source`, the colour ids (`''` = no colour on add and update, `'none'` = no colour in the `colors` filter of `ledger_list_tasks`, OR across colours; `ledger_search_tasks` has no colour filter), and that reordering many tasks is a GUI concern (agents set `priority` on single tasks).

10a. **Global style foundations (standalone work package)** (`mcp-server/gui/public/styles.css`). These rules change every view, so they ship as their own work package, with no dependency beyond Step 1, its own changelog line (Step 23) and its own verification, ahead of and apart from the Tasks view.
    - Add `--color-border-strong` (#7d8ba1 light, #64748b dark) to `:root` and `[data-theme="dark"]`. Use it for form-control borders (`input`, `select`, `textarea`, `.form-control`) and secondary-button borders.
    - Add a global `:focus-visible` ring (`outline: 2px solid var(--color-link); outline-offset: 2px`) plus the input variant from the prototype.
    - Make the header nav `flex-wrap: nowrap` with horizontal overflow scrolling below the existing narrow breakpoint.
    - Add a `prefers-reduced-motion` guard for the new animations.
    - Verify the change on the existing views before the Tasks work builds on it: `styles-tokens.test.ts` (token values, focus rule, nav rule) passes, and a walk-through of Projects, Knowledge and Configuration on port 3460 in both themes at 1280 px and 375 px confirms the focus ring, the form borders and the nav, with nothing else shifting. Record any other view regression in the work package notes.

    Bump `styles.css?v=` in `index.html`.

10b. **Task palette tokens and dot classes** (`mcp-server/gui/public/styles.css`). Depends on Step 2 (the token names are the `TASK_COLOR_IDS`). Kept separate from 10a so the global changes stay isolated. It also owns the 16 `.tc-{id}` rules, so the palette pin test (Test Plan) can pass once 10b lands, without waiting for Step 16.
    - Add the 16 task palette tokens `--task-color-{id}` to `:root` with the prototype's `PALETTE` hex values (red `#ef4444`, orange `#f97316`, amber `#f59e0b`, yellow `#facc15`, lime `#84cc16`, green `#16a34a`, teal `#14b8a6`, cyan `#22d3ee`, blue `#3b82f6`, indigo `#4f46e5`, violet `#8b5cf6`, fuchsia `#d946ef`, pink `#f472b6`, brown `#92400e`, slate `#475569`, gray `#a1a1aa`), and repeat the block in `[data-theme="dark"]` with the same values. The dark block is the place a later per-theme re-tune edits; this plan keeps the approved values and the prototype's light inset ring for dark-theme visibility.
    - Add the 16 `.tc-{id}` rules, each setting `--dot: var(--task-color-{id})`, so no hex value appears outside the token blocks and no inline `style` is needed. Step 16 uses these classes and does not redefine them.

    Bump `styles.css?v=` in `index.html`.

11. **Safe Markdown module (new: `mcp-server/gui/public/safe-markdown.js`).** Namespace `SafeMarkdown` with `render(text)` (block) and `renderInline(text)`. It builds a private `new marked.Marked()` instance so the global `marked` used by the dialogue view is untouched. Renderer overrides:
    - `html` tokens output the escaped source text.
    - `link` keeps only `http:`, `https:` and `mailto:` hrefs and adds `target="_blank" rel="noopener noreferrer"`; other schemes render as plain text.
    - `image` renders as a link to the image URL under the same scheme rule, so no remote image loads.

    Without `marked`, it falls back to escaped text with `<br>`. Load it in `index.html` directly after `libs/marked.min.js`.

12. **API client** (`mcp-server/gui/public/api-client.js`). Add `getTasks()`, `createTask(body)`, `updateTask(id, body)`, `deleteTask(id)` and `reorderTasks(assignments)`, each with `@throws {{ code: string, message: string }}` JSDoc (GUI §20) and a `TaskView` typedef. Bump its `?v=`.

13. **GUI REST API (new: `mcp-server/gui/api-tasks.ts`) and routes** (`mcp-server/gui/server.ts`).
    - Handlers:
      - `handleListTasks()` → `{ tasks, stores: [{ id, label, is_default }], settings, store_errors }`.
      - `handleCreateTask(body)` (`TaskCreateBodySchema`: `store_id`, `text`, `reference?`, `tags?`, `color?`). The GUI draft does not send `color` (the prototype has no picker in the draft), but the body accepts it so the REST and tool contracts match.
      - `handleUpdateTask(rawId, body)` (`TaskUpdateBodySchema`, `.strict()`: `text?`, `reference?` nullable, `tags?`, `color?` (`TaskColorInput`), `completed?`).
      - `handleDeleteTask(rawId)`.
      - `handleReorderTasks(body)` (`TaskReorderBodySchema`: `assignments` 1–500 entries of `{ id: uuid, priority: int }`).
    - Validate ids with `parseTaskId()` (UUID) as the first statement (GUI §22). It follows the UUID precedent `parseKnowledgeId` in `mcp-server/gui/api-knowledge.ts`: a malformed id throws `ApiError('VALIDATION_ERROR', 'Invalid task id.')`, which maps to 400. A well-formed id with no task gives 404. Validate every body at the handler for 400 (`2e5304cf`). Map the typed errors: not-found gives 404, invalid store file gives 409 with the file name withheld from the message (GUI §7 information hiding). Reorder partial failure returns 200 with `failed[]`.
    - Add a `buildTaskRoutes()` sub-builder spread before `buildProjectRoutes()` in `buildRoutes()`:
      - `GET /api/tasks`: `noBody`.
      - `POST /api/tasks/order`: literal path, declared before the `:id` routes.
      - `POST /api/tasks`: `statusCode: 201`.
      - `PATCH /api/tasks/(?<id>[^/]+)`.
      - `DELETE /api/tasks/(?<id>[^/]+)`: `noBody`.
    - Every mutation route carries `guards: [requireLoopbackRequest]`, and the body routes add `requireJsonContentType`.

14. **Tasks model (new: `mcp-server/gui/public/views/tasks-model.js`).** Namespace `TasksModel`, pure ES5 functions over plain arrays, no DOM:
    - `visibleTasks(tasks, state)`: status, store, tags (AND), colours (OR over `colorKey`, `'none'` for no colour, empty selection = any), multi-term AND search over the text, `ticket_label` and tags, then the comparator mirroring `compareTasks`. Tasks marked "leaving" stay visible. For the status, store, tag and colour predicates and for all three sorts, its result must equal the server's `matchesFilters` + `compareTasks` on the same input; `tasks-parity.test.ts` enforces this (the multi-term search is the one deliberate difference).
    - `PALETTE`: the ordered `[{ id, name }]` list (16 entries, names as in the prototype: Red … Gray). No hex values; the colour comes from the `--task-color-{id}` token.
    - `colorById(id)` (`null` for `''` and unknown ids) and `colorKey(task)`, mirroring the server rule; both pinned by a test against `TASK_COLOR_IDS`.
    - `toggleColor(selection, key) → selection`: adds or removes one colour key without mutating the input.
    - `paletteMove(index, key, itemCount) → index`: the prototype's grid navigation (8 columns; `←/→` step, `↓/↑` move by 8 and into or out of the footer buttons, `Home/End`), pure so it is testable without layout.
    - `palettePosition(anchorRect, paletteSize, viewport) → { left, top, flipped }`: below the anchor by default, above it when the bottom would cross `viewport.height - 8` and there is room above; clamped horizontally. Pure, so the flip is testable without a layout engine.
    - `pageOf(list, page, pageSize)`.
    - `swapWithNeighbour(list, id, dir) → { assignments, targetIndex } | null`.
    - `reassignSubset(orderedIds, tasksById) → assignments`.
    - `placementOf(list, id, pageSize) → { page } | { hidden: true }`.
    - `normaliseTag(raw)`: must match the server rule; pinned by a test.
    - `allTags(tasks)`, `firstLine(text)`, `restLines(text)`, `refColumnWidth(items)` (clamped 6–16 ch).

15. **Tasks rendering helpers (new: `mcp-server/gui/public/views/tasks-render.js`).** Namespace `TasksRender`, string builders with `escapeHtml` everywhere and the prototype's markup and classes:
    - `filterBar(state, stores, tags)`: includes the "Colour:" label and the colour filter button (`aria-haspopup`, `aria-expanded`, `aria-label` "Colour filter: {names}" or "any"), showing "Any" or one small dot per selected colour.
    - `activeFilters(state)`: tag chips under "All of:" and colour chips under "Colour, any of:", each colour chip with its dot, its name ("No colour" for `'none'`) and a remove button.
    - `toolbar(position)`: create button, live status region, Expand all, Shortcuts `?`.
    - `helpPanel()`: the full key map, including `c`.
    - `colorCell(task, open)`: the prototype's `.task-color` button (`aria-haspopup`, `aria-expanded`, `aria-label` "Colour: {Name}. Change colour" or "Set colour", `title` with "(c)"), with a `.dot` coloured through a `tc-{id}` class only when `colorById` knows the id; otherwise `is-empty`.
    - `palette(mode, selection)`: the 8-column swatch grid (each swatch a button with the colour name as `aria-label` and `aria-pressed`), the name readout, and the footer: "No colour" in `set` mode; "No colour" (toggle, token `'none'`) and "Any" (disabled when nothing is selected) in `filter` mode.
    - `row(task, uiState)`: `[~xQOT.+-]` with handle, completion checkbox, reference cell, colour cell, first-line text via `SafeMarkdown.renderInline`, expand toggle with the notes-only dot, delete button. The collapsible area holds the notes via `SafeMarkdown.render`, then the store badge, created and completed dates, `completion_source`, the short id (first 8 characters, full id in `title`), then tag chips with an autocomplete input.
    - `refCell(task, editing)`: link plus hover/focus pencil when `ticket_url` is set; a click-to-edit button when empty or unlinked; an input when editing.
    - `draft(position, store)`.
    - `storeMenu(stores, position)`.
    - `pagination(p)`: reuses the `pagination-row` / `pagination-btn` classes.
    - `emptyState(hasFilters)`.

16. **Tasks view controller (new: `mcp-server/gui/public/views/tasks.js`) and wiring.** `renderTasks(app)` (GUI §5): `showLoading` → `API.getTasks()` → render. It owns the UI state the prototype held (`activeId`, `expanded`, `editing`, `armed` + timer, `draft`, `leaving`, `paletteMode` (`'set' | 'filter' | null`) + `paletteTaskId`, filter including `colors`, sort, page, page size seeded from `settings.page_size`), with module-level filter, sort and page persistence so leaving and returning to `#/tasks` keeps them. Behaviour reproduces `tasks-prototype.html` exactly:
    - **Roving tabindex:** only the active row and its controls are tabbable.
    - **Keyboard map:**
      - `↑`/`↓` move between rows, crossing pages.
      - `Enter` edits the text, `r` the reference, `t` the tags (expanding the row), `c` opens the colour palette.
      - `Space` toggles completion; `→`/`←` expand and collapse.
      - `Alt+↑`/`Alt+↓` move the task (priority sort only, otherwise an announcement).
      - `n` creates; `/` focuses search; `?` toggles help.
      - `Del` arms delete, a second `Del` deletes; `Esc` cancels an edit or an armed delete.
    - **Inline editing:** `Enter` saves, `Shift+Enter` inserts a line break, `Esc` cancels, blur saves. The text area holds the raw Markdown (first line = task text). The reference input shows server validation errors with `aria-invalid` and keeps focus.
    - **Colour palette (row, `set` mode):**
      - Clicking the dot or pressing `c` on the active row opens one non-modal palette popover anchored to the dot, placed by `palettePosition` (flips above near the viewport bottom) and re-placed on window resize. Focus goes to the pressed swatch, or the first one.
      - Clicking the same dot again closes it; opening the filter palette closes the row palette first.
      - Choosing a swatch or "No colour" sends `API.updateTask(id, { color })`, closes the palette, returns focus to the dot and announces "Colour set to {Name}" or "Colour removed". The colour applies optimistically and reverts with an error announcement when the request fails. A task that leaves the current colour filter follows the 700 ms leave rule.
      - Arrow keys move through `paletteMove`; `Esc` and `Tab` close the palette and return focus to the dot. Every key the palette handles stops propagation, so the document-level row shortcuts never see it.
    - **Colour filter (`filter` mode):**
      - The filter-bar Colour button opens the same palette in toggle mode. Each swatch and "No colour" toggles a key in `filter.colors` via `TasksModel.toggleColor`, resets to page 1, re-renders the list, and keeps the palette open with focus on the toggled control. "Any" clears the selection.
      - The live region announces "N tasks match the colour filter" or "Colour filter cleared".
      - Colour chips remove one colour each and return focus to the Colour button. "Clear filters" also clears `filter.colors`. `Esc`/`Tab` close and return focus to the button.
    - **Outside-click closing (the prototype bug):** a document-level click closes an open palette when the click lands outside it, outside every colour dot and outside the Colour button. Because the palette re-renders its own content on a toggle, the click's target can be detached by the time the event reaches the document. Both guards apply: the palette's click handler calls `stopPropagation()`, and the document handler ignores any target that is no longer inside `document.documentElement` (`contains`). A re-render of the list or a refetch closes a `set`-mode palette whose task is no longer on the page.
    - **Reordering:**
      - Drag & drop starts from the handle only, works within the page, and only in priority sort, where the handle is shown.
      - On drop, `reassignSubset` produces assignments for `API.reorderTasks`.
      - `Alt+↑/↓` uses `swapWithNeighbour`, and the page follows the task.
      - The new order applies optimistically and is reloaded from the server on failure.
    - **Completion:** a task leaving the filter stays struck through for about 700 ms, then disappears, and focus moves to the neighbour.
    - **Create flow:**
      - The top and bottom create buttons open a `role="menu"` store menu; with one store the menu is skipped.
      - The detached draft opens next to the button used. Empty text is refused.
      - After a save the list re-sorts. The status line says "Task added to {store}", "— shown on page N with the current sorting", or "— hidden by the current filters", and focus moves accordingly.
    - **Delete:** the button label becomes "Confirm"; a second click deletes; it reverts after 3 s or when focus leaves the row.
    - **Tags:** clicking a badge adds it to the tag filter. The tag filter input uses a datalist from `allTags`.
    - **Live refresh:**
      - `visibilitychange` (to visible) re-fetches when no edit, draft, armed delete or open palette is active.
      - Document-level `keydown`, `click` and `visibilitychange` handlers and the window `resize` handler (palette placement) are held in module variables, removed before re-adding on each render (GUI §2), and remove themselves when `#tasks-root` is no longer in the DOM. The palette element lives inside `#tasks-root`, so it leaves with the view.
    - **Housekeeping:**
      - `store_errors` render as a warning banner naming the affected stores.
      - Every closure helper carries the §19 closure-dependency JSDoc.

    Wiring:
    - Add `<a href="#/tasks">Tasks</a>` to the nav after Knowledge in `index.html`.
    - Add the `/tasks` named route in `router.js`.
    - Load `views/tasks-model.js`, `views/tasks-render.js` and `views/tasks.js` (each `?v=1`) in `index.html`, in that order, before `app.js`.
    - Move the Tasks styles from the prototype into `styles.css` under a `/* ── Tasks view ── */` section using existing tokens only (§6), including the colour cell (`.task-color`, `.dot`, `is-empty` ring shown only on row hover/focus or while open, dimmed on completed rows), the palette popover (`.palette`, `.palette-grid`, `.swatch` with the `aria-pressed` check mark, `.palette-foot`, `.palette-none`), the Colour filter button and `.chip-dot`. The row grid gains the 18 px colour column after the reference column. The dot colour comes from the 16 `.tc-{id}` rules added in Step 10b. The reference column width comes from the `--task-ref-width` custom property set from `refColumnWidth`, with ellipsis and a `title` for overlong references.

17. **Configuration → Tasks tab (new: `mcp-server/gui/public/views/config-tasks.js`).** Prefix `ct`. It follows GUI §25 point by point:
    - `configDirty.tasks` key.
    - A `CONFIG_TABS` descriptor `{ key: 'tasks', label: 'Tasks', render: ctRenderTab, leave: ctResetState, reset: ctResetState }` (always-reset shape, since it reads the already-loaded `config`).
    - Listener cleanup and a `ctVisit` token on the save callback.

    The form has three fields: ticket base URL (`type="url"`), default queue name (e.g. `QUEUE-`), default entries per page (number, 5–200). Each has a help note, client-side checks mirroring the schema, and save through `API.updateConfig({ tasks_ticket_base_url, tasks_ticket_queue, tasks_page_size })` with the success and error banners of the General tab. Register the script in `index.html` before `config.js` and bump `config.js?v=`.

18. **Task Curator persona (new).**
    - **Meta: `personas/ledger-support/src/meta/ledger-task-curator.yaml`.**
      - Naming: `slug: ledger-task-curator`, `name: "Ledger Task Curator"`, `id: ledger-support-task-curator`, `vs_file_name: ledger-task-curator.agent.md`, `cc_file_name: ledger-task-curator.md`.
      - Description: "Manage the task list through the ledger — add, find, update, reprioritise and complete tasks, and close tasks a finished plan completed."
      - Tools: `tools: [vscode, read, search, central_pm/*]`; `cc_tools: [Read, Grep, Glob, mcp__central_pm]`. No Edit or Write: the persona edits no files.
      - Overview fields: `identity: "Task List Steward"`, `use_when`, `modes`.
      - `changelog: 1.0.0 (2026-11-23): Initial release`.
    - **Content: `personas/ledger-support/src/content/ledger-task-curator.md`.** Sections: Mission, Operating Philosophy, Operating Modes, Inputs, Tool Integration, Constraints, Workflow, Report Template.
      - **Operating Philosophy:**
        - "Evidence Before Closure": a keyword match is a candidate, not a completion.
        - "The User's Order Is Intentional": never reprioritise or recolour unasked. Priority and colour are the user's own organisation of the list.
        - "A Closed Task Explains Itself": always set `completion_source`.
      - **Synthesis Reconciliation mode.**
        - Inputs: `cwd_path` and `project_storage_path`.
        - Read `synthesis.md`, then `plan.md` and `request.md` where present.
        - Derive term sets: ticket references matched in the documents, the plan title, component and feature names.
        - Run at least three `ledger_search_tasks` queries (status `open`), plus `ledger_list_tasks` with `reference` for every ticket reference found.
        - Close a task with `ledger_update_task { completed: true, completion_source: "<plan slug>" }` only when the synthesis states that the task's whole scope shipped.
        - Report partial matches as candidates left open.
        - Never create, delete, recolour or edit text in this mode.
      - **Task Management mode.** Requests from the user or another agent:
        - Add tasks: choose the store explicitly when more than one exists; ask when ambiguous.
        - Find, update and complete tasks, and reprioritise on explicit request.
        - Filter by colour with `colors` when the user names a colour ("my red tasks"), and set or clear a colour on explicit request, using the palette ids the tool descriptions list.
        - Delete only after explicit confirmation of the listed tasks.
      - **Report Template:** terms searched, tasks closed (id, label, first line), candidates left open with the reason, store errors encountered.

19. **Synthesis dispatch** (`personas/ledger/src/content/9-synthesis.md`, `personas/ledger/src/meta/9-synthesis.yaml`).
    - Add a "Task Reconciliation" section after "Knowledge Collection".
    - Insert a new Workflow step 9 "Task Reconciliation" after step 8 (Knowledge Collection) and renumber the following steps (constraint 5a: step count matches sections): Complete Synthesis 9 → 10, AX Feedback 10 → 11, Handoff 11 → 12. Update every in-text step cross-reference the renumbering affects, so that each still points at the step it meant:
      - Workflow step 2: "Steps 3–8 below" becomes "Steps 3–9 below".
      - Workflow step 5: "skip to Step 9 to obtain the handoff block" becomes "skip to Step 12" (the handoff step, not Complete Synthesis).
      - Step 8's two in-body references ("Review it before proceeding to Step 9" and "Continue with Step 9") keep the number 9, which is now Task Reconciliation: the Archiver flow leads into it, and Task Reconciliation in turn ends by pointing at Step 10 (Complete Synthesis). Re-read both sentences after the edit and reword them where "Step 9" is described as Complete Synthesis.
      The new step dispatches `{{agent_ledger_task_curator}}` / `{{agent_slug_ledger_task_curator}}` per target in the same four-branch form as step 8, passing only `cwd_path` and `project_storage_path`. It carries the same "When the dispatch cannot run" fallback: a project comment naming the Task Curator, the reason and both parameters, plus a Next Steps item in `synthesis.md`. The Task Curator's report is reviewed before Complete Synthesis (Step 10).
    - Add `ledger-task-curator` to `subagents`.
    - Add a changelog entry (minor bump).

20. **Coordinator and Standalone Developer dispatch.**
    - `personas/ledger-support/src/content/ledger-claude-coordinator.md`: extend the Archiver follow-up (Mission sentence, Capabilities bullet, the "Archive Dispatch" section, workflow step 10 and the two constraints) so a Synthesis comment saying the Task Curator did not run triggers the same once-per-COMPLETE dispatch of `{{agent_slug_ledger_task_curator}}`. Add the `Tasks` line to the Final Report. In `ledger-claude-coordinator.yaml`, add `ledger-task-curator` to `subagents`. Also add `ledger-knowledge-archiver` if it is still absent: the same section already dispatches it, but on `origin/main` the list does not declare it. Add a changelog entry.
    - `personas/standalone/src/content/developer.md`: add a new step after "Verify the Archival". It dispatches the Task Curator (four-branch form, `cwd_path` + plan folder as `project_storage_path`) and is marked **non-blocking** like the archival step. Renumber the following steps.
    - `personas/standalone/src/meta/developer.yaml`: add `ledger-task-curator` to `subagents` and a changelog entry.

21. **Persona build and generated metadata.**
    - Run `node scripts/build-personas.js`; it regenerates the target outputs and `personas/name-mapping.json`.
    - Then run `node scripts/build-personas.js --check` and `node scripts/generate-agents-overview.js` (regenerates `docs/references/agents-overview.md`).
    - Add the persona row to `personas/ledger-support/README.md`.
    - Walk the Dependency Table rows for `subagents` changes (orchestrator subagent files).

22. **Documentation.** Apply every entry in **Documentation Updates** below, including the two named constraint exceptions in `constraints-storage.md`. CTX generation was removed from this repository, so there is no `.context/` regeneration step.

23. **Changelogs and version preparation.**
    - `mcp-server/changelog.md`: Tools (six task tools, with colour and colour filter), Storage (per-store task file), GUI (Tasks tab with colour dots and colour filter, Configuration → Tasks). The focus ring, border contrast and nav scrolling of Step 10a get their own separate GUI line, since they affect every view.
    - `personas/changelog.md`: Ledger-Support (new Task Curator), Ledger (Synthesis dispatches it), Standalone (Developer dispatches it).
    - Each touched persona's integrated YAML changelog.

    Follow Changelog Rules rule 9: add to the open work-in-progress entry where one exists, otherwise open the next minor version. Run `npm run sync-version` in `mcp-server/` and `node scripts/check-version-sync.js`.

24. **Verification.**
    - `mcp-server/`: `npm run build`, `npx tsc --noEmit`, `npm test`.
    - Workspace root: `npm test` (it also runs the CTX removal guard, `scripts/tests/ctx-removal.test.js`, so no CTX wiring may be reintroduced).
    - `orchestrator/`: `pytest tests/test_subagents.py` and `ruff check src/`.
    - `node scripts/build-personas.js --check`.
    - Start the GUI with `--port 3460` and a scratch `--ledger-dir`, and walk through the prototype's scripted checks (synthesis "Verification Summary" and "Rework: Colour Dots") against the real view in both themes at 1280 px and 375 px.
    - Report any check that could not run.

## Dependencies

- Step 1 precedes everything.
- Steps 2 and 3 precede 4 (`isSafeTicketBaseUrl`), 6 and 7. Step 2 (`TASK_COLOR_IDS`) also precedes 10b (the palette tokens and `.tc-{id}` rules are named after the ids) and 14. The pin test `tasks-palette-pin.test.ts` depends on Steps 2, 10b and 14 and on nothing later: it reads the `.tc-{id}` rules from Step 10b, not Step 16. Step 5 follows 4 and edits the same file.
- Step 6 precedes 7. Step 7 precedes 8 and 13. Step 8 precedes 9.
- Step 10a depends only on Step 1 and is its own work package; it may run at any point after Step 1 and must be verified before Step 16 starts. Step 10b follows Step 2. Steps 10a and 10b both precede 16. Step 11 precedes 15. Step 12 precedes 16 and 17. Step 13 precedes 16 and 17. Steps 14 and 15 precede 16. Step 14's parity test (`tasks-parity.test.ts`) also depends on Step 7 (`matchesFilters`) and Step 2 (`compareTasks`).
- Step 4 precedes 17 (the settings keys).
- Steps 8 and 9 precede 18 (persona text cites the final tool names and parameters). Step 18 precedes 19 and 20 (the template variables must resolve). Steps 19 and 20 precede 21.
- Steps 2–21 precede 22. Step 22 precedes 23. Step 24 is last.
- No acceptance criterion is a before/after diff of generated output, so no snapshot step is needed.

## Required Components

**New files**
- `mcp-server/src/schema/task.ts`
- `mcp-server/src/utils/ticket-reference.ts`
- `mcp-server/src/storage/task-store.ts`
- `mcp-server/src/storage/task-collection.ts`
- `mcp-server/src/tools/tasks.ts`
- `mcp-server/gui/api-tasks.ts`
- `mcp-server/gui/public/safe-markdown.js`
- `mcp-server/gui/public/views/tasks-model.js`
- `mcp-server/gui/public/views/tasks-render.js`
- `mcp-server/gui/public/views/tasks.js`
- `mcp-server/gui/public/views/config-tasks.js`
- `personas/ledger-support/src/meta/ledger-task-curator.yaml`
- `personas/ledger-support/src/content/ledger-task-curator.md`
- Test files listed in the Test Plan.

**Modified files**
- `mcp-server/src/gui/config.ts`
- `mcp-server/src/tools/registry.ts`
- `mcp-server/src/tools/help-content.ts`
- `mcp-server/gui/server.ts`
- `mcp-server/gui/public/{index.html, router.js, api-client.js, styles.css}`
- `mcp-server/gui/public/views/config.js`
- `personas/ledger/src/content/9-synthesis.md`, `personas/ledger/src/meta/9-synthesis.yaml`
- `personas/ledger-support/src/content/ledger-claude-coordinator.md`, `personas/ledger-support/src/meta/ledger-claude-coordinator.yaml`
- `personas/standalone/src/content/developer.md`, `personas/standalone/src/meta/developer.yaml`
- `personas/ledger-support/README.md`
- Documentation and changelogs listed below.

**Generated (by commands, never hand-edited)**
- Persona outputs under `personas/*/{vs-code,claude-code,deep-agents}/`
- `personas/name-mapping.json`
- `docs/references/agents-overview.md`

**Runtime data (created on first write)**
- `{storePath}/.tasks/tasks.json`

## Assumptions

- The run happens on a checkout based on `origin/main` at or after `fca3de44` (Human Actions #1). Every origin/main reference in the research brief was verified with `git show origin/main:<path>`.
- Task volume stays in the hundreds to low thousands per user, so one `GET /api/tasks` payload and client-side filtering stay responsive.
- "Sibling to the knowledge curator" in the request means the knowledge agent that actually runs at synthesis time, which is the Knowledge Archiver (`9-synthesis.md` step 8). The Task Curator is dispatched right after it. If a Knowledge Curator Targeted Reconciliation dispatch is added to Synthesis later, the Task Curator step stays independent of it.
- The task settings are global (one per server), as stated in the request ("Global Task Settings").
- Tags are free-form, but their stored form is the normalised slug (lowercase, hyphenated), as in the prototype.
- The palette is fixed in code, not user-configurable: the request says "fixed palette" and lists no palette setting under Global Task Settings. Changing it is a code change to `TASK_COLOR_IDS`, `TasksModel.PALETTE` and the `styles.css` tokens, kept in step by the pin test.
- "Default entries per page", which `request.md` lists under Global Task Settings, is the `tasks_page_size` setting already in Steps 4 and 17 (default 20, matching the request's Pagination section).
- No orchestrator code change is needed: `load_subagents()` resolves new ledger-support slugs from the YAML `subagents` list.

## Constraints

- AGENTS critical constraints 1, 2, 4, 6 and 7: `atomicWriteJson`, `withLock`, stderr only, `now()`, pretty JSON.
- No write holds more than one store lock; a reorder batch is several single-store writes.
- A task file that cannot be read or validated is never overwritten.
- GUI frontend: ES5, no build step, one namespace per file, `escapeHtml` for every user value, `?v=N` bumps, listener-lifecycle guards, CSP `script-src 'self'`.
- The GUI under development runs on port 3460, never 3420 (GUI §23).
- Persona sources only; generated persona output is rebuilt, never edited.
- No git write operations by agents; the Git Committer or the user commits.

## Out of Scope

- Migrating the dialogue view's `marked` usage to `SafeMarkdown`.
- Refactoring the knowledge domain's multi-store iteration or its corrupt-file policy.
- A task archive (moving completed tasks out of `tasks.json`).
- Due dates, assignees, task-to-project links, and server-side filtered or paginated listing.
- Creating tasks automatically from synthesis "Deferred & Follow-Up Items" (a possible future Task Curator mode).
- Persisting Tasks-view filters in the URL hash or across browser sessions.
- Sorting by colour, and a colour picker in the create draft. Both are prototype follow-ups the request did not adopt; a colour is set after creation.
- Per-theme re-tuned hex values for the dark theme (slate, brown and indigo have low contrast on the dark surface). The `[data-theme="dark"]` token block makes this a CSS-only change later; this plan ships the approved values with the prototype's light inset ring.
- A user-configurable palette.
- Editing `docs/agents/plans/2026-11-23-tasks-ui-prototype/` (archived; its "where did it go" follow-up is implemented here as AC-16 instead).

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Provide a DEV workspace checkout based on `origin/main` (at or after `fca3de44`) and start the run there, or explicitly accept running it in STABLE after updating STABLE's `main` to `origin/main`. | Before the run | The STABLE checkout hosts the live Ledger server and is 21 commits behind `origin/main`. Workspace creation and branch updates are git write operations reserved for the user. |
| 2 | Restart the MCP server (new agent session) and the live GUI so they load the new build, tools and settings. | After the run | The running processes belong to the user's session; agents must not stop the live server. |
| 3 | Decide whether and when to deploy the new and changed personas with `node scripts/sync-personas.js`. | After the run | Deployment overwrites the live agent folders (`live-workspace.md`), which is a user decision. |
| 4 | Commit the changes through the Git Committer, and release the MCP server and personas versions. | After the run | Commits and releases are reserved for the Git Committer and the user. |

## Acceptance Criteria

- AC-01: Each store keeps its tasks in `{storePath}/.tasks/tasks.json` (`{ version: 1, last_updated, tasks[] }`). A missing file reads as empty. A file that fails to parse or validate is never overwritten: reads skip it and report it in `store_errors`, and writes to it fail with an error naming the store.
- AC-02: Tasks have UUID v4 ids, `created_at` from `now()`, `completed_at` set when completed and cleared on reopen (with `completion_source`), and `updated_at` on every update. The store is never persisted, only reported as `store_id` / `store_label`.
- AC-03: A new task gets priority = max over all readable stores + 1. Priority sort orders by priority desc, then created_at desc, then id asc. Date-completed sort places open tasks last.
- AC-04: References normalise to digits or `QUEUE-digits` (uppercased). A reference typed with the default queue is stored as digits. Invalid input is rejected with a clear message. `ticket_label` and `ticket_url` follow the request's three link rules, and a base URL that is not `http(s)` is rejected by the settings schema and never linked.
- AC-05: Tags are normalised (lowercase, whitespace → hyphen, comma-free, deduplicated, ≤32 characters, ≤20 per task) by the same rule on the server and in `TasksModel.normaliseTag`.
- AC-06: Configuration → Tasks edits the ticket base URL, default queue and default entries per page. Values persist in `gui-config.json`, invalid values show an error banner, and the tab follows GUI §25 (descriptor, dirty key, cleanup, visit token).
- AC-07: `ledger_add_task`, `ledger_get_task`, `ledger_list_tasks`, `ledger_search_tasks`, `ledger_update_task` and `ledger_delete_task` exist with described parameters. Search is multi-term OR, ranked by match count, over the text, reference label and tags. `store_id` defaults to the default store, and an unknown id lists the valid ones.
- AC-08: The task tools are registered through `TOOL_MODULES`, each has a `TOOL_HELP` entry and an overview row, and `tool-registry.test.ts` passes.
- AC-09: `GET/POST /api/tasks`, `PATCH/DELETE /api/tasks/:id` and `POST /api/tasks/order` exist. Creation returns 201, invalid input (including a malformed task id) 400, unknown task or store 404, invalid store file 409. Every mutation route rejects non-loopback requests (403) and the body routes reject non-JSON bodies (415).
- AC-10: A reorder batch spanning stores writes each store under its own lock, one store at a time, never holding two store locks. A store that fails is reported in `failed[]` while the others are applied.
- AC-11: A "Tasks" nav link and `#/tasks` route render the list in the prototype's `[~xQOT.+-]` row layout, with the colour dot between the reference and the text. The collapsible area holds the notes, store badge, created and completed dates, `completion_source`, short id and tags. The expand toggle is always visible, and its dot marks only tasks with notes.
- AC-12: The filter bar offers multi-term AND search (text, reference label, tags), an AND tag filter, an OR colour filter (AC-30), status (default Open), store, and sort (Priority, Date created, Date completed). The list paginates with the configured default page size and a page-size selector.
- AC-13: The move handle appears only in priority sort. Drag & drop by the handle reorders within the page by reassigning the subset's priorities. `Alt+↑/↓` swaps with the filtered neighbour and crosses page boundaries. The order persists via `POST /api/tasks/order`.
- AC-14: Clicking the task text opens a raw Markdown text area (first line = text, rest = notes). `Enter` saves, `Shift+Enter` inserts a line break, `Esc` cancels and blur saves. A linked reference opens the ticket in a new tab, and a hover/focus edit button or `r` edits it. An empty or unlinked reference is edited by clicking it, and an invalid reference shows the server's message without saving.
- AC-15: The full keyboard map works as specified (`↑/↓`, `Enter`, `r`, `Space`, `→/←`, `Alt+↑/↓`, `t`, `c`, `n`, `/`, `Del`, `Esc`, `?` for the help panel) with a roving tabindex.
- AC-16: The create flow works from the top and bottom buttons. The store menu is skipped when one store exists, and the detached draft opens next to the button used. Empty text is refused. After saving, the status line reports "shown on page N" or "hidden by the current filters" as applicable.
- AC-17: The delete button changes to "Confirm" on the first activation, deletes on the second, and reverts after about 3 s or when focus leaves the row. `Del` arms and confirms, and `Esc` disarms.
- AC-18: Tags are edited as chips in the expanded area with autocomplete from existing tags (`t` focuses the editor). Clicking a tag badge adds it to the tag filter.
- AC-19: `Space` toggles completion. A task leaving the current filter stays struck through for about 700 ms before disappearing, focus moves to the neighbouring row, and `prefers-reduced-motion` disables the animation.
- AC-20: `styles.css` defines `--color-border-strong` in both themes (≥3:1 against the surface) and a global `:focus-visible` ring. Form controls use the strong border. The reference column fits the longest label on the page within 6–16 ch with ellipsis. The header nav does not wrap at 375 px.
- AC-21: Task Markdown renders through `SafeMarkdown`: raw HTML is shown as text, only `http(s)` and `mailto` links render (with `target="_blank" rel="noopener noreferrer"`), images never load, and code spans are not double-escaped.
- AC-22: The Tasks view re-fetches when the page becomes visible, unless an edit, draft or armed delete is active. Document-level listeners do not accumulate across re-renders or route changes.
- AC-23: The Ledger Task Curator persona exists with Synthesis Reconciliation and Task Management modes. It is built for all three targets, listed in `personas/name-mapping.json`, `personas/ledger-support/README.md` and `docs/references/agents-overview.md`, and its sources reference only the six task tools by their final names.
- AC-24: Synthesis dispatches the Task Curator after the Knowledge Archiver with the same parameters and the same "dispatch cannot run" fallback. `9-synthesis.yaml` lists `ledger-task-curator` in `subagents`, and `load_subagents('synthesis', …)` resolves it.
- AC-25: The Claude Coordinator re-runs the Task Curator when Synthesis reports it did not run, and the Standalone Developer dispatches it non-blocking after archival.
- AC-26: Every documentation artefact in Documentation Updates is updated. `constraints-storage.md` names both exceptions (reorder batches, `store_id` on task tools), and `cross-system-dependencies.md` carries the task rows and the corrected "Insight mutation ownership" row.
- AC-27: `npm run build`, `npx tsc --noEmit` and `npm test` (mcp-server), the root `npm test`, `build-personas.js --check`, `pytest tests/test_subagents.py` and `ruff check src/` (orchestrator) all pass; and the GUI walk-through on port 3460 completes.
- AC-28: A task stores its colour as one of the 16 palette ids (`red, orange, amber, yellow, lime, green, teal, cyan, blue, indigo, violet, fuchsia, pink, brown, slate, gray`) or `''`, never a hex value. `ledger_add_task`, `ledger_update_task`, `POST /api/tasks` and `PATCH /api/tasks/:id` accept `color` and reject any other value (including `null` and hex strings) with a message listing the valid ids. Every `TaskView` returns `color`. A stored unknown id does not invalidate the file, is returned unchanged, displays as no colour and matches the "No colour" filter.
- AC-29: The row colour dot opens a non-modal palette popover (16 swatches plus "No colour") on click or `c`. Arrow keys navigate the 8-column grid and the footer, `Esc`/`Tab` close it and return focus to the dot, and it flips above the dot near the bottom of the viewport. Choosing a colour persists it and announces the change. A task without a colour shows an empty ring only on row hover/focus. Every dot and swatch has an accessible colour name.
- AC-30: The Colour filter opens the same palette in toggle mode, which stays open while colours are toggled. Several colours plus "No colour" combine as OR, "Any" clears the selection, selected colours show on the button and as removable chips, and "Clear filters" resets them. `ledger_list_tasks` accepts `colors` with the same OR semantics and `'none'` token; `ledger_search_tasks` has no colour parameter.
- AC-31: Toggling inside the filter palette never closes it: the palette's click handler stops propagation, and the document-level outside-click closer ignores targets that are no longer in the document. Clicking outside the palette, the dots and the Colour button still closes it.
- AC-32: The palette ids are identical, in order, in `TASK_COLOR_IDS`, `TasksModel.PALETTE` and the `--task-color-{id}` tokens of both theme blocks in `styles.css`, and `colorKey` gives the same result on the server and in `TasksModel`; a pin test enforces both.
- AC-33: The server's `matchesFilters` + `compareTasks` and the client's `TasksModel.visibleTasks` produce identical task orders and selections on one shared fixture, for every sort and for the status, store, tag and colour filters, including ties on priority and `created_at`; a parity test enforces it.
- AC-34: The global style changes (Step 10a) are delivered as their own work package with their own changelog line. The existing Projects, Knowledge and Configuration views are checked in both themes at 1280 px and 375 px after it lands and before the Tasks view is built on it.

## Testing Strategy

The storage, reference and model layers are pure, or I/O against a temporary directory, and carry most of the behaviour. Each is unit-tested exhaustively. Tool and REST handlers are tested against temporary single-store and multi-store fixtures (`tests/helpers/create-temp-store.ts`, never the live ledger). The guard and status-code contract is tested through the server dispatcher. Frontend modules run under jsdom with `vm.runInThisContext`, following `tests/gui/project-list.test.ts`, with browser globals stubbed on Node's `global` (`0eff2a76`) and timers tracked in a `Map` (`bed501c2`). The model and markup builders are tested directly; the controller is tested through keyboard and click events on a rendered list. Persona changes are verified by the build's own validation (`agent-slug-validation`, `--check`), the name-mapping and overview tests, and the orchestrator's sub-agent test. A manual walk-through on port 3460 repeats the prototype's scripted checks.

## Test Plan

- `mcp-server/tests/schema/task.test.ts` — `TaskSchema`/`TaskFileSchema` accept legacy-shaped records and reject bad ids. `normaliseTag` cases. `TaskTextInput` rejects empty or whitespace-only text and an empty first line. `compareTasks` for all three sorts, including open-last and tie-breakers. `TASK_COLOR_IDS` has 16 unique ids in the specified order. `TaskColorInput` accepts every id and `''`, rejects `null`, `'#ef4444'`, `'Red'` and unknown ids with a message listing the ids. `TaskColorFilterInput` accepts ids and `'none'`, rejects unknown values. `TaskSchema` accepts a record with no `color` and one with an unknown `color`. `colorKey` for an id, `''`, missing and unknown — AC-02, AC-03, AC-05, AC-28, AC-30
- `mcp-server/tests/utils/ticket-reference.test.ts` — Numeric, `abc-12` → `ABC-12`, default-queue shortening (case-insensitive), invalid input, empty → null. Label and URL with and without queue and base URL. `javascript:` and `ftp:` base URLs are unsafe — AC-04
- `mcp-server/tests/gui/config.test.ts` (extend) — New keys default correctly when absent from an existing file. Invalid base URL, queue and page size are rejected by `GuiConfigPartialSchema`. `DEFAULT_CONFIG` deep-equals `GuiConfigSchema.parse({})`. `getTaskSettings()` mapping — AC-04, AC-06
- `mcp-server/tests/storage/task-store.test.ts` — Missing file → empty. Unparsable or schema-invalid file → `invalid`, `mutateTaskFile` throws `TaskFileInvalidError` and the file bytes are unchanged. Successful mutation writes pretty JSON with `last_updated`. The lock directory is `.tasks/`. Concurrent `mutateTaskFile` calls serialise — AC-01
- `mcp-server/tests/storage/task-collection.test.ts` — Multi-store fixture:
  - Tagging with `store_id`/`store_label`, `store_errors` for a corrupt store while the others list.
  - Max + 1 across stores; create in an unknown store → typed error with valid ids.
  - Completion set and clear semantics; reference re-normalisation on update.
  - OR-ranked search; AND tag filter; reference filter.
  - Colour: create defaults to `''`; update sets and clears it; `matchesFilters` and `listTasks` with `colors: ['red', 'none']` return red, uncoloured and unknown-colour tasks and nothing else; a task with an unknown stored id is listed with that id unchanged; `searchTasks` ignores no colour input because its filter type has none.
  - Reorder across two stores applies both, with each store written in its own `mutateTaskFile` call (spy proves no nested lock).
  - Reorder with one corrupt store reports `failed[]` and applies the other.
  - Duplicate id across stores resolves first-store-wins.
  - Legacy (uninitialised store context) path.

  Covers AC-01, AC-02, AC-03, AC-07, AC-10, AC-28, AC-30
- `mcp-server/tests/tools/tasks.test.ts` — Each of the six tools through `_internal` handlers. Required-parameter validation. `store_id` default and unknown-store message. `status` default `open` for list and search. `completion_source` round-trip: stored on completion, `null` when absent, cleared on reopen, rejected on a task that stays open; `priority` replaces the stored value. `color` on add and update (set, clear with `''`, invalid value → `isError` naming the ids) and on every returned task. `colors` filter on list (OR, `'none'`); the `ledger_search_tasks` input schema has no `colors` key. The `color`/`colors` parameter descriptions contain all 16 ids. `isError` responses. String-encoded `limit`/`offset` — AC-07, AC-28, AC-30
- `mcp-server/tests/tools/tasks-help.test.ts` — Every task tool has a non-empty `TOOL_HELP` entry headed by its name, and the overview table lists all six — AC-08
- `mcp-server/tests/tools/tool-registry.test.ts` (existing, must pass unchanged) — `tasks.ts` is found and registered — AC-08
- `mcp-server/tests/gui/api-tasks.test.ts` — Handler validation:
  - Strict bodies reject unknown keys; non-UUID id → 400 (`VALIDATION_ERROR`); well-formed unknown id → 404; unknown store → 404; corrupt store write → 409 without a path in the message.
  - Reorder bounds (0 and 501 entries rejected); partial failure shape.
  - List payload carries `stores`, `settings`, `store_errors`, and each task carries `color`.
  - `PATCH` with `{ color: 'violet' }` and `{ color: '' }` succeeds; `{ color: null }` and `{ color: '#8b5cf6' }` → 400. `POST` with a valid `color` stores it.

  Covers AC-09, AC-10, AC-28
- `mcp-server/tests/gui/server-task-routes.test.ts` — Through the dispatcher:
  - `POST /api/tasks` → 201; `POST /api/tasks/order` is not shadowed by `:id`.
  - Non-loopback socket or `Origin` → 403 on every mutation route; non-JSON content type → 415 on body routes.
  - GET unguarded.

  Covers AC-09
- `mcp-server/tests/gui/route-table.test.ts` (existing, must pass) — New routes use named groups and valid methods with no duplicates — AC-09
- `mcp-server/tests/gui/safe-markdown.test.ts` — `<script>` and `<img onerror>` render as text. `[x](javascript:alert(1))` renders no anchor. `https` links carry `target`/`rel`. `![a](https://x/y.png)` produces no `<img>`. `` `a<b` `` renders `a&lt;b` once. Fallback without `marked`. The global `marked` defaults are unchanged after loading — AC-21
- `mcp-server/tests/gui/tasks-model.test.ts` —
  - `visibleTasks` for every filter and sort, the AND multi-term search, and leaving tasks staying visible.
  - `swapWithNeighbour` at page edges and under filters; `reassignSubset` keeps the multiset of priorities.
  - `placementOf` page and hidden results; `refColumnWidth` clamping.
  - `normaliseTag` matches the server rule on a shared fixture list (pin).
  - Colour filter in `visibleTasks`: empty selection = all; one colour; two colours (OR); `'none'` matching `''`, missing and unknown ids. `toggleColor` adds and removes without mutating the input.
  - `paletteMove` for every key at grid corners, the row boundary (index 7 → 8) and the footer buttons in both modes (one and two footer buttons, "Any" disabled).
  - `palettePosition` below the anchor by default, flipped above near the viewport bottom, not flipped when there is no room above, clamped at the right edge at 375 px.

  Covers AC-03, AC-05, AC-12, AC-13, AC-16, AC-20, AC-29, AC-30
- `mcp-server/tests/gui/tasks-palette-pin.test.ts` (new) — Loads `TasksModel` under `vm` and imports `TASK_COLOR_IDS` and `colorKey` from `src/schema/task.ts`: the `PALETTE` ids equal `TASK_COLOR_IDS` in order; every id has a `--task-color-{id}` declaration in both the `:root` and the `[data-theme="dark"]` blocks of `styles.css` and a `.tc-{id}` rule; `TasksModel.colorKey` equals the server `colorKey` on a shared fixture list — AC-32
- `mcp-server/tests/gui/tasks-parity.test.ts` (new) — Loads `TasksModel` under `vm` and imports `matchesFilters` and `compareTasks` from `src/storage/task-collection.ts` and `src/schema/task.ts`. On one shared fixture (mixed open and completed tasks, several stores, tags, coloured, uncoloured and unknown-colour tasks, deliberate ties on priority and on `created_at`), for each of the three sorts and for status, store, tag (AND) and colour (OR, `'none'`) filters alone and combined, `TasksModel.visibleTasks` (with an empty search) returns the same ids in the same order as `matchesFilters` + `compareTasks`. A comment in the test records that multi-term search differs on purpose — AC-33
- `mcp-server/tests/gui/tasks-render.test.ts` —
  - Row markup order `[~xQOT.+-]` and the handle hidden for date sorts.
  - Colour cell: coloured (`tc-{id}` class, "Colour: Violet. Change colour"), empty (`is-empty`, "Set colour"), and unknown id rendered as empty; no inline `style` and no hex value in the markup.
  - Palette in `set` mode (16 swatches with names and `aria-pressed`, "No colour") and `filter` mode ("No colour" toggle, "Any" disabled when the selection is empty). Colour filter button ("Any" or dots, `aria-label`), colour chips under "Colour, any of:".
  - Reference cell in its three modes (linked + pencil, empty button, unlinked button) and the edit input.
  - Notes rendered via `SafeMarkdown`; expand dot only with notes.
  - Metadata short id with full id in `title`; escaped user values.
  - Store menu `role="menu"`; pagination classes.

  Covers AC-11, AC-13, AC-14, AC-21, AC-29, AC-30
- `mcp-server/tests/gui/tasks-view.test.ts` — jsdom with stubbed `API`, timers in a `Map`:
  - Initial render and roving tabindex.
  - The full keyboard map, including `?` help and `/` search focus.
  - `Enter`/`Shift+Enter`/`Esc`/blur editing.
  - Reference edit with a server 400 keeping focus and `aria-invalid`.
  - `Alt+↓` across a page boundary calling `reorderTasks` with the swap assignments.
  - Drop event reassigning subset priorities.
  - Completion leave delay and focus hand-off.
  - Delete arm, 3 s revert, focus-leave disarm, confirm.
  - Create flow from top (keyboard store menu) and bottom (mouse), single-store skip, empty-text refusal, "shown on page N" and "hidden by the current filters" messages.
  - Tag chip add and remove, and badge click adding a tag filter.
  - `store_errors` banner.
  - `visibilitychange` refetch skipped while editing.
  - Re-rendering twice leaves one document `keydown` listener and one window `resize` listener.
  - Row palette: opening by dot click and by `c`; arrow navigation; choosing a colour calls `updateTask` with `{ color }`, closes, returns focus to the dot and announces; "No colour" sends `''`; a failed request reverts the dot; `Esc` and `Tab` return focus to the dot; `c` and arrow keys inside the palette do not reach the row shortcuts; a second click on the same dot closes it.
  - Colour filter: selecting two colours and "No colour" filters with OR and keeps the palette open with focus on the toggled swatch; "Any" clears; chip removal returns focus to the Colour button; "Clear filters" clears colours; opening the filter palette closes an open row palette.
  - Detached-target regression: a toggle inside the filter palette (which re-renders the palette) leaves it open; a synthetic click dispatched on the document with a detached element as target does not close it; a click on an unrelated row closes it.
  - `visibilitychange` refetch skipped while a palette is open.

  Covers AC-12 to AC-19, AC-22, AC-29, AC-30, AC-31
- `mcp-server/tests/gui/config-tasks-view.test.ts` — Descriptor registered in `CONFIG_TABS`; dirty tracking; client validation messages; save calls `updateConfig` with the three keys; a stale `ctVisit` callback writes nothing after leaving the tab — AC-06
- `mcp-server/tests/gui/api-client.test.ts` (extend) — The five task methods call the right method and path and reject with `{ code, message }` on error — AC-09
- `mcp-server/tests/gui/styles-tokens.test.ts` (new) — Two describe blocks, matching the two steps. Step 10a: `styles.css` declares `--color-border-strong` in `:root` and `[data-theme="dark"]` with the specified values, contains a global `:focus-visible` rule, and the nav no-wrap rule exists inside the narrow breakpoint; this block passes with the 10a work package alone. Step 10b: the 16 `--task-color-{id}` tokens carry the specified hex values in `:root`, and each id has a `.tc-{id}` rule setting `--dot: var(--task-color-{id})`. The prototype's measured contrast values are recorded in the test as documentation — AC-20, AC-32, AC-34
- `scripts/tests/agent-slug-validation.test.js`, `scripts/tests/name-mapping.test.js`, `scripts/tests/generate-agents-overview.test.js` (existing, must pass after the build) — `{{agent_slug_ledger_task_curator}}` resolves; the new persona appears in the mapping and overview — AC-23, AC-24, AC-25
- `orchestrator/tests/test_subagents.py` (extend) — `load_subagents('synthesis', workspace_root)` returns both `ledger-knowledge-archiver` and `ledger-task-curator` with non-empty description and system prompt — AC-24
- Documentation check (Step 22 / Step 24) — every Documentation Updates entry is present, a grep of the persona sources for `ledger_[a-z_]*task` finds only the six registered tool names — AC-23, AC-26, AC-27
- Manual cross-view check on port 3460 (Step 10a) — Projects, Knowledge and Configuration in both themes at 1280 px and 375 px after the global style package: visible focus ring, strong form-control borders, nav does not wrap, no other layout shift — AC-20, AC-34
- Manual GUI walk-through on port 3460 (Step 24) — the prototype's scripted checks, including the "Rework: Colour Dots" checks (dot names, hover-only empty ring, palette by `c`/click/Enter, flip near the viewport bottom, fit at 375 px, filter with several colours, "No colour", chips, "Any", Clear filters, switching between row and filter palette), repeated against the live view in both themes at 1280 px and 375 px — AC-11 to AC-22, AC-27, AC-29 to AC-31

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — The six task tools (parameters, defaults, response shape, `color` and `colors`). `TASK_COLOR_IDS`, `TaskColorInput` and `colorKey`. `task-store.ts` and `task-collection.ts` functions and typed errors. `ticket-reference.ts`. `getTaskSettings()`.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — New schema, utils, storage and tools files, and the `{storePath}/.tasks/tasks.json` layout.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Task create, update and reorder flow (tool and GUI paths through `task-collection.ts`); the Synthesis → Task Curator flow.
- `mcp-server/docs/agents/project-manifest/constraints-storage.md` — New "Task Store Constraints" section:
  - Dot-directory and lock scope; corrupt files never overwritten.
  - Store derived from location; UUID ids; max + 1 priority with the tie-breaker.
  - Colour stored as a palette id or `''`, never a hex value; unknown stored ids are tolerated on read and treated as no colour.
  - Exception entries under *Multi-Store Collation Is Read-Only* (reorder batches) and *Multi-Store Routing Requires No New Tool Parameters* (`store_id` on task tools).
- `mcp-server/docs/agents/project-manifest/constraints.md` — Add the three `tasks_*` keys to the `gui-config.json` rule that lists the runtime-adjustable settings, and note that `DEFAULT_CONFIG` is now derived from the schema.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — Task routes table, `api-tasks.ts` handlers and schemas, the five `api-client.js` methods, `renderTasks`, `TasksModel` (including `PALETTE`, `colorById`, `colorKey`, `toggleColor`, `paletteMove`, `palettePosition`), `TasksRender` (including `colorCell` and `palette`), `SafeMarkdown`, the `config-tasks.js` functions.
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` —
  - §21 table row for `gui/api-tasks.ts`.
  - §25 table row for the `tasks` tab.
  - §7 note that task mutation routes carry the loopback and JSON guards.
  - A new rule: user Markdown is rendered only through `SafeMarkdown`.
  - A new rule: a popover that re-renders its own content stops click propagation, and document-level outside-click closers ignore targets no longer in the document (the palette detached-target bug).
  - A new rule: task colours are rendered only through the `--task-color-{id}` tokens and `.tc-{id}` classes, never from a hex value in JS or markup.
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — `#/tasks` route, the load-all and client-model flow, reorder flow, colour set flow (palette → `PATCH` → optimistic update or revert), Configuration → Tasks save flow.
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — New frontend and backend files.
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` (additional entry) — Note that `TasksModel` filter and sort logic must stay equal to the server's `matchesFilters` / `compareTasks`, enforced by `tasks-parity.test.ts`.
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — Task row anatomy (`[~xQOT.+-]`), reference cell modes, colour dot and palette popover (both modes, keyboard map, flip rule), colour filter button and chips, the `--task-color-{id}` tokens, store menu, delete arm, focus ring and `--color-border-strong` tokens.
- `mcp-server/README.md` — Feature bullet for tasks (GUI tab + MCP tools).
- `docs/agents/project-manifest/cross-system-dependencies.md` —
  - New rows: "Task store (`.tasks/tasks.json`)" (writers and readers); "Task Reconciliation (Synthesis persona)" (`9-synthesis.md`/`.yaml` `subagents`, Coordinator fallback, Standalone Developer, `src/tools/tasks.ts`); "Ticket reference rules" (`ticket-reference.ts` ↔ `TasksModel.normaliseTag` pin test, settings keys); "Task filter and sort rules" (`matchesFilters` / `compareTasks` ↔ `TasksModel.visibleTasks` and comparator; `tasks-parity.test.ts`); "Task colour palette" (`TASK_COLOR_IDS` in `src/schema/task.ts` ↔ `TasksModel.PALETTE` ↔ `--task-color-{id}` tokens and `.tc-{id}` rules in `styles.css` ↔ the tool parameter descriptions; `tasks-palette-pin.test.ts`).
  - Correct the "Insight mutation ownership" row to describe the dispatch that exists.
- `docs/agents/project-manifest/live-workspace.md` — "Ledger storage" row: each store also holds `.tasks/tasks.json`, which the server reads and writes.
- `personas/docs/agents/project-manifest/data-flows.md` and `personas/docs/agents/project-manifest/constraints.md` — Add the Task Curator (per the personas Manifest Maintenance Rules for an added persona).
- `personas/ledger-support/README.md` — Persona table row.
- `docs/references/workflow-and-ledger.md` — "Task Store" subsection beside "Knowledge Store"; Task Curator in the synthesis flow and in the support-agent table.
- `docs/references/multi-store-guide.md` — Tasks are stored per store and merged in the GUI; choose the store at creation.
- `docs/references/agents-overview.md` — Regenerated by `node scripts/generate-agents-overview.js` (never hand-edited).
- `mcp-server/changelog.md`, `personas/changelog.md`, and the integrated changelogs in `ledger-task-curator.yaml`, `9-synthesis.yaml`, `ledger-claude-coordinator.yaml` and `developer.yaml` (Step 23).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **The run starts from the stale STABLE `main` and misses `registry.ts`, `CONFIG_TABS` and route guards.** | Human Actions #1 is a prerequisite, and Step 1 stops the run when any of the four seams is absent. |
| **Editing `mcp-server/src/` in the live workspace affects the running server's next start.** | Run in a DEV workspace (Human Actions #1). A type error leaves the previous `dist/` intact. The GUI under test runs on 3460 against a scratch `--ledger-dir`. |
| **A Git merge conflict leaves a store's `tasks.json` unparsable.** | The store is skipped and reported (AC-01); writes refuse to overwrite it. The banner names the store so the user can resolve the conflict. |
| **A cross-store reorder partially applies.** | Each store's write is atomic, and the deterministic tie-breaker keeps the list stable. `failed[]` triggers a client reload, so the view always shows the persisted order. |
| **Concurrent creates in two stores compute the same max + 1.** | The tie-breaker orders equal priorities deterministically. The next manual move separates them. |
| **The Task Curator closes a task on a superficial keyword match.** | The persona's evidence threshold, partial matches reported as candidates, and `completion_source` on every closure. A wrongly closed task is visible and reopened with one `Space`. |
| **Load-all listing becomes slow at large volumes.** | Out of scope by assumption. The single `GET /api/tasks` handler and `TasksModel` boundary leave room to add server-side filtering later without changing the view's model API. |
| **Global CSS changes (focus ring, form borders, nav) alter other views.** | Intended accessibility fixes, isolated in the standalone Step 10a work package with its own changelog line and a cross-view check on Projects, Knowledge and Configuration in both themes before the Tasks view is built (AC-34). Step 24 repeats the pass. A regression is reverted by reverting that one package. |
| **The server and client filter and sort implementations drift, breaking the reorder tie-breaker.** | `tasks-parity.test.ts` (AC-33) runs both over one fixture with deliberate ties, for every sort and filter. The deliberate search-semantics difference is documented in the test and in the Rationale. |
| **The persona dispatch step count drifts from its sections (constraint 5a).** | Steps 19 and 20 add a section and a numbered step together; the build's validation and the Documentation stage check parity. |
| **The palette ids drift between the server, `TasksModel` and `styles.css`.** | `tasks-palette-pin.test.ts` (AC-32) fails on any difference; the tool descriptions are built from `TASK_COLOR_IDS`. The cross-system Dependency Table carries the sync row. |
| **The filter palette closes itself on a toggle (the prototype's detached-target bug), or document listeners close it unexpectedly.** | Two independent guards (stopPropagation in the palette, `contains` check in the closer) and a dedicated regression test (AC-31). |
| **A colour that is hard to see in the dark theme (slate, brown, indigo) carries meaning the user cannot see.** | Every dot and swatch has an accessible name, the prototype's light inset ring ships, and the dark token block allows a CSS-only re-tune later (Out of Scope). |
| **Template variable `{{agent_slug_ledger_task_curator}}` is unresolved at build.** | Step 18 precedes 19 and 20; `agent-slug-validation` fails the build otherwise. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The work spans storage, MCP tools, the GUI backend, a large keyboard-driven frontend view, a new persona with dispatch changes in three others, and cross-module documentation, so it benefits from decomposed work packages with formal QA, security review of the new mutation routes and Markdown rendering, and code review.
