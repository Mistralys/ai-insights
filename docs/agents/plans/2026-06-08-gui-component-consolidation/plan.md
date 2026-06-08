# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Summary

Consolidate repeated UI patterns in the MCP Server Dashboard GUI into a shared `components.js` module and flatten the CSS badge/banner system using semantic colour tokens. The goal is to reduce code duplication (~150 CSS lines, ~12 inline card fragments, 3 parallel filter-bar implementations), improve visual consistency across light/dark modes, and make future views trivial to build from established components. Work is phased so each phase is independently shippable.

## Architectural Context

The MCP Server Dashboard is a vanilla-JS SPA at `mcp-server/gui/public/` with no bundler, no framework, and no module system. Shared logic lives in global scripts loaded via `<script>` tags in `index.html`. Key files:

- `mcp-server/gui/public/index.html` — Script load order and page shell
- `mcp-server/gui/public/styles.css` — 2,671-line stylesheet with all CSS (light + dark mode overrides)
- `mcp-server/gui/public/utils.js` — Shared helpers: `escapeHtml`, `formatDate`, `statusBadge`, `breadcrumb`, `showLoading`, `showError`
- `mcp-server/gui/public/js/orchestrator-widgets.js` — IIFE-namespaced reusable widget library (`OrchestratorWidgets`)
- `mcp-server/gui/public/views/` — 8 view files: project-list, project-detail, work-package, config, insights, knowledge, run-log, orchestrator

Current conventions:
- Shared rendering code is exposed as globals or IIFE namespaces
- Badge rendering uses `statusBadge()` in `utils.js` (single pattern: `badge badge-{status}`)
- Each view manually constructs cards, filter bars, and page headers via template strings
- Dark mode is implemented via `[data-theme="dark"]` selector overrides on every badge/banner variant

## Approach / Architecture

Introduce a new `mcp-server/gui/public/components.js` file exposing a global `UI` IIFE namespace (following the `OrchestratorWidgets` pattern). This module provides parametric render functions for badges, banners, cards, empty states, and filter bars.

Simultaneously, refactor `styles.css` to use semantic CSS custom properties for badge/banner colours, collapsing the per-class dark-mode overrides into a single `:root` / `[data-theme="dark"]` token block.

Three phases:
1. **Phase 1** — `components.js` with badge, banner, and empty-state helpers + view migration
2. **Phase 2** — CSS semantic token consolidation (badges + banners)
3. **Phase 3** — Card builder + filter bar widget

## Rationale

- **Additive approach:** A new script file preserves the existing SPA architecture. No build tooling, no refactoring of the global pattern.
- **IIFE namespace:** Matches `OrchestratorWidgets` precedent — agents and developers already understand this shape.
- **Token-driven CSS:** Eliminates the maintenance bottleneck of adding a `[data-theme="dark"]` block for every new badge variant. Tokens flip once in the dark-mode block.
- **Phased delivery:** Each phase is shippable independently. Phase 1 is the quickest win (< 1 hour review); Phases 2–3 can happen in subsequent sessions without blocking.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Component system | Global IIFE namespace (`UI.badge()`, `UI.card()`) | Web Components (`<ui-badge>`); ES modules (import/export) | IIFE matches existing pattern (`OrchestratorWidgets`), no tooling changes. Web Components add complexity for no current consumer benefit; ES modules require a bundler or import-map the project doesn't use. |
| Badge CSS shape | Semantic tokens (`--badge-{status}-bg/fg`) + single `.badge[data-color]` approach | Keep current `.badge-*` per-class system; Tailwind-like utility classes | Token approach removes ~120 dark-mode override lines with zero visual change. Utility classes don't fit a framework-free SPA. |
| CSS token naming | `--color-badge-{status}-bg/fg` (prefixed with `--color-`) | Flat `--badge-{status}-bg/fg` without the `--color-` prefix | The existing codebase uses `--color-*` for all colour tokens (e.g., `--color-ready`, `--color-complete`). Using `--color-badge-*` maintains that convention and avoids a naming schism between old and new tokens. |
| Filter bar abstraction | Render function returning HTML + `bind()` callback | Custom element; reactive store | A render function + bind callback is the simplest shape that works in a global-script context. Custom elements would be over-engineered for 3 consumers. |
| Card builder | Simple wrapper function with `opts.accent` | Abstract base card class; Web Component | A function is proportional to the need — 12 inline fragments replaced by 1 call. A class hierarchy would add abstraction without a consumer. |

## Pattern Alignment

- **IIFE namespace for shared rendering** — follows `mcp-server/gui/public/js/orchestrator-widgets.js` pattern. No departure.
- **Global helper functions in `utils.js`** — `statusBadge()` will become a thin wrapper around `UI.badge()`, preserving the existing call-site contract. No departure.
- **CSS custom properties in `:root`** — follows the existing pattern at the top of `styles.css` (e.g., `--color-ready`, `--color-complete`). Extended, not departed from.
- **Script load order in `index.html`** — new `components.js` loads after `utils.js` and before view scripts, matching the dependency graph convention.

## Detailed Steps

### Phase 1 — `components.js` Badge, Banner & Empty-State Helpers

1. Create `mcp-server/gui/public/components.js` with the `UI` IIFE namespace.
2. Implement `UI.badge(type, label)` — generates `<span class="badge badge-{type}">{label}</span>`, normalising `type` (lowercase, replace spaces/underscores with hyphens).
3. Implement `UI.banner(type, message)` — generates the standard error/success/info/stale banner markup. `type` maps to the existing `.error-banner`, `.success-banner`, `.info-banner` classes.
4. Implement `UI.emptyState(message)` — generates `<p class="text-muted mt-16">{message}</p>` (the pattern repeated in 5+ views for "No items found" messaging).
5. Add `<script src="/components.js?v=1"></script>` to `index.html` after `utils.js` and before view scripts.
6. Refactor `statusBadge()` in `utils.js` to delegate to `UI.badge(status, status)` — this ensures all existing callers continue working without modification.
7. Migrate badge generation in `views/project-list.js` to use `UI.badge()` directly (runner badges, dry-run badge, status badge).
8. Migrate badge generation in `views/run-log.js` (stage badges, scope badges).
9. Migrate badge generation in `views/orchestrator.js` and `js/orchestrator-widgets.js` (health badges, status badges).
10. Migrate banner generation in views that construct banners inline (project-detail: error-banner; orchestrator: stale-banner).
11. Migrate empty-state patterns in project-list, insights, knowledge views to `UI.emptyState()`.

### Phase 2 — CSS Semantic Token Consolidation

12. Define new CSS custom properties in the `:root` block of `styles.css`: `--color-badge-{status}-bg` and `--color-badge-{status}-fg` for each status (ready, in-progress, complete, blocked, archived, runner, runner-orchestrator, runner-vscode, runner-claude-code, runner-unknown, dry-run). Use the `--color-` prefix to stay consistent with the existing token convention (`--color-ready`, `--color-complete`, etc.).
13. Define the dark-mode values for those tokens in the `[data-theme="dark"]` `:root` override block.
14. Rewrite each `.badge-{status}` rule to reference its token pair: `background: var(--color-badge-{status}-bg); color: var(--color-badge-{status}-fg)`.
15. Remove all individual `[data-theme="dark"] .badge-*` override blocks (currently ~60 lines).
16. Apply the same token approach to banner colours (`--color-banner-error-bg`, `--color-banner-success-bg`, `--color-banner-info-bg`, `--color-banner-stale-bg`) and remove their individual dark-mode blocks.
17. Apply the same approach to the `.run-event--{severity}` border-colour variants and their dark-mode overrides.
18. Apply the same approach to `.comment-card` priority border colours and their dark-mode overrides.
19. Verify visual parity in both light and dark modes (no colour regressions).

### Phase 3 — Card Builder & Filter Bar Widget

20. Implement `UI.card(title, body, opts)` in `components.js` — generates `<div class="card">` wrapper with optional `<div class="card-title">{title}</div>` and optional `style="border-left-color: {opts.accentColor}"`.
21. Implement `UI.filterBar(containerId, filters)` in `components.js` — accepts an array of filter descriptors (`{ type: 'select'|'text', label, id, options?, placeholder? }`) and returns `{ html, bind }`. The `bind()` function attaches event listeners and calls a provided `onChange` callback.
22. Migrate card construction in `views/work-package.js` (7 inline card fragments) to `UI.card()`.
23. Migrate card construction in `views/knowledge.js` (2 fragments) and `views/config.js` (1 fragment).
24. Migrate card construction in `views/project-detail.js` (1 standard card + comment-cards with accent).
25. Migrate `.orchestrator-status-card` construction in `views/orchestrator.js` and `js/orchestrator-widgets.js` to `UI.card()` — this is the third card variant identified in research (same base shape with status-driven accent).
26. Unify `.filter-bar` and `.insights-filters` CSS into a single `.filter-bar` class family; remove `.insights-filters` class entirely.
27. Migrate filter bar in `views/project-list.js` to use `UI.filterBar()`.
28. Migrate filter bar in `views/insights.js` to use `UI.filterBar()`.
29. Migrate filter controls in `views/knowledge.js` to use `UI.filterBar()`.

## Dependencies

- No external dependencies required (zero new npm packages).
- Phase 2 depends on Phase 1 being complete (badge helper must exist before CSS is refactored so callers generate correct class names).
- Phase 3 depends on Phase 2 (card builder references the token-driven accent colours).

> **Note on phase independence:** The research report presents all three phases as "independently shippable." This plan adds sequential ordering because (a) Phase 2's token refactoring is safer when `UI.badge()` already centralises class-name generation, and (b) Phase 3's accent cards benefit from tokens already being in place. If needed, Phase 2 could be done first by leaving `statusBadge()` unchanged and updating class names in-place, but the sequential order minimises churn.

## Required Components

- `mcp-server/gui/public/components.js` — **NEW** — shared UI render function library
- `mcp-server/gui/public/index.html` — script tag addition
- `mcp-server/gui/public/styles.css` — token introduction + class consolidation + dark-mode override removal
- `mcp-server/gui/public/utils.js` — `statusBadge()` becomes a thin wrapper
- `mcp-server/gui/public/views/project-list.js` — badge/filter migration
- `mcp-server/gui/public/views/project-detail.js` — card/banner/badge migration
- `mcp-server/gui/public/views/work-package.js` — card migration
- `mcp-server/gui/public/views/config.js` — card migration
- `mcp-server/gui/public/views/insights.js` — badge/filter/card migration
- `mcp-server/gui/public/views/knowledge.js` — card/filter migration
- `mcp-server/gui/public/views/run-log.js` — badge/card migration
- `mcp-server/gui/public/views/orchestrator.js` — badge/banner migration
- `mcp-server/gui/public/js/orchestrator-widgets.js` — badge migration

## Assumptions

- The vanilla-JS SPA architecture (no bundler, no framework) is intentional and will not change during this work.
- The IIFE namespace pattern (`OrchestratorWidgets`) is the established convention for shared rendering code.
- All badge variants in the CSS use the same pill shape (border-radius, font-size, text-transform, font-weight) and differ only in colour.
- No automated visual regression testing exists; verification is manual in light + dark modes.

## Constraints

- Must not introduce a build step, bundler, or module system.
- Must not break the existing `OrchestratorWidgets` namespace or its consumers.
- All changes must preserve visual parity in both light and dark modes.
- The `statusBadge()` function must remain callable (backward compat) even after migration.
- Cross-platform policy: no OS-specific code (this is client-side CSS/JS, inherently cross-platform).

## Out of Scope

- Web Components or framework adoption (discussed as future possibility in research).
- `UI.pageHeader()` abstraction — the research notes this only fits 6 of 8 views and the remaining 2 have complex custom headers. Deferred to a future cycle if views converge further.
- `UI.tabs()` component for the Knowledge view's tab switcher — deferred; Knowledge view is the only consumer.
- Performance optimization of view rendering (not a current bottleneck).
- Test automation for visual regression (no existing infrastructure).

## Acceptance Criteria

- A new `components.js` file exists and is loaded in the correct position in `index.html`.
- `UI.badge(type, label)` renders correct badge HTML for all existing badge types.
- `UI.banner(type, message)` renders correct banner HTML for error/success/info/stale types.
- `UI.emptyState(message)` renders the standard empty-state paragraph.
- `UI.card(title, body, opts)` renders card chrome with optional accent border.
- `UI.filterBar(id, filters)` generates a filter bar and its binding function.
- `statusBadge()` in `utils.js` delegates to `UI.badge()` and produces identical output.
- All 8 view files use `UI.*` helpers instead of inline badge/card/filter construction.
- `styles.css` uses semantic tokens (`--color-badge-*`, `--color-banner-*`) for all badge and banner colours.
- All `[data-theme="dark"] .badge-*` individual overrides are removed.
- `.insights-filters` CSS class is removed; all filter bars use `.filter-bar`.
- Visual appearance in light mode is unchanged (pixel-level comparison not required; no intentional visual change).
- Visual appearance in dark mode is unchanged.
- No JavaScript errors in the browser console after migration.

## Testing Strategy

Manual visual verification in both themes. Since the GUI has no automated test infrastructure, testing relies on:
1. Browser dev-tools inspection of generated HTML structure.
2. Side-by-side comparison of each view before/after in light and dark modes.
3. Console error monitoring (no new errors).
4. Interaction testing: filter bars respond correctly, badges display correct colours for all status values.

## Test Plan

- Manual: project-list view — verify all badge types render correctly (status, runner, dry-run) — covers AC: `UI.badge` renders correct HTML
- Manual: project-list view — verify filter bar interaction (status/runner/search) works after migration — covers AC: `UI.filterBar` generates binding function
- Manual: project-detail view — verify comment-cards with priority accent render correctly — covers AC: `UI.card` with accent
- Manual: project-detail view — verify error banner renders in dark mode — covers AC: banner tokens work
- Manual: work-package view — verify all 7 card sections render with correct titles — covers AC: `UI.card` replaces inline fragments
- Manual: insights view — verify filter bar + badge + comment-card rendering — covers AC: `.insights-filters` removed
- Manual: knowledge view — verify tab + filter + card rendering — covers AC: filter bar migration
- Manual: run-log view — verify stage badges and run-event cards render with correct severity colours — covers AC: token-driven colours
- Manual: orchestrator view — verify health badges and stale banner — covers AC: `UI.badge` and `UI.banner`
- Manual: dark-mode toggle — cycle through all views after toggling theme — covers AC: no dark-mode visual regressions
- Manual: browser console — check for zero new JavaScript errors after full navigation — covers AC: no JS errors

## Documentation Updates

- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — add a new top-level section documenting the `UI` namespace (`components.js`): list every public function (`UI.badge`, `UI.banner`, `UI.emptyState`, `UI.card`, `UI.filterBar`) with their signatures, parameter descriptions, and usage examples. Update existing badge/card/banner/filter-bar sections to reference the `UI.*` helpers as the preferred API. Add the new semantic token properties (`--color-badge-{status}-bg/fg`, `--color-banner-{type}-bg/fg`) to the CSS Custom Properties table (§1).
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — add entry for `gui/public/components.js`
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — add `components.js` to the client-side JS section with the `UI` namespace public API
- No changelog entry required at plan time (will be written during release preparation)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Visual regression in dark mode** after token consolidation | Phase 2 is purely cosmetic CSS refactoring with no behaviour change. Manual verification in both themes before committing. Extract exact hex values from current rules and assert token values match. |
| **Broken event binding** after filter bar migration | `UI.filterBar` returns an explicit `bind()` function that each view calls after inserting HTML. Verify each view's filter interaction individually before moving to the next. |
| **`statusBadge()` callers produce different HTML** after delegation to `UI.badge()` | The implementation normalisation (lowercase, replace `_` with `-`) already matches the current `statusBadge()` logic exactly. No behaviour change by design. |
| **Load-order dependency** — `components.js` must be available before views | Script tag is placed after `utils.js` and before all view scripts in `index.html`, matching the existing dependency convention. |
| **Scope creep into page-header or tabs** | Explicitly out of scope. Phase 3 stops at card + filter bar. |

AGENT: Planning
STATUS: READY_FOR_PM
