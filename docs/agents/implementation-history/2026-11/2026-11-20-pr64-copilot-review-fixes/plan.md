# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.13.1
- Architectural Reviews: none — Plan Architect Reviewer v2.5.2

## Prior Project Context

- This is the third pass on the error-code allocator, after `2026-11-19-error-code-generator` (the feature) and `2026-11-20-error-code-generator-rework-1` (Save re-entry guard, 0600 log mode, plugin loader hardening). The feature is still unreleased (`mcp-server/changelog.md` → `v2.12.0 - WIP; UNRELEASED`). Behaviour can still change without migrating installed users. The only on-disk state that might already exist is the developer's own `~/.ai-insights/error-codes/`.
- Repository vision: the short-term goal is minimal friction, and the secondary long-term goal is reliability on Windows, macOS and Linux. F2, F5 and F7 sit exactly between the two: silently reissued codes or a wiped configuration hurt reliability, while a hard stop on allocation adds friction. Every decision below keeps allocation working and never destroys state without keeping a copy.
- Insights applied: `dab7e8f5-d02d-42a7-86a2-5c0bd90a8b1a` (monotonic token for stale async UI responses, applied to F6), `32bcf1a7-dbff-4979-bc05-2396f070c42d` (treat absence and I/O failure as different cases, the core of F2, F5 and F7), `f389f9ce-86cc-4b4e-ac83-eb131fbdc29d` (plain-function storage helpers), `b1a0f887-fe53-49dc-91d7-7119dba24832` (a separate tolerant schema variant beside the strict one, applied to F7), and `271fefef-6868-4efc-bc7c-d96c23b69c1d` (contested locks cost ~350–850 ms in tests, so the concurrency tests set explicit timeouts).
- User context for this revision: AI Insights is a local, single-user tool. A counter file is never shared between different users, but several processes of the same user routinely run in parallel: the DEV and STABLE MCP servers, the GUI, and parallel workflow runs. `resolveErrorCodesDir()` is under the home directory, so all of them contend on the same locks.

## Summary

Fix the seven confirmed Copilot review findings on PR #64 (branch `feature-error-code-generator`), described in `request.md` in this folder, and add regression tests for each. F1 stops the HTTP provider's `peek` from consuming a code. F2, F3 and F5 replace "any read failure resets the state" with an explicit split between a missing file, an unreadable file and a corrupt file. Both corrupt-state stores follow one shared approach: the counter file fails closed into the existing temporary-code fallback, and the temporary-code log recovers by keeping a copy of the corrupt file and continuing. F3 makes counter keys own-property-safe for every string, `__proto__` included. F4 is settled by the user's decision (OD-1): the file provider keeps its per-user `data_dir` lock, which every process of one user shares, and the documentation states that a counter file shared between different users or machines is not supported; the misleading lock comments are corrected, and new tests prove that parallel allocations, in one process and across separate processes, return unique, consecutive values for both the counter file and the temporary-code log. F6 adds a visit token so a late callback cannot write into another tab. F7 makes the temporary prefix digits-only in every place it is accepted, and replaces the config loader's whole-file fallback with a field-level one, so a bad prefix can never wipe providers or secrets. Because parallel processes are routine, every new read path is checked against another process being mid-allocation (Approach §8); this changed one step: corrupt files are preserved by copy before an atomic overwrite, never renamed away, so a concurrent reader never sees the file missing.

## Open Decisions

OD-1 and OD-1b were decided by the user. The steps assume the recommended option of OD-2, OD-3 and OD-4; confirming or overriding those is a `Before the run` human action. Overriding one changes only the steps named in its row.

| # | Finding | Question | Options | Status | Steps affected |
|---|---------|----------|---------|--------|----------------|
| OD-1 | F4 | Should one counter file shared between different users (network share, synced folder) be supported? | (a) Support it with a lock at `{counter_file}.lock` beside the file. (b) Keep the per-user `data_dir` lock and document that a counter file shared between different users is not supported. | **Decided by the user: (b).** AI Insights is a local, single-user tool. `resolveErrorCodesDir()` is `join(homedir(), …)`, so every process of one user (DEV and STABLE servers, GUI, parallel workflow runs) resolves the same `data_dir` and contends on the same `proper-lockfile` lock, which works across processes. The cross-user scenario does not apply. The new `withFileLock` helper, its tests, and every step, criterion and document item depending on it are dropped. The misleading lock comment in `file-provider.ts` and the matching line in `constraints-workflow.md` are still corrected, worded for the single-user case. | 4, 11, 12 |
| OD-1b | F4 | What happens when a custom `counter_file`'s directory does not exist? | (a) Create it, as today (`atomicWriteJson` creates the parent). (b) Report `misconfigured`. | **Decided by the user: dropped (behaviour stays (a)).** Re-checked for a need other than shared-drive safety: none found. The remaining single-user case (a typo in the path, or a removable volume that is not mounted) is a configuration mistake that starts a sequence in the wrong place. It is neither a race nor corruption, and it is visible in the setting the user chose. | none |
| OD-2 | F5 | What happens when the temporary-code log is corrupt? | (a) Default only on `ENOENT`, throw otherwise (fail closed: `ledger_generate_error_code` returns an MCP error until the file is fixed). (b) **Recover.** Keep a byte-identical copy of the corrupt file, salvage the valid entries, continue from a counter no lower than any value found in the file, and report a warning. (c) The current reset (rejected: it destroys history and reissues `777000001`). | **Recommended: (b).** The log is the last-resort fallback, and its guarantee is documented in `README.md` and in the module doc. (b) keeps the guarantee and loses nothing. A non-`ENOENT` read error (e.g. `EACCES`) still fails closed, because the store can neither read nor safely write. | 5, 6 |
| OD-3 | F7 | Which temporary prefixes are valid? | (a) **`^[1-9][0-9]{0,5}$`**: 1–6 digits, no leading zero, not empty. (b) Any non-empty digit string. (c) Allow empty. | **Recommended: (a).** A non-empty prefix keeps temporary codes distinguishable from real ones (an empty prefix yields `000001`). No leading zero keeps the code stable when a consumer parses it as a number. At most 6 digits keeps `first_component_code` (prefix + 6 + 2 digits) at 14 digits, below `Number.MAX_SAFE_INTEGER`'s 16. The default `777` complies. | 7, 8, 9 |
| OD-4 | F7 | What happens to an already-stored invalid prefix (e.g. `ERR`)? | (a) **Targeted fallback.** That field alone reads as the default `777`, a stderr warning names the field, every other field is kept, and the next save writes a valid prefix. (b) Coerce it (strip non-digits; `ERR7` becomes `7`, `ERR` has no result). (c) Refuse every save until the file is hand-edited. | **Recommended: (a).** It is predictable, never invents a value the user did not choose, and needs no manual repair. The same field-level fallback covers any other invalid field (e.g. a string `timeout_ms`), which removes the whole-file wipe that F7's hazard exposed. | 7 |

## Architectural Context

- **Allocator pipeline.** `mcp-server/src/error-codes/allocator.ts` → `allocateErrorCode(input, deps)` loads the config (`deps.loadConfig`), resolves the repository, and calls the active provider through `callProvider`. A throw becomes `failed`, an abort becomes `unavailable`. Every failure falls back to `fallBackToTemporary`, which calls `deps.temporaryCodes.issue(prefix, entry)` without a catch. All policy lives here (`mcp-server/docs/agents/project-manifest/constraints.md` → *Policy Lives in the Allocator, Not in Providers*).
- **Providers.** `mcp-server/src/error-codes/providers/file-provider.ts` (counter file, lock, `allocate`/`peek`) and `mcp-server/src/error-codes/providers/errorcode-incrementor-provider.ts` (HTTP, `buildRequestUrl`). Providers report failure through `AllocationOutcome` (`provider-api.ts`). The provider contract is additive-only and is not changed by this plan.
- **Core state stores** under `~/.ai-insights/error-codes/` (`resolveErrorCodesDir()` in `mcp-server/src/storage/store-registry.ts`, `join(homedir(), …)`): `config-store.ts` (`config.json`, `loadErrorCodeConfig`, `updateErrorCodeConfig`) and `temporary-codes.ts` (`temporary-codes.json`, `issueTemporaryCode`, `listTemporaryCodes`). Both use `withLock` from `mcp-server/src/storage/file-lock.ts` and `atomicWriteJson` from `mcp-server/src/storage/atomic-writer.ts` (temp file `{file}.tmp.{pid}` + rename, so readers see only complete files).
- **Processes.** One user routinely runs several processes against this state at once: the DEV and STABLE MCP servers, the GUI server and parallel workflow runs. All resolve the same home-directory paths and therefore the same `proper-lockfile` locks (`mkdir`-based, atomic across processes). Writers re-read inside the lock; pure readers (`peek`, `listTemporaryCodes`, `loadErrorCodeConfig`) take no lock.
- **Consumers.** The MCP tools in `mcp-server/src/tools/error-codes.ts` (`ledger_generate_error_code`, `ledger_list_temporary_error_codes`), and the GUI API in `mcp-server/gui/api-error-codes.ts` (config GET/PUT, test-connection via `test` or `peek`, temporary list).
- **GUI tab.** `mcp-server/gui/public/views/config-error-codes.js` (`ec*` module state, lazy load in `ecRenderTab`, `ecHandleSave`, `ecHandleTestClick`) is coordinated by `mcp-server/gui/public/views/config.js`, which resets `ec*` state in `renderConfigPage` and in the tab-bar exit branch. Scripts are cache-busted through `?v=N` in `mcp-server/gui/public/index.html`.

## Approach / Architecture

**1. One read primitive that tells "missing" from "broken" (F2, F5, F7).** A new plain-function module `mcp-server/src/storage/json-state-file.ts` exposes two functions:
- `readJsonStateFile(path): Promise<JsonStateRead>` returns a discriminated union: `{ status: 'missing' }` for `ENOENT` only, `{ status: 'parsed', raw, value: unknown }`, or `{ status: 'unparsable', raw, error }`. Any other I/O error is rethrown unchanged.
- `keepCorruptCopy(path, now = new Date()): Promise<string>` copies the file's bytes to `{name}.corrupt-{YYYYMMDDTHHMMSSZ}{ext}` in the same directory, using an exclusive copy so an existing file is never overwritten, and returns the copy's base name. The stamp contains no `:`, so the name is Windows-safe, and a numeric suffix is appended on collision. The original stays in place: the caller replaces it with `atomicWriteJson`, so the path is never absent (see §8 for why it copies instead of renaming).

Schema validation and the corruption policy stay with each store, because each store needs a different policy:

| Store | Missing | Unreadable (non-`ENOENT`) | Unparsable or invalid | Rationale |
|-------|---------|---------------------------|-----------------------|-----------|
| Counter file (F2) | new sequence | `failed` outcome, so the allocator issues a temporary code | `failed` outcome; the file is left untouched | The counter file is the authority on real codes. No automatic value is provably safe, so the provider stops issuing and the user repairs the file. The fallback guarantee still holds through the temporary code. |
| Temporary-code log (F5) | empty log | throw (fail closed, documented) | keep a copy + salvage + continue, with a `warning` | This is the last resort: it must keep issuing, and must never reissue or drop history. |
| `config.json` (F7) | defaults | read: defaults + stderr warning; update: throw | read: field-level salvage (unparsable means defaults) + stderr warning; update: keep a copy of an unparsable file before writing | Allocation must never block on config. A save must never silently overwrite stored secrets. |

**2. Own-property-safe counters (F3).** Counters live in a `Map<string, number>` between read and write. The reader validates `counters` by hand: a plain non-array object whose own enumerable values are safe integers ≥ 0, read with `Object.entries`, which includes an own `__proto__` key that `JSON.parse` created. The writer serialises with `Object.fromEntries(map)`, which defines own data properties, so `__proto__` round-trips as a normal key. The policy for keys is **"no reserved keys"**: every string is a valid key, and read, write and validation share the one parse/serialise pair. `z.record` is no longer used for this field, because Zod drops `__proto__`.

**3. Per-user lock with a documented boundary (F4, OD-1 decided).** The file provider keeps `withLock(ctx.data_dir, …)` around its read-modify-write. `mcp-server/src/storage/file-lock.ts` is not changed. The comment above the lock is rewritten to give the real reasons: every process of one user resolves the same `data_dir`, so all of them serialise on one lock; the `.lock` directory exists only while an allocation holds it and is left only by a hard kill; locking `data_dir` instead of the counter file's directory keeps even that transient directory out of a `{repo}` directory; a counter file shared between different users or machines is not protected and is not supported. The same boundary is stated in the `counter_file` setting description, the plugin guide and the manifest.

**4. Temporary-log recovery (F5).** `issueTemporaryCode` and `listTemporaryCodes` share one internal `readTemporaryLog(dir)`. It returns either `{ file }` or `{ file: salvaged, corruption: { reason, droppedEntries } }`:
- **Salvage:** every array item that passes `TemporaryCodeEntrySchema` is kept.
- **Counter floor:** `next_counter` is the maximum of 1, the parsed `next_counter` when it is a safe integer ≥ 1, and 1 + the trailing six digits of every `"code"` value found by a regex scan of the raw text. The scan also covers unparsable text and codes with a non-digit prefix written before F7.
- **On issue (under the lock):** `readTemporaryLog` runs inside `withLock(dir)`, as the current reader does. On a salvaged read, `keepCorruptCopy(path)` runs, then the salvaged log plus the new entry is written over the original with `atomicWriteJson`. A second process waiting on the same lock re-reads the repaired file afterwards and does not recover a second time. `issueTemporaryCode` returns `{ code, warning? }` instead of `string`. The allocator copies `warning` into a new optional `ErrorCodeResult.warning`.
- **On list (read-only, no copy, no write):** `listTemporaryCodes` returns `{ entries, warning? }`. The MCP tool and the GUI route pass `warning` through.

User-visible messages (exact wording may be polished, but the facts are fixed):
- Issue: `temporary-codes.json was corrupt ({reason}); a copy was kept as {copy-name} and numbering continues from {n}. {k} of {m} logged entries were recovered — check the copy before deleting it.`
- List: `temporary-codes.json is corrupt ({reason}); showing {k} recoverable entries. It will be repaired the next time a temporary code is issued.`
- Unreadable log (fail closed): the MCP error `Error generating error code: temporary-codes: cannot read {path} ({errno code})`.

**5. Prefix rule in one place (F7).** `config-store.ts` exports `TEMPORARY_PREFIX_PATTERN`, `DEFAULT_TEMPORARY_PREFIX` and `TemporaryPrefixSchema`, which carries the message `Temporary prefix must be 1–6 digits and must not start with 0.`. Both the strict `ErrorCodeConfigSchema` (used on write) and `PutErrorCodeConfigBodySchema` use it. The GUI mirrors the pattern in the input's `pattern`/`maxlength` attributes and in `ecCollectCoreSettings`, with a comment naming `config-store.ts` as the source. The browser script cannot import TypeScript; a test pins the two copies together. Loading uses a tolerant per-field parse (OD-4) and names salvaged *fields*, never values, in a stderr warning, because secrets live in `providers`. `loadErrorCodeConfig()` keeps its signature. An internal `readConfigState()` gives `updateErrorCodeConfig` the state it needs to refuse or keep a copy.

**6. Visit token (F6).** `config-error-codes.js` gains `ecVisit` (a number) and `ecResetState()`. `ecResetState()` increments `ecVisit`, calls `ecCleanup()`, and resets every `ec*` field except `ecSaveInFlight`, which deliberately survives a visit. `config.js` replaces both of its hand-maintained `ec*` reset lists with one `ecResetState()` call. Every async callback captures `var visit = ecVisit` before the request and returns early when `visit !== ecVisit`:
- the lazy load (`then` and `catch`);
- Save (`then` and `catch`, after clearing `ecSaveInFlight` unconditionally, since that flag spans visits);
- Test connection (`then` and `catch`, *without* touching `ecTestInFlight` when stale, so a new visit's pending test is not unblocked).

The temporary-codes fetch inside the lazy load gets its own `.catch`, so a failing log no longer blocks the whole tab. The list's `warning` (or fetch error) renders as an escaped `UI.banner('error', …)` inside the Temporary Codes card.

**7. F1.** `buildRequestUrl` deletes `increment` for `peek`, and sets it for `allocate` as today.

**8. Behaviour while another process is mid-allocation.** Parallel processes of one user are routine, so each read path was checked against a concurrent writer in another process:

| Reader | Lock held? | What it can observe while another process writes | Effect on the plan |
|--------|------------|--------------------------------------------------|--------------------|
| File provider `allocate` | yes (`data_dir`) | Nothing in flight: the read happens inside the lock every same-user writer takes. | The strict read (F2) can only classify a file as corrupt when it really is. Step 4 keeps the read inside the lock. |
| File provider `peek` (GUI Test connection) | no | The old or the new complete file (`atomicWriteJson` renames a full temp file into place). | No partial-write false positive, so F2's `failed` on `peek` never fires because of a race. No change needed. |
| `issueTemporaryCode` | yes (`dir`) | Nothing in flight. Two processes that both meet a corrupt log serialise; the second sees the repaired file. | Step 5 keeps `readTemporaryLog` and the recovery inside the lock, so recovery runs once and only one copy is kept. A test proves it. |
| `listTemporaryCodes` (MCP tool, GUI) | no | The old or the new complete file. With a rename-based quarantine it could also have seen *no file* between the rename and the rewrite, and shown an empty log without a warning. | Recovery keeps a copy and overwrites atomically (step 2), so the path is never absent. |
| `loadErrorCodeConfig` (every allocation, GUI) | no | The old or the new complete file. With a rename-based quarantine an allocation running during a config repair would have read `missing`. | Same copy-then-overwrite rule (step 7). |
| `updateErrorCodeConfig` | yes (error-codes dir) | Nothing in flight. | Unchanged: it already re-reads inside the lock. |

Lock waits are bounded by `LOCK_OPTIONS` (50 retries, up to ~50 s). A file-provider lock timeout is a throw, which the allocator turns into `failed` and a temporary code; a temporary-log lock timeout rejects the allocation, as documented in step 6.

## Rationale

- **One read primitive, separate policies.** The three stores share the failure mode, not the remedy. A shared reader removes the copy-pasted try/catch ladders that caused F2, F5 and F7. Keeping policy per store respects the fact that the counter file is authoritative, the log is a last resort, and the config holds secrets. One generic "safe JSON store" with a policy flag was rejected: three policy flags on one function would be harder to read than three short call sites.
- **Fail closed for the counter file, recover for the log.** A corrupt counter can only be repaired by someone who knows which codes were issued, and the allocator already turns `failed` into a temporary code, so the guarantee survives. The log has no such backstop, so it must recover itself. Its counter floor comes from the file's own contents, so it never goes below a value it can still see.
- **Copy, then overwrite atomically.** Every path that replaces broken state keeps the original bytes first, so the user loses nothing they could have fixed by hand. Copying instead of renaming means unlocked readers in other processes never observe the file as missing (Approach §8), which matters because parallel processes are routine for this user.
- **Per-user lock (OD-1, decided).** The `data_dir` lock already serialises every process of one user, because every path resolves under the home directory. A lock beside the counter file would only add protection for a cross-user setup the tool does not support, at the cost of a new helper and a new artefact beside repository files. The real gap was the missing proof, which the new concurrency tests (one process and several processes) close.
- **Field-level config salvage (OD-4).** It closes F7's hazard for every field, not only the prefix, with the same code, which avoids a prefix-only special case that the next field would need again.
- **Visit token over request cancellation.** `API.*` methods return plain promises with no abort signal. A token is the established pattern in this GUI (`mcp-server/gui/public/views/strategy.js` `refreshSeq`) and in the knowledge base (`dab7e8f5…`).
- **Justified structure.** Each new abstraction is listed with its consumers:
  - `json-state-file.ts`: three consumers (file provider, temporary log, config store).
  - `ecResetState`: two consumers in `config.js`, plus the view test.
  - `TemporaryPrefixSchema`: two consumers (config schema, PUT body schema).
  - `ErrorCodeResult.warning`: produced by temporary-log recovery today; it is the natural channel for any future non-fatal notice.
  - The cross-process test worker (`tests/error-codes/fixtures/concurrent-allocation-worker.ts`): two consumers (file-provider and temporary-log concurrency tests); any future store that must hold across processes can reuse it by adding a mode.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Shared corrupt-state handling | Shared `readJsonStateFile` + `keepCorruptCopy`, with the policy kept in each store | (a) Three local fixes; (b) one generic store with a policy enum | (a) repeats the ladder that caused three findings; (b) hides three different policies behind flags. The shared read keeps the "missing ≠ broken" rule in one place. |
| Preserving a corrupt file | Copy to a `.corrupt-*` sibling, then `atomicWriteJson` over the original | Rename the file aside, then write a new one | A rename leaves a window in which unlocked readers in other processes see `missing` and act on defaults. The copy costs one extra file read and has no window. |
| F2 behaviour on a corrupt counter file | Return `failed` (non-ambiguous), leave the file untouched | Auto-repair from a salvaged maximum; restart after keeping a copy | No automatic value is provably above every code already used in source. The temporary fallback covers availability. |
| F3 key policy | `Map` + `Object.entries`/`Object.fromEntries`, so every string is a valid key | Reject reserved keys (`__proto__`, `constructor`, …) as `misconfigured`; `Object.hasOwn` lookup only | Rejection breaks a repository legitimately named `constructor`. Lookup-only leaves `__proto__` dropped (as Copilot notes). The Map gives one rule for read, write and validation. |
| F4 lock location (decided by the user, OD-1) | Keep the per-user `data_dir` lock; document cross-user and cross-machine sharing as unsupported | A `withFileLock` at `{counter_file}.lock`; a lock in a hashed global directory keyed by the canonical path | All processes of one user already share the `data_dir` lock. The alternatives only add value for sharing between users, which the tool does not support. |
| F4 regression proof | In-process parallel test (separate contexts, one `data_dir`) plus a cross-process test with spawned `tsx` workers | Copilot's "two different `data_dir` values on one file" test; in-process tests only | Copilot's test asserts the cross-user case that is now unsupported. In-process contention uses the same `mkdir` lock, but only a real multi-process test exercises the scenario the user named. |
| F5 behaviour | Keep a copy + salvage + counter floor + warning | Fail closed; `ENOENT`-only default | Failing closed breaks the documented fallback guarantee. `ENOENT`-only is just failing closed under another name for every corrupt case. |
| F5 warning channel | `issue()` returns `{ code, warning? }`; optional `ErrorCodeResult.warning` | Stderr only; append the text to `message` | Stderr is invisible to the agent and the user. A separate field keeps `message` stable and is additive to the result shape. |
| F7 migration | Per-field tolerant load + strict write schema | Coerce the prefix; refuse saves; prefix-only special case | Coercion invents values; refusing saves blocks the GUI. A prefix-only fallback leaves the same wipe hazard for every other field. |
| F7 rule location | `TemporaryPrefixSchema` exported from `config-store.ts`, mirrored in the GUI with a pinning test | A new shared constants module | `config-store.ts` already owns the config shape; the GUI cannot import TypeScript in either case. |
| F6 guard | Visit token incremented in `ecResetState()` | `configActiveTab === 'errorCodes'` check; check that `contentEl` is still in the document | Neither alternative detects "left and came back" (same tab, same element), and the late first load would overwrite the second visit. |

## Pattern Alignment

- Follows plain-function storage modules in `mcp-server/src/storage/` (e.g. `mcp-server/src/storage/atomic-writer.ts`, `mcp-server/src/storage/file-lock.ts`) for the new `json-state-file.ts`.
- Follows the fail-closed corruption guard of `mcp-server/src/gui/model-registry.ts` `readModels()` (`ENOENT` vs read/parse/validation errors) for the counter file and config updates.
- Follows `proper-lockfile` via the unchanged `withLock` as the only lock mechanism (`mcp-server/docs/agents/project-manifest/constraints.md` → *All Code Must Run on Windows, macOS, and Linux*).
- Follows the existing "re-read inside the lock" rule of every error-code writer (`issueTemporaryCode`, `updateErrorCodeConfig`, file provider `allocate`); recovery stays inside those locks.
- Follows *Policy Lives in the Allocator*: the file provider *returns* `failed` and never issues a temporary code itself.
- Follows `strategy.js`'s `refreshSeq` token pattern (`mcp-server/gui/public/views/strategy.js`) for F6.
- Follows the GUI tab-module integration points (`mcp-server/gui/docs/agents/project-manifest/constraints.md`, "four integration points every tab module implements"). It departs deliberately in one place: the ec* reset moves from `config.js` into `ecResetState()` in the owning module. The current form duplicates a field list in two places in `config.js` and once more in the test, and the visit token must be incremented atomically with that reset. The constraint text is updated to make an owner-side reset function the documented pattern for async tab modules.
- Departs from the test suite's in-process-only style by adding one spawned-process worker (`tests/error-codes/fixtures/concurrent-allocation-worker.ts`). Justified because the user's scenario is several OS processes; `tsx` is already a dev dependency, so no build step or new dependency is needed.
- Departs from the documented "deliberate zero-setup choice" for corrupt counter files (`mcp-server/docs/agents/project-manifest/api-surface.md` L3206) and from Flow R's "a missing or corrupt file is never a fatal error" (`data-flows.md` L2252). Both are the behaviours F2/F5/F7 identify as defects; the docs are updated in step 12.
- Departs from the constraints-workflow note *Lock File Persists After Server Exit* only by correcting it: the lock persists only after a hard kill.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/error-codes/{providers/file-provider.ts,temporary-codes.ts,config-store.ts}` read ladders | Three copy-pasted fail-open readers | Promoted to step 2 | It is the shared root cause of F2, F5 and F7, so fixing it once is cheaper than fixing it three times. |
| `mcp-server/src/storage/file-lock.ts` `withLock` body | Hard-codes the lock target; a second lock flavour would duplicate it | Rejected | OD-1 was decided as (b): no second lock flavour is needed, so the module is no longer touched. |
| `mcp-server/src/error-codes/providers/file-provider.ts` counters dictionary | A plain object used as a dictionary with untrusted keys | Promoted to step 4 | This is F3 itself. |
| `mcp-server/src/error-codes/providers/file-provider.ts` L112–L115 lock comment | States the reason for the `data_dir` lock incompletely: omits that the `.lock` is transient and that the lock covers every process of one user but not other users | Promoted to step 4 | The user asked to keep this correction; the comment is the first place the next reader looks for the concurrency boundary. |
| `mcp-server/src/error-codes/providers/errorcode-incrementor-provider.ts` `buildRequestUrl` | The set of owned query parameters is implicit | Promoted to step 3 (owned-parameter handling: `pw`/`counter` set, `increment` set or deleted) | It is a one-line change inside F1's fix and documents intent. |
| `mcp-server/src/error-codes/temporary-codes.ts` `listTemporaryCodes` return type | A bare array cannot carry a degraded-read notice | Promoted to step 5 | It is required to surface F5 in the list. The function is internal (MCP tool and GUI route only), so changing its signature is safe. |
| `mcp-server/src/error-codes/config-store.ts` whole-file fallback | One bad field discards every field | Promoted to step 7 | This is F7's hazard; per-field salvage covers all fields for the same cost. |
| `mcp-server/tests/error-codes/{file-provider,temporary-codes}.test.ts` parallel tests | Assert uniqueness only, never that values are consecutive; none crosses a process boundary | Promoted to step 11 | A skipped value would pass today; the user's scenario is several processes. |
| `mcp-server/gui/public/views/config.js` ec* reset lists (two copies) and `tests/gui/config-error-codes-view.test.ts` `resetEcModuleState()` | Hand-maintained duplicates of the module's own state list | Promoted to step 10 | The visit token must change at the same moment as the reset; one owner function makes that atomic and removes three copies. |
| `mcp-server/gui/public/views/config-error-codes.js` lazy-load `Promise.all` | A failure of only the temporary list fails the whole tab | Promoted to step 10 | F5 makes "log corrupt or unreadable" a real case; the settings form must stay usable so the user can act. |
| `isNodeError` re-declared in `mcp-server/src/gui/{log-resolver,model-registry,config}.ts` | Three private copies of the same type guard | Rejected | Those files are outside this plan's blast radius. The new module carries its own guard; consolidating belongs in a separate cleanup. |
| `mcp-server/docs/agents/project-manifest/constraints-workflow.md` *Lock File Persists After Server Exit* | Overstates persistence (the library removes the lock on release and exit) | Promoted to step 12 | Keeping the user-requested correction; leaving it would re-create the misunderstanding behind the old comment. |
| `mcp-server/src/error-codes/allocator.ts` `resolveProviderDataDir` duplicated in `mcp-server/gui/api-error-codes.ts` | A documented deliberate duplication | Rejected | The duplication is unrelated to the findings and is already justified in a comment. |
| `mcp-server/src/error-codes/temporary-codes.ts` prefix parameter | `issueTemporaryCode` accepts any prefix string | Rejected (no extra assertion) | After step 7, `loadErrorCodeConfig()` only ever yields a valid prefix, and it is the sole source. An assertion that throws here would turn a config bug into a failed fallback, the opposite of the guarantee. |

## Detailed Steps

1. **Baseline.** Run `npm test` and `npx tsc --noEmit` in `mcp-server/` and record the pass/fail counts in the pipeline notes, so regressions introduced later are attributable. No file changes.

2. **New `mcp-server/src/storage/json-state-file.ts`** (new file). It contains:
   - `export type JsonStateRead = { status: 'missing' } | { status: 'parsed'; raw: string; value: unknown } | { status: 'unparsable'; raw: string; error: string }`.
   - `export async function readJsonStateFile(path: string): Promise<JsonStateRead>`: `ENOENT` → `missing`; any other `readFile` error is rethrown unchanged (an `ErrnoException` with `code`); a `JSON.parse` failure → `unparsable` with the parser message.
   - `export async function keepCorruptCopy(path: string, now?: Date): Promise<string>`: `copyFile(path, target, constants.COPYFILE_EXCL)` to `{basename-without-ext}.corrupt-{YYYYMMDDTHHMMSSZ}{ext}` in the same directory. On `EEXIST`, retry with `-2`, `-3`, …. Returns the new base name. It never removes or renames the original; the caller overwrites it with `atomicWriteJson`, so unlocked readers in other processes always find a complete file (Approach §8).
   - A private `isNodeError` guard.
   - JSDoc that states the "missing ≠ broken" rule and the copy-not-rename rule with its concurrency reason.
   - Nothing in it writes to stdout.

3. **F1, `mcp-server/src/error-codes/providers/errorcode-incrementor-provider.ts`:** in `buildRequestUrl`, set `increment=yes` for `allocate` and `url.searchParams.delete('increment')` for `peek`. Keep `pw`/`counter` set via `set`. Update the module doc's protocol paragraph to say that `base_url` query parameters named `pw`, `counter` or `increment` are always overridden by the provider.

4. **F2 + F3 + F4, `mcp-server/src/error-codes/providers/file-provider.ts`:**
   - **Counters as a Map (F3).** Replace `CountersFileSchema`'s `z.record` with:
     - a `parseCountersFile(value: unknown): { ok: true; counters: Map<string, number> } | { ok: false; error: string }`. The top level must be a plain non-null, non-array object. `counters` is optional (absent means an empty Map), and when present it must be a plain non-array object whose own enumerable values are safe integers ≥ 0. Iterate with `Object.entries`.
     - a `serializeCountersFile(counters: Map<string, number>): { counters: Record<string, number> }` that uses `Object.fromEntries`.
     - `nextValueFor(counters, key, startValue)` reads `counters.has(key) ? counters.get(key)! : startValue - 1`.
   - **Strict read (F2).** Replace `readCountersFileOrDefault` with `readCounters(filePath)` on top of `readJsonStateFile`. `missing` gives an empty Map. `unparsable`, a `parseCountersFile` failure, or a rethrown I/O error all produce a `CounterFileProblem`. `allocate` and `peek` turn that problem into `{ ok: false, reason: 'failed', ambiguous: false, detail: 'counter file {path} cannot be used ({cause}); no code was issued from it — repair or remove the file' }`. The file is never written in that case.
   - **Lock (F4, OD-1 decided).** Keep `withLock(ctx.data_dir, …)` around the read-modify-write; the `readCounters` call stays inside the lock, so another process of the same user can never be mid-write while the strict read classifies the file (Approach §8). Write with `atomicWriteJson(filePath, serializeCountersFile(counters))`. `peek` stays unlocked: it only ever sees a complete file. Replace the L112–L115 comment with: every process of this user (both MCP servers, the GUI, parallel workflow runs) resolves the same `data_dir`, because `resolveErrorCodesDir()` is under the home directory, so they all serialise on this one lock; the `.lock` directory exists only while an allocation holds it and is left behind only by a hard kill (reclaimed as stale after 10 s); locking `data_dir` instead of the counter file's directory keeps even that transient entry out of a `{repo}` directory; a counter file shared between different users or machines is not protected and is not supported.
   - Update the module JSDoc and the `counter_file` setting `description` with one added sentence: "The file must not be shared between different users or machines: allocations are serialised per user only."

5. **F5, `mcp-server/src/error-codes/temporary-codes.ts`:**
   - Add the private `readTemporaryLog(dir)` on `readJsonStateFile`:
     - `missing` gives the empty log;
     - an I/O error is rethrown as `Error('temporary-codes: cannot read {path} ({code})')`;
     - `parsed` + `TemporaryCodesFileSchema.safeParse` success gives the log;
     - otherwise it salvages as described in Approach §4. Add a named `salvageTemporaryLog(raw, value | undefined)`, exported via an `_internal` object for unit tests (following the `_internal` convention in `mcp-server/src/tools/error-codes.ts`). It returns `{ file, reason, total, recovered }`.
   - Change `issueTemporaryCode` to return `Promise<IssuedTemporaryCode>`, where the new exported `interface IssuedTemporaryCode { code: string; warning?: string }`. `readTemporaryLog` runs inside the existing `withLock(dir)`. On a salvaged read: call `keepCorruptCopy(path)` before computing `n`, build the issue warning, write the same text to `process.stderr`, and overwrite the original with `atomicWriteJson` (mode `TEMPORARY_CODES_FILE_MODE`, as today). Because detection, copy and repair all happen under the lock, a second process that met the same corrupt log waits, re-reads the repaired file and does not recover again. Exhaustion handling is unchanged.
   - Change `listTemporaryCodes` to return `Promise<TemporaryCodesListing>`, where the new exported `interface TemporaryCodesListing { entries: TemporaryCodeEntry[]; warning?: string }`. On a salvaged read it filters the salvaged entries and sets the list warning, with no copy and no write. It stays unlocked.
   - Update the module doc: fallback guarantee, recovery (copy then atomic overwrite, under the lock), and fail-closed on an unreadable log.

6. **F5 consumers:**
   - `mcp-server/src/error-codes/allocator.ts`:
     - `TemporaryCodesDep.issue(prefix, entry): Promise<IssuedTemporaryCode>`;
     - `fallBackToTemporary` uses `issued.code` and, when present, adds `warning: issued.warning`;
     - add `warning?: string` to `ErrorCodeResult`, documented as "a non-fatal problem the caller should report, e.g. a recovered temporary-code log";
     - update the `allocateErrorCode` JSDoc on when it rejects (unreadable log, temporary-log lock timeout under heavy parallel use, exhaustion, disk full).
   - `mcp-server/src/tools/error-codes.ts`: `buildAllocatorDeps` passes the new return type through. `listTemporaryErrorCodes` returns `JSON.stringify({ entries, ...(warning ? { warning } : {}) })`. Update the tool descriptions in `register()` to mention `warning`.
   - `mcp-server/gui/api-error-codes.ts`: `handleListTemporaryErrorCodesGui` returns `{ entries, warning? }`, with `warning` passed through unchanged.

7. **F7, `mcp-server/src/error-codes/config-store.ts`:**
   - Export `TEMPORARY_PREFIX_PATTERN = /^[1-9][0-9]{0,5}$/`, `DEFAULT_TEMPORARY_PREFIX = '777'`, and `TemporaryPrefixSchema = z.string().regex(TEMPORARY_PREFIX_PATTERN, 'Temporary prefix must be 1–6 digits and must not start with 0.')`. `ErrorCodeConfigSchema.temporary_prefix` becomes `TemporaryPrefixSchema.default(DEFAULT_TEMPORARY_PREFIX)`.
   - Add a private `salvageStoredConfig(value: unknown): { config: ErrorCodeConfig; salvaged: string[] } | null`:
     - a non-object, or `version` present and not `1`, returns `null`, meaning corrupt;
     - otherwise each top-level field (`active_provider`, `temporary_prefix`, `timeout_ms`, `retry.default_wait_ms`, `retry.max_wait_ms`) is parsed with its strict field schema, falling back to that field's default and recording the field path;
     - `providers` keeps each entry whose value is a plain non-array object and drops and records the others (`providers.{id}`).
     The strict whole-object parse is tried first, so a valid file takes the fast path.
   - Add a private `readConfigState()` that returns one of `{ state: 'missing' | 'ok' | 'salvaged' | 'corrupt' | 'unreadable'; config; salvaged?; error? }`.
   - `loadErrorCodeConfig()` keeps its signature, stays non-throwing and stays unlocked. It returns `config` for every state. For `salvaged`, `corrupt` and `unreadable` it writes one stderr warning naming the file, the state and the salvaged field paths, never values.
   - `updateErrorCodeConfig(mutator)` (inside its existing `withLock`, re-reading through `readConfigState()` there):
     - `unreadable` throws `Error('config.json cannot be read ({code}); not overwriting it')`;
     - `corrupt` calls `keepCorruptCopy(configPath)` and then proceeds from defaults; the following `atomicWriteJson` replaces the original in one rename, so a concurrent `loadErrorCodeConfig` in another process never reads `missing` during the repair;
     - `missing`, `ok` and `salvaged` proceed from `config`.
     The strict `ErrorCodeConfigSchema.parse(next)` before the write is unchanged.
   - Update the JSDoc for both functions.

8. **F7, `mcp-server/gui/api-error-codes.ts`:** `PutErrorCodeConfigBodySchema.temporary_prefix` becomes `TemporaryPrefixSchema.optional()`, imported from `../src/error-codes/config-store.js`. An invalid prefix returns `VALIDATION_ERROR` (400) whose `details.temporary_prefix` carries the schema message, and nothing is written.

9. **F7 GUI form, `mcp-server/gui/public/views/config-error-codes.js`:**
   - In `ecRenderCoreSettings`, the prefix input gains `inputmode="numeric" pattern="[1-9][0-9]{0,5}" maxlength="6"` and `aria-describedby="ec-core-temporary-prefix-desc"`, plus a `form-note` with the id `ec-core-temporary-prefix-desc` reading "1–6 digits, not starting with 0. Temporary codes are this prefix followed by six digits.".
   - Add the module constant `EC_TEMPORARY_PREFIX_PATTERN = /^[1-9][0-9]{0,5}$/`, commented as a mirror of `TEMPORARY_PREFIX_PATTERN` in `src/error-codes/config-store.ts`.
   - `ecCollectCoreSettings` rejects a non-matching value with `ecShowLiveMessage('Temporary prefix must be 1–6 digits and must not start with 0.', true)` and returns `null`.

10. **F6 + F5 view, `mcp-server/gui/public/views/config-error-codes.js` and `mcp-server/gui/public/views/config.js`:**
    - Add the state `ecVisit = 0` and `ecTemporaryWarning = null`, both documented in the state comment block.
    - Add `function ecResetState()`. It increments `ecVisit`, calls `ecCleanup()`, and resets `ecProviders`, `ecConfig`, `ecPluginDir`, `ecLoadErrors`, `ecTemporaryCodes`, `ecTemporaryWarning`, `ecSelectedProviderId` and `ecTestInFlight`. It does not reset `ecSaveInFlight`.
    - Lazy load in `ecRenderTab`:
      - capture `var visit = ecVisit`;
      - give the temporary fetch its own catch: `API.getTemporaryErrorCodes().catch(function (err) { return { entries: [], warning: 'Temporary codes could not be loaded: ' + (err.message || String(err)) }; })`;
      - in `then`, return when `visit !== ecVisit`; then set `ecTemporaryWarning = results[2].warning || null`;
      - in `catch`, return when `visit !== ecVisit`.
    - `ecRenderTemporaryList` prepends `UI.banner('error', ecTemporaryWarning)` when it is set.
    - `ecHandleSave`: capture `visit`. In `then` and in `catch`, set `ecSaveInFlight = false` first, then return when stale; otherwise behave as today.
    - `ecHandleTestClick`: capture `visit`. In `then` and in `catch`, return immediately when stale, leaving `ecTestInFlight`, `btn` and the message untouched; otherwise behave as today.
    - `config.js`: in `renderConfigPage`, replace the three `ec*` reset lines (L62–L64) with `if (typeof ecResetState === 'function') ecResetState();`. In the tab-bar branch (L113–L117), replace `ecCleanup()` plus the reset lines with the same call.
    - Bump `mcp-server/gui/public/index.html`: `config-error-codes.js?v=2` → `?v=3`, `config.js?v=4` → `?v=5`.
    - Update the JSDoc in `mcp-server/gui/public/api-client.js` `getTemporaryErrorCodes`: `@returns {Promise<{ entries: object[], warning?: string }>}`. Bump `api-client.js?v=6` → `?v=7` (a JSDoc-only change still ships a changed file to the browser).

11. **Tests:** implement every entry of the *Test Plan* below. New files: `mcp-server/tests/storage/json-state-file.test.ts` and the worker `mcp-server/tests/error-codes/fixtures/concurrent-allocation-worker.ts` (not a test file itself; it is spawned by the cross-process tests). Every other test goes into the existing files named there. The worker:
    - is started with `spawn(process.execPath, ['--import', 'tsx', workerPath, mode, ...args])`, where `mode` is `file-provider` or `temporary-codes`;
    - in `file-provider` mode, takes `dataDir`, `counterFile` and a count, calls `fileProvider.allocate` that many times in parallel through one `ProviderContext` with `data_dir = dataDir`, and prints the resulting values as one JSON array on stdout;
    - in `temporary-codes` mode, takes `dir` and a count, calls `issueTemporaryCode(dir, '777', entry)` that many times in parallel, and prints the codes as one JSON array;
    - exits non-zero with the error on stderr when any call fails, so the test reports the cause.
    In-process concurrency tests keep an explicit timeout of 20000–30000 ms, following the existing tests (insight `271fefef…`); cross-process tests use 60000 ms to cover `tsx` start-up.

12. **Documentation:** apply every entry of *Documentation Updates* below.

13. **Changelog:** in `mcp-server/changelog.md`, under the existing `v2.12.0 - WIP; UNRELEASED` entry, add house-style one-liners (the convention is in `docs/agents/project-manifest/constraints.md` → *Changelog Convention*; read it first):
    - `Providers: The Errorcode Incrementor's connection test no longer consumes a code when the base URL already carries increment=yes.`
    - `Providers: A corrupt or unreadable file-provider counter file now falls back to a temporary code instead of restarting the sequence.`
    - `Providers: File-provider counter names such as __proto__ or constructor are stored like any other name.`
    - `Storage: A corrupt temporary-code log is repaired in place after a copy is kept, and numbering continues; the result carries a warning.`
    - `Config: The temporary prefix must be 1–6 digits; an invalid stored value falls back to 777 without resetting other settings.`
    - `GUI: Leaving the Error Codes tab while it loads or saves no longer overwrites the next tab.`
    No version bump: the entry is still unreleased.

14. **Verification:** run `npm run build`, `npx tsc --noEmit` and `npm test` in `mcp-server/`, and compare the results with step 1. Start the GUI on port 3460 and exercise the Error Codes tab: leave it during load and during save, enter an invalid prefix, and run Test connection with a corrupt counter file (`docs/agents/project-manifest/development-commands.md` → *Verification by Change Type*, GUI row). Report any check that could not be run.

## Dependencies

- Step 2 → steps 4, 5, 7 (they consume `readJsonStateFile`/`keepCorruptCopy`).
- Step 5 → step 6 (new return types), and step 6 → step 10 (the list `warning` field).
- Step 7 → step 8 (`TemporaryPrefixSchema`), and step 7 → step 9 (the mirrored pattern).
- Steps 9 and 10 edit the same file; perform them in one work package or in sequence.
- Step 3 is independent.
- Step 11 follows the step each test covers (the cross-process tests follow steps 4 and 5); step 12 follows steps 2–10; step 13 follows step 12; step 14 is last.

## Required Components

- `mcp-server/src/storage/json-state-file.ts` (**new**)
- `mcp-server/src/error-codes/providers/errorcode-incrementor-provider.ts`
- `mcp-server/src/error-codes/providers/file-provider.ts`
- `mcp-server/src/error-codes/temporary-codes.ts`
- `mcp-server/src/error-codes/allocator.ts`
- `mcp-server/src/error-codes/config-store.ts`
- `mcp-server/src/tools/error-codes.ts`
- `mcp-server/src/tools/help-content.ts`
- `mcp-server/gui/api-error-codes.ts`
- `mcp-server/gui/public/views/config-error-codes.js`
- `mcp-server/gui/public/views/config.js`
- `mcp-server/gui/public/api-client.js`
- `mcp-server/gui/public/index.html`
- `mcp-server/tests/storage/json-state-file.test.ts` (**new**)
- `mcp-server/tests/error-codes/fixtures/concurrent-allocation-worker.ts` (**new**, spawned test worker)
- `mcp-server/tests/error-codes/{errorcode-incrementor-provider,file-provider,temporary-codes,allocator,config-store}.test.ts`
- `mcp-server/tests/tools/error-codes.test.ts`
- `mcp-server/tests/gui/{api-error-codes,config-error-codes-view}.test.ts`
- The documentation files listed under *Documentation Updates*
- Existing: `proper-lockfile` 4.1.2 via the unchanged `mcp-server/src/storage/file-lock.ts`; `tsx` (dev dependency) for the spawned worker. No new dependency.

## Assumptions

- OD-1 and OD-1b are decided as recorded; the recommended option of OD-2, OD-3 and OD-4 applies (see *Human Actions*).
- AI Insights is used by one user per home directory. Every process that allocates codes for that user resolves the same `resolveErrorCodesDir()`, so the existing `withLock` locks serialise them. A counter file shared between different users or machines is out of the supported configuration.
- The plan runs on branch `feature-error-code-generator` in `ai-insights/` only. No other repository changes, so no dependency symlinking is needed.
- No installed user depends on the current fail-open behaviour: the feature is unreleased.
- `ErrorCodeResult` gaining the optional `warning` field is additive and does not touch the provider contract (`provider-api.ts`), so no `apiVersion` change is needed.
- `node --import tsx` works with the installed `tsx` ^4.23.1 and the Node version in `docs/agents/project-manifest/development-commands.md`; the engineer confirms this when writing the worker and falls back to the `tsx` binary in `node_modules/.bin` if it does not.

## Constraints

- Never write to stdout in any changed MCP or GUI server module (STDIO discipline); warnings go to stderr. The test worker is not a server module and reports its results on stdout.
- Secrets never appear in warnings: config salvage warnings name field paths only (`mcp-server/docs/agents/project-manifest/constraints.md` → *Secrets Never Leave the Server*).
- `mcp-server/src/storage/file-lock.ts` is not changed; `withLock`'s signature, its `{storageDir}/.lock` location and its directory creation stay as they are for all callers.
- Every read that decides whether state is corrupt and leads to a write happens inside the lock that guards that write. Pure readers stay unlocked and rely on `atomicWriteJson`'s rename.
- A corrupt file is never renamed or removed; it is copied, and the original is replaced with `atomicWriteJson`.
- `proper-lockfile` remains the only lock mechanism; every path operation uses `path.join`/`path.dirname`/`path.basename` (cross-platform policy).
- Every dynamic value rendered in the GUI goes through `escapeHtml()`, either directly or via `UI.banner`.
- Provider modules import only from `../provider-api.js` plus storage primitives (the existing rule in the file provider's module doc).
- No git write operations by agents; the Git Committer or the user commits.

## Out of Scope

- Supporting a counter file shared between different users or machines (OD-1, decided by the user); it is documented as unsupported instead.
- A `misconfigured` result for a custom `counter_file` whose directory is missing (OD-1b, dropped by the user).
- Replying to or resolving the Copilot threads on GitHub (see *Human Actions*).
- Consolidating the three private `isNodeError` copies in `mcp-server/src/gui/`.
- Surfacing config salvage in the GUI (beyond the effective value the form already shows); stderr only in this plan.
- An automatic repair tool for a corrupt counter file.
- Any change to `withLock` or `LOCK_OPTIONS`.
- Releasing v2.12.0.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Confirm or override Open Decisions OD-2, OD-3 and OD-4 (the plan applies the recommendations; OD-1 and OD-1b are already decided). | Before the run | They are product choices about user-facing behaviour, which only the user can make. |
| 2 | Reply to and resolve the seven Copilot review threads on PR #64, citing the fixing commits. For F4, state that the tool is single-user, that every process of one user shares the `data_dir` lock, and that cross-user sharing is documented as unsupported. | After the run | Posting on GitHub under the user's account and judging thread resolution belong to the user; agents perform no GitHub writes. |
| 3 | Commit the changes on `feature-error-code-generator` (via the Git Committer or by hand). | After the run | Commits are made only by the Git Committer or the user (workspace *Git Operations* rule). |

## Acceptance Criteria

- AC-01: `peek` on the Errorcode Incrementor sends no `increment` parameter even when `base_url` contains `increment=yes`; `allocate` sends exactly one `increment=yes`.
- AC-02: A counter file that exists but cannot be read, is not valid JSON, or fails validation makes the file provider's `allocate` and `peek` return `{ ok: false, reason: 'failed' }` with a detail naming the file. The file's bytes are unchanged afterwards, and `allocateErrorCode` issues a temporary code for that case.
- AC-03: Counter keys `__proto__`, `constructor`, `toString` and `hasOwnProperty` each start at `start_value`, increment by one per allocation, persist as own keys in the counter file, and survive a re-read. No inherited property value is ever read or written.
- AC-04: Parallel `allocate` calls against one counter file return unique, consecutive values (exactly `start_value … start_value + N − 1`, and the file's counter ends at the highest of them). This holds for calls in one process through separate `ProviderContext` objects sharing one `data_dir`, and for calls from several separate OS processes. After a `{repo}` counter file has been used, the repository directory contains no `.lock` entry.
- AC-05: Parallel `issueTemporaryCode` calls on one log, in one process and from several separate OS processes, return unique, consecutive codes (`777000001 … 7770000NN`), and the log afterwards holds exactly N entries and `next_counter` N + 1.
- AC-06: `keepCorruptCopy` writes a byte-identical copy under a `*.corrupt-*` name, never overwrites an existing file, and leaves the original path in place. Two parallel `issueTemporaryCode` calls on a corrupt log produce exactly one `.corrupt-*` copy, exactly one result carrying a `warning`, and two distinct codes.
- AC-07: With a temporary-code log that is unparsable, or that holds one invalid entry, `issueTemporaryCode` keeps a byte-identical copy under a `temporary-codes.corrupt-*.json` name, keeps every valid entry, and issues a counter greater than every counter visible in the corrupt file. It returns a `warning`, which `allocateErrorCode` surfaces as `ErrorCodeResult.warning`.
- AC-08: A log that cannot be read for a reason other than `ENOENT` makes `issueTemporaryCode` reject with a message naming the file and errno code, and the file is untouched.
- AC-09: `listTemporaryCodes` on a corrupt log returns the salvageable entries plus a `warning` and writes nothing. The MCP tool `ledger_list_temporary_error_codes` and `GET /api/error-codes/temporary` pass that `warning` through.
- AC-10: The temporary prefix accepts exactly `^[1-9][0-9]{0,5}$`. `PUT /api/error-codes/config` rejects anything else (e.g. `ERR`, `''`, `0777`, `1234567`) with `VALIDATION_ERROR` and writes nothing. The GUI form blocks such a value with the documented message.
- AC-11: A stored `config.json` with an invalid `temporary_prefix` (or another invalid scalar field) loads with that field at its default and every other field, including `providers` and its secrets, unchanged. A subsequent save keeps those providers and secrets.
- AC-12: `updateErrorCodeConfig` on an unparsable `config.json` keeps a byte-identical copy before writing, and on an unreadable `config.json` throws without writing. `loadErrorCodeConfig` never throws in either case.
- AC-13: Leaving the Error Codes tab (or re-rendering the Configuration page) while its initial load, a Save or a Test connection is pending, and then letting that request settle, leaves the other tab's DOM and the cleared ec* state untouched. A Save settling late still clears `ecSaveInFlight`; a Test settling late does not clear a newer visit's `ecTestInFlight`.
- AC-14: A failing or corrupt temporary-codes list no longer prevents the Error Codes settings form from loading; the Temporary Codes card shows the warning as escaped text.
- AC-15: `config.js` resets ec* state only through `ecResetState()`, and `index.html` loads `config-error-codes.js?v=3`, `config.js?v=5` and `api-client.js?v=7`.
- AC-16: Every document listed under *Documentation Updates* reflects the new behaviour. No document still claims that a corrupt counter file, log or config resets silently, or that a lock file persists after a normal exit. The file-provider lock comment, the `counter_file` setting description, `docs/error-code-providers.md` and `api-surface.md` state that every process of one user shares the lock and that a counter file shared between different users or machines is not supported.
- AC-17: `npm run build`, `npx tsc --noEmit` and `npm test` pass in `mcp-server/` with no regression against the step 1 baseline.

## Testing Strategy

Unit tests at each layer, in the existing vitest suites, against real temp directories (`mkdtemp`). There are no filesystem mocks for the storage behaviour, because the findings are about real file contents. Concurrency is tested at two levels. In one process, parallel calls through separate contexts contend on the real `proper-lockfile` `mkdir` lock, which is the same mechanism used between processes. Across processes, the tests spawn the `concurrent-allocation-worker.ts` worker several times at once against one shared temp directory, which reproduces the user's scenario of DEV and STABLE servers, GUI and workflow runs allocating together. Both levels assert unique *and* consecutive values, so a skipped or repeated value fails. The GUI view is tested with the existing jsdom + `vm.runInThisContext` harness, using deferred promises to settle requests after a simulated tab exit. Each fix gets a test that fails on the current code before it passes on the new code, and the engineer records that in the pipeline notes; for the concurrency tests, which may already pass on the current code, the engineer records which assertion is new (consecutiveness, entry count, cross-process).

## Test Plan

- `mcp-server/tests/error-codes/errorcode-incrementor-provider.test.ts`, `describe('request shape')`: new test "peek removes an increment parameter already present in base_url". Use `base_url: 'https://x.test/?increment=yes'`, assert that the captured `peek` URL has no `increment` and the `allocate` URL has `getAll('increment')` equal to `['yes']`. Covers AC-01.
- `mcp-server/tests/storage/json-state-file.test.ts` (**new**). Covers AC-06 and supports AC-02, AC-07 and AC-12.
  - `readJsonStateFile`: missing → `missing`; valid JSON → `parsed`; `'{ not json'` → `unparsable`; a directory path (`EISDIR`) rethrows with `code`.
  - `keepCorruptCopy`: the copy is in the same directory under a `*.corrupt-*` name with identical bytes, and the original still exists with identical bytes; a second call with the same `now` produces a `-2` suffix and leaves the first copy unchanged.
- `mcp-server/tests/error-codes/file-provider.test.ts`:
  - new `describe('corrupt counter file')`. Covers AC-02.
    - Invalid JSON, a non-integer counter, a `counters` array and an unreadable path (`counter_file` pointing at a directory) each return `{ ok: false, reason: 'failed' }` from `allocate` and `peek`, with a detail containing the path.
    - File bytes are unchanged afterwards (`readFile` before/after equality).
  - new `describe('own-property-safe keys')`: for `__proto__`, `constructor`, `toString` and `hasOwnProperty` as `counter_name`, two allocations give `1`, `2`; a fresh `peek` gives `3`; the parsed file satisfies `Object.hasOwn(json.counters, key)` and `json.counters[key] === 2`. Covers AC-03.
  - update "issues twenty unique values across twenty parallel allocations": rename it to "issues twenty unique, consecutive values across twenty parallel allocations", create a separate `makeCtx(dataDir)` per call (as separate processes would), and assert the sorted values equal `[1 … 20]` and the stored counter is `20`. Add a variant with `start_value: 100` expecting `[100 … 119]`. Timeout 20000. Covers AC-04.
  - update `places the counter file inside the repository and never locks that directory`: rename it to "places the counter file inside the repository and leaves no lock behind", assert the ten values are exactly `[1 … 10]`, and keep the assertion that the repository has no `.lock` entry. Covers AC-04.
  - new test "parallel allocations from separate processes return unique, consecutive values": spawn 4 workers in `file-provider` mode, each allocating 5 values, all with the same `dataDir` and the same absolute `counterFile` in a temp directory. Assert every worker exits 0, the 20 values sorted equal `[1 … 20]`, and the file's counter is `20`. Timeout 60000. Covers AC-04.
  - the existing `describeProviderContract` suite still passes. Covers AC-17.
- `mcp-server/tests/error-codes/temporary-codes.test.ts`:
  - update "issues unique codes under twenty parallel calls": rename it to "issues unique, consecutive codes under twenty parallel calls"; assert the sorted codes equal `777000001 … 777000020`, and that the log then holds 20 entries with `next_counter` 21. Covers AC-05.
  - new test "parallel issues from separate processes return unique, consecutive codes": spawn 4 workers in `temporary-codes` mode, 5 codes each, against one temp `dir`. Same assertions as above for 20 codes. Timeout 60000. Covers AC-05.
  - new `describe('corrupt log recovery')`. Covers AC-06 and AC-07.
    - (a) unparsable text containing `"code": "777000041"` issues counter `42`; the `.corrupt-*` copy is byte-identical to the original text; the returned `warning` names the copy.
    - (b) a valid log with `next_counter: 10`, three valid entries and one invalid entry keeps the three entries, issues `…000010`, and the warning reports 3 of 4 recovered.
    - (c) entries with the non-digit prefix `ERR000007` count toward the floor.
    - (d) a log valid except for a missing `next_counter` value still issues above its highest code.
    - (e) two parallel `issueTemporaryCode` calls on one corrupt log: exactly one `.corrupt-*` file exists afterwards, exactly one result has a `warning`, and the two codes are distinct and consecutive. Timeout 20000.
  - "an unreadable log rejects and is left untouched" (log path made a directory). Covers AC-08.
  - `describe('listTemporaryCodes')`: existing tests are adapted to the `{ entries }` shape; a new test checks that a corrupt log returns salvaged entries and a `warning`, and that the directory listing and the file's bytes are unchanged (no copy, no write). Covers AC-09.
- `mcp-server/tests/error-codes/allocator.test.ts`: fakes updated to `issue: vi.fn(async () => ({ code: '777000001' }))`. New test: when `issue` returns a `warning`, the result carries the same `warning` and its `code`/`first_component_code` are unchanged. New test: when the provider returns `failed` for a corrupt counter, the result is temporary with `fallback_reason: 'failed'`. Covers AC-02 and AC-07.
- `mcp-server/tests/tools/error-codes.test.ts`: `listTemporaryErrorCodes` includes `warning` in its JSON when the listing has one and omits it otherwise. Covers AC-09.
- `mcp-server/tests/error-codes/config-store.test.ts`. Covers AC-10, AC-11 and AC-12.
  - `describe('temporary_prefix')`: `TemporaryPrefixSchema` accepts `7`, `777`, `123456` and rejects `''`, `ERR`, `0777`, `1234567`, `77a`.
  - "an invalid stored temporary_prefix loads as 777 and keeps providers": write a config with `temporary_prefix: 'ERR'`, a custom `active_provider`, and `providers: { 'x': { password: 's3cret' } }`. Assert the loaded prefix is `777` and everything else is equal. Then `updateErrorCodeConfig(c => ({ ...c, timeout_ms: 5000 }))`; the file keeps `providers.x.password` and has prefix `777`.
  - The existing "returns the defaults when config.json fails schema validation" is rewritten as "an invalid timeout_ms falls back alone", which asserts the other fields are kept.
  - "an unparsable config.json is copied aside before an update writes" (the `.corrupt-*` copy is byte-identical and the new `config.json` is valid), and "an unreadable config.json makes updateErrorCodeConfig throw and loadErrorCodeConfig return defaults".
  - A stderr spy asserts that the warning names `temporary_prefix` and never contains `s3cret`.
  - The existing "loses no update across ten concurrent calls each setting a different key" still passes (regression guard for the re-read inside the lock). Covers AC-17.
- `mcp-server/tests/gui/api-error-codes.test.ts`: in `describe('handleGetErrorCodeConfig / handleUpdateErrorCodeConfig')`, new test "rejects a non-digit temporary_prefix with VALIDATION_ERROR and writes nothing" (covers AC-10). In `describe('handleTestErrorCodeProvider')`, new test "reports failed with the counter-file detail when the file provider's counter file is corrupt" (covers AC-02). In `describe('handleListTemporaryErrorCodesGui')`, new test "passes a listing warning through" (covers AC-09).
- `mcp-server/tests/gui/config-error-codes-view.test.ts`:
  - `resetEcModuleState()` calls `ecResetState()` plus `ecSaveInFlight = false`, and the `declare global` block gains `ecResetState` and `ecVisit`.
  - New `describe('stale callbacks after leaving the tab')`. Covers AC-13.
    - (a) Initial load pending → `ecResetState()` → `#config-tab-content` replaced by sentinel markup → load resolves → the sentinel is intact and `ecProviders === null`.
    - (b) Leave and re-enter while the first load is pending; resolve the second load, then the first. The DOM reflects the second response.
    - (c) Save pending → `ecResetState()` → sentinel → resolve → the sentinel is intact, `ecConfig === null` and `ecSaveInFlight === false`.
    - (d) Save pending → reject after exit → no live-region message is written into the sentinel.
    - (e) Test pending → exit → re-enter → start a second test → the first settles → `ecTestInFlight` is still `true`.
  - New test "a rejected temporary-codes fetch still renders the settings form and shows the error banner", and "a listing warning renders as escaped text" (with a `<script>` payload). Covers AC-14.
  - New test "rejects an invalid temporary prefix before sending": `ERR` gives no `updateErrorCodeConfig` call and the message in the live region. A new test also asserts that `EC_TEMPORARY_PREFIX_PATTERN.source` equals the `TEMPORARY_PREFIX_PATTERN.source` imported from `src/error-codes/config-store.ts`. Covers AC-10.
  - The existing cache-buster test is updated to `?v=3`, and new static assertions check that `index.html` contains `/views/config.js?v=5` and `/api-client.js?v=7`, and that `views/config.js` contains `ecResetState()` and no longer contains `ecProviders = ecConfig = null`. Covers AC-15.
- AC-16 is verified by the reviewer against the *Documentation Updates* list (documentation has no automated test).

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md`:
  - Error Code Tools (L683–L730): `ErrorCodeResult.warning`; the `ledger_list_temporary_error_codes` result `{ entries, warning? }`; the temporary-prefix rule in the format paragraph (L712).
  - `config-store.ts` (L3077–L3084): `TemporaryPrefixSchema`/`TEMPORARY_PREFIX_PATTERN`/`DEFAULT_TEMPORARY_PREFIX`, per-field salvage, and the update path's copy-then-overwrite or refusal.
  - `file-provider.ts` (L3198–L3212): replace the "deliberate zero-setup choice" sentence with the fail-closed behaviour; Map-based keys with no reserved keys. Rewrite the lock sentence (L3210) for the single-user case: every process of one user shares the `data_dir` lock; the `.lock` is transient; a counter file shared between different users or machines is not supported.
  - `errorcode-incrementor-provider.ts` (L3214): owned parameters.
  - `temporary-codes.ts`: recovery (copy, then atomic overwrite under the lock), `IssuedTemporaryCode`, `TemporaryCodesListing`.
  - A new entry for `src/storage/json-state-file.ts` (`readJsonStateFile`, `keepCorruptCopy`).
- `mcp-server/docs/agents/project-manifest/data-flows.md` Flow R (L2155–L2253): rewrite the config read/write diagrams (salvage, copy, refusal), temporary issue/list (recovery path), and the invariant at L2252. Add one sentence on concurrency: writers re-read under the lock; unlocked readers only ever see complete files, because nothing renames a state file away. Flow T: `warning` passthrough.
- `mcp-server/docs/agents/project-manifest/constraints.md` → *Error-Code Provider Constraints*: a new constraint, "Error-Code State Files Distinguish Missing From Broken". It covers the rule, the per-store policy table from *Approach* §1, the copy-not-rename rule and its concurrency reason, the anti-pattern (catch-all default) and the correct pattern (`readJsonStateFile`).
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md` → *Lock File Persists After Server Exit* (L753–L757): correct it to "removed on release and on normal exit; left only by a hard kill and reclaimed as stale after 10 s". Add, worded for the single-user case: every process of one user that resolves the same storage directory (both MCP servers, the GUI, parallel workflow runs) contends on the same lock. Retitle the heading so it no longer states the wrong fact (e.g. *Lock Directory After a Hard Kill*), and update any in-repository link to the old heading anchor (grep for it).
- `mcp-server/docs/agents/project-manifest/file-tree.md`: L100 annotation (per-user `data_dir` lock, strict read, Map keys); add `src/storage/json-state-file.ts`; add `tests/storage/json-state-file.test.ts` and `tests/error-codes/fixtures/concurrent-allocation-worker.ts` where tests are listed.
- `mcp-server/src/tools/help-content.ts`: in `ledger_generate_error_code` (L1420–L1480), the `warning` field, the prefix rule (L1443), and the counter-file-corruption fallback (`failed` detail). In `ledger_list_temporary_error_codes` (L1482–L1515), the `warning` field.
- `mcp-server/docs/error-code-providers.md`: L14 prefix rule; L20 `file` row: allocations are serialised for every process of the current user; a counter file shared between different users or machines (network share, synced folder) is not supported. Also note that a corrupt counter file stops real allocation until it is repaired.
- `mcp-server/README.md` L86–L92: one sentence on recovery of a corrupt temporary log, keeping the fallback guarantee wording true.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md`:
  - §1.9: the PUT `temporary_prefix` rule and its 400; the `GET /api/error-codes/temporary` response `{ entries, warning? }`.
  - ec* function table (around L733): `ecResetState`.
  - State table (around L746–L749): `ecVisit`, `ecTemporaryWarning`.
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` §14: the visit-token checks and the tolerant temporary fetch.
- `mcp-server/gui/docs/agents/project-manifest/constraints.md`, tab integration points: points 2 and 3 now say "call the module's own reset function". Add a fifth point: async tab modules guard every request callback with a visit token incremented by that reset function. Reference `config-error-codes.js` and `strategy.js`.
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` L43/L47: the `config.js` and `config-error-codes.js` annotations (`ecResetState`, visit token).
- `mcp-server/changelog.md`: step 13.
- Generated context: these manifest edits make `.context/` stale. Per `docs/agents/project-manifest/generated-artefacts.md` it is regenerated by its owner, and on this feature branch generated artefacts are not committed, so no step regenerates it.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **A corrupt counter file now stops real allocations until it is repaired (F2)** | Allocation still succeeds with a temporary code; the `failed` detail names the file and the action; Test connection reports the same detail; documented in the plugin guide and help text. |
| **A user points `counter_file` at a share used by someone else despite the documentation** | The boundary is stated where the path is chosen (setting description), in the plugin guide and in the manifest. Duplicates would surface as two identical codes in source, the same as before this plan; supporting the setup is a recorded user decision (OD-1). |
| **Many parallel workflow runs wait on the per-user lock** | Each critical section is one small read and one atomic write. A file-provider lock timeout becomes `failed` and a temporary code; a temporary-log lock timeout rejects the call, which is documented in the `allocateErrorCode` JSDoc (step 6). |
| **Cross-process tests are slow or flaky (process start-up, CI load)** | Four workers × five calls bound the contention; a 60000 ms timeout covers `tsx` start-up; workers report errors on stderr and the test prints them on failure. |
| **An unlocked reader meets a file that a recovery step is replacing** | Recovery copies the corrupt file and replaces the original with one atomic rename, so the path is never absent or partial (Approach §8). |
| **The counter floor misses a code that existed only in an entry the regex could not see (e.g. truncated mid-entry)** | The corrupt original is kept byte-for-byte, and the warning tells the user to check it. Codes beyond the floor are temporary placeholders listed with context, so a collision stays detectable via `ledger_list_temporary_error_codes`. |
| **Changing `issue()`/`listTemporaryCodes()` return shapes misses a caller** | Both are internal; `npx tsc --noEmit` flags every call site; known consumers are listed in step 6. |
| **The GUI regex drifts from the server's** | The pinning test compares `.source` of both patterns. |
| **A save that settles after leaving the tab gives the user no confirmation** | The save is persisted; the next visit re-fetches and shows the saved values. A cross-tab toast is out of scope. |
| **Field-level salvage persists a default over a user's mistyped value on the next save** | Only the invalid field is replaced, and only with its documented default; a stderr warning names it; the form shows the effective value before saving. |
| **Live workspace impact** | This is the DEV workspace; the stable workspace's running Ledger server is unaffected until the user merges and restarts. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The fixes cross the storage layer, two providers, the allocator, the MCP tools, the GUI API and the GUI view, add a new storage primitive and a cross-process test worker, and change documented failure contracts, so formal QA, security review (preservation of secret-bearing files, warning redaction) and architecture review all add value.
