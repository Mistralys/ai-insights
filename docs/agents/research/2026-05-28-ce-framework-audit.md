# CE Framework Gap Analysis — Ledger Workflow Personas

**Date:** 2026-05-28  
**Scope:** All 9 ledger workflow personas audited against the Context Engineering Framework (3 Laws)  
**Framework Version:** CE Framework Extended v3.0 (Dec 2025)  

---

## Executive Summary

The ledger workflow is **strongly aligned** with the CE Framework's 3 Laws. The 9-persona pipeline is essentially a structural embodiment of Context Engineering: each agent receives structured inputs (Law 1), passes domain-specific context forward via the ledger (Law 2), and multiple verification gates exist (Law 3). Additionally, the Plan Refiner agent (delegating to Plan Architect Reviewer and Plan Auditor) provides a user-triggered quality gate that ensures plans meet structural and technical standards before entering the pipeline — a clean separation of authoring from validation.

**The MCP ledger is the backbone of Law 2.** By design, the ledger is a *shared project notebook* — any agent can read any WP's full detail, pipeline history, and project-level comments at any time. This means cross-WP learning, regression awareness, and pattern recognition are all *structurally enabled* by the ledger's existing tools (`ledger_get_work_package`, `ledger_list_work_packages`, `ledger_get_project_status` → `project_comments[]`, `ledger_add_project_comment`). The gaps identified below are primarily **prompting omissions** (personas don't explicitly instruct agents to mine this data) rather than infrastructure limitations.

The remaining targeted gaps are around **explicit prompting** (agents aren't told to leverage ledger history), **verification scaling**, and the **binary bounce mechanism**.

| Law | Assessment | Score |
|-----|-----------|-------|
| Law 1: Structure the Problem | Strong | 95% |
| Law 2: Provide Rich Context | Strong | 85% |
| Law 3: Verify Rigorously | Strong | 85% |

---

## Law 1: Structure the Problem

### What the workflow does well

- Every persona has a clear objective (Mission)
- Explicit constraints (Rules & Constraints)
- Measurable success criteria (Decision Logic: PASS/FAIL)
- Structured output templates
- Defined input/output contracts between agents
- **External plan validation gate:** The Plan Refiner agent provides a user-triggered quality gate for plans before they enter the ledger workflow. It delegates to the Plan Architect Reviewer (architectural critique, challenges design shape, surfaces simplifications) and Plan Auditor (technical defect detection — hallucinated references, missing steps, infeasible sequencing). This separation of authoring (Planner) from validation (Plan Refiner → Architect + Auditor) follows the CE Framework's principle of independent verification

### Gaps

| # | Severity | Persona | Gap | Recommendation |
|---|----------|---------|-----|----------------|
| 1 | ~~Minor~~ N/A | **Planner** | ~~No explicit PASS/FAIL gate for the plan itself before handoff.~~ **Resolved:** The workflow includes a "Plan Refiner" agent that the user invokes when plan scope warrants it. The Plan Refiner delegates to the Plan Architect Reviewer (architectural critique) and Plan Auditor (technical defect detection), guaranteeing that plans entering the workflow meet quality criteria. The gate is external to the Planner persona by design — separation of concerns between authoring and validation. | No action needed |
| 2 | Minor | **Project Manager** | No Decision Logic section — the PM always succeeds if WPs are created. No quality gate for decomposition quality (WPs too large, too coupled, or missing ACs) | Add self-validation: "Each WP has ≤1 responsibility, explicit ACs, and all dependencies point to existing WPs" |
| 3 | Minor | **Synthesis** | No Decision Logic section. The protocol mentions aborting if data is incomplete (step 5) but this is buried, not formalized | Promote to a formal Decision Logic: "FAIL: >30% of WPs lack pipeline metrics or comments" |

---

## Law 2: Provide Rich Context

### What the workflow does well

- **MCP ledger as a shared project notebook:** The ledger is explicitly designed as a cross-WP communication medium. Any agent can read any WP's full detail (`ledger_get_work_package`), list WPs by status or assignee (`ledger_list_work_packages`), and access project-wide comments (`ledger_get_project_status` → `project_comments[]`). This means prior QA results, review findings, security issues, and implementation patterns are *structurally accessible* to every agent at every stage.
- **Project-level comments:** `ledger_add_project_comment` provides a typed, prioritized, agent-attributed shared notebook (types: `incident`, `note`, `decision`; priorities: `low`, `medium`, `high`). These persist across the project lifecycle and are visible to every agent reading project status.
- **Pipeline comments on every WP:** Each pipeline stage records structured comments. When an agent reads a WP (own or another's), it sees the full pipeline history — pass/fail decisions, reviewer feedback, QA findings, security audit results.
- Agent roster gives each persona awareness of the full workflow
- Operational Protocols give step-by-step domain procedures
- Work Package detail carries context from stage to stage — each WP is a self-contained record of its journey through the pipeline

### Gaps

| # | Severity | Persona | Gap | Recommendation |
|---|----------|---------|-----|----------------|
| 4 | **Major** | **Planner** | **No few-shot mechanism.** The Planner researches the codebase but has no mechanism to retrieve or reference *previously successful plans* from the same project. The CE Framework documents 50%+ quality improvement from few-shot examples | Add to Inputs: "Optional: Prior plan documents from `/docs/agents/plans/` — reference their structure and patterns." Add workflow step: "Scan `/docs/agents/plans/` for 2–3 most recent plans to internalize established planning style" |
| 5 | ~~Major~~ Minor | **Developer** | **Prior-implementation context not explicitly prompted.** The Developer *can* read completed WPs via `ledger_get_work_package` (the mechanism exists), but the persona does not explicitly instruct the agent to consult prior COMPLETE WPs for implementation patterns. The gap is a *prompting omission*, not an infrastructure limitation. | Add to workflow: "For non-trivial WPs, scan `ledger_list_work_packages({ status: 'COMPLETE' })` for WPs with similar scope. Reference their pipeline comments for patterns and pitfalls." |
| 6 | ~~Medium~~ Minor | **QA** | **Prior QA results not explicitly prompted.** The QA agent *can* read other WPs' pipeline data (including QA PASS/FAIL comments) via the ledger, and project-level comments capture recurring issues. The persona does not explicitly instruct the agent to check these before starting. | Add to workflow: "Before starting the Verification Stack, read project-level comments (via `ledger_get_project_status`) and scan pipeline comments on recently-completed WPs for recurring failure patterns." |
| 7 | ~~Medium~~ Minor | **Reviewer** | **Prior review context not explicitly prompted.** The Reviewer *can* access project comments and prior review pipeline data through the ledger. The persona does not explicitly instruct leveraging this cross-WP history. | Add to workflow: "Read project-level comments for recurring review themes. Scan pipeline comments on recently-reviewed WPs to identify repeat patterns." |
| 8 | Medium | **All agents** | **No urgency signaling.** The CE Framework documents 10-15% improvement from operational context / emphasis. The workflow has no equivalent of priority-based verification scaling per-WP | Surface WP priority/criticality metadata to agents. A `priority: critical` WP should trigger heightened verification rigor |

---

## Law 3: Verify Rigorously

### What the workflow does well

- Multiple independent verification gates (QA, Security Auditor, Reviewer)
- Bounce-back mechanism (FAIL → rework → re-verify)
- Structured feedback via pipeline comments
- Rework Handling sections for focused re-entry
- Decision Logic with explicit PASS/FAIL criteria

### Gaps

| # | Severity | Persona | Gap | Recommendation |
|---|----------|---------|-----|----------------|
| 9 | **Major** | **Developer** | **No self-verification checklist.** The CE Framework's Verification Rigor Matrix says production code needs automated tests + functional validation + expert review + documentation. The Developer only runs tests + linter before handoff — no structured self-check | Add a self-validation step after "Verify & Refine": "Before completing the pipeline: (1) all new code paths have test coverage, (2) build passes cleanly, (3) no `TODO`/`FIXME` items remain from this WP, (4) all ACs have an observable verification" |
| 10 | Medium | **QA → Developer loop** | **Binary bounce mechanism.** The CE Framework distinguishes *iterate* (70%+ correct) from *re-prompt* (<50%). The workflow has no concept of "severity of bounce" — a typo and a fundamental design flaw both route identically | Add bounce severity: `minor_rework` (targeted fix, skips re-review) vs. `major_rework` (significant redesign, full re-review) |
| 11 | ~~Medium~~ N/A | **Planner** | ~~**No user iteration gate.** Workflow step 4 says "Guide the user through refining" but the handoff block goes straight to `STATUS: READY_FOR_PM`. No intermediate `STATUS: NEEDS_USER_REVIEW`~~ **Resolved:** The Plan Refiner agent serves as the user iteration gate. When the user deems the plan's scope warrants it, they invoke the Plan Refiner which orchestrates iterative refinement: architectural review (Plan Architect Reviewer), finding integration, and repeated auditing (Plan Auditor) until the plan is audit-clean or a ceiling is reached. The decision to invoke the Refiner is intentionally user-driven — simple plans proceed directly, complex plans get multi-pass validation. | No action needed |
| 12 | Minor | **Synthesis** | **No cross-verification.** Synthesis trusts pipeline metrics at face value. Does not verify that PASS claims match actual AC text | Add: "Cross-reference pipeline `status: PASS` against AC text. Flag inconsistencies (e.g., AC says '80% coverage' but no coverage metric reported)" |
| 13 | Minor | **Security Auditor** | **Prior security findings not explicitly prompted.** The Security Auditor *can* access project-level comments and prior `security-audit` pipeline data via the ledger, but the persona does not explicitly instruct prioritizing previously-identified OWASP categories. | Add to workflow: "Read project-level comments and prior security-audit pipeline results to identify previously-flagged OWASP categories. Prioritize those in the current WP." |

---

## Cross-Cutting Systemic Gaps

These affect the workflow architecture as a whole:

### A. No "Minimum Viable Context" (MVC) Rule

**CE Framework principle:** For each piece of context, ask "does this directly affect the output?"

**Design intent:** The ledger deliberately provides *full* context to any agent that reads it. This is the correct architectural choice — the ledger is a shared notebook, and restricting reads would undermine its value as a cross-agent communication medium. The question is not "should agents see less data?" but "do personas guide agents on what to *prioritize*?"

**Gap:** While access to full context is by design, personas don't guide agents on what subset of ledger data is most relevant to *their specific task*. An agent reading 15 WPs of pipeline history wastes tokens if only 2 are relevant.

**Recommendation:** Each persona's "Read Context" workflow step should specify what to focus on. E.g.:
- QA → focus on `acceptance_criteria`, `implementation.artifacts`, and prior QA pipeline FAILs
- Reviewer → focus on `implementation.artifacts` and project-level architectural comments
- Security Auditor → focus on `implementation.artifacts` and file paths containing auth/crypto/input handling
- Developer on rework → focus on the specific pipeline comments from the FAIL that triggered rework

---

### B. No Verification Rigor Scaling by Criticality

**CE Framework principle:** Verification Rigor Matrix (Critical/High/Medium/Low) determines depth.

**Gap:** Every WP receives identical verification rigor. A documentation typo fix goes through the same QA → Security → Review → Release pipeline as a critical authentication change.

**Current mitigation:** The Pipeline Configurator can skip entire stages for lightweight WPs. But *within* an active stage, rigor is constant.

**Recommendation:** WP metadata could include `criticality: high | medium | low`:
- **High:** Full OWASP scan, all 4 Review Dimensions deep-dived, edge-case budget of 4+
- **Medium:** Standard Verification Stack (current behavior)
- **Low:** Abbreviated check — build passes, ACs met, no regression. Skip edge-case stress test

---

### C. Knowledge Accumulation — Mechanism Exists, Prompting Incomplete

**CE Framework principle:** "Each useful case should leave a reusable artifact." The Virtuous Cycle: first time zero-shot → document → second time few-shot → better results.

**What the ledger already provides:** The ledger IS a knowledge accumulation system by design. Project-level comments (`ledger_add_project_comment`) persist across the entire project lifecycle and are visible to all agents. Every WP's pipeline history (comments, pass/fail results, rework feedback) remains accessible indefinitely via `ledger_get_work_package`. An agent reading a new WP can cross-reference any completed WP's full history. This is the ledger's core philosophy: it's a **project notebook for agents to exchange information**.

**Remaining gap:** While the *mechanism* is robust, two narrower issues persist:
1. **No persona explicitly prompts agents to mine the ledger for patterns.** The data is there, but agents aren't instructed to look at it proactively.
2. **Cross-project knowledge does not transfer.** The ledger is per-project. Lessons from Project A are not visible in Project B. `history/key-learnings.md` exists as a cross-project knowledge file but is not referenced by any persona.

**Recommendation:**
1. Add a "Read project history" step to verification personas (QA, Security Auditor, Reviewer): "Scan project-level comments and pipeline history on COMPLETE WPs for recurring patterns."
2. The Planner should reference `history/key-learnings.md` as a cross-project few-shot context source.
3. Consider having Synthesis write a structured `project_comment` (type: `decision`, priority: `high`) summarizing key patterns discovered — this feeds forward within the same project ledger automatically.

---

### D. No "Iterate vs. Re-Prompt" Decision Framework

**CE Framework principle:** Clear criteria determine whether to iterate (modify existing output) or re-prompt (start over):
- Iterate: output is 70%+ correct, problem is specific and localized
- Re-prompt: output is <50% correct, fundamental comprehension problem

**Gap:** The workflow's bounce mechanism is binary. QA says FAIL → Developer reworks. There is no guidance on:
- How severe is the rework?
- Should the WP return to the Planner for re-scoping?
- Should it be split into smaller WPs?

**Recommendation:** Add a `severity` field to bounce comments:
- `minor` — Localized fix (1-2 specific issues). Developer iterates.
- `major` — Significant rework needed (multiple issues, partial redesign). Developer re-implements section.
- `critical` — Architectural mismatch, fundamental misunderstanding of requirements. Escalate to Planner for re-scoping. WP may need to be cancelled and re-planned.

Map to downstream routing:
- `minor` → Developer rework → skip full re-review (targeted re-check only)
- `major` → Developer rework → full re-review pipeline
- `critical` → Escalate to Planner → new plan cycle

---

## Summary of Recommendations by Priority

| Priority | Count | Theme |
|----------|-------|-------|
| **Major** | 1 | Few-shot context (prior plans — no ledger mechanism for cross-project exemplars) |
| **Medium** | 2 | Verification scaling, feedback loop severity |
| **Minor** | 6 | Prompting gaps (agents not explicitly instructed to mine ledger history), self-validation checklists, MVC guidance |
| ~~Resolved~~ | 2 | Plan validation gate (gap #1) and user iteration gate (gap #11) — addressed by Plan Refiner agent |
| ~~Downgraded~~ | 3 | Gaps #5, #6, #7 — ledger mechanism exists, only prompting is missing (Major/Medium → Minor) |

---

## Top 3 High-Impact Improvements

### 1. Feed prior plans as few-shot context to the Planner

**CE Framework evidence:** 50%+ quality improvement from relevant examples.  
**Current state:** The Planner produces plans without reference to how prior plans in the same project were structured. Note: plan *quality* is already gated by the Plan Refiner agent (Plan Architect Reviewer + Plan Auditor), so structural defects are caught. However, the few-shot gap is about *style consistency and pattern reuse* — the Planner could produce better first drafts (requiring fewer Refiner iterations) if it had exemplars.  
**Implementation:** Add a workflow step to scan `/docs/agents/plans/` for recent plans. Reference their structure, level of detail, and pattern decisions.  
**Effort:** Low (persona content change only).

### 2. Add bounce severity levels to the FAIL feedback loop

**CE Framework evidence:** "Iterate vs. Re-Prompt" decision prevents wasted cycles.  
**Current state:** All bounces route identically regardless of severity.  
**Implementation:** Add `severity` field to pipeline comments on FAIL. Route based on severity level. May require MCP tool schema change to formalize.  
**Effort:** Medium (persona + potentially MCP tool change).

### 3. Add explicit "mine the ledger" prompting to verification personas

**CE Framework evidence:** "Each useful case should leave a reusable artifact."
**Current state:** The ledger already stores all pipeline results, project comments, and WP histories — this is its core design philosophy as a shared project notebook. However, no persona explicitly instructs agents to *proactively read* cross-WP data before starting their own work. The mechanism is robust; the prompting is missing.
**Implementation:** Add a "Read project history" workflow step to QA, Security Auditor, Reviewer, and Developer personas: scan project comments and COMPLETE WP pipelines for recurring patterns/findings before starting.
**Effort:** Low (persona content change only — no tooling or schema changes needed).

---

## Decision Points for Discussion

1. **Scope of change:** Should we implement all 13 gaps, or prioritize the Top 3 and revisit later?
2. **MCP tool changes:** Gap #10 (bounce severity) may require `ledger_complete_pipeline` to accept a `severity` field. Is this a workflow spec change or can it be encoded in comments?
3. **Knowledge file convention:** The ledger already serves as the per-project knowledge accumulator (project comments, pipeline history). The remaining gap is *cross-project* knowledge. Where should that live? `history/key-learnings.md` (current)? Something else?
4. **Verification scaling:** Should `criticality` be a WP-level field in the ledger schema, or just advisory text in the WP spec document?
5. ~~**User iteration gate (gap #11):**~~ **Resolved.** The Plan Refiner agent provides the iteration gate. The user invokes it when plan complexity warrants multi-pass validation (architectural review + technical audit). Simple plans proceed directly to PM — this is by design, not a gap.
