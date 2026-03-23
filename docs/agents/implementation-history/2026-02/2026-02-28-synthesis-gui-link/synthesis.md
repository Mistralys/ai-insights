# Project Status Report — Synthesis GUI Link

**Plan:** `2026-02-28-synthesis-gui-link`
**Date:** 2026-02-28
**Status:** COMPLETE — all 4 work packages delivered

---

## Executive Summary

This session extended the MCP server's GUI dashboard to surface the archived `synthesis.md` document when a project's synthesis has been completed. The implementation is strictly additive and mirrors the established plan document view pattern end-to-end: a new REST endpoint, a new API client method, a new frontend view, and a conditional "View synthesis →" link on the project detail page.

**What was built:**

| Component | Location | WP |
|-----------|----------|----|
| `handleGetSynthesisDocument()` backend handler | `mcp-server/gui/api.ts` | WP-001 |
| `GET /api/projects/:slug/synthesis` REST route | `mcp-server/gui/server.ts` | WP-001 |
| `API.getSynthesisDocument(slug)` client method | `mcp-server/gui/public/app.js` | WP-002 |
| `renderSynthesis(app, slug)` view function | `mcp-server/gui/public/app.js` | WP-002 |
| Conditional "View synthesis →" link on project detail | `mcp-server/gui/public/app.js` | WP-002 |
| `.synthesis-content`, `.synthesis-link-row`, `.synthesis-link` CSS | `mcp-server/gui/public/styles.css` | WP-002 |
| 4 unit tests for `handleGetSynthesisDocument()` | `mcp-server/tests/gui/api.test.ts` | WP-003 |
| Manifest updates (`api-surface.md`, `data-flows.md`, `README.md`) | `mcp-server/docs/agents/project-manifest/` | WP-001/WP-002/WP-004 |
| Duplicate flow-number fix in`data-flows.md` (Flows 12 & 13 → 14 & 15) | `mcp-server/docs/agents/project-manifest/data-flows.md` | WP-004 |

The implementation exploits the pre-existing `synthesis_generated` flag that `handleGetProject()` already spreads from the root index. No additional HTTP call is needed on the project detail page to decide whether to show the link — the flag is sufficient.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 4 of 4 COMPLETE |
| Pipelines executed | 16 (4 per WP: implementation, QA, code-review, documentation) |
| Pipeline pass rate | 16 / 16 (100%) |
| Tests passing (final) | **542** |
| Tests failing | **0** |
| TypeScript errors | **0** |
| Security issues | **0** |
| Acceptance criteria met | **21 / 21** |

### Test count progression

| After WP | Tests |
|----------|-------|
| WP-001 (backend endpoint) | 538 |
| WP-002/WP-003 (frontend + unit tests) | 542 |

---

## Delivery Highlights

### WP-002 pre-delivered WP-003's scope

The developer implementing WP-002 (frontend integration) proactively added 4 unit tests for `handleGetSynthesisDocument()` to `api.test.ts` as part of the same logical change. WP-003's required minimum was 3; the delivery included a 4th path-traversal safety test (`../escape`, `a/b`, empty string) at no additional cost, exceeding the acceptance criteria.

### Data-flows.md duplicate numbering resolved

QA on WP-004 detected that WP-002's pre-emptive manifest edits introduced duplicate `Flow 12` and `Flow 13` headings (colliding with the existing Workflow Coordination and Auto-Handoff Counter flows). WP-004's documentation pass renumbered the new flows to **Flow 14** (Synthesis Completion) and **Flow 15** (Synthesis Document View) before project completion.

### Security posture unchanged

`handleGetSynthesisDocument()` inherits the full security chain from `handleGetPlanDocument()`: `assertSafeSlug()` guards path traversal before any filesystem access; `ledgerDirExists()` checks project presence before reading the archive file. All three path-traversal patterns tested and confirmed rejected.

---

## Strategic Recommendations

### 1. Extract a shared document handler helper (future, non-blocking)

`handleGetSynthesisDocument()` and `handleGetPlanDocument()` in `gui/api.ts` are structurally identical — differing only in the archive filename constant and error-message label. Two variants is acceptable. If a third document type is ever added (e.g. `/api/projects/:slug/report`), refactor to:

```ts
function handleGetDocument(ledgerRoot: string, slug: string, filename: string, label: string): Promise<{ content: string }>
```

This eliminates the copy-paste pattern before it becomes a maintenance liability.

### 2. Harden the catch-all 404 in document handlers (future, non-blocking)

Both `handleGetPlanDocument()` and `handleGetSynthesisDocument()` catch all errors from file reads as `NOT_FOUND` (HTTP 404). A genuine I/O error (disk full, permission denied) will surface as 404 rather than 500. This is an existing pattern inherited from the plan handler — not introduced in this session — but worth revisiting in a future hardening pass to distinguish "file absent" from "I/O failure."

### 3. Clean up `app.js` section comment numbering (low priority, cosmetic)

The synthesis view insert created an irregular section sequence: `4a → 4b → 4b-ii → 4c`. A future housekeeping WP should renumber these sequentially (`4a` through `4f`) and resolve the pre-existing duplicate `4c` label (Project Detail and Work Package Detail both tagged `4c`).

### 4. Align CSS section comment style (low priority, cosmetic)

The `.synthesis-link-row` section header in `styles.css` uses em-dashes (`────`) while the rest of the file uses hyphens (`------`). Minor cosmetic inconsistency; align to the hyphen convention during a future CSS housekeeping pass.

---

## Next Steps

| Priority | Action |
|----------|--------|
| **Low** | Renumber `app.js` section comments (`4a`–`4f`) and resolve duplicate `4c` label |
| **Low** | Align `styles.css` section header decoration to use hyphens throughout |
| **Future** | Evaluate shared `handleGetDocument()` helper if a third document type is introduced |
| **Future** | Harden document handler catches to distinguish 404 (file absent) from 500 (I/O error) |

---

*Generated by Head of Operations (Synthesis Agent) — 2026-02-28*
