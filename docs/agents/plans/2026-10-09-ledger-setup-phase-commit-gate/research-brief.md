# Research Brief

## Scope Sketch

- Workflow specification — `mcp-server/docs/agents/workflow-specification/` — modification (spec-first per root `AGENTS.md` → "Change workflow logic")
- Shared workflow manifest — `shared/workflow-manifest.json`, `shared/workflow-manifest.schema.json`, `scripts/validate-workflow-manifest.js`, `mcp-server/src/schema/workflow-manifest-schema.ts` — modification
- MCP server schema & enums — `mcp-server/src/schema/` — modification
- MCP server storage — `mcp-server/src/storage/ledger-store.ts` — modification
- MCP server tools (lifecycle, WP, pipeline, routing, help) — `mcp-server/src/tools/` — modification + new code
- MCP server utils — `mcp-server/src/utils/` — new code + extraction
- MCP server startup — `mcp-server/src/index.ts` — modification
- GUI (server handlers + browser views) — `mcp-server/gui/` — modification
- Orchestrator — `orchestrator/src/` — modification
- Personas — `personas/ledger/src/`, `personas/ledger-support/src/` — modification
- Documentation & manifests — `mcp-server/docs/agents/project-manifest/`, `mcp-server/gui/docs/agents/project-manifest/`, `orchestrator/docs/`, root `AGENTS.md`, module changelogs — modification
- Tests — `mcp-server/tests/`, `orchestrator/tests/` — new + modification

## Area: Incident evidence

### Verified References
- `/Users/smordziol/Webserver/tools/ledger-storage/store/composer-local-switcher/2026-10-08-switch-output-and-version-guard/project-ledger.json`: 11 WPs. WP-009 (`CANCELLED`, title "Change-origin classifier defects", deps `["WP-005","WP-007"]`) duplicates WP-008 (same title, deps `["WP-004","WP-007"]`). WP-011 (`CANCELLED`, "Documentation, manifest updates and verification gate") duplicates WP-010 (same title and deps). Titles are exact duplicates — an exact (normalized) title comparison detects both.

### Constraints
- Persona guards already uncommitted in the STABLE working tree (`git status`): `personas/ledger/src/content/2-project-manager.md` (3.12.1), `personas/ledger-support/src/content/ledger-bootstrapper.md` (1.5.0). The plan builds on these versions.
- Duplicate-title rejection in `ledger_create_work_package` is in flight (user). Not present in STABLE or DEV `mcp-server/src` (grep for duplicate/normalize title found nothing).

## Area: Workflow specification

### Verified References
- `mcp-server/docs/agents/workflow-specification/README.md` (L1–L30): spec **Version 2.6.0**, changelog per version; L164–L176 "Machine-Readable Vocabulary" table maps `statuses.*` → `src/schema/enums.ts`.
- `mcp-server/docs/agents/workflow-specification/state-machines.md` (L7–L52): §5.1 Initialization creates root index with `status = READY`; §5.2 Project Status Values (READY, IN_PROGRESS, COMPLETE, BLOCKED); §5.3 "Project transitions to IN_PROGRESS when first WP is claimed".
- `state-machines.md` (L66–L140): §6.2 WP transition table; `READY/IN_PROGRESS/BLOCKED/COMPLETE → CANCELLED` PM-only; CANCELLED terminal, `ledger_reopen_cancelled_wp` bypass.
- `mcp-server/docs/agents/workflow-specification/auxiliary-systems.md` (L7–L51): §17.2 healing rules 1–6c keyed on READY/IN_PROGRESS/COMPLETE/BLOCKED; "Completeness note" states implementations that extend the status model MUST add corresponding healing rules.
- `mcp-server/docs/agents/workflow-specification/dependencies-and-rework.md` (L56–L58): §15.2 "Deliberate limitation — no post-creation dependency updates" offers workaround "(a) cancel WP-005 and recreate it with the correct dependencies".
- `mcp-server/docs/agents/workflow-specification/operations.md`: §9b Work Package Creation (L7), §10 Claiming (L197), §10b Status updates (L259), §11 Starting a Pipeline (L436), §12 Completing (L646).
- `mcp-server/docs/agents/workflow-specification/handoff.md` (L15–L24): Planner handoff (`READY_FOR_PM` when no WPs, else WAIT); (L290–L330) PM handoff pseudocode.
- `mcp-server/docs/agents/workflow-specification/edge-cases.md`: last section §21.72 (L777); §21.51 "Work Package Creation on a COMPLETE Project" (L435); §21.9 Summary ↔ Detail consistency (L83).
- `mcp-server/docs/agents/workflow-specification/data-model.md`: §3.1 Project (Root Index) (L24), §3.6 WP ID Format (L179).
- `mcp-server/docs/agents/workflow-specification/walkthrough.md`: mentions `ledger_initialize_project`.

### Established Patterns
- Every spec change gets a version bump and a README changelog entry listing touched sections — `README.md` v2.6.0 entry.
- New behaviours get a numbered edge-case section — `edge-cases.md` §21.72.

### Structural Observations
- `dependencies-and-rework.md` L58: the cancel-and-recreate workaround is phrased phase-agnostically; with a setup phase it is wrong before commit.
- `state-machines.md` §5.3 says the project goes IN_PROGRESS on first claim, but `createWorkPackage` flips READY → IN_PROGRESS on first WP *creation* (`mcp-server/src/tools/work-package.ts` L433–L436). Spec and implementation already disagree.

## Area: Shared workflow manifest

### Verified References
- `shared/workflow-manifest.json` (L3): `"spec_version": "2.6.0"`; (L122–L128) `statuses.project = ["READY","IN_PROGRESS","COMPLETE","BLOCKED"]`, `work_package`, `terminal_work_package`, `pipeline`, `blocker_type`.
- `shared/workflow-manifest.schema.json` (L116–L135): `statuses` object, `required: [project, work_package, terminal_work_package, pipeline, blocker_type]`, `additionalProperties: false`.
- `scripts/validate-workflow-manifest.js` (L208–L222): requires the five status arrays non-empty; checks `terminal_work_package ⊆ work_package`.
- `mcp-server/src/schema/workflow-manifest-schema.ts` (L78): `statuses: StatusesSchema` — Zod mirror of the JSON schema.
- `mcp-server/src/utils/constants.ts` (L125): `SPEC_VERSION = workflowManifest.spec_version`.
- `orchestrator/src/config.py` (L159–L163): `WP_TERMINAL_STATUSES = frozenset(_MANIFEST["statuses"]["terminal_work_package"])`.

### Established Patterns
- Derived-subset key: `terminal_work_package` is a manifest key validated as a subset of `work_package`, consumed by TS (`isTerminalStatus` docs) and Python (`WP_TERMINAL_STATUSES`) — `shared/workflow-manifest.json`, `orchestrator/src/config.py`.

### Constraints
- Root `AGENTS.md`: status enums derive from the manifest; it is the single source of truth.

## Area: MCP server schema & enums

### Verified References
- `mcp-server/src/schema/enums.ts` (L23–L27): `ProjectStatus = z.enum([...statuses.project, 'ARCHIVED'] as unknown as ['READY','IN_PROGRESS','COMPLETE','BLOCKED','ARCHIVED'])` — tuple cast must list every literal.
- `mcp-server/src/schema/root-index.ts` (L36–L57): `RootIndexSchema` — `status: ProjectStatus`, optional fields (`synthesis_generated_at`, `project_summary`, `title`, `ledger_version`, runner fields). No setup timestamp exists.
- `mcp-server/src/schema/project-meta.ts` (L4–L32): `ProjectMetaSchema.status: ProjectStatus` (mirrors root status via `writeRootIndex()` auto-sync).
- `mcp-server/src/schema/validators.ts` (L13–L15) `isTerminalStatus`; (L36–L64) `isValidStatusTransition`; (L73–L106) `canStartWorkPackage`.

## Area: MCP server storage

### Verified References
- `mcp-server/src/storage/ledger-store.ts` (L109–L141): `LedgerStore` — `storageDir = {ledgerRoot}/{repoName}/{slug}`; root at `project-ledger.json`; WP detail at `{storageDir}/{wpId}.json`.
- `ledger-store.ts` (L284–L327): `writeRootIndex()` validates with `RootIndexSchema`, atomically writes, auto-syncs `.meta.json` (status, counters, progress, runner, summaries, title).
- `ledger-store.ts` (L359–L397): `updateWorkPackageWithSync(wpId, updater(wp, root))` — under `withLock`, reads both, writes both, syncs meta.
- `ledger-store.ts` (L417–L455): `createWorkPackageWithSync(creator(root))`.
- `ledger-store.ts` (L483–L540): `batchUpdateWorkPackagesWithSync(callback(root, readWp))` — two-pass validate-then-write.
- `ledger-store.ts` (L339–L344): `writeWorkPackage` is internal-only (JSDoc says no external callers).
- Callers of the two update sync methods outside storage (grep): `src/tools/begin-work.ts` (1), `src/tools/observations.ts` (1), `src/tools/pipeline.ts` (5), `src/tools/work-package.ts` (10), `src/utils/project-reset.ts` (4) — 21 total.
- No WP-file deletion method exists in `LedgerStore` (grep for `unlink`/`rm` in `src/storage/` hits only `atomic-writer.ts` temp cleanup and `migrate-namespaced.ts`).

### Established Patterns
- All WP + root writes go through a `*WithSync` method under one lock — `ledger-store.ts` JSDoc of `writeWorkPackage`.
- Tool-level atomic multi-read/write uses `withLock(store.storageDir, …)` directly — `completeSynthesis` in `mcp-server/src/tools/project-lifecycle.ts` (L838–L929).

### Structural Observations
- Every WP-mutating tool goes through `updateWorkPackageWithSync` or `batchUpdateWorkPackagesWithSync`. These two methods are the only choke point where a phase guard can cover all 21 call sites and any future tool without a hand-maintained list.

## Area: MCP server tools

### Verified References
- `mcp-server/src/tools/project-lifecycle.ts` (L560–L725): `initializeProject` — writes root with `status: 'READY'` (L674) and meta `'READY'` (L692); rejects stale server (`readPackageVersion() !== SERVER_VERSION`, L624–L637) and existing ledger.
- `project-lifecycle.ts` (L132–L257): `computeHealedStatus(rootIndex)` — pure; rules keyed on the four statuses; a status matching no rule is preserved unchanged.
- `project-lifecycle.ts` (L733–L737): `ListProjectsSchema.status` uses `WorkPackageStatus` (allows `CANCELLED`, lacks `ARCHIVED`) — wrong enum for a project filter.
- `project-lifecycle.ts` (L822–L960): `completeSynthesis` — guards: role, ≥1 WP, no pending WPs; sets `COMPLETE`.
- `project-lifecycle.ts` (L341–L520): `getProjectStatus` — self-heals, returns root + `pipeline_health`.
- `mcp-server/src/tools/work-package.ts` (L203–L236): `CreateWorkPackageSchema`; (L245–L257) private `hasCycle(newId, deps, allWps)`; (L259–L475) `createWorkPackage` — max-based ID generation (L307–L312), dependency existence check, cycle check, initial READY/BLOCKED, `validateActiveStages`, sets project `READY → IN_PROGRESS` on create (L433–L436).
- `work-package.ts` (L506–L620): `claimWorkPackage` via `updateWorkPackageWithSync`.
- `work-package.ts` (L665+): `updateWorkPackageStatus`; (L1001) `propagateDependencyUnblock`; (L1074) `propagateDependencyReblock`; (L1205) `resetReworkCount`; (L1333) `reopenCancelledWp`; (L1506) `updateAcceptanceCriteria`; (L1614–L1686) `register()`.
- `mcp-server/src/tools/begin-work.ts` (L59): `beginWork`; registered as `ledger_begin_work` (L279).
- `mcp-server/src/tools/pipeline.ts` (L139 `startPipeline`, L363 `completePipeline`, L687 `cancelPipeline`, L763 `updatePipelineProgress`); registrations L819–L847.
- `mcp-server/src/tools/workflow-next-action.ts` (L53–L62): `NEXT_ACTION_DISPATCH` map; (L118–L180) `getNextActionCore` — reads root, loads details, zero-WP branch returns `CREATE_WORK_PACKAGES` for PM / `WAIT` (wrapped by `embedHandoffStatusInWait`) for others; (L278–L281) batch branch `getNextActionsCollector` runs after the zero-WP check.
- `mcp-server/src/tools/workflow-handoff.ts` (L52–L70): `HANDOFF_DISPATCH`; (L88–L155) `getHandoffStatus` with an inline "all BLOCKED" short-circuit; (L1380–L1430) `computeHandoffStatus` fast path replicating the same short-circuit; (L279) `getPlannerHandoff`; (L478) `getProjectManagerHandoff`.
- `mcp-server/src/utils/constants.ts` (L60–L80): `READY_STATUS_FOR_ROLE` (PM → `READY_FOR_PM`), `HANDOFF_STATUS_ROLE`.
- `mcp-server/src/tools/help-content.ts` (L13+): `TOOL_HELP` record — overview table of all tools, Common Mistakes, Workflow Order.
- `mcp-server/src/utils/pipeline-maps.ts`: `validateActiveStages(stages) → { errors, warnings }`, `DEFAULT_PIPELINE_STAGES`.
- `mcp-server/src/utils/project-reset.ts`: GUI "Reset Project" diagnosis/apply (writes via `batchUpdateWorkPackagesWithSync`, sets project IN_PROGRESS/COMPLETE).
- `mcp-server/src/utils/workflow-helpers.ts`: `clearSynthesisState`.
- `mcp-server/src/schema/common.ts`: `positiveIntInput()` (string-tolerant positive integer).

### Established Patterns
- One tool module per concern exporting `register(server)` and `_internal` for tests — `src/tools/standalone-import.ts`, `src/tools/begin-work.ts`.
- Tool responses carry a `--- NEXT STEP ---` guidance block — `buildStatusTransitionGuidance` in `work-package.ts` (L40–L67).
- PM-only administrative tools take `agent_role` + mandatory `reason` and write an audit project comment — `ledger_reopen_cancelled_wp`, `ledger_reset_rework_count`.

### Structural Observations
- `hasCycle` is private to `work-package.ts`; a setup commit that re-validates the whole graph would otherwise duplicate it.
- The "all WPs BLOCKED" handoff short-circuit is duplicated verbatim in `getHandoffStatus` and the `computeHandoffStatus` fast path; a setup short-circuit would make it a third copy.
- `ListProjectsSchema.status` uses the WP status enum for a project filter.
- `createWorkPackage`'s READY → IN_PROGRESS flip on creation contradicts spec §5.3.

## Area: MCP server startup

### Verified References
- `mcp-server/src/index.ts` (L81–L95): tools registered via each module's `register(server)`; comment demands the log list be kept in sync manually.
- `index.ts` (L166–L171): hard-coded `console.error('[project-ledger-mcp] Registered tools: …')` string of 32 tool names; comment: "The MCP SDK does not expose a listTools() method at startup".

### Structural Observations
- The startup tool list is a hand-maintained list that every new tool must remember. All registrations go through `server.registerTool(name, …)`, so names can be recorded at registration time.

## Area: GUI

### Verified References
- `mcp-server/gui/api.ts` (L313–L315): `VALID_STATUS_FILTERS = new Set(['ACTIVE','ALL','READY','IN_PROGRESS','COMPLETE','BLOCKED','ARCHIVED','CANCELLED'])` — hand-maintained; contains `CANCELLED` (not a project status).
- `gui/api.ts` (L485–L490): `ACTIVE` = every status except `ARCHIVED`.
- `gui/api.ts` (L840–L910): archive requires `COMPLETE`; unarchive requires `ARCHIVED`.
- `gui/api.ts` (L1063+): `handleResetProject` → `project-reset.ts`; routed in `gui/server.ts` (L825).
- `mcp-server/src/gui/auto-archive.ts` (L54): archives only `COMPLETE`.
- `mcp-server/src/gui/errors.ts` (L8, L23): `ApiError(code, message, details?)`.
- `mcp-server/gui/public/views/project-list.js` (L330–L338): `buildStatusOptions` hand-maintained options (no `SETUP`).
- `mcp-server/gui/public/utils.js` (L52–L55): `statusBadge(status)` → `UI.badge(status, status)`; `components.js` (L42–L52) `badge(type,…)` → class `badge-{normalised type}`.
- `mcp-server/gui/public/styles.css` (L373–L398): `.badge-ready`, `.badge-in-progress`, `.badge-complete`, `.badge-blocked`, `.badge-archived` + theme tokens (L43, L165).
- `mcp-server/gui/public/views/project-detail.js` (L19, L222): `#project-status-badge`; (L694, L867) "Reset Project" button + handler.
- GUI manifest: `mcp-server/gui/docs/agents/project-manifest/` (README, api-surface, constraints, data-flows, file-tree, tech-stack, ui-components).

### Established Patterns
- Status rendering is data-driven by CSS class name — `components.js` `badge()`.

### Structural Observations
- `VALID_STATUS_FILTERS` duplicates the project status vocabulary by hand (and carries a non-project `CANCELLED`).
- `buildStatusOptions` duplicates it on the client side (browser JS cannot import the manifest).

## Area: Orchestrator

### Verified References
- `orchestrator/src/supervisor.py` (L50–L81): `_SKIP_ACTIONS`, `_DISPATCH_ACTIONS` (PM: `UNBLOCK_WP, REVIEW_REWORK_LIMIT, REVIEW_STALE, REVIEW_ABANDONED, REPAIR_ORPHAN_BLOCKED, ROUTE_PIPELINE_AGENT`); unknown actions treated as WAIT with warning.
- `supervisor.py` (L170–L360): reads `ledger_get_project_status` (first-iteration missing ledger → route PM), `ledger_list_work_packages`; builds `base_update` with `project_status` JSON.
- `supervisor.py` (L437–L534): no WPs → route PM (unbounded except by `max_iterations`); all WPs terminal → synthesis.
- `supervisor.py` (L539–L640): per-role `ledger_get_next_action`; first dispatchable wins.
- `supervisor.py` (L668–L748): all roles WAIT → cancel circuit-broken WPs (`ledger_update_work_package_status` → CANCELLED as PM) → synthesis.
- `orchestrator/src/state.py` (L80–L110): `WorkflowState` fields incl. `consecutive_failures`, `fatal_error`, `prev_wp_summaries`.
- `orchestrator/src/cli.py` (L965–L972): initial state dict (`iteration: 0`, `project_status: ""`, `consecutive_failures: {}`).
- `orchestrator/src/nodes/pm.py`: `_build_pm_prompt` renders `templates/pm.md` with `project_path`, `plan_file`, `extra` (plan content).
- `orchestrator/src/nodes/templates/pm.md`: `{{#if extra}}` conditional block — template supports conditionals.
- `orchestrator/src/nodes/__init__.py` (L892–L925): every stage receives all MCP tools (`tools=wrapped_tools`) — new MCP tools reach the Deep Agents PM automatically.
- `orchestrator/src/utils/tool_wrappers.py` (L100–L109): `_READ_ONLY_TOOLS`; WP guard inactive when stage has no `current_wp_id` (PM).
- `orchestrator/docs/supervisor-routing.md` (L11–L20): "Special Exits" tree; (L37+) standard routing.
- Tests: `orchestrator/tests/test_supervisor.py` (81 tests), `test_state.py`, `test_nodes.py`, `test_config.py`.

### Established Patterns
- Supervisor is pure Python, manifest-derived constants from `config.py` — `supervisor.py` header.
- Each special exit is logged with a `_log_entry(action=…)` and documented in `supervisor-routing.md`.

### Structural Observations
- If a PM stage ends with the project still in setup, the supervisor today would query next actions; a non-dispatchable response from every role falls through to synthesis, which fails because no WP is terminal. A setup project needs an explicit branch.
- PM re-routing on "no WPs" is unbounded except by `max_iterations`.

## Area: Personas

### Verified References
- `personas/ledger/src/content/2-project-manager.md` (L38–L42): "Important notes" — L42 "After creating the first work package, the project status is automatically set to `IN_PROGRESS`."
- `2-project-manager.md` (L96–L101): Strict Constraints — one Bootstrapper at a time; never resume or repair a partial bootstrap; never recreate a registered WP ("You have no tool to cancel one"); never write ledger files.
- `2-project-manager.md` (L192, L201): steps 9 and 10 justify running before the Bootstrapper because "a registered WP cannot be corrected" / "you have no tool to cancel it".
- `2-project-manager.md` (L202–L230): step 11 Bootstrapper dispatch (per-target conditionals incl. `target_deep_agents`), step 12 verify (stop on count mismatch), step 13 handoff partials.
- `personas/ledger/src/meta/2-project-manager.yaml` (L9–L54): integrated changelog, head 3.12.1; (L93–L105) `mcp_tools` table (ping, initialize, create, get_project_status, get_work_package — purpose text stale: "Step 10 to compare ledger AC against spec file", handoff).
- `personas/ledger-support/src/content/ledger-bootstrapper.md` (L74–L98): Step 2 initialize; "ledger already exists → ask the user"; (L100–L102) Step 3 stops on a ledger that holds WPs; (L158–L179) constraints: never reinitialize, never register into an occupied ledger, never correct after registering.
- `personas/ledger-support/src/meta/ledger-bootstrapper.yaml` (L9–L13): changelog head 1.5.0.
- `personas/ledger-support/src/content/ledger-claude-coordinator.md` (L90): dispatch-map row "Project Manager — Plan provided, needs WP decomposition"; (L107) null `assigned_to` → `ledger_get_next_action` as PM.
- `personas/ledger-support/src/content/ledger-doctor.md` (L96–L98, L132–L149, L363–L373): tool table, symptom list, WP state reference.
- `personas/changelog.md` (L3): `v3.39.0 - **WIP, UNRELEASED**` entry open.

### Established Patterns
- Per-target dispatch conditionals (`target_vscode` / `target_claude_code` / `target_deep_agents`) — `2-project-manager.md` step 5.
- Version and changelog live in the persona YAML `changelog` block; `personas/changelog.md` is summary-only — root `AGENTS.md` Changelog Convention rule 8.
- Generated output is never edited; rebuild via `scripts/build-personas.js`; `docs/agents-overview.md` regenerated when overview fields change.

### Structural Observations
- PM constraint "never recreate a registered WP — you have no tool to cancel one" becomes false once a setup reset tool exists; steps 9/10 rationale text likewise.
- PM `mcp_tools` purpose for `ledger_get_work_package` is stale (refers to a spec-file AC comparison removed in 3.8.0).
- The Bootstrapper's "ledger already exists → ask the user" branch would block re-registration after a setup reset.

### Constraints
- Persona changes only in `personas/*/src/`.

## Area: Documentation & manifests

### Verified References
- `mcp-server/docs/agents/project-manifest/`: `api-surface.md`, `constraints-workflow.md` (sections Status Transitions L30, Claiming L183, Work Package Creation L255, Pipelines L317, Handoffs L538), `data-flows.md`, `file-tree.md`, `constraints-storage.md`.
- `orchestrator/docs/agents/project-manifest/` (api-surface, constraints, data-flows, decisions, …), `orchestrator/docs/supervisor-routing.md`.
- `mcp-server/changelog.md` head `v2.12.0`; `orchestrator/changelog.md` head `v1.4.0`; `personas/changelog.md` WIP `v3.39.0`.
- Root `AGENTS.md` "Cross-System Dependencies" table; "Manifest Maintenance Rules"; Changelog Convention (module changelogs first; root entry at release).
- `scripts/check-version-sync.js` compares module changelog vs `package.json`; `npm run sync-version` in `mcp-server`.
- `.context/` regenerated by `node scripts/cli.js ctx-generate`.

## Area: Tests

### Verified References
- `mcp-server/tests/helpers/create-temp-store.ts` (`createTempStore`, `cleanupTempStore`), `mcp-server/tests/helpers/fixtures.ts` (`makeWorkPackageDetail`, `makePipeline`, `makeWorkPackageSummary`).
- Existing suites: `mcp-server/tests/tools/{project-lifecycle,list-projects,work-package,workflow-next-action,workflow-batch-actions,workflow-handoff}.test.ts`, `mcp-server/tests/storage/ledger-store.test.ts`, `mcp-server/tests/utils/workflow-manifest.test.ts` ("statuses" describe at L219), `mcp-server/tests/gui/{api,api-reset,client-rendering}.test.ts`, `mcp-server/tests/integration/full-workflow.test.ts`.
- Only 7 test files call `initializeProject` (`enrichment-resilience`, `multi-store-tool-resolution`, `project-lifecycle-multi-store`, `meta-enrichment`, `runner-integration`, `project-lifecycle`, `version-freshness`). Most suites write root indexes directly with `status: 'READY'`/`'IN_PROGRESS'` (e.g. `work-package.test.ts` L342–L533), so they remain valid as legacy (committed) projects.
- Root script tests live in `scripts/tests/` (e.g. `cc-tools-validation.test.js`); no dedicated `validate-workflow-manifest` test file exists.
- Orchestrator: `orchestrator/tests/helpers/mock_tools.py`, `fake_chat_model.py`; suites `test_supervisor.py`, `test_state.py`, `test_config.py`, `test_nodes.py`.

### Constraints
- Fixtures need `YYYY-MM-DD-name` plan-path basenames (insight `ab304b5b`); temp dirs via `os.tmpdir()`.

## Area: Additional documentation references

### Verified References
- `personas/ledger/README.md` (L24, L206, L448, L554): PM description, sub-agent section, "Have the Project Manager regenerate work packages" troubleshooting.
- `orchestrator/docs/jsonl-log-schema.md`, `orchestrator/docs/architecture.md` exist.
- `orchestrator/pyproject.toml` (L3) `version = "1.4.0"`; `scripts/check-version-sync.js` (L15, L48–L51) compares it with `orchestrator/changelog.md`.
- `scripts/generate-agents-overview.js` regenerates `docs/agents-overview.md` (supports `--check`).
- `mcp-server/docs/agents/project-manifest/constraints-storage.md` exists (storage conventions).

## Strategic Context

- Strategic vision (ledger): short-term friction-free use; long-term secondary goal "make the project as reliable as possible … operationally for the orchestrator headless workflow". A server-enforced setup gate directly serves headless reliability.
- Prior projects: P02 (`2026-10-08-p02-unfixable-verifier-chain-validation`) added a creation-time mechanical backstop derived from the manifest; P03 (`2026-10-09-p03-rework-limit-headless-completion`, DEV) persisted a refused state so headless loops terminate. DEV is ahead of STABLE (P03 reports spec v2.8.0); version numbers must be taken from changelog heads at implementation time.
- Insight `cdaf1471-5d14-4890-91d2-243a4a2c4896` ("Verify pipeline stage configuration immediately after WP creation — no tool exists to patch it later") recommends cancel-and-recreate before any stage starts — the exact pattern this plan replaces during setup.
- Insight `5e041ed3-319a-40db-8a06-d92ebd2ade1e` (persist the state a refusal implies; ship the consumer in the same release) — informs shipping the orchestrator setup branch together with the server gate.
- Insight `f32724d7-679f-4f77-9168-f24ab6e48b44` (one bounded remediation pass, then terminate) — informs the single PM re-entry bound.
- Insight `f389f9ce-86cc-4b4e-ac83-eb131fbdc29d` (plain-function modules for stateless helpers) — informs the shape of the new setup-phase utility.
- Insight `ab304b5b-a928-447e-a5e3-ba496adadfba` (LedgerStore requires `YYYY-MM-DD-name` plan paths in fixtures) — test-fixture constraint.
- Insight `53454e24-4329-4946-ab9f-3b94cd682f17` (regenerate `.context/` after manifest edits).
