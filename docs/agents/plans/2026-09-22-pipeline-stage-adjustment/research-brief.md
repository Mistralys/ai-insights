# Research Brief

## Scope Sketch

- **MCP tool surface (work package admin)** — `mcp-server/src/tools/` — new code + modification
- **Pipeline stage validation & routing** — `mcp-server/src/utils/pipeline-maps.ts`, `mcp-server/src/utils/workflow-helpers.ts` — read-only verification (no change expected)
- **Storage & schema** — `mcp-server/src/storage/ledger-store.ts`, `mcp-server/src/schema/` — read-only verification (no change expected)
- **Workflow specification** — `mcp-server/docs/agents/workflow-specification/` — modification (authoritative; must change first)
- **Project manifest (MCP server)** — `mcp-server/docs/agents/project-manifest/` — modification
- **Tests** — `mcp-server/tests/tools/`, `mcp-server/tests/startup/` — new code + modification
- **Personas (ledger + ledger-support)** — `personas/ledger/src/content/`, `personas/ledger-support/src/content/` + matching `src/meta/*.yaml` — modification
- **GUI** — `mcp-server/gui/api.ts`, `mcp-server/gui/public/views/work-package.js` — read-only verification (no change expected)
- **Orchestrator** — `orchestrator/src/` — read-only verification (no change expected)
- **Changelogs / versioning** — `mcp-server/changelog.md`, `personas/changelog.md`, root `changelog.md` — modification

---

## Area: The Incident Being Fixed

### Verified References

- `docs/agents/plans/2026-09-22-pipeline-stage-adjustment/request.md` (L1–L21): The request file, moved into the plan folder from `docs/agents/projects/`. WP-005 of a prior plan — the WP implementing credential redaction — was registered with the default 4-stage chain instead of the 5-stage chain including `security-audit` that its own `pipeline-configuration.md` prescribed. No MCP tool existed to patch `active_pipeline_stages`; a direct filesystem edit was blocked by the auto-mode permission classifier; the incident was logged `resolved: false` and the WP reached COMPLETE without an independent security audit. The user's ask: "add the possibility to make such adjustments, restricted to the relevant agents."

### Established Patterns

- Two failure surfaces are implicated, not one: the **remedy** (no mutation tool) and the **cause** (a stage list transcribed wrongly at registration with no parity check afterwards).

### Constraints

- The parity failure happens between `pipeline-configuration.md` (authored by the Pipeline Configurator) and `ledger_create_work_package` (called by the Ledger Bootstrapper). Both are persona-level artefacts — no server-side mechanism can compare them, because the MCP server never sees `pipeline-configuration.md`.

---

## Area: MCP Tool Surface — Work Package Admin

### Verified References

- `mcp-server/src/tools/work-package.ts` (L1–L31): imports — `LedgerStore`, `now()`, `resolveProjectPath`, `clearSynthesisState`, `resolveMultiStoreLedgerRoot`, pipeline-map helpers.
- `mcp-server/src/tools/work-package.ts` (L223, L361–L397): `CreateWorkPackageSchema.active_pipeline_stages`; `createWorkPackage` calls `validateActiveStages(args.active_pipeline_stages)`, rejects on `errors[0]`, surfaces `warnings` in the response, and resolves the stored value (validated stages, else `DEFAULT_PIPELINE_STAGES`) into **both** the WP detail (L397) and the root-index summary (L422).
- `mcp-server/src/tools/work-package.ts` (L1200–L1314): `ledger_reset_rework_count` — PM-only. Guard at L1218–L1226: `if (args.agent_role !== 'Project Manager') return { isError: true, … }`.
- `mcp-server/src/tools/work-package.ts` (L1320–L1470): `ledger_reopen_cancelled_wp` — PM-only, guard at L1335–L1345 (before any disk I/O). Inside `updateWorkPackageWithSync`: dependency-aware status selection via `canStartWorkPackage`, `wp.assigned_to = null`, `delete wp.rework_counts`, root summary sync, `root.pending_work_packages += 1`, `clearSynthesisState(root)`, an audit entry pushed onto `root.project_comments`, `root.last_updated = now()`. After the write: `propagateDependencyReblock(...)`.
- `mcp-server/src/tools/work-package.ts` (L1478–L1602): `ledger_update_acceptance_criteria` — PM-only, guard at L1515–L1525 (after path resolution). Operation-based (`remove`, `modify_text`), CANCELLED guard, clone-then-mutate, post-operation invariant check ("at least one criterion"), single `updateWorkPackageWithSync` call.
- `mcp-server/src/tools/work-package.ts` (L1612–L1686): `register(server)` — eleven `server.registerTool(...)` calls; the three PM-only tools carry a `PM-only…` description prefix.
- `mcp-server/src/tools/work-package.ts` (L1072): `propagateDependencyReblock` is declared module-private (`async function`, no `export`). `propagateDependencyUnblock` (L999) **is** exported.
- `mcp-server/src/tools/work-package.ts` (L799–L923): `updateWorkPackageStatus`, COMPLETE → IN_PROGRESS path. Allowed agents: Project Manager / Project Manager Agent / Documentation / Documentation Agent (L799–L812). Bookkeeping at L899–L922: `wp.revision += 1`, `wp.rework_counts = undefined`, `clearSynthesisState(root)`, summary status sync, `root.pending_work_packages += 1`. Post-write: `propagateDependencyReblock` (L945–L947).
- `mcp-server/src/tools/work-package.ts` — file length 1684 lines (`wc -l`).
- `mcp-server/src/index.ts` (L82–L95): tool modules are registered explicitly; there is no auto-discovery. A code comment states the startup log must be updated whenever a tool is added.
- `mcp-server/src/index.ts` (L170): the literal `Registered tools: …` string enumerating all 32 tool names.

### Established Patterns

- Every PM-only tool: `agent_role: z.string().describe('Must be "Project Manager"')` + an early string-equality guard + a mandatory `reason` for the audit trail + an audit entry appended to `root.project_comments` — `mcp-server/src/tools/work-package.ts` (L1218, L1335, L1515).
- All WP+root mutations go through `LedgerStore.updateWorkPackageWithSync` so both files are written under one lock — `mcp-server/src/storage/ledger-store.ts` (L360–L397).
- Tool handlers return `{ content: [{ type: 'text', text: … }], isError?: true }`; errors are returned, never thrown out of the handler.

### Structural Observations

- `mcp-server/src/tools/work-package.ts`: the PM-only role guard is copied verbatim three times (L1218–L1226, L1335–L1345, L1515–L1525), differing only in the tool name in the message. A fourth tool would make it four copies.
- `mcp-server/src/tools/work-package.ts`: the file mixes the normal WP lifecycle tools (get/list/create/claim/status) with three PM-only administrative escape hatches, at 1684 lines. The two groups share only `LedgerStore` plumbing and `propagateDependencyReblock`.
- `mcp-server/src/tools/work-package.ts` (L1072): `propagateDependencyReblock` is private while its sibling `propagateDependencyUnblock` (L999) is exported — an asymmetry that blocks any reuse from another module.

### Constraints

- `mcp-server/tests/tools/schema-integrity.test.ts` (L1–L60): asserts a hardcoded `EXPECTED_TOOL_NAMES` list ("all 29") captured from each module's `register()`, and that no outer tool schema is a `ZodEffects` (no `.refine()` / `.transform()` on the outer object).
- `mcp-server/tests/startup/tool-log-sync.test.ts` (L20–L45): parses the `Registered tools:` literal from `src/index.ts` and compares it against every `registerTool('…')` name found by scanning `src/tools/*`. A new tool that is not added to the log line fails this test.

---

## Area: Pipeline Stage Validation & Routing

### Verified References

- `mcp-server/src/utils/pipeline-maps.ts` (L38–L75): `PIPELINE_TYPES` (canonical order, manifest-derived), `PipelineTypeEnum`, `CANONICAL_PIPELINE_ORDERING`, `DEFAULT_PIPELINE_STAGES` (the 4-stage legacy chain).
- `mcp-server/src/utils/pipeline-maps.ts` (L353–L428): `validateActiveStages(stages: string[]): { errors, warnings }`. Hard errors: empty array; unknown stage names; duplicates; violation of canonical subsequence order. Soft warnings: `implementation` without `qa`; single-stage chain; any composition that is neither `DEFAULT_PIPELINE_STAGES` nor the full 6-stage chain.
- `mcp-server/src/utils/pipeline-maps.ts` (L208–L296): `resolvePrerequisite`, `resolveNextAgent`, `resolveFailAgent` — all take `activeStages` and default to `DEFAULT_PIPELINE_STAGES`.
- `mcp-server/src/utils/pipeline-maps.ts` (L285–L292): `getOrderedActiveStages(activeStages)` — filters `CANONICAL_PIPELINE_ORDERING` by membership, i.e. canonicalises the order of any accepted list.
- `mcp-server/src/utils/workflow-helpers.ts` (L87): `clearSynthesisState(rootIndex)`.
- `mcp-server/src/utils/workflow-helpers.ts` — `computePassedStages(wp, activeStages)`: for each stage, walks `wp.pipelines` in reverse to the most recent non-`auto_cancelled` entry of that type and counts it when `status === 'PASS'`.
- `mcp-server/src/tools/pipeline.ts` (L152–L180): `startPipeline` resolves `activeStages` from the WP (defaulting to `DEFAULT_PIPELINE_STAGES`), and at L172–L179 **hard-rejects** a requested type that is not in the active stages: *"this pipeline type is not in the WP's active stages"*. This is the mechanism that left the incident with no workaround.
- `mcp-server/src/tools/pipeline.ts` (L221–L240): `rework_counts` is lazily keyed per pipeline type (`wp.rework_counts?.[args.type] ?? 0`) — a newly added stage needs no counter initialisation.
- `mcp-server/src/tools/workflow-next-action.ts` (L1246–L1250): `getSecurityAuditorAction` skips terminal/BLOCKED WPs and any WP whose `active_pipeline_stages` excludes `security-audit`.
- `mcp-server/src/tools/workflow-next-action.ts` (L1406–L1410): **P6 first-run branch** — when the prerequisite (`qa`) has a non-auto-cancelled PASS and there is no prior `security-audit` pipeline, the action is `RUN_SECURITY_AUDIT`. The branch does not consult `assigned_to`. So an IN_PROGRESS WP with a freshly added `security-audit` stage becomes actionable for the Security Auditor immediately.
- `mcp-server/src/tools/workflow-next-action.ts` (L1004–L1016, L1653–L1664): the Reviewer and Documentation branches resolve their prerequisite dynamically and re-engage when a newer upstream PASS exists — so a PASS on a newly inserted `security-audit` replays `code-review` → `documentation` behind it.

### Structural Observations

- No change is needed in this area: every routing function already reads `active_pipeline_stages` per call, so a mutated list takes effect on the next routing call with no cache to invalidate.

### Constraints

- `validateActiveStages` accepts `string[]` and returns errors rather than throwing — reusable verbatim by a new tool.
- The canonical-order rule is a subsequence rule: stages may be omitted, never reordered.
- [added by: Plan Architect Reviewer, unverified] `mcp-server/src/tools/workflow-next-action.ts` (L500-L560): the Project Manager fallback scans IN_PROGRESS WPs in active-stage order and returns `ROUTE_PIPELINE_AGENT` for the first stage without a PASS, FAIL, or IN_PROGRESS record; this routing is derived from the mutated active-stage list.

---

## Area: Storage & Schema

### Verified References

- `mcp-server/src/schema/work-package.ts` (L128): `active_pipeline_stages: z.array(z.string()).optional()` on the WP detail.
- `mcp-server/src/schema/root-index.ts` (L8–L18): `WorkPackageSummarySchema` carries `active_pipeline_stages: z.array(z.string()).nullable().optional()` and `passed_stages: z.number().int().nonnegative().optional()`.
- `mcp-server/src/storage/ledger-store.ts` (L360–L397): `updateWorkPackageWithSync` — reads WP + root under one lock, runs the updater, stamps `wp.last_updated`, then **recomputes** `wpSummary.passed_stages = computePassedStages(updatedWp, wpSummary.active_pipeline_stages)` (L378–L382), validates both documents against their Zod schemas, writes both atomically, and auto-syncs `.meta.json` including `progress_pct: computeProjectProgress(...)`.
- `mcp-server/src/utils/workflow-helpers.ts` (L591–L612): project progress for an IN_PROGRESS WP is `passed_stages / active_stages_count`.

### Structural Observations

- Because `passed_stages` is recomputed **after** the updater runs and reads the summary's own `active_pipeline_stages`, a mutator that writes the new list onto both the detail and the summary gets `passed_stages` and `.meta.json` `progress_pct` corrected for free. No bespoke recomputation is needed.

### Constraints

- Both schemas already permit any string array; no schema migration is required to make the field mutable. The mutability decision is purely a policy/tooling one.

---

## Area: Workflow Specification

### Verified References

- `mcp-server/docs/agents/workflow-specification/README.md` (L1–L8): authoritative spec, **Version: 2.5.1**, dated 2026-05-30, with a per-version `## Changelog` at the top.
- `mcp-server/docs/agents/workflow-specification/data-model.md` (L55–L60): the WP-summary field table plus the routing-optimisation note, which states the value *"is set at WP creation time and is immutable thereafter (see §21.55)"*.
- `mcp-server/docs/agents/workflow-specification/data-model.md` (L77–L84, L206, L230–L238): the WP detail field, the composability statement, and the canonical-ordering/subsequence rule.
- `mcp-server/docs/agents/workflow-specification/edge-cases.md` (L478–L486): **§21.55 Pipeline Stage Backward Compatibility**. L484 is the bullet this work overturns: *"**No mid-flight stage addition:** `active_pipeline_stages` is set at WP creation and cannot be modified thereafter. If the PM discovers mid-project that a WP needs additional stages, the PM must cancel and recreate the WP with the correct stages (losing pipeline history), or manually route work via project comments and PM overrides."*
- `mcp-server/docs/agents/workflow-specification/operations.md` (L70–L152): §9b.2 `active_pipeline_stages` validation — hard rejects and soft guardrails, as implemented by `validateActiveStages`.
- `mcp-server/docs/agents/workflow-specification/edge-cases.md` (L487, L493, L502): section numbering is sequential (§21.56, §21.57, §21.58 …); the highest referenced elsewhere is §21.71 (spec README v2.5.0 notes).

### Established Patterns

- The spec is versioned and changed **before** implementation (root `AGENTS.md` → Manifest Maintenance Rules: *"Change workflow logic … `workflow-specification/` **first**, then implementation code, then tests, then `constraints-workflow.md`"*).
- Operations are specified as numbered sections with pseudocode (`§12.3b` for `updateAcceptanceCriteria`); tool-level constraints are mirrored in `project-manifest/constraints-workflow.md` with a `> **Specification:**` back-link.

### Constraints

- Three separate spec statements assert immutability (`data-model.md` L60, `edge-cases.md` L484, and the reference from the summary-field table). All three must move together, or the spec will contradict itself — and per the workspace failure protocol, the manifest wins over code, so a stale line here would make the new tool "wrong by specification".

---

## Area: Project Manifest (MCP Server)

### Verified References

- `mcp-server/docs/agents/project-manifest/api-surface.md` (L320, L340–L352, L370): dedicated `#### ledger_reset_rework_count`, `#### ledger_reopen_cancelled_wp` (described as a *"PM-only administrative bypass tool (§16.3d, §21.1a)"*), and `#### ledger_update_acceptance_criteria` entries; L4157–L4163 document the internal handler functions.
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md` (L341–L389): the stage-ordering rule, the "all six stages are composable" rule, and the `active_pipeline_stages` hard/soft validation rule, each with a spec back-link.
- Root `AGENTS.md` (L95–L115): Manifest Maintenance Rules — *Add new MCP tool* → `api-surface.md`, `file-tree.md` (if new file), `data-flows.md` (if new flow); *Add constraint/convention* → the matching `constraints-*.md`.
- Root `AGENTS.md` (Changelog Convention + Cross-System Dependencies): version sources are `mcp-server/changelog.md` → `mcp-server/package.json` (via `npm run sync-version`); `personas/changelog.md` → `personas/ledger/src/meta/_shared.yaml` `default_version`; root `changelog.md` → root `package.json`.
- Root `AGENTS.md` (Generated Context Docs): `.context/` is regenerated with `node scripts/cli.js ctx-generate` and is tracked in VCS; `.context/mcp-server/manifest-api-surface.md`, `…/manifest-constraints.md`, `…/workflow-spec-*.md`, and `.context/personas/*` all mirror files this plan touches.

### Structural Observations

- `mcp-server/src/tools/help-content.ts` (L25–L51): the `ledger_help` overview table lists ~30 tools but omits all three PM-only tools (`ledger_reset_rework_count`, `ledger_reopen_cancelled_wp`, `ledger_update_acceptance_criteria`) — verified by grep, which finds no occurrence of those names anywhere in the file. An agent that discovers tools through `ledger_help` cannot see the administrative surface at all.

### Constraints

- `mcp-server/tests/tools/knowledge-help.test.ts` (L18–L30) is the pattern for asserting a `TOOL_HELP[toolName]` entry exists, is non-empty, and contains a `# <toolName>` heading.

---

## Area: Personas

### Verified References

- `personas/ledger-support/src/content/ledger-pipeline-configurator.md` (full read): produces `{PLAN_PATH}/pipeline-configuration.md` with a Per-WP Stage Configuration table; its Decision Criteria list the `security-audit` triggers (auth, sensitive data, external input, crypto/secrets, uploads/paths/SQL, access control); its guiding principle is *"A Missing Stage Costs More Than an Extra One."*
- `personas/ledger-support/src/content/ledger-bootstrapper.md` (L17, L46, L111–L112): reads `pipeline-configuration.md`; *"`active_pipeline_stages` — The stage list for this WP, copied exactly"*; `assigned_to` = owner of the first stage.
- `personas/ledger-support/src/content/ledger-bootstrapper.md` (L120–L140): **Step 4 — Verify the Ledger** currently checks only WP count, statuses, and absence of missing WPs. Step 5's report table has a "Pipeline Stages" column, so the value is already being read back — but nothing compares it to the source table.
- `personas/ledger/src/content/2-project-manager.md` (L158–L181): step 8 dispatches the Bootstrapper; **step 9** instructs, for WPs without `implementation`, *"reclassify the WP to include the `implementation` stage by recreating it with the correct `active_pipeline_stages`"* — the cancel-and-recreate workaround this plan replaces; step 10 verifies via `ledger_get_project_status`.
- `personas/ledger-support/src/content/ledger-doctor.md` (L97–L103): the Diagnostic Toolkit table listing `ledger_reset_rework_count`, `ledger_reopen_cancelled_wp`, `ledger_update_acceptance_criteria` with a "when to use" column; L279–L284 the reopen recipe; L476 *"Use `agent_role: \"Project Manager\"` for repair operations."*
- `personas/ledger-support/src/meta/ledger-doctor.yaml` (full read): `changelog: |` block (newest first, `X.Y.Z (date): description`), `tools`, `cc_tools`, and overview metadata. It has **no** `mcp_tools` block.
- `personas/ledger/src/meta/2-project-manager.yaml` (L19–L27, L65–L77): `changelog` block; `mcp_tools:` list of `- tool: … / purpose: …` entries used to render the persona's tool table.
- `mcp-server/src/tools/work-package.ts` (`listWorkPackages`): returns the raw root-index summaries — which include `active_pipeline_stages` and `passed_stages` — so one `ledger_list_work_packages` call is enough to diff registered stages against `pipeline-configuration.md`.
- Root `AGENTS.md` (Failure Protocol): *"Never edit generated persona files. Trace back to the relevant suite source"*; validation scripts `node scripts/build-personas.js --check` and `node scripts/validate-workflow-manifest.js`; `personas/name-mapping.json` is regenerated by `scripts/build-personas.js`; `docs/agents-overview.md` is regenerated by `scripts/generate-agents-overview.js` after changing any overview field.

### Structural Observations

- `personas/ledger-support/src/content/ledger-bootstrapper.md` Step 4: verification is count-and-status only. The exact failure mode from the incident — a WP registered with the right ID, title, and dependencies but the wrong stage list — passes this check silently.
- `personas/ledger/src/content/2-project-manager.md` step 9: prescribes recreation as the remedy for a wrong stage list. Once the new tool exists this instruction is actively harmful (recreation changes the WP ID and orphans dependents).
- `personas/ledger-support/src/content/ledger-doctor.md`: the Diagnostic Toolkit has no row for a wrong stage list, and no Diagnose/Repair recipe covering "a required stage was never configured".

### Constraints

- Persona behaviour changes are made in `src/content/*.md` + `src/meta/*.yaml` and then built; generated output under `personas/*/vs-code/`, `*/claude-code/`, `*/deep-agents/` is never hand-edited.
- Each persona YAML carries its own `changelog` block, and the version is derived from its first entry — a behaviour change requires a new entry.

---

## Area: GUI

### Verified References

- `mcp-server/gui/api.ts` (L1331–L1360): `handleGetWorkPackageOverview` resolves `wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES`, filters through `CANONICAL_PIPELINE_ORDERING`, and maps each stage to a chip with status (`pending` / `in-progress` / `pass` / `fail`) and `rework_count`, plus `PIPELINE_AGENT_MAP[type]` as the agent.
- `mcp-server/gui/public/views/work-package.js` and `project-detail-modal.js` reference `active_pipeline_stages` for rendering only.

### Structural Observations

- The GUI derives its stage chips from the stored list on every read, so a mutated list renders correctly with no GUI change. The corollary is that a stage **removed** from the list disappears from the GUI even though its pipeline record remains in `wp.pipelines` — which is the concrete argument for forbidding removal of an already-executed stage.
- The GUI exposes no write path for work-package fields (rename/archive are project-level), so there is no GUI surface to keep in sync for this change.

---

## Area: Orchestrator

### Verified References

- `grep -rn "active_pipeline_stages" orchestrator/src orchestrator/docs` returns no matches.

### Structural Observations

- The orchestrator dispatches purely on what `ledger_get_next_action` / `ledger_get_handoff_status` return; it holds no stage state of its own. Nothing to change, and no Python mirror of this logic to keep in sync.

---

## Strategic Context

`ledger_get_repository_context` returned `total_projects: 0` and `strategic_vision: null` for repository `stable` — no prior project history or declared strategy is recorded for this workspace, so nothing constrains the design from that direction.

`ledger_search_insights` returned one directly relevant entry:

- **`cdaf1471-5d14-4890-91d2-243a4a2c4896`** — *"Verify pipeline stage configuration immediately after WP creation — no tool exists to patch it later"* (global, confidence 0.7, origin plan `2026-09-22-mass-upload-performance-metrics-rework-1`). This insight is the generalised record of the very incident in scope. Its remedial half ("no tool exists to patch the stage list after creation"; "the only fix is to cancel and recreate it under a new ID") is exactly what this plan invalidates; its preventive half (verify immediately after creation, while unstarted) remains correct and is promoted into the Bootstrapper and PM personas.

Two further entries informed the design indirectly:

- **`00b9e901-0229-42dd-a68b-fc90ead7a0be`** / **`6f496510-1598-498d-8dfc-bd02521d87a3`** — the harness blocks agents from editing their own guardrail files, and shell workarounds around a permission denial are out of bounds rather than clever. This supports the conclusion that "edit the ledger JSON by hand" is not an acceptable fallback and that the capability belongs in a tool with an explicit role gate.
- **`7d13934f-9d72-4156-9616-15741f3e8f94`** — validation of supplied content has a hard ceiling. The server can verify that a stage list is structurally valid and consistent with recorded pipeline history; it cannot verify that the list matches the work's actual security surface. That judgement stays with the Pipeline Configurator, which is why the preventive half of this plan is a persona-level parity check rather than a server-side rule.
