# Usage Scenarios — Strategy (Repositories)

Part of the [AI Insights Ledger GUI usage scenarios](README.md).

---

## [SC50] View the repository list

1. The user navigates to `#/strategy`.
2. A table lists every declared repository with its label, ID, and vision status (No vision / Partial vision / Full vision); in multi-store mode a Store column and a Repositories/Conflicts tab bar are also shown.

- [ ] Spec approved
- [ ] Implementation verified

## [SC51] Add a new repository

1. The user clicks "Add Repository".
2. A modal opens for entering the repository's ID, label, and folder names (and, in multi-store mode, the target store); on save, the modal closes and the repository list refreshes to include the new entry.

- [ ] Spec approved
- [ ] Implementation verified

## [SC52] Edit an existing repository

1. The user clicks a declared repository's label link in the table.
2. A modal opens pre-filled with the repository's current label, folder names, vision fields, and (in multi-store mode) store; the ID field is read-only. Saving updates the entry and refreshes the list.

- [ ] Spec approved
- [ ] Implementation verified

## [SC53] Reveal and register an undeclared repository

**Preconditions:** At least one filesystem-discovered repository folder is not yet declared in the registry.

1. The user checks "Show undeclared repositories".
2. Undeclared entries appear as muted rows with a "Register" button; clicking it opens the Add Repository modal pre-filled with a sanitized ID, label, and folder name derived from the folder.

- [ ] Spec approved
- [ ] Implementation verified

## [SC54] Sort the repository table by column

1. The user clicks a sortable column header (Label or ID).
2. The table re-sorts by that column; clicking the same header again reverses the sort direction.

- [ ] Spec approved
- [ ] Implementation verified

## [SC55] Move a repository between stores

**Preconditions:** More than one store is configured (multi-store mode).

1. The user opens a repository's edit modal and changes the Store dropdown to a different store.
2. On save, the repository's registration is atomically moved from its original store to the target store.

- [ ] Spec approved
- [ ] Implementation verified

## [SC56] Review and resolve a cross-store registry conflict

**Preconditions:** The same repository ID is registered in more than one store (multi-store mode).

1. The user switches to the "Conflicts" tab.
2. Each conflicting repository is shown as a card listing every store's entry, with an "Active" badge on the winning entry (by store priority) and "Shadowed" on the others, plus vision summaries and last-modified times.
3. The user uses the card's resolution action to resolve the conflict; the conflict count badge on the tab updates accordingly.

- [ ] Spec approved
- [ ] Implementation verified

## [SC82] Delete a repository declaration

**Preconditions:** A repository is declared in the registry.

1. The user removes the repository's declaration (its data and files are not touched — only the entry in the registry is removed).
2. The repository list reloads without the deleted entry; a subsequent scan of its folder shows it again as undeclared, available for re-registration.

- [ ] Spec approved
- [ ] Implementation verified
</content>
