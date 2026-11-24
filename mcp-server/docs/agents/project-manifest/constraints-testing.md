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
- [Path-Traversal Acceptance Criteria Use 404 Wording](#path-traversal-acceptance-criteria-use-404-wording)
- [New Error-Code Providers Must Pass `describeProviderContract`](#new-error-code-providers-must-pass-describeprovidercontract)
- [Network-Backed Providers Never Call a Real Service](#network-backed-providers-never-call-a-real-service)
- [Slow Lock-Contention Tests Use the `withLock` Fast-Lock Test Seam](#slow-lock-contention-tests-use-the-withlock-fast-lock-test-seam)
- [Fire-and-Forget Self-Heal Writes Use the `pendingSelfHeals` Test Seam](#fire-and-forget-self-heal-writes-use-the-pendingselfheals-test-seam)

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

**Rule:** When writing tests that need to inspect tool metadata (input schema shape, parameter constraints, tool descriptions) without spinning up a real MCP server, use the mock `McpServer` intercept pattern: create a plain object with a `registerTool` method that captures schemas into a `Map`, cast it `as unknown as McpServer`, and call `registerAllTools()` (`src/tools/registry.ts`) with it in `beforeAll` — not each tool module's `register()` individually.

**Rationale:** This pattern exercises the exact production registration path — same `registerTool` calls, same `inputSchema` references — without a network socket or real server lifecycle. It is safe with `beforeAll` because registration is synchronous. Deriving the module list from the registry, rather than importing each tool module by hand, means a new module added to `TOOL_MODULES` is covered automatically.

**Correct pattern:**

```typescript
import { beforeAll, describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from '../../src/tools/registry.js';

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
  registerAllTools(mockServer);
});

describe('pipeline schemas', () => {
  it('ledger_start_pipeline has non-empty properties', () => {
    const schema = capturedSchemas.get('ledger_start_pipeline')!;
    const json = zodToJsonSchema(schema) as { properties?: object };
    expect(Object.keys(json.properties ?? {})).not.toHaveLength(0);
  });
});
```

**Zero-parameter allowlist:** A tool that legitimately takes no parameters (e.g. `ledger_ping`) is exempt from the "non-empty properties" assertion via a named `ZERO_PARAMETER_TOOLS: ReadonlySet<string>` allowlist, checked per tool name before asserting. Add a tool to this set only when it genuinely has no parameters — it is a deliberate exception list, not a place to silence a failing assertion.

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

---

### New Error-Code Providers Must Pass `describeProviderContract`

**Rule:** A provider's test file calls `describeProviderContract(name, makeProvider, makeCtx)` (`tests/error-codes/provider-contract.ts`) alongside its own provider-specific tests, for every built-in provider and every reference-example plugin shipped in the repository (e.g. `docs/examples/error-code-provider-example/`). `makeProvider` must return a fresh provider instance per call, and `makeCtx` must accept an optional `Partial<ProviderContext>` override (used by the suite's abort-handling check to supply an already-aborted `signal`).

**Rationale:** The shared suite checks only what every `ErrorCodeProvider` must hold regardless of backend — a well-formed `settings` array, a positive-integer result, a monotonically increasing sequence, tolerance of unknown request fields, and settling instead of hanging on an aborted signal. Writing these checks once, and running them against every provider, catches a contract violation the moment a provider is added or changed, rather than only when the allocator's own tests happen to exercise that provider.

**Anti-pattern:** A new provider's test file re-implementing "returns a positive integer" and "increases monotonically" assertions inline instead of calling `describeProviderContract`.

**Correct pattern (see `file-provider.test.ts`):**
```typescript
describeProviderContract(
  'file provider',
  () => fileProvider,
  (overrides) => makeCtx(dataDir, overrides)
);
```

---

### Network-Backed Providers Never Call a Real Service

**Rule:** A provider that performs I/O over the network (e.g. the `errorcode-incrementor` provider) stubs the global `fetch` with `vi.stubGlobal('fetch', ...)` in every test, including the `describeProviderContract` run against it. No test file under `tests/error-codes/` ever makes a real HTTP request. `tests/error-codes/no-private-config.test.ts` additionally proves that no private host, counter name or credential string for the user's own service ships anywhere under `mcp-server/src`, `mcp-server/gui`, `mcp-server/docs` or `mcp-server/tests` — only the setting *descriptors* (with no `default`) are allowed to exist in the repository.

**Rationale:** The Errorcode Incrementor service is reachable only with the user's own private host and credentials, which never belong in a public repository or in CI. Stubbing `fetch` keeps the suite deterministic, fast, and independent of any real backend being reachable, while the no-private-config test is a standing guard against a credential accidentally being pasted into source, docs, or a test fixture.

**Correct pattern (see `errorcode-incrementor-provider.test.ts`):**
```typescript
vi.stubGlobal('fetch', vi.fn(async () => new Response('52001', { status: 200 })));
```

---

### Slow Lock-Contention Tests Use the `withLock` Fast-Lock Test Seam

**Rule:** A test that deliberately contends `withLock` (parallel calls against the same `storageDir`, or a cross-process worker fixture) installs the fast retry policy in `beforeEach` via `__setLockRetryForTesting({ minTimeout, maxTimeout })` (`src/storage/file-lock.ts`) and restores it in `afterEach` via `__resetLockOptionsForTesting()`. Cross-process worker fixtures (`tests/error-codes/fixtures/concurrent-allocation-worker.ts`, `run-workers.ts`) pass `fastLock: true` (or the `--fast-lock` CLI flag) so the spawned process installs the same policy — the in-process setter alone never reaches a separate worker process. Do not raise a test's own timeout as a substitute for installing the seam; lower or remove a previously-raised timeout once the seam makes the default sufficient (cross-process tests keep an explicit, lower timeout for process-spawn variance, not for lock backoff).

**Rationale:** Contended `withLock` acquisitions pay the production retry/backoff schedule (`DEFAULT_LOCK_OPTIONS`, derived from a 10s stale timeout) by default, costing ~350–850 ms per acquisition in a test. The seam is an in-process setter (plus a worker-process CLI flag), never an environment variable read by `file-lock.ts` itself, so a stray environment variable in production can never weaken real locking. `withLock`'s default behaviour is pinned by characterization tests in `tests/storage/file-lock.test.ts` before any test adopts the seam, since `withLock` is legacy code with no dedicated prior test file.

**Correct pattern (see `tests/error-codes/temporary-codes.test.ts`, `file-provider.test.ts`, `config-store.test.ts`):**
```typescript
beforeEach(() => {
  __setLockRetryForTesting({ minTimeout: 5, maxTimeout: 25 });
});

afterEach(() => {
  __resetLockOptionsForTesting();
});

// cross-process worker:
await runWorkers(workerPath, args, { fastLock: true });
```

---

### Fire-and-Forget Self-Heal Writes Use the `pendingSelfHeals` Test Seam

**Rule:** A test whose `afterEach` removes a temp directory that a fire-and-forget self-heal write may still be targeting — the pattern used by `handleGetProject`'s `.meta.json` cache-refresh write in `gui/api.ts` — awaits `__awaitPendingSelfHealsForTesting()` before the `rm`, instead of a fixed-duration `setTimeout` sleep. Do not reintroduce a sleep to "wait for the write to land"; a sleep is both slower than necessary and timing-dependent (a slow CI runner can still race it), which is exactly the `ENOTEMPTY` teardown race this seam replaced.

**Rationale:** `handleGetProject` never awaits its own self-heal write — doing so would add lock latency to every production project-detail request. Instead, each write's promise is tracked in a module-level `pendingSelfHeals: Set<Promise<void>>` (added on start, removed in `finally` regardless of outcome, so the set never grows unbounded) and `__awaitPendingSelfHealsForTesting()` resolves once every currently-tracked write has settled. This gives tests a deterministic hook without changing production's fire-and-forget behaviour.

**Correct pattern (see `tests/gui/api.test.ts`, `tests/gui/multi-store-api.test.ts`):**
```typescript
afterEach(async () => {
  await __awaitPendingSelfHealsForTesting(); // gui/api.ts
  await rm(tempDir, { recursive: true, force: true });
});
```

A 5 ms sleep kept elsewhere in the same test file for an unrelated reason (e.g. forcing timestamp ordering between an archive and an unarchive) is not part of this seam and should stay, with a comment stating why it is there.
