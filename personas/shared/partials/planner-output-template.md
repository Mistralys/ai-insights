## Plan Output Template

```markdown
# Plan
{{#if has_ledger_workflow}}

## Plan Audit Cycles
- Audits: none — {{agent_plan_auditor}}
- Architectural Reviews: none — {{agent_plan_architect_reviewer}}
{{/if}}
{{#if has_mcp}}

## Prior Project Context
{Optional — omit section entirely if no prior context was retrieved. When present, summarize relevant findings from ledger_get_repository_context and ledger_search_insights: strategic vision alignment, prior project outcomes, recurring patterns, known pitfalls, or reusable insights that informed this plan's design decisions.}

## Knowledge Base Reconciliation
{Optional — omit section entirely when no cited insight is affected. List every stored insight this plan's work would leave making a claim the codebase no longer supports. Each row names the owning agent, which is always the {{agent_ledger_knowledge_curator}} — insight mutation belongs to no other role.}

| Insight ID | Title | What the plan overtakes | Executed by |
|------------|-------|-------------------------|-------------|
| {UUID} | {title} | {the specific claim the change invalidates or supersedes} | {{agent_ledger_knowledge_curator}} (Targeted Reconciliation) |
{{/if}}

## Summary
{One-paragraph summary of the overall goal}

## Architectural Context
{Document the existing architecture relevant to this change: key modules, patterns, conventions, and integration points; reference specific files and directories}

## Approach / Architecture
{High-level explanation of how the solution should be structured, showing how it integrates with the existing architecture described above}

## Rationale
{Why this approach was chosen; key trade-offs}

## Considered Alternatives
{For each significant architectural decision, name the alternatives weighed and the trade-off summary; protects the design from being re-litigated downstream}

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| {Decision name} | {Shape chosen} | {Other shapes evaluated} | {1–2 sentences on why the chosen shape wins} |

## Pattern Alignment
{One line per existing codebase pattern this plan follows or deliberately departs from; cite the pattern by file path; justify any departure}

## Structural Improvements
{Reshaping and adjacent-improvement decisions for code this plan touches. Every row is either promoted into Detailed Steps or explicitly rejected with a reason — an empty Decision is not valid. Where the plan touches only new files, state "New code only — no existing structures in scope." rather than omitting the section.}

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| {File or module path} | {What no longer fits, or what would improve} | Promoted to step {N} \| Rejected | {Why it was promoted, or the cost/risk/scope ground for rejecting it} |

## Detailed Steps
1. {Step}
2. {Step}
3. {Step}

## Dependencies
- {Dependency}

## Required Components
- {File or module}
- {Optional: external services}
- {Optional: infrastructure}

## Assumptions
- {Assumption}

## Constraints
- {Constraint}

## Out of Scope
- {What this plan intentionally ignores}

## Acceptance Criteria

Number each acceptance criterion with an `AC-{NN}:` prefix (zero-padded, sequential). These IDs are stable handles used to map plan-level criteria to implementation work and to test obligations.

- AC-01: {Criterion}
- AC-02: {Criterion}

## Testing Strategy
{How the solution will be tested at a high level}

## Test Plan
{Enumerate every new or modified test as a concrete step — test file path or test name, what it asserts, which acceptance criterion it covers; every new code path introduced by the plan must have at least one test obligation here}

- {Test file or name} — {What it asserts} — {Acceptance criterion covered}

## Documentation Updates
{Enumerate every documentation artefact that must change as a concrete step; consult the project's `AGENTS.md` (or equivalent contributor guide) for any maintenance rules tying code changes to specific doc updates — manifest files, READMEs, changelogs, generated context, API references}

- {Doc artefact path} — {What changes}

## Deferred Items
{Optional — omit section entirely if no deferred items exist. When producing a Synthesis Rework plan, list every deferred item that was NOT promoted into the plan's steps. This table guarantees deferred items are never silently lost across planning cycles.}

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | {Brief description} | {Synthesis section or prior plan reference} | {Why it was not promoted into this plan} | {Optional: conditions under which it should be reconsidered} |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **{Risk}** | {Mitigation} |
{{#if has_ledger_workflow}}

## Recommended Workflow
- **Workflow:** {ledger | standalone}
- **Rationale:** {One sentence explaining the recommendation}
{{/if}}
```
