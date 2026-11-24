# Plan

## Plan Audit Cycles
- Audits: 1 (Sonnet 5.5 ×1) — Plan Auditor v1.13.1
- Architectural Reviews: none — Plan Architect Reviewer v2.5.2

## Prior Project Context

- **Strategic vision.** The short-term goal is minimal setup and daily-use friction. `build-maintain` currently ends with `ctx generate`, which fails the whole command when the external `ctx` binary is not on `PATH`; removing it takes one external prerequisite out of the standard maintenance path. The long-term "Personas First" goal is honoured by keeping the CTX Architect persona (to be repurposed) while the repository stops using CTX itself.
- **Prior outcomes.** CTX upkeep has repeatedly cost effort here: two stored insights exist purely to enforce regeneration discipline (`53454e24…`, `a7adbb64…`), a P04 rework rewrote `ctx-generate` into a staged, non-destructive module, and several manifest curation passes existed only to reconcile `.context/` imports with `AGENTS.md`/`CLAUDE.md`.
- **Unmerged CTX work.** That P04 rewrite (`scripts/lib/ctx-generate.js`, `scripts/tests/ctx-generate.test.js`, `scripts/tests/cli-ctx-generate.test.js`, `.gitignore` entries) lives only on `feature-pipeline-adjustments`, which is not merged into `main`. The new files would merge in without conflict after this removal, so the plan adds a guard test that fails if they return.
- **Pre-commit hook insight** (`2cd87f16…`, global): recommends reshaping inline-shell hooks into testable guard registries. Considered and rejected for this plan (see Structural Improvements).

## Knowledge Base Reconciliation

| Insight ID | Title | What the plan overtakes | Executed by |
|------------|-------|-------------------------|-------------|
| 53454e24-4329-4946-ab9f-3b94cd682f17 | Regenerate .context/ with `node scripts/cli.js ctx-generate` (not raw `ctx generate`) after editing any project-manifest file | The whole claim: `ctx-generate`, `.context/`, `normalize-ctx-paths.js` and `build-maintain`'s CTX step no longer exist, so no manifest edit requires regeneration. Retire or delete. | Ledger Knowledge Curator v1.4.2 (Targeted Reconciliation) |
| a7adbb64-4f57-42ac-9b27-25913bde3815 | scripts/cli.js ctx-generate: use --check for freshness; generation is staged and no longer wipes .context/ on a bad flag | The whole claim: the command and `scripts/lib/ctx-generate.js` are removed (the latter never reached `main`). Retire or delete. | Ledger Knowledge Curator v1.4.2 (Targeted Reconciliation) |

## Resolved Questions

All open questions from planning are answered by the user (2026-11-24); none remain open.

| # | Question | Answer | Effect on the plan |
|---|----------|--------|--------------------|
| 1 | Does the change get a root `changelog.md` entry? | Yes. It goes into the open `v2.16.0 - WIP; UNRELEASED` section; the user adds it after the run. | Human Action 1 now records the approved target section; the run still does not edit changelogs. |
| 2 | Should the Git Committer's CTX rules be stripped? | No, leave it for now: other projects of the user still use CTX generation. | Confirms the rejected Structural Improvements row; no work for the persona. |
| 3 | May `.vscode/mcp.json` be deleted? | Yes. | Confirms step 1. |
| 4 | Should the gitignored agent memories that mention CTX be updated? | No, ignore them; out of scope. | Confirms the Out of Scope entry. |
| 5 | In which order does this land relative to `feature-pipeline-adjustments`? | The CTX removal is done on the current feature branch (`feature-untrack-name-mapping`) as a maintenance operation; the user implements it himself. | Assumptions and Human Action 2 updated; the guard test still protects a later integration of `feature-pipeline-adjustments`. |

## Summary

Remove CTX Generator usage from the ai-insights repository: its configuration (`context.yaml`, three `module-context.yaml` files), its tracked output (`.context/`, about 4 MB, read by no code), the CLI command and the `build-maintain` step that run it, the path-normalisation helper, the pre-commit staleness warning, the `.gitattributes` rule, the editor MCP entry that serves it, and the reference guide — then bring every live manifest and workspace document in line so none tells an agent to read or regenerate `.context/`. The rationale is the user's: agents have outgrown pre-generated codebase snapshots. The CTX Architect persona and every persona that declares it as a sub-agent stay untouched, as do `scripts/bundle-docs.js`/`build/`, the other `build-maintain` steps, and the persona-build `--check` guard. A new static guard test keeps the removal from being undone by an unmerged branch.

## Architectural Context

- **CLI command centre** — `scripts/cli.js` registers commands in a `COMMANDS` array consumed by `createMenu(...)` (`@mistralys/cli-menu`). `cmdBuildMaintain` (L509–L520) runs version sync, root/orchestrator version sync, the persona build, `check-known-roles.js`, then `cmdCtxGenerate(args)` (L519). `cmdCtxGenerate` (L564–L581) deletes `.context/`, spawns `ctx generate`, runs `scripts/normalize-ctx-paths.js` and writes `.context/generated-at.txt`. The `ctx-generate` menu entry is at L1149–L1156; the `build-maintain` description at L927.
- **Git hook** — `.githooks/pre-commit` blocks on the persona `--check`, version sync and ruff; it warns on stale presentation `dist/`, on source changes without `.context/` changes (L56–L65), and on sub-project changelog drift. `STAGED` (L45) is shared by the remaining warning blocks.
- **Generated artefacts catalogue** — `docs/agents/project-manifest/generated-artefacts.md` is the single workspace document for generated files; module `constraints.md` files carry the derived rules; root `AGENTS.md` routes to it, and the Git Committer persona reads it through that link.
- **Manifest hub** — `docs/agents/project-manifest/README.md` (index, Generated Context section, navigation), `root-tooling.md` (script inventory), `development-commands.md` (commands, verification by change type).
- **Module manifests** — `personas/`, `orchestrator/`, `mcp-server/` each under `docs/agents/project-manifest/`.
- **Tests** — root Vitest suite `scripts/tests/` (`npm test` at the root). `scripts/cli.js` cannot be imported (top-level `createMenu(...).run(...)`), so CLI regressions are asserted on source text (`scripts/tests/cli-cmd-agent.test.js`, `scripts/tests/agents-overview.test.js` → `build wiring (static source checks)`).

## Approach / Architecture

A subtractive change in four layers, ordered so code never points at a deleted file:

1. **Artefacts** — delete CTX inputs, outputs, the helper script, the `.gitattributes` rule (and the then-empty file) and `.vscode/mcp.json`.
2. **Code paths** — remove `cmdCtxGenerate`, its menu entry and the `build-maintain` call; drop the pre-commit advisory block.
3. **Guard** — add `scripts/tests/ctx-removal.test.js`, a static test in the established source-text style, asserting that the CLI, hook and attributes carry no CTX wiring and that the CTX files (including the unmerged branch's `scripts/lib/ctx-generate.js`) are absent.
4. **Documentation** — remove or reword every live reference in the hub manifest, module manifests, root `AGENTS.md`/`README.md`, `docs/references/`, `docs/agents/references/` and the presentation design reference. `generated-artefacts.md` stays: it still catalogues version fields, the presentation `dist/`, the agents overview, the audit status, every ignored artefact and the hand-maintained neighbours, and the Git Committer depends on it.

Persona sources are not changed, so no persona rebuild or persona version bump is required; `docs/references/agents-overview.md` keeps its CTX Architect entry.

## Rationale

- `.context/` is fully derived (no unique content), unread by any code, and costs a tracked 4 MB, a mandatory external binary for `build-maintain`, a recurring regeneration chore, and a branch-policy special case. With the user's decision that agents no longer need it, every piece of the pipeline has lost its consumer.
- Keeping `generated-artefacts.md` is required, not optional: removing CTX deletes one row and its satellites, but the document's other rows and its role as the Git Committer's classification source remain.
- The Git Committer is left alone because its CTX rules are conditional on `context.yaml` (or, for the unconditional `.context/` drift default, inert when `.context/` does not exist), and it is a published, project-agnostic persona whose other consumers still use CTX. Changing it would cost a persona release for zero behavioural change here.
- The guard test is justified by a concrete threat, not speculation: `feature-pipeline-adjustments` adds three new CTX files that Git would merge in without conflict.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Fate of `.context/` | Delete the tracked directory | Freeze it (keep, stop regenerating); move it to `.gitignore` and keep generating locally | A frozen snapshot goes stale on the first commit and misleads agents; local generation keeps the binary dependency the removal is meant to drop. |
| Fate of the `ctx-generate` command | Remove command, menu entry and `build-maintain` step together | Keep `ctx-generate` as an opt-in command outside `build-maintain` | An opt-in command with no config files and no consumer is dead code; the CTX Architect, once repurposed, can reintroduce what it needs. |
| `generated-artefacts.md` | Keep; remove CTX rows and reword dependent text | Dissolve it into module `constraints.md` files | It still holds about 30 non-CTX rows, is the documented single source per `AGENTS.md`, and is the Git Committer's lookup target. |
| Git Committer CTX rules | Leave unchanged | Strip CTX rules; make them repo-configurable | Rules are guarded by `context.yaml`/`.context/` presence and serve other CTX-using repositories; editing a published persona for an inert rule adds a release with no effect here. |
| Regression protection | New static guard test `scripts/tests/ctx-removal.test.js` | No test (grep sweep only); assertions appended to `agents-overview.test.js` | A one-off grep does not survive the pending branch merge; a dedicated file keeps the purpose clear instead of overloading the agents-overview suite. |
| `.vscode/mcp.json` | Delete the file | Remove only the CTX server entry | It is the only entry; an empty `servers` object adds nothing, and the path (`F:\…`) is stale on every current checkout. |
| `.gitattributes` | Delete the file once its only line goes | Keep an empty file | An empty attributes file has no effect and invites the question of what it was for. |
| `docs/agents/references/ctx-generator-guide.md` | Delete | Move it next to the CTX Architect persona | No persona links it; the repurposing is undefined, and Git history preserves it if needed. |

## Pattern Alignment

- Follows the static source-text test pattern for `scripts/cli.js` — `scripts/tests/cli-cmd-agent.test.js`, `scripts/tests/agents-overview.test.js` (`build wiring (static source checks)`).
- Follows the single-catalogue pattern for generated files — `docs/agents/project-manifest/generated-artefacts.md` stays the only workspace catalogue; module `constraints.md` files only lose their CTX bullets.
- Follows the AGENTS.md Root-Level / Cross-Project table: a removed root script updates `root-tooling.md`, root `README.md` and `development-commands.md`; a removed generator updates `generated-artefacts.md`.
- Follows the Git Operations constraint (`docs/agents/project-manifest/constraints.md#git-operations`): files are deleted on the filesystem; staging the deletions is left to the Git Committer.
- Follows the history-is-immutable convention: dated curation-log entries, `docs/history/`, `docs/changelog-history/`, implementation history and plans are not rewritten.
- No departures.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `.vscode/mcp.json` | Exists only for the CTX MCP server; hard-coded `F:\Webserver\…` path resolves nowhere. | Promoted to step 1 | Its only purpose ends with this plan. |
| `.gitattributes` | Holds only the CTX line. | Promoted to step 1 | Empty after the edit; deleting avoids a meaningless file. |
| `docs/agents/project-manifest/generated-artefacts.md` → Root `AGENTS.md`/`CLAUDE.md` neighbour row | Its "why it looks generated" reasons are built on CTX history (`.context/agents.md`, `ctx-generate`). | Promoted to step 6 | Same row the plan must touch; rewording it to the surviving reason (`CLAUDE.md` once generated from `AGENTS.md`) keeps the row useful. |
| `personas/docs/agents/project-manifest/constraints.md` §C2a | Navigation is routed to a generated tree that will no longer exist. | Promoted to step 7 | Redirecting to the curated `file-tree.md` keeps the rule meaningful and fixes the matching `file-tree.md` blockquote. |
| `personas/docs/agents/project-manifest/README.md` L36 | Describes "tracked files a build command writes (name mapping, CTX output, …)" — name mapping has been untracked since `2026-11-24-untrack-name-mapping`. | Promoted to step 7 | Same cell the plan edits; fixing both inaccuracies costs nothing extra. |
| `.githooks/pre-commit` | Inline shell, untestable (global insight `2cd87f16…` recommends a guard registry). | Rejected | Reshaping the hook is a separate design change; this plan only shortens it, and the user asked to keep the persona `--check` guard as is. |
| `personas/standalone/src/content/git-committer.md` | Carries CTX-specific rules (*CTX rule*, *CTX date-only filter*, `CTX` label, feature-branch `.context/` exclusion, `.context/` default drift set). | Rejected | Conditional on `context.yaml`/`.context/`, inert here once both are gone; the persona is published and serves other CTX-using repositories; changing it means a rebuild, a persona version bump and a changelog entry for no behavioural change in this repo. Confirmed by the user (Resolved Question 2): other projects still use CTX generation. |
| `personas/shared/partials/documentation-ownership.md` L11 | Routes `context.yaml`/`.context/` ownership to the CTX Architect. | Rejected | Rendered only into keep-list personas; the routing is generic (applies to any project) and the persona is being kept for repurposing. |
| Dated curation logs (`docs/agents/project-manifest/curation-log.md`, module `curation-log.md` files, including the personas Standing Decision of 2026-10-16) | Mention `.context/`. | Rejected | Historical records; the Standing Decision's `.context/` clause becomes moot, not wrong. |
| `docs/history/key-learnings.md`, `docs/changelog-history/**` | Mention CTX. | Rejected | Historical, per the user's instruction. |

## Detailed Steps

1. **Delete CTX artefacts and their satellites** (filesystem deletions only; staging is the Git Committer's job):
   - Delete `context.yaml`, `mcp-server/module-context.yaml`, `personas/module-context.yaml`, `orchestrator/module-context.yaml`.
   - Delete the `.context/` directory entirely (including its current uncommitted regeneration drift).
   - Delete `scripts/normalize-ctx-paths.js`.
   - Delete `.gitattributes` (its only line is `.context/** text eol=lf`).
   - Delete `.vscode/mcp.json` (its only server is the CTX MCP server).

2. **Remove CTX from `scripts/cli.js`:**
   - Delete the `cmdCtxGenerate(args)` call at the end of `cmdBuildMaintain` (L519).
   - Delete the `cmdCtxGenerate` function (L564–L581).
   - Change the `build-maintain` description (L927) from `'Sync versions, build personas & CTX generate'` to `'Sync versions & build personas'`.
   - Delete the `ctx-generate` entry from `COMMANDS` (L1149–L1156).
   - Confirm `spawnSync`, `fs`, `IS_WIN` and `sh` are still used elsewhere (they are: L85, L225, L348, L82, `cmdGitHooks`), so no import is removed.

3. **Remove the CTX advisory from `.githooks/pre-commit`:** delete the block at L56–L65 (comment, `SRC_CHANGED`, `CTX_CHANGED`, the warning). Keep `STAGED` (L45), which the presentation and changelog-drift blocks still use, and every other block unchanged.

4. **Add the guard test (new file)** `scripts/tests/ctx-removal.test.js`, in the static source-text style of `scripts/tests/cli-cmd-agent.test.js`, with a header comment naming this plan and the `feature-pipeline-adjustments` reintroduction risk. Assertions:
   - `scripts/cli.js` source contains none of `cmdCtxGenerate`, `'ctx-generate'`, `normalize-ctx-paths`, `spawnSync('ctx'`.
   - The `cmdBuildMaintain` body (sliced from `function cmdBuildMaintain` to the next `\nfunction `, as in `agents-overview.test.js`) contains no `ctx`/`Ctx`.
   - The `build-maintain` command description contains no `CTX`.
   - `.githooks/pre-commit` contains no `.context`.
   - None of these paths exists: `context.yaml`, `mcp-server/module-context.yaml`, `personas/module-context.yaml`, `orchestrator/module-context.yaml`, `scripts/normalize-ctx-paths.js`, `scripts/lib/ctx-generate.js`, `scripts/tests/ctx-generate.test.js`, `scripts/tests/cli-ctx-generate.test.js`.
   - `.gitattributes`, if present, contains no `.context` rule.

5. **Remove the CTX reference guide:** delete `docs/agents/references/ctx-generator-guide.md`; in `docs/agents/references/README.md` remove the index row (L10) and the "Use the CTX guide…" line (L17).

6. **Update the hub manifest (`docs/agents/project-manifest/`):**
   - `README.md`: drop `context.yaml` from the root-tooling row (L28) and the Shared Infrastructure sentence (L116); delete the `## Generated Context (.context/)` section with its table and the `---` separator that belongs to it (L118–L132); delete the *Get a full codebase snapshot* navigation row (L161).
   - `generated-artefacts.md`: in *Purpose and Branch Policy* remove the `.context/**` drift sentence and the `CTX: Updated docs` clause (L7) and the `.context/` warning from the pre-commit description (L11); delete the `.context/**` row (L35) and the paragraph after the Documentation-style table (L39); delete the neighbour rows for `context.yaml`/`**/module-context.yaml` (L74), for manifests "Imported wholesale into `.context/`" (L81), for `mcp-server/module-context.yaml`/`orchestrator/module-context.yaml` (L83) and for module manifests imported into `.context/` (L84); reword the Root `AGENTS.md`/`CLAUDE.md` row (L75) to the reason that survives (`CLAUDE.md` was once generated from `AGENTS.md`; both are hand-maintained, `CLAUDE.md` holds an `@AGENTS.md` import); delete the `ctx-generate` command row (L96); end the `build-maintain` row (L97) with "and runs `check-known-roles.js`." instead of "…and finishes with `ctx-generate`."
   - `root-tooling.md`: delete the `scripts/normalize-ctx-paths.js` row (L30) and the `context.yaml` row (L67); remove "CTX staleness warning" from the `scripts/install-hooks.js` row (L41).
   - `development-commands.md`: change L37 to "…builds every persona suite and regenerates the agents overview."; change the *Manifest or documentation only* row (L121) to "No build." (drop the CTX staleness sentence).

7. **Update the module manifests:**
   - `personas/docs/agents/project-manifest/constraints.md`: §C2a (L24) — replace the `.context/personas/file-structure.md` pointer with the curated [`file-tree.md`](file-tree.md); Generated Artefacts — remove `.context/**` from the tracked list (L347), delete the "Commit `.context/` output only on `main`…" bullet (L351), drop `context.yaml` and `personas/module-context.yaml` from the neighbour bullet (L354), delete the `ctx-generate` bullet (L356).
   - `personas/docs/agents/project-manifest/file-tree.md`: rewrite the L5 blockquote so it no longer prefers a generated tree (state that this curated tree is the structural reference); delete the `├── module-context.yaml` line (L17).
   - `personas/docs/agents/project-manifest/README.md` L36: describe the Generated Artefacts hub document as covering tracked and ignored generated files (agents overview, audit status, name mapping), dropping "CTX output" and the inaccurate "tracked" framing of the name mapping.
   - `orchestrator/docs/agents/project-manifest/README.md` L92 and `file-tree.md` L13: delete the `module-context.yaml` line.
   - `orchestrator/docs/agents/project-manifest/constraints.md`: L705 — drop "the `.context/orchestrator/**` output"; L708 — reduce to reverting a `pyproject.toml` diff limited to `version`, without the `.context/` clauses; L710 — replace `module-context.yaml` with `.env.example` as the neighbour example alongside `requirements.txt`.
   - `mcp-server/docs/agents/project-manifest/constraints.md` L669: drop `module-context.yaml`, leaving `package-lock.json` as the neighbour example.

8. **Update workspace docs:**
   - `AGENTS.md`: *Restructure workspace* row (L110) — drop "and the generated context docs (regeneration is covered in …)"; delete the *Get a full codebase snapshot for LLMs* navigation row (L204); Generated Artefacts preamble (L210) — drop "the CTX context docs" from the list and change "including the cases of CTX output and date-only diffs" to "including the case of date-only diffs".
   - `README.md` L101: Reference Docs Hub description becomes "Workflow diagrams, Deep Agents patterns, Claude Code dispatch".
   - `docs/references/menu-guide.md`: Build & Maintain description (L78) becomes "Sync module versions and build personas"; delete the CTX generate row (L80); the `build-maintain` example comment (L119) becomes `# sync versions + build personas`.
   - `docs/references/development.md`: delete the `ctx-generate` row (L79).
   - `docs/presentation/docs/design-reference.md` L479–L481: replace "in the same spirit as the existing `.context/` staleness warning" with a self-contained statement that it is advisory and never blocks a commit.

9. **Verify and sweep:**
   - Run the root suite (`npm test` at the repository root), `node scripts/build-personas.js --check`, `node scripts/check-version-sync.js`, `sh -n .githooks/pre-commit`, and `node scripts/cli.js help` (confirm `ctx-generate` is no longer listed and `build-maintain`'s description has no CTX).
   - Run `git grep -n -E "ctx-generate|normalize-ctx|context\.yaml|module-context|\.context/|CTX generat|Generated Context"` and confirm every remaining hit is in the allowed set: keep-list persona sources and metas, `personas/standalone/src/content/git-committer.md`, `personas/shared/partials/documentation-ownership.md`, `personas/docs/persona-design-guide.md`, `personas/docs/audits/**`, `personas/README.md`, `personas/standalone/README.md`, `personas/docs/agents/project-manifest/{constraints.md L78–L79/L153–L154,api-surface.md}`, `docs/references/agents-overview.md`, `scripts/tests/subagent-reference-validation.test.js`, `scripts/tests/ctx-removal.test.js`, curation logs, `docs/history/**`, `docs/changelog-history/**`, `docs/agents/implementation-history/**`, `docs/agents/plans/**`, `changelog.md` history entries. Fix any other hit.
   - Record in the synthesis which checks ran and any that could not.

## Dependencies

- Step 2 depends on step 1 (the deleted helper must not be referenced) — in practice both land together.
- Step 4 depends on steps 1–3 (its assertions describe their end state).
- Steps 5–8 are independent of each other and of steps 2–4.
- Step 9 depends on all previous steps.

## Required Components

- Deleted: `context.yaml`, `mcp-server/module-context.yaml`, `personas/module-context.yaml`, `orchestrator/module-context.yaml`, `.context/`, `scripts/normalize-ctx-paths.js`, `.gitattributes`, `.vscode/mcp.json`, `docs/agents/references/ctx-generator-guide.md`.
- Modified: `scripts/cli.js`, `.githooks/pre-commit`, `AGENTS.md`, `README.md`, `docs/agents/references/README.md`, `docs/agents/project-manifest/{README.md,generated-artefacts.md,root-tooling.md,development-commands.md}`, `personas/docs/agents/project-manifest/{constraints.md,file-tree.md,README.md}`, `orchestrator/docs/agents/project-manifest/{README.md,file-tree.md,constraints.md}`, `mcp-server/docs/agents/project-manifest/constraints.md`, `docs/references/{menu-guide.md,development.md}`, `docs/presentation/docs/design-reference.md`.
- New: `scripts/tests/ctx-removal.test.js`.

## Assumptions

- No external process (CI, a deployed site, a user script) reads `.context/`. Verified for `.github/workflows/`, `docs/_config.yml`, `package.json`, `menu.sh`/`menu.cmd`, `mcp-server/`, `orchestrator/` and `scripts/`.
- The CTX Architect's future repurposing does not need the repository's own `context.yaml`; anything it needs can be reintroduced by that work.
- The work runs on the current feature branch, `feature-untrack-name-mapping`, as a maintenance operation, and the user implements it himself (Resolved Question 5); the existing uncommitted `.context/` drift is disposable (it is drift by the current branch policy).

## Constraints

- Do not edit the CTX Architect persona, the keep-list personas (`8-documentation`, `7-release-engineer`, `agents-md-curator`, `readme-curator`, `workspace-architect`, `manifest-curator`, `documentation-curator`), their partials, or `scripts/tests/subagent-reference-validation.test.js`.
- Keep `scripts/bundle-docs.js`, `build/`, the project manifests and docs sources, the other `build-maintain` steps and the persona-build `--check` line in `.githooks/pre-commit`.
- No git write operations by the implementing agent (Git Operations constraint).
- Do not edit historical records: plans, implementation history, syntheses, curation-log entries, `docs/history/`, `docs/changelog-history/`, ledger storage.

## Out of Scope

- The Git Committer persona's CTX rules (rejected; see Structural Improvements; confirmed by Resolved Question 2).
- Root and module changelog entries — the user adds the root entry to the `v2.16.0` WIP section after the run (see Human Actions, Resolved Question 1).
- Any change on `feature-pipeline-adjustments`.
- Gitignored agent memories that mention CTX: `.claude/agent-memory/7-release-engineer/feedback_combined_release_docs_wp.md` in this repository, and `DEV/.claude/agent-memory/{plan-auditor/project_ai-insights.md, 8-documentation/project_persona_targets_plan.md, git-committer/feedback_upstream_merge_generated_files.md}` in the workspace root. They sit outside version control and outside this repository's tree; their owners verify memories before acting on them. Confirmed out of scope by the user (Resolved Question 4).
- Uninstalling the `ctx` binary or user-level CTX MCP registrations.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Add the root `changelog.md` entry for this change to the open `v2.16.0 - WIP; UNRELEASED` section (approved by the user, Resolved Question 1). | After the run | The user reserved changelog writing for this change. |
| 2 | The removal lands on `feature-untrack-name-mapping` as a maintenance operation (Resolved Question 5). When `feature-pipeline-adjustments` is later integrated, drop its CTX additions (`scripts/lib/ctx-generate.js`, `scripts/tests/ctx-generate.test.js`, `scripts/tests/cli-ctx-generate.test.js`, its `cmdCtxGenerate`/pre-commit/`.gitignore`/doc changes); `scripts/tests/ctx-removal.test.js` fails until they are gone. | After the run | Merging branches is the user's (or the Git Committer's, on request) decision. |
| 3 | Optionally remove any user-level CTX MCP registration and the `ctx` binary. | After the run | Machine-level configuration outside the repository. |

## Acceptance Criteria

- AC-01: `context.yaml`, `mcp-server/module-context.yaml`, `personas/module-context.yaml`, `orchestrator/module-context.yaml`, `.context/`, `scripts/normalize-ctx-paths.js`, `.gitattributes`, `.vscode/mcp.json` and `docs/agents/references/ctx-generator-guide.md` no longer exist in the working tree.
- AC-02: `scripts/cli.js` has no `cmdCtxGenerate` function and no `ctx-generate` command; `cmdBuildMaintain` runs version sync, root/orchestrator version sync, the persona build and `check-known-roles.js` only, and its menu description mentions no CTX.
- AC-03: `.githooks/pre-commit` has no `.context/` warning; all other blocks, including `node scripts/build-personas.js --check || exit 1`, are unchanged, and `sh -n .githooks/pre-commit` passes.
- AC-04: `scripts/tests/ctx-removal.test.js` exists, passes, and fails if any of the deleted CTX files or `scripts/lib/ctx-generate.js` reappears or the CLI/hook regains CTX wiring.
- AC-05: The hub manifest (`README.md`, `generated-artefacts.md`, `root-tooling.md`, `development-commands.md`) contains no reference to `.context/`, `context.yaml`, `module-context.yaml`, `ctx-generate` or `normalize-ctx-paths.js`; `generated-artefacts.md` still exists with its non-CTX rows intact.
- AC-06: The personas, orchestrator and MCP server manifests (outside curation logs and persona-describing rows) contain no reference to `.context/`, `module-context.yaml` or `ctx-generate`; personas §C2a points to `file-tree.md`.
- AC-07: `AGENTS.md`, `README.md`, `docs/agents/references/README.md`, `docs/references/menu-guide.md`, `docs/references/development.md` and `docs/presentation/docs/design-reference.md` contain no reference to CTX generation, `.context/` or the deleted guide.
- AC-08: No persona source, partial, meta file or `scripts/tests/subagent-reference-validation.test.js` is modified; `node scripts/build-personas.js --check` passes.
- AC-09: The root `npm test` suite and `node scripts/check-version-sync.js` pass.
- AC-10: The final `git grep` sweep in step 9 returns hits only in the allowed set.

## Testing Strategy

The change is subtractive, so verification is a mix of one new static guard test (the durable protection), the existing suites (proving nothing else depended on the removed code), command smoke checks (`help`, `sh -n`), and a scripted reference sweep for documentation completeness. No behavioural test of `build-maintain` is run end to end, because it rewrites version fields and persona output on a feature branch; the static slice of `cmdBuildMaintain` covers its wiring.

## Test Plan

- `scripts/tests/ctx-removal.test.js` (new) — `scripts/cli.js has no ctx-generate command or cmdCtxGenerate` — asserts the CLI source lacks `cmdCtxGenerate`, `'ctx-generate'`, `normalize-ctx-paths`, `spawnSync('ctx'` — AC-02, AC-04.
- `scripts/tests/ctx-removal.test.js` (new) — `cmdBuildMaintain does not run CTX` — slices `cmdBuildMaintain` and asserts no `ctx`/`Ctx`; asserts the `build-maintain` description has no `CTX` — AC-02, AC-04.
- `scripts/tests/ctx-removal.test.js` (new) — `pre-commit hook has no .context warning` — reads `.githooks/pre-commit`, asserts no `.context`, and asserts `build-personas.js --check` is still present — AC-03, AC-04.
- `scripts/tests/ctx-removal.test.js` (new) — `CTX files are absent` — asserts each listed path (the four configs, `scripts/normalize-ctx-paths.js`, `scripts/lib/ctx-generate.js`, `scripts/tests/ctx-generate.test.js`, `scripts/tests/cli-ctx-generate.test.js`) does not exist — AC-01, AC-04.
- `scripts/tests/ctx-removal.test.js` (new) — `no .context rule in .gitattributes` — passes when the file is absent or has no `.context` line — AC-01, AC-04.
- `scripts/tests/agents-overview.test.js` → `build wiring (static source checks)` (existing, unchanged) — still passes against the shortened `cmdBuildMaintain` — AC-02, AC-09.
- Root `npm test` (existing suite, including `scripts/tests/subagent-reference-validation.test.js` unchanged) — AC-08, AC-09.
- `node scripts/build-personas.js --check`, `node scripts/check-version-sync.js`, `sh -n .githooks/pre-commit`, `node scripts/cli.js help` — command checks in step 9 — AC-03, AC-08, AC-09, AC-02.
- Step 9 `git grep` sweep against the allowed set — AC-05, AC-06, AC-07, AC-10.
- Filesystem check (`ls`) of every AC-01 path — AC-01.

## Documentation Updates

- `AGENTS.md` — L110, L204, L210 as in step 8.
- `README.md` — L101 reference hub description.
- `docs/agents/references/README.md` — remove the guide's index row and usage line.
- `docs/agents/project-manifest/README.md` — L28, L116, Generated Context section, L161.
- `docs/agents/project-manifest/generated-artefacts.md` — CTX rows, paragraphs and command rows; reworded `AGENTS.md`/`CLAUDE.md` neighbour row (AGENTS.md rule: a changed generator updates this document).
- `docs/agents/project-manifest/root-tooling.md` — removed script and config rows, hook description (AGENTS.md rule: a changed root script updates this document).
- `docs/agents/project-manifest/development-commands.md` — Build & Maintain description and the documentation-only verification row (AGENTS.md rule: a changed command updates this document).
- `personas/docs/agents/project-manifest/{constraints.md,file-tree.md,README.md}` — step 7.
- `orchestrator/docs/agents/project-manifest/{README.md,file-tree.md,constraints.md}` — step 7.
- `mcp-server/docs/agents/project-manifest/constraints.md` — step 7.
- `docs/references/menu-guide.md`, `docs/references/development.md` — CLI menu docs.
- `docs/presentation/docs/design-reference.md` — pre-commit warning comparison.
- `docs/references/agents-overview.md` — no change (generated; CTX Architect stays).
- Changelogs — not edited by the run; the user adds the root entry to the `v2.16.0` WIP section (Human Action 1). No persona or module version changes, since no persona source or module code changes.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Merging `feature-pipeline-adjustments` silently reintroduces CTX code and tests** | `scripts/tests/ctx-removal.test.js` fails on the reintroduced files; Human Action 2 names exactly what to drop. |
| **A stale document still tells agents to regenerate `.context/`** | Step 9 sweep with an explicit allowed set; Knowledge Base Reconciliation retires the two insights that mandate regeneration. |
| **The Git Committer keeps treating `.context/` as drift or forming a `CTX` group** | Inert: with no `context.yaml` and no `.context/`, its CTX rules have nothing to act on. The user confirmed leaving the persona unchanged (Resolved Question 2). |
| **Deleting `.context/` loses work** | Its content is fully derived; Git history keeps every committed version. |
| **Deleting `.vscode/mcp.json` removes a server a developer still uses** | The entry points at a Windows path absent from every current checkout and needs `context.yaml`, which this plan deletes; the user approved the deletion (Resolved Question 3). |
| **Removing the hook block breaks shell syntax or the shared `STAGED` variable** | `STAGED` is defined before the removed block and kept; `sh -n` in step 9 and AC-03. |
| **The CTX Architect's repurposing later needs the guide or configs** | Git history retains `docs/agents/references/ctx-generator-guide.md` and every config. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** A single-repository, predominantly subtractive change in well-understood root tooling and documentation, with one small static test; one developer session with the step 9 sweep as self-review suffices. The user implements it himself on `feature-untrack-name-mapping` (Resolved Question 5).
