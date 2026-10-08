# Plan

## Plan Audit Cycles
- Audits: 1 (Sonnet 5.5 ×1) — Plan Auditor v1.11.0
- Architectural Reviews: 1 (Sonnet 5.5 ×1) — Plan Architect Reviewer v2.3.4

## Summary

A work package whose pipeline chain contains a verifier stage but no stage able to fix what that verifier flags is a decomposition defect. Today the ledger accepts such a chain and `resolveFailAgent()` then routes the verifier's FAIL to the first active stage. For `["qa","code-review"]` that is QA itself, so the loop is bounded only by `max_rework_count`. This plan adds one mechanical backstop: `validateActiveStages()` rejects any chain where a stage's FAIL target (from `pipelines.fail_routing`) owns no active stage at or upstream of the failing stage. A persona slip then shows up as an error when the WP is created, not as a loop at run time. The rule is derived entirely from the manifest. Existing WPs are not re-validated and keep routing exactly as today. The workflow specification is revised first (v2.5.1 → 2.6.0, new §21.72). Tool help, manifest docs and tests follow, and the drifted manifest `spec_version` is realigned.

## Architectural Context

- **Manifest as single source of truth:** `shared/workflow-manifest.json` defines `pipelines.canonical_order`, `pipelines.fail_routing` (stage → role id) and `roles[].pipeline` (role → owned stage). `mcp-server/src/utils/pipeline-maps.ts` derives `CANONICAL_PIPELINE_ORDERING`, `PIPELINE_AGENT_MAP`, `AGENT_PIPELINE_MAP` and `FAIL_AGENT_MAP` from it and contains no hard-coded role strings.
- **Validation seam:** `validateActiveStages(stages: string[]): { errors; warnings }` (`pipeline-maps.ts` L360–L429). It early-returns the first hard error and lets the caller throw `errors[0]`. Its only caller is `createWorkPackage` step 5.5 (`mcp-server/src/tools/work-package.ts` L361–L368).
- **Other writers:** `LedgerStore.importStandaloneProject` (`mcp-server/src/storage/ledger-store.ts` L835, L855) hard-codes `['implementation']`, which satisfies the new rule. `mcp-server/src/utils/project-reset.ts` and `mcp-server/gui/api.ts` only read stages. Read paths never validate. They use `wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES`, so legacy WPs are unaffected by a create-time rule.
- **Fail routing:** `resolveFailAgent()` (`pipeline-maps.ts` L261–L279) returns the manifest target when its stage is active. Otherwise it falls back to the first active stage's owner. That fallback is the only way a verifier gets routed to itself. The recommendation engine's P4b self-rework (spec §21.67) exists only to keep those chains from deadlocking.
- **Specification:** `mcp-server/docs/agents/workflow-specification/` is authoritative. §9b.2 (`operations.md`) defines validation. §9.3.1 (`pipeline-routing.md`) defines the fallback. §21.60/§21.63/§21.65–§21.67 (`edge-cases.md`) describe implementation-less verifier chains.

## Approach / Architecture

1. **The rule (spec §9b.2 Hard Reject 5, "Fail-route coverage"):** For every active stage `S`, let `R = fail_routing[S]`. If `R` owns a pipeline stage `F` (`roles[].pipeline`), then `F` must be active and `canonicalIndex(F) ≤ canonicalIndex(S)`. Stages whose FAIL routes to their own owner satisfy the rule trivially (`implementation`, `release-engineering`, `documentation` under the current manifest). If `R` owns no stage, the rule does not apply, because `resolveFailAgent` routes such a target directly without the fallback. Under the current manifest, the rule rejects exactly the chains that contain `qa`, `security-audit` or `code-review` without `implementation`.
2. **New helper `findFailRoutingGaps()` (new, in `pipeline-maps.ts`):** It takes the active stages only, like its sibling helpers (`getOrderedActiveStages`, `firstActiveStage`, `lastActiveStage`), and reads `FAIL_AGENT_MAP` / `AGENT_PIPELINE_MAP` directly. It returns one `FailRoutingGap` per offending stage: `{ stage, failAgent, fixStage }`. "At or upstream" is a single check: `fixStage` must appear in the ordered active stages up to and including `stage`. One code path covers both "not active" and "active but downstream", so no reason discriminator is needed and no branch exists that the current manifest cannot reach. Map injection is not offered. Manifest derivation is proven by the derived per-stage assertions and the exhaustive invariant in the Test Plan, which re-run against whatever the manifest says.
3. **`validateActiveStages()`:** After the canonical-order check and before the soft warnings, it calls `findFailRoutingGaps()`. If any gaps exist, it pushes one error and returns, the same early-return pattern as rules 1–4. The message groups gaps by missing fix stage and names: the failing stage(s), the FAIL target role, the stage that role owns and that it is not active at or before them, the manifest key (`pipelines.fail_routing`), and the remedy. Example for `["qa","code-review"]`:
   `Pipeline chain [qa → code-review] cannot fix its own FAIL results: FAILs in qa, code-review route to Developer (pipelines.fail_routing), but Developer's stage "implementation" is not active at or before them. Add "implementation" ahead of qa, or remove the verifier stage(s) from the chain.`
4. **Writers:** No call-site changes are needed. `createWorkPackage` already throws `errors[0]`, and the standalone import's constant chain is valid. The plan updates `CreateWorkPackageSchema.active_pipeline_stages` `.describe()` so the MCP schema text states the new rule.
5. **`resolveFailAgent()` stays behaviourally unchanged** (see Rationale). Its docblock and spec §9.3.1 are re-labelled: the fallback is reachable only for WPs created before v2.6.0. An exhaustive test pins the invariant "a chain passes validation ⇔ the fallback is unreachable for every stage of it".

## Rationale

- **Generic rule rather than "verifier needs implementation":** Deriving it from `fail_routing` plus role ownership plus canonical order covers every stage uniformly. It stays correct if the manifest adds a stage, re-routes a verifier, or gives a verifier self-rework. It also mirrors `resolveFailAgent`'s own lookup (`FAIL_AGENT_MAP` → `AGENT_PIPELINE_MAP`), so validation and routing cannot disagree about who fixes what.
- **"At or upstream" rather than "active":** A FAIL target whose stage is active but downstream would receive rework it cannot start, because its own prerequisite is the failing stage. The current manifest cannot express that case, but the user's rule covers it. Checking order costs nothing, because the check is a prefix membership test rather than a separate branch.
- **`resolveFailAgent` recommendation: no behaviour change.** After this plan, the fallback is reachable only from WPs created before v2.6.0. Those WPs currently work through the self-loop plus P4b self-rework (§21.67), and `max_rework_count` bounds them. Changing the fallback, for example routing to Developer (who has no active stage there) or returning BLOCKED, would alter in-flight behaviour of existing projects and re-open the deadlock §21.67 fixed. Nothing in new WPs would benefit. The change is limited to documentation (docblock + §9.3.1/§21.63 marked legacy-only) and an invariant test. Removing the fallback and P4b is possible later, once no ledger contains such a chain. It is listed as deferred.
- **Separate helper:** `validateActiveStages` returns strings. A structured gap list lets the error message group by fix stage. It also lets the test suite assert the rule per stage and the invariant against `resolveFailAgent` without parsing message text. Current consumers are `validateActiveStages` and the tests. The named growth is the 09-22 `ledger_update_pipeline_stages` tool, which reaches the helper through `validateActiveStages`.
- **No injectable maps (design review, Decision 4):** An earlier draft gave the helper an optional `{ failAgentMap, agentPipelineMap }` parameter and a `reason: 'inactive' | 'downstream'` field so tests could simulate other manifests. Both served behaviour the current manifest cannot produce, and no other helper in the module takes injection. The single prefix check removes the unreachable branch. The derived assertions (expected gaps computed from `FAIL_AGENT_MAP`/`AGENT_PIPELINE_MAP` in the test) plus the exhaustive invariant cover manifest derivation, because they re-evaluate on every manifest edit. A manifest change that makes the downstream case reachable is still handled correctly by the same check. It would then warrant a dedicated example test, which is noted in Risks.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Rule formulation | Manifest-derived "FAIL target owns an active stage at or upstream of the failing stage" for every stage | Hard-coded "if any of qa/security-audit/code-review then implementation required" | The hard-coded form is shorter but silently goes wrong when `fail_routing` or the canonical order changes; the derived form costs the same and cannot drift. |
| Severity | Hard reject (error) | Soft guardrail warning | A warning is exactly today's custom-composition warning that personas already ignore; the user's decision is a bootstrap error. |
| Where enforced | Inside `validateActiveStages` | A separate check in `createWorkPackage` | Every current and future writer (including 09-22's update tool) already funnels through `validateActiveStages`; a call-site check would have to be duplicated. |
| Legacy fallback | Keep `resolveFailAgent` fallback + P4b unchanged, document as legacy-only | Remove fallback / route to Developer / BLOCK on FAIL | Any behaviour change hits only pre-existing WPs, which are exactly the ones the user wants to keep working as today. |
| Testability of manifest derivation | Stage-array-only `findFailRoutingGaps`, proven by derived per-stage assertions and the exhaustive invariant against the real manifest | (a) Optional injectable `{ failAgentMap, agentPipelineMap }` parameter plus a `downstream` reason; (b) `vi.mock` of the manifest module; (c) module-private helper | (a) adds a public signature and a branch for behaviour the manifest cannot produce, and departs from sibling helpers (design review, Decision 4). (b) reloads every derived constant and is brittle. (c) loses the structured result the tests and message grouping use. Derived assertions re-run on every manifest edit at no API cost. |
| Rollout sequencing | Deployed personas carry P01 before this run's build; server pick-up follows | Server first, persona fix later | The launch shim loads `mcp-server/dist/` on every server start, so the build alone exposes the rule. Shipping first would make the Pipeline Configurator trigger a hard error it caused (design review, Decision 9). |

## Pattern Alignment

- Follows manifest derivation of all routing data (`mcp-server/src/utils/pipeline-maps.ts` L1–L11, `FAIL_AGENT_MAP` L171–L175).
- Follows `validateActiveStages`'s `{ errors, warnings }` early-return shape and the caller-throws-`errors[0]` contract (`pipeline-maps.ts` L360–L429, `work-package.ts` L362–L368).
- Follows spec-first ordering and per-version README changelog entries (root `AGENTS.md` "Change workflow logic" row; spec `README.md` v2.4.0–v2.5.1 entries).
- Follows the per-helper `describe` block layout in `mcp-server/tests/utils/pipeline-maps.test.ts`.
- Follows the sibling helper signature convention: `findFailRoutingGaps` takes only a stage array and reads the module-level derived maps, like `getOrderedActiveStages` / `firstActiveStage` / `lastActiveStage` (`pipeline-maps.ts` L285–L289, L335, L346). An injectable-map departure was considered and dropped (see Rationale, "No injectable maps").

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/utils/pipeline-maps.ts` `validateActiveStages` docblock | Omits the custom-composition warning the body emits | Promoted to step 3 | Docblock is rewritten anyway for the new error. |
| `mcp-server/src/utils/pipeline-maps.ts` `resolveFailAgent` docblock | Presents the fallback as normal routing | Promoted to step 3 | Marking it legacy-only is the documented outcome of the recommendation. |
| `mcp-server/src/tools/work-package.ts` L223–L232 `.describe()` | Restates validation rules in prose; would drift | Promoted to step 4 | Schema text is what MCP clients see; it must list the new rule. |
| `mcp-server/src/tools/help-content.ts` `ledger_create_work_package` entry | Says "contiguous subsequence" although gaps are allowed | Promoted to step 6 | Same sentence is being rewritten. |
| `mcp-server/docs/agents/project-manifest/constraints-workflow.md` hard-guardrail list and "A Chain With a Verifier Stage Must Include `implementation`" entry | Hard list has four entries; the entry's **Enforcement** paragraph says the server does not enforce the rule ("planned but not implemented"). The soft list already carries all three warnings. | Promoted to step 7 | Same section is being rewritten; both statements become false once rule 5 ships. |
| `shared/workflow-manifest.json` `spec_version` | 2.4.1 vs spec 2.5.1 | Promoted to step 2 | One-line realignment to the new 2.6.0. |
| `resolveFailAgent` fallback + P4b self-rework (`workflow-next-action.ts`) | Becomes legacy-only dead weight for new WPs | Rejected (deferred) | Still required by pre-existing WPs; removal needs a guarantee that no ledger holds such a chain. |
| Spec-vs-manifest `spec_version` drift guard | Nothing checks the two agree | Rejected | User instruction: no new validators for it. |

## Detailed Steps

1. **Revise the workflow specification (authoritative, first).** In `mcp-server/docs/agents/workflow-specification/`:
   - `operations.md` §9b.2: add **Hard Reject 5 — Fail-route coverage** with the rule as formulated in Approach item 1. Add it to the `validateActiveStages` pseudocode after Rule 4, expressed over `FAIL_ROUTING_MAP`/`AGENT_PIPELINE_MAP`/`CANONICAL_PIPELINE_ORDERING` with no stage names. Add a note that the rule applies to every operation that sets `active_pipeline_stages`, and that stored chains are never re-validated on read (§21.72).
   - `pipeline-routing.md`: in §8 (L9–L33), qualify "any valid subsequence" with "that passes §9b.2". In §9.3.1, replace the "In practice…" paragraph and the self-referential-fallback note: the fallback is reachable only for WPs created before v2.6.0, because §9b.2 rule 5 rejects every chain that would trigger it. The pseudocode stays unchanged.
   - `data-model.md`: amend the §3.3 note (L84) and the §4.2 "Removed constants" note (L234, "does not reject any particular subset") to reference rule 5. Add one sentence after the composition-patterns table: a chain without its verifiers' fix stage is invalid (e.g. `["qa","code-review"]`).
   - `edge-cases.md`: add **§21.72 Unfixable Verifier Chain Rejection**. It covers the defect, the self-loop it produced (`["qa","code-review"]` → QA ↔ QA, bounded by `MAX_REWORK_COUNT`), the rule, the error message, the self-routing stages that pass trivially, legacy WPs (not migrated, routing unchanged via §9.3.1/§21.63/§21.67), and the requirement that any future stage-mutation operation applies the same validation. Update §21.55 with a bullet on legacy chains. In §21.60, the FAIL bullet now notes that a single verifier stage is rejected, and the Validation bullet now covers rule 5. Mark §21.63, §21.66 and §21.67 as "legacy chains only — see §21.72". Change §21.65's example and opening bullet: without `implementation`, only chains of self-fixing stages (e.g. `["documentation"]`, `["release-engineering","documentation"]`) are valid.
   - `walkthrough.md` Appendix C (L182): extend the "Invalid active stages" row with "or a stage's FAIL target owns no active stage at or before it".
   - `README.md`: set **Version: 2.6.0**, **Date: 2026-10-06**. Add a `v2.6.0 - Fail-Route Coverage Validation` changelog entry naming §9b.2, §9.3.1, §8, §3.3, §4.2, §21.55, §21.60, §21.63, §21.65, §21.66, §21.67, Appendix C and the new §21.72. Amend the L140 overview sentence.
2. **Realign the manifest version.** In `shared/workflow-manifest.json` L3, set `"spec_version": "2.6.0"`. `SPEC_VERSION` and `ledger_version` stamping follow automatically.
3. **Implement the rule in `mcp-server/src/utils/pipeline-maps.ts`.**
   - Add the exported `FailRoutingGap` interface `{ stage: PipelineType; failAgent: string; fixStage: PipelineType }` (new) and the exported function `findFailRoutingGaps(stages: readonly PipelineType[]): FailRoutingGap[]` (new). It orders input via `getOrderedActiveStages`. For each stage, it looks up `FAIL_AGENT_MAP[stage]`, then `AGENT_PIPELINE_MAP[failAgent]`, skips targets that own no stage, and records a gap when `fixStage` is not in the ordered prefix ending at `stage` (Approach item 2). It uses no stage or role literals and takes no map parameters.
   - In `validateActiveStages`, after the canonical-order block, call `findFailRoutingGaps(asTyped)`. If any gaps exist, push one error grouped by `fixStage` (format in Approach item 3) and return before the warnings.
   - Rewrite the `validateActiveStages` docblock to list all five hard errors and all three soft warnings. Rewrite the `resolveFailAgent` docblock to state that the fallback is legacy-only and unreachable for chains accepted by `validateActiveStages` (spec §9.3.1, §21.72). Leave the function body unchanged.
4. **Update the creation schema text.** In `mcp-server/src/tools/work-package.ts` L223–L232, append the fail-route coverage rule to the `active_pipeline_stages` `.describe()` string, e.g. "Every stage's FAIL target must own an active stage at or before it — verifier stages (qa, security-audit, code-review) require implementation." Leave the step 5.5 logic unchanged. Confirm by reading that `importStandaloneProject`'s `['implementation']` and `project-reset.ts` need no change (both verified in the brief).
5. **Tests.** Update and extend `mcp-server/tests/utils/pipeline-maps.test.ts` and `mcp-server/tests/tools/work-package.test.ts` per the Test Plan. Leave the fixture-based legacy tests listed in the brief unchanged. They are the regression proof that stored implementation-less chains still route as before. Add a one-line comment in each `describe` noting the chain is a legacy (pre-v2.6.0) WP. Run `npm test` and `npm run build` in `mcp-server/`. Any other test that creates a WP through `createWorkPackage` with a now-invalid chain is changed to a valid chain that preserves its intent, or moved to a direct fixture write when it tests legacy routing.
6. **Tool help.** In `mcp-server/src/tools/help-content.ts`:
   - `ledger_create_work_package` optional-parameter line: replace "contiguous subsequence" with "subsequence (gaps allowed)" and add the rule 5 sentence.
   - Common mistake 8 (L62): limit "excludes implementation" to documentation/release-only chains, and state that verifier stages without `implementation` are rejected.
   - L74 note: replace the `["qa","code-review"]` example with `["implementation","qa","code-review"]`.
   - "Rework After Pipeline FAIL" (L77–L82): add "verifier stages (QA, Security Auditor, Reviewer) always have an active Developer stage upstream, enforced at creation".
7. **MCP manifest docs** (`mcp-server/docs/agents/project-manifest/`):
   - `constraints-workflow.md`: add the fifth hard guardrail to the hard-guardrail list (locate by heading). The soft-guardrail list already carries all three warnings and needs no change. Qualify the composability rule. Mark the `resolveFailAgent` fallback note as legacy-only (§21.72).
     - **Amended 2026-10-06, after the plan was written:** the Manifest Curator has since edited this file. A new entry, "A Chain With a Verifier Stage Must Include `implementation`", records the decision and says the server does not enforce it yet. Line numbers above have shifted, so locate by heading.
     - Update that entry's **Enforcement** paragraph to describe the new hard reject and drop "planned but not implemented".
     - In its "Why the chain cannot recover" list, mark the fallback and P4b self-rework as reachable only by WPs created before this spec version.
     - `data-flows.md` Flow 4 / Flow 5 were also touched by that pass; locate by heading.
   - `api-surface.md`: update the `ledger_create_work_package` guardrails (L268). Mark the `resolveFailAgent` fallback (L3640–L3660) as legacy-only and annotate the `['documentation']` example. Update the `validateActiveStages` entry (L3715–L3722). Add a `findFailRoutingGaps` + `FailRoutingGap` entry next to it.
   - `data-flows.md` L158–L170: add the fifth hard guardrail and the third soft guardrail.
8. **Release preparation.** Add a `v2.12.0 - Fail-Route Coverage Validation` entry at the top of `mcp-server/changelog.md` in house style. It records that WP creation rejects chains whose verifiers cannot route a FAIL to an active upstream stage, that existing WPs are unaffected, and that spec 2.6.0 and the manifest `spec_version` are realigned. Bump `mcp-server/package.json` `version` to `2.12.0`. Run `node scripts/check-version-sync.js` from the workspace root.
9. **Regenerate derived documents.** From the workspace root run `node scripts/bundle-docs.js` (refreshes `build/workflow-specification.md`) and `node scripts/cli.js ctx-generate` (refreshes `.context/`). Never hand-edit either output.

## Dependencies

- Step 1 precedes steps 3–7 (spec is authoritative). Step 2 follows step 1 (version number fixed there).
- Step 5 depends on step 3. Step 9 runs last.
- Plan ordering (numbered folders): runs after the persona plan P01 has landed, and before plan P03 (`2026-10-06-p03-rework-limit-headless-completion`) and plan P04 (`2026-09-22-p04-pipeline-stage-adjustment`). It takes spec v2.6.0 and §21.72.

## Required Components

- `mcp-server/docs/agents/workflow-specification/operations.md`, `pipeline-routing.md`, `data-model.md`, `edge-cases.md`, `walkthrough.md`, `README.md`
- `shared/workflow-manifest.json`
- `mcp-server/src/utils/pipeline-maps.ts` (new exports `findFailRoutingGaps`, `FailRoutingGap`)
- `mcp-server/src/tools/work-package.ts` (schema description only)
- `mcp-server/src/tools/help-content.ts`
- `mcp-server/tests/utils/pipeline-maps.test.ts`, `mcp-server/tests/tools/work-package.test.ts`
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md`, `api-surface.md`, `data-flows.md`
- `mcp-server/changelog.md`, `mcp-server/package.json`
- Regenerated: `build/workflow-specification.md`, `.context/`

## Assumptions

- The user's decision is settled: an implementation-less verifier chain is always a decomposition defect, including "pure verification" WPs. Those use `["implementation", …]` with an implementation stage that may be a no-op, or are expressed differently by the planning personas.
- No ledger tool other than `ledger_create_work_package` currently writes caller-supplied `active_pipeline_stages` (verified by grep across `mcp-server/src`, `mcp-server/gui`, `orchestrator/src`, `scripts`).

## Constraints

- No migration of existing ledgers; no validation on any read path.
- The rule references no stage or role names in code; all inputs come from manifest-derived maps.
- Generated docs are regenerated, never hand-edited.

## Out of Scope

- Planning-persona changes (WP Decomposer, Pipeline Configurator, Project Manager). Plan P01 (`2026-10-06-p01-verifier-chain-prevention-personas`) has already landed them in source: the Pipeline Configurator's former `["qa","code-review"]` "verification-only chain" section is withdrawn (`ledger-pipeline-configurator.yaml` changelog 1.3.0). Deploying the rebuilt personas is Human Action 1 and must precede this run (see Human Actions).
- Any change to `resolveFailAgent` behaviour, the P4b self-rework path, or orchestrator routing.
- Validators for `spec_version` drift.
- Editing the 2026-09-22 plan. **Follow-up:** before 09-22 executes, it must (a) take the next free spec version and §21 number after plan P03 (expected v2.8.0 and §21.74), (b) restate its guard-table row 2 to include fail-route coverage, and (c) apply the same `validateActiveStages` call to `ledger_update_pipeline_stages`. That means re-staging a legacy implementation-less WP must produce a valid chain, which repairs it.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Deploy the P01 persona build to every IDE target in use (`node scripts/sync-personas.js`), so the deployed Pipeline Configurator, WP Decomposer and Project Manager no longer propose `["qa","code-review"]` | Before the run | Deployment writes to the user's VS Code prompts and `~/.claude/agents/` directories outside the repository. Step 5's `npm run build` rewrites `mcp-server/dist/`, and the launch shim loads it on every new server start, so stale deployed personas would hit the new hard error as soon as any new session starts. |
| 2 | Restart the STABLE Ledger MCP server so already-running agent sessions pick up the new validation. Do this only once action 1 is confirmed done. | After the run | The server backs the live agentic workflow; restarting it interrupts the user's sessions and is the user's call. |

## Acceptance Criteria

- AC-01: `validateActiveStages(['qa','code-review'])` returns exactly one error, which names `implementation`, `Developer`, the failing stages and `pipelines.fail_routing`, and returns no warnings.
- AC-02: Every canonical subsequence containing `qa`, `security-audit` or `code-review` without `implementation` is rejected. Every chain containing `implementation`, and every chain made only of `release-engineering`/`documentation`, passes rule 5.
- AC-03: For every canonical subsequence accepted by `validateActiveStages`, `resolveFailAgent(stage, chain) === FAIL_AGENT_MAP[stage]` for each stage, so the fallback is unreachable. For every chain rejected only by rule 5, at least one stage hits the fallback.
- AC-04: `findFailRoutingGaps(stages)` takes only a stage array, and its result is manifest-derived. For every canonical subsequence, each returned gap has `failAgent === FAIL_AGENT_MAP[stage]` and `fixStage === AGENT_PIPELINE_MAP[failAgent]`. The set of gap stages equals the expectation computed in the test from those two maps and `CANONICAL_PIPELINE_ORDERING`: fix stage absent from the active prefix ending at the stage. Stages whose FAIL target owns that same stage never produce a gap.
- AC-05: `ledger_create_work_package` with `active_pipeline_stages: ['qa','code-review']` returns an error result and writes no WP (root index `total_work_packages` unchanged).
- AC-06: Existing WPs whose stored chain lacks `implementation` keep their current routing (`resolveFailAgent('qa', ['qa','code-review']) === 'QA'`; existing fixture-based routing, handoff and recommendation tests pass unchanged).
- AC-07: Standalone import still produces a WP with `['implementation']`, which passes `validateActiveStages`.
- AC-08: The workflow specification is at v2.6.0 with §9b.2 rule 5, §21.72 and a changelog entry. `shared/workflow-manifest.json` `spec_version` is `2.6.0`.
- AC-09: Tool help, schema description, `constraints-workflow.md`, `api-surface.md` and `data-flows.md` describe the fifth hard rule, and `help-content.ts` no longer says "contiguous".
- AC-10: `mcp-server/changelog.md` and `mcp-server/package.json` agree on `2.12.0`; `npm test` and `npm run build` pass in `mcp-server/`; generated docs are regenerated.

## Testing Strategy

Unit tests on the pure helpers in `pipeline-maps.ts` carry the rule. They include an exhaustive pass over all 63 canonical subsequences that pins the validation ⇔ fallback invariant against the real manifest. Expectations in that pass are computed from the manifest-derived maps, never from stage names, so it re-validates on every manifest edit. A separate snapshot-style case pins today's concrete outcome (rejected set = contains a verifier, lacks `implementation`) by name, and is expected to change when the manifest does. One tool-level test proves the creation path rejects the chain and writes nothing. The unchanged fixture-based legacy tests serve as the backward-compatibility regression suite.

## Test Plan

- `mcp-server/tests/utils/pipeline-maps.test.ts` › `validateActiveStages` › "rejects a verifier chain without its fix stage (qa + code-review)": single error naming `implementation`, `Developer`, `qa`, `code-review`, `pipelines.fail_routing`; no warnings — AC-01
- `mcp-server/tests/utils/pipeline-maps.test.ts` › `validateActiveStages`: change the existing L401–L404 case `['qa','code-review','documentation']` to expect the rule 5 error. Add accepting cases `['documentation']`, `['release-engineering','documentation']` and `['implementation','code-review']` — AC-02
- `mcp-server/tests/utils/pipeline-maps.test.ts` › new `describe('fail-route coverage invariant')` › "accepted ⇔ fallback unreachable (derived)": enumerate all non-empty canonical subsequences from `CANONICAL_PIPELINE_ORDERING`. A chain is accepted by `validateActiveStages` ⇔ no stage hits the `resolveFailAgent` fallback. The body uses no stage or role literals — AC-03
- `mcp-server/tests/utils/pipeline-maps.test.ts` › same `describe` › "snapshot: rejected set under the current manifest" (kept as a separate, explicitly named snapshot case): the rule-5-rejected set equals {contains `qa`, `security-audit` or `code-review`, lacks `implementation`}, 28 chains, and the accepted set is 35 chains. A comment states that this case changes when `fail_routing` or the canonical order changes, while the derived case does not — AC-02
- `mcp-server/tests/utils/pipeline-maps.test.ts` › new `describe('findFailRoutingGaps')` › "derived from manifest maps": for every canonical subsequence, the gaps match the expectation computed from `FAIL_AGENT_MAP`, `AGENT_PIPELINE_MAP` and the active prefix, and each gap's `failAgent`/`fixStage` equal the map lookups. Self-routing stages never appear as gaps — AC-04
- `mcp-server/tests/utils/pipeline-maps.test.ts` › `describe('findFailRoutingGaps')` › examples: empty for the default and full chains, and one gap per verifier for `['qa','security-audit','code-review']` with `fixStage: 'implementation'` — AC-02, AC-04
- `mcp-server/tests/utils/pipeline-maps.test.ts` › `resolveFailAgent`: keep L225–L236 fallback cases and label them "legacy chain (pre-v2.6.0)" — AC-06
- `mcp-server/tests/tools/work-package.test.ts`: invert "accepts verification-only composition ["qa","code-review"]" (L1716–L1735) to "rejects …". Assert `isError`, that the error text names `implementation`, and that the root index work-package count is unchanged — AC-05
- `mcp-server/tests/tools/work-package.test.ts`: change the single-stage warning test (L1653–L1667) from `['qa']` to `['documentation']` so it still asserts the single-stage warning — AC-02
- `mcp-server/tests/utils/pipeline-maps.test.ts` › `validateActiveStages` › "accepts the standalone-import chain ['implementation']" (existing single-stage case extended to assert `errors` empty) — AC-07
- Existing fixture-based suites unchanged and passing: `tests/tools/pipeline.test.ts`, `tests/tools/begin-work.test.ts`, `tests/tools/workflow-next-action.test.ts`, `tests/tools/workflow-handoff.test.ts`, `tests/integration/auto-handoff.test.ts` — AC-06
- `tests/utils/workflow-manifest.test.ts` (existing `SPEC_VERSION` parity) passes after the bump — AC-08
- Doc and version checks: `node scripts/check-version-sync.js`, and a grep that no `contiguous` remains in `help-content.ts` — AC-09, AC-10

## Documentation Updates

- `mcp-server/docs/agents/workflow-specification/operations.md` — §9b.2 Hard Reject 5 + pseudocode + write-path note
- `mcp-server/docs/agents/workflow-specification/pipeline-routing.md` — §8 qualifier; §9.3.1 fallback legacy-only
- `mcp-server/docs/agents/workflow-specification/data-model.md` — §3.3 and §4.2 notes
- `mcp-server/docs/agents/workflow-specification/edge-cases.md` — new §21.72; §21.55, §21.60, §21.63, §21.65, §21.66, §21.67 amended
- `mcp-server/docs/agents/workflow-specification/walkthrough.md` — Appendix C row
- `mcp-server/docs/agents/workflow-specification/README.md` — v2.6.0, date, changelog, overview sentence
- `shared/workflow-manifest.json` — `spec_version` 2.6.0
- `mcp-server/src/tools/help-content.ts` — create-WP entry, common mistake 8, terminal-agent note, rework section
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md` — hard-guardrail list, verifier-chain entry's Enforcement paragraph, composability rule, fallback note
- `mcp-server/docs/agents/project-manifest/api-surface.md` — create-WP guardrails, `resolveFailAgent`, `validateActiveStages`, new `findFailRoutingGaps`
- `mcp-server/docs/agents/project-manifest/data-flows.md` — creation-flow guardrails
- `mcp-server/changelog.md` — v2.12.0 entry
- `build/workflow-specification.md`, `.context/` — regenerated

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Remove the `resolveFailAgent` first-active-stage fallback and the P4b self-rework path | `resolveFailAgent` recommendation in this plan | Still required by pre-existing WPs with implementation-less verifier chains | Reconsider once no stored ledger holds such a chain (e.g. after 09-22's update tool lets the PM repair them). |
| 2 | Persona changes (WP Decomposer, Pipeline Configurator, Project Manager) | User decision | Handled separately by the Persona Curator | Source changes landed via plan P01 (re-verified 2026-10-08). Only deployment remains, recorded as Human Action 1 (Before the run). |
| 3 | 2026-09-22 plan (P04) alignment (next free spec numbers after plan P03, rule 5 in its guard table) | Sequencing | User asked not to edit that plan | Must happen before 09-22 executes. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Deployed planning personas predate P01 and still emit `["qa","code-review"]`, so bootstraps fail with an error the persona caused** | P01 has landed the fix in source. Human Action 1 deploys it before the run, which matters because step 5's build exposes the rule to any newly started server process, not only to the explicit restart (Human Action 2). If a stale persona slips through anyway, the result is a bootstrap error instead of a loop, and the error message names the remedy. |
| **A future manifest makes the "active but downstream" case reachable, which no example test exercises** | The prefix check covers it on the same code path, and the derived `findFailRoutingGaps` assertion recomputes expectations from the edited manifest. The manifest change that introduces such a case should add a named example test alongside it. |
| **A legitimate "pure verification" WP can no longer be expressed without `implementation`** | Settled by the user's decision. The spec (§21.72, §21.65) and help text tell planners to include `implementation`. |
| **Existing tests that create such chains through the tool start failing** | The brief enumerates them (two in `work-package.test.ts`, one in `pipeline-maps.test.ts`). Step 5 handles any further hit by keeping intent with a valid chain or moving to a fixture write. |
| **Spec version collision with the 09-22 plan** | This plan runs first and takes 2.6.0/§21.72. The follow-up records the renumbering for 09-22. |
| **`spec_version` bump changes `ledger_version` on new ledgers** | Intended realignment. The forward-compat warning only fires when a ledger is newer than the server, which an upgrade cannot cause. |
