# Synthesis Report — Improved Dialogue Render

**Plan:** `2026-07-13-improved-dialogue-render`
**Date:** 2026-07-13
**Status:** COMPLETE
**Work Packages:** 3 / 3 COMPLETE

---

## Executive Summary

This project introduced `renderChunksToDialogue()` — a new pure TypeScript function in `mcp-server/gui/chunk-renderer.ts` — that replaces the verbose, JSON-heavy `renderChunksToMarkdown()` format with a clean, chat-like dialogue view for the GUI's WP chunk panel. The two active `/rendered` HTTP endpoints in `server.ts` were switched to use the new renderer, making the improved experience immediately live. Both the existing verbose renderer (`renderChunksToMarkdown`) and all prior tests were preserved without regression. The implementation was clean and zero-breaking across all 15 acceptance criteria, verified through implementation, QA, code review, and documentation pipelines.

---

## Metrics

| Metric | Value |
|---|---|
| Work packages | 3 of 3 COMPLETE |
| Pipeline stages completed | 9 (WP-001: 4, WP-002: 4, WP-003: 1) |
| Acceptance criteria | 24 of 24 met |
| Chunk-renderer test suite | 77 / 77 PASS (100%) |
| Full GUI test suite | 1,407 / 1,408 PASS |
| TypeScript build (`tsc --noEmit`) | Clean — 0 errors |
| QA edge-case scenarios | 9 scenarios, 16 assertions — all PASS |
| Pre-existing failures (unrelated) | 1 (`run-log-server.test.ts` — 200 vs 404 for missing `.meta.json`) |
| Blocking issues found | 0 |
| Documentation-forward items resolved | 2 (both resolved in documentation pipeline) |

---

## What Was Built

### WP-001 — `renderChunksToDialogue` Core Renderer

A new exported function and private helper infrastructure added to `mcp-server/gui/chunk-renderer.ts`:

- **Three-pass design:** (1) index pass builds `toolCallId → toolName` and `toolCallId → result` maps; (2) render pass iterates accumulated messages per namespace; (3) emit returns assembled Markdown with no document header, role headings, or JSON blocks.
- **Per-tool rendering families:**
  - **File tools** (`edit_file`, `write_file`, `read_file`): `Tool call: \`name\`` + `↳ [filename](/path)`
  - **Execute:** abbreviated command in a `` ↳ `…` `` line; when a ToolMessage exists, last meaningful output line + ✓/✗ exit signal
  - **Task:** `↳ Sub-agent: **subagent_type**` + first result line
  - **write_todos:** compact checklist `- [x] / - [ ]`
  - **Ledger tools:** contextual `↳` summaries (mutation vs. query variants)
  - **Glob/grep/ls/unknown:** header only, no detail line
  - **ToolMessages:** entirely hidden (results consumed inline at call site)
- **Sub-agent namespace separation:** `### Subagent: …` headings
- **Multi-chunk token merging:** partial `input_json_delta` fragments correctly reassembled
- **Pure function guarantee:** no I/O, no side effects, no `mcp-server/src/` imports
- **Tests:** 77 tests covering all tool families, edge cases, multi-chunk merging, cross-namespace ToolMessage correlation, and full regression of `renderChunksToMarkdown`

### WP-002 — Server Integration

Both `/rendered` route handlers in `server.ts` updated to use `renderChunksToDialogue`:
- `GET /api/projects/:slug/chunks/:filename/rendered` (deprecated)
- `GET /api/projects/:repo/:slug/chunks/:filename/rendered` (active)
- `renderChunksToMarkdown` retained as an export for debugging and testing
- Response shape `{ content: string }` unchanged — no frontend breaking change

WP-001's implementation had already applied all three changes; WP-002 served as a formal verification pass.

### WP-003 — Project Manifest Documentation

All four project-manifest documentation files verified accurate (updated during WP-001's implementation):
- `mcp-server/docs/agents/project-manifest/api-surface.md` — `renderChunksToDialogue` entry with signature and format description
- `mcp-server/docs/agents/project-manifest/file-tree.md` — `chunk-renderer.ts` annotation listing both renderers
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — exports table + `/rendered` row updated
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — updated line count (~1000) and description

---

## Strategic Recommendations (Gold Nuggets)

### 1. Two-Pass Correlation Index Pattern
The `buildToolCallIndex` → `buildToolResultIndex` pattern cleanly enables cross-namespace ToolMessage correlation. A ToolMessage in a sub-agent namespace can correctly annotate a tool call in the main namespace. This is a reusable pattern for any future renderer that needs to correlate events across namespace boundaries.

### 2. Renderer Separation via Shared Accumulator
Sharing `accumulateChunks()` between `renderChunksToMarkdown` and `renderChunksToDialogue` while keeping the two renderers fully independent is an effective architecture. New rendering modes can be added with zero risk to existing renderers by following the same pattern: reuse the accumulation step, write a new render step.

### 3. Return-Shape Convention in Formatter Families
`formatWriteTodosDetail` intentionally returns raw Markdown list items (`- [x] content`) rather than `↳ …` strings, unlike all sibling formatters. This was documented with a `@remarks` JSDoc block explicitly naming the sibling functions — an effective way to prevent future contributors from incorrectly applying the wrong convention. The technique is worth repeating for any formatter that diverges from its family's return contract.

### 4. chunk-renderer.ts Module Size Threshold
The file now exceeds 1,000 lines. It remains a single pure-transformation module with no I/O or external dependencies, so splitting is not urgent, but a future refactor could separate accumulation logic (`accumulateChunks` and helpers) from the rendering functions into two co-located files if the module grows further.

### 5. Pre-existing Test Regression in `run-log-server.test.ts`
A pre-existing test failure exists (`GET /:repo/:slug/runs` returns 200 instead of 404 when `.meta.json` is missing). This was confirmed to predate this work entirely and was verified against the base `main` branch. It should be addressed in a dedicated WP to avoid it being confused with regressions in future plans.

---

## Deferred & Follow-Up Items

| # | Source | Agent | Description | Priority | Type |
|---|---|---|---|---|---|
| 1 | WP-001 implementation | Developer | `chunk-renderer.ts` exceeds 1,000 lines. Consider splitting accumulation logic (`accumulateChunks` and helpers) from rendering functions into two co-located files if the module grows further. | Low | **Deferred** — not urgently needed while the module remains pure and cohesive |
| 2 | WP-001 implementation | Developer | `mcp-server/docs/agents/project-manifest/api-surface.md` line 4628: an informational client-facing description in `getChunkRendered`'s `api-client.js` string still references `renderChunksToMarkdown` (low-impact, internal doc string). | Low | **Deferred** — cosmetic, no functional impact |
| 3 | WP-001 QA | QA | `extractExecuteResult` does not truncate long last-output lines. Extremely long single-line outputs (e.g. minified JSON) could produce very wide `↳` lines in rendered Markdown. | Low | **Deferred** — no AC requires truncation; safe for now |
| 4 | WP-001 QA | QA | `execute` ToolMessage with output but no `[Command succeeded/failed...]` footer defaults `success=true` and renders the last line with ✓. Worth documenting explicitly for future contributors. | Low | **Deferred** — current behaviour is safe; add inline doc comment |
| 5 | WP-001 code review | Reviewer | Edge case: a JSONL containing only ToolMessages (no AI messages) produces empty output rather than the `*No dialogue recorded.*` sentinel. Cosmetically surprising but not a real-world concern since chunk files always contain AI messages. | Low | **Out-of-scope** — real-world chunk files always have AI messages |
| 6 | WP-001 code review | Reviewer | `write_todos` with an empty `todos` array renders only the header with no checklist lines. A future enhancement could render a `(no todos)` note for clarity. | Low | **Deferred** — current behaviour is not a defect |
| 7 | WP-002 code review | Reviewer | `formatWriteTodosDetail` JSDoc `@remarks` block (added in documentation pipeline) — confirmed resolved ✅ | — | **Resolved** |
| 8 | Project-wide | All agents | Pre-existing test failure in `run-log-server.test.ts` (`GET /:repo/:slug/runs` — expected 404, received 200 for missing `.meta.json`). Confirmed pre-existing, unrelated to this plan. | Medium | **Deferred** — should be a dedicated WP to fix `.meta.json` 404 handling in the run-log route |

---

## Next Steps

1. **Fix pre-existing `run-log-server.test.ts` failure** (Item #8 above) — highest priority carry-forward. The `.meta.json` 404 handling in the run-log route is broken; it should be a small, isolated fix but merits a dedicated WP to ensure it is tracked and verified.

2. **Consider `execute` output truncation** (Item #3) — if the GUI dialogue panel receives chunk files with long single-line command outputs (e.g., JSON dumps from `execute` calls), the `↳` line could become visually unwieldy. A configurable truncation limit (e.g., 120 chars) in `abbreviateCommand` or `extractExecuteResult` would be a clean improvement.

3. **Module split planning for `chunk-renderer.ts`** (Item #1) — monitor file growth. If the module exceeds ~1,500 lines or additional rendering modes are added, split into `chunk-accumulator.ts` (pure parsing/accumulation) and `chunk-renderer.ts` (rendering functions).

4. **GUI dialogue UX iteration** — now that the dialogue renderer is live, gather feedback on the chat-like format. Areas to watch: whether the `write_todos` checklist rendering is sufficiently readable, whether `execute` output truncation is needed in practice, and whether sub-agent `### Subagent: …` section headings provide sufficient visual separation.

5. **Planner:** The next plan can build on the foundation of this improved dialogue view, for example: adding a toggle in the WP dialogue panel to switch between verbose (`renderChunksToMarkdown`) and compact (`renderChunksToDialogue`) modes, or extending the renderer with additional tool families as new orchestrator tool types are introduced.

---

*Generated by Head of Operations (Synthesis) — 2026-07-13*
