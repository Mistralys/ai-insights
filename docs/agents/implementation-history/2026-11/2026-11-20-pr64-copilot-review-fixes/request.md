# Request: Fix the verified Copilot review findings of PR #64

Repository: `ai-insights` (branch `feature-error-code-generator`, PR https://github.com/Mistralys/ai-insights/pull/64).
Copilot left seven open review threads on the error-code allocator feature. Each was checked
against the code on the branch (paths relative to `ai-insights/`). **All seven are confirmed.**
Plan the fixes, including tests. Scope: only these findings and what they force.

Threads can be re-fetched with `node scripts/fetch-pr-review-comments.js --repo Mistralys/ai-insights --pr 64`.

## Findings

### F1 — `peek()` keeps an `increment` parameter that is already in `base_url`
- `mcp-server/src/error-codes/providers/errorcode-incrementor-provider.ts`, `buildRequestUrl()` (l.47-55).
- Only `allocate` calls `searchParams.set('increment','yes')`; `peek` never removes it. Reproduced: `new URL('https://x.test/?increment=yes')` keeps it after `set('pw', …)`.
- Impact: the GUI "Test connection" (`mcp-server/gui/api-error-codes.ts` l.334, falls back to `peek`) consumes a real code for such a base URL.
- Fix direction: `delete('increment')` for `peek`.

### F2 — Corrupt or unreadable counter file is treated as a new sequence (file provider)
- `mcp-server/src/error-codes/providers/file-provider.ts`, `readCountersFileOrDefault()` (l.40-57).
- Every failure (any `readFile` error, bad JSON, schema failure) returns the empty default. `allocate` then writes `start_value` over the real file, so a base already used in source can be issued again.
- Fix direction: default only on `ENOENT`; throw otherwise. `allocator.ts` (`provider.allocate` wrapper, ~l.335) already turns a provider throw into reason `failed`, which falls back to a temporary code. `peek` shares the reader; decide what it reports.

### F3 — Inherited object keys corrupt the counters file
- `file-provider.ts` `nextValueFor()` (l.98-101) and the `z.record` schema (l.34-36).
- Reproduced: with key `constructor` or `toString`, `counters[key] ?? start-1` yields the inherited function, `+ 1` yields the string `"function Object() { [native code] }1"`, which is persisted. The next read fails the integer schema, so by F2 the whole file resets. `__proto__` is silently never stored (the same value would be issued forever).
- Keys come from `counter_name` (any string) and `repository.folder_name`.
- Fix direction: own-property-safe lookup (e.g. `Object.hasOwn`) and write path, plus one consistent reserved-key policy applied to read, write and validation. Copilot notes a lookup-only fix leaves `__proto__` unsafe.

### F4 — The lock does not protect a counter file shared between users
- `file-provider.ts` `allocate()` (l.112-122) locks `ctx.data_dir`, which is per user (`~/.ai-insights/error-codes/data/file/`, from `resolveProviderDataDir` in `allocator.ts`).
- Valid for a `counter_file` pointing at one shared absolute path (network share etc.): different users hold different locks and can both read N and return N+1. Two separate clones of a repository do **not** share a `{repo}/…` file, so Copilot's "repository-local" example is weaker than stated; one user's worktrees do share `data_dir`, so they are safe today.
- **Design tension for the plan:** the comment at l.112-115 locks `data_dir` on purpose, because `withLock` (`mcp-server/src/storage/file-lock.ts`) creates `.lock` inside the locked directory and a `{repo}/.error-codes.json` would leave an untracked `.lock` in the user's repository. A lock that really contends across users has to live next to the shared file, which reintroduces exactly that artefact. `withLock` currently hard-codes `{storageDir}/.lock` and has other callers. Decide the lock location (e.g. `{counter_file}.lock`, a new lock helper keyed by canonical path) and how to keep it out of repositories (documentation, `.gitignore` guidance, or accepting it), or whether to narrow the supported claim instead. Copilot also asks for a test with two different `data_dir` values targeting one file.

### F5 — Corrupt temporary-code log resets the sequence and history
- `mcp-server/src/error-codes/temporary-codes.ts`, `readFileOrDefault()` (l.64-81), used by `issueTemporaryCode()` and `listTemporaryCodes()`.
- Any failure, including one invalid historical entry, resets `next_counter` to 1 and drops `entries`; the next write returns `777000001` again and destroys the history.
- **Design tension:** this log is the last-resort fallback (`allocator.ts` `fallBackToTemporary()`, ~l.131-160, has no catch) and its module doc promises the fallback guarantee. Failing closed on a corrupt log therefore makes the whole allocation reject. Options to weigh: default only on `ENOENT`; fail closed; or explicit recovery (quarantine the corrupt file, then continue from a safe counter such as one derived from salvageable entries). Also decide what `listTemporaryCodes()` (GUI list) does for a corrupt log. State the chosen behaviour and its user-visible message.

### F6 — Leaving the Error Codes tab mid-load or mid-save lets a stale callback overwrite another tab
- `mcp-server/gui/public/views/config-error-codes.js`: `ecRenderTab()` (l.306-338) holds `contentEl` and writes `innerHTML` and calls `ecWireEvents()` in its `.then`; `ecHandleSave()` (l.432-469) calls `ecRenderTab()` in its `.then`. Neither checks that the Error Codes tab is still active.
- `mcp-server/gui/public/views/config.js` tab-click handler (l.81-125) runs `ecCleanup()` and clears the `ec*` state on exit, but cannot cancel in-flight requests. `#config-tab-content` is shared, so the late callback replaces the other tab's DOM and re-populates the state that was just cleared.
- Fix direction: a visit token (incremented on enter/exit, captured by each async callback, checked before touching state or DOM), including the save `.then`/`.catch` and the test-connection callbacks. Tests belong in `mcp-server/tests/gui/config-error-codes-view.test.ts`.

### F7 — The temporary prefix accepts non-digits
- `mcp-server/src/error-codes/config-store.ts` l.25 (`temporary_prefix: z.string().default('777')`) and `mcp-server/gui/api-error-codes.ts` l.152 (`PutErrorCodeConfigBodySchema`, `z.string().optional()`). The GUI form (`config-error-codes.js` `ecCollectCoreSettings()`, l.374-396) validates the timeouts but not the prefix.
- A prefix such as `ERR` makes the fallback return `ERR000001`, breaking `ErrorCodeResult.code` ("a string of digits", `allocator.ts` l.48) and the `first_component_code` built as `${code}01`.
- **Migration hazard for the plan:** `loadErrorCodeConfig()` (`config-store.ts` l.65-88) returns the *defaults* when the stored file fails the schema, and `updateErrorCodeConfig()` builds on that result. Tightening the schema would make any already-saved non-digit prefix reset the entire config (active provider, provider settings, stored secrets) on the next save. Decide how an existing invalid prefix is handled (e.g. coercion or a targeted fallback for the prefix only) so a prefix mistake can never wipe the rest of the configuration. Decide also whether an empty prefix is allowed and a maximum length.

## Cross-cutting observations
- F2, F3 and F5 are one pattern (fail-open reads that destroy state); F7's hazard is the same pattern in `config-store.ts`. A shared approach may be cleaner than three local fixes, but keep within scope.
- Existing tests: `mcp-server/tests/error-codes/{file-provider,errorcode-incrementor-provider,temporary-codes,config-store,allocator}.test.ts`, `mcp-server/tests/gui/{api-error-codes,config-error-codes-view}.test.ts`.
- Documentation likely affected: the MCP server manifest (`mcp-server/docs/agents/project-manifest/`), the error-code help text in `mcp-server/src/tools/help-content.ts` (~l.1443), and `mcp-server/gui/docs/agents/project-manifest/`.
