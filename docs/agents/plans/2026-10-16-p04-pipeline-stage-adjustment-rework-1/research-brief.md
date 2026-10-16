# Research Brief

Source: `docs/agents/plans/2026-10-15-p04-pipeline-stage-adjustment/synthesis.md` (Synthesis Rework). The user asked to include every deferred item that fits into one plan. Items were gathered from the P04 synthesis, and from the P04 `plan.md` Deferred Items, Out of Scope and rejected Structural Improvements rows. The P04 Deferred Items table carries P03's follow-ups. Each item was re-verified against the current working tree before it was carried.

## Scope Sketch

- MCP tool registration and startup log — `mcp-server/src/index.ts`, `mcp-server/src/tools/*.ts` — modification + new code (tool registry)
- Tool help content — `mcp-server/src/tools/help-content.ts` — modification
- MCP registration/metadata tests — `mcp-server/tests/startup/`, `mcp-server/tests/tools/schema-integrity.test.ts`, `mcp-server/tests/tools/knowledge-help.test.ts` — modification + new test
- PM role guard — `mcp-server/src/utils/pm-role-guard.ts` — new test only
- Pipeline start path — `mcp-server/src/tools/pipeline.ts`, `mcp-server/src/tools/begin-work.ts` — modification + new helper module
- Start-path and rework-limit tests — `mcp-server/tests/tools/start-path-parity.test.ts`, `mcp-server/tests/tools/begin-work.test.ts`, `mcp-server/tests/integration/rework-limit.test.ts` — modification
- CTX generation command — `scripts/cli.js` (`cmdCtxGenerate`, `cmdBuildMaintain`) — modification + new `scripts/lib/` module
- Orchestrator supervisor halted sweep — `orchestrator/src/supervisor.py` — modification
- Orchestrator config constants — `orchestrator/src/config.py` — modification
- Orchestrator tests — `orchestrator/tests/conftest.py`, `orchestrator/tests/test_integration.py`, `orchestrator/tests/test_deep_agent_integration.py`, `orchestrator/tests/test_supervisor.py` — modification
- Documentation and manifests — mcp-server, orchestrator and root manifests, READMEs, changelogs — modification

## Triage of inherited items

| # | Item | Origin | Verified state (2026-10-16) | Decision |
|---|------|--------|------------------------------|----------|
| 1 | `TOOL_HELP` body entries for `ledger_reset_rework_count`, `ledger_reopen_cancelled_wp`, `ledger_update_acceptance_criteria` | P04 synthesis, Deferred 1 | Still missing. Registered-vs-help diff also shows **`ledger_detect_project`** has neither a `TOOL_HELP` entry nor an overview row | Promote, extended to `ledger_detect_project` |
| 2 | `ctx-generate` wipes `.context/` before argument validation; no `--check` mode | P04 synthesis, Deferred 2 + Strategic Recs | Still true (`scripts/cli.js` L556–L585). `ctx generate --check` exits 255 after the clean. New finding: `cmdBuildMaintain` forwards its own args to `cmdCtxGenerate` | Promote, incl. the arg-forwarding defect |
| 3 | Dedicated unit test for `pm-role-guard.ts` | P04 synthesis, Deferred 3 | No `tests/utils/pm-role-guard.test.ts` | Promote |
| 4 | Stale `docs/agents/plans/2026-09-22-p04-pipeline-stage-adjustment/` deletion | P04 synthesis, Deferred 4 | Verified intentional rename: the old folder's `request.md` matches the new one byte for byte. `plan.md`/`research-brief.md` evolved, and the new folder is untracked. This needs a user commit, not plan work | Resolved; no step |
| 5 | Knowledge Archiver pass for P04 | P04 synthesis, Next Steps | Insight `a7adbb64-…` (origin_plan `2026-10-15-p04-pipeline-stage-adjustment`) exists, so an archiver pass did run | Resolved; no step |
| 6 | `schema-integrity.test.ts` keeps its own `register()` list | P04 synthesis, Code Insights (Developer) | Already drifted: the test registers 11 modules and misses `ping.ts` and `standalone-import.ts`, so `ledger_ping`, `ledger_import_standalone` and `ledger_update_synthesis` have **no** schema coverage | Promote (with item 7) |
| 7 | Auto-derive the `Registered tools:` startup literal | P04 plan, Out of Scope + rejected row | Literal still hand-maintained (`src/index.ts` L170); guarded only by a regex source scan | Promote (tool registry) |
| 8 | Extract the duplicated start-path guard chain | P04 Deferred 1 (P03 Deferred 2) | Two copies remain (`pipeline.ts` L156–L282, `begin-work.ts` L145–L238) | Promote |
| 9 | `beginWork` refusal at stored count ≥ MAX on a READY WP | P04 Deferred 2 (P03 Follow-up 4) | `begin-work.test.ts` L671 covers only IN_PROGRESS at MAX | Promote |
| 10 | Redundant second CANCELLED call in the halted sweep | P04 Deferred 3 (P03 Follow-up 5) | `cancelled_ids` is scoped to the PM intercept block (`supervisor.py` L704); the sweep (L834) reads the iteration-start `wp_summaries` snapshot | Promote |
| 11 | Live-LLM tests fail instead of skipping | P04 Deferred 4 (P03 Follow-up 6) | `live` marker documented as "skipped by default" (`tests/README.md` L161, `test_integration.py` L28) but no hook implements it; a set-but-invalid key makes `test_developer_stage_live` / `test_pm_stage_live` fail (401) | Promote |
| 12 | Derive `REWORK_LIMIT` in the orchestrator integration test | P04 Deferred 5 (P03 Follow-up 7) | `test_integration.py` L53–L54: `REWORK_LIMIT = 3` with comment "Mirrors the MCP server's MAX_REWORK_COUNT". The manifest value is **5**, so the mirror is already wrong | Promote |
| 13 | Stale hardcoded test count in `orchestrator/README.md` | P04 Deferred 6 (P03 Follow-up 8) | L376 says "1107 tests". There are two more stale counts in `orchestrator/docs/agents/project-manifest/README.md` (L15, L116: "374 tests") | Promote, all three sites |
| 14 | Tidy `as any` casts and duplicated describe setup in `rework-limit.test.ts` | P04 Deferred 7 (P03 Follow-up 9) | Still present (L46–L58 vs L171–L184; `as any` at L70, L78, L84, L163, L199, L205, L229) | Promote |
| 15 | Halted sweep's direct synthesis route | P04 Deferred 8 (P03 Deferred 1) | Owned by the pending plan P05 (`docs/agents/plans/2026-10-06-p05-headless-pm-review-actions/plan.md`, rejected row L158) | Keep deferred |
| 16 | GUI control for editing stage lists | P04 Out of Scope + rejected row | Needs an authorisation model the GUI lacks | Keep deferred |
| 17 | Mutating other creation-time WP fields; server-side security-surface validation; `rework_counts` adjustment / auto-reopen in `ledger_update_pipeline_stages`; Doctor legacy recommendation | P04 Out of Scope | These are design decisions recorded in P04 and spec §21.75, not deferred work | Not carried |
| 18 | Belated security audit of the incident project | P04 Human Action 3 | Needs the user's choice of project | Human action (unchanged) |
| 19 | `agent_role` is self-declared across PM-only tools | P04 synthesis, Security note | A repo-wide trust model; flagged "not actionable" | Not carried |

## Area: MCP tool registration and startup log

### Verified References
- `mcp-server/src/index.ts` L9–L20: twelve namespace imports of tool modules. L82–L97: twelve sequential `xTools.register(server)` calls preceded by a NOTE comment (L82–L84). L167–L172: second NOTE comment plus the hand-maintained `console.error('[project-ledger-mcp] Registered tools: …')` literal listing 33 names.
- Tool modules exporting `register(server: McpServer): void`: `project-lifecycle.ts` L990, `work-package.ts` L1188, `work-package-admin.ts` L642, `pipeline.ts` L880, `begin-work.ts` L294, `observations.ts` L218, `workflow.ts` L27 (aggregator that calls `workflow-next-action.ts` L1899 and `workflow-handoff.ts` L1442), `help.ts` L70, `ping.ts` L89, `knowledge.ts` L502, `repository-context.ts` L310, `standalone-import.ts` L551.
- 33 tools are registered in total (via `registerTool(` followed by the name literal).
- `mcp-server/tests/startup/tool-log-sync.test.ts` (65 lines): it regex-extracts the `Registered tools:` literal from `index.ts`, regex-scans `src/tools/*.ts` (excluding `help-content.ts`) for `server.registerTool('name'`, and diffs the two sets.
- `mcp-server/tests/tools/schema-integrity.test.ts`:
  - L19–L29 import 11 `register` functions; `ping.ts` and `standalone-import.ts` are missing. It uses `workflow-handoff.ts`/`workflow-next-action.ts` directly instead of `workflow.ts`.
  - L32–L42: mock server capturing `inputSchema`.
  - L44–L56: `beforeAll` with its own call list.
  - L59–L98: hand-written `EXPECTED_TOOL_NAMES` (30 names).
  - L102–L134: count, presence and "non-empty `properties`" assertions.
  - L136–L196: numeric-helper field-type assertions.
- `mcp-server/src/tools/ping.ts` L14: `PingSchema = z.object({})`. Its JSON Schema `properties` is legitimately empty, so the "non-empty properties" proxy cannot be applied to it unmodified.

### Established Patterns
- Mock `McpServer` intercept pattern for metadata tests — `mcp-server/docs/agents/project-manifest/constraints-testing.md` § "Mock `McpServer` Intercept Pattern for Tool Metadata Tests" (L169+), canonical usage in `schema-integrity.test.ts`.
- Tool Registration Pattern (module per category, `register(server)` export) — `mcp-server/docs/agents/project-manifest/tech-stack.md` § 6 (L147–L162).
- Plain-function modules for stateless helpers — insight `f389f9ce-…`, `tech-stack.md`.

### Structural Observations
- `src/index.ts`: the module list and the startup tool list are both hand-maintained, and they are kept in sync with each other only by a source-text regex test.
- `schema-integrity.test.ts`: a third hand-maintained list (modules) and a fourth (tool names), and both have already drifted (3 tools uncovered).
- `index.ts` NOTE comment L167–L169 says "dynamic generation is not currently possible" because the SDK has no `listTools()`. Names can still be captured at registration time by wrapping `registerTool`.

### Constraints
- `stdout` is reserved for MCP protocol; all logs go to `stderr` (`index.ts` L101).
- The startup log line format `[project-ledger-mcp] Registered tools: a, b, …` is documented in `mcp-server/docs/agents/project-manifest/constraints.md` § "Server Version Displays at Startup" (L468–L480) and should keep its shape.

## Area: Tool help content

### Verified References
- `mcp-server/src/tools/help-content.ts` (1366 lines):
  - `TOOL_HELP: Record<string, string>` at L13.
  - Overview table L22–L56 lists 32 tools (no `ledger_detect_project`, no `ledger_help`). It includes rows for the four PM-only tools (L35–L38).
  - Body entries exist for every registered tool **except** `ledger_reset_rework_count`, `ledger_reopen_cancelled_wp`, `ledger_update_acceptance_criteria`, `ledger_detect_project` and `ledger_help` (computed by diffing `TOOL_HELP` keys against registered names).
  - `ledger_update_pipeline_stages` entry L407–L473 is the detail bar: Required Parameters (using the shared `CWD_PATH_PARAM`/`PROJECT_PATH_PARAM` constants, L8–L11), ordered Guards, Recovery Sequence, Caveat, Response Shape, JSON Example.
- `mcp-server/src/tools/help.ts`: returns `TOOL_HELP['overview']` with no `tool_name`, else `TOOL_HELP[name]`, else an "Unknown tool" message listing available keys.
- Source material for the missing entries:
  - `mcp-server/docs/agents/project-manifest/api-surface.md` L108–L123 (`ledger_detect_project`), L321 (`ledger_reset_rework_count`), L341–L370 (`ledger_reopen_cancelled_wp`), L371+ (`ledger_update_acceptance_criteria`).
  - Schemas in `mcp-server/src/tools/work-package-admin.ts` L46–L56, L168–L176, L320–L342.
  - `DetectProjectSchema` in `mcp-server/src/tools/project-lifecycle.ts` L32.
- `mcp-server/tests/tools/knowledge-help.test.ts`: per-tool presence + `# name` heading assertions for the knowledge tools, `ledger_get_repository_context` and `ledger_update_pipeline_stages`. There is no completeness test across all registered tools.

### Established Patterns
- Per-tool help body: `# tool_name` heading, `## Required Parameters` using shared param constants, guards/notes, `## Example` JSON — `help-content.ts` L407–L473.

### Structural Observations
- No test ties `TOOL_HELP` to the registered tool set. That is why four tools lack entries and one lacks an overview row.

### Constraints
- None beyond keeping `help-content.ts` a data-only module (excluded from the tool-log source scan, `tool-log-sync.test.ts` L18).

## Area: PM role guard

### Verified References
- `mcp-server/src/utils/pm-role-guard.ts` (39 lines): `requirePmRole(toolName: string, agentRole: string)`. It returns `null` for exactly `'Project Manager'`, else `{ content: [{ type: 'text', text: \`Error: ${toolName} is a PM-only tool. You are: ${agentRole}\` }], isError: true }`.
- Call sites: four tools in `mcp-server/src/tools/work-package-admin.ts`. There is no `mcp-server/tests/utils/pm-role-guard.test.ts`. Existing utils tests live in `mcp-server/tests/utils/` (e.g. `if-defined.test.ts`, `wp-id.test.ts`).

### Established Patterns
- Utility unit tests in `mcp-server/tests/utils/{module}.test.ts`.

### Structural Observations
- `requirePmRole` accepts only `'Project Manager'`. The CANCELLED transition in `updateWorkPackageStatus` (`work-package.ts`) also accepts `'Project Manager Agent'` (P05 research brief, L46). The asymmetry predates P04 and is outside this plan's files.

### Constraints
- Behaviour must be pinned as-is (a test, not a change).

## Area: Pipeline start path

### Verified References
- `mcp-server/src/tools/pipeline.ts` `startPipeline` L140–L300. Inside `store.updateWorkPackageWithSync`:
  - 0 active stages (L157–L159), 1 role / PM override (L161–L168), 2 `wp.status === 'IN_PROGRESS'` (L170–L175), 2b active-stage membership (L177–L184), 3 duplicate IN_PROGRESS (L186–L195).
  - 4 prerequisite via `resolvePrerequisite` ignoring `auto_cancelled` (L197–L208), 4b `checkRevalidationGuard` (L210–L216).
  - 5 new pipeline object (L218–L224), 6 rework increment (L226–L241), 6b circuit breaker with persist-on-trip and `breakerMessage` (L243–L261).
  - 7 append + `assigned_to` from `PIPELINE_AGENT_MAP` incl. root summary (L263–L276), 8 `root.last_updated` (L278–L279).
  - `breakerMessage` is thrown after the lock (L284–L286).
- `mcp-server/src/tools/begin-work.ts` `beginWork` L58–L285: the claim phase (L78–L141, READY → IN_PROGRESS with CLAIMABLE_ROLES, assignment, dependency and transition guards; IN_PROGRESS re-entry check) is followed by a start phase (L143–L238). The start phase duplicates the chain above except:
  - It runs the duplicate check before the active-stage check.
  - It has no status check (the claim phase guarantees IN_PROGRESS).
  - Its error texts are identical. There is also a trivial difference in the `rework_counts` spread (`?? {}`).
- Shared helpers already in `mcp-server/src/utils/workflow-helpers.ts`: `MAX_REWORK_COUNT` (L37), `hasDownstreamFail` (L191), `checkRevalidationGuard` (L214).
- `mcp-server/tests/tools/start-path-parity.test.ts` (169 lines): a scenario table run through both tools, asserting the same `isError` and persisted `rework_counts`. Its header says "maintain two copies of the start-guard chain".
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md`:
  - L357–L373 "Pipelines Can Only Be Started for an Active Stage" — "implemented twice", plus a "Divergence between the two start paths" paragraph.
  - L245 `isPipelineOwner` enforcement in `beginWork()`.
- `mcp-server/docs/agents/project-manifest/api-surface.md` L474–L476: circuit breaker and revalidation guard notes.
- Spec: `mcp-server/docs/agents/workflow-specification/edge-cases.md` L828 ("`ledger_begin_work` on a READY WP claims first and then applies the guard chain") — remains true after extraction.

### Established Patterns
- Pure guard helpers returning a value instead of throwing (`checkRevalidationGuard` → `string | null`) — `workflow-helpers.ts` L214.
- Capture-outside-the-updater for post-lock results (`claimed`, `breakerMessage`) — `begin-work.ts` L71–L74, `pipeline.ts` L153.

### Structural Observations
- `pipeline.ts` / `begin-work.ts`: ~90 lines of guard logic duplicated, with one ordering difference, pinned only by a parity suite.

### Constraints
- All error texts are asserted in tests (`start-pipeline-guards.test.ts`, `begin-work.test.ts`, `rework-circuit-breaker.test.ts`). They must stay byte-identical.
- Persist-on-trip semantics (§21.74) must be preserved: a trip from below persists the counter (and, for `beginWork`, the claim); a stored count already at MAX writes nothing.

## Area: Start-path and rework-limit tests

### Verified References
- `mcp-server/tests/tools/begin-work.test.ts` L605–L683 `describe('beginWork — circuit breaker persists the trip')`:
  - READY at MAX−1 (L638).
  - IN_PROGRESS at MAX−1 (L657).
  - IN_PROGRESS at MAX writes nothing (L671).
  - **No READY-at-MAX case.**
- `mcp-server/tests/integration/rework-limit.test.ts` (247 lines):
  - Two describes with identical `tempDir`/`store`/`originalArgv` `beforeEach`/`afterEach` blocks (L46–L58, L171–L184).
  - `as any` on `type` (L70, L78), the completePipeline args object (L84), the synthesis args (L163), the seeded WP (L199), the summary entry (L205) and the completePipeline args (L229).
- `mcp-server/tests/helpers/` holds `create-temp-store.ts`, `fixtures.ts`, `test-utils.ts`.

### Established Patterns
- Temp-ledger setup via `mkdtemp` + `--ledger-dir` argv push — the same block in both test files.

### Structural Observations
- `rework-limit.test.ts`: the duplicated setup and loose casts noted by P03's Reviewer.

### Constraints
- None.

## Area: CTX generation command

### Verified References
- `scripts/cli.js` (1287 lines, ESM):
  - `cmdCtxGenerate(args)` L556–L585: `rmSync('.context')` **first**, then `spawnSync('ctx', ['generate', ...args])`. On non-zero it logs and `process.exit`s, leaving `.context/` deleted. Then `normalize-ctx-paths.js .context`, `generated-at.txt`, and an `AGENTS.md → CLAUDE.md` sync with a header.
  - `cmdBuildMaintain(args)` L499–L511 calls `cmdCtxGenerate(args)` with its **own** args (e.g. `--suite …`), which `ctx` rejects after the clean.
  - Menu entry `ctx-generate` L1151–L1157.
  - `cli.js` runs `createMenu(...)` at top level, so its `cmd*` functions are not importable. Coverage is static source assertions (`scripts/tests/cli-cmd-agent.test.js` L1–L60, `extractFunctionBody`).
- `ctx generate --help` (installed at `/usr/local/bin/ctx`): `-w, --work-dir` sets the output directory (default `./.context`). Verified in a scratch copy: `ctx generate -w <dir>` exits 0, writes all documents into `<dir>`, and creates no `./.context`. An unknown flag (`--check`) exits 255.
- `scripts/normalize-ctx-paths.js` takes the target directory as `argv[2]`.
- `scripts/lib/mcp-dist-freshness.js` header (L1–L25): the "structured result, caller owns the exit" pattern with injected `spawn`.
- Root scripts tests: `scripts/tests/*.test.js` (Vitest, `npm test` from the workspace root).
- `.githooks/pre-commit` L56–L62: an advisory "source changed but `.context/` not staged" warning (staged-file heuristic only).
- Docs mentioning the command:
  - `AGENTS.md` L167, L435, L461 (`CLAUDE.md` is generated from it).
  - `docs/references/development.md` L79.
  - `docs/references/menu-guide.md` L80, L119.
  - `docs/agents/project-manifest/README.md` L138, L167.

### Established Patterns
- Extract testable logic into `scripts/lib/` with dependency injection — `scripts/lib/mcp-dist-freshness.js`, `scripts/lib/build-checks.js`; insight `e832d2f4-…`.
- Static source assertions for `cli.js` wiring — `scripts/tests/cli-cmd-agent.test.js`.

### Structural Observations
- `cmdCtxGenerate`: a destructive step ahead of validation and ahead of generation. A failed or interrupted `ctx` run leaves the tracked `.context/` deleted.
- `cmdBuildMaintain`: forwards build arguments to an unrelated tool.

### Constraints
- Cross-Platform Policy (root `AGENTS.md`): Node built-ins only, `path.join`, `shell: IS_WIN` for spawning `ctx`, temp dirs via `os.tmpdir()`.
- `.context/` is tracked in VCS. `CLAUDE.md` is regenerated from `AGENTS.md` by this command.

## Area: Orchestrator supervisor halted sweep

### Verified References
- `orchestrator/src/supervisor.py` (897 lines):
  - `_cancel_wp` L162, `_query_next_action` L176, `_handle_rework_limit(…, cancelled_ids: set[str], …)` L198–L297 (skips an ID already in the set at L246, adds at L253).
  - Iteration-start snapshot `wp_summaries` L495–L499; `cf` consecutive failures L360.
  - Role loop L693+: the PM intercept creates `cancelled_ids: set[str] = set()` **inside** the `if role == _PM_ROLE and action in _SUPERVISOR_OWNED_ACTIONS` block (L703–L723).
  - All-WAIT fall-through halted sweep L828–L870: it iterates `wp_summaries` (iteration-start statuses) and cancels any non-terminal WP with `cf >= 3`. It does not know about cancellations made earlier in the same iteration.
- Tests: `orchestrator/tests/test_supervisor.py` (class `TestReworkLimitCancellation`, per P05 brief L90).
- Pending plan P05 (`docs/agents/plans/2026-10-06-p05-headless-pm-review-actions/plan.md`):
  - Replaces `_handle_rework_limit` with a registry executor that keeps "per-iteration handled set" semantics (L68–L70, L201–L206).
  - Leaves the sweep's synthesis route unchanged (L158).
  - Instructs locating code by function, not line (L241).

### Established Patterns
- Per-iteration handled-ID set — `_handle_rework_limit` (`supervisor.py` L246–L253).

### Structural Observations
- The handled set's scope is narrower than the iteration, so the sweep re-cancels a WP the intercept already cancelled (harmless ledger error, swallowed at L863–L869, but a redundant call and a misleading WARNING).

### Constraints
- The supervisor must stay LLM-free (orchestrator `constraints.md` §4, cited in P05 L122).
- P05 must still find `_handle_rework_limit` and the PM intercept by name.

## Area: Orchestrator config constants and tests

### Verified References
- `orchestrator/src/config.py`:
  - `_load_workflow_manifest()` L40, `_MANIFEST` L64.
  - Manifest-derived constants: `PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`, `FAIL_ROUTING_AGENT_MAP`, `NEXT_STAGE_MAP`, `PIPELINE_TYPES`, `ROLE_IDS`, … (L76–L160).
  - **No** export of `constants.max_rework_count`.
- `shared/workflow-manifest.json` L130–L135: `constants.max_rework_count: 5`.
- `orchestrator/tests/test_integration.py` L53–L54 `REWORK_LIMIT = 3`, used at L127/L133 (ScriptedLedger threshold + payload) and L767 (fixture count).
- Live tests:
  - `orchestrator/tests/test_deep_agent_integration.py` `_resolve_live_model()` L909–L948 skips only when **no** key is set or the provider package is missing. Live tests: `test_developer_stage_live` L977–L978 and `test_pm_stage_live` L1067–L1068.
  - `orchestrator/tests/test_integration.py` `test_live_happy_path_with_real_mcp` L953 (skeleton, skips on no key).
  - `orchestrator/pyproject.toml` `[tool.pytest.ini_options]` registers markers `integration`, `live`, `deepagent`, with **no** `addopts` deselection.
  - `orchestrator/tests/conftest.py` holds config stubs only, with no collection hooks.
  - P03 synthesis L21: both live tests failed with 401 on an invalid key in a default run.
- Docs: `orchestrator/tests/README.md` L157–L163 (marks table: live "skipped by default"), `orchestrator/README.md` L514, L529, L560–L562.
- `scripts/preflight-orchestrator.js` L228–L280: `checkAnthropicKey` (`GET https://api.anthropic.com/v1/models`) and `checkGoogleKey` (`GET https://generativelanguage.googleapis.com/v1beta/models?key=…`) validate keys without consuming tokens. They are the existing precedent for a no-token credential probe.
- `scripts/cli.js` `cmdOrchestratorTests` L876–L903: `--live`, or answering "y", selects `-m "integration or deepagent or live"`. That is how live tests get selected with whatever key is in `orchestrator/.env`, which explains the 401 failures in P03.

### Established Patterns
- Manifest-derived module constants in `config.py` (single source of truth: `shared/workflow-manifest.json`).
- Test helpers in `orchestrator/tests/helpers/` (`fake_chat_model.py`, `mock_tools.py`).

### Structural Observations
- `test_integration.py`: a "mirror" constant that has silently diverged from its source (3 vs 5).
- The live marker's documented default ("skipped") is not implemented.

### Constraints
- Python 3.11+, stdlib-first. No new dependency for a credential probe (`urllib.request`).
- Cross-platform: no shell utilities.

## Area: Documentation and versions

### Verified References
- Stale counts: `orchestrator/README.md` L376 ("1107 tests"); `orchestrator/docs/agents/project-manifest/README.md` L15 and L116 ("374 tests").
- `orchestrator/docs/agents/project-manifest/file-tree.md` L75 describes the live tests as "skip gracefully when no API key is set".
- mcp-server manifest rows to update:
  - `file-tree.md` L232 (tool-log-sync description), L270–L272 (schema-integrity, start-path-parity).
  - `tech-stack.md` § 6 L147–L162.
  - `constraints-workflow.md` L357–L373.
  - `constraints-testing.md` L169+.
  - `constraints-code-style.md` L256.
  - `constraints.md` L468–L480.
  - `api-surface.md` (tools section, `_internal` sections, help).
- Current versions:
  - mcp-server v2.13.0 (`mcp-server/changelog.md`, `package.json`).
  - orchestrator v1.5.0 (`orchestrator/changelog.md`, `pyproject.toml`).
  - personas v3.39.0.
  - root v2.16.0 (unreleased; the latest tag is `2.14.1`).
  - Spec v2.9.0, last edge case §21.75.
- Root `AGENTS.md` Changelog Convention: module changelogs first, then the root entry with a `> mcp vX · orchestrator vZ` line. `node scripts/cli.js build-maintain` syncs the root and orchestrator versions; `scripts/check-version-sync.js` validates them.
- P05 numbering rule (P05 plan L242): versions are read at execution time, so a bump here does not conflict.

### Constraints
- House style: flat bullets, category prefixes, ≤ 100-char lines.

## Strategic Context

- Strategic vision (ledger): short-term low-friction setup and daily use; long-term secondary goal is reliability on all three OSes and in the headless orchestrator workflow. A non-destructive `ctx-generate`, live tests that skip correctly, and a correct halted sweep all serve that reliability goal.
- Prior projects: P01–P04 are complete. P05 (headless PM review actions) is planned but not executed, and it touches `supervisor.py` around the same intercept.
- Insights consulted:
  - `a7adbb64-4f57-42ac-9b27-25913bde3815` (ctx-generate destructive `--check`): overtaken by this plan.
  - `f389f9ce-…` (plain-function modules).
  - `e832d2f4-…` (extract build-time logic into `scripts/lib/` for testability).
  - `d56f4e19-…` (derive validation from the same data the runtime uses — applies to the registry-derived tests and the manifest-derived `MAX_REWORK_COUNT`).
  - `48607cdb-…` (test guards with a synthetic failure fixture).
  - `53454e24-…` (run ctx generate after manifest edits — still valid; the command name is unchanged).
  - `b37db114-…` (true dry-run by replaying the real code path — informs the `--check` design).
