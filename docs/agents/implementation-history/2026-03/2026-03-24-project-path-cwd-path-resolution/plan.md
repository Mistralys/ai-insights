# Plan: Eliminate `project_path` / `cwd_path` confusion permanently

## Summary

Agents (both LLM-driven and orchestrator-automated) regularly confuse `project_path` and `cwd_path`, leading to mutual-exclusivity rejections at runtime. The root cause is a leaky abstraction: two parameters that serve a single purpose (identify the active project) are exposed to callers who don't understand (or shouldn't need to understand) the difference.

This plan proposes a **server-side resolution** strategy: make `resolveProjectPath()` tolerant of receiving both parameters simultaneously — instead of rejecting, it applies a deterministic precedence rule — and improve tool schema descriptions so agents stop passing both in the first place.

## Architectural Context

### Current Design

- **`project_path`** = absolute path to the plan folder (e.g., `/path/to/docs/agents/plans/2026-02-16-feature`). The agent must already know the exact plan directory.
- **`cwd_path`** = the agent's workspace root. The MCP server auto-detects which project it belongs to via `LedgerStore.detectProjectByCwd()`.
- **16 tools** accept both (optional, mutually exclusive). **1 tool** (`ledger_initialize_project`) accepts only `project_path` (required). **1 tool** (`ledger_detect_project`) accepts only `cwd_path`.
- **Mutual exclusivity** is enforced at runtime in `resolveProjectPath()` (`mcp-server/src/utils/path-validator.ts`, line 70–72) — not via Zod `.refine()` (which would break MCP schema introspection).
- **Orchestrator safety net** (`orchestrator/src/utils/tool_wrappers.py` → `inject_project_path()`) strips `cwd_path` and injects `project_path` via `setdefault` — acting as a layer 2 fallback.

### The Problem

1. **Tool descriptions tell agents to prefer `cwd_path`** ("Your workspace root directory — preferred"), but orchestrator agents are told to use `project_path`. This contradictory guidance causes LLMs to pass both.
2. **The mutual-exclusivity rejection is unnecessarily strict.** When both are provided and agree (i.e., `cwd_path` resolves to the same project as `project_path`), the server should just use `project_path` and ignore `cwd_path`. 
3. **Previous orchestrator fix (commit 4343f17)** introduced `cwd_path` injection alongside `project_path`, triggering the very guard it was supposed to work with.
4. **The orchestrator wrapper is a bandaid** — it fixes orchestrator-driven calls but doesn't help IDE agents who pass both parameters directly to the MCP server.

### Key Files

| File | Role |
|------|------|
| `mcp-server/src/utils/path-validator.ts` | `resolveProjectPath()` — mutual exclusivity guard + path resolution |
| `mcp-server/src/tools/project-lifecycle.ts` | `ledger_initialize_project` (only `project_path`), `ledger_detect_project` (only `cwd_path`), `ledger_get_project_status`, `ledger_complete_synthesis` |
| `mcp-server/src/tools/work-package.ts` | 7 tools with both params |
| `mcp-server/src/tools/pipeline.ts` | 4 tools with both params |
| `mcp-server/src/tools/observations.ts` | 2 tools with both params |
| `mcp-server/src/tools/begin-work.ts` | 1 tool with both params |
| `mcp-server/src/tools/workflow-handoff.ts` | 1 tool with both params |
| `mcp-server/src/tools/workflow-next-action.ts` | 1 tool with both params |
| `mcp-server/src/tools/help-content.ts` | Help text explaining parameter semantics |
| `orchestrator/src/utils/tool_wrappers.py` | `inject_project_path()` — strips `cwd_path`, injects `project_path` |
| `mcp-server/tests/utils/path-validator.test.ts` | Tests for `resolveProjectPath()` |
| `orchestrator/tests/test_tool_wrappers.py` | Tests for `inject_project_path()` |

## Approach / Architecture

### Strategy: Precedence over rejection

**Replace the mutual-exclusivity guard with a deterministic precedence rule:**

> When both `project_path` and `cwd_path` are provided, `project_path` wins. `cwd_path` is silently ignored.

This is the only safe default because:
- `project_path` is the more specific value (exact plan folder path).
- `cwd_path` is a convenience shortcut that resolves to a `project_path` anyway.
- If both are provided, the caller *clearly* knows the project path — `cwd_path` is redundant noise.

### Three-Layer Solution

**Layer 1 — MCP Server (`resolveProjectPath()`):** Remove the throw. When both are provided, use `project_path`, ignore `cwd_path`. Log a deprecation-style warning in the response metadata (not an error).

**Layer 2 — Tool Schema Descriptions:** Improve `.describe()` text on all 16 tool schemas to explicitly say "Do NOT pass both" and clarify the two use cases more crisply. This reduces the probability of agents passing both.

**Layer 3 — Orchestrator Wrapper:** Keep the `cwd_path` stripping behavior (belt-and-suspenders), but the MCP server no longer errors out if it fails to strip.

### Out-of-scope alternative: Merge into a single parameter

Merging `project_path` and `cwd_path` into a single `path` parameter was considered but rejected:
- It would be a breaking API change for all persona instructions, all tests, and all orchestrator wrappers.
- The two params serve genuinely different resolution paths: `project_path` is a direct lookup, `cwd_path` triggers auto-detection with possible `AMBIGUOUS` results.
- A single `path` parameter would need heuristic detection (is this a plan folder or a workspace root?) — more complex, more fragile.

## Rationale

- **Robustness over strictness.** The mutual-exclusivity guard was defensive, but in practice it only catches accidental misuse — and then punishes it with a hard failure. A precedence rule achieves the same safety with zero downtime.
- **Server-side fix is exhaustive.** Fixing only the orchestrator wrapper leaves IDE agents vulnerable. Fixing the server covers all callers.
- **Backward-compatible.** No parameter is removed, no schema changes, no breaking change for any consumer.

## Detailed Steps

### Step 1: Change `resolveProjectPath()` to use precedence instead of rejection

**File:** `mcp-server/src/utils/path-validator.ts`

Replace lines 70–72:
```typescript
// Mutual exclusivity guard
if (args.project_path && args.cwd_path) {
  throw new Error(MUTUAL_EXCLUSIVITY_PATH_MSG);
}
```

With:
```typescript
// Precedence rule: project_path wins when both are provided.
// cwd_path is silently ignored — project_path is the more specific value.
// (Previously this was a hard rejection, but agents frequently pass both.)
if (args.project_path) {
  planFolderBasename(args.project_path);
  return args.project_path;
}
```

This change also means the existing `if (args.project_path)` block (lines 74–77) becomes redundant and should be removed to avoid dead code. The combined flow becomes:

```typescript
export async function resolveProjectPath(args: {
  project_path?: string;
  cwd_path?: string;
  [key: string]: unknown;
}): Promise<string> {
  // Precedence rule: project_path wins when both are provided.
  // cwd_path is silently ignored since project_path is the more specific value.
  if (args.project_path) {
    planFolderBasename(args.project_path);
    return args.project_path;
  }

  if (args.cwd_path) {
    // ... (existing cwd_path resolution logic unchanged)
  }

  throw new Error('Either project_path or cwd_path is required.');
}
```

### Step 2: Update the `MUTUAL_EXCLUSIVITY_PATH_MSG` constant

The constant is exported for tests. It should be kept (not removed) but its role changes — it's no longer used at runtime but may still be referenced. Consider:
- **Option A:** Remove the constant entirely, update tests. (Clean but slightly larger diff.)
- **Option B:** Keep the constant exported but unused, with a comment. (Minimal diff.)

**Recommendation:** Option A — remove it. Dead code should not linger. Update the test that asserts the throw behavior.

### Step 3: Update `mutuallyExclusivePaths` helper

The backward-compat export `mutuallyExclusivePaths` in `path-validator.ts` is exported for tests only. Since the runtime no longer enforces mutual exclusivity, this function is dead code. Remove it, or keep it as a pure utility if any other test still uses it. Check usage.

### Step 4: Update tests in `mcp-server/tests/utils/path-validator.test.ts`

- Remove or rewrite the test: `'throws when both project_path and cwd_path are provided'`.
- Add a new test: `'uses project_path when both project_path and cwd_path are provided'` — assert that when both are provided, `resolveProjectPath()` returns the `project_path` value and does not call `LedgerStore.detectProjectByCwd`.

### Step 5: Improve tool schema `.describe()` texts

**For `project_path`** (all 16 tools):
```
Current:  'Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'
New:      'Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'
```

**For `cwd_path`** (all 16 tools):
```
Current:  'Your workspace root directory — preferred. The server auto-detects the active project.'
New:      'Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'
```

This is a mass find-and-replace across 6 tool files. Each file uses the exact same description string for both parameters, making it a straightforward substitution.

### Step 6: Update help content

**File:** `mcp-server/src/tools/help-content.ts`

Update the help text paragraph that says _"Most tools accept either `cwd_path` or `project_path` — not both"_ to reflect the new precedence rule:

```
**Most tools accept `project_path` and/or `cwd_path`.** If you have `project_path` (the plan folder), use it — it's the fastest path. If you only know your workspace directory, pass `cwd_path` and the server auto-detects the active project. If you pass both, `project_path` takes precedence and `cwd_path` is ignored.
```

### Step 7: Update constraint documentation

**File:** `mcp-server/docs/agents/project-manifest/constraints.md`

Find the section about mutual exclusivity being enforced at runtime and update it to document the new precedence rule instead.

### Step 8: Orchestrator — keep existing `cwd_path` stripping (no change needed)

The `inject_project_path()` wrapper in `orchestrator/src/utils/tool_wrappers.py` already strips `cwd_path`. This remains correct — it's a belt-and-suspenders optimization that avoids even sending the redundant parameter. No code change is needed.

The wrapper's doc comment should be updated to mention that the MCP server now handles both gracefully, so the stripping is an optimization rather than a requirement.

### Step 9: Update orchestrator wrapper docstring

**File:** `orchestrator/src/utils/tool_wrappers.py`

Update the design notes comment block (lines 31–34) from:
```
strips it — most MCP tools enforce mutual exclusivity between
``project_path`` and ``cwd_path``.
```
To:
```
strips it for efficiency — the MCP server now handles both gracefully
(``project_path`` takes precedence), but stripping avoids sending
redundant data.
```

### Step 10: Run test suites

- `cd mcp-server && npx vitest run tests/utils/path-validator.test.ts`
- `cd mcp-server && npx vitest run` (full suite to catch regressions)
- `cd orchestrator && .venv/bin/pytest tests/test_tool_wrappers.py -v`

## Dependencies

- Step 1 must complete before Steps 2–4 (they modify the same file and tests).
- Steps 5–7 are independent of Steps 1–4 (schema descriptions, help text, docs).
- Step 9 is independent of all other steps.
- Step 10 depends on all other steps being complete.

## Required Components

### Modified files
- `mcp-server/src/utils/path-validator.ts` — core fix (Steps 1–3)
- `mcp-server/tests/utils/path-validator.test.ts` — test updates (Step 4)
- `mcp-server/src/tools/begin-work.ts` — description update (Step 5)
- `mcp-server/src/tools/observations.ts` — description update (Step 5)
- `mcp-server/src/tools/pipeline.ts` — description update (Step 5)
- `mcp-server/src/tools/project-lifecycle.ts` — description update (Step 5)
- `mcp-server/src/tools/work-package.ts` — description update (Step 5)
- `mcp-server/src/tools/workflow-handoff.ts` — description update (Step 5)
- `mcp-server/src/tools/workflow-next-action.ts` — description update (Step 5)
- `mcp-server/src/tools/help-content.ts` — help text update (Step 6)
- `mcp-server/docs/agents/project-manifest/constraints.md` — docs update (Step 7)
- `orchestrator/src/utils/tool_wrappers.py` — docstring update (Step 9)

### No new files needed

## Assumptions

- The precedence rule (`project_path` wins) is the universally correct behavior. There is no scenario where a caller has a valid `project_path` but wants the server to ignore it and use `cwd_path` instead.
- The `mutuallyExclusivePaths` export is only used in tests (verify before removing).
- The schema description strings are identical across all 16 tools (confirmed by grep).

## Constraints

- **No Zod `.refine()` on outer schemas.** The existing constraint (to avoid `ZodEffects` breaking MCP introspection) remains intact. This plan does not touch Zod schemas beyond `.describe()` text.
- **Cross-platform: no impact.** This plan only changes runtime logic and string constants — no file system, path separator, or platform-specific concerns.
- **Backward compatible.** No parameter is removed, renamed, or made required/optional differently. Existing callers that pass only `project_path` or only `cwd_path` see zero behavior change.

## Out of Scope

- Merging `project_path` and `cwd_path` into a single `path` parameter (too large a breaking change).
- Removing `cwd_path` from tool schemas entirely (valid use case for IDE agents who don't know the plan path).
- Changes to persona instructions or prompt templates (the server-side fix should make these unnecessary).

## Acceptance Criteria

1. `resolveProjectPath({ project_path: 'valid', cwd_path: 'any' })` returns `'valid'` without throwing.
2. `resolveProjectPath({ project_path: 'valid' })` still works as before.
3. `resolveProjectPath({ cwd_path: 'valid' })` still auto-detects as before.
4. `resolveProjectPath({})` still throws "Either project_path or cwd_path is required."
5. All existing MCP server tests pass (no regressions).
6. Orchestrator `inject_project_path` tests still pass.
7. Tool schema descriptions clearly document the precedence rule.
8. Help text and constraint docs are updated.

## Testing Strategy

- **Unit tests:** Update `path-validator.test.ts` to test the new precedence behavior.
- **Regression tests:** Full vitest run ensures no tool broke.
- **Orchestrator tests:** `pytest test_tool_wrappers.py` confirms the wrapper still works.
- **Manual smoke test:** Run an orchestrator pipeline end-to-end to verify no mutual-exclusivity errors appear.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Silent data mismatch** — `project_path` and `cwd_path` point to different projects, but `project_path` wins silently | Acceptable: `project_path` is always the more authoritative value. If a caller passes the wrong `project_path`, that's a bug regardless of `cwd_path`. We could add an optional validation that `cwd_path` resolves to the same project as `project_path`, but this adds latency and complexity for a marginal benefit. |
| **Dead code left behind** — removing `MUTUAL_EXCLUSIVITY_PATH_MSG` and `mutuallyExclusivePaths` might break external references | Grep for all usages before removal. Both are only used in test files within this repo. |
| **Schema description changes confuse agents mid-session** — IDE agents cache tool schemas at session start | New sessions get the correct descriptions. Mid-session agents are unaffected since the server now tolerates both params. |
