# Plan

## Summary

Add an optional `outcome_summary` parameter to the `ledger_import_standalone` and `ledger_update_synthesis` MCP tools, so the calling agent supplies a curated project outcome summary instead of the server parsing one out of a named section of `synthesis.md`. The existing `parseOutcomeSummary()` extraction stays in place as the fallback when the parameter is omitted, which keeps every current caller — including the non-agent `scripts/import-standalone.js` — working unchanged. The change makes summary length and content a persona instruction rather than a document contract, and removes the requirement that a synthesis document carry a section with one exact heading.

## Architectural Context

- `mcp-server/src/tools/standalone-import.ts` defines both tools. `ImportStandaloneSchema` and `UpdateSynthesisSchema` are the Zod input schemas; `importStandalone()` and `updateSynthesis()` are the handlers.
- Both handlers read `synthesis.md` from the plan folder and call `parseOutcomeSummary(synthesisContent)` (line ~271 and line ~448 respectively). That helper lives in `mcp-server/src/utils/synthesis-parser.ts` and matches `/^#{2,3}\s+Outcome Summary\s*$/im`, falling back to the first bullet under an `Implementation Summary` heading, else `null`.
- `importStandalone()` passes the parsed value to `LedgerStore.importStandaloneProject()` as both `outcomeSummary` and — wrapped in an array — `pipelineSummary`, with `['Standalone plan executed.']` as the null fallback.
- `updateSynthesis()` assigns the parsed value directly to `rootIndex.outcome_summary` inside the lock, and `writeRootIndex()` auto-syncs it into `.meta.json`.
- `ledger_complete_synthesis` (`mcp-server/src/tools/project-lifecycle.ts`, ~line 815) already takes `outcome_summary` as a required tool parameter with `z.string().min(10)`, and never reads the file. This plan makes the two standalone tools consistent with it.
- `project_summary` on `ImportStandaloneSchema` is the closest existing precedent for an optional, agent-curated string parameter on this exact tool, including its key-presence spread semantics through to storage.
- Storage schemas (`src/schema/root-index.ts`, `src/schema/project-meta.ts`) already declare `outcome_summary` as `z.string().nullable().optional()`. No schema migration is required.

## Approach / Architecture

Add `outcome_summary` to both input schemas as `z.string().trim().min(10).optional()`, matching the validation floor already used by `ledger_complete_synthesis` and the optional/trim shape already used by `project_summary`.

In `importStandalone()`, resolve the effective summary once, immediately after the file read:

```ts
const outcomeSummary = args.outcome_summary ?? parseOutcomeSummary(synthesisContent);
```

`updateSynthesis()` takes one further fallback, because it operates on a project that may already hold a summary worth keeping. Its resolution order is supplied argument, then parsed section, then the value already in the root index:

```ts
const outcomeSummary =
  args.outcome_summary ?? parseOutcomeSummary(synthesisContent) ?? rootIndex.outcome_summary ?? null;
```

The root index is already read inside the lock in that handler, so the existing value is available at the assignment site without an extra read. The practical effect is that a refresh can set or replace a summary but can never clear one: a document with no parseable section and a caller that supplies nothing leaves the stored summary as it was. This is the defect that motivated the plan — a ledger-produced `synthesis.md` writes an `Executive Summary` heading, parses to `null`, and today wipes the summary that `ledger_complete_synthesis` stored at completion time.

Everything downstream of those lines — the `importStandaloneProject()` call, the `pipelineSummary` derivation, the `rootIndex.outcome_summary` assignment, and the response payload — continues to consume the single resolved value and needs no further change. The file read stays in both handlers regardless, since `updateSynthesis()` also re-archives the document and `importStandalone()` needs it present.

## Rationale

Parsing a heading out of a Markdown document couples the stored summary to a naming convention that no single persona owns. The ledger Synthesis persona currently instructs its agent to write an `Executive Summary` section while the parser looks for `Outcome Summary`, so ledger-produced syntheses parse to `null` and a refresh silently clears the stored summary. Making the summary a tool parameter removes the coupling entirely and puts length and content under persona control, where they can be tuned in one place.

Keeping the parser as a fallback rather than replacing it is what makes the change non-breaking: `scripts/import-standalone.js` drives batch imports with no agent in the loop and has no summary to supply.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| How the summary reaches the tool | Optional parameter, parser as fallback | (a) Required parameter, parser removed; (b) rename the expected heading to match the persona; (c) leave as-is | (a) breaks `scripts/import-standalone.js` and every existing caller; (b) preserves the document coupling that caused the defect and needs back-filling of historical files; (c) leaves the ledger refresh path clearing summaries silently. |
| Validation floor | `.trim().min(10)` | `.min(1)` like `project_summary` | `ledger_complete_synthesis` already rejects under 10 characters for the same field in the same storage slot. Two different floors for one stored value is a trap. |
| Where the fallback lives | Inline `??` in each handler | A wrapper in `synthesis-parser.ts` | The parser is a pure Markdown function with its own test file. Giving it knowledge of tool arguments would widen its contract for two call sites. |

## Pattern Alignment

- Follows `ImportStandaloneSchema.project_summary` (`mcp-server/src/tools/standalone-import.ts`) for optional agent-curated string parameters: `.trim()`, `.optional()`, a `.describe()` that tells the agent how to compose the value.
- Follows `CompleteSynthesisSchema.outcome_summary` (`mcp-server/src/tools/project-lifecycle.ts`) for the validation floor and the description wording.
- Leaves `parseOutcomeSummary()` and its test file (`mcp-server/tests/utils/synthesis-parser.test.ts`) untouched — the fallback contract is unchanged.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/tools/standalone-import.ts` | Both handlers repeat the read-file-then-parse sequence with near-identical error blocks | Rejected | Extracting a shared helper touches both handlers' error-response shapes and is not needed by this change. Out of scope. |
| `mcp-server/src/utils/synthesis-parser.ts` | Its doc comment states the parsed value is what gets stored | Promoted to step 6 | The comment becomes inaccurate once the parameter exists; leaving it is a documented-but-wrong reference for the next reader. |

## Detailed Steps

1. Add `outcome_summary` to `ImportStandaloneSchema` in `mcp-server/src/tools/standalone-import.ts`: `z.string().trim().min(10).optional()` with a `.describe()` stating it is a 2–3 sentence plain-text summary of what was accomplished, the approach taken, and any notable results or limitations; and that when omitted the server falls back to parsing the `Outcome Summary` section of `synthesis.md`.
2. Add the identical field to `UpdateSynthesisSchema` in the same file.
3. In `importStandalone()`, replace `const outcomeSummary = parseOutcomeSummary(synthesisContent);` with `const outcomeSummary = args.outcome_summary ?? parseOutcomeSummary(synthesisContent);`. Leave the `pipelineSummary` derivation and the response payload as they are.
4. In `updateSynthesis()`, resolve the summary inside the lock, after the root index is read, as `args.outcome_summary ?? parseOutcomeSummary(synthesisContent) ?? rootIndex.outcome_summary ?? null`. The parse call may stay where it is; only the assignment to `rootIndex.outcome_summary` needs the full chain. Note in a comment that the third term exists so a refresh never clears a summary it cannot replace.
5. Update `mcp-server/src/tools/help-content.ts`: document the new parameter for both tools, and correct the line stating that `outcome_summary` is extracted from the `Outcome Summary` section of `synthesis.md` so it describes the parameter-first, parse-fallback resolution.
6. Update the doc comment on `parseOutcomeSummary()` in `mcp-server/src/utils/synthesis-parser.ts` to note it is the fallback path when the tools receive no `outcome_summary` argument.
7. Add tests to `mcp-server/tests/tools/standalone-import.test.ts` covering, for both tools: (a) a supplied `outcome_summary` is stored verbatim and takes precedence over a parseable `Outcome Summary` section carrying different text; (b) an omitted `outcome_summary` still parses from the document, i.e. the existing behaviour is unchanged; (c) a supplied summary shorter than 10 characters is rejected by validation; (d) for import only, `pipeline_summary` derives from the supplied value. For `ledger_update_synthesis` add two further cases: (e) a project holding a summary, refreshed against a `synthesis.md` with no parseable section and with no argument supplied, keeps its existing summary rather than being set to `null`; (f) the same project with a parseable section takes the parsed value, confirming the existing value is the last resort and not a veto.
8. Update `mcp-server/docs/agents/project-manifest/api-surface.md` with the new parameter on both tools, and `data-flows.md` where the summary resolution is described.
9. Add an `outcome_summary` field row to the Cross-System Dependencies table in the root `CLAUDE.md`, modelled on the existing `project_summary` row, naming the two tools, the storage schemas, and the two persona files that supply the value (`personas/ledger-support/src/content/ledger-synthesis-maintainer.md`, `personas/ledger/src/content/9-synthesis.md`).
10. Add an entry to `mcp-server/changelog.md` under a new version heading, following the house style (flat bullets, category prefix, ≤ 100 chars).

## Dependencies

- None. All four files are in `mcp-server/` and no other module blocks this work.

## Required Components

- `mcp-server/src/tools/standalone-import.ts`
- `mcp-server/src/tools/help-content.ts`
- `mcp-server/src/utils/synthesis-parser.ts` (comment only)
- `mcp-server/tests/tools/standalone-import.test.ts`
- `mcp-server/docs/agents/project-manifest/api-surface.md`, `data-flows.md`
- `CLAUDE.md` (workspace root)
- `mcp-server/changelog.md`

## Assumptions

- The `.trim().min(10)` floor is acceptable for both tools; a caller wanting a shorter summary is better served by omitting the parameter.
- `LedgerStore.importStandaloneProject()` and `writeRootIndex()` need no signature change, since they already accept the resolved value through existing parameters.

## Constraints

- The change must be backward compatible for `ledger_import_standalone`: omitting the parameter preserves today's behaviour exactly, including the `null` result and the `'Standalone plan executed.'` pipeline-summary fallback.
- `ledger_update_synthesis` changes behaviour in exactly one direction: where it previously stored `null` over an existing summary, it now keeps the existing summary. It must never keep an old summary in preference to a supplied or parsed one.
- Do not remove or weaken `parseOutcomeSummary()` or its existing tests.
- Do not edit generated persona output under `personas/*/vs-code/`, `personas/*/claude-code/`, or `personas/*/deep-agents/`.
- Do not edit any persona source file under `personas/*/src/`. The persona-side changes are being made in parallel by the Persona Curator and will conflict.
- No Git write operations.

## Out of Scope

- Persona source changes — handled separately by the Persona Curator.
- Back-filling historical `synthesis.md` files that carry an `Executive Summary` heading.
- Any change to `ledger_complete_synthesis`, which already takes the parameter.
- Any change to the GUI or its rendering of `outcome_summary`.

## Acceptance Criteria

1. `ledger_import_standalone` and `ledger_update_synthesis` both accept an optional `outcome_summary` string; a supplied value is stored verbatim in the root index and `.meta.json` and echoed in the tool response.
2. Omitting the parameter on `ledger_import_standalone` reproduces current behaviour exactly, verified by the pre-existing tests in `standalone-import.test.ts` continuing to pass unmodified.
2a. `ledger_update_synthesis` never clears a stored `outcome_summary`: with no argument and no parseable section, the previously stored value survives the refresh.
3. A supplied value under 10 characters is rejected with a Zod validation error naming the field.
4. `npm test` passes in `mcp-server/`, and `npx tsc --noEmit` reports no errors.
5. `help-content.ts`, the MCP server manifest, and the root `CLAUDE.md` describe the parameter-first resolution; no remaining documentation claims the summary is extracted from the document unconditionally.
