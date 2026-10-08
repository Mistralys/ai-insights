# Research Brief

## Scope Sketch

- Workflow specification — `mcp-server/docs/agents/workflow-specification/` — modification (authoritative; revised first per root `AGENTS.md` "Change workflow logic" row)
- Shared workflow manifest — `shared/workflow-manifest.json` — modification (`spec_version` only)
- Stage validation and fail routing — `mcp-server/src/utils/pipeline-maps.ts` — modification
- WP creation tool — `mcp-server/src/tools/work-package.ts` — modification (schema `.describe()` text only; the call site already enforces `validateActiveStages` errors)
- Other `active_pipeline_stages` writers — `mcp-server/src/storage/ledger-store.ts`, `mcp-server/src/utils/project-reset.ts`, `mcp-server/gui/api.ts` — verification only (no change)
- Tool help — `mcp-server/src/tools/help-content.ts` — modification
- Tests — `mcp-server/tests/utils/pipeline-maps.test.ts`, `mcp-server/tests/tools/work-package.test.ts` — modification
- MCP server manifest — `mcp-server/docs/agents/project-manifest/constraints-workflow.md`, `api-surface.md`, `data-flows.md` — modification
- MCP server release preparation — `mcp-server/changelog.md`, `mcp-server/package.json` — modification
- Generated artefacts — `build/workflow-specification.md` (`scripts/bundle-docs.js`), `.context/` (`node scripts/cli.js ctx-generate`) — regeneration
- Personas — `personas/ledger-support/src/content/ledger-pipeline-configurator.md` etc. — out of scope (follow-up)

## Area: Stage validation and fail routing

### Verified References
- `mcp-server/src/utils/pipeline-maps.ts` (L20–L34): `_roleById` (role id → name), `_SYNTHESIS_ROLE`, `_DEVELOPER_ROLE`, all from `workflowManifest`.
- `pipeline-maps.ts` (L43–L44): `PIPELINE_TYPES` = `workflowManifest.pipelines.canonical_order`; L64 `CANONICAL_PIPELINE_ORDERING = PIPELINE_TYPES`; L72–L73 `DEFAULT_PIPELINE_STAGES` from `pipelines.default_stages`.
- `pipeline-maps.ts` (~L108–L112): `PIPELINE_AGENT_MAP` built from `roles[].pipeline` (non-null) → `roles[].name`.
- `pipeline-maps.ts` (~L160–L163): `AGENT_PIPELINE_MAP` — inverse of `PIPELINE_AGENT_MAP`.
- `pipeline-maps.ts` (L171–L175): `FAIL_AGENT_MAP: Record<PipelineType, string>` from `pipelines.fail_routing` (role id → name, `_DEVELOPER_ROLE` default).
- `pipeline-maps.ts` (L261–L279): `resolveFailAgent(pipelineType, activeStages = DEFAULT_PIPELINE_STAGES)`: `baseAgent = FAIL_AGENT_MAP[type]`; `baseStage = AGENT_PIPELINE_MAP[baseAgent]`; returns `baseAgent` when `!baseStage || activeStages.includes(baseStage)`; otherwise returns `PIPELINE_AGENT_MAP[first active stage in canonical order]`; `_DEVELOPER_ROLE` if none. Note: does **not** check whether `baseStage` is upstream of `pipelineType`.
- `pipeline-maps.ts` (L285–L289): `getOrderedActiveStages(activeStages)`.
- `pipeline-maps.ts` (L360–L429): `validateActiveStages(stages: string[]): { errors; warnings }` — early-return errors in order: empty, invalid types, duplicates, out-of-canonical-order; then warnings: implementation without qa, single-stage, non-default/non-full custom composition. Docblock L352–L359 lists only the first two warnings.
- **Self-loop confirmed:** for `['qa','code-review']`, `resolveFailAgent('qa')` → base `Developer`, `baseStage = 'implementation'` not active → fallback first active stage `qa` → `'QA'`. Same for `code-review` → `'QA'`. Existing test `mcp-server/tests/utils/pipeline-maps.test.ts` L225–L231 asserts `resolveFailAgent('qa', ['qa','code-review']) === 'QA'`; L233–L236 asserts `resolveFailAgent('code-review', ['code-review','documentation']) === 'Reviewer'`.
- [added by: Plan Architect Reviewer, unverified] `pipeline-maps.ts` (L412–L423): custom-composition soft warning in `validateActiveStages`; the `asTyped` canonical-order loop (L394–L409) is the insertion point for the new check.
- [added by: Plan Architect Reviewer, unverified] `shared/workflow-manifest.json` (L112–L119): `pipelines.fail_routing` object (six entries).

- [added by: Plan Auditor, verified by Planner 2026-10-08] `pipeline-maps.ts` (L335, L346): sibling stage helpers are named `firstActiveStage(stages?)` / `lastActiveStage(stages?)` (no `getFirstActiveStage`); `getOrderedActiveStages` L285; `FAIL_ROUTING_MAP` L149 (stage -> role name).
- [added by: Plan Auditor, unverified] `mcp-server/tests/utils/pipeline-maps.test.ts` L452, L460: existing `validateActiveStages(['implementation'])` cases; `mcp-server/tests/utils/workflow-manifest.test.ts` L335: `SPEC_VERSION` parity test.
- [added by: Plan Auditor, unverified] Only `tests/tools/work-package.test.ts`, `multi-store-tool-resolution.test.ts`, `wp-id.test.ts`, `storage/ledger-store.test.ts` import `createWorkPackage`; only work-package.test.ts passes an implementation-less chain through it (L1662, L1726).

### Established Patterns
- All routing constants derive from the manifest with zero hard-coded role strings — module header `pipeline-maps.ts` L1–L11.
- Validators return `{ errors, warnings }` and early-return on the first hard error; caller throws `errors[0]` — `pipeline-maps.ts` L360–L429, `work-package.ts` L362–L368.

### Structural Observations
- `pipeline-maps.ts` L352–L359: `validateActiveStages` docblock omits the custom-composition warning (guardrail 7) that the body emits.
- `pipeline-maps.ts` L248–L260: `resolveFailAgent` docblock presents the fallback as a normal routing rule; nothing marks it as reachable only for chains that validation should reject.

### Constraints
- Manifest (`shared/workflow-manifest.json`): `fail_routing` = implementation→developer, qa→developer, security-audit→developer, code-review→developer, release-engineering→release_engineer, documentation→docs. Every pipeline-owning role owns exactly one stage. `pm` is non-orchestrating with `pipeline: null`; `scripts/validate-workflow-manifest.js` L193–L202 only requires fail_routing values to be non-orchestrating role IDs, so a pipeline-less fail target is structurally possible. `resolveFailAgent` routes such a target directly (no fallback).
- Under the current manifest, the rule "fail target owns an active stage at or upstream of the failing stage" rejects exactly the chains that contain any of `qa`/`security-audit`/`code-review` without `implementation` (28 of 63 canonical subsequences), and accepts 35.

## Area: `active_pipeline_stages` writers

### Verified References
- `mcp-server/src/tools/work-package.ts` (L223–L232): `CreateWorkPackageSchema.active_pipeline_stages` `.describe()` text lists the four structural rules.
- `work-package.ts` (L361–L368): step 5.5 calls `validateActiveStages`, throws `errors[0]`, pushes warnings; (L384–L387) `resolvedActiveStages` defaults to `DEFAULT_PIPELINE_STAGES` when omitted; written to detail (L397) and summary (L422). Only tool that accepts caller-supplied stages.
- `mcp-server/src/storage/ledger-store.ts` (L835, L855): `importStandaloneProject` hard-codes `active_pipeline_stages: ['implementation']` (summary and detail) — satisfies the new rule; used by `mcp-server/src/tools/standalone-import.ts`.
- `mcp-server/src/utils/project-reset.ts` (L132–L334): `active_pipeline_stages` only appears in diagnosis objects (copies of existing stages, `[]` for CANCELLED) — read-only reporting, not a WP write.
- `mcp-server/gui/api.ts` L1331: read-only.
- `orchestrator/src`, `scripts/`: no `active_pipeline_stages` writes (grep).
- `ledger_update_pipeline_stages`: does not exist in `mcp-server/src` (planned by `docs/agents/plans/2026-09-22-p04-pipeline-stage-adjustment/plan.md`, unexecuted; its step 5 handler calls `validateActiveStages` and its guard table row 2 restates the four structural rules; it claims spec v2.6.0 and §21.72).

### Established Patterns
- Read paths never validate: every consumer uses `(wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES` (e.g. `pipeline.ts` L154, L440; `begin-work.ts` L165; `workflow-next-action.ts` L576). Legacy WPs with any stored chain keep routing as today.

### Structural Observations
- `work-package.ts` L223–L232 `.describe()` duplicates the validation rules in prose; it will drift again unless updated with the rule.

### Constraints
- Existing ledgers are not migrated; no validation is added on read paths.

## Area: Workflow specification

### Verified References
- `README.md` L5–L6: **Version 2.5.1**, Date 2026-05-30; changelog per version with section list and new edge cases; L140 "The PM may compose any valid subsequence of the canonical ordering".
- `operations.md` L107–L169: §9b.2 Active Pipeline Stages Validation — Hard Rejects 1–4, Soft Guardrails 5–7, pseudocode `validateActiveStages`, "Removed constraint" note.
- `data-model.md` L84 (§3.3 `active_pipeline_stages` note: "may compose any valid subsequence"); L234 (§4.2 "does not reject any particular subset"); L236–L245 Common composition patterns (all listed patterns remain valid: default, full, documentation-only, verification-only `["implementation","qa","code-review"]`, security-focused, quick fix).
- `pipeline-routing.md` L9–L33 (§8 canonical ordering, "any valid subsequence"); L243–L254 §9.3 FAIL_ROUTING_MAP; L256–L282 §9.3.1 FAIL Routing Fallback, incl. `["qa","code-review"]` → QA example and "Self-referential fallback" note.
- `edge-cases.md`: §21.55 L478–L485 backward compatibility; §21.60 L522–L531 single-stage semantics (FAIL fallback bullet; "Validation" bullet); §21.62 L542 verification-only = `["implementation","qa","code-review"]`; §21.63 L551–L557 FAIL Routing Fallback Semantics (`["qa","code-review"]`, `["qa","code-review","documentation"]` examples); §21.65 L567–L574 Test-Only WP prerequisite (example `["qa","code-review"]`); §21.66 L576 first-active-stage re-engagement loop (example `["qa","code-review"]`); §21.67 L627 First-Active-Stage Self-Rework Deadlock (P4b); last section §21.71 L738.
- `walkthrough.md` L174–L182: Appendix C, row "Create WP | Invalid active stages".

### Established Patterns
- Each version bump adds a README changelog entry naming every section touched and every new §21.x — README v2.4.0–v2.5.1 entries.
- Spec first, then implementation, then tests, then `constraints-workflow.md` — root `AGENTS.md` maintenance table.

### Structural Observations
- §21.63, §21.66 and §21.67 describe behaviour reachable only through implementation-less verifier chains; they become legacy-only once creation rejects those chains.
- §21.65 uses a now-invalid chain as its example.

### Constraints
- Next free edge case is §21.72; next minor spec version is 2.6.0. Both are also claimed by the unexecuted 2026-09-22 plan; this plan runs first, so 09-22 must renumber.

## Area: Shared manifest version drift

### Verified References
- `shared/workflow-manifest.json` L3: `"spec_version": "2.4.1"` — drifted from spec README 2.5.1 (confirmed).
- `mcp-server/src/utils/constants.ts` L123–L125: `SPEC_VERSION = workflowManifest.spec_version`; stamped as `ledger_version` on new ledgers (`project-lifecycle.ts` L442, L679); forward-compat warning compares it (`project-lifecycle.ts` L381–L395).
- `scripts/validate-workflow-manifest.js` L68: only type-checks `spec_version`.

### Constraints
- Tests compare against the `SPEC_VERSION` constant, not a literal (prior verification of `tests/tools/project-lifecycle.test.ts`), so a bump needs no test edits.

## Area: Tool help and MCP manifest docs

### Verified References
- `mcp-server/src/tools/help-content.ts` L62 (common mistake 8: WPs excluding implementation, "test-only, verification-only, or documentation-only"); L66 workflow order step 1; L74 note "For non-standard compositions (e.g., `["qa","code-review"]`), the Reviewer is the terminal agent"; L77–L82 "Rework After Pipeline FAIL"; L228–L267 `ledger_create_work_package` entry — optional-parameter line wrongly says "contiguous subsequence" (gaps are allowed per §9b.2).
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md` L359–L367 composability rule; L371–L389 "`active_pipeline_stages` Validation: Hard and Soft Guardrails" (hard list of 4; soft list of 2, missing custom-composition); L487–L492 handoff routing incl. fallback.
- `mcp-server/docs/agents/project-manifest/api-surface.md` L262–L269 `ledger_create_work_package` guardrails; L3640–L3660 `resolveFailAgent` entry (example `resolveFailAgent('qa', ['documentation'])`); L3715–L3722 `validateActiveStages` entry.
- `mcp-server/docs/agents/project-manifest/data-flows.md` L158–L170 creation flow hard/soft guardrails.

### Constraints
- Root `AGENTS.md` maintenance table: new public helper → `api-surface.md`; constraint change → `constraints-workflow.md`; data-flow change → `data-flows.md`.

## Area: Tests

### Verified References
- `mcp-server/tests/utils/pipeline-maps.test.ts` L200–L242 `resolveFailAgent` block; L390–L476 `validateActiveStages` block — L401–L404 asserts `['qa','code-review','documentation']` has no errors (will change).
- `mcp-server/tests/tools/work-package.test.ts` L1653–L1667 single-stage warning test via `createWorkPackage` with `['qa']` (will now error); L1716–L1735 "accepts verification-only composition ["qa","code-review"]" (must invert).
- Fixture-based legacy tests that write implementation-less chains directly (bypassing creation) and must keep passing unchanged: `tests/tools/pipeline.test.ts` L1832; `tests/tools/begin-work.test.ts` L587; `tests/tools/workflow-next-action.test.ts` L1941–L2158; `tests/tools/workflow-handoff.test.ts` L2344, L2907–L2957, L3096, L3112; `tests/integration/auto-handoff.test.ts` L1067–L1100.
- `mcp-server/package.json`: `"test": "vitest run"`, `"build": "tsc"`.

### Established Patterns
- Vitest `describe`/`it` blocks per exported helper in `tests/utils/pipeline-maps.test.ts`; tool tests call the handler (`createWorkPackage(args, tempDir)`) and inspect `result.isError` / response text.

## Area: Release preparation

### Verified References
- `mcp-server/changelog.md` top entry `v2.11.0`; `mcp-server/package.json` L3 `"version": "2.11.0"`; `scripts/check-version-sync.js` compares the two.
- Root `AGENTS.md` Changelog Convention: `mcp-server/changelog.md` has own SemVer, not Git-tagged.

## Area: Personas (follow-up only)

### Verified References
- `personas/ledger-support/src/content/ledger-pipeline-configurator.md` L90: section "The verification-only chain `["qa", "code-review"]` fits a WP that:" — recommends a chain the new rule rejects.
- **Re-verified 2026-10-08 (design-review integration):** the L90 section above is gone from the persona source. Plan P01 (`docs/agents/plans/2026-10-06-p01-verifier-chain-prevention-personas/`) has landed it: `ledger-pipeline-configurator.md` now carries "### A WP with nothing to author is a decomposition defect" (L94 onward), and `personas/ledger-support/src/meta/ledger-pipeline-configurator.yaml` changelog `1.3.0 (2026-10-06)` reads "Verification-only chain withdrawn". `ledger-wp-decomposer.yaml` `1.9.0 (2026-10-06)` and `personas/ledger/src/meta/2-project-manager.yaml` carry matching entries. No persona source under `personas/*/src/content/` still recommends `["qa","code-review"]`. Whether the rebuilt output is **deployed** to the user's VS Code / Claude Code agent directories cannot be verified from the repository.
- `scripts/install-mcp-global.js` L79–L120 (`_buildShimContent`): the global launch shim spawns `mcp-server/dist/index.js` directly on every server start, with no version pin. Any server process started after `npm run build` loads the new validation. That includes the one a new IDE or Claude Code session spawns, not only a deliberate restart.

### Constraints
- Persona changes are handled separately by the Persona Curator (source changes already landed via P01).
- The new server behaviour reaches live sessions as soon as `mcp-server/dist/` is rebuilt and any new server process starts. Deployed personas must therefore already carry P01 before the run's build step.
