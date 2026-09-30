# Research Brief

> **Primary input:** `docs/agents/research/2026-09-22-ledger-declared-repository-indicator.md`
> → section `## Implementation Recommendation — Plan 1: "Repository Declaration Indicator"`.
> **Secondary input (mined, not re-derived):** `docs/agents/plans/2026-09-16-ledger-declared-project-indicator/research-brief.md`.
> Its `## Area: MCP server — meta schema & enrichment cache` section and its Design Fork's
> project-level framing are invalidated by the new premise and were not carried forward.
>
> Every claim below was re-verified against the working tree on 2026-09-22. Divergences from the
> research document are marked **[NEW FINDING]** and are the material this brief adds.

## Scope Sketch

- **Registry schema** — `mcp-server/src/schema/repository-registry.ts` — modification (new optional field)
- **Registry storage** — `mcp-server/src/storage/repository-registry.ts` — modification (new locked mutator, internal refactor)
- **Project declaration loader** — `mcp-server/src/storage/project-declaration.ts` — modification (expose base-only settings)
- **CLI declaration verbs** — `scripts/ledger-project.js`, `scripts/lib/ledger-bridge.js` — modification (write-back on `init`/`edit`)
- **Repository-context tool** — `mcp-server/src/tools/repository-context.ts` — modification (throttled refresh + back-fill)
- **GUI API layer** — `mcp-server/gui/api-repos.ts` — modification (expose field; preserve it across updates; clear endpoint)
- **GUI client** — `mcp-server/gui/public/views/strategy.js`, `mcp-server/gui/public/api-client.js` — modification (badge + Clear control)
- **Tests** — `mcp-server/tests/`, `scripts/tests/` — new test files and additions
- **Documentation** — root `AGENTS.md`, MCP server manifest, GUI manifest, changelogs — modification

---

## Area: Registry schema

### Verified References

- `mcp-server/src/schema/repository-registry.ts` (L39–L47): `RepositoryEntrySchema` is a plain
  `z.object` with exactly `id`, `label`, `folder_names`, `vision`, `created_at`, `last_modified`.
  No `.strict()`, so unknown keys are **stripped** on parse rather than rejected.
- Same file (L19–L38): the entry carries a field-by-field doc-comment block. Every existing field is
  documented there; a new field is expected to follow suit.
- Same file (L56–L58): `RepositoryRegistrySchema` wraps `repositories: z.array(RepositoryEntrySchema)`.
- `mcp-server/src/schema/project-declaration.ts` (L25–L40): `OUTPUT_IDS = ['strategic-vision']`,
  `OutputIdSchema = z.enum(OUTPUT_IDS)`, `DEFAULT_OUTPUT_PATHS`. `OutputId` is the exported type.
- `mcp-server/src/schema/store-config.ts` — `StoreEntrySchema.path` (machine-local absolute paths)
  and `StoreSyncMetaSchema` (stores are explicitly modelled as synced across devices). This is the
  basis for keeping `.repositories.json` path-free.

### Established Patterns

- Nullable-with-doc-comment field style — `StrategicVisionSchema`, `mcp-server/src/schema/repository-registry.ts` L12–L16.
- Optional + nullable enrichment fields — `mcp-server/src/schema/project-meta.ts` (`project_summary`, `title`).
- `.strict()` is used deliberately where unknown keys must be rejected (`ProjectSettingsSchema`,
  `mcp-server/src/schema/project-declaration.ts` L98–L104) and deliberately omitted on the registry.

### Structural Observations

- `mcp-server/src/schema/repository-registry.ts`: the schema carries no note about what may *not* go
  on an entry. The research document's "shut the door on path fields" recommendation has no place to
  live until such a note exists.

### Constraints

- `mcp-server/docs/agents/project-manifest/constraints-code-style.md` forbids `.refine()`,
  `.transform()`, `.superRefine()` on outer tool schemas (cited in
  `mcp-server/src/schema/project-declaration.ts` L15–L18). Timestamp/format validation belongs to the
  storage layer, matching `created_at` / `last_modified`, which are plain `z.string()`.

---

## Area: Registry storage

### Verified References

- `mcp-server/src/storage/repository-registry.ts` (L42–L55): `loadRegistry()` wraps
  `readFile` → `JSON.parse` → `RepositoryRegistrySchema.parse` in a **single bare `catch`** that
  returns `{ repositories: [] }`. The comment at L52 names schema validation failure explicitly as
  one of the swallowed cases. **This is the silent-registry-wipe mechanism, verified.**
- Same file (L69–L80): `saveRegistry()` parses, sorts by `id`, then calls
  `withLock(storePath, async () => atomicWriteJson(path, validated))`. The lock covers only the
  write — not any caller-side read.
- Same file (L93–L103, L115–L117): `findByFolderName()`, `getAllFolderNames()` — pure, no I/O.
- `mcp-server/src/storage/file-lock.ts` (L31–L76): `withLock()` uses `proper-lockfile` with
  `stale: 10000`, 50 retries. **[NEW FINDING]** `proper-lockfile` locks are **not reentrant** — a
  nested `withLock()` on the same `storePath` retries against its own held lock and then throws the
  `ELOCKED`-derived error at L56–L59. A naive `updateRepositoryEntry()` implemented as
  `withLock(… loadRegistry() → mutate → saveRegistry() …)` therefore **self-deadlocks**, because
  `saveRegistry()` acquires the same lock internally. The research document does not mention this.
- `mcp-server/src/storage/repository-lookup.ts` (L35–L52): `findEntryInStores(ledgerRoot, repoId)`
  returns `{ storePath, entry } | null`; (L68–L88) `listEntriesInStores(ledgerRoot)` returns
  `Array<{ storePath, entry }>`. Both carry the owning store path.
- `mcp-server/src/storage/atomic-writer.ts` — `atomicWriteJson` (write-temp-then-rename).

### Established Patterns

- Plain exported functions, no classes, one `storePath` parameter threaded explicitly —
  `mcp-server/src/storage/repository-registry.ts` throughout.
- Cross-store resolution is centralised in one module so callers never re-derive store order —
  `mcp-server/src/storage/repository-lookup.ts` module doc (L1–L8).

### Structural Observations

- `mcp-server/src/storage/repository-registry.ts`: there is no read-modify-write primitive. Every
  current caller (`mcp-server/gui/api-repos.ts` L512/L543, L571/L573, L649–L667) hand-rolls
  `loadRegistry()` → mutate array → `saveRegistry()` outside any lock. Adding a second class of
  writer (CLI + server) to that pattern multiplies the lost-update window.
- Same file: the atomic write body inside `saveRegistry()` is not separable from its lock
  acquisition, which is precisely what a locked composite operation needs.

### Constraints

- `mcp-server/docs/agents/project-manifest/constraints-storage.md` governs this module (per
  `AGENTS.md` → Manifest Maintenance Rules, "Add constraint/convention" row).
- Root `AGENTS.md` → Cross-Platform Policy rule 4: file locking must work on all three OSs;
  `proper-lockfile` is the sanctioned mechanism.

---

## Area: Project declaration loader

### Verified References

- `mcp-server/src/storage/project-declaration.ts` (L112–L121): `ProjectDeclarationResult`'s
  `declared` variant carries `settings` — documented at L116 as **"the merged settings:
  `settings.json` with `settings.local.json` deep-merged over it"** — plus
  `sourcePaths: { settings, local }`.
- Same file (L205–L229): the merge loop produces `mergedOutputs`, then `mergedSettings`, then
  returns `{ kind: 'declared', settings: mergedSettings, sourcePaths }`. **The un-merged base
  settings object is computed (as `baseResult.data`) but never returned.**
- `mcp-server/src/schema/project-declaration.ts` (L107–L121): `ProjectSettingsLocalSchema` omits
  `repository_id` entirely — a machine-local override may not redirect identity, but it *may*
  flip `outputs.*.enabled`.
- `mcp-server/src/utils/repository-identity.ts` (L138–L168): the `declared` tier puts
  `declResult.settings` — i.e. the **merged** settings — into `DeclaredIdentity.settings`, alongside
  `entry` and `storePath`.

### Established Patterns

- Discriminated-union `{ kind, … }` results rather than thrown exceptions for user-triggerable
  rejections — `ProjectDeclarationResult`, `ResolvedOutputPath`, `ResolveRepositoryIdentityResult`.
- The base/local split is treated as a first-class invariant, not an implementation detail —
  `.ledger/README.md`, `ProjectSettingsLocalSchema`'s doc comment.

### Structural Observations

**[NEW FINDING]** The registry is portable across devices (`StoreSyncMetaSchema`), while
`settings.local.json` is explicitly machine-local and gitignored (`GITIGNORE_LINE` in
`scripts/lib/ledger-project-core.js` L37). Any server-side writer that derives `outputs_enabled`
from `DeclaredIdentity.settings` would therefore copy **machine-local output preferences into a
portable, cross-device artefact** — a smaller instance of exactly the failure the research document
uses to reject a path field on `RepositoryEntry`. The loader currently offers no base-only accessor,
so there is no correct source for this sub-fact on the server path.

### Constraints

- `.ledger/settings.local.json` must never influence repository-level recorded facts; a local
  override "may not redirect a project's declared identity"
  (`mcp-server/src/schema/project-declaration.ts` L110–L114).

---

## Area: CLI declaration verbs

### Verified References

- `scripts/ledger-project.js` (L106–L110): `bootstrapStoreContext()` calls `initStoreContext()` once
  per process before any registry lookup.
- Same file (L121–L126): `lookupEntryById(repositoryId, ledgerRootOverride)` calls
  `findEntryInStores()` and **returns `found.entry` only — `found.storePath` is discarded.**
  Verified callers: L591 (`runEdit`) and L759 (`runSync`).
- Same file (L370–L418): `runInitNonInteractive()` — `resolveInitTarget()` → `buildInitialSettings()`
  → `planInitWrites()` → `writePlannedFiles(plan.files)` at L415, then `printAdvisories()`.
- Same file (L427+): `runInitWizard()` — same core calls behind prompts.
- Same file (L674–L681): `finalizeEdit()` — `buildInitialSettings()` → `writeSettingsOnly()` →
  `performSync()`. This is the single choke-point both `edit` shells funnel through.
- `scripts/lib/ledger-project-core.js` (L96–L136): `resolveInitTarget()` returns
  `{ classification: 'matched' | 'ambiguous' | 'unregistered', matched: { storePath, entry } | null,
  derivedName, candidates: Array<{ storePath, entry, isDerivedMatch }> }`.
  **`matched.storePath` is present** — the `init` path already has correct multi-store targeting
  available and simply does not use it today.
- `scripts/lib/ledger-bridge.js` (L82–L96): `loadDistModule(relativePath)` — freshness guard plus
  cached dynamic import from `mcp-server/dist/`. The only sanctioned scripts → mcp-server direction.
- `scripts/ledger-project.js` (L1–L36): module doc states the core/shell split — the pure core makes
  every decision; this file owns every side effect.

### Established Patterns

- Two shells per verb (non-interactive and wizard) converging on one shared finalisation function —
  `scripts/ledger-project.js` L370/L427 (init) and L612/L638 → L674 (edit).
- Compiled-module access exclusively through `loadDistModule()` — never a relative import into
  `mcp-server/src/`.
- Decision logic in `scripts/lib/ledger-project-core.js`; I/O in `scripts/ledger-project.js`.

### Structural Observations

- `scripts/ledger-project.js` L121–L126: `lookupEntryById()` narrowing `{ storePath, entry }` down to
  `entry` is the sole reason the `edit` path cannot target the owning store. Two call sites.
- `scripts/ledger-project.js` L415 / L674–L681: `init` and `edit` have exactly one write point each,
  so a write-back hook needs no new control flow — but `init`'s two shells both call
  `writePlannedFiles()` separately (L415 and inside the wizard), unlike `edit`'s single
  `finalizeEdit()`.

### Constraints

- Root `AGENTS.md` → Cross-Platform Policy rule 3: root scripts must not rely on Unix-only utilities.
- `scripts/tests/ledger-project.test.js` (L1–L16) records the testing convention: drive the **real**
  compiled `dist/` modules against temp dirs, no bridge mocking, and always pass an explicit
  `ledgerRoot` override so the live workspace ledger is never touched
  (`mcp-server/docs/agents/project-manifest/constraints-testing.md` — the `d6f8fa4d` insight ID cited
  alongside it in the test file does not resolve; see *Strategic Context*).

---

## Area: Repository-context tool

### Verified References

- `mcp-server/src/tools/repository-context.ts` (L154–L171): `getRepositoryContext()` calls
  `resolveRepositoryIdentity(args.cwd_path, args.repository_name)` first, then destructures
  `{ repositoryName, declaration }`.
- Same file (L185–L195): on the declared tier, `registryEntry = declaration.entry` — reused directly,
  never re-looked-up.
- Same file (L110–L150): `buildMirrorField()` carries an explicit contract in its doc comment —
  **"Read-only — never writes, removes, or otherwise touches the filesystem."**
- Same file (L294–L308): the response is assembled last; `mirror` is additive and omitted when absent.
- Same file (L318–L328): the whole handler is wrapped in one `try`/`catch` that converts any throw
  into `isError: true`.
- `mcp-server/src/utils/repository-identity.ts` (L43–L52): `DeclaredIdentity` carries
  `projectRoot`, `settings`, `entry`, `storePath` — everything a write-back needs except base-only
  output state.

### Established Patterns

- `_internal` export object for unit-testing private functions —
  `mcp-server/src/tools/repository-context.ts` L384–L388.
- Expected-failure suppression is narrow and justified in a doc comment, never a bare catch —
  `safeListRepositoryInsights()` L344–L356 re-throws everything that is not `SlugValidationError`.

### Structural Observations

- `mcp-server/src/tools/repository-context.ts`: the tool is currently a pure reader. Introducing a
  write makes the module doc and `buildMirrorField()`'s "read-only" statement partially untrue unless
  the new write is explicitly scoped and documented as not touching the working tree.

### Constraints

- Adding a write to a read-path tool must not change the response shape, must not fail the call, and
  must not lengthen the critical path noticeably — the tool already performs multi-store project
  scans and knowledge queries (L207–L288).

---

## Area: GUI API layer

- [added by: Plan Architect Reviewer, unverified] `mcp-server/gui/api.ts` (L1009–L1011): `handleGetConfig()` returns the in-memory `GuiConfig` cache directly, so an additive runtime-only response field can be merged there without adding it to the disk-round-tripped `GuiConfigSchema`.

### Verified References

- `mcp-server/gui/api-repos.ts` (L192–L213): `RepoListItem` interface. **[NEW FINDING]** It already
  carries a field named **`declared: boolean`**, documented at L205–L211 as
  "`true` for entries sourced from the repository registry, `false` for synthetic entries discovered
  from the filesystem". The doc block above it (L186–L190) instructs consumers to
  "branch on `declared`". A second, unrelated meaning of "declared" on the same object would collide
  directly with an existing documented contract.
- Same file (L215–L236): `toListItem(entry, storeId)` — the sole `RepositoryEntry` → `RepoListItem`
  projection; sets `declared: true`.
- Same file (L257+, L308–L309, L340): `handleListRepos()` — registry entries via `toListItem()`,
  plus optional filesystem-discovered synthetic items.
- Same file (L379–L394): `handleGetRepo()` returns `found.entry` (optionally `+ store_id`) — a
  **spread** of the whole entry, so a new schema field flows through automatically.
- Same file (L501–L545): `handleUpdateRepo()`. **[NEW FINDING — highest-impact omission in the
  research document]** at L529–L536 it rebuilds the entry by **explicit field enumeration**:
  ```
  const updated: RepositoryEntry = RepositoryEntrySchema.parse({
    id: existing.id,
    label: label ?? existing.label,
    folder_names: folder_names ?? existing.folder_names,
    vision: vision ?? existing.vision,
    created_at: existing.created_at,
    last_modified: nowIso(),
  });
  ```
  There is no `...existing` spread. Any field added to `RepositoryEntrySchema` that is not added to
  this literal is **silently dropped on every GUI repository edit** — editing a label or a vision
  horizon would erase the declaration record.
- Same file (L616–L670): `handleMoveRepo()` builds `movedEntry` via
  `RepositoryEntrySchema.parse({ ...entry, last_modified: nowIso() })` — a spread, therefore safe.
- Same file (L415+, L453, L473): `handleCreateRepo()` — new entries; no declaration to preserve.
- Same file (L562–L573): `handleDeleteRepo()` — filter + `saveRegistry`, unaffected.
- Same file (L45–L46): imports `loadRegistry`, `saveRegistry` from
  `../src/storage/repository-registry.js`; (L60) imports `findEntryInStores` from
  `../src/storage/repository-lookup.js`.
- Same file (L128–L191): `RepoCreateBodySchema` / `RepoUpdateBodySchema` — zod-validated request
  bodies; `validationError()` / `ApiError` for failures.
- `mcp-server/gui/server.ts` (L563–L596): `buildRepoRoutes()` — declarative route table
  (`POST /api/repos`, `PUT/GET/DELETE /api/repos/:repoId`, `POST /api/repos/:repoId/move`), each
  entry mapping a method + path (string or named-group regex) to a handler.
- `mcp-server/gui/api.ts` (L24, L374, L639, L1817): `inferProjectRootFromPlanPath(meta.plan_path)`
  from `../src/utils/ledger-root.js` — **exists and is in active use**; this is the mechanism the
  superseded brief's Branch A would rely on.

### Established Patterns

- One handler per route, exported from `api-repos.ts`, wired in `buildRepoRoutes()`.
- `findEntryInStores()` first to locate the owning store, then `loadRegistry(storePath)` /
  `saveRegistry(storePath, …)` — every mutating handler (L507–L512, L566–L571, L637–L660).
- Sub-resource verbs are `POST /api/repos/:repoId/<verb>` (`/move`, L581–L583).
- `store_id` enrichment is conditional on multi-store mode and omitted otherwise (L385–L393).

### Structural Observations

- `mcp-server/gui/api-repos.ts` L529–L536: the enumerate-don't-spread construction in
  `handleUpdateRepo()` is a standing data-loss trap for *any* future entry field, not just this one.
  `handleMoveRepo()` two hundred lines below already uses the spread form, so the codebase disagrees
  with itself about the safe shape.
- Same file: all four mutating handlers repeat the
  `findEntryInStores` → `loadRegistry` → mutate → `saveRegistry` sequence with no lock spanning it —
  the same lost-update exposure a new locked mutator is being introduced to avoid.

### Constraints

- `AGENTS.md` → Manifest Maintenance Rules: "Change anything under `mcp-server/gui/`" →
  `mcp-server/gui/docs/agents/project-manifest/`. The GUI owns a separate manifest from the MCP server.

---

## Area: GUI client

### Verified References

- `mcp-server/gui/public/views/strategy.js` (L67–L72): `visionStatus(repo)` returns one of three
  `<span class="badge badge-blocked|badge-complete|badge-in-progress">` strings.
- Same file (L89–L147): `buildTableHtml(repos, isMultiStore)` — sorts, then maps each repo to a row.
  L111–L126 is the undeclared-row branch (`r.declared === false`, muted row, `Undeclared` badge,
  Register button); L127–L134 is the declared row (Label button, ID, optional Store cell,
  `visionStatus(r)` cell). Header at L136–L143: `Label`, `ID`, optional `Store`, `Vision`.
- Same file (L226–L248): `wireTableButtons()` — `[data-register-folder]` and `[data-edit-repo]`
  delegation; the edit path calls `API.getRepo(repoId)` then `renderRepoModal('edit', repo, …)`.
- Same file (L581–L700+): `renderRepoModal(mode, repo, stores, onSaved, prefill)` — field-group HTML
  assembled as strings (`idField`, `labelField`, `folderWidget`, `visionFields`, `storeField`),
  wired through `wireModalEvents(overlay, { excludeTextarea, onSubmit: handleSave, onClose })`.
  Vision fields are edit-mode-only (L646–L659), establishing the precedent for an edit-mode-only
  control.
- `mcp-server/gui/public/api-client.js` (L532, L544, L567): `listRepos(includeUndeclared)`,
  `getRepo(repoId)`, `updateRepo(repoId, data)`.

*[added by: Planner, GUI-review integration — verified against the working tree]*

- `mcp-server/gui/public/styles.css` (L358–L368): the `.badge` base rule is
  `display:inline-block; padding:2px 10px; border-radius:var(--radius-pill); font-size:11px;
  font-weight:600; letter-spacing:0.04em; text-transform:uppercase; white-space:nowrap`. Badge text is
  therefore **uppercased** and **never wraps** — a long badge string widens its table cell without
  limit.
- `mcp-server/gui/public/styles.css` (L513–L517): `.table-wrapper { overflow-x:auto; border-radius;
  border }` is the established horizontal-scroll container for wide tables. Used by
  `views/project-list.js` (L258), `views/config-stores.js` (L149),
  `views/config-model-registry.js` (L181), `views/project-detail.js` (L773) and
  `views/project-detail-dialogues.js` (L470).
- `mcp-server/gui/public/views/strategy.js` (L137, L318) emits a bare `<table class="data-table">`
  with **no** `.table-wrapper` container. The class `data-table` has no rule in `styles.css` (grep
  returns only these two emission sites); the table is styled by the bare `table` selector at
  `styles.css` L519 (`width:100%`). The Strategy tables are the only tables in the GUI without the
  scroll container.
- `mcp-server/gui/public/utils.js` (L26–L50): `formatDate(isoString)` — a global loaded for every
  jsdom suite by `mcp-server/tests/gui/setup-gui-globals.ts` (L53). Returns `'—'` for a falsy input,
  `'Today, HH:MM'` / `'Yesterday, HH:MM'` / `'Wednesday, 12 Feb, 16:41'` within a week, and
  `'12 Feb 2026, 16:41'` beyond it. Its two fallback paths (unparseable date, thrown error) return
  `escapeHtml(isoString)`; every other return is built from `Date` components and contains no
  HTML-special characters. Re-escaping its return value would therefore double-escape the fallback.
  `strategy.js` does not currently call it — no other date-formatting helper exists in that file.
- `mcp-server/gui/public/views/strategy.js`: `visionStatus()` (L67) and `buildTableHtml()` (L89) are
  declared **inside** `renderStrategyList(app)`'s function body, so neither is reachable from the
  global scope. Only `renderStrategyList` (L39) and `renderRepoModal` (L581) are top-level
  declarations. `vm.runInThisContext`-based suites can assert only on top-level declarations — see
  `mcp-server/tests/gui/client-rendering.test.ts` (L22–L25) and
  `mcp-server/tests/gui/project-list.test.ts` (L101–L102), where `project-list.js`'s top-level
  `buildTable()` is asserted directly.
- Modal field markup convention (`strategy.js` L643–L669): `<div class="cs-modal-field-group">` +
  `<label class="form-label">` + `.form-control`; `.cs-modal-field-error` for inline errors
  (`styles.css` L4114, L4118). There is no help-text / hint class — muted inline text in this file is
  `class="text-muted" style="font-size:13px"` (L184, L307–L308, L356).
- Destructive actions confirm through the native `confirm()` dialog: `views/project-list.js`
  (L564, L568), `views/config-stores.js` (L530), `views/config-model-registry.js` (L580).
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` (§ Badge Colour Tokens) documents
  every `.badge-*` variant against its `--color-badge-*-bg` / `-fg` token pair. Reusing an existing
  variant adds no token and needs no entry there; introducing a variant does.

### Established Patterns

- ES5-style browser JS: `var`, `function`, string-concatenated HTML, `escapeHtml()` on every
  interpolated value — throughout `strategy.js`.
- Badges are small pure functions returning a `<span class="badge …">` string (`visionStatus`).
- Edit-mode-only modal sections are built as conditional string fragments (`isAdd ? '' : …`).
- All API access goes through the `API.*` façade in `api-client.js`, never `fetch` in a view.

### Structural Observations

- `mcp-server/gui/public/views/strategy.js` L127–L134: the declared row emits one status cell.
  Adding a second status concept means either a second column (header change at L136–L143, affecting
  the `isMultiStore` colspan arithmetic) or a second badge inside the existing Vision cell. The row
  builder inlines all of this, so there is no seam for a per-row status list.

*[added by: Planner, GUI-review integration — verified against the working tree]*

- `mcp-server/gui/public/views/strategy.js` L137: the repositories table has no `.table-wrapper`
  scroll container, unlike every other wide table in the GUI. A fourth (or, in multi-store mode,
  fifth) column carrying a `white-space:nowrap` badge is the first change likely to exercise that
  gap.
- `mcp-server/gui/public/views/strategy.js` L67, L89: the view's two pure string-returning helpers
  are closure-scoped, which is why no suite asserts on Strategy rendering today. Any new helper
  placed beside them inherits the same untestability.
- `mcp-server/gui/public/views/strategy.js` has no date-formatting call, while `utils.js` L26 already
  exposes one globally — a new local formatter would duplicate an existing helper.

### Constraints

- Root `AGENTS.md` → Tool-Agnostic Policy: no GUI surface may name or depend on a specific IDE or
  agent harness (recorded in local memory `feedback-tool-agnostic`).
- Client-side files are plain browser JS with no build step — no TypeScript, no modules.

- [added by: Plan Auditor, unverified] `mcp-server/gui/public/views/strategy.js` (L45–L61) initially requests only `API.listRepos(false)` and `API.getStores()`; `API.getConfig()` is currently consumed only by `mcp-server/gui/public/views/config.js` (L35–L43). A runtime GUI configuration value needs an explicit Strategy-view fetch or shared-state delivery path.
- [added by: Plan Auditor, unverified] `mcp-server/gui/public/api-client.js` (L1–L19) centralizes request construction; an API facade method without a third `body` argument produces no `Content-Type` header and no request body, matching the proposed clear-declaration DELETE contract.

---

## Area: Tests

### Verified References

- `mcp-server/tests/storage/repository-registry.test.ts` (L1–L36): imports the storage functions
  directly; `makeEntry(overrides)` / `makeRegistry(overrides)` fixture factories; temp dirs via
  `mkdtemp(join(tmpdir(), …))`.
- `mcp-server/tests/schema/repository-registry.test.ts` — schema-level suite, the natural home for a
  legacy-parse assertion.
- `mcp-server/tests/storage/repository-lookup.test.ts` — multi-store resolution coverage.
- `mcp-server/tests/tools/repository-context.test.ts`,
  `mcp-server/tests/tools/repository-context-identity.test.ts`,
  `mcp-server/tests/tools/repository-context-multi-store.test.ts` — the three existing suites for the
  tool; the identity suite is where declared-tier behaviour lives.
- `mcp-server/tests/utils/repository-identity.test.ts` — declared/derived tier resolution.
- `mcp-server/tests/storage/project-declaration.test.ts`,
  `mcp-server/tests/schema/project-declaration.test.ts` — loader and schema suites.
- `mcp-server/tests/gui/api-repos.test.ts`, `mcp-server/tests/gui/api-repos-store.test.ts` — GUI repo
  handler suites (single-store and multi-store).
- `mcp-server/tests/gui/client-rendering.test.ts` — the precedent for asserting on client-side
  rendering output.
- `scripts/tests/ledger-project.test.js` (L1–L60): CLI shell tests; `makeTempDir()`,
  `writeRegistry(ledgerRoot, entries)` helpers; explicit `ledgerRoot` override on every call; real
  `dist/` modules, no bridge mocking.
- `scripts/tests/ledger-project-core.test.js` — pure-core tests.
- `vitest.config.ts` at the workspace root drives both TS and JS suites.

### Established Patterns

- Test files mirror source paths (`src/storage/x.ts` → `tests/storage/x.test.ts`).
- Acceptance criteria are named in the test file's header comment block
  (`scripts/tests/ledger-project.test.js` L18–L33).
- Temp-directory isolation with `afterEach` cleanup; never the live workspace ledger.

### Constraints

- `mcp-server/docs/agents/project-manifest/constraints-testing.md` governs test conventions.
- Root `AGENTS.md` → Cross-Platform Policy rule 5: no hardcoded Unix paths; use `os.tmpdir()`.

---

## Area: Documentation

### Verified References

- Root `AGENTS.md` (L257–L280): `## 🔗 Cross-System Dependencies` — a three-column table
  (`Dependency` | `Source of Truth` | `Must Stay In Sync With`). Two rows are directly adjacent to
  this work: **"Per-store `.repositories.json`"** (names every reader/writer of the file, including
  `orchestrator/src/utils/store_resolution.py`) and **"`.ledger/settings.json` ↔ registry identity
  and the output contract"**.
- Root `AGENTS.md` (L84–L122): Manifest Maintenance Rules. Relevant rows — "Add new class/service" →
  `api-surface.md` + `file-tree.md`; "Modify public method signature" → `api-surface.md`;
  "Change data flow" → `data-flows.md`; "Change anything under `mcp-server/gui/`" → the GUI's own
  manifest; "Add constraint/convention" → the matching `constraints-*.md`.
- Root `AGENTS.md` (L216): notes the `claude-md-companion` guard — relevant only if a new
  `AGENTS.md` were added, which this work does not do.
- `changelog.md` (root, L1–L12) and `mcp-server/changelog.md` (L1–L15): the root entry is the
  Git-tagged release and references module versions via a `> mcp vX · personas vY` line; module
  changelogs carry the detail. Cross-System Dependencies row "Changelogs" and "Version (MCP server)"
  (root `AGENTS.md`) bind `mcp-server/changelog.md` → `mcp-server/package.json` via
  `npm run sync-version`.
- `mcp-server/docs/agents/project-manifest/` — five constraints documents, cited by heading not number.
- `mcp-server/gui/docs/agents/project-manifest/` — the GUI's own manifest set.
- `.ledger/README.md` — user-facing description of the declaration folder and the
  `settings.json` / `settings.local.json` split.

### Established Patterns

- Cross-System Dependencies rows are exhaustive prose listing every consumer by file path and symbol.
- Manifests are treated as authoritative over code ("if implementation code contradicts a manifest,
  the code is likely wrong" — `AGENTS.md` L32).

### Constraints

- `orchestrator/src/utils/store_resolution.py` (L3–L9, L31) reads `.repositories.json` with plain
  stdlib `json` and only inspects `folder_names` — **verified tolerant** to a new entry field, so no
  orchestrator code change is required. It must still be named in the updated dependency row.

---

## Strategic Context

**Retrieved live.** The `central_pm` MCP server is reachable (v2.10.0);
`ledger_get_repository_context`, `ledger_search_insights` and `ledger_list_insights` were all called
directly. This section replaces the earlier off-disk substitute.

**Strategic vision** (live, via `ledger_get_repository_context` — identical to the on-disk
`.ledger/strategic-vision.md` copy read during the degraded pass, so no conclusion below changed):

- *Short term* — "make the whole project as easy as possible to set up and use by developers.
  Onboarding and daily usage must offer as little friction as possible." This work is squarely a
  short-term-goal feature: it answers "did my `ledger init` actually work?" at the moment the user
  asks it, and makes the answer visible without a terminal.
- *Mid term* — end-user documentation and persona-design awareness now that the repository is public.
  Bearing on scope: the badge must be self-explanatory without documentation, and the public-repo
  consent posture around `.ledger/` outputs must not weaken.
- *Long term* — "Personas First… All integrated tools exist only to support the personas." A GUI
  status badge is a supporting affordance and should stay proportionate — a field and a badge, not a
  subsystem. This reinforces keeping the GUI "Declare…" action out of scope.

**Prior project context.** `2026-09-17-ledger-project-declaration-rework-1` is **COMPLETE** — it
removed the workspace's last IDE-specific advisory from `ledger init`/`edit` and codified the
Tool-Agnostic Policy in `AGENTS.md`. That policy binds the badge and any new CLI output introduced
here. The repository has 199 recorded projects.

**Insights — live retrieval (16 repository-scoped, plus global-scope searches):**

- `d6f8fa4d` — **does not exist.** Absent from the full repository-scoped listing and from
  global-scope search. It is cited as a binding insight in `scripts/tests/ledger-project.test.js` L15
  and in the archived `2026-09-16-ledger-project-declaration` plan — with two *different* claims
  attributed to it across those two sites. The underlying test-isolation constraint is real and lives
  in `mcp-server/docs/agents/project-manifest/constraints-testing.md`; cite that document instead.
  Raised for the Curator in the plan's *Knowledge Base Reconciliation*.
- `14827914` (2026-09-17, **created after the superseded brief**) — *"Core/shell split is the
  established convention for interactive root-level CLI verbs."* Binding and **confirming**: the CLI
  write-back belongs in `scripts/ledger-project.js`, not `ledger-project-core.js`, which is what the
  plan already specified.
- `b1a0f887` / `8b900521` (global, 2026-09-17, **created after the superseded brief**) — *"drop
  `.default()` from the local-file schema variant when merging partial config over a base config."*
  Binding on the `baseSettings` work: it independently validates exposing the un-merged base parse
  and constrains where defaults may be applied.
- `f13a8d1a` (global, 2026-09-17) — layered path-traversal guards ahead of writes into a consumer's
  file tree. **Not binding**: this plan writes only to the registry under `~/.ai-insights/`.
- `acc856a9` — *"The `project_summary` field is the canonical template for new agent-curated
  optional fields."* Partially applicable: the precedent for optional+nullable storage fields, which
  the `declaration` field follows.
- `dd78cc67` — *"`writeProjectMeta()` two-phase spread…"* **Not binding** — it applied only to the
  rejected project-level `.meta.json` branch. `writeProjectMeta()` is untouched here.
- `f389f9ce` — *"Use plain-function modules (not classes) for stateless storage helpers."* Binding on
  the new registry mutator, and names `repository-registry.ts` as the canonical reference.
- `8f882784` — `repository_name` display-casing invariant in `gui/api.ts`. Worth knowing for the GUI
  work, though this plan adds no new repo-name derivation site.
- `53454e24` — run `ctx generate` after editing `docs/agents/project-manifest/` files. Binding on the
  documentation step.

No stored insight describes `loadRegistry()`'s failure-swallowing behaviour, the `saveRegistry()`
lock scope, or `handleUpdateRepo()`'s enumerate-don't-spread construction — all three are
load-bearing facts for this work and are candidates for capture at synthesis time.
