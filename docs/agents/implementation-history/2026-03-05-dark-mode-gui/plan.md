# Plan

## Summary

Add a user-togglable dark mode to the MCP Server Dashboard GUI. The user can switch between light and dark themes via a toggle button in the header navigation bar. The selected theme persists across page loads via `localStorage`. A `data-theme="dark"` attribute placed on the `<html>` element drives all visual changes through a new set of CSS custom-property overrides, keeping the implementation self-contained and minimal.

---

## Architectural Context

The GUI is a plain JavaScript SPA with no build step and no external UI framework. All three source files live in `mcp-server/gui/public/`:

| File | Role |
|---|---|
| `index.html` | Shell HTML - loads `styles.css` then `app.js`. No existing inline scripts. |
| `styles.css` | All styling. Colors are almost entirely expressed through CSS custom properties declared in `:root`. A handful of component-level rules use hard-coded hex values (`#fef3c7`, `#f1f5f9`, `#dbeafe`, etc.). |
| `app.js` | Plain JS SPA. Defines `API`, `Router`, and page renderer functions, then calls `Router.init()`. No existing theme logic. The header nav is rendered statically in `index.html` – it is **not** rebuilt by `app.js`. |

**Coverage note:** The majority of color surface area is parameterized via `--color-*` variables, making a CSS-only dark palette override straightforward. The hardcoded hex values require explicit overrides in the dark theme block.

---

## Approach / Architecture

### 1. CSS: Dark-theme variable block (`styles.css`)

Add a single `[data-theme="dark"]` rule after the `:root` block that resets all color custom properties and directly overrides the handful of hardcoded hex selectors. This keeps all theming in CSS – no color values in JS.

**Dark palette design:**

| Variable | Light | Dark |
|---|---|---|
| `--color-bg` | `#f8fafc` | `#0f172a` |
| `--color-surface` | `#ffffff` | `#1e293b` |
| `--color-border` | `#e2e8f0` | `#334155` |
| `--color-text` | `#1e293b` | `#f1f5f9` |
| `--color-text-muted` | `#64748b` | `#94a3b8` |
| `--color-header-bg` | `#1e293b` | `#0f172a` |
| `--color-header-text` | `#f1f5f9` | `#f1f5f9` *(unchanged)* |
| `--shadow` | `0 1px 4px rgba(0,0,0,0.08)` | `0 1px 4px rgba(0,0,0,0.4)` |

Status/priority accent colors (`--color-ready`, `--color-in-progress`, `--color-complete`, `--color-blocked`, `--color-priority-*`) stay unchanged — they are vivid colours that read well on both backgrounds.

**Hardcoded selectors that need explicit overrides in `[data-theme="dark"]`:**

| Selector | Light hex in rule | Dark replacement |
|---|---|---|
| `.badge-ready` bg | `#dbeafe` | `#1e3a5f` |
| `.badge-in-progress` bg | `#fef3c7` | `#451a03` |
| `.badge-complete` bg | `#dcfce7` | `#14532d` |
| `.badge-blocked` bg | `#fee2e2` | `#450a0a` |
| `tbody tr:hover` | `#f1f5f9` | `#1e293b` *(surface)* — use `var(--color-surface)` |
| `.error-banner` bg/border | `#fff1f2` / `#fecdd3` | `#450a0a` / `#7f1d1d` |
| `.success-banner` bg/border | `#f0fdf4` / `#bbf7d0` | `#14532d` / `#166534` |
| `.reset-modal-banner` bg/color | `#fef3c7` / `#92400e` | `#451a03` / `#fbbf24` |
| `.reset-stage-present` bg | `#dcfce7` | `#14532d` |
| `.reset-stage-missing` bg | `#fee2e2` | `#450a0a` |
| `.health-badge` bg | `#f1f5f9` | `#334155` |
| `.health-badge.healthy` bg | `#dcfce7` | `#14532d` |
| `.health-badge.attention` bg | `#fef3c7` | `#451a03` |
| `select` elements (filter-bar, insights-filters) | inherits surface | needs `color: var(--color-text)` in dark |

### 2. JS: Theme module (`app.js`)

Add a `Theme` IIFE before the `Router` section that:

- Reads saved preference from `localStorage` key `mcp-theme` on page load.
- Applies `data-theme="dark"` to `document.documentElement` if the saved preference is `dark`, or if no preference has been saved yet (dark is the default).
- Exposes `Theme.toggle()` which flips the attribute and persists to `localStorage`.

### 3. HTML: Toggle button (`index.html`)

- Add a small inline `<script>` tag in `<head>` that immediately reads `localStorage` and sets `data-theme` **before** CSS renders, eliminating flash of incorrect theme (FOUC).
- Add a `<button id="theme-toggle">` inside `<header><div class="container"><nav>` after the existing nav links.

### 4. CSS: Toggle button style (`styles.css`)

Add a `.theme-toggle` button style: icon-only, inherits header text colour, no border, appropriate hover state. Displays a ☀️ icon when dark mode is active, 🌙 when light mode is active (driven by a `[data-theme="dark"] .theme-toggle::before` rule that swaps the `content` property).

---

## Rationale

- **CSS custom properties + `data-theme` attribute** is the canonical modern approach: no JS color logic, instant re-paint via a single attribute change, SSR/FOUC-safe with the inline script technique.
- **No new files** — all changes land in the three existing files, matching the project's zero-build-step ethos.
- **Dark mode as the default** gives first-time visitors the intended experience immediately, while `localStorage` allows them to switch to and persist light mode.
- **`localStorage` persistence** ensures the choice survives navigation (hash changes) and page reloads without a server round-trip.

---

## Detailed Steps

1. **`styles.css` — Add dark-theme CSS variable overrides**
   - Immediately after the closing `}` of the `:root` block, add a `[data-theme="dark"]` block that resets all `--color-*` and `--shadow` custom properties to their dark values.

2. **`styles.css` — Override hardcoded hex values in dark mode**
   - Append a clearly commented `[data-theme="dark"]` section at the bottom of the file (after all existing rules) containing targeted overrides for every hardcoded-color selector identified in the table above.
   - Add a specific dark rule for `select` and `input[type="text"]` in `.filter-bar` / `.insights-filters` to apply correct text and background colours.

3. **`styles.css` — Add `.theme-toggle` button styles**
   - Add button reset styles scoped to `.theme-toggle` inside the header.
   - Use `::before` pseudo-element with `content` to render the icon, swapped via `[data-theme="dark"] .theme-toggle::before`.

4. **`index.html` — Add FOUC-prevention inline script**
   - Add a `<script>` block inside `<head>` (after `<link rel="stylesheet">`) that reads `localStorage.getItem('mcp-theme')` and applies `data-theme="dark"` synchronously unless the saved preference is explicitly `'light'`.

5. **`index.html` — Add toggle button to nav**
   - Inside `<header><div class="container"><nav>`, after the last `<a>` tag, add `<button id="theme-toggle" class="theme-toggle" aria-label="Toggle dark mode"></button>`.

6. **`app.js` — Add `Theme` IIFE module**
   - Before the `Router` IIFE, add the `Theme` module:
     - `init()`: reads `localStorage`; defaults to dark if no value is stored; applies `data-theme`, syncs the toggle button's `title`/`aria-label`.
     - `toggle()`: flips `data-theme`, saves to `localStorage`, updates button attributes.
   - Wire `Theme.init()` call at the bottom bootstrap section (before `Router.init()`).
   - Wire a `click` listener on `document.getElementById('theme-toggle')` that calls `Theme.toggle()`.

---

## Dependencies

- No new libraries or npm packages required.
- No changes to `mcp-server/gui/server.ts` or `mcp-server/gui/api.ts` — this is a pure frontend change.

---

## Required Components

**Modified files only (no new files):**

| File | Changes |
|---|---|
| `mcp-server/gui/public/styles.css` | Dark palette CSS variable block; hardcoded-hex overrides block; toggle button styles |
| `mcp-server/gui/public/index.html` | FOUC-prevention inline script in `<head>`; toggle button element in nav |
| `mcp-server/gui/public/app.js` | `Theme` IIFE module; bootstrap wiring |

---

## Assumptions

- The MCP GUI is served as-is from `mcp-server/gui/public/` with no asset bundler. Changes to `.css`, `.html`, and `.js` are picked up immediately on next page load.
- There are no automated tests for the GUI frontend (confirmed: tests live under `mcp-server/tests/` and cover MCP tools, storage, and the Express API — not UI rendering).
- The `libs/marked.min.js` script (used for markdown rendering) requires no theming changes.

---

## Constraints

- No build step may be introduced. All changes must work as static files served directly.
- No new external CSS/JS libraries may be added.
- The toggle button must be keyboard-accessible (`button` element, `aria-label`).
- The dark theme must not reduce readability of status badges or pipeline health indicators.

---

## Out of Scope

- Theming the login/auth layer (there is none).
- Per-user server-side preference storage.
- Animated theme transitions (beyond the instantaneous attribute swap).
- Theming third-party content rendered via `marked.parse()` — the plan-content and synthesis-content blocks already inherit CSS variables through their container styles, so they will theme correctly without additional work.

---

## Acceptance Criteria

- [ ] Clicking the toggle button in the header switches the UI between light and dark themes without a page reload.
- [ ] The selected theme persists across hard page reloads (browser F5) via `localStorage`.
- [ ] No flash of incorrect theme (FOUC) occurs on page load when a theme preference has been saved.
- If no preference is saved, the UI defaults to dark mode.
- [ ] All status badges (ready, in-progress, complete, blocked), health badges, error banners, success banners, and the reset modal are legible in dark mode.
- [ ] Form controls (inputs, selects) display correct text and background colours in dark mode.
- [ ] Table hover state is visible but not jarring in dark mode.
- [ ] The toggle button is visible in both themes and is keyboard-focusable.
- [ ] No regressions to light mode appearance.

---

## Testing Strategy

Manual visual QA across all three nav views (Projects, Insights, Configuration):

1. Open the GUI in a browser.
2. Verify default theme is dark when no `localStorage` key is set.
3. Click the toggle; confirm the entire page re-themes instantly.
4. Reload the page; confirm the theme persists.
5. Clear `localStorage`; reload; confirm fallback to dark mode.
6. Navigate through every view and sub-view (project list, project detail, work package detail, plan view, synthesis view, insights, config) in both themes, checking for legibility issues.
7. Focus the toggle button with keyboard `Tab` and activate with `Space`/`Enter`.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **FOUC on initial load** — browser renders page before JS sets the theme | Inline `<script>` in `<head>` synchronously sets `data-theme="dark"` (the default) before the first paint; only overrides to light if `localStorage` explicitly stores `'light'` |
| **Missed hardcoded hex values** — some selectors not captured during audit | Post-implementation visual QA pass over every view in dark mode will surface any remaining issues; the overrides section can be expanded |
| **`select` element native OS styling** — native `<select>` picks up system dark mode independently in some browsers, causing mismatch | Explicitly set `background` and `color` on `select` in the dark override block; this works in all evergreen browsers |
| **Contrast ratio failures** — dark badge backgrounds might not meet WCAG AA** | The chosen badge dark backgrounds (e.g. `#14532d` with `#16a34a` text) have been selected to maintain sufficient contrast; verify with browser DevTools accessibility panel |
