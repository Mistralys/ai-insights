# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.12.0
- Architectural Reviews: none — Plan Architect Reviewer v2.3.4

## Prior Project Context

This is the first rework of P04 (`docs/agents/plans/2026-10-15-p04-pipeline-stage-adjustment/`). P04 shipped `ledger_update_pipeline_stages` with 10/10 WPs complete and no rework cycles. Its synthesis lists four deferred items. P04's own plan also carried eight P03 follow-ups that it did not take up, and it rejected two structural improvements as outside its blast radius. The repository's long-term secondary goal is reliability on all three OSes and in the headless orchestrator workflow. Several of these items serve that goal directly: a `ctx-generate` that cannot delete tracked output, live tests that skip instead of failing, and a halted sweep without a redundant cancel.

Plan P05 (`docs/agents/plans/2026-10-06-p05-headless-pm-review-actions/`) is planned but not executed. It reshapes the same supervisor intercept this plan touches (step 11), keeps per-iteration handled-set semantics, and tells its implementer to locate code by function and read version numbers at execution time. This plan's supervisor change is compatible with P05 and narrower than it.

Insights that shaped the design:
- `d56f4e19-…`: derive validation from the same data the runtime uses. Applied to the registry-derived tests and to the manifest-derived `MAX_REWORK_COUNT`.
- `e832d2f4-…`: extract script logic into `scripts/lib/` for fixture testing.
- `b37db114-…`: a true dry-run replays the real code path.
- `48607cdb-…`: prove a guard with a synthetic failure fixture.
- `f389f9ce-…`: plain-function modules for stateless helpers.

## Knowledge Base Reconciliation

| Insight ID | Title | What the plan overtakes | Executed by |
|------------|-------|-------------------------|-------------|
| a7adbb64-4f57-42ac-9b27-25913bde3815 | scripts/cli.js ctx-generate: an unsupported flag like --check destructively wipes .context/ before erroring | Step 9 adds a real `--check` mode, validates arguments before any filesystem change, and only replaces `.context/` after a successful generation. The insight's claims that there is no check mode, that the clean runs before argument parsing, and its advice to "always invoke it with no flags" all stop holding. | Ledger Knowledge Curator v1.4.2 (Targeted Reconciliation) |

## Summary

This plan addresses the actionable items in `docs/agents/plans/2026-10-15-p04-pipeline-stage-adjustment/synthesis.md`. It also covers every deferred, out-of-scope and rejected item inherited from P04's plan that fits one plan. Each item was re-verified first; see the triage table in `research-brief.md`.

1. **MCP tool registry.** One registry replaces the hand-maintained tool lists in `index.ts` and in the tests. The startup log, the schema-integrity suite and a new help-coverage suite all derive from it. Three tools currently have no schema coverage, and that gap closes.
2. **Help entries.** `ledger_help` gains full entries for the three older PM-only tools and for `ledger_detect_project`, which also has no overview row today.
3. **Tests.** `requirePmRole()` gets its own unit test, and `beginWork` gets the missing READY-at-MAX case.
4. **Start-guard extraction.** The duplicated start-guard chain in `pipeline.ts` and `begin-work.ts` moves into one helper.
5. **Test tidy.** `rework-limit.test.ts` loses its loose casts and its duplicated setup.
6. **`ctx-generate`.** The command gains a non-destructive `--check` mode, rejects unknown flags before touching anything, and no longer deletes `.context/` when generation fails. `build-maintain` stops passing its own flags to `ctx`.
7. **Orchestrator:**
   - The halted sweep stops re-cancelling a WP that was already cancelled in the same iteration.
   - Live-LLM tests skip by default and on invalid credentials.
   - The integration test reads the rework limit from the manifest, which corrects a silent 3-vs-5 divergence.
   - Stale hardcoded test counts are removed from three documents.

Two inherited items were verified as already resolved: the old P04 plan folder deletion is an intentional rename, and the P04 Knowledge Archiver pass did run.

## Architectural Context

- **MCP server tool registration.** Each tool category is a module exporting `register(server: McpServer)` (`mcp-server/docs/agents/project-manifest/tech-stack.md` § 6). `mcp-server/src/index.ts` imports twelve modules (L9–L20) and calls each `register` (L82–L97). After connecting, it prints a hand-written `Registered tools:` literal of 33 names (L167–L172).
  - `mcp-server/tests/startup/tool-log-sync.test.ts` keeps that literal honest by regex-scanning `src/tools/*.ts`.
  - `mcp-server/tests/tools/schema-integrity.test.ts` keeps a separate list of 11 modules and 30 tool names. It has already drifted: `ping.ts` and `standalone-import.ts` are not registered there, so `ledger_ping`, `ledger_import_standalone` and `ledger_update_synthesis` have no schema coverage.
- **Help.** `mcp-server/src/tools/help-content.ts` exports `TOOL_HELP` (overview table + one Markdown body per tool), and `mcp-server/src/tools/help.ts` serves it. The `ledger_update_pipeline_stages` entry (L407–L473) sets the detail bar.
- **PM-only guard.** `mcp-server/src/utils/pm-role-guard.ts` `requirePmRole(toolName, agentRole)` returns `null` or the standard rejection result. It is used by the four tools in `mcp-server/src/tools/work-package-admin.ts`.
- **Start paths.** `startPipeline` (`mcp-server/src/tools/pipeline.ts` L140–L300) and the start phase of `beginWork` (`mcp-server/src/tools/begin-work.ts` L143–L238) each run the same guard chain inside `LedgerStore.updateWorkPackageWithSync`:
  - role / PM override
  - active-stage membership
  - duplicate IN_PROGRESS pipeline
  - prerequisite (ignoring `auto_cancelled`)
  - revalidation
  - rework increment
  - persist-on-trip circuit breaker
  - append + `assigned_to`

  `beginWork` runs a claim phase first. `mcp-server/tests/tools/start-path-parity.test.ts` pins that the two copies agree. Shared pure helpers already live in `mcp-server/src/utils/workflow-helpers.ts` (`MAX_REWORK_COUNT`, `hasDownstreamFail`, `checkRevalidationGuard`).
- **CTX generation.** `scripts/cli.js` `cmdCtxGenerate` (L556–L585):
  1. Deletes `.context/`.
  2. Spawns `ctx generate` with the forwarded args.
  3. Normalises paths with `scripts/normalize-ctx-paths.js`.
  4. Writes `generated-at.txt`.
  5. Regenerates `CLAUDE.md` from `AGENTS.md`.

  `cmdBuildMaintain` (L499–L511) ends with `cmdCtxGenerate(args)`. `cli.js` runs its menu at module top level, so its `cmd*` functions are covered by static source assertions (`scripts/tests/cli-cmd-agent.test.js`). Testable logic lives in `scripts/lib/` with injected dependencies (`scripts/lib/mcp-dist-freshness.js`, `scripts/lib/build-checks.js`).
- **Orchestrator supervisor.** `orchestrator/src/supervisor.py`:
  - It snapshots `wp_summaries` at the start of each iteration (L495–L499).
  - It polls roles, PM first. In the PM intercept, `REVIEW_REWORK_LIMIT` is handled by `_handle_rework_limit`, which tracks cancelled IDs in a set created inside the intercept block (L703–L723).
  - On the all-WAIT fall-through, the halted sweep (L828–L870) cancels every non-terminal WP in the snapshot with ≥ 3 consecutive failures.
- **Orchestrator config and tests.** `orchestrator/src/config.py` derives routing constants from `shared/workflow-manifest.json` but not `constants.max_rework_count`. `orchestrator/tests/test_integration.py` hardcodes `REWORK_LIMIT = 3` against a manifest value of 5. The `live` marker is registered in `orchestrator/pyproject.toml` and documented as "skipped by default", but nothing implements that default. `orchestrator/tests/conftest.py` has no collection hooks.

## Approach / Architecture

### 1. Tool registry (`mcp-server/src/tools/registry.ts`, new)

A plain-function module that owns the list of tool modules and the act of registering them:

- `ToolModule` (exported interface): `{ readonly id: string; readonly register: (server: McpServer) => void }`. `id` is the module's file stem (e.g. `'work-package-admin'`) and appears in diagnostics.
- `TOOL_MODULES: readonly ToolModule[]` (exported, frozen): the twelve modules in today's `index.ts` order. `workflow.ts` stays the single entry for `workflow-next-action.ts` + `workflow-handoff.ts`.
- `registerAllTools(server: McpServer, modules: readonly ToolModule[] = TOOL_MODULES): string[]` (exported): registers every module through a recording view of `server`. That view is an object whose `registerTool(name, …rest)` records `name` and forwards to the real `server.registerTool(name, …rest)`, returning its result. The function returns the names in registration order. It throws `Error('Duplicate tool registration: <name>')` if a name repeats. The SDK would also reject a duplicate, but this message names the tool before the SDK's own error. The `modules` parameter is used only by tests, which pass a reduced list to prove the completeness check fails. Production always uses the default.

`src/index.ts` replaces its twelve imports and calls with `const registeredTools = registerAllTools(server);`. It prints `` `[project-ledger-mcp] Registered tools: ${registeredTools.join(', ')}` `` at the same point and in the same format as today. Both NOTE comments about manual sync are removed.

### 2. Registry-derived tests

- `tool-log-sync.test.ts` changes purpose from "the literal matches the source" to "the registry matches the source". It does three things:
  - It calls `registerAllTools(mockServer)` and compares the returned set with the regex source scan of `src/tools/*.ts`, through a file-local `diffNameSets(registered, scanned)` returning `{ missing, extra }`. This catches a module that calls `server.registerTool` but is missing from `TOOL_MODULES`. A synthetic case calls `registerAllTools(mockServer, TOOL_MODULES.filter(m => m.id !== 'ping'))` and asserts that `missing` equals `['ledger_ping']`.
  - It asserts that `src/index.ts` calls `registerAllTools(`, builds the log line from the returned names (`Registered tools: ${` together with `.join(', ')`), and contains no `Registered tools: ledger_` literal.
  - It asserts that the returned list has no duplicates.
- `schema-integrity.test.ts` drops its eleven imports, its `beforeAll` call list and `EXPECTED_TOOL_NAMES`. It populates `capturedSchemas` with `registerAllTools(mockServer)` and iterates the returned names. The real invariant (an outer schema that is a `ZodObject`, not `ZodEffects`) is asserted directly for every tool via `schema instanceof ZodObject`, the passthrough-unwrapped form included. The "non-empty `properties`" assertion runs for every tool except a named `ZERO_PARAMETER_TOOLS = new Set(['ledger_ping'])`, whose schema is legitimately `z.object({})`. A synthetic fixture proves the `ZodEffects` detection still fails: a schema wrapped in `.refine()` is asserted to be rejected. The numeric-helper assertions (L136–L196) are unchanged.

### 3. Help coverage and entries

New suite `mcp-server/tests/tools/help-content-coverage.test.ts`. For every name returned by `registerAllTools(mockServer)` except `ledger_help` (the overview itself is its help), it asserts:
- `TOOL_HELP[name]` is a non-empty string.
- The entry contains the heading `# ${name}`.
- The overview table contains a row starting with `| ${name} |`.

It also asserts that every `TOOL_HELP` key other than `overview` is a registered tool, so a renamed tool cannot leave an orphan entry behind. The checks run through a file-local `findHelpGaps(names, help)` returning `{ missingEntry, missingHeading, missingRow, orphanKeys }`. A synthetic case feeds it a name absent from `TOOL_HELP` and an extra key, and asserts both are reported.

`help-content.ts` gains four entries, matching the `ledger_update_pipeline_stages` structure:
- Purpose line.
- `## Required Parameters` using `CWD_PATH_PARAM`/`PROJECT_PATH_PARAM`.
- `## Guards` in evaluation order, read from the implementation in `work-package-admin.ts` and from `api-surface.md` L321–L420.
- `## Response Shape`.
- `## Example`.

The four entries:
- `ledger_reset_rework_count`
- `ledger_reopen_cancelled_wp`
- `ledger_update_acceptance_criteria`: including the rule that zero criteria may not remain, and the exact-text matching caveat.
- `ledger_detect_project`: `cwd_path` only; NOT_FOUND / AMBIGUOUS outcomes; note that every other tool accepts `cwd_path` directly.

The overview table gains a `ledger_detect_project` row. The existing `knowledge-help.test.ts` keeps its content-specific assertions; its per-tool presence checks are now redundant but harmless and stay as they are.

### 4. `requirePmRole()` unit test

New `mcp-server/tests/utils/pm-role-guard.test.ts` pins the contract exactly as it is:
- `null` for `'Project Manager'`.
- The rejection object for any other value (`'Developer'`, `'Project Manager Agent'`, `'project manager'`, `''`).
- The exact text `Error: ${toolName} is a PM-only tool. You are: ${agentRole}`, with `toolName` inserted verbatim.
- `isError: true` and a single text content block.

It does not change behaviour.

### 5. Shared start-guard helper (`mcp-server/src/utils/pipeline-start.ts`, new)

A plain-function module exporting:

- `PipelineStartRequest` (interface): `{ workPackageId: string; type: PipelineType; agentRole: string }`.
- `PipelineStartOutcome` (type): `{ kind: 'started' } | { kind: 'tripped'; message: string }`.
- `applyPipelineStart(wp: WorkPackageDetail, root: RootIndex, request: PipelineStartRequest): PipelineStartOutcome`. It runs, in `startPipeline`'s current order:
  1. Role / PM override.
  2. `wp.status === 'IN_PROGRESS'`.
  3. Active-stage membership.
  4. Duplicate IN_PROGRESS.
  5. Prerequisite + revalidation.
  6. Rework increment.
  7. Circuit breaker.
  8. Append + `assigned_to` (detail and root summary) + `root.last_updated`.

  A rejection throws with today's exact message. A trip from below mutates the counter and `root.last_updated`, then returns `{ kind: 'tripped', message }`. A stored count already at MAX throws, so the updater aborts and nothing is written.

`startPipeline` and `beginWork` each call it inside their existing updater callback and keep their own `breakerMessage` capture-and-throw-after-lock. `beginWork` calls it after its claim phase, where status is always IN_PROGRESS, so the status guard is a no-op there.

The one ordering difference disappears: `beginWork` currently checks duplicates before active-stage membership. Both guards can only fire together when a running pipeline's type is not an active stage. `ledger_update_pipeline_stages` guard 5 prevents that state through tools, so the observable behaviour of every reachable state is unchanged. A parity scenario pins the unified order.

### 6. `ctx-generate` (`scripts/lib/ctx-generate.js`, new; `scripts/cli.js` modified)

A dependency-injected module that never prints or exits; the caller owns presentation and the exit code, as in `scripts/lib/mcp-dist-freshness.js`.

- `parseCtxArgs(args: string[]) → { ok: true, check: boolean, passthrough: string[] } | { ok: false, error: string }`. It allowlists `--check` (ours) plus the `ctx generate` options this workspace forwards: `-q`/`--quiet`, `-v`/`-vv`/`-vvv`/`--verbose`, `--no-ansi`/`--ansi`, `-n`/`--no-interaction`. Anything else, including `-w`/`--work-dir` (which the command owns), returns an error naming the flag and the supported set.
- `generateContext({ workspaceRoot, outDir, passthrough, spawn, normalize }) → { ok: true } | { ok: false, reason: 'ctx-missing' | 'ctx-failed', status }`. It runs `ctx generate -w <outDir> …passthrough` with `cwd: workspaceRoot` and `shell` on Windows, then normalises paths in `outDir`. `ctx-missing` covers a spawn `ENOENT`.
- `runCtxGenerate({ workspaceRoot, args, deps }) → { ok, mode: 'generate' | 'check', … }`:
  1. Parse args. On error, return before any filesystem access.
  2. Generate into a fresh staging directory from `fs.mkdtempSync(path.join(os.tmpdir(), 'ai-insights-ctx-'))`.
  3. In **generate** mode, on success: write `generated-at.txt` into staging, then swap it in.
     1. Copy staging to `<root>/.context.incoming` (`fs.cpSync`, recursive). A rename from the OS temp dir is not portable across devices.
     2. Rename `<root>/.context` → `<root>/.context.previous` when it exists.
     3. Rename `<root>/.context.incoming` → `<root>/.context`.
     4. Remove `.context.previous`.

     If any of sub-steps 1–3 fails, restore `.context.previous` to `.context` when it was moved, remove `.context.incoming`, and return `{ ok: false, reason: 'replace-failed', error }`. On success, regenerate `CLAUDE.md` from `AGENTS.md`. Both transient names are added to the root `.gitignore`, so an interrupted swap is never committed.
  4. In **check** mode: compare the staging tree with `<root>/.context`, excluding `generated-at.txt`, and compare the expected `CLAUDE.md` content with the file on disk. Return `{ fresh: boolean, added: string[], removed: string[], changed: string[], claudeMdStale: boolean }`. Nothing under the workspace is written.
  5. Always remove the staging directory (`finally`).
  6. On generation failure, return the failure. `.context/` is untouched in both modes.
- `compareTrees(expectedDir, actualDir, { exclude }) → { added, removed, changed }`: exported for tests, relative paths with `/` separators, sorted.

`cmdCtxGenerate(args)` in `cli.js` becomes a thin caller that maps results to messages and exits:
- Generate: success → 0.
- Check: fresh → 0. Stale → 1, listing up to 20 paths and a count of the rest.
- Argument error → 2.
- `ctx` missing or failed → that status, or 1.

`cmdBuildMaintain` calls `cmdCtxGenerate([])`; its own arguments belong to the persona build. The menu entry's description mentions `--check`.

### 7. Orchestrator

- **Halted sweep.** `supervisor_node` creates one `cancelled_this_iteration: set[str]` before the role loop. The PM intercept passes it to `_handle_rework_limit` (keyword `cancelled_ids`, same signature) instead of a block-local set. The halted sweep skips any `wp_id` in it. A WP the intercept already cancelled is no longer cancelled a second time, and no misleading `Failed to cancel halted WP` warning is logged. The per-intercept semantics stay the same: an ID in the set is still skipped by `_handle_rework_limit`, now for the whole iteration rather than one PM block. P05's registry executor inherits this set.
- **Rework limit constant.** `config.py` exports `MAX_REWORK_COUNT: int = int(_MANIFEST["constants"]["max_rework_count"])` beside the other manifest-derived constants. `test_integration.py` imports it in place of `REWORK_LIMIT = 3` at all three use sites. Its current consumers are the integration test and, if P05 needs one, the supervisor.
- **Live tests.** A new helper module, `orchestrator/tests/helpers/live_gating.py`, holds two pure, injectable functions:
  - `live_selected(markexpr: str) -> bool`: true when the `-m` expression names `live` as a positive term. The check tokenises on whitespace and parentheses and rejects a `live` preceded by `not`.
  - `probe_credentials(env: Mapping[str, str], opener=urllib.request.urlopen, timeout=5.0) -> tuple[bool, str]`: no key → `(False, "no key")`. Anthropic `GET https://api.anthropic.com/v1/models` with `x-api-key` and `anthropic-version: 2023-06-01`; Google `GET https://generativelanguage.googleapis.com/v1beta/models?key=…`. HTTP 401/403 → `(False, "invalid key")`. Network error → `(False, "unreachable")`. 200 → `(True, provider)`. This mirrors `scripts/preflight-orchestrator.js` L228–L280 and consumes no tokens.

  `orchestrator/tests/conftest.py` adds a `pytest_collection_modifyitems` hook. When `live_selected(config.option.markexpr)` is false, it adds a skip marker to every `live` item ("live tests run only with -m live"). When it is true, it probes once per session (cached on `config`) and adds a skip marker with the probe's reason when the probe fails. The existing in-test `pytest.skip` calls stay as a second line.

### 8. Documentation and versions

The manifest, README and changelog updates are listed under Documentation Updates. Versions:
- mcp-server v2.14.0 (registry, help entries, start-guard extraction).
- orchestrator v1.6.0 (sweep fix, manifest constant, live gating).
- root v2.17.0, carrying the `ctx-generate` change.

The workflow specification is unchanged: no state machine, routing or edge-case behaviour changes.

## Rationale

- **Registry over a better regex.** Three hand lists exist and two have drifted. Deriving the log and both test suites from the list `index.ts` actually executes removes them rather than policing them. The recording view uses only the public `registerTool` signature, so it does not depend on SDK internals. A new tool module becomes one line in `TOOL_MODULES`, and `tool-log-sync.test.ts` fails if that line is forgotten.
- **Help coverage as a test, not a review habit.** The P04 reviewers flagged the missing entries four times and nobody acted. A registry-derived test makes the next omission a build failure.
- **Extract the start-guard chain now.** P03 deferred it to P04, and P04 deferred it again. Every limit-related change since P02 has edited both copies. The parity suite stays as an end-to-end guard on the claim + start composition.
- **Staged generation for `ctx-generate`.** Validating arguments first fixes the reported defect. Generating into a staging directory also fixes the wider one: any `ctx` failure currently deletes tracked output. It also makes `--check` the same code path as a real run (insight `b37db114-…`), so the two cannot drift.
- **Probe credentials instead of catching provider errors.** The live tests run the stage node, which catches exceptions and reports failure through state, so a 401 shows up as an assertion failure deep inside the test. A pre-collection probe, using the same endpoints `preflight-orchestrator.js` already trusts, decides once and reports a clear skip reason.
- **Manifest-derived constant.** The test's "mirror" comment already lies (3 vs 5). Deriving it is the only form that cannot diverge again (insight `d56f4e19-…`).
- **No speculative structure.**
  - `ToolModule.id` has a consumer: diagnostics in `registerAllTools` errors and test failure messages.
  - `PipelineStartOutcome`'s `tripped` variant has two consumers.
  - `compareTrees` and `parseCtxArgs` are exported for tests and used by `runCtxGenerate`.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Source of the startup tool list | Names recorded at registration via a `registerTool`-forwarding view (`registerAllTools`) | Keep the literal + regex test; read the SDK's private `_registeredTools`; a static `TOOL_NAMES` array per module | The literal is the drift source. Private SDK fields break silently on upgrade. Per-module name arrays duplicate each `registerTool` call. Recording at the call site has one source and uses public API only. |
| Schema-integrity tool list | Derived from `registerAllTools`, plus a named zero-parameter allowlist | Keep `EXPECTED_TOOL_NAMES` and add the three missing tools by hand | Adding three names fixes today and reintroduces the drift class. An accidental tool removal is still caught by the help-coverage orphan check and visible in review. |
| Help coverage enforcement | New registry-derived coverage suite | Extend `knowledge-help.test.ts` per tool | Per-tool blocks are another hand list. One loop covers every current and future tool. |
| Start-guard sharing | One `applyPipelineStart` helper used by both tools | A narrower Guards 4–5 helper only (P03's suggested first slice); make `beginWork` call `startPipeline` | The narrow helper leaves half the chain duplicated. Calling the tool function would need a second lock acquisition and break the atomic claim + start write. |
| Helper failure signalling | Throw for rejections, return `tripped` for a persisted trip | Return a full result union for every guard | Both callers already rely on throw-to-abort inside `updateWorkPackageWithSync`. Only the trip needs a commit-then-error path, so only it is a return value. |
| `ctx-generate` safety | Validate args, generate into staging, replace on success; `--check` compares staging to `.context/` | Only reorder validation before the clean; implement `--check` as an mtime/heuristic comparison | Reordering alone still deletes `.context/` when `ctx` fails mid-run. A heuristic check would differ from what a real run produces. |
| Staging location | `os.tmpdir()` via `fs.mkdtempSync` | A gitignored directory inside the workspace | A temp dir cannot be picked up by `ctx`'s own source globs, which scan the workspace (e.g. the `**/module-context.yaml` import). |
| Live-test default | Skip unless `-m` selects `live`, plus a credential probe when selected | `addopts = "-m 'not live'"` in `pyproject.toml`; env var opt-in | `addopts` overrides are fragile when the CLI passes its own `-m` (`cli.js` L903 does). An env var adds a second opt-in mechanism next to the documented `-m live`. |
| Halted-sweep dedupe | Iteration-scoped cancelled-ID set shared by intercept and sweep | Re-fetch `ledger_list_work_packages` before the sweep | A re-fetch costs an MCP round-trip per WAIT iteration to recover a fact the supervisor already holds. |

## Pattern Alignment

- Follows the Tool Registration Pattern (`mcp-server/docs/agents/project-manifest/tech-stack.md` § 6). Modules keep their `register(server)` exports; the registry only lists them.
- Follows the mock `McpServer` intercept pattern (`mcp-server/docs/agents/project-manifest/constraints-testing.md` L169+). The tests now obtain the module list from the registry instead of importing each module.
- Follows pure guard helpers in `src/utils/` (`checkRevalidationGuard` in `mcp-server/src/utils/workflow-helpers.ts` L214; `requirePmRole` in `mcp-server/src/utils/pm-role-guard.ts`) and plain-function modules (insight `f389f9ce-…`).
- Follows capture-outside-the-updater for post-lock errors (`breakerMessage`, `mcp-server/src/tools/pipeline.ts` L153, `mcp-server/src/tools/begin-work.ts` L74).
- Follows "structured result, caller owns the exit" with injected `spawn` for root scripts (`scripts/lib/mcp-dist-freshness.js` L14–L19), and static source assertions for `cli.js` wiring (`scripts/tests/cli-cmd-agent.test.js`).
- Follows manifest-derived constants in `orchestrator/src/config.py`.
- Follows test helpers in `orchestrator/tests/helpers/`.
- **Departure:** the orchestrator test suite gains its first collection hook in `conftest.py`, which has held config stubs only. Justified because marker-based default skipping can only be implemented at collection time. The decision logic lives in the testable helper module, and the hook stays a few lines.
- **Departure:** `applyPipelineStart` unifies guard order on `startPipeline`'s sequence, changing `beginWork`'s order for one unreachable-through-tools state. Justified because a shared helper must have one order, and the parity suite pins it.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/index.ts` (L82–L97, L167–L172) | Module list and startup tool literal are hand-maintained | Promoted to step 2 | P04 rejected this as needing a refactor across eleven modules. Recording at the call site needs no module changes, so the cost objection no longer holds. |
| `mcp-server/tests/tools/schema-integrity.test.ts` (L19–L98) | Own module list and name list; three tools already uncovered | Promoted to step 3 | It is the live instance of the drift the synthesis warned about. |
| `mcp-server/tests/startup/tool-log-sync.test.ts` | Guards a literal that step 2 removes | Promoted to step 3 | The test is repurposed to guard registry completeness. |
| `mcp-server/src/tools/help-content.ts` | Four registered tools lack entries; one lacks an overview row; nothing checks completeness | Promoted to step 4 | Synthesis Deferred 1, widened to `ledger_detect_project` once verified. |
| `mcp-server/src/utils/pm-role-guard.ts` | Contract only covered indirectly | Promoted to step 5 | Synthesis Deferred 3. |
| `mcp-server/src/tools/pipeline.ts` / `mcp-server/src/tools/begin-work.ts` | Guard chain duplicated with one ordering difference | Promoted to step 7 | Deferred twice (P03 → P04); every recent limit change edited both copies. |
| `mcp-server/tests/tools/start-path-parity.test.ts` header | Describes "two copies" | Promoted to step 7 | The header must describe the shared helper; the suite stays. |
| `mcp-server/tests/integration/rework-limit.test.ts` | Duplicated setup, seven `as any` casts | Promoted to step 8 | P03 Follow-up 9, carried by P04. |
| `scripts/cli.js` `cmdCtxGenerate` (L556–L585) | Destructive clean before validation and before generation | Promoted to step 9 | Synthesis Deferred 2; bit two pipelines. |
| `scripts/cli.js` `cmdBuildMaintain` (L511) | Forwards build args to `ctx` | Promoted to step 9 | Found during verification. It would turn into an argument error once step 9 validates arguments, so it must be fixed in the same step. |
| `orchestrator/src/supervisor.py` (L703–L723, L828–L870) | Handled-ID set scoped narrower than the iteration | Promoted to step 11 | P03 Follow-up 5. |
| `orchestrator/tests/test_integration.py` (L53–L54) | Hardcoded mirror constant already wrong | Promoted to step 10 | P03 Follow-up 7. |
| `orchestrator/tests/conftest.py`, `orchestrator/pyproject.toml` markers | Documented "skipped by default" not implemented | Promoted to step 12 | P03 Follow-up 6. |
| `orchestrator/README.md` L376; `orchestrator/docs/agents/project-manifest/README.md` L15, L116 | Hardcoded test counts | Promoted to step 13 | P03 Follow-up 8, widened to the two manifest sites found during verification. |
| `orchestrator/src/supervisor.py` halted sweep direct synthesis route | Unblocked dependents never run after a sweep | Rejected | Owned by pending plan P05 (rejected row L158 there). Changing routing here would collide with P05's intercept redesign. |
| `.githooks/pre-commit` L56–L62 CTX staleness warning | Could use the new `--check` | Rejected | `--check` runs a full `ctx` generation (seconds). The hook's advisory staged-file heuristic is the right cost for every commit. Agents and the user can run `--check` on demand. |
| `mcp-server/src/utils/pm-role-guard.ts` vs `updateWorkPackageStatus` accepting `'Project Manager Agent'` | Two PM checks accept different role strings | Rejected | The status-transition path is outside this plan's files, and changing either side alters authorisation behaviour. Step 5's test pins the guard's current contract, which makes the asymmetry visible. Recorded in Deferred Items. |
| `mcp-server/tests/tools/knowledge-help.test.ts` per-tool presence blocks | Become redundant with step 4's coverage suite | Rejected | They are harmless, and the file's content-specific assertions remain valuable. Deleting the overlap is churn without gain. |

## Detailed Steps

1. **Capture the test baseline.** No dependencies; must run before any other step changes code.
    - Run the mcp-server suite (`npm test` in `mcp-server/`), the root scripts suite (`npm test` at the workspace root) and the orchestrator suite (`python -m pytest tests/` in `orchestrator/`, default markers). Write each run's failing test IDs and totals to `~/.ai-insights/baselines/2026-10-16-p04-pipeline-stage-adjustment-rework-1/` (`mcp-server.txt`, `scripts.txt`, `orchestrator.txt`).
    - The baseline lives in the user's home directory, outside every repository, where no step of this run cleans or overwrites it.
    - Do not fix anything found here; pre-existing failures are recorded, not addressed.

2. **Add the tool registry and wire `index.ts`.**
   - Create `mcp-server/src/tools/registry.ts` (new) with `ToolModule`, `TOOL_MODULES` (twelve modules, today's order, `Object.freeze`d) and `registerAllTools(server)` as described in Approach §1, with JSDoc on each export.
   - In `mcp-server/src/index.ts`, replace the twelve tool-module imports and `register` calls with `registerAllTools(server)`, keep the returned names, and print `[project-ledger-mcp] Registered tools: ${names.join(', ')}` at the current log position.
   - Remove both "kept in sync manually" NOTE comments.
   - Run `npx tsc --noEmit` in `mcp-server/`.

3. **Derive the registration tests from the registry.**
   - Rewrite `mcp-server/tests/startup/tool-log-sync.test.ts` per Approach §2: registry-vs-source-scan set equality, no duplicates, and `index.ts` uses `registerAllTools(` without a hardcoded `Registered tools: ledger_` literal. Keep `EXCLUDED_TOOL_FILES` for `help-content.ts` and add `registry.ts` to it.
   - Rewrite the registration part of `mcp-server/tests/tools/schema-integrity.test.ts` per Approach §2: `registerAllTools(mockServer)` in `beforeAll`, per-tool `ZodObject` assertion, non-empty `properties` except `ZERO_PARAMETER_TOOLS`, and a synthetic `.refine()` fixture proving detection.
   - Replace the two count-bearing header comments with count-free wording. Leave the numeric-helper block unchanged.
   - Confirm the suite now covers all 33 tools, including `ledger_ping`, `ledger_import_standalone` and `ledger_update_synthesis`.

4. **Complete the help content and add the coverage suite.** Depends on step 2.
   - Add `TOOL_HELP` entries for `ledger_reset_rework_count`, `ledger_reopen_cancelled_wp`, `ledger_update_acceptance_criteria` and `ledger_detect_project` to `mcp-server/src/tools/help-content.ts`, structured per Approach §3. Derive guard order and messages from `mcp-server/src/tools/work-package-admin.ts` and `mcp-server/src/tools/project-lifecycle.ts`, cross-checked against `mcp-server/docs/agents/project-manifest/api-surface.md`. Where code and manifest disagree, the code's current behaviour is documented and the disagreement is reported as a pipeline observation.
   - Add a `ledger_detect_project` row to the overview table.
   - Create `mcp-server/tests/tools/help-content-coverage.test.ts` (new) per Approach §3.

5. **Unit-test `requirePmRole()`.** Create `mcp-server/tests/utils/pm-role-guard.test.ts` (new) per Approach §4.

6. **Add the missing `beginWork` READY-at-MAX case.** This is a characterization test, written before step 7 refactors the code. In `mcp-server/tests/tools/begin-work.test.ts` `describe('beginWork — circuit breaker persists the trip')`, add `it('writes nothing on a READY WP whose stored count is already at MAX')`:
   - Seed a READY WP assigned to Developer with a FAIL implementation pipeline and `rework_counts.implementation = MAX_REWORK_COUNT`.
   - Call `beginWork`.
   - Assert `isError`, `status === 'READY'`, unchanged `assigned_to`, unchanged `last_updated`, the root summary still READY, and a single pipeline.

7. **Extract the shared start-guard helper.** Depends on step 6.
   - Create `mcp-server/src/utils/pipeline-start.ts` (new) with `PipelineStartRequest`, `PipelineStartOutcome` and `applyPipelineStart`, per Approach §5. Error texts must be moved verbatim.
   - Replace the guard chain in `startPipeline` (`mcp-server/src/tools/pipeline.ts`) and the start phase of `beginWork` (`mcp-server/src/tools/begin-work.ts`) with a call to it. Map `tripped` to each tool's existing `breakerMessage` and `return { wp, root }`.
   - Remove imports that become unused in both files.
   - Create `mcp-server/tests/utils/pipeline-start.test.ts` (new) with in-memory `wp`/`root` fixtures, one case per guard (see Test Plan).
   - In `mcp-server/tests/tools/start-path-parity.test.ts`:
     - Rewrite the header to say both tools route through `applyPipelineStart` and the suite pins the claim + start composition.
     - Add the scenario "duplicate IN_PROGRESS of a type outside the active stages reports the active-stage error on both paths".
   - Run the full mcp-server suite and confirm every existing guard-message assertion still passes unchanged.

8. **Tidy `rework-limit.test.ts`.**
   - In `mcp-server/tests/integration/rework-limit.test.ts`, extract the duplicated temp-ledger `beforeEach`/`afterEach` into one file-local `useTempLedger(prefix)` helper returning accessors for `tempDir` and `store`.
   - Replace the seven `as any` casts with typed values: `PipelineType` for `type`, the tools' `z.infer` argument types via each module's exported schema in `_internal` where available, `WorkPackageDetail`/`WorkPackageSummary` for the seeded objects, and `satisfies` where a partial literal is intended.
   - Where a cast cannot be removed without changing the test's meaning, keep it with a one-line comment stating why.
   - Assertions are unchanged.

9. **Make `ctx-generate` safe and add `--check`.**
   - Create `scripts/lib/ctx-generate.js` (new, ESM) with `parseCtxArgs`, `generateContext`, `compareTrees` and `runCtxGenerate`, per Approach §6, with a module header in the style of `scripts/lib/mcp-dist-freshness.js`.
   - Replace the body of `cmdCtxGenerate` in `scripts/cli.js` with a call to `runCtxGenerate` and the result-to-message/exit mapping from Approach §6.
   - Change `cmdBuildMaintain` to call `cmdCtxGenerate([])`.
   - Add `.context.incoming/` and `.context.previous/` to the root `.gitignore`.
   - Update the `ctx-generate` menu entry description to "Generate context documentation (ctx generate); --check verifies freshness without writing".
   - Create `scripts/tests/ctx-generate.test.js` (new), using a fake `spawn` that writes fixture files into the `-w` directory, plus real temp directories.
   - Add static source assertions for the wiring to `scripts/tests/cli-ctx-generate.test.js` (new), reusing the `extractFunctionBody` approach from `scripts/tests/cli-cmd-agent.test.js`.
   - Manually verify against the real `ctx` binary:
     1. `node scripts/cli.js ctx-generate` succeeds.
     2. An immediate `node scripts/cli.js ctx-generate --check` exits 0.
     3. `node scripts/cli.js ctx-generate --bogus` exits 2 with `.context/` untouched (`git status .context` unchanged).

     Record the outputs in the pipeline summary.

10. **Derive the orchestrator rework limit from the manifest.**
   - Add `MAX_REWORK_COUNT` to `orchestrator/src/config.py` next to the other manifest-derived constants, with a docstring comment naming `constants.max_rework_count`.
   - In `orchestrator/tests/test_integration.py`, import it, delete `REWORK_LIMIT = 3` and its comment, and replace the three uses.
   - Add a test to `orchestrator/tests/test_config.py` asserting `config.MAX_REWORK_COUNT == json.load(manifest)["constants"]["max_rework_count"]`.
   - Run the integration tests: `-m integration`.

11. **Stop the halted sweep re-cancelling a WP.**
    - In `orchestrator/src/supervisor.py` `supervisor_node`, create `cancelled_this_iteration: set[str] = set()` before the role loop.
    - Pass it to `_handle_rework_limit` instead of the block-local `cancelled_ids`.
    - In the halted sweep, skip any `_wp_id_h` in it.
    - Update the inline comment at the intercept to state the set's iteration scope and that the sweep reads it.
    - Add the regression test to `orchestrator/tests/test_supervisor.py` (see Test Plan).
    - Run `ruff check` on the changed files.

12. **Gate live tests by default and on invalid credentials.**
    - Create `orchestrator/tests/helpers/live_gating.py` (new) with `live_selected` and `probe_credentials`, per Approach §7, stdlib only.
    - Add the `pytest_collection_modifyitems` hook to `orchestrator/tests/conftest.py`, with a module-docstring paragraph describing it.
    - Create `orchestrator/tests/test_live_gating.py` (new) for the helper functions, with the opener injected so no network is used.
    - Verify that a default `python -m pytest tests/` reports the `live` tests as skipped. With `-m live` and a deliberately invalid key in the environment, they should skip with "invalid key".

13. **Update documentation and manifests.** Depends on steps 2–12. Apply every entry under Documentation Updates. Write counts nowhere: describe test suites by scope, not by number.

14. **Changelogs and versions.** Depends on step 13.
    - Add entries in house style:
      - `mcp-server/changelog.md` v2.14.0.
      - `orchestrator/changelog.md` v1.6.0.
      - Root `changelog.md` v2.17.0, with `> mcp v2.14.0 · orchestrator v1.6.0`. It summarises the tool registry, the help entries, the start-guard extraction, the `ctx-generate` safety and `--check`, and the orchestrator test and sweep fixes.
    - Run `node scripts/cli.js build-maintain`. It syncs `mcp-server/package.json`, root `package.json` and `orchestrator/pyproject.toml`, rebuilds personas and the agents overview, and regenerates `.context/` through the new code path.
    - Run `node scripts/check-version-sync.js`.

15. **Exit gate.** Depends on steps 1 and 14.
    - Run the full mcp-server suite (`npm test` in `mcp-server/`), `npx tsc --noEmit`, the root scripts suite (`npm test` at the workspace root), the full orchestrator suite (`python -m pytest tests/`), `ruff check` on the changed Python files, and `node scripts/build-personas.js --check`.
    - Run `node scripts/cli.js ctx-generate --check`, which must exit 0.
    - Compare each suite's failing test IDs against the step 1 baseline in `~/.ai-insights/baselines/2026-10-16-p04-pipeline-stage-adjustment-rework-1/`. Every failure must already appear in the baseline. Baseline failures that now pass, such as the live-LLM tests that now skip, are listed as resolved. Record totals in the pipeline summary only, not in any document.

## Dependencies

- Step 1 (baseline capture) has no dependencies and runs before every other step. Step 15 consumes its output.
- Steps 3 and 4 depend on step 2 (`registerAllTools`).
- Step 7 depends on step 6, which pins the behaviour first.
- Step 9's `build-maintain` change must land before step 14 runs `build-maintain`.
- Step 13 depends on steps 2–12. Step 14 depends on step 13. Step 15 depends on steps 1 and 14.
- Steps 5, 8, 10, 11 and 12 are independent of each other and of steps 2–4.
- External: the `ctx` CLI on `PATH` (present at `/usr/local/bin/ctx`) for step 9's manual verification and steps 14–15. The orchestrator virtualenv for steps 10–12 and 15.

## Required Components

- New: `mcp-server/src/tools/registry.ts`
- New: `mcp-server/src/utils/pipeline-start.ts`
- New: `mcp-server/tests/tools/registry.test.ts`
- New: `mcp-server/tests/tools/help-content-coverage.test.ts`
- New: `mcp-server/tests/utils/pm-role-guard.test.ts`
- New: `mcp-server/tests/utils/pipeline-start.test.ts`
- New: `scripts/lib/ctx-generate.js`
- New: `scripts/tests/ctx-generate.test.js`
- New: `scripts/tests/cli-ctx-generate.test.js`
- New: `orchestrator/tests/helpers/live_gating.py`
- New: `orchestrator/tests/test_live_gating.py`
- Modified: `mcp-server/src/index.ts`, `mcp-server/src/tools/help-content.ts`, `mcp-server/src/tools/pipeline.ts`, `mcp-server/src/tools/begin-work.ts`
- Modified: `mcp-server/tests/startup/tool-log-sync.test.ts`, `mcp-server/tests/tools/schema-integrity.test.ts`, `mcp-server/tests/tools/start-path-parity.test.ts`, `mcp-server/tests/tools/begin-work.test.ts`, `mcp-server/tests/integration/rework-limit.test.ts`
- Modified: `scripts/cli.js`, root `.gitignore` (`.context.incoming/`, `.context.previous/`)
- Modified: `orchestrator/src/supervisor.py`, `orchestrator/src/config.py`, `orchestrator/tests/conftest.py`, `orchestrator/tests/test_integration.py`, `orchestrator/tests/test_supervisor.py`, `orchestrator/tests/test_config.py`
- Documentation files listed under Documentation Updates

## Assumptions

- The P04 working-tree changes (uncommitted `.context/`, changelogs, the plan-folder rename) are the baseline this plan builds on. The user commits them; this plan does not depend on their commit state.
- The `docs/agents/plans/2026-09-22-p04-pipeline-stage-adjustment/` deletion is the intentional rename to `2026-10-15-…`. Verified: `request.md` is byte-identical, and the new folder holds the evolved plan and brief.
- An archiver pass for P04 already ran (insight `a7adbb64-4f57-42ac-9b27-25913bde3815` carries P04 as `origin_plan`).
- `ctx generate` output is deterministic for identical inputs. Step 9's manual generate-then-check verification proves it. If it is not, the check reports the differing files, and the step records them instead of masking them.
- P05 executes after this plan and, per its own rules, locates code by function and reads version numbers at execution time.

## Constraints

- Error texts of all start guards and of `requirePmRole` stay byte-identical; tests assert them.
- Persist-on-trip semantics (spec §21.74) are preserved on both start paths.
- The startup log keeps the `[project-ledger-mcp] Registered tools: …` format on `stderr`.
- Root scripts and orchestrator code follow the Cross-Platform Policy (root `AGENTS.md`): Node/Python built-ins, `path.join`/`pathlib`, `shell: IS_WIN` when spawning `ctx`, OS temp directories.
- No new runtime or dev dependencies (the credential probe uses `urllib.request`).
- No workflow specification change and no persona change.

## Out of Scope

- Changing the halted sweep's direct route to synthesis (owned by P05).
- A GUI control for editing stage lists (needs an authorisation model the GUI lacks).
- Aligning the `'Project Manager Agent'` acceptance between `updateWorkPackageStatus` and `requirePmRole`.
- Replacing the pre-commit CTX staleness heuristic with `--check`.
- The design decisions P04 recorded as exclusions: mutating other creation-time WP fields, server-side security-surface validation of stage lists, and `rework_counts` adjustment or auto-reopen in `ledger_update_pipeline_stages`. The same applies to the Doctor's legacy-WP recommendation.
- The self-declared `agent_role` trust model.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Commit the P04 working-tree state, including the plan-folder rename from `2026-09-22-…` to `2026-10-15-…`, and this plan's changes. | After the run | Version control is managed by the user. |
| 2 | Restart or reinstall the stable workspace's MCP server so the running instance serves the new help entries and registry. | After the run | The stable workspace runs the workflow executing this plan; replacing its server mid-run would stop the run. |
| 3 | Publish and tag the root releases (v2.15.0, v2.16.0 and v2.17.0 are unreleased; the latest tag is 2.14.1). | After the run | Releases and tags belong to the user. The run only prepares changelogs and version fields. |
| 4 | Optionally run the belated security audit on the project from P04's `request.md` incident. | After the run | It needs the user's choice of project and a live ledger. |

## Acceptance Criteria

- AC-01: `mcp-server/src/tools/registry.ts` exports `TOOL_MODULES` and `registerAllTools`. `src/index.ts` registers tools only through `registerAllTools` and contains no hardcoded tool-name list.
- AC-02: The startup log line `[project-ledger-mcp] Registered tools: …` lists exactly the names `registerAllTools` returned, on `stderr`.
- AC-03: `tool-log-sync.test.ts` fails when a module that calls `server.registerTool` is missing from `TOOL_MODULES`, and when a tool name repeats.
- AC-04: `schema-integrity.test.ts` derives its tool set from the registry, covers all registered tools (including `ledger_ping`, `ledger_import_standalone`, `ledger_update_synthesis`), asserts a `ZodObject` outer schema for each, and contains no hand-written tool-name list.
- AC-05: `TOOL_HELP` has entries with `# name` headings for `ledger_reset_rework_count`, `ledger_reopen_cancelled_wp`, `ledger_update_acceptance_criteria` and `ledger_detect_project`. Each documents required parameters, guards in evaluation order, response shape and an example. The overview table lists `ledger_detect_project`.
- AC-06: `help-content-coverage.test.ts` fails when any registered tool other than `ledger_help` lacks a `TOOL_HELP` entry or overview row, and when a `TOOL_HELP` key names no registered tool.
- AC-07: `tests/utils/pm-role-guard.test.ts` pins `requirePmRole`'s `null` result for `'Project Manager'` and its exact rejection object and message for other roles, including `'Project Manager Agent'`.
- AC-08: A `beginWork` call on a READY WP whose stored count is already at `MAX_REWORK_COUNT` is refused and persists nothing: status, assignment, root summary and `last_updated` are unchanged.
- AC-09: `startPipeline` and `beginWork` both apply the start guards through `applyPipelineStart` in `src/utils/pipeline-start.ts`. No guard logic is duplicated between the two files, and all pre-existing guard and circuit-breaker tests pass with unchanged assertions.
- AC-10: `rework-limit.test.ts` has one shared temp-ledger setup. Each remaining `as any` cast has an explanatory comment, and the file has no uncommented `as any`.
- AC-11: `node scripts/cli.js ctx-generate` with an unsupported flag exits 2 without modifying `.context/` or `CLAUDE.md`.
- AC-12: A failed `ctx` run, or a failed swap, leaves `.context/` with its previous content. A successful generate replaces `.context/` with the new output, `generated-at.txt` and the `CLAUDE.md` sync.
- AC-13: `node scripts/cli.js ctx-generate --check` exits 0 when `.context/` and `CLAUDE.md` match a fresh generation, and 1 with the differing paths otherwise. It writes nothing in the workspace in either case.
- AC-14: `node scripts/cli.js build-maintain` passes no arguments to the CTX step.
- AC-15: `orchestrator/src/config.py` exports `MAX_REWORK_COUNT` equal to the manifest's `constants.max_rework_count`, and `test_integration.py` uses it with no hardcoded limit.
- AC-16: In a supervisor iteration where the PM intercept cancels a WP that also has ≥ 3 consecutive failures, and all roles then WAIT, `ledger_update_work_package_status(CANCELLED)` is called exactly once for that WP and no `halted_wp_cancelled` entry is logged for it.
- AC-17: A default orchestrator test run reports every `live` test as skipped. With `-m live`, live tests are skipped with the probe's reason when no key is set or the key is rejected (HTTP 401/403), and run when the probe succeeds.
- AC-18: No document in the orchestrator README or orchestrator manifest states a test count.
- AC-19: All manifests, READMEs and changelogs listed under Documentation Updates reflect the changes. Versions are mcp-server v2.14.0, orchestrator v1.6.0 and root v2.17.0, and `check-version-sync.js` passes.
- AC-20: The exit gate passes: full mcp-server, root scripts and orchestrator suites, `tsc --noEmit`, `ruff check` on changed Python files, `build-personas.js --check` and `ctx-generate --check`. Every remaining test failure appears in the step 1 baseline.

## Testing Strategy

- **Characterization before refactor.** Step 6 adds the missing READY-at-MAX case before step 7 moves the guard chain. The unchanged guard-message, circuit-breaker and parity suites then prove the extraction is behaviour-preserving.
- **Baseline first.** Step 1 records failing test IDs before any change, so the exit gate can tell a regression from a pre-existing environmental failure.
- **Unit tests for every new module.** These cover `registerAllTools` (through the startup and schema suites), `applyPipelineStart` (in-memory fixtures, no disk), `ctx-generate.js` (fake `spawn` + temp directories) and `live_gating.py` (injected opener, no network).
- **Derived-set tests with synthetic failure fixtures** (insight `48607cdb-…`). Each registry-derived suite includes a case proving it fails on a planted violation: a `.refine()` schema, a fake module missing from a list, a `TOOL_HELP` key with no tool.
- **Static source assertions** for `cli.js` wiring, which cannot be imported.
- **Manual end-to-end check** of `ctx-generate` against the real `ctx` binary in step 9, and dogfooded in the exit gate (`--check` after `build-maintain`).
- **Scripted supervisor test** for the sweep dedupe, using the existing `test_supervisor.py` fake-tool pattern.

## Test Plan

- `mcp-server/tests/startup/tool-log-sync.test.ts`:
  - The registry name set equals the `src/tools/*.ts` source-scan set.
  - `registerAllTools(mockServer, TOOL_MODULES.filter(m => m.id !== 'ping'))` yields `missing: ['ledger_ping']`.
  - The returned names are unique.
  - `src/index.ts` contains `registerAllTools(`, builds the log line from the returned names, and has no `Registered tools: ledger_` literal.

  Covers AC-01, AC-02, AC-03.
- `mcp-server/tests/tools/registry.test.ts` (new) — `registerAllTools` forwards every call to the real `registerTool` with the original arguments and returns its results. It returns names in order, throws `Duplicate tool registration: <name>` on a repeated name, and `TOOL_MODULES` is frozen and has unique `id`s — AC-01, AC-03
- `mcp-server/tests/tools/schema-integrity.test.ts` — every registry tool has a `ZodObject` outer schema. `properties` is non-empty for every tool not in `ZERO_PARAMETER_TOOLS`. `ledger_ping`, `ledger_import_standalone` and `ledger_update_synthesis` are covered. A synthetic `.refine()`-wrapped schema is detected as non-`ZodObject`. The numeric-helper assertions are unchanged — AC-04
- `mcp-server/tests/tools/help-content-coverage.test.ts` (new) — per registered tool (excluding `ledger_help`): an entry exists, a `# name` heading and an overview row. There is no orphan `TOOL_HELP` key. `findHelpGaps` reports a synthetic name absent from `TOOL_HELP` and a synthetic orphan key — AC-05, AC-06
- `mcp-server/tests/tools/knowledge-help.test.ts` — gains content assertions for the four new entries: `## Required Parameters`, `## Guards` (the three PM tools), `## Example`, and `PM-only` wording for the three PM tools — AC-05
- `mcp-server/tests/utils/pm-role-guard.test.ts` (new) — returns `null` for `'Project Manager'`. It rejects `'Developer'`, `'Project Manager Agent'`, `'project manager'` and `''` with `isError: true`, one text block and exact message text, with the tool name inserted verbatim — AC-07
- `mcp-server/tests/tools/begin-work.test.ts` › `writes nothing on a READY WP whose stored count is already at MAX` — refusal, READY status, assignment, root summary and `last_updated` unchanged, one pipeline — AC-08
- `mcp-server/tests/utils/pipeline-start.test.ts` (new) — one case per guard with exact messages:
  - role rejection and PM override marker
  - non-IN_PROGRESS rejection
  - inactive-stage rejection
  - duplicate rejection
  - missing / non-PASS prerequisite
  - auto-cancelled prerequisite ignored
  - revalidation rejection
  - direct and downstream rework increments
  - trip from below returns `tripped` with the counter at MAX and no pipeline appended
  - stored-at-MAX throws
  - success appends the pipeline and sets `assigned_to` on detail and root summary, plus `root.last_updated`

  Covers AC-09.
- `mcp-server/tests/tools/start-path-parity.test.ts` — existing scenarios unchanged; the new duplicate-outside-active-stages scenario agrees on both paths — AC-09
- Existing `mcp-server/tests/tools/start-pipeline-guards.test.ts`, `mcp-server/tests/tools/rework-circuit-breaker.test.ts`, `mcp-server/tests/tools/begin-work.test.ts`, `mcp-server/tests/integration/rework-limit.test.ts` — pass with unchanged assertions — AC-09
- `mcp-server/tests/integration/rework-limit.test.ts` — refactored setup and typed arguments, same assertions, suite passes — AC-10
- `scripts/tests/ctx-generate.test.js` (new):
  - `parseCtxArgs` accepts `--check` and each allowlisted passthrough flag, and rejects `--bogus` and `-w`.
  - `runCtxGenerate` with an invalid flag performs no filesystem access (fake `fs` spies, or an untouched temp workspace).
  - A failing fake `spawn` leaves an existing `.context/` byte-identical.
  - A succeeding fake `spawn` replaces `.context/`, writes `generated-at.txt`, and regenerates `CLAUDE.md` with the header.
  - Check mode reports fresh for identical trees (ignoring `generated-at.txt`), and reports added, removed and changed files plus a stale `CLAUDE.md` correctly, writing nothing.
  - The staging directory is removed after success, failure and check.
  - An injected failure during the copy or the second rename returns `replace-failed`, leaves the original `.context/` content in place, and leaves no `.context.incoming` or `.context.previous` behind.
  - A spawn `ENOENT` maps to `ctx-missing`.

  Covers AC-11, AC-12, AC-13.
- `scripts/tests/cli-ctx-generate.test.js` (new) — the `cmdCtxGenerate` body delegates to `runCtxGenerate` and contains no `rmSync`. The `cmdBuildMaintain` body calls `cmdCtxGenerate([])`. Exit-code mapping literals exist for the argument-error (2) and stale (1) paths — AC-11, AC-13, AC-14
- `orchestrator/tests/test_config.py` › `test_max_rework_count_matches_manifest` — `config.MAX_REWORK_COUNT` equals the manifest value — AC-15
- `orchestrator/tests/test_integration.py` — integration tests pass using `config.MAX_REWORK_COUNT`; `REWORK_LIMIT` no longer defined — AC-15
- `orchestrator/tests/test_supervisor.py` › `TestReworkLimitCancellation::test_halted_sweep_skips_wp_cancelled_this_iteration` — a WP with `consecutive_failures >= 3` receives `REVIEW_REWORK_LIMIT`, and the PM is re-polled to WAIT with all other roles WAIT. Exactly one CANCELLED call for that WP, a `rework_limit_wp_cancelled` entry, no `halted_wp_cancelled` entry, route to synthesis. A companion case confirms a halted WP **not** cancelled by the intercept is still cancelled by the sweep — AC-16
- `orchestrator/tests/test_live_gating.py` (new):
  - `live_selected` returns true for `"live"`, `"integration or deepagent or live"` and `"(live)"`, and false for `""`, `"not live"`, `"integration"` and `"deepagent and not live"`.
  - `probe_credentials` (injected opener) returns no key → `(False, "no key")`; Anthropic 200 → `(True, "anthropic")`; 401 and 403 → `(False, "invalid key")`; a `URLError` → `(False, "unreachable")`; Google-only key → the Google endpoint is used.
  - The Anthropic request carries the `x-api-key` and `anthropic-version` headers.

  Covers AC-17.
- Manual, step 12 — a default `python -m pytest tests/` run shows the three `live` tests skipped; `-m live` with an invalid key shows them skipped with "invalid key" — AC-17
- Step 13 review against Documentation Updates, plus `grep -nE "[0-9]{3,} tests"` over `orchestrator/README.md` and `orchestrator/docs/agents/project-manifest/` returning nothing — AC-18, AC-19
- Step 15 exit gate commands — AC-19, AC-20

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/file-tree.md`:
  - Add `src/tools/registry.ts`, `src/utils/pipeline-start.ts`, `tests/tools/registry.test.ts`, `tests/tools/help-content-coverage.test.ts`, `tests/utils/pm-role-guard.test.ts` and `tests/utils/pipeline-start.test.ts`.
  - Rewrite the `tool-log-sync.test.ts` (L232) and `schema-integrity.test.ts` (L270) descriptions to the registry-derived purpose.
  - Update `start-path-parity.test.ts` (L272).
- `mcp-server/docs/agents/project-manifest/api-surface.md`:
  - Add a `src/tools/registry.ts` section (`ToolModule`, `TOOL_MODULES`, `registerAllTools`) and a `src/utils/pipeline-start.ts` section (`PipelineStartRequest`, `PipelineStartOutcome`, `applyPipelineStart`).
  - Change "registered via `xTools.register(server)` in `src/index.ts`" phrasing (L174, L214, L708, L785) to "registered through `TOOL_MODULES` (`src/tools/registry.ts`)".
  - Note at the `ledger_help` section (L726) that every registered tool has a `TOOL_HELP` entry, enforced by `help-content-coverage.test.ts`.
  - Point the circuit-breaker and revalidation notes (L474–L476) to `applyPipelineStart`.
- `mcp-server/docs/agents/project-manifest/tech-stack.md` § 6 Tool Registration Pattern (L147–L162): add the registry as the single module list. Also add that a new module is registered by adding one `TOOL_MODULES` entry, and that the startup log and the metadata tests derive from it.
- `mcp-server/docs/agents/project-manifest/constraints.md` § "Server Version Displays at Startup" (L468–L480): state that the `Registered tools:` line is generated from `registerAllTools`.
- `mcp-server/docs/agents/project-manifest/constraints-testing.md` § "Mock `McpServer` Intercept Pattern…" (L169+): replace the per-module `register()` example with `registerAllTools(mockServer)`, and add the zero-parameter allowlist rule.
- `mcp-server/docs/agents/project-manifest/constraints-code-style.md` L256: the regression guard covers every registry tool.
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md`:
  - "Pipelines Can Only Be Started for an Active Stage" (L357–L373): change the "implemented twice" enforcement list to `applyPipelineStart` in `src/utils/pipeline-start.ts`, called by both start paths.
  - Replace the "Divergence between the two start paths" paragraph with the shared-helper rule (change start guards only in `pipeline-start.ts`; the parity suite pins the claim + start composition).
  - Check L245 for consistency.
- `mcp-server/AGENTS.md`: if it references the startup tool list or the start-guard duplication, update it to match. Verify with grep during step 13.
- `orchestrator/README.md`:
  - L376: replace "1107 tests — …" with a count-free description.
  - L514 and the marks table (L560–L562): live tests are skipped unless selected with `-m live`, and are skipped with a reason when the key is missing or rejected.
  - L529: same wording for the two live smoke tests.
- `orchestrator/tests/README.md` Marks Reference (L157–L163): describe the collection hook and the credential probe; add `helpers/live_gating.py` to the helpers table.
- `orchestrator/docs/agents/project-manifest/README.md` L15 and L116: remove "374 tests".
- `orchestrator/docs/agents/project-manifest/file-tree.md`: add `tests/helpers/live_gating.py` and `tests/test_live_gating.py`, and update the L75 live-test description.
- `orchestrator/docs/agents/project-manifest/api-surface.md`: add `config.MAX_REWORK_COUNT`.
- `orchestrator/docs/supervisor-routing.md` circuit-breaker / halted-WP section (L79–L89 per P05 brief): state that the sweep skips WPs already cancelled by the supervisor in the same iteration.
- Root `AGENTS.md`:
  - Add a `scripts/lib/ctx-generate.js` row to the Root-Level Tooling table.
  - In Generated Context Docs (L167), add "`node scripts/cli.js ctx-generate --check` verifies freshness without writing; unsupported flags are rejected before anything changes."
  - Update the `context.yaml` row (L435).
  - `CLAUDE.md` is regenerated from `AGENTS.md` by the step 14 `build-maintain` run.
- `docs/references/development.md` L79 and `docs/references/menu-guide.md` L80, L119: document `--check`, and that `build-maintain` runs CTX generation without forwarding its own flags.
- `docs/agents/project-manifest/README.md` L138: mention `--check`.
- `mcp-server/changelog.md` v2.14.0, `orchestrator/changelog.md` v1.6.0, root `changelog.md` v2.17.0 (step 14).
- `.context/` regenerated by step 14 (`build-maintain`) — covers the manifest edits per insight `53454e24-…`.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Halted sweep routes straight to synthesis, so unblocked dependents never run | P03 Deferred 1 → P04 Deferred 8 | Owned by pending plan P05, which redesigns the same intercept | Reconsider when P05 executes or immediately after it. |
| 2 | GUI control for editing a WP's stage list | P04 Out of Scope / rejected row | A separate feature needing an authorisation model the GUI does not have | Own plan if requested. |
| 3 | `'Project Manager Agent'` accepted by `updateWorkPackageStatus` but not by `requirePmRole` | Found during this plan's research | Changes authorisation behaviour in a path outside this plan's files | Step 5's test makes the guard's contract explicit. Decide on one canonical PM identity in a future plan. |
| 4 | Use `ctx-generate --check` in the pre-commit hook | Arises from step 9 | Full generation is too slow for every commit | Reconsider for a CI job rather than the hook. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Guard extraction changes an error text or persist-on-trip behaviour** | Step 6 pins the one uncovered case first. Messages are moved verbatim. All existing guard, breaker, parity and integration suites must pass with unchanged assertions (AC-09). |
| **The recording view breaks if the SDK's `registerTool` signature changes** | It forwards `...rest` untouched and returns the SDK's result. `registry.test.ts` asserts forwarding, and `tsc` checks the `McpServer` type. |
| **`ctx generate` is not deterministic, making `--check` report false staleness** | Step 9 verifies generate-then-check against the real binary. A diff is reported with paths rather than hidden, and the step records any non-deterministic file for follow-up. |
| **Replacing `.context/` fails halfway (e.g. a file lock on Windows)** | Generation completes in staging before `.context/` is touched. The swap copies to a sibling directory and uses two same-directory renames, restoring `.context.previous` on failure. Both transient names are gitignored. Tested with an injected failing copy and a failing second rename. |
| **The live-test probe hits the network during a normal run** | The probe runs only when `-m` selects `live`; default runs never probe. Unit tests inject the opener. |
| **Collision with P05's supervisor changes** | The change keeps `_handle_rework_limit`'s name and signature and widens only the set's scope, which P05's executor also needs. P05 locates code by function. |
| **`build-maintain` users relied on flags reaching `ctx`** | No documented flag of `build-maintain` targets `ctx`. Its args are persona-build and sync-version flags, which `ctx` already rejected. |
| **Help text drifts from implementation** | Step 4 derives the guard order from the code and reports any manifest disagreement as an observation. The coverage suite guarantees presence; the `knowledge-help.test.ts` additions pin structure. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The plan spans the MCP server, root scripts and the orchestrator across 15 steps with distinct concerns (a registry refactor, a guard-chain extraction, a destructive-tooling fix and test infrastructure), so formal QA and review stages per work package pay off.
