# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.9.2
- Architectural Reviews: none — Plan Architect Reviewer v2.3.2

## Prior Project Context

This is a **Synthesis Rework** of `2026-09-16-ledger-project-declaration`
(`docs/agents/plans/2026-09-16-ledger-project-declaration/synthesis.md`), which shipped the opt-in
`.ledger/` project declaration, the generated strategic-vision mirror, and the
`ai-insights ledger init/edit/sync` CLI across 16 work packages.

The repository's declared long-term vision (retrieved via `ledger_get_repository_context`) states:
*"Focus on the essentials before agentic tools and IDEs with LLM-independence by design. All
integrated tools exist only to support the personas."* The user's instruction for this rework — drop
the `PreToolUse` hook entirely, because tool-specific code is unwanted at this stage — is that vision
applied to a concrete artefact, so this plan both removes the artefact and records the rule that
would have prevented it.

Insights consulted: `14827914-…` (core/shell split is the settled CLI convention — respected: the
advisory change stays inside the pure core), `d205d609-…` (ordered write-consent guards — the
leaf-symlink test in step 5 pins the realpath layer of that guard), `2cd87f16-…` (pre-commit guard
registries — relevant only to a deferred item, not acted on here).

## Knowledge Base Reconciliation

| Insight ID | Title | What the plan overtakes | Executed by |
|------------|-------|-------------------------|-------------|
| 00b9e901-0229-42dd-a68b-fc90ead7a0be | Claude Code's own self-modification guardrail blocks Write/Edit on .claude/settings.json in the session's own working directory | The harness fact still holds, but the entry's closing guidance — escalate the intended `.claude/settings.json` content to the human operator — is superseded for this repository: the hook is being removed outright rather than deferred to a human, and this workspace now carries a policy against tool-specific artefacts (step 6). The entry also near-duplicates `6f496510-…`; the pair warrants a merge or a confidence re-rating. | Ledger Knowledge Curator v1.4.1 (Targeted Reconciliation) |
| 6f496510-1598-498d-8dfc-bd02521d87a3 | Claude Code's self-modification guardrail blocks any in-session agent from writing its own .claude/settings.json | Same overtaken claim: *"capture the exact intended file content in the plan/handoff notes and route it as a manual, human-applied step"* no longer describes this repository's answer to that situation — the answer here is that a tool-specific hook is not planned at all. Near-duplicate of `00b9e901-…`. | Ledger Knowledge Curator v1.4.1 (Targeted Reconciliation) |

## Summary

Address the actionable items left open by the `2026-09-16-ledger-project-declaration` synthesis, led
by the user's decision to drop the `PreToolUse` deny-hook entirely rather than carry it as a
human-action item: remove the Claude-Code-specific advisory from the `ledger init`/`edit` advisory
set and every live reference to it, and record a workspace-wide tool-agnostic policy so the class of
coupling does not reappear. The policy exposed a live contradiction the plan also resolves: the
repository's `CLAUDE.md` is a generated 70 KB copy of `AGENTS.md`, while the persona that owns the
file specifies a single `@AGENTS.md` import line — this plan adopts the import model, deletes the
copy machinery, adds the missing `mcp-server/` companion, and guards both with a health check.
Two deferred items from the synthesis are pulled forward as well: the security auditor's warning
about declaring output paths at sensitive locations, and the leaf-symlink coverage gap in the sync
write guard. All remaining synthesis items are triaged into the Deferred Items table.

## Architectural Context

The `ai-insights ledger` command group follows the core/shell split established by
`scripts/lib/launch-agent-core.js`: `scripts/lib/ledger-project-core.js` holds pure decisions and
`scripts/ledger-project.js` holds the flag-driven and wizard shells. One of those decisions is
`collectAdvisories({ projectRoot })` (`scripts/lib/ledger-project-core.js` L246–L302), which returns
five `{ id, text, applicable }` records that the shells print after a declaration is written. Four are
constant `applicable: true` records; only `gitignore` computes applicability from disk, and only
`gitignore` is ever offered for automatic application.

One of the five records, `pretooluse-hook` (L293–L296), recommends a `PreToolUse` hook in
`.claude/settings.json`. It is the module's only string tied to a specific coding tool. The shells
never reference it by id — `printAdvisories()` filters on `applicable` and a caller-supplied
`skipIds`, and `runInit`/`runEdit` look up only `gitignore` and `public-repository-warning`
(`scripts/ledger-project.js` L223–L246, L473–L512, L641–L642) — so the record is removable as a pure
data change.

`CLAUDE.md` is currently a generated 70 KB copy: `cmdCtxGenerate()` (`scripts/cli.js` L558–L585) ends
by writing a generated-header line plus the verbatim contents of `AGENTS.md`, and `cmdBuildMaintain()`
(L501–L514) calls it as its final step. The project holds three incompatible accounts of this file:
the code copies content; `changelog.md` L396 calls it a "content sync" while L415 calls it a
"companion file"; and `personas/standalone/src/content/agents-md-curator.md` L139 — the persona that
owns `AGENTS.md`/`CLAUDE.md` per `personas/shared/partials/documentation-ownership.md` — specifies
*"the single line `@AGENTS.md`, and nothing else"*, adding "never overwrite one holding content beyond
the import; ask the user". This workspace's `CLAUDE.md` has always held content beyond the import, so
that persona's stop-and-ask branch fires on every Update run here. `mcp-server/AGENTS.md` has no
companion at all. Nothing depends on the copy: no test asserts `CLAUDE.md`'s content,
`.context/agents.md` is generated from `AGENTS.md` directly via `context.yaml` (L108), and
`.githooks/pre-commit` only warns on `.context/` staleness.

Separately, `OutputConfigSchema` (`mcp-server/src/schema/project-declaration.ts` L41–L55) allows a
declaration to override an output's `path`, with traversal and reserved-filename validation living in
`resolveOutputPath()` and symlink/shape validation in `syncProjectOutputs()`
(`mcp-server/src/outputs/sync.ts`). `mcp-server/tests/outputs/sync.test.ts` L333–L356 pins the
symlinked-intermediate-directory escape; the leaf-file variant is verified only manually.

## Approach / Architecture

Five bounded changes, no new modules and no new abstractions:

1. **Delete the `pretooluse-hook` advisory record** from `collectAdvisories()` and update its JSDoc,
   the exact-set test assertion, and the `AGENTS.md` tooling row that enumerates the advisories
   (`CLAUDE.md` inherits the change through regeneration). No replacement advisory is added: the protection intent is already
   expressed tool-neutrally by `renderLedgerReadme()` (`scripts/lib/ledger-project-core.js` L177–L197,
   *"must never be hand-edited … carries a `generated-by` marker"*) and by the DO-NOT-EDIT line in the
   generated mirror's own header (`mcp-server/src/outputs/strategic-vision.ts`).
2. **Record the rule as workspace policy** — a short "Tool-Agnostic Policy" section authored in
   `AGENTS.md`, sitting alongside the existing Cross-Platform Policy it is modelled on, plus a row in
   the Root-Level / Cross-Project maintenance table. `CLAUDE.md` picks both up when
   `node scripts/cli.js ctx-generate` regenerates it. This converts a one-off deletion into a check
   future planning runs through.
3. **Document the sensitive-output-path warning** (the security auditor's deferred item) on the
   `path` field's JSDoc in `mcp-server/src/schema/project-declaration.ts`, in
   `mcp-server/docs/agents/project-manifest/constraints-storage.md`, and as one line in the root
   `README.md` ledger section. Documentation only — no schema refinement, per
   `constraints-code-style.md`.
4. **Switch `CLAUDE.md` to the one-line `@AGENTS.md` import**, deleting the content-copy block from
   `cmdCtxGenerate()`, adding the missing `mcp-server/CLAUDE.md` companion, guarding both with a
   health check, and documenting the contract in `AGENTS.md`. This resolves a live contradiction: the
   code copies 70 KB, while the persona that owns the file
   (`personas/standalone/src/content/agents-md-curator.md` L139) specifies a single `@AGENTS.md` line
   and instructs the agent to stop and ask the user whenever the file holds more — which this
   workspace's own `CLAUDE.md` always did.

5. **Close the leaf-symlink coverage gap** with one additional test case in
   `mcp-server/tests/outputs/sync.test.ts`, directly beside the existing intermediate-directory case
   and reusing its imports.

## Rationale

Removing the advisory rather than rewriting it tool-neutrally is the right call because the
tool-neutral message already exists in two places a consumer reads before any hook would fire
(`.ledger/README.md` and the generated file's own DO-NOT-EDIT header). A fifth advisory line restating
it would add onboarding noise, which works against the declared short-term goal of minimal friction.

Codifying the policy costs one documentation section and is the only part of this rework that
prevents recurrence. Without it, the next plan touching an agent-facing surface has nothing to fail
against — the original hook advisory passed a full 16-WP pipeline including audit and review precisely
because no rule existed to cite.

The `CLAUDE.md` switch is funded here rather than deferred because this plan is the evidence for the
problem: an earlier draft of these very steps instructed the implementer to apply every edit twice and
assert the two copies byte-identical. The import model removes the failure mode at the source rather
than documenting around it — one authority, no duplicated content to diverge, nothing to regenerate,
and the workspace stops contradicting its own AGENTS.md Curator. It is also the model the user runs
successfully in other projects, which makes it proven rather than speculative. The moment a plan is
already editing `AGENTS.md` is the only moment this is free.

Deleting the sync block outright, rather than repointing it to emit `@AGENTS.md`, follows from what
the file becomes: its content is a constant, so it is a committed source file and regenerating it on
every CTX run is machinery with no job. The drift risk that machinery nominally covered is handled
where drift is actually detectable — a health check that fails when an `AGENTS.md` has no companion,
which is a condition that already exists in the repository today.

The two items pulled forward from the synthesis's deferred list (sensitive-path documentation,
leaf-symlink test) are both inside this rework's blast radius — the declaration schema and the sync
write guard are the same feature surface — and both are cheap. Everything outside that radius
(pre-commit guard-registry refactor, `cmdLedger` glue coverage, TOCTOU) stays deferred.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Fate of the `pretooluse-hook` advisory | Delete the record outright | (a) Rewrite it tool-neutrally ("protect `.ledger/` from agent writes using your tool's mechanism"); (b) keep it but gate it behind a detected `.claude/` directory | A vague tool-neutral restatement duplicates `.ledger/README.md` and the generated DO-NOT-EDIT header without adding actionable content; detection-gating is exactly the tool-specific coupling the user is removing, plus new branching and tests. Deletion is the only option that leaves no coupling behind. |
| Whether to codify a policy | Add a "Tool-Agnostic Policy" section to `AGENTS.md`/`CLAUDE.md` + a maintenance-table row | (a) Delete the advisory silently; (b) add it only to the Failure Protocol decision matrix | A silent deletion leaves the next plan free to reintroduce the same coupling — the original one shipped through a full pipeline unchallenged. A decision-matrix row alone is a reaction path, not a design rule; the Cross-Platform Policy precedent shows this workspace states such rules as their own section. |
| Home for the sensitive-output-path warning | Schema JSDoc + `constraints-storage.md` + one `README.md` line | (a) A `.refine()` allowlist/denylist on `OutputConfigSchema.path`; (b) a runtime denylist in `resolveOutputPath()`; (c) README only | `constraints-code-style.md` forbids `.refine()` on outer schemas. A runtime denylist of "sensitive" paths is unbounded guesswork (every repo's sensitive set differs) and would create a false sense of completeness over the existing containment guards. README-only leaves the warning invisible to an agent reading the schema. |
| `CLAUDE.md` content model | A committed one-line `@AGENTS.md` import | (a) Keep the generated 70 KB verbatim copy and document it; (b) keep the copy but add a staleness guard | The copy duplicates the entire operating manual into every diff, lets the two files diverge between CTX runs, and contradicts the AGENTS.md Curator's own contract. The import gives one authority and nothing to keep in sync. User-confirmed: this is the model already proven across their other projects. |
| How the one-line companion is produced | Committed source file; the `cmdCtxGenerate()` sync block is deleted | (a) Repoint the sync block to write `@AGENTS.md` each run; (b) leave the block untouched and overwrite afterwards | A generator that emits a constant earns nothing and keeps `CLAUDE.md` classified as a build artefact, which is the classification that caused the confusion. Option (b) would have CTX overwrite the import on the very next run. |
| Guarding the companion | Instant-tier check in `scripts/lib/health-checks.js` | (a) Nothing — rely on the persona; (b) a blocking pre-commit guard | `mcp-server/AGENTS.md` has no companion today, so "rely on the persona" is already demonstrably insufficient. A blocking pre-commit guard is disproportionate for a missing pointer file; the health-check registry surfaces it in `doctor` and the CLI status line at near-zero cost. |
| Scope of the symlink test addition | One leaf-file case appended to the existing symlink block | (a) Parameterise the existing test over both variants; (b) leave deferred | Parameterising rewrites a passing security test for no coverage gain and obscures which variant failed. Leaving it deferred keeps a manually-verified-only branch in a security guard the synthesis itself flagged. |

## Pattern Alignment

- **Core/shell split for CLI verbs** (`scripts/lib/ledger-project-core.js` + `scripts/ledger-project.js`,
  precedent `scripts/lib/launch-agent-core.js`) — followed: the advisory change is a pure data edit in
  the core; no shell change is needed because no shell references the record by id.
- **Advisories as structured records printed by the shell** (`scripts/lib/ledger-project-core.js`
  L246–L302) — followed: the array keeps its shape, one member fewer.
- **Exact-set assertions on advisory ids** (`scripts/tests/ledger-project-core.test.js` L226) —
  followed: the expected set is edited, not loosened to `toContain`.
- **Workspace-wide policy sections authored in `AGENTS.md`** (existing "Cross-Platform Policy"
  section) — followed: the new Tool-Agnostic Policy adopts the same numbered-rules-plus-rationale
  shape and placement convention.
- **`CLAUDE.md` is a one-line `@AGENTS.md` import beside every `AGENTS.md`**
  (`personas/standalone/src/content/agents-md-curator.md` L139) — a pattern the codebase declares but
  does not currently follow; steps 7–9 bring the repository into line with its own persona contract.
- **Health checks are defined once in the registry and resolved by id** (`scripts/lib/health-checks.js`,
  insight `13766e63-…`) — followed by step 8's new instant-tier check.
- **Validation lives in `resolveOutputPath()` / `syncProjectOutputs()`, never in the Zod schema**
  (`mcp-server/src/schema/project-declaration.ts` L13–L18;
  `mcp-server/docs/agents/project-manifest/constraints-code-style.md`) — followed: the sensitive-path
  item is documentation only.
- **`.context/` is regenerated, never hand-edited** (`AGENTS.md` → Generated Context Docs) — followed:
  step 8 regenerates rather than patching `.context/scripts.md` and `.context/agents.md`.
- No pattern departures.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `scripts/lib/ledger-project-core.js` → `collectAdvisories()` | Carries the workspace's only tool-specific string; the advisory list otherwise mixes one computed record with constant ones | Promoted to step 1 | The removal is the rework's mandate; the mixed computed/constant shape is fine as-is for five-minus-one records and needs no reshaping. |
| `scripts/lib/ledger-project-core.js` → `renderLedgerReadme()` | Already carries the tool-neutral "generated files must never be hand-edited" statement the removed advisory was protecting | Promoted to step 2 (verification only, no text change expected) | Confirming the tool-neutral coverage is what justifies adding no replacement advisory; if the reviewer finds the wording insufficient, step 2 is the place to strengthen it. |
| `scripts/cli.js` → `cmdCtxGenerate()` L575–L585 | Copies all of `AGENTS.md` into `CLAUDE.md` on every CTX run, contradicting the AGENTS.md Curator's one-line-import contract and this workspace's own persona ownership table | Promoted to step 7 | The duplication is the root cause of the confusion this plan's first draft fell into. Replacing it with a committed import deletes ~10 lines of code and 70 KB of duplicated content, and makes `AGENTS.md` the single authority in fact as well as in doctrine. |
| `mcp-server/AGENTS.md` | Has no `CLAUDE.md` companion, so Claude-family agents entering that sub-project get no routing at all | Promoted to step 7(c) | One-line file, inside the blast radius of the companion work, and the concrete evidence that the companion rule drifts unguarded. |
| `scripts/lib/health-checks.js` | No check binds an `AGENTS.md` to its companion, which is why the `mcp-server` gap went unnoticed | Promoted to step 8 | The registry exists, the instant tier is the right cost class, and `doctor` plus the CLI status line consume it with no extra wiring. |
| `AGENTS.md` policy sections | No stated rule on tool-specific code, despite an explicit LLM-independence long-term goal — the gap that let the hook advisory ship | Promoted to step 6 | The single highest-leverage change here: without it the deletion is undone by the next plan that finds a convenient IDE-specific mechanism. |
| `mcp-server/src/schema/project-declaration.ts` → `OutputConfigSchema.path` | Permits an arbitrary project-relative target with no warning about sensitive in-repo destinations | Promoted to step 4 | Documentation-only, inside the touched feature surface, and closes a security-audit deferred item. |
| `mcp-server/tests/outputs/sync.test.ts` | Symlink coverage stops at the intermediate-directory variant; the leaf-file variant is manually verified only | Promoted to step 5 | A security guard with a manually-verified-only branch is one refactor away from silently regressing. |
| `.githooks/pre-commit` | Inline shell guards; the advisory `ledger sync --check` block was added as one more inline block | Rejected | The original plan explicitly bounded this, and a guard-registry refactor (insight `2cd87f16-…`) is its own plan with its own test surface. Recorded in Deferred Items. |
| `scripts/cli.js` → `cmdLedger()` / `runLedgerInference()` | Untested dispatch glue; `runLedgerInference()` is module-private, so testing it needs an export change | Rejected | This rework touches neither function; exporting internals purely to test a thin wrapper expands scope without a triggering change. Recorded in Deferred Items. |

## Detailed Steps

1. **Remove the `pretooluse-hook` advisory record.** In `scripts/lib/ledger-project-core.js`, delete
   the `{ id: 'pretooluse-hook', … }` entry from the array returned by `collectAdvisories()`
   (L293–L296), leaving four records. Update the function's JSDoc (L246–L261) so both mentions of
   "the hook snippet" are gone and the remaining sentence reads correctly for the routing lines and
   the public-repository warning only.
2. **Verify the tool-neutral protection statement.** Read `renderLedgerReadme()`
   (`scripts/lib/ledger-project-core.js` L177–L197) and confirm it still states that generated files
   are never hand-edited and carry a `generated-by` marker. Make no change if it does; if the
   statement has drifted, restore it in tool-neutral wording (no tool, IDE, or harness named).
3. **Update the advisory test.** In `scripts/tests/ledger-project-core.test.js` (L218–L231), remove
   `'pretooluse-hook'` from the expected id set and retitle the test to name the four remaining
   advisories. Keep the exact-set assertion — it is the guard that makes a future reintroduction fail
   loudly.
4. **Document the sensitive-output-path warning.** (a) Extend the JSDoc above `OutputConfigSchema` in
   `mcp-server/src/schema/project-declaration.ts` (L41–L55) with a warning that a `path` override
   aims a generated, periodically overwritten file at that location, and that declaring it at a
   security-sensitive destination (e.g. anything under `.git/`, a CI configuration file, or an
   executable script path) is unsupported. (b) Add the same warning as a short entry in
   `mcp-server/docs/agents/project-manifest/constraints-storage.md`. (c) Add one sentence to the
   `ai-insights ledger` section of the root `README.md` (L48–L62). No schema refinement and no runtime
   denylist.
5. **Add the leaf-symlink regression test.** In `mcp-server/tests/outputs/sync.test.ts`, directly after
   the existing intermediate-directory case (L333–L356), add a case that plants a symlink at the leaf
   output file itself (e.g. `.ledger/strategic-vision.md` → a file outside the project root), runs
   `syncProjectOutputs()` in write mode, and asserts the output is reported `blocked` and that the
   out-of-root target is unchanged. Reuse the existing `symlink` import (L23) and the surrounding
   temp-directory fixture; use `os.tmpdir()`-based paths only, never a hardcoded `/tmp`.
6. **Add the Tool-Agnostic Policy.** In `AGENTS.md` only, add a short section modelled on the existing
   "Cross-Platform Policy": generated artefacts, CLI output, advisories, and documentation shipped to
   consumer projects must not name or depend on a specific IDE, agent harness, or coding tool;
   protection and correctness guarantees belong to mechanisms the project itself owns (file headers,
   the `.ledger/README.md` contract, git hooks, the sync guards); persona and IDE-target files under
   `personas/` remain the deliberate exception, since target-specific output is their purpose. Name a
   second, narrower exception: a tool's own entry-point file (`CLAUDE.md`, `.github/copilot-instructions.md`
   and the like) may exist, but carries only a pointer to the neutral canonical document — never a
   copy of it and never content of its own. That is precisely what step 7 implements, and it is the
   minimal-coupling form: one import line, with the entire operating manual staying in `AGENTS.md`.
   Include a rationale line citing the declared LLM-independence long-term goal.
7. **Replace the `CLAUDE.md` content copy with the `@AGENTS.md` import.** (a) In `scripts/cli.js`,
   delete the AGENTS.md→CLAUDE.md sync block at the end of `cmdCtxGenerate()` (L575–L585) — the
   `agentsMd`/`claudeMd` read-and-copy, the generated-header constant, and both log lines. Nothing
   replaces it: a file whose content is the constant `@AGENTS.md` is a committed source file, not a
   build artefact, so regenerating it on every CTX run is machinery without a job. (b) Replace the
   repository's `CLAUDE.md` with a single line, `@AGENTS.md`, and nothing else — no header comment,
   matching the contract in `personas/standalone/src/content/agents-md-curator.md` L139. (c) Add the
   same one-line `mcp-server/CLAUDE.md` companion beside `mcp-server/AGENTS.md`, which has none today.
8. **Guard the companion against drift.** Add an instant-tier check to `scripts/lib/health-checks.js`
   that fails when either of the two known `AGENTS.md` files — the workspace root `AGENTS.md` and
   `mcp-server/AGENTS.md` — lacks a sibling `CLAUDE.md` containing exactly `@AGENTS.md`. Hardcode these
   two paths rather than performing a recursive or glob-based scan for `AGENTS.md`: every existing
   instant-tier check in the registry (`mcp-dist`, `orchestrator-venv`, `hooks-installed`,
   `node-version`, …) is a fixed-path `fs.existsSync`/`fs.readFileSync` call with no directory
   traversal, which is what keeps it under the tier's stated < 5 ms budget, and a repository-wide walk
   would be a different cost class. This also matches the plan's own blast radius, which never
   proposes adding an `AGENTS.md` anywhere else. The missing `mcp-server/CLAUDE.md` is the evidence
   this drift already happens; `doctor` and the CLI status line pick the check up for free. Follow the
   lookup-by-id registry convention (insight `13766e63-…`) — define the check once, never re-implement
   the predicate at a call site.
9. **Document the companion contract.** In `AGENTS.md`: (a) state in the "Generated Context Docs
   (`.context/`)" section that `CLAUDE.md` is *not* generated — it is a committed one-line
   `@AGENTS.md` import, so `AGENTS.md` is the single authority and a conflict is never resolved in
   `CLAUDE.md`'s favour; (b) add a Cross-System Dependencies row binding each `AGENTS.md` to its
   one-line companion and naming the new health check as the guard; (c) note the companion rule in the
   Manifest Maintenance Rules → Root-Level / Cross-Project table, so adding a new `AGENTS.md`
   anywhere carries the obligation.
10. **Update the workspace doc references.** In `AGENTS.md` (L425) only: (a) remove "the PreToolUse
   hook snippet" from the `collectAdvisories()` inventory in the `scripts/lib/ledger-project-core.js`
   row, leaving the gitignore line, the two doc-routing lines, and the public-repository warning;
   (b) add a row to the "Root-Level / Cross-Project" maintenance table mapping *"Add tool-specific or
   IDE-specific behaviour"* to the new policy section.
11. **Regenerate the context snapshot.** Run `node scripts/cli.js ctx-generate` (or
    `node scripts/cli.js build-maintain`, which calls it last) so `.context/scripts.md` and
    `.context/agents.md` pick up the advisory removal, the `cmdCtxGenerate()` change, and the new
    `AGENTS.md` sections. Requires `ctx` on PATH — the command exits non-zero without it. Never
    hand-edit `.context/`. Confirm the run leaves `CLAUDE.md` untouched, which is the observable proof
    step 7(a) landed.
12. **Run the test suites.** `npm test` from the workspace root (covers `scripts/tests/`, including
    the new health-check test) and the `mcp-server` Vitest suite. Both must report zero failures.
13. **Changelogs and versions.** Add an entry to `mcp-server/changelog.md` (documentation-only schema
    and constraints change plus the new regression test) and a root `changelog.md` entry summarising
    the advisory removal, the tool-agnostic policy, and the `CLAUDE.md` import switch, following the
    house style (flat bullets, category prefixes, ≤ 100-char lines) and the module-first ordering.
    Bump versions and run `node scripts/cli.js check-versions`. `personas/changelog.md` is not touched
    — the AGENTS.md Curator persona already specifies the import model and needs no change.

## Dependencies

- Steps 1 → 3 (the test expectation must change with the record, in the same work package, or the
  suite fails).
- Steps 1, 4, 5, 6 → 10 (doc references updated after the code they describe).
- Step 7 → 8 (the companions must exist before the check that asserts them, or the suite fails).
- Step 7(a) → 11 (`cmdCtxGenerate()` must stop copying before CTX runs, or the run overwrites the new
  one-line `CLAUDE.md` with the old 70 KB copy — this ordering is the one genuine trap in the plan).
- Steps 6, 9, 10 → 11 (`ctx-generate` runs after the final `AGENTS.md` state, or `.context/` is stale).
- Steps 1–11 → 12 → 13 (tests green before changelog and version bumps).
- No dependency on the human-action items carried over from the synthesis (committing the dogfooding
  artefacts) — this plan's changes are independent of whether that commit has happened.

## Required Components

- `scripts/lib/ledger-project-core.js` (existing — modified)
- `scripts/tests/ledger-project-core.test.js` (existing — modified)
- `mcp-server/src/schema/project-declaration.ts` (existing — modified, documentation only)
- `mcp-server/tests/outputs/sync.test.ts` (existing — modified)
- `mcp-server/docs/agents/project-manifest/constraints-storage.md` (existing — modified)
- `AGENTS.md` (existing — modified; policy section, companion contract, tooling and maintenance rows)
- `README.md` (existing — modified)
- `scripts/cli.js` (existing — modified; sync block deleted from `cmdCtxGenerate()`)
- `CLAUDE.md` (existing — replaced with the single line `@AGENTS.md`; becomes a committed source file)
- `mcp-server/CLAUDE.md` (**new** — one-line `@AGENTS.md` companion beside `mcp-server/AGENTS.md`)
- `scripts/lib/health-checks.js` (existing — modified; new instant-tier companion check)
- `scripts/tests/health-checks.test.js` (existing — modified; coverage for the new check)
- `.context/scripts.md`, `.context/agents.md` (existing — regenerated via
  `node scripts/cli.js ctx-generate`; never hand-edited)
- `changelog.md`, `mcp-server/changelog.md` (existing — modified)

## Assumptions

- The historical plan artefacts under `docs/agents/plans/2026-09-16-ledger-project-declaration/` and
  `docs/agents/plans/2026-09-11-claude-dynamic-workflow/` are immutable records of what was decided at
  the time and are not edited by this plan, even though they mention `PreToolUse`.
- No `.claude/settings.json` was ever created in this workspace by the original plan (the synthesis
  records it as blocked and deferred), so there is no hook file to delete — only references.
- `node scripts/cli.js ctx-generate` is runnable in the execution environment (it requires `ctx` on
  PATH; `cmdCtxGenerate()` exits non-zero without it). If it is not available, the regeneration is
  reported as an outstanding manual step and neither `CLAUDE.md` nor `.context/` is hand-edited — the
  work ships with `AGENTS.md` correct and its artefacts pending, never with divergent hand edits.

## Constraints

- Agents do not run Git write commands; the user owns committing, including the still-uncommitted
  dogfooding artefacts from the original plan.
- `mcp-server/docs/agents/project-manifest/constraints-code-style.md` forbids `.refine()`,
  `.transform()`, and `.superRefine()` on outer schemas — step 4 is documentation only.
- Tests must be cross-platform: `os.tmpdir()` / `tempfile`-style temp paths, no hardcoded `/tmp`, no
  asserted path separators (workspace Cross-Platform Policy, rule 5). Note that the leaf-symlink test
  creates a symlink, which on Windows may require developer mode or elevation — the existing
  intermediate-directory symlink test at L333 carries **no platform guard at all** (no
  `process.platform` check, no `describe.skipIf`, no try/catch around `symlink()`), so there is no
  guard to reuse. The new leaf-symlink case inherits this same currently-unmitigated gap; it is a
  pre-existing condition of the whole symlink block, not something step 5 introduces or is expected to
  fix.
- Until step 7(a) lands, `cmdCtxGenerate()` still overwrites `CLAUDE.md` with a full copy of
  `AGENTS.md`. Delete the sync block before writing the one-line import, and never hand-edit
  `CLAUDE.md` in the window between.
- After step 7, `AGENTS.md` is the sole authority — a conflict is never resolved in `CLAUDE.md`'s
  favour, and the companion holds the import line and nothing else
  (`personas/standalone/src/content/agents-md-curator.md` L139).
- `personas/changelog.md` is summary-only and is not touched by this plan.

## Out of Scope

- Creating any `.claude/settings.json`, hook file, or equivalent tool-specific configuration — this is
  the explicit inverse of the plan's mandate.
- Any change to the AGENTS.md Curator persona — it already specifies the import model this plan adopts.
- Adding `AGENTS.md`/companion pairs to sub-projects that have neither today (`personas/`,
  `orchestrator/`) — step 7(c) covers only `mcp-server/`, which already has an `AGENTS.md`.
- Any other behaviour of `cmdCtxGenerate()` beyond deleting the sync block — `ctx generate`, path
  normalisation, and the `generated-at.txt` stamp are untouched.
- Refactoring `.githooks/pre-commit` into a testable guard registry.
- Any change to `syncProjectOutputs()` behaviour, `resolveOutputPath()` behaviour, or the TOCTOU
  window in `assertRealPathWithinRoot()` — step 5 adds a test, not a guard change.
- Committing the original plan's staged dogfooding artefacts (human action).
- Any persona source change.

## Acceptance Criteria

- AC-01: `collectAdvisories()` returns exactly four records — `gitignore`, `agents-md-routing`,
  `manifest-routing`, `public-repository-warning` — and no record with id `pretooluse-hook`.
- AC-02: `scripts/lib/ledger-project-core.js` contains no occurrence of `PreToolUse`,
  `.claude/settings.json`, or any other named IDE, agent harness, or coding tool.
- AC-03: `ledger init` and `ledger edit` still print the four remaining advisories in both the
  flag-driven and wizard paths, and the gitignore offer still behaves as before (applicable only when
  a `.gitignore` exists without the line).
- AC-04: A repository-wide search for `PreToolUse` returns hits only under
  `docs/agents/plans/` (immutable historical artefacts) — no hits in `scripts/`, `mcp-server/`,
  `personas/`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/references/`, or `.context/`.
- AC-05: `AGENTS.md` carries a Tool-Agnostic Policy section stating that shipped artefacts, CLI
  output, and documentation must not depend on a specific IDE, agent harness, or coding tool, naming
  the `personas/` target-specific output as the deliberate exception.
- AC-06: The Root-Level / Cross-Project maintenance table in `AGENTS.md` carries a row routing
  tool-specific or IDE-specific behaviour to the new policy section.
- AC-07: The `scripts/lib/ledger-project-core.js` row of the Root-Level Tooling table in `AGENTS.md`
  describes `collectAdvisories()` as returning the gitignore line, the two doc-routing lines, and the
  public-repository warning, with no hook mention.
- AC-08: `OutputConfigSchema`'s JSDoc in `mcp-server/src/schema/project-declaration.ts` warns that a
  `path` override targets a generated, repeatedly overwritten file and must not be aimed at a
  security-sensitive destination; `constraints-storage.md` and the root `README.md` ledger section
  carry the same warning.
- AC-09: `mcp-server/tests/outputs/sync.test.ts` contains a case that plants a symlink at the leaf
  output file pointing outside the project root, asserts `syncProjectOutputs()` reports the output
  `blocked`, and asserts the out-of-root target file is unchanged.
- AC-10: No schema-level `.refine()`, `.transform()`, or `.superRefine()` was added, and no runtime
  path denylist was introduced.
- AC-11: The root `npm test` suite and the `mcp-server` Vitest suite both pass with zero failures.
- AC-12: `.context/scripts.md` and `.context/agents.md` are regenerated via
  `node scripts/cli.js ctx-generate` and contain no `PreToolUse` reference (or, if `ctx` is
  unavailable, the regeneration is reported as an outstanding manual step and nothing under
  `.context/` is hand-edited).
- AC-13: `mcp-server/changelog.md` and the root `changelog.md` each carry a new entry in house style,
  and `node scripts/cli.js check-versions` exits 0.
- AC-14: `cmdCtxGenerate()` in `scripts/cli.js` contains no AGENTS.md→CLAUDE.md copy: running
  `node scripts/cli.js ctx-generate` leaves `CLAUDE.md` byte-for-byte unchanged.
- AC-15: The repository root `CLAUDE.md` contains exactly the single line `@AGENTS.md` and nothing
  else, and an identical `mcp-server/CLAUDE.md` exists beside `mcp-server/AGENTS.md`.
- AC-16: `scripts/lib/health-checks.js` carries an instant-tier check that fails when either the
  workspace root `AGENTS.md` or `mcp-server/AGENTS.md` lacks a sibling `CLAUDE.md` containing exactly
  `@AGENTS.md`, and it passes against the repository's post-change state. The check hardcodes these two
  paths rather than scanning the repository.
- AC-17: `AGENTS.md` documents the companion contract in its Generated Context Docs section, as a
  Cross-System Dependencies row naming the health check as the guard, and as a Root-Level /
  Cross-Project maintenance-table row.
- AC-18: No file under `.context/` is hand-edited; `.context/` reaches its final state only through
  `node scripts/cli.js ctx-generate`.

## Testing Strategy

Automated regression coverage carries the behavioural assertions (advisory set, sync write guard) and
runs in the two existing suites — root `scripts/tests/` under Vitest and `mcp-server`'s Vitest suite.
The documentation-only changes (policy section, doc rows, JSDoc, manifest, README) are verified by a
repository-wide grep assertion for the removed term plus reviewer inspection, since no code path
depends on them. The advisory-printing behaviour of both shells is already covered by
`scripts/tests/ledger-project.test.js`, which asserts against printed output rather than advisory ids,
so it acts as an unmodified regression check that removing a record did not break rendering.

## Test Plan

- `scripts/tests/ledger-project-core.test.js` → `collectAdvisories()` describe block, exact-set id
  assertion — asserts the returned ids are exactly `gitignore`, `agents-md-routing`,
  `manifest-routing`, `public-repository-warning` — AC-01
- `scripts/tests/ledger-project-core.test.js` → the three existing gitignore-applicability cases, run
  unmodified — asserts the gitignore record's computed applicability is unaffected by the removal —
  AC-01, AC-03
- `scripts/tests/ledger-project.test.js` → existing `init`/`edit` output assertions, run unmodified —
  asserts both shells still render their advisory block and the gitignore offer after the record set
  shrank — AC-03
- `mcp-server/tests/outputs/sync.test.ts` → new case *"blocks a symlink escape: the declared output
  path is itself a symlink to a file outside projectRoot"* — asserts the output record is `blocked`
  and the out-of-root target file content is unchanged — AC-09
- `mcp-server/tests/outputs/sync.test.ts` → existing intermediate-directory symlink case, run
  unmodified — asserts the added case did not disturb the existing guard coverage — AC-09
- Repository-wide `PreToolUse` grep (run as a verification step by the implementer and re-run by QA)
  — asserts hits exist only under `docs/agents/plans/` — AC-02, AC-04, AC-12
- Root `npm test` and `mcp-server` Vitest full runs — assert zero failures across both suites — AC-11
- Documentation verification pass (QA + Documentation, recorded as a checklist in the WP): the
  Tool-Agnostic Policy section exists in `AGENTS.md` and names the `personas/` exception (AC-05); the
  maintenance-table row exists (AC-06); the `ledger-project-core.js` tooling row names four advisories
  and no hook (AC-07); the output-path warning appears in the schema JSDoc, `constraints-storage.md`,
  and `README.md` (AC-08); the companion contract appears in the Generated Context Docs section, a
  Cross-System Dependencies row, and the maintenance table (AC-17) — AC-05, AC-06, AC-07, AC-08, AC-17
- `scripts/tests/health-checks.test.js` → new cases for the companion check — asserts it passes when
  an `AGENTS.md` has a sibling `CLAUDE.md` containing exactly `@AGENTS.md`, and fails when the
  companion is missing, empty, or holds any other content — AC-16
- Repository inspection after step 11 (QA): root `CLAUDE.md` and `mcp-server/CLAUDE.md` each contain
  exactly `@AGENTS.md`; `git diff` shows `CLAUDE.md` unchanged by the `ctx-generate` run; `grep` finds
  no `claudeMd` or generated-header constant left in `scripts/cli.js` — AC-14, AC-15
- `git diff --stat` over the work — asserts no file under `.context/` was edited outside the
  `ctx-generate` run — AC-18
- Diff review of `mcp-server/src/schema/project-declaration.ts` and
  `mcp-server/src/storage/project-declaration.ts` — asserts the change is comment-only: no
  `.refine()` / `.transform()` / `.superRefine()` and no runtime path denylist added — AC-10
- `node scripts/cli.js check-versions` — asserts changelog/manifest version parity — AC-13

## Documentation Updates

Per the Manifest Maintenance Rules in `AGENTS.md`:

- `AGENTS.md` (the only authored file of the pair) — new Tool-Agnostic Policy section; Root-Level
  Tooling row for `scripts/lib/ledger-project-core.js` loses the hook mention; new Root-Level /
  Cross-Project maintenance-table row for tool-specific behaviour; Generated Context Docs section and
  `scripts/cli.js` tooling row state that `ctx-generate` regenerates `CLAUDE.md`
- `AGENTS.md` — Generated Context Docs section states `CLAUDE.md` is *not* generated but is a
  committed one-line `@AGENTS.md` import; new Cross-System Dependencies row for the companion
  contract and its health-check guard; new maintenance-table row obliging a companion for any new
  `AGENTS.md`; `scripts/cli.js` tooling row loses the AGENTS.md→CLAUDE.md sync mention;
  `scripts/lib/health-checks.js` tooling row gains the new check
- `CLAUDE.md`, `mcp-server/CLAUDE.md` — one-line `@AGENTS.md` companions (content, not documentation
  about them)
- `docs/references/menu-guide.md` — check whether its `ctx-generate` entry mentions the CLAUDE.md
  sync; update if so
- `README.md` — one sentence in the `ai-insights ledger` section warning against declaring an output
  path at a security-sensitive destination
- `mcp-server/docs/agents/project-manifest/constraints-storage.md` — the same output-path warning as a
  storage-domain constraint (root maintenance table: "Add constraint/convention" → the matching
  `constraints-*.md`)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — only if the `OutputConfigSchema` entry
  there describes the `path` field's contract; check and update to match the new JSDoc, otherwise no
  change
- `.context/scripts.md`, `.context/agents.md` — regenerated via `node scripts/cli.js ctx-generate`
- `mcp-server/changelog.md` — module entry for the documentation/constraints change and the new
  regression test
- `changelog.md` (root) — release entry summarising the advisory removal and the tool-agnostic policy,
  with the `> mcp vX` module-version blockquote
- `docs/references/menu-guide.md` — verified to carry no hook reference; no change expected, confirm
  during the documentation pass

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Commit the original plan's staged dogfooding artefacts (`.ledger/*`, `.gitignore`, `.githooks/pre-commit`, `AGENTS.md`, `CLAUDE.md`) | Synthesis → Blockers, WP-015 | Git writes are the user's, never an agent's | Now simpler than the synthesis assumed: there is no `.claude/settings.json` to wait for, so the commit is unblocked and can include this rework's edits. |
| 2 | `.githooks/pre-commit` refactor into a cross-platform, testable guard registry | Synthesis → Deferred (originally WP-015 plan notes) | Outside this rework's blast radius; needs its own test surface and a runner shim | Global insight `2cd87f16-2556-4523-af27-0b88a6adbf0b` describes the target shape. Reconsider when a third blocking guard is added. |
| 3 | Test coverage for `cmdLedger()` / `runLedgerInference()` dispatch glue in `scripts/cli.js` | Synthesis → Coverage Gap, WP-014 | This plan does not touch `scripts/cli.js`; `runLedgerInference()` is module-private, so testing it requires an export change made solely for tests | Reconsider when `scripts/cli.js`'s ledger dispatch is next modified for a functional reason. |
| 4 | TOCTOU race between `assertRealPathWithinRoot()` and the subsequent I/O | Synthesis → Deferred, WP-009 security audit | Recorded Low/Info by the auditor; closing it means a file-descriptor-based write path, a redesign of the sync writer | Revisit only if `.ledger/` outputs ever become writable by an untrusted process. |
| 5 | Predictable temp-filename pattern in `atomicWriteText()` | Synthesis → WP-009 security audit (Low/Info) | Pre-existing, not introduced by the declaration feature; outside this rework's scope | Would be addressed workspace-wide, not per-feature. |
| 6 | Unescaped Markdown interpolation of vision content in the generated mirror | Synthesis → WP-009 security audit (Low/Info) | Only a risk if a future consumer renders the mirror as HTML; no such consumer exists | Revisit if the GUI or a docs site ever renders `.ledger/strategic-vision.md`. |
| 7 | Plan AC-24's "run in Audit mode" wording vs. the AGENTS.md Curator's Update-mode-only reality | Synthesis → QA (WP-005) | A drafting artefact in an immutable historical plan; functional intent was independently confirmed met | No action needed; recorded so it is not rediscovered as a defect. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **A `PreToolUse` reference survives somewhere unsearched and the removal reads as incomplete** | AC-04 makes a repository-wide grep an explicit criterion, re-run by QA; the research brief already enumerates every live hit (three files) plus the generated `.context/` copies cleared by step 8. |
| **Removing the advisory leaves consumers with no signal that generated outputs must not be hand-edited** | Step 2 verifies `renderLedgerReadme()` still carries that statement, and the generated mirror's own DO-NOT-EDIT header is unchanged — two tool-neutral signals remain. |
| **The Tool-Agnostic Policy is read as banning the `personas/` suites' IDE-target output** | Step 6 names `personas/` target-specific output as the deliberate exception in the policy text itself, and AC-05 requires that exception to be present. |
| **The leaf-symlink test fails on Windows CI for lack of symlink privileges** | The existing intermediate-directory symlink test carries no platform guard today, so step 5 keeps the new case on that same, currently-unmitigated behaviour rather than introducing an inconsistency between the two cases; adding a guard to either is out of this plan's scope. |
| **`ctx-generate` is unavailable in the execution environment and `.context/` is hand-edited instead** | AC-12 explicitly permits reporting the regeneration as an outstanding manual step and forbids hand-editing `.context/`. |
| **The one-line `CLAUDE.md` is written before the sync block is deleted, and the next `ctx-generate` restores the 70 KB copy** | Called out as an explicit ordering dependency (step 7(a) before step 11); AC-14 asserts a CTX run leaves `CLAUDE.md` unchanged, which fails loudly if the block survives. |
| **Switching to `@AGENTS.md` loses content for an agent that does not resolve the import** | The import is a Claude-family directive and `CLAUDE.md` is a Claude-family entry point — no other tool reads it. Every non-Claude consumer already reads `AGENTS.md` directly, and `.context/agents.md` remains a full standalone copy for snapshot consumers. |
| **A new `AGENTS.md` ships without a companion, as `mcp-server/` did** | Step 8's health check fails on exactly this condition and surfaces in `doctor` and the CLI status line; step 9(c) adds the obligation to the maintenance table. Because the check hardcodes today's two known `AGENTS.md` paths rather than scanning for them, a third `AGENTS.md` added by a future plan is not automatically covered — that plan must also update the health check's path list, per the new maintenance-table row. |
| **`ctx` is missing on PATH, so `.context/` silently ships stale** | `cmdCtxGenerate()` exits non-zero rather than failing quietly; AC-12 requires the gap to be reported as an outstanding manual step, and AC-18 forbids hand-editing instead. |

## Recommended Workflow

- **Workflow:** ledger
- **Rationale:** The change spans three modules (root `scripts/`, `mcp-server/`, workspace docs), alters
  build behaviour in `cmdCtxGenerate()` with a real ordering trap, and adds a workspace-level policy
  plus a security-guard regression test — all of which benefit from the formal QA, security-audit, and
  review stages even though each individual edit is small.
