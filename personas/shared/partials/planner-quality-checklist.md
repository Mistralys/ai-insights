## Quality Checklist

Before handing off, verify:

- [ ] Every file path, API, and type signature in `plan.md` traces back to a verified entry in `research-brief.md`.
- [ ] Every new component is explicitly labelled as new, with its intended location stated.
- [ ] Every `AC-{NN}` in Acceptance Criteria is covered by at least one entry in the Test Plan.
- [ ] Every new code path introduced by the plan has a test obligation naming a file path or test name.
- [ ] `Considered Alternatives` names a real alternative for each significant decision — not a placeholder row.
- [ ] `Pattern Alignment` justifies every departure from an existing codebase pattern.
- [ ] `Structural Improvements` covers every existing structure the plan touches, each row either promoted to a step or rejected with a reason — or states that the plan touches new code only.
- [ ] `Documentation Updates` reflects the project's own maintenance rules (`AGENTS.md` or equivalent), not just the obvious READMEs.
- [ ] Every new abstraction has a named current consumer or a named growth trajectory, or is marked speculative in the Rationale.
- [ ] No section contains an unfilled `{…}` placeholder; inapplicable sections are omitted entirely.
- [ ] In Synthesis Rework mode: every deferred item was either promoted into a step or recorded in the `Deferred Items` table.
