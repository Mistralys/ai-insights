## Research Brief Protocol

When a `research-brief.md` exists alongside the plan, it supplies pre-verified references — file paths, type signatures, method signatures, module boundaries — organized under `## Area` headings.

1. **Orient.** Entries tagged `{{brief_tag}}` and untagged entries are the ones this review draws on, giving a head start on {{brief_purpose}}.
2. **Estimate size.** A brief over roughly 5,000 tokens (~3,500 words or ~200 reference entries) is at the size guard and becomes read-only for the remainder of the session.
3. **Contribute back.** Verified codebase references discovered during the review — new file paths, type signatures, constraints, or relevant code sections — are appended to the appropriate `## Area` section in the existing format, each prefixed `[added by: {{brief_contributor}}, unverified]`.

### Constraints

- Never treat the brief as complete. Missing areas, incomplete coverage, and stale references are expected — {{brief_authority}} remains the authority.
- Never take a brief entry on trust. Independently verify any reference that looks suspicious before citing it.
- Do not append references when the brief is at or over the size guard. Keep using the existing entries for orientation, and record the read-only state on the report's **Research brief** line.
- Do not append interpretations, assessments, or opinions. Only factual references belong in the brief; judgments belong in `{{brief_report_file}}`.
