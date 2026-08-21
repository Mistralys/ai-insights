# Project: GUI Usage Scenarios

## Problem

When planning GUI features, including end-user usage scenarios alongside the plan has proven
valuable for surfacing gaps before implementation. We need a repeatable way to produce a
`usage-scenarios.md` companion document to a plan, and to later verify that the plan actually
fulfills every scenario.

## Options Considered

| Option | Verdict | Reason |
|---|---|---|
| Mode on Web GUI Specialist | Rejected | It is an implementation-time agent that consumes an already-finished plan; by the time it runs, the architectural decisions scenarios should inform are already locked in. |
| Extend the Planner's workflow/outputs | Rejected | Scenarios are derived *from* the finished plan, not co-designed with it — this would mix plan authorship with a different cognitive task inside one persona, which the Persona Design Guide warns against. It also doesn't fit the generate → human-edit → verify loop described below. |
| New dedicated standalone persona | **Chosen** | Scenario generation and coverage verification are a distinct concern (user-facing coverage lens) that mirrors the existing Plan Auditor / Plan Architect Reviewer pattern — a peer reviewer of the plan, not a subordinate step inside Planner or Web GUI Specialist. |

## Decision

Create a new standalone persona, **Usage Scenarios Curator**, following the Curator pattern
(Persona Curator, Manifest Curator, Changelog Curator) with two Operating Modes:

| Mode | Trigger | Behavior |
|---|---|---|
| **Generate** | User provides a `plan.md` | Read the plan, derive candidate usage scenarios (actor, goal, trigger, step-by-step interaction, expected system response, edge cases), write `usage-scenarios.md` next to the plan. The user then manually extends/corrects it. |
| **Verify** | User provides `plan.md` + an edited `usage-scenarios.md` | Cross-reference every scenario step against the plan's Approach/Steps/Acceptance Criteria. Report which scenarios are fully covered, partially covered, or unaddressed, using the same PASS / PASS WITH FINDINGS / FAIL verdict style as Plan Auditor. Save as `scenario-coverage.md`. |

This keeps the new persona a peer of Plan Auditor rather than a subordinate of Planner or Web GUI
Specialist:

- Planner stays focused on architecture and sequencing.
- Web GUI Specialist stays focused on implementation.
- Plan Auditor stays focused on technical grounding.
- Usage Scenarios Curator owns the user-facing coverage lens exclusively.

### Sequencing in Practice

```
Planner → plan.md
   → Usage Scenarios Curator (Generate) → usage-scenarios.md
   → user manually edits/extends usage-scenarios.md
   → Usage Scenarios Curator (Verify) → scenario-coverage.md
   → gaps (if any) feed back into Planner as a rework trigger
```

## Design Basis for the Verify Mode

Reuse Plan Auditor's finding-table and verdict format (`plan-auditor.md`) as the structural basis
for the Verify mode's output — categorized findings, severity, and a PASS / PASS WITH FINDINGS /
FAIL verdict — so the output style stays consistent across plan-adjacent auditing agents.

## Integration Points

### Plan Refiner

Plan Refiner (`plan-refiner.md`) should integrate scenario **verification** automatically, gated
purely on file presence — never Generate mode, since Generate depends on the human-edit step in
between and cannot be automated:

- **Trigger:** At the start of the Refinement Cycle, check whether `usage-scenarios.md` exists
  alongside the plan (the same presence check already used for `research-brief.md`). If absent,
  skip scenario verification entirely — this is opt-in by the file's existence, not a new required
  artifact.
- **Placement:** Run as a new phase after the Audit Loop converges (i.e., once the plan is
  technically PASS / PASS WITH FINDINGS). Checking coverage against a plan that is still failing
  technical audit would waste cycles on a moving target.
- **Loop shape (open question — see Open Items):** Unlike the Audit Loop, this likely should be a
  single-shot check rather than an iterative loop up to the ceiling, to keep the Refiner's scope
  proportional. Proposed behavior:
  1. Delete any stale `scenario-coverage.md` alongside the plan.
  2. Delegate to **Usage Scenarios Curator (Verify mode)** with the plan path and
     `usage-scenarios.md` path.
  3. Read the resulting `scenario-coverage.md` verdict.
  4. **PASS / PASS WITH FINDINGS (Minor only):** Report in the Refinement Log; no further action.
  5. **FAIL or Major findings:** Delegate one integration pass to the Planner (same pattern as
     audit-finding integration) to close the gaps, then re-run the Verify mode once. Do not loop
     further — if still failing after one integration pass, report it as an unresolved item
     rather than escalating to CEILING_REACHED/DIVERGING (those states are reserved for the
     technical Audit Loop).
- **Refinement Log:** Add a `Scenario Coverage` row/section to the existing template so this new
  phase is visible in the standard report (`SKIPPED — no usage-scenarios.md`, `PASS`,
  `PASS WITH FINDINGS`, or `FAIL — unresolved`).

### Git Committer

Git Committer (`git-committer.md`) must treat `usage-scenarios.md` as a source companion file to
`plan.md`, `synthesis.md`, and `request.md`:

- **Plan folder convention:** Extend the existing version-controlled file set for plan folders
  from `plan.md`, `synthesis.md`, `request.md` to also include `usage-scenarios.md` when present.
- **Plan Matching / thematic grouping:** Source companion files travel with the same topic group
  as their plan — never staged or committed separately (mirrors the existing "Plan documents
  travel with their commits" constraint).
- **Archival on synthesis completion:** When a plan folder's `synthesis.md` exists and the plan is
  queued for archival to `docs/agents/implementation-history/`, `usage-scenarios.md` (if present)
  moves alongside `plan.md`/`synthesis.md`/`request.md` in the same mechanical,
  no-confirmation-needed step.
- **Derived coverage report:** `scenario-coverage.md` is a generated review artifact, not a source
  document. It is not added to the version-controlled plan-file set or moved during archival.
- **Absence is normal:** `usage-scenarios.md` is optional — plans without GUI scope will not have
  one, and Git Committer should not flag its absence as an incomplete plan (that gate remains tied
  to `synthesis.md` only).

### Standalone Archival and Import

The Standalone Archiver and `ledger_import_standalone` must preserve the same source-document
boundary as Git Committer:

- **MCP import implementation:** Extend the import path to copy `request.md` and
  `usage-scenarios.md` when present, alongside the required `plan.md` and `synthesis.md`. Add
  storage and tool tests for present and absent optional files.
- **Archiver confirmation:** Update `standalone-archiver.md` to report these optional source
  documents accurately from the tool response. The persona must not claim that it copied files the
  MCP tool did not archive.
- **Archival callers:** Update Developer (Standalone) and Web GUI Specialist wording so their
  Standalone Archiver handoff identifies the complete source-document set.
- **Generated report exclusion:** Do not import or archive `scenario-coverage.md`; it is a derived
  verification artifact rather than a source document.

### Persona Registration and Discovery

- **Plan Refiner metadata:** Add `usage-scenarios-curator` to `plan-refiner.yaml`'s `subagents`
  list as well as adding the Verify-mode workflow. Target-specific generated personas depend on
  this metadata declaration for supported delegation.
- **Standalone catalog:** Add Usage Scenarios Curator to `personas/standalone/README.md` and
  regenerate `docs/agents-overview.md` after its metadata is added.

### Verification Suite Expansion (Acceptance Verifier)

Cross-referenced from `docs/agents/plans/2026-08-01-verification-suite-expansion/plan.md` (Item
1, Acceptance Verifier). That plan's AV is deliberately **plan-blind** — it verifies the running
feature against the original `request.md` bundle only, never against `plan.md` or anything
derived from it. `usage-scenarios.md` is generated *from* `plan.md`, so it cannot be fed to the AV
directly without contaminating that blindness. The legitimate link is upstream: usage scenarios
authored or captured **before/during planning, at the goal level**, would qualify as requester-
authored `request.md` bundle attachments — concrete, decidable walkthroughs the AV could use
without ever touching the plan. Whether/how to shift scenario capture earlier for that purpose is
deferred until Acceptance Verifier implementation is planned; it is not resolved by this project.

## Final Contract

- [x] `usage-scenarios-curator` is a standalone-only persona with Generate and Verify modes.
- [x] Plan Refiner runs Verify mode only when `usage-scenarios.md` exists beside the plan and only
  after the technical audit converges.
- [x] A PASS or Minor-only PASS WITH FINDINGS ends the scenario phase. FAIL or Major findings may
  trigger one Planner integration pass and one bounded re-check; unresolved findings are
  reported without extending the technical audit ceiling.
- [x] `usage-scenarios.md` is plan-derived evidence and remains upstream-only from the plan-blind
  Acceptance Verifier. It must never be passed to that verifier as input.
- [x] Requester-authored, goal-level scenarios remain a future `request.md` bundle design question;
  this project does not move scenario capture into the pre-plan request workflow.
- [x] Optional `request.md` and authored `usage-scenarios.md` are preserved through standalone
  import and archival; generated `scenario-coverage.md` is excluded.
