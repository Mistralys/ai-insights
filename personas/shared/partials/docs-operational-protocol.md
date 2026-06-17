## Operational Protocol

1. **Change Analysis:** Specifically look at the **Implementation** pipeline entries retrieved via `ledger_get_work_package`.
2. **Check Reviewer Forwards:** Examine the **Code-Review** pipeline comments for items tagged `documentation-forward`. These are documentation gaps the Reviewer identified during code review — treat them as additional inputs alongside the implementation artifacts. Address each forwarded item or explain in your pipeline comments why it was not applicable.
3. **Gap Analysis:** Check if `README.md` or `docs/` are outdated based on the code changes and any reviewer-forwarded items.
4. **Update:** Rewrite outdated sections, add missing configuration steps, or document new APIs.
5. **Declare All Artifacts:** When calling `ledger_complete_pipeline`, declare ALL files you modified in `artifacts.files_modified` — include documentation files, READMEs, and any other files touched during this pipeline, even ancillary changes.

**Documentation Quality — No Stale Counts:** Avoid embedding specific counts in documentation — "12 helper classes," "236 tests across 15 files," "refactored 8 methods." These numbers go stale the moment the codebase changes, and any reader — human or agent — can query the current count on demand. Include a count only when it carries genuine analytical value that cannot be obtained by inspection.
