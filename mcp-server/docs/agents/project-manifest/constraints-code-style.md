# Constraints — Code Style

> **Scope:** TypeScript authoring conventions — naming, loop style, compiler strictness, JSDoc
> requirements, Zod schema shape, and tool-registration patterns.
>
> **Companion documents:**
> [Core](constraints.md) ·
> [Workflow](constraints-workflow.md) ·
> [Testing](constraints-testing.md) ·
> [Storage & Knowledge](constraints-storage.md) ·
> [GUI](../../../gui/docs/agents/project-manifest/constraints.md)

## Contents

- [Test-Only Exports Must Use `_internal`](#test-only-exports-must-use-the-_internal-naming-convention)
- [Prefer `for-of` Loops Over Indexed `for` Loops](#prefer-for-of-loops-over-indexed-for-loops)
- [No Unused Locals](#no-unused-locals-nounusedlocals)
- [JSDoc Convention for Captured-Closure Variables](#jsdoc-convention-for-captured-closure-variables)
- [Pre-mutation State Capture in Lock Callbacks](#pre-mutation-state-capture-in-lock-callbacks)
- [`assigned_to` Requires a Canonical AgentRole](#assigned_to-requires-a-canonical-agentrole-project_commentsagent-does-not)
- [`project_path` Takes Precedence Over `cwd_path`](#project_path-takes-precedence-over-cwd_path)
- [No `.refine()` on Outer Tool Schemas](#do-not-use-refine-transform-or-superrefine-on-outer-tool-schemas)
- [MCP SDK Injects `RequestHandlerExtra`](#mcp-sdk-injects-requesthandlerextra--handler-registration-must-use-wrapper-functions)
- [Zod `.describe()` for Pipeline Types](#zod-describe-annotations-for-pipeline-type-must-use-describepipelinetypes)

---

### Test-Only Exports Must Use the `_internal` Naming Convention

**Rule:** Any module that exposes private symbols for unit testing must export them under a single named export called `_internal`. Do **not** introduce alternative names such as `_schemas`, `_test`, or `_utils`.

**Pattern:**
```typescript
/**
 * @internal — exported for unit testing only.
 */
export const _internal = {
  MyPrivateClass,
  MyInternalSchema,
  myHelperFunction,
};
```

**Rationale:** Consistency and grep-ability. A single naming convention makes it trivial to audit test-only surface (`grep -r '_internal'`) and eliminates `_schemas` / `_test` divergence.

**Enforcement:** Do not re-introduce `_schemas` or any alternate name.

---

### Prefer `for-of` Loops Over Indexed `for` Loops

**Rule:** Use `for-of` loops for array iteration. Avoid `for (let i = 0; i < arr.length; i++)` indexed loops unless the index itself is required for logic, or a performance constraint is documented.

**When an indexed loop is unavoidable** (e.g. pairwise comparison where both `i-1` and `i` are needed), use non-null-asserted access (`arr[i]!`) with an inline comment explaining the in-bounds guarantee:

```typescript
// TypeScript is compiled with noUncheckedIndexedAccess so array[i] returns T | undefined.
// The loop invariant (i < arr.length) guarantees arr[i] is defined — safe to assert.
for (let i = 1; i < pipelines.length; i++) {
  const prev = pipelines[i - 1]!; // in-bounds: i >= 1
  const curr = pipelines[i]!;     // in-bounds: i < pipelines.length
}
```

**Context:** The project enables `noUncheckedIndexedAccess` in `tsconfig.json`. This means array element access returns `T | undefined`, which requires either a null-check or a `!` assertion. The `for-of` pattern avoids indexed access entirely and is therefore preferred.

---

### No Unused Locals (`noUnusedLocals`)

**Rule:** `tsconfig.json` enables `"noUnusedLocals": true`. Every import, variable, parameter, and type alias that is declared must be consumed within its file. Dead imports and unused variables are compile errors — fix, never suppress.

**Rationale:** Unused imports are structural noise left behind by refactors (e.g., when symbols move to a new module). They mislead agents and developers into thinking a dependency exists when it does not, and they obscure intent. The `noUnusedLocals` flag makes these errors hard build failures so they cannot accumulate silently.

**Anti-pattern:**
```typescript
// ❌ WRONG — AGENT_PIPELINE_MAP moved to workflow-next-action-batch.ts but was
// left in the import list of workflow-next-action.ts after a file-split refactor.
import {
  PIPELINE_TYPES,
  AGENT_PIPELINE_MAP,   // ← never referenced in this file
  type PipelineType,
} from '../utils/pipeline-maps.js';
```

**Correct pattern:**
```typescript
// ✅ CORRECT — only symbols actually used in this file are imported.
import {
  PIPELINE_TYPES,
  type PipelineType,
} from '../utils/pipeline-maps.js';
```

**Forbidden patterns:**
- Adding `// @ts-ignore` or `// eslint-disable` to suppress unused-local errors.
- Importing a symbol "for re-export" without an explicit re-export statement.
- Leaving a symbol in an import group after moving its last consumer to another file.

---

### JSDoc Convention for Captured-Closure Variables

**Rule:** When using the captured-closure pattern (an outer-scope `let` written inside a `withLock` / `updateWorkPackageWithSync` callback and read after the call returns), add a brief `// captured via closure in lock callback` inline comment on the `let` declaration.

**Example:**
```typescript
let autoFinalizeResult: 'finalized' | 'blocked' | null = null; // captured via closure in lock callback
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  // ... logic that may set autoFinalizeResult ...
  autoFinalizeResult = 'finalized';
  return { wp, root };
});
if (autoFinalizeResult === 'finalized') { /* ... */ }
```

**Rationale:** The pattern is non-obvious to contributors unfamiliar with the lock-callback design. Without the comment, reviewers may assume the variable is always `null` after the call — it is not; the callback executed synchronously within the lock and the `let` is live.

---

### Pre-mutation State Capture in Lock Callbacks

**Rule:** Any variable holding pre-mutation WP or root-index state that is needed **after** the `updateWorkPackageWithSync` callback must be declared with `let` in the **outer scope** and assigned inside the callback. Variables declared with `const` inside the callback are lexically scoped to that callback and are invisible at the call site.

**Anti-pattern:**
```typescript
// ❌ WRONG — const inside callback is NOT visible at the call site
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  const previousStatus = wp.status; // const → invisible outside callback
  wp.status = 'IN_PROGRESS';
  return { wp, root };
});
// TS2304: Cannot find name 'previousStatus'  ← compile error
console.log(previousStatus);
```

**Correct pattern:**
```typescript
// ✅ CORRECT — let declared in outer scope, assigned inside callback
let previousStatus = '';
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  previousStatus = wp.status; // assigns to outer-scope let
  wp.status = 'IN_PROGRESS';
  return { wp, root };
});
console.log(previousStatus); // ✅ 'READY' — visible after lock completes
```

**Rationale:** `updateWorkPackageWithSync` (and `withLock`) discard the callback's return value for the state-capture use case. Any data produced inside the callback that is needed after it completes must be captured via closure by assigning to an outer-scope `let` variable. This pattern appears throughout `work-package.ts` (e.g., `let createdWpId = ''` in `createWorkPackage`).

**Alternative correct pattern (`| undefined` union):** When the captured value has no meaningful zero value, use a `| undefined` union rather than a non-null assertion (`!`):

```typescript
// ✅ ALSO CORRECT — used in project-lifecycle.ts completeSynthesis
let result: { status: string } | undefined;
await withLock(store.storageDir, async () => {
  // ... read-modify-write ...
  result = { status: 'COMPLETE' };
});
if (!result) throw new Error('Expected result to be set inside lock');
// result is narrowed to { status: string } here
```

---

### `assigned_to` Requires a Canonical AgentRole; `project_comments.agent` Does Not

**Rule:** The `assigned_to` field on a work package (`WorkPackageSchema.assigned_to`) must be a value from the `AGENT_ROLES` constant (a validated `AgentRole` union). The `agent` field on a project-level comment (`ProjectCommentSchema.agent`) is typed as `z.string()` and is intentionally **not** constrained to `AGENT_ROLES`.

**Rationale:** `assigned_to` drives workflow routing, gate checks, and pipeline agent-map lookups — it must be a machine-readable canonical role value. `project_comments.agent` is a human-readable audit identifier; it records who wrote the comment as a narrative label, not as a workflow actor, so free-form strings are appropriate.

**Anti-pattern:**
```typescript
// ❌ WRONG — using a non-canonical value in the role-validated field
await claimWorkPackage({ ..., agent: "Developer Agent" });
// Zod rejects "Developer Agent" — not a member of AGENT_ROLES
```

**Correct pattern:**
```typescript
// ✅ CORRECT — canonical AgentRole value required for assigned_to/agent in claim
await claimWorkPackage({ ..., agent: "Developer" });

// ✅ ALSO CORRECT — free-text is acceptable in project_comments.agent
await addProjectComment({ ..., agent: "Developer Agent" });
```

**Forbidden patterns:**
- Using `"Developer Agent"` (or any multi-word variant) as the `agent` argument to `ledger_claim_work_package` or `ledger_start_pipeline`.
- Assuming `project_comments.agent` and `assigned_to` share the same validation rules — they do not.
- Hardcoding role strings anywhere other than constants. Use `AGENT_ROLES` entries or the `AgentRole` type for `assigned_to`-typed fields.

**Reference:** `AGENT_ROLES` is derived from `shared/workflow-manifest.json` (`roles[].name`) and re-exported from `src/utils/constants.ts`. `ProjectCommentSchema` is in `src/schema/validators.ts`. See [tech-stack.md — Architectural Pattern 10](tech-stack.md#10-manifest-derived-constants) for the full list of manifest-derived constants.

---

### `project_path` Takes Precedence Over `cwd_path`

**Rule:** When a caller supplies both `project_path` and `cwd_path`, `resolveProjectPath()` uses `project_path` and silently ignores `cwd_path`. Supplying both parameters is **not** an error. Do **not** add `.refine()`, `.transform()`, or `.superRefine()` to the outer `z.object()` of any tool schema to enforce exclusivity.

**Precedence rule (in `resolveProjectPath()`, `src/utils/project-resolver.ts`):**
1. If `project_path` is provided (truthy) → use it directly; `cwd_path` is ignored.
2. If only `cwd_path` is provided → auto-detect the active project from the workspace root.
3. If neither is provided → throw a missing-path error.

**Guidance for callers:**
- If you already have `project_path` (the plan folder path from a prior tool response), pass it — it is the fastest path with no auto-detection overhead.
- If you only know your workspace root, pass `cwd_path` and let the server detect the project.
- If you pass both, `project_path` wins; `cwd_path` is a no-op in that call.

**Enforcement:**
- `resolveProjectPath()` applies the precedence rule at the top of its body. Every tool handler that accepts both optional path fields calls it.
- The predicate `mutuallyExclusivePaths` and the constant `MUTUAL_EXCLUSIVITY_PATH_MSG` remain exported from `src/utils/path-validator.ts` for backward compatibility and test coverage. They are **not used in production tool files**.
- Schemas that only contain `project_path` (mandatory) or only `cwd_path` — but not both as optional fields — are exempt. `DetectProjectSchema`, `InitializeProjectSchema`, and `ListProjectsSchema` fall into this category.

**See also:** the general outer-schema rule below.

---

### Do Not Use `.refine()`, `.transform()`, or `.superRefine()` on Outer Tool Schemas

**Rule:** Never chain `.refine()`, `.transform()`, or `.superRefine()` on the outer `z.object({...})` schema passed as `inputSchema` to `server.registerTool()`. These methods convert a `ZodObject` into a `ZodEffects` wrapper, which the MCP SDK's JSON Schema converter cannot introspect — it emits `{ properties: {}, required: [] }` instead of the actual field list.

**Reason:** The MCP `tools/list` response uses the JSON Schema to populate the tool definition shown to AI clients. An empty `properties` object means the client cannot see any parameters, so agents cannot pass arguments to the tool. This bug silently affects all callers, including VS Code Copilot agent mode.

**Correct pattern:** Move cross-field validation inside the handler function (or a helper it calls, such as `resolveProjectPath()`):

```typescript
// ✅ CORRECT — plain ZodObject; SDK emits correct properties
const MyToolSchema = z.object({
  project_path: z.string().optional(),
  cwd_path: z.string().optional(),
});

async function myToolHandler(args: z.infer<typeof MyToolSchema>) {
  // Precedence enforced at runtime by resolveProjectPath()
  const projectPath = await resolveProjectPath(args);
  // ...
}
```

**Anti-pattern:**

```typescript
// ❌ WRONG — .refine() converts ZodObject → ZodEffects
// SDK emits { properties: {}, required: [] } — agent cannot pass arguments
const MyToolSchema = z.object({
  project_path: z.string().optional(),
  cwd_path: z.string().optional(),
}).refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });
```

**Exception:** Field-level `.refine()` applied to an individual field definition (e.g., `z.string().refine(...)`, `plan_file: z.string().refine(v => v === 'plan.md', ...)`) is safe — the outer `z.object()` remains a `ZodObject`.

**Regression guard:** `tests/tools/schema-integrity.test.ts` converts every registered tool schema to JSON Schema and asserts non-empty `properties`. This test fails if a `.refine()` / `.transform()` / `.superRefine()` is re-added to any outer schema.

---

### MCP SDK Injects `RequestHandlerExtra` — Handler Registration Must Use Wrapper Functions

**Rule:** Every internal tool handler that has a second positional parameter (`_ledgerRoot?: string`) **must** be registered via an arrow-function wrapper, **not** passed directly as the handler. Additionally, each such handler **must** apply a defensive type guard before using `_ledgerRoot`.

**Root cause:** The MCP SDK (v1.0.4+) calls every registered tool handler as `typedHandler(args, extra)` where `extra` is a `RequestHandlerExtra`. If the handler has a second positional parameter (`_ledgerRoot?: string`), the `extra` object is captured by it. Because `extra` is truthy, `_ledgerRoot ?? projectPath` resolves to the `extra` object, causing downstream `path.join()` calls to throw:
```
TypeError: The "path" argument must be of type string. Received an instance of Object
```

**Two-layer defence:**

*Layer 1 — Registration wrapper (primary):*
```typescript
// ✅ CORRECT — extra never reaches the internal handler
server.registerTool('ledger_create_work_package', { ... }, (args) => createWorkPackage(args));

// ❌ WRONG — extra leaks into _ledgerRoot
server.registerTool('ledger_create_work_package', { ... }, createWorkPackage as any);
```

*Layer 2 — Defensive type guard inside the handler (secondary):*
```typescript
async function createWorkPackage(args: ..., _ledgerRoot?: string) {
  // ✅ Guard against the MCP SDK injecting a RequestHandlerExtra object
  const ledgerRoot = typeof _ledgerRoot === 'string' ? _ledgerRoot : undefined;
  // Use ledgerRoot throughout — never use _ledgerRoot directly after this line
}
```

**Affected handlers (both layers applied):** `createWorkPackage`, `claimWorkPackage`, `updateWorkPackageStatus`, `resetReworkCount`, `updateAcceptanceCriteria` (all in `src/tools/work-package.ts`), and `completeSynthesis` (`src/tools/project-lifecycle.ts`).

**Why single-argument handlers are unaffected:** Handlers with only one parameter (`initializeProject`, `getProjectStatus`, etc.) silently ignore any surplus arguments passed by the SDK — `extra` is discarded before it can cause harm.

**Rationale:** A bug introduced when the SDK began passing `extra` went undetected because all unit tests call internal functions directly with an explicit string `_ledgerRoot`. The registration layer, where the SDK's extra injection occurs, had no test coverage. The two-layer defence ensures correctness both at the registration boundary and inside the function itself.

---

### Zod `.describe()` Annotations for Pipeline Type Must Use `describePipelineTypes()`

**Rule:** All Zod `.describe()` strings that enumerate pipeline type values MUST be generated by calling `describePipelineTypes(prefix)` from `src/utils/pipeline-maps.ts`. Hardcoding a pipeline type list inline in a `.describe()` string is forbidden.

**Rationale:** `PIPELINE_TYPES` is the single source of truth for the canonical pipeline type list. Hardcoded `.describe()` strings drift silently when a new pipeline type is added — as demonstrated when `observations.ts` still listed only the original four types after `security-audit` and `release-engineering` were introduced. `describePipelineTypes()` derives the annotation from `PIPELINE_TYPES` at schema definition time, so any future addition propagates automatically to all MCP JSON Schema annotations.

❌ **Anti-pattern:**
```typescript
PipelineTypeEnum.describe('Pipeline type: "implementation", "qa", "code-review", "documentation"')
```

✅ **Correct pattern:**
```typescript
import { describePipelineTypes } from '../utils/pipeline-maps.js';
// ...
PipelineTypeEnum.describe(describePipelineTypes('Pipeline type:'))
```

**Enforcement:** A drift-detection test in `tests/utils/pipeline-maps.test.ts` asserts that the output of `describePipelineTypes()` contains every entry in `PIPELINE_TYPES` — future additions that are not reflected in the helper are caught automatically.
