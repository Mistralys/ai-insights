# Synthesis: Tasks List

### Outcome Summary

Task management was added to the AI Insights Ledger across all 19 work packages: a per-store task file merged into one global collection, six ledger_*_task MCP tools, a Tasks GUI tab with inline editing, keyboard navigation, reordering and a colour palette with colour filter, and a Configuration Tasks tab for ticket link settings. A new Ledger Task Curator persona was created and wired into the Synthesis, Claude Coordinator and Standalone Developer personas so finished work closes matching tasks. All work packages passed every pipeline stage; the only test failures are five Windows-flaky mcp-server tests identical to the baseline, and the manual browser smoke test of the visual changes was dropped from the workflow and remains unverified.

### Metrics

- Work packages: 19 of 19 COMPLETE, 19 of 19 with all active stages PASS (0 missing stages).
- Final exit gate (WP-019 QA): mcp-server `npm test` 4824 passed, 5 failed (all pre-existing, identical to baseline); root `npm test` 480/480; `pytest tests/test_subagents.py` 23 passed; `ruff check src/` clean; `tsc --noEmit` clean; `node scripts/build-personas.js --check` exit 0.
- New test files: task schema and ticket reference (21), task-store (9), task-collection (22), tasks tools and help (45 with registry), GUI API and routes, tasks-model/palette-pin/parity (69), tasks-render (26), tasks-view (32 at WP-013, extended by WP-014), config-tasks view, styles-tokens (40), safe-markdown (7).
- Security: 8 security-audit stages (WP-001, 002, 005, 006, 009, 011, 012), 0 Critical/High/Medium findings, 0 issues in all metrics.
- Code review: 0 blocking issues across all WPs; 1 reviewer-applied fix-forward (WP-012 JSDoc).
- Rework: one cycle only, WP-015 (QA FAIL on a hard-pinned `config.js?v=6` assertion; fixed by loosening to a regex, then PASS).
- Versions: root 2.17.0 WIP, mcp-server 2.14.0 WIP, personas 3.40.0 WIP; Synthesis/coordinator/developer persona YAML changelogs 3.16.0 / 3.5.0 / 1.21.0.
- Coverage percentages were not recorded by any stage.

#### Failed or Open Metrics

- 5 mcp-server test failures remain, all pre-existing and Windows-environment related: `api-models` AC-13 (EBUSY on temp-dir removal), `repository-context` (x3), `standalone-import` (EPERM). The baseline was taken only on these three files, not the whole suite (partial baseline).
- Visual and browser checks were never run (see Deferred items).

### Strategic Recommendations

- Single storage layer, two consumers: `task-collection.ts` serves both MCP tools and the GUI REST API, avoiding the duplicated multi-store iteration seen in knowledge code. Reuse this pattern for future per-store domains.
- Never overwrite unreadable user-synced files: `mutateTaskFile` reports an invalid file (for example Git conflict markers) and refuses to write, rather than starting from empty. Worth applying to other store-resident JSON files.
- Server-computed derived fields (`ticket_label`, `ticket_url`) and colours stored as palette ids keep the ES5 frontend thin and let theme re-tunes avoid data migrations.
- Parity tests pin duplicated client/server logic (`TasksModel` vs `compareTasks`/`matchesFilters`/`normaliseTag`/`colorKey`, palette ids vs CSS tokens). Search semantics differ on purpose (AND client-side, OR server-side).
- Popover that re-renders itself needs two independent outside-click guards (stopPropagation and detached-target check); recorded as a GUI constraint (section 29).
- Persona design: one Task Curator with two modes; the Coordinator `Archive Dispatch` section generalises two sub-agents under shared rules (reviewer gold nugget).
- Process lesson from the Ledger Doctor repair: a workflow acceptance criterion must not depend on tooling absent from the environment (WP-007 stalled with 5/5 stages PASS on a browser-only AC, starving WP-008 and WP-015).

### Code Insights

**Developer**
- WP-004: `task-collection.ts` imports `getTaskSettings` from `gui/config.ts`, an inverted dependency (storage depending on GUI). Documented, worth revisiting.
- WP-004: `createTask` computes max+1 priority from a separate load, so cross-process concurrent creates can share a priority; the `compareTasks` tie-breaker keeps order deterministic.
- WP-004: A store unreadable at load time is invisible to reorder, so its ids raise `TaskNotFoundError`; `failed[]` covers write-time failures only.
- WP-013: Drops on a page with tied priorities cannot separate ties (`reassignSubset` limitation); a failed refetch after a failed reorder is silent.
- WP-006: Store-file errors are rewritten to a path-free message because `TaskFileInvalidError` embeds an absolute path.
- WP-012: `.btn-icon` is defined three times in `styles.css`; Tasks styles scope their own `.badge-store`, `kbd`, `.visually-hidden` under `.tasks-view`.
- WP-015: The General config tab has the same stale-config-after-save issue that the Tasks tab fixed by mutating the config object in place.
- WP-007/WP-008: Component inputs (`.filter-bar input`, `.orch-plan-input`) still use `--color-border` instead of `--color-border-strong`.
- WP-006/WP-015: Tests pin cache-buster `?v=` literals (`config-error-codes.js?v=3`, `api-client.js?v=8`), so bumps break tests; WP-008 and WP-015 loosened two to regexes.

**QA**
- WP-005: `store_id: ''` on list/search is forwarded unchanged to the collection (benign, untested); add maps it to undefined.
- WP-003: No test for a mutator producing a schema-invalid file (ZodError path) or lock-dir creation when the store root is missing.
- WP-009: No tests for obfuscated schemes (`java\tscript:`, entity-encoded) or `mailto` links.
- WP-011/WP-012: `.task-id`, `.task-source`, `.swatch`, `.chip-dot` CSS was flagged missing after WP-011; later GUI WPs supplied it.
- WP-014: jsdom has no layout, so the viewport-bottom palette flip is covered only by `paletteMove`/`palettePosition` unit tests.
- WP-016: Task Management mode has no fixed `completion_source` format; no automated test covers persona sources.
- WP-018: No automated check that numbered-step cross-references in persona prose stay in sync after renumbering.
- WP-001: `ticketUrl` has no slash handling; the base URL must end with its separator (documented).

**Security Auditor**
- WP-001: `ticketUrl` does not re-validate a stored reference; GUI must escape task text and use only http(s) hrefs.
- WP-012: Defence-in-depth hardening: add a client-side http(s) scheme check on the ticket link href in `tasks-render.js` (as `SafeMarkdown.isAllowedHref` does).

**Reviewer**
- WP-006: `handleReorderTasks` classifies failures via `message.startsWith`; prefer a typed reason.
- WP-007: Reduced-motion guard is global (all animations), changing every view; the global input border rule may be overridden by later component rules at equal specificity.
- WP-015: Validation constants in `config-tasks.js` duplicate server schema rules and must be kept in sync with `src/gui/config.ts`.
- WP-016: Report Template reads as Synthesis Reconciliation oriented (Plan field); Task Management reports may omit it.

**Release Engineer**
- Changelog Curator repeatedly declined to write without user approval; the Release Engineer applied its drafts. File-path and long CLI bullets are candidates for a Rewrite session.
- WP-001: Untagged v2.16.0 sits above the last tag 2.15.0, so a new WIP v2.17.0 was opened above it; the user may want to merge entries.

**Documentation**
- Several stale doc items recorded: `api-surface.md` GuiConfig block omits `capture_dialogues` and lists `max_handoff_depth` default 50 (code: 100); `constraints.md` TOC omits sections 25 to 27 and section 25 prose still names "Stores, Error Codes" as always-reset tabs; `config.js` descriptor-count wording; GUI `file-tree.md` File Sizes table lacks rows for `api-tasks.ts`, `tasks-model.js`; `tech-stack.md` script load order lacks the tasks scripts; `workflow-and-ledger.md` Synthesis bullet omits task reconciliation.

### Deferred & Follow-Up Items

**Deferred**
- Manual visual smoke test (project-level, Project Manager; high). Cross-view check of Projects, Knowledge and Configuration plus Tasks on port 3460, both themes, 1280 and 375 px was removed from WP-007 AC 6 and WP-019 AC 4 by a Ledger Doctor repair and never verified. WP-007 AC 3 (nav does not wrap at 375 px) is only verified by CSS string pins. To be done by a human.
- Release finalization (WP-001/WP-019, Release Engineer; medium). WIP markers on root 2.17.0, mcp-server 2.14.0 and personas 3.40.0 need finalizing, tagging and publishing by the user; resolve the untagged v2.16.0 versus 2.17.0 ordering. Persona deployment (`sync-personas.js`) is a user decision.
- Persona wording warnings (WP-016/WP-019, QA/Reviewer; low). `ledger-task-curator.md` Operating Philosophy lines 14 and 17 emit imperative-phrasing build warnings; rephrase as claims. Optionally state that the Plan field may be omitted in Task Management reports and recommend a `completion_source` prefix.
- Dark-theme contrast for slate, brown and indigo task colours (WP-014 plan Out of Scope; low).
- Colourless sorting and a colour picker in the create draft (WP-014 Out of Scope).
- Migrating the dialogue view to `SafeMarkdown` (WP-009 out of scope; low).
- Client-side http(s) check on ticket link href (WP-012 Security, hardening; low).
- Announce failed refetch after a failed reorder; tied-priority drop limitation (WP-013; low).
- Add tests: schema-invalid mutator and lock-dir creation (WP-003), `store_id: ''` on list/search (WP-005), obfuscated link schemes (WP-009).
- Doc staleness items listed under Documentation above (low).

**Out-of-scope / pre-existing**
- Five Windows-flaky mcp-server tests (`api-models` AC-13 EBUSY should use `rm` with `maxRetries`; `repository-context` x3; `standalone-import` EPERM) fail at baseline; need a separate fix.
- ESLint v9 has no flat config in `mcp-server` (still `.eslintrc`), so lint could not run (WP-002).
- Inverted dependency `storage` to `gui/config` (WP-004; medium architecture note).
- Harness friction: `mcp-server/node_modules` junctioned without `.bin` shims in the baseline worktree, so `npm run build`/`npx tsc` fail there (WP-019).

### Next Steps

1. A human runs the dropped visual smoke test on port 3460 (both themes, 1280 and 375 px) covering Tasks, Projects, Knowledge and Configuration.
2. Finalize release entries (root 2.17.0, mcp-server 2.14.0, personas 3.40.0), tag and publish; decide on persona deployment.
3. Plan a small hardening and cleanup cycle: stabilise the five Windows-flaky tests, move `getTaskSettings` out of the storage import path, add the listed missing tests, rephrase the Task Curator philosophy lines, and apply the documentation staleness fixes.
4. Consider promoting the "no tooling-dependent acceptance criteria" policy into planning guidance so browser-only ACs are not generated for environments without a browser.
