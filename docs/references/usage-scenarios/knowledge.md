# Usage Scenarios — Knowledge

Part of the [AI Insights Ledger GUI usage scenarios](README.md).

---

## [SC57] Browse global knowledge entries

1. The user navigates to `#/knowledge` (the "Global" tab is active by default).
2. Insight cards scoped `global` are listed, each showing its category pill, tags, content preview, confidence bucket (High/Medium/Low), source, and created/updated timestamps.

- [ ] Spec approved
- [ ] Implementation verified

## [SC58] Browse repository-scoped knowledge entries

1. The user clicks the "Repository" tab.
2. The filter bar gains a Repository dropdown, and the list shows only insights scoped `repository`, each labeled with its owning repository name.

- [ ] Spec approved
- [ ] Implementation verified

## [SC59] Filter knowledge entries

1. The user selects a category from the Category dropdown and/or types into the "Title, content or tag…" search field (and, on the Repository tab, selects a repository).
2. The list updates in place to show only insights matching all active filters.

- [ ] Spec approved
- [ ] Implementation verified

## [SC60] Edit a knowledge entry

1. The user clicks "Edit" on an insight card.
2. The card switches to an inline form (title, content, category, tags, confidence slider with a live percentage/label readout); submitting saves the changes and returns the card to its normal display, while a save failure shows an inline error without discarding the edit.

- [ ] Spec approved
- [ ] Implementation verified

## [SC61] Delete a knowledge entry

1. The user clicks "Delete" on an insight card.
2. The card shows an inline "Delete this entry?" confirmation with Confirm/Cancel; confirming removes the card from the list, and cancelling restores the normal card view.

- [ ] Spec approved
- [ ] Implementation verified

## [SC62] Promote a repository insight to global

**Preconditions:** The insight is scoped `repository`.

1. The user clicks "Promote to Global" on the insight card.
2. The insight is converted to `global` scope and moves out of the Repository tab's list into the Global tab.

- [ ] Spec approved
- [ ] Implementation verified

## [SC63] Move a repository insight to another repository

**Preconditions:** The insight is scoped `repository`.

1. The user clicks "Move to Repository" on the insight card, types a target repository name, and clicks "Confirm".
2. The insight is reassigned to the target repository and the list updates to reflect its new `repository_name`.

- [ ] Spec approved
- [ ] Implementation verified

## [SC64] See an empty state when no knowledge entries match

**Preconditions:** The active tab/filter combination matches zero insights.

1. The user applies filters that exclude every insight.
2. A "No knowledge entries found." message is shown instead of an empty list.

- [ ] Spec approved
- [ ] Implementation verified
</content>
