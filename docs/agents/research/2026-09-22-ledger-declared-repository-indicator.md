# Research Report

## Problem Statement

The draft plan `docs/agents/plans/2026-09-16-ledger-declared-project-indicator/plan.md` proposes surfacing a "ledger-declared" indicator by caching the `mirror` field from `ledger_get_repository_context` onto each **project's** `.meta.json`. Its stated reason for going project-level rather than repository-level is that `.repositories.json` stores `folder_names`, never filesystem paths — a repository may have many clones, and the registry "structurally cannot answer" whether a checkout has a `.ledger/` folder.

The user challenges that reasoning as a possible logical fallacy: if a project is detected as ledger-enabled *and* the repository is identified, the repository is ledger-enabled. The alternative proposed is to move the fact into the **declaration workflow** — `ai-insights ledger init` already resolves the repository entry, so it could flag the entry directly, and `edit`/`sync` could fail loudly when `.ledger/` is absent.

The question to answer: which level does this fact actually belong to, and what is the correct write path?

## Problem Decomposition

1. What exactly does "ledger-enabled" mean here? (There is more than one candidate fact.)
2. Is "has a `.ledger/` declaration" a property of a *clone* or of a *repository*?
3. If it is repository-level, what can write it, and when?
4. How does the fact get corrected when it stops being true (declaration deleted, branch without `.ledger/`)?
5. Where does it render, and does the per-project cache still have any independent value?
6. What are the correctness risks of writing to `.repositories.json` from the CLI?
7. What does a repository-level field unlock that a project-level one cannot — specifically, can the GUI become a second front-end for declaring a repository?

## Context & Constraints

Verified against the working tree (2026-09-22) — the upstream `ledger-project-declaration` plan has **shipped**; the draft plan's "Blocked" status is stale:

- `mcp-server/src/utils/repository-identity.ts` exists with the three-tier `explicit → declared → derived` contract and returns a populated `DeclaredIdentity { projectRoot, settings, entry, storePath }` on the declared tier.
- `mcp-server/src/tools/repository-context.ts` imports `resolveRepositoryIdentity`, `DeclaredIdentity`, `resolveOutputPath`, `parseGeneratedHeader`, `visionHash` — the `mirror` field machinery is in place.
- `.ledger/settings.json`, `.ledger/README.md` and `.ledger/strategic-vision.md` are **tracked in git** in this very repository (`git ls-files .ledger` returns all three). Only `settings.local.json` is gitignored (`GITIGNORE_LINE` in `scripts/lib/ledger-project-core.js`).
- `RepositoryEntrySchema` (`mcp-server/src/schema/repository-registry.ts`) carries `id`, `label`, `folder_names`, `vision`, `created_at`, `last_modified` — no declaration-related field.
- `loadRegistry(storePath)` / `saveRegistry(storePath, registry)` are the only registry writers; `saveRegistry` validates then writes atomically **inside** `withLock(storePath, …)`. The lock does *not* span the caller's read-modify-write.
- Root-level scripts reach compiled `mcp-server/dist/` modules through `scripts/lib/ledger-bridge.js` → `loadDistModule()`; `scripts/lib/store-commands.js` already delegates `.repositories.json` I/O this way (per `AGENTS.md`, WP-007).
- The GUI's repository surface is `mcp-server/gui/public/views/strategy.js` (`buildTableHtml`, `visionStatus(repo)` badges) backed by `mcp-server/gui/api-repos.ts`; the project surfaces are `project-list.js` / `project-detail.js` backed by `api.ts`.

**Assumptions recorded (not verified with the user):**
- "Ledger-enabled repository" is intended to mean *"this repository opted in via a committed `.ledger/` declaration"*, not *"someone once ran a ledger workflow against it"*.
- The registry remains user-local and per-store; nothing here is shared across users.

## The Central Question: Clone or Repository?

**Fact.** `.ledger/settings.json` is a version-controlled file. This repository's own copy is tracked. `ledger init` writes it as normal repository content, and only `settings.local.json` is excluded from version control — a deliberate split documented in `.ledger/README.md` and enforced by `ProjectSettingsLocalSchema`, which forbids `repository_id` in the local override precisely so a machine-local file cannot redirect the declared identity.

**Consequence.** The declaration is not a property of a checkout. It travels in the commit graph, so every clone of a declared repository at that commit has it. The draft plan's premise — "a repository can be checked out many times, in many states, so the registry structurally cannot answer this" — conflates two different things:

| Fact | Level | Varies per clone? |
|------|-------|-------------------|
| A `.ledger/settings.json` exists declaring `repository_id: X` | Repository (committed content) | No — only across branches/commits |
| The absolute path at which a checkout lives | Clone | Yes |
| Whether that checkout's mirror file is current (`mirror.stale`) | Clone × commit | Yes |
| Which outputs are enabled *on this machine* (`settings.local.json`) | Clone | Yes |

The registry genuinely cannot hold rows 2–4. Row 1 it can hold perfectly well. **The user's instinct is correct, and the draft plan's rationale is a category error applied to the wrong row.**

The one residual truth in the draft plan's objection is epistemic, not structural: the server can never *observe* row 1 on its own — it has no working tree. But it does not need to observe it. It is told, by a process that stood in the working tree and resolved the repository entry by id. A registry field is a **recorded claim with provenance**, and that is the same standing as every other field in the registry (`label`, `vision`, `folder_names` are all asserted, never observed).

## Prior Art & Known Patterns

### Pattern 1: Project-level opportunistic cache (the draft plan as written)
- **Description:** thread `mirror` from a tool call into `ProjectMetaSchema` as `ledger_declared`; render in `project-detail.js` / `project-list.js`.
- **Where used:** the existing enrichment-cache family in `mcp-server/src/schema/project-meta.ts` (`runner`, `runner_client`, `project_summary`, `title`, `duration_ms`) — all "populate when observed, tolerate absence".
- **Strengths:** zero new write surface; follows an established, well-understood pattern; no registry-mutation risk; cannot ever be wrong about *this* project because it records a real observation.
- **Weaknesses:** answers the wrong question. A project that predates the declaration shows nothing; a repository declared yesterday shows nothing until an agent happens to call the tool inside it; the same fact gets re-recorded on every project of the same repository. The indicator is absent exactly when the user most wants it — right after `ledger init`, before any agent work.
- **Fit:** poor as the primary mechanism; acceptable as a secondary provenance record.

### Pattern 2: Declaration-time write-back to the registry (the user's alternative)
- **Description:** `ai-insights ledger init` (and `edit`, and `sync`) already resolve a registry entry — `resolveInitTarget()` in `scripts/lib/ledger-project-core.js` classifies the target as `matched`/`ambiguous`/`unregistered` against `listEntriesInStores()`. On a successful write, also set a `declaration` field on that `RepositoryEntry`.
- **Where used:** this is the classic *registration handshake* — the same shape as `npm link` writing into the global prefix, `git worktree add` recording into `.git/worktrees`, or an IDE "trust this folder" store. The authoritative state lives with the artefact; the index records that the handshake happened.
- **Strengths:** the flag appears the instant the user opts in, which is precisely the moment they ask "did that work?"; it is repository-level, matching the fact's real level; it needs no agent traffic; it composes with the existing GUI Strategy table, which already renders per-repository badges (`visionStatus`).
- **Weaknesses:** it is a claim, not an observation, so it can go stale in the one direction that matters (declaration deleted, or `init` never committed); it introduces a CLI→registry write path that does not exist today.
- **Fit:** strong. Correct level, correct moment.

### Pattern 3: Server-side re-affirmation from the declared tier
- **Description:** every time `resolveRepositoryIdentity()` returns `source: 'declared'`, the server has proof — right now, from a real filesystem — that a declaration exists and resolves to entry `X`. Stamp `last_seen_at` on that entry.
- **Where used:** "last seen" / heartbeat freshness fields are standard in service registries (Consul, Eureka) and in package-manager link registries.
- **Strengths:** self-healing freshness with no new user action; turns Pattern 2's claim into a claim-with-recency; costs one registry write on an already-I/O-heavy tool call.
- **Weaknesses:** a write on a read-path tool call (needs throttling — e.g. skip if `last_seen_at` is under an hour old); still cannot detect *removal*, only confirm presence.
- **Fit:** strong as a complement to Pattern 2, weak alone (same "only when an agent happens to run" gap).

### Pattern 4: Hard failure / strict mode in the declaration workflow
- **Description:** the second half of the user's alternative — make `edit`/`sync` fail when `.ledger/` is absent, and possibly make MCP tools refuse undeclared repositories.
- **Where used:** already partly implemented. Per `AGENTS.md`, `edit` and `sync` both resolve the root via `findProjectRoot()` and "error on `not_declared`/`invalid` … pointing at `ledger init`".
- **Strengths:** no new work for the CLI half; keeps the registry honest at the moment of edit.
- **Weaknesses:** extending strictness to the MCP tools would be a breaking change. The `derived` tier exists deliberately (`repository-identity.ts` module doc) so ad-hoc, undeclared repositories keep working. Declaration is opt-in by design.
- **Fit:** already satisfied for the CLI; **reject** any extension to the tool layer.

## Alternative & Creative Approaches

- **Approach:** Model the registry field as a three-state *confidence* record rather than a boolean — `declaration: { declared_at, last_seen_at, outputs_enabled: OutputId[], schema_version } | null` — and render it as one of three GUI states: *Declared* (seen recently), *Declared (last confirmed <date>)* (claim aging), *Not declared* (null).
  **Rationale:** it makes the epistemic weakness legible instead of hiding it behind a boolean the UI implicitly presents as ground truth. It also carries the genuinely useful sub-fact — *which* outputs the repository enables — which no boolean can.
  **Risk:** more schema surface; a date shown without explanation can read as alarming. Mitigate by only showing the date when it is older than a threshold (opinion: 30 days).

- **Approach:** Derive nothing; make the GUI Strategy row expose a "Check declaration" action that is only enabled when a path is known.
  **Rationale:** avoids stale state entirely.
  **Risk:** the GUI server has no working-tree path for a repository — `folder_names` are names, not paths. This is the one place the draft plan's objection *does* bind. **Not viable without storing paths, which the design explicitly refuses.**

- **Approach:** Let `ledger init` optionally record the resolved absolute path as a *hint* (`last_declared_path`), gitignored semantics aside, purely so the GUI could offer a re-check.
  **Rationale:** cheap, enables verification.
  **Risk:** reintroduces exactly the clone-tracking the architecture rejects, and the path is wrong the moment the user has two clones. **Recommend against.**

## Unlocked Capability: GUI-Initiated Declaration

The strongest argument for the repository-level field is not the indicator itself — it is what the indicator makes possible. Once the GUI's Strategy table can render *"declared / not declared"* per repository, the obvious next affordance is a **"Declare…" action on an undeclared row**, bringing `ai-insights ledger init` into the GUI. A boolean living on a project's `.meta.json` could never support this: it describes work that already happened, and offers nothing to act on.

**This remains strictly opt-in.** The GUI button is a second front-end over the same consent-gated workflow, not a new policy. Nothing is declared without an explicit user action, every output still defaults to `{ enabled: false }` (`buildInitialSettings()`), and the public-repository warning still precedes each output's enable prompt.

### The path problem, and why it is not a problem

The GUI server has no working-tree path for a repository — `folder_names` are names, not paths. The resolution is the same one the MCP tool already uses: **the user supplies the path at action time, and it is never persisted.**

**Fact — this pattern is already established in the GUI.** `mcp-server/gui/public/views/config-stores.js` takes an absolute path from the user through a plain text input (`cs-modal-path`), validates it with `csValidatePath()` (accepts `/`, `~/`, or a Windows drive letter), and the server creates the directory if absent. A repository-declaration modal would reuse that exact shape.

The invariant holds: `RepositoryEntry` still stores no path. The path is a transient argument to one action, exactly as `cwd_path` is a transient argument to `ledger_get_repository_context`. Filesystem-independence is preserved because the *registry* stays path-free — not because paths never enter the system.

### Sketch

```
Strategy table row (undeclared)      →  [ Declare… ]
  ↓ modal
  Working-tree path:  [ /Users/me/code/my-project        ]
  Repository:         my-project  (pre-filled, read-only — this row)
  Outputs:
    [ ] Strategic vision mirror  → .ledger/strategic-vision.md
        ⚠ This writes repository content. Do not enable for a public
          repository unless the vision is intended to be public.
  ☐ Also append /.ledger/settings.local.json to .gitignore
                                            [ Cancel ]  [ Declare ]
  ↓ POST /api/repos/:repoId/declare  { path, outputs, apply_gitignore }
  ↓ server: validate path → planInitWrites() → write .ledger/ →
            syncProjectOutputs() → set entry.declaration
  ↓ row re-renders as "Declared", mirror link live
```

A companion `GET /api/repos/:repoId/declaration?path=…` (dry-run) lets the modal preview the exact write set and surface `collectAdvisories()` output before the user commits — the same advisories the CLI wizard prints.

### The real architectural cost: a core that lives on the wrong side

**This is the finding that determines effort.** The init decision logic is currently in `scripts/lib/ledger-project-core.js` — root-level JavaScript. The GUI is TypeScript inside `mcp-server/`. The dependency direction in this workspace runs **scripts → `mcp-server/dist/`** via `scripts/lib/ledger-bridge.js` → `loadDistModule()` (per `AGENTS.md`, WP-002/WP-007), never the reverse. The GUI cannot import from `scripts/`.

So a GUI declare flow requires one of:

| Option | Description | Assessment (opinion) |
|---|---|---|
| **A. Relocate the core** | Move `resolveInitTarget` / `buildInitialSettings` / `planInitWrites` / `collectAdvisories` into `mcp-server/src/` (e.g. `src/storage/project-declaration-init.ts`); `ledger-project-core.js` becomes a bridge re-export, exactly as `scripts/lib/ledger-dirs.js` already does for `LedgerStore.listAllProjectDirs()` | **Recommended.** Matches the established direction, single implementation, and the CLI's core/shell split survives intact. Highest one-off cost, lowest ongoing cost. |
| **B. Reimplement in the GUI** | Second implementation of the same write planning in TypeScript | Reject — two implementations of a consent-gated file writer will drift, and the drift is silent. |
| **C. GUI shells out to the CLI** | `spawn('ai-insights', ['ledger','init',…])` | Reject — `init`'s non-interactive path exists, but the GUI server would depend on the `ai-insights` binary being linked (`scripts/lib/npm-link.js`'s `global-cli-linked` check is a *slow-tier health check*, not a guarantee), and structured error reporting degrades to stderr scraping. |

Option A is the reason this belongs in a **separate, sequenced plan** rather than being folded into the indicator work. The indicator (registry field + badge) is self-contained and ships first; the GUI declare flow is a follow-up whose real content is the core relocation.

### New risks introduced by the GUI path

- **Writing outside the ledger root.** Every other GUI write targets a store the user configured. This one writes into an arbitrary user-named directory. The server must validate that the target exists, is a directory, and — recommended — contains a `.git` entry, refusing otherwise. `mcp-server/src/utils/path-validator.ts` covers plan-path segments, not arbitrary absolute working-tree roots; this needs its own guard.
- **Wrong-repository declaration.** In the CLI, `cwd` supplies the binding, so the repository and the working tree agree by construction. In the GUI the user picks a row *and* types a path, so they can be mismatched. Mitigation: the dry-run preview should compare the path's basename against the entry's `folder_names` and warn — not block — on a mismatch (a legitimate clone may be renamed).
- **Consent must not weaken through the funnel.** The CLI prints the public-repository warning immediately above each `Enable …? (y/N)` prompt, default No. The modal must place it in the same position relative to each output toggle, with the same default. A one-line footnote is a weakening of an existing guarantee.

## Evaluated & Redirected: A "Master Folder" (Authoritative Clone) per Repository

**Proposal.** Let the user nominate one local clone per repository as the authoritative working tree — e.g. pointing a repository entry at a STABLE checkout rather than a DEV one — so the ledger has a path it can use without asking each time.

**Verdict: the capability is worth having; the proposed location is not. It must not go on `RepositoryEntry` / `.repositories.json`.**

### The disqualifier is sharper than "multi-user"

The user's own objection — that this setting would be entirely user-specific — is correct, but it understates the problem. The decisive constraint is visible in the schemas, and it bites long before a second user exists:

| File | Location | Holds absolute paths? | Portable? |
|---|---|---|---|
| `stores.json` | `~/.ai-insights/` (user-level, outside every store) | **Yes** — `StoreEntrySchema.path` | No, and by design |
| `.repositories.json` | **inside** a store root | No — `folder_names` only | **Yes** — travels with the store |

**Fact.** `StoreSyncMetaSchema` (`mcp-server/src/schema/store-config.ts`) exists specifically so a user can document that a store is synced across devices (`provider`, `remote_path`, `notes`), and `.repositories.json` lives *inside* that synced store. An absolute path written into `.repositories.json` is therefore broken on arrival at the second device — **for a single user with a laptop and a desktop.** Multi-user installations are just the extreme case of a failure that already occurs at one user, two machines.

This is also the same line `stores.json` itself already draws: the machine-local file is the one that holds paths and points *at* the portable artifact; the portable artifact holds no paths. The master-folder fact is unambiguously a `stores.json`-tier fact wearing a `.repositories.json`-shaped costume.

The project declaration solved this identical problem one layer down: `settings.json` (committed, carries identity) vs `settings.local.json` (machine-local, gitignored, may not redirect `repository_id`). The same split applies here — and applying it consistently is a point in the design's favour, not an extra concept.

### Recommended shape, if and when it is built

A machine-local map at the `~/.ai-insights/` tier, beside `stores.json` and never inside a store:

```
~/.ai-insights/workspaces.json
{
  "workspaces": {
    "<repository_id>": { "path": "/Users/me/code/project-STABLE", "pinned": true,
                         "last_used_at": "2026-09-22T…" }
  }
}
```

**Self-populating, with an optional pin — not a setting the user must configure.** Every declare/sync/tool call that supplies a real path already reveals a working tree for that repository; record it as `last_used_at` and prefill from it. This gives the whole benefit at zero configuration cost for the common single-clone case.

The pin is what serves the actual stated use case. A user who keeps both a DEV and a STABLE checkout (as this workspace's own `…/ai-insights/DEV` layout shows) would otherwise see the remembered path flap between the two as they work. `pinned: true` freezes it to the authoritative clone and suppresses auto-update. **Opinion:** pin-on-top-of-auto-remember is strictly better than a pure setting, because it degrades to zero-config for everyone who does not have the multi-clone problem.

### What it genuinely unlocks

One item here is a real capability gain, not just UX:

1. **Detecting un-declaration** — previously recorded in this report as impossible ("no automatic path can detect removal; needs a manual *Clear declaration* control"). With a known local path, the GUI or a periodic check can verify that `.ledger/settings.json` still exists and still names this `repository_id`, and clear or flag the registry's `declaration` field when it does not. This closes the one real weakness of the claim-based model, **on machines that have a path** — never universally.
2. **Prefilled declare modal** — the path input becomes a confirmation rather than a typing exercise.
3. **One-click sync from the dashboard** — "mirror is stale → Regenerate" becomes actionable without a terminal.

### Why not to build it yet

**Opinion, clearly labelled as such:** this is a convenience layer over a flow that does not exist. Sequence it third — after the registry indicator, and after the GUI declare action has been used enough to show whether typing a path is actually annoying. Building it now risks designing the ergonomics of a workflow nobody has performed. It is also purely additive: every consumer falls back to prompting for a path when no entry exists, so adding it later costs nothing that building it now would save.

The one thing worth doing *now* is negative and free: **do not add a path field to `RepositoryEntrySchema`** as part of the indicator work, and note in that schema's doc comment that paths belong to the `~/.ai-insights/` tier. That keeps the door open without opening it.

## Comparative Evaluation

| Criterion | P1: project cache | P2: init write-back | P3: server re-affirm | P4: strict workflow | Hybrid (P2+P3) |
|---|---|---|---|---|---|
| **Answers the actual question** | No — project-level proxy | Yes | Partially | N/A (guard, not indicator) | Yes |
| **Complexity** | Low (1 field + 2 views) | Low–Medium (new CLI→registry write) | Medium (write on read-path, throttling) | None new (already shipped for CLI) | Medium |
| **Performance** | Negligible | Negligible (once per `init`/`edit`) | One throttled registry write per tool call | Negligible | Negligible with throttle |
| **Freshness** | Only after agent activity | Instant on opt-in; decays after | Refreshes on every agent visit | N/A | Instant + self-refreshing |
| **Can detect un-declaration** | No | No | No | Yes, at edit time | No (needs manual clear) |
| **Maintainability** | Follows existing enrichment pattern | Adds a registry mutation path needing a locked read-modify-write helper | Couples a read tool to a write | Already in place | Two writers, one schema field |
| **Risk** | Low, but misleading UI | Medium — registry concurrency | Medium — write amplification | Low | Medium, contained |
| **Time to implement (estimate)** | ~0.5 day | ~1 day | ~0.5 day | ~0 | ~1.5 days |

## Recommendation

> **Planning this? Go straight to *Implementation Recommendation — Plan 1* below.** This section gives the reasoning; that one gives the scope, build order, decided defaults, risks, and acceptance signals.

**Move the fact to the repository level and write it from the declaration workflow — Pattern 2 as the primary mechanism, Pattern 3 as the freshness complement. Drop Pattern 1 (the project-level `.meta.json` cache) from scope.**

Concretely:

1. **Schema.** Add to `RepositoryEntrySchema` (`mcp-server/src/schema/repository-registry.ts`):
   ```
   declaration: { schema_version: 1,
                  declared_at: string,
                  last_seen_at: string,
                  outputs_enabled: OutputId[] }  // nullable, optional
   ```
   Optional + nullable so every existing `.repositories.json` keeps parsing unchanged (`loadRegistry` currently swallows a schema failure into an *empty registry* — a non-optional field here would silently blank every user's registry, which is the single most dangerous mistake available in this change).

2. **Primary writer — the CLI.** `scripts/ledger-project.js`'s `init` and `edit` shells set `declaration` on the resolved entry after a successful `settings.json` write, going through `scripts/lib/ledger-bridge.js` → a **new** locked helper in `mcp-server/src/storage/repository-registry.ts` (see step 5). `edit` also updates `outputs_enabled`. Decision-logic stays pure in `ledger-project-core.js`; the write belongs to the shell, per that module's existing core/shell split.

3. **Freshness writer — the server.** In `mcp-server/src/tools/repository-context.ts`, when `resolveRepositoryIdentity()` yields `source: 'declared'`, refresh `last_seen_at` on `declaration.entry` — throttled (skip when already within the last hour) and strictly best-effort (a failure must never fail the tool call). If `declaration` is `null` at that point, populate it: this back-fills every repository declared before this change ships.

4. **Rendering.** Extend `mcp-server/gui/api-repos.ts`'s repo list payload and add a badge in `strategy.js`'s `buildTableHtml`, alongside the existing `visionStatus(repo)` badge — that table is already the per-repository status surface, so the indicator costs no new view. A manual **Clear declaration** control in the repo edit modal (`renderRepoModal`) covers un-declaration, which no automatic path can detect.

5. **Concurrency (must not be skipped).** Do not implement the write as `loadRegistry()` → mutate → `saveRegistry()` from the caller: `saveRegistry` holds the lock only around its own write, so two concurrent callers can lose each other's edits. Add a `updateRepositoryEntry(storePath, id, mutator)` helper that performs load-mutate-save **inside one `withLock(storePath, …)`**, and route both writers through it. (Fact: `withLock` is currently internal to `saveRegistry`; verified in `repository-registry.ts`.)

6. **Sequence the GUI declare flow as a separate follow-up plan.** Ship the indicator first (steps 1–5 above are self-contained). The GUI "Declare…" action then lands as its own plan whose substantive content is relocating the init core from `scripts/lib/ledger-project-core.js` into `mcp-server/src/` (Option A above), with the CLI core reduced to a bridge re-export. See *Unlocked Capability: GUI-Initiated Declaration* for the modal sketch, the `POST /api/repos/:repoId/declare` shape, and the three new risks (writing outside the ledger root, path/row mismatch, consent weakening through the funnel).

**Why not keep the project-level cache as well.** It would be a second, weaker source of the same truth, rendered in a second place, with different staleness semantics — the classic setup for two UI surfaces disagreeing. The one thing it offers that the registry cannot is *per-project provenance* ("this work happened while the repo was declared"), which no stated requirement asks for. If that need appears later, it is additive and unblocked.

**On the "fail when `.ledger/` is missing" half of the alternative:** keep it exactly where it already is. `edit` and `sync` already error on `not_declared`/`invalid` and point at `ledger init`. Do **not** extend strictness into `ledger_get_repository_context` — the `derived` tier is a deliberate, documented affordance for undeclared repositories, and removing it would break every repository that has not opted in.

### Proof-of-Concept Outline

1. Add the optional `declaration` field to `RepositoryEntrySchema`; assert in a test that an entry *without* it still parses and that `loadRegistry` on a legacy file returns the entries (not an empty registry).
2. Add `updateRepositoryEntry(storePath, id, mutator)` with the lock spanning load→save; test two concurrent mutations both survive.
3. Wire `ledger init` to call it; run `ai-insights ledger init` in a scratch repo and confirm `.repositories.json` gains the field.
4. Add the throttled `last_seen_at` refresh in `repository-context.ts`; confirm a tool call against an already-declared, pre-existing entry back-fills `declaration`.
5. Render the badge in `strategy.js`; confirm undeclared rows render nothing extra.

## Implementation Recommendation — Plan 1: "Repository Declaration Indicator"

> **Planner handoff section.** This is the scope to plan now. Three phases were identified in this report; only phase 1 is in scope here. The remaining two are listed under *Deferred to Later Plans* below and must not be pulled forward.

### Objective

Record, on each repository's registry entry, that the repository carries a committed `.ledger/` declaration — written by the declaration workflow, refreshed opportunistically by the server, and surfaced as a read-only badge in the GUI Strategy table.

### Build Order

Ordered by risk, not by layer. Slice 1 is the only part that can cause data loss; it is built and tested before anything depends on it.

| # | Slice | Content | Rationale |
|---|---|---|---|
| 1 | **Schema + locked mutator** | Optional, nullable `declaration` on `RepositoryEntrySchema` (`mcp-server/src/schema/repository-registry.ts`); new `updateRepositoryEntry(storePath, id, mutator)` in `mcp-server/src/storage/repository-registry.ts` with `withLock(storePath, …)` spanning the whole load→mutate→save | The only risky part of the feature. Everything else is trivial once this is correct, and unsafe if it is not. |
| 2 | **CLI write-back** | `ledger init` / `ledger edit` (`scripts/ledger-project.js`, via `scripts/lib/ledger-bridge.js`) set `declaration` after a successful `settings.json` write; `edit` also refreshes `outputs_enabled` | The moment the user opts in is the moment they want confirmation that it worked. |
| 3 | **Server refresh + back-fill** | `mcp-server/src/tools/repository-context.ts`: when `resolveRepositoryIdentity()` returns `source: 'declared'`, stamp `last_seen_at`; populate the whole `declaration` record when it is currently `null` | **Load-bearing — do not cut.** Without it, every repository declared *before* this ships (including this workspace) shows nothing until someone re-runs `init`. This is what makes the badge true on day one rather than gradually. |
| 4 | **GUI badge** | Badge in `mcp-server/gui/public/views/strategy.js` → `buildTableHtml`, beside the existing `visionStatus(repo)` badge; field exposed via `mcp-server/gui/api-repos.ts`; *Clear declaration* control in `renderRepoModal`'s edit mode | The visible payoff. The Clear control is the only un-declaration path that exists in phase 1. |
| 5 | **Docs** | `AGENTS.md` → Cross-System Dependencies (new row); `mcp-server/docs/agents/project-manifest/api-surface.md`; GUI manifest `api-surface.md` / `data-flows.md` | Two independent writers converging on one field is exactly the class of coupling that table exists to record. |

### Field Shape (decided — not an open question)

```
declaration: {
  schema_version: 1,
  declared_at:    string,      // ISO 8601, set once by the CLI
  last_seen_at:   string,      // ISO 8601, refreshed by the server
  outputs_enabled: OutputId[]  // from the declaration's enabled outputs
} | null   // optional + nullable
```

Defaults chosen so no decision blocks the plan (all revisable by the Planner, none outstanding):
- **Record, not boolean** — `outputs_enabled` is the sub-fact most likely to be wanted next, and retrofitting it onto a boolean means a second migration.
- **1-hour throttle** on the `last_seen_at` refresh.
- **30-day threshold** before the badge degrades from *Declared* to *Declared (last confirmed …)*.

### Critical Risks the Plan Must Address

1. **Silent registry wipe (highest severity).** `loadRegistry()` (`mcp-server/src/storage/repository-registry.ts`) catches *every* failure — missing file, malformed JSON, **and schema validation failure** — and returns `{ repositories: [] }`. A non-optional `declaration` field would therefore make every pre-existing `.repositories.json` read as an empty registry, with no error surfaced anywhere. **Mitigation:** the field is optional *and* nullable, and the first test written asserts that a legacy registry file (no `declaration` key) still parses and returns its entries.
2. **Lost updates on concurrent writes.** `saveRegistry()` holds `withLock` only around its own write, so a caller-side `loadRegistry()` → mutate → `saveRegistry()` loses concurrent edits. **Mitigation:** both writers go through `updateRepositoryEntry()`, never through a caller-side read-modify-write.
3. **A read-path tool that writes.** Slice 3 adds a registry write to `ledger_get_repository_context`, a read tool. **Mitigation:** throttled, and strictly best-effort — a write failure must never fail the tool call or alter its response.
4. **Multi-store targeting.** The write must target the store that actually owns the entry. Server side, `DeclaredIdentity.storePath` already carries it; the CLI path must capture the equivalent from `listEntriesInStores()` rather than assuming the default store.

### Acceptance Signals

- A legacy `.repositories.json` with no `declaration` key parses and returns its entries — asserted by test.
- Two concurrent `updateRepositoryEntry()` calls both survive — asserted by test.
- `ai-insights ledger init` in a scratch repository populates `declaration` on the correct store's registry entry.
- A `ledger_get_repository_context` call against a repository declared *before* this change back-fills `declaration` without any user action.
- The Strategy table shows the badge for declared repositories and renders nothing extra for undeclared ones.
- *Clear declaration* in the repo edit modal sets the field to `null` and the badge disappears.

### Deferred to Later Plans — Do Not Pull Forward

| Item | Phase | Gate |
|---|---|---|
| GUI "Declare…" action + relocating the init core from `scripts/lib/ledger-project-core.js` into `mcp-server/src/` | Plan 2 | After plan 1 ships; see *Unlocked Capability: GUI-Initiated Declaration* |
| `~/.ai-insights/workspaces.json` master-folder / authoritative-clone map | Plan 3 | Trigger-gated; see *Evaluated & Redirected* |
| Project-level `.meta.json` caching of this fact | — | **Rejected outright**; see *The Central Question* |
| "Show only declared repositories" filter | — | Confirm demand first |
| Any path field on `RepositoryEntry` | — | **Rejected.** Add a doc-comment in the schema recording that paths belong to the `~/.ai-insights/` tier, so the door stays visibly shut. |

### Workflow & Disposition

- **Workflow: ledger, with QA and review stages active.** The superseded draft proposed *standalone*, sized for a two-file GUI change. This scope touches schema, storage, CLI, server, GUI, and docs, and carries a concurrency-sensitive mutator plus a silent-data-loss failure mode.
- **Supersede, do not revise,** `docs/agents/plans/2026-09-16-ledger-declared-project-indicator/plan.md`. Its premise (project-level fact) is wrong, and its "Blocked" status is stale — the upstream `ledger-project-declaration` plan has shipped.

## Open Questions

- **Boolean vs. record.** The report recommends the record (`declared_at` / `last_seen_at` / `outputs_enabled`). If the user wants the minimum, a nullable `declared_at: string` alone still carries "when" and is a strict subset — but `outputs_enabled` is the field most likely to be wanted within a release or two.
- **Staleness threshold for the GUI.** When should the badge degrade from *Declared* to *Declared (last confirmed …)*? 30 days is an estimate, not a researched figure.
- **Throttle interval for `last_seen_at`.** One hour is an estimate. If `ledger_get_repository_context` is called many times per session, this matters; if once per session, the throttle can be dropped entirely.
- **Ambiguous/unregistered `init` targets.** `resolveInitTarget()` can return `ambiguous` or `unregistered`. When `init` proceeds against a newly created entry, the write-back is trivial; when it proceeds against an ambiguous match, confirm with the user whether the write-back should be suppressed.
- **Does the draft plan get superseded or retargeted?** Recommendation is to rewrite it as a repository-level plan rather than implement it as drafted; its "Blocked" status is in any case stale, since the upstream dependency has shipped.
- **GUI declare flow — path entry mechanism.** The report assumes a validated text input, matching `config-stores.js`. A browser cannot offer a real directory picker for a server-side path; if that UX is unacceptable, the alternative is a recent-paths list built from `cwd_path` values the MCP server has already seen — which would mean persisting paths somewhere, and needs an explicit decision since it brushes against the path-free registry invariant.
- **GUI declare flow — should it also offer `edit` and `sync`?** Once `declare` exists, "change enabled outputs" and "regenerate mirror" are natural neighbours. `sync` in particular is attractive (it fixes a stale mirror from the dashboard) but needs a path again. Recommend deciding the full verb set before building, rather than adding one verb at a time.
- **`.gitignore` application from the GUI.** The CLI offers to append `GITIGNORE_LINE` only when a `.gitignore` already exists (`collectAdvisories()` marks it `applicable: false` otherwise). Confirm the GUI mirrors that condition rather than creating the file.
- **Master-folder / workspace map — build trigger.** Recommended as a third-phase addition (see *Evaluated & Redirected*). The open decision is what evidence would trigger it: repeated path typing in the declare modal, or the un-declaration-detection gap becoming user-visible. Worth naming the trigger now so it does not get built reflexively.
- **Multi-store ownership.** `findEntryInStores()` resolves across stores by priority. Writing back must target the store that actually owns the entry (`DeclaredIdentity.storePath` carries it on the server side; the CLI path must capture the equivalent from `listEntriesInStores()`).

## References

- `mcp-server/src/schema/repository-registry.ts` — `RepositoryEntrySchema`, `StrategicVisionSchema`
- `mcp-server/src/schema/project-declaration.ts` — `ProjectSettingsSchema`, `ProjectSettingsLocalSchema`, `OUTPUT_IDS`, `DEFAULT_OUTPUT_PATHS`
- `mcp-server/src/storage/repository-registry.ts` — `loadRegistry`, `saveRegistry` (lock scope), `findByFolderName`
- `mcp-server/src/storage/repository-lookup.ts` — `findEntryInStores`, `listEntriesInStores`
- `mcp-server/src/utils/repository-identity.ts` — three-tier resolution contract, `DeclaredIdentity`
- `mcp-server/src/tools/repository-context.ts` — `ledger_get_repository_context` and its `mirror` machinery
- `mcp-server/src/outputs/sync.ts` — `syncProjectOutputs`, `SyncOutcomeKind`
- `scripts/lib/ledger-project-core.js` — `resolveInitTarget`, `buildInitialSettings`, `planInitWrites`, `GITIGNORE_LINE`, `renderLedgerReadme`
- `scripts/ledger-project.js` — `init` / `edit` / `sync` shells
- `scripts/lib/ledger-bridge.js` — `loadDistModule()` bridge for root-level scripts
- `mcp-server/gui/public/views/strategy.js` — `buildTableHtml`, `visionStatus`, `renderRepoModal`
- `mcp-server/gui/api-repos.ts` — repo CRUD handlers (`handleCreateRepo`, `handleUpdateRepo`, `handleMoveRepo`, …)
- `mcp-server/src/schema/store-config.ts` — `StoreEntrySchema.path` (machine-local paths), `StoreSyncMetaSchema` (stores are synced across devices) — the basis for rejecting a path field on `RepositoryEntry`
- `mcp-server/gui/public/views/config-stores.js` — `csValidatePath()`, `cs-modal-path` input: precedent for user-supplied absolute paths in the GUI
- `mcp-server/gui/server.ts` — `buildRepoRoutes()`, `/api/repos/*` routing
- `mcp-server/src/utils/path-validator.ts` — `validatePlanPath`, `assertSafeSegment` (plan paths only; does not cover arbitrary working-tree roots)
- `scripts/lib/ledger-dirs.js` — precedent for the "core in `mcp-server/src/`, thin bridge re-export in `scripts/`" relocation shape (Option A)
- `scripts/lib/npm-link.js` — `isCliLinked()`; why the GUI must not shell out to the `ai-insights` binary
- `AGENTS.md` → Cross-System Dependencies — `.ledger/settings.json` ↔ registry identity row; per-store `.repositories.json` row
- `docs/agents/plans/2026-09-16-ledger-declared-project-indicator/plan.md` — the draft under review
- `git ls-files .ledger` in this repository — evidence that the declaration is committed content
