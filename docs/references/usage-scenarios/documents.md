# Usage Scenarios — Documents & Run Logs

Part of the [AI Insights Ledger GUI usage scenarios](README.md).

---

## [SC36] View a project's plan document

**Preconditions:** The project has an archived plan document.

1. The user navigates to `#/projects/{repo}/{slug}/plan` (directly, or via "View full plan →" on the detail page).
2. The full plan is rendered as Markdown, including breadcrumb navigation back to the project; wide tables (6+ columns) are given responsive styling.

- [ ] Spec approved
- [ ] Implementation verified

## [SC37] See an empty state when the plan document is unavailable

**Preconditions:** The project has no archived plan document (e.g. it was missing at initialization time).

1. The user navigates to the project's plan URL.
2. A "Plan document not available for this project." message is shown instead of an error page.

- [ ] Spec approved
- [ ] Implementation verified

## [SC38] View a project's synthesis document

**Preconditions:** The project's synthesis has been generated and archived.

1. The user navigates to `#/projects/{repo}/{slug}/synthesis` (directly, or via a "View synthesis →" link).
2. The full synthesis report is rendered as Markdown with breadcrumb navigation back to the project; wide tables receive synthesis-specific responsive styling.

- [ ] Spec approved
- [ ] Implementation verified

## [SC39] See an empty state when the synthesis document is unavailable

**Preconditions:** The project has not yet completed synthesis.

1. The user navigates to the project's synthesis URL.
2. A "Synthesis document not available for this project." message is shown instead of an error page.

- [ ] Spec approved
- [ ] Implementation verified

## [SC40] Watch an orchestrator run log update live

**Preconditions:** An orchestrator run for the project is actively writing log entries.

1. The user opens a run's log viewer (`#/projects/{repo}/{slug}/runs/{filename}`) while the run is still in progress.
2. Existing entries render as a timeline of event cards immediately; new entries are appended automatically every 5 seconds via incremental fetch, and a progress bar updates in place from `progress_snapshot` entries. Polling stops automatically once a `run_end` or `run_error` entry appears.

- [ ] Spec approved
- [ ] Implementation verified

## [SC41] Review a failed run's error event in the run log

**Preconditions:** The run log contains a `run_error`, `stage_error`, or `fatal_error` entry.

1. The user scrolls the run log timeline to the failure entry.
2. The entry is visually flagged with an error severity style and shows the error message; for a `stage_error`, the affected work package and duration are also shown.

- [ ] Spec approved
- [ ] Implementation verified
</content>
