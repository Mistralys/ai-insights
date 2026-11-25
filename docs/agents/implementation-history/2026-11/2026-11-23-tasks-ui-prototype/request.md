# Project: Tasks List

## Description

We will add a GUI for task management with agent access through the MCP ledger.
This will be used by the user in the GUI to review tasks, also exposing MCP
tools for agents to both access the tasks and CRUD management.

## Task Curator Agent & Workflow Integration

We will add a specialized Task Curator agent that will know how to use the task
management and be the primary point of contact for user requests and other agents.
It should automatically run at synthesis time as sibling to the knowledge curator,
to check the tasks against the synthesis and mark them as done as needed.

The Task Curator agent can use the MCP tools to search for matching todos using
multiple search terms like the Knowledge Curator does for searching for insights.

## Ledger MCP Integration

Dedicated tools will be added to the ledger for the full CRUD task spectrum and searching for tasks.

## Entries

### Entry Format

|| Reference || Description ||
| | Ticket reference is optional, placeholder when empty, editable separately from task text (see Inline Editing) |
| 4578 | Numeric reference to a ticket, omitting the queue name - uses the default queue |
| QUEUE-4578 | Ticket reference with a custom queue name |
| | Example description for the task, can use **Markdown** |
| | Multi-line entries are possible, all additional content below the first gets smaller font size, and is hidden by default. |
| | Lines can be edited inline on click |

Ticket references are linked when a reference is specified, to open in a new tab:

- No queue name = [{QUEUE}{REF}]({BASE_URL}{QUEUE}{REF})
- With queue name = [{REF}]({BASE_URL}{REF})
- No base ticket URL set = {REF}

### Entry properties

- Unique ID (string, shown in entry metadata)
- Ticket reference (string, numeric. e.g. `1547` or full `QUEUE-1547`)
- Task description (string, multiline, markdown-enabled)
- Tags (multiple selection, freely editable)
- Store (string, store ID)
- Completed (boolean)
- Date created (date + time)
- Date completed (date + time)
- Color (string, user-selected from predefined colors)

## Global Task Settings

These are managed in a new "Tasks" tab in the Configuration screen.

- Base ticket URL
- Base ticket queue name (e.g `QUEUE-`)
- Default entries per page

## GUI

### Tasks Tab

A new main tab in the UI: "Tasks".

Clickable layout prototype: [tasks-prototype.html](tasks-prototype.html) (open in a browser; sample data, nothing is saved).

### Design Principles

The entry management must aggressively minimize clicks to manage tasks. No dialogs, and solid keyboard navigation.

### Entry Layout

[~xQOT.+-]
{  C. }

[ = Content left-hand side
] = Content right-hand side
~ = Handle to move entry up & down
x = Completion toggle
O = Color dot/square
Q = Reference
T = task Text
. = Flexible width auto-fill
C = Additional lines / Metadata (dates, store badge) / Tags
{} = Collapsible content
+ = Collapse/Expand control (always visible, as it also toggles the tags)
- = Delete button

The layout principle is to show a compact list of single-line entries. Even the tags are hidden, they are primarily relevant for the filtering.

### Pagination

The task list is limited to 20 entries by default, and has pagination controls to navigate to additional pages.

### Filtering

The list can be filtered:

- By search terms.
- By one or more tags (AND).
- By completion status: Open / Completed / All.
- By store.
- By color: one or more colors, plus "No color" (matches any of the selected colors).
- By color.

Behavior:

- Completed entries are hidden by default (status filter defaults to "Open").
- Sorting is the manual user-specified priority by default.
- Sorting can be switched to date created or completed.
- When sorting by date completed, open entries (no completion date) are sorted last.

### Reordering

- The move handle is only available when sorting by priority. It is hidden in the date-sorted modes.
- Entries can be moved by dragging the handle, or with `Alt+↑` / `Alt+↓`.
- Moving works within the current page. `Alt+↑` on the first entry of a page moves it to the end of the previous page; `Alt+↓` on the last entry moves it to the start of the next page.

### Inline Editing

- Clicking the task text switches it to a raw Markdown text area: the first line is the task text, additional lines are the collapsible content.
- Clicking the color dot opens the palette to choose a color (fixed palette)
- The reference is edited in its own small inline field:
  - A linked reference opens the ticket on click; an edit button shown on hover/focus edits it.
  - An empty reference (placeholder) or an unlinked one (no base ticket URL) is edited by clicking it directly.
- `Enter` saves, `Shift+Enter` inserts a line break, `Esc` cancels, and leaving the field (blur) saves.

### Color Palette

A fixed color palette allows choosing a color for an entry. This displays a color dot/square that is intended to visually identify entries. The color is user-defined. 

Palette size: 16 colors.

### Keyboard Navigation

| Key | Action |
|---|---|
| `↑` / `↓` | Move focus between entries |
| `Enter` | Edit the task text of the focused entry |
| `r` | Edit the reference of the focused entry |
| `Space` | Toggle completion |
| `→` / `←` | Expand / collapse |
| `Alt+↑` / `Alt+↓` | Move the entry up / down (priority sorting only) |
| `t` | Edit the tags (expands the entry) |
| `c` | Open the color palette of the focused entry |
| `n` | Create a new entry |
| `/` | Focus the search field |
| `Del` | Arm delete ("Confirm"); press again to delete |
| `Esc` | Cancel the current edit or armed delete |

### Adding Tasks

A "Create" icon at the top of the list (and repeated at the bottom) can be used to add a new entry. Clicking this opens a menu to select the target store (the store cannot be changed once an entry has been added). 

After selecting the store, the new entry is added using an entry detached from the list. This is so it is independent from the current sorting settings. Once the entry has been confirmed, it is added to the list according to the current sorting settings (it may even disappear from view) and the detached entry disappears again. 

New entries get the highest user-specified priority, so that when the list is sorted by priority, it is shown on top.

- The detached entry opens next to the "Create" icon that was used (top or bottom of the list).
- When only one store is available, the store menu is skipped.

### Deleting Entries

Clicking the delete button switches its label to "Confirm", a second click deletes the entry.
The button reverts to "Delete" after about 3 seconds, or when the focus leaves the entry.

### Tagging 

Tags can be freely created and assigned to entries. They are hidden by default, and are rendered below the additional content of the entry, if any. It can shown/hidden with the collapse controls. Tags are rendered as small, compact badges.

- Tags are edited inline in the expanded area as chips, with autocomplete from the existing tags.
- Clicking a tag badge adds it to the tag filter.

## Storage

task entries are saved in the available stores. A dedicated `tasks.json` per store that gets merged into a global collection like the global knowledge.

