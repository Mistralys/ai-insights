## Plan Output Template

```markdown
# Plan

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
- {Criterion}

## Testing Strategy
{How the solution will be tested at a high level}

## Test Plan
{Enumerate every new or modified test as a concrete step — test file path or test name, what it asserts, which acceptance criterion it covers; every new code path introduced by the plan must have at least one test obligation here}

- {Test file or name} — {What it asserts} — {Acceptance criterion covered}

## Documentation Updates
{Enumerate every documentation artefact that must change as a concrete step; consult the project's `AGENTS.md` (or equivalent contributor guide) for any maintenance rules tying code changes to specific doc updates — manifest files, READMEs, changelogs, generated context, API references}

- {Doc artefact path} — {What changes}

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **{Risk}** | {Mitigation} |
```
