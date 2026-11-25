# Plan: Tasks List — UI Prototype

## Summary

Build a single-page, self-contained HTML prototype of the planned "Tasks" tab so the layout and interaction model described in `docs/agents/projects/tasks.md` can be discussed before any real implementation starts. The prototype reuses the live GUI's design tokens (header, buttons, badges, pagination, dark/light theme) and runs entirely on in-memory sample data, with no server or MCP integration.

## Scope

- Single HTML file at `docs/agents/projects/tasks-prototype.html`, no build step, no external dependencies besides the fonts the GUI already loads.
- Compact single-line entry rows following the layout `[~xQT.+-]` with collapsible content (additional lines, dates, store badge, tags).
- Ticket reference linking per the description's link format, with a placeholder when empty; mock "Tasks" settings for base URL and queue.
- Inline editing of text (Markdown) and reference; tag chip editing with autocomplete; click tag to filter.
- Filtering by search, tags (AND), completion status (Open/Completed/All), store; sorting by priority, date created, date completed.
- Reordering via drag handle and Alt+↑/↓ (priority sort only), including page-boundary moves.
- Create flow with store menu (skipped for a single store) and a detached new-entry row at the top or bottom.
- Two-step delete with timed revert; pagination with 20 entries per page.
- Full keyboard navigation as specified in the project description; light and dark theme.

## Out of Scope

- Persistence, API endpoints, MCP tools, the Task Curator agent, and the real Configuration tab.
- Integration into `mcp-server/gui/public`.

> Ad-hoc plan created from a direct user request; no formal planning pass was run.
