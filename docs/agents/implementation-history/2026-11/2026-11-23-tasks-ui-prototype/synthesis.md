
## Synthesis

### Completion Status
- Date: 2026-11-23
- Status: COMPLETE
- Completed by: Web GUI Specialist Agent
- Research brief: none found
- Archived in Ledger: 2026-11-23

### Outcome Summary

A self-contained, clickable prototype of the planned "Tasks" tab now exists at `docs/agents/plans/2026-11-23-tasks-ui-prototype/tasks-prototype.html`, built against the project description in `docs/agents/plans/2026-11-23-tasks-ui-prototype/request.md`. It uses the live GUI's design tokens, so it looks like a real tab of the Ledger dashboard in both themes. It implements the full interaction model on sample data, so the layout and keyboard flow can be discussed by using them rather than from a description.

### Interface Implementation Summary
- Compact single-line task rows following `[~xQT.+-]`: drag handle, completion checkbox, ticket reference, task text with inline Markdown, expand toggle and two-step delete. The collapsible area holds the note lines, the store badge, created/completed dates and the tag chips.
- Ticket references are linked per the spec's link format (default queue for numeric references, custom queue as typed, plain text without a base URL). They are edited separately through a hover pencil or the `r` key.
- Inline editing of task text (raw Markdown; Enter saves, Shift+Enter adds a new line, Esc cancels, blur saves) and of references, with validation and normalisation (`queue-99` with the default queue is stored as `99`).
- Filter bar with multi-term search, Open/Completed/All status filter, store filter, sort (priority / date created / date completed) and an AND tag filter. Tags can be added from an autocomplete field or by clicking a tag badge in a task.
- Reordering by drag & drop or Alt+↑/↓, only in priority sort. It works under active filters and crosses page boundaries.
- Create flow from the top or bottom button: a store menu (skipped when only one store exists), then a detached draft row. After saving, the status line reports where the task went ("shown on page 2" / "hidden by the current filters").
- Full keyboard model with a roving tabindex, an inline shortcut panel (`?`), and global `/` and `n` shortcuts.
- Prototype-only controls panel standing in for Configuration → Tasks (base URL, queue name, single-store mode).

### Documentation Updates
- `docs/agents/plans/2026-11-23-tasks-ui-prototype/request.md`: added the agreed interaction defaults earlier in the session (Reordering, Inline Editing, Keyboard Navigation, create-flow and delete details, tag editing, filter options), and a link to the prototype under "Tasks Tab".
- No GUI manifest updates were needed, because nothing in `mcp-server/gui` changed. The prototype lives with the project description.

### Verification Summary
- Browser checks (headless Chrome via a scratch puppeteer script): initial render and pagination; reference links with default queue, custom queue and no base URL; arrow-key navigation including crossing pages; expanding and adding tags by keyboard; text edit save/cancel/multi-line; reference edit with normalisation and invalid input; Alt+↑/↓ moves including across the page boundary; completion with delayed leave and focus hand-off; delete arm/Esc/3 s revert/confirm, and disarm when focus leaves; blur-commit followed by a click on another row's text; tag-badge click filter; create flow from top (keyboard store menu) and bottom (mouse) including the empty-text refusal and the hidden-by-filter message; handle hidden in date sorts; date-completed ordering; multi-term search and ↓ into the list; single-store mode; help toggle; light/dark themes at 1280px.
- Accessibility and responsive audit: roving tabindex and visible focus ring on rows and controls; ARIA labels on icon buttons, `aria-expanded` on toggles and the create menu, `role="menu"` keyboard handling, live status region; measured contrast (body text, links, muted text all ≥4.5:1; input borders and handle ≥3:1 in both themes after a fix); no horizontal overflow at 375, 640 (≈200% zoom of 1280) and 768px; `prefers-reduced-motion` disables the flash and fade; iOS zoom guard (16px inputs) on touch devices.
- Tests run: no project test suite covers a standalone prototype file; the scratch browser script above served as the functional test.
- Static analysis run: no linter is configured for `docs/`; the browser run reported no console or page errors.
- Result: PASS. All scripted checks pass in the final run.

### Interface Insights

#### Implementation Decisions
- [HIGH] (decision) `tasks-prototype.html`, reference cell: the spec wants the reference to be both a ticket link and click-to-edit, and one click target cannot do both. The reference text opens the ticket; a pencil button (on hover/focus) or `r` edits it. Clicking edits directly when there is no base URL or no reference. **Confirmed by the user on 2026-11-23** and recorded in `docs/agents/plans/2026-11-23-tasks-ui-prototype/request.md` → Inline Editing.
- [MEDIUM] (decision) `tasks-prototype.html`, task list: roving tabindex. Only the active row and its own controls are in the Tab order, so Tab enters the list once and the arrow keys move between rows, instead of tabbing through every control on the page.
- [MEDIUM] (decision) `tasks-prototype.html`, completion: a task that leaves the current filter stays struck through for about 700 ms before it disappears, and focus moves to the neighbouring row. Instant removal made it unclear what had happened.
- [MEDIUM] (decision) `tasks-prototype.html`, move logic: moving swaps `priority` values with the neighbour in the *filtered* list, so it works under filters without disturbing hidden tasks and naturally crosses pages. Drag & drop reassigns the existing priority values within the page. The real implementation can keep this model (integer priority, new task = max + 1).
- [LOW] (decision) `tasks-prototype.html`, Markdown: a tiny built-in renderer keeps the file self-contained. The real view should use the GUI's bundled `marked`, with sanitising, like the Knowledge view.
- [MEDIUM] (decision) `tasks-prototype.html`, colour dot / palette *(rework)*: the dot sits between the reference and the text (`[~xQOT.+-]`). Tasks without a colour show an empty ring only on hover/focus. The palette is a non-modal popover anchored to the dot (16 colours plus "No colour"), navigable with the arrow keys; Esc/Tab closes it and returns focus to the dot, and it flips above the dot near the bottom of the viewport. A new `c` shortcut opens it and was added to `request.md`.
- [MEDIUM] (decision) `tasks-prototype.html`, palette contents *(rework)*: the 16 colours were chosen for hue separation at dot size (red, orange, amber, yellow, lime, green, teal, cyan, blue, indigo, violet, fuchsia, pink, brown, slate, gray). A task stores a palette id such as `violet`, not a hex value, so the palette can be re-tuned per theme without migrating stored tasks.
- [MEDIUM] (decision) `tasks-prototype.html`, colour filter *(rework)*: a "Colour" control in the filter bar opens the same palette as toggles, so several colours can be picked; "No colour" selects uncoloured tasks and "Any" clears the filter. A task has only one colour, so the selected colours combine as *any of* (OR); AND would always be empty. The palette stays open while toggling, the button shows the selected dots, each colour appears as a removable chip under "Colour, any of:", and "Clear filters" resets colours too.
- [LOW] (decision) `tasks-prototype.html`, prototype controls *(rework)*: the new "Default entries per page" setting from `request.md` is in the controls panel and updates the list and the per-page selector.
- [LOW] (decision) `tasks-prototype.html`, expand toggle: the dot on `+` marks only tasks with note lines. Counting tags as well put it on almost every row.

#### Follow-Up Items
- [MEDIUM] (accessibility-gap) `mcp-server/gui/public/styles.css`: the live stylesheet has no `:focus-visible` rules, and `--color-border` (#e2e8f0) is about 1.2:1 on white, below the 3:1 non-text threshold for input borders. The prototype adds `--color-border-strong` (#7d8ba1 light / #64748b dark; #94a3b8 measured only 2.56:1) and a global focus ring. The real Tasks view should move these into `styles.css`.
- [MEDIUM] (visual-bug) `tasks-prototype.html`, `.task-ref`: at 1280px the reference column cut off `QUEUE-4578`. It is fixed with a 12.5ch column and an overlaid pencil. The real view must size this column for the longest expected reference; very long custom queue names will still be cut off.
- [LOW] (ux-friction) `docs/agents/plans/2026-11-23-tasks-ui-prototype/request.md`, Adding Tasks: a saved draft can land on another page or be hidden by filters. Consider writing the "where did it go" status feedback into the spec.
- [LOW] (accessibility-gap) `tasks-prototype.html`, palette in dark theme *(rework)*: the slate, brown and indigo dots have low contrast against the dark surface. A light inset ring keeps them visible; per-theme hex values for the same ids would help if users rely on these colours. Colour never carries meaning on its own, because every dot has an accessible name.
- [LOW] (improvement) `request.md`, colours *(rework)*: colours cannot be sorted, and the new-task row has no colour picker (a colour is set after creation). Filtering by colour was added in a later rework.
- [LOW] (ux-friction) `mcp-server/gui/public/styles.css`, header nav: the live header wraps into three rows at 375px and two at 200% zoom, pushing content down. A compact or overflow nav pattern would help every view.

### Rework: Colour Dots (2026-11-23)
- Requested by the user after approval: user-chosen colour dots from a fixed 16-colour palette, as added to `request.md` (entry property "Color", layout `O`, Inline Editing, Color Palette section).
- Delivered: a colour dot cell in each row, a palette popover with mouse and keyboard support, the `c` shortcut (added to the keyboard table in `request.md`), seeded sample colours, and the "Default entries per page" setting in the prototype controls.
- Follow-up request: filter by colour, implemented as a multi-select OR filter with "No colour" and "Any" options, filter chips, and keyboard support. Added "By color" to the Filtering list in `request.md`.
- Verified in headless Chrome: dot rendering with accessible names, hidden empty ring until hover/focus, opening with `c`, click and Enter, arrow navigation, choosing and clearing a colour, Esc and outside-click closing with focus return, flipping near the bottom of the viewport, fitting at 375px, the per-page default setting, light/dark themes, and for the filter: single and multiple colours, "No colour", chip removal, "Any", Clear filters, Esc focus return, switching between the row palette and the filter palette, and no overflow at 375/640px. The full earlier regression run also passes.

### Additional Comments
- Open the prototype directly from disk (`file://`); it needs no server. The only external request is the same Google Fonts import the live GUI uses.
- The prototype's data model (fields, priority semantics, reference normalisation) is a reasonable starting point for the `tasks.json` schema, but it is not binding.
