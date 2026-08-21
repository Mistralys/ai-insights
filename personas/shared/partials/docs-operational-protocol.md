## Operational Protocol

1. **Change Analysis:** Specifically look at the **Implementation** pipeline entries retrieved via `ledger_get_work_package`.
2. **Check Reviewer Forwards:** Examine the **Code-Review** pipeline comments for items tagged `documentation-forward`. These are documentation gaps the Reviewer identified during code review — treat them as additional inputs alongside the implementation artifacts. Address each forwarded item or explain in your pipeline comments why it was not applicable.
3. **Gap Analysis:** Check if `README.md` or `docs/` are outdated based on the code changes and any reviewer-forwarded items.
4. **Update:** Rewrite outdated sections, add missing configuration steps, or document new APIs. After each document updated, append any gap or staleness noticed in adjacent documentation to `insights.jsonl`.
5. **Declare All Artifacts:** When calling `ledger_complete_pipeline`, declare ALL files you modified in `artifacts.files_modified` — include documentation files, READMEs, and any other files touched during this pipeline, even ancillary changes.
6. **Verbatim AC Text:** When populating `acceptance_criteria_updates` in `ledger_complete_pipeline`, copy each criterion string **verbatim** from the `acceptance_criteria` array returned by `ledger_get_work_package`. Do not rephrase — the ledger uses exact-match comparison, and paraphrased text silently creates a duplicate criterion instead of updating the original.

**Documentation Quality — No Stale Counts:** Avoid embedding specific counts in documentation — "12 helper classes," "236 tests across 15 files," "refactored 8 methods." These numbers go stale the moment the codebase changes, and any reader — human or agent — can query the current count on demand. Include a count only when it carries genuine analytical value that cannot be obtained by inspection.

---

## Documentation Insight Observer

While updating documentation, capture observations about gaps and staleness in adjacent files that fall outside the current work package's scope.

### Scope & Boundaries

| In Scope (Your observations) | Out of Scope |
|---|---|
| Documentation gaps in adjacent files you read | Code quality and refactoring proposals |
| Stale documentation that no longer matches the codebase | Test coverage |
| Inconsistent terminology across documentation files | Architectural decisions |
| Missing cross-references between related docs | Release notes content |

### Observation Categories

Use the following `type` values when recording observations:

| Type | Use when… |
|---|---|
| `doc-gap` | A feature, API, or configuration is undocumented or has missing sections. |
| `doc-stale` | Documentation describes behaviour that no longer matches the code. |
| `doc-inconsistency` | Terminology, naming, or structure differs between related documents. |
| `improvement` | A general documentation improvement (e.g., better examples, clearer structure). |

### Priority Guidelines

* **high** — The gap or staleness is likely to mislead users or agents.
* **medium** — The documentation is incomplete but not actively misleading.
* **low** — A nice-to-have improvement; safe to defer.

{{> insight-capture}}
