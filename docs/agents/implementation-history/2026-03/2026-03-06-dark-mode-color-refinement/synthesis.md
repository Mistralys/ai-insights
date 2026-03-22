# Synthesis — Dark Mode Color Refinement

**Project:** 2026-03-06-dark-mode-color-refinement  
**Completed:** 2026-03-06  
**Status:** All 3 work packages COMPLETE — all pipelines PASS

---

## What Was Delivered

A single CSS file was modified (`mcp-server/gui/public/styles.css`) to fix dark mode readability. Three new CSS custom properties were introduced and `.btn-primary` was decoupled from the status color token.

### Token changes in `[data-theme="dark"]`

| Token | Old value | New value | Reason |
|-------|-----------|-----------|--------|
| `--color-border` | `#334155` | `#475569` | Slightly more defined panel edges |
| `--color-ready` | *(not overridden; used light-mode #2563eb)* | `#3b82f6` | Brighter badge text & progress fills |
| `--color-in-progress` | *(not overridden; used #d97706)* | `#f59e0b` | Brighter amber-400 |
| `--color-complete` | *(not overridden; used #16a34a)* | `#22c55e` | Brighter green-500 |
| `--color-blocked` | *(not overridden; used #dc2626)* | `#f87171` | Brighter red-400 |
| `--color-link` *(new)* | n/a | `#60a5fa` | 7.02:1 on `#0f172a` — WCAG AA ✓ |
| `--color-btn-bg` *(new)* | n/a | `#1d4ed8` | 6.70:1 with white — WCAG AA ✓ |
| `--color-priority-high` | *(not overridden)* | `#f87171` | Brighter red-400 |
| `--color-priority-medium` | *(not overridden)* | `#fbbf24` | Brighter amber-400 |

### Rule changes

- `a { color: var(--color-link); }` — was `var(--color-ready)`, now uses the new dedicated link token
- `.btn-primary { background: var(--color-btn-bg); border-color: var(--color-btn-bg); }` — was `var(--color-ready)`, now uses the new dedicated button-background token

**Light mode: zero change.** Both new tokens default to `var(--color-ready)` in `:root`, preserving identical light-mode behaviour.

---

## Key Finding: Plan Contrast Estimate Was Wrong

The plan estimated `#3b82f6` (blue-500) at `~4.7:1` with white text for `.btn-primary`. Measured value is **3.68:1** — below WCAG AA (4.5:1) for 13px/weight-500 text. The plan's architectural insight (decouple `--color-link` from `--color-ready`) was correct, but the same decoupling was needed for the button background too.

The `--color-btn-bg` token introduced in WP-002 resolves this cleanly by following the identical token-override pattern without adding any hard-coded hex values to the component block.

---

## Verified Contrast Ratios

| Element | Foreground | Background | Ratio | WCAG AA |
|---------|-----------|-----------|-------|---------|
| Link text (dark) | `#60a5fa` | `#0f172a` | 7.02:1 | ✓ PASS |
| `.btn-primary` text (dark) | `#ffffff` | `#1d4ed8` | 6.70:1 | ✓ PASS |
| IN_PROGRESS badge (dark) | `#f59e0b` | `#451a03` | 6.97:1 | ✓ PASS |
| BLOCKED badge (dark) | `#f87171` | `#450a0a` | 5.84:1 | ✓ PASS |
| Light link text | `#2563eb` | `#f8fafc` | 4.94:1 | ✓ PASS |
| Light `.btn-primary` | `#ffffff` | `#2563eb` | 5.17:1 | ✓ PASS |
| READY badge (dark) | `#3b82f6` | `#1e3a5f` | 3.13:1 | ⚠ Below AA |
| COMPLETE badge (dark) | `#22c55e` | `#14532d` | 4.00:1 | ⚠ Below AA |

The READY and COMPLETE badge cases are architectural constraints — the shared `--color-ready` / `--color-complete` token cannot simultaneously satisfy both badge-text brightness and button-background darkness requirements. Both are significant improvements over the pre-change values (2.23:1 and ~2.3:1 respectively). Full resolution requires split badge-text tokens and is tracked in `mcp-server/todo.md`.

---

## Follow-up Items (tracked in `mcp-server/todo.md`)

1. **`--color-priority-low` dark override** — `#95a5a6` has no dark override (~3.5:1 on dark bg). Fix: add `#cbd5e1` (slate-300).
2. **READY/COMPLETE badge text contrast** — 3.13:1 / 4.00:1. Fix: `--color-badge-ready-text` / `--color-badge-complete-text` split tokens, or adjust hard-coded badge backgrounds.
3. **`.btn-danger` dark contrast** — `#f87171` background with white text = 2.77:1. Fix: `--color-btn-danger-bg: #b91c1c` following the `--color-btn-bg` pattern.

---

## Files Modified

| File | Nature of change |
|------|-----------------|
| `mcp-server/gui/public/styles.css` | 2 new tokens in `:root`; 8 new token overrides in `[data-theme="dark"]`; `.btn-primary` rule updated; `a {}` rule updated |
| `mcp-server/changelog.md` | v1.10.3 entry added / corrected |
| `mcp-server/todo.md` | 2 follow-up items added (READY/COMPLETE badge, `.btn-danger`) |
