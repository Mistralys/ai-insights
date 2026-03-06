# Plan

## Summary

Refine the dark mode color palette of the MCP Server GUI Dashboard (`mcp-server/gui/public/styles.css`) to improve visual hierarchy and readability. The primary pain point is that links are rendered in `#2563eb` (Tailwind blue-600), a color calibrated for light backgrounds that appears dim and low-contrast on the dark `#0f172a` background. Fixing this requires separating "link color" from "button accent color" (they currently share the same CSS variable) and introducing a dedicated `--color-link` token, while also brightening all four status colors in the dark theme to 400–500-level equivalents. The reference palette is **GitHub Primer Dark**, the industry-standard dark-mode design system.

---

## Architectural Context

All styling lives in a single file:

- [`mcp-server/gui/public/styles.css`](mcp-server/gui/public/styles.css) — 1 273 lines

Color tokens are defined as CSS custom properties in two places:

| Block | Lines | Purpose |
|-------|-------|---------|
| `:root { … }` | 8–33 | Light-mode defaults: status colors, neutrals, spacing |
| `[data-theme="dark"] { … }` | 38–48 | Dark-mode overrides: only neutrals (bg, surface, border, text) |
| `[data-theme="dark"] .badge-*`, etc. | 1200–1273 | Hard-coded hex overrides for specific components |

**Key observation:** The four status colors (`--color-ready`, `--color-in-progress`, `--color-complete`, `--color-blocked`) are defined only in `:root` and are **never overridden** in the dark-mode block. Every component that uses those tokens — links, badge text, button backgrounds, progress bars — therefore consumes light-mode 600-level colors regardless of theme.

**The link/button coupling problem:**

```css
/* Both share the same token: */
a                   { color: var(--color-ready); }          /* wants a bright readable blue */
.btn-primary        { background: var(--color-ready); }     /* wants a darker blue for white-text contrast */
```

Naively setting `--color-ready` to a very bright blue in dark mode would break `.btn-primary` readability (white text on light-blue background fails WCAG AA). This must be resolved by **decoupling link color from button color**.

---

## Approach / Architecture

### Reference Palette — GitHub Primer Dark

| Purpose | Primer Dark Token | Hex | Tailwind Equivalent |
|---------|------------------|-----|---------------------|
| Link / primary accent | `--color-accent-fg` | `#58a6ff` | blue-400 |
| Primary interactive (buttons, focus rings) | `--color-btn-primary-bg` | `#1f6feb` | blue-700 (darker, white-text safe) |
| Success / complete | `--color-success-fg` | `#3fb950` | green-400 |
| Attention / in-progress | `--color-attention-fg` | `#d29922` | amber-500 |
| Danger / blocked | `--color-danger-fg` | `#f85149` | red-400 |

### What Changes

**1. Introduce `--color-link` token** (new variable, defaults to `var(--color-ready)` so light mode is unchanged):

```css
:root {
  --color-link: var(--color-ready);   /* NEW — light mode: inherits blue-600 */
}
```

Update the base link rule:

```css
a {
  color: var(--color-link);           /* was: var(--color-ready) */
}
```

**2. Override both `--color-link` and all four status colors in the dark block:**

```css
[data-theme="dark"] {
  /* existing neutrals kept as-is */
  --color-bg:          #0f172a;
  --color-surface:     #1e293b;
  --color-border:      #334155;       /* optional: bump to #475569 for slightly more definition */
  --color-text:        #f1f5f9;
  --color-text-muted:  #94a3b8;
  --color-header-bg:   #0f172a;
  --color-header-text: #f1f5f9;
  --shadow:            0 1px 4px rgba(0, 0, 0, 0.4);

  /* NEW — brighter status colors for dark backgrounds */
  --color-ready:       #3b82f6;       /* blue-500  → btn-primary BG stays WCAG AA with white text */
  --color-in-progress: #f59e0b;       /* amber-400 → replaces dim amber-600 */
  --color-complete:    #22c55e;       /* green-500 → replaces dim green-600 */
  --color-blocked:     #f87171;       /* red-400   → replaces dim red-600 */

  /* NEW — link-specific color, brighter than button blue */
  --color-link:        #60a5fa;       /* blue-400  → optimised for text on dark bg */
}
```

**Why blue-500 for `--color-ready` but blue-400 for `--color-link`?**

- `.btn-primary` uses `--color-ready` as its *background* with white foreground text. `#3b82f6` (blue-500) achieves a contrast ratio of ~4.7 : 1 against `#ffffff` — just above the WCAG AA threshold of 4.5 : 1.
- `a` text on `#0f172a` (slate-900): `#60a5fa` (blue-400) achieves ~6.0 : 1, clearly passing AA. Using the even darker `#3b82f6` would give ~4.9 : 1 — also passing but visually dimmer. The separate variable allows each use-case to be optimal.

**3. Review priority accent colors**

The three priority colors (`--color-priority-high`, `--color-priority-medium`, `--color-priority-low`) are only set in `:root` and not currently used in many visible places. They should receive dark-mode overrides in the same block for consistency:

```css
--color-priority-high:   #f87171;   /* red-400 */
--color-priority-medium: #fbbf24;   /* amber-400 */
--color-priority-low:    #94a3b8;   /* slate-400 — fine as-is */
```

**4. Optional border lift**

The current `--color-border` in dark mode (`#334155`, slate-700) is subtle. Bumping it to `#475569` (slate-600) would improve panel and table definition without brightening the overall background. This is a conservative, optional change.

**5. No changes needed to dark-mode badge backgrounds**

The hard-coded badge background colors (`#1e3a5f`, `#451a03`, `#14532d`, `#450a0a`) are intentionally deep/muted. With the brighter text colors now coming from the overridden status variables, the badge text/background contrast automatically improves — no additional changes required to the badge block.

---

## Rationale

| Decision | Why |
|----------|-----|
| Decouple `--color-link` from `--color-ready` | Allows optimal contrast for both text links (lighter) and button backgrounds (darker) independently. Follows the Primer Dark pattern of having separate fg and interactive-element tokens. |
| Use blue-500 for `--color-ready` (not blue-400) | Maintains WCAG AA contrast for `.btn-primary` (white text) while still being noticeably brighter than the current blue-600. |
| Use GitHub Primer Dark as reference | Industry-tested, publicly documented, specifically designed for the same kind of data-dense dark-mode dashboard. Tailwind's own dark-mode guide and VS Code's dark theme converge on the same approximate hue levels. |
| Keep badge backgrounds as-is | They are already dark-optimised and the fix to text color is sufficient. Changing backgrounds risks over-engineering and may affect the screenshot record. |
| Keep `--color-text-muted` as-is (`#94a3b8`) | Already matches Primer Dark's secondary text color. No change needed. |
| Change `styles.css` only | All color tokens flow from this one file. No JavaScript or HTML changes required. |

---

## Detailed Steps

1. **Add `--color-link` to `:root`** — new variable defaulting to `var(--color-ready)` so light mode is completely unaffected.
2. **Update the base `a { }` rule** — change `color: var(--color-ready)` → `color: var(--color-link)`.
3. **Expand the `[data-theme="dark"]` block** — add overrides for `--color-ready`, `--color-in-progress`, `--color-complete`, `--color-blocked`, `--color-link`, `--color-priority-high`, `--color-priority-medium`.
4. **(Optional) Bump `--color-border`** in the dark block from `#334155` to `#475569`.
5. **Verify no regressions** by visually checking the three affected surface types:
   - Project list table (links, badges, progress bars, buttons)
   - Project detail page (synthesis link, task table, health badges)
   - Configuration/Insights pages (filter controls, nav)

---

## Dependencies

- No new libraries or build tools required.
- No JavaScript changes required.
- No HTML changes required.

---

## Required Components

| File | Change Type |
|------|-------------|
| [`mcp-server/gui/public/styles.css`](mcp-server/gui/public/styles.css) | Modify — add token, update link rule, expand dark block |

---

## Assumptions

- The GUI is served with its current single-file CSS bundle (no CSS preprocessor or build step).
- The live preview at the attached screenshot is representative of the production dark mode state.
- `.synthesis-link` uses `var(--color-primary)` (an undefined token that silently falls back to the browser default) — this is a pre-existing bug, not in scope for this plan.

---

## Constraints

- All changes must be confined to `styles.css`. No new files.
- WCAG AA contrast ratios must be maintained for all interactive elements:
  - Link text on dark bg: ≥ 4.5 : 1
  - Button text (white) on button bg: ≥ 4.5 : 1
  - Badge text on badge bg: ≥ 4.5 : 1
- Light mode must be **completely unaffected** by all changes.

---

## Out of Scope

- Fixing the pre-existing `--color-primary` undefined-variable bug on the synthesis link (separate issue).
- Redesigning the dark-mode background palette (bg, surface, border neutrals) — these are already well-calibrated.
- Adding a system-preference media query (`prefers-color-scheme: dark`) — out of scope.
- Changing the light-mode color palette.

---

## Acceptance Criteria

- Links in dark mode are visually distinct and clearly readable against the `#0f172a` background (target: `#60a5fa` or equivalent).
- Status badge text (READY, IN_PROGRESS, COMPLETE, BLOCKED) is brighter and crisp in dark mode.
- `.btn-primary` (blue button with white text) maintains WCAG AA contrast in dark mode.
- Progress bar fills remain visible and coloured appropriately.
- Light mode renders identically to before the change.
- No hard-coded hex overrides need to be added under the `[data-theme="dark"]` component block — the variable overrides in the theme block are sufficient.

---

## Testing Strategy

Manual visual inspection suffices for a pure CSS variable change:

1. Load the GUI in dark mode, navigate to the Projects list — verify link brightness, badge text, button.
2. Navigate to a project detail page — verify all badge types and in-progress indicators.
3. Switch to light mode — verify no visible change in any color.
4. Run the existing test suite (`npm test` in `mcp-server/`) — no failures expected (tests cover server logic, not CSS).

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`.btn-primary` contrast regression** if `--color-ready` is brightened too far | Use blue-500 (`#3b82f6`) not blue-400; verify 4.7 : 1 ratio against white before shipping |
| **Badge text washed out** if status colors become too light against the deep badge backgrounds | Verify each of the four badge types; the 400–500 level colors have been chosen specifically to remain readable on the `#1e3a5f`/`#14532d`/`#451a03`/`#450a0a` dark backgrounds |
| **Scope creep** | The plan is narrowly scoped to `styles.css` variable additions/overrides. No other files need to be opened. |
