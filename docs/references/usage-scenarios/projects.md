# Usage Scenarios — Projects

Part of the [AI Insights Ledger GUI usage scenarios](README.md).

---

## [SC01] View the project list

1. The user opens the dashboard root (`#/`).
2. A table of projects is shown with columns for Project, Repository, WPs, % Done, Status, Runner, Duration, Created, and Updated, along with a filter bar and pagination controls.

- [ ] Spec approved
- [ ] Implementation verified

## [SC02] Filter projects by status

**Preconditions:** At least one project exists in a non-default status.

1. The user opens the Status dropdown in the filter bar and selects a status (e.g. "Complete" or "Blocked").
2. The table reloads to show only projects matching that status, and the count badge next to each status option reflects how many projects currently match.

- [ ] Spec approved
- [ ] Implementation verified

## [SC03] Search projects by name

1. The user types into the "Search projects…" field.
2. After a short debounce, the table reloads to show only projects whose name or slug matches the query; the page resets to 1 and the search input retains focus and cursor position across the re-render.

- [ ] Spec approved
- [ ] Implementation verified

## [SC04] Filter projects by runner

**Preconditions:** Projects exist with more than one distinct runner value (e.g. Orchestrator, VS Code, Claude Code).

1. The user opens the Runner dropdown and selects a runner.
2. The table reloads to show only projects launched by that runner; runners with zero matching projects are omitted from the dropdown, except a previously selected runner that becomes stale, which stays visible with a zero count so it can be cleared.

- [ ] Spec approved
- [ ] Implementation verified

## [SC05] Filter projects by repository

**Preconditions:** Projects exist across more than one registered repository.

1. The user opens the Repository dropdown and selects a repository.
2. The table reloads to show only that repository's projects; the dropdown groups multiple folder-name aliases of the same registered repository under one label and count.

- [ ] Spec approved
- [ ] Implementation verified

## [SC06] Sort the project table by column

1. The user clicks a sortable column header (e.g. "Updated").
2. The table reloads sorted by that column, with an arrow indicator showing direction; clicking the same header again reverses the sort direction.

- [ ] Spec approved
- [ ] Implementation verified

## [SC07] Paginate through the project list

**Preconditions:** More projects exist than fit on a single page.

1. The user clicks "Next →", a specific page number, or changes the "Per page" selector.
2. The table reloads showing the requested page, and the "Showing X–Y of Z projects" summary updates to match.

- [ ] Spec approved
- [ ] Implementation verified

## [SC08] See an empty state when no projects match the filters

**Preconditions:** The current filter combination matches zero projects.

1. The user applies filters that exclude every project (e.g. an unused status).
2. A clear "No projects found." message is shown instead of an empty table.

- [ ] Spec approved
- [ ] Implementation verified

## [SC09] See the project list refresh automatically

1. The user leaves the project list open without interacting with it.
2. Every 10 seconds the current page reloads in place with the latest project data, without disrupting scroll position or open menus (any open action menu is closed).

- [ ] Spec approved
- [ ] Implementation verified

## [SC10] Open a project from the list

**Preconditions:** The project has a registered repository.

1. The user clicks a project's name link in the table.
2. The browser navigates to that project's detail page (`#/projects/{repo}/{slug}`).

- [ ] Spec approved
- [ ] Implementation verified

## [SC11] Archive a project from the list

**Preconditions:** The project is not already archived and has a registered repository.

1. The user opens the row's action menu (⋮) and clicks "Archive".
2. A confirmation prompt appears; on confirmation, the project is archived and the list reloads without it (when the Active filter is applied).

- [ ] Spec approved
- [ ] Implementation verified

## [SC12] Unarchive a project from the list

**Preconditions:** The project is currently archived.

1. The user opens the row's action menu and clicks "Unarchive".
2. The project is restored to active status and the list reloads to reflect the change.

- [ ] Spec approved
- [ ] Implementation verified

## [SC13] Delete a project from the list

**Preconditions:** The project has a registered repository.

1. The user opens the row's action menu and clicks "Delete".
2. A confirmation prompt warns the action cannot be undone; on confirmation, the project is permanently removed and the list reloads without it.

- [ ] Spec approved
- [ ] Implementation verified

## [SC14] See a project with no registered repository as read-only

**Preconditions:** A project's `repository_name` is null (e.g. legacy or misconfigured data).

1. The user views the project list containing such a project.
2. The row renders with a plain (non-linked) name and its action-menu items are present but produce no effect when clicked, so the user cannot navigate into or act on an unresolvable project.

- [ ] Spec approved
- [ ] Implementation verified

## [SC79] View and sort projects by duration

**Preconditions:** At least one project has completed synthesis (a measured duration).

1. The user views the project list, whose Duration column shows each project's wall-clock duration (creation to synthesis completion), or "—" for projects without a measured duration yet.
2. The user clicks the "Duration" column header to sort the table by duration; clicking the same header again reverses the sort direction, consistent with other sortable columns.

- [ ] Spec approved
- [ ] Implementation verified
</content>
