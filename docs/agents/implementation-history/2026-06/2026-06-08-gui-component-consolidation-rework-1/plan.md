# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context
The immediately preceding project `2026-06-08-gui-component-consolidation` delivered a full UI component consolidation: 5 `UI.*` render functions, 66 CSS custom-property tokens, 13 card fragments and 3 filter bars unified. Its synthesis identified a vitest setup file as the single highest-leverage follow-up, plus 10 deferred/cleanup items. This rework plan addresses all actionable and deferred items from that synthesis.

## Summary
Address every actionable item and deferred item from the GUI Component Consolidation synthesis: create a shared vitest GUI setup file to eliminate repeated `components.js` loading boilerplate; extend `UI.badge()` with an optional `attrs` parameter; harden `_normaliseType()`; tokenise the remaining hardcoded dark-mode CSS (`.run-stage-badge--*`, `.reset-modal-banner`); clean up dead CSS classes and redundant properties; migrate `showError()` to `UI.banner()`; and close documentation gaps.

## Architectural Context

### Existing GUI test infrastructure
- `mcp-server/vitest.config.ts` — Global vitest config for the MCP server; currently has no `setupFiles` entry.
- `mcp-server/tests/gui/README.md` — Documents the script loading pattern (`readFileSync` + `vm.runInThisContext`) but each test file still does it individually.
- 8 test files currently contain their own `vm.runInThisContext(componentsJs)` call.

### UI namespace (`mcp-server/gui/public/components.js`)
- IIFE exposing `UI.badge`, `UI.banner`, `UI.emptyState`, `UI.card`, `UI.filterBar`.
- `badge(type, label)` — no support for extra HTML attributes.
- `_normaliseType(type)` — returns CSS slug; has an existing falsy guard (`if (!type) return '';`); no HTML-escape (documented warning only).

### CSS architecture
- 66 semantic tokens already defined for badge and banner variants in `:root` / `[data-theme="dark"]`.
- `.run-stage-badge--active/done/error` still use hardcoded hex values with parallel `[data-theme="dark"]` override blocks.
- `.reset-modal-banner` uses hardcoded `#fef3c7`/`#92400e` (light) and `#451a03`/`#fbbf24` (dark).
- `.orchestrator-status-card` duplicates `.card` base properties (`background`, `border`, `border-radius`).
- `form-control-sm` referenced in `knowledge.js` but has no CSS definition.

### `showError()` in `utils.js`
- Line 153: emits `<div class="error-banner">…</div>`.
- `UI.banner('error', msg)` emits `<p class="error-banner">…</p>`.
- The element tag change (`<div>` → `<p>`) is the reason this was deferred.

## Approach / Architecture

The work is grouped into 5 coherent work packages:

1. **WP-1: Vitest GUI setup file** — Create a shared setup file that loads `utils.js` and `components.js` into the jsdom global, then remove the duplicated loading from all 8 test files.

2. **WP-2: `UI.badge()` enhancements** — Add an optional third `opts` parameter supporting `attrs` (extra HTML attributes like `title`) and harden `_normaliseType()` with a falsy guard + `escapeHtml()` wrapping. Migrate the `run-log.js` inline cross-WP badge to use the new API.

3. **WP-3: CSS tokenisation — `.run-stage-badge--*` and `.reset-modal-banner`** — Define new `--color-run-stage-*` and `--color-banner-warn-*` tokens; replace hardcoded hex values and remove parallel dark-mode override blocks.

4. **WP-4: CSS/JS cleanup** — Remove `.orchestrator-status-card` redundant properties; remove dead `form-control-sm` references; consolidate scattered badge rule sections (structural only); add inline comment documenting banner token asymmetry.

5. **WP-5: `showError()` migration + documentation** — Migrate `showError()` from inline `<div>` to `UI.banner()` (accepting the `<div>` → `<p>` element change as an explicit AC); update `tests/gui/README.md` with remaining patterns.

## Rationale
- The vitest setup file is the highest-leverage change: it eliminates an entire class of regression that caused 3 rework cycles in the original project.
- `UI.badge()` opts extension follows the same `opts` pattern already established by `UI.card()` and `UI.filterBar()`, ensuring API consistency.
- CSS tokenisation follows the exact mechanical process proven in WP-004/WP-005 of the original project.
- Cleanup items are batched into a single WP to avoid overhead from tiny individual work packages.
- `showError()` migration is last because it introduces a DOM element change that must be tested carefully.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Vitest setup approach | `setupFiles` in project config with environment-aware guard | `globalSetup` (runs once before all suites) | `setupFiles` runs per-file and respects `@vitest-environment jsdom` — essential since only GUI tests need the DOM globals. `globalSetup` runs in Node context only. |
| `UI.badge()` attrs | Optional `opts` object (3rd param) with `attrs` record | Dedicated `title` parameter | `opts` is extensible (can add `dataAttrs`, `class` etc. later) without breaking the signature. Matches the `UI.card()` precedent. |
| `.reset-modal-banner` token naming | `--color-banner-warn-*` (new variant) | Reuse `--color-banner-stale-*` | Foreground colours differ (`#92400e` vs `#78350f`); reusing would silently change the banner's appearance. A dedicated `warn` variant preserves visual fidelity. |
| `showError()` element change | Accept `<p>` tag (via `UI.banner()`) | Keep `<div>` wrapper with custom `UI.errorBanner()` | Introducing a 6th UI function solely to preserve a `<div>` tag is unjustified. `<p>` is semantically correct for a single-message banner. Tests asserting on `.error-banner` class will still pass. |

## Pattern Alignment
- `mcp-server/vitest.config.ts` — Adding `setupFiles` follows standard Vitest config patterns; no departure.
- `mcp-server/gui/public/components.js` — `opts` parameter pattern follows `UI.card()` and `UI.filterBar()` precedent exactly.
- `mcp-server/gui/public/styles.css` — `:root` / `[data-theme="dark"]` token block pattern follows WP-004/WP-005 established convention.
- `mcp-server/tests/gui/README.md` — Already documents the loading pattern; we enhance rather than replace.

## Detailed Steps

### WP-1: Vitest GUI Setup File (High Priority)

1. Create `mcp-server/tests/gui/setup-gui-globals.ts` — reads `utils.js` and `components.js` via `readFileSync`, executes via `vm.runInThisContext`, and assigns minimal required stubs (`showLoading`, `showError`, `Router`, `localStorage`) to `globalThis`.
2. Add a `test.setupFiles` entry to `mcp-server/vitest.config.ts` that applies only to `tests/gui/**` files using a workspace-level project or vitest workspace config — OR use a conditional inside the setup file that checks for the jsdom environment.
3. Remove the duplicated `readFileSync(componentsJs)` + `vm.runInThisContext(componentsJs)` from all 8 test files: `project-list.test.ts`, `orchestrator-view.test.ts`, `project-detail-runs.test.ts`, `dialogue-qa.test.ts`, `client-rendering.test.ts`, `insights-knowledge-links.test.ts`, `run-log.test.ts`, `orchestrator-widgets.test.ts`.
4. Remove duplicated `readFileSync(utilsJs)` + `vm.runInThisContext(utilsJs)` from the same files where it is also loaded in the setup. Also remove the `utilsJs` loading from `router-utils.test.ts` (which loads `utilsJs` but not `componentsJs`) to prevent double-loading via the setup file.
5. Keep per-file loading of view-specific scripts (e.g., `projectListJs`, `orchestratorWidgetsJs`) — only the shared globals move to the setup file.
6. Run the full GUI test suite (`npx vitest run tests/gui/`) to confirm 3,095 tests still pass.

### WP-2: `UI.badge()` Enhancements

7. Add an optional third parameter `opts` to `UI.badge()` in `components.js`:
   - `opts.attrs`: a plain object `{ attrName: attrValue }` rendered as extra HTML attributes on the `<span>`.
   - All attribute values are HTML-escaped via `escapeHtml()`.
8. Harden `_normaliseType()`:
   - Add an early return of `''` if `type` is falsy (already present — verify).
   - Wrap the return value with `escapeHtml()` before interpolation into the `class` attribute in `badge()`.
9. Migrate the inline cross-WP badge in `run-log.js` (line ~271) to use `UI.badge('fail', '⚠ cross-WP: ' + toolWpId, { attrs: { title: 'Tool targeted ' + toolWpId + ' but stage is running ' + stageWpId } })`. Note: do NOT wrap `toolWpId` in `escapeHtml()` in the label — `badge()` internally escapes the label, so double-wrapping would produce double-encoded output.
10. Update `api-surface.md` with the new `opts` parameter signature.
11. Add a unit test in an appropriate GUI test file verifying `UI.badge()` renders extra attrs correctly.

### WP-3: CSS Tokenisation

12. Define 6 new `--color-run-stage-*` tokens in the `:root` block:
    - `--color-run-stage-active-bg: #fef3c7`
    - `--color-run-stage-active-fg: var(--color-in-progress)` (reuse existing semantic token)
    - `--color-run-stage-active-border: #fde68a`
    - `--color-run-stage-done-bg: #dcfce7`
    - `--color-run-stage-done-fg: var(--color-complete)`
    - `--color-run-stage-done-border: #bbf7d0`
    - `--color-run-stage-error-bg: #fee2e2`
    - `--color-run-stage-error-fg: var(--color-blocked)`
    - `--color-run-stage-error-border: #fecaca`
13. Define matching dark-theme overrides in the `[data-theme="dark"]` `:root` block:
    - `--color-run-stage-active-bg: #451a03`, `--color-run-stage-active-fg: #fbbf24`, `--color-run-stage-active-border: #92400e`
    - `--color-run-stage-done-bg: #14532d`, `--color-run-stage-done-fg: #86efac`, `--color-run-stage-done-border: #166534`
    - `--color-run-stage-error-bg: #450a0a`, `--color-run-stage-error-fg: #fca5a5`, `--color-run-stage-error-border: #7f1d1d`
14. Replace hardcoded values in `.run-stage-badge--active/done/error` with `var(--color-run-stage-*)` references.
15. Remove the `[data-theme="dark"] .run-stage-badge--active/done/error` override blocks (now handled by token reassignment).
16. Define 4 new `--color-banner-warn-*` tokens:
    - Light: `--color-banner-warn-bg: #fef3c7`, `--color-banner-warn-fg: #92400e`, `--color-banner-warn-border: #f59e0b`
    - Dark: `--color-banner-warn-bg: #451a03`, `--color-banner-warn-fg: #fbbf24`, `--color-banner-warn-border: #92400e`
17. Replace hardcoded values in `.reset-modal-banner` with `var(--color-banner-warn-*)` and add `border` if appropriate.
18. Remove the `[data-theme="dark"] .reset-modal-banner` override block.
19. Run the full test suite to confirm no visual regressions in test assertions.

### WP-4: CSS/JS Cleanup

20. In `.orchestrator-status-card` CSS: remove `background`, `border`, and `border-radius` properties (inherited from `.card` via `extraClass`). Keep `padding`, `margin-bottom`, and `box-shadow: none` as overrides. Also remove the `[data-theme="dark"] .orchestrator-status-card` override block (~line 2600) which overrides those same now-removed properties — after this step its values are inherited from `.card` with theme-aware custom properties, making it dead CSS.
21. In `knowledge.js`: remove `form-control-sm` from all 4 references — the 3 `cssClass` strings in `buildKnFilters()` (lines ~89, ~92, ~93) and the "move to repository" `<input>` class (line ~186). Leave `form-control` intact.
22. Consolidate the 4 scattered badge rule sections in `styles.css` (~lines 277, 1831, 2082, 2484) into a single badge section. This is a structural move — no property changes.
23. Add an inline comment in the banner token block header explaining the `error`/`success` foreground asymmetry (they reuse semantic `--color-blocked`/`--color-complete` instead of dedicated `-fg` tokens).
24. Run the full test suite.

### WP-5: `showError()` Migration + Documentation

25. In `utils.js` line 153: replace the inline `<div class="error-banner">` construction with a call to `UI.banner('error', message)`.
26. Update any tests that assert the `<div>` tag in error banner output to expect `<p>` instead.
27. Verify `.error-banner` CSS rules target the element by class (tag-agnostic) — no CSS changes expected.
28. Update `tests/gui/README.md` to note that `showError()` now delegates to `UI.banner()`.
29. Run the full test suite.

## Dependencies
- WP-2 depends on WP-1 (the test for `UI.badge()` opts will benefit from the shared setup file).
- WP-3, WP-4, and WP-5 are independent of each other but should follow WP-1.
- WP-5 has no dependency on WP-2 or WP-3.

## Required Components
- `mcp-server/tests/gui/setup-gui-globals.ts` (new file)
- `mcp-server/vitest.config.ts` (modified — add setupFiles for gui tests)
- `mcp-server/gui/public/components.js` (modified — badge opts, _normaliseType hardening)
- `mcp-server/gui/public/utils.js` (modified — showError migration)
- `mcp-server/gui/public/styles.css` (modified — tokens, consolidation, cleanup)
- `mcp-server/gui/public/views/run-log.js` (modified — badge migration)
- `mcp-server/gui/public/views/knowledge.js` (modified — remove form-control-sm)
- `mcp-server/tests/gui/project-list.test.ts` (modified — remove setup boilerplate)
- `mcp-server/tests/gui/orchestrator-view.test.ts` (modified)
- `mcp-server/tests/gui/project-detail-runs.test.ts` (modified)
- `mcp-server/tests/gui/dialogue-qa.test.ts` (modified)
- `mcp-server/tests/gui/client-rendering.test.ts` (modified)
- `mcp-server/tests/gui/insights-knowledge-links.test.ts` (modified)
- `mcp-server/tests/gui/run-log.test.ts` (modified)
- `mcp-server/tests/gui/orchestrator-widgets.test.ts` (modified)
- `mcp-server/tests/gui/router-utils.test.ts` (modified — remove utilsJs loading)
- `mcp-server/tests/gui/README.md` (modified — document setup file, showError delegation)
- `mcp-server/docs/agents/project-manifest/api-surface.md` (modified — badge opts signature)
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` (modified — new tokens, badge opts)

## Assumptions
- The vitest `setupFiles` approach works correctly with per-file `@vitest-environment jsdom` annotations (vitest documentation confirms this).
- `.orchestrator-status-card` is always used with `extraClass` on `UI.card()`, so base `.card` properties are inherited. (Verified: `orchestrator-widgets.js` passes `extraClass: 'orchestrator-status-card'`.)
- No external consumers depend on `showError()` emitting a `<div>` — all consumers are internal GUI views.
- The `form-control-sm` class is not defined anywhere (confirmed: no CSS definition found).

## Constraints
- The setup file must NOT load view-specific scripts — only shared globals (`utils.js`, `components.js`). View scripts are test-specific.
- The `UI.badge()` `opts.attrs` values must always be HTML-escaped to prevent XSS.
- The CSS badge section consolidation (step 22) must not change any property values or selector specificity.
- The `showError()` element change (`<div>` → `<p>`) must be listed as an explicit acceptance criterion, not done silently.

## Out of Scope
- Adding a pre-commit lint step for `Depends on` file header comments (Strategic Rec #4 — requires broader discussion).
- Adding `UI.badge()` user-input validation beyond the escaping hardening (no current call site accepts user input).
- Migrating `run-log.js` `tool_call_start`/`tool_call_end` badges (not mentioned in synthesis).
- Theme colour design decisions beyond using the exact values already present.

## Acceptance Criteria
- AC-1: A single vitest setup file loads `utils.js` and `components.js` for all GUI tests; no individual test file contains `vm.runInThisContext(componentsJs)`.
- AC-2: `UI.badge('fail', 'text', { attrs: { title: 'tooltip' } })` renders `<span class="badge badge-fail" title="tooltip">text</span>`.
- AC-3: `UI.badge(null, 'text')` returns a badge with empty type class (`badge badge-`) without throwing.
- AC-4: `_normaliseType()` return value is HTML-escaped before interpolation into the class attribute.
- AC-5: `.run-stage-badge--active/done/error` use CSS custom-property tokens; no `[data-theme="dark"] .run-stage-badge--*` override blocks exist.
- AC-6: `.reset-modal-banner` uses `--color-banner-warn-*` tokens; no `[data-theme="dark"] .reset-modal-banner` override block exists.
- AC-7: `.orchestrator-status-card` does not declare `background`, `border`, or `border-radius`; no `[data-theme="dark"] .orchestrator-status-card` block exists.
- AC-8: No reference to `form-control-sm` exists anywhere in `knowledge.js`.
- AC-9: `showError()` calls `UI.banner('error', message)` — emits `<p class="error-banner">…</p>`.
- AC-10: Full test suite passes (3,095+ tests, 0 failures).
- AC-11: Banner token block contains an inline comment explaining the error/success foreground asymmetry.

## Testing Strategy
All changes are verified by the existing comprehensive GUI test suite (3,095 tests). The setup file change is the most critical — it must be validated by running ALL gui tests after removing per-file loading. New tests are added only for the `UI.badge()` opts extension.

## Test Plan

- `mcp-server/tests/gui/setup-gui-globals.ts` (setup file) — Implicitly tested by all 3,095 existing tests passing after removal of per-file loading — AC-1, AC-10
- New assertion in `mcp-server/tests/gui/client-rendering.test.ts` (or a new `components.test.ts`) — `UI.badge()` renders extra `attrs` as HTML attributes — AC-2
- New assertion — `UI.badge(null, 'x')` does not throw — AC-3
- New assertion — `UI.badge('<script>', 'x')` does not contain unescaped `<script>` in class attribute — AC-4
- Existing `run-log.test.ts` — cross-WP badge still renders correctly after migration — AC-2
- Existing GUI tests — `.run-stage-badge--*` visual test assertions remain green — AC-5
- Existing GUI tests — `.reset-modal-banner` rendering assertions remain green — AC-6
- Existing `orchestrator-widgets.test.ts` — card rendering unchanged — AC-7
- Existing `insights-knowledge-links.test.ts` or `knowledge` tests — filter rendering — AC-8
- Existing tests asserting `showError()` output — updated to expect `<p>` tag — AC-9

## Documentation Updates
- `mcp-server/tests/gui/README.md` — Add "Setup File" section explaining the shared `setup-gui-globals.ts`; update the "Script Loading Order" section to reference it; document `showError()` → `UI.banner()` delegation.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Update `UI.badge()` signature to include `opts` parameter.
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — Add `--color-run-stage-*` token table; add `--color-banner-warn-*` token table; update badge API section.
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — Note that `showError()` now delegates to `UI.banner()`.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Setup file loads globals that conflict with test-local stubs** | Setup file only loads `utils.js` + `components.js`. Per-test stubs (e.g., `Router`, `API`) override afterward in `beforeAll`. Test files retain their own `beforeAll` for view-specific scripts and stubs. |
| **Badge section consolidation changes specificity** | Move rules without changing selector order within the cascade; verify with full test run; CSS has no `@layer` usage that could be affected. |
| **`showError()` `<p>` tag breaks consumer assumptions** | Only 1 consumer exists (`utils.js` itself). Test assertions updated explicitly. CSS targets `.error-banner` class, not element tag. |
| **`_normaliseType()` escaping changes output for valid types** | Valid type strings (e.g., `in-progress`) contain no HTML special characters. `escapeHtml()` is a no-op for them. Only adversarial input changes. |
| **`form-control-sm` removal breaks visual styling** | Confirmed: no CSS definition exists for this class. It is a no-op. Removal is safe. |
