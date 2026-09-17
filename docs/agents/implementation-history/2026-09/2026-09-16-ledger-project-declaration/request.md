# Specification: Project-Side Ledger Declaration and Strategic Vision Mirror

**Status:** Draft for planning
**Date:** 2026-09-16
**Audience:** Planner persona (AI Insights)
**Related:** `mcp-server/` (central_pm), `.repositories.json` registry, Manifest Curator, AGENTS.md Curator, standalone Planner

---

## 1. Summary

The ledger holds a three-horizon strategic vision per repository, but only ledger-aware agents can read it, via `ledger_get_repository_context`. Standalone personas and developers working without the MCP server never see it.

This specification introduces two things:

1. **An official, opt-in project-side declaration** that a repository is ledger-enabled: a `.ledger/` folder at the project root containing a `settings.json`.
2. **A generated, read-only mirror of the strategic vision** inside that folder, so that any agent or person with the repository checked out can read it, with no ledger access required.

The second depends on the first. Today the ledger never writes into a project apart from the work agents perform there. Writing a mirror file is a precedent, so it is bounded by an explicit consent model: the ledger MAY write into a project only inside `.ledger/`, or into a path the project has declared in `.ledger/settings.json`. Nothing else, ever.

---

## 2. Motivation

- **Reach.** Strategic vision is authored once in the ledger but is relevant to every planning and documentation persona, ledger-aware or not — including the standalone Planner and the planned Fitness Auditor.
- **Identity.** Resolving a working tree to a registry entry currently runs through `folder_names`, derived from a directory basename. This breaks on renamed clones and multiple checkouts. A declared `repository_id` in the project gives the ledger an authoritative answer.
- **Separation.** Developers who do not use the ledger should not have to notice it exists. Everything ledger-related lives in one hidden folder that does not interfere with their work.

---

## 3. Design Decisions (settled)

These were decided ahead of planning and SHOULD be treated as constraints, not options. The Planner MAY challenge them in the plan's design section if research surfaces a conflict with the codebase.

| # | Decision | Rationale |
|---|---|---|
| D1 | The ledger writes into a project only inside `.ledger/` or into paths declared in `.ledger/settings.json`. | Bounds the precedent to a rule with a visible edge; a file elsewhere is a bug by definition and can be hook-enforced. |
| D2 | The generated vision file defaults to `.ledger/strategic-vision.md`. The path is overridable per output. | Keeps the default inside the consented directory; a project that wants it in `docs/` says so explicitly. |
| D3 | The mirror is **generated**, never curated. The Manifest Curator and AGENTS.md Curator treat `.ledger/**` as read-only and route to it. | *Truth Upstream, Routing Downstream.* A hand-maintained copy acquires a second maintainer and a second decay rate. |
| D4 | Registry owns identity; project owns consent. A `repository_id` in `.ledger/settings.json` that matches no registry entry in any store is an error, not a registration. The store cannot enable outputs from its side. | Consent to be written into must live with the thing being written into. |
| D5 | All outputs default to **off**. `.ledger/settings.json` with no outputs enabled is valid and useful (identity only). | Safe default for every project; vision content may be sensitive in a public repo. |
| D6 | `settings.json` is committed; `settings.local.json` is gitignored and overrides it. | Mirrors the `.claude/` convention already in use. |
| D7 | Generated files are committed. | Their purpose is to be readable by agents and people who do not have the ledger. |
| D8 | Disabling an output removes its generated file. | A stale mirror whose header claims it is maintained is worse than no mirror. |
| D9 | Generation is **pulled** from inside the repository (CLI run at project root), not pushed by the store. | The registry knows `folder_names`, not filesystem paths. The store cannot locate a checkout. |
| D10 | Discoverability is by routing, not search. AGENTS.md and the project manifest MUST route to `.ledger/` when it exists. | Consistent with how `.claude/`, `.context/`, `.github/` are found today. |

---

## 4. Scope

### In scope

- `.ledger/settings.json` schema and loader (`src/schema/`, `src/storage/` or equivalent).
- Repository identity resolution updated to consult `.ledger/settings.json` (`ledger_get_repository_context`, `LedgerStore.detectProjectByCwd()` and any other cwd → repository derivation).
- Workspace CLI subcommands to initialise the folder and sync outputs.
- The `strategic-vision` output: generator, header format, removal on disable.
- Persona updates: Manifest Curator, AGENTS.md Curator, standalone Planner.
- Documentation: mcp-server README, project manifest, persona READMEs, changelog.
- Recommended `PreToolUse` hook snippet for consumer projects; applied to the AI Insights workspace itself.

### Out of scope (v1)

- Any second generated output. The `outputs` map is designed to admit more, but only `strategic-vision` ships.
- Pushing regeneration from the dashboard Strategy page (see D9).
- Dashboard UI changes beyond what falls out of identity resolution. A "declared via `.ledger/`" indicator is a v2 nice-to-have.
- An MCP tool for agents to trigger sync. Deferred; see §11.
- Writing to `.gitignore`, `AGENTS.md`, the manifest, or `.claude/settings.json` in consumer projects — all outside `.ledger/` (D1). The CLI prints what to add; owning curators or the user make the edit.

---

## 5. The `.ledger/` Folder

```
<project-root>/
└── .ledger/
    ├── README.md               # static explainer, written by `init`
    ├── settings.json           # committed, shared
    ├── settings.local.json     # gitignored, per-developer overrides (optional)
    └── strategic-vision.md     # generated when the output is enabled
```

### 5.1 `settings.json` schema

Zod schema in `src/schema/`, `.strict()`, following the conventions in `constraints-code-style.md`.

```jsonc
{
  "schema_version": 1,
  "repository_id": "ai-insights",          // must match a RepositoryEntry.id in some store
  "outputs": {
    "strategic-vision": {
      "enabled": false,                     // default false
      "path": ".ledger/strategic-vision.md" // optional; default shown; relative to project root
    }
  }
}
```

Rules:

- `schema_version` MUST be present; unknown versions are rejected with a clear error.
- `repository_id` MUST match `SLUG_REGEX` (reuse from `schema/common.ts`).
- `outputs` MAY be absent or empty. Unknown output keys are rejected (`.strict()`), so a typo cannot silently disable an output.
- `path`, when present, MUST be relative, MUST NOT escape the project root (`..` segments rejected after normalisation), and MUST NOT point at `settings.json`, `settings.local.json`, or `README.md` inside `.ledger/`.
- `settings.local.json` uses the same schema with every field optional; it is deep-merged over `settings.json`. It MUST NOT override `repository_id` (identity is shared, not personal); the Planner SHOULD decide whether this is a schema-level omission or a load-time rejection.

### 5.2 Loader

- Absent folder or absent `settings.json` → "not declared"; behaviour is exactly as today.
- Malformed JSON or schema failure → a **surfaced** error, not a silent fallback. This is deliberately stricter than `loadRegistry()`'s lossy-fallback contract: the project has opted in, and a broken opt-in should be visible.
- The loader takes a project-root path and returns a typed result distinguishing `not_declared` / `declared` / `invalid`, so callers can act on each.

---

## 6. Identity Resolution

Precedence for resolving a repository entry, highest first:

1. Explicit `repository_name` argument (existing behaviour, `ledger_get_repository_context`).
2. `repository_id` from `.ledger/settings.json` found at the project root derived from `cwd_path`.
3. Folder-name derivation from `cwd_path` basename (existing behaviour).

When step 2 yields an id with no matching entry in any store, the tool MUST return an error identifying the id and the stores searched. It MUST NOT fall through to step 3, because a declared identity that resolves to a different repository by accident is worse than a hard failure.

The Planner SHOULD locate every place cwd → repository derivation happens (`ledger_get_repository_context`, `LedgerStore.detectProjectByCwd()`, `listProjectsByFolderNames()`, dashboard undeclared-repository discovery) and decide which adopt the new precedence in v1. Multi-store mode MUST be handled via `findEntryInStores()` or equivalent, not a single-store lookup.

---

## 7. Workspace CLI

Two subcommands, added to the workspace CLI (`scripts/cli.js`) and surfaced through `menu.sh` / `menu.cmd` where the existing pattern for `install-mcp` does so. The Planner SHOULD verify this is the right home rather than `mcp-server/` scripts; the requirement is that they run from a project root without a running MCP server and can read every configured store.

### 7.1 `ledger init`

Run at a project root.

- Resolves the registry entry: by `--repository-id` if given, otherwise by folder-name derivation. If none matches, exits with an error pointing at the dashboard Strategy page (registration stays in the ledger — D4).
- Creates `.ledger/` with `README.md` and `settings.json` (all outputs `enabled: false`).
- Refuses to overwrite an existing `settings.json` unless `--force`.
- Prints, but does not apply:
  - the `.gitignore` line for `.ledger/settings.local.json`;
  - a routing line for `AGENTS.md` and the manifest;
  - the recommended `PreToolUse` hook snippet (§10);
  - a warning that enabling `strategic-vision` places vision content in the repository, which may be public.
- Supports `--dry-run`, consistent with `install-mcp`.

### 7.2 `ledger sync`

Run at a project root. Idempotent.

- Loads settings; errors if not declared or invalid.
- Resolves the registry entry by `repository_id` (§6, step 2 only — no folder-name fallback).
- For each **enabled** output: renders it and writes it atomically to the configured path (reuse `atomicWriteJson`-style write-temp-then-rename for text). Writes only if content differs, so a no-op sync produces no diff.
- For each **disabled** output: if a file exists at the configured path **and** carries the generated-file marker (§8.1), removes it. A file without the marker is never touched; the CLI reports it and exits non-zero.
- Prints a per-output status: `written`, `unchanged`, `removed`, `skipped (disabled)`, `blocked (unmarked file at path)`.
- Supports `--check` (exit 1 if any enabled output is stale, write nothing), mirroring `build-personas.js --check`, so it can sit in a pre-commit hook or CI.

---

## 8. The `strategic-vision` Output

### 8.1 File format

Markdown. The header block is the contract; the body layout may be refined by the Planner.

```markdown
<!-- generated-by: ai-insights ledger sync -->
<!-- source: central_pm .repositories.json — repository_id: ai-insights -->
<!-- source-last-modified: 2026-09-14T10:22:31Z -->
<!-- generated-at: 2026-09-16T08:01:12Z -->
<!-- DO NOT EDIT. Regenerate with `ledger sync`. To change the vision, use the dashboard Strategy page. -->

# Strategic Vision — <label>

> Generated from the project ledger. This file is read-only.

## Short term
…

## Mid term
…

## Long term
…
```

- The first line is the **marker** that §7.2 checks before removing a file. It MUST be exact and MUST be the first line.
- `source-last-modified` is `RepositoryEntry.last_modified`. It is the staleness signal for anything that can also read the registry.
- A `null` horizon renders as an explicit "not yet authored" line, never an empty section.
- Newlines, trailing whitespace and encoding MUST be deterministic so that repeated syncs are byte-identical (D7 — this file is committed and must not churn).

### 8.2 Behaviour when the entry has no vision at all

Generate the file anyway with all three "not yet authored" lines. An enabled output that produces nothing would be indistinguishable from a broken sync.

---

## 9. Persona Changes

| Persona | Change |
|---|---|
| **Manifest Curator** | New rule: when `.ledger/` exists at the project root, the manifest MUST contain a routing line to `.ledger/strategic-vision.md` (or the configured path) and MUST describe the folder as generated and read-only. Audit mode flags a missing or stale routing line. The Curator never writes inside `.ledger/`; findings about its contents are routed to the user (`ledger sync`), per *Findings Travel Further Than Fixes*. |
| **AGENTS.md Curator** | Same rule and same audit behaviour for `AGENTS.md`. `.ledger/**` is read-only for this persona. |
| **Planner (standalone)** | When `.ledger/strategic-vision.md` (or configured path) exists, read it and populate the *Strategic Context* section of the research brief from it, noting the `source-last-modified` date. Today that section is gated on `has_mcp`; the gate becomes "MCP available **or** mirror present". Never edit the file; if the vision appears outdated, say so in the plan and point at the dashboard. |
| **Planner (ledger)** | No change required; it already has `ledger_get_repository_context`. The Planner MAY note in the brief when the mirror and the ledger disagree (`source-last-modified` older than registry `last_modified`), as a signal that `ledger sync` is due. |

Changes go into shared partials where the two Planners share text (`planner-research-brief-template.md`), not into either persona directly, per the existing division in `persona-build-architecture`. The Persona Curator's constraints apply: the standalone Planner is not a published artifact but the Curator itself is; nothing project-specific may leak into published files.

Any principle added to a second persona is registered in the recurring-principles registry (constraint 5c). D3 is an application of the existing *Truth Upstream, Routing Downstream*; no new principle is expected.

---

## 10. Mechanical Enforcement

Consumer projects SHOULD add a `PreToolUse` hook denying `Write`/`Edit` to `.ledger/**` for all agents. `ledger init` prints the snippet; the AI Insights workspace applies it to its own `.claude/settings.json` as dogfooding.

The rule from D1 SHOULD be tested in the ledger codebase: a test asserting that the set of paths any sync writes to is a subset of `{.ledger/**} ∪ declared output paths`.

---

## 11. Open Questions for the Planner

The Planner SHOULD resolve these during research and record the resolution in the plan.

1. **Claude Code Grep and hidden directories.** ripgrep skips hidden files without `--hidden`. Determine how Claude Code's Grep/Glob tools behave for `.ledger/` (evidence: how `.claude/` and `.context/` behave today). If they skip it, D10 stands but the documentation MUST say so, and the D2 default should be reconsidered against `docs/strategic-vision.md`.
2. **Home for the CLI subcommands.** `scripts/cli.js` versus a `mcp-server/` script; the constraint is running without a live server while reading all stores via the store-config machinery.
3. **Where identity resolution lives.** Single helper consulted by every cwd-based derivation, or per-site changes. A single helper is preferred; confirm it does not create a circular dependency between `storage/` and `schema/`.
4. **`settings.local.json` and `repository_id`.** Schema omission or load-time rejection (§5.1).
5. **`ledger_get_repository_context` response.** Whether to add an optional `mirror` field (`{ path, generated_at, source_last_modified, stale: boolean }`) when `cwd_path` resolves to a declared project. Low cost, high value for the ledger Planner; confirm it does not disturb existing consumers or the Zod response tests.
6. **`--check` in the workspace pre-commit hook.** Whether `.githooks/pre-commit` should run `ledger sync --check` for the AI Insights repo itself once it is declared. Only if the hook already has store access without a running server.
7. **Deferred MCP tool.** Whether a future `ledger_sync_project_files` tool is desirable at all, given it would let an agent write into the project. Record the argument either way; do not implement in v1.

---

## 12. Acceptance Criteria

1. A project with no `.ledger/` folder behaves exactly as before; all existing tests pass unchanged.
2. `ledger init` at a registered project root creates `.ledger/README.md` and `.ledger/settings.json` with all outputs disabled, and prints the gitignore line, routing lines, hook snippet, and the public-repository warning. It refuses to overwrite without `--force`.
3. `ledger init` at an unregistered project root exits non-zero with a message pointing at the dashboard, and creates nothing.
4. With `strategic-vision.enabled: true`, `ledger sync` writes the file at the default path with the exact header contract from §8.1; a second `sync` with no registry change is byte-identical and reports `unchanged`.
5. Changing a horizon via `PUT /api/repos/:id` and running `sync` updates the file and its `source-last-modified`.
6. With `path` overridden to `docs/strategic-vision.md`, `sync` writes there and nowhere else.
7. With `enabled: false` and a marked file present at the configured path, `sync` removes it. With an unmarked file present, `sync` leaves it, reports `blocked`, and exits non-zero.
8. `sync --check` exits 1 when the file is stale or missing and writes nothing.
9. `ledger_get_repository_context` with a `cwd_path` inside a declared project resolves by `repository_id` even when the directory basename matches no `folder_names` entry.
10. A declared `repository_id` matching no store yields an error naming the id; no folder-name fallback occurs.
11. A `settings.json` with an unknown output key, a `..` path, or an unsupported `schema_version` is rejected with a specific error.
12. A test asserts that every path written by `sync` is within `.ledger/` or a declared output path (D1).
13. Manifest Curator and AGENTS.md Curator, run in Audit mode against a declared project lacking a routing line, report the omission and do not write inside `.ledger/`.
14. The standalone Planner, run in a declared project with the mirror present and no MCP server, produces a research brief whose *Strategic Context* section is populated from the file and cites its `source-last-modified`.
15. mcp-server README, project manifest, persona READMEs and `changelog.md` document the folder, both subcommands, the consent model (D1, D4) and the read-only rule; `npm run sync-version` reflects the release.
