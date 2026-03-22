# Plan

## Summary

Implement all seven actionable items from the `2026-03-18-shared-role-manifest` synthesis — five code fixes/improvements (immediate and near-term) plus two manifest schema extensions (future) — to close the remaining hardcoded islands, eliminate dead imports, consolidate duplicate predicates, extend test coverage, and complete the manifest-derived architecture.

## Architectural Context

The `shared/workflow-manifest.json` is the single source of truth for all workflow vocabulary. All three sub-projects (MCP server, orchestrator, scripts) derive their constants from it at module-load time.

Key modules relevant to this plan:

- [mcp-server/src/utils/pipeline-maps.ts](mcp-server/src/utils/pipeline-maps.ts) — Pipeline routing: all maps and resolve functions now derive from the manifest **except** `resolveFailAgent()` which still uses a hardcoded `baseAgentMap` literal (lines 254–261).
- [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts) — Workflow utility functions: exports two functionally identical predicates (`hasDependencyBlocked` at line 329 and `isBlockedByDependencies` at line 346).
- [mcp-server/src/utils/constants.ts](mcp-server/src/utils/constants.ts) — Agent roles: `AgentRole` and `OrchestratingRole` are explicit literal union types that must be manually synced with the manifest.
- [orchestrator/src/supervisor.py](orchestrator/src/supervisor.py) — Imports `VALID_STAGES` (line 25) but never uses it anywhere in the file.
- [orchestrator/src/config.py](orchestrator/src/config.py) — `_chain_roles` (line 82) filters `r["id"] != "planner"` rather than `r.get("orchestrating")` to keep Synthesis in the chain; lacks explanatory comment.
- [orchestrator/tests/test_supervisor.py](orchestrator/tests/test_supervisor.py) — `_derive_next_action` helper only handles 4 pipeline stages (implementation, qa, code-review, documentation); `TestDirectActionRouting` class is missing parameterized cases for `RUN_SECURITY_AUDIT` and `RUN_RELEASE_ENGINEERING`.
- [shared/workflow-manifest.json](shared/workflow-manifest.json) — `statuses.work_package` lists `["READY", "IN_PROGRESS", "COMPLETE", "BLOCKED", "CANCELLED"]` but has no `terminal_work_package` subset field; terminal statuses are hardcoded as `{"COMPLETE", "CANCELLED"}` in `orchestrator/src/config.py` (line ~108).

## Approach / Architecture

The plan is structured as seven independent work packages, grouped by priority tier. Each WP is self-contained and can be executed in isolation (no cross-WP ordering dependencies except WP-007 which depends on WP-006 for schema validation). All changes are manifest-driven where applicable, continuing the architectural pattern established in the original session.

## Rationale

- **WP-001 (resolveFailAgent):** Completes the manifest-derivation story for `pipeline-maps.ts` — the last hardcoded island. Uses the existing `_roleById` lookup already in scope, requiring minimal code change.
- **WP-002 (routing tests):** Security Auditor and Release Engineer routing is exercised at runtime but unasserted in tests. Adding parameterized cases provides regression protection for these code paths.
- **WP-003 (dead import):** `VALID_STAGES` is imported but never referenced in `supervisor.py`. Removing it prevents confusion and keeps imports honest.
- **WP-004 (comment):** The `_chain_roles` filter intentionally keeps Synthesis to maintain the `docs → synthesis` terminal link in `NEXT_STAGE_MAP`. Without a comment, a future agent may "fix" this and silently break the handoff chain.
- **WP-005 (duplicate predicates):** `hasDependencyBlocked()` and `isBlockedByDependencies()` are byte-for-byte identical in logic. Consolidating to a single canonical export with a re-export alias reduces maintenance surface.
- **WP-006 (Zod manifest parsing):** TypeScript JSON imports widen to `string[]`, preventing narrow type inference. Parsing the manifest with a Zod schema at startup recovers narrow `AgentRole` types dynamically and adds runtime validation.
- **WP-007 (terminal_work_package):** Adding a `terminal_work_package` subset to the manifest eliminates the hardcoded `{"COMPLETE", "CANCELLED"}` filter in `orchestrator/src/config.py` and makes terminal status semantics manifest-authoritative.

## Detailed Steps

### WP-001: Derive `resolveFailAgent()` baseAgentMap from manifest (Immediate)

1. In [mcp-server/src/utils/pipeline-maps.ts](mcp-server/src/utils/pipeline-maps.ts) (lines 254–261), replace the hardcoded `baseAgentMap` record literal with a manifest-derived expression:
   ```typescript
   const baseAgentMap: Record<PipelineType, string> = Object.fromEntries(
     Object.entries(workflowManifest.pipelines.fail_routing).map(
       ([pipeline, roleId]) => [pipeline, _roleById[roleId as string] ?? 'Developer']
     )
   ) as Record<PipelineType, string>;
   ```
2. Update the JSDoc comment on `resolveFailAgent()` to note that base routing is now fully manifest-derived.
3. Add a parity test in [mcp-server/tests/utils/workflow-manifest.test.ts](mcp-server/tests/utils/workflow-manifest.test.ts) asserting that `resolveFailAgent()` output for each pipeline type matches the manifest's `fail_routing` → role name resolution.
4. Run `npm test` from `mcp-server/` — all 1467+ tests must pass.
5. Run `npm run build` — zero TypeScript errors.

### WP-002: Add Security Auditor / Release Engineer routing tests (Immediate)

1. In [orchestrator/tests/test_supervisor.py](orchestrator/tests/test_supervisor.py), extend the `_derive_next_action` helper to handle `security-audit` and `release-engineering` pipeline stages. After the `cr` (code-review) handling block (~line 108), add:
   - `sa = latest(pipelines, "security-audit")` → if `cr == "PASS"` and `sa is None`, yield `("Security Auditor", "RUN_SECURITY_AUDIT")`.
   - `re = latest(pipelines, "release-engineering")` → if `sa == "PASS"` and `re is None`, yield `("Release Engineer", "RUN_RELEASE_ENGINEERING")`.
   Note: The exact insertion point and conditional chain depends on the existing 4-stage logic. The helper should reflect the 6-stage canonical ordering for WPs that have all stages active.
2. In `TestDirectActionRouting`, add parameterized test cases:
   ```python
   ("Security Auditor",  "RUN_SECURITY_AUDIT",      "security_auditor"),
   ("Release Engineer",  "RUN_RELEASE_ENGINEERING",  "release_engineer"),
   ```
3. Run `pytest orchestrator/tests/` — all 219+ tests must pass.

### WP-003: Remove dead `VALID_STAGES` import from supervisor.py (Near-term)

1. In [orchestrator/src/supervisor.py](orchestrator/src/supervisor.py) line 25, remove `VALID_STAGES` from the import statement:
   ```python
   # Before:
   from .config import PIPELINE_ROLE_NAMES, ROLE_IDS, VALID_STAGES, WP_TERMINAL_STATUSES
   # After:
   from .config import PIPELINE_ROLE_NAMES, ROLE_IDS, WP_TERMINAL_STATUSES
   ```
   **Alternatively**, if `VALID_STAGES` should be used, add an assertion guard (e.g., validate that each destination in `_ROLE_STAGE_MAP.values()` is a member of `VALID_STAGES`). Choose based on whether the import was aspirational or accidental.
2. Run `pytest orchestrator/tests/` — all tests must pass.
3. Run `ruff check orchestrator/src/` — no lint errors.

### WP-004: Add clarifying comment to `_chain_roles` filter (Near-term)

1. In [orchestrator/src/config.py](orchestrator/src/config.py) line ~82, add a comment above the `_chain_roles` list comprehension explaining the intent:
   ```python
   # Roles in manifest order excluding the planner (first, orchestrating).
   # IMPORTANT: Synthesis is intentionally kept despite being orchestrating,
   # because NEXT_STAGE_MAP needs the terminal "docs → synthesis" link.
   # Filtering by `r.get("orchestrating")` would drop Synthesis and break
   # the handoff chain — do NOT "fix" this to use the orchestrating flag.
   _chain_roles: list = [r for r in _roles if r["id"] != "planner"]
   ```
2. No functional change — comment only. Run `pytest orchestrator/tests/` to confirm no regressions.

### WP-005: Consolidate duplicate dependency-blocked predicates (Near-term)

1. In [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts), designate `isBlockedByDependencies()` (line 346) as the canonical implementation.
2. Replace `hasDependencyBlocked()` (line 329) with a re-export alias:
   ```typescript
   /**
    * @deprecated Use isBlockedByDependencies(). Alias retained for backward
    * compatibility with existing call sites.
    */
   export const hasDependencyBlocked = isBlockedByDependencies;
   ```
3. Verify all call sites still compile:
   - `workflow-next-action-batch.ts` imports `hasDependencyBlocked` (line 23, used at line 263).
   - `workflow-handoff.ts` imports `isBlockedByDependencies` (line 17, used at 10+ locations).
4. Run `npm test` and `npm run build` from `mcp-server/` — all tests pass, zero errors.

### WP-006: Parse manifest with Zod at startup for narrow types (Future)

1. Create a new file `mcp-server/src/schema/workflow-manifest-schema.ts` containing a Zod schema that mirrors the structure of `shared/workflow-manifest.json`, including:
   - `roles` array with `z.object({ id, name, pipeline, orchestrating, persona_file })`.
   - `pipelines` object with `canonical_order`, `default_stages`, `prerequisites`, `fail_routing`.
   - `statuses` object with `project`, `work_package`, `pipeline`, `blocker_type` arrays.
   - `constants` object with numeric fields.
2. In `mcp-server/src/utils/constants.ts`, replace the raw JSON import + manual `AgentRole` union type with:
   ```typescript
   const manifest = ManifestSchema.parse(_require('../../../shared/workflow-manifest.json'));
   // AgentRole is now inferred from the parsed schema's roles[].name literal union
   ```
   This eliminates the manual sync requirement flagged in Strategic Recommendation #3.
3. Apply the same pattern in `enums.ts` and `pipeline-maps.ts` — all three files share the same parsed manifest instance.
4. Add a startup-time validation test confirming that `ManifestSchema.parse()` succeeds on the current `workflow-manifest.json`.
5. Run full test suite (`npm test`) + build (`npm run build`).

### WP-007: Add `terminal_work_package` field to manifest (Future)

1. In [shared/workflow-manifest.json](shared/workflow-manifest.json), add a `terminal_work_package` array inside the existing `statuses` object:
   ```json
   "statuses": {
     "project":      ["READY", "IN_PROGRESS", "COMPLETE", "BLOCKED"],
     "work_package": ["READY", "IN_PROGRESS", "COMPLETE", "BLOCKED", "CANCELLED"],
     "terminal_work_package": ["COMPLETE", "CANCELLED"],
     "pipeline":     ["IN_PROGRESS", "PASS", "FAIL"],
     "blocker_type": ["dependency", "decision", "external", "technical"]
   }
   ```
2. Update [shared/workflow-manifest.schema.json](shared/workflow-manifest.schema.json) to include the new `terminal_work_package` property with appropriate constraints (must be a subset of `work_package`).
3. Update `scripts/validate-workflow-manifest.js` to add a semantic check: every value in `terminal_work_package` must also appear in `work_package`.
4. In [orchestrator/src/config.py](orchestrator/src/config.py) (~line 108), replace the hardcoded filter:
   ```python
   # Before:
   WP_TERMINAL_STATUSES: frozenset[str] = frozenset(
       s for s in _MANIFEST["statuses"]["work_package"] if s in {"COMPLETE", "CANCELLED"}
   )
   # After:
   WP_TERMINAL_STATUSES: frozenset[str] = frozenset(
       _MANIFEST["statuses"]["terminal_work_package"]
   )
   ```
5. If WP-006 has been completed, add the new field to the Zod manifest schema.
6. Run validation: `node scripts/validate-workflow-manifest.js`, `pytest orchestrator/tests/`, `npm test` from `mcp-server/`.

## Dependencies

- WP-001 through WP-005 are fully independent — can be executed in any order or in parallel.
- WP-007 depends on WP-006 only if the Zod schema is to include the new field. If WP-006 has not been completed yet, WP-007 can still proceed by adding the field to the JSON and JSON Schema only.
- All WPs require the current codebase state left by the `2026-03-18-shared-role-manifest` session (all committed).

## Required Components

### Existing files to modify
- `mcp-server/src/utils/pipeline-maps.ts` — WP-001
- `mcp-server/tests/utils/workflow-manifest.test.ts` — WP-001
- `orchestrator/tests/test_supervisor.py` — WP-002
- `orchestrator/src/supervisor.py` — WP-003
- `orchestrator/src/config.py` — WP-004, WP-007
- `mcp-server/src/utils/workflow-helpers.ts` — WP-005
- `mcp-server/src/utils/constants.ts` — WP-006
- `mcp-server/src/schema/enums.ts` — WP-006
- `shared/workflow-manifest.json` — WP-007
- `shared/workflow-manifest.schema.json` — WP-007
- `scripts/validate-workflow-manifest.js` — WP-007

### New files to create
- `mcp-server/src/schema/workflow-manifest-schema.ts` — WP-006 (Zod schema for the manifest)

## Assumptions

- The codebase is in the state left by the completed `2026-03-18-shared-role-manifest` session with all 7 original WPs committed.
- The `_roleById` lookup map and `workflowManifest.pipelines.fail_routing` structure in `pipeline-maps.ts` contain all 6 pipeline types as keys.
- The orchestrator's `_derive_next_action` test helper is intended to mirror the full 6-stage pipeline when all stages are active.
- `VALID_STAGES` in `supervisor.py` is indeed dead (confirmed: only appears on the import line).

## Constraints

- **JSON import pattern:** Any new file in `mcp-server/src/` that imports `workflow-manifest.json` must use `createRequire(import.meta.url)` — ESM `import … from '*.json'` fails on Node.js 22+ without `with { type: 'json' }`, which TypeScript's `module: Node16` does not support.
- **No STDIO pollution:** MCP server code must never write to stdout/stderr (breaks MCP STDIO transport).
- **Backward compatibility:** The `hasDependencyBlocked` export must remain available (even if as an alias) to avoid breaking `workflow-next-action-batch.ts` imports.
- **Manifest as source of truth:** If the manifest contradicts code, trust the manifest per AGENTS.md failure protocol.

## Out of Scope

- Modifying the persona templates or generated persona output files.
- Changes to the GUI layer.
- Restructuring the orchestrator's LangGraph node topology.
- Adding new pipeline stages or agent roles to the manifest.
- Changelog or version bump (handled by Release Engineer).

## Acceptance Criteria

- **WP-001:** `resolveFailAgent()` contains zero hardcoded role name strings; output for all 6 pipeline types matches `manifest.pipelines.fail_routing` → role name resolution; parity test exists.
- **WP-002:** `TestDirectActionRouting` includes parameterized cases for `("Security Auditor", "RUN_SECURITY_AUDIT", "security_auditor")` and `("Release Engineer", "RUN_RELEASE_ENGINEERING", "release_engineer")`; all orchestrator tests pass.
- **WP-003:** `VALID_STAGES` no longer appears in `supervisor.py` (or is actively used in an assertion guard); no lint warnings.
- **WP-004:** A comment block above `_chain_roles` explains why Synthesis is kept despite being orchestrating.
- **WP-005:** Only one function body exists for the dependency-blocked predicate; `hasDependencyBlocked` is a re-export alias; all MCP server tests pass.
- **WP-006:** `AgentRole` type is inferred from Zod parse output, not manually declared; manifest parse failure at startup produces a clear error; all tests pass.
- **WP-007:** `WP_TERMINAL_STATUSES` in `orchestrator/src/config.py` reads directly from `manifest["statuses"]["terminal_work_package"]` with no hardcoded status set; validation script checks subset constraint.

## Testing Strategy

| WP | Test Scope | Command |
|----|-----------|---------|
| WP-001 | Unit + parity test for `resolveFailAgent` | `cd mcp-server && npm test` |
| WP-002 | Parameterized routing tests | `cd orchestrator && pytest tests/test_supervisor.py` |
| WP-003 | Lint + existing test suite | `cd orchestrator && ruff check src/ && pytest` |
| WP-004 | No functional change — smoke test | `cd orchestrator && pytest` |
| WP-005 | Full MCP server suite (import alias compatibility) | `cd mcp-server && npm test && npm run build` |
| WP-006 | New startup validation test + full suite | `cd mcp-server && npm test && npm run build` |
| WP-007 | Manifest validation + orchestrator + MCP server | `node scripts/validate-workflow-manifest.js && cd orchestrator && pytest && cd ../mcp-server && npm test` |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **WP-001: `fail_routing` key names don't cover all 6 pipeline types** | Verify manifest `fail_routing` keys before implementation; add `?? 'Developer'` fallback in the derivation expression for safety. |
| **WP-002: `_derive_next_action` helper drift from MCP server logic** | The helper is a test-only simulation; document its drift risk clearly. Consider adding a comment referencing the manifest's `canonical_order` for future maintainers. |
| **WP-005: Re-export alias breaks tree-shaking or bundler assumptions** | MCP server is not bundled (runs as Node.js process); `const` alias export is standard ESM. No risk. |
| **WP-006: Zod schema duplication vs. JSON Schema** | The Zod schema serves a different purpose (TypeScript type narrowing at runtime) than the JSON Schema (structural validation). Both are needed; document the distinction. |
| **WP-007: Adding manifest field breaks existing validation** | Update `workflow-manifest.schema.json` and validation script atomically in the same WP. Run `node scripts/validate-workflow-manifest.js` as the first post-edit check. |
