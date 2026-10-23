# Plan

> **RETROACTIVE PLAN — ALL STEPS ALREADY IMPLEMENTED.**
> This plan was written on 2026-10-23, after the fact. It describes the plan that would have produced
> the change already present in the working tree, so that the change has a plan of record. Every
> step under Detailed Steps is already implemented. No step is open, and no code was changed while
> writing this plan. The verified facts behind it are in `research-brief.md` in this folder.

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.12.0
- Architectural Reviews: none — Plan Architect Reviewer v2.3.4

## Prior Project Context

The repository's short-term vision is setup and daily use with as little friction as possible. The
secondary long-term goal is reliability on Windows, macOS and Linux. Both favour a single global
Copilot home (`~/.copilot`): one registration and one skills folder serve Copilot CLI and VS Code
alike, and the relative path is the same on every OS. That replaces both the per-OS
`Code/User/mcp.json` switch and the per-workspace `.github/skills/` copy.

This plan builds on a predecessor change in the same v2.15.0 cycle. That change introduced
`shared/publish-locations.json` and `mcp-server/src/utils/publish-locations.ts`, and moved the VS
Code persona target from `Code/User/prompts` to `~/.copilot/agents/` (see the brief's *Baseline*
section). The knowledge base search found no insight about these deploy targets.

## Summary

Move every remaining GitHub Copilot deploy target into the global Copilot home.

- VS Code skills deploy to `~/.copilot/skills/` instead of the workspace-relative `.github/skills/`.
- The global `central_pm` MCP registration moves from the VS Code user `mcp.json` (under
  `Code/User`) to `~/.copilot/mcp-config.json`, written in the Copilot CLI schema: top-level
  `mcpServers`, entry `{ type: 'local', command: 'node', args: [shim], tools: ['*'] }`. VS Code
  picks the file up through its Copilot CLI MCP discovery, which is on by default.
- Every Copilot location (agents, skills, MCP config) honours `COPILOT_HOME`, the variable Copilot
  CLI uses in place of `~/.copilot`. This covers both the root scripts and the MCP server's agent
  registry default.
- `installVSCode()` is renamed to `installCopilot()`, with no alias.
- `uninstall()` clears `central_pm` from both the new config and the legacy VS Code `mcp.json`.

## Architectural Context

- **Shared location config.** `shared/publish-locations.json` holds home-relative path segments per
  location. Two readers consume it:
  - `scripts/publish-locations.js`, for the root scripts;
  - `mcp-server/src/utils/publish-locations.ts`, for the MCP server's agent registry default, used
    by `mcp-server/src/index.ts` `resolveAgentsDir()`.

  This follows the shared-JSON pattern already set by `shared/workflow-manifest.json`.
- **Root resolver.** `scripts/publish-locations.js` joins segments through one helper,
  `homeLocation(key)`, and validates keys with `segmentsFor(key)`. It exposes named getters.
  `getPublishLocations()` lists the persona agents targets for `sync-personas.js` and the
  `cli.js` clean-agents command.
- **Skill publishing.** `scripts/publish-skills.js` deploys `dist/vscode-skills/*.md` and
  `dist/claude-skills/*.md` as `{stem}/SKILL.md`, clearing only stems that match the build output.
  The Claude target already came from `getClaudeCodeSkillsDir()`, but the VS Code target was a
  hard-coded `path.join(ROOT, '.github', 'skills')`.
- **Global MCP registration.** `scripts/install-mcp-global.js` writes a stable shim
  (`~/.ai-insights/bin/launch-server.js`) and its `config.json`, merges a `central_pm` entry into a
  user-level MCP config, and optionally registers with Claude Code through the `claude` CLI.
  `_resolvePaths(overrides)` centralises the paths and accepts test overrides. Its callers are
  `scripts/cli.js` (`install-mcp`) and the `global-mcp` setup component.
- **Tests.** Root script tests run with `vitest run scripts/tests/`. MCP server tests live under
  `mcp-server/tests/`.

## Approach / Architecture

1. **Extend the shared config.**
   - Add `copilot_home: [".copilot"]` as the declared base of every Copilot location.
   - Add `vscode_skills: [".copilot", "skills"]` and
     `copilot_mcp_config: [".copilot", "mcp-config.json"]`.
   - Document the rebase rule in `_comment`, so any reader of the file learns it.
2. **Put the rebase rule in one helper per reader.** `homeLocation(key)` in the JS resolver rebases
   a location onto `path.resolve($COPILOT_HOME)` when two conditions hold: `COPILOT_HOME` is set
   and non-blank after `trim()`, and the location's segments start with the `copilot_home`
   segments. It keeps the remaining segments. Every other location, including all Claude ones,
   stays under `os.homedir()`. The TS reader applies the same rule to `vscode_agents`.
3. **Add two getters.** `getVSCodeSkillsDir()` and `getCopilotMcpConfigPath()` sit beside the
   existing getters, so consumers never assemble Copilot paths themselves.
4. **Point the consumers at the getters.**
   - `publish-skills.js` uses `getVSCodeSkillsDir()`.
   - `install-mcp-global.js` uses `getCopilotMcpConfigPath()` as the default `mcpPath`.
5. **Switch the registration schema and name.**
   - `installCopilot()` merges into `mcpServers` with the Copilot CLI local-server entry, keeping
     every other key and server in place.
   - Backups of the config are made owner-only (`0o600`), because the file may hold other servers'
     credentials.
   - The legacy platform path helper survives as `_getLegacyVSCodeMcpPath()`, used only by
     uninstall.
6. **Make uninstall cover both files.** A new `_removeServerEntry(file, key)` helper removes
   `central_pm` under a given top-level key. It is best-effort and writes a 0600 backup first.
   `uninstall()` calls it for the new config (`mcpServers`) and the legacy one (`servers`).
   `install()` leaves the legacy file untouched.

## Rationale

- **One home for all Copilot artefacts.** Copilot CLI reads `~/.copilot/{agents,skills,mcp-config.json}`,
  and VS Code reads the same agents and skills folders and discovers the CLI MCP config. A single
  registration therefore reaches both clients. Global skills also work in every workspace, while
  `.github/skills/` only worked inside this repository.
- **Honouring `COPILOT_HOME` everywhere.** A user who has moved their Copilot home would otherwise
  get personas, skills or the MCP entry in a folder their tools never read. A partial
  implementation, such as agents only, would split their installation across two homes. Putting
  the rule in the single path helper of each reader makes it impossible to forget for a future
  Copilot location.
- **A declared base key instead of a hard-coded `.copilot`.** The rebase prefix is data in the
  shared file, so both readers compare against the same source. A future key under `.copilot` is
  rebased with no code change.
- **Blank values ignored.** An exported-but-empty `COPILOT_HOME` must not resolve to the current
  working directory through `path.resolve('')`.
- **Rename without an alias.** `installVSCode()` is an internal module export. Its only callers are
  `install()`, `dryRun()` and the tests in this repository. The old name would now describe the
  wrong target, and an alias would keep that misleading name alive with no external consumer.
- **Legacy entry kept on install, removed on uninstall.** Install writes only to the file it owns.
  Removing an entry from a file it no longer targets is a destructive edit the user did not ask
  for. Uninstall is an explicit request to remove `central_pm` everywhere, so it clears both.
- **Owner-only backups.** The Copilot config is shared with other servers, whose entries can carry
  tokens. A world-readable timestamped copy would leak them.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Global MCP registration target | `~/.copilot/mcp-config.json` (`mcpServers` schema), discovered by VS Code | Keep VS Code user `mcp.json`; write both files | One file serves Copilot CLI and VS Code and needs no per-OS path. Writing both would register the server twice in VS Code. |
| VS Code skills target | `~/.copilot/skills/` (user-global) | Keep workspace `.github/skills/`; deploy to both | Global skills reach every workspace and match the global agents folder. Deploying to both would make VS Code list duplicate skills. |
| `COPILOT_HOME` handling | Prefix rebase in `homeLocation()` driven by a `copilot_home` base key | Per-getter `if (COPILOT_HOME)` checks; separate env-aware keys in JSON | One rule in one place per reader covers present and future Copilot keys. Per-getter checks repeat the logic and are easy to miss. |
| Scope of the rebase | Copilot locations only | Rebase Claude locations too | Claude Code does not read `COPILOT_HOME`, so rebasing its folders would deploy where Claude never looks. |
| Function naming | Rename to `installCopilot()`, no alias | Keep `installVSCode()`; rename and keep a deprecated alias | The target is now Copilot-wide. Every caller is in-repo, so an alias only preserves a misleading name. |
| Legacy `Code/User/mcp.json` entry | Untouched on install, removed on uninstall | Migrate (remove) on install; leave it forever | Install stays non-destructive toward files it no longer owns, and uninstall still cleans fully. Re-running `uninstall` then `install` gives users an explicit migration path. |
| Uninstall structure | `_removeServerEntry(file, key)` helper called per file | Duplicate the inline removal block for the second file | One helper owns the backup, permissions and removal. A third config would be one more call. |
| TS reader sharing | Reimplement the rebase rule in `publish-locations.ts` | Import the JS resolver from `mcp-server` | Root `AGENTS.md` forbids relative imports across folder boundaries. The rule is four lines, and both readers are pinned by tests. |

## Pattern Alignment

- **Follows:** the shared JSON consumed by both the JS scripts and the TS server, as with
  `shared/workflow-manifest.json` (read by `scripts/sync-personas.js` and
  `mcp-server/src/utils/constants.ts`).
- **Follows:** one named getter per location in `scripts/publish-locations.js`, which consumers
  import instead of building paths.
- **Follows:** path overrides through `opts` for test isolation in `scripts/install-mcp-global.js`
  (`shimBaseDir`, `mcpPath`), extended with `legacyMcpPath`.
- **Follows:** a timestamped backup before mutating a user config, already in `installVSCode()`.
  This plan tightens it to owner-only permissions.
- **Follows:** the Cross-Platform Policy (root `AGENTS.md`): only `path.join`/`path.resolve`, and
  `chmodSync` wrapped in try/catch because Windows ignores POSIX modes.
- **Follows:** loading JSON in ESM through `createRequire(import.meta.url)`, as
  `mcp-server/src/utils/constants.ts` does.
- **Departs:** the MCP server keeps its own copy of the rebase rule instead of sharing code with
  `scripts/`. This is justified by the no-cross-boundary-imports directive, and the shared JSON
  `_comment` documents the rule for both readers.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `scripts/publish-locations.js` `homeLocation()` | Already the only segment-to-home join; the natural single owner of `COPILOT_HOME` | Promoted to step 2 | Covers every current and future Copilot getter with no per-getter logic. |
| `shared/publish-locations.json` | Rebase prefix would otherwise be hard-coded `.copilot` in two readers | Promoted to step 1 (`copilot_home` key) | Keeps the prefix in the shared data both readers already load. |
| `scripts/publish-skills.js` `GH_SKILLS` | Only skill target not resolved through `publish-locations.js` | Promoted to step 4 | Gives both skill targets one owner and makes the target rebase-aware. |
| `scripts/install-mcp-global.js` `uninstall()` | Inline removal block bound to one file and one schema key | Promoted to step 6 (`_removeServerEntry`) | A second config with a different key would otherwise duplicate the block. |
| `scripts/install-mcp-global.js` backups | Timestamped backups inherited the default umask | Promoted to steps 5 and 6 (`0o600`) | The shared Copilot config may hold credentials for other servers. |
| `scripts/install-mcp-global.js` idempotency check | Compares only `command` and `args`, not `type`/`tools` | Rejected | The shim path is the only value that varies between installs. Leaving a hand-tuned `tools` list alone respects user edits to a shared file. |
| `docs/agents/project-manifest/cross-system-dependencies.md` | No row for `shared/publish-locations.json`, although JS and TS readers must agree on its keys and rebase rule | Rejected (not done in this change) | The implementation did not add the row. It is recorded under Deferred Items so it is not lost. |
| `mcp-server/docs/agents/project-manifest/` file tree / API surface | `src/utils/publish-locations.ts` not listed | Rejected (not done in this change) | The file came from the predecessor change. Recorded under Deferred Items. |

## Detailed Steps

All steps are **already implemented** (retroactive record).

1. **[Implemented] Extend `shared/publish-locations.json`.**
   - Add `copilot_home: [".copilot"]`, `copilot_mcp_config: [".copilot", "mcp-config.json"]` and
     `vscode_skills: [".copilot", "skills"]`, keeping `vscode_agents`, `claude_agents` and
     `claude_skills`.
   - Extend `_comment`: locations that start with the `copilot_home` segments are rebased onto
     `COPILOT_HOME` when it is set, and both readers are named.
2. **[Implemented] Rebase Copilot locations in `scripts/publish-locations.js`.**
   - `homeLocation(key)` reads `process.env.COPILOT_HOME?.trim()`. When the value is non-blank and
     `segmentsFor(key)` starts with `segmentsFor('copilot_home')`, it returns
     `path.join(path.resolve(override), ...rest)`. Otherwise it joins onto `os.homedir()`.
   - Update the JSDoc key union to include `copilot_mcp_config` and `vscode_skills`.
3. **[Implemented] Add getters in `scripts/publish-locations.js`.**
   - `getVSCodeSkillsDir()` resolves `vscode_skills`, and `getCopilotMcpConfigPath()` resolves
     `copilot_mcp_config`. Export both.
   - Update the header comment, which names `getVSCodeSkillsDir` among the helpers that
     `publish-skills.js` imports.
4. **[Implemented] Retarget `scripts/publish-skills.js`.**
   - Import `getVSCodeSkillsDir`.
   - Replace `GH_SKILLS = path.join(ROOT, '.github', 'skills')` with
     `VS_SKILLS = getVSCodeSkillsDir()`, and deploy through it.
   - Log the absolute target path, and update the header and inline comments to
     `~/.copilot/skills/` (user-global).
5. **[Implemented] Switch the registration in `scripts/install-mcp-global.js`.**
   - Import `getCopilotMcpConfigPath`.
   - Rename `_getVSCodeMcpPath()` to `_getLegacyVSCodeMcpPath()`, documented as used only by
     uninstall.
   - In `_resolvePaths()`, default `mcpPath` to `getCopilotMcpConfigPath()` and add
     `legacyMcpPath` (overridable).
   - Rename `installVSCode()` to `installCopilot()` with no alias. It merges into `mcpServers` with
     `{ type: 'local', command: 'node', args: [shimPath], tools: ['*'] }`, and chmods the
     pre-write backup to `0o600` (try/catch).
   - Update `dryRun()`, `install()` and their log lines ("Copilot mcp-config.json …"), and the
     module header's API list.
6. **[Implemented] Clear both configs on uninstall in `scripts/install-mcp-global.js`.**
   - Add `_removeServerEntry(file, key)`. It is best-effort: it backs up at `0o600`, deletes
     `existing[key].central_pm`, rewrites the file and swallows errors.
   - `uninstall()` calls it for `(mcpPath, 'mcpServers')` and `(legacyMcpPath, 'servers')` before
     the Claude Code and shim cleanup.
   - `install()` does not touch the legacy file.
7. **[Implemented] Rebase the MCP server's agents default in
   `mcp-server/src/utils/publish-locations.ts`.**
   - Extend `PublishLocations` and `loadLocations()` to require and validate `copilot_home` next to
     `vscode_agents`.
   - Apply the same prefix rebase in `getVSCodeAgentsDir()`.
8. **[Implemented] Update the root script tests.**
   - `scripts/tests/install-mcp.test.js`: rename to `installCopilot` and assert `mcpServers`. Add
     the suite *installCopilot() entry shape and uninstall()*, covering `type`/`tools` and dual-file
     uninstall that preserves other servers.
   - `scripts/tests/publish-skills.test.js`: resolve the target through `getVSCodeSkillsDir()`.
   - New `scripts/tests/publish-locations.test.js`: unset, set, blank `COPILOT_HOME`, and Claude
     never rebased.
9. **[Implemented] Add the MCP server test.** New `mcp-server/tests/utils/publish-locations.test.ts`
   covers the default `~/.copilot/agents` and rebasing onto `COPILOT_HOME`, with the environment
   restored in `afterEach`.
10. **[Implemented] Update the documentation** (see Documentation Updates). This covers the
    changelog bullets in the top v2.15.0 entry, plus the README, reference docs, manifests and
    skills README.

## Dependencies

- Steps 2–3 depend on step 1, because the new keys must exist before `segmentsFor` can resolve them.
- Steps 4–6 depend on step 3, the getters.
- Step 7 depends on step 1 (`copilot_home`).
- Steps 8–9 depend on steps 2–7.
- Step 10 depends on steps 4–7, since the final paths and names it documents come from them.
- External: the predecessor change (shared JSON file, TS reader, agents target) was already in the
  working tree.

## Required Components

- `shared/publish-locations.json` (modified)
- `scripts/publish-locations.js` (modified)
- `scripts/publish-skills.js` (modified)
- `scripts/install-mcp-global.js` (modified)
- `mcp-server/src/utils/publish-locations.ts` (modified)
- `scripts/tests/install-mcp.test.js` (modified)
- `scripts/tests/publish-skills.test.js` (modified)
- `scripts/tests/publish-locations.test.js` (new)
- `mcp-server/tests/utils/publish-locations.test.ts` (new)
- Documentation files listed under Documentation Updates (modified)
- External consumers, which are not changed: GitHub Copilot CLI (reads `~/.copilot/mcp-config.json`
  and honours `COPILOT_HOME`) and VS Code (Copilot CLI MCP discovery, agents and skills folders)

## Assumptions

- VS Code's discovery of the Copilot CLI MCP config is enabled by default, so a registration in
  `~/.copilot/mcp-config.json` reaches VS Code without a `Code/User/mcp.json` entry. Source:
  code.visualstudio.com MCP configuration reference.
- The Copilot CLI local-server entry shape is `{ type: 'local', command, args, tools }` under
  top-level `mcpServers`, and `tools: ['*']` enables every tool. Source: docs.github.com Copilot CLI
  "Adding MCP servers".
- `COPILOT_HOME` replaces `~/.copilot` as a whole, so sub-paths keep their names beneath it.
- `installVSCode()` has no consumer outside this repository.

## Constraints

- The Cross-Platform Policy applies: no hard-coded separators, and POSIX permission calls are
  tolerated as no-ops on Windows.
- No relative imports across folder boundaries, so the MCP server cannot import
  `scripts/publish-locations.js`.
- Uninstall stays best-effort and never throws on an unreadable or malformed config.
- Install must stay idempotent: a second run with an unchanged shim path writes nothing.

## Out of Scope

- Removing previously published `.github/skills/` copies from the workspace. They stay in place
  (`insights-audit-persona/` and `release-check/` still exist).
- Removing the legacy `central_pm` entry from `Code/User/mcp.json` during install. Only uninstall
  clears it.
- `COPILOT_HOME` (or any equivalent environment override) for the Claude Code locations
  `~/.claude/agents` and `~/.claude/skills`.
- A compatibility alias for `installVSCode()`.
- Rewording historical documents that describe the old targets: research notes and
  implementation-history plans under `docs/agents/`.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Re-run `node scripts/cli.js install-mcp` and `node scripts/cli.js publish-skills` on each machine to move the registration and skills to the new locations. | After the run | It writes to each user's home directory on their own machines. |
| 2 | Optionally run `uninstall` and then `install-mcp`, or edit `Code/User/mcp.json` by hand, to drop the legacy `central_pm` entry if VS Code shows the server twice. | After the run | It is a decision about the user's own editor configuration. |
| 3 | Optionally delete stale workspace copies under `.github/skills/` that the publish step used to create. | After the run | Which copies are still wanted is the user's call; hand-written ones such as `release-check` must survive. |
| 4 | Commit the change and release v2.15.0. | After the run | Version control and releases are managed by the user. |

## Acceptance Criteria

- AC-01: `scripts/publish-skills.js` deploys VS Code skills to `getVSCodeSkillsDir()`
  (`~/.copilot/skills/{stem}/SKILL.md`), not to the workspace `.github/skills/`, and `--dry-run`
  writes nothing there.
- AC-02: `installCopilot()` writes `central_pm` to `getCopilotMcpConfigPath()`
  (`~/.copilot/mcp-config.json`) under top-level `mcpServers` as
  `{ type: 'local', command: 'node', args: [shimPath], tools: ['*'] }`. It preserves every other
  server and top-level key, and makes a timestamped owner-only backup before overwriting.
- AC-03: Running `installCopilot()` a second time with the same shim path reports
  `changed: false` and leaves the file byte-identical.
- AC-04: `uninstall()` removes `central_pm` from both the Copilot config (`mcpServers`) and the
  legacy VS Code `mcp.json` (`servers`), keeping every other server in both files. `install()`
  does not modify the legacy file.
- AC-05: When `COPILOT_HOME` is set, the VS Code agents directory (scripts and MCP server), the
  skills directory and the MCP config path all resolve beneath `path.resolve(COPILOT_HOME)`. A
  blank or whitespace-only value is ignored.
- AC-06: Claude Code locations (`~/.claude/agents`, `~/.claude/skills`) are unaffected by
  `COPILOT_HOME`.
- AC-07: `installVSCode` is no longer exported. `installCopilot` replaces it with no alias, and
  `install()`/`dryRun()` call the new name.
- AC-08: The root script test suite (`npm test` → `vitest run scripts/tests/`) and the
  `mcp-server` test suite pass.

## Testing Strategy

Unit tests with temp-dir isolation cover the registration logic, using the existing
`mcpPath`/`shimBaseDir` overrides plus the new `legacyMcpPath`. Environment-driven tests cover the
location resolver: they set and unset `COPILOT_HOME` and restore it in `afterEach`. A subprocess
dry-run test covers the skill publish target. Path assertions compare through `path.join` /
`path.resolve`, so they hold on every OS. Verified on 2026-10-23: the three affected script test
files pass (29/29), and the `mcp-server` `publish-locations` and `agent-registry` tests pass
(51/51).

## Test Plan

- `scripts/tests/publish-skills.test.js` — *does not write any file to ~/.copilot/skills/ for the
  test stem*: a dry-run leaves `getVSCodeSkillsDir()/<stem>/SKILL.md` absent — AC-01
- `scripts/tests/install-mcp.test.js` — *installCopilot() creates mcp.json with central_pm when it
  does not exist*: `mcpServers.central_pm.command === 'node'` — AC-02, AC-07
- `scripts/tests/install-mcp.test.js` — *installCopilot()* merge test: `mcpServers.other_server`
  and `someTopLevelKey` are preserved — AC-02
- `scripts/tests/install-mcp.test.js` — *installCopilot()* backup test: a timestamped `.bak` exists
  after a write over an existing file — AC-02
- `scripts/tests/install-mcp.test.js` — *writes the Copilot CLI schema: local type and all tools
  enabled*: `type === 'local'`, `tools` equals `['*']` — AC-02
- `scripts/tests/install-mcp.test.js` — *installCopilot()* idempotency test: the second call
  returns `changed: false` and the content is unchanged — AC-03
- `scripts/tests/install-mcp.test.js` — *installCopilot()* dry-run test: the diff holds
  `mcpServers.central_pm` and the file is not written — AC-02
- `scripts/tests/install-mcp.test.js` — *uninstall() removes central_pm from the new and the legacy
  config, keeping other servers* — AC-04
- `scripts/tests/publish-locations.test.js` (new) — *defaults to ~/.copilot when COPILOT_HOME is
  unset* and *rebases every Copilot location onto COPILOT_HOME when set* (agents, skills, MCP
  config) — AC-05
- `scripts/tests/publish-locations.test.js` (new) — *ignores a blank COPILOT_HOME* — AC-05
- `scripts/tests/publish-locations.test.js` (new) — *never rebases Claude Code locations* — AC-06
- `mcp-server/tests/utils/publish-locations.test.ts` (new) — *resolves to ~/.copilot/agents* and *is
  rebased onto COPILOT_HOME when set* — AC-05
- Full suites: `npm test` at the repository root and `npm test` in `mcp-server/` — AC-08

Gaps in test coverage, noted for the record: no test asserts the `0o600` mode of backups, and none
asserts that `install()` leaves a pre-existing legacy entry untouched (AC-04, second clause).

## Documentation Updates

- `changelog.md` — top v2.15.0 entry: bullets for skills moving to `~/.copilot/skills/`,
  `install-mcp` moving to `~/.copilot/mcp-config.json` (legacy entry kept on install, cleared on
  uninstall), and `COPILOT_HOME` honoured by every `~/.copilot` target and the agent registry.
- `README.md` — the `publish-skills` command comment names `~/.copilot/skills/`.
- `docs/references/menu-guide.md` — the *Publish skills* row target.
- `docs/references/development.md` — the `install-mcp` row target (`~/.copilot/mcp-config.json`,
  Copilot CLI + VS Code).
- `docs/agents/project-manifest/root-tooling.md` — the rows for `publish-locations.js`
  (`COPILOT_HOME` rebasing, `getCopilotMcpConfigPath()`, `getVSCodeSkillsDir()`),
  `publish-skills.js` (targets) and `install-mcp-global.js` (target file and `mcpServers` schema).
- `mcp-server/docs/agents/project-manifest/README.md` — the global registration sentence names
  `~/.copilot/mcp-config.json`.
- `skills/README.md` — the publish target and the command table name `~/.copilot/skills/`.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Add a `shared/publish-locations.json` row to `docs/agents/project-manifest/cross-system-dependencies.md`, naming both readers and the `copilot_home` rebase rule | Structural Improvements; root `AGENTS.md` sync-point rule | Not done by the implementation | Do it the next time either reader changes |
| 2 | List `mcp-server/src/utils/publish-locations.ts` in the MCP server manifest `file-tree.md` / `api-surface.md` | Structural Improvements | The file came from the predecessor change and is not yet documented | Belongs with the predecessor's documentation pass |
| 3 | Reword `personas/docs/agents/project-manifest/api-surface.md` L344, which describes the in-repo `.github/skills/` files as the VS Code skill copies | Research brief, Documentation area | The in-repo copies still exist, so the line is not yet false | Revisit if the `.github/skills/` copies are removed |
| 4 | Tests for owner-only backup mode and for `install()` leaving the legacy entry in place | Test Plan gaps | Not written by the implementation | The mode test must skip on Windows |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **VS Code lists `central_pm` twice** (the legacy `Code/User/mcp.json` entry plus the discovered Copilot config) | The changelog says install leaves the legacy entry in place. `uninstall` followed by `install` clears it (Human Action 2). |
| **Stale workspace `.github/skills/` copies shadow or duplicate the global skills in this repository** | They are documented as not removed (changelog, Out of Scope). The user decides about deletion (Human Action 3). |
| **`COPILOT_HOME` set in one shell but not another** splits deploys across two homes | This matches Copilot CLI's own behaviour, so tools and deploys agree whenever the environment is the same. |
| **The JS and TS readers diverge on the rebase rule** | Both have tests for the rebase. The rule is documented in the shared JSON `_comment`. Deferred Item 1 adds the sync point to the cross-system table. |
| **Backups of a credential-bearing config are readable by others** | `chmodSync(backup, 0o600)` on every backup, in both install and uninstall. |
| **An external script still calls `installVSCode()`** | Every caller is in-repo and was updated. The rename appears through the changed API list in the module header and `root-tooling.md`. |

## Recommended Workflow

- **Workflow:** standalone
- **Rationale:** This is a retroactive record of a change that is already implemented. The change
  is a single-concern move of root-script deploy targets within well-understood patterns, and its
  tests already pass, so no ledger pipeline needs to run.
