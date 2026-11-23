# Research Brief

## Scope Sketch

- Skill sources — `skills/meta/`, `skills/src/`, `skills/README.md` — modification (new `scope` field) and new code (three new skills: `release-check`, `insights-changelog`, `insights-changelog-archive`)
- Skills build — `scripts/build-skills.js` — modification
- Skills publish — `scripts/publish-skills.js`, `scripts/publish-locations.js` — modification; new `scripts/lib/` modules
- CLI menu — `scripts/cli.js` (`cmdPublishSkills`, `cmdBuildMaintain`, menu entries) — modification
- Persona sync — `scripts/sync-personas.js` (`syncSkills`) — modification (removal)
- Hand-maintained skill and prompts — `.github/skills/release-check/SKILL.md`, `.github/prompts/*.prompt.md` — migration into the build, deletion
- Local publish targets — `.github/skills/`, `.claude/skills/` — integration (tracked generated output)
- CI — `.github/workflows/ci.yml` — modification
- Persona builder library — `ai-persona-builder` (sibling repo) — verification only, no change
- Documentation and manifests — hub `docs/agents/project-manifest/`, personas manifest, `docs/references/`, root `README.md`, root `changelog.md` — modification
- CLI menu "p" publish action (added requirement, 2026-11-23) — `scripts/cli.js` (`sync-personas` command, key `p`, becomes the combined publish action), new `scripts/lib/` module, `scripts/lib/name-mapping.js` — modification and new code
- Callers of the `sync-personas` command — `scripts/lib/health-checks.js`, `scripts/launch-agent.js`, `docs/references/{menu-guide,development,persona-quickstart-ide}.md`, `skills/README.md` — modification (`--parts personas` where the intent is personas only)
- CLI menu library — sibling repository `cli-menu` (`@mistralys/cli-menu`) — modification (public checkbox prompt), release preparation only

## Area: Skill sources

### Verified References
- `skills/meta/_shared.yaml`: only `default_version: '1.0.0'`.
- `skills/meta/insights-audit-persona.yaml`: `name`, `description`, `context: fork`, `agent: persona-curator`, `changelog` (1.0.0, 2026-07-15). No scope field.
- `skills/meta/insights-pr-review.yaml`: `name`, `description`, `changelog` (1.0.0, 2026-11-20). No `agent`/`context`.
- `skills/src/insights-pr-review.md`: step 2 explicitly supports running from a repository other than AI Insights, locating `scripts/fetch-pr-review-comments.js` through the global `ai-insights` command. The skill is written for cross-repository use.
- `skills/README.md`: line "deploys to `~/.copilot/skills/` and `.claude/skills/`" is wrong (script uses `~/.claude/skills/`). Also mentions "(WP-002)/(WP-003)" plan leftovers. Metadata Fields table lists `name`, `description`, `context`, `agent`, `changelog`; `argument_hint` is used by the VS Code template but not documented.

### Established Patterns
- One YAML in `meta/` + one Markdown in `src/` per slug, stem shared — `skills/README.md`.
- Per-skill integrated `changelog` block scalar, version derived from the first entry — `skills/README.md`.

### Structural Observations
- `skills/README.md`: incorrect Claude publish path; undocumented `argument_hint`; stale WP references.
- `skills/src/insights-pr-review.md`: written for global (cross-repo) use. User decision 2026-11-23: it is `scope: global`; all other skills are `local`.

### User Decisions (2026-11-23)
- `insights-pr-review` → `scope: global` (written for use in other repositories). Every other skill → `scope: local`.
- Scope naming: the repository-bound scope is called `local` everywhere (YAML `scope: local | global`, default `local`, `publish-skills --scope local|global|all`, catalog code, tests, docs, changelog). `project` is not a valid value. "Project" stays only where it means the repository in prose or Claude Code's own "project skills" term. The plan folder name is unchanged.
- The two prompt-derived skills are named `insights-changelog` and `insights-changelog-archive` (slugs, file names, YAML `name`, slash commands).
- The checkbox prompt goes into `cli-menu` as `runCheckboxPrompt`; the selection is remembered per checkout in the gitignored `.cli-state.json`; the unreleased `cli-menu` v1.1.1 changelog entry is folded into v1.2.0.
- The `sync-personas` command keeps the `p` hotkey and becomes the combined publish action (personas + skills, part submenu, `--parts`); no separate `publish` command. Publishing skills by default is accepted. Without `--parts`: submenu in a TTY, all parts in a non-TTY; `--parts` restricts in either mode; default is all parts.
- Home skill directories on this machine (checked 2026-11-23): `~/.claude/skills/` holds `insights-audit-persona/` and `synced/`; `~/.copilot/skills/` holds `release-notes/`. No `insights-pr-review` copy exists in either, so its first global publish creates it.

### Constraints
- VS Code requires the skill `name` to equal the directory name (lowercase, digits, hyphens, max 64 chars); `description` max 1024 chars (VS Code docs, fetched 2026-11-23).

## Area: Skills build (`scripts/build-skills.js`)

### Verified References
- `scripts/build-skills.js` (L1–L106): loads `@mistralys/persona-builder` from `personas/node_modules/@mistralys/persona-builder/dist/index.cjs` via `createRequire`; registers `vscode-skill` (`contextFlags: { target_vscode_skill: true }`) and `claude-skill` (`contextFlags: { target_claude_skill: true }`) on a private `TargetRegistry`; frontmatter templates inline (`VSCODE_SKILL_FRONTMATTER` emits `name`, `description`, optional `argument-hint`; `CLAUDE_SKILL_FRONTMATTER` emits `name`, `description`, optional `context`, optional `agent`); writes `dist/vscode-skills/{slug}.md` and `dist/claude-skills/{slug}.md`; clears both dirs first unless `--check`/`--dry-run`; `--strict` forwarded.
- `node scripts/build-skills.js --check --strict` currently passes: "4 built, 0 written" (2 skills × 2 targets).

### Established Patterns
- Thin script + library modules in `scripts/lib/` (e.g. `scripts/lib/name-mapping.js`, `scripts/lib/ctx-generate.js`, `scripts/lib/yaml-utils.js`).
- `scripts/lib/yaml-utils.js` → `parseYamlScalars(text, fields)` extracts top-level scalars, handles quoted values with trailing comments.

### Structural Observations
- Templates are inline constants in the script; no validation of skill metadata beyond what the library does.
- Nothing checks that a skill's `agent` slug names a deployed persona (README documents the silent failure).

### Constraints
- `dist/vscode-skills/`, `dist/claude-skills/` are gitignored (`.gitignore`).

## Area: Persona builder library (`ai-persona-builder`)

### Verified References
- Installed version 3.0.1 (`personas/node_modules/@mistralys/persona-builder/package.json`, `ai-persona-builder/package.json`).
- `ai-persona-builder/src/validators/`: `filename-validator.ts`, `strict-validator.ts` (required markers only), `subagent-validator.ts`, `tool-parity-validator.ts`, `tool-requirements-validator.ts`. No unknown-key validator.
- `ai-persona-builder/src/builders/persona-builder.ts` (L845–L881): `strict` fails on warning-severity validation results; YAML keys are merged into the template context.
- Empirical test (scratch copy of `skills/` with `scope: project` and a bogus key added, built with `strict: true`): `success: true`, `strictFailures: []`, and `{{scope}}` resolved in a template. Unknown YAML keys are neither warned about nor rejected under `--strict`, and they are available to templates.

### Constraints
- No change to the builder repository is needed; the scope is handled entirely in this repository.

## Area: Skills publish

### Verified References
- `scripts/publish-skills.js` (L1–L122): reads `dist/vscode-skills/*.md`, `dist/claude-skills/*.md`; deploys each as `{targetDir}/{stem}/SKILL.md` to `getVSCodeSkillsDir()` / `getClaudeCodeSkillsDir()`; `rmSync` of the `{stem}` directory first; `--dry-run`; exit 1 when no built files. Top-level script, no exports.
- `scripts/publish-locations.js`: home-relative locations read from `shared/publish-locations.json` (`vscode_skills: [".copilot","skills"]`, `claude_skills: [".claude","skills"]`); `COPILOT_HOME` rebasing; exports `getVSCodeSkillsDir`, `getClaudeCodeSkillsDir`, etc. Header calls it the single source of truth for publish locations.
- `shared/publish-locations.json`: also read by `mcp-server/src/utils/publish-locations.ts` (per its `_comment`); home-relative only.
- `scripts/tests/publish-skills.test.js`: subprocess tests; plants `test-skill-publish-abc123.md` in both dist dirs and runs `--dry-run`; second suite empties dist and expects exit 1. Currently 6 passing.
- `scripts/tests/publish-locations.test.js`: COPILOT_HOME rebasing tests.

### Established Patterns
- Clearing only the stem directory of each built skill, preserving siblings — `scripts/publish-skills.js`.

### Structural Observations
- Publish is a monolithic top-level script: deployment planning, I/O and reporting are not separable, so tests can only drive it as a subprocess against real home directories.
- Target directories are hardcoded to the two global helpers; there is no notion of scope.

### Constraints
- Built `.md` files carry no scope; publish must learn it from metadata.

## Area: CLI (`scripts/cli.js`)

### Verified References
- `cmdBuildSkills(args)` (L469) runs `build-skills.js` with all args.
- `cmdPublishSkills(args)` (L474–L480) runs `build-skills.js` with all args, then `publish-skills.js` with only `--dry-run` forwarded.
- `cmdBuildMaintain(args)` (L503–L514): mcp sync-version, `syncRootVersion()`, `syncOrchestratorVersion()`, `build-personas.js --suite all`, `check-known-roles.js`, `cmdCtxGenerate(args)`. No skills step.
- Menu entries `build-skills` (L972) and `publish-skills` (L980, description "Build & deploy skills to VS Code and Claude Code"), category `Skills`.

### Structural Observations
- `cmdPublishSkills` cannot forward any publish flag other than `--dry-run`.
- Build & Maintain does not regenerate skills, so tracked skill output would not be refreshed by the default-branch build-first rule.

## Area: Persona sync (`scripts/sync-personas.js`)

### Verified References
- `syncSkills(dryRun)` (L432–L491): copies top-level `*.md` files from `<repo>/.claude/skills/` to `~/.claude/skills/` ("making them available in any project"). Called for `--target claude-code|all` (L582). Help text (L534) documents it.
- `.claude/skills/` has never existed in git history; `syncSkills` is effectively dead code today, and its flat `*.md` layout does not match the `{slug}/SKILL.md` layout.

### Structural Observations
- Once `.claude/skills/` holds local-scope skills, `syncSkills` is a latent path to push local skills into the global home, directly contradicting local scope.

## Area: Hand-maintained skill and prompts

### Verified References
- `.github/skills/release-check/SKILL.md` (tracked, hand-written, 2026-07-03): frontmatter `name`, `description` (single-quoted). Content stale: hardcoded test counts ("58 test files and 1743 tests", "777 at last count"); tagging section uses `git tag v<version>`, while tags are unscoped (`git tag` → `2.14.1`, `2.14.0`, …) and `.github/workflows/release-personas.yml` triggers on tags `'[0-9]*'` (a `v` tag would not trigger the release). It does not run the workspace-root `npm test`, and has no WIP-marker check (Changelog Rule 9). No `{{` sequences (safe for the template engine).
- `.github/skills/insights-audit-persona/SKILL.md` (tracked): identical to the VS Code build output of `insights-audit-persona` — a committed copy of generated output.
- `.github/prompts/changelog.prompt.md`, `.github/prompts/changelog-archive.prompt.md` (tracked): frontmatter `agent: Changelog Curator v1.5.0` (stale; the persona is 1.7.2, VS Code agent name "Changelog Curator"). `changelog.prompt.md` instructs consolidating interim version headings, which predates and conflicts with Changelog Rule 9 (single `**WIP; UNRELEASED**` entry, finalized by the Curator's Rewrite mode). No `{{` sequences.
- `personas/name-mapping.json`: `standalone-changelog-curator` → `claude_code.agent_name: "changelog-curator"`, `vscode.agent_name: "Changelog Curator"`; `standalone-persona-curator` → `claude_code.agent_name: "persona-curator"`.
- `personas/standalone/src/content/changelog-curator.md`: no reference to the prompt files.

### Consumers of the prompts / release-check
- `docs/references/development.md` L94, L96 — links both prompts.
- `docs/agents/project-manifest/constraints.md` L118 (Archive Locations → "run the archive prompt") and the "Prompt Template" subsection (points to a copy-paste template in `development.md` that does not exist).
- `docs/presentation/slides/working-with-models/persona-vs-skill.html` L46 — mentions "the release-check skill … lives with the project" (still true).
- `scripts/publish-skills.js` header and `docs/agents/project-manifest/root-tooling.md` L25 cite `release-check` as an example hand-written sibling.
- `docs/references/persona-quickstart-ide.md` L52 — generic end-user advice about `.github/prompts/`; does not reference these files.

## Area: Local publish targets

### Verified References
- `git ls-files .github .claude`: `.github/skills/insights-audit-persona/SKILL.md`, `.github/skills/release-check/SKILL.md`, both prompts tracked; nothing under `.claude/` tracked.
- `.gitignore`: ignores `.claude/agent-memory/` only; `.github/skills/` and `.claude/skills/` are not ignored.
- VS Code (docs fetched 2026-11-23): project skills in `.github/skills/` (Copilot) and `.claude/skills/` (Claude harness); personal `~/.copilot/skills/`, `~/.claude/skills/`; the deprecated Local harness also reads `.claude/skills/` and `~/.claude/skills/`; same-name skills in two locations both appear. Frontmatter: `name`, `description`, `argument-hint`, `user-invocable`, `disable-model-invocation`, `context: fork` (experimental). No `agent` field.

### Constraints
- `docs/agents/project-manifest/generated-artefacts.md`: tracked generated files need a row (Generated by, Derived from, safe/unsafe-to-discard verdicts); feature-branch drift is not committed unless the branch changed the source; default-branch commits start with Build & Maintain.
- AGENTS.md: never edit generated output; change the source and regenerate.

## Area: CI (`.github/workflows/ci.yml`)

### Verified References
- Jobs: MCP Server Tests, Orchestrator Tests, Ruff Linting, Manifest Validation, Persona Build Check (L107–L126: `cd personas && npm ci`, `node scripts/build-personas.js`, `--check`). No skills step; the workspace-root Vitest suite is not run in CI. `paths-ignore` excludes `docs/**`.

## Area: Documentation and manifests

### Verified References
- `README.md` L25–L37 (Skills section; L34 publish destination comment).
- `docs/references/menu-guide.md` L53–L54, L101–L104.
- `docs/agents/project-manifest/root-tooling.md` L12 (sync-personas), L20 (publish-locations), L24–L25 (build/publish skills).
- `docs/agents/project-manifest/generated-artefacts.md` L50 (Ignored row for dist skills), L82 (hand-maintained `skills/{meta,src}/`), L103 (sync-personas row mentions `.claude/skills/`), "Commands That Touch More Than They Generate" `build-maintain` row.
- `docs/agents/project-manifest/live-workspace.md` L26 (sync-personas "and skills in `~/.claude/skills/`").
- `docs/agents/project-manifest/development-commands.md` L28–L35 (root commands), L106–L121 (Verification by Change Type; no skills row).
- `docs/agents/project-manifest/cross-system-dependencies.md`: Dependency Table has no skill rows; Validation Scripts table L42+.
- Personas manifest: `personas/README.md` L83; `personas/docs/agents/project-manifest/README.md` L72; `tech-stack.md` L42, L61; `api-surface.md` L347 (claims skills are "not built by the persona-builder" — wrong), L600, L620 (`syncSkills`); `data-flows.md` L206 region; `constraints-build-system.md` L149 item 13.
- `scripts/tests/README.md` — general test conventions, no per-file list.
- Root `changelog.md`: topmost `## v2.15.0 - Outcome Summaries and Safer Chains`, not WIP-marked; last tag `2.14.1`; root `package.json` version `2.15.0`.

### Constraints
- Changelog Rule 9 (hub `constraints.md` → Changelog Convention) decides which entry receives new bullets.
- AGENTS.md Root-Level table: root script change → `root-tooling.md`, root `README.md`, `development-commands.md`; generated-file change → `generated-artefacts.md`; sync point → `cross-system-dependencies.md`; verification check → `development-commands.md` → Verification by Change Type.

## Area: CLI menu "p" publish action (added requirement)

### Verified References
- `scripts/cli.js` L951–L958: the `p` hotkey is the command `sync-personas` (label "Sync personas", category `Personas`, description "Deploy to VS Code & Claude Code", `run: cmdSyncPersonas`). `cmdSyncPersonas(args)` (L355–L358) runs `scripts/sync-personas.js` with all args. Today this action publishes personas and, through the dead `syncSkills()`, would sync `.claude/skills/`; it never runs `build-skills.js` / `publish-skills.js`.
- `scripts/cli.js` L972–L986: `build-skills` and `publish-skills` are keyless (`key: null`) commands in category `Skills`.
- `scripts/cli.js` L18–L30: imports `createMenu, C, log, IS_WIN, NPM, sh, runScript, runLongScript, checkNodeVersion, PreflightError, waitForKey` from `@mistralys/cli-menu`. `cli.js` calls `createMenu(...).run(...)` at module top level, so its `cmd*` functions are not importable; `scripts/tests/cli-cmd-agent.test.js` therefore uses static source-text assertions.
- `scripts/cli.js` L368–L456 `cmdCleanAgents`: the only multi-choice prompt in `cli.js` — a numbered list read through `readline` ("Enter numbers separated by commas, or a for all"), not a checkbox UI.
- `scripts/cli.js` L206–L225: the `personas` setup component calls `sync-personas.js` directly via `spawnSync`, not through the `sync-personas` command.
- `scripts/lib/health-checks.js` L268–L284: the `personas-fresh` slow check (detect: `build-personas.js --check`) has fix hint `node scripts/cli.js sync-personas`. `HEALTH_CHECKS` is exported (L104); fix hints are display-only (`scripts/cli.js` L1234, `scripts/preflight-orchestrator.js` L342), never executed. `scripts/tests/health-checks.test.js` does not assert this hint today.
- `scripts/launch-agent.js` L67–L69: empty-agents message `Run "ai-insights sync-personas" (or "./menu.sh sync-personas") to deploy them first.` No test asserts it.
- Other callers of the `sync-personas` *command* (verified by search 2026-11-23, excluding history, plans and `.context/`): `docs/references/menu-guide.md` L44 (row) and L97 (example); `docs/references/development.md` L36 (`ai-insights sync-personas` example) and L73 (menu equivalent of `node scripts/sync-personas.js`); `docs/references/persona-quickstart-ide.md` L109, L120 (`./menu.sh sync-personas` to deploy a new persona); `skills/README.md` L100 (`node scripts/cli.js sync-personas` to deploy personas for agent-delegating skills). No caller in `.github/` (CI), root `package.json` scripts, `menu.sh`, `mcp-server/src`, the GUI or `orchestrator/src`. Persona sources do not reference the command.
- Many documents cite the `scripts/sync-personas.js` *script* (personas manifest, `root-tooling.md`, `live-workspace.md`, `development-commands.md` L86, `generated-artefacts.md`, `ide-runtime-settings.md`, `workflow-and-ledger.md`); the script stays personas-only, so these remain correct apart from the `syncSkills` removal.
- `cli-menu/src/parser.ts`: the first non-flag argument is the command and every remaining argument is passed to it, so `node scripts/cli.js sync-personas --parts personas` reaches the command without `--`.
- `scripts/cli.js` L869–L900 `cmdOrchestratorTests`: an async command that calls `waitForKey()` itself, because the interactive menu does not pause after a command that returns a Promise.
- `scripts/sync-personas.js` L500–L590: flags `--dry-run`, `--target vscode|claude-code|all`, `--custom-path <path>`; always builds every suite first.
- `scripts/lib/launch-agent-core.js`: an in-repo raw-mode picker (pure reducer `reducePickerInput`, `renderPickerLines`, I/O shell `runInteractivePicker`) built on the exported cli-menu primitives `enterRawMode`, `restoreTerminal`, `clearScreen`, `C`.
- `scripts/lib/launch-toggles.js`: `LAUNCH_TOGGLES` frozen registry + `LaunchToggles` state class; header states toggle state is never persisted.
- Persisted state precedents: `~/.ai-insights/stores.json` and `~/.ai-insights/config.json` (user-level, `scripts/lib/store-commands.js`, `scripts/lib/health-checks.js` L174); `.orchestrator-run.json` (per-checkout, repo root, gitignored in `.gitignore`); `personas/model-registry/local.json` (per-checkout, gitignored).
- Persona counts (2026-11-23): `personas/{ledger,standalone,ledger-support}/src/meta/*.yaml` without `_`-prefixed files → 9 + 24 + 11 = 44, equal to the 44 entries of `personas/name-mapping.json`. Built output: 44 Claude Code files, 43 VS Code files (`ledger-claude-coordinator` has no VS Code target). `scripts/lib/name-mapping.js` `generateNameMapping()` discovers the files inline: ledger `/^\d+-.*\.yaml$/` (L150–L151), other suites `.yaml` and not `_`-prefixed (L244–L245).
- Skill counts after this plan: catalog scopes `global` = 1 (`insights-pr-review`), `local` = 4.

### Established Patterns
- Registry of frozen definition objects driving rendering and argv emission — `scripts/lib/launch-toggles.js`.
- Thin CLI command in `cli.js`, testable logic in `scripts/lib/*.js` with injectable paths — `scripts/lib/store-commands.js`, `scripts/lib/launch-agent-core.js`.
- Per-checkout local state in a gitignored repo-root file — `.orchestrator-run.json`.

### Structural Observations
- `cli.js` `cmdPublishSkills` inlines the build-then-publish sequence; a second caller (the new publish action) would duplicate it.
- `scripts/lib/name-mapping.js`: persona metadata discovery is inline in `generateNameMapping()`, so another consumer counting personas would have to copy the two filter rules.
- `cmdCleanAgents`' numbered prompt is a candidate consumer of a checkbox prompt.
- Changing the `sync-personas` command's default from "personas" to "all parts" changes the meaning of every existing personas-only caller listed above; each needs `--parts personas` to keep its meaning. The `personas` setup component calls the script directly and is unaffected.

### Constraints
- In the interactive menu, a hotkey runs `cmd.run([])`: CLI flags are never forwarded, and the command cannot tell a hotkey run from a direct `node scripts/cli.js <id>` run except through `process.stdin.isTTY`.
- Direct commands in a non-TTY (agents, CI) must not block on a prompt.

## Area: CLI menu library (`cli-menu`, sibling repository)

### Verified References
- `ai-insights/package.json`: dependency `"@mistralys/cli-menu": "^1.1.0"`; installed `node_modules/@mistralys/cli-menu` is a real directory (v1.1.0 from npm), not a symlink.
- `cli-menu/package.json`: version 1.1.0; scripts `build` (tsup, `prebuild` clears `dist/`), `test` (vitest), `typecheck`. Tags `v1.0.0`, `v1.1.0`. `cli-menu/CHANGELOG.md` top entry `v1.1.1 - Bundle Documentation` is unreleased (no tag, package.json still 1.1.0).
- `cli-menu/src/setup/checkbox-menu.ts`: `runCheckboxMenu(components: SetupComponent[]): Promise<string[] | null>` — raw-mode checkbox TUI (↑/↓ j/k, Space, `a` toggle all, Enter, `q` cancel; returns `null` in non-TTY). Hardcoded title "Select components to set up:", initial checks from `detect()`, `(done)` tag. Registers/unregisters a SIGINT handler.
- `cli-menu/src/index.ts`: barrel re-exporting `types, colors, help, parser, preflight, runners, screen, raw-mode, version, create-menu`. `src/setup/` is not exported; `cli-menu/docs/agents/project-manifest/api-surface.md` L300–L311 lists `runCheckboxMenu` as internal-only.
- `cli-menu/src/raw-mode.ts`: exported `isRawModeSupported`, `enterRawMode`, `exitRawMode`, `restoreTerminal`.
- `cli-menu/src/menu/interactive.ts` L98, L184: hotkey commands run as `cmd.run([])`; a Promise result is awaited with no `waitForKey()`.
- `cli-menu/tests/setup/checkbox-menu.test.ts`: tests drive `runCheckboxMenu` through a spied `process.stdin.on('keypress')`.
- No generic persisted-state facility in the library.

### Constraints
- `cli-menu/docs/agents/project-manifest/constraints.md`: zero production dependencies; no `process.exit()` in library code; layer direction `factory → engine → service → primitive` (engine = `src/menu/`, `src/setup/`); `src/index.ts` is a pure barrel; interactive raw-mode modules must register and unregister a SIGINT handler (Invariant 6).
- `cli-menu/AGENTS.md` maintenance rules: exported function/type → `api-surface.md`; new source file → `file-tree.md`; checkbox TUI flow → `data-flows.md` §6 + `api-surface.md`; layered architecture change → `tech-stack.md`, `data-flows.md`, `constraints.md`; CLI-facing behaviour → `README.md`.
- No documented local dependency switch exists in either repository's `AGENTS.md`; the switch is made by hand.
- Workspace rule: no relative imports across repository boundaries; `ai-insights` imports the library by package name only.

## Strategic Context

- Short-term vision: minimal setup friction for developers. Tracking local skills means a fresh clone has them without running a publish.
- Insight `41989677-e20b-43fb-a4fb-724dd2547f65` (hand-rolled YAML scalar extraction pitfalls): reuse `parseYamlScalars`, which already handles quoted values with trailing comments.
- Insight `39ca30b5-fbb7-46a4-8147-d9475ca70ab4` (a check mode should reuse the real generation path): the publish `--check` mode compares planned deployments produced by the same planning code against disk.
- No stored insight is overtaken by this work.
