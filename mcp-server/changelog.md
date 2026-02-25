# Project Ledger MCP Server - Changelog

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
