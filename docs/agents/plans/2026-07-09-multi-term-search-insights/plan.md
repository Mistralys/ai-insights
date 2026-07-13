# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v2.0.0

## Summary

`ledger_search_insights` currently matches the entire `query` string as a single verbatim
substring. Agents naturally write multi-word queries (e.g. `"content type rendering frame
footer"`) expecting each word to be an independent search term. This plan changes
`KnowledgeStoreManager.searchInsights()` to tokenize the `query` on whitespace and apply
**OR semantics** — an insight matches if any token appears in its title, content, or tags.
Multi-token results are ranked by descending match count so the most relevant insights surface
first. Single-token queries are fully backward-compatible (identical output, same order).

## Architectural Context

The search path is:

```
MCP tool layer    mcp-server/src/tools/knowledge.ts       searchInsights()
                        ↓  delegates to
Storage layer     mcp-server/src/storage/knowledge-store.ts  KnowledgeStoreManager.searchInsights()
```

`KnowledgeStoreManager.searchInsights()` (line 233) loads all insights via `_loadInsights()`,
then runs a single `.filter()` with three `.includes(q)` checks. Pagination and tag filtering
follow. The entire operation is a pure in-memory computation after the I/O load — no writes,
no locks.

The tool schema description in `SearchInsightsSchema` (tools/knowledge.ts line 97–101) is
surfaced directly to agents via the MCP protocol and currently advertises "substring match",
misleading agents into believing multi-word phrasing is safe.

The project manifest documents the existing tool signature in
`mcp-server/docs/agents/project-manifest/api-surface.md` (line 686–706).

Tests live in two files:
- `mcp-server/tests/storage/knowledge-store.test.ts` — unit tests for `searchInsights()` (line 291)
- `mcp-server/tests/tools/knowledge.test.ts` — integration-style tests for `ledger_search_insights` (line 189)

## Approach / Architecture

**Step 1 — Tokenize the query.** Split `query` on `/\s+/` and filter empty strings, producing
`tokens: string[]`. All tokens are lowercased once at this point.

**Step 2 — OR match with ranking.** For each insight, count how many tokens appear in
title/content/tags (the match count). Keep insights with `matchCount > 0`. For multi-token
queries, sort descending by match count so insights matching more terms rank first. Single-token
queries skip the sort (preserving stable insertion order as today).

**Step 3 — Empty query fallback.** When `tokens` is empty (empty string or all whitespace),
return all insights — preserving the current implicit behavior where `''.includes('')` matches
everything.

The tags filter and pagination steps that follow are untouched.

No new abstractions, no new files, no dependency changes — all changes are inside one method,
one schema description, two test files, and one manifest document.

## Rationale

OR logic was chosen because:
- Agents formulate queries as concept clusters, not exact phrases.
- Silently returning zero results (current behavior for any multi-word query) is worse than
  returning too many.
- Ranking by match count provides precision-within-OR without introducing AND semantics.
- The `tags` filter already provides AND logic for structured, controlled-vocabulary filtering,
  creating a clean complementary pair: free-text `query` (OR) + structured `tags` (AND).

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Query tokenization logic | OR — insight matches if any token present | AND — all tokens must match | AND returns zero results far too often when agents use more than 2 terms; OR with ranking recovers precision |
| Ranking | Descending match count, multi-token only | No ranking (flat OR); full TF-IDF | Match count is zero-dependency and sufficient for a small in-memory store; TF-IDF is over-engineering at this scale |
| Single-token behavior | Unchanged (skip sort, same output) | Unified code path with sort | Skipping the sort for single-token preserves stable output order and avoids any risk of subtle order-change regressions |
| Empty query | Return all insights (preserve current) | Return empty array | `''.includes('')` already returns true for all strings today; changing to empty-returns-nothing would be a silent behavioral regression |

## Pattern Alignment

| Pattern | Status |
|---------|--------|
| Pure in-memory filter after `_loadInsights()` — no new I/O or locks introduced | Follows — matches existing `searchInsights` and `listInsights` structure |
| `atomicWriteJson` + `withLock` for all writes | Unaffected — `searchInsights` is a read-only operation |
| Zod schema descriptions surfaced to agents via MCP | Follows — update the `query` field description to accurately guide agents |
| Test fixtures built via `makeInsightInput` + `beforeEach` setup | Follows — new tests reuse the same fixture pattern in both test files |

## Detailed Steps

1. **Modify `KnowledgeStoreManager.searchInsights()`** in
   `mcp-server/src/storage/knowledge-store.ts`:
   - Replace the single `const q = query.toLowerCase()` + `.filter(includes)` block with the
     tokenized OR + ranking logic described in the Approach section.
   - Update the method JSDoc to describe the new tokenized OR behavior, empty-query fallback,
     and match-count ranking.

2. **Update `SearchInsightsSchema` query field description** in
   `mcp-server/src/tools/knowledge.ts`:
   - Change the description from `"case-insensitive substring match against title, content, and tags"`
     to something like `"Space-separated search terms; an insight matches if any term appears
     in its title, content, or tags (OR logic). Results ranked by number of matched terms."`.

3. **Add tests to `mcp-server/tests/storage/knowledge-store.test.ts`**:
   - Multi-term OR: query `"path error"` returns both the path-related insight and the
     error-related insight.
   - Ranking: create two insights where one matches 2 tokens and the other matches 1 token;
     verify the 2-token match appears first.
   - Single-token backward compat: verify `"path"` still returns only path-related insights
     (no regression, same order as today).
   - Empty query returns all insights.
   - Whitespace-only query returns all insights.

4. **Add a test to `mcp-server/tests/tools/knowledge.test.ts`**:
   - Multi-term query via the tool layer returns insights matching any term (smoke test through
     the MCP tool wrapper).

5. **Update `mcp-server/docs/agents/project-manifest/api-surface.md`**:
   - Revise the `ledger_search_insights` `query` parameter description to document OR semantics
     and match-count ranking.

## Dependencies

- No new npm dependencies.
- No schema changes (the `query: string` field type is unchanged).
- Steps 3 and 4 depend on Step 1 being implemented first.

## Required Components

- `mcp-server/src/storage/knowledge-store.ts` — modify `searchInsights()` (existing)
- `mcp-server/src/tools/knowledge.ts` — update `SearchInsightsSchema` description (existing)
- `mcp-server/tests/storage/knowledge-store.test.ts` — add new tests (existing)
- `mcp-server/tests/tools/knowledge.test.ts` — add one smoke test (existing)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — update doc (existing)

## Assumptions

- The knowledge store is small enough that in-memory scoring (iterating all tokens per insight)
  carries no performance concern.
- Agents that relied on exact multi-word phrase matching (the old behavior) were silently getting
  zero results anyway, so the behavior change cannot break working agent flows.
- Stable sort within equal match-count buckets is acceptable (JavaScript `.sort()` is stable per
  spec since ES2019 / Node 11).

## Constraints

- No breaking change to the public method signature (`searchInsights(query, filters?)`).
- Single-token queries must produce byte-for-byte identical results to today.
- No new npm dependencies (in-memory computation only).
- All existing `searchInsights` tests must continue to pass without modification.

## Out of Scope

- Fuzzy matching or stemming (e.g. "render" matching "rendering").
- Phrase-quoted substrings (e.g. `"frame footer"` as an exact phrase).
- Changing `listInsights` — it has no text query parameter.
- Modifying the `tags` AND filter — it already works correctly.
- Changelog entries — left to the Release Engineer.

## Acceptance Criteria

- AC-01: A query of two space-separated terms returns every insight that matches at least one
  term (OR logic), regardless of which term matches.
- AC-02: When a multi-term query produces multiple results, insights matching more terms appear
  before insights matching fewer terms.
- AC-03: A single-term query produces the same result set and order as the current implementation.
- AC-04: An empty string query returns all insights (same as current behavior).
- AC-05: A whitespace-only query returns all insights.
- AC-06: The `query` parameter description visible to MCP clients accurately describes
  OR semantics and match-count ranking.
- AC-07: All pre-existing `searchInsights` tests continue to pass without modification.

## Testing Strategy

Unit tests in `knowledge-store.test.ts` cover the storage layer directly. A smoke test in
`knowledge.test.ts` validates the behavior end-to-end through the MCP tool wrapper. No
integration test with a live MCP session is required — the tool wrapper is already covered for
other query cases; one multi-term smoke test is sufficient.

## Test Plan

- `tests/storage/knowledge-store.test.ts` — "multi-term query returns insights matching any
  term (OR)" — AC-01
- `tests/storage/knowledge-store.test.ts` — "multi-term query ranks insights with more matched
  terms first" — AC-02
- `tests/storage/knowledge-store.test.ts` — "single-term query result set and order unchanged"
  — AC-03
- `tests/storage/knowledge-store.test.ts` — "empty query returns all insights" — AC-04
- `tests/storage/knowledge-store.test.ts` — "whitespace-only query returns all insights" — AC-05
- `tests/tools/knowledge.test.ts` — "ledger_search_insights multi-term query returns OR results"
  — AC-01, AC-06

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Update `ledger_search_insights`
  `query` parameter description to reflect OR semantics and match-count ranking (AC-06).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Sort instability for equal-count results** | JavaScript `.sort()` is spec-guaranteed stable (ES2019+, Node ≥ 11). Stable sort means insertion order is preserved within equal-count buckets — no test flakiness. |
| **Existing tests that assert exact result order** | All current tests assert by content, not by position index. Review each assertion before submitting — any positional assertion would need adjustment if match-count ranking reorders results. |
| **Performance regression on large stores** | The scoring loop is O(insights × tokens). Stores are small (hundreds of insights at most). No mitigation required; document assumption. |
