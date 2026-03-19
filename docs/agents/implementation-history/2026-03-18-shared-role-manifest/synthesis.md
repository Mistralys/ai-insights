# Project Synthesis — Shared Role Manifest

**Plan:** `2026-03-18-shared-role-manifest`  
**Synthesis Date:** 2026-03-18  
**Status:** COMPLETE  
**Scope:** 7 work packages — all COMPLETE, all assigned to Documentation agent

---

## Executive Summary

This session delivered a **single source of truth for the AI Insights workflow vocabulary** — `shared/workflow-manifest.json` — and refactored all three sub-projects to derive their role, pipeline, and constant data from it rather than maintaining parallel hardcoded copies.

Before this session, agent roles, pipeline types, default stages, and numeric constants existed in at least four independent locations: `mcp-server/src/utils/constants.ts`, `mcp-server/src/utils/pipeline-maps.ts`, `orchestrator/src/config.py`, and `scripts/sync-personas.js`. Each was a silent drift vector — a role rename or constant change required four-point manual coordination. That architecture is now retired.

After this session, a single file at `shared/workflow-manifest.json` owns the authoritative vocabulary. All consumers derive their constants at module-load time. A JSON Schema (`shared/workflow-manifest.schema.json`) enforces structural correctness, and a dedicated validation script (`scripts/validate-workflow-manifest.js`) enforces semantic cross-reference integrity (DAG acyclicity, fail_routing referential validity, default_stages subset check). A 34-test invariant suite (`mcp-server/tests/utils/workflow-manifest.test.ts`) provides continuous regression protection.

---

## Deliverables

| WP | Scope | Key Artifacts |
|----|-------|---------------|
| WP-001 | Manifest creation | `shared/workflow-manifest.json`, `shared/workflow-manifest.schema.json` |
| WP-002 | MCP server enums + constants | `mcp-server/src/schema/enums.ts`, `mcp-server/src/utils/constants.ts` |
| WP-003 | MCP server pipeline maps + helpers | `mcp-server/src/utils/pipeline-maps.ts`, `mcp-server/src/utils/workflow-helpers.ts` |
| WP-004 | Orchestrator config + supervisor | `orchestrator/src/config.py`, `orchestrator/src/supervisor.py` |
| WP-005 | Scripts refactor + validation script | `scripts/sync-personas.js`, `scripts/check-known-roles.js`, `scripts/build-personas.js`, `scripts/validate-workflow-manifest.js` |
| WP-006 | Integration validation + tests | `mcp-server/tests/utils/workflow-manifest.test.ts` (34 new tests) |
| WP-007 | Manifest documentation | `mcp-server/docs/agents/project-manifest/tech-stack.md`, `constraints.md`, `workflow-specification/README.md` |

---

## Metrics

### MCP Server (TypeScript)

| Metric | Value |
|--------|-------|
| Test files | 45 (+1 new) |
| Tests passing | 1,467 (+34 new) |
| Tests failing | 0 |
| Build result | PASS (0 TypeScript errors) |
| Rework cycles | 1 (WP-002: Node.js 22+ JSON import regression) |

### Orchestrator (Python)

| Metric | Value |
|--------|-------|
| Tests passing | 219 |
| Tests failing | 0 |
| Tests skipped | 1 (pre-existing conditional skip) |

### Scripts / Personas

| Check | Result |
|-------|--------|
| `node scripts/validate-workflow-manifest.js` | Exit 0 — spec_version=2.4.1, roles=9, pipelines=6 |
| `node scripts/build-personas.js --check` | 18 personas across 2 targets — all up-to-date, 0 warnings |

### Pipeline Health

| Metric | Value |
|--------|-------|
| WPs with all stages PASS | 7 / 7 |
| WPs with missing stages | 0 |
| Project comments | 0 |

---

## Notable Events During Execution

### WP-002: Node.js 22+ JSON Import Regression (RESOLVED)

The initial implementation of `enums.ts` and `constants.ts` used bare ESM `import … from '*.json'` syntax. This compiled successfully under TypeScript but emitted `ERR_IMPORT_ATTRIBUTE_MISSING` at runtime on Node.js 22+ (`node dist/index.js`). The VS Code deployment path via `tsx` was unaffected — only the orchestrator's production path using the compiled `dist/index.js` was broken.

**Resolution:** Both files were immediately reworked to use `createRequire(import.meta.url)` — the standard CJS interop pattern for ESM modules that need to load JSON without the `with { type: 'json' }` import attribute. Runtime-verified on Node.js 25.8.1 (v22+ compatible). All 1,433 tests continued to pass.

**Lesson captured:** TypeScript's `module: Node16` does not support `with { type: 'json' }` import attributes. Any future file in `mcp-server/src/` that imports JSON must use `createRequire(import.meta.url)`. This pattern is now established in three locations (enums.ts, constants.ts, pipeline-maps.ts) and documented in tech-stack.md.

---

## Strategic Recommendations (Gold Nuggets)

### 1. Follow-on Required: `resolveFailAgent()` Hardcoded `baseAgentMap` (Medium Priority)

**File:** `mcp-server/src/utils/pipeline-maps.ts` — `resolveFailAgent()` function  
**Flagged by:** WP-003 Reviewer, WP-006 QA and Reviewer (independent triple flagging)

The function uses a hardcoded `baseAgentMap` with role names (`'Developer'`, `'Release Engineer'`, `'Documentation'`) rather than deriving from `manifest.pipelines.fail_routing` via the `_roleById` lookup already in scope. Current hardcoded values match the manifest exactly — there is no bug today. However, a future change to `fail_routing` in the manifest for non-default stages would silently not propagate to this function. The parity test suite (WP-006) does not cover `resolveFailAgent()`.

**Recommended fix:**
```typescript
const baseAgentMap = Object.fromEntries(
  Object.entries(workflowManifest.pipelines.fail_routing).map(
    ([p, id]) => [p, _roleById[id]]
  )
);
```
This is a one-line change that completes the manifest-derivation story for `pipeline-maps.ts`.

### 2. Missing Orchestrator Test Coverage for Security Auditor + Release Engineer Routing (Medium Priority)

**File:** `orchestrator/tests/test_supervisor.py` — `TestDirectActionRouting` / `_derive_next_action` helper  
**Flagged by:** WP-004 Developer

The `_derive_next_action` test helper only handles 4 pipeline stages (implementation, qa, code-review, documentation). Now that the supervisor queries Security Auditor and Release Engineer agents, parameterized test cases for `RUN_SECURITY_AUDIT → security_auditor` and `RUN_RELEASE_ENGINEERING → release_engineer` routing are missing. These code paths are exercised at runtime but not asserted in the test suite.

### 3. TypeScript Literal Union Types Require Manual Sync With Manifest (Low Priority, Design Limitation)

**Files:** `mcp-server/src/utils/constants.ts` — `AgentRole`, `OrchestratingRole` types  
**Flagged by:** WP-002 Reviewer

TypeScript's JSON import widening (`string[]` instead of literal tuple) prevents inferring narrow types from the manifest's `roles[].name` array. The solution adopted (explicit literal union type annotations) is correct but creates a manual sync requirement: adding a role to the manifest will not automatically update the `AgentRole` union type. The `as unknown as [...]` tuple assertions on the Zod enum values share the same limitation.

**Mitigation path:** Parse the manifest with a Zod schema at startup to recover narrow types dynamically. This would also add runtime validation that the manifest matches the expected shape. Schedule as a low-urgency improvement.

### 4. Orchestrator `_chain_roles` Synthesis Preservation Needs a Comment (Low Priority)

**File:** `orchestrator/src/config.py` line ~82  
**Flagged by:** WP-004 Reviewer

The `_chain_roles` accumulator filters by `r["id"] != "planner"` rather than `r.get("orchestrating")`. This is intentional — Synthesis must remain in the chain so `NEXT_STAGE_MAP` includes the `docs → synthesis` terminal link. The existing comment does not explain this, making the code vulnerable to a future "fix" that silently breaks the handoff chain. A one-line comment addition would guard against this.

### 5. Pre-existing Debt: Duplicate Predicate Functions in `workflow-helpers.ts` (Low Priority)

**File:** `mcp-server/src/utils/workflow-helpers.ts`  
**Flagged by:** WP-003 Reviewer

`hasDependencyBlocked()` and `isBlockedByDependencies()` are functionally identical — same predicate logic, same parameter shape, different parameter name. Both are in active use. Track as cleanup debt for a future consolidation WP.

---

## Architecture Validation

The manifest-derivation architecture is confirmed correct across all three sub-projects:

| Consumer | Derivation Pattern | Verified |
|----------|--------------------|----------|
| `mcp-server/src/schema/enums.ts` | `createRequire` → Zod enum values | ✅ 1467 tests |
| `mcp-server/src/utils/constants.ts` | `createRequire` → AGENT_ROLES, ROLE_IDS, SPEC_VERSION | ✅ 1467 tests |
| `mcp-server/src/utils/pipeline-maps.ts` | `createRequire` → all pipeline maps + PIPELINE_PREREQUISITES | ✅ 1467 tests |
| `mcp-server/src/utils/workflow-helpers.ts` | `createRequire` → all numeric constants | ✅ 1467 tests |
| `orchestrator/src/config.py` | `_load_workflow_manifest()` → all routing constants | ✅ 219 pytest |
| `orchestrator/src/supervisor.py` | imports from config → ROLE_IDS, WP_TERMINAL_STATUSES | ✅ 219 pytest |
| `scripts/sync-personas.js` | `require()` → KNOWN_ROLES one-liner | ✅ Runtime verified |
| `scripts/build-personas.js` | `require()` → role name cross-check for ledger YAMLs | ✅ --check pass |

**Cross-System Dependencies table in AGENTS.md** has been updated to reflect manifest as the single source of truth for all consumers. `AGENT_ROLES` and `KNOWN_ROLES` are both now documented as manifest-derived (auto-derived, always agree by construction).

---

## Next Steps

### Immediate (Recommended for Next Session)

1. **Fix `resolveFailAgent()` baseAgentMap** — replace hardcoded map with manifest derivation via `_roleById`. One-line change, closes the last hardcoded island in `pipeline-maps.ts`. (See Strategic Recommendation #1.)

2. **Add Security Auditor / Release Engineer routing tests** to `orchestrator/tests/test_supervisor.py`. Expands `_derive_next_action` to cover all 6 pipeline stages and adds `TestDirectActionRouting` cases for the two new agents. (See Strategic Recommendation #2.)

### Near-Term

3. **Add `VALID_STAGES` usage or remove import** in `orchestrator/src/supervisor.py`. Either add an assertion guard or remove the dead import.

4. **Add clarifying comment** to `_chain_roles` in `orchestrator/src/config.py` explaining why Synthesis is kept in the chain despite being an orchestrating role.

5. **Consolidate duplicate predicates** `hasDependencyBlocked()` / `isBlockedByDependencies()` in `workflow-helpers.ts`.

### Future

6. **Parse manifest with Zod at startup** in `mcp-server/src/` to recover narrow types dynamically for `AgentRole` / `OrchestratingRole`, eliminating the manual union sync requirement.

7. **Add `statuses.terminal_work_package` field to manifest** to replace the hardcoded `{"COMPLETE", "CANCELLED"}` filter currently used in `orchestrator/src/config.py` for `WP_TERMINAL_STATUSES`. This would complete the fully-derived architecture.

---

*Generated by Head of Operations (Synthesis) — 2026-03-18*
