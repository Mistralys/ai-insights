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

### Badge Colour Tokens

All badge colours use CSS custom property indirection — no hardcoded hex values in `.badge-*` rules.
Light-mode values are defined in `:root`; dark-mode overrides live in `[data-theme="dark"] :root`.

| Token | Light value | Badge variant |
|-------|-------------|---------------|
| `--color-badge-ready-bg` / `-fg` | `#dbeafe` / `#2563eb` | `.badge-ready` |
| `--color-badge-in-progress-bg` / `-fg` | `#fef3c7` / `#d97706` | `.badge-in-progress` |
| `--color-badge-complete-bg` / `-fg` | `#dcfce7` / `#16a34a` | `.badge-complete` |
| `--color-badge-blocked-bg` / `-fg` | `#fee2e2` / `#dc2626` | `.badge-blocked` |
| `--color-badge-archived-bg` / `-fg` | `#f3f4f6` / `#6b7280` | `.badge-archived` |
| `--color-badge-runner-bg` / `-fg` | `#ede9fe` / `#5b21b6` | `.badge-runner` |
| `--color-badge-runner-orchestrator-bg` / `-fg` | `#e0e7ff` / `#3730a3` | `.badge-runner-orchestrator` |
| `--color-badge-runner-vscode-bg` / `-fg` | `#dbeafe` / `#1d4ed8` | `.badge-runner-vscode` |
| `--color-badge-runner-claude-code-bg` / `-fg` | `#fef3c7` / `#92400e` | `.badge-runner-claude-code` |
| `--color-badge-runner-unknown-bg` / `-fg` | `#f3f4f6` / `#6b7280` | `.badge-runner-unknown` |
| `--color-badge-dry-run-bg` / `-fg` / `-border` | `#f3e8ff` / `#7c3aed` / `#c4b5fd` | `.badge-dry-run` |
| `--color-badge-pass-bg` / `-fg` / `-border` | `#dcfce7` / `#15803d` / `#bbf7d0` | `.badge-pass` |
| `--color-badge-fail-bg` / `-fg` / `-border` | `#fee2e2` / `#b91c1c` / `#fecaca` | `.badge-fail` |
| `--color-badge-pending-bg` / `-fg` | `#fef9c3` / `#a16207` | `.badge-pending` |
| `--color-badge-started-bg` / `-fg` | `#dcfce7` / `#15803d` | `.badge-started` |
| `--color-badge-dead-bg` / `-fg` | `#fee2e2` / `#b91c1c` | `.badge-dead` |
| `--color-badge-info-bg` / `-fg` | `#dbeafe` / `#1d4ed8` | `.badge-info` |
| `--color-badge-success-bg` / `-fg` | `#dcfce7` / `#15803d` | `.badge-success` |
| `--color-badge-error-bg` / `-fg` | `#fee2e2` / `#b91c1c` | `.badge-error` |
| `--color-badge-warning-bg` / `-fg` | `#fef3c7` / `#92400e` | `.badge-warning` |
| `--color-badge-neutral-bg` / `-fg` | `#f3f4f6` / `#6b7280` | `.badge-neutral` |
| `--color-badge-scope-global-bg` / `-fg` | `#dbeafe` / `#1d4ed8` | `.badge-scope-global` |
| `--color-badge-scope-repository-bg` / `-fg` | `#dcfce7` / `#15803d` | `.badge-scope-repository` |

### Banner Colour Tokens

| Token | Light value | Banner variant |
|-------|-------------|----------------|
| `--color-banner-error-bg` / `-border` | `#fff1f2` / `#fecdd3` | `.error-banner` |
| `--color-banner-success-bg` / `-border` | `#f0fdf4` / `#bbf7d0` | `.success-banner` |
| `--color-banner-info-bg` / `-fg` / `-border` | `#eff6ff` / `#1d4ed8` / `#bfdbfe` | `.info-banner` |
| `--color-banner-stale-bg` / `-fg` / `-border` | `#fef3c7` / `#78350f` / `#f59e0b` | `.stale-banner` |
| `--color-banner-warn-bg` / `-fg` / `-border` | `#fef3c7` / `#92400e` / `#f59e0b` | `.reset-modal-banner` |

**Note:** `error` and `success` variants reuse the semantic `--color-blocked` / `--color-complete`
tokens for their foreground colour instead of dedicated `-fg` tokens; `info`, `stale`, and `warn`
variants require a distinct `-fg` value.

### Run-Stage Badge Colour Tokens

| Token | Light value | Used by |
|-------|-------------|---------|
| `--color-run-stage-active-bg` / `-fg` / `-border` | `#fef3c7` / `var(--color-in-progress)` / `#fde68a` | `.run-stage-badge--active` |
| `--color-run-stage-done-bg` / `-fg` / `-border` | `#dcfce7` / `var(--color-complete)` / `#bbf7d0` | `.run-stage-badge--done` |
| `--color-run-stage-error-bg` / `-fg` / `-border` | `#fee2e2` / `var(--color-blocked)` / `#fecaca` | `.run-stage-badge--error` |

**Note:** The `-fg` tokens are defined via `var()` references to semantic tokens (`--color-in-progress`,
`--color-complete`, `--color-blocked`). Since those semantic tokens each have their own dark overrides,
no `[data-theme="dark"]` override is needed for the run-stage `-fg` tokens — they cascade automatically.

**Badge-specific tokens** — see Section 4 for the full naming convention and instructions for adding new variants.

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

### CSS Token Convention

Each `.badge-{variant}` rule uses CSS custom property indirection — **no hardcoded hex values**.
All badge colours are declared as tokens in `:root` and dark-mode values override them in
`[data-theme="dark"]`. This eliminates individual `[data-theme="dark"] .badge-*` override blocks.

**Token naming:**

| Token | Usage |
|-------|-------|
| `--color-badge-{variant}-bg` | `background` of `.badge-{variant}` |
| `--color-badge-{variant}-fg` | `color` of `.badge-{variant}` |
| `--color-badge-{variant}-border` | `border-color` (only for `dry-run`, `pass`, `fail`) |

**Adding a new badge variant** requires three steps:
1. Define `--color-badge-{variant}-bg` and `--color-badge-{variant}-fg` in the `:root` block
   (light-mode values).
2. Add corresponding dark-mode overrides in the `[data-theme="dark"]` `:root` block.
3. Write the `.badge-{variant}` rule using `var(--color-badge-{variant}-bg)` and
   `var(--color-badge-{variant}-fg)`. Do **not** write a separate `[data-theme="dark"] .badge-{variant}`
   rule — the token cascade handles dark mode automatically.

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

---

## 17. UI JavaScript Namespace (`components.js`)

> **Source file:** `public/components.js`  
> **Loaded after:** `utils.js` (requires `escapeHtml()`). Loaded before all view scripts.  
> **Global:** `window.UI` — an ES5 IIFE exposing five pure render helpers.

All functions return HTML strings. Structural attributes (`id`, `data-id`, titles) are HTML-escaped
via `escapeHtml()`. Style-related fields (`body`, `opts.style`, `opts.accentColor`, `opts.titleStyle`,
`opts.extraClass`, `optionsHtml`) are inserted verbatim — pass only trusted/literal values.

---

### `UI.badge(type, label, opts?)` → `string`

Returns a status badge `<span>`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | `string` | Badge variant. Normalised via `_normaliseType()` (lowercase, spaces/underscores → hyphens; result is HTML-escaped). |
| `label` | `string` | Display text. HTML-escaped. |
| `opts` | `object` | Optional. |
| `opts.attrs` | `Record<string,string>` | Extra HTML attributes added to the `<span>`; all values are HTML-escaped. |

**Returns:** `<span class="badge badge-{normType}"{extraAttrs}>{escaped-label}</span>`

**Examples:**
```js
UI.badge('in-progress', 'In Progress')
// → '<span class="badge badge-in-progress">In Progress</span>'

UI.badge('fail', 'Error', { attrs: { title: 'Details' } })
// → '<span class="badge badge-fail" title="Details">Error</span>'
```

---

### `UI.banner(type, message)` → `string`

Returns an inline-banner `<p>`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | `string` | Banner variant. Normalised via `_normaliseType()`. Supported: `error`, `success`, `info`, `stale`, `warn`. |
| `message` | `string` | Display text. HTML-escaped. |

**Returns:** `<p class="{normType}-banner">{escaped-message}</p>`

> **Note:** `showError()` in `utils.js` now delegates to `UI.banner('error', message)`, so it also
> emits `<p class="error-banner">…</p>` (not a `<div>`).

**Example:**
```js
UI.banner('error', 'Something failed')
// → '<p class="error-banner">Something failed</p>'
```

---

### `UI.emptyState(message)` → `string`

Returns a muted empty-state `<p>`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Display text. HTML-escaped. |

**Returns:** `<p class="text-muted mt-16">{escaped-message}</p>`

**Example:**
```js
UI.emptyState('No items found')
// → '<p class="text-muted mt-16">No items found</p>'
```

---

### `UI.card(title, body, opts?)` → `string`  *(added WP-006)*

Returns a `.card` wrapper div.

| Parameter | Type | Description |
|-----------|------|-------------|
| `title` | `string \| null` | Card heading. HTML-escaped. Pass `null`/falsy to omit the title element. |
| `body` | `string` | Raw HTML for the card body. **Not escaped.** |
| `opts` | `object?` | Optional rendering options (see table below). |

**`opts` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `opts.id` | `string` | `id` attribute on the wrapper `<div>`. HTML-escaped. |
| `opts.dataId` | `string\|number` | `data-id` attribute on the wrapper. HTML-escaped. |
| `opts.style` | `string` | Additional inline style on the wrapper. Verbatim — not escaped. |
| `opts.accentColor` | `string` | Sets `border-left-color` as an inline style. Combined with `opts.style` when both are present. Verbatim. |
| `opts.titleStyle` | `string` | Inline style on the `.card-title` `<div>`. Verbatim. |
| `opts.extraClass` | `string` | Extra CSS class(es) appended to the wrapper (result: `"card {extraClass}"`). Verbatim. |

> **Security note:** `opts.style`, `opts.accentColor`, and `opts.titleStyle` are NOT HTML-escaped.
> Pass only trusted/literal CSS values (e.g. `'max-width:560px'`, `'var(--color-complete)'`).
> Never interpolate raw user input.

**Returns:** `<div class="card{extraClass}" id=".." data-id=".." style="..">{titleDiv}{body}</div>`

**Examples:**
```js
UI.card('Title', '<p>Body</p>')
// → '<div class="card"><div class="card-title">Title</div><p>Body</p></div>'

UI.card(null, body)
// → '<div class="card">{body}</div>'

UI.card('Title', body, { accentColor: '#ff0000' })
// → '<div class="card" style="border-left-color: #ff0000;">…</div>'

UI.card('Title', body, { extraClass: 'orchestrator-status-card', accentColor: 'var(--color-complete)' })
// → '<div class="card orchestrator-status-card" style="border-left-color: var(--color-complete);">...</div>'
```

---

### `UI.filterBar(containerId, filters)` → `{ html: string, bind: function }`  *(added WP-007)*

Renders a `.filter-bar` wrapper and returns `{ html, bind }` for two-phase setup.

| Parameter | Type | Description |
|-----------|------|-------------|
| `containerId` | `string` | `id` attribute on the outer `<div class="filter-bar">` wrapper. HTML-escaped. |
| `filters` | `FilterDescriptor[]` | Ordered array of filter control descriptors. |

**`FilterDescriptor` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'select'\|'text'` | Yes | Control type. |
| `id` | `string` | Yes | Element `id`. HTML-escaped. |
| `label` | `string` | No | `<label for>` text. Omitted when falsy. HTML-escaped. |
| `options` | `Array<{value, label, selected?}>` | No | Select options. Each `value`/`label` is HTML-escaped. |
| `optionsHtml` | `string` | No | Pre-built `<option>` HTML. Takes precedence over `options`. Verbatim. |
| `placeholder` | `string` | No | `placeholder` attribute for text inputs. HTML-escaped. |
| `value` | `string` | No | `value` attribute for text inputs. HTML-escaped. |
| `cssClass` | `string` | No | Extra CSS class(es) on the control element. HTML-escaped. |

**Return value:**

| Property | Type | Description |
|----------|------|-------------|
| `html` | `string` | Full HTML including the outer wrapper div and all inner controls. |
| `bind(onChange)` | `function` | Attaches event listeners (`'change'` for selects, `'input'` for text) via `document.getElementById(f.id)`. On any interaction calls `onChange(state)` where `state` is `{ [id]: currentValue }` for every filter. |

> **DOM insertion required before `bind()`:** `html` must be in the DOM before calling `bind()`.
> After an `outerHTML` replacement (e.g. knowledge.js tab-switch rebuild), always call `bind()` again
> immediately after the replacement — the old listeners are discarded with the old element.

**Example:**
```js
const fb = UI.filterBar('my-bar', [
  { type: 'select', id: 'f-status', label: 'Status',
    options: [{ value: 'ALL', label: 'All', selected: true }, { value: 'READY', label: 'Ready' }] },
  { type: 'text', id: 'f-search', placeholder: 'Search…' }
]);

container.innerHTML = fb.html;   // insert first
fb.bind(function(state) {        // then wire events
  console.log(state['f-status'], state['f-search']);
});
```
