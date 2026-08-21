# Usage Scenarios — Configuration

Part of the [AI Insights Ledger GUI usage scenarios](README.md).

---

## [SC65] Edit general server settings

1. The user navigates to the General tab of the Configuration screen and changes settings such as auto-handoff, max handoff depth, dialogue capture, or auto-archive days.
2. Changing any field marks the tab dirty; clicking "Save" persists the settings and shows a "Configuration saved." confirmation, while an invalid value (e.g. negative max depth) shows an inline validation error and blocks the save.

- [x] Spec approved
- [ ] Implementation verified

## [SC66] Add a store

1. The user opens the Stores tab, clicks "Add Store", and enters a store ID, directory path, and optional label.
2. While the user types the path, the modal checks whether the directory already exists; if it does, a note confirms that the existing directory will be imported as-is (preserving any existing repository registry), and if it does not, a note confirms that the directory will be created. On save, the store appears in the stores table with its project/repository counts. If the existing directory contains a repository registry file that fails validation, a warning is shown alongside the successful import; a syntactically invalid path is rejected with an inline error.

- [ ] Spec approved
- [ ] Implementation verified

## [SC67] Edit a store

1. The user clicks "Edit" on a store row.
2. A modal opens with the ID and path shown read-only and the label editable; saving updates the store's label.

- [ ] Spec approved
- [ ] Implementation verified

## [SC68] Remove a store

1. The user clicks "Remove" on a store row.
2. The store is removed from the configuration; if it was the default store, no store remains marked default until the user sets a new one.

- [ ] Spec approved
- [ ] Implementation verified

## [SC69] Set the default store and reorder stores

**Preconditions:** More than one store is configured.

1. The user clicks the outlined star (☆) next to a non-default store to make it the default, and/or clicks "Reorder Stores" to enter the reorder view and uses the up/down arrows to change store priority order.
2. The chosen store becomes marked default (★, disabled); the store order updates and determines which store wins when the same repository exists in more than one store. Clicking "Done" exits the reorder view.

- [ ] Spec approved
- [ ] Implementation verified

## [SC70] Assign a model to a persona

1. The user opens the Persona Models tab, clicks the edit (✎) icon next to a persona's model, selects a model (or "Default") from the dropdown, and clicks "Done".
2. The persona's row shows a dirty-change indicator and the newly selected model name; a stale banner appears indicating the persona build needs to be rebuilt to take effect.

- [ ] Spec approved
- [ ] Implementation verified

## [SC71] Set the default model for all personas

1. The user clicks the edit icon next to "Default Model", selects a model, and clicks "Done".
2. The default model updates for any persona without its own explicit override; a dirty indicator appears until the change is saved.

- [ ] Spec approved
- [ ] Implementation verified

## [SC72] Replace a model across all persona assignments

1. The user opens the "Replace Model" inline form, selects a "Replace" model and a "With" model, and clicks "Replace All".
2. Every persona currently assigned the "Replace" model is reassigned to the "With" model in a single bulk operation, with a result message confirming how many assignments changed.

- [ ] Spec approved
- [ ] Implementation verified

## [SC73] Rebuild personas after a model change

**Preconditions:** Model assignments have changed since the last persona build (stale banner is visible).

1. The user clicks "Rebuild Personas" (from the stale banner or the pre-build empty state).
2. The button shows a spinner and "Rebuilding…" while the build runs; on completion the stale banner disappears and persona rows show their resolved model names from the fresh build. A build failure shows an inline error without losing the current assignment state.

- [ ] Spec approved
- [ ] Implementation verified

## [SC74] Add, edit, or delete a model in the Model Registry

1. The user opens the Model Registry tab and adds a new model (name + slug + optional Claude Code override), edits an existing custom model's fields inline, or deletes a custom model (built-in entries show a "Built-in" badge and cannot be edited or deleted).
2. Edits show a dirty-dot indicator per changed field; deleted models show a "Restore" option until the tab is saved; an invalid or duplicate slug shows an inline validation error.

- [ ] Spec approved
- [ ] Implementation verified

## [SC75] See an unsaved-changes guard when switching configuration tabs

**Preconditions:** The active tab (General, Persona Models, or Model Registry) has unsaved changes.

1. The user clicks a different configuration tab.
2. A confirmation prompt warns that unsaved changes will be discarded; confirming discards the changes and switches tabs, while cancelling keeps the user on the current tab with their edits intact.

- [ ] Spec approved
- [ ] Implementation verified

## [SC80] View the store list

1. The user opens the Stores tab.
2. A table lists every configured store with its ID, label, a type badge ("Git", showing ahead/behind counts when applicable, or "Folder"), a sync status badge that reveals the sync provider, remote path, and notes in a popover on hover or focus, and its project/repository counts; the default store is marked accordingly.

- [ ] Spec approved
- [ ] Implementation verified

## [SC83] Import an existing directory as a store

**Status: Removed (superseded by [SC66])**
</content>
