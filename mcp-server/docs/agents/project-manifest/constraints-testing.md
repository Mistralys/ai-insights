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
