# Usage Scenarios — Project Detail

Part of the [AI Insights Ledger GUI usage scenarios](README.md).

---

## [SC15] View a project's detail page

1. The user navigates to a project (`#/projects/{repo}/{slug}`).
2. The page shows the project title, status and health badges, slug, repository link, plan path, runner, created/updated timestamps, duration/active-time metrics, a work-package table, project comments, and an Orchestrator Runs section.

- [ ] Spec approved
- [ ] Implementation verified

## [SC16] Rename a project's title inline

1. The user clicks the pencil icon next to the project title and types a new title, then presses Enter (or clicks away).
2. The heading and breadcrumb update to the new title; if the rename fails, an inline error is shown next to the input and the user can retry without losing their edit.

- [ ] Spec approved
- [ ] Implementation verified

## [SC17] Rename a project's slug inline

1. The user clicks the pencil icon next to the project slug, types a new slug, then presses Enter.
2. On success, the browser navigates to the project's new URL under the renamed slug; an invalid slug (uppercase letters, symbols, etc.) shows an inline validation error without submitting, and a server-side failure shows an inline error while preserving the entered value for retry.

- [ ] Spec approved
- [ ] Implementation verified

## [SC18] Unarchive a project from its detail page

**Preconditions:** The project's status is `ARCHIVED`.

1. The user sees the archived-project banner at the top of the page and clicks "Unarchive".
2. The project is restored to active status and the page re-renders without the banner.

- [ ] Spec approved
- [ ] Implementation verified

## [SC19] Expand a truncated plan synopsis

**Preconditions:** The project has a plan synopsis long enough to overflow the collapsed view.

1. The user sees a "Show more" toggle beneath the synopsis and clicks it.
2. The synopsis expands to show its full text and the toggle label changes to "Show less"; clicking again collapses it.

- [ ] Spec approved
- [ ] Implementation verified

## [SC20] Open the full plan from the synopsis

1. The user clicks "View full plan →" beneath the synopsis.
2. The browser navigates to the project's rendered plan document (`#/projects/{repo}/{slug}/plan`).

- [ ] Spec approved
- [ ] Implementation verified

## [SC21] Open the synthesis report once generated

**Preconditions:** The project's synthesis has been generated.

1. The user sees a "View synthesis →" link (either standalone or inside the outcome summary card) and clicks it.
2. The browser navigates to the project's synthesis document (`#/projects/{repo}/{slug}/synthesis`).

- [ ] Spec approved
- [ ] Implementation verified

## [SC22] Open a work package from the project table

1. The user clicks a work package's ID/row in the Work Packages table.
2. The browser navigates to that work package's detail page (`#/projects/{repo}/{slug}/wp/{wpId}`).

- [ ] Spec approved
- [ ] Implementation verified

## [SC23] Review project comments

**Preconditions:** The project has one or more project-level comments.

1. The user scrolls to the "Project Comments" section.
2. Comments are listed newest-first, each showing the authoring agent, comment type, timestamp, note text, and any structured context; a project with no comments shows a "No comments yet." message instead.

- [ ] Spec approved
- [ ] Implementation verified

## [SC24] Reset broken work packages via the Reset Project modal

**Preconditions:** At least one work package needs a reset.

1. The user clicks "Reset Project"; the button shows "Analyzing…" while the diagnosis runs, then a modal opens summarizing which work packages need attention.
2. For each work package the user can choose Reset, Skip, or Cancel (unless it is already cancelled), optionally reset acceptance criteria to unmet, and use "Reset All Broken" or "Skip All" to bulk-apply a choice; a running summary line shows how many will be reset/skipped/cancelled and the resulting project status.
3. The user clicks "Apply Reset"; the project reloads reflecting the updated work package and project statuses.

- [ ] Spec approved
- [ ] Implementation verified

## [SC25] Force-complete a healthy project via the Reset Project override

**Preconditions:** All work packages are healthy and the project status is `IN_PROGRESS`.

1. The user clicks "Reset Project"; the modal opens in "Mark as Complete" mode with a banner explaining that all healthy work packages will be forced to COMPLETE.
2. The user clicks "Mark as Complete" (or toggles "Cancel Override" first to back out); on confirmation, all non-cancelled work packages are forced to COMPLETE and the project status becomes COMPLETE.

- [ ] Spec approved
- [ ] Implementation verified

## [SC26] See confirmation that a healthy project needs no reset

**Preconditions:** All work packages are healthy and the project status is not `IN_PROGRESS`.

1. The user clicks "Reset Project".
2. An alert confirms "All work packages are healthy — no reset needed." and no modal opens.

- [ ] Spec approved
- [ ] Implementation verified

## [SC27] Watch a project's status update live without reloading

**Preconditions:** An orchestrator run is actively progressing through the project's work packages.

1. The user leaves the project detail page open while the run progresses in the background.
2. Every 5 seconds the page polls for changes and patches the status badge, per-work-package status/pipeline cells, health badge, synthesis link, outcome summary, and timing info in place — without a full page reload or loss of scroll position; if the change is structural (e.g. a new work package appears), the page performs a full re-render instead.

- [ ] Spec approved
- [ ] Implementation verified

## [SC28] Kill an active orchestrator run from the project toolbar

**Preconditions:** An orchestrator run for this project is active and present in the run queue.

1. The user clicks the "Kill" button in the project's orchestrator toolbar and confirms the prompt.
2. The run process is terminated and the toolbar updates to reflect that no run is active.

- [ ] Spec approved
- [ ] Implementation verified

## [SC29] Resume an interrupted orchestrator run from the project toolbar

**Preconditions:** A previous orchestrator run for this project was interrupted and run metadata exists.

1. The user clicks "Resume" in the project's orchestrator toolbar.
2. The toolbar begins polling (3 s cadence) for the resumed run to appear in the queue; once detected, the page performs a full re-render reflecting the newly active run.

- [ ] Spec approved
- [ ] Implementation verified

## [SC30] Open a past run's log from the project's Orchestrator Runs list

**Preconditions:** The project has at least one recorded orchestrator run.

1. The user scrolls to the "Orchestrator Runs" section and clicks a run entry.
2. The browser navigates to that run's log viewer (`#/projects/{repo}/{slug}/runs/{filename}`).

- [ ] Spec approved
- [ ] Implementation verified

## [SC31] Review the project-level agent dialogues

**Preconditions:** At least one agent dialogue has been captured for the project.

1. The user scrolls to the project's Dialogues section, which loads asynchronously after the rest of the page.
2. Dialogues are grouped by source and stage in an overview table; clicking a revision button opens the rendered dialogue (interactive tool-call/checklist rendering when chunk data is available, or a Markdown fallback otherwise) inline.

- [ ] Spec approved
- [ ] Implementation verified

## [SC81] Navigate to the filtered project list from a project's repository breadcrumb

1. The user clicks the repository name in the breadcrumb at the top of a project's detail page.
2. The browser navigates to the project list with the Repository filter pre-selected to that repository, showing only its projects.

- [ ] Spec approved
- [ ] Implementation verified
</content>
