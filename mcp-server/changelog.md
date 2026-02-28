# Project Ledger MCP Server - Changelog

## v1.8.0 - Phase 4: Recommendation Engine Rewrite (2026-02-28)

### Changed

- `src/tools/workflow-next-action.ts` — Full rewrite of all five per-role action functions (`getProjectManagerAction`, `getDeveloperAction`, `getQaAction`, `getReviewerAction`, `getDocumentationAction`) to comply with §14.1–§14.5 of the Agent Workflow Specification. Priority orderings corrected (Developer: `REWORK` now fires before `IMPLEMENT`; Documentation: self-`REWORK` now fires before `WRITE_DOCS`). Removed non-spec action names `RESOLVE_BLOCKERS` (replaced by `UNBLOCK_WP`) and `MARK_COMPLETE` (replaced by `FINALIZE_WP` / `UPDATE_CRITERIA`). All role functions now use `rework_counts[pipelineType]` directly — legacy scalar `rework_count` compat shim removed from Developer priority 1.

### Added

- `src/utils/workflow-helpers.ts` — New `isActivePipeline(wp, type)` helper: returns `true` when a WP has an IN_PROGRESS, non-stale pipeline of the given type. Used by the `CONTINUE_PIPELINE` priority across all four pipeline-owning roles (Developer, QA, Reviewer, Documentation).

- **13 new action types** across all roles:

  | Action | Role | Trigger |
  |--------|------|---------|
  | `UNBLOCK_WP` | PM | BLOCKED WP with non-dependency blocker (`decision`, `external`, `technical`) — replaces `RESOLVE_BLOCKERS` |
  | `REVIEW_REWORK_LIMIT` | PM | Any WP has any `rework_counts[*] >= MAX_REWORK_COUNT` |
  | `REVIEW_STALE` | PM | `extractStalePipelineAction` detects stale IN_PROGRESS pipeline |
  | `REVIEW_ABANDONED` | PM | IN_PROGRESS WP with no active pipeline beyond grace period (via `mostRecentEffectivePipeline` + `status_changed_at`) |
  | `REPAIR_ORPHAN_BLOCKED` | PM | BLOCKED WP with resolved or null blocker (`canStartWorkPackage` returns allowed) |
  | `CONTINUE_PIPELINE` | Developer / QA / Reviewer / Documentation | Active non-stale pipeline of the role's type already in progress (§21.33) |
  | `WAIT_FOR_DOWNSTREAM` | Developer | Downstream FAIL exists but `hasDownstreamReengagedSince("implementation")` is false — developer already re-passed, waiting for QA to re-run |
  | `WAIT_FOR_REWORK` | QA / Reviewer | Most recent pipeline FAIL and upstream has not re-passed since (replaces generic `WAIT`) |
  | `BLOCK_FOR_REWORK_LIMIT` | QA / Reviewer / Documentation | Own rework count at `MAX_REWORK_COUNT` |
  | `WAIT_FOR_UPSTREAM_REWORK_LIMIT` | QA / Reviewer / Documentation | Upstream role's rework count at `MAX_REWORK_COUNT` (circuit-breaker propagation per §21.53) |
  | `FINALIZE_WP` | Documentation | Docs PASS + all acceptance criteria `met: true` + freshness check (`doc.completed_at > impl.started_at`) — replaces `MARK_COMPLETE` with proper conditions |
  | `UPDATE_CRITERIA` | Documentation | Docs PASS + freshness OK but ≥1 criterion has `met: false` or `met` absent |
  | `CLAIM_WP` | QA / Reviewer / Documentation | READY WP assigned to the role with all dependencies satisfied |

- **Priority 4 / 6 split for QA and Reviewer** — re-engagement (priority 4: prior pipeline exists + `hasNewUpstreamPassSince`) is now correctly separated from first-run (priority 6: no prior pipeline + upstream PASS). Previously both code paths were merged.

- **Developer priority 5 temporal guard** — `REWORK` (downstream-triggered) now requires `hasDownstreamReengagedSince("implementation")` to be true; emits `WAIT_FOR_DOWNSTREAM` when the guard is false. This prevents a second rework cycle when the developer has already re-passed and is waiting for QA to pick up the change.

- **`FINALIZE_WP` freshness check** — Documentation compares doc pipeline `completed_at` against the most recent non-auto-cancelled implementation pipeline's `started_at`, not `completed_at`. Catches the case where a late-arriving doc PASS was written before a new rework cycle started.

- **Integration smoke test** — New describe block `"Integration — full pipeline lifecycle (impl → qa-fail → rework → qa-pass)"` added to `tests/tools/workflow-next-action.test.ts`. Exercises 5 lifecycle states × 2 agent perspectives (Developer + QA) = 10 assertions covering the complete rework cycle with inline state-machine timeline documentation.

- **Expanded test suite** — 774 tests total (up from 621 baseline at start of Phase 4; +153 new tests spanning all five roles, all new action types, and all temporal guard edge cases).

### Known Gaps (tracked, non-blocking)

- `workflow-batch-actions.ts` — `buildBatchNextSteps()` has a `default: return []` branch that silently produces empty `next_steps` for unrecognised action types (e.g. `WAIT_FOR_REWORK`, `WAIT_FOR_DOWNSTREAM`, `BLOCK_FOR_REWORK_LIMIT`). These are valid actions that agents may need next-step guidance for. A future improvement should add explicit cases or emit a structured WAIT response with contextual `next_steps`.
- `tests/integration/full-workflow.test.ts` line 922 — Stale comment `// This condition should trigger the MARK_COMPLETE action in getDocumentationAction` references the removed `MARK_COMPLETE` action. Non-functional; should be updated to reference `WRITE_DOCS` + `FINALIZE_WP` flow in a follow-up tidy-up pass.
- `api-surface.md` — New action types from Phases 4–6 are documented in one consolidated pass by the Phase 6 Documentation agent. No manifest update in this phase.

---

## v1.7.0 - Phase 1: Schema & Type Foundations (2026-02-27)

### Changed
- `src/schema/work-package.ts` — `revision` validator changed from `.positive()` to `.nonnegative()` to accept `0` as the initial value per §3.3 and §21.4.
- `src/schema/work-package.ts` — `assigned_to` changed from `z.string()` to `z.string().nullable()` in `WorkPackageDetailSchema` to represent unassigned work packages.
- `src/schema/root-index.ts` — `assigned_to` changed from `z.string()` to `z.string().nullable()` in `WorkPackageSummarySchema`.
- `src/tools/work-package.ts` — `createWorkPackage()` default `revision` changed from `1` to `0`.
- `src/tools/pipeline.ts` — `StartPipelineSchema`, `CancelPipelineSchema`, and `UpdatePipelineProgressSchema` WP ID regex updated from `/^WP-\d{3}$/` to `/^WP-\d{3,}$/` to accept IDs beyond WP-999.
- `src/tools/pipeline.ts` — Rework increment logic now writes both `rework_counts.{type}` (new) and `rework_count` (legacy) simultaneously (dual-write for backward compatibility). Circuit breaker reads effective count as `rework_counts?.implementation ?? rework_count ?? 0`.
- `src/tools/workflow-next-action.ts` — `getDeveloperAction` BLOCK_FOR_REWORK_LIMIT check updated to use same dual-field compatibility pattern.

### Added
- `src/schema/work-package.ts` — `auto_cancelled: z.boolean().optional()` added to `PipelineSchema` (§3.4).
- `src/schema/work-package.ts` — `ReworkCountsSchema` and `ReworkCounts` type added and exported; `rework_counts: ReworkCountsSchema.optional()` added to `WorkPackageDetailSchema`.
- `src/schema/work-package.ts` — `status_changed_at: z.string().optional()` added to `WorkPackageDetailSchema` (§10b.1).
- `src/storage/ledger-store.ts` — `readWorkPackage()` now applies an in-memory backward-compat migration: if a file contains `rework_count` scalar but no `rework_counts` map, synthesises the map and removes the scalar. Migration is in-memory only — no write triggered.
- `src/tools/pipeline.ts` — `_schemas` export added for test-only access to `StartPipelineSchema`, `CancelPipelineSchema`, `UpdatePipelineProgressSchema`.
- `src/tools/work-package.ts` — `_ledgerRoot` test-hook parameter added to `createWorkPackage()` for isolated unit testing (mirrors `propagateDependencyUnblock` pattern).
- `tests/helpers/fixtures.ts` — New shared fixture factory: `makeWorkPackageDetail()`, `makePipeline()`, `makeWorkPackageSummary()` with spec-compliant defaults (`revision: 0`, `assigned_to: 'Developer'`).
- `tests/schema/work-package-schema.test.ts` — 22 new Zod parse-level tests covering `auto_cancelled`, `rework_counts` (full/partial/absent), `rework_count` legacy scalar, `status_changed_at`, `revision: 0`, and `assigned_to: null` on both detail and summary schemas.
- 16 test files bulk-updated: 53 occurrences of `revision: 1` fixture defaults replaced with `revision: 0` (3 intentional exceptions preserved: 2 schema-validity tests, 1 increment-to-2 integration test).

### Known Gaps (Phase 2)
- `CompletePipelineSchema` in `src/tools/pipeline.ts` (line ~234) and `AddObservationSchema` in `src/tools/observations.ts` (line ~21) still use the 3-digit-only pattern `/^WP-\d{3}$/`. This creates a workflow break for projects reaching WP-1000+: a pipeline can be started but not completed, and observations cannot be recorded. Two-line fix; tracked for a Phase 2 micro-WP.

## v1.6.0 - Workflow Specification Audit Fixes (2026-02-26)

### Fixed
- `tsconfig.json` — Added `noEmitOnError: true` to prevent the compiler from emitting JS output when type errors are present (GN-2).
- `workflow-handoff.ts` — Replaced inline `=== 'COMPLETE'` terminal check in `nextAgentFromStatus()` with `isTerminalStatus()`, ensuring `CANCELLED` is treated as a terminal status (GN-1).
- `workflow-batch-actions.ts` — Replaced `allComplete` / `=== 'COMPLETE'` with `allTerminal` / `isTerminalStatus()`; updated reason string to `'All work packages are in a terminal status (COMPLETE or CANCELLED).'` (GN-1).
- `work-package.ts` — Added override authorization guard in `claimWorkPackage`: `override: true` is now rejected for any caller who is neither `"Project Manager"` nor the current `wp.assigned_to`, with a hard error message (GN-5).
- `work-package.ts` — Updated three WP ID Zod schemas (`GetWorkPackageSchema`, `CreateWorkPackageSchema` dependencies, `ClaimWorkPackageSchema`) from `/^WP-\d{3}$/` to `/^WP-\d{3,}$/` to accept IDs beyond `WP-999` (GN-3).
- `project-lifecycle.ts` — Wrapped `completeSynthesis` read-modify-write sequence in `withLock(store.storageDir, ...)` for race-condition compliance (GN-4).

### Added
- 16 new tests across 3 test files (505 total, up from 489):
  - `workflow-handoff.test.ts`: `CANCELLED` pipeline status returns `null` from `nextAgentFromStatus`.
  - `workflow-batch-actions.test.ts` (**new file**): 4 tests for all-CANCELLED terminal short-circuit and updated reason string.
  - `work-package.test.ts`: 5 override authorization guard tests (PM allowed, assignee allowed, third-party rejected); 6 WP ID regex schema tests (`WP-1000` accepted, `WP-10` rejected across all three updated schemas).

### Documentation
- `tech-stack.md` — Added `npm run build` to the Build & Test command table; documented `noEmitOnError: true` under Key Conventions.
- `api-surface.md` — Updated `nextAgentFromStatus()` return-value semantics; extended `ledger_claim_work_package` description with override authorization enforcement.
- `constraints.md` — Fixed constraint #8 WP ID regex to `/^WP-\d{3,}$/`; updated constraint #14 override Authorization to reflect code enforcement; added Extension to constraint #2 covering single-file read-modify-write locking; added Gotcha 12 (`updateWorkPackageWithSync` outer-scope `let` hoisting pattern).
- `data-flows.md` — Updated Flow 12 (Synthesis Completion) to show the `withLock` wrapper and `let result!` hoisting pattern.
- `AGENTS.md` — Added Critical Constraints row #11 for the `updateWorkPackageWithSync` hoisting convention.
- `file-tree.md` — Added `workflow-batch-actions.test.ts` to the `tests/tools/` listing.

## v1.5.1 - Constraint Numbering Cleanup (2026-02-23)

### Changed
- `mcp-server/docs/agents/project-manifest/constraints.md`: renumbered all constraints from a mixed alphabetic-suffix scheme (3a/3b/3c, 9a/9b, 13a–13d, duplicate section numbers) to a clean sequential 1–38 global sequence. Constraint text is unchanged.
- `mcp-server/docs/agents/project-manifest/api-surface.md`: updated cross-reference from `constraint 9b` to `constraint 14` to match the new numbering.

## v1.5.0 - Centralized Ledger Storage (2026-02-20)

### Added
- `ProjectMetaSchema`, `resolveLedgerRoot()`, and `projectSlugFromPath()` utilities
- `LedgerStore` stores files in `{ledgerRoot}/{slug}/`; `.meta.json` CRUD + auto-sync
- `ledger_list_projects` tool; `initializeProject` writes `.meta.json` on creation
- Ledger root created at startup via `--ledger-dir`; `storage/ledger/.gitkeep` added
- `help.ts` updated for central storage paths and `ledger_list_projects` docs
- 30+ tests for schema, meta sync, ledger-root, and path-validator
- Project manifest, README, and `.gitignore` updated for centralized storage

## v1.4.3 - Strategic Recommendations (2026-02-20)

### Changed
- Enabled `noUncheckedIndexedAccess`; resolved 6 narrowing errors across 4 files
- Replaced `_internal` object with direct named exports; tests use namespace import
- `check-known-roles.js` — unified parse helper; dotAll regex for multiline arrays
- Migrated `stderrSpy` setup to `beforeEach`/`afterEach` in agent-registry tests
- Added `@param strict` JSDoc to `discoverAgents()`

## v1.4.2 - Gold Nuggets Housekeeping (2026-02-20)

### Changed
- `workflow.ts` imports `AgentRole` from `constants.ts`; removed local re-derivation
- Standardized `[agent-registry]` log prefix across all `stderr` calls
- Split `.toMatch(/Dev A|Dev Z/)` into two independent assertions in tests
- Differentiated two identical `storage error` catch-block labels in `workflow.ts`
- Reordered `data-flows.md` flow sections to strict ascending numeric order (1–13)

## v1.4.1 - Synthesis Next Steps (2026-02-20)

### Added
- New `src/utils/constants.ts` — canonical `AGENT_ROLES` array and `AgentRole` type
- `sync-personas.js` warns when a `role:` value is absent from `KNOWN_ROLES`
- `data-flows.md` — new Flow 13 documenting `auto_handoff_depth` lifecycle
- `discoverAgents()` gains optional `strict` param; role-collision warning added

### Fixed
- Silent `catch {}` in `buildHandoffResponse` replaced with `stderr` logging
- Fixed TS7053 in `getNextActions` by casting `pipelineType as PostImplPipelineType`
- `validatePlanPath` normalizes backslashes before `basename()` for cross-platform use

## v1.4.0 - Automatic Handoffs (2026-02-20)

### Added
- `role:` field added to YAML frontmatter of all 7 ledger personas
- New `src/utils/agent-registry.ts` — discovers agents and builds role→handle map
- `--agents-dir` CLI flag; auto-detects VS Code User prompts folder per platform
- `auto_handoff_depth` counter on root index; capped at `MAX_HANDOFF_DEPTH = 10`
- `ledger_get_handoff_status` returns `auto_handoff` object when next agent resolves
- Personas 2–7 updated with auto-handoff logic using `runSubagent`
- Unit tests for agent registry (discovery, role lookup, error paths, reset)
- Unit tests for auto-handoff block in `buildHandoffResponse`
- 23 integration tests — full chain, depth limit, rework cycle, graceful degradation
- `sync-personas.js` warns when a ledger persona is missing its `role:` field

## v1.3.2 - Micro Debt Followup (2026-02-18)

### Changed
- Derived `AGENT_PIPELINE_MAP` via `Object.fromEntries`; introduced `PipelineType` union
- Added UTC-trap comment to `now()` in `timestamp.ts`
- Hoisted and relocated `_internal`-related maps in `workflow.ts`
- Added inline comment noting manual tool-list sync requirement in `index.ts`
- Updated `api-surface.md` to document `PipelineType`

## v1.3.1 - Technical Debt Remediation (2026-02-18)

### Changed
- Extracted pipeline routing constants into `src/utils/pipeline-maps.ts`
- `now()` returns ISO 8601 T-format; added `parseTimestamp()` for backward compat
- Added `extractStalePipelineAction()` and `extractReworkAction()` to `workflow.ts`
- Added DESIGN NOTE explaining the two-lock pattern in `updateWorkPackageStatus`
- Minor refinements: cross-ref comments, reduce-based max, `.at(-1)` cleanup

## v1.3.0 - Workflow Hardening (2026-02-17)

### Added
- `rework_count` on `WorkPackageDetail`; `ledger_update_pipeline_progress` tool
- `handoff_notes` on `ledger_complete_pipeline`; `HandoffNote` schema
- `ledger_get_next_actions` (plural) tool; `getHandoffNotesForAgent` helper

### Changed
- `isMostRecentPipelineFail` — rework only triggers on the most recent FAIL
- `ledger_claim_work_package` validates all dependencies are COMPLETE first
- `ledger_start_pipeline` enforces ordering and auto-updates `assigned_to`
- COMPLETE transition triggers `propagateDependencyUnblock` for downstream WPs

### Fixed
- `ledger_get_handoff_status` BLOCKED check now only fires when ALL WPs are blocked
- Documentation agent now routes correctly when some WPs are COMPLETE and others BLOCKED

## v1.2.2 - Reviewer Dependency-Aware Handoff

### Fixed
- Reviewer checks if remaining WPs are ready or blocked before deciding handoff target
- When all remaining WPs are blocked, Reviewer hands to Documentation instead of Developer

## v1.2.1 - Handoff Logic Fix

### Fixed
- QA no longer hands off to Reviewer when open Developer packages remain

## v1.2.0 - Property Handling

### Changed
- Tools accept additional properties to tolerate unneeded metadata from weaker models

## v1.1.0 - Help Tool

### Added
- New `ledger_help` tool; improved descriptions on all tools

## v1.0.1 - Version Information

### Added
- Server logs its version at startup; `sync-version.js` syncs `package.json` from changelog

### Fixed
- `ledger_get_handoff_status` BLOCKED status now requires ALL work packages to be blocked

## v1.0.0 - Initial Release

- Initial release with the first 13 tools
