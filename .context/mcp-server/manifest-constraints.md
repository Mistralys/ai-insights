# MCP Server - Manifest (Constraints)
<INSTRUCTION>
# MCP Server - Manifest: Constraints
Architectural invariants, naming conventions, status transition rules, and known limitations. Read this before making any changes to the MCP server.
Constraints are split by domain: constraints.md (core infrastructure), -workflow, -testing, -code-style, -storage, plus the GUI's own document.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: Core, workflow, testing, code-style, and storage constraints_
# Core, workflow, testing, code-style, and storage constraints
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── project-manifest/
                └── constraints-code-style.md
                └── constraints-storage.md
                └── constraints-testing.md
                └── constraints-workflow.md
                └── constraints.md

```
###  Path: `/mcp-server/docs/agents/project-manifest/constraints-code-style.md`

```md
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

```
###  Path: `/mcp-server/docs/agents/project-manifest/constraints-storage.md`

```md
# Constraints — Storage, Knowledge & Multi-Store

> **Scope:** The knowledge store, the multi-store ledger architecture, schema-strictness patterns
> that span both, and the storage-layer known limitations.
>
> **Companion documents:**
> [Core](constraints.md) ·
> [Workflow](constraints-workflow.md) ·
> [Testing](constraints-testing.md) ·
> [Code Style](constraints-code-style.md) ·
> [GUI](../../../gui/docs/agents/project-manifest/constraints.md)

## Contents

- [Knowledge Store Constraints](#knowledge-store-constraints)
- [Schema Strictness Patterns](#schema-strictness-patterns)
- [Multi-Store Architecture Constraints](#multi-store-architecture-constraints)
- [Known Limitations](#known-limitations)

---

## Knowledge Store Constraints

### Insight IDs Are UUID v4 Strings — Not Auto-Increment Integers

**Rule:** Every insight stored in the knowledge base has an `id` field that is a **UUID v4 string** generated via `crypto.randomUUID()` at creation time. The old auto-increment `next_id` counter no longer exists in `KnowledgeStoreSchema`. IDs are globally unique across all stores and all scopes.

**Rationale:** Auto-increment integers were per-store only — the same numeric `id` could appear in two independent stores, causing deduplication logic to discard valid insights on cross-store merge. UUID v4 eliminates this collision class without any coordination between stores.

**`moveInsight()` preserves the original UUID:** When an insight is promoted (`repository → global`) or moved (`global → repository` or `repository → repository`), the returned insight retains the source's `id` unchanged. No new UUID is assigned. Frontend consumers do not need to track a "pre-promote ID" to correlate with the post-move insight.

**`KnowledgeStoreSchema` does not include `next_id`:** Any store file containing a `next_id` field pre-dates the UUID migration. The schema no longer declares or persists it.

**`formatInsightId()` does not exist:** The helper that produced `KN-NNNN` / `{storeId}:KN-NNNN` display strings has been removed from `src/tools/knowledge.ts`. Tool responses do not include a `formatted_id` field.

**`parseKnowledgeId()` validates UUID format:** The `parseKnowledgeId(raw)` helper in `gui/api-knowledge.ts` validates UUID v4 format (via `z.string().uuid()`), not positive-integer format.

**Anti-patterns:**
```typescript
// ❌ WRONG — using store.next_id as insight ID (removed field)
const insight = { id: store.next_id++, ...fields };

// ❌ WRONG — treating id as a number
const found = store.insights.find(i => i.id === 42);
```

**Correct patterns:**
```typescript
// ✅ CORRECT — assign UUID at creation
import { randomUUID } from 'crypto';
const insight = InsightSchema.parse({ id: randomUUID(), ...fields });

// ✅ CORRECT — locate by UUID string
const found = store.insights.find(i => i.id === '550e8400-e29b-41d4-a716-446655440000');

// ✅ CORRECT — moveInsight() preserves UUID
const moved = await manager.moveInsight(insight.id, { scope: 'repository', repository_name: 'my-repo' }, 'global');
// moved.id === insight.id  ← same UUID
```

---

### `'global'` Is a Reserved Repository Name

**Rule:** The string `"global"` MUST NOT be used as a `repository_name` when adding or moving a repository-scoped insight. Calling `addInsight` or `repositoryStorePath()` with `repository_name === 'global'` throws an error.

**Rationale:** The global knowledge store file is named `global-insights.json`. If a repository were also named `"global"`, its store file would collide with the global store, corrupting both.

**Enforcement:** `KnowledgeStoreManager.repositoryStorePath(repoName)` throws `Error('Repository name "global" is reserved...')` when `repoName === 'global'`. This is the only enforcement point — the Zod `InsightSchema` and the MCP tool input schemas do NOT validate the reserved name; the guard is storage-layer-only.

**Anti-pattern:**
```typescript
// ❌ WRONG — 'global' is reserved; this will throw at the storage layer
await manager.addInsight({ scope: 'repository', repository_name: 'global', ... });
```

**Correct pattern:**
```typescript
// ✅ CORRECT — use a real repository name (e.g. derived from repo root dir basename)
await manager.addInsight({ scope: 'repository', repository_name: 'my-repo', ... });

// ✅ CORRECT — to add cross-repository knowledge, use global scope instead
await manager.addInsight({ scope: 'global', ... });
```

---

### `origin_plan` Is Provenance Metadata Only — Not a Storage Key

**Rule:** The `origin_plan` field on an `Insight` is strictly a provenance annotation — it records which plan folder produced the insight. It MUST NOT be used as a storage discriminator, a routing key, or a scope identifier. The two valid storage scopes are `'global'` and `'repository'`; there is no `'project'` scope and `origin_plan` does not create one.

**Rationale:** A previous design used a `'project'` scope (with `project_slug` as the store key) that conflated storage location with planning provenance. The current design separates these concerns: `scope` + `repository_name` determine where an insight is stored; `origin_plan` records where it was first discovered, regardless of where it is stored.

**Forbidden patterns:**
- Using `origin_plan` as a scope value (e.g. `scope: origin_plan`) ❌
- Using `origin_plan` as a `repository_name` discriminator ❌
- Passing `origin_plan` to any store-selection method (`searchInsights`, `listInsights`, `updateInsight`, `deleteInsight`) as a filter ❌
- Treating `origin_plan` as equivalent to `project_slug` in the sense of defining a per-project store ❌

**Correct usage:**
```typescript
// ✅ CORRECT — origin_plan is metadata only; scope + repository_name determine storage
await manager.addInsight({
  scope: 'repository',
  repository_name: 'ai-insights',       // storage key — where it lives
  origin_plan: '2026-05-01-my-feature', // provenance — where it was discovered
  title: '...',
  // ...
});
```

---

### `.knowledge/` Uses a Single Lock Scope; Excluded from Project Enumeration

**Rule:** All write operations on the `.knowledge/` store (`addInsight`, `updateInsight`) MUST acquire a single `withLock(knowledgeDir(), ...)` scope that covers the entire read-modify-write sequence. Pure reads (`searchInsights`, `listInsights`) do NOT acquire a lock, consistent with the `LedgerStore` read pattern. The `.knowledge/` directory lives at `{ledgerRoot}/.knowledge/` and MUST NOT be included in project enumeration (`listAllProjects`, `detectProjectByCwd`) — it is global infrastructure, not a per-project ledger.

**Rationale:** Using a single lock on `knowledgeDir()` (rather than per-file locks) prevents concurrent writers from interleaving across `global-insights.json` and `{repository_name}-insights.json` stores. Excluding `.knowledge/` from project enumeration prevents it from being misidentified as a project directory.

**Lock target:** Always `knowledgeDir()` — never a per-file path and never `store.storageDir` (that is the per-project lock target, not the knowledge store lock target).

**Anti-pattern:**
```typescript
// ❌ WRONG — separate lock per store file; concurrent writers can interleave
await withLock(globalStorePath(), async () => { /* write global store */ });
await withLock(projectStorePath(slug), async () => { /* write project store */ });
```

**Correct pattern:**
```typescript
// ✅ CORRECT — single lock on the knowledge directory for any write operation
await withLock(knowledgeDir(), async () => {
  const store = await _readStore(storePath);
  // ... mutate store ...
  await atomicWriteJson(storePath, store);
});
```

**Project enumeration exclusion:** `LedgerStore.listAllProjects()` reads `readdir(ledgerRoot)` and filters to subdirectories. The `.knowledge` entry is excluded by the existing filter that skips dot-prefixed entries — no additional code change is required. This constraint documents the expected behaviour so it is preserved if the filter is ever modified.

---

### Queue-Entry Path Segments Must Be Validated at Two Layers

**Rule:** Any code path that constructs a filesystem path from a queue-entry `slug` or `expectedRepo` field **must** apply `assertSafeSegment()` validation **before** passing those values to `join()` or any file-system API. Validation must occur at **both** of the following layers:

1. **Type-guard layer — `isRawQueueEntry()` in `validate-entry.ts`:**
   Normalizes `expectedRepo` to `null` in-place when the value is absent, not a string, or an empty/whitespace-only string (`.trim().length === 0`). This ensures every validated `RawQueueEntry` carries `expectedRepo: string | null` with no empty strings downstream.

2. **Call-site layer — `getProjectLedgerStatus()` in `get-queue.ts`:**
   Calls `assertSafeSegment(slug)` (always) and `assertSafeSegment(expectedRepo)` (when non-null) immediately before any `join()` call. Returns `{ exists: false, synthesisGenerated: false }` (fail-safe) when either check fails.

**Rationale:** The two-layer approach is necessary because `getProjectLedgerStatus()` is also called directly by `killQueueEntry()` and `dismissQueueEntry()` in `orchestrator-manager.ts`. Future call sites that bypass `isRawQueueEntry()` would have no path-segment protection without the second layer. The call-site guard is cheap (one regex test) and eliminates the need for callers to reason about whether their entry arrived via the type guard.

**Fail-safe defaults:**
- `isRawQueueEntry()` normalizes silently to `null` — the entry remains valid for other fields.
- `getProjectLedgerStatus()` returns `{ exists: false, synthesisGenerated: false }` on any assertion failure — the safe direction; entries are not displayed as active.

**Anti-pattern:**
```typescript
// ❌ WRONG — constructs a path directly from a queue-entry field without validation
const ledgerPath = join(ledgerRoot, entry.expectedRepo!, entry.expectedSlug, 'project-ledger.json');
```

**Correct pattern:**
```typescript
// ✅ CORRECT — assertSafeSegment() guards before any join()
if (!assertSafeSegment(slug)) {
  return { exists: false, synthesisGenerated: false };
}
if (expectedRepo !== null && !assertSafeSegment(expectedRepo)) {
  return { exists: false, synthesisGenerated: false };
}
const ledgerPath = expectedRepo
  ? join(ledgerRoot, expectedRepo, slug, 'project-ledger.json')
  : join(ledgerRoot, slug, 'project-ledger.json');
```

**`assertSafeSegment()` rejects:** uppercase letters, path separators (`/`, `\`), traversal sequences (`..`), null bytes, Unicode lookalikes, empty strings, and whitespace-only strings (SAFE_SLUG_REGEX anchor `^[a-z0-9]` + Boolean guard).

**See also:** [Ledger Storage Paths Must Include the Repository Namespace Level](constraints.md#ledger-storage-paths-must-include-the-repository-namespace-level); `api-surface.md` §`assertSafeSegment` (canonical validation delegate).

---

## Schema Strictness Patterns

### Dual-Schema Pattern — Strict Input Schemas, Permissive Storage Schemas

**Rule:** Input schemas (tool parameters) enforce strict contracts (required, non-nullable, min-length). Storage schemas (persisted JSON) declare the same fields as `.nullable().optional()` for backward compatibility with records created before the field existed. Bridge logic uses key-presence checks (`'field' in cacheUpdates`) to distinguish "not provided" from "explicitly null".

**Rationale:** Legacy records must parse without migration. New tool calls must enforce quality. The two concerns require different schema strictness levels — combining them into one schema satisfies neither.

**Canonical example:** `CompleteSynthesisSchema.outcome_summary` is `z.string().min(10)` (input); `ProjectMetaSchema.outcome_summary` is `z.string().nullable().optional()` (storage).

**Second instance:** `InitializeProjectSchema.project_summary` is `z.string().trim().min(1)` (input, optional — absent is valid but an empty or whitespace-only string is not); `RootIndexSchema` and `ProjectMetaSchema` declare it as `z.string().nullable().optional()` (storage). Bridge logic in `initializeProject()` uses a conditional spread to omit the field entirely when not provided. `InitializeProjectSchema.title` and `ImportStandaloneSchema.title` follow the same input shape (`z.string().trim().min(1).max(200)`), and `title` was extended onto `RootIndexSchema` (`.nullable().optional()`) to close a resilience gap where `title` previously reached only `.meta.json` and was lost if enrichment failed.

**Nullable/non-nullable pairing gotcha:** `RootIndexSchema.title` is nullable for shape parity with `project_summary`, but `MetaCacheUpdates.title` is intentionally non-nullable (no "clear title" use case). The auto-sync bridge in `writeRootIndex()` must coalesce a theoretical `null` to `undefined` rather than propagate it — watch for the same mismatch if a future field is added to both schemas with differing nullability.

**Anti-pattern:**
```typescript
// ❌ WRONG — using .optional() on an input schema to avoid handling legacy data;
// this shifts the quality gate to runtime callers and allows degenerate input through.
outcome_summary: z.string().optional()
```

**Correct pattern:**
```typescript
// ✅ CORRECT — input schema is strict; storage schema is permissive; bridge uses key-presence check.
// Input schema (tool parameters):
outcome_summary: z.string().min(10)

// Storage schema (persisted JSON):
outcome_summary: z.string().nullable().optional()

// Bridge logic (writeProjectMeta):
if ('outcome_summary' in cacheUpdates) {
  updates.outcome_summary = cacheUpdates.outcome_summary;
}
```

---

### Graceful Degradation — `@remarks` Fallback Contract for Optional Enrichment Paths

**Rule:** Any function that provides optional enrichment data (where absence is acceptable) must document its fallback behavior in a `@remarks` JSDoc block. The remark must state: (1) what conditions trigger the fallback, (2) what value is returned as the fallback, and (3) whether the fallback is silent or logged.

**Rationale:** Several components in the history system use this pattern (`loadRegistry`, `safeListRepositoryInsights`, the Planner workflow step). Without explicit documentation, future contributors may "fix" the silent degradation by throwing errors, breaking the enrichment-is-optional contract.

**Canonical examples:** `loadRegistry()` in `repository-registry.ts` (returns `{ repositories: [] }` on absent/corrupt file), `safeListRepositoryInsights()` in `repository-context.ts` (returns `[]` on SLUG_REGEX failure).

**Anti-pattern:**
```typescript
// ❌ WRONG — a function that degrades gracefully but documents only the success path in JSDoc.
/**
 * Returns the repository registry.
 */
async function loadRegistry(root: string): Promise<Registry> {
  try {
    return JSON.parse(await fs.readFile(registryPath(root), 'utf-8'));
  } catch {
    return { repositories: [] };
  }
}
```

**Correct pattern:**
```typescript
// ✅ CORRECT — @remarks block explicitly states fallback trigger, fallback value, and observability.
/**
 * Returns the repository registry.
 *
 * @remarks
 * Falls back to `{ repositories: [] }` when the registry file is absent or contains
 * invalid JSON. The fallback is silent (no log, no metric). Callers must treat an
 * empty `repositories` array as a valid state — the registry is optional enrichment.
 */
async function loadRegistry(root: string): Promise<Registry> {
  try {
    return JSON.parse(await fs.readFile(registryPath(root), 'utf-8'));
  } catch {
    return { repositories: [] };
  }
}
```

---

## Multi-Store Architecture Constraints

These constraints apply only when `stores.json` is present; its absence activates legacy single-store mode with no behavioral changes.

### `stores.json` Is Optional — Its Absence Means Legacy Single-Store Mode

**Rule:** When `~/.ai-insights/stores.json` does not exist, the server behaves exactly as before the multi-store architecture: `resolveLedgerRoot()` returns the single root, all reads and writes use it, and repository registration remains optional. No error is thrown, no migration is triggered, no behavior changes.

**Rationale:** Backward compatibility requires that existing single-store users be entirely unaffected.

**Implementation:** `loadStoresConfig()` returns `null` when the file is absent. Callers treat `null` as the signal to use legacy mode. `StoreRouter` in legacy mode delegates to `resolveLedgerRoot()`.

---

### Repository Registration Is Mandatory in Multi-Store Mode

**Rule:** When `stores.json` is present, creating a project in an unregistered repository is a hard error: `"Repository 'X' is not registered in any store. Register it via the GUI or CLI before creating projects."` The server never silently routes unregistered repositories to a default store in multi-store mode.

**Rationale:** Silent default-store routing causes "where did my project go?" confusion — a user who forgets to register before creating a project silently accumulates data in the wrong store. The registration error is one-time friction that prevents an ongoing class of misconfiguration.

**Exception:** In single-store mode, registration remains optional — no friction for users who do not need multi-store.

---

### Per-Store Registries — Each Store Owns Its `.repositories.json`

**Rule:** Repository metadata is stored in each store's own `.repositories.json` at `{storePath}/.repositories.json`. There is no central cross-store registry. The existing `RepositoryEntrySchema` is reused as-is; only the file location changes.

**Rationale:** Per-store registries make stores fully self-contained and portable — repository metadata travels with the store during sync. A central registry would require manual re-registration on every new device after syncing a store.

**Implementation:** `loadRegistry(storePath)` and `saveRegistry(storePath, data)` accept an explicit `storePath` parameter. In legacy mode, `storePath` defaults to `resolveLedgerRoot()`.

---

### Store-Order Priority Governs Write Routing

**Rule:** When multiple stores are configured, the **array order in `stores.json`** determines write priority. The first store whose `.repositories.json` claims a repository name is the write target for that repository. Reordering entries in `stores.json` changes which store wins.

**Rationale:** Store-order priority gives users a simple, controllable conflict-resolution mechanism. Earlier stores win — reorder to change priority.

**Implementation:** `StoreRouter.resolveStoreForWrite(repoName)` iterates stores in `stores.json` order, loading each store's `.repositories.json` until it finds one that claims the repo.

---

### Multi-Store Collation Is Read-Only

**Rule:** All cross-store operations (list projects, merge registries, detect project by cwd, search knowledge) are **read-only**. No write operation spans multiple stores. Each write is routed to exactly one store (the owning store, determined by `resolveStoreForWrite()`).

**Rationale:** Cross-store write operations require distributed locking or conflict detection, which adds significant complexity and failure modes. All writes remain within a single store's `withLock()` scope.

**Implementation:** `MultiStoreManager` provides only collation methods (`listAllProjects`, `getMergedRegistry`, `detectProjectByCwd`, `getRegistryConflicts`, `searchKnowledge`, `listKnowledge`). Write routing is exclusively the domain of `StoreRouter`.

---

### The MCP Server Has No Sync Responsibility

**Rule:** The MCP server reads and writes local JSON files only. It has no knowledge of Git, S3, Syncthing, or any other sync mechanism. Sync between store directories is entirely the user's responsibility and external to the MCP server's codepath.

**Rationale:** Keeping sync external eliminates an entire class of failure modes (network errors, auth failures, merge conflicts) from the MCP server. Users choose the sync strategy that suits their environment.

---

### Multi-Store Routing Requires No New Tool Parameters

**Rule:** No MCP tool exposes a `store_id` parameter. Store routing is implicit — derived from the repository name (via `deriveRepoName(projectPath)`), which is derived from the project path. Agents, orchestrator, and CLI tools require no new parameters to operate in multi-store mode.

**Rationale:** Adding a `store_id` parameter to every tool would burden every agent invocation and break backward compatibility. Implicit per-repo routing makes multi-store transparent to all existing tool consumers.

**Exception:** The GUI and CLI allow users to specify a target store when creating a new repository entry — a user-facing configuration action, not an agent tool call.

---

### `gui-config.json` Is Server-Wide — One File per Process, Not per Store

**Rule:** The GUI server uses a single `gui-config.json` for all behavioral settings (`auto_handoff_enabled`, `auto_archive_days`, etc.). In multi-store mode, this file lives at `~/.ai-insights/gui-config.json`. In single-store mode, it lives at `{ledgerRoot}/gui-config.json`. There is no per-store `gui-config.json`.

**Rationale:** All current config fields are server-wide behavioral settings with no store-scoped semantics. Per-store configs would create ambiguity about which store's config governs server behavior when multiple stores are active.

**Implementation:** `resolveGuiConfigPath(storeConfig, ledgerRoot)` in `src/storage/store-registry.ts` — returns the user-level path when `storeConfig` is non-null (multi-store), otherwise the ledger-root path.

---

### MCP Tool Handlers Must Use `resolveMultiStoreLedgerRoot()`

**Rule:** Every MCP tool handler function that constructs a `LedgerStore` must resolve the correct store root by calling `resolveMultiStoreLedgerRoot(projectPath, _ledgerRoot)` and passing the result to `new LedgerStore(...)`. Handlers that have a `_ledgerRoot` parameter (test-injection bypass) must pass that raw value as the second argument so the string-guard check inside `resolveMultiStoreLedgerRoot` can activate the test override.

The older `extractLedgerRoot(_ledgerRoot)` helper — which strips the `RequestHandlerExtra` object from the `_ledgerRoot` parameter but performs no store routing — is **not sufficient for multi-store mode** and must not be used when constructing a `LedgerStore` directly.

**Rationale:** `extractLedgerRoot` only guards against the MCP SDK injecting a `RequestHandlerExtra` object; it does not route the project to its owning store. In multi-store mode a handler that calls `new LedgerStore(projectPath)` or `new LedgerStore(extractLedgerRoot(_ledgerRoot))` silently falls through to the default store, causing reads and writes to target the wrong ledger directory for any project registered in a non-default store. `resolveMultiStoreLedgerRoot` subsumes the `extractLedgerRoot` guard (step 1 of its resolution order) and adds full store routing.

**Anti-pattern:**
```typescript
// ❌ WRONG — extractLedgerRoot bypasses store routing; projects in non-default stores
//            will be silently read/written from the default store.
const ledgerRoot = extractLedgerRoot(_ledgerRoot);
const store = new LedgerStore(ledgerRoot ?? projectPath);
```

**Correct pattern:**
```typescript
// ✅ CORRECT — resolveMultiStoreLedgerRoot routes to the owning store and subsumes
//              the extractLedgerRoot guard (test override is step 1 of resolution order).
const ledgerRoot = await resolveMultiStoreLedgerRoot(projectPath, _ledgerRoot);
const store = new LedgerStore(ledgerRoot ?? projectPath);
```

**Migration scope:** All affected handler functions in `work-package.ts`, `pipeline.ts`, `begin-work.ts`, `observations.ts`, `workflow-handoff.ts`, `workflow-next-action.ts`, and `project-lifecycle.ts` have been migrated. Any new handler added to these files — or any handler that previously called `extractLedgerRoot(_ledgerRoot)` directly — must apply the same 3-line pattern: import `resolveMultiStoreLedgerRoot`, await it with `(projectPath, _ledgerRoot)`, and pass the result as the first `LedgerStore` constructor argument.

**Write-routing exception:** Handlers that create new ledger state — currently `initializeProject()` (`project-lifecycle.ts`), `importStandalone()` (`standalone-import.ts`), and `createWorkPackage()` (`work-package.ts`) — must use the `resolveStoreForWrite()` pattern instead. This enforces that the target repository is registered in a store, preventing silent phantom directory creation in the default store. See `initializeProject()` for the reference pattern.

---

## Known Limitations

### KL-1. `'unknown'` Namespace Collision When Repo Root Fails Slug Validation

**Affected components:** `LedgerStore.storageDir` (via `deriveRepoName()` in `src/utils/ledger-root.ts`) and `migrateToNamespacedLayout()` (via the `repository_name` field in `.meta.json`)

**Trigger condition — `LedgerStore.storageDir`:** `deriveRepoName()` derives the repo name by lowercasing the project-root directory basename and delegates to `assertSafeSegment()` (which encapsulates `SAFE_SLUG_REGEX`) for validation. When a repo's root directory name contains characters that fail this check — dots (e.g. `my.project`), underscores, non-ASCII characters, or a path too shallow to extract four levels — `deriveRepoName()` falls back to `'unknown'`. If two or more such repos exist on the same machine, their projects share the `{ledgerRoot}/unknown/` namespace and can **collide by slug**.

**Trigger condition — `migrateToNamespacedLayout()`:** The migration function uses `repository_name` from each project's `.meta.json` as the namespace. If `repository_name` is absent, `null`, or an empty string, the project is moved to `{ledgerRoot}/unknown/{slug}/`. Additionally, if a user has a repository literally named `'unknown'` (a valid, slug-compatible name), its projects share the namespace with all fallback projects.

**Mitigation:** Rename the repository root directory to a slug-compatible name (lowercase alphanumeric and hyphens only, e.g. `My.Project` → `my-project`). This is the only reliable fix; there is no server-side escape hatch once two repos produce the same `repoName`. For the migration-layer scenario, also avoid naming a repository `'unknown'`.

**Detection:** Inspect `{ledgerRoot}/unknown/` — multiple slug subdirectories there indicate affected projects. Each `.meta.json` inside identifies the originating `plan_path`.

---

### KL-2. `auto-archive.ts` Multi-Store Guard Is Less Specific Than the GUI Guards

**Affected component:** `src/gui/auto-archive.ts`

**Divergence:** `auto-archive.ts` activates multi-store scanning with the guard `isStoreContextInitialized()` alone. All other multi-store guards in `gui/api.ts` (`resolveProjectStore`) and `gui/server.ts` (`resolveRepoName`, run-log routes) use the compound form `isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()`.

**Why it is functionally equivalent:** `StoreRouter.getAllStores()` called inside `getMultiStoreManager().listAllProjects()` returns a single-element array containing `resolveLedgerRoot()` when the router is in legacy mode (null config). Auto-archive therefore scans a single store in both single-store and multi-store mode — the behavior difference is invisible to the caller.

**Why it still matters:** Future contributors reading `auto-archive.ts` in isolation may assume the single-guard form has different intended semantics and introduce a behavioral divergence. Aligning `auto-archive.ts` to the compound guard form would remove the ambiguity.

---

### KL-3. `assertSafeSlug` Is Defined in Four Files, and One Does Not Delegate

**Affected components:** `src/utils/ledger-root.ts`, `src/utils/path-validator.ts` (the canonical delegate), `src/gui/handlers/run-log-handlers.ts`, `gui/api.ts`, and `gui/server.ts`

**Current state:** `assertSafeSlug` wrappers in `src/utils/ledger-root.ts`, `src/gui/handlers/run-log-handlers.ts`, and `gui/api.ts` delegate to `assertSafeSegment()` from `src/utils/path-validator.ts`, which encapsulates the `SAFE_SLUG_REGEX` check. The throw-type variants differ by layer (`Error` in the storage layer; `ApiError NOT_FOUND` in the GUI layer) — that separation is intentional. `deriveRepoName()` in `src/utils/ledger-root.ts` also delegates to `assertSafeSegment()` directly.

**The gap:** `gui/server.ts` still performs an inline `SAFE_SLUG_REGEX.test()` call rather than delegating to `assertSafeSegment()`. A change to `assertSafeSegment()` therefore does **not** propagate to `gui/server.ts`.

**Ongoing invariant (partially held):** When slug-segment validation logic changes, update `assertSafeSegment()` in `path-validator.ts` **and** the inline check in `gui/server.ts` until the latter is migrated to delegate.

```
###  Path: `/mcp-server/docs/agents/project-manifest/constraints-testing.md`

```md
# Constraints — Testing

> **Scope:** Every convention governing the Vitest suite — isolation, fixtures, helper
> infrastructure, mocking policy, and acceptance-criteria hygiene.
>
> **Companion documents:**
> [Core](constraints.md) ·
> [Workflow](constraints-workflow.md) ·
> [Code Style](constraints-code-style.md) ·
> [Storage & Knowledge](constraints-storage.md) ·
> [GUI](../../../gui/docs/agents/project-manifest/constraints.md)

> **CI gate:** The MCP server Vitest test suite (`npm test` in `mcp-server/`) is enforced on every push and pull request to `main` via `.github/workflows/ci.yml` (`mcp-server-tests` job, Node.js 20). All tests must pass before a PR can be merged.

## Contents

- [Test Timeout Is 10 Seconds](#test-timeout-is-10-seconds)
- [Prefer Real Implementations Over `vi.mock`](#prefer-real-implementations-over-vimock)
- [Always Supply an Isolated Ledger Root](#always-supply-an-isolated-ledger-root)
- [`afterEach` Teardown Variables Must Be Declared in the Same `describe` Scope](#aftereach-teardown-variables-must-be-declared-in-the-same-describe-scope)
- [Test Helper Infrastructure Mandate](#test-helper-infrastructure-mandate)
- [Mock `McpServer` Intercept Pattern](#mock-mcpserver-intercept-pattern-for-tool-metadata-tests)
- [Acceptance Criteria Field-Name Verification](#acceptance-criteria-field-name-verification)

---

### Test Timeout Is 10 Seconds

**Rule:** All Vitest tests have a default timeout of 10 seconds.

**Configuration:** Set in `vitest.config.ts`.

**Rationale:** Integration tests may involve multiple file I/O operations and lock acquisitions.

---

### Prefer Real Implementations Over `vi.mock`

**Rule:** When writing tests that involve the agent registry (`discoverAgents`, `isRegistryLoaded`, `getAgentHandle`, `getAgentId`) or `LedgerStore`, use the real implementations backed by a temporary directory rather than `vi.mock`.

**Pattern:**
```typescript
import { discoverAgents, resetRegistry } from '../../src/utils/agent-registry.js';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'test-'));
  agentDir = join(tempDir, 'agents');
  await mkdir(agentDir);
  store = new LedgerStore(tempDir);
});

afterEach(async () => {
  resetRegistry();
  await rm(tempDir, { recursive: true, force: true });
  await rm(agentDir, { recursive: true, force: true });
});
```

**Rationale:** `vi.mock` creates module-level side-effects that can leak across test files, especially with ES module hoisting. Using real implementations with `resetRegistry()` cleanup eliminates mock side-effects, provides genuine end-to-end coverage, and is consistent with the approach in `tests/utils/agent-registry.test.ts`.

**Reserve `vi.mock` for:** Code paths that touch the network, spawn child processes, or produce uncontrollable side-effects that cannot be isolated with a temp directory.

---

### Always Supply an Isolated Ledger Root

**Rule:** Every test file that constructs a `LedgerStore` **must** pass a `mkdtemp`-based temporary directory as the second `ledgerRoot` argument. Omitting the argument (or passing the real `storage/ledger/` path) causes the store to write to production storage, accumulating stale artifact directories across CI and local runs.

**Preferred pattern — use the shared helper:**
```typescript
import { createTempStore, cleanupTempStore } from '../helpers/create-temp-store.js';

let handle: Awaited<ReturnType<typeof createTempStore>>;

beforeEach(async () => {
  handle = await createTempStore(join(tmpdir(), '2026-01-01-test-project'));
});

afterEach(async () => {
  await cleanupTempStore(handle);
});
```

**Why a helper?** `createTempStore(planPath)` in `tests/helpers/create-temp-store.ts` always injects a fresh `mkdtemp` root, making correct isolation the path of least resistance. Never construct `new LedgerStore(path)` with a single argument inside any test.

**Anti-pattern (forbidden):**
```typescript
// ❌ WRONG — writes to production storage/ledger/
const store = new LedgerStore('/absolute/path/to/my-plan');
```

---

### `afterEach` Teardown Variables Must Be Declared in the Same `describe` Scope

**Rule:** Variables cleaned up in an `afterEach` block (e.g. a temp directory path) must be declared in the same `describe` block's scope, not in an outer scope. Referencing a variable from an outer scope is a silent bug — the inner `afterEach` compiles and runs but cleans up the *outer* variable, leaving the inner temp directory on disk.

**Pattern:**
```typescript
describe('my feature', () => {
  let tempDir: string;          // ← declared here
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'my-feature-'));
    store = new LedgerStore(MY_PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }); // ← same scope ✅
  });
});
```

**Anti-pattern:**
```typescript
let tempLedgerRoot: string; // ← outer scope

describe('nested', () => {
  let tempDir: string;      // ← different name / inner scope

  beforeEach(async () => { tempDir = await mkdtemp(…); });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true }); // ❌ wrong variable
  });
});
```

---

### Test Helper Infrastructure Mandate

**Rule:** All new test files **must** import shared fixture factories and test utilities from `tests/helpers/fixtures.ts` and `tests/helpers/test-utils.ts`.

**(a)** Any new test file that needs a project root index, WP detail object, or ledger directory must use the canonical factories from `tests/helpers/fixtures.ts` (e.g. `makeProject`, `makeWpDetail`, `injectLedgerDir`, `nowFloor`).

**(b)** Defining a local test-scope fixture factory function is **prohibited** when a canonical equivalent already exists in `tests/helpers/fixtures.ts`. If the helper does not yet exist and is needed by multiple tests, add it to `tests/helpers/` first rather than duplicating it inline.

**Rationale:** Prevents per-file fixture divergence, eliminates test-replica maintenance burden, and ensures fixture behaviour (field defaults, schema shape, timestamps) stays consistent across the entire test suite.

**Anti-pattern:**
```typescript
// ❌ WRONG — local factory duplicates the canonical makeWpDetail from tests/helpers/fixtures.ts
function makeTestWp(overrides: Partial<WorkPackageDetail> = {}): WorkPackageDetail {
  return {
    work_package_id: 'WP-001',
    status: 'READY',
    revision: 0,
    pipelines: [],
    assigned_to: null,
    dependencies: [],
    acceptance_criteria: [],
    ...overrides,
  };
}
```

**Correct pattern:**
```typescript
// ✅ CORRECT — import the canonical factory; field defaults and schema shape are guaranteed
import { makeWpDetail } from '../helpers/fixtures.js';

const wp = makeWpDetail({ work_package_id: 'WP-001', status: 'READY' });
```

---

### Mock `McpServer` Intercept Pattern for Tool Metadata Tests

**Rule:** When writing tests that need to inspect tool metadata (input schema shape, parameter constraints, tool descriptions) without spinning up a real MCP server, use the mock `McpServer` intercept pattern: create a plain object with a `registerTool` method that captures schemas into a `Map`, cast it `as unknown as McpServer`, and call each tool module's `register()` function with it in `beforeAll`.

**Rationale:** This pattern exercises the exact production registration path — same `register()` call, same `inputSchema` reference — without a network socket or real server lifecycle. It is safe with `beforeAll` because `register()` calls are synchronous.

**Correct pattern:**

```typescript
import { beforeAll, describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register as registerPipeline } from '../../src/tools/pipeline.js';

const capturedSchemas = new Map<string, z.ZodTypeAny>();

const mockServer = {
  registerTool: (
    name: string,
    config: { description: string; inputSchema: z.ZodTypeAny },
    _handler: unknown
  ) => {
    capturedSchemas.set(name, config.inputSchema);
  },
} as unknown as McpServer;

beforeAll(() => {
  registerPipeline(mockServer);
});

describe('pipeline schemas', () => {
  it('ledger_start_pipeline has non-empty properties', () => {
    const schema = capturedSchemas.get('ledger_start_pipeline')!;
    const json = zodToJsonSchema(schema) as { properties?: object };
    expect(Object.keys(json.properties ?? {})).not.toHaveLength(0);
  });
});
```

**When to use:** Any test that needs to verify tool schema shape, description content, or parameter constraints without full server lifecycle overhead. See `tests/tools/schema-integrity.test.ts` for the canonical usage.

**Note on `zod-to-json-schema`:** This package is currently a transitive dependency (via `@modelcontextprotocol/sdk`) and is not declared as an explicit `devDependency` in `mcp-server/package.json`. Tests relying on it work today, but if the SDK drops the transitive dep in a future update, imports will fail without a clear error. Prefer adding it explicitly when introducing new test files that import it directly.

---

### Acceptance Criteria Field-Name Verification

**Rule:** Acceptance criteria text that references specific JSON field names, TypeScript parameter names, or object property names (e.g., `store`, `rootIndex`, `wpDetails`, `storageDir`) **must** be verified against the actual implementation source before the AC is committed to a work package. If the implementation uses a different name than what the AC states, the AC text must be updated to match.

**Rationale:** Stale field-name references in ACs cause false-negative review outcomes. When a reviewer checks `wpDetails` against acceptance criteria but the implementation uses `allWpDetails`, the criterion is technically not met — yet neither the agent nor the QA reviewer notices.

**Anti-pattern:**
```
// AC text: "getNextActionsCollector receives `wpDetails` as a pre-loaded array"
// Implementation: loads wp details internally, no wpDetails parameter
// → AC text silently passes review because no one checks the parameter name
```

**Correct pattern:**
```
// AC text uses the exact parameter/field name from the source:
// "getNextActionsCollector receives `rootIndex: RootIndex` and `store: LedgerStore`"
// Verified against src/tools/workflow-next-action.ts before committing
```

---

### Path-Traversal Acceptance Criteria Use 404 Wording

**Rule:** When writing acceptance criteria for test cases that exercise `assertSafeSlug` rejection, use:

> *"Invalid slug (e.g. path-traversal attempt) returns 404 NOT_FOUND."*

Do **not** write `"400 VALIDATION_ERROR"` — the guard deliberately returns `NOT_FOUND` (not `VALIDATION_ERROR`) to mask traversal detection.

**Reference:** See [error-ledger.md](../../../../docs/history/error-ledger.md) — deviation recorded in the 2026-03-04 project-reset rework synthesis. The guard itself is documented in the [GUI constraints](../../../gui/docs/agents/project-manifest/constraints.md).

```
###  Path: `/mcp-server/docs/agents/project-manifest/constraints-workflow.md`

```md
# Constraints — Workflow Enforcement

> **Scope:** Server-side enforcement of the workflow state machine — status transitions, claiming,
> pipelines, handoffs, and the gotchas that arise from them.
>
> **The [Workflow Specification](../workflow-specification/README.md) is the authority for workflow
> *rules*.** This document records only what the specification does not: which function enforces a
> rule, what error text it emits, and where the implementation has non-obvious consequences. When
> this document and the specification disagree, the specification wins.
>
> **Companion documents:**
> [Core](constraints.md) ·
> [Testing](constraints-testing.md) ·
> [Code Style](constraints-code-style.md) ·
> [Storage & Knowledge](constraints-storage.md) ·
> [GUI](../../../gui/docs/agents/project-manifest/constraints.md)

## Contents

- [Status Transitions](#status-transitions)
- [Claiming & Assignment](#claiming--assignment)
- [Work Package Creation](#work-package-creation)
- [Pipelines](#pipelines)
- [Handoffs & Routing](#handoffs--routing)
- [Comments](#comments)
- [Gotchas](#gotchas)

---

## Status Transitions

### Status Transitions Are Enforced

**Rule:** Work package status transitions must follow the legal transition table.

> **Specification:** [§6.2 Transition Table](../workflow-specification/state-machines.md#62-transition-table)
> is the authoritative table. It is not duplicated here.

**Enforcement:** `isValidStatusTransition()`, applied in `updateWorkPackageStatus()` in
`src/tools/work-package.ts`.

**Server-side notes not in the specification:**

- `CANCELLED` is the only fully terminal status; `CANCELLED → CANCELLED` self-transitions are rejected.
- `ledger_reopen_cancelled_wp` (PM-only) bypasses the check explicitly — `isValidStatusTransition('CANCELLED', *)` continues to return `false`. See [§16.3d](../workflow-specification/dependencies-and-rework.md#163d-administrative-reopen-of-incorrectly-cancelled-wps) and [§21.1a](../workflow-specification/edge-cases.md#211a-administrative-reopen-of-cancelled-wps).
- `status_changed_at` is set on **every** successful transition, including `BLOCKED → BLOCKED` blocker replacements where the status value itself does not change.

**PM-only tool guard placement convention:** PM-only guards must fire **before** `resolveProjectPath()` and any `LedgerStore` construction — no file lock is acquired on early rejection. The `reopenCancelledWp` handler is the canonical model: `agent_role` is checked at the top of the handler body, before any I/O. Prefer this placement over the older `resetReworkCount` pattern (PM guard inside `try` after store construction). All new PM-only tools should follow the `reopenCancelledWp` placement.

---

### Acceptance Criteria Must All Be Met Before COMPLETE

**Rule:** A work package cannot be marked `COMPLETE` unless all acceptance criteria have `met: true`.

**Enforcement:** `canCompleteWorkPackage()` validator in `ledger_update_work_package_status`.

**Error message format:**
```
Cannot mark work package as COMPLETE: the following acceptance criteria are not met:
  - Criterion 1
  - Criterion 2
```

---

### Only the Documentation Agent Can Set COMPLETE

**Rule:** The `ledger_update_work_package_status` tool rejects transitions to `COMPLETE` from any agent other than `"Documentation"` or `"Documentation Agent"`.

**Enforcement:** Hard guard in `updateWorkPackageStatus()`. The error message includes the full workflow reminder (Developer → QA → Reviewer → Documentation → COMPLETE).

**Rationale:** Enforces the multi-stage workflow at the MCP server level; this was previously a persona-level convention only. Auto-finalize on terminal-stage PASS (below) is now the preferred COMPLETE path — `ledger_update_work_package_status` remains registered for PM and edge-case use only.

> **Specification:** [§6.5 Agent Guards](../workflow-specification/state-machines.md#65-agent-guards), §21.10.

---

### Auto-Finalize on Terminal-Stage Pipeline PASS

**Rule:** When `ledger_complete_pipeline` is called with `status: "PASS"` and the calling agent owns the WP's **last active stage** (terminal stage), the server automatically evaluates whether all acceptance criteria are met **after** applying `acceptance_criteria_updates`. If all criteria are met, the WP is transitioned to `COMPLETE` **within the same lock scope** as the pipeline completion — no separate `ledger_update_work_package_status` call is required.

The terminal stage is determined dynamically: `CANONICAL_PIPELINE_ORDERING.filter(t => activeStages.includes(t)).at(-1)`. For default WPs (`DEFAULT_PIPELINE_STAGES`), this is `documentation` (Documentation agent). For custom-stage WPs it may be any stage.

**Conditions (all must apply):**
- `type === lastActiveStage` (the last entry in the WP's ordered active stages)
- `status === 'PASS'`
- `agent_role === PIPELINE_AGENT_MAP[lastActiveStage]` (PM overrides bypass auto-finalize)
- All `wp.acceptance_criteria[*].met === true` after applying `acceptance_criteria_updates`

**Response signals:**
- `auto_finalized: true` — WP transitioned to COMPLETE; `pending_work_packages` decremented.
- `auto_finalize_blocked: true` + `unmet_criteria: string[]` — criteria check failed; WP stays IN_PROGRESS.

**Enforcement:** Logic in `completePipeline()` in `src/tools/pipeline.ts`.

**Dependency unblocking side-effect (§6.3):** When auto-finalize transitions the WP to `COMPLETE`, `propagateDependencyUnblock` is called **after** the main lock is released (consistent with §12.2 and the separate-lock gotcha below). This transitions eligible BLOCKED dependents to `READY`. Only dependents whose `blocked_by.type` is `'dependency'` (or absent) are eligible — WPs blocked by `'external'`, `'decision'`, or `'technical'` reasons remain BLOCKED.

**Rationale:** The Documentation agent always called `ledger_update_work_package_status` immediately after a PASS pipeline — the transition was unconditional and never conditional. Automating it server-side removes a mandatory extra tool call from every Documentation pipeline.

---

### `READY → IN_PROGRESS` Must Use `ledger_claim_work_package`

**Rule:** `ledger_update_work_package_status` rejects `status: 'IN_PROGRESS'` when the WP is currently `READY`. The caller must use `ledger_claim_work_package` instead.

**Enforcement:** Early-return guard in `updateWorkPackageStatus()` that throws an actionable error naming `ledger_claim_work_package` as the correct tool.

**Rationale:** `ledger_claim_work_package` enforces dependency checks and agent identity checks that `ledger_update_work_package_status` does not replicate.

---

### `IN_PROGRESS → READY` (Unclaim) Requires No Active Pipelines

**Rule:** When transitioning a WP from `IN_PROGRESS` back to `READY`, all pipelines must be in a terminal state (non-`IN_PROGRESS`). If any pipeline is currently `IN_PROGRESS`, the transition is rejected with an actionable error.

**Side effect:** On success, `assigned_to` is cleared in both the WP detail file and the root index summary.

**Enforcement:** Guard in `updateWorkPackageStatus()` step 4 in `src/tools/work-package.ts`.

---

### `BLOCKED → BLOCKED` Replaces the Blocker with Guards

**Rule:** A `BLOCKED` work package can be re-blocked with a different `blocked_by` object. This early-return path applies:

1. **Agent guard:** Only the `"Project Manager"` (or `"Project Manager Agent"`) or the current `wp.assigned_to` may replace a blocker.
2. **Type guard:** Changing a `'dependency'`-type blocker to a non-dependency type (or vice versa) is rejected. Dependency blockers are managed automatically by the system; manual replacement of dependency blockers is disallowed.
3. **Side effect:** `status_changed_at` and `root.last_updated` are set; `pending_work_packages` is unchanged (status remains `BLOCKED`).

**Enforcement:** Early-return guard in `updateWorkPackageStatus()` step 1a.

---

### BLOCKED Status Requires a Blocker Object

**Rule:** When transitioning a work package to `BLOCKED`, the `blocked_by` field must be provided.

**Enforcement:** `ledger_update_work_package_status` throws an error if `status: 'BLOCKED'` is passed without `blocked_by`.

---

### `IN_PROGRESS → BLOCKED` and `IN_PROGRESS → CANCELLED` Auto-Cancel Active Pipelines

**Rule:** When a WP transitions from `IN_PROGRESS` to `BLOCKED` or `CANCELLED`, all currently `IN_PROGRESS` pipelines are automatically cancelled. Each cancelled pipeline receives `auto_cancelled: true` to distinguish it from deliberate FAIL pipelines.

**Effect on rework detection:** Auto-cancelled pipelines are excluded from both direct and downstream rework detection in `ledger_start_pipeline` (see [Rework Count Increments on Pipeline Retry](#rework-count-increments-on-pipeline-retry)).

**Enforcement:** `autoCancelActivePipelines(wp, reason)` helper called at steps 8a/8b in `updateWorkPackageStatus()` in `src/tools/work-package.ts`.

---

### `→ COMPLETE` Freshness Check

**Rule:** When transitioning a WP to `COMPLETE`, a freshness check is applied: the most recent non-auto-cancelled `documentation` pipeline PASS must have been recorded **after** the most recent `implementation` pipeline start. If the doc PASS predates the impl start (stale doc), the transition is rejected.

**Exception:** If no `implementation` pipeline exists, or if no `documentation` pipeline has a PASS, the check is skipped (absent timestamps are accepted).

**Absent timestamp permissive default:** If the most recent `documentation` pipeline lacks a `completed_at` timestamp, or if the most recent `implementation` pipeline lacks a `started_at` timestamp, the freshness check is skipped and the `→ COMPLETE` transition is allowed.

**Enforcement:** Freshness check in `canCompleteWorkPackage()` or in `updateWorkPackageStatus()` step 2b.

**Rationale:** Prevents a WP from being completed with documentation that was written before the current implementation cycle.

---

### Reopening a COMPLETE Work Package Requires PM or Documentation

**Rule:** When transitioning a work package from `COMPLETE` back to `IN_PROGRESS`, the calling `agent` MUST be `"Project Manager"` (or `"Project Manager Agent"`) or `"Documentation"` (or `"Documentation Agent"`). All other agents are rejected.

**Enforcement:** Hard guard in `updateWorkPackageStatus()` in `src/tools/work-package.ts`, applied before the status mutation.

**Error message format:**
```
Cannot reopen work package WP-XXX: only the Project Manager or Documentation agent may transition COMPLETE → IN_PROGRESS.
Hand off to the Project Manager or Documentation agent to formally reopen this work package.
```

**Additional effect:** On `COMPLETE → IN_PROGRESS`, rework state is fully reset: `rework_counts` is set to `{}`, `rework_count` is set to `0`, `root.synthesis_generated` is cleared, and `root.synthesis_generated_at` is set to `null`. This ensures a reopened WP starts with a clean rework slate and prevents the Synthesis agent from being gated by stale synthesis state.

---

## Claiming & Assignment

### Claiming a WP Assigned to Another Agent Requires Override

**Rule:** `ledger_claim_work_package` rejects the claim when the work package's `assigned_to` field differs from the calling `agent` parameter, unless `override: true` is explicitly passed.

**Authorization:** Only the **Project Manager** and the **current assignee** (`wp.assigned_to`) are permitted to use `override: true`. Any other agent passing `override: true` receives a hard rejection. The guard is conditional on `wp.assigned_to` being set — unassigned WPs bypass the identity check.

**Error message (unauthorized override):**
```
override is restricted to "Project Manager" or the current assignee ("Developer"). You are "Reviewer".
```

**Error message (assignment mismatch):**
```
Cannot claim work package WP-002: it is assigned to "Documentation" but you are "Developer".

If you need to re-assign this WP, pass override: true.
Otherwise, only claim work packages assigned to your role.
```

**Enforcement:** Hard guard in `claimWorkPackage()` before dependency and status-transition checks.

**Rationale:** Prevents agents from silently re-assigning WPs outside their remit.

---

### Only CLAIMABLE_ROLES Can Claim Work Packages

**Rule:** The `agent` field passed to `ledger_claim_work_package` must be a claimable role.

**Non-claimable roles:** `Planner`, `Planner Agent`, `Synthesis`, `Synthesis Agent` — these orchestrating roles are excluded from claiming WPs.

**Guard ordering:** The CLAIMABLE_ROLES guard fires at step 1b — unconditionally, immediately after the `READY` status guard and **before** the assignment guard (step 2) and override-auth guard (step 2b). Consequence: a non-claimable role always receives the role error regardless of the WP's `assigned_to` field or whether `override: true` is passed.

**Enforcement:** `CLAIMABLE_ROLES` is a named export at module scope in `src/tools/work-package.ts`, checked in `claimWorkPackage` step 1b. It is derived programmatically from `AGENT_ROLES` by filtering out `ORCHESTRATING_ROLES` (defined in `src/utils/constants.ts`), so adding a new orchestrating role automatically removes it from the claimable set without requiring manual updates.

---

### Work Package `assigned_to` Always Starts as `null`

**Rule:** When creating a work package via `ledger_create_work_package`, the `assigned_to` input field is accepted silently but **ignored**. Both the WP detail file and the root index summary are written with `assigned_to: null`.

**Rationale (§9b.1):** Assignment is managed by `ledger_claim_work_package` (transitions to `IN_PROGRESS`) and cleared by `IN_PROGRESS → READY` (unclaim). Pre-populating at creation time bypasses these guards.

**Enforcement:** `createWorkPackage()` in `src/tools/work-package.ts` overwrites the input value.

---

### `ledger_begin_work` IN_PROGRESS Guard Accepts Pipeline-Type Owners

**Rule:** When `ledger_begin_work` is called on a work package that is already `IN_PROGRESS`, the call is allowed if **either** condition holds:

1. **Idempotent re-entry:** `wp.assigned_to === args.agent_role` (the same agent is continuing their own work).
2. **Cross-agent handoff:** `PIPELINE_AGENT_MAP[args.type] === args.agent_role` (the caller is the legitimate pipeline-type owner per the workflow spec).

If neither condition holds, the call is rejected.

**Rationale (§9.1, §16.5):** The `assigned_to` field is a trailing bookkeeping field — a side-effect updated by the pipeline-start phase, not a security gate. Pipeline authorisation is defined by `PIPELINE_AGENT_MAP`. Using `assigned_to` as a hard gate would block every cross-agent handoff where `ledger_begin_work` is used instead of the two-step `ledger_claim_work_package + ledger_start_pipeline` sequence.

**Contrast with `ledger_claim_work_package`:** That tool operates on `READY` WPs and does require an explicit `override: true` for cross-agent claims — the `READY → IN_PROGRESS` transition is a deliberate re-assignment. `ledger_begin_work` on an `IN_PROGRESS` WP is a pipeline-start handoff, not a re-assignment.

**Enforcement:** `isPipelineOwner` compound check in `beginWork()` in `src/tools/begin-work.ts`.

**Error message (guard fires):**
```
Cannot begin work on WP-002: it is IN_PROGRESS and assigned to "Reviewer" but you are "Developer".
Only the assigned agent or the legitimate pipeline-type owner may start a pipeline on an IN_PROGRESS work package.
```

---

## Work Package Creation

### Dependencies Must Exist Before Creation

**Rule:** When creating a work package, all dependency IDs must already exist in the root index.

**Enforcement:** `ledger_create_work_package` validates dependencies before creating the work package.

**Rationale:** Prevents dangling references.

---

### Creating a Work Package Must Not Introduce a Dependency Cycle

**Rule:** Before persisting, `createWorkPackage` calls `hasCycle(newWpId, deps, allExistingWps)` (BFS) to verify the new dependency edges don't form a circular dependency. If a cycle is detected, the creation is rejected.

**Error message format:**
```
Dependency cycle detected: WP X would create a circular dependency.
```

**Scope:** `hasCycle` checks forward-reference cycles among existing WPs. Simultaneous batch creation bypasses cycle detection — WPs should be created sequentially.

**Enforcement:** `hasCycle()` pure function at module scope in `src/tools/work-package.ts`, called in `createWorkPackage` step 3b.

---

### New BLOCKED Work Packages Receive an Auto-Assigned `blocked_by`

**Rule:** When a work package's initial status is `BLOCKED` (because at least one dependency is not terminal), `blocked_by` is automatically populated:
```typescript
{ type: 'dependency', description: 'Dependency WP-XXX is not complete', blocking_work_package: 'WP-XXX' }
```
where `WP-XXX` is the first unmet dependency.

**Enforcement:** Inside `createWorkPackage()` initial status determination.

---

### Acceptance Criteria Cannot Be Empty or Whitespace-Only

**Rule:** Each string in the `acceptance_criteria` array must be non-empty and non-whitespace after trimming. An empty string or a string containing only spaces/tabs/newlines is rejected. The array itself must contain at least one entry (Zod `.min(1)`).

**Error message format:**
```
Acceptance criteria cannot be empty or whitespace-only.
```

**Enforcement:** Validation loop in `createWorkPackage()` before WP creation, supplementing the Zod-level `.min(1)` array constraint.

**Rationale:** Prevents the degenerate case of a WP that auto-passes all criterion checks.

---

### `title` Is Required on `ledger_create_work_package`

**Rule:** The `title` field is required in `CreateWorkPackageSchema` for all new WPs. Calling `ledger_create_work_package` without `title` fails Zod validation. `title` is defined as `z.string().min(1)`, so an empty string (`""`) is rejected at the validation layer.

**Storage-schema divergence:** In storage schemas (`WorkPackageDetailSchema`, `WorkPackageSummarySchema`) `title` is optional for backward compatibility with existing WPs that pre-date the field. A `description` field is also available on the detail schema (optional) for storing the full specification body; it is stored in the WP detail file only and never copied to the root index summary, which must remain compact.

---

## Pipelines

### Pipelines Require an IN_PROGRESS Work Package

**Rule:** A pipeline can only be started on a work package with status `IN_PROGRESS`.

**Enforcement:** `ledger_start_pipeline` validates WP status before creating the pipeline.

**Rationale:** Prevents starting work before a work package is claimed.

---

### No Duplicate IN_PROGRESS Pipelines

**Rule:** Only one pipeline of a given type can be `IN_PROGRESS` at a time for a work package.

**Enforcement:** `ledger_start_pipeline` checks for an existing `IN_PROGRESS` pipeline of the same type before creating a new one.

**Rationale:** Forces agents to complete or fail a pipeline before retrying.

---

### Pipelines Must Follow the Required Ordering

**Rule:** Pipelines must be started in the order defined by the work package's `active_pipeline_stages` (defaults to `DEFAULT_PIPELINE_STAGES` when omitted). Each stage requires a PASS on its immediately preceding active stage. A historical PASS followed by a FAIL is not sufficient — the most recent entry is the only one that counts (per §8.2 most-recent-wins semantics).

**Enforcement:** `ledger_start_pipeline` calls `resolvePrerequisite(type, activeStages)` — which filters `CANONICAL_PIPELINE_ORDERING` by the WP's `active_pipeline_stages` and returns the immediately preceding active stage — then finds the most recent pipeline of that prerequisite type via `.at(-1)`, and rejects if it is absent or its status is not `PASS`.

**Error message format:**
```
Cannot start 'qa' pipeline: requires a PASS 'implementation' pipeline first.
Active pipeline order: implementation → qa → code-review → documentation.
```

**Exception:** The first active stage in the WP's ordering has no prerequisite and can always be started (subject to other constraints).

> **Specification:** [§8 Pipeline Routing](../workflow-specification/pipeline-routing.md).

---

### All Six Pipeline Stages Are PM-Composable

**Rule:** All six pipeline stages (`implementation`, `qa`, `security-audit`, `code-review`, `release-engineering`, `documentation`) are equally composable by the Project Manager. There is no inherent "mandatory" or "optional" designation for any stage. The PM selects any valid subsequence of `CANONICAL_PIPELINE_ORDERING` per work package via the `active_pipeline_stages` field.

**Default:** When `active_pipeline_stages` is omitted, `DEFAULT_PIPELINE_STAGES` (`['implementation', 'qa', 'code-review', 'documentation']`) is used for backward compatibility.

**Rationale:** The former `MANDATORY_PIPELINE_TYPES` and `OPTIONAL_PIPELINE_TYPES` constants are retired. The PM-composable model enables custom workflows (e.g., skipping QA for documentation-only WPs, adding a security audit before code review) without encoding assumptions into the server.

**Extension:** `CANONICAL_PIPELINE_ORDERING` defines the only valid execution order — stages may be omitted but not reordered. `resolvePrerequisite`, `resolveNextAgent`, and `resolveFailAgent` derive routing dynamically from the per-WP `active_pipeline_stages` array.

> **Specification:** [§4.2 Pipeline Stage Constants](../workflow-specification/data-model.md#42-pipeline-stage-constants), §9b.

---

### `active_pipeline_stages` Validation: Hard and Soft Guardrails

**Rule:** When `ledger_create_work_package` receives an `active_pipeline_stages` value, it validates the array before persisting the work package.

**Hard guardrails (reject with error — creation is aborted):**
- Empty array (`[]`)
- Entries that are not valid `PIPELINE_TYPES` values
- Duplicate entries
- Entries that are not a subsequence of `CANONICAL_PIPELINE_ORDERING` (relative ordering must be preserved; gaps are allowed)

**Soft guardrails (warning appended to the success response — creation is NOT aborted):**
- `implementation` present without `qa` (unusual composition)
- Single-stage chain (degenerate case)

**Omitted field:** When `active_pipeline_stages` is omitted (the common case for standard 4-stage workflows), validation is bypassed entirely. The field is absent on the WP detail and dynamic resolve functions substitute `DEFAULT_PIPELINE_STAGES` at runtime.

**Enforcement:** `validateActiveStages()` helper called inside `createWorkPackage()` in `src/tools/work-package.ts`. Hard rejection throws before the WP is written; soft warning is appended to the response string after the WP is written.

> **Specification:** [§9b.2](../workflow-specification/operations.md#9b2-active-pipeline-stages-validation).

---

### Pipeline Start Auto-Updates `assigned_to`

**Rule:** When a pipeline starts, the work package's `assigned_to` field is automatically updated to the responsible agent according to `PIPELINE_AGENT_MAP`.

**Enforcement:** `ledger_start_pipeline` applies the map atomically alongside the pipeline creation. Both WP detail and root index summary are updated.

> The type-to-agent map itself is defined in `src/utils/pipeline-maps.ts` and specified in
> [§9 Pipeline Routing](../workflow-specification/pipeline-routing.md).

---

### `agent_role` Is Required for Pipeline Start and Complete

**Rule:** Both `ledger_start_pipeline` and `ledger_complete_pipeline` require an `agent_role` parameter. The value must match the pipeline type's owner role (per `PIPELINE_AGENT_MAP`). Calls that omit `agent_role` or provide a mismatched role are rejected with a descriptive error.

**Exception:** `agent_role: 'Project Manager'` (or `'Project Manager Agent'`) bypasses the type-to-agent match check for any pipeline type (PM Override). When PM override is active, `startPipeline` adds a `[PM Override]` marker to the pipeline summary and `completePipeline` sets the handoff note's `from_agent` to `'Project Manager (PM Override)'`.

**Enforcement:** Agent role guard in `startPipeline()` and `completePipeline()` in `src/tools/pipeline.ts` (steps 1b and 2b respectively), applied after the WP status guard.

---

### Rework Count Increments on Pipeline Retry

**Rule:** When `ledger_start_pipeline` detects a rework, the work package's rework counters are automatically incremented. Rework is detected when either:
- **Direct rework:** The most recent completed pipeline of the same type has `FAIL` status.
- **Downstream rework:** A prerequisite pipeline type was reworked (re-failed) after the last PASS of the current pipeline type.

**Auto-cancelled exclusion:** Pipelines with `.auto_cancelled === true` are excluded from both rework-detection checks. This exclusion also applies to **temporal comparison functions** such as `checkRevalidationGuard` — an auto-cancelled pipeline is invisible to all time-based guard logic. Auto-cancelled pipelines must never be counted by rework detection, circuit breakers, or any temporal comparison function.

**Primary field:** `rework_counts` — a per-pipeline-type map. This is the authoritative counter.

**Legacy field:** `rework_count` — a scalar counter maintained during a prior transition period. No production code path writes this field. The in-memory migration in `LedgerStore.readWorkPackage()` handles on-disk files that still contain it, but no new writes are emitted.

**Backward-compat migration:** `LedgerStore.readWorkPackage()` performs a lazy in-memory migration: if a file contains `rework_count` but no `rework_counts`, it synthesises `rework_counts: { implementation: rework_count, qa: 0, 'code-review': 0, documentation: 0 }` and removes `rework_count`. This migration is **in-memory only** — no write is triggered; the on-disk file is updated lazily on the next `updateWorkPackageWithSync()` call.

**Initial value:** Both fields are absent (`undefined`) until the first rework; neither is ever initialised to `0` on creation.

| Rework condition | `rework_counts` change |
|---|---|
| None (no prior failure, no downstream rework) | No increment |
| Direct rework (last same-type FAIL) | `rework_counts[type]` +1 |
| Downstream rework (prerequisite reworked after last PASS) | `rework_counts[type]` +1 |

**Circuit breaker:** After incrementing, the effective count is computed as `rework_counts?.[type] ?? 0`. If this value reaches `MAX_REWORK_COUNT` (default: 5, from `workflow-helpers.ts`), `ledger_start_pipeline` rejects with an error guiding the caller to cancel or restructure. `getDeveloperAction` also surfaces `BLOCK_FOR_REWORK_LIMIT` as the highest-priority action for affected WPs.

---

### `propagateDependencyReblock` Auto-Cancels IN_PROGRESS Pipelines

**Rule:** When `propagateDependencyReblock` transitions a non-COMPLETE, non-CANCELLED, non-BLOCKED dependent WP back to `BLOCKED`, all currently `IN_PROGRESS` pipelines on that WP are automatically cancelled with `auto_cancelled: true` (consistent with the `IN_PROGRESS → BLOCKED` behavior enforced by `updateWorkPackageStatus`).

**Additional behaviors:**
- **COMPLETE dependents:** For each `COMPLETE` WP that lists the reopened WP as a dependency, a warning comment is appended to its last pipeline (type: `"warning"`, priority: `"high"`).
- **`synthesis_generated` reset:** If any WP was re-blocked, `root.synthesis_generated` is reset to `false` and `root.synthesis_generated_at` is set to `null` to ensure the Synthesis agent must re-run.
- If no candidates were re-blocked, `synthesis_generated` and `synthesis_generated_at` are **not** changed.

**Enforcement:** `propagateDependencyReblock()` in `src/tools/work-package.ts`.

---

### Artifact Declaration Expectation — Soft Warning on Empty `files_modified`

**Rule:** When `ledger_complete_pipeline` is called with `status: 'PASS'` and the `artifacts.files_modified` array is either absent or empty, the server appends a soft-warning note **only if the pipeline type is in `ARTIFACT_EXPECTED_PIPELINE_TYPES`** (`implementation`, `code-review`, `release-engineering`, `documentation`). Verification-only pipeline types (`qa`, `security-audit`) are exempt because those agents verify but do not modify files. `code-review` is included because the Reviewer may apply Fix-Forward edits. This is a non-blocking warning — the pipeline completion is still accepted.

**Rationale:** Agents often forget to populate `files_modified`, reducing the value of the pipeline record for auditing and documentation. The soft warning creates a visible signal in the response without blocking legitimate zero-file-change completions.

**Exception:** The warning is only emitted on `PASS` completions — `FAIL` pipelines are not expected to declare modified files.

**Enforcement:** Soft check in `completePipeline()` in `src/tools/pipeline.ts` (step 3b), gated by `ARTIFACT_EXPECTED_PIPELINE_TYPES` from `src/utils/pipeline-maps.ts`.

---

### Advisory Dependency Freshness Check on PASS Completion

**Rule:** When `ledger_complete_pipeline` is called with `status: 'PASS'` on a WP that has `dependencies`, the server performs an advisory staleness check. For each dependency, the server reads the full WP detail (pre-lock, before lock acquisition) and uses `dep.last_updated` directly. Inside the lock callback, if `dep.last_updated` is later than `pipeline.started_at` (Date-based comparison via `new Date().getTime()`, not lexicographic string comparison), a project comment is appended:

```typescript
{ type: 'warning', priority: 'low', agent: 'system', note: '<dep WP-XXX was modified after this pipeline started>' }
```

**PASS is never blocked.** This check is purely advisory — no pipeline status is changed, no error is thrown.

**Skip conditions:** The check is entirely skipped when `pipeline.started_at` is absent (unstarted or legacy pipeline record), or the WP's `dependencies` array is empty.

**`last_updated` field:** `WorkPackageDetail` includes a dedicated `last_updated: z.string().optional()` field auto-stamped with `now()` on every WP detail write path (status transitions, claim, pipeline start/complete/cancel, creation, cascade reblock/unblock). It is auto-stamped via `updateWorkPackageWithSync` (the primary choke point), plus explicit setting in `createWorkPackage`, `propagateDependencyUnblock`, and `propagateDependencyReblock` (which bypass the choke point). Existing WP detail files without the field parse without error.

**Race window (acceptable):** Dependency WP files are read before lock acquisition. A dependency could theoretically be modified between the pre-read and the lock. For an advisory-only check this race window is acceptable — false negatives do not affect correctness.

> **Specification:** §21.59.

---

## Handoffs & Routing

### Handoff Notes Are Routed via `resolveNextAgent` / `resolveFailAgent`

**Rule:** When `ledger_complete_pipeline` is called with a `handoff_notes` array, a structured `HandoffNote` entry is appended to the work package. The `to_agent` is determined dynamically:

- **On PASS:** `resolveNextAgent(type, activeStages)` returns the owner of the next active stage in canonical order, or `'Synthesis'` when the type is the last active stage.
- **On FAIL:** `resolveFailAgent(type, activeStages)` uses a base routing map extended to all six stages. If the base fail-target's stage is absent from `activeStages`, the fallback is the agent that owns the first active stage.

> **Specification:** The full PASS/FAIL routing tables are defined in
> [§9, §12 Pipeline Routing](../workflow-specification/pipeline-routing.md) and are not duplicated
> here. In summary: `documentation` and `release-engineering` self-rework on FAIL; all other FAIL
> paths route to the Developer.

**Schema:**
```typescript
interface HandoffNote {
  from_agent: string; // PIPELINE_AGENT_MAP[type], or 'Project Manager (PM Override)' when PM override is active
  to_agent: string;   // resolveNextAgent(type, activeStages) on PASS; resolveFailAgent(type, activeStages) on FAIL
  timestamp: string;
  notes: string[];    // The strings passed in handoff_notes
}
```

**`ledger_complete_pipeline` guards (applied before pipeline lookup):**
1. **WP status guard:** Rejects if `wp.status !== 'IN_PROGRESS'` (defense-in-depth).
2. **Agent role guard:** `agent_role` must match `PIPELINE_AGENT_MAP[type]`. Exception: `agent_role === 'Project Manager'` bypasses this check (PM Override), and `from_agent` is set to `'Project Manager (PM Override)'`.

**Consumption:** `ledger_get_next_action` and `ledger_get_next_actions` include any handoff notes addressed to the requesting agent in their response.

---

### PM Handoff Detects Pending Pipeline Stages on IN_PROGRESS WPs

**Rule:** Both `getProjectManagerHandoff()` (§13.1, `workflow-handoff.ts`) and `getProjectManagerAction()` (§14.1.2, `workflow-next-action.ts`) MUST scan non-terminal, non-dependency-blocked `IN_PROGRESS` work packages for pending pipeline stages when no `READY` WPs exist. This scan — called **step 2b** in the handoff function and **Priority 3d** in the recommendation engine — is the only mechanism that advances a WP between pipeline stages after a stage PASS, and that bootstraps freshly-claimed WPs with zero pipelines to their first active stage.

**Invariant:** An IN_PROGRESS WP that has a PASS on stage N and no pipeline started for stage N+1 MUST surface as actionable by the PM (either via `ROUTE_PIPELINE_AGENT` action or the equivalent `READY_FOR_<AGENT>` handoff status) before the affected agent can be dispatched. Without step 2b, such WPs are silently stuck — the PM returns `WAIT` instead of routing the next agent.

**Guards (all must be applied):**
1. **FAIL guard** — If the most recent non-auto-cancelled pipeline for the current stage is FAIL, break the stage scan for this WP. The stage's own agent handles rework; the PM does not route.
2. **IN_PROGRESS guard** — If the most recent non-auto-cancelled pipeline for the current stage is IN_PROGRESS, break. The stage is already being worked on.
3. **Upstream IN_PROGRESS guard** — If the preceding stage's most recent non-auto-cancelled pipeline is IN_PROGRESS, break. Routing the next stage now would be premature.
4. **Dependency-blocked exclusion** — WPs where `wp.status === 'BLOCKED'` and `blocked_by.type === 'dependency'` (or `blocked_by` is absent) are excluded from step 2b entirely.

**Coverage scenarios:**
- **Stage-transition routing:** WP has implementation PASS and no QA pipeline → PM routes to QA.
- **Zero-pipeline bootstrap:** Freshly-claimed IN_PROGRESS WP with no pipelines → PM routes to first active stage's agent.

**Rationale:** The PM is the only agent whose action/handoff functions have visibility into all WPs simultaneously. Without step 2b, a WP that just received a pipeline PASS would not advance until something else triggered a re-scan.

> Implementation: `workflow-handoff.ts` `getProjectManagerHandoff()` §13.1 step 2b; `workflow-next-action.ts` `getProjectManagerAction()` §14.1.2 Priority 3d.

---

### Non-PM Handoff Functions Must Dispatch to the Next READY WP Before Returning WAIT

**Rule:** Each of the five non-PM handoff functions — `getQaHandoff`, `getSecurityAuditorHandoff`, `getReviewerHandoff`, `getReleaseEngineerHandoff`, and `getDocumentationHandoff` — MUST call `findNextReadyDispatch(wpDetails, '<RoleName>')` as the penultimate step, immediately before the final `return WAIT` fallthrough. If `findNextReadyDispatch` returns a non-null result, the function MUST return that dispatch rather than falling through to WAIT.

**Rationale:** Without this step, completing the last pipeline stage on WP-N leaves the IDE in a stalled state when WP-N+1 is READY but has no pipelines yet. The affected functions previously returned a bare `WAIT` in this scenario, requiring manual PM intervention to unblock the IDE workflow. The PM handoff already implements this cross-WP dispatch pattern (§13.1 Step 2); this rule extends the same behaviour to all non-PM handoff functions.

**`findNextReadyDispatch` algorithm:**
1. Finds the first READY work package whose dependencies are satisfied (using `isBlockedByDependencies`).
2. Routes to the agent owning its first active pipeline stage (`PIPELINE_AGENT_MAP[firstActiveStage(wp.active_pipeline_stages ?? null)]`).
3. If all WPs are terminal, returns `READY_FOR_SYNTHESIS` (safety-net branch for handoff functions that position cross-WP dispatch before their own all-terminal check).
4. Returns `null` when no deterministic dispatch is possible — the caller falls through to WAIT.

**Self-routing is intentional:** `findNextReadyDispatch` does NOT filter out cases where the target role equals the calling role. Self-routing causes the IDE to visibly declare a new handoff step for the new work package, improving auditability and keeping orchestrator and IDE behaviors aligned.

**Scope:** This is a best-effort optimization for IDE runners. The orchestrator does not depend on it — its supervisor polling loop re-dispatches independently.

**Correct pattern:**
```typescript
// ✅ CORRECT — penultimate step, just before final WAIT return
const dispatch = findNextReadyDispatch(wpDetails, 'Documentation');
if (dispatch) {
  return buildHandoffResponse(
    'Documentation', dispatch.status, dispatch.reason,
    undefined, projectPath, store
  );
}
return buildHandoffResponse('Documentation', 'WAIT', 'No actionable documentation work.');
```

**Anti-pattern:**
```typescript
// ❌ WRONG — returns WAIT without checking for READY WPs
return buildHandoffResponse('Documentation', 'WAIT', 'No actionable documentation work.');
```

---

## Comments

### Pipeline Comments Have No Agent Field

**Rule:** Pipeline-level comments do not include an `agent` field. The agent is inferred from the pipeline type.

**Contrast:** Project-level comments include an explicit `agent` field because they are not tied to a specific pipeline.

---

### Incident Comments Require Context

**Rule:** When adding a project comment with `type: 'incident'`, the `context` field is required.

**Enforcement:** `ledger_add_project_comment` throws an error if `type === 'incident'` and `context` is missing.

**Required context fields:**
- `os` — Operating system where the incident occurred
- `tool` — Tool or command that caused the incident
- `work_package` (optional) — Associated work package
- `resolved` — Whether the incident is resolved
- `workaround` (optional) — Workaround description

---

## Gotchas

### ⚠️ Revision Only Increments on COMPLETE → IN_PROGRESS

The `revision` field only increments when a work package transitions from `COMPLETE` back to `IN_PROGRESS`. It does not increment on other status changes.

---

### ⚠️ READY Status After Creation Depends on Dependencies

When creating a work package:
- If dependencies are empty or all `COMPLETE` → initial status is `READY`
- If any dependency is not `COMPLETE` → initial status is `BLOCKED`

This logic is automatic and transparent to the caller.

---

### ⚠️ Work Package Summaries Are Duplicates

Work package summaries in the root index duplicate a subset of data from the work package detail files.

**Reason:** Performance — agents can list work packages without loading all detail files.

**Invariant:** Summaries must always match the corresponding detail files. This is enforced by `createWorkPackageWithSync()` (creation) and `updateWorkPackageWithSync()` (updates).

---

### ⚠️ REWORK Is Triggered Only by the Most Recent FAIL

The REWORK recommendation in `ledger_get_next_action` is based **only on the most recent pipeline** of a given type, not any historical FAIL. A work package with pipeline history `[FAIL, PASS]` does NOT receive a REWORK recommendation — the PASS means the issue was resolved.

**Implementation:** `isMostRecentPipelineFail(pipelines, pipelineType)` — see [Internal Testing Utilities](api-surface.md#internal-testing-utilities).

---

### ⚠️ Documentation Handoff Skips Dependency-Blocked WPs

`getDocumentationHandoff` (and `getQaHandoff`, `getReviewerHandoff`) treat WPs blocked by incomplete dependencies as ineligible for their stage. If all unreviewed/undocumented WPs are dependency-blocked, the handoff returns `READY_FOR_SYNTHESIS` rather than routing the agent back to the Developer.

**Why it matters:** Without this check, a project where the only remaining WPs are blocked by incomplete dependencies would incorrectly route the Documentation Agent back to the Developer stage, stalling the workflow.

---

### ⚠️ Dependency Auto-Unblocking Uses a Separate Lock

When a work package transitions to `COMPLETE`, `propagateDependencyUnblock` automatically transitions eligible downstream dependents from `BLOCKED` to `READY`. This runs **after** the main lock in `updateWorkPackageStatus` is released — it acquires its own lock.

**Eligibility rule:** A BLOCKED WP is auto-unblocked only when **all its dependencies are terminal (COMPLETE or CANCELLED) AND its `blocked_by.type` is `"dependency"` or absent**. WPs blocked by `"external"`, `"decision"`, or `"technical"` reasons are intentionally skipped — their blockers must be resolved manually.

**Implication:** There is a brief window between the COMPLETE write and the unblocking write during which the root index shows the WP as COMPLETE but dependents are still BLOCKED. This is safe for single-user workflows, but would be a race condition risk in a concurrent multi-agent environment.

---

### ⚠️ WP ID Generation Is Max-Based, Not Length-Based

Work package IDs are generated by scanning the highest existing numeric suffix and adding 1. This means:
- Deleting a WP does not cause ID collisions (unlike a length+1 approach)
- IDs are monotonically increasing but may have gaps (e.g., WP-001, WP-003 if WP-002 was removed)
- IDs can be 3+ digits: the schema regex `/^WP-\d{3,}$/` supports WP-001 through WP-9999+

---

### ⚠️ Unknown Criteria Text in `acceptance_criteria_updates` Is Appended

When `ledger_complete_pipeline` is called with `acceptance_criteria_updates`, each update item is matched by exact criterion text:
- **Matched:** updates the `met` flag on the existing entry.
- **Not matched (unknown text):** appends a new `AcceptanceCriterion` entry `{ criterion, met }` to the WP's `acceptance_criteria` array.

---

### ⚠️ Metrics Object Is Extensible

The `metrics` object in pipelines uses `.passthrough()` in Zod, meaning it accepts additional fields beyond the predefined ones (`test_coverage`, `tests_passed`, etc.).

**Use case:** Custom metrics for different pipeline types (e.g., `build_time`, `bundle_size`).

---

### ⚠️ Lock File Persists After Server Exit

The `.lock` file inside `storage/ledger/{slug}/` is not automatically deleted when the server exits. It will be left on disk and overwritten on the next lock acquisition.

**Implication:** Safe to ignore — the lock system handles stale locks automatically.

```
###  Path: `/mcp-server/docs/agents/project-manifest/constraints.md`

```md
# Constraints & Conventions — Core

> **Scope:** Infrastructure rules that apply across the whole server — file I/O, storage layout,
> schema, module system, validation, concurrency, build, and manifest authoring.
>
> **Companion documents:**
> [Workflow](constraints-workflow.md) ·
> [Testing](constraints-testing.md) ·
> [Code Style](constraints-code-style.md) ·
> [Storage & Knowledge](constraints-storage.md) ·
> [GUI](../../../gui/docs/agents/project-manifest/constraints.md)

## Contents

- [Constraint Entry Format](#constraint-entry-format)
- [Workflow Specification Governance](#workflow-specification-governance)
- [File System Constraints](#file-system-constraints)
- [Schema Constraints](#schema-constraints)
- [Concurrency Constraints](#concurrency-constraints)
- [Module System Constraints](#module-system-constraints)
- [Validation Constraints](#validation-constraints)
- [Counter Self-Healing](#counter-self-healing)
- [Development & Build Constraints](#development--build-constraints)
- [Manifest Documentation Constraints](#manifest-documentation-constraints)
- [Cross-Platform Constraints](#cross-platform-constraints)

### Constraint Entry Format

Entries are cited by heading, not by number. Numbers were removed after repeated collisions made
citations ambiguous — link to the heading anchor instead.

New entries follow this structure:

| Section | Content |
|---------|---------|
| **Rule** | The specific, actionable rule — include forbidden alternatives inline. |
| **Rationale** | Why the rule exists. One or two sentences. |
| **Anti-pattern** (if applicable) | A concrete ❌ code example showing the wrong approach. |
| **Correct pattern** (if applicable) | A concrete ✅ code example showing the right approach. |
| **Forbidden patterns** (if applicable) | A prose or list summary of every variant that must NOT be used. |

---

## Workflow Specification Governance

### The Workflow Specification Is the Source of Truth for All Workflow Logic

**Rule:** The [Workflow Specification](../workflow-specification/README.md) is the authoritative definition of all workflow logic — state machines, pipeline routing, status transitions, handoff behavior, recommendation engine behavior, edge cases, and constants. Implementation code must conform to the specification. When code contradicts the specification, the code is wrong.

**Spec-first development:** Changes to workflow logic MUST be made in the specification first, then implemented in code, then validated by tests, then documented in the project manifest — in that order.

**Test traceability:** Test descriptions SHOULD reference the workflow specification section they validate (e.g., `// §14.13 row 1: returns true when QA FAIL started after impl PASS completed`). This convention is already practiced in several test files and should be followed consistently.

**Rationale:** The specification was designed to be a language-agnostic, formally reviewed reference. Treating code as the source of truth defeats this purpose and leads to silent behavioral drift between the TypeScript (MCP server) and Python (orchestrator) implementations.

**Scope:** This constraint applies to workflow logic only — file I/O, schema validation, concurrency primitives, and other infrastructure concerns are governed by the constraints below.

**Consequence for this manifest:** Workflow rules are not restated in the manifest. [constraints-workflow.md](constraints-workflow.md) carries only the server-side enforcement details the specification does not cover — which function enforces a rule, what error text it emits — and points at the spec for the rules themselves.

---

## File System Constraints

### All File I/O Must Be Atomic

**Rule:** Never write directly to target files. Always use the `atomicWriteJson()` function.

**Rationale:** Ensures readers never see partial writes or corrupt JSON.

**Implementation:** Write to `{file}.tmp.{pid}`, then atomically rename to target.

**Anti-pattern:**
```typescript
// ❌ WRONG — direct write; a crash mid-write leaves the target file truncated or corrupt
await fs.writeFile(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
```

**Correct pattern:**
```typescript
// ✅ CORRECT — write to .tmp.{pid}, then rename; readers never see a partial file
await atomicWriteJson(targetPath, data);
```

---

### Dual-File Updates Require Locking

**Rule:** When writing both `storage/ledger/{slug}/project-ledger.json` and `storage/ledger/{slug}/WP-###.json`, always use the appropriate high-level method: `LedgerStore.createWorkPackageWithSync()` for creating a new WP, `LedgerStore.updateWorkPackageWithSync()` for updating a single existing WP, or `LedgerStore.batchUpdateWorkPackagesWithSync()` for updating multiple WPs in one operation. Only fall back to a manual `withLock(store.storageDir, ...)` scope when none of these methods covers the use case. **`store.storageDir` is the only acceptable first argument to `withLock` — never pass `projectPath`, `ledgerRoot`, or `ledgerRoot ?? projectPath`.** Once a `LedgerStore` is constructed, use its `.storageDir` property to obtain the canonical lock directory.

**Extension — Single-File Read-Modify-Write:** Even when updating only the root index, any read-modify-write sequence must also be wrapped in `withLock(store.storageDir, ...)` to prevent TOCTOU races. Example: `completeSynthesis` reads the root index, mutates `synthesis_generated` and project status, then writes it back — this entire sequence must occur inside a single lock scope.

**Rationale:** Prevents race conditions and dual-file desync when multiple agents run concurrently.

**Anti-pattern:**
```typescript
// ❌ WRONG — race condition risk
await store.writeWorkPackage(wpId, updatedWp);
await store.writeRootIndex(updatedRoot);
```

**Correct pattern:**
```typescript
// ✅ CORRECT — atomic dual-file creation (new WP)
await store.createWorkPackageWithSync(async (root) => {
  // ... build new WP detail and updated root ...
  return { wpId, wp: newWpDetail, root: updatedRoot };
});

// ✅ CORRECT — atomic dual-file update (existing WP)
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  // ... update both wp and root ...
  return { wp: updatedWp, root: updatedRoot };
});
```

---

### Batch Multi-WP Writes Must Use `batchUpdateWorkPackagesWithSync`

**Rule:** When updating multiple work packages and the root index in a single operation, always use `LedgerStore.batchUpdateWorkPackagesWithSync()`. Never loop over `updateWorkPackageWithSync()` calls or acquire multiple separate `withLock` scopes to write a batch of WPs — this produces one lock acquisition per WP instead of one per operation.

**Rationale:** A loop of per-WP lock acquisitions is not atomic at the operation level: a crash or concurrent write between iterations can leave some WPs updated while others are not, desynchronizing WP state and the root index. `batchUpdateWorkPackagesWithSync` consolidates all reads, validation, writes, and the root index sync into a single lock scope.

**Atomicity invariant (two-pass validate-then-write):** The method validates all WPs via Zod **before** writing any of them. A validation failure on any WP in the batch aborts the entire operation with no disk writes. This is stronger than the per-WP atomicity provided by `updateWorkPackageWithSync`, which validates and writes one WP at a time.

**Note on lock-scope vs. rollback-scope atomicity:** If a file write succeeds for WP-A but a subsequent I/O error prevents writing WP-B, WP-A's write is not rolled back. This characteristic is shared with `updateWorkPackageWithSync`. Validation failures are fully atomic (no writes); I/O failures after the write phase begins are not.

**Anti-pattern:**
```typescript
// ❌ WRONG — multiple lock acquisitions; not atomic across the batch
for (const wpId of candidateIds) {
  await store.updateWorkPackageWithSync(wpId, (wp, root) => {
    // ...
    return { wp: updatedWp, root: updatedRoot };
  });
}
```

**Correct pattern:**
```typescript
// ✅ CORRECT — single lock; all WPs validated before any write
await store.batchUpdateWorkPackagesWithSync(async (root, readWp) => {
  const updatedWps = new Map<string, WorkPackageDetail>();
  for (const wpId of candidateIds) {
    const wp = await readWp(wpId);
    // ... mutate wp ...
    updatedWps.set(wpId, wp);
  }
  // ... mutate root ...
  return { updatedWps, root: updatedRoot };
});
```

**Known callers:** `propagateDependencyUnblock` and `propagateDependencyReblock` in `src/tools/work-package.ts`; `applyProjectReset` and `markProjectComplete` in `src/utils/project-reset.ts`.

---

### `writeWorkPackage` and `writeRootIndex` Are Internal — Tool Code Must Not Call Them

**Rule:** `LedgerStore.writeWorkPackage()` and `LedgerStore.writeRootIndex()` are marked `@internal` in source. Tool functions (`src/tools/`) and shared helpers (`src/utils/`) must never call these methods directly. All WP+root writes must go through one of the three sync methods above.

**Rationale:** Bypassing the sync methods skips `last_updated` auto-stamping, Zod validation, `.meta.json` sync, and the single-lock atomicity guarantee. The `@internal` tag is documentation-only (TypeScript does not enforce it) — this constraint encodes the boundary as a project rule.

**Legitimate direct callers of `writeRootIndex` (non-tool code):**
- `src/tools/project-lifecycle.ts` — `getProjectStatus()` self-healing: repairs stale counter fields under an explicit `withLock` scope; `initializeProject()` and `completeSynthesis()` for root-index-only transitions that don't involve any WP file write
- `auto-archive.ts` — sets `status: 'ARCHIVED'` with `preserveLastUpdated: true` (root-index write only; sync methods do not apply)
- `observations.ts` — appends a project-level comment (root-index write only; no WP file involved)
- `workflow-handoff.ts` — `buildHandoffResponse()`: increments or caps the `auto_handoff_depth` counter on every handoff-status response; root-index-only write with no WP file involvement
- `importStandaloneProject()` (internal `LedgerStore` method) — bootstraps a standalone project from scratch; manages its own `withLock(storageDir)` scope; architecturally equivalent to `initializeProject()`, so listing it in the allowlist prevents it being incorrectly refactored to a sync method

**`writeWorkPackage` — no external callers; one approved internal exception:** `writeWorkPackage` has no legitimate external callers. The sole approved internal exception is `importStandaloneProject()`, which bootstraps a standalone project from scratch inside `LedgerStore` and manages its own lock scope. The `@internal` restriction targets tool code outside `LedgerStore`; internal bootstrap methods that create a complete project state from scratch may call `writeWorkPackage` directly.

**Anti-pattern:**
```typescript
// ❌ WRONG — bypasses auto-stamping, validation, and .meta.json sync
await store.writeWorkPackage(wpId, updatedWp);
await store.writeRootIndex(updatedRoot);
```

**Correct pattern:** Use `updateWorkPackageWithSync`, `createWorkPackageWithSync`, or `batchUpdateWorkPackagesWithSync` as shown above.

---

### Paths Must Be Absolute

**Rule:** All MCP tool inputs require absolute paths for `project_path`.

**Rationale:** The server has no concept of "current working directory" — it must be told explicitly where files live.

---

### Plan Folders Must Remain Human-Readable Markdown Only

**Rule:** No machine-generated files (JSON, lock files, etc.) may be written inside plan folders.

**Rationale:** Plan folders are the authoritative human source-of-truth. Machine output lives in the centralized ledger at `{mcp-server}/storage/ledger/{slug}/`.

**Archiving clarification:** `archiveDocuments()` copies files **from** the plan folder **into** the centralized storage directory. The direction is one-way: plan folder → ledger. The archived copy is read-only from the agent's perspective — it exists for retrieval by the GUI and tooling, not for editing. The original file in the plan folder remains the authoritative source and is never modified by the server. No writes ever occur inside the plan folder.

**`plan_file` validation:** the `plan_file` argument accepted by `ledger_initialize_project` is enforced at parse time by a Zod `.refine()` check: `v === PLAN_ARCHIVE_FILENAME`. Calls with any value other than `'plan.md'` are rejected with a Zod validation error before reaching handler logic. This ensures the GUI's `/api/projects/:slug/plan` endpoint can always rely on the archived plan document having the fixed filename `plan.md`.

**Archive error contract:** `archiveDocuments()` uses a discriminated error strategy:
- Missing source file (`ENOENT`) — the filename is silently added to `skipped[]` and a warning is written to `stderr`. The operation continues with remaining files.
- All other I/O errors (e.g., `EACCES`, `ENOSPC`, `EISDIR`) — the error is **re-thrown** to the caller. Callers must not assume all errors from `archiveDocuments()` are benign.

---

### `.meta.json` Must Be Written Under the Project Lock

**Rule:** `writeProjectMeta()` must always be called inside the same `withLock()` scope as the root index write it synchronizes. Never call it outside a lock context except for the standalone `writeRootIndex()` (which manages its own internal sync). Note: `writeRootIndex` is `@internal` — see the allowlist above for legitimate direct callers.

**Rationale:** Prevents `.meta.json` from lagging behind the root index in a concurrent environment.

---

### Central Ledger Root Is Resolved Once at Startup

**Rule:** `resolveLedgerRoot()` is called once at server startup. The `--ledger-dir <path>` CLI argument overrides the default `{mcp-server}/storage/ledger/` location. The resolved path is logged to stderr.

**Usage:**
```bash
# Override ledger root:
node dist/index.js --ledger-dir /custom/path/to/ledger
```

**Default:** `{mcp-server}/storage/ledger/` (relative to the server package root).

---

### Ledger Storage Paths Must Include the Repository Namespace Level

**Rule:** Never construct a ledger storage path as `join(ledgerRoot, slug)` or `join(ledgerRoot, slug, filename)`. The canonical storage layout is `{ledgerRoot}/{repoName}/{slug}/` — all paths into the centralized ledger **must** include the `{repoName}` tier. Use one of the two canonical resolution functions:

| Input available | Function | Returns |
|-----------------|----------|---------|
| Absolute plan folder path | `LedgerStore(planPath, ledgerRoot)` constructor | Instance whose `.storageDir` is `join(ledgerRoot, deriveRepoName(planPath), slug)` |
| Bare slug or qualified `{repo}/{slug}` | `resolveProjectDir(slugOrQualified, ledgerRoot)` | Absolute `storageDir` path; then read `.meta.json` to obtain `plan_path` for the constructor |

**Anti-pattern:**
```typescript
// ❌ WRONG — missing the repo-namespace level; two repos with the same slug collide
const store = new LedgerStore(slug, ledgerRoot);
// storageDir resolves to join(ledgerRoot, 'unknown', slug) for most inputs
// — correct only when deriveRepoName(planPath) happens to return 'unknown'
```

**Correct pattern — constructing from plan path (most common):**
```typescript
// ✅ CORRECT — LedgerStore(planPath, ledgerRoot) calls deriveRepoName internally
const store = new LedgerStore(planPath, ledgerRoot);
// storageDir === join(ledgerRoot, deriveRepoName(planPath), slug)
```

**Correct pattern — resolving from a URL slug parameter (GUI handlers):**
```typescript
// ✅ CORRECT — resolveProjectDir probes all namespace dirs to find the one containing slug
const storageDir = await resolveProjectDir(slug, ledgerRoot);
const meta = JSON.parse(await readFile(join(storageDir, '.meta.json'), 'utf-8'));
const store = new LedgerStore(meta.plan_path, ledgerRoot);
```

**Rationale:** The repo-namespaced layout eliminates slug collisions when multiple repositories create identically-named plan folders (e.g., two developers each have a `2026-01-01-initial-setup` plan). Bypassing the namespace level causes different projects to share a storage directory, silently corrupting each other's ledger data.

**See also:** `data-flows.md` §Storage Layout for the full directory structure; `api-surface.md` for `deriveRepoName()`, `resolveProjectDir()`, and `migrateToNamespacedLayout()` signatures.

---

### Project-Directory Discovery Must Be Centralized in `listAllProjectDirs()`

**Rule:** The flat-vs-namespaced two-level scan (`{ledgerRoot}/{slug}/` vs. `{ledgerRoot}/{repoName}/{slug}/`) has changed shape multiple times as the storage layout evolved. `LedgerStore.listAllProjectDirs()` in `src/storage/ledger-store.ts` is the single source of truth for this scan; `LedgerStore.listAllProjects()` delegates to it. **Never re-implement depth-1/depth-2 layout detection anywhere else** — including in root-level `scripts/` utilities.

Root-level Node scripts that need to enumerate ledger project directories MUST import `listAllProjectDirs()` from `scripts/lib/ledger-dirs.js`, which loads the compiled `LedgerStore` from `mcp-server/dist/` (rebuilding it when stale) rather than duplicating the scan logic in plain JavaScript. Current consumers: `scripts/backfill-duration.js`, `scripts/import-standalone.js` (`collectKnownSlugs()`), and `scripts/lib/store-commands.js` (`storeList()`).

**See also:** `api-surface.md` §`LedgerStore` static methods — `listAllProjectDirs()` signature and delegation contract.

---

### STDIO Logging Discipline

**Rule:** Never log to `stdout`. All logs must go to `stderr`.

**Rationale:** `stdout` is reserved for the MCP protocol. Logging to `stdout` breaks protocol communication.

**Implementation:**
```typescript
// ✅ CORRECT
console.error('[project-ledger-mcp] Server started');

// ❌ WRONG — breaks MCP protocol
console.log('[project-ledger-mcp] Server started');
```

---

## Schema Constraints

### Work Package IDs Must Follow WP-### Format

**Rule:** All work package IDs must match the regex `/^WP-\d{3,}$/` (e.g., `WP-001`, `WP-042`, `WP-999`, `WP-1000`). The minimum is three digits; there is no upper bound to future-proof projects beyond WP-999.

**Enforcement:** Validated by Zod schemas in `GetWorkPackageSchema`, `CreateWorkPackageSchema` (dependencies array), `ClaimWorkPackageSchema`, `StartPipelineSchema`, `CompletePipelineSchema`, `CancelPipelineSchema`, `UpdatePipelineProgressSchema`, and `AddObservationSchema`, as well as the utility functions `formatWpId()` and `parseWpId()`.

---

### Timestamps Must Use UTC ISO 8601 Format

**Rule:** All timestamp fields use UTC ISO 8601 format (`YYYY-MM-DDTHH:MM:SSZ`) with a trailing `Z`. Always use the `now()` utility function.

**Anti-pattern:**
```typescript
// ❌ WRONG — local time, inconsistent format
const timestamp = new Date().toLocaleString();
```

**Correct pattern:**
```typescript
// ✅ CORRECT — UTC with trailing Z
const timestamp = now(); // "2026-02-16T18:00:00Z"
```

**Backward compatibility:** `parseTimestamp()` accepts legacy formats (`YYYY-MM-DD HH:MM:SS`, `YYYY-MM-DDTHH:MM:SS` without Z) for ledger files written by earlier versions.

---

### JSON Must Be Pretty-Printed

**Rule:** All JSON files written by the server must use 2-space indentation and include a trailing newline.

**Rationale:** Human readability and clean git diffs.

**Enforcement:** `atomicWriteJson()` automatically formats as `JSON.stringify(data, null, 2) + '\n'`.

---

## Concurrency Constraints

### Lock Timeout Is 10 Seconds

**Rule:** File locks have a stale timeout of 10 seconds. Locks older than this are considered abandoned and can be forcibly acquired.

**Implication:** If a process crashes while holding a lock, other processes will wait up to 10 seconds before retrying.

---

### Lock Retry Count Is 50

**Rule:** Lock acquisition is retried up to 50 times with 200ms–1000ms exponential backoff before failing.

**Total retry window:** ~10–50 seconds, ensuring coverage of the 10s stale timeout.

---

## Module System Constraints

### All Imports Must Use .js Extensions

**Rule:** Even when importing TypeScript files, use `.js` extensions.

**Example:**
```typescript
// ✅ CORRECT
import { LedgerStore } from '../storage/ledger-store.js';

// ❌ WRONG
import { LedgerStore } from '../storage/ledger-store';
```

**Rationale:** Node16 module resolution requires explicit file extensions for ESM.

---

### No Default Exports

**Convention:** All exports are named exports. No default exports are used.

**Rationale:** Improves refactoring and tooling support.

---

## Validation Constraints

### All Reads Are Validated

**Rule:** Every file read operation validates the JSON against a Zod schema before returning data.

**Enforcement:** `LedgerStore.readRootIndex()` and `LedgerStore.readWorkPackage()` both parse and validate.

**Failure modes:**
- File not found → `ENOENT` error
- Malformed JSON → `SyntaxError`
- Schema mismatch → Zod validation error

---

### All Writes Are Validated

**Rule:** Every file write operation validates data against a Zod schema before writing.

**Enforcement:** `LedgerStore.writeRootIndex()` and `LedgerStore.writeWorkPackage()` call `Schema.parse()` before writing.

**Rationale:** Prevents writing invalid data to disk.

---

## Counter Self-Healing

### Project Status Tool Auto-Corrects Counters and Project Status

**Rule:** `ledger_get_project_status` recomputes `total_work_packages`, `pending_work_packages`, and the project `status` from the `work_packages` array on every invocation.

**Behavior:**
- If counters are incorrect, they are silently corrected.
- If `status === 'READY'` and any WP is `IN_PROGRESS`, status is healed to `IN_PROGRESS`.
- If `status === 'BLOCKED'` and no WP is actually `BLOCKED`, status is healed to `IN_PROGRESS` (pending WPs exist) or `READY` (no pending WPs).
- If `status === 'IN_PROGRESS'` and all WPs are complete (pending = 0, WPs exist), status is healed to `COMPLETE`.
- If `status === 'COMPLETE'` and pending WPs exist, status is healed back to `IN_PROGRESS`.
- An empty project (no WPs) is never auto-healed to `COMPLETE`.
- Healing rules are mutually exclusive and applied in order; only the first matching rule fires.
- The root index is rewritten only when a correction is made.

**Rationale:** Provides fault tolerance against bugs that might cause counter or status drift.

---

## Development & Build Constraints

### Changelog Is the Source of Truth for Versioning

**Rule:** All version changes must be made in `changelog.md` first, then synced to `package.json`.

**Rationale:** Maintains a single source of truth and ensures version history is documented.

**Process:**
1. Update `changelog.md` with a new version header.
2. Run `npm run sync-version` to extract the version and update `package.json`.
3. The MCP server displays the version at startup in STDERR.

**Anti-pattern:**
```bash
# ❌ WRONG — manually editing package.json version
vim package.json  # Don't do this!
```

**Correct pattern:**
```bash
# ✅ CORRECT — update changelog first, then sync
vim changelog.md  # Add new version
npm run sync-version
```

---

### Version Sync Runs Automatically Before Dev

**Rule:** The `predev` hook ensures the version is synced before running the development server.

**Implication:** You can skip manual `npm run sync-version` if running `npm run dev` — it happens automatically.

**Manual sync needed when:**
- Building for distribution
- Running in production
- CI/CD pipelines
- Testing version display without starting the server

---

### Server Version Displays at Startup

**Rule:** The MCP server logs its version to STDERR on startup.

**Example output:**
```
[project-ledger-mcp] Server v1.0.1 started successfully
[project-ledger-mcp] Transport: STDIO
[project-ledger-mcp] Registered tools: ledger_get_project_status, ...
```

**Purpose:** Allows users and CI systems to verify which version is running in their project.

---

### Runtime Config Is Read From an In-Memory Cache

**Rule:** `gui-config.json` is the single source of truth for runtime-adjustable settings (`auto_handoff_enabled`, `max_handoff_depth`). The following apply:

- The MCP server (`index.ts`) and GUI server (`gui/server.ts`) **both** must call `readConfigFromDisk()` at startup and `startConfigWatcher()` to begin monitoring.
- `getConfig()` **MUST NOT** read from disk — it returns from the in-memory singleton cache only.
- The `FSWatcher` must be closed via `stopConfigWatcher()` during graceful shutdown and in test teardown.
- The 250ms debounce is mandatory — do not reduce it. Windows `fs.watch()` commonly emits duplicate events within <100ms of a file write.
- On watcher error or file parse failure, the cache retains its last known good values. The server continues operating with stale config rather than crashing.
- `ledger_root` in `gui-config.json` is **read-only** from the GUI perspective. `writeConfig()` strips it from incoming data. API handlers **MUST NOT** allow callers to overwrite it via `PUT /api/config`.

---

## Manifest Documentation Constraints

### No Implementation Provenance in Manifest Documents

**Rule:** Project manifest documents (`api-surface.md`, `constraints*.md`, `data-flows.md`, etc.) describe the **current state** of the codebase. They must not contain work package IDs, plan references, or other implementation-history markers (e.g., `WP-003`, `added in WP-005`, `wired in WP-004`).

**Where provenance belongs:** Plan documents, synthesis reports, and changelog entries — not the manifest.

**Rationale:** WP IDs are scoped to individual plans. A reader who has not ingested the plan history cannot resolve `WP-006` to a meaningful context. Provenance markers also accumulate over time and add noise without aiding comprehension of current behavior.

**What is allowed:** References to `WP-###` as a *data format specifier* (e.g., `work_package_id: string // WP-### format`) are fine — these describe the runtime data model, not implementation history.

---

### No Counts, Tallies, or Inventories in Manifest Documents

**Rule:** Do not state how many tests, files, handlers, or constraints exist. Write the durable fact without the number — "all affected handler functions", not "all 18 affected handler functions". Include a figure only when it carries analytical value that inspection cannot supply, such as a threshold or a configured limit.

**Rationale:** Counts decay silently on the next commit while continuing to look authoritative. Any reader can obtain the current figure on demand; a stale one actively misleads.

**Anti-pattern:** "All 97 storage tests pass." · "Six view JS files inject HTML." · "12 helper classes."

**Correct pattern:** "The storage test suite passes." · "Several view JS files inject HTML." · "The helper classes in this module."

---

### Resolved Limitations Are Deleted, Not Annotated

**Rule:** When a known limitation is resolved, remove the entry. Do not retain it with a *(Resolved)* marker and a historical narrative. The resolution belongs in the changelog; the manifest describes only current state.

**Rationale:** A resolved limitation is not a limitation. Retained entries mislead readers into planning around a constraint that no longer exists, and their historical detail is exactly the provenance the rule above excludes.

---

### Constraints Are Cited by Heading, Not by Number

**Rule:** Do not number constraint entries, and do not cite them by number in source comments, tests, or sibling manifest documents. Reference the heading text or link to its anchor.

**Rationale:** Numbers collided repeatedly as the document grew — the same number came to identify two unrelated constraints, making every citation in that range ambiguous. Headings survive reordering, insertion, and redistribution across documents; numbers do not.

**Anti-pattern:** `// See Constraint 55.` · `**See also:** §63 for the general rule.`

**Correct pattern:** `// See "Non-PM Handoff Functions Must Dispatch…" in constraints-workflow.md.`

---

## Cross-Platform Constraints

### All Code Must Run on Windows, macOS, and Linux

**Rule:** The MCP server must work on all three supported platforms. Do not introduce OS-specific APIs without a cross-platform fallback. Use `path.join()` / `path.resolve()` for all file paths — never hardcode `/` or `\` separators.

**File locking:** Uses `proper-lockfile` (cross-platform npm package). Do not replace with a platform-specific alternative.

**Rationale:** The workspace-wide cross-platform policy (see root `AGENTS.md` → Cross-Platform Policy) applies to all sub-projects. The MCP server runs alongside the user's IDE on their desktop OS.

```
_SOURCE: GUI-layer constraints and conventions (frontend, backend routes, security, polling, DOM)_
# GUI-layer constraints and conventions (frontend, backend routes, security, polling, DOM)
```
// Structure of documents
└── mcp-server/
    └── gui/
        └── docs/
            └── agents/
                └── project-manifest/
                    └── constraints.md

```
###  Path: `/mcp-server/gui/docs/agents/project-manifest/constraints.md`

```md
# Constraints & Conventions — MCP Server GUI

> **Scope:** Every convention governing the GUI — the vanilla-JS frontend and the standalone HTTP
> server that serves it, including its REST handler modules (`gui/api*.ts`) and route table.
>
> **Companion documents (MCP server core):**
> [Core](../../../../docs/agents/project-manifest/constraints.md) ·
> [Workflow](../../../../docs/agents/project-manifest/constraints-workflow.md) ·
> [Testing](../../../../docs/agents/project-manifest/constraints-testing.md) ·
> [Code Style](../../../../docs/agents/project-manifest/constraints-code-style.md) ·
> [Storage & Knowledge](../../../../docs/agents/project-manifest/constraints-storage.md)
>
> Entries here are numbered for historical continuity, but cite them by heading — the core
> manifest dropped numbering after repeated collisions.

## Contents

**Frontend**

- [1. No Build Step](#1-no-build-step)
- [2. ES5-Compatible JavaScript](#2-es5-compatible-javascript-frontend)
- [3. Global Namespace Pattern](#3-global-namespace-pattern)
- [4. Hash-Based Routing Convention](#4-hash-based-routing-convention)
- [5. View Module Naming](#5-view-module-naming)
- [6. CSS Theming System](#6-css-theming-system)
- [12. Error Handling Convention](#12-error-handling-convention-frontend)
- [13. HTML Generation Convention](#13-html-generation-convention)
- [14. Version Busting Convention](#14-version-busting-convention)
- [18. CSS Class Derivation From API Values](#18-css-class-derivation-from-api-values-is-only-safe-for-zod-enum-validated-fields)
- [19. JSDoc Closure-Dependency Documentation](#19-jsdoc-closure-dependency-documentation-for-gui-helpers)
- [20. API Client `@throws` JSDoc](#20-api-client-methods-that-reject-on-server-error-must-carry-throws-jsdoc)

**Backend**

- [7. Security Constraints](#7-security-constraints-backend)
- [8. STDIO Discipline](#8-stdio-discipline)
- [9. Route Dispatch Ordering and Sub-Builder Composition](#9-route-dispatch-ordering-and-sub-builder-composition)
- [10. Deprecated Route Convention](#10-deprecated-route-convention)
- [11. Polling Convention](#11-polling-convention)
- [15. Dual-Format Endpoint Pattern](#15-dual-format-endpoint-pattern-formatstructured)
- [16. Hot-Reload After Store Config Writes](#16-hot-reload-after-store-config-writes)
- [21. Handler Domain Split — One File per API Domain](#21-handler-domain-split--one-file-per-api-domain)
- [22. Path-Traversal Guards Must Come First](#22-path-traversal-guards-must-come-first)
- [23. GUI Port Convention](#23-gui-port-convention--live-3420-vs-dev-3460)

**Reference**

- [24. Known Limitations](#24-known-limitations)

---

## 1. No Build Step

The frontend has **zero build tooling**. All `.js` and `.css` files in `public/` are served as-is by the static file server. There is no bundler, no minifier, no transpiler, no source maps.

**Implications:**
- Do not use `import`/`export` syntax in frontend files.
- Do not use `let`, `const`, arrow functions, template literals, or other ES6+ features in frontend code.
- Do not add a `package.json` to `gui/` or `gui/public/`.
- Do not introduce webpack, vite, rollup, esbuild, or any bundler.
- Cache-busting is done manually via `?v=N` query strings in `index.html` script/link tags.

---

## 2. ES5-Compatible JavaScript (Frontend)

All frontend JavaScript uses **ES5-compatible patterns**:

- `var` instead of `let`/`const`.
- `function` declarations instead of arrow functions.
- String concatenation instead of template literals.
- IIFE module pattern instead of ES modules.
- `Promise` chains with `.then()` / `.catch()` (native Promises are the one ES6 feature used, as all target browsers support them).

**Exception:** `async/await` appears in `api-client.js` internal helper — this is acceptable because the GUI targets modern browsers where async/await has been supported since 2017.

**Rationale:** The codebase was designed for maximum simplicity and zero dependencies. The pattern is intentional — do not "upgrade" to modern syntax without adding a transpilation step.

**Event listener lifecycle on persistent DOM elements:** There are no framework lifecycle hooks. Any module that registers a `click` (or other) listener on a persistent element (e.g., `document.body`, a tab container, a persistent table wrapper) **must** manage the listener reference manually:

```javascript
var csClickHandler = null;

function csInitListeners() {
  csClickHandler = function (e) { /* … */ };
  persistentEl.removeEventListener('click', csClickHandler); // guard against double-init
  persistentEl.addEventListener('click', csClickHandler);
}

function csCleanup() {
  if (csClickHandler) {
    persistentEl.removeEventListener('click', csClickHandler);
    csClickHandler = null;
  }
}
```

Skipping the `removeEventListener` guard causes listeners to accumulate silently each time the tab/view is re-rendered, leading to duplicate event handling that is difficult to diagnose. This pattern is established in `config-stores.js` and `config.js`; all future tab modules must follow it from the start.

---

## 3. Global Namespace Pattern

Frontend modules expose their public API as global variables via IIFEs:

```javascript
var ModuleName = (function () {
  // private
  return { publicMethod: fn };
})();
```

**Rules:**
- Each file exposes exactly one namespace (or a set of bare functions for `utils.js`).
- Dependencies between modules are implicit (load order in `index.html` matters).
- View files expose a `render*` function that the router calls.
- Do not introduce a module loader or import map.

**Cross-module shared state (`globalThis`):** When a view is split into sub-modules that need to share a mutable array or object, the owning module declares it as a `var` and immediately promotes it to `globalThis`:

```javascript
// In the owning module (project-detail.js):
var _pdLogPreviewCleanups = [];
globalThis._pdLogPreviewCleanups = _pdLogPreviewCleanups;
```

Sub-modules then reference the shared state exclusively via `globalThis.*`. All in-place mutations (`.push()`, `.length = 0`) operate on the same array instance.

**Drain invariant:** Drain sites must use `.length = 0` (in-place reset), never `= []` (reassignment). Reassignment would create a new array that the other module's reference does not see, silently breaking the drain contract. See `data-flows.md §3a` for the full project-detail module load-order and shared-state documentation.

---

## 4. Hash-Based Routing Convention

- All client-side routes use `#` prefix (e.g., `#/projects/repo/slug`).
- The router matches routes via regex patterns in declaration order.
- Route parameters are extracted via capture groups.
- All URL parameters passed to API calls must be `encodeURIComponent()`-encoded.
- New routes must be added to **both** `router.js` (dispatch) and the corresponding view file.

---

## 5. View Module Naming

| Convention | Example |
|------------|---------|
| File name | `views/{noun}.js` (hyphenated) |
| Render function | `render{PascalCase}(app, ...params)` |
| First argument | Always the `#app` container element |
| Pattern | `showLoading()` → fetch → build HTML string → set innerHTML |

Views must:
- Call `showLoading(app)` before any async work.
- Handle fetch errors with `showError(app, message)`.
- Use `breadcrumb()` for navigation context.
- Cache project names via `ProjectNameCache.set()` when fetching project data.

---

## 6. CSS Theming System

- All colors are defined as CSS custom properties on `:root`.
- Dark mode overrides properties under `[data-theme="dark"]`.
- Hard-coded hex values in dark overrides are acceptable (and necessary for specific badge backgrounds).
- Never use hard-coded colors in the light-theme base styles — always reference `var(--color-*)`.
- The `theme-init.js` script in `<head>` prevents FOUC by setting the attribute before body renders.

---

## 7. Security Constraints (Backend)

### Path Traversal Prevention

- All URL path parameters (slug, repo, wpId, filename) are validated against allowlist regexes before filesystem access.
- `SAFE_SLUG_REGEX` (`/^[a-z0-9][a-z0-9-]*$/`) for project slugs and repo names.
- `SAFE_ID_PATTERN` (`/^[A-Za-z0-9][\w-]*$/`) for WP IDs and queue entry IDs.
- Static file serving checks `resolve(filePath).startsWith(PUBLIC_DIR)`.
- Invalid parameters always return `NOT_FOUND` — never a different error that could leak information.

### Body Size Limit

- `MAX_BODY_BYTES = 1_048_576` (1 MiB) enforced by `readBody()`.
- Both `Content-Length` pre-check and streaming byte-count check.
- Exceeding the limit throws `PayloadTooLargeError` → HTTP 413.

### Information Hiding

- Ambiguous slug resolutions are downgraded to NOT_FOUND (cross-namespace existence leak prevention).
- Malformed `.meta.json` files log to stderr but return NOT_FOUND to clients.
- Error responses never include internal paths or stack traces.

### Security Headers

All responses include:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`

---

## 8. STDIO Discipline

- **`server.ts`**: May write to stdout (it runs as a standalone process, not an MCP server).
- **`api.ts`, `api-knowledge.ts`, `orchestrator-manager.ts`**: Never write to `process.stdout`. Diagnostics go to `process.stderr` only.
- **Rationale:** The MCP server communicates via stdout. Although the GUI is a separate process, handler files are shared — keeping them stdout-free prevents accidental protocol corruption if handlers are ever loaded in the MCP process.

---

## 9. Route Dispatch Ordering and Sub-Builder Composition

Routes in `server.ts` are declared in `buildRoutes()` and matched in declaration order by `dispatchRoute()`. `buildRoutes()` delegates to non-exported domain sub-builders — `buildConfigRoutes`, `buildOrchestratorRoutes`, `buildRepoRoutes`, `buildKnowledgeRoutes`, `buildModelRoutes`, `buildStoreRoutes`, `buildProjectRoutes` — composed via spread. When adding a route, add it to the appropriate sub-builder; the spread ordering in `buildRoutes()` must not be changed, since it is what preserves the section ordering below. Each sub-builder receives only the closure variables its handlers require. The table is organized into three sections:

- **Section A** — Body-parsing routes (`PUT`, `PATCH`, `POST`). These routes use `readJsonBody()` and have no `noBody` flag.
- **Section B** — Keyword-specific body-free routes (`noBody: true`). Both active namespaced (`/:repo/:slug/keyword`) and deprecated flat (`/:slug/keyword`) variants live here. **Section B MUST precede Section C** — this is a load-bearing ordering constraint, not cosmetic. A Section C catch-all regex would shadow keyword-specific routes if declared first.
- **Section C** — Catch-all body-free routes (`noBody: true`). These match any remaining path shapes after Section B has had priority.

When adding new routes:

- More-specific patterns (keyword routes) must appear in **Section B** before the **Section C** catch-alls.
- All parameterised routes must use RegExp with **named capture groups** (e.g., `(?<slug>[^/]+)`) — positional groups are not permitted.
- Namespaced routes (`/:repo/:slug/...`) and legacy flat routes (`/:slug/...`) coexist within the same section — both are equally matched by `dispatchRoute()`.
- Route handlers conform to the `Route` interface defined in `server.ts`. `Route.method` is typed as the `HttpMethod` union (`'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'`) — not `string` — giving compile-time safety for route method values.

---

## 10. Deprecated Route Convention

Legacy non-namespaced routes (e.g., `/api/projects/:slug`) are retained for backward compatibility and marked with `@deprecated` comments. Each deprecated route has a comment pointing to its namespaced replacement. These will be removed in the next major version.

---

## 11. Polling Convention

- Views that need live data set up polling via `Router._setPolling(fn, delayMs)`.
- The router **automatically clears** any active interval on route change.
- The `OrchestratorWidgets.renderLogPreview()` returns a cleanup function for component-level polling. Callers must wrap the push with `if (cleanup)` to defend against a null/undefined return (the current implementation always returns a function, but the guard is kept for contract safety).
- Default intervals: 3–5 seconds for active data, 30 seconds for stale checks.
- **In-place patch pattern (project-detail):** `renderProjectDetail` avoids full-page rebuilds on poll ticks by comparing a stable structure key (`_orchRunsStructureKey`) against the previous tick. If the structure is unchanged, only the status card's `innerHTML` is replaced (`_patchOrchStatusCard`). If the structure changed (new run, run completed, or first tick), a full `renderRunsList` is performed with scroll-position save/restore. See `data-flows.md §9` for details.

---

## 12. Error Handling Convention (Frontend)

- API errors are caught and displayed via `showError(container, message)`.
- Error objects have shape `{ code: string, message: string }`.
- `window.alert()` is used for action failures (kill, dismiss) where the page shouldn't navigate.
- `window.confirm()` gates destructive actions (kill, delete).

---

## 13. HTML Generation Convention

- Views build HTML as concatenated strings (not DOM manipulation).
- Set `container.innerHTML = htmlString` in one assignment.
- Use `escapeHtml()` for ALL user-provided text to prevent XSS.
- Never use `innerHTML` with unescaped user data.
- DOM event listeners (for buttons, forms) are attached AFTER innerHTML is set, using `querySelector` / `getElementById`.

---

## 14. Version Busting Convention

Script and stylesheet references in `index.html` use `?v=N` query parameters for cache busting:

```html
<script src="/api-client.js?v=3"></script>
```

When modifying a frontend file, increment its `?v=N` parameter in `index.html` to ensure browsers pick up the change.

---

## 15. Dual-Format Endpoint Pattern (`?format=structured`)

Some backend endpoints support a `?format=structured` query parameter to switch the response
between a plain-text format and a structured JSON format without breaking existing callers.

**Current endpoints using this pattern:**

| Endpoint | Without parameter | With `?format=structured` |
|----------|-------------------|---------------------------|
| `GET …/chunks/:filename/rendered` | `{ content: string }` — Markdown from `renderChunksToDialogue()` | `{ blocks: DialogueBlock[] }` — typed array from `renderChunksToStructured()` |

**Rules for this pattern:**

1. **Backward-compatible by default.** Omitting the parameter always returns the legacy format.
   Existing callers do not need to be updated.
2. **Format detection is via `URLSearchParams`.** Use
   `new URLSearchParams(qStr).get('format') === 'structured'` — do not parse manually.
3. **Only `format=structured` is a valid structured-mode value.** Any other value falls back to the
   default format; no error is returned for unknown values.
4. **New dual-format endpoints must document both response shapes** in `api-surface.md`
   (routes table row) and the corresponding data flow in `data-flows.md`.

---

## 16. Hot-Reload After Store Config Writes

Every write handler in `api-stores.ts` (`handleAddStore`, `handleImportStore`, `handleUpdateStore`, `handleRemoveStore`, `handleSetDefaultStore`, `handleReorderStores`) **must** call `reloadStoreContext()` after a successful `saveStoresConfig()`. This is mandatory — skipping it leaves the in-memory `StoreRouter` and `MultiStoreManager` stale while the on-disk `stores.json` has been updated, causing subsequent read/write operations to use the wrong store routing.

**`reloadStoreContext()` contract:**
- Calls `loadStoresConfig()` to re-read `stores.json` from disk.
- Constructs `new StoreRouter(config, { skipDirCreate: true })` — the `skipDirCreate` flag prevents `mkdirSync` from throwing when a store path is temporarily unavailable (unmounted drive, offline NFS). Directory creation is the responsibility of `handleAddStore`, not of the reload.
- Calls `setStoreContext(router, manager)` to overwrite the module-level singletons.
- Returns the new `StoresConfig | null` so callers can use it to build the response.

**Failure handling:** If `reloadStoreContext()` throws (unexpected I/O error), the write handler returns a 500. The config file was already saved — the client should retry the read (`GET /api/stores`) to get the current state.

**Test isolation:** Test suites that call `setStoreContext()` directly do not need to call `reloadStoreContext()`. The real-implementation tests for write handlers should verify that the in-memory context reflects the updated config after each mutation.

---

## 18. CSS Class Derivation From API Values Is Only Safe for Zod-Enum-Validated Fields

CSS class derivation from raw API values is only safe when the field is a Zod-enum-validated type. For non-enum fields, apply `escapeHtml()` or a whitelist map.

**Rationale:** The pattern `(field).toLowerCase().replace(/ /g, '_')` generates a CSS class string from a server-supplied value. If the field is a closed Zod enum, the server guarantees the value is one of a finite safe set — class injection is not possible. If the field is a free-form string (`z.string()`), a tampered ledger JSON (or a future schema relaxation) could insert arbitrary characters into a `class=""` attribute, enabling CSS injection or layout-breaking attacks.

**Anti-pattern:**
```javascript
// ❌ WRONG — open string field; output is injected into class="" without escaping
var cls = (someOpenStringField || '').toLowerCase().replace(/ /g, '_');
el.innerHTML = '<span class="badge ' + cls + '">…</span>';
```

**Correct patterns:**
```javascript
// ✅ OPTION A — field is a closed Zod enum (safe by schema contract)
// p.status is WorkPackageStatus — a Zod enum with a fixed value set
var cls = (p.status || '').toLowerCase().replace(/ /g, '_');

// ✅ OPTION B — whitelist map (safe for any field type)
var STATUS_CLASS = { READY: 'ready', IN_PROGRESS: 'in_progress', COMPLETE: 'complete', BLOCKED: 'blocked', CANCELLED: 'cancelled' };
var cls = STATUS_CLASS[p.status] || 'unknown';

// ✅ OPTION C — escapeHtml() before insertion (safe for any field type)
var cls = escapeHtml((someField || '').toLowerCase().replace(/ /g, '_'));
```

**Scope:** Applies to all client-side JavaScript in `gui/public/`. When adding new attribute values derived from API data, determine whether the field is enum-backed before using the raw-derivation pattern.

---

## 19. JSDoc Closure-Dependency Documentation for GUI Helpers

Every closure-scoped helper function in `gui/public/views/*.js` that reads or mutates variables from its enclosing scope MUST include a `Closure dependencies (from <parent>() scope):` JSDoc block listing each closed-over variable with a one-line description of whether it is read-only or mutated by this helper.

**Example:**
```javascript
/** Injects action buttons into the rendered table.
 *
 *  Closure dependencies (from renderOrchestrator() scope):
 *    `expandedIds`   — mutated; toggle clicks update row expansion state.
 *    `refreshQueue`  — read-only; called after Kill/Dismiss actions. */
function _bindQueueActions(container, entries) { /* ... */ }
```

**Rationale:** Vanilla JS files lack module-level imports that make dependencies visible. Without explicit documentation, future contributors cannot determine which outer-scope variables a helper depends on without reading the entire enclosing function.

**Scope:** Applies only to `gui/public/views/*.js` files (vanilla JS, no module system). TypeScript modules in `src/` use explicit imports and do not need this pattern.

---

## 20. API Client Methods That Reject on Server Error Must Carry `@throws` JSDoc

Any method in `gui/public/api-client.js` that can reject its returned Promise with a structured server error object MUST include a `@throws` JSDoc tag documenting the shape of that error:

```javascript
/**
 * @throws {{ code: string, message: string }} On non-ok response from the server.
 */
```

**Scope:** Applies to all methods in the Model Registry group (`getModels`, `saveModels`, `loadDefaultModels`), the Persona group (`getAssignments`, `updateAssignments`, `replaceAssignedModel`, `rebuildPersonas`, `getPersonas`), and any future API method that may reject with a structured error. Methods that never reject with a structured error object (e.g. methods that return `null` on 404) are exempt.

**Rationale:** `api-client.js` has no TypeScript types. Without `@throws` JSDoc, callers have no machine-readable signal that error objects carry `code` and `message` properties — critical for correct `catch` block handling. The tag is the only inline contract available in a plain-JS, no-build-step environment.

**Anti-pattern:**
```javascript
// ❌ WRONG — caller has no documented error shape
getModels: async function () { /* ... */ },
```

**Correct pattern:**
```javascript
// ✅ CORRECT — error shape is documented for callers and tooling
/**
 * @throws {{ code: string, message: string }}
 */
getModels: async function () { /* ... */ },
```

---

## 21. Handler Domain Split — One File per API Domain

Each API domain owns a dedicated handler module imported by `server.ts`. No handler code for these domains may be added to or remain in `gui/api.ts`.

| Module | Owns |
|--------|------|
| `gui/api-knowledge.ts` | `/api/knowledge*` handlers, `KnowledgeUpdateBodySchema`, `KnowledgeMoveBodySchema`, `KnowledgeListParams`, `parseKnowledgeId` |
| `gui/api-repos.ts` | `/api/repos*` handlers, `RepoCreateBodySchema`, `RepoUpdateBodySchema`, `RepoListItem`, `assertNoFolderNameConflicts` |
| `gui/api-stores.ts` | `/api/stores/*` handlers, their Zod body schemas, `StoreListItem` |
| `gui/api-models.ts` | Model registry and persona-assignment handlers |

**Rationale:** `gui/api.ts` had grown into a maintenance liability. Extracting each domain into its own module isolates ownership and prevents drift back into `api.ts`. Each extracted module re-defines `validationError` locally (importing `ApiError` directly) rather than re-exporting it from `api.ts`.

**Implication for `gui/server.ts`:** Import domain handlers from their own module — never from `./api.js`. All routes are registered in the unified `buildRoutes()` table and dispatched by `dispatchRoute()`.

**Domain-specific notes:**

- **`POST /api/repos` returns 201, not 200.** This is intentional — correct REST practice for resource creation. All other mutation routes return 200. The 201 is set via the `statusCode: 201` field on the route entry and must not be changed.
- **`RepoCreateBodySchema` and `RepoUpdateBodySchema` are `@internal`.** They are exported so tests can construct validated shapes without duplicating schema logic. They are not a stable public API — keep them marked `@internal` when editing `api-repos.ts`.
- **Store route ordering:** literal-path routes (`/api/stores/import`, `/api/stores/order`, `/api/stores/conflicts`) MUST be registered before parameterized `:storeId` routes (`/api/stores/:storeId`, `/api/stores/:storeId/default`) to prevent shadowing.
- **`handleGetStoresEnriched` replaces `handleGetStores`.** `handleGetStoresEnriched(ledgerRoot)` returns `StoreListItem[]` enriched with `is_default`, `is_git`, and optional `ahead`/`behind` fields. Do not re-add a bare `handleGetStores` to `api.ts`.

**Anti-pattern:**
```typescript
// ❌ WRONG — domain handler in api.ts, or re-exported via api.ts
export async function handleListRepos(...) { /* in gui/api.ts */ }
```

**Correct pattern:**
```typescript
// ✅ CORRECT — handler in the dedicated module
// gui/api-repos.ts
export async function handleListRepos(...) { /* ... */ }

// gui/server.ts
import { handleListRepos } from './api-repos.js';
```

---

## 22. Path-Traversal Guards Must Come First

Every GUI API handler that accepts a path segment parameter must call its corresponding guard as the **first** statement (slug) or **second** statement (wpId), before any other processing.

| Guard | Parameter | Placement |
|-------|-----------|-----------|
| `assertSafeSlug(slug)` | project slug or repo name | 1st statement |
| `assertSafeWpId(wpId)` | work-package ID | 2nd statement (after `assertSafeSlug`) |

**Rejection criteria (both guards):** throws `ApiError` with code `NOT_FOUND` (HTTP 404) if the value is empty (`''`), contains a forward slash (`/`), or contains a double dot (`..`).

**Rationale:** Returning `NOT_FOUND` rather than `FORBIDDEN` on traversal attempts is intentional — it avoids leaking structural information about the server's file system, and is consistent with the standard "project not found" response.

**Implementation:** Both guards are module-private (not exported). They must not be bypassed or called after other parameter-dependent operations. `assertSafeSlug` in `gui/api.ts` delegates to `assertSafeSegment()` from `src/utils/path-validator.ts`; the copy in `gui/server.ts` still performs an inline `SAFE_SLUG_REGEX.test()` — see the core manifest's [Known Limitations](../../../../docs/agents/project-manifest/constraints-storage.md#known-limitations).

**Acceptance-criteria wording:** see [Path-Traversal Acceptance Criteria Use 404 Wording](../../../../docs/agents/project-manifest/constraints-testing.md#path-traversal-acceptance-criteria-use-404-wording).

---

## 23. GUI Port Convention — LIVE (3420) vs. DEV (3460)

The GUI server uses **port 3420** as its default. This port is reserved for the **LIVE workspace** — the installed production copy of the MCP server that agents use during active ledger workflows. When running the GUI from the **DEV workspace** (this repository, a feature branch, or any development build), always pass `--port 3460`:

```bash
# ✅ CORRECT — DEV workspace / feature branch
node scripts/run-gui.js -- --port 3460

# ✅ CORRECT — LIVE workspace (default; no flag needed)
node scripts/run-gui.js
```

**Rationale:** The LIVE and DEV workspaces can run simultaneously on the same machine. Without distinct ports, a DEV GUI process silently shadows the LIVE instance (or vice versa), causing agents mid-workflow to read stale or incorrect ledger data from the wrong server.

**Anti-pattern:**
```bash
# ❌ WRONG — launching a DEV GUI on the default port while LIVE is running
node scripts/run-gui.js   # collides with the LIVE instance on port 3420
```

**Port registry:**

| Port | Workspace | When to Use |
|------|-----------|-------------|
| 3420 | LIVE (production install) | Default; leave unset for the installed, workflow-active build |
| 3460 | DEV / feature branch | Always pass `--port 3460` when running from this repository |

---

## 24. Known Limitations

| Limitation | Impact |
|------------|--------|
| No hot reload (frontend) | Must manually refresh browser after frontend JS/CSS changes. |
| No TypeScript on frontend | No type checking for client-side code. |
| Single-threaded server | No worker threads; long handler blocking affects all requests. |
| No WebSocket | Polling-based updates only; no push notifications. |
| CORS locked to localhost | Cannot access from remote machines without modification. |
| Queue file locking gap | TypeScript uses atomic rename; Python uses `.run-queue.lock`. Concurrent writes could race (low risk). |
| No authentication | Local development tool; assumes trusted network. |
| Markdown rendered without HTML sanitization | All markdown rendering (`work-package.js`, `project-detail-dialogues.js`, plan/synthesis views) passes content through `marked.parse()` without DOMPurify or equivalent. Acceptable because all rendered content is server-authored by MCP tools from agent pipelines. If the system ever accepts markdown from untrusted sources (user-submitted descriptions, external imports), a sanitization step must be added before rendering. |

```