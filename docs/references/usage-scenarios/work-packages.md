# Usage Scenarios — Work Packages

Part of the [AI Insights Ledger GUI usage scenarios](README.md).

---

## [SC32] View a work package's detail page

1. The user navigates to a work package (`#/projects/{repo}/{slug}/wp/{wpId}`).
2. The page shows the work package title and status badge, assigned-to and dependencies, a rendered Markdown description, an acceptance criteria checklist (met/unmet icons), a pipeline progression bar with per-stage badges and rework indicators, and a Pipelines section listing every pipeline run newest-first.

- [ ] Spec approved
- [ ] Implementation verified

## [SC33] Review a work package's pipeline history

**Preconditions:** The work package has at least one pipeline run recorded.

1. The user scrolls to the Pipelines section.
2. Each pipeline entry shows its type, status badge, duration, start/completion timestamps, a bullet-point summary, and any reviewer comments with type and priority; aggregate active time and wall-clock duration are shown above the list when timing data exists.

- [ ] Spec approved
- [ ] Implementation verified

## [SC34] Review a work package's handoff notes

**Preconditions:** At least one pipeline run for the work package recorded handoff notes.

1. The user scrolls to the "Handoff Notes" card.
2. All handoff notes across the work package's pipeline runs are listed as bullet points; the card is omitted entirely when no handoff notes exist.

- [ ] Spec approved
- [ ] Implementation verified

## [SC35] Review a work package's agent dialogues

**Preconditions:** At least one agent dialogue has been captured for the work package.

1. The user scrolls to the work package's Dialogues card, which loads asynchronously.
2. Dialogue revisions are grouped by pipeline stage, with the latest revision per stage visually marked; clicking a revision button expands its rendered content inline, and clicking the same button again collapses it. When no dialogues exist, a "No dialogues available for this work package." message is shown instead.

- [ ] Spec approved
- [ ] Implementation verified
</content>
