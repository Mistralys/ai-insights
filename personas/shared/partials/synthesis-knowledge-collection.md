## Knowledge Collection

Before calling `ledger_complete_synthesis`, extract and commit reusable insights from this project. This phase ensures knowledge generated during the development cycle is preserved and available to future projects.

### 1. Identify Gold Nuggets

Review the synthesis document and all WP pipelines for:

- **Patterns** — Recurring design, testing, or implementation patterns that proved effective.
- **Pitfalls** — Mistakes, regressions, or anti-patterns encountered (and how they were resolved).
- **Coding principles** — Project- or language-specific conventions that emerged during work.
- **Architectural decisions** — Key structural choices and their rationale.

### 2. Determine Scope

For each candidate insight, decide whether it is:

- **`global`** — Applicable across projects (general patterns, cross-cutting principles, universal best practices). Use this when the insight would be useful in a different project without modification.
- **`project`** — Specific to this project's context, codebase, or constraints. Use `project_slug` to associate it with the current project's slug.

### 3. Apply the Confidence Heuristic

Assign a confidence score (`0–1`) using these guidelines:

| Level | Score | Definition |
|-------|-------|------------|
| **High** | `0.9–1.0` | Validated across multiple projects or by established best practices. |
| **Medium** | `0.6–0.8` | Observed in this project with clear evidence; not yet validated elsewhere. |
| **Low** | `0.3–0.5` | Inferred or speculative — useful to record but requires further validation. |

### 4. Deduplicate Before Committing

For each candidate insight, call `ledger_search_insights` with a short keyword query to check if a substantively similar insight already exists:

- If a matching insight is found and covers the same ground, **skip** committing (avoid duplication).
- If a matching insight exists but your insight adds new nuance or context, **commit** the new insight anyway.

### 5. Commit Each New Insight

For each non-duplicate insight, call `ledger_add_insight`. Use these fields:

- `scope`: `"global"` or `"project"`
- `project_slug`: required when `scope` is `"project"` (alphanumeric, hyphens, underscores)
- `title`: short, action-oriented title
- `content`: full description including context, evidence, and recommendation
- `category`: one of `"architecture"`, `"testing"`, `"workflow"`, `"security"`, `"performance"`, `"tooling"`, or another descriptive string
- `tags`: array of keyword tags for filtering
- `source`: WP ID or plan name (e.g., `"WP-003"`)
- `confidence`: numeric score from step 3

Commit only insights with genuine reuse value. Quality and clarity matter more than quantity.
