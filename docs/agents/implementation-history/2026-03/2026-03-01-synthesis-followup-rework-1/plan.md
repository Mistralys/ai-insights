# Plan

## Summary

Four cleanup items were surfaced as strategic recommendations by the synthesis of the `2026-03-01-synthesis-followup` session. All are non-blocking improvements to test correctness, code hygiene, document consistency, and pre-commit coverage. This plan addresses them in a single cycle: (1) replace all stale `'Developer Agent'` strings in test fixtures with the valid role `'Developer'`; (2) extract a private `resolveStore()` helper in `work-package.ts` to DRY up the duplicated store-resolution ternary; (3) reposition constraint #60 to its correct sequential location in `constraints.md`; and (4) add a git pre-commit hook that runs `node scripts/build-personas.js --check` to extend persona freshness coverage beyond the existing `pretest` gate.

---

## Architectural Context

### MCP Server — Test Fixtures and Role Validity

`AGENT_ROLES` in `mcp-server/src/utils/constants.ts` defines the seven canonical roles:

```
'Planner' | 'Project Manager' | 'Developer' | 'QA' | 'Reviewer' | 'Documentation' | 'Synthesis'
```

`WorkPackageSummarySchema.assigned_to` (`mcp-server/src/schema/root-index.ts:11`) is typed as `z.string().nullable()` — **not** constrained to `AgentRole` at the schema level. The `assigned_to` validation against `AGENT_ROLES` only fires through the live tool pipeline (specifically `ledger_claim_work_package`). Test fixtures that construct `WorkPackageSummary` or `WorkPackage` objects directly bypass this guard, meaning invalid strings like `'Developer Agent'` currently pass silently.

There are **39 occurrences** of the literal `Developer Agent` across test files — significantly more than the 2 called out in the synthesis. The breakdown by file:

| File | Occurrences (approx.) | Context |
|------|-----------------------|---------|
| `tests/integration/full-workflow.test.ts` | 20 | `assigned_to` fixtures + 1 `agent:` field in project_comments |
| `tests/tools/pipeline.test.ts` | 14 | `assigned_to` fixtures |
| `tests/tools/workflow-handoff.test.ts` | 2 | inline WP stub `assigned_to` values |
| `tests/integration/auto-handoff.test.ts` | 1 | `assigned_to` fixture |
| `tests/storage/ledger-store.test.ts` | 1 | `assigned_to` fixture |
| `tests/schema/validators.test.ts` | 1 | `assigned_to` fixture |

**Out of scope for replacement** (do NOT change):
- `tests/tools/work-package.test.ts:1256` — `it('accepts Developer agent (known role)')` prose test description.
- `tests/tools/start-pipeline-guards.test.ts:108` — `expect(result).toContain('can only be started by the Developer agent')` matches a live server-emitted human-readable message.
- `tests/tools/workflow-handoff.test.ts:1334` — `it('rework loop: … targets Developer agent …')` prose test description.
- `tests/integration/full-workflow.test.ts:717` — `agent: 'Developer Agent'` inside a `project_comments` push. `ProjectCommentSchema.agent` is `z.string()` (free text), so this is not schema debt.

### MCP Server — `work-package.ts` Store Resolution

`mcp-server/src/tools/work-package.ts` contains two exported/internal functions that resolve a `LedgerStore` from the same overloaded parameter:

```typescript
// propagateDependencyUnblock (lines 919–927):
const store =
  typeof ledgerRootOrOpts === 'object' && ledgerRootOrOpts !== null
    ? ledgerRootOrOpts.store
    : new LedgerStore(projectPath, typeof ledgerRootOrOpts === 'string' ? ledgerRootOrOpts : undefined);

// propagateDependencyReblock (lines 987–995): identical
```

These 5-line ternary blocks are verbatim duplicates. A private `resolveStore()` helper consolidates them into a single definition with no behavior change.

### MCP Server — Constraint #60 Position

`mcp-server/docs/agents/project-manifest/constraints.md` currently orders constraints like this:

```
### 32. No Default Exports  (line 570)
### 60. No Unused Locals    (line 578)  ← OUT OF PLACE
### 33. All Reads Are Validated (line 613)
...
### 59. Acceptance Criteria Field-Name Verification (line 1228)
```

Constraint #60 was appended out of sequence — it appears between #32 and #33 when it should follow #59. The content and numbering are correct; only the document position needs adjustment.

### Workspace — Pre-Commit Hook Infrastructure

There is no root-level `package.json` in this monorepo. Husky requires one, making it unsuitable without adding an otherwise-unnecessary root package manifest. A self-contained approach — a `.githooks/pre-commit` shell script activated via `git config core.hooksPath .githooks` — avoids new tooling dependencies while covering the gap.

The existing guard path:
- `mcp-server/package.json` `pretest` → runs `build-personas.js --check` before `npm test` in `mcp-server/`.

The missing gap:
- A developer making changes exclusively in `personas/src/` (no `mcp-server/` test run) never triggers the freshness check.

The pre-commit hook closes this gap by running `node scripts/build-personas.js --check` on every commit regardless of which sub-project is touched.

---

## Approach / Architecture

All four items are isolated changes with no cross-cutting interactions; they are packaged as four sequential work packages in descending priority.

**WP-001** performs a targeted search-and-replace across all 6 affected test files, changing `assigned_to: 'Developer Agent'` → `'Developer'` and `wp.assigned_to = 'Developer Agent'` → `'Developer'`. The four out-of-scope strings listed above must NOT be touched. A full `npm test` run confirms no regressions.

**WP-002** adds a private helper at the bottom of `work-package.ts`'s module-level scope:

```typescript
function resolveStore(
  projectPath: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): LedgerStore {
  return typeof ledgerRootOrOpts === 'object' && ledgerRootOrOpts !== null
    ? ledgerRootOrOpts.store
    : new LedgerStore(projectPath, typeof ledgerRootOrOpts === 'string' ? ledgerRootOrOpts : undefined);
}
```

Both `propagateDependencyUnblock` and `propagateDependencyReblock` replace their duplicated ternary blocks with a single call to `resolveStore(...)`. Existing tests provide regression coverage.

**WP-003** cuts constraint #60 from its current out-of-sequence position (between #32 and #33) and inserts it immediately after constraint #59 in `constraints.md`. No numbering or content changes.

**WP-004** creates `.githooks/pre-commit` as a shell script that runs `node scripts/build-personas.js --check` and exits non-zero on failure. A new `scripts/install-hooks.js` helper automates `git config core.hooksPath .githooks`. The repo's root [README.md](README.md) `## Development` section is updated with a one-liner setup instruction. `personas/docs/agents/project-manifest/constraints.md` receives a new constraint entry documenting the `.githooks` requirement. The [mcp-server/docs/agents/project-manifest/tech-stack.md](mcp-server/docs/agents/project-manifest/tech-stack.md) DevEx entry for the persona guard is updated to reference the pre-commit hook.

---

## Rationale

- **`'Developer Agent'` sweep** — The previous synthesis flagged only 2 occurrences; the full audit reveals 39. Fixing only 2 would leave latent debt unexploded. Doing all of them in one focused WP is cheaper than a drip-fix approach.
- **`resolveStore()` extraction** — The existing duplication is mechanical; a helper is the least-surprising DRY mechanism in this module's coding style.
- **Constraint reordering** — Sequential document structure matters for agent consumption. Constraint #60 appearing between #32 and #33 is disorienting and may cause agents to miss it when scanning the tail of the document.
- **Shell script over Husky/lefthook** — No root `package.json` exists. Adding one solely for a pre-commit manager introduces a structural change disproportionate to the benefit. A `.githooks/` directory with an `install-hooks.js` script aligns with the existing pattern of self-contained `scripts/` helpers.

---

## Detailed Steps

1. **WP-001: Replace all stale `'Developer Agent'` fixtures**
   1. Run `grep -rn "assigned_to.*Developer Agent" mcp-server/tests/` to confirm the full match list.
   2. In each matching file, replace `'Developer Agent'` on `assigned_to` lines with `'Developer'`.
   3. Verify the four out-of-scope strings (test descriptions, `.toContain()` assertion, `agent:` comment field) are untouched.
   4. Run `npm test` in `mcp-server/` — confirm 982/982 pass (or more, if any previously-silently-failing tests now surface correctly).

2. **WP-002: Extract `resolveStore()` helper in `work-package.ts`**
   1. Add private `resolveStore()` function immediately before `propagateDependencyUnblock` (around line 915).
   2. Replace the 3-line `const store = ...` ternary in `propagateDependencyUnblock` with `const store = resolveStore(projectPath, ledgerRootOrOpts);`.
   3. Replace the identical ternary in `propagateDependencyReblock` with the same one-liner.
   4. Run `npm test` — confirm all tests pass.
   5. Update `mcp-server/docs/agents/project-manifest/api-surface.md` to document `resolveStore()` as a private helper in the `Internal Utilities` section.

3. **WP-003: Reposition constraint #60 in `constraints.md`**
   1. Cut the entire `### 60. No Unused Locals` block (including its trailing `---` separator) from its current position between #32 and #33.
   2. Paste it immediately after the `### 59. Acceptance Criteria Field-Name Verification` block, before the `## Runtime Config Monitoring` section.
   3. Visually verify the sequential order is correct (#58 → #59 → #60 → Runtime Config Monitoring).

4. **WP-004: Add pre-commit persona freshness guard**
   1. Create `.githooks/pre-commit` shell script:
      ```sh
      #!/bin/sh
      node scripts/build-personas.js --check
      ```
      Make it executable (`chmod +x .githooks/pre-commit`).
   2. Create `scripts/install-hooks.js`:
      ```js
      #!/usr/bin/env node
      import { execSync } from 'child_process';
      execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
      console.log('Git hooks installed. Pre-commit persona guard active.');
      ```
   3. Update root [README.md](README.md) `## Development` (or equivalent setup section) to include:
      ```
      node scripts/install-hooks.js
      ```
   4. Add a new constraint to `personas/docs/agents/project-manifest/constraints.md` documenting that `.githooks/pre-commit` runs the persona freshness check and that developers must run `node scripts/install-hooks.js` after cloning.
   5. Update `mcp-server/docs/agents/project-manifest/tech-stack.md` to note that the persona freshness guard is enforced at both `pretest` (mcp-server) and pre-commit levels.

---

## Dependencies

- WP-001 has no dependencies on WP-002, WP-003, or WP-004.
- WP-002 has no dependencies.
- WP-003 has no dependencies.
- WP-004 has no dependencies.
- All WPs can be sequenced arbitrarily; priority order is recommended.

---

## Required Components

### Modified Files

| File | WP |
|------|----|
| `mcp-server/tests/tools/workflow-handoff.test.ts` | WP-001 |
| `mcp-server/tests/tools/pipeline.test.ts` | WP-001 |
| `mcp-server/tests/integration/full-workflow.test.ts` | WP-001 |
| `mcp-server/tests/integration/auto-handoff.test.ts` | WP-001 |
| `mcp-server/tests/storage/ledger-store.test.ts` | WP-001 |
| `mcp-server/tests/schema/validators.test.ts` | WP-001 |
| `mcp-server/src/tools/work-package.ts` | WP-002 |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-002 |
| `mcp-server/docs/agents/project-manifest/constraints.md` | WP-003 |
| `README.md` | WP-004 |
| `personas/docs/agents/project-manifest/constraints.md` | WP-004 |
| `mcp-server/docs/agents/project-manifest/tech-stack.md` | WP-004 |

### New Files

| File | WP |
|------|----|
| `.githooks/pre-commit` | WP-004 |
| `scripts/install-hooks.js` | WP-004 |

---

## Assumptions

- `'Developer'` is the correct canonical replacement for `'Developer Agent'` in `assigned_to` fixtures, consistent with `AGENT_ROLES` in `constants.ts`.
- The `agent:` field in `project_comments` (`full-workflow.test.ts:717`) is deliberately free-text and does not require updating.
- A lean `.githooks/` shell script is preferred over installing Husky or lefthook due to the absence of a root `package.json`.
- The `scripts/install-hooks.js` helper uses top-level `import` (ESM), consistent with the existing scripts in `scripts/`.

---

## Constraints

- All changes in WP-001 must leave the four out-of-scope strings untouched (prose test descriptions, `.toContain()` assertion, comment `agent:` field).
- WP-002 must not change the function signatures of `propagateDependencyUnblock` or `propagateDependencyReblock`.
- WP-003 must not alter constraint numbering, content, or the `---` separator structure.
- WP-004 must not require changes to `mcp-server/package.json` or `personas/package.json`.
- All WPs must leave the test suite at 982+ passing, 0 failing.

---

## Out of Scope

- Converting `WorkPackageSummarySchema.assigned_to` from `z.string()` to `z.enum(AGENT_ROLES)` at the Zod schema level — a meaningful behavioral change requiring its own planning cycle.
- Updating `ProjectCommentSchema.agent` to `z.enum(AGENT_ROLES)` — the field is intentionally free-text.
- Adding test coverage for `resolveStore()` beyond what existing tests for `propagateDependencyUnblock` / `propagateDependencyReblock` already provide.
- Adding CI pipeline integration (GitHub Actions) for either persona freshness or test runs.

---

## Acceptance Criteria

### WP-001
- `grep -rn "assigned_to.*Developer Agent" mcp-server/tests/` returns 0 matches.
- `grep -n "can only be started by the Developer agent" mcp-server/tests/tools/start-pipeline-guards.test.ts` still returns 1 match (untouched).
- `grep -n "accepts Developer agent" mcp-server/tests/tools/work-package.test.ts` still returns 1 match (untouched).
- `npm test` in `mcp-server/` passes with 0 failures.

### WP-002
- `propagateDependencyUnblock` and `propagateDependencyReblock` each contain a single `const store = resolveStore(...)` call replacing the old 3-line ternary.
- A private `resolveStore()` function exists in `work-package.ts` with the correct signature.
- `npm test` passes with 0 failures.
- `api-surface.md` documents `resolveStore()` as a private internal helper.

### WP-003
- `constraints.md` sequential order is: ...#58 → #59 → #60 → `## Runtime Config Monitoring`.
- Constraint #60 no longer appears between #32 and #33.
- Content, numbering, and all `---` separators are unchanged.

### WP-004
- `.githooks/pre-commit` exists, is executable, and runs `node scripts/build-personas.js --check`.
- Running `.githooks/pre-commit` with a stale persona exits non-zero.
- `scripts/install-hooks.js` exists and successfully runs `git config core.hooksPath .githooks`.
- Root `README.md` includes `node scripts/install-hooks.js` in the development setup instructions.
- `personas/docs/agents/project-manifest/constraints.md` contains a new constraint documenting the hook requirement.
- `mcp-server/docs/agents/project-manifest/tech-stack.md` references both the `pretest` and pre-commit guard levels.

---

## Testing Strategy

Testing is regression-centric: the existing 982-test suite in `mcp-server/` provides full coverage for WP-001 and WP-002. WP-003 is a documentation-only change with no runtime side-effects; the QA agent should visually verify the constraint ordering. WP-004 is tested by manually triggering `.githooks/pre-commit` with both a clean and a stale persona state, confirming the exit code behaviour in each case.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **WP-001 touches the wrong string** (a prose description or `.toContain()` assertion) | The acceptance criteria include explicit grep checks for the 2 strings that must remain. The Developer must verify these before marking WP-001 COMPLETE. |
| **WP-002 breaks propagation behaviour** due to subtle differences in the two ternary blocks | Both blocks were confirmed identical by direct comparison (lines 925–927 vs. 993–995). If a future diff is found, abort the refactor and document in the error ledger. |
| **WP-003 cuts/pastes incorrectly**, losing the `---` separator or disrupting adjacent content | The Developer should diff the changed file after editing to confirm only the position of the #60 block changed. |
| **WP-004 `.githooks/pre-commit` not auto-enabled on clone** | This is by design — git hooks require opt-in. The `install-hooks.js` script and README notice are the expected mitigation. |
| **WP-004 `install-hooks.js` conflicts with existing `core.hooksPath`** | The script overwrites with `.githooks`; this is the only hook path in the repo. No existing configuration exists to conflict with. |
