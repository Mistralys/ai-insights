# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.9.3 — findings resolved
- Architectural Reviews: 1 — Plan Architect Reviewer v2.3.3

## Prior Project Context

`ledger_get_repository_context` reports no prior projects and no declared strategic vision for repository `stable`, so no earlier outcome constrains this design.

One stored insight is directly on point: **`cdaf1471-5d14-4890-91d2-243a4a2c4896`** — *"Verify pipeline stage configuration immediately after WP creation — no tool exists to patch it later"* — is the generalised record of the incident this plan addresses. It asserts two things: that no tool exists to patch a stage list after creation (which this plan fixes), and that stage assignment should therefore be verified immediately after creation while the WP is still unstarted (which this plan keeps, and promotes from advice into an explicit persona step). Two further insights (`00b9e901-…`, `6f496510-…`) establish that working around a permission denial with a shell command is out of bounds rather than a fix — which is why the capability belongs in a role-gated tool rather than in a filesystem edit. Insight `7d13934f-…` ("shit in, shit out") draws the responsibility boundary this plan follows: the server validates structure and consistency with recorded history; whether a stage list matches the work's real security surface stays a persona judgement.

## Knowledge Base Reconciliation

| Insight ID | Title | What the plan overtakes | Executed by |
|------------|-------|-------------------------|-------------|
| cdaf1471-5d14-4890-91d2-243a4a2c4896 | Verify pipeline stage configuration immediately after WP creation — no tool exists to patch it later | The claim that no tool exists to patch the stage list after creation, and the consequence drawn from it — that once a pipeline has started "the only fix is to cancel and recreate it under a new ID, which cascades into every dependent". After this plan, `ledger_update_pipeline_stages` patches the list in place, including on a WP whose stages have already run. The preventive half of the insight (verify stage configuration immediately after creation) remains valid and should be retained. | Ledger Knowledge Curator v1.4.1 (Targeted Reconciliation) |

## Summary

A work package's `active_pipeline_stages` is currently write-once: it is set by `ledger_create_work_package` and there is no tool, and no permitted manual path, to change it afterwards. When the Ledger Bootstrapper registered WP-005 of a prior plan with the default 4-stage chain instead of the 5-stage chain its own `pipeline-configuration.md` prescribed, the mistake became unfixable — `ledger_start_pipeline` hard-rejects any stage that is not in the active list, so the credential-redaction work package completed with no independent security audit. This plan closes both halves of that failure: it adds `ledger_update_pipeline_stages`, a PM-only tool that replaces a work package's stage list in place under explicit safety guards, and it adds a stage-parity verification step to the Ledger Bootstrapper and Project Manager so a mis-transcribed stage list is caught at registration time rather than at synthesis time. The workflow specification's three standing assertions that the field is immutable are revised first, since they are authoritative over the implementation.

## Architectural Context

`active_pipeline_stages` is stored in two places that must agree: the WP detail (`mcp-server/src/schema/work-package.ts` L128) and the root-index summary (`mcp-server/src/schema/root-index.ts` L15). Both are plain `z.array(z.string())` — nothing in the schema enforces immutability; it is a policy expressed in the specification and enforced only by the absence of a write path.

All routing reads the list per call and caches nothing: `resolvePrerequisite`, `resolveNextAgent`, `resolveFailAgent`, `getOrderedActiveStages`, `firstActiveStage`, and `lastActiveStage` in `mcp-server/src/utils/pipeline-maps.ts` each accept `activeStages` and fall back to `DEFAULT_PIPELINE_STAGES`. The recommendation engine in `mcp-server/src/tools/workflow-next-action.ts` filters per role by stage membership (e.g. L1250 for `security-audit`) on every call. This is what makes in-place mutation viable: a changed list takes effect on the next routing call with no derived state to rebuild.

Writes go through `LedgerStore.updateWorkPackageWithSync` (`mcp-server/src/storage/ledger-store.ts` L360–L397), which takes one lock, runs the updater over both documents, then recomputes `wpSummary.passed_stages` from the summary's own stage list and re-syncs `.meta.json` `progress_pct`. A mutator that writes the new list to both documents therefore gets progress bookkeeping corrected for free.

Three PM-only administrative tools already exist in `mcp-server/src/tools/work-package.ts` — `ledger_reset_rework_count` (L1200), `ledger_reopen_cancelled_wp` (L1320), `ledger_update_acceptance_criteria` (L1478). They share a shape: an `agent_role` string-equality guard, a mandatory `reason`, an audit entry on `root.project_comments`, and a single `updateWorkPackageWithSync` call. The new tool is the fourth member of that family.

The cause side of the incident lives entirely in the persona layer. The Ledger Pipeline Configurator writes `pipeline-configuration.md`; the Ledger Bootstrapper copies each row's stage list into `ledger_create_work_package`. Nothing compares the two afterwards — the Bootstrapper's Step 4 verification checks WP count and status only. The MCP server never sees `pipeline-configuration.md`, so this parity check can only be a persona step.

## Approach / Architecture

Four moves, in dependency order.

**1 — Revise the specification.** `edge-cases.md` §21.55 L484 ("No mid-flight stage addition"), `data-model.md` L60 ("set at WP creation time and is immutable thereafter"), and the operations chapter are amended together: the field becomes mutable through exactly one gated operation, with the guards enumerated. A new edge case documents the mid-flight replay behaviour. The spec version goes 2.5.1 → 2.6.0.

**2 — Reshape the admin tool surface.** The three PM-only tools move out of the 1684-line `work-package.ts` into a new `mcp-server/src/tools/work-package-admin.ts`, and their triplicated role guard is extracted into `requirePmRole()` in a new `mcp-server/src/utils/pm-role-guard.ts`. `propagateDependencyReblock` is exported from `work-package.ts` so the admin module can reach it — matching its already-exported sibling `propagateDependencyUnblock`. Doing the move before the addition keeps two mechanical diffs instead of one mixed one.

**3 — Add `ledger_update_pipeline_stages`.** A PM-only tool taking the **complete replacement list** plus a mandatory `reason`. It validates through the existing `validateActiveStages`, canonicalises order through `getOrderedActiveStages`, then applies four state guards (below) plus one non-rejecting state mutation, writes the list to both the detail and the summary inside one `updateWorkPackageWithSync`, appends an audit comment, and returns the before/after lists, any soft warnings, and next-step guidance.

The guards, in order:

| # | Guard | Rejection reason |
|---|-------|------------------|
| 1 | `agent_role === 'Project Manager'` | Restricting the capability to the role that owns pipeline composition. Checked before any disk I/O, as in `reopenCancelledWp`. |
| 2 | `validateActiveStages(stages).errors` is empty | Same hard rules as creation: non-empty, known names, no duplicates, canonical subsequence order. |
| 3 | WP status is not `CANCELLED` | A terminal, abandoned WP has no pipeline to configure. Mirrors the `updateAcceptanceCriteria` CANCELLED guard. |
| 4 | WP status is not `COMPLETE` | A COMPLETE WP must be reopened first via `ledger_update_work_package_status` (COMPLETE → IN_PROGRESS, agent `Project Manager`), which already owns the reopen bookkeeping. The error message names that call explicitly. Checked immediately after the CANCELLED guard — both are status-gate preconditions, logically prior to the content-shape checks below — so a PM who targets a COMPLETE WP always gets this actionable message rather than the removal guard's, even when the requested list would also fail guard 6. |
| 5 | No pipeline is currently `IN_PROGRESS` | Changing the chain under a running agent would change its downstream routing mid-flight. The PM cancels the pipeline first (`ledger_cancel_pipeline`). |
| 6 | No stage being **removed** has a non-`auto_cancelled` pipeline record | A removed stage's history stops rendering in the GUI (which derives chips from the list) while the records stay in `wp.pipelines` — an audit trail that exists but cannot be seen. Removal stays available for stages that never ran. |
| 7 | *(mutation, not a rejection)* If `wp.assigned_to`'s role currently owns a stage in the removed set (via the `PIPELINE_AGENT_MAP` reverse lookup), null out `wp.assigned_to` and the matching root summary field in the same write | N/A — guard 6 already permits removing a never-run stage; without this, the WP keeps a stale `assigned_to` that matches no active stage, making it invisible to every role's `ledger_get_next_action` handler (each gates on both stage-membership and `assigned_to === role`). Mirrors the existing precedent at `reopenCancelledWp` (`work-package.ts` L1397) and the IN_PROGRESS → READY transition (`work-package.ts` L887–L896), both of which null `assigned_to` on the same class of state-invalidating mutation. |

Recovery for the incident's exact shape is therefore a two-call sequence — reopen, then re-stage — after which the routing engine takes over unaided: `getSecurityAuditorAction` P6 (`workflow-next-action.ts` L1406–L1410) fires `RUN_SECURITY_AUDIT` on the strength of the existing `qa` PASS and the absence of any prior audit pipeline, without consulting `assigned_to`. A PASS there then re-engages `code-review` and `documentation` behind it through the standard newer-upstream-PASS checks, and the terminal-stage auto-finalize returns the WP to COMPLETE.

**4 — Close the cause.** The Ledger Bootstrapper gains a stage-parity check in Step 4: one `ledger_list_work_packages` call returns summaries that already carry `active_pipeline_stages`, which it diffs row-by-row against the Per-WP Stage Configuration table it worked from, reporting any mismatch in the initialization report. The Project Manager gains the matching verification in step 10 and has its step 9 remediation rewritten from "recreate the WP" to "call `ledger_update_pipeline_stages`". The Ledger Doctor gains a toolkit row and a Diagnose/Repair recipe for the wrong-stage-list fault.

## Rationale

The tool replaces the whole list rather than applying add/remove operations because the list is authored as a whole — `pipeline-configuration.md` prescribes a complete chain per WP, and the PM's mental model is "this WP's chain is X". Replacement is idempotent, reuses `validateActiveStages` unchanged (it validates a complete array), and makes the audit comment self-describing (`[a, b] → [a, b, c]`).

Reopen is deliberately *not* folded into the tool. `updateWorkPackageStatus`'s COMPLETE → IN_PROGRESS path already carries five coupled effects — `revision += 1`, `rework_counts` reset, `clearSynthesisState`, `pending_work_packages += 1`, and a cascade reblock of dependents (`work-package.ts` L899–L947). Re-implementing those inside a second tool would duplicate the workspace's most consequential bookkeeping and guarantee drift. Two explicit calls also keep the reopen visible in the audit trail as a deliberate act.

The removal guard is asymmetric on purpose: adding a stage is always safe (the new stage simply becomes actionable), while removing one that has run erases visible history. Since the motivating incident is a *missing* stage, the asymmetry costs nothing in practice and keeps the audit trail honest. Removing a never-run stage is otherwise unconditionally permitted by guard 6 — but if that stage is the one `wp.assigned_to`'s role currently owns, leaving `assigned_to` untouched would strand the WP: no role's `ledger_get_next_action` handler would surface it, since every handler gates on both stage-membership and `assigned_to === role`, and removal breaks only the first half of that pair. Guard 7 closes this by nulling `assigned_to` (and the matching root summary field) in the same write whenever the removed set includes the stage `assigned_to` currently names, mirroring the existing precedent at `reopenCancelledWp` and the IN_PROGRESS → READY transition.

Restricting to `Project Manager` matches the existing three admin tools and needs no new role concept. The Ledger Doctor already performs its repairs as `agent_role: "Project Manager"` (`ledger-doctor.md` L476), so it inherits the capability with a persona-doc change and no code change.

The persona-side parity check is where the root cause actually lives, and it is nearly free: the Bootstrapper already reads the stage list back for its report table, so the addition is a comparison, not a new read.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Mutation granularity | Full-list replacement (`stages: string[]`) | Operation list (`add_stage` / `remove_stage`), mirroring `ledger_update_acceptance_criteria` | Replacement matches how the list is authored in `pipeline-configuration.md`, is idempotent, and reuses `validateActiveStages` verbatim; an operation list would need its own post-application re-validation and produces a less legible audit entry. |
| Handling a COMPLETE WP | Reject with an instruction to reopen first | A `reopen_if_complete: true` flag that performs the reopen inline | Inline reopen would duplicate the five coupled effects at `work-package.ts` L899–L947 (revision, rework reset, synthesis invalidation, pending counter, cascade reblock) in a second place and drift from them; a two-call sequence keeps one implementation and one audit trail. |
| Tool placement | New tool `ledger_update_pipeline_stages` | A new `active_pipeline_stages` parameter on `ledger_update_work_package_status` | The status tool is already the most overloaded in the surface (nine guard blocks) and is called by every pipeline agent; bolting a PM-only field onto it would mean a role check that applies to one parameter only. A separate tool keeps the PM-only gate total. |
| Removing an executed stage | Hard reject | Allow with a `force` flag, or allow silently | The GUI derives its stage chips from the list (`gui/api.ts` L1331–L1345), so a removed executed stage's pipelines become invisible while remaining in the file — a hidden audit trail. The motivating fault is a missing stage, so the restriction blocks nothing that is needed. |
| Mutating while a pipeline runs | Hard reject | Allow, and auto-cancel the running pipeline (as IN_PROGRESS → BLOCKED does) | Auto-cancelling silently discards an agent's in-flight work. Requiring an explicit `ledger_cancel_pipeline` keeps the discard deliberate and attributable. |
| Authorised roles | `Project Manager` only | A new "admin role" set including `Ledger Doctor` | The Doctor already repairs as `agent_role: "Project Manager"` by its own documented convention, so a new role concept would add a second authorisation vocabulary for no additional capability. |
| Preventing recurrence | Persona-level stage-parity check after registration | Server-side enforcement | The server never sees `pipeline-configuration.md` and has no way to know a WP's intended chain, so no server-side check is possible. Per insight `7d13934f-…`, this is the responsibility boundary, stated rather than chased. |
| Admin tool module split | Move all four PM-only tools to `work-package-admin.ts` | Leave them in `work-package.ts` (which would reach ~1850 lines) | The split is a mechanical move of three self-contained functions plus one export, done before the addition; leaving them mixed keeps a general-purpose module growing a PM-only appendix that no normal WP flow touches. |

## Pattern Alignment

- **PM-only tool shape** — follows `ledger_reopen_cancelled_wp` (`mcp-server/src/tools/work-package.ts` L1320–L1470): `agent_role` string-equality guard before disk I/O, mandatory `reason`, audit entry on `root.project_comments`, single `updateWorkPackageWithSync`.
- **Validation reuse** — follows `createWorkPackage` (`work-package.ts` L361–L397): `validateActiveStages` for hard errors, soft warnings surfaced in the response rather than blocking.
- **Dual-document write** — follows the `updateWorkPackageWithSync` contract (`ledger-store.ts` L360–L397); the mutator writes both the detail and the summary, and lets the store recompute `passed_stages` and `.meta.json` progress.
- **Error-return, never throw** — all handlers return `{ content: […], isError: true }`, per every tool in `work-package.ts`.
- **Spec-first change order** — follows the root `AGENTS.md` rule that workflow logic changes land in `mcp-server/docs/agents/workflow-specification/` before implementation, tests, and `constraints-workflow.md`.
- **Persona sources only** — all persona edits are made in `personas/*/src/content/*.md` and `personas/*/src/meta/*.yaml`; generated targets are rebuilt, never hand-edited (root `AGENTS.md` Failure Protocol).
- **Deliberate departure — no `.refine()` on the outer schema.** The cross-field rules (guards 3–6) cannot live in Zod because `mcp-server/tests/tools/schema-integrity.test.ts` forbids `ZodEffects` on outer tool schemas (it empties `properties` in `tools/list`). They are implemented as imperative guards inside the handler, which is what every existing multi-guard tool does.
- **Deliberate departure — new module `work-package-admin.ts`.** No existing tool module is split by authorisation level. The justification is size (1684 lines today) plus the total absence of shared logic between the PM-only escape hatches and the normal lifecycle tools, beyond one helper that is exported anyway.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/tools/work-package.ts` (L1218, L1335, L1515) | The PM-only role guard is copied verbatim three times; a fourth tool makes four copies | Promoted to step 3 | Extraction into `requirePmRole()` is the cheapest it will ever be — the fourth copy is being written right now, and the message format would otherwise diverge across four sites. |
| `mcp-server/src/tools/work-package.ts` (1684 lines) | Mixes normal WP lifecycle tools with three PM-only administrative escape hatches that share no logic with them | Promoted to step 4 | Moving three self-contained functions before adding a fourth keeps two mechanical diffs; deferring it means the module crosses ~1850 lines and the split never gets funded on its own. |
| `mcp-server/src/tools/work-package.ts` (L1072) | `propagateDependencyReblock` is module-private while its sibling `propagateDependencyUnblock` (L999) is exported | Promoted to step 4 | The module split requires the export; the asymmetry has no rationale and removing it is a one-word change. |
| `mcp-server/src/tools/help-content.ts` (L25–L51) | The `ledger_help` overview table omits all three existing PM-only tools, so the administrative surface is undiscoverable through help | Promoted to step 7 | The step already adds a row and a `TOOL_HELP` entry for the new tool; adding the three missing rows in the same pass is the only realistic moment this gap closes. |
| `personas/ledger-support/src/content/ledger-bootstrapper.md` (Step 4) | Post-registration verification checks WP count and status only — the exact incident (right WP, wrong stage list) passes it silently | Promoted to step 10 | This is the root cause. The data needed for the check is already being read for the Step 5 report table. |
| `personas/ledger/src/content/2-project-manager.md` (step 9) | Instructs the PM to fix a wrong stage list by recreating the WP | Promoted to step 11 | Once the tool exists this instruction is actively harmful: recreation changes the WP ID and orphans every dependent that references it. |
| `personas/ledger-support/src/content/ledger-doctor.md` (Diagnostic Toolkit, L97–L103) | No toolkit row and no recipe for a wrong or incomplete stage list | Promoted to step 12 | The Doctor is the persona users invoke for exactly this class of fault; a capability it does not know about does not exist in practice. |
| `mcp-server/src/utils/pipeline-maps.ts` | `validateActiveStages` already returns `{ errors, warnings }` rather than throwing, and is reusable as-is | Rejected | No change needed — the function is already shaped for a second caller. |
| `mcp-server/gui/` | Renders stage chips read-only from the stored list; no WP-field write path exists | Rejected | Adding a GUI editing control for stage lists is a separate feature with its own authorisation question (the GUI has no agent-role concept), well outside this plan's blast radius. |
| `mcp-server/src/index.ts` (L170) | The `Registered tools:` literal is hand-maintained, guarded only by `tests/startup/tool-log-sync.test.ts` | Rejected | Auto-deriving the list would require a registry refactor across all eleven tool modules — outside this plan's blast radius, and the existing test already makes the manual list fail loudly rather than silently. |

## Detailed Steps

1. **Revise the workflow specification — mutability.** In `mcp-server/docs/agents/workflow-specification/edge-cases.md` §21.55, replace the "No mid-flight stage addition" bullet (L484) with a bullet describing mid-flight adjustment via `ledger_update_pipeline_stages` and its guards. In `data-model.md`, amend the routing-optimisation note (L60) so the summary field is described as PM-mutable through that single operation, and amend the §3.3 detail-field note (around L84) to match. Add a new edge case §21.72 "Mid-Flight Pipeline Stage Adjustment" covering: the reopen-then-restage sequence for a COMPLETE WP, including the reordered guard evaluation (CANCELLED, then COMPLETE, then the running-pipeline and removal guards) so the reopen instruction surfaces before the less-actionable removal rejection whenever both conditions apply; the replay of stages downstream of a newly inserted one (audit PASS re-engages `code-review`, then `documentation`, then terminal auto-finalize); the automatic `passed_stages` / `progress_pct` recomputation; the rule that `rework_counts` needs no initialisation for a newly added stage; and the rule that removing a never-run stage currently owned (via `PIPELINE_AGENT_MAP`) by `wp.assigned_to`'s role nulls `assigned_to` in the same write, so the WP never carries a stale assignment invisible to `ledger_get_next_action`.
2. **Specify the operation.** In `mcp-server/docs/agents/workflow-specification/operations.md`, add §12.3c `updatePipelineStages` following the §12.3b (`updateAcceptanceCriteria`) format: signature, the guards in evaluation order — CANCELLED, COMPLETE, no-IN_PROGRESS-pipeline, no-removal-of-an-executed-stage, then the `assigned_to`-nulling companion mutation on removal — the dual-document write, the audit comment, and the response shape. Bump `workflow-specification/README.md` to **Version: 2.6.0** with a dated changelog entry naming the new operation, the §21.55 revision, and the new §21.72.
3. **Extract the PM role guard.** Add `mcp-server/src/utils/pm-role-guard.ts` exporting `requirePmRole(toolName: string, agentRole: string)`, returning `null` when the role is `Project Manager` and otherwise the standard `{ content: [{ type: 'text', text: 'Error: <toolName> is a PM-only tool. You are: <agentRole>' }], isError: true }` result. Replace the three inline guards in `work-package.ts` (L1218, L1335, L1515) with calls to it, preserving each tool's current guard position relative to path resolution.
4. **Split out the admin module.** Create `mcp-server/src/tools/work-package-admin.ts` and move `ResetReworkCountSchema` / `resetReworkCount`, `ReopenCancelledWpSchema` / `reopenCancelledWp`, and `UpdateAcceptanceCriteriaSchema` / `updateAcceptanceCriteria` into it with their three `registerTool` calls in a new `register(server)`. Export `propagateDependencyReblock` from `work-package.ts` and import it in the new module. Register the module in `mcp-server/src/index.ts` alongside the existing eleven.
5. **Implement `ledger_update_pipeline_stages`** in `work-package-admin.ts`. Schema: `project_path?`, `cwd_path?`, `work_package_id` (`/^WP-\d{3,}$/`), `agent_role`, `stages: z.array(z.string()).min(1)`, `reason: z.string().trim().min(1)`. Handler order: `requirePmRole` → `resolveProjectPath` → `validateActiveStages` (return `errors[0]` as an error result) → `getOrderedActiveStages` to canonicalise → `resolveMultiStoreLedgerRoot` + `LedgerStore` → one `updateWorkPackageWithSync` applying guards 3–6 **in this order** — CANCELLED, then **COMPLETE** (moved ahead of the removal guard so it is reachable in one call whenever a PM also tries to shrink a COMPLETE WP's stage list), then no IN_PROGRESS pipeline, then no removal of an executed stage — as thrown errors inside the updater. After guard 6 passes, compute the removed-stage set and, if `wp.assigned_to`'s role currently maps (via the `PIPELINE_AGENT_MAP` reverse lookup) to a stage in that set, null `wp.assigned_to` and the matching root summary field in the same write — this is guard 7's companion mutation, not a rejection, so the removal still proceeds. Then assign `wp.active_pipeline_stages`, the matching root summary's `active_pipeline_stages`, an audit comment (`type: 'pipeline_stages_updated'`, `priority: 'high'`, `agent: 'Project Manager'`, naming both lists, the reason, and whether `assigned_to` was cleared), and `root.last_updated = now()`. Do **not** recompute `passed_stages` — the store does it. Response JSON: `message`, `work_package_id`, `previous_stages`, `new_stages`, `warnings`, and a next-step line telling the PM to call `ledger_get_next_action` for the agent owning the first not-yet-passed stage.
6. **Wire up registration metadata.** Add `ledger_update_pipeline_stages` to the `Registered tools:` literal in `mcp-server/src/index.ts` (L170) and to `EXPECTED_TOOL_NAMES` in `mcp-server/tests/tools/schema-integrity.test.ts`, updating its "all 29" count comment and adding the `work-package-admin` register import.
7. **Help content.** In `mcp-server/src/tools/help-content.ts`, add a `TOOL_HELP['ledger_update_pipeline_stages']` entry (heading `# ledger_update_pipeline_stages`, parameters, the guards in evaluation order including the `assigned_to`-nulling companion mutation on removal, the reopen-then-restage recovery sequence, a worked example matching the incident) and an overview-table row. In the same pass, add the missing overview-table rows for `ledger_reset_rework_count`, `ledger_reopen_cancelled_wp`, and `ledger_update_acceptance_criteria`.
8. **Tests.** Add `mcp-server/tests/tools/update-pipeline-stages.test.ts` per the Test Plan below, and extend `mcp-server/tests/tools/knowledge-help.test.ts` (or a sibling help test) to assert the new `TOOL_HELP` entry.
9. **Manifest documentation.** Add `#### ledger_update_pipeline_stages` to `mcp-server/docs/agents/project-manifest/api-surface.md` next to the other PM-only tools, and record the new `work-package-admin.ts` / `pm-role-guard.ts` modules plus their moved handlers in the internal-functions section. Add a "`active_pipeline_stages` Mutation: PM-Only, Guarded" rule to `constraints-workflow.md` with a `> **Specification:**` back-link to §12.3c, and update the stage-composability rule (L359–L367) which currently implies creation-time-only selection. Add both new files to `mcp-server/docs/agents/project-manifest/file-tree.md`, and add the tool's write path to `data-flows.md`.
10. **Bootstrapper stage parity.** In `personas/ledger-support/src/content/ledger-bootstrapper.md` Step 4, add a stage-parity check: after registration, call `ledger_list_work_packages` and compare each returned `active_pipeline_stages` against the Per-WP Stage Configuration table row for that WP; on mismatch, correct it immediately with `ledger_update_pipeline_stages` (`agent_role: "Project Manager"`, reason naming the source table) and record both the mismatch and the correction in the Step 5 report. Add a matching "Stage parity" line to the report template and a constraint forbidding a success report with an unchecked parity slot. Add a changelog entry to `personas/ledger-support/src/meta/ledger-bootstrapper.yaml`.
11. **Project Manager persona.** In `personas/ledger/src/content/2-project-manager.md`, rewrite step 9's remediation from recreating the WP to calling `ledger_update_pipeline_stages`, and extend step 10's verification to include confirming each WP's `active_pipeline_stages` against `pipeline-configuration.md` before handing off. Add `ledger_update_pipeline_stages` to the `mcp_tools` list in `personas/ledger/src/meta/2-project-manager.yaml` with a purpose line, plus a changelog entry.
12. **Ledger Doctor persona.** In `personas/ledger-support/src/content/ledger-doctor.md`, add a Diagnostic Toolkit row for `ledger_update_pipeline_stages` ("WP is missing a required pipeline stage, e.g. security-audit on security-sensitive work") and a numbered Diagnose/Repair recipe covering the COMPLETE case: reopen via `ledger_update_work_package_status` (COMPLETE → IN_PROGRESS, `agent: "Project Manager"`), re-stage via the new tool, then verify with `ledger_get_next_action` for the newly enabled stage's owner. Add a changelog entry to `personas/ledger-support/src/meta/ledger-doctor.yaml`.
13. **Rebuild generated artefacts.** Run `node scripts/build-personas.js` (regenerating the three output targets and `personas/name-mapping.json`), then `node scripts/build-personas.js --check` to confirm no staleness; run `node scripts/generate-agents-overview.js` if any persona overview field changed; run `node scripts/cli.js ctx-generate` to refresh `.context/`.
14. **Changelogs and versions.** Add an entry to `mcp-server/changelog.md` (minor bump — new tool, no breaking change) and run `npm run sync-version` in `mcp-server/`; add an entry to `personas/changelog.md` and update `default_version` in `personas/ledger/src/meta/_shared.yaml` per the workspace convention; add the aggregated entry to the root `changelog.md` with the `> mcp vX · personas vY` module reference line.

## Dependencies

- Steps 1–2 (specification) precede all implementation, per the root `AGENTS.md` workflow-logic change order.
- Step 3 (guard extraction) precedes step 4 (module split) so the moved functions carry their final shape.
- Step 4 precedes step 5 — the new tool is written into the module that already exists.
- Steps 6–7 depend on step 5 (the tool name must exist).
- Step 8 depends on steps 5–7.
- Step 9 depends on steps 3–5 (the documented API must be final).
- Steps 10–12 depend on step 5 (the personas reference the tool by name and parameters).
- Step 13 depends on steps 10–12.
- Step 14 is last — the changelog describes what shipped.

## Required Components

**New:**
- `mcp-server/src/tools/work-package-admin.ts` — PM-only work package administration tools (three moved + one new).
- `mcp-server/src/utils/pm-role-guard.ts` — `requirePmRole()` shared authorisation guard.
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — test suite for the new tool.
- `mcp-server/docs/agents/workflow-specification/` — new §12.3c in `operations.md` and new §21.72 in `edge-cases.md` (new sections in existing files).

**Modified:**
- `mcp-server/src/tools/work-package.ts` — guards replaced, three tools removed, `propagateDependencyReblock` exported.
- `mcp-server/src/tools/help-content.ts` — one new `TOOL_HELP` entry, four new overview rows.
- `mcp-server/src/index.ts` — new module registration, `Registered tools:` literal.
- `mcp-server/tests/tools/schema-integrity.test.ts`, `mcp-server/tests/tools/knowledge-help.test.ts`.
- `mcp-server/docs/agents/workflow-specification/README.md`, `data-model.md`, `edge-cases.md`, `operations.md`.
- `mcp-server/docs/agents/project-manifest/api-surface.md`, `constraints-workflow.md`, `file-tree.md`, `data-flows.md`.
- `personas/ledger/src/content/2-project-manager.md` + `personas/ledger/src/meta/2-project-manager.yaml`.
- `personas/ledger-support/src/content/ledger-bootstrapper.md` + `personas/ledger-support/src/meta/ledger-bootstrapper.yaml`.
- `personas/ledger-support/src/content/ledger-doctor.md` + `personas/ledger-support/src/meta/ledger-doctor.yaml`.
- `mcp-server/changelog.md`, `mcp-server/package.json` (via `npm run sync-version`), `personas/changelog.md`, `personas/ledger/src/meta/_shared.yaml`, root `changelog.md`, root `package.json`.
- Generated: `personas/*/{vs-code,claude-code,deep-agents}/`, `personas/name-mapping.json`, `docs/agents-overview.md` (if overview fields change), `.context/`.

## Assumptions

- The MCP server restarts (or is reinstalled) between implementation and any manual verification — a running instance does not pick up new tools.
- `pipeline-configuration.md` remains the authoritative source for a WP's intended stage list; the parity check compares the ledger against it, never the reverse.
- The Ledger Doctor continues to act as `agent_role: "Project Manager"` for repairs, as its own persona states, so it needs no code-level authorisation change.
- No existing ledger data requires migration: both schemas already accept any string array, and the change is to the write path only.

## Constraints

- Cross-platform: Node.js `path` APIs only, no Unix-only shell utilities, no hardcoded separators in tests (root `AGENTS.md` Cross-Platform Policy).
- No `.refine()`, `.transform()`, or `.superRefine()` on the outer tool schema — enforced by `mcp-server/tests/tools/schema-integrity.test.ts`.
- Generated persona output is never hand-edited; changes go through `src/content/` + `src/meta/` and a rebuild.
- The workflow specification is authoritative: where it and the implementation disagree, the implementation is wrong. Its immutability statements must therefore change in the same release as the tool, not after it.
- `mcp-server/src/index.ts`'s `Registered tools:` literal is hand-maintained and test-enforced.

## Out of Scope

- Any GUI control for viewing or editing stage lists beyond the read-only chips that already render.
- Mutating `dependencies`, `acceptance_criteria` structure, or any other creation-time WP field — only `active_pipeline_stages` becomes mutable.
- Server-side validation that a stage list matches the work's actual security surface; that judgement stays with the Ledger Pipeline Configurator.
- Retroactively auditing the WP-005 described in `docs/agents/plans/2026-09-22-pipeline-stage-adjustment/request.md` — this plan supplies the capability; running the belated audit on that project is a separate action.
- Orchestrator (Python) changes — it holds no stage state (`grep` for `active_pipeline_stages` in `orchestrator/` returns nothing).
- Auto-deriving the `Registered tools:` startup literal from a tool registry.

## Acceptance Criteria

- AC-01: `ledger_update_pipeline_stages` is registered, appears in `tools/list` with non-empty `properties`, and is present in the `Registered tools:` startup literal.
- AC-02: A call with `agent_role` other than `Project Manager` is rejected with a PM-only error and performs no write.
- AC-03: A stage list that is empty, contains an unknown stage, contains duplicates, or violates canonical order is rejected with the corresponding `validateActiveStages` error and performs no write.
- AC-04: A valid call on an IN_PROGRESS WP writes the canonically ordered list to both the WP detail and the root-index summary, and `passed_stages` plus `.meta.json` `progress_pct` are recomputed consistently.
- AC-05: Every successful call appends a `pipeline_stages_updated` project comment naming the previous list, the new list, and the supplied reason.
- AC-06: A call on a `CANCELLED` WP is rejected.
- AC-07: A call on a WP with any `IN_PROGRESS` pipeline is rejected, naming the running pipeline type.
- AC-08: A call that removes a stage with a non-`auto_cancelled` pipeline record is rejected; removing a stage that never ran succeeds.
- AC-08b: Removing a never-run stage that `wp.assigned_to`'s role currently owns (via the `PIPELINE_AGENT_MAP` reverse lookup) nulls `wp.assigned_to` and the matching root summary field in the same write; removing a never-run stage that `assigned_to` does not own leaves `assigned_to` unchanged.
- AC-09: A call on a `COMPLETE` WP is rejected with a message naming `ledger_update_work_package_status` (COMPLETE → IN_PROGRESS, `agent: "Project Manager"`) as the prerequisite, and this rejection is reached even when the same requested list would also fail the removal guard (guard 4 — COMPLETE — is now evaluated ahead of guard 6 — removal).
- AC-10: After reopening a formerly COMPLETE WP (4-stage, all PASS) and adding `security-audit`, `ledger_get_next_action` for `Security Auditor` returns `RUN_SECURITY_AUDIT` for that WP, and `ledger_start_pipeline` with `type: "security-audit"` is accepted.
- AC-11: Soft warnings from `validateActiveStages` are returned in the response without blocking the write.
- AC-12: The three pre-existing PM-only tools behave identically after the guard extraction and module split — same tool names, same schemas, same guard messages.
- AC-13: `ledger_help` lists `ledger_update_pipeline_stages` plus the three previously missing PM-only tools in its overview table, and `TOOL_HELP` carries a `# ledger_update_pipeline_stages` entry.
- AC-14: The workflow specification contains no remaining assertion that `active_pipeline_stages` is immutable after creation, is versioned 2.6.0, and specifies the operation as §12.3c with edge case §21.72.
- AC-15: The Ledger Bootstrapper persona performs a stage-parity check against `pipeline-configuration.md` after registration and reports its outcome explicitly; the PM persona's remediation references `ledger_update_pipeline_stages` and no longer instructs WP recreation; the Ledger Doctor persona documents the tool and the reopen-then-restage recipe.
- AC-16: `node scripts/build-personas.js --check` reports no stale generated persona output, and the full `mcp-server` test suite passes.

## Testing Strategy

Vitest, at the tool-handler level against a temporary ledger fixture created with the language's temp-directory API (no hardcoded paths), following the structure of `mcp-server/tests/tools/reopen-cancelled-wp.test.ts`. Each guard gets a rejection test that also asserts the on-disk state is unchanged, since a guard that rejects after a partial write is worse than no guard. The recovery path gets an integration-style test that drives the real sequence — build a COMPLETE 4-stage WP, reopen, re-stage, then assert the routing engine offers the audit — because the value of this feature is that sequence working end to end, not the field changing. The two static-list guards (`schema-integrity`, `tool-log-sync`) are already enforced by existing suites and need only their expectations updated.

## Test Plan

- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — registered tool appears in the captured schema map with non-empty `properties` — AC-01
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — non-PM `agent_role` returns `isError` and the WP file is byte-identical afterwards — AC-02
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — one case each for empty list, unknown stage name, duplicate stage, and out-of-canonical-order list; each returns `isError` and leaves the WP unchanged — AC-03
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — happy path on an IN_PROGRESS WP: detail and summary both carry the canonicalised list, and `passed_stages` matches `computePassedStages` for the new list — AC-04
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — happy path appends exactly one `pipeline_stages_updated` project comment containing both lists and the reason — AC-05
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — CANCELLED WP is rejected — AC-06
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — WP with an IN_PROGRESS `qa` pipeline is rejected and the message names `qa` — AC-07
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — removing `qa` (which has a PASS record) is rejected; removing `documentation` (no record) succeeds — AC-08
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — a WP with `assigned_to: 'QA'` has `qa` removed while never having run (no pipeline record): `assigned_to` and the matching root summary field are both nulled in the same write; a control case removing a different never-run stage while `assigned_to: 'QA'` leaves `assigned_to` unchanged — AC-08b
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — a COMPLETE WP whose requested list also removes an already-passed stage is rejected with the COMPLETE/reopen message, not the removal-guard message, proving guard 4 (COMPLETE) is evaluated ahead of guard 6 (removal) — AC-09
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — COMPLETE WP is rejected and the message names `ledger_update_work_package_status` — AC-09
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — recovery sequence: COMPLETE 4-stage WP with four PASS pipelines → `updateWorkPackageStatus` COMPLETE→IN_PROGRESS as Project Manager → add `security-audit` → `getSecurityAuditorAction` returns `RUN_SECURITY_AUDIT` for that WP → `startPipeline('security-audit')` resolves without error — AC-10
- `mcp-server/tests/tools/update-pipeline-stages.test.ts` — a single-stage list returns the soft warning in `warnings` and still writes — AC-11
- `mcp-server/tests/tools/work-package.test.ts`, `mcp-server/tests/tools/reopen-cancelled-wp.test.ts`, `mcp-server/tests/tools/rework-circuit-breaker.test.ts` — existing suites pass unmodified against the relocated handlers, proving the move was behaviour-preserving — AC-12
- `mcp-server/tests/tools/schema-integrity.test.ts` — `EXPECTED_TOOL_NAMES` includes `ledger_update_pipeline_stages`; the captured schema is a `ZodObject`, not `ZodEffects` — AC-01, AC-12
- `mcp-server/tests/startup/tool-log-sync.test.ts` — the `Registered tools:` literal matches the union of every module's registered names, including the new module — AC-01
- `mcp-server/tests/tools/knowledge-help.test.ts` (extended) — `TOOL_HELP['ledger_update_pipeline_stages']` exists, is non-empty, and contains `# ledger_update_pipeline_stages` — AC-13
- Manual verification recorded in the WP: grep the workflow-specification directory for "immutable" / "cannot be modified" in the `active_pipeline_stages` context and confirm zero remaining hits; confirm README version 2.6.0 — AC-14
- Manual verification recorded in the WP: read the three rebuilt persona outputs and confirm the parity check, the rewritten remediation, and the Doctor recipe are present — AC-15
- `node scripts/build-personas.js --check` and `npm test` in `mcp-server/` — AC-16

## Documentation Updates

- `mcp-server/docs/agents/workflow-specification/edge-cases.md` — §21.55 bullet replaced; new §21.72 "Mid-Flight Pipeline Stage Adjustment"
- `mcp-server/docs/agents/workflow-specification/data-model.md` — routing-optimisation note (L60) and the §3.3 field note amended from immutable to PM-mutable
- `mcp-server/docs/agents/workflow-specification/operations.md` — new §12.3c `updatePipelineStages`
- `mcp-server/docs/agents/workflow-specification/README.md` — version 2.6.0, dated changelog entry
- `mcp-server/docs/agents/project-manifest/api-surface.md` — new `#### ledger_update_pipeline_stages`; internal-function entries for the relocated handlers and `requirePmRole`
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md` — new mutation rule with spec back-link; stage-composability rule amended
- `mcp-server/docs/agents/project-manifest/file-tree.md` — `work-package-admin.ts`, `pm-role-guard.ts`, `update-pipeline-stages.test.ts`
- `mcp-server/docs/agents/project-manifest/data-flows.md` — the stage-mutation write path
- `personas/ledger/src/content/2-project-manager.md` + `.../meta/2-project-manager.yaml` — steps 9–10, `mcp_tools`, changelog
- `personas/ledger-support/src/content/ledger-bootstrapper.md` + `.../meta/ledger-bootstrapper.yaml` — Step 4 parity check, report template, constraint, changelog
- `personas/ledger-support/src/content/ledger-doctor.md` + `.../meta/ledger-doctor.yaml` — toolkit row, repair recipe, changelog
- `mcp-server/changelog.md` + `mcp-server/package.json` (via `npm run sync-version`)
- `personas/changelog.md` + `personas/ledger/src/meta/_shared.yaml` (`default_version`)
- Root `changelog.md` + root `package.json`
- `docs/agents-overview.md` — regenerate via `scripts/generate-agents-overview.js` if any persona overview field changed
- `.context/` — regenerate via `node scripts/cli.js ctx-generate` (`mcp-server/manifest-*`, `mcp-server/workflow-spec-*`, `personas/*`)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Moving three working tools between modules introduces a silent regression** | The move is mechanical and the existing suites (`work-package.test.ts`, `reopen-cancelled-wp.test.ts`, `rework-circuit-breaker.test.ts`) run unmodified against the relocated handlers — AC-12 makes an unchanged-behaviour proof a release condition. The guard extraction lands as a separate step before the move, so a failure points at one change or the other. |
| **A guard rejects after a partial write, leaving the WP inconsistent** | Guards 3–6 throw inside the `updateWorkPackageWithSync` updater, which writes nothing when the updater throws; guards 1–2 run before any I/O. Guard 7's `assigned_to`-nulling mutation runs after guard 6 inside the same updater call, so it either lands atomically with the stage-list write or not at all. Each rejection test asserts the on-disk state is unchanged, not merely that an error came back. |
| **Making the field mutable erodes routing determinism, which the §21.55 immutability rule was protecting** | The capability is PM-only, requires a written reason, is blocked while any pipeline runs, cannot erase executed history, and records an audit comment on every use. The spec revision states the narrowed guarantee explicitly rather than leaving the old one silently false. |
| **The mid-flight replay surprises operators — an added audit re-runs code-review and documentation behind it** | This is correct behaviour (a stage's output must be re-reviewed after a newly inserted upstream stage passes), and it is documented in the new §21.72 and in the tool's help entry, plus asserted end to end by the AC-10 test. |
| **The spec is revised but a stale immutability line survives elsewhere, making the shipped tool "wrong by specification"** | AC-14 makes a zero-hit grep across the specification directory a release condition rather than a reviewer's memory. |
| **Persona edits ship without a rebuild, so the generated agents keep the old instructions** | Step 13 runs the rebuild, and `node scripts/build-personas.js --check` under AC-16 fails on stale output. |
| **The parity check gets skipped in practice because "the stages looked right"** | The Bootstrapper's report template gains an explicit parity slot with a mandatory "none"-style line, following the persona's existing pattern for its Failures and Flagged slots — an unfilled slot is visible rather than absent. |
| **A future stage added to the canonical ordering breaks the removal guard's assumptions** | The guard compares against `wp.pipelines` records rather than a stage allowlist, and validation goes through the manifest-derived `validateActiveStages`, so a new canonical stage is picked up automatically. |
| **Removing a never-run stage that `assigned_to`'s role currently owns leaves the WP with a stale assignment invisible to every role's `ledger_get_next_action` handler** | Guard 7 nulls `wp.assigned_to` (and the matching root summary field) in the same `updateWorkPackageWithSync` write whenever the removed set includes the stage `assigned_to`'s role owns, mirroring the existing precedent at `reopenCancelledWp` (`work-package.ts` L1397) and the IN_PROGRESS → READY transition (`work-package.ts` L887–L896). AC-08b and a dedicated test make this a release condition rather than a discovered-in-production gap. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The change is cross-cutting — authoritative specification, MCP server code, a module split, tests, manifest documentation, and three personas across two suites — and it re-opens a security-gating mechanism, which makes an independent security-audit stage on the tool's guard logic worth having.
