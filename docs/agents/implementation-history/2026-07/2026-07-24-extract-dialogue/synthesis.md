# Synthesis Report — `2026-07-24-extract-dialogue`

**Date:** 2026-07-24  
**Status:** COMPLETE  
**Total Work Packages:** 5 / 5 COMPLETE  
**Pipeline Health:** All stages passed across all WPs (18 total PASS pipelines, 0 open failures)

---

## Executive Summary

This project delivered two tightly integrated tools that make LangGraph agent dialogue human-readable without requiring manual JSONL parsing:

1. **`scripts/extract-dialogue.js`** — A stdlib-only Node.js ESM CLI script that reads chunk `.jsonl` files, assembles streaming fragments into complete prose turns, and writes a Markdown `.md` file alongside the source. Supports single-file, directory-batch, `--dry-run`, `--force`, and `--help` modes. Registered in `scripts/cli.js` as a hidden Orchestrator-category command.

2. **`renderChunksToText()` + `/chunks/:filename/text` backend endpoint** — A new pure TypeScript renderer in `chunk-renderer.ts` and a new `GET /api/projects/:repo/:slug/chunks/:filename/text` REST endpoint in `api.ts` / `server.ts`. The endpoint is cache-first: it reads an existing `.md` file (CLI-generated or prior access) or extracts and writes one on first request, always returning `{ content: string, cached: boolean }`.

3. **GUI "Text Only" tab** — The dialogue modal in `project-detail-dialogues.js` gains a two-tab layout (Detailed / Text Only) when `useChunks === true`. The Text Only tab lazily fetches prose via `API.getChunkText()` and caches the result for the modal session. Legacy Markdown dialogues (`useChunks === false`) are unchanged.

4. **Orchestrator Archaeologist persona + documentation** — The `(future)` placeholder was replaced with concrete descriptions of both tools. `AGENTS.md`, the GUI and MCP-server `api-surface.md` files, `file-tree.md`, and `tech-stack.md` were updated. The Archaeologist's Workflow step 6 now directs agents to use `extract-dialogue` or the GUI Text Only tab when reading assembled prose.

The CLI and server-side renderer are independent implementations sharing a common `.md` format contract (flat prose for single-namespace; `## Outer Agent` / `## Inner Agent` sections for dual-namespace; `*No dialogue recorded.*` sentinel for empty content). Whichever tool runs first primes the cache for the other.

---

## Metrics

| WP | Pipeline Stages | Tests Passed | Tests Failed | Security Issues | Notes |
|----|-----------------|-------------|--------------|-----------------|-------|
| WP-001 | impl → qa → code-review → docs | 10 AC verified | 0 | — | 1 auto-cancelled QA pipeline (out-of-root path error, recovered) |
| WP-002 | impl → qa → code-review → docs | 144 (111 regression + 33 new) | 0 | — | 33 new tests in `chunk-renderer-text.test.ts` |
| WP-003 | docs only | — | — | — | Documentation WP, 5 AC verified |
| WP-004 | impl → qa → security-audit → code-review → docs | 29 new integration tests | 0 | 0 Critical / 0 High | 2 Medium-informational observations (non-blocking) |
| WP-005 | impl → qa → code-review → docs | 334 (102 targeted + 232 regression) | 0 | — | 2 medium coverage gaps flagged for next cycle |

**Total new tests added:** 33 (WP-002) + 29 (WP-004) + 334 verified green (WP-005) = **396 test runs clean at project end**

**Pre-existing test failures (unrelated, persisting throughout):**
- 107 tests in `project-detail-auto-update.test.ts` / `project-detail-poll-modes.test.ts` — `API.getRepo is not a function` (out-of-scope, separate WP)
- 3 tests in `repository-context.test.ts` — insight deduplication (out-of-scope)

---

## Strategic Recommendations ("Gold Nuggets")

### 1. Route table refactor for `server.ts`
**Priority: Medium | Source: WP-004 Developer + Reviewer**  
`server.ts` now dispatches 3+ chunk-related routes via an if-else chain that is growing past 1000 lines. A table-driven or map-based router would improve discoverability and eliminate the risk of guard-condition drift between route families. Consider a refactor in the next architectural cycle before the route count grows further.

### 2. Pre-existing TypeScript strict-null errors in `api.ts`
**Priority: Medium | Source: WP-004 Developer**  
Lines 343, 384, 557, and 565 in `api.ts` have pre-existing `TS2532`/`TS2345` strict-null errors. These pre-date this project and are not caused by any WP here. They should be addressed in a dedicated cleanup pass to keep the TypeScript compiler output clean.

### 3. Parallel chunk parser maintenance contract
**Priority: Medium | Source: WP-001 Code Review (documentation-forward)**  
`scripts/extract-dialogue.js` and `chunk-renderer.ts` implement the same chunk-parsing algorithm independently (by design — no build coupling). A maintenance note was placed in `mcp-server/docs/agents/project-manifest/file-tree.md` at the `chunk-accumulator.ts` entry. **Any future evolution of the JSONL chunk format must be reflected in both places.** The `.context/scripts.md` CTX document captures the CLI source for agent discoverability.

### 4. Log injection hardening for rejected filenames
**Priority: Medium | Source: WP-004 Security Audit**  
`console.warn()` calls in `handleGetChunkText` echo the raw (regex-failed) filename string. In environments where server logs are forwarded to a log aggregator UI, attacker-controlled characters (ANSI escapes, path separators) could enable log injection. Recommendation: sanitize with `JSON.stringify(filename.slice(0, 64))` before logging. Low operational risk on localhost, but good hygiene.

### 5. Silent cache-write failures in `handleGetChunkText`
**Priority: Medium | Source: WP-004 Security Audit**  
The best-effort `writeFile` catch block is intentionally bare (correct design — write errors should not break the read path). However, if the chunks directory has unexpected permissions, every cache-miss will silently re-extract with no operator signal. Adding a `console.warn()` inside the catch (logging the error message but not rethrowing) would make disk permission issues observable without affecting the read path.

### 6. `renderChunksToText()` multi-namespace label design
**Priority: Low | Source: WP-002 Code Review + Documentation**  
The current implementation collapses all `ns.length > 0` namespaces into a single `## Inner Agent` section. For orchestrators with multiple named inner namespaces (e.g. `pm:...`, `developer:...`), this merges them without distinguishing labels. The JSDoc was updated to document this constraint and flag it for future contributors. If N-inner support is needed, each named namespace would require a distinct section header.

---

## Deferred & Follow-Up Items

| # | Type | Source WP | Agent | Description | Priority |
|---|------|-----------|-------|-------------|----------|
| 1 | **Deferred** | WP-005 | QA, Reviewer | `API.getChunkText()` in `api-client.js` has no dedicated frontend unit test in `api-client.test.ts`. The method is covered server-side but a frontend test asserting URL construction, URI-encoding of all three params, and `data.content` extraction would complete the pattern established by `getChunkRendered` and `getChunkStructured`. | Medium |
| 2 | **Deferred** | WP-005 | QA, Reviewer | The tab bar interaction in `project-detail-dialogues.js` (two-tab switch, lazy-load on first Text Only click, cache reuse, error-path leaves `cachedTextHtml` null for retry) has no unit tests in `project-detail-dialogues.test.ts`. The intentional null-cache-on-error behavior is a subtle contract worth both a code comment and test coverage. | Medium |
| 3 | **Deferred** | WP-004 | Security Auditor | `CHUNK_FILENAME_RE` (`/^[A-Za-z0-9_-]+\.jsonl$/`) has no maximum length constraint on the filename stem. A client could submit a very long filename that passes the regex, consuming path-resolution overhead before the ENOENT 404. Add an early length check (e.g. `filename.length > 256`) consistent with the `MAX_SEGMENT_LENGTH=128` slug guard. | Low |
| 4 | **Deferred** | WP-001 | Reviewer | `extractFile()` returns `status: 'empty'` when it writes the `*No dialogue recorded.*` placeholder, but the summary line emits `1 empty` without clarifying a file was written. Consider changing to `1 empty (written)` or folding empties into the written count with a parenthetical note. | Low |
| 5 | **Deferred** | WP-001 | Reviewer | `discoverChunkFiles()` silently swallows `readdirSync` errors and returns `[]`, causing `No .jsonl files found.` when a permissions error occurs. A future improvement could distinguish "directory not readable" from "directory is empty" to surface the underlying OS error. | Low |
| 6 | **Deferred** | WP-004 | Developer | `api-client.js` description in `api-surface.md` still references "32 REST endpoints". When `WP-005`'s `getChunkText()` client method ships (it has — via this project), that count should be updated in the next documentation sweep. | Low |
| 7 | **Out of scope** | WP-005 | Developer, QA | 107 pre-existing test failures (`API.getRepo is not a function`) in `project-detail-auto-update.test.ts` / `project-detail-poll-modes.test.ts`. These require a `getRepo` method from a separate, in-flight work stream. Must be resolved before the test suite is considered fully green. | High |
| 8 | **Out of scope** | WP-002 | QA | 3 pre-existing failures in `repository-context.test.ts` (insight deduplication). Unrelated to this project — requires a separate bug investigation. | Medium |
| 9 | **Out of scope** | WP-004 | Developer | Pre-existing TypeScript strict-null errors in `api.ts` at lines 343, 384, 557, 565 (`TS2532`/`TS2345`) and `orchestrator-manager.ts` (`TS2322`). Require a dedicated cleanup pass. | Medium |
| 10 | **Reminder** | WP-003, WP-005 | Documentation | Run `node scripts/build-personas.js` to regenerate built persona output files in `claude-code/` and `deep-agents/` from the updated Archaeologist persona source at `personas/ledger-support/src/content/ledger-orchestrator-archaeologist.md`. **This step was not automated.** | — |

---

## Files Modified (Full Project)

| File | WPs |
|------|-----|
| `scripts/extract-dialogue.js` | WP-001 (created) |
| `scripts/cli.js` | WP-001 |
| `mcp-server/gui/chunk-renderer.ts` | WP-002, WP-004 (docs) |
| `mcp-server/tests/gui/chunk-renderer-text.test.ts` | WP-002 (created) |
| `mcp-server/gui/api.ts` | WP-004, WP-002 (docs) |
| `mcp-server/gui/server.ts` | WP-004 |
| `mcp-server/tests/gui/api-chunk-text.test.ts` | WP-004 (created) |
| `mcp-server/gui/public/api-client.js` | WP-005 |
| `mcp-server/gui/public/views/project-detail-dialogues.js` | WP-005 |
| `mcp-server/gui/public/styles.css` | WP-005 |
| `mcp-server/gui/public/index.html` | WP-005 |
| `AGENTS.md` | WP-005 docs |
| `personas/ledger-support/src/content/ledger-orchestrator-archaeologist.md` | WP-005 docs |
| `docs/references/development.md` | WP-001 docs |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-004 docs |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | WP-001 docs, WP-004 docs |
| `mcp-server/gui/docs/agents/project-manifest/api-surface.md` | WP-002 docs, WP-003, WP-005 docs |
| `mcp-server/gui/docs/agents/project-manifest/file-tree.md` | WP-005 docs |
| `mcp-server/gui/docs/agents/project-manifest/tech-stack.md` | WP-005 docs |
| `.context/mcp-server/manifest-file-tree.md` | WP-001 CTX regen |
| `.context/scripts.md` | WP-001 CTX regen |
| `.context/workspace-structure.md` | WP-001 CTX regen |

---

## Next Steps for Planner / Manager

1. **Run `node scripts/build-personas.js`** immediately — the Archaeologist persona source was updated but the built output files have not been regenerated.

2. **Resolve the `API.getRepo` test failures** (107 tests) — this is the highest-priority pre-existing issue discovered during this project. Identify the in-flight WP responsible for the `getRepo` method and unblock it.

3. **Add `API.getChunkText()` frontend unit tests** — 2–3 tests in `api-client.test.ts` asserting URL construction and `data.content` extraction. Mirrors the `getChunkRendered` / `getChunkStructured` test pattern.

4. **Add tab interaction unit tests** — Cover the two-tab switch, first-click lazy-load, second-click cache hit, and error-path (null cache → retry) in `project-detail-dialogues.test.ts`.

5. **Address the `server.ts` route table debt** — Plan a refactor from the if-else chain to a table-driven router before the route count grows further.

6. **Hardening pass for `handleGetChunkText`** — Address the two Security Auditor Medium findings: (a) add `console.warn` inside the `writeFile` catch block for observability; (b) sanitize the filename string before logging in `console.warn` rejection messages.

7. **TypeScript strict-null cleanup** — Resolve the 4 pre-existing strict-null errors in `api.ts` and 2 in `orchestrator-manager.ts` in a dedicated cleanup WP.
