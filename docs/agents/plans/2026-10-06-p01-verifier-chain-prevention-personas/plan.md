# Plan — Prevent Verifier-Only Work Packages at the Source (Personas)

**Executor:** Persona Curator, Maintain mode, one persona per pass.
**Created:** 2026-10-06
**Revised:** 2026-10-06 — curator review integrated (gate baseline, Configurator/PM flag handshake, PM check before bootstrap, gate-host dependencies, L97 exception, QA trigger detail, Doctor step made mandatory).

## Summary

A WP whose pipeline chain contains only verifier stages (`qa`, `security-audit`, `code-review`) has no stage that can fix what those stages flag. When one fails, the ledger's fail routing has no Developer to send it to and loops the WP back to the failing verifier. This plan changes the three planning personas so they never produce such a WP. Verification always travels with the work it verifies. It also fixes a stale rework trigger in the QA persona that came up during the investigation, and teaches the Ledger Doctor to recognise legacy WPs with this defect.

## Background

**Incident.** Ledger project `hcp-editor/2026-10-01-ms03-ms04-coma-payload-completion`, WP-019: a milestone exit gate with the chain `["qa", "code-review"]`. QA failed on a test failure that predated the plan and was unrelated to it. The ledger re-dispatched QA with nothing changed, QA failed again, and the WP only moved on after a PM amended the AC. Headless runs have no PM to do that.

**Cause.** The Pipeline Configurator offers a "verification-only chain" `["qa", "code-review"]` in its Decision Criteria. The configurator's 1.2.2 / 1.2.3 fixes (2026-09-30) covered deliverables without an authoring stage. They did not cover a verifier with no fixer.

**Structural fact.** In canonical order (`implementation → qa → security-audit → code-review → release-engineering → documentation`), `implementation` is the only stage upstream of the verifiers. All verifier FAILs route to the Developer (`pipelines.fail_routing` in `shared/workflow-manifest.json`). Two consequences:
- Any chain containing a verifier needs `implementation`.
- QA cannot check docs written in the same WP, because `documentation` runs after QA.

**Decisions (user, 2026-10-06).**
1. A verifier-only chain is a decomposition defect, fixed at the source by the WP Decomposer, Pipeline Configurator and PM.
2. Rejected: ledger-inserted "out-of-chain rework" runs that choose a fixer by finding type. They would hurt traceability and add an intelligent mechanism behind the declared chain. The rationale is recorded in the project documentation, not in a plan.
3. Unfixable failures, such as a failure that predates the plan and lies outside it, are accepted. The existing rework limit (`BLOCK_FOR_REWORK_LIMIT`) ends the loop.
4. The ledger adds one mechanical backstop: `validateActiveStages()` rejects such chains at WP creation. That is a separate plan, written by the Planner in this repository on 2026-10-06.

**Defence in depth.** Three personas each catch the defect at their own stage. The Decomposer never writes the WP, and its Consistency Pass checks the set. The Configurator never assigns the chain, and flags any WP that arrives with nothing to author. The PM reads that flag and the stage lists before the Bootstrapper runs. Each layer has to work alone, because the one before it may have missed the case.

## Sequencing

This is plan P01 of four numbered plans: P01 personas (this plan), P02 ledger validation, P03 rework-limit headless completion, P04 pipeline stage adjustment (2026-09-22).

**Deploy this plan before the ledger plan's server rebuild.** The ledger plan (`docs/agents/plans/2026-10-06-p02-unfixable-verifier-chain-validation/`) rejects any chain with `qa`, `security-audit` or `code-review` and no `implementation`. While the Pipeline Configurator still recommends `["qa", "code-review"]`, every bootstrap that uses it fails at WP creation.

This plan does not otherwise depend on the ledger plan. P02 has not shipped, so the persona text states the rule as a design rule and does not mention the ledger's rejection at all. A follow-up can add a one-line reference once P02 lands.

## Steps

### 1. Pipeline Configurator — remove the verification-only chain
File: `personas/ledger-support/src/content/ledger-pipeline-configurator.md` (meta: `src/meta/ledger-pipeline-configurator.yaml`, currently 1.2.3)

- Delete the `### The verification-only chain ["qa", "code-review"] fits a WP that:` block (around L90–95), together with its three pre-requisites.
- Add a constraint: **never assign a chain whose verifier stages have no stage able to fix what they flag.** In canonical order that means `qa`, `security-audit` or `code-review` require `implementation`.
- **Alternative action for a WP with nothing to author.** A WP that arrives with nothing for `implementation` to do is a decomposition defect. The Configurator neither invents a narrower chain nor quietly assigns the standard chain. A standard chain on such a WP gives the Developer an empty stage that passes trivially, and the PM's stage-list check would then see a valid chain. Instead the Configurator:
  - assigns the standard chain as a placeholder, so the output stays complete;
  - records the WP in the Guardrail Notes under a fixed, named flag: **`Decomposition defect — no authoring work`**, with one line on why (e.g. "ACs only run the test suite").
  The PM acts on this flag in step 3. The fixed wording lets the PM find it reliably.
- Remove the verification-only references from:
  - the "Never narrow a chain on an unverified pre-requisite" constraint (around L109);
  - the Codebase Verification capability (around L31);
  - triage step 2 (around L159), which lists verification-only as a flag. Replace that flag with "no authoring work" so triage still catches it;
  - step 6 / Guardrail Notes (around L163) and the Output Template guidance (around L131). Both gain the named flag above in place of the verification-only wording;
  - Quality Checklist items around L151 and L153. L153 (CLI side effects on verification-only WPs) goes; add one item: "Every WP with nothing to author carries the `Decomposition defect — no authoring work` flag".
- Keep the documentation-only chain. It has no verifier, so it is unaffected.
- Version: minor bump to 1.3.0, because a chain the persona used to emit is withdrawn.

### 2. WP Decomposer — never produce a verification-only WP
File: `personas/ledger-support/src/content/ledger-wp-decomposer.md`

**Philosophy and constraint.**
- Widen the existing "Tests Belong With the Code They Verify" principle (L17) to verification in general, rather than adding a second, overlapping principle. A possible title is "Verification Belongs With the Work It Verifies"; the Philosophy Tone Pass decides the final wording.
- The hard rule goes into the existing constraint "Never create a WP for tests, changelog entries, version bumps, or by-product documentation" (L152): a WP whose only work is running checks is not a valid WP, and none of the exceptions covers it. Update the matching Quality Checklist item (L279) the same way.

**Separate-test-WP exceptions (L95–99).**
- L97 ("end-to-end integration tests owned by QA"): a WP owned by QA has no `implementation` stage, which is the defect. Rewrite it: the Developer writes the end-to-end tests in `implementation`, and QA verifies them.
- L99 ("a regression suite for a pre-existing module"): a separate test WP that *writes* tests has `implementation` and is fine. One that only *runs* tests is the defect. Say so.
- Re-check L98 ("cannot begin until an upstream deliverable is verified externally") against the same test: it is valid only if the WP authors something.

**Milestone and plan exit gates** (static analysis plus suite runs after all other WPs):
- Fold them into the ACs of the last WP that authors something, with `implementation`. That WP's Developer then has a real job: making the gate pass, including regressions that cross WP boundaries.
- When the last authoring WP is docs-only, the gate goes on the last WP with `implementation` instead.
- **Dependencies of the gate's host WP.** The Dependency Sequencer adds an edge only for real coupling, such as files, artifacts or ACs that reference another WP's deliverables. A generic "suite has no new failures" AC references none, so the Sequencer would treat parallel leaf WPs as independent, and the gate could run before they finish. The gate AC therefore names every code WP it covers, e.g. "no new failures across the work of WP-003, WP-004 and WP-006". That lets the Sequencer's existing "B's acceptance criteria reference A's deliverables" rule make the edges. Repeat the list in the WP's `**Notes:**` so the Sequencer sees it is intentional. The Sequencer persona itself is not changed.

**Gate AC wording: "no new failures against a recorded baseline", not "green".**
- The baseline is the state of the code **at the plan's starting commit**, not at the start of the host WP. By the time the host WP starts, the other WPs have landed, so any regression they caused would already be in a baseline taken then, and the gate could not see it.
- The AC says how to get the baseline without a person: run the same gate commands on the run's base commit in a temporary git worktree (e.g. the merge-base with the base branch). Then compare the current results to it. Failures present in both are out of scope. Only failures new since the baseline fail the gate.
- Name the gate commands exactly, and make test filters match whole test names. Incident detail: WP-019's `composer test-filter -- Override` matched an unrelated Pigeon test by substring.

**Consistency Pass.** Add a check to the table (around L174–175): no WP in the set consists only of running verification, and every exit gate sits on an authoring WP whose ACs name the WPs it covers. Remedy: fold the gate into the last authoring WP and delete the empty WP.

### 3. Project Manager — reject verifier-only WPs before bootstrap
File: `personas/ledger/src/content/2-project-manager.md`

**New step between 8 (Pipeline Configurator) and 9 (Ledger Bootstrapper).** Step 10 runs after the Bootstrapper has already created the WPs, so a check placed there can only recreate them. Once P02 ships, the Bootstrapper itself fails on these chains before step 10 is reached. The new step reads `pipeline-configuration.md` and checks two things:
- **The Configurator's flag.** Any WP listed under `Decomposition defect — no authoring work` in the Guardrail Notes.
- **The stage lists.** Any WP whose `active_pipeline_stages` contains `qa`, `security-audit` or `code-review` but no `implementation`.

For each hit, re-invoke the WP Decomposer to fold the WP's ACs into the WP whose output it verifies, or into the last authoring WP for an exit gate. Then re-run the Dependency Sequencer and Pipeline Configurator for the changed set before bootstrapping. Never add `implementation` with an artificial AC just to satisfy the rule. Renumber the following steps, and any cross-references to them.

**Step 10 ("Validate test-only WPs", currently around L200).**
- Drop "verification-only" from its list of chains without `implementation`. After the new step, none can reach the ledger.
- Drop "test-only" too. Writing tests needs `implementation`, so a test-only WP without it is the same verification-only case. What remains is documentation-only and any other chain without `implementation`.
- Keep the existing symbol check and authoring check as they are.

### 4. QA — fix the stale `REWORK_QA` trigger
Files: `personas/ledger/src/content/4-qa.md` (L105–113, L137), `personas/ledger/src/meta/4-qa.yaml` (L68)

- The server never emits `REWORK_QA`. QA is re-engaged with `RUN_QA` in two situations (`mcp-server/src/tools/workflow-next-action.ts`):
  - **Re-engagement (P4, around L833–857):** a new `implementation` PASS since the last QA pipeline. Its reason reads "has a new … PASS since the last QA pipeline". This also fires when the last QA run *passed*, for example after a code-review or security-audit bounce sent the WP back to the Developer.
  - **Self-rework fallback (P4b, around L859–880):** the most recent QA pipeline is FAIL and the Developer's stage is not active. Its `next_steps` tell QA to "address the issues identified in the prior QA FAIL".
- Model the section on the Reviewer's Rework Handling (`6-reviewer.md` L169–177), which already names the situations in which `RUN_REVIEW` arrives. The Security Auditor (`5-security-auditor.md` L172–174) uses the same pattern. Neither needs changing; that check is done.
- **Re-key the focused rework protocol:** it applies when `RUN_QA` arrives and the WP's **most recent** `qa` pipeline is FAIL. A WP that merely has an older FAIL somewhere in its history, or whose last QA passed, gets the full Verification Stack.
- **Self-rework.** After P01 and P02, P4b can only happen on legacy WPs created without `implementation`. Add one sentence: in self-rework, QA re-verifies but never authors a fix to production code or tests. Where the failure still stands, QA reports FAIL again, and the rework limit (`BLOCK_FOR_REWORK_LIMIT`) ends the loop, as decision 3 intends. The server's P4b wording is a ledger concern and out of scope here.
- Update the action list at L137, the section heading at L105, and the tool purpose at `4-qa.yaml` L68. Remove every `REWORK_QA` reference.

### 5. Ledger Doctor — diagnose legacy verifier-only WPs
File: `personas/ledger-support/src/content/ledger-doctor.md`

Two or three lines, placed with the existing rework-limit diagnosis (around L170):
- **Symptom:** a WP whose `active_pipeline_stages` has a verifier but no `implementation`, cycling the same verifier on its own FAIL until it hits the rework limit.
- **Fix:** cancel the WP and recreate it with `implementation`, with the gate as its ACs and the baseline wording from step 2. Once the 2026-09-22 plan (P04) lands, the PM's stage-update tool can add `implementation` in place instead. Do not name that tool before it exists.

## Verification (per persona)

1. Read `persona-design-guide.md` (Inputs lookup order) at the start of the session.
2. Philosophy Tone Pass where an Operating Philosophy section is touched (step 2 touches it).
3. Prose Density Pass over the edited prose only.
4. The guide's Quality Checklist, plus the curator's three additions.
5. Prepend a changelog entry to each persona's metadata, and add a line to `personas/changelog.md` (summary-only, one bullet per persona or one thematic bullet).
6. Run the persona build and read each rendered target end to end: `claude-code/`, `vs-code/`, `deep-agents/`.
7. **Cross-persona check, after all five personas are done:** the Configurator's flag wording in step 1 and the PM's lookup in step 3 match character for character. The Decomposer's gate-AC wording (step 2) and the Doctor's fix (step 5) describe the same baseline.

## Out of Scope

- Ledger code and the workflow specification (the separate ledger plan), including the wording of the server's P4b self-rework `next_steps`.
- The Dependency Sequencer persona. Step 2 makes gate dependencies explicit through the existing AC-reference rule instead.
- Documentation of the routing research and the rejected design (the project documentation, integrated by the Manifest Curator on 2026-10-06).
- Persona changes for the rejected out-of-chain design (Developer out-of-scope verdict, Coordinator settled-WP check, Synthesis out-of-scope reporting, orchestrator runner exit code 3). None of these apply any more.
