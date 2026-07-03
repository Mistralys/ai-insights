# Research Report — Acceptance-Criteria Misfiling: Synthesis

## Problem Statement

Agents in the ledger workflow repeatedly report that acceptance criteria (AC) end up
attached to the wrong work package (WP). Two independent investigations diagnosed the same
symptom from different layers of the pipeline. This report reconciles their findings,
deduplicates overlapping issues, and ranks the combined set of fixes so the team can focus
effort where it pays off most.

## Reconciling the Two Reports

The two reports do **not** conflict — they describe two distinct failure modes that both
end in "AC on the wrong WP":

| | Report A (misplacement) | Report B (misfiling-diagnosis) |
|---|---|---|
| **Failure mode** | *Semantic* — the decomposer assigns an AC to a WP whose scope doesn't match | *Mechanical* — the correct AC array is wired to the wrong WP during registration |
| **Where it happens** | Authoring (`work-packages-draft.md`) | Materialization (Bootstrapper Step 3–4) |
| **Primary cause** | No AC-to-WP affinity signal; no coverage check | ID re-mapping between file-order and registration-order; dual unreconciled copies |
| **Shared conclusion** | Both independently identify the **missing content-level verification gate** as a key structural hole |

Their strongest point of agreement is the **verification gap**: no gate anywhere compares
AC *content* against the WP it belongs to. Report A frames it as "no downstream cross-check";
Report B frames it as "every gate checks existence/counts, not content." Same hole.

## Orchestrator Path — Verified

Both source reports left open whether the Python orchestrator has an independent
initialization routine that would need the same fixes. **This is now confirmed: it does
not — the orchestrator reuses the identical persona sources, so all fixes apply once.**

Evidence:

- The PM stage node ([orchestrator/src/nodes/pm.py](../../../orchestrator/src/nodes/pm.py))
  creates a Deep Agent from the **PM persona system prompt** and the shared MCP toolkit; it
  has no bespoke WP-creation or AC-handling logic. It simply reads the plan and invokes the
  agent.
- Subagents (including `ledger-wp-decomposer` and `ledger-bootstrapper`) are loaded by
  [orchestrator/src/utils/subagents.py](../../../orchestrator/src/utils/subagents.py) from
  the **same** `personas/ledger-support/deep-agents/{slug}.md` files that the IDE consumes —
  the PM's `subagents` list in
  [2-project-manager.yaml](../../../personas/ledger/src/meta/2-project-manager.yaml) declares
  both slugs.
- Run logs confirm the orchestrator's `pm` stage calls `ledger_create_work_package` against
  the same MCP server (e.g. `orchestrator/logs/*.jsonl`), i.e. the identical dual-input,
  auto-ID tool path Report B analyzed.

**Implication:** Because both the IDE and orchestrator paths delegate to the same
Bootstrapper/PM/Decomposer persona text and the same MCP server, fixing I1–I5 in the persona
sources (and, where noted, the MCP server) corrects **both** execution harnesses
simultaneously. No orchestrator-specific patch is required.

## Consolidated Issue Inventory

The five distinct issues across both reports, deduplicated:

| # | Issue | Source | Layer |
|---|-------|--------|-------|
| I1 | **Bootstrapper numbering juggle** — spec files numbered in decomposer order, WPs registered (and auto-ID'd) in dependency order; rename fixes filename only, not the AC array pairing | B (Gap 2) | Materialization |
| I2 | **No content-level AC verification gate** — no gate re-reads persisted AC and compares to the WP's spec file / plan | A (downstream gap) + B (Gap 3) | Verification |
| I3 | **Dual unreconciled AC copies** — `ledger_create_work_package` takes both an `acceptance_criteria` array and a `work_package_file` that also lists AC; server stores only the array, never reconciles | B (Gap 1) | Materialization |
| I4 | **Unnumbered, untagged plan AC + no coverage table** — Planner emits global bullet AC with no ID or WP affinity; decomposer has no protocol to map plan AC → WP and no coverage output | A (Planner + Decomposer gaps) | Planning |
| I5 | **Exact-match AC updates create phantom criteria** — `===` matching in `ledger_complete_pipeline`; paraphrased updates silently append a duplicate instead of updating | A (secondary) | Runtime |

## Rating Methodology

Each issue is scored on three axes (1–5), combined into a **Priority** signal:

- **Impact** — how strongly fixing it reduces real misfiling.
- **Confidence** — how sure we are this issue actually causes the reported symptom.
- **Effort** — implementation cost (**inverted** in priority: cheaper = better).

**Priority = Impact × Confidence ÷ Effort**, then bucketed to P0/P1/P2.

## Ranked Recommendations

### ⭐ P0 — I1: Fix the Bootstrapper numbering juggle

| Impact | Confidence | Effort | Priority |
|:------:|:----------:|:------:|:--------:|
| 5 | 5 | 2 (Medium) | **P0** |

**Why it wins:** This is the single most likely *mechanical* cause and the only issue rated
"High likelihood" by either report. The three-way juggle (file order → dependency order →
auto-assigned ledger ID) forces the agent to hand-pair an AC array with a `work_package_file`
under active renaming — the exact conditions for cross-wiring.

**Fix (preferred):** Reorder the Bootstrapper so spec files are created **after**
registration, named with the ledger-returned ID. This eliminates the rename step and the
file/array divergence at the root. Persona-source change only
([ledger-bootstrapper.md](../../../personas/ledger-support/src/content/ledger-bootstrapper.md)),
no MCP server code required.

### ⭐ P0 — I2: Add a content-level AC verification gate

| Impact | Confidence | Effort | Priority |
|:------:|:----------:|:------:|:--------:|
| 5 | 5 | 1 (Low) | **P0** |

**Why it wins:** Both reports independently converge here — the highest-agreement finding.
It is the *detector* whose absence lets every other issue pass silently. Low effort, high
leverage: it catches I1, I3, and I4 misfilings after the fact even before they are fixed.

**Fix:** In Bootstrapper Step 6 and/or PM Step 9, call `ledger_get_work_package` per WP and
assert set-equality between the returned `acceptance_criteria` and the `## Acceptance Criteria`
section of the matching `work/{WP_ID}.md`. Use **normalized** comparison (trim + case-fold)
to avoid stalling on benign whitespace. Emit a warning rather than a hard failure initially.

### P1 — I4: Numbered plan AC + decomposer coverage table

| Impact | Confidence | Effort | Priority |
|:------:|:----------:|:------:|:--------:|
| 4 | 4 | 2 (Low–Medium) | **P1** |

**Why:** Addresses the *semantic* failure mode and adds human-reviewable traceability — the
strongest recommendation of Report A (its "Approach A"). Lower urgency than I1/I2 because it
prevents authoring-time misjudgement rather than the more common mechanical mis-wiring, but
it is cheap and makes misplacement visible in review.

**Fix:** (1) Planner emits `- AC-{NN}: {Criterion}` numbered format. (2) WP Decomposer gains
a Step 2.5 mapping each plan AC → covering WP, plus a coverage table in
`work-packages-draft.md`, plus a Quality-Checklist item "every plan AC appears in the
coverage table."

### P2 — I3: Collapse the dual AC copies to a single source

| Impact | Confidence | Effort | Priority |
|:------:|:----------:|:------:|:--------:|
| 3 | 4 | 2 (Low) | **P2** |

**Why:** A contributing factor, not a primary trigger. Largely **subsumed by I1**: once spec
files are created post-registration and I2's gate reconciles content, the dual-copy risk
mostly evaporates. Still worth codifying.

**Fix:** Instruct the Bootstrapper to derive the `acceptance_criteria` array by reading it
back from the spec file it just wrote for *that same WP ID*, rather than re-transcribing from
the draft. Optional server-side defense: warn when array count ≠ file AC count.

### P2 — I5: Prevent phantom criteria from paraphrased updates

| Impact | Confidence | Effort | Priority |
|:------:|:----------:|:------:|:--------:|
| 2 | 4 | 1 (Low) | **P2** |

**Why:** A distinct *runtime* symptom, not a placement cause — it compounds AC confusion but
doesn't misfile AC across WPs. Documentation-only fix, so cheap to include.

**Fix:** Add verbatim-copy guidance to the Developer and QA operational-protocol partials:
"copy criterion text verbatim from `ledger_get_work_package`; paraphrasing appends a
duplicate." Optionally normalize (`trim` + case-fold) the `===` match in
[pipeline.ts](../../../mcp-server/src/tools/pipeline.ts) — but note edge-cases.md §21.3
made exact-match intentional, so treat as a separate design decision.

## Priority Summary

| Rank | Issue | Priority | Layer | Effort | Server code? |
|:----:|-------|:--------:|-------|--------|:------------:|
| 1 | I2 — content-level verification gate | **P0** | Verification | Low | No |
| 2 | I1 — Bootstrapper numbering juggle | **P0** | Materialization | Medium | No |
| 3 | I4 — numbered plan AC + coverage table | **P1** | Planning | Low–Med | No |
| 4 | I3 — single AC transcription source | **P2** | Materialization | Low | Optional |
| 5 | I5 — phantom-criteria guidance | **P2** | Runtime | Low | Optional |

**Suggested focus:** Ship **I2 + I1 together** as one Bootstrapper/PM persona revision — I2
provides the safety net while I1 removes the root cause, and both are persona-only. Follow
with I4 as a planning-template pass. I3 and I5 fold in as low-cost hardening.

## Recommended Implementation Sequence

1. **I1 + I2** — single persona-source change set (Bootstrapper Steps 3–6, PM Step 9). The
   verification gate lands alongside the reorder so regressions are caught immediately.
2. **I4** — Planner template + WP Decomposer protocol + coverage table.
3. **I3** — read-back instruction in the Bootstrapper (mostly redundant after I1).
4. **I5** — verbatim-copy guidance in Developer/QA protocols.

## Open Questions

- **Hard failure vs. warning for the I2 gate?** Both reports flag this. Start with a
  normalized-comparison *warning*; promote to hard failure once false-positive rate is known.
- **Should the PM's verification step explicitly consult the coverage table (I4)?** Adding
  this to Workflow Step 7 would close the loop between planning-phase and materialization-phase
  checks.
- **Fuzzy vs. exact AC matching server-side (I5)?** Adding `trim()` + case-fold to the `===`
  merge would reduce phantom criteria but changes intentional behaviour (edge-cases.md §21.3).

## References

Both source reports and their citations:

- [Report A — acceptance-criteria-misplacement.md](2026-07-03-acceptance-criteria-misplacement.md)
- [Report B — ac-misfiling-diagnosis.md](2026-07-03-ac-misfiling-diagnosis.md)
- [WP Decomposer persona](../../../personas/ledger-support/src/content/ledger-wp-decomposer.md)
- [Planner persona](../../../personas/ledger/src/content/1-planner.md)
- [PM persona](../../../personas/ledger/src/content/2-project-manager.md)
- [Bootstrapper persona](../../../personas/ledger-support/src/content/ledger-bootstrapper.md)
- [QA persona](../../../personas/ledger/src/content/4-qa.md)
- [work-package.ts](../../../mcp-server/src/tools/work-package.ts) — dual AC inputs, auto-ID assignment
- [pipeline.ts](../../../mcp-server/src/tools/pipeline.ts) — AC merge logic (exact `===` match)
- [operations.md](../../../mcp-server/docs/agents/workflow-specification/operations.md) — AC update merge semantics
- [edge-cases.md](../../../mcp-server/docs/agents/workflow-specification/edge-cases.md) — §21.3 append-not-reject rationale
- [developer-operational-protocol.md](../../../personas/shared/partials/developer-operational-protocol.md)
- [qa-operational-protocol.md](../../../personas/shared/partials/qa-operational-protocol.md)
