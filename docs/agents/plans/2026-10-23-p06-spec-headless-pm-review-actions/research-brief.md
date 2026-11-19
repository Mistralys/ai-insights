# Research Brief

Input: `docs/agents/projects/revise-specification.md` (the "Spec Amendment Brief", final after three review rounds, 2026-10-23), which is the output of the review briefing `docs/agents/projects/abandoned-review.md`. All facts below were verified against the v2.9.0 split specification files on 2026-10-23.

## Scope Sketch

- Workflow specification — `mcp-server/docs/agents/workflow-specification/` — modification (all five changes of the amendment brief, plus version bump)
- Shared workflow manifest — `shared/workflow-manifest.json` — modification (`spec_version` only)
- Module and root changelogs — `mcp-server/changelog.md`, `changelog.md` — modification (one Docs bullet each in the open WIP entries)
- Generated context — `.context/mcp-server/workflow-spec-*.md` — regeneration (derived from the spec files)
- MCP server project manifest — `mcp-server/docs/agents/project-manifest/constraints-workflow.md` — examined; **not changed** (see Constraints in Area 8)
- Superseded plan — `docs/agents/plans/2026-10-06-p05-headless-pm-review-actions/` — examined; retired by the user, not edited by this plan

## Area 1: Recommendation Engine (`recommendations.md`, 462 lines)

### Verified References
- `recommendations.md` L39–L112: §14.1.2 Project Manager Action Logic. Priority list L43–L52 (1 `UNBLOCK_WP`, 2 `REVIEW_REWORK_LIMIT`, 3 `REVIEW_STALE`, 3b `REVIEW_ABANDONED`, 3c `REPAIR_ORPHAN_BLOCKED`, 3d `ROUTE_PIPELINE_AGENT`, 4 `CREATE_WORK_PACKAGES`, 5 `WAIT`). Pseudocode L54–L106: 3b block evaluated before 3c and 3d; it returns `REVIEW_ABANDONED with wp.id, wp.assigned_to`. 3d walk: PASS → continue; FAIL → break (FAIL routing handled by the downstream agent); IN_PROGRESS → break; upstream IN_PROGRESS → break; else `return ROUTE_PIPELINE_AGENT with wp.id, stage, nextAgent`.
- `recommendations.md` L108: "Priority 3b notes" (grace period, `root.last_updated` fallback, `mostRecentEffectivePipeline` excludes auto-cancelled). L110: "Priority 3c notes".
- `recommendations.md` L114–L188: §14.2 Developer (priority 1 `BLOCK_FOR_REWORK_LIMIT`, 2 `RESUME_OR_CANCEL`, 3 `CONTINUE_PIPELINE`, 4 `REWORK` direct, 5 `REWORK` downstream, 5b `WAIT_FOR_DOWNSTREAM`, 6 `IMPLEMENT`, 7 `CLAIM_WP` "unassigned or assigned to Developer"). §14.3 QA L190, §14.4 Reviewer L210, §14.5 Documentation L228 (priority 5b `UPDATE_CRITERIA`, which tells the Documentation agent to set a `technical` blocker when unmet criteria are caused by code), §14.5a L249, §14.5b Security Auditor L258, §14.5c Release Engineer L278. Assignment is consulted **only** in each engine's `CLAIM_WP` priority.
- `recommendations.md` L358: §14.8 Stale Pipeline Detection (`STALE_PIPELINE_HOURS = 24`). L374: §14.9 Batch Actions — a single sentence ("Same logic as single next-action, but collects all matching WPs…"); it enumerates no fields. L389 §14.11 `mostRecentEffectivePipeline`, L403 §14.12 `wpClaimedDuration`, L425 §14.13 `hasDownstreamReengagedSince` (the last section; §14.14 is free).

### Established Patterns
- Helper algorithms are numbered `### 14.N \`name\` Algorithm` with a pseudocode fence — `recommendations.md` §14.6, §14.7, §14.11–§14.13.
- Priority sub-items use letter suffixes (3b, 3c, 3d, 5b) with no renumbering; evaluation order is expressed in pseudocode comments — `recommendations.md` L46–L49, L68.
- Action payload fields are named in the priority-list prose and the pseudocode `return … with …` line — `recommendations.md` L44 (`REVIEW_REWORK_LIMIT` payload, added in v2.8.0).

### Structural Observations
- `recommendations.md` §14.1.2: 3b is evaluated before 3d, so an idle-but-routable WP gets `REVIEW_ABANDONED` instead of `ROUTE_PIPELINE_AGENT`.
- `recommendations.md` §14.2–§14.5c: every role engine repeats the same priority skeleton by prose ("Same priority pattern as Developer…"). A new priority must be added to each of the six engines individually; there is no shared "common role priorities" section.
- `recommendations.md` §14.5 / §14.5a: `FINALIZE_WP` has no condition that would stop finalisation while a targeted rework is pending (the field does not exist yet).

### Constraints
- No new action names (amendment brief, "Machine-readable vocabulary"). A targeted rework is emitted as the existing `REWORK` action.

## Area 2: Operations (`operations.md`, 1065 lines)

### Verified References
- `operations.md` L107: §9b.2 Active Pipeline Stages Validation. Rules: L28-of-section Rule 1 valid types, Rule 2 subsequence of canonical ordering, Rule 3 no duplicates, Rule 4 non-empty, Rule 5 fail-route coverage. L72: "Stored chains are never re-validated on read" — legacy chains keep whatever chain they were given (§21.72).
- `operations.md` L441–L568: §11.1 `startPipeline` algorithm. L469 re-validation guard. L530–L550: rework branch `isDirectRework` / `isDownstreamRework` → increment `counts[pipelineType]`, then circuit breaker (`if counts[pipelineType] >= MAX_REWORK_COUNT` → persist if crossing from below, `ERROR("Rework limit reached…")`). L561: "Auto-update assigned agent".
- `operations.md` L569: §11.1.1 Re-Validation Guard. L611–L615: §11.1.2 Agent Role Validation — one bullet only (PM override). L617–L634: §11.2 Rework Count Semantics table (None / PASS no downstream FAIL / PASS downstream FAIL → +1 / PASS downstream IN_PROGRESS / FAIL → +1 / IN_PROGRESS → cannot start). L636: §11.3.
- `operations.md` L894: §12.3c `updatePipelineStages` (the PM's repair path for active stages).

### Established Patterns
- Guards and branch conditions are written inline in the §11.1 pseudocode with `// Guard:` comments — `operations.md` L469–L550.

### Structural Observations
- `operations.md` §11.1 rework branch: two boolean predicates feed one increment; a third predicate (`isTargetedRework`) fits the same branch without a new path.

### Constraints
- The refused start persists the incremented count and creates no pipeline (§21.74); any clearing of a new field must happen only on pipeline creation.

## Area 3: Data Model and State Machines (`data-model.md` 247 lines, `state-machines.md` 253 lines)

### Verified References
- `data-model.md` L63–L81: §3.3 Work Package Detail (`WorkPackageDetail { … blocked_by: Blocker?, … rework_counts: ReworkCounts?, active_pipeline_stages: PipelineType[]?, status_changed_at, handoff_notes, pipelines }`). L113: §3.5 Supporting Types; L121–L125 `Blocker { type, description, blocking_work_package? }`; L127 `BlockerType = "dependency" | "decision" | "external" | "technical"`. §4 (L188) is Agent Roles.
- `state-machines.md` L66–L139: §6.2 Transition Table (box-drawing table). Relevant rows: `IN_PROGRESS → COMPLETE` (criteria, last-active-stage PASS, freshness, last-stage agent), `IN_PROGRESS → READY` ("Clears assigned_to"), `IN_PROGRESS → BLOCKED` ("All IN_PROGRESS pipelines set to FAIL (with auto_cancelled = true)"), `BLOCKED → IN_PROGRESS` ("PM, current assignee, or system; Clears blocked_by field"), `BLOCKED → READY` ("System-only (auto-unblock path from §15.4); Clears blocked_by field"), `COMPLETE → IN_PROGRESS` (reopen; resets `rework_counts`). L190: summary line "IN_PROGRESS → … BLOCKED (any agent; requires blocker; auto-cancels pipelines)". L141 §6.2.1, L195 §6.4, L207 §6.5.

### Established Patterns
- Side effects of a transition are listed as extra lines in the row's "Conditions & Guards" cell — `state-machines.md` L83–L86, L98–L104.
- Optional data-model fields carry a trailing `//` comment naming their section — `data-model.md` L73–L80.

### Structural Observations
- `state-machines.md` §6.2: two transitions reach READY (`IN_PROGRESS → READY`, `BLOCKED → READY`). A routing field that must not survive a return to READY must be cleared on both.
- `state-machines.md` §6.2 `IN_PROGRESS → COMPLETE`: no guard covers "a rework instruction is still pending".

### Constraints
- Backward compatibility: new fields must be optional and absent on existing ledgers (minor bump).

## Area 4: Pipeline Routing and Handoff (`pipeline-routing.md` 297 lines, `handoff.md` 419 lines)

### Verified References
- `pipeline-routing.md` L243: §9.3 `FAIL_ROUTING_MAP`; L256 §9.3.1 `resolveFailAgent` — never returns null (falls back to `PIPELINE_AGENT_MAP[activeStages[0]]`), fallback reachable only for pre-v2.6.0 chains; escalation note: Release Engineer sets a `technical` blocker for code-caused failures.
- `handoff.md` L11: §13.1 Per-Agent Handoff Functions; L307 PM handoff "Step 2b: IN_PROGRESS WPs needing next pipeline stage"; L380 design note (pipeline blindness); L382 design note (freshly-claimed WP coverage) — says step 2b routes "rather than waiting for the abandoned threshold".

### Established Patterns
- §13.1 step 2b and §14.1.2 3d share their guards and are documented as "identical" — `edge-cases.md` §21.70 L728.

### Structural Observations
- `handoff.md` step 2b and `recommendations.md` 3d duplicate the same walk in two places; any routing change (targeted rework) must be applied to both.

### Constraints
- None beyond the shared-guard rule above.

## Area 5: Dependencies and Rework (`dependencies-and-rework.md`, 392 lines)

### Verified References
- `dependencies-and-rework.md` L77: §15.4 Automatic Unblocking; L117: "⚠ Stuck-agent limitation" paragraph — "The WP will eventually be surfaced via the PM's `REVIEW_ABANDONED` action … but this requires the staleness threshold to elapse. Implementations … MAY … proactively unclaim the WP."
- `dependencies-and-rework.md` L239–L252: §16.3 Circuit Breaker (`MAX_REWORK_COUNT = 5`, per pipeline type). L254 §16.3b. L293–L311 §16.3c (numbered surrogate steps 1–3, Rationale, "PM reset as alternative", "Halted WPs and synthesis", Related sections). L313 §16.3d. L335 §16.4. §16.3e is free.

### Established Patterns
- Headless rules: the orchestrator acts with `agent_role: "Project Manager"`, logs, comments best-effort, re-queries — `dependencies-and-rework.md` §16.3c.

### Structural Observations
- `dependencies-and-rework.md` §16.3c is specific to `REVIEW_REWORK_LIMIT`; no generalised headless matrix exists for the other PM actions.

### Constraints
- `REPAIR_TIMESTAMPS` (`walkthrough.md` L171, `edge-cases.md` L171) is an optional (SHOULD) PM action that the amendment brief's §16.3e matrix does not list.

## Area 6: Edge Cases (`edge-cases.md`, 873 lines)

### Verified References
- §21.11 L109, §21.12 L113, §21.13 L117, §21.18 L164 (null timestamps; L171 mitigation names `REVIEW_STALE` / `REVIEW_ABANDONED` and `REPAIR_TIMESTAMPS`), §21.19 L173, §21.20 L180, §21.24 L209 (L214 links `[§21.43](#2143-post-technical-blocker-unblock-routing)`), §21.27 L231, §21.39 L325 (last bullet: "PM can then either re-claim … or unclaim"), §21.40 L333 "Abandoned WP Detection (Claimed but No Pipeline)" (bullet (b) "override-claim on behalf of a different agent"), §21.43 L361 (PM must coordinate rework manually), §21.49 L418 (two ⚠ bullets: "dead-end", "permanent dead-end until the PM is externally restarted"), §21.68 L690 (L712 recommends an orchestrator-level crash-recovery cap), §21.70 L728 (scenario b "rather than waiting for the `REVIEW_ABANDONED` staleness threshold"; L746 related-sections line), §21.72 L779, §21.74 L822, §21.75 L834 (last; §21.76 is free).

### Established Patterns
- New edge cases start with `**Introduced:** spec vX.Y.Z, …` and end with a `**Related:**` line — `edge-cases.md` §21.74 L822–L832.
- Anchors are GitHub-style slugs of the full heading text (e.g. `#2143-post-technical-blocker-unblock-routing`).

### Structural Observations
- `edge-cases.md` §21.40 and §21.43: the amendment brief retitles both headings. Retitling changes their anchors, and `edge-cases.md` L214 and L746 link to them by anchor.
- Repository-wide search (design-review integration, 2026-10-23) for the anchors `#2140-abandoned-wp-detection-claimed-but-no-pipeline` and `#2143-post-technical-blocker-unblock-routing`, and for the heading texts, outside `docs/agents/plans/` and `node_modules`: the only hits are `edge-cases.md` L214 and L746, their regenerated copies in `.context/mcp-server/workflow-spec-edge-cases.md` (L233, L765), and the amendment brief `docs/agents/projects/revise-specification.md` (which proposes the retitles: L172 "Abandoned WP Detection (No Derivable Next Actor)", L244 "Post-Technical-Blocker Unblock Routing (untargeted blockers)"). No source, test, persona or manifest file links to either anchor.

### Constraints
- Preserve existing anchors (amendment brief constraint, `revise-specification.md` L32: "Preserve existing cross-reference anchors"). The brief itself retitles §21.40 and §21.43, so the constraint is read as "every existing cross-reference keeps resolving", which repairing the two in-file links satisfies.

## Area 7: Walkthrough and README (`walkthrough.md` 220 lines, `README.md` 227 lines)

### Verified References
- `walkthrough.md` L135–L143: Appendix A Constant Reference (`DEFAULT_PIPELINE_STAGES`, `CANONICAL_PIPELINE_ORDERING`, `STALE_PIPELINE_HOURS` 24, `MAX_REWORK_COUNT` 5, `MAX_HANDOFF_DEPTH` 50). L145–L172: Appendix B Action Types Reference (columns Action / Emitted By / Meaning; no `ROUTE_PIPELINE_AGENT` row; `REWORK` row "Developer/Documentation/Release Engineer"; `UNBLOCK_WP`, `REVIEW_STALE`, `REVIEW_ABANDONED` rows). L174–L212: Appendix C Error Conditions Summary (`Update Status | Missing blocker` row exists). L213: Soft Warnings.
- `README.md` L5–L6: `**Version:** 2.9.0`, `**Date:** 2026-10-16`. L10–L109: Changelog, newest first, `### vX.Y.Z - Title` with bold-lead bullets naming sections. L111–L124: Table of Contents (per **document**, not per section). L128–L162: Quick Section Reference (per **top-level §** only: 1–22, A–C). L186–L204: Machine-Readable Vocabulary. L220–L227: Compliance Model Rules 1–6.

### Established Patterns
- Changelog entry shape — `README.md` v2.8.0 / v2.9.0 entries.

### Structural Observations
- `README.md`: TOC and Quick Section Reference list documents and top-level sections only. New sub-sections §14.14 and §16.3e fall under existing rows (§14, §16) and need no new rows — the amendment brief's instruction to add them is inapplicable.

### Constraints
- `mcp-server/tests/utils/workflow-manifest.test.ts` L343–L357 asserts that `shared/workflow-manifest.json` `spec_version` equals the README `**Version:**` line; L338–L341 asserts `SPEC_VERSION` equals the manifest.

## Area 8: Shared Manifest, Project Manifest, Changelogs, Generated Context

### Verified References
- `shared/workflow-manifest.json`: keys `$schema, spec_version ("2.9.0"), roles, pipelines, statuses, constants`. `constants = { max_rework_count: 5, stale_pipeline_hours: 24, max_handoff_depth: 100, handoff_depth_multiplier: 30 }`.
- `shared/workflow-manifest.schema.json`: `constants` is `additionalProperties: false` with all four keys required. `scripts/validate-workflow-manifest.js` L229–L237 checks those four keys. Consumers: `orchestrator/src/config.py` L170 (`MAX_REWORK_COUNT` from `constants.max_rework_count`); `mcp-server` constants via `tests/utils/workflow-manifest.test.ts` parity tests.
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md` L3–L9: "records only what the specification does not: which function enforces a rule, what error text it emits"; L232–L254 already documents that `ledger_begin_work` admits the pipeline-type owner on an IN_PROGRESS WP (`isPipelineOwner` in `src/tools/begin-work.ts`).
- `README.md` (spec) Compliance Rule 6: "the manifest is updated to reflect the new implementation — in that order". Root `AGENTS.md` Manifest Maintenance Rules: workflow-logic changes go spec → code → tests → `constraints-workflow.md`.
- `mcp-server/changelog.md` top entry `## v2.14.0 - **WIP; UNRELEASED** - …` with `Docs:` bullets; root `changelog.md` top entry `## v2.17.0 - **WIP; UNRELEASED** - …` (`> mcp v2.14.0 · orchestrator v1.6.0`).
- `mcp-server/module-context.yaml` L162–L205: several documents take `sourcePaths: [ docs/agents/workflow-specification ]`, producing `.context/mcp-server/workflow-spec-state.md`, `workflow-spec-operations.md`, `workflow-spec-edge-cases.md`. Regenerate with `node scripts/cli.js ctx-generate` (check with `--check`).
- Current branch: `feature-pipeline-adjustments` (not the default branch).

### Established Patterns
- Spec-only changes are recorded as a `Docs: Workflow specification …` bullet in `mcp-server/changelog.md` — v2.13.0 and earlier entries.

### Structural Observations
- `shared/workflow-manifest.json` `constants` mirrors the spec's Appendix A constants. The new `MAX_DISPATCHES_WITHOUT_PROGRESS` has no consumer until the orchestrator implementation lands.
- `walkthrough.md` Appendix A says `MAX_HANDOFF_DEPTH` 50, and `auxiliary-systems.md` L93 says `MAX_HANDOFF_DEPTH = 50 // Static floor`, but the manifest holds `max_handoff_depth: 100`. That is a pre-existing spec-vs-manifest divergence, outside this amendment's topic.

### Constraints
- `constraints-workflow.md` documents the implementation. This plan changes no code, so editing it now would describe behaviour the server does not have yet.
- Generated-artefact policy (root `AGENTS.md` → Generated Artefacts): when a branch changes the source of a generated file, keep the file, regenerate it, and commit it with the source. Commit handling belongs to the Git Committer, not to this plan.

## Area 9: Superseded Plan P05 and Downstream Consumers (examined, not changed)

### Verified References
- `docs/agents/plans/2026-10-06-p05-headless-pm-review-actions/plan.md`: never executed (no ledger project). It expects to take spec v2.10.0 and §21.76. It prescribes `UNBLOCK_WP` → cancel and `REVIEW_ABANDONED` → defer plus a safety-net cancel. Both contradict the amended §16.3e (decision/external/untargeted technical → fatal; `REVIEW_ABANDONED` → fatal). The user retired it on 2026-10-23.
- Files that reference behaviour this amendment changes (implementation follow-ups, not edited here): `mcp-server/src/tools/workflow-next-action.ts`, `mcp-server/src/tools/workflow-next-action-batch.ts`, `orchestrator/src/supervisor.py` (L50–L58 `_SKIP_ACTIONS` includes `BLOCK_FOR_REWORK_LIMIT`), `orchestrator/docs/supervisor-routing.md`, `mcp-server/docs/agents/project-manifest/api-surface.md`, `mcp-server/docs/agents/project-manifest/data-flows.md`, `personas/ledger-support/src/content/ledger-doctor.md` (Repair 10).

### Established Patterns
- None (examination only).

### Constraints
- The user owns retiring the P05 folder.

## Strategic Context

- Strategic vision, long-term secondary goal: "Make the project as reliable as possible … operationally for the orchestrator headless workflow." This amendment closes the last PM actions that have no headless rule.
- Prior projects: P02 (v2.6.0, Rule 5 fail-route coverage), P03 (v2.8.0, persisted refused start + §16.3c headless rework limit), P04 (v2.9.0, `ledger_update_pipeline_stages` = §12.3c, the repair path §21.40 now prescribes). Each was spec-first, with implementation in the same or a later plan.
- Insight `5e041ed3-319a-40db-8a06-d92ebd2ade1e` ("When a guard refuses an operation, persist the state change the refusal implies"): supports keeping `rework_requested` on a refused start, so the persisted count drives `REVIEW_REWORK_LIMIT`.
- Insight `5571cd45-2bd3-41eb-8a7a-426064d87b8b` ("consecutive, not cumulative failure counter"): matches the "consecutive dispatches without progress" wording of `MAX_DISPATCHES_WITHOUT_PROGRESS`.
- Insight `1334b750-0b17-4424-90e9-4cf1f8b26784` ("…without renaming _handle_rework_limit — P05 depends on the name"): its stated reason ends with P05's retirement.
- Insight `53454e24-4329-4946-ab9f-3b94cd682f17`: regenerate `.context/` with `node scripts/cli.js ctx-generate` after editing sources it covers.
