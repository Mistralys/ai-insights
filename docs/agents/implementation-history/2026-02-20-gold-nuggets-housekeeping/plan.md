# Plan

## Summary

Implement all seven strategic recommendations (Gold Nuggets) identified in the 2026-02-20 synthesis report. These items are not defects — all prior acceptance criteria were met — but each represents a low-cost, high-clarity improvement to code quality, type safety, test correctness, log consistency, and documentation readability. The work is split into three priority bands that map directly to the synthesis report's "Next Steps" queue.

---

## Approach / Architecture

The seven items fall into three natural groups by effort and impact:

**Group A — Trivial code fixes (< 5 minutes each):**  
Four isolated, zero-risk changes to source and test files. Each touches a single call site, label string, or assertion. They can be applied as one work package or as four separate micro-WPs.

**Group B — Structural automation (1–2 hours):**  
A CI/pre-commit hook that reads the compiled `dist/utils/constants.js` and asserts parity with the `KNOWN_ROLES` array in `sync-personas.js`. This permanently closes the manual-sync drift risk introduced in WP-005.

**Group C — Low-priority polish (variable effort):**  
A type-tightening pass on `AGENT_PIPELINE_MAP` (requires downstream impact analysis) and a section-reorder of `data-flows.md` (purely editorial).

No new modules, services, or infrastructure are required for Groups A and C. Group B requires a small Node.js assertion script and a `package.json` script entry (or equivalent CI step).

---

## Rationale

- Groups A and C are sequenced first because they are independently deliverable in a single session without coordination overhead.
- Group B is sequenced after Group A because it depends on the TypeScript project already having a working `build` step that produces `dist/`, which is confirmed to exist.
- Group C items are kept separate because GN #6 (type tightening) carries a non-trivial risk of surfacing hidden casts elsewhere, and GN #7 (section reorder) may invalidate anchored links in referencing documents — both warrant their own review pass.

---

## Detailed Steps

### Group A — Trivial fixes

1. **GN #1 — Remove local `AgentRole` re-derivation in `workflow.ts`**
   - File: `mcp-server/src/tools/workflow.ts`, line 59
   - Remove: `type AgentRole = typeof AGENT_ROLES[number];`
   - Add: `import type { AgentRole } from '../utils/constants.js';`
   - Verify: `tsc --noEmit` passes; `AgentRole` continues to resolve correctly at all use sites.

2. **GN #3 — Standardise `stderr` prefixes in `agent-registry.ts`**
   - File: `mcp-server/src/utils/agent-registry.ts`
   - Line 137: Change `[discoverAgents]` → `[agent-registry]` in the `RangeError` message.
   - Line 146: Change `[discoverAgents]` → `[agent-registry]` in the collision warning.
   - Verify: All `stderr` output in the file now uses the uniform `[agent-registry]` prefix.

3. **GN #4 — Fix collision warning test assertions in `agent-registry.test.ts`**
   - File: `mcp-server/tests/utils/agent-registry.test.ts`
   - Locate the collision warning describe block; find the two identical `.toMatch(/Dev A|Dev Z/)` assertions.
   - Replace with two distinct assertions:
     ```
     expect(collisionWarning).toMatch(/Dev A/);
     expect(collisionWarning).toMatch(/Dev Z/);
     ```
   - Verify: Test suite passes (251 tests); the two assertions now independently confirm both names appear in the warning.

4. **GN #5 — Differentiate `buildHandoffResponse` catch block labels in `workflow.ts`**
   - File: `mcp-server/src/tools/workflow.ts`, lines 1032 and 1049
   - Change the first catch label from `storage error` to `storage error (auto-handoff depth update)`.
   - Change the second catch label from `storage error` to `storage error (COMPLETE depth reset)`.
   - Verify: Both labels are unique and self-documenting; `tsc --noEmit` passes.

### Group B — Structural automation

5. **GN #2 — Automate `KNOWN_ROLES` / `constants.ts` parity check**
   - Create a new script at `scripts/check-known-roles.js` (at workspace root, alongside `sync-personas.js`).
   - The script imports `AGENT_ROLES` from the compiled output (`mcp-server/dist/utils/constants.js`) and compares it against the `KNOWN_ROLES` array hard-coded in `sync-personas.js`.
   - If any value present in `AGENT_ROLES` is absent from `KNOWN_ROLES`, or vice versa, the script exits with code 1 and prints a diff.
   - Add a `"check:roles"` entry to `mcp-server/package.json` scripts (e.g. `node ../scripts/check-known-roles.js`) so it can be called from CI.
   - Document the script's purpose and invocation in a brief inline comment at the top of the file.
   - Verify: Running the script against the current codebase exits 0; manually adding a bogus role to `KNOWN_ROLES` causes it to exit 1.

### Group C — Low-priority polish

6. **GN #6 — Tighten `AGENT_PIPELINE_MAP` typing in `workflow.ts`**
   - File: `mcp-server/src/tools/workflow.ts`
   - Change the type annotation of `AGENT_PIPELINE_MAP` from `Record<string, string>` to `Record<string, PipelineType>`.
   - Remove the `as PipelineType` cast at line 1638 if it is no longer needed.
   - Assess whether the `PostImplPipelineType` casts in `getNextActions` can be simplified as a result.
   - Verify: `tsc --noEmit` passes with zero errors; no new casts introduced.

7. **GN #7 — Reorder `data-flows.md` sections numerically**
   - File: `mcp-server/docs/agents/project-manifest/data-flows.md`
   - Current order: 1, 2, 3, 4, 5, 6, 7, 12, 10, 11, 8, 9, 13
   - Target order: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
   - Before reordering: check for any documents in `docs/` that link directly to named section anchors in `data-flows.md` and update those links accordingly.
   - Verify: Sections appear in numeric order; no broken anchors in referencing documents.

---

## Dependencies

- GN #1, #3, #4, #5 have no inter-dependencies and may be executed in any order or in parallel.
- GN #2 depends on the TypeScript project having a passing `npm run build` that produces `mcp-server/dist/utils/constants.js`.
- GN #6 should be executed after GN #1 to avoid conflating two changes to the same file in the same review pass.
- GN #7 has no code dependencies; it may be executed at any point but should be the last item to minimise noise in diffs.

---

## Required Components

- `mcp-server/src/tools/workflow.ts` — GN #1, #4 (line 59), GN #5 (lines 1032, 1049), GN #6
- `mcp-server/src/utils/agent-registry.ts` — GN #3 (lines 137, 146)
- `mcp-server/tests/utils/agent-registry.test.ts` — GN #4
- `sync-personas.js` — referenced by GN #2 (read-only; source of `KNOWN_ROLES`)
- `mcp-server/package.json` — GN #2 (add `check:roles` script entry)
- `scripts/check-known-roles.js` *(new)* — GN #2
- `mcp-server/docs/agents/project-manifest/data-flows.md` — GN #7

---

## Assumptions

- The TypeScript build (`npm run build`) in `mcp-server/` produces `dist/utils/constants.js` with `AGENT_ROLES` exported as a CommonJS or ESM export readable by a plain Node.js script.
- No external CI pipeline is currently configured; the check script will be invokable manually via `npm run check:roles` until a CI step is wired.
- The `AGENT_PIPELINE_MAP` is defined in `mcp-server/src/utils/pipeline-maps.ts` or inline in `workflow.ts` — the exact declaration site must be confirmed before GN #6 is attempted.
- No other documents currently link to `data-flows.md` section anchors by number; this must be verified before reordering.

---

## Constraints

- All changes must leave `tsc --noEmit` at zero errors.
- All changes must leave the full test suite green (currently 251 tests).
- GN #2 script must not require additional npm dependencies beyond what is already installed.
- GN #5 label strings must remain grep-able as `[buildHandoffResponse]`; only the sub-label suffix changes.

---

## Out of Scope

- Introducing a formal CI pipeline (GitHub Actions, etc.) — GN #2 only adds an npm script for manual / future CI use.
- Refactoring `getNextActions` beyond the type-tightening already implied by GN #6.
- Adding new data flows to `data-flows.md` beyond reordering existing sections.
- Any changes to the agent workflow, ledger structure, or MCP tool API surface.

---

## Acceptance Criteria

- `tsc --noEmit` exits 0 after Group A and Group C source changes.
- All 251+ tests pass after Group A test fixes, with the two collision-warning assertions independently verifying both names.
- `[agent-registry]` is the only prefix used across all `stderr` output in `agent-registry.ts`.
- Both `buildHandoffResponse` catch block labels are unique and include a meaningful sub-context string.
- Running `npm run check:roles` in `mcp-server/` exits 0 against the current codebase, and exits 1 when `KNOWN_ROLES` and `AGENT_ROLES` are artificially made to diverge.
- `data-flows.md` sections appear in the order 1 through 13 with no gaps, and no referencing document has a broken anchor.

---

## Testing Strategy

Each change is validated at the unit level:

- **GN #1, #3, #5, #6:** Run `tsc --noEmit` after each edit. No new tests needed.
- **GN #4:** Run `npx vitest run tests/utils/agent-registry.test.ts` and confirm both new `.toMatch` assertions pass distinctly.
- **GN #2:** Manual invocation of `node scripts/check-known-roles.js` in both passing and artificially failing states. Add a brief comment describing how to trigger the failure mode.
- **GN #7:** Visual review of the reordered document; grep for any anchored links in `docs/` pointing to `data-flows.md`.

Full suite (`npx vitest run`) is run after Group A is complete and again after Group C to confirm no regressions.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **GN #6: Tightening `AGENT_PIPELINE_MAP` type surfaces hidden casts elsewhere in `workflow.ts`** | Run `tsc --noEmit` immediately after the change; address any newly surfaced errors before merging. |
| **GN #1: Removing local `AgentRole` re-derivation breaks a use site not visible in a quick scan** | Search for all uses of `AgentRole` in `workflow.ts` with `grep` before removing the local declaration. |
| **GN #2: Compiled `dist/` is stale or absent, causing the check script to fail spuriously** | Document that `npm run build` must be run before `npm run check:roles`; add a guard that prints a clear message if `dist/utils/constants.js` is missing. |
| **GN #7: Reordering sections silently breaks a section anchor linked from another document** | Grep `docs/` and the workspace root for `data-flows.md#flow` before reordering. |
| **GN #3: Changing the `RangeError` message prefix in strict mode breaks a test assertion** | Search `tests/` for any assertion that expects the `[discoverAgents]` prefix string and update it alongside the source change. |
