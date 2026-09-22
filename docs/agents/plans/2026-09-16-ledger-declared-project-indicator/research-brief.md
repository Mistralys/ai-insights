# Research Brief

> Produced for the draft `plan.md` in this folder (authored by Claude Code mimicking the plan format).
> The draft declared itself **Blocked** pending the `2026-09-16-ledger-project-declaration` plan.
> **That dependency has shipped** — see "Headline Findings" below, which also records two
> grounding errors in the draft that change the shape of the eventual plan.

## Headline Findings

**F1 — The hard dependency has shipped; the draft's `Blocked` status is stale.**
`mirror` exists on the tool response today (`mcp-server/src/tools/repository-context.ts` L69–90 for
the `MirrorStatus` interface, L108–145 for `buildMirrorField()`, L300–309 for the conditional
attach). `resolveRepositoryIdentity()`, `findProjectRoot()`, `loadProjectDeclaration()`,
`resolveOutputPath()`, `visionHash()` and `parseGeneratedHeader()` are all present and imported.
This very workspace carries a live declaration at `.ledger/settings.json`
(`{"schema_version":1,"repository_id":"ai-insights","outputs":{"strategic-vision":{"enabled":true}}}`)
plus a generated `.ledger/strategic-vision.md`. The upstream plan folder is no longer in the working
tree; the ledger records `2026-09-17-ledger-project-declaration-rework-1` as **COMPLETE**.

**F2 — The draft's cache-write step (step 2) has no call site to attach to.**
`ledger_get_repository_context` is **repository**-scoped, not project-scoped. Its `cwd_path` is a
workspace root, and its response returns a *list* of up to `max_projects` project entries
(`repository-context.ts` L220–243). At no point in that handler is there a single ledger project,
`LedgerStore` instance, or `.meta.json` in scope to write the fact onto. The draft's step 2 —
"find the server-side call site where the response is available in a project-scoped context" —
describes a call site that does not exist. Writing the fact onto every project the call happened to
return would be both semantically wrong (the fact concerns the checkout, not each historical plan)
and an N-write amplification on a read-only tool.

**F3 — The draft's central rationale is factually incorrect: the GUI server *does* have working-tree
filesystem access, and already uses it per project.**
The draft states *"The GUI server has no filesystem access to a user's working tree and no way to ask
'does this project have `.ledger/` right now' on demand."* Both halves are wrong:

- `mcp-server/gui/api.ts` L399 (`handleListProjects`) and L635 (`handleGetProject`) call
  `inferProjectRootFromPlanPath(meta.plan_path)` to recover the checkout root from the stored plan path.
- Both then perform **real filesystem reads against that root**: `readProjectName(projectRoot)`
  (L422 and L636), implemented in `mcp-server/src/utils/read-project-name.ts`, which reads
  `package.json` / `composer.json` / `pyproject.toml` from the working tree.
- `findProjectRoot(startPath)` (`mcp-server/src/storage/project-declaration.ts` L69) is a bounded
  ancestor walk for `.ledger/settings.json` — exactly the live check the draft assumed impossible —
  and `loadProjectDeclaration(projectRoot)` (L139) returns a
  `not_declared | declared | invalid` discriminated union.

A **live check is therefore viable**, needs no `ProjectMetaSchema` change, cannot go stale, and has no
cache-coherence surface. This is a genuine design fork the plan must resolve explicitly rather than
inherit from the draft — see "Design Fork" below.

---

## Scope Sketch

- **MCP server — meta schema & enrichment cache** — `mcp-server/src/schema/project-meta.ts`,
  `mcp-server/src/storage/ledger-store.ts` — modification *(only on the cache branch of the fork)*
- **MCP server — project declaration primitives** — `mcp-server/src/storage/project-declaration.ts` —
  integration (read-only reuse; no change expected)
- **MCP server — repository-context tool** — `mcp-server/src/tools/repository-context.ts` —
  reference only; see F2 (no change expected on either branch)
- **GUI API layer** — `mcp-server/gui/api.ts`, `mcp-server/gui/server.ts` — modification
- **GUI client views** — `mcp-server/gui/public/views/project-detail.js`,
  `project-list.js`, `mcp-server/gui/public/api-client.js` — modification
- **Tests** — `mcp-server/tests/schema/`, `mcp-server/tests/storage/`, `mcp-server/tests/gui/` —
  new code
- **Documentation** — GUI manifest, MCP server manifest, `.context/` regeneration — modification

---

## Area: MCP server — meta schema & enrichment cache

### Verified References

- `mcp-server/src/schema/project-meta.ts` (L1–31): `ProjectMetaSchema`. Core fields `slug`,
  `plan_path`, `status`, `date_created`, `last_updated`, `title`. Enrichment-cache block:
  `total_work_packages`, `pending_work_packages`, `progress_pct`, `duration_ms`, `project_name`,
  `repository_name`, `outcome_summary`, `project_summary`, `runner`, `runner_client`,
  `runner_version`. Every enrichment field is `.optional()`; the nullable ones are
  `.nullable().optional()`. Confirms the draft's read of this file as the established home for
  "populate when observed, tolerate absence" facts.
- `mcp-server/src/storage/ledger-store.ts` (L19–47): `MetaCacheUpdates` interface — the parallel
  hand-maintained list of writable cache fields. The `title` JSDoc (L31–42) documents the
  nullable/non-nullable semantics split.
- `mcp-server/src/storage/ledger-store.ts` (L550–613): `writeProjectMeta(planFile, status,
  cacheUpdates, options)`. Read-modify-write against `.meta.json`, two-phase conditional spread
  (preserve existing → apply `cacheUpdates`), then `ProjectMetaSchema.parse()` and
  `atomicWriteJson()`. Supports `options.preserveLastUpdated` for cache-only refreshes that must not
  distort project-list sort order.
- `mcp-server/src/storage/ledger-store.ts` (L613–640): `readProjectMeta()` — throws on missing,
  malformed, or schema-invalid meta.

### Established Patterns

- **Two-phase spread with nullability-dependent key-presence checks** — `ledger-store.ts` L585–608:
  `'key' in cacheUpdates` for nullable fields (supports an explicit `null` clear),
  `!== undefined` for non-nullable ones.
- **Optional-and-backward-compatible enrichment fields** — `project-meta.ts` L17–30: every field
  added after the original schema is optional, so legacy `.meta.json` files keep validating.
- **Lazy self-heal cache write from the GUI** — `mcp-server/gui/api.ts` L688–691: `handleGetProject`
  computes `duration_ms` on a cache miss and fire-and-forgets a `writeProjectMeta('', undefined,
  { duration_ms }, { preserveLastUpdated: true })`, swallowing failures. Direct precedent for a
  GUI-side enrichment write, should the cache branch be chosen.

### Structural Observations

- `mcp-server/src/schema/project-meta.ts` + `mcp-server/src/storage/ledger-store.ts`: the cache
  field set is declared **three times** and hand-maintained in each — once in `ProjectMetaSchema`,
  once in the `MetaCacheUpdates` interface, and twice more inside `writeProjectMeta()`'s two spread
  phases (preserve, then override). Adding one field means four coordinated edits, and the compiler
  catches none of the omissions: a field left out of the preserve phase is silently dropped on the
  next write. The list has grown to 11 entries.
- `mcp-server/src/storage/ledger-store.ts` L585–608: the preserve phase and the override phase are
  two near-identical conditional-spread blocks over the same key set, differing only in source
  object and presence predicate.

### Constraints

- Any new field must be optional so existing `.meta.json` files continue to parse
  (`readProjectMeta()` hard-throws on a validation failure — see L630–637).
- A nullable field requires `'key' in cacheUpdates` semantics in `writeProjectMeta()`, or callers
  silently cannot clear it (confirmed by stored insight `dd78cc67`, below).
- Writes go through `atomicWriteJson()`; `.meta.json` is never written directly.

---

## Area: MCP server — project declaration primitives

### Verified References

- `mcp-server/src/storage/project-declaration.ts` (L69–92): `findProjectRoot(startPath)` — resolves
  `startPath`, walks ancestors looking for `.ledger/settings.json`, bounded by
  `MAX_ANCESTOR_DEPTH = 64` (L46) and by filesystem-root detection. Returns the nearest matching
  directory or `null`. The module doc (L52–62) declares this the **single** root-detection contract
  for every consumer.
- `mcp-server/src/storage/project-declaration.ts` (L112–137, L139): `ProjectDeclarationResult` is a
  three-state discriminated union — `not_declared` | `declared` (with merged `settings` and
  `sourcePaths`) | `invalid`. The doc comment is explicit that a malformed hand-authored declaration
  must surface rather than be swallowed.
- `mcp-server/src/storage/project-declaration.ts` (L247, L269): `ResolvedOutputPath` =
  `{ kind: 'ok'; path } | { kind: 'rejected'; reason }`, and `resolveOutputPath(...)`.
- `mcp-server/src/schema/project-declaration.ts`: `ProjectSettingsSchema`, `OutputId`,
  `DEFAULT_OUTPUT_PATHS` (imported at `project-declaration.ts` L17–23).
- `mcp-server/src/outputs/sync.ts` (L367–374): `syncProjectOutputs({ projectRoot, settings, entry,
  mode })` → `SyncOutputRecord[]`, iterating `OUTPUT_IDS`. The sole writer of the mirror file.
- `mcp-server/src/outputs/strategic-vision.ts`: `visionHash()`, `parseGeneratedHeader()` (imported
  and used read-only by `repository-context.ts` L11).
- Live example on disk: `.ledger/settings.json` and `.ledger/strategic-vision.md` in this workspace.

### Established Patterns

- **Plain-function storage modules, no class, no shared mutable state** — `project-declaration.ts`
  module doc L1–12 states it follows the `repository-registry.ts` / `repository-lookup.ts` pattern.
  Corroborated by stored insight `f389f9ce`.
- **Read-only consumers never write** — `repository-context.ts` `buildMirrorField()` doc (L104–118)
  is explicit that computing mirror status never touches the filesystem for writing; that is
  `syncProjectOutputs()`'s job alone. Any indicator work must inherit this discipline.
- **Discriminated unions over booleans for declaration state** — `ProjectDeclarationResult` and
  `ResolvedOutputPath` both model `invalid` distinctly from `absent`.

### Structural Observations

- None. This module is newly shipped, well-factored, and needs no reshaping for this work — it is
  consumed read-only on either branch of the design fork.

### Constraints

- `findProjectRoot()` performs a real filesystem walk (up to 64 `readFile` probes worst case, one
  per ancestor). Calling it once per project across a 197-project list view is a measurable cost
  that must be bounded — see the memoisation note under the GUI API area.
- `fileExists()` (L98–105) implements existence via `readFile` + catch-all, so it does not
  distinguish ENOENT from EACCES. A permission failure reads as "not declared". This mirrors the
  concern already recorded in stored insight `32bcf1a7`.

---

## Area: MCP server — repository-context tool

### Verified References

- `mcp-server/src/tools/repository-context.ts` (L69–90): `MirrorStatus` — `path: string`,
  `generated_at: string | null`, `vision_hash: string`, `stale: boolean`. **Note the deviation from
  the draft**, which assumed `generated_at: string`: it is nullable, `null` meaning "declared and
  enabled, but `ai-insights ledger sync` has not run yet".
- (L92–101): `RepositoryContextResponse`, with `mirror?: MirrorStatus` documented as "Absent for an
  undeclared project or a disabled output".
- (L108–145): `buildMirrorField(declaration)` — returns `undefined` when the output is disabled or
  the resolved path was rejected; otherwise reads the mirror file (tolerating absence), parses the
  generated header, and computes `stale = header === null || header.visionHash !== currentHash`.
- (L156–175): the handler resolves identity via `resolveRepositoryIdentity(args.cwd_path,
  args.repository_name)`; `cwd_path` is a **workspace root**, never a plan folder.
- (L220–243): the response's `projects[]` is a capped, sorted list of `ProjectEntry` — a *many*
  relation. There is no single project in scope. This is the basis of finding **F2**.
- (L300–309): `mirror` is attached only when `declaration` is present.

### Established Patterns

- **Additive, omitted-by-default response fields** — the `mirror` field's own doc comment (L96–99,
  L300–303) frames omission as the mechanism that keeps existing consumers and response tests
  unaffected. The same discipline should govern whatever this plan adds to the GUI API responses.

### Structural Observations

- None actionable. The plan consumes this module's concepts, not its code; no change is expected
  here on either branch.

### Constraints

- The tool is read-only by contract and must stay that way. Adding a cache write here would break
  the invariant stated in `buildMirrorField()`'s own doc comment.

---

## Area: GUI API layer

### Verified References

- `mcp-server/gui/api.ts` (L331–336): `handleListProjects(ledgerRoot, rawParams)` →
  `ProjectListEnvelope`.
- (L356–360): project set is loaded via `getMultiStoreManager().listAllProjects()` (multi-store) or
  `LedgerStore.listAllProjects(ledgerRoot)` (legacy). **Enrichment runs over the full set, before
  pagination** (L369–L450) — `enrichedAll` is a `Promise.all` over *every* project, not just the
  current page. This workspace's ledger currently reports **197 projects** for `ai-insights` alone
  (`ledger_get_repository_context`).
- (L399): `const projectRoot = inferProjectRootFromPlanPath(meta.plan_path);`
- (L413–426): the slow path performs working-tree I/O — `readProjectName(projectRoot)` — when the
  cache is cold. Proof of filesystem access (finding **F3**).
- (L432–444): `repository_name` derived inline from `projectRoot` with a long comment forbidding
  substitution of `deriveRepoName()` (display casing must be preserved).
- (L608–613): `handleGetProject(ledgerRoot, slug, repoName)` → `ProjectDetail`; returns
  `{ ...rootIndex, meta, project_name, timing }` (L697).
- (L635–636): the same `inferProjectRootFromPlanPath` + `readProjectName` pair in the detail path.
- (L688–691): the fire-and-forget `writeProjectMeta` self-heal described above.
- (L1184, L1231): the health handler's `work_packages_needing_reset` field — the payload behind the
  detail page's async badge.
- `mcp-server/src/utils/ledger-root.ts` (L75–92): `inferProjectRootFromPlanPath(planPath)` — pure,
  no filesystem access; finds the `docs/agents` anchor and returns everything before it, or `null`.
- `mcp-server/gui/server.ts` (L882–884): route `GET /api/projects/:repo/:slug/health` via a named
  capture-group regex; (L1099–1101) a deprecated single-segment variant retained for compatibility.
- `mcp-server/src/utils/read-project-name.ts` (L12–55): `readProjectName(projectRoot)` — sequential
  `package.json` → `composer.json` → `pyproject.toml` best-effort reads, every failure swallowed,
  returns `null` when nothing matches.

### Established Patterns

- **A secondary, potentially-expensive per-project fact gets its own endpoint and loads
  asynchronously** — the health badge: dedicated route (`server.ts` L882), dedicated client method
  `getProjectHealth()` (`api-client.js` L286), rendered as `Checking…` in the initial HTML and
  patched in later (`project-detail.js` L692, L353–366). This is the closest precedent to a live
  declaration check on the detail page.
- **Cache fast path with I/O fallback** — `handleListProjects` L409–L450: prefer cached
  `.meta.json` values, fall back to reads only when the cache is cold.
- **Per-project read failures are isolated** — the doc comment at L325–329 states one bad project
  must never break the response; the enrichment body honours it with local try/catch.
- **Route table with regex named capture groups** — `server.ts` L841, L882–884.

### Structural Observations

- `mcp-server/gui/api.ts` L399 + L635: `inferProjectRootFromPlanPath(meta.plan_path)` is computed in
  two places, each followed by its own working-tree I/O against that root. A third per-root fact
  (the declaration check) would make three call sites derive-then-read the same directory with no
  shared helper and no memoisation.
- `mcp-server/gui/api.ts` L432–444: the inline `repository_name` derivation carries a comment asking
  future authors to keep duplicate call sites in sync by hand — an explicitly acknowledged
  hand-maintained duplication (see stored insight `8f882784`, which reinforces rather than
  questions it).
- `mcp-server/gui/api.ts` L369–L450: enrichment is unconditionally full-set, so any per-project cost
  added here is multiplied by the total project count (197 today), not the page size (≤ 200,
  default 50). Distinct project **roots**, by contrast, number in the low tens — a memo keyed on
  `projectRoot` would collapse the cost almost entirely, and `findProjectRoot()`'s result is
  identical for every project sharing a checkout.

### Constraints

- `handleListProjects` is on the hot path for the main GUI screen; per-project synchronous-ish I/O
  must be bounded or memoised.
- Display fields must preserve original directory casing — never route them through
  `deriveRepoName()`.
- New API response fields should be additive and omitted when unknown, per the `mirror` precedent.

---

## Area: GUI client views

### Verified References

- `mcp-server/gui/public/views/project-detail.js` (L686–694): page header — `<h1>`, edit-title
  button, `<span id="project-status-badge">` with `statusBadge(meta.status)`,
  `<span id="health-badge" class="health-badge">Checking…</span>`, reset button.
- (L695–724): the secondary-fact card — `UI.card(null, '<div class="text-muted"
  style="font-size:13px">…')` containing **Slug**, **Repository**, **Plan path**, conditional
  **Runner** (L703–709, rendered only when `meta.runner_client || meta.runner`), **Created**,
  **Updated**, conditional **Duration**/**Active**, **Server version**, **Spec version**. This is
  the exact insertion point the draft's step 4 describes, and the conditional-runner line is the
  template for a conditional declaration line.
- (L726–748): the `.plan-synopsis` IIFE — prefers `project.project_summary` (escaped, wrapped in
  `<p>`) over `extractSynopsis()` + `marked.parse()`, with an explicit warning never to run
  plain-text through `marked`.
- (L350–366): `_patchHealthBadge(health)` — locates `#health-badge`, swaps text and class.
- (L443–447, L507–508): the combined poll builds a snapshot, populates `health` from a parallel
  fetch, and patches only on diff.
- (L833–834): comment noting `health` starts `null` and is populated asynchronously.
- `mcp-server/gui/public/views/project-list.js` (L51–52, L601–605): `repoFolderMap` — a
  folder_name → `{ label, id }` map, resolved once per load from the repos response and read
  per-row in `buildTable`.
- (L85–98): `RUNNER_LABELS`, `runnerLabel()`, `runnerBadge()` — the latter delegates to
  `UI.badge('runner-' + safeRunner, label)`. The canonical badge helper.
- (L188–270): `buildTable(projects)` — `thSort(label, key)` header helper, a nine-cell row
  (name, repo, WPs, % done, status, runner, duration, created, updated) plus an actions cell, and a
  `<thead>` listing exactly those nine sortable columns plus `<th>Actions</th>`.
- (L224–232): the `repoFolderMap` lookup per row, with a raw-folder-name fallback.
- `mcp-server/gui/public/api-client.js` (L137): `getProject(repo, slug)`; (L286)
  `getProjectHealth(repo, slug)`; (L372) `getRunMetadata(repo, slug)` — the three shapes a new
  client method would follow.

### Established Patterns

- **Conditional secondary facts render nothing when absent** — the Runner line (L703–709) and the
  Duration span (L717–721) are both empty-string when the underlying value is missing. Directly
  supports the draft's AC-02.
- **All interpolated values pass through `escapeHtml()`** — used on every dynamic value in both views.
- **Badges are built via `UI.badge(cssModifier, label)`**, never hand-assembled.
- **Sortable columns are declared once in `thSort` calls and matched positionally to row cells** —
  adding a column means editing both the `<thead>` list and every row's cell sequence.

### Structural Observations

- `mcp-server/gui/public/views/project-list.js` L254–265 vs L246–253: the header column list and the
  row cell list are two positionally-coupled hand-maintained sequences. Inserting a tenth column
  requires matching edits in both, with no structural guard against a mismatch. This is the concrete
  reason the draft's step 5 prefers "an icon or small badge, not a full column" — the brief confirms
  the draft's instinct, and also confirms that folding an indicator into an **existing** cell (e.g.
  alongside the repository label, which is already `repoFolderMap`-resolved per row) avoids the
  coupling entirely.
- `mcp-server/gui/public/views/project-detail.js` L695–724: the fact card is one ~30-line string
  concatenation mixing unconditional and conditional rows. It is at the size where a further
  conditional row is still tolerable but a second one would warrant extracting a small
  `factRow(label, value)` helper.

### Constraints

- Client views are plain ES5-style browser JS (IIFE modules, `var`, string concatenation) loaded
  directly by the browser and read verbatim by jsdom tests via `readFileSync` + `vm` — no build
  step, no module syntax.
- Plain-text values must never be passed through `marked.parse()`.

---

## Area: Tests

### Verified References

- `mcp-server/tests/schema/project-meta.test.ts`, `project-meta-runner.test.ts`,
  `project-archiving-schema.test.ts` — existing `ProjectMetaSchema` coverage; the natural home for a
  new-field test on the cache branch.
- `mcp-server/tests/storage/project-declaration.test.ts` — existing coverage for
  `findProjectRoot()` / `loadProjectDeclaration()` / `resolveOutputPath()`.
- `mcp-server/tests/outputs/strategic-vision.test.ts`, `sync.test.ts` — mirror header and sync
  coverage.
- `mcp-server/tests/storage/ledger-store.test.ts`, `project-meta.test.ts`,
  `mcp-server/tests/tools/meta-enrichment.test.ts` — `writeProjectMeta()` enrichment coverage.
- `mcp-server/tests/gui/api.test.ts` — `handleListProjects` / `handleGetProject` server-side coverage.
- `mcp-server/tests/gui/project-list.test.ts`, `project-detail-helpers.test.ts`,
  `project-detail-snapshot.test.ts`, `project-detail-diff.test.ts`,
  `project-detail-auto-update.test.ts` — **jsdom** client-rendering coverage.
- `mcp-server/tests/gui/project-detail-helpers.test.ts` (L1–35): the harness pattern —
  `// @vitest-environment jsdom`, then `readFileSync` of each `gui/public/views/*.js` file and
  evaluation through `node:vm`.
- `mcp-server/tests/gui/setup-gui-globals.ts` — shared jsdom global setup.

### Established Patterns

- **Client views are testable**: the draft's hedge *"GUI rendering check (existing GUI test harness,
  if any covers `project-detail.js`/`project-list.js`)"* is resolved — both views are covered today,
  and a rendering obligation for the new indicator is a firm requirement, not a conditional one.
- **Server-side API handlers are tested directly** (not via HTTP) in `tests/gui/api.test.ts`.

### Constraints

- Test fixtures must use `YYYY-MM-DD-name` plan-folder basenames or `LedgerStore` construction
  throws (stored insight `ab304b5b`).
- Tests must be platform-agnostic: no hardcoded `/tmp`, no asserted path separators
  (root `AGENTS.md` → Cross-Platform Policy, rule 5). Relevant here because any live-check test
  needs real temporary directories containing a `.ledger/settings.json`.

---

## Area: Documentation

### Verified References

- Root `AGENTS.md` → Manifest Maintenance Rules (MCP Server table): "Add new class/service" →
  `api-surface.md`, `file-tree.md`; "Modify public method signature" → `api-surface.md`; "Change
  data flow" → `data-flows.md`; **"Change anything under `mcp-server/gui/`" →
  `mcp-server/gui/docs/agents/project-manifest/` — the GUI owns its own manifest.**
- Root `AGENTS.md` → Cross-System Dependencies: the `.ledger/settings.json` ↔ registry identity row
  and the generated-mirror ↔ `StrategicVisionSchema` row both enumerate every consumer that must
  stay in sync. A new consumer of `findProjectRoot()` / `loadProjectDeclaration()` belongs in the
  first of those rows.
- Root `AGENTS.md` → Generated Context Docs: `.context/` is regenerated via
  `node scripts/cli.js ctx-generate`.
- Root `AGENTS.md` → Changelog Convention: module changelog first (`mcp-server/changelog.md`), root
  changelog second; house style is a flat bullet list, ≤ 100-char lines.

### Established Patterns

- Manifest-first: the manifest is authoritative, and a code/manifest conflict is resolved in the
  manifest's favour.
- `.context/` regeneration follows every `docs/agents/project-manifest/` edit (stored insight
  `53454e24`).

### Constraints

- GUI changes must update the **GUI** manifest, not the MCP server manifest — a distinction the
  draft's step 6/7 already gets right.
- Any `ProjectMetaSchema` change touches the Cross-System Dependencies row set in root `AGENTS.md`.

---

## Design Fork (for the Confirm phase)

Findings F2 and F3 mean the draft's single approach is really two, and the plan must choose:

| | **A — Live check** | **B — Cached fact (draft's approach)** |
|---|---|---|
| Data source | `findProjectRoot()` / `loadProjectDeclaration()` against `inferProjectRootFromPlanPath(meta.plan_path)`, at GUI request time | A new `ProjectMetaSchema` field, written when observed |
| Schema change | None | `ProjectMetaSchema` + `MetaCacheUpdates` + two `writeProjectMeta()` spread phases |
| Accuracy | Always current | "As of last observation"; can never self-correct downward (a removed `.ledger/` stays reported as declared forever) |
| Writer | None — read-only, honours `buildMirrorField()`'s discipline | Needs a project-scoped call site that **does not currently exist** (F2) |
| Cost | `findProjectRoot()` per distinct project root; memoisable to ~tens of walks per list load | One extra `.meta.json` field read |
| Precedent | `readProjectName()` working-tree read (api.ts L422/L636); async `#health-badge` endpoint | `duration_ms` lazy self-heal (api.ts L688–691) |

**The brief's reading:** B's blocking problem is F2 — there is no call site to write from — while A's
only real cost (repeated ancestor walks) is bounded by memoisation on `projectRoot`, and A needs no
schema change at all. A also eliminates the draft's own acknowledged weakness ("the fact can go stale
and that is acceptable"). A hybrid is available if list-view cost proves unacceptable: live check on
the **detail** page via a dedicated endpoint (exact `#health-badge` precedent), and nothing at all in
the list view — which would also sidestep the column-coupling observation entirely.

Three of the draft's sections depend on which branch is chosen and cannot be carried forward as-is:
its Rationale (built on the incorrect no-filesystem-access premise), its steps 1–2, and its
Deferred/Open Question about boolean-vs-rich shape (moot under A, where the full
`ProjectDeclarationResult` is available at render time).

---

## Strategic Context

**Strategic vision (from `ledger_get_repository_context`, repository `ai-insights`):**

- *Short-term:* "make the whole project as easy as possible to set up and use by developers.
  Onboarding and daily usage must offer as little friction as possible." — This indicator is squarely
  a short-term-goal feature: it answers "is this project ledger-enabled?" at a glance.
- *Mid-term:* end-user documentation and persona-design awareness, now that the repository is public.
- *Long-term:* "Personas First… Focus on the essentials before agentic tools and IDEs with
  LLM-independence by design. All integrated tools exist only to support the personas." — A GUI
  affordance is a supporting tool, so it should stay proportionate: a small, low-cost indicator,
  not a new subsystem. Reinforces branch A over B.

**Prior project history (197 projects in this repository).** Directly upstream:
`2026-09-17-ledger-project-declaration-rework-1` — **COMPLETE**. Its outcome summary records that it
"Removed the workspace's one Claude-Code-specific advisory (`pretooluse-hook`) from `ai-insights
ledger init`/`edit`, and codified a durable 'Tool-Agnostic Policy' in `AGENTS.md`". Relevant
constraint for this plan: root `AGENTS.md` → **Tool-Agnostic Policy** now governs shared surfaces —
a GUI indicator must not name or depend on any specific IDE or agent harness. (This also matches the
locally stored `feedback-tool-agnostic` memory.)

**Relevant stored insights (`ledger_search_insights`, repository `ai-insights`):**

- `dd78cc67` — *"writeProjectMeta() two-phase spread: use `!== undefined` for non-nullable fields,
  `'key' in cacheUpdates` for nullable ones."* Binding if branch B is chosen; a nullable field added
  with `!== undefined` silently cannot be cleared.
- `acc856a9` — *"The `project_summary` field is the canonical template for new agent-curated
  metadata fields."* Four-layer template (Zod shape → `MetaCacheUpdates` → `writeProjectMeta()`
  handler → persona instruction delivery). Partially applicable to B: layer 4 does **not** apply —
  the declaration fact is machine-observed, not agent-curated, so no persona instruction is needed.
- `8f882784` — *"`handleGetInsights` and `handleListProjects` derive `repository_name` with original
  casing — do not replace with `deriveRepoName()`."* Names the inline duplication observed above and
  explicitly asks a third derivation site to copy the pattern rather than refactor it.
- `f389f9ce` — *"Use plain-function modules (not classes) for stateless storage helpers."*
  Governs any new helper added near `project-declaration.ts`.
- `ab304b5b` — *"`LedgerStore` constructor enforces `YYYY-MM-DD-name` planPath basename — test
  fixtures must comply."* Binding on every new test fixture.
- `53454e24` — *"Run `ctx generate` after every edit to `docs/agents/project-manifest/` files."*
  Binding on the documentation step.
- `32bcf1a7` — *"Optional standalone-import files must distinguish absence from I/O failure."* The
  same class of defect is latent in `project-declaration.ts`'s `fileExists()` (catch-all, so EACCES
  reads as "not declared") — worth an explicit decision in the plan rather than silent inheritance.

**Knowledge-base reconciliation candidates** (for the plan's `## Knowledge Base Reconciliation`
section, executed by the Ledger Knowledge Curator v1.4.1):

- `acc856a9` — if branch B ships, this insight's claim that the template covers *all* new metadata
  fields would need qualifying: a machine-observed field skips its persona-delivery layer.
- `8f882784` — if the plan adds a third `inferProjectRootFromPlanPath`-derived per-project fact (or
  memoises the derivation), the insight's "if you add a third derivation site, use the same inline
  pattern" guidance becomes outdated in its specifics.
- `dd78cc67` / the `MetaCacheUpdates` field inventory — only if branch B ships.

Under branch A, none of the above is invalidated and the section would be omitted.
