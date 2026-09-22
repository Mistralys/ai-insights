# Plan

## Plan Audit Cycles
- Audits: none — this is a draft handoff plan, not yet run through the Plan Auditor or Plan Architect Reviewer.
- Architectural Reviews: none.

## Status

**Blocked.** This plan cannot start implementation until `docs/agents/plans/2026-09-16-ledger-project-declaration/plan.md` ships, specifically its step 8 (`resolveRepositoryIdentity`), step 9 (the `mirror` field on `ledger_get_repository_context`'s response) and AC-20. Everything below assumes that plan's `RepositoryContextResponse.mirror` shape exists. Hand this to the Planner for a full pass (research brief, audit, architectural review) once that dependency lands — this draft is a scoping head start, not a finished plan.

## Prior Project Context

Raised during review of the ledger-project-declaration plan (2026-09-16): that plan explicitly lists a dashboard "declared via `.ledger/`" indicator as **Out of Scope** and as **Deferred Item #3**, reasoning "natural follow-up once `mirror` data exists in the tool response." This document is that follow-up, drafted ahead of time so it is ready the moment the dependency clears.

The framing that shaped this draft: the indicator is a **project**-level fact, not a **repository**-level one. `.repositories.json` (`mcp-server/src/schema/repository-registry.ts`) stores `folder_names`, never filesystem paths — a repository can be checked out many times, in many states, so the registry structurally cannot answer "does the on-disk checkout have a `.ledger/` folder." The only place the server ever sees a real filesystem path is a `cwd_path` argument at tool-call time (`ledger_get_repository_context`), and that call happens in the context of a specific ledger project (plan folder), not the repository as an abstract entity. So the fact this plan surfaces is necessarily captured and displayed per-project, cached from the last time an agent working in that project reported a `.ledger/` declaration — not computed live from the registry.

## Summary

When an agent runs `ledger_get_repository_context` from inside a project whose repository has a `.ledger/` declaration with an enabled output, the response carries a `mirror` field (path, `generated_at`, `vision_hash`, `stale`). This plan caches that fact onto the project's `.meta.json` enrichment cache the next time the tool is called for that project, and surfaces it in the GUI as a small "Ledger-declared" indicator on the project detail page and an optional column/badge in the project list — giving a developer a quick visual answer to "was this project ledger-enabled?" without needing repository-registry knowledge the server doesn't have.

## Architectural Context

**Enrichment cache today.** `mcp-server/src/schema/project-meta.ts` → `ProjectMetaSchema` already carries a family of optional, nullable "enrichment cache" fields written incrementally as facts become known — `duration_ms`, `project_name`, `repository_name`, `outcome_summary`, `project_summary`, `runner`/`runner_client`/`runner_version`. This is the established home for exactly this kind of "populate when observed, tolerate absence otherwise" fact.

**Mirror field shape (upstream, not yet built).** Per the ledger-project-declaration plan step 9: `RepositoryContextResponse.mirror?: { path: string; generated_at: string; vision_hash: string; stale: boolean }`, populated only when `cwd_path` resolves to a declared project with the vision output enabled; omitted otherwise.

**GUI rendering precedent.** `mcp-server/gui/public/views/project-detail.js` renders `meta.runner`/`meta.runner_client`/`meta.runner_version` as a small inline fact near the status badge (`statusBadge(meta.status)`, around L691–L708), and a `.plan-synopsis` block driven by `project.project_summary` (L726–L733). Both are good precedent for a low-key, secondary-fact rendering style — this is not a headline feature, it's a small trust-building detail.

**Project list precedent.** `mcp-server/gui/public/views/project-list.js` already resolves a repository label lookup (`repoFolderMap`, folder_name → `{ label, id }`) once per load and renders it into the table (`buildTable`). A ledger-declared badge would follow the same "resolve once, render per row" shape rather than a per-row API call.

## Approach / Architecture

Three layers:

1. **Cache write** — extend `ProjectMetaSchema` with an optional, nullable `ledger_declared` field (or similarly named), populated at the same call site that already handles the `mirror` response (wherever the MCP server records tool outcomes against a project's `.meta.json` — needs research once the upstream plan lands; likely near `writeProjectMeta()` enrichment calls used for `project_summary`/`title`).
2. **API surface** — `handleListProjects` / `handleGetProject` in `mcp-server/gui/api.ts` already return `.meta.json` contents; confirm the new field passes through without a dedicated handler change (it should, following the `runner`/`project_summary` precedent).
3. **GUI rendering** — a small badge/label on `project-detail.js` near the existing status/runner facts, and an optional column or icon in `project-list.js`'s table, both gated on the field being present (omitted projects render nothing extra — no "not declared" noise for the common case).

## Rationale

**Why cache on `.meta.json` instead of querying live.** The GUI server has no filesystem access to a user's working tree and no way to ask "does this project have `.ledger/` right now" on demand — the only signal is what an agent already reported via `mirror` during a real tool call. Caching mirrors the existing `project_summary`/`runner` pattern exactly: best-effort, populated when observed, silent when not.

**Why the fact can go stale and that is acceptable.** A cached "was declared as of the last known tool call" is weaker than a live check, but it is the only data the server can ever have, and it is far better than no information — the plan is explicitly framed by the user as "important to know if it's been initialized," not as a real-time compliance signal. The `mirror.stale` sub-field already carries the vision-specific staleness bit for anyone who needs a stronger guarantee.

**Why this is a small plan, not a large one.** The heavy lifting (schema, identity resolution, the `mirror` field itself) is entirely owned by the upstream ledger-project-declaration plan. This plan only threads one more optional field through an already-established enrichment-cache pipeline and renders it — consistent with Deferred Item #3's own framing as "pure UI affordance with no functional dependency" once the data exists.

## Detailed Steps (draft — confirm exact call sites once upstream plan ships)

1. Add `ledger_declared: z.boolean().nullable().optional()` (or a richer `{ declared, path, generated_at, stale }` shape — decide based on what's actually useful to show) to `ProjectMetaSchema` in `mcp-server/src/schema/project-meta.ts`.
2. Find the server-side call site where `ledger_get_repository_context`'s response is available in a project-scoped context and thread the new field into the same enrichment-cache write path used for `project_summary`/`runner` (exact location TBD — likely in `mcp-server/src/tools/repository-context.ts` or wherever project metadata gets updated post-tool-call; needs research once step 8/9 of the upstream plan exist to grep against).
3. Confirm `handleListProjects`/`handleGetProject` in `mcp-server/gui/api.ts` pass the new field through unchanged (no dedicated handler logic expected, per the `runner` precedent).
4. Render the fact in `mcp-server/gui/public/views/project-detail.js` — a small line or badge near the existing runner/status facts, shown only when the field is present.
5. Render an optional compact indicator (icon or small badge, not a full column, to avoid crowding the existing sort/filter-heavy table) in `mcp-server/gui/public/views/project-list.js`.
6. Update `mcp-server/gui/docs/agents/project-manifest/` (api-surface.md, data-flows.md) for the new field and its GUI consumers.
7. Update `mcp-server/docs/agents/project-manifest/api-surface.md`/`file-tree.md` for the `ProjectMetaSchema` change.

## Required Components (draft)

**Modified**
- `mcp-server/src/schema/project-meta.ts`
- Whatever module owns the post-tool-call enrichment write for `project_summary`/`runner` (identify during research)
- `mcp-server/gui/public/views/project-detail.js`
- `mcp-server/gui/public/views/project-list.js`
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md`, `data-flows.md`
- `mcp-server/docs/agents/project-manifest/api-surface.md`, `file-tree.md`

**New — tests**
- Extend the existing `ProjectMetaSchema` schema test coverage for the new field
- GUI rendering check (existing GUI test harness, if any covers `project-detail.js`/`project-list.js`)

## Out of Scope

- Anything in the upstream ledger-project-declaration plan itself (schema, storage, CLI, identity resolution, the `mirror` field) — this plan only consumes it.
- A live, on-demand check of whether a project's checkout currently has `.ledger/` — the server has no path to the working tree outside of a reported `cwd_path`.
- Repository-level (as opposed to project-level) indicators — rejected per the Rationale above; the registry cannot know this.
- Any change to `.repositories.json` or `RepositoryEntrySchema`.

## Acceptance Criteria (draft)

- AC-01: A project whose most recent tool call reported a `mirror` field has `ledger_declared` (or equivalent) populated in its `.meta.json` and returned by `handleGetProject`/`handleListProjects`.
- AC-02: A project with no such history renders no extra indicator — omission produces no visual noise.
- AC-03: The project detail page shows the indicator near the existing status/runner facts, following the established low-key secondary-fact style.
- AC-04: The project list view shows a compact indicator that does not disrupt existing sort/filter/column layout.
- AC-05: Existing `ProjectMetaSchema` consumers and tests pass unchanged (new field is optional and nullable).

## Dependencies

- Hard dependency: `docs/agents/plans/2026-09-16-ledger-project-declaration/plan.md` steps 8–9 and AC-20 must ship first.

## Deferred / Open Questions for the Planner

- Exact call site for threading the new field through the enrichment cache — needs the shipped upstream code to identify precisely.
- Whether to cache a plain boolean or the fuller `{ path, generated_at, stale }` shape from `mirror` — richer data is more useful but couples this plan's schema more tightly to the upstream one's shape.
- Whether project-list needs a filter (e.g. "show only ledger-declared projects") or just a passive badge — passive badge is the minimal default; confirm with the user before adding filter UI.

## Recommended Workflow

- **Workflow:** standalone (small, single-surface GUI change once unblocked) — reassess if the Planner's research brief surfaces more surface area than expected.
