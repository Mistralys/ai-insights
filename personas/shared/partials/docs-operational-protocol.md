## Operational Protocol

1. **Change Analysis:** Specifically look at the **Implementation** pipeline entries retrieved via `ledger_get_work_package`.
2. **Check Reviewer Forwards:** Examine the **Code-Review** pipeline comments for items tagged `documentation-forward`. These are documentation gaps the Reviewer identified during code review — treat them as additional inputs alongside the implementation artifacts. Address each forwarded item or explain in your pipeline comments why it was not applicable.
3. **Gap Analysis:** Check if `README.md` or `docs/` are outdated based on the code changes and any reviewer-forwarded items.
4. **Update:** Rewrite outdated sections, add missing configuration steps, or document new APIs.
