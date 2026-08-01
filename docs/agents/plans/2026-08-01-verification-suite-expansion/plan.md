# Verification Suite Expansion — Implementation Brief

> **Prepared for:** Persona Curator
> **Date:** 2026-07-31
> **Revision:** v3.5 (2026-07-31) — documentation & build-target reconciliation promoted to a work item (**new Item 7**, new Phase 0): Claude Code output policy resolved to **standalone-suite-only** (routing-fidelity rationale; levers: `persona-build.config.js`, retire `syncClaudeCode`, keep `syncStandaloneClaudeCode`), which settles Item 1's output-flavor decision by policy; Coordinator reconciliation grounded in its actual source location (standalone suite, both flavors); **Planner tool-matrix discrepancy verified fixed** in the updated technical reference (`ledger_get_repository_context` + `ledger_search_insights` now documented for the Planner), confirming the verdict-loudness loop's load-bearing dependency; bundle-regeneration item added (generated doc — regenerate, don't hand-edit); standalone AV input path clarified (plan-folder `request.md`, no MCP dependency).
> **Revision:** v3.4 (2026-07-31) — grounding pass against the repository documentation (persona roster, workflow companion, **Agent Workflow Specification v2.5.1**, technical reference bundle): tool-name correction (`ledger_create_project` → `ledger_initialize_project`); server-side phase routing made explicit (new `READY_FOR_ACCEPTANCE_VERIFICATION` handoff status, agent-registry mapping, VS Code auto-handoff chain); verdict-recording tool named (`record_acceptance_report`) with its Tool Allocation Matrix and `.meta.json` consequences; **Workflow Specification amendment** and **Ledger Standalone Archiver / `ledger_import_standalone` amendment** added as first-class touchpoints; Item 1 persona work restated in build-system terms (YAML source → `build-personas.js` outputs, three output flavors incl. an explicit Claude Code decision, model registry); dispatch-parity question resolved to the existing `subagents:` / `load_subagents()` mechanism; Coordinator deprecation scope widened (sync-script deployment, execution-mode tables, contradictory roster entry); wording fixes (requiredness derivation, knowledge-store doc claim, browser-capability verification, post-COMPLETE `reworked_by` edge case).
> **Revision:** v3.3 (2026-07-31) — filterable acceptance outcome: derived `acceptance_outcome` enum (`PASSED` / `PASSED_WITH_GAPS` / `FAILED` / `UNVERIFIED` / `NOT_APPLICABLE`) computed in `central_pm` as the single mapping for all consumers; GUI badge + filter; rework linkage (`rework_of` / `reworked_by`) so the failed filter distinguishes unaddressed failures from reworked ones.
> **Revision:** v3.2 (2026-07-31) — AV made fully non-blocking: all verdicts, including `DOES NOT SOLVE`, let Synthesis and archival proceed. Fixes a v3 contradiction (the recovery path, Planner Synthesis-Rework, consumes a synthesis document the hold-open gate would have prevented from existing) and lets failed projects feed the knowledge base. Verdict loudness replaces gating: verdict leads the Status Report, persists as an archived outcome field surfaced via `ledger_get_repository_context`, and is stated in the run-completion output. Hold-open machinery removed from `central_pm` and the Ledger Doctor amendment.
> **Revision:** v3.1 (2026-07-31) — terse-request handling: `request.md` defined as a bundle (verbatim prompt + requester-authored attachments + optional ratified intent restatement); new `INTENT UNDERDETERMINED` verdict replacing guessing; ratification mechanism at end of planning session with a no-implementation-language guardrail enforced by the Plan Auditor.
> **Revision:** v3 (2026-07-31) — aligns the brief with the actual execution architecture (VS Code Chat + LangGraph orchestrator; Coordinator retired): AV repositioned as a project-level phase before Synthesis with restated blocking semantics; plan-blindness enforced via restricted per-node tool surfaces; verbatim-request persistence moved upstream to the Planner; snapshot-ref baseline relocated into the `central_pm` MCP server; sub-agent dispatch parity made an explicit decision point; Coordinator dependency replaced with a deprecation action.
> **Revision:** v2 (2026-07-31) — incorporates review amendments: verbatim-request persistence, mechanical plan-blindness enforcement, plan-level AV granularity and blocking semantics, per-WP diff baseline decision, pipeline-artifact allowlist, `VERIFIED-BY` verification channels, rulebook precedence, documentation-accuracy findings, and a phased rollout order.
> **Scope:** 2 new agent personas, 1 new sub-agent persona, 1 new mode on an existing persona, 2 prompt/template amendments, pipeline integration notes, *(v3.4)* 1 Workflow Specification amendment plus 1 amendment to `ledger_import_standalone` / the Ledger Standalone Archiver, and *(v3.5)* 1 documentation & build-target reconciliation item.
> **Status:** Proposal — implement via Persona Curator Create/Maintain modes as indicated per item.

---

## Motivation & Design Principle

The current pipeline verification stages (QA, Security Auditor, Reviewer) differ in persona but not in inputs: all three read the same Work Package and verify against the same acceptance criteria. They therefore share the plan's blind spots. The Plan Auditor and Plan Architect Reviewer mitigate this upstream, but nothing downstream verifies **without the plan in hand**.

**Design principle for this expansion:** verification agents earn their existence by differing from existing agents in *inputs* or *cadence*, not merely in what they pay attention to. Information asymmetry — deliberately withholding context from an agent — is a verification tool.

**Execution-mode assumptions (v3).** This brief targets the two supported execution environments only: **VS Code Chat (manual stage-by-stage invocation)** and the **LangGraph/Deep Agents Orchestrator** with its pure-Python deterministic supervisor. The **Ledger Claude Coordinator is retired** — it depended on an LLM respecting ledger routing, which proved unreliable — and Claude Code remains unsupported per the workflow documentation. Two architectural facts do heavy lifting throughout this revision: (a) the orchestrator's supervisor makes routing decisions in deterministic Python via `ledger_get_next_action`, with no LLM in the routing loop; (b) each orchestrator stage node wraps the shared MCP tools before creating its Deep Agent, so **per-stage tool-surface restriction is available as an enforcement mechanism**. Where v2 asked an LLM coordinator to behave, v3 makes the harness structurally incapable of misbehaving.

The six verification gaps addressed (from post-implementation verification analysis):

1. Spec-to-intent gap — nothing verifies the running feature against original intent, plan-blind.
2. Negative space of the diff — no check of changes *outside* the plan's declared scope.
3. Test strength — tests are verified for presence and coverage, not for defect-detection power.
4. Security supply chain — mostly covered; minor charter amendment needed.
5. Operational readiness — absent from plans, therefore never verified.
6. Architectural drift — per-WP review is structurally blind to cumulative erosion.
7. Documentation accuracy *(added in v2)* — Stage 8 writes documentation; nothing verifies it against actual behavior. Closed inside Item 1 at zero structural cost (see the documentation-divergence finding category).

---

## Item 1 — NEW AGENT: Acceptance Verifier

**Persona Curator mode:** Create *(v3: plus MCP server, orchestrator, and persona-template code changes — see Pipeline Integration; this item is no longer persona-only work)*
**Suite:** Ledger Pipeline (project-level phase, pre-Synthesis) + Standalone variant
**Addresses gaps:** Spec-to-intent; documentation accuracy (v2)

### Role Brief

**Identity:** Product Acceptance Specialist (user advocate, non-engineer perspective)

**Mission:** Verify that the delivered feature solves the problem the requester actually had — independently of how the plan interpreted it.

### Critical Design Constraint (non-negotiable)

**This agent MUST NOT read the plan document, Work Package, acceptance criteria, synthesis, or any pipeline artifact.** Its entire value derives from its ignorance of the implementation frame. If it reads the plan, it degenerates into a second QA pass and duplicates existing coverage. The persona instructions must state this prohibition explicitly and include it in Strict Constraints.

### Inputs

- The **`request.md` bundle** *(redefined in v3.1)*, retrieved **exclusively via the dedicated `get_original_request` MCP tool** (see Operational Dependencies below) — never via general ledger reads, which would expose adjacent pipeline artifacts. The bundle contains:
  - The **verbatim initial prompt** as submitted to the Planner (pre-Planner, unedited).
  - Any **requester-authored attachments** provided at planning time — e.g., a UI-specification markdown document. These are pre-plan requester intent, not pipeline artifacts, and are therefore legitimate AV input; bundling them removes the ambiguity of their status.
  - Optionally, a **ratified intent restatement** (see Operational Dependencies, dependency 1) — clearly marked as a ratified restatement, never silently merged with the verbatim text.

  Note on terseness: a terse request is *not* a defect for this agent — the terser the request, the more interpretive liberty the Planner took, and the more a plan-blind check can catch. A detailed requester-written project description would shrink that gap and push the AV toward a redundant second QA pass. The quality bar for a request is **decidability**, not detail: could a stranger with only this bundle and the running application judge whether the goal was achieved?
- **User-level interaction capability** with the running application *(broadened in v2 from "browser access")*: a browser for UI-facing deliverables (reuse the browser capability pattern from Developer — Standalone v1.4.0: navigate, click, fill forms, screenshot); a plain HTTP client for API-surface deliverables. The capability is selected from the nature of the delivered feature — an API consumer exercising endpoints is the "user" of an API change, and a browser pantomime adds nothing there. *(v3.4)* The reuse claim is **unverified against the repository documentation** — the workflow companion, specification, and technical reference contain no browser-capability description for Developer — Standalone. Confirm the capability exists in that persona's source before Phase 4 depends on it; if absent, specifying the browser toolset is new work inside this item, not a reuse.
- Optionally: user-facing documentation (README, WHATSNEW), since a real user would have access to these. **When documentation is available, the Verifier must follow it as literal instructions during the walkthrough** and report any divergence ("docs say X, app does Y") under the documentation-divergence finding category. A plan-blind reader executing the docs is the strongest available documentation test, and it costs no new persona (closes gap 7).

### Outputs

- **Acceptance Report** written to the plan folder as `acceptance.md` (standalone) or recorded to the ledger (pipeline), containing:
  - Verdict: `SOLVES INTENT` / `PARTIALLY SOLVES` / `DOES NOT SOLVE` / `INTENT UNDERDETERMINED` *(v3.1)*
  - A narrative walkthrough of the attempt to accomplish the requester's goal as a user would
  - Findings categorized as: intent mismatch, usability friction, confusing states, "technically conforms but misses the point", **documentation divergence** (v2 — docs-as-instructions walkthrough failures)
  - For `INTENT UNDERDETERMINED`: which aspects of the request could not be verified and what a decidable request would have stated — feedback on request-writing, not on the implementation
  - Screenshots as evidence where applicable

### Key Behaviors

- Attempts the user's goal from the request text alone; does not reverse-engineer what the implementation "intended."
- **Never guesses intent (v3.1).** When the request bundle does not support a verdict — the goal is not decidable from the text plus the running application — the Verifier returns `INTENT UNDERDETERMINED` rather than inventing an interpretation. A guessed intent is a *third* interpretation, neither the requester's nor the Planner's, and is worse than useless as a verification signal.
- Explores adjacent paths a real user would stumble into (wrong input, back button, empty states).
- Reports observations without proposing implementation fixes — findings route back to the Planner/user, not the Developer, because an intent mismatch is a *plan* defect.

### Pipeline Integration (rewritten in v3 — project-level phase, not a WP stage)

**Why not a WP stage.** The ledger enforces a canonical six-stage WP ordering, `ledger_get_next_action` returns a fixed action enum, and the orchestrator graph has one node per stage. Inserting a new WP stage between `code-review` and `release-engineering` would require changes to the stage-ordering machinery, a new action directive, new status-transition rules, and Configurator rework — heavy, and it would reintroduce the per-WP granularity problem v2 already rejected (intent maps to the *plan*, not to any WP; per-WP verdicts would mean "the plan isn't finished," not "intent was missed").

**Chosen integration: a project-level phase, the same class of thing as Synthesis.** The supervisor already implements "all roles return `WAIT` → route to Synthesis." This becomes:

```
all WAIT → Acceptance Verification (if required and not yet verified) → Synthesis
```

Concretely:

- One new supervisor routing case and one new orchestrator stage node (persona template in `orchestrator/src/nodes/templates/`, restricted tool wrapper — see Operational Dependencies).
- One new project-level ledger field: `acceptance_verification` with status (`REQUIRED` / `NOT_REQUIRED` / `SKIPPED_NO_ENVIRONMENT` / verdict) — no changes to WP stage ordering, WP status transitions, or the per-WP action enum.
- *(v3.4)* One new **server-side handoff status**: `READY_FOR_ACCEPTANCE_VERIFICATION`. In VS Code mode routing is entirely server-computed — `ledger_get_handoff_status`, the handoff payload embedded in `WAIT` responses, `INVOKE_AGENT` auto-promotion, and `findNextReadyDispatch()`, whose all-terminal branch currently returns `READY_FOR_SYNTHESIS`. The new status is interposed before that branch: returned when all WPs are terminal and `acceptance_verification` is `REQUIRED` and unresolved; falls through to `READY_FOR_SYNTHESIS` otherwise. The AV role is registered in the agent registry (the `*.agent.md` frontmatter scan) so `auto_handoff` prompts carry the correct `@id` routing prefix. This is routing *awareness*, not gating — no verdict blocks anything; the server merely knows the phase exists. The orchestrator supervisor case is the Python-side twin of the same rule.
- In VS Code Chat, the human invokes the AV persona in a fresh conversation once all WPs are finalized; `ledger_get_handoff_status` at that point names the AV as next via the new status. *(v3.4)* Note that "manual mode" is not purely manual — agents 2–9 auto-handoff via `runSubagent` when the server returns an `auto_handoff` entry; without the server-side status above, that chain would dead-end silently at all-WPs-finalized, skipping the AV in exactly the runs where the human wasn't watching.

**Requiredness determination (replaces per-WP skip logic):** the project requires acceptance verification if **any WP touched UI, API surface, or user-visible behavior** — derivable by the Configurator at decomposition time from the WP definitions' *content* (titles, descriptions, declared scope), overridable by the PM. *(v3.4 wording fix: `active_pipeline_stages` do not encode UI/API-touch, so the derivation reads the WP definitions, not the stage lists.)* The Reviewer retains the v2 late-activation escape hatch: it may set the requiredness flag when implementation reveals user-visible behavior change the plan did not declare (e.g., a refactor that altered behavior). Skip-for-environment remains a recorded state (`SKIPPED_NO_ENVIRONMENT`), never a silent omission.

**Verdict semantics (rewritten in v3.2 — fully non-blocking; Synthesis always runs).** v3's hold-open gate for `DOES NOT SOLVE` contained a contradiction: its recovery path is Planner Synthesis-Rework mode, whose *input is a synthesis document* — the gate blocked the artifact its own recovery consumes. It also blocked archival and knowledge extraction, meaning failed projects — the most instructive ones — would never have contributed to institutional memory. Therefore: **the AV never blocks anything.** Every verdict is recorded, Synthesis runs unconditionally, the project archives, and rework proceeds naturally from the synthesis document, which — with the acceptance report folded in — is a *richer* rework input than the acceptance report alone (intent-miss findings alongside code insights, scope audit results, and per-WP observations).

- `SOLVES INTENT` — recorded; Synthesis and archival proceed.
- `PARTIALLY SOLVES` — recorded; verdict and findings appear prominently in the Status Report so the gap is visible for the requester's ship/rework decision.
- `DOES NOT SOLVE` — recorded; Synthesis and archival proceed, with the recommendation to produce a rework plan (Planner — Standalone, Synthesis Rework mode) carried in the Status Report. It never bounces to the Developer, because an intent mismatch is a *plan* defect. In this ecosystem release engineering is versioning and changelog curation, not deployment — the "do not ship" gate is, and remains, the human; the AV's job is to make sure the human arrives at that gate informed, not to withhold the paperwork.
- `INTENT UNDERDETERMINED` *(v3.1)* — recorded; feedback about the request, not the implementation — it says nothing was verifiable, not that something failed. Includes the Verifier's note on what a decidable request would have stated, and flags that this project's outcome was never independently verified.

**Verdict loudness (v3.2 — replaces gating).** The cost of non-blocking is that a failed project archives looking procedurally identical to a success; the signal must therefore be structurally loud rather than dependent on the requester reading carefully:

1. **The verdict leads the Status Report** — first line, before achievements, not a section below them.
2. **The verdict persists as an archived outcome field** on the project, so the GUI badge distinguishes it and — more importantly — **`ledger_get_repository_context` surfaces it in the project history**: the next planning session on this repository starts knowing that project N did not solve its request, closing the loop even if the requester skimmed.
3. **The orchestrator's run-completion output states the verdict explicitly** — never a bare "run complete."

**Acceptance outcome indicator (v3.3 — filterable, derived once, consumed everywhere).** The raw verdict states are optimized for the report, not for filtering — a GUI filter shouldn't need to know that `SKIPPED_NO_ENVIRONMENT` and `INTENT UNDERDETERMINED` both mean "unverified." `central_pm` therefore derives a compact **`acceptance_outcome`** enum from the `acceptance_verification` field and stores it on the archived project:

| `acceptance_outcome` | Derived from |
|---|---|
| `PASSED` | `SOLVES INTENT` |
| `PASSED_WITH_GAPS` | `PARTIALLY SOLVES` |
| `FAILED` | `DOES NOT SOLVE` |
| `UNVERIFIED` | `INTENT UNDERDETERMINED` or `SKIPPED_NO_ENVIRONMENT` |
| `NOT_APPLICABLE` | `NOT_REQUIRED` (AV never in scope for this project) |

The derivation lives in the server — one mapping, so the GUI badge, the project-list filter, `ledger_get_repository_context`, and the orchestrator's run-completion line all agree by construction rather than each reimplementing the classification. The underlying verdict and acceptance report remain available for drill-down; the enum exists purely so "show me everything that didn't pass" is one filter, not a query over report text. `PASSED_WITH_GAPS` is kept distinct rather than folded into either neighbor so the requester decides per-context whether partial counts as passing.

**Rework linkage (v3.3 — keeps the failed filter meaningful over time).** Without linkage, the `FAILED` filter accumulates forever and stops distinguishing "needs my attention" from "already handled." When a plan is produced via **Planner Synthesis-Rework mode**, the Planner records the source project's ID in the plan; the **Bootstrapper** registers it as `rework_of` on the new project at creation, and `central_pm` sets the reciprocal **`reworked_by`** on the failed project. The GUI can then filter `FAILED` into **unaddressed** (`reworked_by` empty) versus **reworked** (link present, with the rework project's own outcome one click away) — turning the indicator from a wall of shame into a worklist that empties.

### Operational Dependencies (rewritten in v3 — actions outside this persona)

The plan-blindness constraint is only as strong as its enforcement. Four dependencies must land with, or before, this persona:

1. **Verbatim request persistence — at planning time, not bootstrap.** The orchestrator is launched with a plan document (`./menu.sh orchestrator path/to/plan.md`); in headless mode the raw pre-Planner request never enters the system unless it was captured earlier. Therefore: the **Planner (v2.2.0) and Planner — Standalone (v2.0.1)** persist the request as `request.md` in the plan folder at planning time; the **Ledger Bootstrapper (v1.2.0)** registers it into the ledger as a first-class artifact at project creation *(v3.4: concretely, extend **`ledger_initialize_project`** — which already archives `plan.md` into the ledger project folder — to archive `request.md` alongside it; the Bootstrapper's role is to pass the bundle through at initialization)*; the **`central_pm` MCP server** exposes a dedicated **`get_original_request`** tool that returns exactly that artifact and nothing adjacent. Without the Planner-side half, the Verifier has nothing to be blind *toward* in orchestrator runs.

   *(v3.1)* **`request.md` is a bundle, and intent that emerged in dialogue needs a capture mechanism.** The requester's intent is often not fully contained in the initial prompt — it emerges through the planning conversation (Planner asks, requester answers, course corrects). The initial prompt alone under-captures it; the requester's raw conversation turns can't be persisted alone because they're incomprehensible without the Planner's questions ("yes, the second option"). The Planner therefore assembles `request.md` as:

   - **Always:** the verbatim initial prompt, plus any requester-authored attachments (e.g., UI-specification markdown) — unedited.
   - **When the prompt is terse or intent emerged through dialogue:** at the end of the planning session — while the requester is still present interactively, before the plan goes to the headless orchestrator — the Planner emits a short **intent restatement at goal level** and the requester ratifies or edits it. The ratified text is appended to the bundle, clearly marked as a ratified restatement, never merged with the verbatim text.
   - **Contamination guardrail:** the restatement must contain **no solution or implementation vocabulary** — problem, user, and observable success only. The Planner drafting it is a plan-frame leak by construction; goal-level phrasing plus requester ratification is what makes it acceptable. The "technically conforms but misses the point" failures the AV exists to catch live *below* goal level, so they survive a goal-level restatement intact. The **Plan Auditor (v1.7.0)** enforces the no-implementation-language rule mechanically as part of its checklist.

   The ratification step is a backstop, not a demand for requester discipline: a requester who opens planning sessions with a few sentences of *why* (problem + observable success) usually makes it unnecessary, but the pipeline must absorb inconsistent request-writing rather than depend on consistent request-writing.
2. **Isolation via restricted tool surface, not dispatch etiquette.** *(Replaces the v2 Coordinator amendment, which is void — the Coordinator is retired.)* In the **orchestrator**, the AV stage node wraps only a minimal tool set before creating its Deep Agent: `get_original_request`, the user-level interaction capability (browser / HTTP client), and its report-write tool. No `ledger_get_project_status`, no plan-folder file reads. The agent is not asked to be blind; it is structurally incapable of seeing. In **VS Code Chat**, invocation in a fresh conversation is naturally isolated (the contamination vector was always an LLM coordinator relaying context); the residual requirement is that the AV `.agent.md` restricts its `tools:` frontmatter allowlist to the same minimal set and instructs self-service via `get_original_request`. The persona-level Strict Constraint remains as defense in depth, not as the primary mechanism.
3. **Runnable environment.** User-level interaction presumes a running, seeded application. The persona's preflight must define who starts it and how (dev server bootstrap, seed data); where no runnable environment can be established, the phase records `SKIPPED_NO_ENVIRONMENT` rather than attempting verification against nothing.
4. **A named verdict-recording tool, and the spec that governs it (v3.4).** The restricted tool surface referenced "its report-write tool" without naming it: the server exposes **`record_acceptance_report`** — verdict plus acceptance report in one write — as the AV's *sole* ledger-write, the only `central_pm` tool in its allowlist besides `get_original_request`. Two consequences follow mechanically: the normative **MCP Tool Allocation Matrix** gains an AV column (the matrix is the reference against which persona `mcp_tools` YAML is verified), and the **`.meta.json` sync** carries `acceptance_outcome`, so project-list filtering never has to open every root index. All of this — the field, the tool, the handoff status — exists formally only once the **Agent Workflow Specification** is amended (see Pipeline Integration Summary): the spec is the authoritative contract that implementation and tests are validated against, so the spec amendment is the *first* artifact of Phase 4, not documentation written after the fact.

---

## Item 2 — NEW SUB-AGENT: Scope Auditor

**Persona Curator mode:** Create
**Suite:** Standalone (dispatched as sub-agent by Reviewer, Stage 6; also user-invocable after standalone Developer runs)
**Addresses gap:** Negative space of the diff

**Dispatch parity (v3 — explicit decision required per execution mode; v3.4 — mechanism confirmed, decision narrowed).** "Reviewer dispatches a sub-agent" is `runSubagent` in VS Code Chat; inside the orchestrator it presumes the reviewer Deep Agent node has equivalent sub-agent support wired to this persona's template. *(v3.4)* That support **exists**: personas carry a `subagents:` YAML field consumed by the orchestrator's `load_subagents()` loader at pipeline startup — currently used only by the Project Manager for its four planning sub-agents. The open question therefore narrows from "does the mechanism exist" to "is LLM-initiated dispatch acceptable here": a `subagents:` entry makes the sub-agent *available*, but the stage agent must still choose to call it. For the Scope Auditor — which runs on **every** WP, unconditionally — the harness-enforcement principle decides it: use **harness-sequencing** (the reviewer stage node itself invokes the Scope Auditor as a second agent within the same stage and merges its report into the stage record); a mandatory check should not depend on the Reviewer remembering. In VS Code Chat, where no harness exists, the Reviewer persona instruction plus `runSubagent` remains the mechanism, with the audit's presence verifiable in the stage record. The same reasoning applies to Item 4's QA → Strength-mode dispatch, with one difference: Strength runs are *conditional* (risk-threshold), so LLM-initiated dispatch via `subagents:` is defensible there — the threshold judgment is agent work anyway.

### Role Brief

**Identity:** Change Control Auditor

**Mission:** Classify every change in the diff as in-scope or out-of-scope relative to the plan's declared scope, and flag unvetted changes. The inverse of the Developer's Code Insight Observer: the Observer reports what the Developer *noticed*; the Scope Auditor verifies what the Developer *did*.

### Inputs

- The full diff of the implementation (uncommitted changes, or diff against the pre-plan baseline commit).
- The plan document / Work Package: declared file and module scope, acceptance criteria.

### Outputs

- **Scope Audit Report** with every hunk classified:
  - `IN-SCOPE` — traces to an acceptance criterion or declared scope item
  - `OUT-OF-SCOPE` — no traceable justification; requires separate human vetting
- Two finding types carry **elevated severity** and must be surfaced at the top of the report:
  1. **Modified pre-existing tests** — any change to a test file that existed before this plan. Rationale: an agent weakening an old assertion to make new code pass turns the suite green while cutting a hole in the safety net. Every such change must be listed with the before/after assertion semantics.
  2. **Opportunistic edits** — refactors, config changes, or "fixes" the Developer made that no acceptance criterion required, even when individually defensible. These are unvetted by definition.

### Key Behaviors

- Mechanical and conservative: when traceability to the plan is ambiguous, classify as out-of-scope and let a human downgrade.
- Does not judge code quality (Reviewer's territory) or correctness (QA's territory) — only scope conformance.
- Cheap enough to run on every WP; no skip logic needed.
- **Pipeline-artifact allowlist (v2):** this expansion's own agents write files that trace to no acceptance criterion — Strength-mode mutation configs (`infection.json5` / `stryker.conf.*`), Architecture Fitness Auditor scaffolds (dedicated `fitness/` folder), `acceptance.md`, and plan-folder reports. Without an allowlist the Scope Auditor flags all of them on every run — permanent false-positive noise generated by the verification suite itself. Classify pipeline-generated artifacts by path convention and generating stage as `PIPELINE-ARTIFACT` (neither in- nor out-of-scope), listed in an appendix for transparency rather than surfaced as findings.
- **Sequencing relative to Strength mode (v2):** the Strength mode's manual fallback deliberately breaks code mid-run. The Scope Audit must run against the *restored* tree — the Reviewer dispatches the Scope Auditor only after the QA stage (including any Strength-mode sub-agent) has completed.

### Strict Constraints

- Read-only. Never modifies code, tests, or the plan.
- No Git write operations (consistent with ecosystem convention).

### Operational Dependencies (actions outside this persona)

The Scope Auditor requires a clean diff baseline. Since agents in this ecosystem do not perform Git writes, **committing before each plan run becomes load-bearing**.

**Dirty-tree check (relocated in v3 — server-side, both modes).** v2 placed the preflight in the Ledger Orchestrator Runner, which exists in only one of the two execution modes. The component present in both is the **`central_pm` MCP server**: it checks for a dirty working tree at project creation (**`ledger_initialize_project`** — *v3.4 tool-name correction; no `ledger_create_project` tool exists*) and refuses or warns, making the guarantee execution-mode-independent. *(v3.4)* Note this and the snapshot-ref capture are the server's **first Git responsibilities of any kind** — today `central_pm` is a pure state store with zero repository interaction. Shelling out to `git` (resolving the working tree via the `.repositories.json` registry) is a new capability *class* for the server, not an incremental extension, and deserves its own test surface in the spec amendment. The **Ledger Orchestrator Runner (v1.5.1)** keeps a preflight as a friendlier early warning before a run is launched, and the **Developer — Standalone (v1.4.0)** flow retains the same check for standalone runs feeding a user-invoked Scope Audit.

**Per-WP baseline decision (v2, resolved in v3 — must be made explicitly, not inherited accidentally).** The plan-start check guarantees a clean baseline for the *plan*; but the Reviewer dispatches the Scope Auditor **per WP**, and WPs execute sequentially — WP 3's diff against the plan baseline includes WP 1's and WP 2's changes. Three options, in ascending invasiveness:

1. **Cumulative-scope audit** — the Scope Auditor receives the union of all prior WPs' declared scopes for the plan and audits the full diff against that union. No Git machinery changes; the trade-off is degraded attribution of an out-of-scope hunk to a specific WP.
2. **Server-side snapshot refs (recommended; relocated in v3 from "orchestrator harness" to `central_pm`)** — when `ledger_begin_work` claims the **implementation stage** of a WP, the MCP server captures a lightweight snapshot via `git stash create` (an unreferenced commit object; touches no branch, index, or working tree) and records the ref in the WP record. The Scope Auditor diffs the current tree against the WP's own snapshot ref. Placing this in the server rather than the orchestrator harness makes the baseline exist **in both execution modes** — VS Code Chat manual mode has no harness, and under the v2 design the baseline would silently not exist there. The server is a process, not an agent, so the no-agent-Git-writes convention survives intact; the server already owns atomic writes and stage-transition enforcement, so this is a natural extension of its authority.
3. **Harness checkpoint commits** — relax the convention to allow the harness one commit per completed WP. Cleanest diffs, but changes the ecosystem's Git contract, interacts with the Git Committer's end-of-run thematic grouping, and exists in only one execution mode.

Option 2 is adopted: execution-mode-independent, preserves the convention, costs one ledger field per WP, and keeps attribution exact.

---

## Item 3 — NEW AGENT: Architecture Fitness Auditor

**Persona Curator mode:** Create
**Suite:** Standalone (periodic, user- or schedule-invoked — deliberately NOT a pipeline stage)
**Addresses gap:** Architectural drift

### Role Brief

**Identity:** Principal Architecture Health Auditor

**Mission:** Detect cumulative architectural erosion that per-WP review cannot see. Five locally-approved Work Packages can still add up to duplicated logic, inverted dependency arrows, parallel patterns, and violated module boundaries. This agent audits the **whole codebase against the project's architectural rules**, not any plan.

### Why not a pipeline stage

The Reviewer (Stage 6) verifies each change against its Work Package; drift is a property of the *accumulation* of changes. The cadence difference (per-WP vs. periodic) is the reason this is a distinct agent — closer in spirit to the Ledger Doctor (system health check) than to the Reviewer (change gate).

### Inputs

- The full current codebase.
- **`constraints.md`** from the Project Manifest (Manifest Curator's canonical architectural rules) — this is the primary rulebook.
- The **Ledger knowledge base** — architectural decisions accumulated by the Ledger Knowledge Archiver are effectively fitness rules that are currently never re-checked. Read them and verify the codebase still honors them.
- Optionally: the ledger's archived plan history since the last audit, to focus attention on recently-touched areas.

**Rulebook precedence (v2):** `constraints.md` and the knowledge base can disagree — the KB accumulates decisions the Manifest Curator may since have superseded. Precedence rule: **`constraints.md` wins**. A conflict between the two rulebooks is itself a finding, routed to the Manifest Curator / Ledger Knowledge Curator for reconciliation — never silently resolved by this agent.

### Outputs

- **Drift Report** containing:
  - Findings per architectural rule: `HOLDS` / `ERODED` / `VIOLATED`, with file/module evidence
  - Cross-cutting observations: duplicated logic that should be shared, dependency-direction violations, pattern forks (new pattern introduced where an established one existed), module boundary breaches
  - A prioritized remediation candidate list, formatted as **input for the Planner — Standalone** to turn into remediation plans
- Where a rule is mechanically checkable (dependency direction, duplication thresholds, boundary linting), recommend or scaffold a **fitness function** so the check migrates from periodic audit into continuous static analysis. Each audit cycle should shrink its own future scope.

### Cadence

Monthly, or every N archived plans (suggest N = 10 as a starting point; tune to plan throughput).

**Ordering (v2):** run the **Ledger Knowledge Curator (v1.2.0)** immediately before each Fitness audit. Auditing the whole codebase against a KB containing stale, duplicate, or low-value entries wastes the expensive part of the run on rules that shouldn't exist. This pairing also gives the Knowledge Curator's "periodic" cadence a concrete trigger, which it currently lacks.

**Documentation touchpoint (v3.4):** `workflow-and-ledger.md` states that only the Planner and Synthesis interact with the knowledge store directly. This item adds a third direct reader (and the Knowledge Curator already audits the store, so the claim was loose before this brief). Update the Knowledge Store section of that document when this persona lands — the same doc pass can note the read-only nature of the Fitness Auditor's access.

### Strict Constraints

- Read-only against application code. May scaffold fitness-function configs (linter rules, dependency-cruiser/deptrac configs) as its only write output, in a dedicated folder for human review.
- Does not relitigate decisions recorded in the knowledge base — it verifies conformance to them. Proposing a rule *change* is out of scope (route to human + Planner).

---

## Item 4 — NEW MODE: Unit Test Auditor → "Strength" mode

**Persona Curator mode:** Maintain (targeted amendment to Unit Test Auditor v1.1.1)
**Addresses gap:** Test strength

### Rationale

The Unit Test Auditor currently finds blind spots (tests that are *missing*). The complementary question — do the tests that *were written* actually detect defects — belongs to the same identity (Lead QA Auditor & Test Architect). A mode, not a new agent, consistent with the ecosystem's existing modes convention.

### Mode Specification

**Mode name:** Strength

**Mission (mode-specific):** Verify that new tests would fail if the code they cover were wrong. Detect tautological tests, over-mocked tests, tests asserting on their own setup, and weak assertions.

**Method:**
1. Scope: the test files and covered code introduced or modified by the current plan/WP (not the whole suite — mutation testing is compute-heavy).
2. Run the project's mutation testing tool: **Infection** for PHP, **Stryker** for JS/TS. If neither is configured, report that as a `high` finding and scaffold a minimal config scoped to the new code.
3. Report surviving mutants as findings, each with: the mutant description, the test(s) that should have killed it, and a concrete assertion improvement.
4. Where mutation tooling cannot run, fall back to the manual protocol: select the highest-risk new tests, deliberately break the covered implementation, confirm the tests go red, restore.
5. Explicitly check unhappy-path coverage: error handling, boundary conditions, adversarial inputs. Plans are biased toward happy paths; flag the imbalance when found.

**Dispatch:** The QA stage (Stage 4) may dispatch this mode as a sub-agent for WPs above a risk threshold (suggest: WPs touching authz, money, data integrity, or public API surface). Also user-invocable standalone. *(v3)* Subject to the same dispatch-parity decision as the Scope Auditor (Item 2): verify Deep Agents sub-agent support in the orchestrator's QA node, or harness-sequence the Strength run within the QA stage node.

**Constraints:** Restore all deliberately-broken code before completion (manual protocol). Never "fix" weak tests directly — report only.

---

## Item 5 — TEMPLATE AMENDMENT: Planner plan template — standing operational-readiness criteria

**Persona Curator mode:** Maintain (amendment to Planner v2.2.0 and Planner — Standalone v2.0.1)
**Addresses gap:** Operational readiness

### Rationale

Migration reversibility, observability, feature flags, and rollback paths go unverified because they are absent from plans — not because no agent could check them. Once they are acceptance criteria, the existing QA and Reviewer stages verify them at no extra cost.

### Amendment

Add a mandatory **Operational Readiness** section to the plan template. For each category the Planner must either write a concrete acceptance criterion or an explicit waiver with reason (`N/A — no schema changes`). Silence is not permitted; the Plan Auditor should treat a missing category as a finding.

**Verification channel tag (v2 — prevents unverifiable AC from corrupting QA verdicts).** This amendment creates acceptance criteria no pipeline stage can execute: the performance envelope demands criteria that hold "at realistic (not dev-machine) scale" while the execution agent is deliberately deferred (below). A strict SDET gatekeeper facing such a criterion will either FAIL the WP or silently skip it — both bad. Therefore every Operational Readiness criterion carries a mandatory tag:

- `VERIFIED-BY: QA` — verifiable in-pipeline; QA treats it as any other AC.
- `VERIFIED-BY: human` — outside pipeline jurisdiction; QA lists it as **handed off**, never as passed.
- `VERIFIED-BY: deferred` — acknowledged as unverifiable until execution tooling exists; recorded in the ledger so the deferred set is visible when deciding whether the execution agent (below) has become worth building.

This preserves the specification win of this item without changing what a QA `PASS` means.

Categories:

| Category | The plan must state... |
|---|---|
| **Data migrations** | Whether schema/data changes exist; if so: reversibility, table-locking behavior at production data volume, dry-run requirement |
| **Backward compatibility** | Which contracts are touched (API shapes, event schemas, config formats) and the compatibility guarantee for each |
| **Observability** | What logs/metrics the feature emits that an operator would need during an incident |
| **Rollout control** | Feature flag or equivalent kill switch; rollback path that does not require a new deploy |
| **Performance envelope** | Expected load characteristics and any criterion that must hold at realistic (not dev-machine) scale — N+1 queries, memory behavior, payload sizes |

### Corresponding amendment to Plan Auditor (v1.7.0)

Add to its checklist: verify the Operational Readiness section exists and every category is either concretely specified or explicitly waived. A blanket "N/A" across all categories on a WP that touches persistence or API surface is itself a finding. *(v2)* Additionally verify every Operational Readiness criterion carries a `VERIFIED-BY` tag, and that `QA`-tagged criteria are genuinely executable on a dev machine — a load-scale criterion tagged `VERIFIED-BY: QA` is a mistagging finding.

### Deliberately deferred

Do **not** create an operational-readiness *execution* agent (load testing, migration dry-runs) at this time. Build it only if a recurring need for execution — not just specification — emerges. If it does, it will be a genuine new persona (SRE identity, environment access) rather than a checklist.

---

## Item 6 — PROMPT AMENDMENT: Security Auditor — supply-chain verification for new dependencies

**Persona Curator mode:** Maintain (targeted amendment to Security Auditor v3.6.4)
**Addresses gap:** Security supply chain (residual)

The existing charter (OWASP Top 10, dependency risks, secrets) already covers most of this gap. Add one explicit protocol for **newly introduced dependencies**:

For every dependency added in the current WP, verify:
1. **The package exists and is the intended one** — agents occasionally hallucinate plausible package names, and typosquatted packages exist precisely to catch that. Confirm exact name against the official registry (Packagist / npm), check publisher, download volume, and repository linkage.
2. **Maintenance signal** — last release date, open critical issues, deprecation status.
3. **License compatibility** with the project's license policy.
4. **Known vulnerabilities** — advisory database check (`composer audit` / `npm audit`), which likely already occurs; make it explicit per new dependency rather than suite-wide only.

Findings use the existing severity scheme; a hallucinated or typosquat-suspect package is `Critical`.

---

## Item 7 — RECONCILIATION: Documentation & build-target consistency *(new in v3.5)*

**Persona Curator mode:** Maintain (Coordinator source) + repository maintenance (build config, sync script, two documents)
**Addresses gap:** none directly — removes contradictions this expansion would otherwise inherit and build on top of

The v3.4 grounding pass surfaced contradictions between the workflow documents. They are cheap to fix, independent of all other items, and worth fixing *first*: the Persona Curator creating the AV, and every future reader of this brief, should meet a consistent picture. Four sub-items:

### 7a — Claude Code output targets: standalone-suite-only, stated as policy

The workflow companion states no Claude Code persona outputs are generated for the ledger pipeline; the build reference documents `personas/ledger/claude-code/` as a live target (the build wrapper builds **all suites × both targets** per `personas/persona-build.config.js`, and `syncClaudeCode` deploys ledger CC outputs to `~/.claude/agents/`). Both cannot stay true.

**Resolution — derive the policy from the exclusion rationale rather than picking a document.** Claude Code is excluded because it does not reliably follow ledger *routing*; standalone personas have no routing to violate. Therefore:

- **Ledger suite:** stop generating the Claude Code target — adjust the suite×target matrix in `persona-build.config.js`, remove the `personas/ledger/claude-code/` outputs, and retire `syncClaudeCode` (the ledger-suite CC sync).
- **Standalone suite:** Claude Code outputs remain supported — `syncStandaloneClaudeCode` and `personas/standalone/claude-code/` stay. The documented caveat stands: the standalone CC frontmatter template does not support `mcpServers`, so MCP-dependent standalone personas (e.g., `ledger-bootstrapper`) remain VS-Code-only — consistent with standalone personas being filesystem-first.
- **Companion doc:** replace the blanket sentence with the suite-scoped statement (ledger: VS Code + Deep Agents only; standalone: VS Code + Claude Code, MCP caveat noted) and the routing-fidelity rationale.

**Consequence for Item 1 (settles the v3.4 open decision by policy):** the pipeline AV persona gets **no Claude Code output** — the ledger CC target no longer exists. The **standalone AV variant** follows standalone-suite policy, and is unblocked by the `mcpServers` limitation because *(v3.5 clarification)* the standalone variant reads `request.md` directly from the plan folder — there is no ledger, so `get_original_request` and the exclusive-MCP-access rule are pipeline-variant constraints only. The standalone variant's isolation rests on the fresh-conversation pattern plus the persona's Strict Constraint against reading `plan.md` and other plan-folder artifacts.

### 7b — Coordinator: one story across all surfaces

The companion describes the Coordinator as VS Code Chat automation (`runSubagent`); the roster says it is for running the pipeline *in Claude Code*; the build reference shows it shipping in **both** flavors from the **standalone suite** (`personas/standalone/vs-code/ledger-claude-coordinator.agent.md`, `personas/standalone/claude-code/ledger-claude-coordinator.md`), with the sync script deploying the CC flavor to `~/.claude/agents/`. A "Claude Code coordinator" is self-refuting given the exclusion rationale in the same document set.

**Resolution:** both documents converge on **retired** (per the v3 deprecation), with a one-line history note acknowledging it shipped in both flavors. Concretely: the Persona Curator Maintain operation targets the **standalone-suite source** (not a ledger persona, as v3–v3.4 implicitly assumed); both sync deployments are removed or gated; the companion's Coordinator passages (execution-modes section, "choosing a mode" table, support-persona table) and the roster entry are updated together — reconciled, not one fixed and one forgotten.

### 7c — Planner tool matrix: **verified fixed** *(v3.5 — was a v3.4-era finding, resolved upstream)*

The MCP Tool Allocation Matrix previously stated the Planner "has no MCP tools," contradicting the companion's description of the Planner reading repository context and insights. The updated technical reference now carries `ledger_get_repository_context` and `ledger_search_insights` rows with the Planner column populated and a rewritten rationale (read-only, pre-planning tools). **This materially validates this brief:** the verdict-loudness design (v3.2) surfaces `acceptance_outcome` via `ledger_get_repository_context` on the premise that the Planner actually reads it — that premise is now documented, normative fact rather than an inference from a contradicted document. The v3.4 AV column addition lands on a corrected matrix. (Recorded for completeness: the corrected matrix also documents `ledger_search_insights` for Developer/QA/Security Auditor/Reviewer — no impact on this plan.)

### 7d — Regenerate the technical reference; don't hand-edit it

The technical reference bundle is a generated artifact (the ecosystem's own `<!-- AUTO-GENERATED -->` convention applies) and lags the roster — it shows Developer at v3.4.0/v3.5.0 against v3.7.1 in the roster. After 7a and 7b land, **regenerate** the bundle rather than hand-editing the affected passages; hand edits to a generated document create the next contradiction. Fold the persona-version refresh into the same regeneration.

### Verification status at time of writing

The updated technical reference confirms **7c is done**. The companion and roster copies available to this brief still carry the pre-fix Coordinator and Claude-Code text, so **7a and 7b remain listed as actions**; if they have already landed in the repository, their acceptance criteria below reduce to quick verification checks. The brief is written to be correct in either state.

---

## Pipeline Integration Summary

```
Plan → [1] Planner*        (* amended: Operational Readiness template + VERIFIED-BY
                              tags + assemble request.md bundle, ratify intent
                              restatement before session ends)
     → [2] Project Manager  (Bootstrapper registers request.md into the ledger)
     → per WP, ledger-enforced stage order:
        [3] Developer        (central_pm snapshots baseline at ledger_begin_work)
        [4] QA               (Strength mode: dispatched via subagents:,
                               threshold-judged — v3.4)
        [5] Security Auditor* (* amended: new-dependency supply-chain protocol)
        [6] Reviewer          (Scope Auditor: harness-sequenced in the node — v3.4,
                               after Strength completes; diffs vs WP snapshot ref)
        [7] Release Engineer
        [8] Documentation     (terminal — WP finalized)
     → all WPs finalized       (handoff: READY_FOR_ACCEPTANCE_VERIFICATION — v3.4):
        [NEW project-level phase] Acceptance Verifier
                              (plan-blind; restricted tool surface;
                               input via get_original_request;
                               verdict via record_acceptance_report;
                               non-blocking — verdict recorded, leads the
                               Status Report, persists as outcome field)
     → [9] Synthesis          (always runs; aggregates new report types;
                               rework proceeds from the synthesis document)

Periodic (outside pipeline):
     Ledger Knowledge Curator → Architecture Fitness Auditor
                                   (monthly / every ~10 archived plans;
                                    constraints.md wins over knowledge base;
                                    output feeds Planner — Standalone)
```

Additional touchpoints:

- **Agent Workflow Specification (v2.5.1)** *(v3.4 — first-class touchpoint, previously missing)*: the specification declares itself the authoritative definition of the workflow's state machines, handoff logic, and invariants — the MCP server, orchestrator, and tests are **validated against it**. Everything below that changes server behavior exists formally only via a spec amendment: §3.1 root index (`acceptance_verification`, `acceptance_outcome`, `rework_of` / `reworked_by`), §4 agent roles (the AV role), §13 handoff logic (`READY_FOR_ACCEPTANCE_VERIFICATION` and its position relative to the all-terminal `READY_FOR_SYNTHESIS` branch of `findNextReadyDispatch()`), and new §21 edge cases — including `SKIPPED_NO_ENVIRONMENT` semantics and the post-COMPLETE `reworked_by` write (legal, since archival is a display flag rather than immutability, but it must be *specified*, not discovered). Matching test coverage per the spec's compliance model. The spec amendment is Phase 4's first artifact.
- **`central_pm` MCP server** *(v3, simplified v3.2, extended v3.3, corrected v3.4)*: expose `get_original_request` (returns the verbatim request artifact and nothing adjacent) and **`record_acceptance_report`** *(v3.4 — the AV's sole ledger-write: verdict + report in one call; previously implied as "its report-write tool" but never named)*; extend **`ledger_initialize_project`** *(v3.4 tool-name correction — there is no `ledger_create_project`)* to archive `request.md` beside the `plan.md` it already archives, and to perform the dirty-working-tree check; capture `git stash create` snapshot refs at `ledger_begin_work` on the implementation stage; project-level `acceptance_verification` field with `REQUIRED` / `NOT_REQUIRED` / `SKIPPED_NO_ENVIRONMENT` / verdict states — **non-blocking record: no gate, but the server does carry phase-routing awareness** *(v3.4 clarification — "pure record, no gating logic" overstated it: in VS Code mode all routing is server-computed, so the handoff computation must interpose `READY_FOR_ACCEPTANCE_VERIFICATION` when all WPs are terminal and verification is required-and-pending; naming the next agent is routing, refusing to proceed would be gating, and only the former exists)*; derive and store the **`acceptance_outcome`** enum (single mapping for all consumers), expose it in project-list/status responses, and carry it in the **`.meta.json` sync** so list filtering never opens every root index; on creation of a project carrying `rework_of`, set the reciprocal `reworked_by` link on the referenced project; the outcome and rework links are surfaced by `ledger_get_repository_context` in the project history.
- **Ledger Standalone Archiver (v1.5.0) / `ledger_import_standalone`** *(v3.4 — previously missing)*: the import path validates and archives exactly `plan.md` + `synthesis.md` and hardcodes a COMPLETE single-WP record — standalone AV verdicts would never reach the ledger, and every imported project would sit ambiguously in the v3.3 filter. Amend the tool (and the Archiver persona's checklist) to optionally ingest `acceptance.md`, setting verdict and `acceptance_outcome` on the imported record; when absent, record `NOT_APPLICABLE` (mirroring the pipeline mapping) so imported projects classify correctly rather than polluting `UNVERIFIED`.
- **Orchestrator (supervisor + nodes)** *(v3, extended v3.2)*: new routing case (`all WAIT → Acceptance Verification → Synthesis`); new AV stage node with restricted tool wrapper and persona template; `stage_start` / `stage_complete` / `routing_decision` JSONL events for the new phase; the run-completion output states the AV verdict explicitly — never a bare "run complete"; *(v3.4)* Deep Agents sub-agent support is confirmed to exist via the `subagents:` persona YAML field consumed by `load_subagents()` at startup (currently PM-only) — per Item 2, harness-sequence the Scope Auditor (unconditional check) and dispatch Strength mode via `subagents:` (conditional, threshold-judged); a new AV node also means a LangGraph graph-shape change, so note that in-flight SQLite-checkpointed runs from before the change should complete on the old graph rather than resume across it.
- **Planner (v2.2.0) / Planner — Standalone (v2.0.1)** *(v3, extended v3.1, v3.3)*: assemble the `request.md` bundle in the plan folder at planning time — verbatim initial prompt, requester-authored attachments, and (when the prompt is terse or intent emerged in dialogue) a goal-level intent restatement ratified by the requester before the session ends (in addition to the Item 5 template amendments); in **Synthesis-Rework mode**, record the source project's ID in the plan so the rework linkage can be established at bootstrap.
- **Ledger Bootstrapper (v1.2.0)** *(v3, extended v3.3)*: register `request.md` into the ledger as a first-class artifact at project creation; when the plan carries a rework source, register `rework_of` on the new project (triggering the server's reciprocal `reworked_by` link).
- **AV persona (all build outputs)** *(v3, rewritten v3.4 in build-system terms)*: personas are not hand-authored files — they are **built from YAML sources** (`personas/{suite}/src/meta/` + content) via `scripts/build-personas.js`, which also regenerates `name-mapping.json` (GUI persona visibility and model-assignment validation). Item 1 therefore means: author the AV YAML source with a minimal `tools:` / `mcp_tools` declaration (`get_original_request`, `record_acceptance_report`, the user-level interaction capability — feeding the normative **MCP Tool Allocation Matrix**, which gains an AV column), run the build to produce the VS Code `.agent.md` and Deep Agents template, and confirm model resolution (registry default applies unless a per-persona assignment is added; the orchestrator resolves assignments at startup). *(v3.4)* The build has **three** output flavors — VS Code, Deep Agents, and **Claude Code**. *(v3.5 — decision settled by Item 7a policy)*: the ledger-suite Claude Code target is retired, so the pipeline AV ships as VS Code `.agent.md` + Deep Agents template only; the standalone AV variant follows standalone-suite policy and needs no MCP access (it reads `request.md` from the plan folder — see Item 7a).
- **Ledger Pipeline Configurator (v1.1.0):** derive the project-level AV requiredness flag from WP definition content at decomposition time (PM-overridable) — *(v3.4)* from titles/descriptions/declared scope, since `active_pipeline_stages` do not encode UI/API-touch.
- **Reviewer (v3.7.0)** *(v2)*: may set the AV requiredness flag late when implementation reveals undeclared user-visible behavior change.
- **Ledger Orchestrator Runner (v1.5.1):** retain dirty-tree preflight as early warning (authoritative check now server-side).
- **Developer — Standalone (v1.4.0)** *(v2)*: dirty-tree preflight for standalone runs feeding a user-invoked Scope Audit.
- **Synthesis (v3.7.1)** *(extended v3.2)*: extend aggregation to include Acceptance Reports, Scope Audit findings, Strength-mode results, and the deferred `VERIFIED-BY: deferred` criteria set in the Project Status Report; the AV verdict **leads the Status Report** — first line, before achievements; on `DOES NOT SOLVE`, the report carries the rework recommendation so Planner Synthesis-Rework can proceed directly from this document.
- **Ledger Knowledge Archiver (v1.7.0)** *(v3.2)*: extract intent-miss insights from projects with `DOES NOT SOLVE` / `PARTIALLY SOLVES` verdicts — e.g., "requests mentioning X in this repository tend to mean Y" — so failed projects feed institutional memory rather than being excluded from it.
- **Plan Auditor (v1.7.0):** add Operational Readiness section verification, including `VERIFIED-BY` tag presence and plausibility, to its checklist; *(v3.1)* verify that any ratified intent restatement in `request.md` contains no solution or implementation vocabulary (goal-level only) and is clearly marked as a restatement.
- **Ledger Doctor (v1.3.0)** *(v3, simplified v3.2)*: aware of the new AV phase and `SKIPPED_NO_ENVIRONMENT` state. (The v3 "held open by AV verdict" recognition is void — the state no longer exists.)
- **Ledger Orchestrator Archaeologist (v1.0.1)** *(v3, minor)*: remit extends to AV-phase transcripts and JSONL events.
- **GUI dashboard** *(v3, extended v3.3)*: surface the acceptance report; per-project **`acceptance_outcome` badge** in the project list; **outcome filter** (`PASSED` / `PASSED_WITH_GAPS` / `FAILED` / `UNVERIFIED` / `NOT_APPLICABLE`), with `FAILED` sub-filterable into unaddressed vs. reworked via the `reworked_by` link, and rework projects one click away from their source.
- **Ledger Claude Coordinator (v1.0.0)** *(v3 — deprecation, replaces the v2 amendment; scope widened v3.4; grounded v3.5)*: retired from the workflow; formally deprecate via Persona Curator Maintain — *(v3.5)* targeting the **standalone-suite source** (`personas/standalone/src/`), where the Coordinator actually lives, shipping in both VS Code and Claude Code flavors — and update `workflow-and-ledger.md` and the roster, which still present it as a supported mode. Otherwise the Persona Curator maintains a persona nothing dispatches, and future readers will wonder why the AV isolation protocol doesn't mention it. Full reconciliation scope — the contradictory host-environment descriptions, both sync deployment paths, the execution-mode tables — is specified in **Item 7b**.

---

## Rollout Ordering (v2)

The seven items carry very different cost/risk profiles; land them in phases rather than as a batch:

0. **Phase 0 — documentation & build-target reconciliation (Item 7, immediate, zero risk):** pure doc/build-config work with no operational dependencies; do it before anything else so the Persona Curator creates the new personas against a consistent picture. 7c is already verified done; 7a/7b are small; 7d (bundle regeneration) closes the phase.
1. **Phase 1 — pure amendments (immediate):** Items 5 and 6. No new machinery; the Planner template, Plan Auditor checklist, and Security Auditor protocol changes are Persona Curator Maintain operations with no operational dependencies. *(v3, v3.1)* Include the Planner-side `request.md` bundle assembly here — verbatim prompt, attachments, and the end-of-session ratification step. It is a cheap template addition whose value compounds: every plan run after it lands is AV-ready when Phase 4 arrives, and the ratified restatements accumulate as decidable intent records even before the AV exists to consume them.
2. **Phase 2 — Scope Auditor (observe-only first):** mechanical, runs on every WP, highest finding volume. Run it in **observe-only mode for the first N plans** (findings recorded but non-blocking) to tune the out-of-scope false-positive rate and the pipeline-artifact allowlist before its findings carry weight. *(v3)* Requires the `central_pm` snapshot-ref capture and dirty-tree check to land first — *(v3.4)* both are spec-governed server changes, so a small spec amendment (Git-capability sections of §21 plus the `ledger_initialize_project` / `ledger_begin_work` behavior) fronts this phase too. The dispatch decision is made (v3.4, Item 2): harness-sequenced in the orchestrator, `runSubagent` in VS Code Chat.
3. **Phase 3 — Strength mode:** enable first on projects where Infection/Stryker is already configured; the scaffold-a-config path follows once the mode is proven. Dispatch-parity decision shared with Phase 2.
4. **Phase 4 — Acceptance Verifier (last):** heaviest operational dependencies — `get_original_request`, `record_acceptance_report`, Bootstrapper/`ledger_initialize_project` registration, the persona YAML source and build outputs, supervisor routing case *and* the server-side `READY_FOR_ACCEPTANCE_VERIFICATION` handoff status, verdict recording and loudness surfacing, the `ledger_import_standalone` amendment, and a runnable-environment story must all exist first. *(v3)* Cheaper than under the v2 stage-insertion design: the project-level phase touches one routing case and one ledger field instead of the WP stage-ordering machinery. *(v3.2)* Cheaper again: the ledger field carries no gate. *(v3.4)* Sequencing rule inside the phase: the **Workflow Specification amendment lands first**, then server + tests validated against it, then persona build, then orchestrator node — the ecosystem's own compliance model demands spec-before-implementation, and this brief should not exempt itself.
5. **Continuous — Architecture Fitness Auditor:** independent of the pipeline phases; first run can start any time after the Knowledge Curator pairing is scripted. Expect the first audit to be the largest; each subsequent cycle should shrink as fitness functions migrate checks into static analysis.

---

## Acceptance Criteria for This Brief

- [ ] Acceptance Verifier persona created (both variants); plan-blindness constraint present in both Mission and Strict Constraints as defense in depth; user-level interaction capability (browser or HTTP client per feature nature) included.
- [ ] *(v3, extended v3.4)* AV integrated as a **project-level phase**: supervisor routing case (`all WAIT → AV → Synthesis`), AV stage node with **restricted tool wrapper**, project-level `acceptance_verification` ledger field; VS Code `.agent.md` carries a minimal `tools:` frontmatter allowlist. No changes to WP stage ordering or the per-WP action enum. *(v3.4)* Server-side handoff computation interposes **`READY_FOR_ACCEPTANCE_VERIFICATION`** before the all-terminal `READY_FOR_SYNTHESIS` branch; AV role registered in the agent registry so `auto_handoff` prompts carry the `@id` prefix; VS Code auto-handoff chain verified not to dead-end at all-WPs-finalized.
- [ ] *(v3.4)* **Agent Workflow Specification amended before implementation**: §3.1 fields (`acceptance_verification`, `acceptance_outcome`, `rework_of` / `reworked_by`), §4 AV role, §13 handoff status and ordering, §21 edge cases (incl. post-COMPLETE `reworked_by` write and `SKIPPED_NO_ENVIRONMENT`); test coverage per the spec's compliance model.
- [ ] *(v3.4)* **`record_acceptance_report`** exposed as the AV's sole ledger-write; MCP Tool Allocation Matrix gains an AV column; `.meta.json` sync carries `acceptance_outcome`.
- [ ] *(v3.4)* **`ledger_import_standalone` / Ledger Standalone Archiver amended**: `acceptance.md` optionally ingested on import, verdict + outcome set on the imported record, `NOT_APPLICABLE` when absent.
- [ ] *(v3.4, settled v3.5)* AV persona created as **YAML source + persona build**; `name-mapping.json` regenerated; model-registry resolution confirmed; output flavors per Item 7a policy — pipeline AV: VS Code + Deep Agents only (ledger CC target retired); standalone AV: standalone-suite policy, plan-folder `request.md` input, no MCP dependency.
- [ ] *(v3.4)* Developer — Standalone browser-capability reuse **confirmed in the persona source** before Phase 4 relies on it (or the browser toolset specified fresh within Item 1).
- [ ] *(v3.4)* All references use **`ledger_initialize_project`** (no `ledger_create_project` tool exists); dirty-tree check and `request.md` archival specified against it.
- [ ] *(v3, extended v3.1)* Request captured at **planning time** as the `request.md` bundle: verbatim initial prompt + requester-authored attachments + optional ratified goal-level intent restatement (clearly marked, never merged); Bootstrapper registers it at project creation; `get_original_request` MCP tool exposed; AV consumes the bundle exclusively through it.
- [ ] *(v3.1)* Planner end-of-session ratification step implemented for terse or dialogue-shaped requests; restatement guardrail (no solution/implementation vocabulary) enforced by the Plan Auditor checklist.
- [ ] *(v3.1)* `INTENT UNDERDETERMINED` verdict implemented: returned instead of guessed intent, non-blocking, surfaced in the Status Report with feedback on what a decidable request would have stated.
- [ ] *(v3.2, replaces the v3 gate)* AV is fully **non-blocking**: all verdicts recorded, Synthesis always runs, project archives; verdict leads the Status Report; verdict persists as an archived outcome field surfaced via `ledger_get_repository_context`; run-completion output states the verdict; `DOES NOT SOLVE` carries the Synthesis-Rework recommendation in the Status Report; `SKIPPED_NO_ENVIRONMENT` recorded, never silent; no hold-open logic anywhere in `central_pm`.
- [ ] *(v3.2)* Knowledge Archiver extracts intent-miss insights from `DOES NOT SOLVE` / `PARTIALLY SOLVES` projects.
- [ ] *(v3.3)* `acceptance_outcome` enum derived and stored in `central_pm` (single mapping: `PASSED` / `PASSED_WITH_GAPS` / `FAILED` / `UNVERIFIED` / `NOT_APPLICABLE`), exposed in project-list/status responses and `ledger_get_repository_context`.
- [ ] *(v3.3)* GUI shows the outcome badge per project and filters by outcome; `FAILED` sub-filterable into unaddressed vs. reworked.
- [ ] *(v3.3)* Rework linkage implemented end to end: Synthesis-Rework plans carry the source project ID; Bootstrapper registers `rework_of`; server sets reciprocal `reworked_by`.
- [ ] *(v2)* AV documentation-divergence finding category present; docs-as-instructions walkthrough behavior specified.
- [ ] Scope Auditor persona created; elevated-severity handling for modified pre-existing tests and opportunistic edits; read-only enforced.
- [ ] *(v3, resolved v3.4)* Dispatch decision documented for Reviewer→Scope Auditor and QA→Strength: Deep Agents sub-agent support confirmed to exist via the `subagents:` YAML field / `load_subagents()`; Scope Auditor **harness-sequenced** in the reviewer node (unconditional check), Strength mode dispatched via `subagents:` (conditional, threshold-judged); `runSubagent` in VS Code Chat for both.
- [ ] *(v3)* Baseline machinery lives in `central_pm`: snapshot ref captured via `git stash create` at `ledger_begin_work` on the implementation stage and recorded in the WP record; dirty-working-tree check at project creation; Scope Auditor diffs against the WP's snapshot ref. Works identically in both execution modes.
- [ ] *(v2)* Pipeline-artifact allowlist implemented (`PIPELINE-ARTIFACT` classification by path convention and generating stage); Scope Audit sequenced after Strength-mode completion.
- [ ] *(v2)* Scope Auditor runs observe-only for an initial tuning period before findings carry weight.
- [ ] Architecture Fitness Auditor persona created as standalone periodic agent; inputs wired to `constraints.md` and ledger knowledge base; write access limited to fitness-function scaffolds.
- [ ] *(v2)* Rulebook precedence encoded (`constraints.md` wins; conflicts are findings routed to Manifest/Knowledge Curators); Knowledge Curator sequenced before each Fitness audit.
- [ ] *(v3.4)* `workflow-and-ledger.md` Knowledge Store section updated when Item 3 lands (Fitness Auditor as a third direct knowledge-store reader; read-only access noted).
- [ ] Unit Test Auditor amended with Strength mode; mutation tooling protocol (Infection/Stryker) plus manual fallback; QA dispatch threshold documented.
- [ ] Planner and Planner — Standalone templates amended with mandatory Operational Readiness section (waiver-or-criterion, never silence); Plan Auditor checklist extended accordingly.
- [ ] *(v2)* `VERIFIED-BY` tag mandatory on every Operational Readiness criterion; QA treats `human`-tagged criteria as handed off, never passed; `deferred` set surfaced by Synthesis.
- [ ] Security Auditor amended with per-new-dependency supply-chain protocol.
- [ ] *(v2)* Dirty-tree preflight retained in Ledger Orchestrator Runner (early warning) and added to Developer — Standalone; *(v3)* authoritative check is server-side.
- [ ] *(v3, widened v3.4, grounded v3.5)* Ledger Claude Coordinator formally deprecated via Persona Curator Maintain on the **standalone-suite source**; full surface reconciliation per Item 7b (companion execution-mode passages and tables, roster entry, both sync deployment paths — `syncClaudeCode` context and `syncStandaloneClaudeCode`'s Coordinator file).
- [ ] *(v3)* GUI surfaces the acceptance report and project-level AV status; Orchestrator Archaeologist remit extended to AV-phase artifacts.
- [ ] *(v3.5 — Item 7a)* Claude Code output policy encoded: `persona-build.config.js` suite×target matrix excludes `ledger` × `claude-code`; `personas/ledger/claude-code/` outputs removed; `syncClaudeCode` retired; `syncStandaloneClaudeCode` retained; companion doc carries the suite-scoped statement with the routing-fidelity rationale. (If already landed in the repository: verify each lever and check off.)
- [ ] *(v3.5 — Item 7b)* Coordinator story reconciled across companion, roster, build reference, and sync script — all surfaces state "retired," with the both-flavors history note. (If already landed: verify and check off.)
- [ ] *(v3.5 — Item 7c)* **Verified done:** MCP Tool Allocation Matrix carries `ledger_get_repository_context` + `ledger_search_insights` for the Planner — the verdict-loudness loop's Planner-side dependency is documented, normative fact.
- [ ] *(v3.5 — Item 7d)* Technical reference bundle regenerated (not hand-edited) after 7a/7b land; stale persona versions refreshed in the same pass.
- [ ] No operational-readiness execution agent created (explicitly deferred; the accumulating `VERIFIED-BY: deferred` set is the evidence base for revisiting).

---

## Design Rationale (for the record)

A new verification persona is justified when it differs from existing agents in **inputs** or **cadence**, not merely in emphasis:

- **Acceptance Verifier** — justified by *withheld inputs* (plan-blindness). Cannot be expressed as a mode of QA or Reviewer without destroying its value.
- **Architecture Fitness Auditor** — justified by *cadence* (periodic, codebase-wide vs. per-WP). Cannot be a pipeline stage by construction.
- **Scope Auditor** — mechanical, diff-vs-scope input pairing distinct from any existing agent; kept small as a sub-agent.
- **Test strength** — same identity and inputs as the Unit Test Auditor → mode, not agent.
- **Operational readiness / supply chain** — specification and checklist gaps → template and prompt amendments, not agents.

This litmus test is recommended as a standing evaluation criterion for future verification-persona proposals. *(v2)* Concretely: promote it out of this brief and into the **Persona Curator's audit criteria** (Maintain operation on Persona Curator v1.3.0), so every future verification-persona proposal is evaluated against it by default rather than by convention.

*(v2, sharpened in v3)* A second principle earned its place during review: **where a persona's value depends on a constraint (plan-blindness, read-only, restored-tree, clean baseline), enforce the constraint in the harness — tool-surface restriction, MCP server authority, deterministic routing — not solely in the persona's instructions.** Prompt-level constraints are advisory under context contamination; harness-level constraints are structural. v3 demonstrates the hierarchy concretely: the Coordinator (an LLM asked to route faithfully) failed and is retired; the orchestrator's supervisor (deterministic Python) and `central_pm` (schema-enforcing server) succeed and absorb the enforcement duties — the AV's restricted per-node tool surface and the server-side snapshot capture are the template cases. When choosing where a guarantee lives, prefer the component that cannot choose to ignore it.

*(v3.1)* A third principle, from the terse-request analysis: **the quality bar for a verification input is decidability, not detail.** A terse request is a feature for a plan-blind verifier — it maximizes the interpretation gap the verifier exists to check — while a detailed requester-written specification shrinks that gap and degrades the verifier toward redundancy. When an input falls below decidability, the correct response is a dedicated "cannot verify" outcome (`INTENT UNDERDETERMINED`), never a guess: a guessed intent is a third interpretation with no owner. And where input quality depends on human habit, give the pipeline a backstop (the ratification step) rather than depending on the habit — the pipeline should absorb requester inconsistency, not require requester discipline.

*(v3.2)* A fourth principle, from the non-blocking correction: **a verification verdict should enrich the record, never amputate it.** Do not block the stage that produces the artifact your own recovery path consumes — v3's hold-open gate would have prevented the synthesis document that Synthesis-Rework requires as input, and excluded exactly the most instructive projects (the failures) from the knowledge base. When removing a gate, replace it with structural loudness (verdict-first reporting, persisted outcome fields, history surfacing) so the signal survives without the block. A design that gets smaller when corrected — here, the entire hold-open machinery deleted — is usually a sign the correction is right.

*(v3.4)* A fifth principle, from the grounding pass: **a brief about a spec-governed system is not done until it names the spec amendment.** The narrative documents (roster, workflow companion) *describe* the system; the Agent Workflow Specification *is* its contract — implementation and tests are validated against it, so any change to fields, roles, handoff statuses, or server behavior that skips the spec produces exactly the spec-implementation drift the ecosystem's compliance model exists to prevent. The grounding pass also demonstrated the resolution order when sources disagree: the narrative documents contradicted each other twice (the Coordinator's host environment; whether Claude Code persona outputs exist) while the specification and the technical reference agreed — so **spec > technical reference > narrative docs**, and every documentation contradiction discovered en route becomes an explicit work item (here: folded into the deprecation pass) rather than a silent choice of which document to believe. Corollary for verification inputs: two claims in earlier revisions survived only because no document contradicted them (`ledger_create_project`; the Developer — Standalone browser pattern) — the first proved wrong once checked, the second remains unverified and now carries a preflight check. An unverifiable claim in an implementation brief is a finding against the brief, not a free pass. *(v3.5)* The principle promptly paid for itself: the Planner-tool-matrix contradiction, once fixed upstream (Item 7c), converted the verdict-loudness loop's central premise — that the Planner reads `ledger_get_repository_context` — from an inference resting on a contradicted document into documented, normative fact. Reconciling documents is not housekeeping; it is how a plan's load-bearing assumptions get promoted to facts.