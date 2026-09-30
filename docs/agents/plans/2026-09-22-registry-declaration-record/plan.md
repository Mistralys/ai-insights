# Plan

## Plan Audit Cycles
- Audits: 5 — Plan Auditor v1.9.3
- Architectural Reviews: 2 — Plan Architect Reviewer v2.3.3
- GUI/UX Reviews: 1 — Web GUI Specialist (Slice 4 only)

## Prior Project Context

**Strategic alignment.** The live `strategic_vision` matches the on-disk copy the offline pass used,
word for word, so no design conclusion drawn from it changes. The repository's short-term goal is
minimum-friction onboarding and daily use. This feature answers "did my `ledger init` actually
work?" at the moment the user asks it, with no terminal round-trip — squarely on that goal. The
long-term "Personas First / integrated tools exist only to support the personas" principle bounds
the ambition: this ships a registry field and a badge, not a subsystem, which is the main reason the
GUI "Declare…" action stays deferred.

**Binding prior outcome.** `2026-09-17-ledger-project-declaration-rework-1` (COMPLETE) codified the
**Tool-Agnostic Policy** in root `AGENTS.md`. No surface introduced here may name or depend on a
specific IDE or agent harness.

**Newly visible insight — `14827914` (created 2026-09-17).** *"Core/shell split is the established
convention for interactive root-level CLI verbs."* `scripts/lib/ledger-project-core.js` stays pure —
classification and defaulting, no prompting, no I/O — with side effects living in the shell. This
**confirms the plan as written**: the *Pattern Alignment* bullet already places the CLI write-back in
`scripts/ledger-project.js` rather than the core module. The insight promotes that from a reading of
one module's doc comment to a settled, twice-applied convention. No redesign follows.

**Newly visible insight — `b1a0f887` / `8b900521` (global, created 2026-09-17).** *"Zod
partial-over-base config merges: drop `.default()` on the local/override schema."* Applying a default
on both the base and the local schema variant makes "explicitly false" indistinguishable from "not
mentioned", silently clobbering a base `true`. This bears directly on **step 3**, which exposes
`baseSettings` un-merged so repository-level facts are read from `settings.json` alone, and on the
`outputs_enabled` derivation that consumes it. The insight independently validates that design — it
names the un-merged read as the only point where the distinction survives — and adds one
implementation constraint: any default on a declaration-settings field must be applied once, after
the merge, never on the local schema variant.

**Newly visible insight — `f13a8d1a` (global, created 2026-09-17).** Layered allowlist → real-path
symlink-escape → directory-shape checks ahead of any write into a consumer's file tree. Not binding
here: this plan's writes target the registry under `~/.ai-insights/`, never a caller-configured path
in the working tree. Recorded so the non-applicability is a decision rather than an omission.

## Knowledge Base Reconciliation

No stored insight makes a claim that this plan's *code* changes would invalidate. Insight `dd78cc67`
(`writeProjectMeta()` two-phase spread semantics) was binding only on the *rejected* project-level
`.meta.json` branch; this plan does not touch `writeProjectMeta()`, so it remains accurate.
Insight `14827914` (CLI core/shell split) and globals `b1a0f887` / `8b900521` (Zod partial-over-base
merges) are both *confirmed* by this plan rather than overtaken — the plan follows both.

Three load-bearing facts discovered during research are **not** in the knowledge base and are
candidates for capture at synthesis time (an addition, not a reconciliation, therefore owned by the
Ledger Knowledge Archiver v1.9.1, not the Curator): `loadRegistry()`'s total failure-swallowing;
`saveRegistry()`'s lock covering only its own write together with `proper-lockfile`'s
non-reentrancy; and `handleUpdateRepo()`'s enumerate-don't-spread entry reconstruction.

## Summary

Record, on each repository's entry in the per-store `.repositories.json` registry, that the
repository carries a committed `.ledger/` declaration — written by `ai-insights ledger init` and
`ledger edit` at the moment the user opts in, refreshed and back-filled opportunistically by
`ledger_get_repository_context` when it resolves a repository through the declared tier, and
surfaced as a read-only badge in the GUI Strategy table with a manual *Clear declaration* control in
the repository edit modal. The work is sequenced by risk: the schema change and a new lock-spanning
registry mutator land and are tested before any writer depends on them, because a mistake there
silently empties every existing user's registry.

## Architectural Context

The registry is a per-store JSON file, `{storePath}/.repositories.json`, described by
`RepositoryRegistrySchema` in `mcp-server/src/schema/repository-registry.ts` and read/written
exclusively through `loadRegistry()` / `saveRegistry()` in
`mcp-server/src/storage/repository-registry.ts`. Cross-store resolution is centralised in
`mcp-server/src/storage/repository-lookup.ts` (`findEntryInStores`, `listEntriesInStores`), both of
which return the owning `storePath` alongside the entry.

Three independent processes reach this file today. The **MCP server** reaches it through the storage
layer directly. The **GUI** reaches it through `mcp-server/gui/api-repos.ts`, whose five handlers are
wired into `buildRepoRoutes()` in `mcp-server/gui/server.ts`. The **root-level CLI**
(`scripts/ledger-project.js`) reaches compiled `mcp-server/dist/` modules through
`scripts/lib/ledger-bridge.js` → `loadDistModule()` — the one sanctioned scripts → mcp-server
direction; the reverse is forbidden. A fourth reader, `orchestrator/src/utils/store_resolution.py`,
parses the file with stdlib `json` and inspects only `folder_names`.

The project-side declaration is `{projectRoot}/.ledger/settings.json`
(`ProjectSettingsSchema`), loaded and merged with the machine-local, gitignored
`settings.local.json` by `loadProjectDeclaration()` in
`mcp-server/src/storage/project-declaration.ts`. `resolveRepositoryIdentity()` in
`mcp-server/src/utils/repository-identity.ts` implements the three-tier
`explicit → declared → derived` contract and, on the declared tier, hands back a `DeclaredIdentity`
carrying `projectRoot`, merged `settings`, the matched `entry`, and the owning `storePath`.
`mcp-server/src/tools/repository-context.ts` is that contract's only consumer today and is currently
a pure reader.

The GUI Strategy table is built by `buildTableHtml()` in
`mcp-server/gui/public/views/strategy.js`, which renders one status badge per row via
`visionStatus(repo)` and opens `renderRepoModal()` for edits. Its data comes from `handleListRepos()`
→ `toListItem()` → the `RepoListItem` interface in `mcp-server/gui/api-repos.ts`.

## Approach / Architecture

An optional, nullable `declaration` record is added to `RepositoryEntrySchema`. Its three states are
intentional: an omitted key means a legacy or not-yet-recorded declaration and is eligible for
declared-tier back-fill; `null` means the user explicitly cleared the ledger's assertion and must
not be recreated by observation alone; an object is an asserted, refreshable record. `init` and
`edit` deliberately replace either omission or `null` with a new assertion, because those commands
are fresh user opt-in.

All registry mutations funnel through one lock-spanning registry primitive, so neither the new
writers nor existing GUI partial writers can overwrite a snapshot loaded before another writer's
commit:

1. **The declaration workflow (primary).** `ledger init` and `ledger edit` already resolve the
   registry entry *and* its owning store before writing `settings.json`. After a successful write,
   each sets `declaration` on that entry. This is what makes the badge appear at the instant the user
   opts in.
2. **The repository-context tool (freshness and back-fill).** When `resolveRepositoryIdentity()`
  returns `source: 'declared'`, the server has first-hand filesystem proof that a declaration
  exists and resolves to a specific entry in a specific store. It stamps `last_seen_at`, throttled
  to at most once an hour, and populates the entire record only when its key is omitted. It never
  overwrites `null`, because that is an explicit clear. The back-fill is what makes the badge
  correct on day one for every repository declared before this ships — including this workspace —
  rather than only after someone re-runs `init`.

`mcp-server/src/storage/repository-registry.ts` gains a lock-held
`mutateRegistry(storePath, mutator)` primitive whose `withLock(storePath, …)` spans the whole
reload → validate-invariants → mutate → validate/sort/write sequence. The entry-focused
`updateRepositoryEntry(storePath, id, mutator)` delegates to it for the CLI, tool, and clear
operation. Its discriminated result distinguishes `updated`, `unchanged`, and `not_found`, so a
caller that resolved an owner before acquiring the mutation lock cannot mistake a deleted or moved
entry for a successful write. GUI create, update, and delete use `mutateRegistry()` directly so their registry-wide
folder-name checks see the locked snapshot; cross-store move uses a dedicated storage-level
two-store mutation that acquires both store locks in deterministic path order before reloading
either registry. Because `proper-lockfile` locks are not reentrant, the existing `saveRegistry()`
cannot be called from inside either primitive; its validate-sort-write body is first extracted into
an unlocked internal function shared by `saveRegistry()` and the mutation primitives.

The GUI exposes the record on `RepoListItem` and on `handleGetRepo()`'s response, renders it as a
dedicated table column, and offers a `DELETE /api/repos/:repoId/declaration` endpoint behind a
*Clear declaration* control in the edit modal — the only un-declaration path that exists in this
phase, since nothing in the system can observe a `.ledger/` folder being deleted.

Two correctness fixes ride along because the change lands directly on top of them: `handleUpdateRepo()`
is changed from enumerate-the-fields to spread-then-override inside the locked registry callback
(without which every GUI repository edit would silently erase the new field), and `lookupEntryById()` in `scripts/ledger-project.js` is
changed to return the owning `storePath` alongside the entry (without which the `edit` write-back
cannot target the correct store in multi-store mode).

## Rationale

**Why the repository level.** `.ledger/settings.json` is committed repository content — verified in
this repository, where `git ls-files .ledger` returns `settings.json`, `README.md`, and
`strategic-vision.md`, with only `settings.local.json` gitignored. The declaration therefore travels
in the commit graph and is identical in every clone at a given commit. It is not a property of a
checkout. What *does* vary per clone — the absolute path, mirror freshness, machine-local output
overrides — is exactly what the registry does not and must not hold.

**Why a record rather than a boolean.** `outputs_enabled` is the sub-fact most likely to be wanted
next (it is what a future GUI "Declare…" flow would prefill), and `last_seen_at` is what keeps an
asserted claim honest. Retrofitting either onto a boolean means a second schema migration through the
same silent-wipe hazard. The extra cost now is three JSON keys.

**Why the field must be optional *and* nullable.** `loadRegistry()` catches every failure — missing
file, malformed JSON, and schema validation failure alike — and returns `{ repositories: [] }` with
nothing logged. A required field would make every pre-existing `.repositories.json` in the world read
as an empty registry, in the GUI, in the CLI, and in the MCP tools simultaneously, with no error
anywhere. This is the single most dangerous mistake available in this change and it is silent.

**Why a registry-wide mutation primitive rather than an entry-only mutator.** `saveRegistry()`
holds `withLock` only around its own write. A caller that loads, mutates and saves has an unguarded
window in between. An entry-only helper would protect the CLI and tool while leaving GUI handlers
able to load an old full registry and later replace the file, erasing the new declaration despite
the helper. The GUI update path also validates folder-name uniqueness against siblings, which is a
registry invariant rather than an entry concern. A lock-held registry callback is therefore the
smallest boundary that makes every partial writer observe and modify one current snapshot;
`updateRepositoryEntry()` remains the focused convenience wrapper for callers that truly need only
one entry.

**Why `undefined` and `null` must remain distinct.** Omission is the only state the server cannot
distinguish from a pre-feature registry, so it is the only state eligible for automatic back-fill.
`null` is written solely by the user's Clear action and is an intentional suppression, not missing
data. Treating them alike would make the next declared-tier context lookup silently reverse the
user's action while the declaration file still exists. That distinction must be evaluated inside the
lock-held mutation callback, not from `DeclaredIdentity.entry`, which is an earlier lookup snapshot:
by the time the callback runs, a concurrent Clear may have changed the current record to `null`.
A tombstone object would add audit history that no present consumer needs; JSON's existing
optional-versus-null distinction is sufficient when the decision is made against the lock-current
entry.

**Why the server writer is worth the cost of a write on a read path.** Without it the feature is
retroactively blind: every repository declared before this ships shows nothing until someone re-runs
`init` in it, which most users have no reason to do. A throttled, best-effort, failure-swallowed
write is a proportionate price for a badge that is correct on the day it ships. This mirrors an
established precedent rather than inventing a new shape: `getProjectStatus()` in
`mcp-server/src/tools/project-lifecycle.ts` (L405–L460) already self-heals on read — re-deriving and
writing a repaired value under a single lock, inside a `try`/`catch` that swallows the write failure,
without changing its response contract — for `ledger_version` back-fill and `synthesis_generated_at`
repair; this plan applies the same shape to the registry. Two alternatives were weighed and rejected
on structural, not merely cost, grounds. A one-time batch script following
`scripts/backfill-duration.js`'s convention would still require every user to invoke it manually,
since `.repositories.json` is per-user and per-store and therefore never centrally reachable by a
maintainer-run migration, and it would still leave ongoing `last_seen_at` freshness unsolved, so two
mechanisms would ship instead of one. A GUI-triggered backfill (for example on `handleListRepos()`)
is structurally impossible today, because `RepositoryEntry` deliberately carries no per-entry path
(see "Why the repository level" above) for the GUI backend to check against — it collapses into the
already-rejected live-filesystem check (*Rejected Approach — Branch A*).

**Why `outputs_enabled` must come from the base settings, not the merged ones.**
`DeclaredIdentity.settings` is `settings.json` with the machine-local, gitignored
`settings.local.json` deep-merged over it. Writing that into `.repositories.json` — a file that lives
*inside* a store and is explicitly modelled as synced across devices via `StoreSyncMetaSchema` —
would copy one machine's local output preferences into a portable artefact and show them on every
other machine. That is a smaller instance of exactly the failure the research document uses to reject
a path field on `RepositoryEntry`, and it deserves the same answer.

**Speculative-structure check.** Every new abstraction here has a named consumer in this plan:
`updateRepositoryEntry()` has two (the CLI shell and the tool); `baseSettings` has one (the server's
`outputs_enabled` derivation); the `declaration` record has three readers (`toListItem`,
`handleGetRepo`, `buildTableHtml`). Nothing is added on anticipation alone.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Where the fact lives | Optional, nullable `declaration` record on `RepositoryEntry` | (a) Project-level `ProjectMetaSchema` field, populated opportunistically — the superseded draft's approach; (b) live filesystem check at GUI request time via `inferProjectRootFromPlanPath(meta.plan_path)` — the superseded brief's Branch A; (c) no persistence, CLI output only | (a) answers a project-level question when the user asked a repository-level one, and shows nothing for a repository declared before any agent ran. (b) is analysed in detail below and fails on cross-device correctness, not on the absence of a path. (c) leaves the GUI, the one surface where the question is asked at a glance, unable to answer it. |
| Record vs. boolean | `{ schema_version, declared_at, last_seen_at, outputs_enabled }` | A bare nullable `declared_at: string`; a bare `declared: boolean` | The record's two extra keys cost nothing now; adding either of them later means a second pass through the silent-registry-wipe hazard for no gain. |
| Write primitive | New lock-held `mutateRegistry(storePath, mutator)` plus `updateRepositoryEntry()` as its entry-focused convenience wrapper; migrate every GUI partial writer | Callers keep hand-rolling `loadRegistry()` → mutate → `saveRegistry()`; an entry-only mutator while GUI writers remain deferred; or widen `saveRegistry()` itself to take a mutator | Hand-rolling leaves every whole-file snapshot vulnerable. An entry-only helper protects new writers but permits a GUI snapshot loaded before their commit to erase it later. Replacing `saveRegistry()` would blur whole-registry replacement with mutation; a sibling primitive preserves its current contract and makes the safe path explicit. |
| Mutation-time disappearance | Discriminated `updated` / `unchanged` / `not_found` storage results, translated to `ApiError('NOT_FOUND', ...)` by GUI handlers | Treat the pre-lock owner lookup as authoritative; return `null` and let each caller infer intent; retry a moved entry in its new store | The lookup is only a routing hint. A result from the locked snapshot makes deletion or movement while waiting observable and prevents stale callbacks from writing; automatic retries could mutate a repository after an explicit concurrent move, while a clear 404 tells the client its target no longer exists at the requested location. |
| Cross-store move | Dedicated storage-level two-store mutation with both locks acquired in deterministic normalized-path order, then both registries reloaded and validated while locked | Keep GUI move on two stale snapshots; compose two independent single-store mutations; optimistic version/CAS retry | A move is the one GUI operation that changes two registries, so neither independently locked writes nor stale preloads preserve its atomic invariant. Ordered two-lock acquisition prevents inverse-order deadlock and keeps source removal, destination collision validation, and insertion in one storage-owned operation; CAS adds persisted versions and caller retry policy disproportionate to the existing lock. |
| Lock composition | Extract the unlocked validate-sort-write body; `saveRegistry()`, `mutateRegistry()`, and the ordered two-store move operation call it | Call `saveRegistry()` from inside a mutation lock | `proper-lockfile` is not reentrant: the nested acquisition would retry against the outer lock 50 times and then throw. The nested form does not merely perform badly — it never succeeds. |
| Source of `outputs_enabled` on the server path | Base `settings.json` only, via a new `baseSettings` field on `ProjectDeclarationResult` | Use `DeclaredIdentity.settings` (merged); or omit `outputs_enabled` from the server writer entirely | Merged settings leak machine-local preferences into a cross-device-synced file. Omitting the field would leave every back-filled entry with an empty `outputs_enabled` that never self-corrects, defeating the point of the back-fill. |
| Back-fill / freshness mechanism | Throttled write inside `ledger_get_repository_context`'s declared-tier path, following `getProjectStatus()`'s self-heal-on-read shape | (a) A one-time batch script, following `scripts/backfill-duration.js`'s convention; (b) a GUI-triggered backfill (e.g. on `handleListRepos()`) | (a) requires manual per-user invocation, since `.repositories.json` is per-user and per-store and never centrally reachable by a maintainer-run migration, and still leaves ongoing freshness unsolved. (b) has no path source to check against — `RepositoryEntry` carries no path field — and collapses into the already-rejected live-filesystem check. |
| Un-declaration state | Manual *Clear declaration* control writes `declaration: null`; omitted remains legacy/unrecorded and eligible for back-fill | Treat `null` as equivalent to omitted; a tombstone record; automatic detection; a TTL that expires the record | `null` gives clear durable, conventional semantics without a new schema. Treating it as missing reverses a user action; a tombstone adds audit data without a consumer. Nothing currently observes folder deletion, while a TTL would silently create false negatives. Automatic detection becomes possible only with the deferred `workspaces.json` path map. |
| `ledger sync` as a third writer | No — `init` and `edit` only | Also stamp `last_seen_at` from `sync` | `sync` runs from `.githooks/pre-commit`. Adding a registry write there puts lock acquisition on the commit path for every commit in every declared repository, to refresh a field the server already refreshes. The cost lands on the most latency-sensitive surface in the system. |
| GUI placement | A dedicated `Declaration` column in the Strategy table | A second badge inside the existing Vision cell | Two unrelated status concepts in one cell read as one compound status. The table already renders a conditional `Store` column, so a conditional-free extra column is an established shape, not a new one. |
| Stale-variant date placement | Short badge text plus the date in a muted sibling span, formatted by the existing `formatDate()` | The full string `.ledger/ declared · last confirmed {date}` inside the badge; badge plus a `title` attribute holding the date; CSS truncation with an ellipsis | `.badge` is `text-transform: uppercase` and `white-space: nowrap` (`styles.css` L358–L368), so a date inside the pill renders uppercase and can never wrap or shrink — in a table that had no scroll container, that is unbounded horizontal growth. A `title` attribute hides the fact from touch and keyboard users; truncation hides the one value the stale variant exists to show. The muted sibling wraps, keeps the pill short, and stays in the accessibility tree. |
| Declaration badge colours | Reuse `badge-complete` / `badge-in-progress` | A dedicated `badge-declaration-*` variant with its own `--color-badge-*` token pair; `badge-neutral` / `badge-info` | A new variant means new tokens, dark-theme overrides, a `ui-components.md` row and a contrast decision this plan is not otherwise making. Reuse inherits the existing component's contrast unchanged and reads as the same fresh/attention scale users already know. The risk it carries — reading as one compound status with the adjacent `Vision` cell — is answered by a separate column header, the `.ledger/` prefix, and the manual check in AC-28 rather than by new colours. |
| Modal helper-text placement | Persistently visible beside the *Clear declaration* button | Only inside the `confirm()` dialog; a tooltip on the button | The consequence of clearing ("the `.ledger/` folder is untouched") is what the user needs *before* deciding. A confirmation dialog is read at the moment of commitment, often not at all, and a tooltip is unreachable on touch. Persistent text costs one muted span. |
| Malformed `declaration` shape | Render nothing, as an explicitly documented defensive default | Render a "declaration malformed" badge; log to the console; let the destructuring throw | The registry is user-writable JSON and this column is informational. A visible error badge asks the user to act on something with no GUI remedy; a throw inside the row builder takes the whole table down. Rendering nothing is the only outcome that cannot mislead — documented at the guard so a future reader does not read it as a missing branch (AC-25). |
| GUI payload field name | `declaration` | `declared` / `is_declared` | `RepoListItem.declared` already exists with a *different* documented meaning ("sourced from the registry, not discovered on the filesystem"), and its doc block instructs consumers to branch on it. Reusing the word would collide with a live contract. |

### Rejected Approach — Branch A, the live filesystem check

The superseded brief
(`docs/agents/plans/2026-09-16-ledger-declared-project-indicator/research-brief.md` →
`## Design Fork (for the Confirm phase)`) proposes checking the filesystem at GUI request time:
reach a project root via `inferProjectRootFromPlanPath(meta.plan_path)` and call
`findProjectRoot()` / `loadProjectDeclaration()` there. Its stated advantages are real — no schema
change, and a result that is always current rather than an aging claim. The new research document
dismisses it on the grounds that a repository-level badge has no path source, and then concedes that
`plan_path` is in fact a path source it dismissed too quickly. That concession is correct:
`inferProjectRootFromPlanPath` exists and is in active use at `mcp-server/gui/api.ts` L374, L639 and
L1817. **The approach is rejected here on different and stronger grounds.**

- **It is wrong on a synced store, which is a supported first-class configuration.**
  `plan_path` is an absolute path recorded by whichever machine created the project.
  `StoreSyncMetaSchema` (`mcp-server/src/schema/store-config.ts`) exists precisely so a store can be
  synced across devices, and `.repositories.json` and the project directories live inside that store.
  On the second device, `inferProjectRootFromPlanPath` yields a path that does not exist, the check
  finds no `.ledger/`, and the badge reports *not declared* for a repository that unambiguously is.
  A cached claim degrades to "possibly stale"; a live check against another machine's path degrades
  to "confidently wrong", which is worse in a UI.
- **The level mismatch is real, not merely awkward.** The Strategy table lists repositories. To
  answer per repository, the GUI would have to enumerate that repository's projects, infer a root per
  distinct `plan_path`, and walk ancestors for each — a per-row fan-out over project metadata, for
  every row, on every table load. And a repository with zero projects — the exact state right after
  `ledger init`, which is the moment the user most wants the answer — has no `plan_path` at all and
  is unanswerable by construction.
- **It cannot be written from where the truth is known.** The one process standing in the working
  tree with certainty is `ledger init`. A live check throws that certainty away and tries to
  reconstruct it later from a weaker signal.

**They are not exclusive, and the complement is deliberately deferred rather than rejected.** A live
verification pass is the right way to detect *un*-declaration, which the cached record genuinely
cannot do. It becomes correct once a machine-local, per-device path is available — which is precisely
what the deferred `~/.ai-insights/workspaces.json` map (research document, *Evaluated & Redirected*)
provides. Building it now, on `plan_path`, would mean building it on the one path source that is
wrong in the cross-device case, and then rebuilding it. It is recorded in *Deferred Items* with that
gate named.

## Pattern Alignment

- **Optional + nullable enrichment fields on a storage schema** — follows `project_summary` / `title`
  in `mcp-server/src/schema/project-meta.ts`.
- **Field-by-field doc-comment block on the entry schema** — follows
  `mcp-server/src/schema/repository-registry.ts` L19–L38; the new field gets its own entry there.
- **Un-merged base settings for repository-level facts; defaults applied once after the merge** —
  follows global insight `b1a0f887` / `8b900521`: a `.default()` on the local/override schema variant
  makes "explicitly false" indistinguishable from "not mentioned". Step 3's `baseSettings` is the
  point where that distinction survives.
- **No `.refine()` / `.transform()` on schemas; format validation in the storage layer** — follows
  `mcp-server/src/schema/project-declaration.ts` L15–L18 and the existing plain-`z.string()`
  treatment of `created_at` / `last_modified`.
- **Plain exported functions with an explicit `storePath` first parameter** — follows every function
  in `mcp-server/src/storage/repository-registry.ts`.
- **Discriminated-union `{ kind, … }` results over thrown exceptions for expected rejections** —
  followed by `ProjectDeclarationResult`'s unchanged shape; the new `baseSettings` field is additive
  to the existing `declared` variant.
- **Root scripts reach mcp-server only through `loadDistModule()`** — the CLI write-back adds a new
  bridge accessor alongside the existing `getLedgerRoot()` / `getOutputSchema()` /
  `lookupEntryById()`, and imports nothing from `mcp-server/src/` directly.
- **CLI core/shell split** — the write-back is a side effect and therefore belongs in
  `scripts/ledger-project.js`, not `scripts/lib/ledger-project-core.js`, per that module's doc
  comment (L1–L36) and insight `14827914`, which records the core/shell split as a settled,
  twice-applied convention (`launch-agent-core.js`, then `ledger-project-core.js`) rather than a
  local choice.
- **One GUI handler per route, wired declaratively in `buildRepoRoutes()`** — the new
  `handleClearRepoDeclaration()` follows `handleMoveRepo()`'s sub-resource shape.
- **Client-side ES5 browser JS with `escapeHtml()` on every interpolated value, badges as small pure
  string-returning functions** — the new `declarationStatus(repo, staleAfterMs)` mirrors
  `visionStatus(repo)` in shape.
- **One shared date formatter for the whole client** — the badge reuses `formatDate()`
  (`mcp-server/gui/public/utils.js` L26–L50) rather than adding a second formatter to `strategy.js`,
  which has none today.
- **Wide tables live inside a `.table-wrapper` scroll container** — follows `project-list.js` L258,
  `config-stores.js` L149, `config-model-registry.js` L181 and `project-detail.js` L773; the Strategy
  table is currently the exception and step 12 brings it into line.
- **No hardcoded badge colours; every variant is a documented `--color-badge-*` token pair** —
  follows `mcp-server/gui/docs/agents/project-manifest/ui-components.md` § Badge Colour Tokens. This
  plan reuses two existing variants and adds no token, so that table needs no new row.
- **Destructive GUI actions confirm through the native `confirm()` dialog** — follows
  `project-list.js` L564/L568, `config-stores.js` L530 and `config-model-registry.js` L580.
- **Tool `_internal` export for unit-testing private functions** — the throttled refresh function is
  added to `repository-context.ts`'s existing `_internal` object.

**Deliberate departures:**

- **A REST sub-resource with `DELETE` rather than `POST`.** The only existing sub-resource route is
  `POST /api/repos/:repoId/move`. `DELETE /api/repos/:repoId/declaration` is used instead of
  extending `RepoUpdateBodySchema` with a nullable `declaration` field, because that would make the
  field writable by the general update route and invite a client to assert a declaration the server
  has no evidence for. Clearing is the only client-initiated mutation this field permits, and a
  `DELETE` on the sub-resource says exactly that.
- **A file-scope badge helper in a view whose sibling helpers are closure-scoped.**
  `visionStatus()` and `buildTableHtml()` sit inside `renderStrategyList()`'s body, which is why no
  suite asserts on Strategy rendering today. `declarationStatus()` is declared at file scope instead
  — the shape `project-list.js`'s `buildTable()` already uses and the only one a
  `vm.runInThisContext` suite can reach. The threshold is passed in rather than closed over, so the
  function remains pure and the departure buys testability without loosening encapsulation.
- **A write on a read-path MCP tool.** `mcp-server/src/tools/repository-context.ts` is documented as
  read-only and `buildMirrorField()` states it explicitly. The departure is bounded to the registry
  (never the working tree), throttled, and failure-swallowed, and both doc comments are updated in
  the same change to say so rather than being left contradicting the code.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/storage/repository-registry.ts` — `saveRegistry()` | The validate-sort-write body is inseparable from its lock acquisition, so no locked composite operation can reuse it; `proper-lockfile` is non-reentrant, so nesting is not an option | Promoted to step 2 | Required for correctness, not cleanliness: without the extraction, `updateRepositoryEntry()` cannot be implemented at all. |
| `mcp-server/gui/api-repos.ts` — `handleUpdateRepo()` L529–L536 | Rebuilds the entry by explicit field enumeration with no `...existing` spread, so any new schema field is dropped on every GUI edit; `handleMoveRepo()` 100 lines below already uses the safe spread form | Promoted to step 9 | Directly inside the blast radius — without it the feature is broken by the second thing a user does in the GUI. Aligning it with `handleMoveRepo()` also removes a standing trap for every future entry field. |
| `scripts/ledger-project.js` — `lookupEntryById()` L121–L126 | Discards `found.storePath` from `findEntryInStores()`, leaving the `edit` and `sync` paths unable to name the store that owns the entry | Promoted to step 6 | Required by the `edit` write-back's multi-store targeting (critical risk 4). Two call sites, both in this file. |
| `mcp-server/src/storage/project-declaration.ts` — `loadProjectDeclaration()` | Computes the un-merged base settings internally but returns only the merged result, leaving callers no correct source for repository-level (as opposed to machine-local) declaration facts | Promoted to step 3 | Required by the server writer's `outputs_enabled` derivation. Additive to the existing `declared` variant, so no caller changes. |
| `mcp-server/src/schema/repository-registry.ts` — entry doc block | Records what each field *is*, but nothing about what may not be added; the research document's "paths belong to the `~/.ai-insights/` tier" conclusion has nowhere to live | Promoted to step 1 | A one-paragraph doc comment, written while the reasoning is fresh, is the whole cost of keeping a deliberately-shut door visibly shut. |
| `mcp-server/gui/api-repos.ts` — all four mutating handlers | Each repeats `findEntryInStores` → `loadRegistry` → mutate → `saveRegistry` with no lock spanning the sequence, so a GUI snapshot loaded before a CLI or tool write can later erase the new declaration | Promoted to step 9 | This is the same data-loss class step 2 exists to remove, not a separable refactor. `handleUpdateRepo()` already needs registry-scoped folder-name validation, and cross-store move needs coordinated source/destination updates; the storage boundary must own both rather than leave an intentional stale-writer escape hatch. |
| `mcp-server/gui/public/views/strategy.js` — `buildTableHtml()` table markup | Emits a bare `<table class="data-table">` with no `.table-wrapper`, unlike every other wide table in the GUI; `data-table` itself has no CSS rule anywhere, so the table is styled only by the bare `table` selector (`styles.css` L519) | Promoted to step 12 | The new column carries a `white-space: nowrap` badge, so this plan is what makes the missing scroll container visible — the table would overflow the page instead of scrolling in its card. One wrapping `<div>` reusing an existing class (AC-26). The unused `data-table` class is left in place: removing it is unrelated cleanup and the conflicts table at L318 also carries it. |
| `mcp-server/gui/public/views/strategy.js` — `visionStatus()` at L67 | Closure-scoped inside `renderStrategyList()`, therefore unreachable from a `vm.runInThisContext` suite — the reason no test asserts Strategy badge rendering today | **Rejected** | Hoisting it would change a function this plan does not otherwise touch, and it closes over nothing, so the move is pure churn with a re-render risk. The new `declarationStatus()` is declared at file scope instead, which gives the plan's own badge the testability it needs without editing the neighbour. |
| `mcp-server/gui/public/views/strategy.js` — `buildTableHtml()` row builder | Inlines column construction and header arithmetic, so each new per-row status concept edits three places (header, declared-row branch, undeclared-row branch) | **Rejected** | A column-descriptor refactor of this function is a self-contained readability improvement with no bearing on this feature's correctness, and it would rewrite the single most visually-reviewed function in the view for a one-column addition. Adding one column the way the `Store` column was added stays within the established shape. |

## Detailed Steps

### Slice 1 — Schema and locked mutator

1. **Add the `declaration` field to `RepositoryEntrySchema`**
   (`mcp-server/src/schema/repository-registry.ts`).
   - Define and export `RepositoryDeclarationSchema`:
     `schema_version: z.literal(1)`, `declared_at: z.string()`, `last_seen_at: z.string()`,
     `outputs_enabled: z.array(OutputIdSchema)`. Import `OutputIdSchema` from
     `./project-declaration.js` so the two can never drift. Export the inferred
     `RepositoryDeclaration` type.
   - Add `declaration: RepositoryDeclarationSchema.nullable().optional()` to
     `RepositoryEntrySchema`. **Both modifiers are required** — `.optional()` so a legacy file with
     no key parses, `.nullable()` so *Clear declaration* can write an explicit `null` that survives a
     round-trip.
   - Extend the entry's field-by-field doc block (L19–L38) with a `declaration` entry stating: the
     record is an asserted claim with provenance, not an observation; `declared_at` is when the
     declaration was first *recorded* by whichever writer reached it first (the server's back-fill
     has no way to know when the user actually ran `init`); `last_seen_at` is refreshed only by
     first-hand filesystem evidence; `outputs_enabled` reflects committed `settings.json` only, never
     `settings.local.json`.
   - Add a paragraph to the schema's module or entry doc recording that **absolute filesystem paths
     must never be added to this entry** — `.repositories.json` lives inside a store and stores are
     modelled as synced across devices (`StoreSyncMetaSchema`, `mcp-server/src/schema/store-config.ts`),
     so a path is wrong on the second machine. Path-shaped facts belong at the `~/.ai-insights/` tier
     beside `stores.json`.
   - Do **not** add `.strict()` to `RepositoryEntrySchema`; unknown-key stripping is the current,
     relied-upon behaviour.

2. **Add lock-spanning registry mutation primitives** (`mcp-server/src/storage/repository-registry.ts`).
   - Extract the current body of `saveRegistry()` (validate → sort by `id` → `atomicWriteJson`) into
     a module-private `writeRegistryUnlocked(storePath, registry)`. Re-implement `saveRegistry()` as
     `withLock(storePath, () => writeRegistryUnlocked(storePath, registry))` — its public behaviour
     and signature are unchanged.
   - Add and export a synchronous-callback `mutateRegistry(storePath, mutator)` primitive. It acquires
     `withLock(storePath, …)`, reloads the registry only after the lock is held, passes the current
     registry to the callback for all registry-wide validation and mutation, then validates, sorts,
     writes through `writeRegistryUnlocked()`, and returns the callback's result. It is the required
     path for single-store partial mutations; callers must not retain or later save a registry snapshot
     read before this callback runs.
   - Add and export a discriminated entry-mutation result:
     ```
     type UpdateRepositoryEntryResult =
       | { kind: 'updated'; entry: RepositoryEntry }
       | { kind: 'unchanged'; entry: RepositoryEntry }
       | { kind: 'not_found' };
     ```
     `updated` means this call wrote a replacement, `unchanged` means the entry was present but the
     callback deliberately made no change (so the primitive performs no write), and `not_found`
     means the id was absent from the registry reloaded while the lock was held. This result is the
     contract for all callers that performed an earlier owner lookup; that lookup selects a store but
     does not prove the entry still exists when mutation begins.
   - Add and export:
     ```
     updateRepositoryEntry(
       storePath: string,
       id: string,
       mutator: (entry: RepositoryEntry) => RepositoryEntry | undefined
     ): Promise<UpdateRepositoryEntryResult>
     ```
     Implement it as an entry-focused convenience wrapper over `mutateRegistry()`: find the entry by
     `id`, return `{ kind: 'not_found' }` without writing when absent, otherwise apply `mutator` to a
     copy. A callback result of `undefined` returns `{ kind: 'unchanged', entry }` without writing;
     a replacement is parsed, installed, written, and returned as `{ kind: 'updated', entry }`.
     This lets the repository-context refresh decide whether to write from the lock-current entry
     rather than from a snapshot captured before the lock.
   - Add and export a storage-level cross-store move operation, with a name and result shape matching
     the existing move handler's needs. Normalize and lexically order the two distinct store paths,
     acquire both `withLock` locks in that order, reload both registries only after their locks are
     held, validate destination folder-name conflicts against the current destination registry, remove
     from the source, add the spread-preserved entry to the destination, and write both through
    `writeRegistryUnlocked()`. Its result must likewise distinguish `moved`, `unchanged` for a
    same-store no-op, and `not_found` when the source entry is absent after both locks are acquired;
    a destination id/folder conflict remains the existing validation failure. A same-store move
    delegates to `mutateRegistry()` rather than taking the same lock twice and returns `not_found`
    when its lock-current source entry is absent.
   - Document that all mutation callbacks are synchronous and side-effect-free: they run while one or
     two locks are held, so I/O extends the critical section, and `withLock`'s 10-second stale timeout
     bounds how long that can safely be. Also document that neither primitive may be invoked from
     inside another lock on the same path, naming `proper-lockfile`'s non-reentrancy and ELOCKED
     failure as the reason.

### Slice 2 — CLI write-back

3. **Expose base settings from the declaration loader**
   (`mcp-server/src/storage/project-declaration.ts`).
   - Add `baseSettings: ProjectSettings` to the `declared` variant of `ProjectDeclarationResult`,
     populated from the already-computed base parse result before the local merge. Document it as
     "`settings.json` alone, with no `settings.local.json` merged in — use this, never `settings`,
     for any fact recorded at the repository level."
   - Return it from both `declared` return sites (the early return when no local override exists, and
     the post-merge return). Existing callers are unaffected — the field is purely additive.
   - Per global insight `b1a0f887` / `8b900521`: do not add a `.default()` to any field on the
     local/override schema variant. A default there fabricates the value during parsing of an
     override that never mentioned the field, so "explicitly false" and "not mentioned" become
     indistinguishable and a base `true` is silently clobbered. Apply any default exactly once,
     after the merge (`merged.field ?? fallback`). This is what makes `baseSettings` a trustworthy
     source for the `outputs_enabled` derivation in the server writer.

4. **Carry base settings through the identity resolver**
   (`mcp-server/src/utils/repository-identity.ts`).
   - Add `baseSettings: ProjectSettings` to the `DeclaredIdentity` interface, with a doc comment
     pointing at step 3's rule, and populate it from `declResult.baseSettings` in the `declared`
     branch.

5. **Add a shared declaration-record builder** (new module,
   `mcp-server/src/storage/repository-declaration.ts`).
   - Export `enabledOutputIds(settings: ProjectSettings): OutputId[]` — the enabled output ids from a
     settings object, in `OUTPUT_IDS` order so the array is stable and two writers never produce
     diff-noise from ordering alone.
   - Export `applyDeclaration(entry, { outputsEnabled, now }): RepositoryEntry` — returns a copy with
     `declaration` set, preserving an existing `declared_at` and setting it to `now` when the record
     is omitted or `null`, and always setting `last_seen_at` to `now`. Its callers are only explicit
     `init` / `edit` opt-in and the omitted-key server back-fill; the refresh branch must never call it
     for `null`, so a Clear action remains durable until the user opts in again.
   - Export `DECLARATION_REFRESH_THROTTLE_MS = 60 * 60 * 1000` and
     `DECLARATION_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000`, each with a doc comment stating the
     value is a starting estimate and naming what evidence would change it.
   - **Consumers:** step 7 (CLI), step 8 (server refresh), step 12 (GUI badge threshold, which reads
     `DECLARATION_STALE_AFTER_MS` through the API layer, not by re-deriving it). This module exists
     so the three writers/readers share one definition of "what a declaration record looks like"; it
     is the alternative to the same three-line object literal appearing in `scripts/`,
     `src/tools/`, and `gui/`.

6. **Preserve the owning store path in the CLI's entry lookup**
   (`scripts/ledger-project.js`).
   - Change `lookupEntryById()` to return `found` (`{ storePath, entry }`) or `null` rather than
     `found.entry`, and rename it to `lookupEntryWithStore()` to make the shape change visible at
     both call sites.
   - Update `runEdit()` (L591) and `runSync()` (L759) to destructure. `runSync()` needs `entry` only;
     it changes shape but not behaviour.

7. **Write the declaration record from `init` and `edit`** (`scripts/ledger-project.js`).
   - Add a bridge accessor `getRegistryWriters()` returning `updateRepositoryEntry` from
     `storage/repository-registry.js`, and an accessor for
     `storage/repository-declaration.js`'s `enabledOutputIds` / `applyDeclaration`, both via
     `loadDistModule()`.
   - Add one shared, non-exported helper in this file,
     `recordDeclaration({ storePath, entry, settings, log, errorLog })`, which computes
     `enabledOutputIds(settings)`, calls `updateRepositoryEntry(storePath, entry.id, …)` with
     `applyDeclaration`, and logs a one-line confirmation naming the repository id.
   - **Best-effort semantics:** wrap the call so a registry write failure prints a warning naming the
     store path and the reason, and leaves the verb's exit code unchanged. The user's
     `settings.json` write has already succeeded at this point; failing the command afterwards would
     misreport a declaration that is in fact on disk.
   - Call it from `runInitNonInteractive()` after `writePlannedFiles(plan.files)` (L415), using
     `target.matched.storePath` and `target.matched.entry` — this path only ever proceeds past the
     `classification === 'matched'` check (the `ambiguous` and `unregistered` classifications already
     abort earlier there), so `target.matched` is always populated at this call site.
   - Call it from `runInitWizard()`'s equivalent write point. Unlike the non-interactive path, the
     wizard also handles `classification === 'ambiguous'` by prompting the user to pick a candidate,
     and `resolveInitTarget()` returns `matched: null` in that branch — the wizard's existing
     `matchedEntry` variable narrows `target.candidates[chosenIndex].entry` down from the candidate
     object, discarding that candidate's `storePath` the same way `lookupEntryById()` discards it in
     step 6. Introduce a companion `matchedStorePath` variable, set alongside `matchedEntry` in both
     branches — `target.matched.storePath` in the `matched` branch,
     `target.candidates[chosenIndex].storePath` in the selection branch — and pass
     `matchedStorePath` (never `target.matched.storePath` directly) into `recordDeclaration()` from
     the wizard's write point.
   - Call it from `finalizeEdit()` after `writeSettingsOnly()` and before `performSync()`.
     `finalizeEdit()` is the single choke-point both `edit` shells pass through, so one call site
     covers both — but neither `storePath` nor `errorLog` is yet in scope there: step 6 only changes
     `runEdit()`'s own destructuring of `lookupEntryWithStore()`'s result, while
     `runEditNonInteractive()`, `runEditWizard()`, and `finalizeEdit()` all currently accept only
     `entry` (`runEditNonInteractive()` also already accepts `errorLog`, but `runEditWizard()` does
     not, and `runEdit()`'s own call to `runEditWizard()` does not pass it — following the
     `storePath`-only version of this instruction literally would leave `errorLog` `undefined` at
     the `recordDeclaration()` call site, throwing a `TypeError` the first time a registry write
     fails). Add a `storePath` parameter to all three functions' signatures, and add an `errorLog`
     parameter to `runEditWizard()`'s and `finalizeEdit()`'s signatures (the same function
     `runEditNonInteractive()` already receives). Thread both from `runEdit()`'s destructured
     `{ storePath, entry }` and its own `errorLog` down through
     `runEditNonInteractive(storePath, entry, …, errorLog)` (already received there, now also
     forwarded onward instead of stopping) and `runEditWizard(storePath, entry, …, errorLog)` to the
     `finalizeEdit()` call site, so the `recordDeclaration({ storePath, entry, settings, log,
     errorLog })` call inside `finalizeEdit()` receives both the correct owning store and a working
     failure-reporting function from either edit shell.
   - **Do not** write on `--dry-run`: `runInitNonInteractive()` returns at the dry-run branch before
     any write, and that ordering must be preserved.
   - **Do not** add any write to `runSync()` — see *Considered Alternatives*.

### Slice 3 — Server refresh and back-fill

8. **Refresh and back-fill from the repository-context tool**
   (`mcp-server/src/tools/repository-context.ts`).
   - Add a private `refreshDeclarationRecord(declaration: DeclaredIdentity): Promise<void>`:
     - Capture `now` and `outputsEnabled` before the storage call, but do **not** branch on
       `declaration.entry.declaration` to decide whether to write. `DeclaredIdentity.entry` is an
       identity-resolution snapshot obtained before the registry lock, and it can be overtaken by a
       concurrent Clear.
     - Call `updateRepositoryEntry(declaration.storePath, declaration.entry.id, (currentEntry) => { … })`
       exactly once. Inside that lock-held callback, evaluate the current tri-state: return
       `undefined` for `currentEntry.declaration === null`; call `applyDeclaration()` only when it is
       `undefined` (legacy back-fill); for an object, return `undefined` when `last_seen_at` is within
       `DECLARATION_REFRESH_THROTTLE_MS` of `now`, otherwise return an updated record with refreshed
       `last_seen_at`. An unparseable object `last_seen_at` is due, not an error.
     - Treat either `{ kind: 'unchanged' }` or `{ kind: 'not_found' }` as a successful no-op. The
       latter occurs when an entry has been deleted or moved between identity resolution and lock
       acquisition; refresh must never recreate it or chase it to another store.
     - Keep the helper's result internal but derive its "write occurred" state from the storage
       result (`kind === 'updated'`) for focused tests and diagnostics. This gives the test suite a
       concrete assertion for omitted back-fill, due refresh, throttle, explicit clear, and source
       disappearance without exposing a new MCP response field.
     - Wrap the whole body in a `try`/`catch` that swallows the failure, with a doc comment
       explaining that this is a deliberate exception to the module's re-throw convention
       (`safeListRepositoryInsights()` L344–L356): the tool's contract is to return repository
       context, and a registry-write failure changes nothing about the caller's ability to use the
       response. Log at most a single `console.warn`.
   - Call it from `getRepositoryContext()` only when `declaration` is non-null — i.e. only on the
     declared tier, never on `explicit` or `derived`, where no filesystem evidence exists.
   - Call it **after** the response object is fully assembled and immediately before returning, and
     `await` it. Awaiting keeps the write deterministic and testable; a floating promise would make
     the behaviour untestable and could outlive the process in a short-lived MCP invocation. The
     throttle is what keeps the added latency at approximately one registry write per repository per
     hour.
   - The response shape is unchanged: the refresh reads and writes the registry and contributes
     nothing to the returned JSON.
   - Update the module doc and `buildMirrorField()`'s "read-only" statement to scope the claim
     precisely — the tool never writes to the **working tree**; it does make one throttled,
     best-effort write to the **registry** on the declared tier.
   - Add `refreshDeclarationRecord` to the existing `_internal` export object.

### Slice 4 — GUI

9. **Migrate every GUI registry mutation onto the storage boundary** (`mcp-server/gui/api-repos.ts`,
   `mcp-server/src/storage/repository-registry.ts`).
   - Replace `handleCreateRepo()`'s caller-side load and save with `mutateRegistry()`, performing id
     and folder-name conflict checks and appending the new entry inside its locked callback.
   - Replace `handleUpdateRepo()`'s caller-side load and save with `mutateRegistry()`, performing
     the target lookup and `assertNoFolderNameConflicts()` against the locked registry. The pre-lock
     `findEntryInStores()` result identifies the candidate store only; if the target id is absent in
     the lock-current registry because a concurrent delete or move won first, return a
     mutation-time `not_found` outcome and translate it to `ApiError('NOT_FOUND', …)`. Build the replacement as
     `RepositoryEntrySchema.parse({ ...existing, label: …, folder_names: …, vision: …,
     last_modified: nowIso() })`, matching the existing move preservation shape. Keep `id` and
     `created_at` immutable because they come from `...existing` and `RepoUpdateBodySchema` does not
     accept them.
   - Replace `handleDeleteRepo()`'s caller-side load and save with `mutateRegistry()`, locating and
     removing the target from the locked registry so an intervening declaration write cannot be lost.
     If the pre-located entry is absent once the callback holds the lock, make no write and throw
     `ApiError('NOT_FOUND', …)`; never report `{ deleted: true }` for a stale owner lookup.
   - Move the existing cross-store `handleMoveRepo()` read, conflict validation, source removal, and
     destination insertion behind the new storage-level ordered two-store mutation. The GUI handler
     remains responsible only for request validation and translating storage outcomes to `ApiError`.
     In particular, when the source entry disappeared or was moved while the handler waited for both
     ordered locks, the storage result is `not_found` and the handler returns `ApiError('NOT_FOUND',
     …)` without writing either registry; it does not reuse the stale `entry` from its pre-lock
     lookup. Preserve its current `RepositoryEntrySchema.parse({ ...entry, last_modified: nowIso() })` form.

10. **Expose the record through the GUI API** (`mcp-server/gui/api-repos.ts`).
    - Add `declaration?: RepositoryDeclaration | null` to the `RepoListItem` interface, with a doc
      comment explicitly distinguishing it from the adjacent `declared: boolean` field — `declared`
      means "sourced from the registry rather than discovered on the filesystem"; `declaration` means
      "this repository carries a committed `.ledger/` declaration". Synthetic filesystem-discovered
      items leave it `undefined`.
    - Set it in `toListItem()` from `entry.declaration ?? null`.
    - `handleGetRepo()` already spreads the whole entry, so the field flows through with no change.
    - Add `handleClearRepoDeclaration(ledgerRoot, repoId): Promise<RepositoryEntry>` — locate the
      owning store with `findEntryInStores()`, throw `ApiError('NOT_FOUND', …)` when absent, then
      `updateRepositoryEntry(storePath, repoId, (e) => ({ ...e, declaration: null,
      last_modified: nowIso() }))`. Return the entry only for an `updated` result; translate a
      lock-time `not_found` result to `ApiError('NOT_FOUND', …)`. (An already-null entry may return
      `unchanged` only if the handler deliberately avoids timestamp churn; in that case return its
      current entry.) This preserves the handler's declared `Promise<RepositoryEntry>` contract and
      makes a stale owner lookup a documented 404 rather than a null dereference. `null` is an explicit user-cleared
      state, distinct from the omitted legacy state, so the declared-tier refresh must leave it intact.
    - Expose `DECLARATION_STALE_AFTER_MS` to the client without persisting it to disk: merge
      `{ declaration_stale_after_ms: DECLARATION_STALE_AFTER_MS }` into `handleGetConfig()`'s
      response object in `mcp-server/gui/api.ts`, computed fresh from the imported constant on every
      call — **not** as a new `GuiConfigSchema` field. `GuiConfigSchema` round-trips through
      `gui-config.json` via `readConfigFromDisk()` / `atomicWriteJson()`, and a Zod `.default()` only
      fires when the key is absent from the parsed JSON; a schema field would bake today's constant
      value into every existing installation's config file on the first read/write cycle, and a
      later source-code change to the constant would then silently fail to propagate to any
      installation with an already-persisted `gui-config.json`. This extends the existing
      `GuiConfigSchema.omit({ ledger_root: true })` precedent for a GET-visible, non-writable field,
      but goes one step further: `ledger_root` is still a schema member (merely PUT-excluded), while
      `declaration_stale_after_ms` must never become a schema member at all, since even a read-only
      schema field would still round-trip through disk on every read/write cycle. Change
      `handleGetConfig()`'s return type from `Promise<GuiConfig>` to
      `Promise<GuiConfig & { declaration_stale_after_ms: number }>` to carry the merged field without
      widening `GuiConfig` itself. The client (`strategy.js`) reads it off the same `API.getConfig()`
      call `config.js` already makes, rather than hardcoding a second copy.

11. **Wire the route** (`mcp-server/gui/server.ts`).
    - Add to `buildRepoRoutes()`:
      `{ method: 'DELETE', path: /^\/api\/repos\/(?<repoId>[^/]+)\/declaration$/, noBody: true, … }`
      → `handleClearRepoDeclaration`. Place it **before** the existing
      `DELETE /^\/api\/repos\/(?<repoId>[^/]+)$/` route, matching the codebase's general convention
      for sub-resource routes — the existing route's `[^/]+$`-anchored regex cannot match a path
      with a further `/declaration` segment regardless of order, so this is defense-in-depth rather
      than a fix for a reachable shadowing bug (see Risks & Mitigations).

12. **Render the badge and the Clear control**
    (`mcp-server/gui/public/views/strategy.js`, `mcp-server/gui/public/api-client.js`).
    - Add `declarationStatus(repo, staleAfterMs)` as a **top-level function declaration** in
      `strategy.js` — beside `renderStrategyList()` and `renderRepoModal()`, *not* inside
      `renderStrategyList()`'s closure where `visionStatus()` and `buildTableHtml()` live. The
      closure-scoped helpers are unreachable from the global scope, so a helper placed beside them
      cannot be asserted by a `vm.runInThisContext` suite; `project-list.js`'s top-level
      `buildTable()` is the shape that is directly testable (see `client-rendering.test.ts` L22–L25,
      `project-list.test.ts` L101–L102). The threshold arrives as a parameter rather than being read
      from an outer variable, so the function stays pure and the caller keeps ownership of the
      `API.getConfig()` value from step 10.
    - `declarationStatus()` returns:
      - `''` when `repo.declaration` is absent, `null`, or **any shape other than an object carrying
        a non-empty string `last_seen_at`**. Both "genuinely undeclared" and "unexpected shape"
        therefore render nothing. Record this in a one-line comment on the guard as a deliberate
        defensive default, not an oversight: the column is an informational indicator, the registry
        is user-writable JSON, and rendering nothing is the only failure mode that cannot mislead —
        a thrown error would take the whole table down with it.
      - `<span class="badge badge-complete">.ledger/ declared</span>` when `last_seen_at` is within
        `staleAfterMs` of now.
      - the same badge with `badge-in-progress`, followed by a sibling
        `<span class="text-muted" style="font-size:11px">last confirmed {formatDate(last_seen_at)}</span>`,
        when it is older. **The date sits outside the pill, not inside the badge text.** The `.badge`
        base rule (`styles.css` L358–L368) is `text-transform: uppercase` and `white-space: nowrap`,
        so a date inside the badge renders as `LAST CONFIRMED 12 FEB 2026, 16:41` and cannot wrap or
        shrink at any viewport width; the muted sibling wraps normally and keeps the pill short. The
        badge text names `.ledger/` explicitly so it cannot be confused with the existing `Undeclared`
        badge, which means "not registered in the ledger at all".
      - An unparseable `last_seen_at` is treated as stale rather than fresh, matching the server-side
        rule in step 8 that an unparseable timestamp is due rather than an error.
    - Format the date with the existing global `formatDate()` (`mcp-server/gui/public/utils.js`
      L26–L50) — do not add a second formatter to `strategy.js`, and do not hand-roll an ISO or
      locale rendering. `setup-gui-globals.ts` already loads `utils.js` into every jsdom suite, so it
      is available in tests as well as at runtime. Interpolate its return value **directly, without
      `escapeHtml()`**: its two fallback paths already return `escapeHtml(isoString)` and every other
      return is built from `Date` components, so re-escaping would double-escape a malformed
      timestamp. Every other interpolated value in this function passes through `escapeHtml()` as
      usual.
    - `badge-complete` / `badge-in-progress` are reused deliberately rather than introducing a new
      variant, so no `--color-badge-*` token and no `ui-components.md` entry is added and the column
      inherits the contrast of the existing badge component unchanged. The same two classes carry
      *workflow* semantics elsewhere and appear in the adjacent `Vision` cell of the same row, so the
      two cells must remain readable as two independent statuses rather than one compound one — the
      distinct column header, the `.ledger/` prefix in the badge text, and the muted date sibling are
      what separate them. The manual verification step in the Test Plan checks this and the badge's
      legibility in both themes; a future need for a dedicated colour would mean a new variant, a new
      token pair, and a `ui-components.md` row.
    - Source the threshold by adding `API.getConfig()` to `renderStrategyList()`'s existing
      `Promise.all([API.listRepos(false), API.getStores()])` (L49–L52) and holding
      `declaration_stale_after_ms` in the same closure state as `isMultiStore`, so `refreshTable()`
      reuses it without re-fetching. A missing or non-numeric value falls back to treating every
      record as fresh rather than blocking the render — the column is informational, and a config
      round-trip failure must not empty the table.
    - Add a `Declaration` column: a `<th>` in the header (L136–L143), a cell in the declared-row
      branch, and an empty cell in the undeclared-row branch so the two branches stay column-aligned.
    - Wrap `buildTableHtml()`'s returned `<table class="data-table">` in
      `<div class="table-wrapper">…</div>` (`styles.css` L513–L517), matching
      `project-list.js` L258, `config-stores.js` L149 and `config-model-registry.js` L181. The
      Strategy tables are the only wide tables in the GUI without this container; the new column —
      whose badge cannot wrap — is what makes its absence visible, since the table would otherwise
      overflow the page rather than scroll inside its card. `wireRepoSortHandlers()` and
      `wireTableButtons()` query within `#strategy-table-area` rather than assuming a direct table
      child, so the added wrapper does not affect them. The conflicts table at L318 is out of this
      plan's blast radius and is left as it is.
    - In `renderRepoModal()`, add an **edit-mode-only** section (following the `visionFields`
      `isAdd ? '' : …` precedent, in a `cs-modal-field-group` with a `form-label`) that shows the
      current declaration state and, when a record is present, a *Clear declaration* button. Clicking
      it asks for confirmation through the native `confirm()` dialog used by every other destructive
      GUI action (`project-list.js` L564, `config-stores.js` L530), calls a new
      `API.clearRepoDeclaration(repoId)`, and refreshes the table through the existing `onSaved`
      callback.
    - The helper text — clearing removes only the ledger's record and does not touch the repository's
      `.ledger/` folder — is rendered **persistently beside the button**, as a
      `<span class="text-muted" style="font-size:13px">` inside the same field group, visible for as
      long as the section is. It is not deferred into the `confirm()` string: the consequence has to
      be readable *before* the user commits, and a confirmation dialog is read at the moment of
      commitment, if at all. The `confirm()` message stays a short restatement.
    - Add `clearRepoDeclaration(repoId)` to `mcp-server/gui/public/api-client.js`, following the
      shape of the existing `deleteRepo`.
    - No change to `mcp-server/gui/public/styles.css`: every class used here (`badge`,
      `badge-complete`, `badge-in-progress`, `text-muted`, `table-wrapper`, `cs-modal-field-group`,
      `form-label`) already exists.

### Slice 5 — Documentation

13. **Root `AGENTS.md`.**
    - Add a Cross-System Dependencies row: **`RepositoryEntry.declaration` record** | Source of
      truth: the committed `{projectRoot}/.ledger/settings.json` | Must stay in sync with:
      `mcp-server/src/schema/repository-registry.ts` → `RepositoryDeclarationSchema`;
      `mcp-server/src/storage/repository-registry.ts` → `mutateRegistry()` / the entry-focused
      `updateRepositoryEntry()` / the ordered two-store move operation (the only sanctioned mutation
      paths — never a caller-side `loadRegistry` → mutate → `saveRegistry`);
      `mcp-server/src/storage/repository-declaration.ts` → `applyDeclaration()` / `enabledOutputIds()`;
      `scripts/ledger-project.js` → `init` / `edit` write-back;
      `mcp-server/src/tools/repository-context.ts` → throttled `last_seen_at` refresh and back-fill
      on the declared tier for an omitted key only, never an explicit `null` clear;
      `mcp-server/gui/api-repos.ts` → `RepoListItem.declaration`,
      `handleClearRepoDeclaration()`; `mcp-server/gui/public/views/strategy.js` →
      `declarationStatus()`. Note that `outputs_enabled` derives from `settings.json` only and never
      from `settings.local.json`, and that the record is an asserted claim, not an observation.
    - Extend the existing **"Per-store `.repositories.json`"** row to name `mutateRegistry()` as the
      required path for every single-store partial mutation, `updateRepositoryEntry()` as its
      entry-focused wrapper, and the ordered two-store operation as the required move path; record that
      `orchestrator/src/utils/store_resolution.py` reads the file with stdlib `json` and inspects
      only `folder_names` — therefore unaffected by new entry fields.
    - Extend the existing **"`.ledger/settings.json` ↔ registry identity and the output contract"**
      row to note that the enabled-output set is now mirrored into the registry entry.

14. **MCP server manifest** (`mcp-server/docs/agents/project-manifest/`).
    - `api-surface.md` — `mutateRegistry()`, `updateRepositoryEntry()`, the ordered two-store move
      operation, the new
      `mcp-server/src/storage/repository-declaration.ts` exports, the `RepositoryDeclarationSchema` /
      `RepositoryDeclaration` type, `ProjectDeclarationResult.baseSettings`, and
      `DeclaredIdentity.baseSettings`.
    - `file-tree.md` — the new `src/storage/repository-declaration.ts`.
    - `data-flows.md` — the two write paths into `declaration` (CLI opt-in; server declared-tier
      refresh/back-fill of omitted legacy state only), all GUI mutations through the lock-held
      registry boundary, and the ordered two-store move flow.
    - `constraints-storage.md` — a new constraint: every partial registry mutation goes through
      `mutateRegistry()`, its entry wrapper, or the ordered two-store move operation; `saveRegistry()`
      is for whole-registry replacement only; nothing may call `saveRegistry()` from inside a
      `withLock` on the same store path.

15. **GUI manifest** (`mcp-server/gui/docs/agents/project-manifest/`).
    - `api-surface.md` — `handleClearRepoDeclaration()`, the new route, the `RepoListItem.declaration`
      field and its distinction from `RepoListItem.declared`, and `API.clearRepoDeclaration()`.
    - `data-flows.md` — the Strategy-table badge read path (including where
      `declaration_stale_after_ms` enters the view through `API.getConfig()`) and the
      clear-declaration write path.
    - `ui-components.md` — **no change**: the badge reuses the existing `badge-complete` /
      `badge-in-progress` variants and adds no `--color-badge-*` token, so § Badge Colour Tokens
      stays as it is. Recorded here so the omission reads as a decision rather than a missed
      maintenance rule.

16. **Changelogs.**
    - `mcp-server/changelog.md` — a new version entry covering the schema field, the mutator, the
      tool refresh, and the GUI badge/clear control; then `npm run sync-version` to keep
      `mcp-server/package.json` in step, per the "Version (MCP server)" dependency row.
    - Root `changelog.md` — a user-facing entry referencing the module version via the
      `> mcp vX` line, per the "Changelogs" dependency row.

17. **`.ledger/README.md`** — one sentence noting that declaring a project also records the fact
    against the repository's ledger entry, where it appears on the dashboard Strategy page, and that
    the record can be cleared there.

## Dependencies

- Step 2 depends on step 1 (the schema must accept the field before a mutator can write it).
- Steps 4 and 5 depend on step 3 (`baseSettings` must exist before it can be carried or consumed).
- Step 7 depends on steps 2, 5 and 6.
- Step 8 depends on steps 2, 4 and 5.
- Steps 10–12 depend on steps 1, 2 and 9. Step 12 depends on step 11 for the route to exist.
- Step 9 depends on step 2: all GUI mutations must enter through the lock-held storage boundary before
  any declaration writer ships, so no stale whole-registry GUI snapshot remains able to erase it.
- Slice 5 depends on slices 1–4 being final in shape (not necessarily merged).
- **External:** no new npm or Python dependency. `proper-lockfile` and `zod` are already in
  `mcp-server/package.json`.
- **Build:** `scripts/lib/ledger-bridge.js` rebuilds `mcp-server/dist/` automatically when `src/` is
  newer, so the CLI picks up steps 1–5 without a manual build.

## Required Components

**New files:**
- `mcp-server/src/storage/repository-declaration.ts` — `enabledOutputIds()`, `applyDeclaration()`,
  `DECLARATION_REFRESH_THROTTLE_MS`, `DECLARATION_STALE_AFTER_MS`.
- `mcp-server/tests/storage/repository-registry-mutator.test.ts` — new.
- `mcp-server/tests/storage/repository-declaration.test.ts` — new.

**Modified files:**
- `mcp-server/src/schema/repository-registry.ts`
- `mcp-server/src/storage/repository-registry.ts`
- `mcp-server/src/storage/project-declaration.ts`
- `mcp-server/src/utils/repository-identity.ts`
- `mcp-server/src/tools/repository-context.ts`
- `mcp-server/gui/api-repos.ts`
- `mcp-server/gui/api.ts`
- `mcp-server/gui/server.ts`
- `mcp-server/gui/public/views/strategy.js`
- `mcp-server/gui/public/api-client.js`
- `scripts/ledger-project.js`
- `mcp-server/tests/schema/repository-registry.test.ts`
- `mcp-server/tests/storage/repository-registry.test.ts`
- `mcp-server/tests/storage/repository-registry-mutation.test.ts`
- `mcp-server/tests/storage/project-declaration.test.ts`
- `mcp-server/tests/tools/repository-context-identity.test.ts`
- `mcp-server/tests/gui/api-repos.test.ts`
- `mcp-server/tests/gui/api-repos-store.test.ts`
- `mcp-server/tests/gui/api.test.ts`
- `mcp-server/tests/gui/api-client.test.ts`
- `mcp-server/tests/gui/client-rendering.test.ts`
- `scripts/tests/ledger-project.test.js`
- `AGENTS.md`, `changelog.md`, `mcp-server/changelog.md`, `.ledger/README.md`
- `mcp-server/docs/agents/project-manifest/{api-surface,file-tree,data-flows,constraints-storage}.md`
- `mcp-server/gui/docs/agents/project-manifest/{api-surface,data-flows}.md`

**Unchanged by design:** `scripts/lib/ledger-project-core.js` (pure decision core — the write-back is
a side effect), `orchestrator/src/utils/store_resolution.py` (stdlib `json`, reads only
`folder_names`), `mcp-server/src/schema/project-meta.ts` and `writeProjectMeta()` (the project-level
cache is rejected outright), `mcp-server/gui/public/styles.css` (no new badge variant or
`--color-badge-*` token — every class the GUI slice uses already exists),
`mcp-server/gui/public/utils.js` (`formatDate()` is reused as-is),
`mcp-server/gui/docs/agents/project-manifest/ui-components.md` (no new variant to document).

## Assumptions

- "Ledger-enabled repository" means *"this repository opted in via a committed `.ledger/`
  declaration"*, not *"someone once ran a ledger workflow against it"*.
- The registry remains user-local and per-store; nothing recorded here is shared between users.
- `declared_at` records when the declaration was first **recorded by the ledger**, not when the user
  ran `init`. The server's back-fill cannot know the latter, and no existing data preserves it.
- A 1-hour refresh throttle and a 30-day staleness threshold are starting estimates, documented as
  such at their definitions. Neither is derived from measurement.
- `ai-insights ledger init` against an entry resolved through `resolveInitTarget()`'s `matched`
  classification, or through the wizard's interactive selection among an `ambiguous`
  classification's candidates, is an unambiguous user intent, so the write-back applies in both
  cases (step 7). The `unregistered` classification, and the non-interactive path's `ambiguous`
  classification (which has no prompt available and errors out instead), already abort before any
  write, so no write-back question arises there — the research document's open question about
  suppressing the write-back on an ambiguous match is moot for those two cases as the code stands.

## Constraints

- `loadRegistry()`'s bare catch must not be narrowed in this plan. Changing it is a behavioural change
  affecting every reader and belongs in its own plan; this plan works within it by making the field
  optional.
- `proper-lockfile` locks are not reentrant — no `withLock` on a store path may be nested inside
  another on the same path.
- Root scripts may reach `mcp-server` only through `loadDistModule()`; the reverse direction is
  forbidden.
- No absolute filesystem path may be written into `.repositories.json`.
- `settings.local.json` must never influence a repository-level recorded fact.
- Root `AGENTS.md` → Tool-Agnostic Policy: no new surface may name or depend on a specific IDE or
  agent harness.
- Root `AGENTS.md` → Cross-Platform Policy: temp dirs via `os.tmpdir()` in tests, `path.join()`
  everywhere, no Unix-only shell utilities in `scripts/`.
- The `ledger_get_repository_context` response shape must not change.

## Out of Scope

- The GUI **"Declare…"** action and the relocation of `scripts/lib/ledger-project-core.js` into
  `mcp-server/src/` (research document, Plan 2).
- The `~/.ai-insights/workspaces.json` master-folder / authoritative-clone map (Plan 3).
- Any project-level `.meta.json` caching of this fact — rejected outright.
- A "show only declared repositories" filter.
- Any path field on `RepositoryEntry`.
- Extending strict-mode failure into the MCP tool layer: the `derived` tier is a deliberate,
  documented affordance for undeclared repositories, and `edit` / `sync` already error on
  `not_declared` / `invalid`.
- Narrowing `loadRegistry()`'s error handling to distinguish "absent" from "corrupt".

## Acceptance Criteria

- AC-01: A legacy `.repositories.json` containing entries with **no** `declaration` key parses
  successfully and `loadRegistry()` returns those entries — not an empty registry.
- AC-02: `RepositoryEntrySchema` accepts `declaration: null` and a fully-populated record, and
  rejects a record with a missing or wrongly-typed member; `declaration: null` survives a
  `saveRegistry()` → `loadRegistry()` round trip.
- AC-03: Overlapping single-store `mutateRegistry()` / `updateRepositoryEntry()` operations and GUI
  create, update, delete, or clear operations preserve every intended mutation; no later writer
  replaces a stale whole-registry snapshot.
- AC-04: The storage-level cross-store move preserves exactly one moved entry, validates the current
  destination folder-name set, and completes under deterministic ordered locks without ELOCKED or
  inverse-order deadlock.
- AC-05: `updateRepositoryEntry()` completes without an ELOCKED failure, proving no nested lock
  acquisition on the same store path, returns the discriminated `not_found` result with no write
  when its id is absent, and returns `unchanged` without a write when its lock-held callback declines
  to replace a present entry.
- AC-06: `loadProjectDeclaration()` returns `baseSettings` reflecting `settings.json` alone, with
  `settings.local.json`'s `outputs.*.enabled` overrides absent from it but present in `settings`.
- AC-07: `ai-insights ledger init` in a scratch repository populates `declaration` on the entry in the
  store that actually owns it, with `outputs_enabled` matching the enabled outputs just written.
- AC-08: `ledger init --dry-run` writes nothing to the registry.
- AC-09: `ledger edit` refreshes `outputs_enabled` and `last_seen_at` while preserving the original
  `declared_at`.
- AC-10: In multi-store mode, `ledger edit`'s write-back targets the owning store's registry and
  leaves other stores untouched.
- AC-11: A registry write failure during `init` / `edit` prints a warning and leaves the verb's exit
  code and its `settings.json` write unaffected.
- AC-12: A `ledger_get_repository_context` call resolving through the **declared** tier stamps
  `last_seen_at` on the owning store's entry.
- AC-13: The same call against a repository whose entry has **no** `declaration` back-fills the whole
  record without any user action.
- AC-14: A second declared-tier call within the throttle window performs no registry write.
- AC-15: An explicitly cleared `declaration: null` remains `null` after a declared-tier
  `ledger_get_repository_context` call, including a controlled overlap where refresh pauses before
  acquiring the registry lock, Clear commits `null`, and refresh subsequently observes that current
  null state; a later explicit `ledger init` or `ledger edit` replaces it with a fresh record.
- AC-16: A registry write failure during the refresh neither fails the tool call nor alters its
  response; the response shape is byte-identical to the pre-change shape in all cases.
- AC-17: No registry write occurs on the `explicit` or `derived` identity tiers.
- AC-18: `PUT /api/repos/:repoId` preserves an existing `declaration` record across a label,
  `folder_names`, or vision edit, and GUI create, update, delete, and move all execute their
  validation and mutations from a lock-current registry snapshot. When the pre-located target is
  deleted or moved before the mutation lock is acquired, update and delete return NOT_FOUND and do
  not write a stale replacement.
- AC-19: `GET /api/repos` and `GET /api/repos/:repoId` expose the record; filesystem-discovered
  synthetic list items carry no `declaration`, and the pre-existing `declared: boolean` field retains
  its original meaning and values.
- AC-20: `DELETE /api/repos/:repoId/declaration` sets the field to `null` and returns the updated
  entry; an unknown `repoId`, or an entry removed or moved after pre-lookup but before the locked
  mutation, returns 404 without a stale write; the route does not shadow, and is not shadowed by,
  `DELETE /api/repos/:repoId`. A cross-store move whose source disappears after both locks are
  acquired also returns 404 without writing either registry.
- AC-21: The Strategy table renders the declared badge for a repository with a fresh record, the
  "last confirmed" variant past the staleness threshold, and nothing extra for a repository with no
  record — with declared and undeclared rows staying column-aligned. In the stale variant the badge
  text itself stays `.ledger/ declared` and the confirmation date is rendered outside the badge
  element, formatted by the existing global `formatDate()` rather than by a new formatter or a raw
  ISO string.
- AC-22: The *Clear declaration* control appears only in the modal's edit mode and only when a record
  is present.
- AC-23: Root `AGENTS.md` carries a Cross-System Dependencies row for the new field naming every
  writer and reader, including its omitted-versus-null semantics and the registry mutation boundary,
  and both affected manifests are updated.
- AC-24: `GET /api/config` returns the current runtime `declaration_stale_after_ms` value without
  persisting it through GUI config writes, and `API.clearRepoDeclaration(repoId)` sends an encoded
  `DELETE /api/repos/{repoId}/declaration` request.
- AC-25: `declarationStatus()` returns an empty string — never a partial badge, an `undefined`
  fragment, or a thrown error — for every malformed `repo.declaration` shape: a string, a number, an
  array, an object with no `last_seen_at`, and an object whose `last_seen_at` is a non-string or an
  unparseable string are each rendered as nothing (an unparseable *parseable-typed* timestamp being
  treated as stale, per step 12).
- AC-26: The Strategy repositories table is rendered inside a `.table-wrapper` container, so the
  added `Declaration` column — whose badge cannot wrap — scrolls horizontally within its card instead
  of overflowing the page, and the header, declared-row and undeclared-row column counts stay equal
  in both single-store and multi-store mode.
- AC-27: In edit mode with a record present, the "clearing removes only the ledger's record and does
  not touch the `.ledger/` folder" helper text is visible alongside the *Clear declaration* button
  without any interaction, and clicking the button requests confirmation before
  `API.clearRepoDeclaration()` is called — a declined confirmation issues no request.
- AC-28: The GUI change introduces no new `.badge-*` variant, no new `--color-badge-*` token, and no
  change to `mcp-server/gui/public/styles.css`; badge contrast is therefore inherited from the
  existing badge component, and a manual visual check confirms the `Declaration` and `Vision` cells
  read as two independent statuses in both light and dark themes.

## Testing Strategy

Vitest throughout, driven by the workspace-root `vitest.config.ts`, with test files mirroring source
paths. Schema and storage behaviour is unit-tested against temp directories created with
`mkdtemp(join(tmpdir(), …))` and cleaned up in `afterEach`. The concurrency criteria use controlled
overlap: begin a GUI-equivalent mutation callback and a CLI/tool `updateRepositoryEntry()` against
the same store, then assert the final registry contains both intended changes and no stale snapshot
replacement. Cross-store move tests invoke opposing moves concurrently to prove normalized lock order
does not deadlock and final registries retain every unrelated entry. CLI behaviour is tested at the shell level through the real
compiled `dist/` modules with no bridge mocking, passing an explicit `ledgerRoot` override on every
call so the live workspace ledger is never touched, as required by
`mcp-server/docs/agents/project-manifest/constraints-testing.md`. GUI handlers are tested
through their exported functions in both single-store and multi-store suites. Race tests use a
test-only barrier at the mutation boundary: pause refresh or a handler after its pre-lock owner
lookup but before lock acquisition, let Clear/delete/move commit, then release the paused operation
and assert the lock-current callback either preserves `null` or returns NOT_FOUND without a write.
Client-side rendering is asserted through the existing `client-rendering.test.ts` approach — pure
helpers (`declarationStatus()`) called directly after `vm.runInThisContext`, which is why step 12
declares it at file scope, and the two closure-scoped concerns (the table's column alignment and the
modal's clear section) driven through `renderStrategyList()` / `renderRepoModal()` in jsdom with
stubbed `API`, `Router` and `window.confirm` globals, asserting against the rendered DOM rather than
a returned string. The API facade's `fetch` options are asserted in `api-client.test.ts`. Every failure-swallowing path
is tested by forcing the failure — not by inspection — so "best-effort" is proven rather than
asserted.

**The first test written is the legacy-registry parse (AC-01), before the field is added to the
schema in step 1.** It is the guard for the only failure mode in this change that destroys user data
and reports nothing.

## Test Plan

- `mcp-server/tests/schema/repository-registry.test.ts` — a legacy entry object with no `declaration`
  key parses; a full record parses; `declaration: null` parses; a record missing `schema_version`,
  carrying a non-array `outputs_enabled`, or carrying an output id outside `OUTPUT_IDS` is rejected — AC-01, AC-02
- `mcp-server/tests/storage/repository-registry.test.ts` — `loadRegistry()` on a legacy
  `.repositories.json` file written without the key returns its entries, not `{ repositories: [] }`;
  `saveRegistry()` → `loadRegistry()` round-trips `declaration: null` and a populated record — AC-01, AC-02
- `mcp-server/tests/storage/repository-registry-mutator.test.ts` *(new)* — `mutateRegistry()` reloads
  after lock acquisition and persists the callback result; `updateRepositoryEntry()` delegates to it;
  overlapping registry and entry mutations preserve both changes; the call completes rather than
  throwing ELOCKED; an unknown id returns `not_found` and leaves the file byte-identical; a present
  entry whose callback returns `undefined` reports `unchanged` without writing — AC-03, AC-05
- `mcp-server/tests/storage/repository-registry-mutation.test.ts` *(new)* — the ordered two-store
  move preserves source/destination invariants, detects a destination conflict from the locked
  current snapshot, and opposing concurrent moves complete without deadlock or unrelated-entry loss — AC-04
- `mcp-server/tests/storage/repository-declaration.test.ts` *(new)* — `enabledOutputIds()` returns ids
  in `OUTPUT_IDS` order and omits disabled ones; `applyDeclaration()` preserves an existing
  `declared_at`, sets it when absent or `null`, and always advances `last_seen_at` — AC-07, AC-09
- `mcp-server/tests/storage/project-declaration.test.ts` — `baseSettings` excludes a
  `settings.local.json` `enabled` override that `settings` includes — AC-06
- `scripts/tests/ledger-project.test.js` — `init` populates `declaration` on the owning store's entry
  with the expected `outputs_enabled`; `init --dry-run` leaves the registry byte-identical; `edit`
  refreshes `outputs_enabled` / `last_seen_at` and preserves `declared_at`; a multi-store `edit`
  writes only to the owning store; a registry write forced to fail (read-only store dir or an entry
  id removed between resolution and write) prints a warning and leaves the exit code and
  `settings.json` unchanged — AC-07, AC-08, AC-09, AC-10, AC-11
- `mcp-server/tests/tools/repository-context-identity.test.ts` — a declared-tier call stamps
  `last_seen_at`; a declared-tier call against an entry with no `declaration` back-fills the full
  record; an immediate second call writes nothing; a controlled overlap pauses refresh before it
  acquires the registry lock, clears the current entry, releases refresh, and proves the lock-time
  callback observes and preserves `null`; a later `init` / `edit` restores a record; a refresh whose
  entry disappears before lock acquisition is a successful no-op; a forced write failure leaves the
  call successful and the response unchanged; `explicit` and `derived` tier calls leave the registry
  byte-identical; the response JSON is unchanged from the pre-change shape in every case — AC-12,
  AC-13, AC-14, AC-15, AC-16, AC-17
- `mcp-server/tests/gui/api-repos.test.ts` — GUI create, update, delete, and clear each use the
  lock-held storage primitive; `handleUpdateRepo()` preserves `declaration` across a label,
  `folder_names`, or vision edit; controlled overlap with an entry mutation retains both changes;
  `toListItem()` sets `declaration` from the entry; a synthetic undeclared list item carries no
  `declaration` while retaining `declared: false`; `handleGetRepo()` includes the record;
  `handleClearRepoDeclaration()` sets it to `null` and throws `NOT_FOUND` for an unknown id; each of
  update, delete, and clear is also paused after pre-lookup while a concurrent delete or move removes
  the target, then returns `NOT_FOUND` without writing stale data — AC-03, AC-18, AC-19, AC-20
- `mcp-server/tests/gui/api-repos-store.test.ts` — the GUI move uses the ordered two-store operation,
  retains source/destination invariants, returns `NOT_FOUND` with no source/destination write when
  its source disappears after both locks are acquired, and `handleClearRepoDeclaration()` targets the
  owning store in multi-store mode — AC-04, AC-20
- `mcp-server/tests/gui-server.test.ts` — `DELETE /api/repos/:repoId/declaration` routes to the clear
  handler and `DELETE /api/repos/:repoId` still routes to the delete handler — AC-20
- `mcp-server/tests/gui/api.test.ts` — `handleGetConfig()` returns the current imported
  `DECLARATION_STALE_AFTER_MS` as `declaration_stale_after_ms`; a subsequent config update and read
  proves this runtime-only field was not written into `gui-config.json` — AC-24
- `mcp-server/tests/gui/api-client.test.ts` — `API.clearRepoDeclaration('repo/a b')` makes exactly one
  request with method `DELETE` and URL `/api/repos/repo%2Fa%20b/declaration`, with no request body —
  AC-24
- `mcp-server/tests/gui/client-rendering.test.ts` — loads `views/strategy.js` via
  `vm.runInThisContext` (which reaches `declarationStatus()` only because step 12 declares it at file
  scope) and asserts: the fresh badge for a recent `last_seen_at`; the `badge-in-progress` badge past
  the threshold, with the badge's own text containing no date and a sibling `text-muted` span
  carrying `formatDate()`'s output; an empty string for `undefined`, `null`, a string, a number, an
  array, an object with no `last_seen_at`, and an object whose `last_seen_at` is a non-string or
  unparseable — with no call throwing; a fresh-record fallback when the threshold argument is
  missing or non-numeric — AC-21, AC-25
- `mcp-server/tests/gui/client-rendering.test.ts` (same file, jsdom render) — drives
  `renderStrategyList(app)` against stubbed `API.listRepos` / `API.getStores` / `API.getConfig` and a
  `Router` stub, then asserts against the rendered DOM: `#strategy-table-area` contains a
  `.table-wrapper` wrapping the table; the `<th>` count equals every row's `<td>` count for a mixed
  declared/undeclared fixture in both single-store and multi-store mode; the `Declaration` cell of a
  stale row contains one `.badge` element whose text has no digits — AC-21, AC-26
- `mcp-server/tests/gui/client-rendering.test.ts` (same file, modal render) — `renderRepoModal()` in
  add mode emits no clear section; in edit mode with no record it emits none; in edit mode with a
  record it emits the *Clear declaration* button **and** the helper text naming `.ledger/` in the
  same field group, with the helper text present in the initial DOM before any click; with
  `window.confirm` stubbed to `false` the click issues no `API.clearRepoDeclaration` call, and with
  it stubbed to `true` exactly one call is made with the repo id — AC-22, AC-27
- `mcp-server/gui/public/styles.css` diff check (assertion by review, not a test) — the GUI slice
  leaves the stylesheet untouched and adds no `.badge-*` variant or `--color-badge-*` token — AC-28
- Manual verification (recorded in the work package, not automated) — after implementation, a
  `ledger_get_repository_context` call against this workspace back-fills `declaration` on the
  `ai-insights` entry with no user action, and the Strategy table shows the badge; the fresh and
  stale variants are legible in both light and dark themes, and the `Declaration` and `Vision` cells
  read as two independent statuses rather than one compound status; at a narrow viewport
  (≤ 900px, the existing `styles.css` breakpoint) the table scrolls inside its card rather than
  overflowing the page — AC-13, AC-21, AC-26, AC-28
- Documentation review against the Quality Checklist — root `AGENTS.md` row names every writer and
  reader, the lock-held mutation boundary, and omitted-versus-null semantics; both manifests are
  updated — AC-23

## Documentation Updates

- `AGENTS.md` (root) → Cross-System Dependencies — new `RepositoryEntry.declaration` row; extend the
  existing "Per-store `.repositories.json`" and "`.ledger/settings.json` ↔ registry identity" rows
- `mcp-server/docs/agents/project-manifest/api-surface.md` — `mutateRegistry()`,
  `updateRepositoryEntry()`, the ordered two-store move operation, the
  `repository-declaration.ts` exports, `RepositoryDeclarationSchema`,
  `ProjectDeclarationResult.baseSettings`, `DeclaredIdentity.baseSettings`
- `mcp-server/docs/agents/project-manifest/file-tree.md` — new `src/storage/repository-declaration.ts`
- `mcp-server/docs/agents/project-manifest/data-flows.md` — the two write paths into `declaration`,
  omitted-versus-null refresh semantics, GUI mutation routing, and ordered two-store move
- `mcp-server/docs/agents/project-manifest/constraints-storage.md` — all partial mutations go through
  the lock-held storage primitives; never nest `withLock` on the same store path
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — `handleClearRepoDeclaration()`, the
  new route, `RepoListItem.declaration` vs `RepoListItem.declared`, `API.clearRepoDeclaration()`
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — badge read path and clear write path
- `mcp-server/changelog.md` — new version entry; then `npm run sync-version`
- `changelog.md` (root) — user-facing entry with the `> mcp vX` module reference
- `.ledger/README.md` — one sentence on the registry-side record and where to clear it
- `docs/agents/plans/2026-09-16-ledger-declared-project-indicator/plan.md` — add a "superseded by
  this plan" header. **That folder is untracked in git; commit it before editing, and delete
  nothing in it.** Both of its files are read-only inputs to this plan.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | GUI "Declare…" action; relocating the init core from `scripts/lib/ledger-project-core.js` into `mcp-server/src/` | Research document, *Unlocked Capability* / *Deferred to Later Plans* | Its real content is the core relocation, not the indicator; it is a plan in its own right | Gate: after this plan ships. Carries three new risks — writing outside the ledger root, path/row mismatch, consent weakening through the modal funnel |
| 2 | `~/.ai-insights/workspaces.json` machine-local authoritative-clone map | Research document, *Evaluated & Redirected* | Convenience layer over a flow that does not exist yet | Gate: repeated path typing in the declare modal becoming a complaint, **or** the un-declaration-detection gap becoming user-visible |
| 3 | Live filesystem verification of a declaration, to detect *un*-declaration | Superseded brief's Branch A; this plan's *Rejected Approach* | Correct only with a per-device path, which `plan_path` is not on a synced store | Gate: item 2 shipping. Complements the cached record rather than replacing it |
| 4 | Narrowing `loadRegistry()` to distinguish "absent" from "corrupt" and surface the difference | This plan, *Constraints* | Behavioural change affecting every registry reader in three processes | Gate: its own plan. Today a corrupt registry is indistinguishable from a first run, which is its own latent problem |
| 5 | Per-project provenance ("this work happened while the repo was declared") | Research document, *Why not keep the project-level cache as well* | No stated requirement asks for it; a second weaker source of the same truth invites two UI surfaces disagreeing | Purely additive and unblocked if the need appears |
| 6 | "Show only declared repositories" filter | Research document, *Deferred to Later Plans* | Demand unconfirmed | — |
| 7 | Measuring the 1-hour throttle and 30-day staleness threshold | Research document, *Open Questions* | Both are estimates; measurement needs the feature in use | Both constants are named and documented as estimates at their definitions, so changing them is a one-line edit |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Silent registry wipe (highest severity).** `loadRegistry()` swallows schema validation failure and returns `{ repositories: [] }` with nothing logged, so a non-optional field would make every pre-existing registry read as empty across the GUI, CLI and MCP tools simultaneously | The field is `.nullable().optional()`. AC-01 is the **first test written**, before the schema changes, and asserts a legacy file parses and returns its entries. No `.strict()` is added to `RepositoryEntrySchema` |
| **Silent field loss on every GUI edit.** `handleUpdateRepo()` rebuilds the entry by field enumeration with no `...existing` spread, so the new field is dropped whenever a user edits a label or a vision horizon | Step 9 builds the replacement from `...existing` inside the lock-held callback. AC-18 asserts preservation across all three editable fields |
| **Self-deadlock in the new mutation primitives.** `proper-lockfile` is not reentrant; a `withLock` wrapping `saveRegistry()` or taking the same store lock twice would retry against its own lock 50 times and then throw | Step 2 extracts `writeRegistryUnlocked()`, routes same-store moves through one lock, and orders only distinct store paths. AC-04 and AC-05 assert the operations complete. The storage docs name the hazard |
| **Lost updates from concurrent writers.** The CLI, server, and GUI all write the registry, while `saveRegistry()`'s lock otherwise covers only its own write | Step 2 provides the only partial-mutation paths; step 9 migrates every GUI partial writer so each reloads after lock acquisition. Controlled-overlap tests prove GUI and CLI/tool changes survive together (AC-03), while the two-store suite protects move invariants (AC-04) |
| **Machine-local preferences leaking into a cross-device artefact.** `DeclaredIdentity.settings` is merged with the gitignored `settings.local.json`, and `.repositories.json` lives inside a store that may be synced | `outputs_enabled` derives from `baseSettings` (step 3) on every writer. AC-06 asserts the two differ where a local override exists |
| **A read-path tool that writes.** The refresh adds a registry write to `ledger_get_repository_context` | Throttled to once per repository per hour; wrapped in a swallow-everything `try`/`catch` with a single `console.warn`; runs only on the declared tier; contributes nothing to the response. AC-14, AC-16 and AC-17 each assert one of those bounds |
| **Writing to the wrong store in multi-store mode** | `init`'s non-interactive path uses `resolveInitTarget()`'s `matched.storePath`; its wizard path uses the companion `matchedStorePath` threaded through both the `matched` and candidate-selection branches (step 7); `edit` restores `storePath` in `runEdit()` (step 6) and threads it as an explicit parameter through `runEditNonInteractive()`, `runEditWizard()`, and `finalizeEdit()` (step 7) so it reaches the `recordDeclaration()` call site rather than stopping at `runEdit()`; the server uses `DeclaredIdentity.storePath`. AC-10 asserts the `edit` path; AC-20 asserts the GUI clear path |
| **Route shadowing — not actually reachable under the current regex.** The existing `DELETE /api/repos/:repoId` route is `/^\/api\/repos\/(?<repoId>[^/]+)$/` — its `[^/]+` single-segment class and trailing `$` anchor already exclude a match against a path with a further `/declaration` segment, in either registration order | Step 11 still registers the more specific route first, as defense-in-depth and to match the codebase's general sub-resource-route convention — not because the current syntax is otherwise exploitable. AC-20 asserts both routes reach their own handlers regardless |
| **The badge asserts something that stopped being true.** The record is a claim; a deleted `.ledger/` folder cannot be observed | The staleness threshold degrades the badge to "last confirmed {date}" rather than leaving it unqualified; *Clear declaration* gives the user an explicit correction; the schema doc records that the field is an asserted claim. Automatic detection is deferred item 3 with its gate named |
| **An explicit clear is silently recreated.** The server sees the still-present declaration folder after a user clears the registry record | The refresh callback re-evaluates tri-state only after it holds the mutation lock: omitted alone is eligible for back-fill, and lock-current `null` returns `unchanged`. Only a later explicit `init` or `edit` invokes `applyDeclaration()` against `null`. AC-15 pauses refresh before lock acquisition, commits Clear, then proves `null` survives when refresh resumes |
| **A GUI handler writes through a stale owner lookup.** A repository can be deleted or moved after update, delete, clear, or move resolves its source but before it holds the relevant mutation lock | Owner lookup is routing only. Locked storage returns `not_found` for an absent current entry; update, delete, and clear translate it to 404, while cross-store move returns 404 without writing either registry. AC-18 and AC-20 cover controlled deletion/move overlaps |
| **A nowrap badge in a table with no scroll container.** `.badge` is `white-space: nowrap` and `text-transform: uppercase`; the Strategy table is the one wide table in the GUI without `.table-wrapper`, so a long badge string would push the page into horizontal overflow at narrow widths | Step 12 keeps the badge text short and renders the confirmation date in a muted sibling span outside the pill, and wraps the table in the existing `.table-wrapper`. AC-26 asserts the wrapper and equal column counts; the manual check covers the ≤ 900px breakpoint |
| **A malformed registry record breaking the Strategy table.** `.repositories.json` is user-writable, and the row builder runs for every repository | `declarationStatus()` treats anything other than an object with a usable `last_seen_at` as "render nothing", documented at the guard as deliberate. AC-25 asserts the whole malformed-shape matrix returns `''` without throwing |
| **`declared_at` misread as "when the user ran `init`".** The back-fill has no access to that fact | Documented at the schema field, in the manifest, and in the `AGENTS.md` row as "first recorded by the ledger". The GUI badge shows `last_seen_at`, never `declared_at` |
| **CLI verb failing after a successful `settings.json` write.** A registry write error arriving after the declaration is already on disk would misreport the outcome | Best-effort semantics: warn, preserve the exit code. AC-11 asserts it by forcing the failure |
| **The MCP server was unreachable during planning**, so no insight created since 2026-09-16 was seen | All codebase claims in this plan were verified directly against the working tree rather than taken from the research document — which surfaced four findings the document missed. The gap is limited to stored insights, and the Archiver can capture the three new load-bearing facts at synthesis |

## Recommended Workflow

- **Workflow:** ledger
- **Rationale:** The change spans schema, storage, CLI, MCP tool, GUI server, GUI client and docs,
  introduces a concurrency-sensitive mutator, and carries a silent-data-loss failure mode in
  `loadRegistry()` plus a silent-field-loss one in `handleUpdateRepo()` — both of which need QA and
  security/architecture review stages rather than self-review. This confirms the research document's
  recommendation and overturns the superseded draft's *standalone*, which was sized for a two-file
  GUI change that this plan is not.
