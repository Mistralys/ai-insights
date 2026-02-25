# Plan

## Summary

This plan implements all "Next Steps" identified in the Automatic Handoffs synthesis report (`/docs/agents/implementation-history/2026-02-19-automatic-handoffs/synthesis.md`) and resolves the one pre-existing unit-test failure (`path-validator.test.ts`). The work spans three priority tiers: immediate micro-debt fixes (silent error swallowing, TS7053 type errors, constants duplication), near-term quality improvements (role-value cross-validation in `sync-personas.js`, failing test repair, `data-flows.md` documentation gap), and two explicitly scoped architectural enhancements (`discoverAgents` strict-mode option and role collision warning in the agent registry). The Planner → PM auto-handoff gap is explicitly excluded as a separate architectural initiative.

---

## Approach / Architecture

The work is split into seven discrete, ordered work packages:

1. **WP-001 – Fix silent `catch {}` blocks** — Two `catch` blocks in `buildHandoffResponse` (`workflow.ts` ~lines 1043 and 1060) swallow storage errors with no trace. Replace both with `process.stderr.write()` calls that emit a structured error string, matching the logging convention already established in `agent-registry.ts`.

2. **WP-002 – Fix TS7053 implicit-any indexing (TD-01)** — `agentNameMap`, `actionNameMap`, and `reworkActionMap` are typed as `Record<PostImplPipelineType, string>` but are indexed with a `string` variable (`pipelineType`) in `getNextActions`, causing TS7053 errors. Fix by asserting `pipelineType as PostImplPipelineType` at each index site (three lines).

3. **WP-003 – Extract `src/utils/constants.ts`** — Both `workflow.ts` (`AGENT_ROLES`) and `agent-registry.ts` (`KNOWN_AGENT_ROLES`) define the same seven-item role array. Create a new `src/utils/constants.ts` that exports a single canonical `AGENT_ROLES` constant. Update both consumers to import from it and delete the local duplicates.

4. **WP-004 – Fix failing `path-validator.test.ts` test (TD-02)** — `basename()` (from Node's `path` module) uses the OS separator; on macOS it does not split on backslashes, so the Windows-style fixture paths (e.g. `f:\\Webserver\\...\\2026-02-16-technical-debt-cleanup`) return the full string as the "basename" rather than `2026-02-16-technical-debt-cleanup`. Fix `validatePlanPath` in `src/utils/path-validator.ts` to normalise path separators before calling `basename`, so Windows-style paths are handled correctly on all platforms.

5. **WP-005 – Cross-validate `role:` values in `sync-personas.js`** — The existing `validateLedgerFrontmatter()` warns when `role:` is absent but does not verify that the extracted value exactly matches a known agent role. Extend the function to read the canonical `AGENT_ROLES` list (hardcoded inline — `sync-personas.js` is plain JS, not TS) and emit a distinct warning when a `role:` value is present but does not match any known role.

6. **WP-006 – Update `data-flows.md`** — Document the `auto_handoff_depth` increment/reset lifecycle as a new flow in `docs/agents/project-manifest/data-flows.md`. The section should cover: where the counter lives (root index), when it is incremented (`buildHandoffResponse`, gated by `< MAX_HANDOFF_DEPTH`), when it is reset (project reaches `COMPLETE`), and what happens when the limit is reached (auto handoff is suppressed; no error).

7. **WP-007 – Agent registry: strict mode + collision warning** — Add two enhancements to `src/utils/agent-registry.ts`:
   - **Strict Mode:** Add an optional `strict?: boolean` parameter to `discoverAgents()`. When `true`, any `.agent.md` file whose parsed `role:` value is not in `AGENT_ROLES` causes `discoverAgents()` to throw rather than silently add the unknown role to the map.
   - **Collision Warning:** When two `.agent.md` files share the same `role:`, the current last-wins behavior is silent. Emit a `process.stderr.write()` warning on collision, naming both files. The last-wins behavior is preserved; only the warning is new.

---

## Rationale

- **micro-debt first (WP-001–003):** Silent errors and duplicate role arrays are the highest friction items — they create real debugging hazards as the codebase grows. Fixing them first leaves the codebase in a cleaner state for all subsequent work.
- **Test fix (WP-004)** is a pre-existing failure that has been deferred across multiple plans. Fixing `path-validator.ts` (rather than patching the test fixtures) is the correct approach because the validator is production code and must behave correctly on all platforms.
- **`sync-personas.js` cross-validation (WP-005)** closes the partial implementation gap from WP-010 and is low risk — advisory warnings only.
- **Documentation gap (WP-006)** is pure doc work and unblocks future planners/reviewers who rely on `data-flows.md` to understand counter lifecycle.
- **Registry enhancements (WP-007)** are explicitly isolated to `agent-registry.ts` and its tests. Strict mode is opt-in (non-breaking). Collision warning is additive (non-breaking).

---

## Detailed Steps

1. **WP-001:** Open `src/tools/workflow.ts` and locate the two `catch {}` blocks inside `buildHandoffResponse` (around lines 1043–1044 and 1060). Replace each with `catch (err) { process.stderr.write(...) }` that emits a labelled message including the error string.
2. **WP-002:** In `getNextActions` (`workflow.ts`), locate the three indexing sites `agentNameMap[pipelineType]`, `actionNameMap[pipelineType]`, and `reworkActionMap[pipelineType]` (around lines 1729–1743). Cast `pipelineType` to `PostImplPipelineType` at each site.
3. **WP-003:**
   - Create `src/utils/constants.ts` exporting `AGENT_ROLES`.
   - In `workflow.ts`: replace the local `AGENT_ROLES` const with an import from `../utils/constants.js`.
   - In `agent-registry.ts`: replace the local `KNOWN_AGENT_ROLES` const with an import of `AGENT_ROLES` from `./constants.js`; update all internal references from `KNOWN_AGENT_ROLES` to `AGENT_ROLES`.
   - Verify `src/index.ts` root export includes `constants.ts` if it re-exports utilities.
4. **WP-004:**
   - In `src/utils/path-validator.ts`, before calling `basename(projectPath)`, normalise the path by replacing all `\\` with `/` so that Windows-style path strings are correctly parsed on all platforms.
   - Run the test suite to confirm the previously failing test now passes and no regressions are introduced.
5. **WP-005:**
   - In `sync-personas.js`, add a `KNOWN_ROLES` constant (mirroring the seven role values from `workflow.ts`) at the top of the file.
   - In `validateLedgerFrontmatter()`, after extracting a `role` value, check `!KNOWN_ROLES.includes(role)` and emit a `console.warn` if the check fails, naming the file and the unrecognised value.
6. **WP-006:**
   - Open `docs/agents/project-manifest/data-flows.md`.
   - Add a new section "Flow N: Auto-Handoff Depth Counter Lifecycle" documenting the counter in the root index, increment path, reset path, and depth-exceeded suppression path.
7. **WP-007:**
   - Add a `strict?: boolean` parameter to `discoverAgents()` signature.
   - When `strict` is true and a parsed role is not in `AGENT_ROLES`, throw a `RangeError` with the file name and role value.
   - Before assigning `newMap[role] = name`, check if `newMap[role]` already has a value; if so, emit `process.stderr.write()` warning naming both files.
   - Update tests in `tests/utils/agent-registry.test.ts` to cover: strict mode rejection of unknown role, strict mode acceptance of known roles (pass-through), and duplicate-role collision warning.

---

## Dependencies

- WP-003 must complete before WP-002 (WP-002 touches `workflow.ts`, and WP-003 refactors it; easier to do WP-003 first to avoid merge conflicts).
- WP-007 depends on WP-003 (imports `AGENT_ROLES` from `constants.ts`).
- All other WPs are independent.

**Recommended sequencing:** WP-001 → WP-003 → WP-002 → WP-004 → WP-005 → WP-006 → WP-007

---

## Required Components

| File | Action |
|------|--------|
| `src/tools/workflow.ts` | Edit: fix silent catch blocks (WP-001), fix TS7053 casts (WP-002), replace local AGENT_ROLES with import (WP-003) |
| `src/utils/agent-registry.ts` | Edit: replace KNOWN_AGENT_ROLES with import (WP-003), add strict mode + collision warning (WP-007) |
| `src/utils/constants.ts` | **New file**: export canonical AGENT_ROLES (WP-003) |
| `src/utils/path-validator.ts` | Edit: normalise path separators before basename (WP-004) |
| `sync-personas.js` | Edit: add KNOWN_ROLES, extend validateLedgerFrontmatter (WP-005) |
| `docs/agents/project-manifest/data-flows.md` | Edit: add auto_handoff_depth flow section (WP-006) |
| `tests/utils/agent-registry.test.ts` | Edit: add tests for strict mode and collision warning (WP-007) |

---

## Assumptions

- No new MCP tool API surface is added; all changes are internal.
- `sync-personas.js` remains plain JavaScript (no TypeScript compilation step); the `KNOWN_ROLES` constant is hardcoded inline rather than dynamically imported.
- The `discoverAgents()` strict-mode parameter defaults to `false`; existing callers in `src/index.ts` are unchanged.
- `AGENT_ROLES` in `constants.ts` uses `as const` to preserve the `readonly` tuple type already relied upon by `AgentRole` in `workflow.ts`.

---

## Constraints

- All existing tests must remain green after each WP. The full suite (244 tests) must reach 244/244 passing by the end of WP-004.
- No changes to the MCP tool schemas or public-facing JSON responses.
- `sync-personas.js` warnings remain advisory only — they must not cause non-zero exit codes.
- `strict` mode in `discoverAgents()` must not affect the existing call site in `src/index.ts` (no argument passed → defaults to `false`).
- Constraint #19 applies: prefer real-impl + temp directories over `vi.mock` in the new registry tests (WP-007).

---

## Out of Scope

- Planner → PM automatic handoff (requires a separate ledger-bootstrap architectural decision).
- CI / pre-commit hook integration for persona role validation.
- Any changes to MCP tool names, argument schemas, or response formats.
- Performance optimisation of `buildHandoffResponse` double-`readRootIndex()` I/O (TD-03 acknowledged, deferred to a future plan).

---

## Acceptance Criteria

- [ ] `npx vitest run` reports 244/244 tests passing with zero failures.
- [ ] `npx tsc --noEmit` reports zero errors across the project.
- [ ] `src/utils/constants.ts` exists and is the sole definition of `AGENT_ROLES`; no other file in `src/` defines a local copy.
- [ ] Both `catch` blocks in `buildHandoffResponse` emit to `process.stderr` on error.
- [ ] `node ./sync-personas.js` emits a console warning when a ledger persona has an unrecognised `role:` value.
- [ ] `data-flows.md` contains a section documenting the `auto_handoff_depth` increment/reset lifecycle.
- [ ] `discoverAgents({ strict: true })` throws on an unknown role in a fixture file.
- [ ] `discoverAgents()` emits a `process.stderr` warning when two `.agent.md` files share the same `role:`.

---

## Testing Strategy

- **WP-001:** No new tests required; the change is observable behaviour (stderr output), validated manually and confirmed by the existing workflow-handoff test suite remaining green.
- **WP-002:** No new tests required; TS compiler (`tsc --noEmit`) validates the fix.
- **WP-003:** No new tests required; existing tests for both `workflow.ts` and `agent-registry.ts` serve as regression coverage.
- **WP-004:** The pre-existing `path-validator.test.ts` fixture (`should accept valid plan paths with date prefix`) is the acceptance test. It must pass after the fix without modifying the test file.
- **WP-005:** Manual smoke test: inject a ledger persona file with `role: UnknownRole` and verify the warning appears.
- **WP-006:** Documentation-only; no automated tests.
- **WP-007:** Extend `tests/utils/agent-registry.test.ts` with at minimum:
  - strict mode + unknown role → throws `RangeError`
  - strict mode + known role → resolves without error
  - non-strict mode + unknown role → silent (existing behaviour, covered by existing tests)
  - two `.agent.md` files with identical `role:` → `process.stderr.write` called once with both file names

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`AGENT_ROLES as const` type lost during import in `workflow.ts`** | Re-export with `as const` in `constants.ts`; verify `AgentRole` type still resolves after refactor via `tsc --noEmit` |
| **`strict` parameter breaks call site in `index.ts`** | Default is `false`; existing `discoverAgents()` call passes no argument — no change needed |
| **Path normalisation in `path-validator.ts` alters valid POSIX paths** | Only replace `\\` with `/`; forward slashes are valid in POSIX paths and `basename` behaviour is unaffected |
| **`sync-personas.js` KNOWN_ROLES drifts from `workflow.ts` `AGENT_ROLES`** | Document this as a known limitation in the file header comment and add it to the constraints doc as an acknowledged manual-sync item |
| **WP-007 stderr spy in tests pollutes vitest output** | Use `vi.spyOn(process.stderr, 'write')` and restore in `afterEach`; this isolates noise to the specific test |
