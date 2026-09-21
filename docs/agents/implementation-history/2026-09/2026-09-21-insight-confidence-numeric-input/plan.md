# Plan

## Plan Audit Cycles
- Audits: 2 — Cycle 1: PASS WITH FINDINGS (1 Major, 3 Minor; all integrated) — Plan Auditor v1.9.3. Cycle 2: PASS WITH FINDINGS (1 Major, 1 Minor; both integrated) — Plan Auditor v1.9.3
- Architectural Reviews: 1 (5x Confirm, no Challenge/Reconsider; findings integrated) — Plan Architect Reviewer v2.3.3

## Prior Project Context

The repository's short-term strategic goal is minimising setup and daily-usage friction, and its long-term secondary goal is operational reliability of the headless orchestrator path. A tool call an agent cannot complete because it serialised a fractional number as a string is friction of exactly that kind, and it is unrecoverable in the headless path where no human retries the call by hand.

Two stored insights shaped the design:

- `f389f9ce-86cc-4b4e-ac83-eb131fbdc29d` — stateless helpers in the MCP server are plain-function modules, not classes. The new numeric-input helper follows that shape.
- `8b900521-a71e-4095-bfa1-0212be01a92f` / `b1a0f887-fe53-49dc-91d7-7119dba24832` — Zod defaults that fabricate values destroy the "omitted vs. declared" distinction irrecoverably. The same hazard, in coercion form, is why this plan rejects `z.coerce.number()` (see Considered Alternatives).

No stored insight makes a claim about `confidence` typing or numeric tool-input handling, so this work leaves the knowledge base intact.

## Summary

The Ledger Knowledge Curator reported that `ledger_update_insight` rejects fractional confidence values with `Expected number, received string`, leaving it unable to recalibrate an entry from 0.8 to 0.9. Source inspection shows the field is not typed as an integer — the emitted JSON Schema is `{"type": "number"}` — and the true cause is that the schema has no tolerance for a **string-encoded** number, which is how some clients serialise fractions. A second, independent defect sits beside it: neither `ledger_add_insight` nor `ledger_update_insight` enforces the documented `[0, 1]` range at the tool boundary, so an out-of-range value is only caught deep inside the storage layer as an opaque write error. This plan introduces a shared, string-tolerant numeric-input helper in `mcp-server/src/schema/common.ts`, applies it to `confidence` (with the missing range) and to every other numeric tool input exhibiting the same intolerance, and aligns the GUI write path, help content, and manifest documentation with the result.

## Architectural Context

The MCP server registers each tool via `server.registerTool(name, { description, inputSchema }, handler)`, where `inputSchema` is a plain `z.object({...})` (`mcp-server/src/tools/knowledge.ts` L502–L546). The SDK converts that object to JSON Schema with `toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy: 'input' })` (`mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` L75–L83), which for Zod v3 delegates to the same `zodToJsonSchema` the repository's own regression guard uses (`mcp-server/tests/tools/schema-integrity.test.ts`). Argument validation therefore happens in the SDK, **before** the handler body runs — a schema rejection never reaches the tool's own `try/catch`, which is why the Curator saw a bare Zod message rather than a curated `isError` response.

Validation of `confidence` is currently split across three layers:

| Layer | File | Constraint |
|---|---|---|
| MCP tool input | `mcp-server/src/tools/knowledge.ts` L39–L42, L324 | `z.number().optional()` — type only, no range |
| Storage record | `mcp-server/src/schema/knowledge.ts` L56 | `z.number().min(0).max(1)` — enforced at write time inside `updateInsight()` (`mcp-server/src/storage/knowledge-store.ts` L329–L352) |
| GUI HTTP body | `mcp-server/gui/api-knowledge.ts` L124 | `z.number().min(0).max(1).optional()` |

Cross-domain schema constants live in `mcp-server/src/schema/common.ts`, which today exports only `SLUG_REGEX` and is re-exported by `schema/knowledge.ts` for backwards compatibility. That module is the established home for a constraint shared by unrelated schema domains.

The binding constraint on any solution is `mcp-server/docs/agents/project-manifest/constraints-code-style.md` § *Do Not Use `.refine()`, `.transform()`, or `.superRefine()` on Outer Tool Schemas* — wrapping the outer `z.object()` in a `ZodEffects` blanks the advertised `properties`. Its documented exception permits field-level effects, and the research phase confirmed empirically that a field-level `z.preprocess(...)` around `z.number()` emits an unchanged `{"type":"number","minimum":0,"maximum":1}`.

## Approach / Architecture

Three moves, in order of dependency:

1. **A shared numeric-input helper module.** Add plain exported factory functions to `mcp-server/src/schema/common.ts` that wrap a numeric Zod schema in a field-level `z.preprocess` which converts **only** non-empty strings via `Number(...)` and passes every other input through untouched. `null`, booleans, objects, and `""` continue to be rejected by the inner `z.number()` rather than being silently coerced. Named constructors built on it (`confidenceInput()`, `positiveIntInput()`, `nonNegativeIntInput()`, `numberInput()`) give each call site a one-line, self-describing definition, and `confidenceInput()` carries the `[0, 1]` range so the tool boundary finally states the constraint the docs already claim.

2. **Application at every numeric tool input.** `confidence` on both knowledge write tools, `limit`/`offset` on the knowledge read tools, `max_results` on `ledger_get_next_action`, `max_projects` on `ledger_get_repository_context`, and the three `metrics` counters on `ledger_complete_pipeline`. The defect class is identical at all seven call sites (`confidence` counted once as a site despite two tools; `limit`/`offset` counted once as one pagination-parameter group — three chains: two `limit` fields plus one `offset` — ten distinct Zod chains in total, itemized in Detailed Steps 3–4) and all sit in the blast radius of the helper being introduced.

3. **Alignment of the surrounding surfaces.** The GUI `KnowledgeUpdateBodySchema` moves onto `confidenceInput()` so both write paths into the same stored field validate identically; `.describe()` strings and `ledger_help` content state that fractional values are the norm and that string-encoded numbers are accepted; the manifest records the new convention so the next numeric tool input is written the same way.

`InsightSchema` in `mcp-server/src/schema/knowledge.ts` keeps its plain `z.number().min(0).max(1)`. It validates data read from disk and written by the storage layer, not agent-supplied arguments, and a stored `"0.9"` string should stay an error.

## Rationale

The reported symptom and the underlying defect differ, and fixing only the symptom would leave the more dangerous half in place. String intolerance is a *usability* failure — the call fails loudly and the caller knows. The missing `[0, 1]` range is a *correctness* failure — `ledger_update_insight` accepts `confidence: 7`, forwards it to the store, and the caller receives a write-layer error that names neither the field nor the range. Both live in the same two schema definitions, so both are repaired in one pass.

Centralising the conversion is what keeps the fix from decaying. Seven call sites (ten distinct Zod chains, grouping `confidence`'s two tools as one site and `limit`/`offset` as one pagination-parameter group — three chains: two `limit` fields plus one `offset` — see Detailed Steps 3–4 for the itemized list) that each need the same wrapper is a hand-maintained list, and the next numeric input added later will be written as a bare `z.number()` unless the shared helper is the obvious thing to reach for. Naming the helpers after their semantics (`confidenceInput`, `positiveIntInput`) rather than their mechanism makes the call sites shorter than the code they replace, which is the only reliable way to get a convention adopted.

The helper is not speculative structure: it has four named consumer files on day one (`tools/knowledge.ts`, `tools/workflow-next-action.ts`, `tools/repository-context.ts`, `tools/pipeline.ts`) plus `gui/api-knowledge.ts`, and the growth trajectory is every future tool parameter that carries a number.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|---|---|---|---|
| How to accept string-encoded numbers | Field-level `z.preprocess` converting only non-empty strings, wrapped in named helper factories | (a) `z.coerce.number()`; (b) `z.union([z.number(), z.string()])` + handler-side parsing; (c) leave the schema alone and document "do not quote numbers" in the persona | (a) was verified to accept `null` and coerce it to `0` — and `0` is the Curator's *retirement* marker, so a malformed argument would silently retire an insight; (b) emits an `anyOf` JSON Schema, and — the real defect — union members still require handler-side parsing at every call site, which undermines the "one shared helper, not seven ad hoc conversions" goal this plan exists to deliver; (c) leaves a client-serialisation quirk as a permanent agent-facing trap in the headless path. |
| Where the helper lives | New exports in the existing `mcp-server/src/schema/common.ts` | A new `schema/numeric-input.ts` module | `common.ts` already exists for exactly this — "cross-domain constants that would otherwise couple unrelated schema files together" (its own module docblock). A second shared module for one concern splits the shared-constant home in two. |
| Where the `[0, 1]` range is enforced | At the tool boundary *and* retained in `InsightSchema` | Tool boundary only; or storage only (status quo) | Tool-boundary validation produces an actionable message naming field and range before any I/O; the storage constraint stays as the last line of defence for data arriving from the GUI, migrations, or hand-edited files. |
| Scope of the helper's application | All seven numeric tool inputs | Only `confidence` on the two knowledge tools | The failure mode is a property of argument serialisation, not of `confidence`. Fixing one field leaves `limit`, `offset`, `max_results`, `max_projects`, and the pipeline metrics as the same trap, and the helper exists either way. |
| `InsightSchema.confidence` | Unchanged (`z.number().min(0).max(1)`) | Apply the helper there too, for uniformity | It validates persisted records, not agent input. A `"0.9"` string in a store file is corruption and should fail loudly rather than self-heal on read. |

## Pattern Alignment

- **Follows** the shared-constant convention of `mcp-server/src/schema/common.ts` — new cross-domain schema building blocks are exported from there, and domain schemas import them.
- **Follows** the plain-function module pattern for stateless helpers (`mcp-server/src/storage/repository-registry.ts`; insight `f389f9ce`) — the helpers are exported functions, not a class.
- **Follows** the field-level `.describe()` convention used on every tool input in `mcp-server/src/tools/knowledge.ts`.
- **Follows** the documented exception in `constraints-code-style.md` § *Do Not Use `.refine()` … on Outer Tool Schemas*: effects are applied to individual field definitions only, and the outer `z.object()` remains a `ZodObject`. No departure — the regression guard in `tests/tools/schema-integrity.test.ts` is extended rather than worked around.
- **Follows** the `_internal` naming convention (`constraints-code-style.md`) if any helper internals need exposing for tests; the plan expects the public factories to be sufficient.
- No new pattern is introduced, so no departure requires justification.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|---|---|---|---|
| `mcp-server/src/tools/knowledge.ts` — `AddInsightSchema.confidence` (L39–L42) | Documents the range `0–1` in its `.describe()` but enforces nothing; out-of-range values fail later in the storage layer | Promoted to step 3 | Same two-line definition the plan is already editing; enforcing the documented contract at the point of entry is the whole point of the fix. |
| `mcp-server/src/tools/knowledge.ts` — `UpdateInsightSchema.confidence` (L324) | Same missing range, and the field the reported defect is about | Promoted to step 3 | Directly in scope. |
| Seven inline `z.number()` tool-input chains across `tools/knowledge.ts`, `tools/workflow-next-action.ts`, `tools/repository-context.ts`, `tools/pipeline.ts` | No shared definition; every numeric-input policy decision must be repeated per site, and the next new parameter will not inherit it | Promoted to steps 1 and 4 | The helper is being written regardless; leaving six of seven sites on the old shape guarantees the same bug report from a different field. |
| `mcp-server/gui/api-knowledge.ts` — `KnowledgeUpdateBodySchema.confidence` (L124) | The two write paths into the same stored field validate differently (HTTP body has the range, MCP tool does not) | Promoted to step 5 | Single-line change that removes a divergence the plan would otherwise create in the opposite direction. |
| `mcp-server/src/tools/pipeline.ts` — `metrics` sub-object (L319–L321) | Three numeric fields with neither `.describe()` nor tolerance, nested inside the `metrics` object | Promoted to step 4 (helper + `.describe()` strings) | Inside the blast radius; the `.describe()` additions cost one line each and the fields are agent-facing. |
| `mcp-server/src/schema/work-package.ts`, `project-meta.ts`, `root-index.ts` numeric fields | Same bare `z.number()` shape | Rejected | These validate persisted JSON, not agent arguments. Adding string tolerance there would mask genuine store corruption, and the files sit outside the tool-input blast radius. |
| `mcp-server/src/schema/knowledge.ts` — `InsightSchema.confidence` (L56) | Bare `z.number().min(0).max(1)` | Rejected | Deliberate — see Considered Alternatives. It is the storage contract and must stay strict. |
| Curated error responses for SDK-level argument-validation failures | Zod rejections bypass each handler's `try/catch` entirely, so the caller sees a raw Zod message rather than a tool-shaped `isError` payload | Rejected | Fixing this means intercepting validation for every tool at the SDK registration layer — a server-wide change far outside the blast radius of a confidence-field defect. Mitigated here by improved `.describe()` text, and worth a plan of its own. |

## Detailed Steps

1. **Add the numeric-input helpers to `mcp-server/src/schema/common.ts`.** Export a base factory — `numericInput<T extends z.ZodTypeAny>(inner: T)` — returning `z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), inner)`, plus the named constructors `numberInput()`, `positiveIntInput()`, `nonNegativeIntInput()`, and `confidenceInput()` (the last built as `numericInput(z.number().min(0).max(1))`). Document in the module docblock: (a) why `z.preprocess` and not `z.coerce` — `z.coerce.number()` converts `null`/booleans/`""` to a number, and `0` is the Curator's retirement marker for `confidence`; (b) that only non-empty strings are converted, everything else falls through to the inner schema; (c) that these belong on **tool and HTTP inputs only**, never on storage schemas; (d) that the wrapper is field-level and must never be applied to an outer tool `z.object()` (cross-reference `constraints-code-style.md`); (e) that the conversion accepts any string `Number()` can parse, not just plain decimal literals — hex (`"0x5"` → `5`), exponential (`"1e2"` → `100`), and leading `"+5"` all convert silently, so a future reader isn't surprised by that surface.
2. **Verify the emitted JSON Schema is unchanged.** Confirm via `zodToJsonSchema` that each helper still produces the same shape as the bare chain it replaces (`{"type":"number","minimum":0,"maximum":1}` for `confidenceInput()`, `{"type":"integer","exclusiveMinimum":0}` for `positiveIntInput()`). This was validated during research against the repository's own dependencies; step 8 locks it in as a test.
3. **Apply `confidenceInput()` to the knowledge write tools** in `mcp-server/src/tools/knowledge.ts`: `AddInsightSchema.confidence` (L39–L42) and `UpdateInsightSchema.confidence` (L324). Update both `.describe()` strings to state that the value is a decimal fraction between 0 and 1 (e.g. `0.75`), that values outside the range are rejected, and that a string-encoded number such as `"0.9"` is accepted and converted. Leave the handler bodies unchanged — `confidence: args.confidence ?? 1` (L86) and the `!== undefined` guard (L344) are already correct.
4. **Apply the integer and number helpers to the remaining numeric tool inputs:** `SearchInsightsSchema.limit` (`tools/knowledge.ts` L130–L135), `ListInsightsSchema.limit` / `.offset` (L218–L229), `GetNextActionSchema.max_results` (`tools/workflow-next-action.ts` L76–L81), `RepositoryContextSchema.max_projects` (`tools/repository-context.ts` L38–L47, preserving `.default(5)` and its ordering relative to `.optional()`), and `metrics.tests_passed` / `tests_failed` / `security_issues` (`tools/pipeline.ts` L319–L321, adding a short `.describe()` to each while the lines are being touched).
5. **Align the GUI write path:** replace `confidence: z.number().min(0).max(1).optional()` in `KnowledgeUpdateBodySchema` (`mcp-server/gui/api-knowledge.ts` L124) with `confidenceInput().optional()`. Keep the outer `.strict()` — it is what blocks immutable fields and is unaffected by field-level effects.
6. **Update `ledger_help` content** in `mcp-server/src/tools/help-content.ts`: the `ledger_add_insight` parameter line (L800) and the `ledger_update_insight` parameter line (L922) state that `confidence` is a decimal in `[0, 1]`, that out-of-range values are rejected, and that string-encoded numbers are accepted. Add a short worked example of recalibration (e.g. `{ "id": "…", "confidence": 0.9 }`) alongside the existing examples (L931, L934), and leave the `confidence: 0` retirement guidance (L951) intact.
7. **Write helper unit tests** in `mcp-server/tests/schema/common.test.ts` (see Test Plan).
8. **Extend the schema-integrity regression guard** (`mcp-server/tests/tools/schema-integrity.test.ts`). First close a registration gap: this file does not currently import/register `repository-context.ts`, and `ledger_get_repository_context` is absent from its `EXPECTED_TOOL_NAMES` list — so `max_projects` has no path into this harness at all. Register `repository-context.ts`'s tool module (alongside its existing `beforeAll` registrations) and add `ledger_get_repository_context` to `EXPECTED_TOOL_NAMES` *before* adding any new assertions. While this file is already open, also correct its stale header/inline comments ("all 26 tool schemas", "all 22 tool names") to reflect the true registered count: `EXPECTED_TOOL_NAMES` already holds 28 entries today, before this step's change, so after this step's own addition of `ledger_get_repository_context` the true count is 29 — write "29," not 28. With that gap closed, add assertions on the *emitted field types* for every helper-wrapped input, so a future switch to `z.coerce` or `z.union` that degrades the advertised signature fails the build.
9. **Add tool-level tests** for the two knowledge write tools in `mcp-server/tests/tools/knowledge.test.ts`; a GUI body-schema test in `mcp-server/tests/gui/api-knowledge.test.ts`; string-tolerance tests for `max_results` in `mcp-server/tests/tools/workflow-next-action.test.ts` (AC-08); string-tolerance tests for `max_projects` in `mcp-server/tests/tools/repository-context.test.ts` (AC-08); string-tolerance tests for the `metrics` counters in `mcp-server/tests/tools/pipeline.test.ts` (AC-10); and a help-content wording test in `mcp-server/tests/tools/knowledge-help.test.ts` (AC-13) (see Test Plan).
10. **Run the full MCP server suite** (`npm test` in `mcp-server/`) plus `npx tsc --noEmit`, and confirm no existing test depended on out-of-range confidence being accepted at the tool boundary.
11. **Update the documentation artefacts** listed under Documentation Updates.

## Dependencies

- Step 1 precedes steps 3, 4, 5, 7, 8, and 9 — every application site imports the helper.
- Steps 3–5 are mutually independent and may proceed in parallel once step 1 lands.
- Step 8 depends on steps 3 and 4 (the schemas must already be wrapped for the assertions to be meaningful).
- Step 11 depends on the final shape of steps 1–9.
- No external services, no data migration, no store-format change: `confidence` values already persisted are untouched.

## Required Components

- `mcp-server/src/schema/common.ts` — modified (new exported helper factories)
- `mcp-server/src/tools/knowledge.ts` — modified
- `mcp-server/src/tools/workflow-next-action.ts` — modified
- `mcp-server/src/tools/repository-context.ts` — modified
- `mcp-server/src/tools/pipeline.ts` — modified
- `mcp-server/src/tools/help-content.ts` — modified
- `mcp-server/gui/api-knowledge.ts` — modified
- `mcp-server/tests/schema/common.test.ts` — modified
- `mcp-server/tests/tools/knowledge.test.ts` — modified
- `mcp-server/tests/tools/schema-integrity.test.ts` — modified
- `mcp-server/tests/tools/workflow-next-action.test.ts` — modified
- `mcp-server/tests/tools/repository-context.test.ts` — modified
- `mcp-server/tests/tools/pipeline.test.ts` — modified
- `mcp-server/tests/tools/knowledge-help.test.ts` — modified
- `mcp-server/tests/gui/api-knowledge.test.ts` — modified
- `mcp-server/docs/agents/project-manifest/api-surface.md` — modified
- `mcp-server/docs/agents/project-manifest/constraints-code-style.md` — modified
- `mcp-server/changelog.md`, root `changelog.md` — modified
- `.context/` — regenerated

## Assumptions

- The Curator's client serialised `0.9` as the string `"0.9"`; the quoted error text (`Expected number, received string`) admits no other reading, the emitted JSON Schema for both tools is `{"type": "number"}` rather than `{"type": "integer"}`, and 186 of the 216 insights already stored carry a fractional confidence — so fractional writes demonstrably succeed from other clients.
- `Number("0.9")` is the correct conversion for every affected field; no locale-specific decimal separator (`"0,9"`) needs to be supported, and such input should keep failing.
- Existing persisted `confidence` values are already within `[0, 1]`, since `InsightSchema` has always enforced the range on write.
- No downstream consumer relies on `ledger_update_insight` accepting an out-of-range confidence.

## Constraints

- No `.refine()`, `.transform()`, `.superRefine()`, or `.preprocess()` on any **outer** tool `z.object()` — field level only (`constraints-code-style.md`).
- The emitted JSON Schema for every touched field must keep its current `type` (`number` / `integer`) and range keywords; agents read that schema to construct their calls.
- Cross-platform: pure schema changes, no filesystem or shell involvement.
- `mcp-server/changelog.md` and `mcp-server/package.json` versions must stay in sync (`scripts/check-version-sync.js`, blocking pre-commit hook).
- Generated persona files must never be hand-edited — this plan touches none.

## Out of Scope

- Server-wide interception of SDK-level argument-validation errors to return curated `isError` payloads (rejected above, worth its own plan).
- Any change to storage schemas (`schema/knowledge.ts`, `work-package.ts`, `project-meta.ts`, `root-index.ts`).
- Any persona source change — the Curator's instructions already treat confidence as fractional and need no correction.
- Migration or rewriting of existing stored insights, including the 0.8 entry that prompted the report; the Curator re-runs its recalibration once the fix ships.
- Orchestrator-side (Python) argument construction.

## Acceptance Criteria

- AC-01: `ledger_update_insight` accepts `confidence: 0.9` and persists `0.9`.
- AC-02: `ledger_update_insight` accepts the string `"0.9"` and persists the number `0.9`.
- AC-03: `ledger_add_insight` accepts both `0.85` and `"0.85"` and persists `0.85`.
- AC-04: `ledger_add_insight` and `ledger_update_insight` both reject a confidence outside `[0, 1]` (e.g. `5`, `-0.1`) at the tool boundary, before any store write.
- AC-05: `confidence: null`, `confidence: true`, and `confidence: ""` are rejected — never coerced to `0` — on both knowledge write tools.
- AC-06: `confidence: 0` remains accepted on both tools (the retirement marker is unaffected).
- AC-07: The JSON Schema emitted for `confidence` on both tools is `{"type": "number", "minimum": 0, "maximum": 1}`.
- AC-08: `limit`, `offset`, `max_results`, and `max_projects` accept string-encoded integers (`"5"`) and still reject non-integer, zero/negative, and non-numeric values per their existing constraints.
- AC-09: The JSON Schema emitted for every integer input remains `"type": "integer"` with its existing bound keywords.
- AC-10: `ledger_complete_pipeline` accepts string-encoded `metrics.tests_passed` / `tests_failed` / `security_issues` values.
- AC-11: `tests/tools/schema-integrity.test.ts` still reports non-empty `properties` for all registered tool schemas.
- AC-12: `PATCH /api/knowledge/:id` accepts a string-encoded confidence, still rejects out-of-range values, and still rejects unknown keys (`.strict()` preserved).
- AC-13: `ledger_help` output for both knowledge write tools states the `[0, 1]` decimal range and that string-encoded numbers are accepted.
- AC-14: `npm test` and `npx tsc --noEmit` pass in `mcp-server/`.
- AC-15: `api-surface.md` and `constraints-code-style.md` describe the accepted input forms and the shared-helper convention.

## Testing Strategy

Three layers, all Vitest, matching the existing suite layout. Unit tests pin the helper's conversion and rejection behaviour in isolation. Schema-shape tests assert the JSON Schema clients actually receive, using the existing `registerTool`-capturing harness. Tool-level tests exercise the real write path end-to-end against a temporary ledger root, confirming the persisted value and that rejections happen before any store write. The GUI body schema gets a parser-level test alongside the existing `api-knowledge` tests. No new test infrastructure is required.

## Test Plan

- `mcp-server/tests/schema/common.test.ts` — `confidenceInput()` parses `0.9`, `"0.9"`, `" 0.9 "`, `0`, and `1` to the expected numbers — AC-01, AC-02, AC-06
- `mcp-server/tests/schema/common.test.ts` — `confidenceInput()` rejects `5`, `-0.1`, `null`, `true`, `""`, `"abc"`, `{}` — AC-04, AC-05
- `mcp-server/tests/schema/common.test.ts` — `positiveIntInput()` / `nonNegativeIntInput()` parse `"5"` → `5`, `"0"` → `0` (non-negative only), and reject `"5.5"`, `"-1"`, `"0"` (positive only), `null`, `""` — AC-08
- `mcp-server/tests/schema/common.test.ts` — `numberInput()` passes non-string values through untouched (identity for numbers; rejection for `null`/booleans) — AC-05
- `mcp-server/tests/tools/schema-integrity.test.ts` — asserts `properties.confidence` is `{"type":"number","minimum":0,"maximum":1}` for `ledger_add_insight` and `ledger_update_insight` — AC-07
- `mcp-server/tests/tools/schema-integrity.test.ts` — asserts `"type": "integer"` plus existing bound keywords for `limit`, `offset`, `max_results`, `max_projects` — AC-09
- `mcp-server/tests/tools/schema-integrity.test.ts` — existing non-empty-`properties` assertion continues to pass for every registered tool — AC-11
- `mcp-server/tests/tools/knowledge.test.ts` — `ledger_update_insight` with `confidence: 0.9` persists `0.9`; with `"0.9"` persists `0.9` — AC-01, AC-02
- `mcp-server/tests/tools/knowledge.test.ts` — `ledger_add_insight` with `0.85` and with `"0.85"` both persist `0.85` — AC-03
- `mcp-server/tests/tools/knowledge.test.ts` — `confidence: 5` and `confidence: -0.1` are rejected by the schema on both tools, and the stored record is unchanged — AC-04
- `mcp-server/tests/tools/knowledge.test.ts` — `confidence: null` / `true` / `""` are rejected and never stored as `0` — AC-05
- `mcp-server/tests/tools/knowledge.test.ts` — `confidence: 0` still succeeds and, combined with `superseded_by`, produces the retired record — AC-06
- `mcp-server/tests/tools/knowledge.test.ts` — `ledger_list_insights` with `limit: "2"` / `offset: "1"` returns the same page as the numeric form — AC-08
- `mcp-server/tests/tools/workflow-next-action.test.ts` — `max_results: "2"` returns the same `actions` array as `max_results: 2` — AC-08
- `mcp-server/tests/tools/repository-context.test.ts` — `max_projects: "3"` caps the `projects[]` array at 3, and omission still defaults to 5 — AC-08
- `mcp-server/tests/tools/pipeline.test.ts` — `ledger_complete_pipeline` with string-encoded `metrics.tests_passed` / `tests_failed` / `security_issues` stores the numeric values — AC-10
- `mcp-server/tests/gui/api-knowledge.test.ts` — `KnowledgeUpdateBodySchema` parses `confidence: "0.9"` → `0.9`, rejects `1.5`, and still rejects an unknown key — AC-12
- `mcp-server/tests/tools/knowledge-help.test.ts` — help text for both knowledge write tools mentions the decimal `[0, 1]` range and string-encoded acceptance — AC-13

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — `ledger_add_insight` (L759–L772) and `ledger_update_insight` (L816–L834) signature comments: `confidence?: number` documented as a decimal in `[0, 1]`, enforced at the tool boundary, with string-encoded numbers accepted; add the same note to `limit` / `offset` on the read tools, `max_results`, `max_projects`, and the `metrics` counters
- `mcp-server/docs/agents/project-manifest/constraints-code-style.md` — new section "Numeric Tool Inputs Use the Shared Coercing Helpers": the rule (numeric tool/HTTP inputs use `confidenceInput()` / `positiveIntInput()` / `nonNegativeIntInput()` / `numberInput()` from `schema/common.ts`), the reason (`z.coerce` fabricates `0` from `null`; `0` is semantically loaded for `confidence`), the storage-schema exemption, the field-level-only restriction cross-referencing the existing outer-schema rule, and the regression guard in `tests/tools/schema-integrity.test.ts`. This section must also explicitly *add* `.preprocess()` to the enumerated method list in the existing § *Do Not Use `.refine()`, `.transform()`, or `.superRefine()` on Outer Tool Schemas* exception — that exception currently names only `.refine()`, and this plan is the first thing in the codebase to use field-level `.preprocess()`, so the documented exception must name it rather than leaving the extension implicit. Add the entry to that document's table of contents
- `mcp-server/changelog.md` — new entry (patch or minor per the change's significance), house style, ≤ 100-char lines
- `changelog.md` (root) — aggregated entry with the `> mcp vX.Y.Z` reference line, written after the module entry
- `mcp-server/package.json` — version synced via `npm run sync-version` (enforced by `scripts/check-version-sync.js` in the pre-commit hook)
- `.context/` — regenerate via `node scripts/cli.js ctx-generate` (the pre-commit hook warns on staleness); affects `.context/mcp-server/manifest-api-surface.md` and `.context/mcp-server/manifest-constraints.md`

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **A future switch to `z.coerce` silently reintroduces `null → 0`, retiring insights by accident** | The module docblock states the hazard explicitly; `tests/schema/common.test.ts` asserts `null`/`true`/`""` rejection, so the substitution fails the suite. |
| **The `z.preprocess` wrapper degrades the JSON Schema clients read, hiding parameters** | Verified during research against the repository's own `zod-to-json-schema` (field-level preprocess emits the unchanged typed schema) and locked in by the extended `schema-integrity` assertions (AC-07, AC-09, AC-11). |
| **Adding the `[0, 1]` range breaks a caller that currently sends out-of-range values** | Such calls already fail at the storage layer, so no working path is lost — only the error moves earlier and gets clearer. Step 10 runs the full suite to confirm no test depended on the old behaviour. |
| **`.default(5)` on `max_projects` interacts badly with the preprocess wrapper** | The helper wraps the inner numeric schema only; `.optional().default(5)` stays outermost and is covered by the repository-context test asserting the omitted-argument default. |
| **The Curator's actual client quoted the value for a different reason (e.g. a transport quirk), so the fix does not resolve the report** | After shipping, re-run the reported recalibration (`confidence` 0.8 → 0.9 on the affected entry) as the acceptance smoke test; the string-tolerance path covers the serialisation reading and the range fix stands on its own merits either way. |

## Recommended Workflow

- **Workflow:** standalone
- **Rationale:** One design decision (a single shared helper) applied mechanically across seven call sites in one module, within an established Zod pattern, with the sole structural risk — a degraded JSON Schema — already covered by the automated `tests/tools/schema-integrity.test.ts` guard.
