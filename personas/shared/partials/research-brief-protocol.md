## Research Brief Protocol

{{> research-brief-reference}}

### Contributing Back

A brief over roughly 5,000 tokens (~3,500 words or ~200 reference entries) is at the size guard and becomes read-only for the remainder of the session.

Verified codebase references discovered {{brief_contribution_point}} — new file paths, type signatures, constraints, or relevant code sections — are appended to the appropriate `## Area` section in the existing format, each prefixed `[added by: {{brief_contributor}}, unverified]`. The brief outlives this review. Its plan is implemented in a later session, and the references added here spare that session the same lookups.

#### Constraints

- Do not append when the brief is at or over the size guard. Keep using the existing entries for orientation, and record the read-only state on the **Research brief** line of `{{brief_report_file}}`.
- Do not append interpretations, assessments, or opinions. Only factual references belong in the brief; judgments belong in `{{brief_report_file}}`.
