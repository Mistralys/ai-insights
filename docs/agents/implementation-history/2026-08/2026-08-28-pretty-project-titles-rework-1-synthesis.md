## Synthesis

### Completion Status
- Date: 2026-09-07
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-09-07

### Outcome Summary

Closed the resilience, validation, and test-hygiene gaps flagged in the prior `pretty-project-titles` synthesis and directly targeted by the Copilot PR review. `title` now follows the exact dual-path storage pattern already used by `project_summary` — it is written into the root index first and auto-synced to `.meta.json`, surviving a non-fatal enrichment failure instead of depending on it. Both `title` and `project_summary` input schemas now trim whitespace before the `min(1)` check, closing the whitespace-only-string gap Copilot called out. The schema-mirror anti-pattern Copilot flagged in `meta-enrichment.test.ts` (and its sibling in `standalone-import.test.ts`) was replaced with assertions against the real exported schemas.

### Implementation Summary
- Added `title` to `RootIndexSchema` and threaded it through `initializeProject()` and `importStandaloneProject()`, mirroring `project_summary`'s spread-then-auto-sync pattern; `writeRootIndex()`'s `.meta.json` auto-sync now propagates `title` as well.
- Removed the standalone `updateTitle()` call and its ordering-constraint comment from `importStandaloneProject()` — the root-index write now covers `.meta.json` propagation in one step.
- Added `.trim()` ahead of `.min(1)` on `title` and `project_summary` in both `InitializeProjectSchema` and `ImportStandaloneSchema`, rejecting whitespace-only input at the schema boundary.
- Exported `ImportStandaloneSchema` from `standalone-import.ts` (mirroring the already-exported `InitializeProjectSchema`) so tests can assert against the real tool contract instead of an inline mirror.
- Fixed the schema-mirror tests Copilot's review pointed at directly in `meta-enrichment.test.ts` (title) and `standalone-import.test.ts` (title and `project_summary`), and added whitespace-only rejection tests alongside them.
- Added root-index persistence/omission tests for `title` in both `project-lifecycle.test.ts` and `standalone-import.test.ts`, plus a resilience test proving `title` survives a forced failure of the `.meta.json` enrichment write.

### Documentation Updates
- `AGENTS.md` (root) — updated the `project_summary` and `title` cross-system dependency rows: both now document `.trim()` validation, and the `title` row reflects its new root-index storage path and the removal of the standalone-import `updateTitle()` ordering constraint.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — updated `ledger_initialize_project` and `ledger_import_standalone` signatures/prose and the `RootIndex`/`ImportStandaloneDetail` type listings to reflect `.trim()` and the root-index storage path for `title`.
- `mcp-server/docs/agents/project-manifest/constraints-storage.md` — extended the Dual-Schema Pattern's "second instance" note to cover `title`'s trim constraint and its new `RootIndexSchema` membership; follow-up on 2026-09-07 added a dedicated "Nullable/non-nullable pairing gotcha" note per the Code Insights entry below.
- `mcp-server/src/tools/help-content.ts` — replaced the stale "whitespace-only strings pass" caveat (now false after adding `.trim()`) with an accurate note in both the `ledger_initialize_project` and `ledger_import_standalone` help sections.
- `CLAUDE.md` (root) — not hand-edited; it is auto-generated from `AGENTS.md` via `node scripts/cli.js ctx-generate` and will pick up this change on the next regeneration, per existing project convention.

### Verification Summary
- Tests run: full `mcp-server` Vitest suite (`npx vitest run`), including the modified `project-lifecycle.test.ts`, `standalone-import.test.ts`, and `meta-enrichment.test.ts` files
- Static analysis run: `npx tsc --noEmit` (mcp-server has no separate ESLint script; TypeScript strict compilation is its static analysis gate)
- Result: PASS — all tests green, no type errors

### Code Insights
- [medium] (improvement) mcp-server/src/storage/ledger-store.ts `writeRootIndex()`: `RootIndexSchema.title` is nullable (mirroring `project_summary`'s shape per the plan), but `MetaCacheUpdates.title` is intentionally non-nullable (documented as having "no clear title use case"). This created a real type mismatch, resolved by coalescing a theoretical `null` to `undefined` at the auto-sync call site. No code path currently writes `title: null`, so this is a type-safety guard rather than an active bug — worth a one-line mention in `constraints-storage.md` if a future field repeats this nullable/non-nullable pairing. **Addressed 2026-09-07:** added as a one-line gotcha note to the Dual-Schema Pattern section.
- [low] (convention) mcp-server/tests/tools/meta-enrichment.test.ts: The plan called for new `title` integration tests in `project-lifecycle.test.ts`, but a `title parameter — initializeProject stores title in .meta.json` describe block already existed in `meta-enrichment.test.ts` with the exact schema-mirror anti-pattern Copilot's review named by file and line. Rather than adding a second, differently-shaped `title` test suite, the existing block was fixed in place; `project-lifecycle.test.ts` was scoped to the root-index and resilience coverage that was genuinely missing, avoiding duplicate low-value assertions across two files.
- [low] (convention) mcp-server/src/storage/ledger-store.ts `updateTitle()`: now reachable only from the GUI rename flow (`handleRenameProject`). No other code references its former `importStandaloneProject` ordering constraint, but this is worth a quick grep if `updateTitle()`'s contract changes again.

### Additional Comments
- The deferred items from the plan (`CONTRIBUTING.md` cacheable-field-semantics section, GUI end-to-end round-trip test, extending the pattern to `tags`/`category`) remain deferred — no new information surfaced during implementation that would change that prioritization.
- Persona source files (`ledger-bootstrapper.md`, `standalone-archiver.md`, `title-crafting-guide.md`) were left untouched per the plan's explicit exclusion; they already instruct agents to pass `title`, and nothing in this rework changes the tool-call contract those personas rely on.
