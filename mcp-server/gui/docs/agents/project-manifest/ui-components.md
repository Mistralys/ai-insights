# UI Components — MCP Server GUI

> **Source file:** `public/styles.css`
>
> This document catalogues the CSS component library available to all view modules.
> When adding new UI elements, check here first — reuse existing classes before creating new ones.

---

## 1. CSS Custom Properties

### Light Theme (`:root`)

| Property | Value | Purpose |
|----------|-------|---------|
| `--color-ready` | `#2563eb` | Blue — READY status, primary accent |
| `--color-in-progress` | `#d97706` | Amber — IN_PROGRESS status |
| `--color-complete` | `#16a34a` | Green — COMPLETE status |
| `--color-blocked` | `#dc2626` | Red — BLOCKED status, errors |
| `--color-bg` | `#f8fafc` | Page background |
| `--color-surface` | `#ffffff` | Card/panel background |
| `--color-border` | `#e2e8f0` | Borders, dividers |
| `--color-text` | `#1e293b` | Primary text |
| `--color-text-muted` | `#64748b` | Secondary/meta text |
| `--color-header-bg` | `#1e293b` | Header background |
| `--color-header-text` | `#f1f5f9` | Header text |
| `--color-link` | `var(--color-ready)` | Link color |
| `--color-btn-bg` | `var(--color-ready)` | Primary button background |
| `--color-btn-danger-bg` | `var(--color-blocked)` | Danger button background |
| `--color-priority-high` | `#e74c3c` | Priority accent |
| `--color-priority-medium` | `#f39c12` | Priority accent |
| `--color-priority-low` | `#95a5a6` | Priority accent |
| `--radius` | `6px` | Default border radius |
| `--radius-pill` | `9999px` | Pill-shaped elements |
| `--shadow` | `0 1px 4px rgba(0,0,0,0.08)` | Card shadow |

Dark theme (`[data-theme="dark"]`) overrides all color tokens for dark backgrounds.

---

## 2. Layout Classes

| Class | Description |
|-------|-------------|
| `.container` | Max-width 1440px, centered, horizontal padding. |
| `.page-header` | Flex row for page title + actions. |
| `.page-heading-wrapper` | Inline-flex for title + edit button. |
| `.filter-bar` | Horizontal flex row for filter controls. |
| `.pagination-row` | Flex container for pagination controls. |
| `.pagination` | Button group for page number buttons. |

---

## 3. Button Classes

| Class | Description |
|-------|-------------|
| `.btn` | Base button: inline-flex, padding 6px 14px, border-radius, transitions. |
| `.btn-primary` | Blue background, white text. |
| `.btn-secondary` | Transparent background, border, normal text color. |
| `.btn-danger` | Red background, white text. |
| `.btn-sm` | Smaller padding (4px 10px) and font size (12px). |
| `.btn-resume` | Outline-style blue button (border only, fills on hover). |
| `.btn-icon` | Icon-only button (no background, minimal padding). |

### `.btn-group`

Fused row of same-size buttons sharing inner borders.

```html
<div class="btn-group">
  <button class="btn btn-danger btn-sm">Kill</button>
  <button class="btn btn-resume btn-sm">Resume</button>
</div>
```

**Rules:**
- Adjacent buttons collapse their borders (`margin-left: -1px`).
- First child gets left border-radius; last child gets right border-radius.
- Focused/hovered buttons get `z-index: 1` to show their full border.
- Disabled buttons inside a group get `opacity: 0.5; cursor: not-allowed`.
- The browser renders the `title` attribute as a tooltip on disabled buttons.

---

## 4. Badge Classes

| Class | Purpose |
|-------|---------|
| `.badge` | Base: pill-shaped, uppercase, small text. |
| `.badge-ready` | Blue — READY status. |
| `.badge-in-progress` / `.badge-in_progress` | Amber — IN_PROGRESS. |
| `.badge-complete` | Green — COMPLETE. |
| `.badge-blocked` | Red — BLOCKED. |
| `.badge-archived` | Gray — ARCHIVED. |
| `.badge-runner` | Purple — generic runner badge. |
| `.badge-runner-orchestrator` | Indigo — orchestrator runner. |
| `.badge-runner-vscode` | Blue — VS Code runner. |
| `.badge-runner-claude-code` | Amber — Claude Code runner. |
| `.badge-runner-unknown` | Gray — unknown runner. |
| `.badge-dry-run` | Purple dashed border — dry run indicator. |
| `.badge-pending` | Yellow — orchestrator pending. |
| `.badge-started` | Green — orchestrator started. |
| `.badge-dead` | Red — orchestrator dead process. |
| `.badge-info` | Blue — progress info. |
| `.badge-success` | Green — progress success. |
| `.badge-error` | Red — progress error. |
| `.badge-warning` | Amber — progress warning. |
| `.badge-neutral` | Gray — progress neutral. |
| `.badge-pass` | Green outline — pipeline pass. |
| `.badge-fail` | Red outline — pipeline fail. |
| `.badge-scope-global` | Blue — global knowledge scope. |
| `.badge-scope-repository` | Green — repository knowledge scope. |

---

## 5. Card & Panel Classes

| Class | Description |
|-------|-------------|
| `.card` | Surface panel with border, shadow, padding, margin-bottom. |
| `.card-title` | 16px bold heading inside a card. |
| `.comment-card` | Left-border-accented card for insight comments. |
| `.priority-high` / `.priority-medium` / `.priority-low` | Left-border color modifiers for `.comment-card`. |
| `.plan-synopsis` | Blue left-border card for plan excerpt. |
| `.orchestrator-status-card` | Queue entry status card. |
| `.orchestrator-cli-reference` | CLI commands reference card. |

---

## 6. Table Classes

| Class | Description |
|-------|-------------|
| `.table-wrapper` | Overflow-x scroll container with border. |
| `th.sortable` | Clickable column header with cursor pointer. |
| `th.sort-asc` / `th.sort-desc` | Sort indicator arrows (CSS `::after`). |
| `tr.clickable` | Cursor pointer for navigable rows. |
| `.num-col` | Right-aligned numeric column. |
| `.repo-col` | Monospace, muted repository name. |

---

## 7. Orchestrator-Specific Classes

| Class | Description |
|-------|-------------|
| `.orch-section` | Section block with bottom margin. |
| `.orch-section-title` | Section heading. |
| `.orch-start-panel` | Start New Run panel. |
| `.orch-plan-input-row` | Flex row for plan input + button. |
| `.orch-plan-input` | Monospace text input for plan path. |
| `.orch-queue-table` | Queue table layout. |
| `.orch-toggle-cell` | Expand/collapse toggle column. |
| `.orch-plan-cell` | Truncated monospace plan path cell. |
| `.orch-elapsed-cell` | Elapsed time cell. |
| `.orch-progress-cell` | Progress summary cell. |
| `.orch-actions-cell` | Action buttons cell. |
| `.orch-queue-action-btn` | Normalized action button (works on `<a>` and `<button>`). |
| `.orch-log-preview` | Scrollable inline log preview container. |
| `.orch-empty-queue` | Empty state padding. |
| `.orch-active-run-section` | Active run section in project detail. |

---

## 8. Run Log Classes

| Class | Description |
|-------|-------------|
| `.run-event` | Base event card with left border accent. |
| `.run-event--info` | Blue accent (info events). |
| `.run-event--warning` | Amber accent (warnings). |
| `.run-event--error` | Red accent (errors). |
| `.run-event--success` | Green accent (success events). |
| `.run-event--debug` | Muted, compact (tool calls, high-frequency events). |
| `.run-wp-badge` | WP ID badge inside event cards. |
| `.run-progress-track` / `.run-progress-bar` | Progress bar (width set inline). |
| `.run-stage-badge` | Pipeline stage badge. |
| `.run-stage-badge--active` / `--done` / `--error` | Stage state variants. |
| `.run-event-summary` | Pipeline summary block inside events. |

---

## 9. Pipeline Stage Track Classes

| Class | Description |
|-------|-------------|
| `.pipeline-track` | Flex row of stage badges. |
| `.stage-badge` | Individual stage indicator (32×22px). |
| `.stage-pending` / `.stage-in-progress` / `.stage-pass` / `.stage-fail` | Stage state variants. |
| `.rework-indicator` | Red circle overlay (rework count). |
| `.pipeline-track-legend` | Legend text below track. |

---

## 10. Knowledge Page Classes

| Class | Description |
|-------|-------------|
| `.knowledge-tabs` | Tab navigation container (flex, bottom border track). |
| `.knowledge-tab` | Individual tab button. `.active` variant highlights. |
| `.category-pill` | Category label pill. |
| `.tag-chip` | Purple tag chip. |
| `.confidence-label` | Italic confidence score label. |
| `.knowledge-actions` | Action button row in knowledge cards. |
| `.knowledge-move-input` | Inline input group for move-to-project. |

---

## 11. Form Classes

| Class | Description |
|-------|-------------|
| `.form-group` | Margin wrapper for form fields. |
| `.form-label` | Label styling. |
| `.form-control` | Text input / select styling. |
| `.form-note` | Help text below inputs. |
| `.form-check` | Styled checkbox. |

---

## 12. State & Feedback Classes

| Class | Description |
|-------|-------------|
| `.loading` | Centered spinner + "Loading…" text. |
| `.error-banner` | Red error message box. |
| `.success-banner` | Green success message box. |
| `.info-banner` | Blue informational banner. |
| `.stale-banner` | Yellow sticky warning (version mismatch). |

---

## 13. Utility Classes

| Class | Description |
|-------|-------------|
| `.mt-8` / `.mt-16` / `.mt-24` | Margin-top spacers. |
| `.mb-8` / `.mb-16` | Margin-bottom spacers. |
| `.monospace` | Monospace font. |
| `.text-muted` | Muted text color. |
| `.text-danger` | Red text color. |
| `.breadcrumb` | Breadcrumb navigation styling. |

---

## 14. Health Badge

| Class | Description |
|-------|-------------|
| `.health-badge` | Base pill in project header. |
| `.health-badge.healthy` | Green variant. |
| `.health-badge.attention` | Amber variant. |

---

## 15. Dialogue Classes

| Class | Description |
|-------|-------------|
| `.dialogue-stage` | Stage grouping container. |
| `.dialogue-stage-label` | Stage name label. |
| `.dialogue-btn` | Revision selection button (pill). |
| `.dialogue-btn-latest` | Highlighted latest revision. |
| `.dialogue-btn-active` | Currently expanded revision. |
| `.dialogue-content` | Scrollable Markdown content area. |
| `.dialogue-markdown` | Markdown rendering overrides. |

---

## 16. Reset Modal Classes

| Class | Description |
|-------|-------------|
| `.reset-modal-overlay` | Full-screen backdrop. |
| `.reset-modal` | Modal container (max 720px). |
| `.reset-modal-header` / `.reset-modal-footer` | Header/footer with borders. |
| `.reset-modal-close` | Close button. |
| `.reset-modal-banner` | Warning banner inside modal. |
| `.reset-wp-list` | Scrollable WP list. |
| `.reset-wp-row` | Individual WP row. |
| `.reset-wp-actions` | Radio button row (reset/skip). |
| `.reset-stage-badge` | Stage status in reset context (`.reset-stage-present` / `.reset-stage-missing` / `.reset-stage-inactive`). |
