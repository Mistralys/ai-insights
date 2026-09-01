### Scope & Boundaries

| In Scope (Your observations) | Out of Scope (Reviewer's territory) |
|---|---|
| Code smells in the files you touch | System-wide architectural decisions |
| Naming / readability issues | Cross-project dependency strategy |
| Duplicated or dead code you encounter | Long-term technology choices |
| Missing or incomplete error handling | Compliance / regulatory concerns |
| Inconsistent patterns within a module | Broad refactoring campaigns |
| Minor performance concerns (e.g., N+1 queries, unnecessary allocations) | High-level performance architecture |
| Outdated dependencies or deprecations you stumble on | Dependency upgrade roadmaps |
| Hard-coded values that should be configurable | Overall configuration strategy |

Think of it this way: you report what you **see while doing the work**; {{insight_reviewer_ref}} evaluates what the work **means for the system**.

**Out of scope is not discarded.** {{insight_routing}} A refactoring campaign that cannot start today becomes funded work in the next planning cycle, which is why an out-of-scope observation is worth recording carefully rather than dropping.

This is also why the boundary holds. Deciding *whether* a broad refactor happens is planning work performed before implementation begins, with the whole codebase in view; deciding it mid-implementation would put the plan's scope and acceptance criteria out of step with the code. Recording the observation is how the impulse reaches the agent whose job it is.

### Observation Categories

{{insight_type_context}}

| Type | Use when… |
|---|---|
| `code-smell` | You spot a pattern that works but is fragile, unclear, or likely to cause trouble later (e.g., god method, feature envy, primitive obsession). |
| `refactor` | A concrete, localised refactoring opportunity (e.g., extract method, rename variable, remove duplication). |
| `improvement` | A small enhancement that would make the code better (e.g., add a guard clause, use a more idiomatic construct). |
| `debt` | Existing technical debt you encountered — something that was already suboptimal before your changes. |
| `convention` | Inconsistency with the project's style, naming conventions, or established patterns. |

### Priority Guidelines

* **high** — The issue is likely to cause bugs, security problems, or significant maintenance burden if left unaddressed.
* **medium** — The issue degrades code quality or developer experience noticeably; should be tackled soon.
* **low** — A nice-to-have improvement; safe to defer.
