# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.13.1
- Architectural Reviews: none — Plan Architect Reviewer v2.5.2

## Prior Project Context

- This is the fourth pass on the error-code allocator branch (`feature-error-code-generator`), after `2026-11-19-error-code-generator`, `2026-11-20-error-code-generator-rework-1` and `2026-11-20-pr64-copilot-review-fixes`. v2.12.0 is still `WIP; UNRELEASED`, so response shapes can still change without migrating installed users. The prior plan's changes are still uncommitted in the working tree; this plan builds on them.
- Repository vision: the secondary long-term goal is reliability on Windows, macOS and Linux. Two items here are cross-platform reliability fixes: the diverging provider `data_dir` path (mixed separators on Windows) and the shared temp path in `atomicWriteJson`.
- Insights applied: `dab7e8f5-d02d-42a7-86a2-5c0bd90a8b1a` (monotonic token for stale async UI responses, extended to the three remaining config tabs), `271fefef-6868-4efc-bc7c-d96c23b69c1d` (contested `withLock` costs ~350–850 ms in tests, which motivates the test seam), `f389f9ce-86cc-4b4e-ac83-eb131fbdc29d` (plain-function helper modules), `4a972e16-abcf-43ee-a1e7-2201730f05c0` (a consolidated helper's default state needs its own check, applied to the shared `isNodeError` and the lock seam's reset), and `53454e24-4329-4946-ab9f-3b94cd682f17` (`.context/` regeneration via `node scripts/cli.js ctx-generate`).
- Triage follows the standing preference to close the inherited backlog: every synthesis follow-up and every prior Out-of-Scope or rejected row was re-verified against the code. None changes authorisation behaviour or diverges from the workflow spec, so none is split into a stub plan.

## Knowledge Base Reconciliation

| Insight ID | Title | What the plan overtakes | Executed by |
|------------|-------|-------------------------|-------------|
| 271fefef-6868-4efc-bc7c-d96c23b69c1d | proper-lockfile-based withLock() costs ~350-850ms per contested acquisition in the mcp-server test suite | It says every test calling the locking helper pays this cost and must budget long timeouts. After step 3, tests can install a fast retry policy through `__setLockRetryForTesting()`. The production cost still holds and stays the budget for real high-throughput consumers. | Ledger Knowledge Curator v1.4.2 (Targeted Reconciliation) |

## Summary

This plan reworks `docs/agents/plans/2026-11-20-pr64-copilot-review-fixes/synthesis.md` and addresses all of its actionable follow-up items. It also re-triages that plan's Out of Scope list and rejected Structural Improvements. Code changes:

- `atomicWriteJson` gets a unique temp path per call.
- `withLock` gets a test-only retry seam, so concurrency tests no longer pay production backoff.
- The five private `isNodeError` copies are replaced by one shared guard.
- The two diverging provider `data_dir` helpers are replaced by one shared helper.
- A rejected GUI request now reports which field failed.
- The Error Codes tab shows a banner when a stored config was partly or wholly unusable.
- The Configuration view moves to a tab registry. Every tab gets its own reset and leave functions, and a visit token on every async callback.
- `handleGetProject`'s fire-and-forget self-heal write is tracked, so tests can await it, which removes the `ENOTEMPTY` teardown race at its cause.

The error-code part of the MCP server API reference is restructured into short bullet lists, and every affected manifest and the changelog are updated.

## Architectural Context

- **Storage primitives** (`mcp-server/src/storage/`): `atomic-writer.ts` (`atomicWriteJson`, temp path `{file}.tmp.{pid}`), `file-lock.ts` (`withLock`, private `LOCK_OPTIONS`), `json-state-file.ts` (`readJsonStateFile`, `keepCorruptCopy`), `store-registry.ts` (`resolveErrorCodesDir`, `resolveErrorCodePluginDir`). These are plain-function modules.
- **Error-code core** (`mcp-server/src/error-codes/`): `allocator.ts` (private `resolveProviderDataDir`), `config-store.ts` (private `readConfigState` classifying `missing | ok | salvaged | corrupt | unreadable`; `loadErrorCodeConfig` reports to stderr only), `temporary-codes.ts` (the `{ entries, warning? }` degraded-read pattern).
- **GUI backend** (`mcp-server/gui/`): one handler file per API domain (GUI constraint §21). Each handler file has its own private `validationError`. `ApiError` lives in `mcp-server/src/gui/errors.ts`. `gui/server.ts`'s `sendError` serializes `{ error: { code, message } }` and drops `details`. `gui/api.ts`'s `handleGetProject` issues one fire-and-forget `.meta.json` self-heal write.
- **GUI frontend** (`mcp-server/gui/public/views/`): `config.js` coordinates five tabs. Four companion modules load before it (`index.html` L43–L47). GUI constraint §25 *Config Tab Modules* defines five integration points; only `config-error-codes.js` implements the reset function and visit token.
- **Tests**: Vitest, `testTimeout: 10000`. GUI views are tested under jsdom with `vm.runInThisContext`. Cross-process concurrency tests spawn `tests/error-codes/fixtures/concurrent-allocation-worker.ts` through `run-workers.ts`.

## Approach / Architecture

1. **Shared Node error guard (new `mcp-server/src/utils/node-errors.ts`).** It exports `isNodeError(err): err is NodeJS.ErrnoException` and `hasErrorCode(err, code): boolean`. All five private copies are deleted and import it. `hasErrorCode` replaces the `isNodeError(err) && err.code === 'X'` idiom at the touched call sites; it is the comparison those call sites repeat.
2. **Unique temp path.** `atomicWriteJson` writes to `` `${filePath}.tmp.${process.pid}.${randomUUID()}` ``. The pid stays in the name so a stray temp file can still be traced to its process. The rename is still the commit point. The error-path unlink targets the same per-call path.
3. **Lock test seam.** `file-lock.ts` keeps the production `LOCK_OPTIONS` as an exported, frozen `DEFAULT_LOCK_OPTIONS` constant and adds a module-level `activeLockOptions`. Two test-only exports:
   - `__setLockRetryForTesting({ minTimeout, maxTimeout })` derives `retries = Math.ceil(stale / minTimeout)`, so the retry window still covers the stale timeout. It rejects `minTimeout < 1` or `maxTimeout < minTimeout`.
   - `__resetLockOptionsForTesting()` restores the defaults.
   The `ELOCKED` message quotes the active retry count. The worker fixture accepts an optional `--fast-lock` flag and calls the setter before it does any work. `run-workers.ts` gains an option that adds the flag. The error-code concurrency tests install the fast policy in `beforeEach`, reset it in `afterEach`, and drop their raised per-test timeouts wherever the default 10 s now suffices.
4. **One provider data-dir helper.** `store-registry.ts` gains `resolveErrorCodeProviderDataDir(providerId)` = `join(resolveErrorCodesDir(), 'data', providerId)`. The allocator's template-string copy and the GUI's private copy are deleted. The prior rejection rested on a "MCP-tool / GUI-API boundary" that does not exist: `gui/api-error-codes.ts` already imports from `store-registry.ts`. The copies have also diverged on Windows.
5. **Readable validation errors.** `mcp-server/src/gui/errors.ts` gains `describeZodIssues(issues, options?)`. It returns `"{path}: {message}"` for the first issue (the root path renders as `body`), plus `" (and N more)"` when there are more. It never includes a received value: for issue codes whose default message quotes input (`invalid_enum_value`, `invalid_literal`, `invalid_union_discriminator`), it uses a fixed per-code message instead. The seven call sites in `gui/api-error-codes.ts` and `gui/api.ts` that pass Zod data as `details` now build `` `${prefix}: ${describeZodIssues(issues)}` `` as the message and keep `details` unchanged. `sendError` still never serializes `details`. The `errors.ts` header documents that `details` are server-side only (tests, logs).
6. **Config salvage in the GUI.** `config-store.ts` exports `readErrorCodeConfig(): Promise<{ config: ErrorCodeConfig; warning?: string }>`. The warning is built from `readConfigState()`: field paths for `salvaged`, the fixed `reason` for `corrupt`/`unreadable`, never a value or parser message. `loadErrorCodeConfig()` becomes a wrapper that writes that same warning to stderr and returns `config`, so its signature and MCP-tool behaviour are unchanged. `handleGetErrorCodeConfig` returns `ErrorCodeConfigResponse & { warning?: string }`. The Error Codes tab renders it as a second banner (`ecConfigWarning`), reset by `ecResetState()`.
7. **Config tab registry.** `config.js` replaces its three hand-written tab lists (buttons, dispatcher, exit branch) and its field resets with one `CONFIG_TABS` array of `{ key, label, render(data), leave(discarded), reset() }` descriptors. The functions are referenced by global name; ES5 function declarations are hoisted globals available at call time. On page render, `config.js` calls every `reset()`. On a tab switch, it runs the existing dirty `confirm()` and then calls the left tab's `leave(discarded)`. The three remaining modules gain:
   - `config-stores.js`: `csVisit`, `csResetState()` (visit++, close the modal, release `csClickHandler`, clear `cs*`). `leave` = reset, which matches today's unconditional cleanup.
   - `config-model-registry.js`: `mrVisit`, `mrResetState()` (visit++, clear `mr*`), `mrLeaveTab(discarded)` (visit++; full reset only when `discarded`).
   - `config-persona-models.js`: `pmVisit`, `pmResetState()`, `pmLeaveTab(discarded)` with the same semantics. `pmIsBuilding` spans visits like `ecSaveInFlight`: a stale rebuild callback still clears it, then returns.
   Every async callback in these modules captures the module's visit token and returns early when it is stale. Persona Models and Model Registry keep their state across a non-discarding switch, because their page-load arguments are not refreshed after a save. `config-error-codes.js` maps to `{ leave: ecResetState, reset: ecResetState }`.
8. **Tracked self-heal write.** `gui/api.ts` keeps a module-level `Set<Promise<void>>` of in-flight self-heal writes. Each write is added on start and removed on settle; failures are still swallowed. `__awaitPendingSelfHealsForTesting()` (exported, test-only) awaits a snapshot of the set. Production behaviour is unchanged: no request ever awaits the write. `tests/gui/api.test.ts` and `tests/gui/multi-store-api.test.ts` await it in `afterEach` before `rm`. The 20 ms sleeps that waited for self-heal writes are replaced by the same await.

## Rationale

- Every synthesis follow-up is a small, local fix in code this branch already changes or depends on. Fixing them now costs one session; later they would need a standalone cleanup plan, which rarely gets funded.
- The `ENOTEMPTY` fix goes to the cause (an untracked write) rather than the symptom (`rm` retries). Retries would leave the 20 ms sleeps timing-dependent and would mask any future leaked write.
- The lock seam is set from inside each process (in-process setter; the worker calls it from a CLI flag). No production environment variable is read, so a stray variable can never weaken production locking.
- `describeZodIssues` puts the field message into `message` rather than serializing `details`. `details` holds raw Zod structures, which can carry received values from a body that may contain secrets. Sending them would also change the wire contract of every GUI route.
- The tab registry is the durable shape for the Configuration view. Adding a sixth tab today means editing three places in `config.js` plus remembering field resets. After the change it means one descriptor, and a test fails when a `config-*.js` module is missing from the registry.
- `hasErrorCode` has current consumers: the `isNodeError(err) && err.code === …` idiom appears in the touched files (e.g. `src/gui/model-registry.ts` L222).

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Unique temp path | `{file}.tmp.{pid}.{uuid}` | `{file}.tmp.{pid}.{counter}` (module counter); `fs.mkdtemp` sibling directory | A UUID needs no shared state and is already used in the package. A counter is unique per process only. A temp directory doubles the syscalls and changes cleanup. |
| Faster lock tests | Test-only setter plus a worker CLI flag | Optional third `withLock` parameter; env var read by `file-lock.ts`; `vi.useFakeTimers` | A parameter would have to be threaded through every store API. An env var is a production knob. Fake timers do not reach worker processes or `proper-lockfile`'s internal timers. |
| ENOTEMPTY teardown race | Track the fire-and-forget write; await it in teardown | `rm(…, { maxRetries })` (synthesis suggestion); make `handleGetProject` await the write | Retries hide the cause and keep the sleeps. Awaiting in production adds lock latency to every project view. |
| Surfacing GUI validation failures | First-issue summary in `message` | Serialize `details` in `sendError`; client-side field mapping | Serializing changes every route's wire shape and risks echoing values. Field mapping needs per-form client code for a one-line benefit. |
| Config salvage visibility | `readErrorCodeConfig()` returns `{ config, warning? }`; GUI banner | Add the warning to the MCP tool's `ErrorCodeResult.warning` too; throw on salvage | Agents cannot repair the config, and the GUI is where the user edits it. `ErrorCodeResult.warning` already carries the temporary-log notice and would need merging rules. Throwing breaks the "never blocks allocation" guarantee. |
| Config tab coordination | Registry array in `config.js` referencing global functions | Self-registration (`CONFIG_TABS.push` in each module); keep per-field resets in `config.js` | Self-registration needs the registry declared in a file loaded earlier (`utils.js`), which spreads ownership. Keeping field lists is the duplication the synthesis flagged. A source-check test closes the gap that hand registration leaves. |
| Leave semantics for Persona Models / Model Registry | `leave(discarded)` that bumps the visit and resets only on discard | Reset on every leave (as Stores and Error Codes do) | Reset-on-leave would re-initialise from stale page-load arguments after a save. That is a regression. |
| Provider data dir | Exported helper in `store-registry.ts` | Export from `allocator.ts`; keep the duplicates and fix the separator | `store-registry.ts` already owns every `~/.ai-insights/error-codes` path. Fixing duplicates in place leaves them free to diverge again. |

## Pattern Alignment

- Follows the plain-function storage/utility module pattern (`mcp-server/src/utils/if-defined.ts`, `mcp-server/src/storage/repository-registry.ts`) for `node-errors.ts` and the new `store-registry.ts` helper.
- Follows the test-only hook naming of `__resetForTesting()` (`mcp-server/src/gui/config.ts`) for `__setLockRetryForTesting`, `__resetLockOptionsForTesting` and `__awaitPendingSelfHealsForTesting`.
- Follows the `{ data, warning? }` degraded-read shape of `listTemporaryCodes` (`mcp-server/src/error-codes/temporary-codes.ts`) for `readErrorCodeConfig`.
- Follows the visit-token pattern of `config-error-codes.js` (`ecVisit`) and `strategy.js` (`refreshSeq`) for `csVisit`, `mrVisit` and `pmVisit`, as GUI constraint §25 point 5 already requires.
- Follows the `api-stores.ts` precedent of putting the first Zod issue message into the `ApiError` message.
- Deliberate departure: `config.js`'s registry replaces the "add a key, reset in `renderConfigPage`, clean up in the tab-bar handler" recipe of §25 points 1–3 with "add one descriptor". The constraint is rewritten in the same change (step 12), so the manifest and the code stay aligned.
- Deliberate departure: `config-model-registry.js` and `config-persona-models.js` get a `leave` that does not reset state. §25 point 3 currently says leaving always resets. The rewrite records the exception and its reason (stale page-load arguments).

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/storage/atomic-writer.ts` temp path | Shared `{file}.tmp.{pid}` path for concurrent unlocked writes in one process | Promoted to step 2 | Synthesis follow-up; makes the primitive safe on its own instead of relying on every caller's lock. |
| `mcp-server/src/storage/file-lock.ts` private `LOCK_OPTIONS` | Tests pay production backoff; no characterization tests exist | Promoted to step 3 | Synthesis follow-up. The prior plan's "no change to `withLock`" was tied to OD-1 (no second lock flavour); this seam adds no flavour and leaves production defaults unchanged. |
| `isNodeError` in `src/storage/json-state-file.ts`, `src/gui/{model-registry,config,log-resolver}.ts`, `gui/api.ts` | Five identical private copies | Promoted to step 1 | Prior Out-of-Scope item. The branch already added a fifth copy, so consolidation belongs in the same change set. |
| `resolveProviderDataDir` in `src/error-codes/allocator.ts` and `gui/api-error-codes.ts` | Documented duplication that has already diverged (separator) | Promoted to step 4 | Reverses the prior rejection on a new fact: the stated boundary does not exist, and the divergence is a Windows reliability defect. |
| `mcp-server/gui/server.ts` `sendError` / `ApiError.details` | `details` documented but never serialized; seven call sites lose the field message | Promoted to step 5 (message-side fix; serializer unchanged) | Synthesis follow-up, widened to the same defect class in `gui/api.ts`. |
| Private `validationError` in six `gui/api-*.ts` files | Six three-line copies | Rejected | Each is a trivial one-line wrapper owned by its handler-domain file (GUI constraint §21). Moving them would touch four files this plan otherwise leaves alone, for no behaviour change. |
| `mcp-server/src/error-codes/config-store.ts` `loadErrorCodeConfig` | Salvage reported to stderr only | Promoted to step 6 | Prior Out-of-Scope item ("surfacing config salvage in the GUI"); the degraded-read pattern already exists. |
| `mcp-server/gui/public/views/config.js` field resets and three tab lists | Hand-maintained duplicates of other modules' state | Promoted to step 7 | Synthesis follow-up; the registry removes all three lists. |
| `config-stores.js`, `config-model-registry.js`, `config-persona-models.js` async callbacks | No visit token; a late response renders into another tab | Promoted to step 7 | Same defect F6 fixed for Error Codes; GUI constraint §25 point 5 already requires it. |
| `mcp-server/gui/api.ts` fire-and-forget self-heal | Untracked write races test teardown; tests use 20 ms sleeps | Promoted to step 8 | Synthesis follow-up, fixed at the cause. |
| `mcp-server/docs/agents/project-manifest/api-surface.md` error-code section | Dense single paragraphs with WP provenance tags | Promoted to step 11 | Synthesis follow-up; the section is rewritten anyway for steps 4–6. |
| Automatic repair tool for a corrupt counter file | Prior Out-of-Scope | Rejected | It needs a product decision on which value to resume from. Guessing reintroduces the duplicate-code risk F2 removed. Recorded in Deferred Items. |
| Shared counter file across users or machines; `misconfigured` result for a missing `counter_file` directory | Prior Out-of-Scope (OD-1, OD-1b) | Rejected | Both were decided or dropped by the user in the prior plan; nothing new changes that decision. |
| `tests/error-codes/fixtures/run-workers.ts` spawn helper; `ecResetState()` calling `ecCleanup()`; recovery warnings on stderr | Informational synthesis notes | Rejected (no change) | They describe intended behaviour, not defects. Step 3 reuses `run-workers.ts` as the synthesis anticipated. |

## Detailed Steps

1. **Shared Node error guard.** Create `mcp-server/src/utils/node-errors.ts` (new) with `isNodeError(err: unknown): err is NodeJS.ErrnoException` (true for an `Error` carrying a string `code`; keep the predicate identical to the existing copies) and `hasErrorCode(err: unknown, code: string): boolean`. Delete the private copies in `mcp-server/src/storage/json-state-file.ts`, `mcp-server/src/gui/model-registry.ts`, `mcp-server/src/gui/config.ts`, `mcp-server/src/gui/log-resolver.ts` and `mcp-server/gui/api.ts`, and import from the new module. Rewrite `isNodeError(x) && x.code === '…'` expressions in those five files as `hasErrorCode(x, '…')`. Before deleting, confirm all five bodies are behaviourally identical; record any difference in the step's summary and keep the strictest predicate.

2. **Unique atomic-write temp path.** In `mcp-server/src/storage/atomic-writer.ts`, build the temp path as `` `${filePath}.tmp.${process.pid}.${randomUUID()}` `` (`randomUUID` from `crypto`). Keep the error-path unlink on that same per-call path. Update the JSDoc (`{filePath}.tmp.{pid}.{uuid}`) and explain why the suffix exists: concurrent unlocked writers in one process.

3. **Lock test seam.**
   - Add characterization tests first (see Test Plan: `tests/storage/file-lock.test.ts`).
   - In `mcp-server/src/storage/file-lock.ts`, export `DEFAULT_LOCK_OPTIONS` (the current values, `Object.freeze`d, nested `retries` included) and use a module-level `activeLockOptions`, initialised to the defaults.
   - Add `__setLockRetryForTesting({ minTimeout, maxTimeout })`. It derives `retries = Math.ceil(DEFAULT_LOCK_OPTIONS.stale / minTimeout)` and throws on `minTimeout < 1` or `maxTimeout < minTimeout`.
   - Add `__resetLockOptionsForTesting()`.
   - The `ELOCKED` message quotes `activeLockOptions.retries.retries`.
   - Mark both functions `@internal` and test-only in JSDoc.
   - In `mcp-server/tests/error-codes/fixtures/concurrent-allocation-worker.ts`, accept an optional leading `--fast-lock` argument that calls `__setLockRetryForTesting({ minTimeout: 5, maxTimeout: 25 })` before any work, and update the usage comment.
   - In `mcp-server/tests/error-codes/fixtures/run-workers.ts`, add an optional `{ fastLock?: boolean }` parameter to `runWorker`/`runWorkers` that prepends the flag.
   - In `mcp-server/tests/error-codes/{temporary-codes,file-provider,config-store}.test.ts`, install the same fast policy in `beforeEach`, reset it in `afterEach`, and pass `fastLock: true` to the cross-process tests.
   - Lower or remove each raised per-test timeout once a local run shows it is unnecessary. Keep an explicit timeout on the cross-process tests, since process spawn time varies across machines, and record the before and after durations in the step summary.

4. **Single provider data-dir helper.** In `mcp-server/src/storage/store-registry.ts`, add `resolveErrorCodeProviderDataDir(providerId: string): string` returning `join(resolveErrorCodesDir(), 'data', providerId)`, with JSDoc. Delete the private copies in `mcp-server/src/error-codes/allocator.ts` and `mcp-server/gui/api-error-codes.ts` (including the duplication comment) and call the new helper from both.

5. **Readable GUI validation errors.**
   - In `mcp-server/src/gui/errors.ts`, add `describeZodIssues(issues: ZodIssue[]): string` with the rules in Approach item 5:
     - First issue only, plus an "and N more" suffix.
     - The path joined with `.`, or `body` for the root path.
     - A fixed, value-free message for `invalid_enum_value`, `invalid_literal` and `invalid_union_discriminator`.
     - Never the received input.
   - Extend the file header: `details` stay server-side and are never serialized by `gui/server.ts`.
   - In `mcp-server/gui/api-error-codes.ts` (four call sites, L189, L212, L291, L306) and `mcp-server/gui/api.ts` (L1030, L1074, L1165), build the message as `` `${prefix without the trailing period}: ${describeZodIssues(error.issues)}` ``. Keep the existing `details` argument unchanged.
   - Confirm that `config-error-codes.js` already shows `err.message` on a failed Save; if it shows a fixed string instead, switch it to `err.message`.

6. **Config salvage warning in the GUI.**
   - In `mcp-server/src/error-codes/config-store.ts`, export `readErrorCodeConfig(): Promise<{ config: ErrorCodeConfig; warning?: string }>`, built on `readConfigState()`. The warning text is the same wording the stderr line uses today: field paths for `salvaged`, the fixed reason for `corrupt` and `unreadable`, never a value or parser message. A `missing` or `ok` file has no warning.
   - Rewrite `loadErrorCodeConfig()` as a wrapper that writes `[error-codes] {warning}` to stderr when a warning is present and returns `config`. Its stderr output must be unchanged.
   - In `mcp-server/gui/api-error-codes.ts`, `handleGetErrorCodeConfig` uses `readErrorCodeConfig()` and returns `warning` when present. Extend `ErrorCodeConfigResponse` with `warning?: string`. The Save and Test handlers keep `loadErrorCodeConfig()`.
   - In `mcp-server/gui/public/views/config-error-codes.js`, add `ecConfigWarning`: set it from the config response in the lazy load, render it as a `UI.banner('error', …)` above the settings form, and clear it in `ecResetState()`. Document it in the module's state comment.
   - In `mcp-server/gui/public/api-client.js`, update the JSDoc of `getErrorCodeConfig` to the new response shape.

7. **Config tab registry, per-tab reset/leave, visit tokens.** Depends on step 6, since both steps change `config-error-codes.js`.
   - `config-stores.js`: add `csVisit` and `csResetState()`. `csResetState()` increments `csVisit`, calls `csCloseModal()` when defined, removes `csClickHandler` from `#config-tab-content`, and resets every `cs*` field to its declared initial value. Guard each async callback (`csHandleModalSave`, `csRefreshTab`, the delete and sync handlers in `csWireEvents`, `csMoveStore`): capture `csVisit` before the request, return early when it is stale.
   - `config-model-registry.js`: add `mrVisit`, `mrResetState()` (increment, reset `mr*`) and `mrLeaveTab(discarded)` (increment; call `mrResetState()` when `discarded`). Guard the `mrDoSave` and `mrDoLoadDefaults` callbacks. A stale callback still re-enables nothing in the DOM and writes no state.
   - `config-persona-models.js`: add `pmVisit`, `pmResetState()` and `pmLeaveTab(discarded)` with the same semantics. Guard `pmDoSave`, `pmDoRebuild` and its nested refresh, and the `pmWireEvents` request callbacks. A stale rebuild callback still sets `pmIsBuilding = false` before returning, because the flag spans visits.
   - `config.js`: declare `CONFIG_TABS`, one descriptor per tab, in display order:
     - `general`: `render` = General render plus wiring; `leave` and `reset` reset `configDirty.general` only.
     - `stores`: `leave` and `reset` = `csResetState`.
     - `personaModels`: `leave` = `pmLeaveTab`, `reset` = `pmResetState`.
     - `modelRegistry`: `leave` = `mrLeaveTab`, `reset` = `mrResetState`.
     - `errorCodes`: `leave` and `reset` = `ecResetState`.
   - In `config.js`, generate the tab buttons from `CONFIG_TABS`. `renderConfigTabContent` looks up the descriptor. `renderConfigPage` resets every `configDirty` key and calls each descriptor's `reset()`. The tab-bar handler runs the existing `confirm()` guard, records `discarded`, and calls the left tab's `leave(discarded)`. Remove every direct reference to another module's fields from `config.js`. Keep the `typeof … === 'function'` guards only where a module may legitimately be absent; otherwise reference the functions directly.
   - Update the module header comments of all five files to describe the contract.
   - Bump `?v=` for the four changed view scripts in `mcp-server/gui/public/index.html` (GUI constraint §14).

8. **Tracked self-heal write.** In `mcp-server/gui/api.ts`, add a module-level `pendingSelfHeals = new Set<Promise<void>>()`. Wrap the L718 write so that the promise (failures still swallowed) is added to the set and removed in `finally`. Export `__awaitPendingSelfHealsForTesting(): Promise<void>` (`@internal`, test-only), which awaits `Promise.all([...pendingSelfHeals])`. Update the comment above the write. In `mcp-server/tests/gui/api.test.ts`, make the `afterEach` await it before `rm`, and replace each `setTimeout(r, 20)` that waits for a self-heal write (L267, L311, L335, L352, L374) with the same await. Leave the 5 ms sleeps alone if they serve another purpose; state the reason in a comment. Add the same `afterEach` await to `mcp-server/tests/gui/multi-store-api.test.ts`.

9. **Tests.** Write every test in the Test Plan. Where a step changed an existing test file, update the existing assertions (e.g. the `config-error-codes-view.test.ts` source check at L590–L593 becomes a check that `config.js` references `ecResetState` through `CONFIG_TABS`).

10. **Verification.** In `mcp-server/`, run `npx tsc --noEmit`, `npm run build` and `npx vitest run`. Run the full suite twice and confirm both runs are green, as a guard against the teardown race. Report the wall-clock duration of `tests/error-codes/` before and after step 3.

11. **API reference restructure (error-code section).** In `mcp-server/docs/agents/project-manifest/api-surface.md`, rewrite the prose under *Error-Code Provider Contract* (`config-store.ts`, `temporary-codes.ts`, `allocator.ts`, `providers/file-provider.ts`, and the tool entries `ledger_generate_error_code` and `ledger_list_temporary_error_codes`) into short labelled bullet lists, following the existing `providers/errorcode-incrementor-provider.ts` entry. Drop "WP-0xx" provenance tags inside that section only. Add `readErrorCodeConfig` and `resolveErrorCodeProviderDataDir`. No behaviour statement may be lost: a reviewer diffs the claims, not the wording.

12. **Manifest, constraint and changelog updates.** Apply every entry in Documentation Updates.

## Dependencies

- Step 1 before steps 4–8 only where they edit the same files (`gui/api.ts` in step 8); otherwise independent.
- Step 3's characterization tests are written before `file-lock.ts` changes.
- Step 5 before step 6 (both edit `gui/api-error-codes.ts`).
- Step 6 before step 7 (both edit `config-error-codes.js`).
- Steps 9–10 after steps 1–8. Steps 11–12 after step 10, so the docs describe verified behaviour.

## Required Components

- New: `mcp-server/src/utils/node-errors.ts`
- New: `mcp-server/tests/utils/node-errors.test.ts`
- New: `mcp-server/tests/storage/file-lock.test.ts`
- New: `mcp-server/tests/gui/config-tabs.test.ts`
- New: `mcp-server/tests/gui/errors.test.ts`
- Modified source: `mcp-server/src/storage/{atomic-writer,file-lock,json-state-file,store-registry}.ts`, `mcp-server/src/error-codes/{allocator,config-store}.ts`, `mcp-server/src/gui/{errors,model-registry,config,log-resolver}.ts`, `mcp-server/gui/{api,api-error-codes}.ts`
- Modified frontend: `mcp-server/gui/public/views/{config,config-stores,config-model-registry,config-persona-models,config-error-codes}.js`, `mcp-server/gui/public/api-client.js`, `mcp-server/gui/public/index.html`
- Modified tests: `mcp-server/tests/storage/{atomic-writer,store-registry}.test.ts`, `mcp-server/tests/error-codes/{temporary-codes,file-provider,config-store,allocator}.test.ts`, `mcp-server/tests/error-codes/fixtures/{concurrent-allocation-worker,run-workers}.ts`, `mcp-server/tests/gui/{api,multi-store-api,api-error-codes,config-error-codes-view,server-error-mapping}.test.ts`

## Assumptions

- The prior plan's uncommitted changes on `feature-error-code-generator` are the baseline. The user may commit them before the run, but nothing here requires it.
- `proper-lockfile` honours `retries.minTimeout`/`maxTimeout` as passed (it delegates to `retry`), so a 5–25 ms policy is effective in tests.
- Zod 3's issue codes `invalid_enum_value`, `invalid_literal` and `invalid_union_discriminator` are the only default messages that quote received input. Step 5's test pins this for the schemas in scope.

## Constraints

- Production lock defaults (`stale: 10000`, 50 retries, 200–1000 ms) must not change (`constraints.md` *Lock Timeout Is 10 Seconds*, *Lock Retry Count Is 50*).
- No GUI response may contain a config value, a secret or a JSON parser message in a warning or error.
- GUI frontend stays ES5 with no build step (GUI constraints §1–§3), and changed scripts get version-busted (§14).
- No stdout writes (STDIO discipline).
- Generated `.context/` output is not regenerated or committed on this feature branch.

## Out of Scope

- An automatic repair tool for a corrupt counter file (see Deferred Items).
- Sharing a counter file between users or machines, and a `misconfigured` result for a missing `counter_file` directory (both decided in the prior plan).
- Consolidating the six private `validationError` wrappers (rejected in Structural Improvements).
- Reporting the config warning through the MCP tool's `ErrorCodeResult`.
- Replying to or resolving the Copilot threads on PR #64.
- Releasing v2.12.0.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Commit the changes on `feature-error-code-generator` (via the Git Committer or by hand). | After the run | Only the Git Committer or the user performs git writes (workspace *Git Operations* rule). |
| 2 | Reply to and resolve the seven Copilot threads on PR #64, if not already done (the prior plan's follow-up). | After the run | GitHub writes under the user's account belong to the user. |
| 3 | When the branch is merged and committed on the default branch, run Build & Maintain (it runs `node scripts/cli.js ctx-generate`), so `.context/` picks up this branch's manifest changes, including the lock-directory heading and the error-code docs. | After the run | Generated artefacts are refreshed only on the default branch, which agents do not commit to. |
| 4 | Ask the Ledger Knowledge Curator to reconcile insight `271fefef-6868-4efc-bc7c-d96c23b69c1d` (see Knowledge Base Reconciliation). | After the run | Insight mutation belongs to the Curator, after the change has shipped. |

## Acceptance Criteria

- AC-01: `mcp-server/src/utils/node-errors.ts` exports `isNodeError` and `hasErrorCode`, and no other source file under `mcp-server/src/` or `mcp-server/gui/` declares its own `isNodeError`.
- AC-02: Two concurrent unlocked `atomicWriteJson` calls to the same target in one process both resolve, the target holds one of the two complete payloads, and no `*.tmp.*` file remains in the directory.
- AC-03: `withLock` with default options behaves as before (characterization tests pass unchanged), and `DEFAULT_LOCK_OPTIONS` equals `{ stale: 10000, retries: { retries: 50, minTimeout: 200, maxTimeout: 1000 } }`.
- AC-04: `__setLockRetryForTesting` produces a retry window that is at least the stale timeout, rejects invalid input, and `__resetLockOptionsForTesting` restores the defaults.
- AC-05: The error-code concurrency tests, in-process and cross-process, run with the fast lock policy and still assert unique, consecutive values. `tests/error-codes/` total duration is reported before and after.
- AC-06: `resolveErrorCodeProviderDataDir(id)` equals `join(resolveErrorCodesDir(), 'data', id)`, and both the allocator and the GUI Test connection pass exactly that value as `data_dir`.
- AC-07: A `PUT /api/error-codes/config` with an invalid `temporary_prefix` returns HTTP 400 whose `error.message` names `temporary_prefix` and the schema's message.
- AC-08: No validation error message built by `describeZodIssues` contains a received value, including an enum or literal mismatch and a rejected secret field.
- AC-09: `GET /api/error-codes/config` returns `warning` naming the invalid field paths for a salvaged config and the fixed reason for a corrupt or unreadable one. No warning is returned for a missing or valid file, and no warning contains a value or parser message.
- AC-10: `loadErrorCodeConfig()` keeps its signature, return value and stderr output for every config state.
- AC-11: The Error Codes tab shows the config warning as a banner, and leaving the tab clears it.
- AC-12: `config.js` holds no reference to any `cs*`, `mr*`, `pm*` or `ec*` state variable. Every `views/config-*.js` module has a `CONFIG_TABS` entry, and the tab buttons are generated from `CONFIG_TABS`.
- AC-13: For Stores, Model Registry and Persona Models, a request that settles after the user left the tab writes nothing into `#config-tab-content` and changes no module state, except the visit-spanning `pmIsBuilding` flag, which is cleared.
- AC-14: Leaving Model Registry or Persona Models without discarding keeps their state; leaving after a confirmed discard resets it.
- AC-15: `tests/gui/api.test.ts` contains no sleep that waits for a self-heal write. Its `afterEach` and that of `tests/gui/multi-store-api.test.ts` await `__awaitPendingSelfHealsForTesting()` before removing the temp directory.
- AC-16: `npx tsc --noEmit`, `npm run build` and two consecutive `npx vitest run` passes in `mcp-server/` succeed.
- AC-17: The error-code section of `api-surface.md` uses bullet lists for the entries named in step 11, contains no WP provenance tags, and documents `readErrorCodeConfig` and `resolveErrorCodeProviderDataDir`.
- AC-18: Every artefact in Documentation Updates is updated, and `mcp-server/changelog.md` gains bullets under `v2.12.0 - WIP; UNRELEASED` with no version change.

## Testing Strategy

Unit tests for each new helper. Characterization tests pin `withLock` before its change. The existing concurrency tests run under the fast lock policy and keep their uniqueness and consecutiveness assertions. GUI backend tests cover the new message and warning shapes. jsdom view tests load all five config view scripts through `vm.runInThisContext` (the established loader) to exercise the registry, leave and reset semantics, and stale callbacks with deferred promises. Two consecutive full-suite runs guard the teardown fix.

## Test Plan

- `mcp-server/tests/utils/node-errors.test.ts` (new) — `isNodeError` is true for an `ErrnoException`-shaped error and false for a plain `Error`, a non-error, and an object with a non-string `code`; `hasErrorCode` matches only the exact code — AC-01
- `mcp-server/tests/storage/atomic-writer.test.ts` — two concurrent unlocked writes to one target both resolve, the result is one complete payload, and the directory holds no temp file; a failed rename leaves no temp file — AC-02
- `mcp-server/tests/storage/file-lock.test.ts` (new) — characterization: the callback result is returned, the lock is released after a throw, two contending `withLock` calls serialize, and `ELOCKED` produces the "after N retries" message (the stale/ELOCKED path is exercised with the fast policy); `DEFAULT_LOCK_OPTIONS` values and frozenness; the setter's derived window is at least `stale`; the setter rejects invalid input; reset restores the defaults — AC-03, AC-04
- `mcp-server/tests/error-codes/{temporary-codes,file-provider,config-store}.test.ts` — the existing parallel and cross-process tests run under the fast policy (cross-process via `fastLock: true`), the assertions are unchanged, and `afterEach` resets the policy — AC-05
- `mcp-server/tests/storage/store-registry.test.ts` — `resolveErrorCodeProviderDataDir('file')` equals `join(resolveErrorCodesDir(), 'data', 'file')` — AC-06
- `mcp-server/tests/error-codes/allocator.test.ts` and `mcp-server/tests/gui/api-error-codes.test.ts` — the `data_dir` a provider receives from allocation and from Test connection equals the helper's value — AC-06
- `mcp-server/tests/gui/api-error-codes.test.ts` — an invalid-prefix PUT rejects with a message naming `temporary_prefix`; an invalid provider setting names its field; a rejected secret value never appears in the message — AC-07, AC-08
- `mcp-server/tests/gui/errors.test.ts` (new) — `describeZodIssues` covers the root path (`body`), nested paths, the "and N more" suffix, and fixed messages for enum, literal and discriminator issues that do not contain the received value — AC-08
- `mcp-server/tests/gui/server-error-mapping.test.ts` — a `VALIDATION_ERROR` with `details` still serializes as `{ error: { code, message } }` only — AC-08
- `mcp-server/tests/error-codes/config-store.test.ts` — `readErrorCodeConfig` returns no warning for missing or valid files, field paths for salvaged files, and the fixed reasons for corrupt (not JSON, not a config) and unreadable files; no warning contains a seeded secret or parser text; `loadErrorCodeConfig` keeps its return value and stderr line per state (stderr spied) — AC-09, AC-10
- `mcp-server/tests/gui/api-error-codes.test.ts` — `handleGetErrorCodeConfig` passes `warning` through and omits it when absent — AC-09
- `mcp-server/tests/gui/config-error-codes-view.test.ts` — the config warning banner renders, is escaped, and is cleared by `ecResetState()`; the source check is updated to the registry — AC-11, AC-12
- `mcp-server/tests/gui/config-tabs.test.ts` (new, jsdom) — the buttons are generated from `CONFIG_TABS`; a source scan of `views/config.js` finds no `cs`/`mr`/`pm`/`ec`-prefixed state identifiers; every `views/config-*.js` file has a descriptor; for Stores, Model Registry and Persona Models, a deferred request resolved after a tab switch leaves `#config-tab-content` and the module state untouched; a stale `pmDoRebuild` still clears `pmIsBuilding`; leaving Model Registry or Persona Models without a discard keeps state and leaving after a confirmed discard resets it; `renderConfigPage` calls every `reset()` — AC-12, AC-13, AC-14
- `mcp-server/tests/gui/config-helpers.test.ts` — still passes with the new module globals (loader unchanged) — AC-12
- `mcp-server/tests/gui/api.test.ts` and `mcp-server/tests/gui/multi-store-api.test.ts` — the self-heal tests await `__awaitPendingSelfHealsForTesting()` instead of sleeping; a new test asserts that the helper resolves only after the `.meta.json` write is visible — AC-15
- Full suite: `npx tsc --noEmit`, `npm run build`, and `npx vitest run` twice — AC-16
- Documentation review: diff of the error-code section claims before and after step 11; checklist of Documentation Updates — AC-17, AC-18

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/file-tree.md` — add `src/utils/node-errors.ts`, `tests/utils/node-errors.test.ts`, `tests/storage/file-lock.test.ts`, `tests/gui/errors.test.ts`.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — the step 11 restructure. Add `isNodeError`/`hasErrorCode`, `DEFAULT_LOCK_OPTIONS` and the two test-only lock hooks, `resolveErrorCodeProviderDataDir`, `readErrorCodeConfig` and `describeZodIssues`. Update the `atomicWriteJson` temp-path description (around L2248).
- `mcp-server/docs/agents/project-manifest/constraints.md` — *All File I/O Must Be Atomic*: temp path `{file}.tmp.{pid}.{uuid}` and the reason (L71, L81). *Lock Timeout Is 10 Seconds* / *Lock Retry Count Is 50*: note that tests may install a faster policy only through `__setLockRetryForTesting`, which preserves window ≥ stale. *Error-Code State Files Distinguish Missing From Broken*: config warnings are also returned to the GUI, value-free.
- `mcp-server/docs/agents/project-manifest/constraints-testing.md` — new heading *Lock-Heavy Tests Install the Fast Lock Policy* (setter in `beforeEach`, reset in `afterEach`, `fastLock: true` for workers) and new heading *Await Fire-and-Forget Writes Before Teardown* (`__awaitPendingSelfHealsForTesting`, no sleeps).
- `mcp-server/docs/agents/project-manifest/data-flows.md` — atomic write step (L50) temp path; Flow R (config read) adds the `readErrorCodeConfig` warning path.
- `mcp-server/docs/agents/project-manifest/tech-stack.md` — atomic write description (L109).
- `mcp-server/docs/agents/workflow-specification/auxiliary-systems.md` — atomic write step (L270) temp path. This is wording only; no workflow logic changes.
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` — rewrite §25 *Config Tab Modules* around the `CONFIG_TABS` descriptor contract (render, leave(discarded), reset), the per-module visit tokens, and the keep-on-leave exception for Persona Models and Model Registry with its reason; update the known-modules table. §7 *Information Hiding*: validation messages name fields, never values; `details` are never serialized.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — `config.js` internals (registry, removal of field resets); new `csVisit`/`csResetState`, `mrVisit`/`mrResetState`/`mrLeaveTab`, `pmVisit`/`pmResetState`/`pmLeaveTab`; `ecConfigWarning`; `GET /api/error-codes/config` response `warning?`; `__awaitPendingSelfHealsForTesting`.
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — the Error Codes config load with warning; the Configuration tab switch flow through `CONFIG_TABS`.
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — `tests/gui/config-tabs.test.ts`, `tests/gui/errors.test.ts` if listed there.
- `mcp-server/docs/error-code-providers.md` — `data_dir` is built with the platform separator (one sentence where `data_dir` is described).
- `mcp-server/changelog.md` — bullets under `v2.12.0 - WIP; UNRELEASED`, no version change: GUI rejected Save names the field; Error Codes tab shows a config warning; Configuration tabs ignore late responses; atomic writes use a unique temp file; provider `data_dir` is identical from the MCP tool and the GUI.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Automatic repair tool for a corrupt counter file | Prior plan, Out of Scope | Choosing the resume value is a product decision; any guess risks reissuing codes, the failure F2 removed. | Reconsider with a user decision on the source of truth (e.g. the highest value in the temporary log or the remote provider). |
| 2 | Consolidating the six private `validationError` wrappers in `mcp-server/gui/api-*.ts` | Found during this triage | Outside this plan's touched files except two; no behaviour gain. | Fold into the next plan that restructures GUI handler errors. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **The fast lock policy leaks into another test file and hides a real contention bug** | `afterEach` resets it in every file that sets it. `file-lock.test.ts` asserts the reset. Vitest isolates modules per file by default. |
| **The registry refactor changes tab behaviour (e.g. Persona Models loses unsaved state)** | Explicit leave and reset semantics per tab, AC-14, and jsdom tests for both paths. `config-helpers.test.ts` keeps covering the dirty helpers. |
| **A validation message echoes a secret** | `describeZodIssues` never reads received input. Fixed messages cover input-quoting codes. A test submits a secret in a failing body and asserts it is absent from the message. |
| **The unique temp suffix leaves stray files after a hard kill (now unique, so never overwritten)** | Same exposure as today (a pid-named temp also survives a kill). Recorded in the atomic-write constraint; no cleanup sweep is added. |
| **The self-heal tracking set grows if a write never settles** | Each entry is removed in `finally`. `writeProjectMeta` runs under `withLock`, whose retries are bounded. |
| **Removing the duplicate `isNodeError` changes a predicate subtly** | Step 1 compares the five bodies first and keeps the strictest one; AC-01 tests cover its edge cases. |

## Recommended Workflow

- **Workflow:** ledger
- **Rationale:** The plan spans storage primitives, the error-code core, two GUI backend files, five frontend view modules, test infrastructure and two manifests. These are distinct concerns, and formal QA and review stages benefit them, especially the tab-registry refactor and the secret-safe error messages.
