# Plan Folders

The layout of `docs/agents/plans/` and `docs/agents/implementation-history/`, which files agents find in a plan folder, and which agent writes each. The persona sources named below are the authority for each file's contents; this document records where the files sit and how they travel.

## Location and Naming

A plan lives in its own folder, `docs/agents/plans/{YYYY-MM-DD}-{slug}/`, in the repository the plan is about. The folder holds `plan.md` and whatever companions the session produced. Tools that receive a plan folder or file derive the project root by finding the `docs/agents` segment in its path, so a plan folder has to sit beneath `docs/agents/plans/` to be recognised. The orchestrator also reads the repository name from the folder's position, as described in the orchestrator manifest's [Log-Copy Path Derives `repo_name` From `plan_dir.parents[3]`](../../../orchestrator/docs/agents/project-manifest/constraints.md#23-log-copy-path-derives-repo_name-from-plan_dirparents3).

Completed plans move to `docs/agents/implementation-history/{YYYY-MM}/{slug}/`.

## Files in a Plan Folder

The Git Committer persona sorts the files into three classes: source documents, research material and generated evidence. The table follows that grouping.

| File | Class | Written by | Notes |
|------|-------|------------|-------|
| `plan.md` | Source | The Planner (standalone `planner`, or the ledger Planner) | The plan itself. Read-only for the Developer and for every later stage. The Planner keeps the plan-audit cycle counter in it. |
| `request.md` | Source | Supplied with the request; no persona source writes it | The original request the plan answers, present only for some plans. Treated as the carrier of requester intent. |
| `usage-scenarios.md` | Source | The Usage Scenarios Curator (Generate mode), then edited by humans | Authored, optional companion; its absence is normal. Preserved through archival and ledger import. |
| `research-brief.md` | Research material | The Planner, enriched by the Plan Refiner's review cycles | Verified codebase references the plan was built from, which the implementing session reads first. Committed while the plan is under `plans/`; removed rather than moved on archival, and gitignored under `implementation-history/`. |
| `audit.md` | Generated evidence | The Plan Auditor | Blocking technical audit of the plan. Gitignored. |
| `design-review.md` | Generated evidence | The Plan Architect Reviewer | Advisory decision-level review, produced in parallel with the audit and never merged with it. Gitignored. |
| `scenario-coverage.md` | Generated evidence | The Usage Scenarios Curator (Verify mode) | Per-scenario coverage verdict. Not archived and never handed on as source. |
| `insights.jsonl` | Generated evidence | The standalone Developer, appended to during implementation | Insight sink, opened with a `session-start` marker and appended to across rework passes. Gitignored, yet part of the archival set: it moves with the plan folder. |
| `synthesis.md` | Source | The standalone Developer on completion, or the ledger workflow's Synthesis agent (which also archives it into ledger storage through `ledger_complete_synthesis`) | The record of what was done. Its presence is the signal that a plan is finished. A rework pass amends it in place. |

Files the ledger workflow produces during planning and decomposition are also gitignored under `docs/agents/`: `work.md`, `work/`, `dependency-analysis.md`, `pipeline-configuration.md` and `work-packages-draft.md`. The root `.gitignore` is authoritative for the exact patterns.

## How a Plan Folder Travels

1. The Planner writes `plan.md` and `research-brief.md`; the Plan Auditor and Plan Architect Reviewer add `audit.md` and `design-review.md`.
2. A Developer session writes `insights.jsonl` and, at the end, `synthesis.md`.
3. When a folder holds a `synthesis.md`, the Git Committer moves its archival set (`plan.md`, `synthesis.md`, `request.md`, an authored `usage-scenarios.md` and `insights.jsonl`, where present) to `implementation-history/{YYYY-MM}/{slug}/` before committing.
4. The Ledger Synthesis Maintainer imports a standalone plan into the project ledger with `ledger_import_standalone`, which archives `plan.md`, `synthesis.md` and an authored `usage-scenarios.md` into ledger storage, and refreshes the ledger copy of `synthesis.md` afterwards. It treats `scenario-coverage.md` and `insights.jsonl` as generated evidence, never as import sources.
5. The orchestrator takes a `plan.md` path as its input and derives its plan folder from it.

The persona sources behind these rules: [Git Committer](../../../personas/standalone/src/content/git-committer.md) (file classes, archival set), [Developer](../../../personas/standalone/src/content/developer.md) (insight sink, synthesis) and [Ledger Synthesis Maintainer](../../../personas/ledger-support/src/content/ledger-synthesis-maintainer.md) (import and refresh).
