## Knowledge Collection

Before calling `ledger_complete_synthesis`, extract and commit reusable insights from this project. This phase ensures knowledge generated during the development cycle is preserved and available to future projects.

### 1. Identify Gold Nuggets

Review the synthesis document and all WP pipelines for:

- **Patterns** — Recurring design, testing, or implementation patterns that proved effective.
- **Pitfalls** — Mistakes, regressions, or anti-patterns encountered (and how they were resolved).
- **Coding principles** — Project- or language-specific conventions that emerged during work.
- **Architectural decisions** — Key structural choices and their rationale.

**Non-obviousness filter.** Discard any candidate that a competent coding agent would already know without seeing this project. Generic best practices — "validate your inputs", "handle errors gracefully", "write tests for edge cases" — are not insights. A candidate passes if it surfaces a non-obvious pitfall, applies a known principle to a specific context in an unexpected way, or documents a decision whose rationale is not self-evident from the code.

**Scarcity expectation.** A typical project contributes at most 1–3 committed insights in total across both scopes. Finding more candidates than this almost always means the filter was applied too generously. Treat a large candidate list as a signal to re-rank all candidates and keep only the absolute strongest — not to commit them all.

### 2. Determine Scope

For each candidate insight, decide whether it is:

- **`global`** — A principle, pattern, or pitfall that transfers to an unrelated future project without modification.
- **`repository`** — Specific to a particular codebase. Use `repository_name` to associate it with the repository where this insight applies. Optionally include `origin_plan` to record the plan or project that produced the insight as provenance metadata.

**Global scope writing rule.** Global content must be fully project-agnostic. Before committing, remove all project-specific identifiers from the `title` and `content` — function names, variable names, file paths, error type names, and internal API names. Replace them with generic descriptors or abstract pseudo-code (e.g., `resolveProjectDir()` → `the resolver function`; `/absolute/path/to/store` → `{store-root}`). Language and framework names are permitted when the insight is inherently language-specific — include the language name in the title. Apply this test before setting `scope: "global"`: *"Would this read as a useful principle to a developer who has never seen this codebase?"* If the answer is no, either rewrite it to pass the test or downgrade to `scope: "repository"`.

### 3. Review Each Candidate

Before making any MCP calls, apply a cold second-pass filter to every drafted candidate. Insights that feel important within project context often fail to hold up when examined from outside it.

**For `global` candidates — all three must be true:**
1. After removing project-specific identifiers, the principle stands alone and teaches something non-trivial.
2. A developer on a completely different type of project would find it immediately actionable.
3. It goes beyond what a competent developer would already know.

If any test fails, discard the candidate. Downgrading to `scope: "repository"` is permitted only when the insight is genuinely valuable but inherently codebase-specific — not as a catch-all rescue for failing global candidates.

**For `repository` candidates — both must be true:**
1. It is specific enough to be useful to a future agent working on this exact codebase, and would not be discovered in five minutes of reading the code.
2. It captures something not already obvious from reading the code — preferably a mistake made, a rework triggered, or a decision whose rationale is not self-evident.

If either test fails, discard the candidate. Do not try to rescue a weak candidate by rewording it — if the underlying insight does not survive honest review, drop it.

**Universal filters — apply to every candidate regardless of scope:**

- **The Surprise Test.** Would an experienced developer who reviewed this project say *"I hadn't thought of that"*? If the likely reaction is *"yes, obviously"* or *"that's standard practice"*, discard the candidate regardless of how clearly it is articulated.
- **The Origin Test.** Does this insight trace to a specific mistake, rework, unexpected failure, or hard-won design decision in this project? Correct behaviour observed without incident is not an insight. If no concrete incident in the project prompted this observation, discard it.

Only candidates that pass all applicable tests proceed to step 4.

### 4. Apply the Confidence Heuristic

Assign a confidence score (`0–1`) using these guidelines:

| Level | Score | Definition |
|-------|-------|------------|
| **High** | `0.9–1.0` | Validated across multiple projects or by established best practices. |
| **Medium** | `0.6–0.8` | Observed in this project with clear evidence; not yet validated elsewhere. |
| **Low** | `0.3–0.5` | Inferred or speculative — useful to record but requires further validation. |

### 5. Deduplicate Before Committing

For each candidate insight, call `ledger_search_insights` with a short keyword query to check if a substantively similar insight already exists:

- If a matching insight is found and covers the same ground, **skip** committing (avoid duplication).
- If a matching insight exists but your insight adds new nuance or context, **commit** the new insight anyway.

### 6. Commit Each New Insight

For each non-duplicate insight, call `ledger_add_insight`. Use these fields:

- `scope`: `"global"` or `"repository"`
- `repository_name`: required when `scope` is `"repository"` — the name of the repository this insight applies to
- `origin_plan`: optional — the plan slug or identifier that produced this insight (provenance metadata; recommended when `scope` is `"repository"`)
- `title`: short, action-oriented title
- `content`: the principle, its context, and the recommendation — in 3–5 sentences maximum. Omit preamble, examples, and background that do not add to the principle itself. For `"global"` scope: no specific function names, file paths, variable names, or error message strings — use generic descriptors or pseudo-code. For `"repository"` scope: concrete detail is valuable; include it.
- `category`: one of `"architecture"`, `"testing"`, `"workflow"`, `"security"`, `"performance"`, `"tooling"`, or another descriptive string
- `tags`: array of keyword tags for filtering; include technology names when relevant (e.g., `"typescript"`, `"python"`, `"windows"`, `"react"`, `"sqlite"`)
- `source`: WP ID or plan name (e.g., `"WP-003"`)
- `confidence`: numeric score from step 4

Commit only insights with genuine reuse value. Quality and clarity matter more than quantity.
