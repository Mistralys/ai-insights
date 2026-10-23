# Curation Log

Why this manifest looks the way it does, and when it was last verified.
Read freely — Standing Decisions explains the deliberate gaps and conventions.
Written by the Manifest Curator only; no other agent edits this file.

## Standing Decisions

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-16 | The practice for generated artefacts on feature branches is the one the Git Committer persona (`personas/standalone/src/content/git-committer.md`) enforces. On a feature branch, generator drift (including all `.context/` output) stays out of commits and is reverted by path before upstream integration. A generated file whose source the branch changed is committed with that change. `.context/` is committed only on the default branch `main`, as a `CTX: Updated docs` commit. Date-only diffs of generated files are never committed. `generated-artefacts.md` and `constraints.md` → Generated Artefacts summarise this and cite the Git Committer rather than restating its procedure. | Decided by the user. The Git Committer is the agent that commits and discards these files, so making its rules the project practice keeps one source of truth. Where the two disagree, the Git Committer persona wins and the manifest is corrected. |

## History

### 2026-10-23 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: the consolidation of the generated-artefacts documentation into the hub manifest, and the links this manifest holds to it. Not a full reconcile.
**Commit:** 2d4220a3 (working tree held uncommitted changes, including earlier same-day manifest edits)
**Changes:** Deleted this manifest's `generated-artefacts.md`; its content now lives in the hub's `docs/agents/project-manifest/generated-artefacts.md`, which is the single document for the repository. Repointed the `README.md` index row and the `constraints.md` → Generated Artefacts preamble and first bullet to the hub file. The `constraints.md` section is kept and remains the binding rules. History entries and Standing Decisions below name `generated-artefacts.md` as it stood when written; where they refer to a document in this directory, read the hub file. The consolidation Standing Decision is recorded in the hub's Curation Log.
**Notes:** The reverted-decision search, changed-code intersection and adjacent-document check were not run, by the brief's scope. Root `AGENTS.md` and the CTX configuration are stages still to come; findings for both are in the hub log's entry for this date.

### 2026-10-23 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: Purpose and Branch Policy in `generated-artefacts.md`, to agree with the hub copy. Not a full reconcile.
**Commit:** 2d4220a3
**Changes:** Added a paragraph recording that a commit on a branch that is not a feature branch opens with a fresh Build & Maintain run (`node scripts/cli.js build-maintain`), and that a feature branch skips it. The paragraph states this is a project-level rule the Git Committer persona does not enforce, because the owner decided on 2026-10-23 to keep it out of that persona; the Git Committer stays the authority for the feature-branch practice only. It links to the hub copy. The command and menu label were checked against `scripts/cli.js`. The Standing Decision above is unchanged, since it covers the feature-branch practice; the new decision is recorded in the hub log.
**Notes:** The working tree held uncommitted changes, so the scan read 2d4220a3 plus that working tree. Other checks were not run, by the brief's scope. The hub log holds the finding for root `AGENTS.md`.

### 2026-10-23 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: `constraints.md` → C5f (anchor `nested-delegation`), the Orchestrator row only, for the Workspace Architect v1.7.0 Amend changes. Not a full reconcile.
**Commit:** bc2b4737
**Changes:** The Orchestrator row now names *Amend Routing*, *Amend Dispatch* and the Amend workflow's *Stage 7 — Other Owners* and *Return Pass* steps as locations. It also records four things. The owner's own pass record is part of every Amend dispatch's scope, and Amend verification checks it. Routing follows the changed section to the files it names as authority or summary, and files outside the documentation set join as user-approved stage 7 rows. An in-brief finding for a stage that already ran goes back in one return pass, and no owner is dispatched more than twice. The summary has a **Return Passes** line, and **Follow-ups** is narrowed. Checked against `personas/standalone/src/content/workspace-architect.md` and its meta changelog. No other personas manifest document describes Amend dispatches or follow-up handling.
**Notes:** The working tree held uncommitted changes, the v1.7.0 persona source included, so the scan read bc2b4737 plus that working tree. The reverted-decision search, changed-code intersection, generated-artefacts check and adjacent-document check were not run, because the brief limited the scope. One finding for root `AGENTS.md` (owner: AGENTS.md Curator), reported to the caller: the Personas maintenance row on caller's-plan deferral names "the Workspace Architect's *Delegation Protocol* inputs", but the Amend dispatch inputs now live in *Amend Dispatch*.

### 2026-10-19 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: mentions of root `AGENTS.md` and root `CLAUDE.md` as hand-maintained neighbours. Touched `generated-artefacts.md` (Hand-maintained Neighbours) and `constraints.md` (Generated Artefacts). Not a full reconcile.
**Commit:** 1ced4e17
**Changes:** Root-level files are recorded only by the workspace hub manifest, so the two root-file rows were removed from the Hand-maintained Neighbours table and both files were dropped from the "Never revert a hand-maintained neighbour" bullet. The `ctx-generate` bullet stays. The rest of the personas manifest was searched; remaining hits are the AGENTS.md Curator persona and cross-references to the root manual, which are not neighbour claims.
**Notes:** The working tree held uncommitted changes, so the scan read 1ced4e17 plus that working tree. The reverted-decision search, changed-code intersection and adjacent-document check were not run, by the brief's scope. The earlier 2026-10-19 entry above describes the now-removed `CLAUDE.md` neighbour row; it is a dated record and stays as written.

### 2026-10-19 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: root `CLAUDE.md` no longer described as generated (`generated-artefacts.md`, `constraints.md`, `README.md`), the `api-surface.md` Sync Script section, and one pointer in `file-tree.md`. Not a full reconcile.
**Commit:** 1ced4e17
**Changes:**
- Root `CLAUDE.md` is a hand-maintained one-line `@AGENTS.md` import, and `cmdCtxGenerate()` in `scripts/cli.js` contains no reference to it. Removed its row from the tracked table, dropped the overwrite from the `ctx-generate` and `build-maintain` command rows, listed it under Hand-maintained Neighbours, and updated the `constraints.md` Generated Artefacts preamble and two bullets.
- `api-surface.md`: path helpers and `parseFrontmatter` moved from the function table to an Imported Helpers note (they come from `scripts/publish-locations.js` and `scripts/lib/frontmatter.js`); `validateVSCodeFrontmatter` lists `role`, `name`, `vs_file_name`, `id` and `model`; the `KNOWN_ROLES` snippet shows the ESM `JSON.parse(fs.readFileSync(...))` form. Verified against `scripts/sync-personas.js`.
- `file-tree.md`: `scripts/` section points to the hub's `root-tooling.md`.

**Notes:** This closes the four observations the 2026-10-16 entry left open on the Sync Script section. The 2026-10-16 History entry above still describes `CLAUDE.md` as generated; it is a dated record and stays as written. Wording elsewhere in this log's older entries is untouched.

### 2026-10-16 · Update · Curator v1.8.0

**Scope:** Narrow, by fact: the persona build, check and sync facts of the caller's brief, in `api-surface.md` (build Exit code paragraph, Sync Script functions table and CLI Behaviour), `constraints-build-system.md` (entries 9 and 14), and the root manifest hub `docs/agents/project-manifest/README.md` (Cross-System Dependencies → Agent name mapping row, Validation Scripts → `build-personas.js --check` row). Each file was searched whole for the brief's facts. No other section was reconciled.
**Commit:** 1502acd9
**Changes:**
- `api-surface.md`: Sync Script table renames `validateStandaloneVSCodeFrontmatter` / `validateStandaloneCCFrontmatter` to `validateSlugModeVSCodeFrontmatter(dir, suiteLabel)` / `validateSlugModeCCFrontmatter(dir, suiteLabel)`, both serving standalone and ledger-support. The `syncStandalone*` and `syncLedgerSupport*` rows name the validator each calls. CLI Behaviour states the sync takes no `--suite` and ignores unknown arguments. The Exit code paragraph drops "the five checks".
- `constraints-build-system.md`: entry 14 uses the slug-mode names and lists `id` for the VS Code validator. Entry 9 drops "one of the five descriptors".
- Root hub `README.md`: the Agent name mapping row names all three suites' `src/meta/` plus `personas/model-registry/` and links to the `generated-artefacts.md` Runtime-coupled table. It says the file is regenerated by real builds only. The `--check` row now describes a write-free validation run that never compares against disk and links to the personas CLI interface section.

**Notes:** Stage 1 of a Workspace Architect Amend plan. Facts re-verified against `scripts/build-personas.js`, `scripts/sync-personas.js` and `scripts/lib/name-mapping.js`. The working tree held uncommitted changes, earlier stage-1 passes of this session included, so the scan read 1502acd9 plus that working tree. `1502acd9..HEAD` is empty, so the changed-code intersection and reverted-decision search had no range to cover. The root hub has no curation log of its own; this entry records its edits. Deferred, outside the brief:
- `api-surface.md` → `validateVSCodeFrontmatter` row omits `model`, which the code also checks (`constraints-build-system.md` entry 14 has it).
- `api-surface.md` → `KNOWN_ROLES` snippet shows `require(...)`; `scripts/sync-personas.js` is ESM and uses `JSON.parse(fs.readFileSync(...))`.
- `api-surface.md` → Sync Script table lists `getVSCodePromptsDir`, `getClaudeCodeAgentsDir`, `getClaudeCodeSkillsDir` and `parseFrontmatter` as its functions; they are imported from `scripts/publish-locations.js` and `scripts/lib/frontmatter.js`.
- Root hub `README.md` → "Orchestrator persona files" row names `personas/ledger/claude-code/` filenames; root `AGENTS.md` names `personas/ledger/deep-agents/`. Not verified this pass.

### 2026-10-16 · Update · Curator v1.8.0

**Scope:** Narrow, by fact rather than by line: seven persona-build facts from the caller's brief (`--check` / `--dry-run` semantics and the `note_only` guard; `--strict` semantics and unresolved markers; the pre-commit hook; `name-mapping.json` inputs and fields; the build wrapper's flags; `sync-personas.js` build call, `--target` and `--dry-run`; `package-personas.js` build and `TARGETS`). Every manifest document except this log was searched for statements of those facts. No other content was verified.
**Commit:** 1502acd9
**Changes:**
- `constraints-build-system.md`: entry 5 names the library's `[WARN] Unresolved variable` / `[WARN] Partial not found` lines and says they never fail the build, `--strict` included. Entry 6 adds the partial case and states that `resolveExitCode()` considers only the library status and error count. Log-Prefix Convention: removed the `[STRICT]` row (nothing emits it) and the prefix count. Entry 8 rewritten: the `note_only` guard is `validateNoteOnlyGuard()` in `personas/plugins/ledger/role-validator.js`, run from the ledger plugin's `onValidate` hook on output cached in `onPostRender`, error severity, on every build. Removed the staleness comparison, `staleCount` and `[note_only-violation]`. Entry 13 adds the ledger-support sync functions, `--custom-path` and `syncSkills()`. Entry 15: the sync calls the build with no arguments or `--dry-run` only, and `--dry-run` previews from existing output.
- `api-surface.md`: build flags intro and `--strict` row; step 6 warnings marked never fatal; `name-mapping.json` table gains `suite`, `model`, `model_slug`, `cc_model`, and `number` is `null` outside the ledger suite; Sync Script gains `syncLedgerSupportVSCode`, `syncLedgerSupportClaudeCode`, `syncSkills` rows and a CLI Behaviour subsection.
- `tech-stack.md`: build flags intro and `--strict` row; sync flag rows (`--target` selects deploy steps only, `--dry-run` copies nothing); sync tool row mentions skills.
- `data-flows.md`: sync step 1 spawn line; note under the sync diagram for the ledger-support steps and `syncSkills()`.
- `constraints.md`: entry 25 closing sentence no longer cites a "pre-commit freshness guard"; entry 26 wording; entry 27 rewritten: the hook validates sources and is not a freshness guard.
- `variables.md`: resolution table's unresolved-variable rows.
- `README.md` (index): `--dry-run` is the `--check` alias; strict-mode block rewritten (no `[STRICT]`, markers never fatal); sync `--target` heading.
- `generated-artefacts.md`: `sync-personas.js` row (skills, `--dry-run`); new `package-personas` row (full `--strict` build unless `--skip-build`; `TARGETS` keeps ZIPs standalone-only).

**Notes:** Dispatched as stage 1 of a Workspace Architect Amend plan. The facts came from the caller's brief and were spot-checked against `.githooks/pre-commit`, `scripts/sync-personas.js`, `scripts/package-personas.js`, `scripts/lib/build-checks.js`, `scripts/build-personas.js`, `scripts/lib/name-mapping.js` and `personas/plugins/ledger/`. The working tree held uncommitted changes, including the `sync-personas.js` change that stopped passing `--suite` / `--target`. The commit above is the last one and equals the previous entry's floor, so the changed-code intersection and reverted-decision search had an empty committed range and were not run. The Adjacent Document Check was not run, because the caller assigned root `AGENTS.md` and `personas/README.md` to later stages. Left for the next pass, outside these facts:
- `api-surface.md` → Sync Script lists `validateStandaloneVSCodeFrontmatter` / `validateStandaloneCCFrontmatter`. The code has `validateSlugModeVSCodeFrontmatter(dir, suiteLabel)` / `validateSlugModeCCFrontmatter(dir, suiteLabel)`. `constraints-build-system.md` entry 14 uses the old names too.
- `api-surface.md` → build Exit code paragraph says "any of the five checks", which is a count.

### 2026-10-16 · Update · Curator v1.8.0

**Scope:** Narrow, persona-build facts only: the `--check` semantics, the name-mapping inputs and ordering, `--suite` / `--target` being ignored by the build wrapper, `--strict` semantics in `constraints-build-system.md` entry 6, and the `generated-artefacts.md` items the previous entry deferred. Covered `api-surface.md` → `build-personas.js` flags and post-build step 2; `data-flows.md` → build post-build step and sync pipeline step 1; `constraints-build-system.md` entries 6 and 15; `tech-stack.md` → CLI Flags (`build-personas.js`); `README.md` → the `--check` usage heading; `constraints.md` entry 26; `generated-artefacts.md` → Purpose and Branch Policy, the `.context/**` row, Known Contradictions. No other content in any document was verified.
**Commit:** 1502acd9
**Changes:**
- `--check` (in `api-surface.md`, `tech-stack.md`, `README.md`, `constraints.md` 26, `generated-artefacts.md` → Purpose and Branch Policy): now described as an in-memory render that writes nothing and fails only on error-severity validation results. It never compares against files on disk. The pre-commit paragraph also names the hook's other blocking steps, `check-version-sync.js` and ruff on staged orchestrator Python.
- Name mapping (`api-surface.md` post-build step 2, `data-flows.md` post-build): it reads all three suites' `src/meta/` plus `personas/model-registry/`. Ledger entries come first by `number`, then non-ledger entries by suite and role. Entry fields now include `suite`, `model`, `model_slug` and `cc_model`, and `number` is `null` outside the ledger suite.
- Sync (`data-flows.md` sync step 1, `constraints-build-system.md` 15): the build ignores the `--suite` / `--target` that the sync passes and builds everything in `persona-build.config.js`. `--target` limits only the copy step.
- `constraints-build-system.md` 6: rewritten. The wrapper runs no marker scan and has no `strictFailures` counter. `--strict` is forwarded to the library, which then also fails on warning-severity validation results. Unresolved `{{variable}}` markers only print a console `[WARN]` and never fail the build. Removed GN-4 (fence stripping for a scan that does not exist) and GN-5 (`--check` detecting stale output). The recommended command is now `node scripts/build-personas.js --strict`.
- `generated-artefacts.md`: the `.context/**` row's verdicts are now branch-scoped. On a feature branch the row is always drift; the per-file safe and unsafe conditions apply only on `main`, as the 2026-10-16 Standing Decision requires. Removed the Known Contradictions bullet about the `persona-build.config.js` header, which now states the `--check` behaviour correctly.

**Notes:** Dispatched as stage 1 of a Workspace Architect Amend plan. The working tree held uncommitted changes when scanned, including the `persona-build.config.js` header rewrite. The commit above is the last one and equals the previous entry's floor, so the changed-code intersection and the reverted-decision search had an empty committed range and were not run beyond the caller's evidence. The Adjacent Document Check was not run: the caller assigned root `AGENTS.md` and `personas/README.md` to later stages. The generated-artefacts check covered only the rows named above. The same wrong facts survive outside this pass's scope, left for the next pass:
- `constraints-build-system.md` 8 says `--check` compares generated content against the file on disk, and describes a `staleCount` / `[note_only-violation]` guard in `build-personas.js`. The `note_only` check now lives in the ledger plugin (`personas/plugins/ledger/role-validator.js`, error severity).
- `constraints-build-system.md` → Log-Prefix Convention lists a `[STRICT]` prefix for unresolved markers. Nothing emits it.
- `constraints.md` 27 says the hook fails when a generated persona file is stale.
- `api-surface.md` and `tech-stack.md` → `--strict` rows, and `README.md` → strict-mode usage, still say `--strict` fails on unresolved markers.
- `api-surface.md` → `name-mapping.json` — All Suites table lacks the `suite`, `model`, `model_slug` and `cc_model` fields.

### 2026-10-16 · Update · Curator v1.8.0

**Scope:** Narrow, one user decision only: the feature-branch practice for generated artefacts, in `generated-artefacts.md` → Purpose and Branch Policy and `constraints.md` → Generated Artefacts. No other content in any document was verified.
**Commit:** 1502acd9
**Changes:**
- `curation-log.md`: first Standing Decision, recording the user's ruling that the Git Committer persona's generated-artefact rules are the project practice.
- `generated-artefacts.md` → Purpose and Branch Policy: removed the `TODO: verify` marker. The paragraph now states the practice and cites the Git Committer as the authority. The pre-commit hook description is kept as a separate paragraph.
- `constraints.md` → Generated Artefacts: removed the `TODO: verify` marker. Replaced the "regenerate on the integration branch" bullet with three: follow the Git Committer's rules (drift out of feature-branch commits, reverted by path before integration; first materialisation committed with its source), `.context/` only on `main` as `CTX: Updated docs`, and no date-only commits of generated files.

**Notes:** The working tree held uncommitted changes when scanned. The commit above is the last one. `main` is the default branch according to `origin/HEAD`. The reverted-decision search, changed-code intersection, generated-artefacts row check and Adjacent Document Check were not run, because the caller limited the pass to this decision. Left for the next pass: the `.context/**` row in `generated-artefacts.md` still gives per-file safe and unsafe verdicts. The Git Committer treats all of `.context/` as drift on a feature branch whatever the row says, so the row's *Unsafe to discard when* condition never applies there. It now matters only on `main`, and the row should say so.

### 2026-10-16 · Update · Curator v1.8.0

**Scope:** Narrow. Covers only the four corrections the previous entry left for the next pass: `file-tree.md` → `shared/partials/`, `constraints.md` entries 4, 33 and 34, and `constraints-cross-system.md` entry 3. No other content in any document was verified.
**Commit:** 1502acd9
**Changes:**
- `file-tree.md` → `shared/partials/`: the listing now matches the directory on disk. Added `documentation-ownership.md`, `no-release-cycles.md`, `outcome-summary-crafting-guide.md`, `refinement-pass-label.md`, `release-history-archiving.md`, `research-brief-reference.md`, `title-crafting-guide.md` and `wip-changelog-version.md`.
- `constraints.md` entry 4 (Edit → Build → Sync): removed the `--suite` / `--target` build flags. `scripts/build-personas.js` parses only `--check`, `--dry-run` and `--strict`, forwards `--config personas/persona-build.config.js` to the library CLI, and passes no other argument on. The sync-personas step is unchanged.
- `constraints.md` entries 33 and 34: the overview path is now `docs/references/agents-overview.md`, which is the `OUTPUT_FILE` in `scripts/generate-agents-overview.js`.
- `constraints-cross-system.md` entry 3: the name mapping now covers all three suites' meta directories plus `personas/model-registry/`, read by `scripts/lib/name-mapping.js` and invoked from `build-personas.js`. The entry-shape and regeneration-trigger lists now include the `suite`, model and `name` / `changelog` / `model_slug` inputs the code reads. Removed the ledger persona count.

**Notes:** Dispatched as stage 1 of a Workspace Architect Amend plan. The working tree held uncommitted changes when scanned. The commit above is the last one. The reverted-decision search, changed-code intersection and generated-artefacts check were not run, because the caller limited the pass to these corrections. Both `TODO: verify` markers about the feature-branch practice stay in place, and that question is still open. The same stale facts survive in documents outside this pass's scope, and they are left for the next pass:
- `api-surface.md` → `build-personas.js` post-build step 2 and `data-flows.md` → build post-build step still say the name mapping reads only the ledger YAML and has one entry per ledger persona, sorted by `number`.
- `constraints-build-system.md` entry 6 recommends `--strict --suite all`. `--suite` has no effect there.
- `data-flows.md` → sync flow shows `sync-personas.js` passing `--suite` and `--target` to the build. That is what the code does, but the wrapper ignores both flags, so the diagram implies a narrowing that does not happen.
- Code observations, not manifest defects: `scripts/sync-personas.js` and `scripts/package-personas.js` (`--suite standalone --target all --strict`) both pass flags the wrapper discards, so packaging builds every suite.

### 2026-10-16 · Update · Curator v1.8.0

**Scope:** Narrow, three user-approved changes only: (1) a new `generated-artefacts.md`, with its index row and the matching *Generated Artefacts* section in `constraints.md`; (2) the four missing rows in `api-surface.md` → Shared Partials; (3) entry 5f in `constraints.md` and the `documentation-ownership.md` row in `api-surface.md`, for the caller's-plan refinement. No other content in any document was verified.
**Commit:** 1502acd9
**Changes:**
- `generated-artefacts.md` created. Tracked generated files: `personas/name-mapping.json` (runtime-coupled, loaded by the MCP server), `.context/**`, root `CLAUDE.md`, `docs/references/agents-overview.md`, `personas/docs/audits/status.md`. The built persona files under every `personas/*/{vs-code,claude-code,deep-agents}/` are gitignored, and only the `.gitkeep` placeholders in four of those directories are tracked. Linked from `README.md`.
- `constraints.md`: new *Generated Artefacts* section (anchor `generated-artefacts`), unnumbered so it does not collide with the existing numbering.
- `api-surface.md` → Shared Partials: added `ax-feedback.md`, `developer-philosophy.md`, `pm-subagent-roster.md` and `outcome-summary-crafting-guide.md`, with includers taken from the suite content files.
- `constraints.md` → 5f and the `documentation-ownership.md` row: a document whose stage the caller's plan marks skipped now counts as already decided, like one whose owner is still to come. 5f also names the Manifest Curator's *CTX Context Delegation* skip rule beside its step 13. 5f still links to the guide's Pattern 9 → Nested Delegation and does not restate it.

**Notes:** The working tree held uncommitted changes when scanned, including every persona source and the guide change documented here. The commit above is the last one. The reverted-decision search and changed-code intersection were not run, because the caller limited the pass to these three changes.
- Open question for the user: the branch practice for generated artefacts, and the branch they are regenerated on, are not recorded anywhere. Both `generated-artefacts.md` and the new `constraints.md` section carry a `TODO: verify` marker until that is settled. Once settled, it belongs in Standing Decisions.
- Found while checking generators: `name-mapping.json`'s `model`, `model_slug` and `cc_model` fields come from the gitignored `personas/model-registry/local.json` and `assignments.json`, so the tracked file varies between machines. Recorded under *Known Contradictions*.
- Left for the next full pass: `file-tree.md`'s `shared/partials/` listing omits several partials now on disk (among them `documentation-ownership.md`, `outcome-summary-crafting-guide.md`, `wip-changelog-version.md`); `constraints.md` C4 still documents `--suite` / `--target` flags that the index says the wrapper does not take; C34 and AGENTS.md give the overview path as `docs/agents-overview.md` where the generator writes `docs/references/agents-overview.md`; cross-system X3 says the name mapping reads the ledger YAML only, where `scripts/lib/name-mapping.js` reads all three suites and the model registry.

### 2026-10-16 · Update · Curator v1.8.0

**Scope:** Narrow, one change only: documenting how the persona suite implements nested delegation between documentation personas. Covered `api-surface.md` → Shared Partials and `constraints.md` → Persona Content Philosophy. No other content in any document was verified.
**Commit:** 1502acd9
**Changes:**
- `api-surface.md` → Partials Inventory → Shared Partials: added the missing `documentation-ownership.md` row (includers, agent-name/slug variables, `ownership_read_only`, target flags, the caller's-plan rule).
- `constraints.md` → Persona Content Philosophy: added entry 5f (anchors `c4f` and `nested-delegation`), recording the shared partial rule, the inline caller's-plan deferrals in the Manifest Curator, AGENTS.md Curator and Documentation Curator, and the Workspace Architect as the orchestrator that sends the plan. It links to the Persona Design Guide, Pattern 9 → Nested Delegation, rather than restating it.

**Notes:** Dispatched as stage 1 of a Workspace Architect Amend plan. The working tree held uncommitted changes when scanned, and the persona sources documented here were among them. The commit above is the last one. `api-surface.md` already held an uncommitted `wip-changelog-version.md` row from other work, which this pass left alone. The reverted-decision search, changed-code intersection and generated-artefacts check were not run, because the caller limited the pass to this change. The skip is deferred, not settled:
- This manifest has no `generated-artefacts.md`, although the project tracks generated files such as `personas/name-mapping.json` and `.context/`. That is for the next full pass.
- The Shared Partials inventory still lacks `ax-feedback`, `developer-philosophy`, `outcome-summary-crafting-guide` and `pm-subagent-roster`. These are a follow-up the caller has already recorded.

Facts verified on the way:
- The partial is included from the three personas' content files, not their YAML. The YAML declares the owners in `subagents`.
- No current persona sets `ownership_read_only`. The Manifest Reviewer set it when the partial was introduced, and that persona no longer exists.

### 2026-09-23 · Update · Curator v1.4.1

**Scope:** Narrow verification only — every document in this manifest was searched for references to the `standalone-archiver` persona (renamed to `ledger-synthesis-maintainer`, "Ledger Synthesis Maintainer", v2.0.0, id `ledger-support-synthesis-maintainer`) and to the standalone-only framing of `ledger_update_synthesis`. No other content in any document was verified.
**Commit:** d5a1062a
**Changes:** None — no drift found. `api-surface.md`'s two partial-consumer rows (`summary-crafting-guide.md`, `title-crafting-guide.md`) had already been reconciled to "Synthesis Maintainer" by hand before this pass; nothing else in the manifest names the persona or its files.
**Notes:** The working tree held uncommitted changes when scanned — the commit above is the last one, and the rename was among the uncommitted work. The reverted-decision search and changed-code intersection were not run; the pass was scoped to one rename by the requesting agent. Outside this manifest and therefore not corrected here: `personas/ledger-support/README.md` lists the persona's display name as "Synthesis Maintainer" where its `meta` YAML and every sibling row give the full `name` (`Ledger Synthesis Maintainer`) — routed to Documentation (Standalone).

### 2026-09-02 · Update · Curator v1.4.1

**Scope:** All 14 discrepancies from the 2026-09-02 audit — `README.md`, `tech-stack.md`, `api-surface.md`, `file-tree.md`, `constraints-build-system.md`, `variables.md`. `data-flows.md`, `constraints.md`, and `constraints-cross-system.md` needed no changes (audit found none).
**Changes:**
- `README.md` — rewrote Overview and Quick Reference to describe all three suites (ledger, standalone, ledger-support) and all three targets (vscode, claude-code, deep-agents); removed the hand-maintained Version/Last Updated header; added a Curation Log row to the Manifest Sections table.
- `tech-stack.md` — moved `@mistralys/persona-builder` into the Production table (it is a `personas/package.json` dependency, not a workspace-root devDependency) and corrected its version to `^2.6.0`.
- `api-surface.md` — fixed the Planner's `has_mcp` flag (was `—`, is `✓`); corrected the `FRONTMATTER_STANDALONE_VSCODE` template (`name` now shows `v{{version}}` appended, `last_updated` now shows its `{{#if}}` guard) and the matching Metadata Field Map row; added a Key Derivation Rules bullet documenting the `name`/`version` composition.
- `file-tree.md` — full rewrite of the `personas/` tree: added the `ledger-support/` suite, `model-registry/`, `name-mapping.json`, all three suites' `deep-agents/` output dirs, `docs/audits/` and the other `docs/*.md` files, `variables.md` and `curation-log.md` in the manifest's own doc list, and `handoff-block-manual.md`; replaced the entirely-wrong `shared/partials/` listing with the real 22-file set; added a header note pointing to `.context/personas/file-structure.md` as the drift-proof source for pure structure.
- `constraints-build-system.md` — rewrote item 2: nested `{{#if}}` inside an `{{else}}` branch (and `{{else if}}` chains) are supported and required for three-target content; only nesting inside a truthy branch with no `{{else}}` is unsupported. Marked item 10's version-lag callout resolved now that `personas/package.json` pins `^2.6.0`.
- `variables.md` — corrected the `{{name}}` (standalone) example to the plain form, noting the template appends the version.

**Notes:** Per the prior audit's recommendation, `file-tree.md` and `README.md` were rewritten wholesale rather than patched piecemeal. `personas/README.md`'s stale `--suite` flag reference was left untouched — it is a sibling doc, not this manifest, and was routed to Documentation (Standalone) in the audit report rather than corrected here.

### 2026-09-02 · Audit · Curator v1.4.1

**Scope:** Whole manifest — `README.md`, `tech-stack.md`, `api-surface.md`, `data-flows.md`, `file-tree.md`, `constraints.md`, `constraints-build-system.md`, `constraints-cross-system.md`, `variables.md`.
**Changes:** None — audit only. This is the manifest's first recorded curation pass; no prior log existed.
**Findings:** 6 high, 6 medium, 2 low. See [audit-report-2026-09-02.md](audit-report-2026-09-02.md). Highlights: `README.md`/`file-tree.md` still describe a two-suite, two-target system (the codebase now has three of each); `constraints-build-system.md` item 2 claims nested `{{#if}}` is unsupported, contradicted by the live engine and by three other documents in this same manifest.
