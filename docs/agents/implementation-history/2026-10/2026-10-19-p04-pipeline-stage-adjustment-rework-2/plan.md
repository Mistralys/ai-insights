# Plan

## Plan Audit Cycles
- Audits: 2 (Sonnet 5.5 ×2) — Plan Auditor v1.12.0
- Architectural Reviews: 1 (Sonnet 5.5 ×1) — Plan Architect Reviewer v2.3.4

## Prior Project Context

This is the second rework of P04. Rework-1 (`docs/agents/plans/2026-10-16-p04-pipeline-stage-adjustment-rework-1/`) completed 12/12 WPs with no rework cycles. Its changes are still uncommitted and its changelog entries are marked WIP. Its synthesis lists five follow-ups. This plan takes three of them and moves the other two to Human Actions. Rework-1's own deferred items were re-verified, and none has become actionable here.

The user decided that the two authorisation items need focused, separate plans, so both are out of this plan:
- **Role-alias asymmetry:** to be resolved by following spec §6.5 (accept the short and long forms). Stub plan: `docs/agents/plans/2026-10-19-p08-role-alias-alignment/`.
- **`updateWorkPackageStatus` guards lag spec v2.4.0:** found during this research. Stub plan: `docs/agents/plans/2026-10-19-p07-status-guard-spec-alignment/`.

Insights that shaped the design:
- `b37db114-…`: a true dry-run replays the real code path. Check mode keeps the same generation path and only narrows recovery.
- `48607cdb-…`: prove a guard with a synthetic failure fixture. Applied to the guard-order and double-fault tests.
- `1334b750-…`: P05 depends on `_handle_rework_limit`'s name. This plan does not touch `supervisor.py`.

## Summary

This plan addresses the actionable items in `docs/agents/plans/2026-10-16-p04-pipeline-stage-adjustment-rework-1/synthesis.md` that do not change authorisation behaviour. Each item was re-verified first; see the triage table in `research-brief.md`.

1. **PM-only guard order.** All four PM-only tools in `work-package-admin.ts` reject a non-PM caller before any project resolution or disk access. A parametrised test pins this for every PM-only tool, and the help entries and manifest describe the single order.
2. **`ctx-generate` failure truthfulness.** The double fault in the swap rollback is reported honestly: the result carries the restore error and where the previous output now lives, and the CLI stops claiming a restore that did not happen. Recovery checks its own operations and aborts before generating into stale staging. `--check` no longer renames or deletes `.context.previous/`. A failed cleanup after a successful swap is surfaced instead of ignored.
3. **Orchestrator lint debt and gate.** All 22 `ruff` violations under `orchestrator/tests/` are fixed. This includes the two E501s the synthesis named, and the same 22 were already the P03 baseline. CI and the pre-commit hook then lint `tests/` as well as `src/`, so the debt cannot return.
4. **CI coverage for root scripts.** A new CI job runs the root scripts suite, which no job runs today, including the new `ctx-generate` suites.

## Architectural Context

- **PM-only tools.** `mcp-server/src/tools/work-package-admin.ts` holds four PM-only handlers, all guarded by `requirePmRole()` (`mcp-server/src/utils/pm-role-guard.ts`). `reopenCancelledWp` (L179) and `updatePipelineStages` (L462) call it first, "before any disk I/O". `resetReworkCount` (L58) resolves the project and builds a `LedgerStore` before checking the role (L64, L74). `updateAcceptanceCriteria` (L345) resolves the project first (L351, L357). `help-content.ts` documents each tool's guard order, including the inconsistency (L537, L626).
- **`ctx-generate`.** `scripts/lib/ctx-generate.js` `runCtxGenerate` (L333–L419) works in four phases:
  1. Parse arguments.
  2. Recover from an interrupted run (`recoverInterruptedSwap`, L176).
  3. Generate into `.context.incoming/`.
  4. In check mode, compare and remove staging. Otherwise, swap via `.context.previous/`.

  `renameWithRetry` and `removeWithRetry` return result objects and never throw, but recovery (L188–L201), the rollback restore (L401–L403) and the post-swap cleanup (L408–L410) ignore those results. `scripts/cli.js` `cmdCtxGenerate` (L566–L612) maps `reason` to messages and exit codes. Its `'swap-failed'` message always claims a restore (L588–L591).
- **Lint gates.** `orchestrator/pyproject.toml` configures `ruff` (line length 100, rules E/F/I/UP). `.github/workflows/ci.yml` job `ruff` and `.githooks/pre-commit` (L19–L41) lint `orchestrator/src/` only. All 22 current violations are in `orchestrator/tests/`.
- **CI.** `.github/workflows/ci.yml` has five jobs (MCP server tests, orchestrator tests, ruff, manifest validation, persona build check), all on `ubuntu-latest` with SHA-pinned actions and Node 20. The root suite (`npm test` → `vitest run scripts/tests/`) has no job. Some root tests import `@mistralys/persona-builder`, which lives in `personas/node_modules`.

## Approach / Architecture

### 1. PM-only guard order

The rule: **a PM-only tool rejects a non-PM `agent_role` before any project resolution, store construction or disk access.** The two newer handlers already follow it.

- In `resetReworkCount`, move the `requirePmRole('ledger_reset_rework_count', …)` call to the first statement, before `resolveProjectPath`. The `LedgerStore` construction stays after resolution, and the reason guard stays where it is.
- In `updateAcceptanceCriteria`, move `requirePmRole('ledger_update_acceptance_criteria', …)` above `resolveProjectPath`.
- Add a one-line comment matching the existing ones ("PM-only guard — reject before any disk I/O").

Behaviour change: a non-PM call with an unresolvable project path now gets the PM-only rejection instead of the resolution error. For both of these tools, every call that the role check would reject was going to be rejected anyway; only the error text differs. Authorised calls are unchanged.

New `mcp-server/tests/tools/pm-only-guard-order.test.ts` is parametrised over a named `PM_ONLY_TOOLS` table: tool name, handler from `_internal`, and minimal valid arguments. For each tool it asserts:
- With `agent_role: 'Developer'` and a `project_path` that does not exist, the result is the exact `requirePmRole` rejection.
- No file was created under a temp ledger root passed as `_ledgerRoot`.

A completeness case derives the set of guarded tool names from source and asserts that it equals the table's tool names. A future PM-only tool added without a table row then fails the suite. The derivation is keyed on the guard module, not on one literal call form, so a renamed or aliased guard cannot silently escape it:
- A scanner function in the test (`collectPmGuardedTools(sourceText)`) reads every `import { … } from '…/pm-role-guard.js'` statement and collects each imported binding, including `X as Y` aliases. It then matches calls to any of those bindings whose first argument is a quoted tool-name literal, tolerating whitespace and line breaks between `(` and the literal.
- The scan covers every `.ts` file under `mcp-server/src/tools/` that imports from `pm-role-guard`, not only `work-package-admin.ts`, so a PM-only tool added in another module is also caught.
- Non-vacuity: the scan must find at least one importing file and at least one guarded name. A guard-form change that the scanner no longer recognises (for example, a helper exported under a new module path) then fails loudly instead of yielding an empty set that a reduced table would match.
- A header comment in the test names the coupling: the role-alias plan (`docs/agents/plans/2026-10-19-p08-role-alias-alignment/`) may route the guard through a role-identity helper, and whoever changes the guard's module or call shape updates `collectPmGuardedTools` in the same change.
- Synthetic fixtures (insight `48607cdb-…`): a reduced table is reported as missing a name, and an inline source string using an aliased import and a multi-line call (`import { requirePmRole as guard } …` / `guard(\n  'ledger_x', …)`) yields `ledger_x`.

### 2. `ctx-generate` failure truthfulness

All changes are in `scripts/lib/ctx-generate.js` and its caller. Generation stays a single code path for both modes.

- **Recovery reports its outcome.** `recoverInterruptedSwap` returns `{ recovered, restoredOutput, failures: Array<{ op: 'restore' | 'remove-previous' | 'remove-incoming', path, error }> }` and records every `{ ok: false }` helper result in `failures`. It gains an option `{ mode: 'generate' | 'check' }` (default `'generate'`):
  - In `'check'` mode it only removes a stale `.context.incoming/`, because staging is about to be reused. It never renames or removes `.context.previous/` and never touches `.context/`.
- **`runCtxGenerate` aborts on failed recovery.** When `failures` is non-empty, it returns `{ ok: false, reason: 'recovery-failed', failures }` before calling `generateContext`. Generating into a `.context.incoming/` that could not be cleared would mix stale and new files.
- **Check mode with a missing `.context/`.** If `.context.previous/` exists and `.context/` does not, check mode reports `fresh: false` and lists `.context/` among the diffs. It does not restore. This needs no new comparison code: `compareTrees`'s inner `collect()` already returns an empty set for a missing directory (`scripts/lib/ctx-generate.js` L221), so every expected file reports as a diff. Step 3 pins that behaviour with a test.
- **Truthful swap failure.** Both `'swap-failed'` return sites (the move-aside failure at L387–L392 and the move-in failure at L394–L402) gain `previousOutput`. Its value is **observed, not inferred**: after the failing branch's own cleanup, `runCtxGenerate` checks `fs.existsSync` on `.context/` and `.context.previous/` and classifies the result. The helper's return value never decides the state on its own, because a rename reported as failed may still have taken effect, and the move-aside branch leaves a different state from the restore branch.
  - `'none'`: no `.context/` existed before the run (`outputExisted` is false).
  - `'untouched'`: the move-aside failed, and `.context/` exists while `.context.previous/` does not. The old output was never moved.
  - `'restored'`: the move-in failed, the restore was attempted, and `.context/` exists while `.context.previous/` does not.
  - `'preserved-in-previous'`: the move-in failed, `.context/` is missing and `.context.previous/` exists. The next generate run restores it through recovery.
  - `'unknown'`: the observed pair matches none of the expected states for that branch. The result also carries `observed: { output: boolean, previous: boolean }`, so the CLI can report exactly what is on disk without claiming a recovery path.

  The full branch-to-state table, applied only when `outputExisted` is true (otherwise the value is `'none'`). `output` and `previous` are the observed existence of `.context/` and `.context.previous/`:

  | Failing branch | `output` | `previous` | `previousOutput` |
  |---|---|---|---|
  | Move-aside | true | false | `'untouched'` |
  | Move-aside | false | true | `'unknown'` |
  | Move-aside | true | true | `'unknown'` |
  | Move-aside | false | false | `'unknown'` |
  | Move-in | true | false | `'restored'` |
  | Move-in | false | true | `'preserved-in-previous'` |
  | Move-in | true | true | `'unknown'` |
  | Move-in | false | false | `'unknown'` |

  `'preserved-in-previous'` is reachable only from the move-in branch and `'untouched'` only from the move-aside branch. A move-aside failure that leaves the old output in `.context.previous/` is `'unknown'`, because a rename that reported failure is not trusted to have completed.
  - `restoreError` is set whenever the restore rename returned `{ ok: false }`, independently of the observed classification.
- **Leftover after success.** If removing `.context.previous/` after a successful swap fails, the result is `{ ok: true, mode: 'generate', agentsMdMissing, leftoverPrevious: true }`. The next run removes it.
- **CLI mapping in `cmdCtxGenerate`:**
  - `'swap-failed'` prints the message for its `previousOutput` value. Only `'restored'` says that `.context/` was restored; `'untouched'` says it was not changed; `'none'` says no previous output existed. For `'preserved-in-previous'` it names both errors and states that `.context/` is missing, that its previous content is in `.context.previous/`, and that the next `ctx-generate` run restores it. For `'unknown'` it names the error (and `restoreError` when present), lists which of `.context/` and `.context.previous/` exist per `observed`, and asks the user to inspect them before rerunning. Exit 1 in every case.
  - New `'recovery-failed'` case lists each failure's operation, path and error message, and states that nothing was generated. Exit 1.
  - `leftoverPrevious` prints a dim note after the success line. Exit code unchanged.

### 3. Orchestrator lint debt and gate

- Run `ruff check --fix tests/` for the four auto-fixable findings (F401, I001), then wrap the 18 E501 lines by hand: string concatenation, parenthesised continuation, or moving a trailing comment onto its own line. Behaviour stays the same and no `# noqa` is added.
- `.github/workflows/ci.yml` job `ruff`: `ruff check src/ tests/`.
- `.githooks/pre-commit`: match staged files with `grep -E '^orchestrator/(src|tests)/.*\.py$'` and run `"$RUFF" check orchestrator/src/ orchestrator/tests/`. Everything else in the block stays the same.
  - The `-E` flag is required. The current line uses plain `grep` (basic regex), where `(`, `|` and `)` are literal characters, so the alternation copied without `-E` would never match and the hook would silently stop linting. `grep -E` is POSIX and already used in the same hook (`grep -cE` for the presentation check), so the hook stays `sh`-compatible.
  - Step 4 proves the match line with a simulated staged-name list (see Detailed Steps).

### 4. Root scripts CI job

New job `root-scripts-tests` ("Root Scripts Tests") in `.github/workflows/ci.yml`, modelled on `orchestrator-tests`:
- `actions/checkout` and `actions/setup-node`, both pinned to the same SHAs as the existing jobs.
- `node-version: '20'`, with npm cache over `package-lock.json` and `personas/package-lock.json`.
- `npm ci` at the root, then `cd personas && npm ci`.
- `npm test` at the root.

The step-5 verification in a clean copy decides whether the job also needs a personas build or an `mcp-server` install. Any extra install step it finds necessary is added to the job and recorded in the pipeline summary.

### 5. Documentation, changelogs, versions

Every unreleased changelog head carries the `**WIP; UNRELEASED**` marker, so this plan extends those entries rather than opening new versions: mcp-server v2.14.0, orchestrator v1.6.0, root v2.17.0. If a head entry no longer carries the marker at execution time, the step opens the next patch version above it instead. Documentation targets are listed under Documentation Updates.

## Rationale

- **Role first, everywhere.** A role check needs no I/O and is the cheapest rejection. Two tools already document "before any disk I/O" as intent, so the other two are the outliers. Unifying on the order the newer tools chose also keeps help text and manifest prose to one sentence per tool.
- **A derived completeness check for the guard-order test.** A hand list of PM-only tools would drift the way the tool lists did before rework-1's registry. Deriving the guarded names from the guard module's imported bindings keeps the table honest, and the non-vacuity assertion turns an unrecognised guard form into a failure rather than a silent pass. This matters because the role-alias plan is scheduled to reshape the guard next. A `pmOnly()` wrapper that makes the order structural was weighed and rejected as out of proportion (see Considered Alternatives).
- **Truthfulness over more retries.** The double fault is rare, typically a lock held on Windows across all retries. Adding retries would not remove it; reporting it accurately does. Recovery already restores `.context.previous/` on the next run, so the right fix is to say so.
- **Observed state over inferred state.** A swap failure is reported from what `fs.existsSync` sees on both directories, not from which helper returned `{ ok: false }`. Two branches can fail with different disk outcomes, and a rename's reported result is not proof of its effect. Two `existsSync` calls are the whole cost, and the `'unknown'` value means the CLI never names a recovery path the disk does not support.
- **Abort on failed recovery.** Continuing would let `ctx` write into a staging directory still holding the previous run's files. That is the one way the staged design could produce a corrupt `.context/` without any error.
- **Check mode stays read-only for real output.** `--check` exists to observe. Restoring or deleting `.context.previous/` there changes state that a concurrent or later generate run relies on.
- **Fix all 22 lint findings and widen the gate.** Fixing only the two named lines leaves 20 that block anyone who stages those files once the hook covers `tests/`. Widening the gate without the cleanup would fail CI immediately.
- **Root scripts CI job.** The suite holds the regression tests for rework-1's most consequential fix (`ctx-generate`) and runs nowhere automatically.
- **No speculative structure.** `previousOutput` has five consumers (the five CLI messages), and `observed` has one (the `'unknown'` message). `failures` has one (the `recovery-failed` message) plus tests. `PM_ONLY_TOOLS` is consumed by the parametrised test and its completeness check.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Unified guard order for PM-only tools | Role check first, before resolution | Resolution first everywhere; document the asymmetry as intentional | Role-first needs no I/O and matches the two newer tools and their comments. Resolution-first would reorder the newest tool's documented design. Documenting the asymmetry leaves no rule for a fifth tool. |
| Keeping the PM-only tool list honest | Parametrised table plus a source scan keyed on the bindings imported from `pm-role-guard`, across `src/tools/`, with a non-vacuity assertion | A table only; derive the tools from the registry by description text; a scan for the literal `requirePmRole('` text; a `pmOnly(toolName, handler)` wrapper whose own registry feeds the table | A table alone drifts. Description text is prose, not a contract. The literal-text scan would silently miss the guard once the role-alias plan renames or wraps it. The wrapper makes the order structural but reshapes four handlers whose guards sit in differently shaped `try` blocks, which is out of proportion for this plan. |
| Double-fault handling | Report the restore failure and where the old output is; next run recovers | More retries; copying `.context.previous/` back on failure | Retries only shift the threshold. A copy-back can fail under the same lock and doubles the I/O. Recovery already exists and only needed honest reporting. |
| Swap-failure state reporting | `previousOutput` classified from `fs.existsSync` on both directories after the failing branch, with `'untouched'` and `'unknown'` alongside `'none'`, `'restored'`, `'preserved-in-previous'` | A three-value enum inferred from which rename failed; a boolean `restored` plus optional `restoreError` | Inference misreports the move-aside failure (old output intact, no `.context.previous/`) and any rename whose reported result differs from its effect. A boolean cannot express "preserved elsewhere" or "unknown" without extra flags, and `outputExisted` already covers `'none'`. |
| Recovery failure | Abort before generation with `recovery-failed` | Generate into a fresh unique staging name instead | A unique name would need its own cleanup and recovery rules, and would hide a persistent lock that the user should resolve. |
| Check mode recovery | Clear stale staging only | Skip recovery entirely in check mode; stage check runs in an OS temp directory | Skipping would let `ctx` write into stale staging. An OS temp staging path would fork the generation path from the real run (insight `b37db114-…`). |
| Lint scope | Fix all 22 test findings and lint `tests/` in CI and the hook | Fix only the two named lines; per-file ignores for `tests/` | Two lines leave the gate unwidenable. Per-file ignores would make test code permanently exempt from the rules the source follows. |
| Root suite in CI | New dedicated job | Add `npm test` as a step in `mcp-server-tests` | The existing jobs are one concern each, and a separate job reports independently, which `docs/references/development.md` describes as the design. |

## Pattern Alignment

- Follows "role guard before any disk I/O" — `reopenCancelledWp` and `updatePipelineStages` in `mcp-server/src/tools/work-package-admin.ts`.
- Follows `_internal` handler testing — `mcp-server/tests/tools/work-package.test.ts` L15.
- Follows registry-derived completeness tests with synthetic failure fixtures — rework-1's `mcp-server/tests/tools/help-content-coverage.test.ts`.
- Follows "structured result, caller owns the exit" — `scripts/lib/mcp-dist-freshness.js`, and the existing `reason` switch in `scripts/cli.js` `cmdCtxGenerate`.
- Follows injected I/O seams for failure tests — `renameWithRetryFn` / `removeWithRetryFn` in `scripts/lib/ctx-generate.js`.
- Follows the CI job layout of `.github/workflows/ci.yml`: one concern per job, SHA-pinned actions, npm cache.
- No departures.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/tools/work-package-admin.ts` (L58–L80, L345–L360) | Two of four PM-only handlers resolve the project before the role check | Promoted to step 2 | Synthesis Deferred (WP-003). One rule now applies to every PM-only tool. |
| `mcp-server/src/tools/help-content.ts` (L537, L626) | Guard lists document the inconsistency | Promoted to step 2 | They must describe the unified order. |
| `scripts/lib/ctx-generate.js` `recoverInterruptedSwap` (L176–L204) | Ignores helper results; runs mutating recovery in check mode | Promoted to step 3 | A failed clear lets `ctx` write into stale staging, and check mode is meant to be read-only. |
| `scripts/lib/ctx-generate.js` swap rollback and cleanup (L397–L410) | Restore and cleanup results ignored | Promoted to step 3 | Synthesis Deferred (WP-007 review). |
| `scripts/cli.js` `cmdCtxGenerate` (L588–L591) | Always claims a restore | Promoted to step 3 | The message is false on the double fault and on a first run. |
| `orchestrator/tests/` (22 findings) | Lint debt since at least P03 | Promoted to step 4 | Synthesis Deferred (WP-008), widened. Prerequisite for widening the gate. |
| `.github/workflows/ci.yml` `ruff` job; `.githooks/pre-commit` L19–L41 | Lint `src/` only | Promoted to step 4 | Keeps the cleanup from regressing. |
| `.github/workflows/ci.yml` | No job for the root scripts suite | Promoted to step 5 | The suite guards rework-1's `ctx-generate` fix and runs nowhere automatically. |
| `mcp-server/src/tools/work-package.ts` `updateWorkPackageStatus` alias lists and guards | Five hand-written alias lists; guards lag spec v2.4.0 | Rejected | User decision: each gets its own focused plan (stub plans `2026-10-19-p08-role-alias-alignment` and `2026-10-19-p07-status-guard-spec-alignment`). |
| `mcp-server/src/utils/pm-role-guard.ts` | Could be widened to an alias-aware role helper | Rejected | Belongs to the role-alias stub plan. |
| CI `ctx-generate --check` job | Would catch stale `.context/` in pull requests | Rejected | Needs a `ctx` install in CI and can only be validated by a push. Stays in Deferred Items. |
| `mcp-server/tests/tools/knowledge-help.test.ts` presence blocks | Redundant with the help coverage suite | Rejected | Harmless overlap; deletion is churn (rework-1 decision stands). |

## Detailed Steps

1. **Capture the baseline.** No dependencies; must run before any other step changes code.
   - Run the mcp-server suite (`npm test` in `mcp-server/`), the root scripts suite (`npm test` at the workspace root), the orchestrator suite (`python -m pytest tests/` in `orchestrator/`) and `ruff check . --output-format concise` in `orchestrator/`.
   - Write each run's failing test IDs (or lint findings) and totals to `~/.ai-insights/baselines/2026-10-19-p04-pipeline-stage-adjustment-rework-2/`: `mcp-server.txt`, `scripts.txt`, `orchestrator.txt`, `ruff.txt`.
   - The baseline lives outside every repository, where no step of this run cleans or overwrites it. Pre-existing failures are recorded, not fixed.

2. **Unify the PM-only guard order.**
   - In `mcp-server/src/tools/work-package-admin.ts`, move the `requirePmRole` call to the first statement of `resetReworkCount` and of `updateAcceptanceCriteria`, before `resolveProjectPath`, with the comment "PM-only guard — reject before any disk I/O". Rejection texts stay unchanged.
   - In `mcp-server/src/tools/help-content.ts`, reorder the `## Guards (evaluated in this order)` lists of `ledger_reset_rework_count` and `ledger_update_acceptance_criteria` so PM-only is guard 1 and project resolution is guard 2. Delete the sentence "an unresolvable path errors before any role check runs".
   - Create `mcp-server/tests/tools/pm-only-guard-order.test.ts` (new) per Approach §1.
   - Run the full mcp-server suite and `npx tsc --noEmit`. Every existing admin-tool test passes unchanged.

3. **Make `ctx-generate` failures truthful.**
   - In `scripts/lib/ctx-generate.js`:
     - Extend `recoverInterruptedSwap` with `failures` and the `mode` option.
     - Abort `runCtxGenerate` with `recovery-failed` on a non-empty `failures`.
     - Pass `mode: 'check'` from check mode.
     - Add `previousOutput` (classified from the observed state of `.context/` and `.context.previous/` at both `swap-failed` return sites), `restoreError` and `observed` to `swap-failed`, and `leftoverPrevious` to a successful generate, all per Approach §2. Keep the classification in one small private helper used by both return sites, so the branch-to-state table lives in one place.
     - Update the JSDoc typedef for the result union.
   - Pin `compareTrees`'s existing missing-directory behaviour (an empty set for a missing directory, L221) with a test, and state it in its JSDoc. No code change to `compareTrees` is expected.
   - In `scripts/cli.js` `cmdCtxGenerate`, apply the message and exit-code mapping from Approach §2.
   - Extend `scripts/tests/ctx-generate.test.js` and `scripts/tests/cli-ctx-generate.test.js` per the Test Plan.
   - Manually verify against the real `ctx` binary that `node scripts/cli.js ctx-generate` succeeds and that `node scripts/cli.js ctx-generate --check` then exits 0. Record both outputs in the pipeline summary.

4. **Clear the orchestrator lint debt and widen the gate.**
   - In `orchestrator/`, run `ruff check --fix tests/`, then fix the remaining E501 findings by hand per Approach §3 with no `# noqa`. `ruff check .` must report zero findings.
   - Run `python -m pytest tests/` and confirm that the failing test IDs match the step 1 baseline.
   - In `.github/workflows/ci.yml` job `ruff`, change the command to `cd orchestrator && ruff check src/ tests/`.
   - In `.githooks/pre-commit`, widen the staged-file pattern (with `grep -E`) and the lint command per Approach §3.
   - Verify the hook's match line executably:
     1. Copy the `grep` expression from the edited hook verbatim (not retyped from this plan).
     2. Pipe a simulated staged-name list through it: `orchestrator/src/a.py`, `orchestrator/tests/x.py`, `orchestrator/tests/conftest.py`, `orchestrator/README.md`, `orchestrator/src/data.json`, `scripts/z.py`, `mcp-server/src/orchestrator/b.py`.
     3. The output must be exactly the three `orchestrator/src/` and `orchestrator/tests/` `.py` names.
     4. Run `sh -n .githooks/pre-commit` to confirm the hook still parses as POSIX `sh`.
   - Record the command, the input list and the output in the pipeline summary.

5. **Add the root scripts CI job.**
   - Add the `root-scripts-tests` job to `.github/workflows/ci.yml` per Approach §4, reusing the existing jobs' pinned action SHAs.
   - Verify that the job's install steps are sufficient:
     1. Copy the files from `git ls-files -co --exclude-standard` into a fresh directory under the OS temp dir.
     2. Run the job's commands there in order: root `npm ci`, `cd personas && npm ci`, root `npm test`.
     3. If the suite needs more (a personas build, an `mcp-server` install), add the matching step to the job and repeat.
   - Record the final command list and the result in the pipeline summary. Remove the temp copy afterwards.

6. **Update documentation.** Depends on steps 2–5. Apply every entry under Documentation Updates.

7. **Changelogs and versions.** Depends on step 6.
   - Extend the WIP entries per Approach §5, in house style:
     - `mcp-server/changelog.md` v2.14.0: unified PM-only guard order.
     - `orchestrator/changelog.md` v1.6.0: test lint cleanup, `tests/` now linted in CI and the hook.
     - Root `changelog.md` v2.17.0: one bullet each for the guard order, the truthful `ctx-generate` failures, the lint gate, and the new CI job. The `> mcp … · orchestrator …` line stays accurate.
   - Run `node scripts/cli.js build-maintain`, which regenerates `.context/` and `CLAUDE.md` through the updated code path, then `node scripts/check-version-sync.js`.

8. **Exit gate.** Depends on steps 1 and 7.
   - Run the full mcp-server suite, `npx tsc --noEmit`, the root scripts suite, the orchestrator suite, `ruff check src/ tests/` in `orchestrator/`, `node scripts/build-personas.js --check` and `node scripts/cli.js ctx-generate --check`, which must exit 0.
   - Compare each suite's failing test IDs with the step 1 baseline in `~/.ai-insights/baselines/2026-10-19-p04-pipeline-stage-adjustment-rework-2/`. Every remaining failure must already appear there, and the ruff count must be zero.
   - Record totals in the pipeline summary only, not in any document.

## Dependencies

- Step 1 has no dependencies and runs first. Step 8 consumes its output.
- Steps 2, 3, 4 and 5 are independent of each other.
- Step 6 depends on steps 2–5. Step 7 depends on step 6. Step 8 depends on steps 1 and 7.
- External: the `ctx` CLI on `PATH` for steps 3, 7 and 8. The orchestrator virtualenv (with `ruff`) for steps 1, 4 and 8. Network access for `npm ci` in step 5.

## Required Components

- New: `mcp-server/tests/tools/pm-only-guard-order.test.ts`
- Modified: `mcp-server/src/tools/work-package-admin.ts`, `mcp-server/src/tools/help-content.ts`
- Modified: `scripts/lib/ctx-generate.js`, `scripts/cli.js`, `scripts/tests/ctx-generate.test.js`, `scripts/tests/cli-ctx-generate.test.js`
- Modified: `orchestrator/tests/test_integration.py`, `orchestrator/tests/test_persona_models_assignments.py`, `orchestrator/tests/test_slug_dir.py`, `orchestrator/tests/test_store_resolution.py`, `orchestrator/tests/test_streaming_capture.py`, `orchestrator/tests/test_subagents.py`
- Modified: `.github/workflows/ci.yml`, `.githooks/pre-commit`
- Documentation files listed under Documentation Updates

## Assumptions

- The rework-1 working tree (uncommitted, branch `feature-pipeline-adjustments`) is the baseline. Line references were verified against it on 2026-10-19. If the user commits it first, nothing in this plan changes.
- The rework-1 changelog entries remain unreleased while this plan runs.
- The stub plans `2026-10-19-p08-role-alias-alignment` and `2026-10-19-p07-status-guard-spec-alignment` run after this plan. Neither touches the files this plan changes, apart from `help-content.ts`, which the role-alias plan edits in other entries.

## Constraints

- `requirePmRole` rejection texts and all existing admin-tool test assertions stay unchanged.
- `ctx-generate` keeps one generation path for both modes (insight `b37db114-…`), and check mode never renames or deletes `.context/` or `.context.previous/`.
- Lint fixes do not change test behaviour and add no `# noqa` or per-file ignores.
- Root scripts follow the Cross-Platform Policy (root `AGENTS.md`). The hook stays POSIX `sh`-compatible like the rest of `.githooks/pre-commit`.
- No new runtime or dev dependencies. No workflow specification change and no persona change.

## Out of Scope

- Role-alias handling in `requirePmRole` and `updateWorkPackageStatus` (stub plan `2026-10-19-p08-role-alias-alignment`).
- Aligning `updateWorkPackageStatus`'s COMPLETE, reopen and blocker-replacement guards with spec v2.4.0 (stub plan `2026-10-19-p07-status-guard-spec-alignment`).
- The halted sweep's direct route to synthesis (owned by P05).
- CI on macOS or Windows runners.
- The design exclusions P04 recorded, and the self-declared `agent_role` trust model.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Commit the rework-1 and rework-2 changes. | After the run | Version control is managed by the user. |
| 2 | Push to a branch with a pull request against `main`, and confirm that the new `Root Scripts Tests` job and the widened `ruff` job pass on GitHub. | After the run | CI runs only on GitHub after a push, which the user performs. |
| 3 | Publish and tag the root releases (v2.15.0 through v2.17.0 are unreleased; the latest tag is 2.14.1). | After the run | Releases and tags belong to the user. |
| 4 | Restart or reinstall the stable workspace's MCP server so it serves the rework-1 registry, the help entries and the new guard order. | After the run | The stable workspace runs the workflow executing this plan. |
| 5 | Run the Ledger Knowledge Archiver on the rework-1 plan folder. The recording-shim and staged generate-and-swap nuggets were never archived. | After the run | It is a separate agent session outside the ledger roles, started by the user. |
| 6 | Optionally run the belated security audit on the project from P04's `request.md` incident. | After the run | It needs the user's choice of project and a live ledger. |

## Acceptance Criteria

- AC-01: Each of the four PM-only tools (`ledger_reset_rework_count`, `ledger_reopen_cancelled_wp`, `ledger_update_acceptance_criteria`, `ledger_update_pipeline_stages`), called with a non-PM `agent_role` and a non-existent `project_path`, returns the exact `requirePmRole` rejection and creates no file under the ledger root.
- AC-02: `pm-only-guard-order.test.ts` fails when a tool guarded through any binding imported from `pm-role-guard` in a `mcp-server/src/tools/` file (including an aliased import or a multi-line call) has no row in its `PM_ONLY_TOOLS` table, and fails when the scan finds no importing file or no guarded name.
- AC-03: The `TOOL_HELP` guard lists of all four PM-only tools name the PM-only check as guard 1, and every pre-existing admin-tool test passes with unchanged assertions.
- AC-04: When moving the new output into place fails and restoring the previous `.context/` also fails, `runCtxGenerate` returns `swap-failed` with `previousOutput: 'preserved-in-previous'` and `restoreError`. The CLI says that `.context/` is missing, that its previous content is in `.context.previous/`, and that the next run restores it, and exits 1. A following generate run restores and completes.
- AC-05: `previousOutput` on every `swap-failed` result reflects the observed existence of `.context/` and `.context.previous/`, not the helpers' reported results: a failed move-aside yields `'untouched'`, no prior `.context/` yields `'none'`, and an observed pair matching no expected state yields `'unknown'` with `observed`. The CLI claims a restore only when `previousOutput` is `'restored'`, and for `'unknown'` lists what exists without naming a recovery path.
- AC-06: When any recovery operation fails, `runCtxGenerate` returns `recovery-failed` with the failing operations, does not call `ctx`, and the CLI exits 1 listing them.
- AC-07: `ctx-generate --check` never renames or deletes `.context/` or `.context.previous/`. With `.context.previous/` present and `.context/` missing, it reports stale and exits 1.
- AC-08: A failed removal of `.context.previous/` after a successful swap yields `ok: true` with `leftoverPrevious: true`, and the CLI notes it while still exiting 0.
- AC-09: `ruff check src/ tests/` in `orchestrator/` reports zero findings, with no new `# noqa` or per-file ignores, and the orchestrator suite's failures match the step 1 baseline.
- AC-10: The CI `ruff` job lints `src/` and `tests/`. The pre-commit hook lints both directories when any staged file is under `orchestrator/src/` or `orchestrator/tests/`: its match line uses `grep -E`, and run against a simulated staged-name list it selects exactly the `.py` files under those two directories.
- AC-11: `.github/workflows/ci.yml` has a `root-scripts-tests` job that installs what the root suite needs and runs root `npm test`, with SHA-pinned actions. Its command list was verified in a clean copy of the working tree.
- AC-12: All documents and changelogs listed under Documentation Updates reflect the changes, and `check-version-sync.js` passes.
- AC-13: The exit gate passes: full mcp-server, root scripts and orchestrator suites, `tsc --noEmit`, `ruff check src/ tests/`, `build-personas.js --check` and `ctx-generate --check`. Every remaining test failure appears in the step 1 baseline.

## Testing Strategy

- **Baseline first.** Step 1 records failing test IDs and lint findings, so the exit gate can tell regressions from pre-existing failures.
- **Behavioural guard-order test** across every PM-only tool, with a derived completeness check proven by a reduced-table fixture and an aliased-import fixture.
- **Injected I/O failures** for every new `ctx-generate` branch through the existing `renameWithRetryFn` / `removeWithRetryFn` seams, on real temp directories.
- **Static source assertions** for the `cmdCtxGenerate` message mapping, since `cli.js` cannot be imported.
- **Clean-copy rehearsal** of the new CI job's commands, since CI itself runs only after the user pushes.
- **Dogfooding.** `build-maintain` and `ctx-generate --check` run through the changed code path in steps 7 and 8.

## Test Plan

- `mcp-server/tests/tools/pm-only-guard-order.test.ts` (new):
  - Per `PM_ONLY_TOOLS` row: a non-PM role with a non-existent `project_path` returns the exact `Error: <tool> is a PM-only tool. You are: Developer` result with `isError: true`, and the temp ledger root stays empty.
  - `collectPmGuardedTools` over every `src/tools/*.ts` file importing `pm-role-guard` returns a non-empty set equal to the table's names, from at least one importing file.
  - A reduced table (one row removed) is reported as missing that name.
  - An inline fixture source with `import { requirePmRole as guard } from '../utils/pm-role-guard.js'` and a multi-line `guard(\n  'ledger_x', …)` call yields `ledger_x`; a fixture with no `pm-role-guard` import yields an empty set, which the non-vacuity assertion rejects.

  Covers AC-01, AC-02.
- Existing `mcp-server/tests/tools/work-package.test.ts`, `reopen-cancelled-wp.test.ts`, `update-pipeline-stages.test.ts`, `multi-store-tool-resolution.test.ts`, `tests/utils/pm-role-guard.test.ts` — pass with unchanged assertions — AC-03
- `mcp-server/tests/tools/knowledge-help.test.ts` — gains assertions that the `## Guards` lists of `ledger_reset_rework_count` and `ledger_update_acceptance_criteria` start with `1. **PM-only**` — AC-03
- `scripts/tests/ctx-generate.test.js` › `recoverInterruptedSwap`:
  - A failing restore rename and a failing removal are each reported in `failures` with their `op`.
  - In `mode: 'check'`, `.context.previous/` and `.context/` are untouched and a stale `.context.incoming/` is removed.

  Covers AC-06, AC-07.
- `scripts/tests/ctx-generate.test.js` › `runCtxGenerate — real run`:
  - A failing move-in plus a failing restore returns `previousOutput: 'preserved-in-previous'` and `restoreError`, and `.context.previous/` holds the original bytes. A second run with working renames restores and completes.
  - A failing move-in with a successful restore returns `'restored'`; with no prior `.context/` it returns `'none'`.
  - A failing move-aside returns `'untouched'`, `.context/` holds the original bytes, and `.context.previous/` does not exist.
  - Observation beats the reported result: a fake restore rename that moves the directory but reports `{ ok: false }` returns `'restored'` with `restoreError` set; a fake that reports `{ ok: true }` without moving returns `'preserved-in-previous'`.
  - A rename fake that leaves both `.context/` and `.context.previous/` present returns `'unknown'` with `observed: { output: true, previous: true }`.
  - A failing move-aside whose fake actually moves `.context/` to `.context.previous/` (observed `.context/` missing, `.context.previous/` present) returns `'unknown'` with `observed: { output: false, previous: true }`, not `'preserved-in-previous'`. This pins that `'preserved-in-previous'` is reachable only from the move-in branch.
  - A recovery failure returns `recovery-failed` and the fake `spawn` is never called.
  - A failing post-swap removal of `.context.previous/` returns `ok: true, leftoverPrevious: true`.

  Covers AC-04, AC-05, AC-06, AC-08.
- `scripts/tests/ctx-generate.test.js` › `runCtxGenerate — check mode`:
  - With `.context.previous/` present and `.context/` missing: `fresh: false`, `.context` listed, both directories exactly as before.
  - `compareTrees` with a missing second directory reports every expected file.

  Covers AC-07.
- `scripts/tests/cli-ctx-generate.test.js`:
  - The `cmdCtxGenerate` body handles `'recovery-failed'`.
  - It branches on `previousOutput` with a case for each of `'none'`, `'untouched'`, `'restored'`, `'preserved-in-previous'` and `'unknown'`, the text "was restored to its previous content" appears only in the `'restored'` branch, and the `'unknown'` branch references `observed`.
  - It references `leftoverPrevious`.

  Covers AC-04, AC-05, AC-06, AC-08.
- Step 3 manual run against the real `ctx` binary (generate, then `--check` exits 0) — AC-13
- Step 4 `ruff check .` with zero findings, plus the orchestrator suite compared with the baseline — AC-09
- Step 4 review of the `.github/workflows/ci.yml` diff, plus the simulated staged-name run of the hook's `grep -E` match line (exactly the three `orchestrator/src|tests` `.py` names selected) and `sh -n .githooks/pre-commit` — AC-10
- Step 5 clean-copy rehearsal of the `root-scripts-tests` commands — AC-11
- Step 6 review against Documentation Updates, plus `node scripts/check-version-sync.js` — AC-12
- Step 8 exit gate commands — AC-13

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md`:
  - In the `ledger_reset_rework_count` (L321) and `ledger_update_acceptance_criteria` (L371) sections, state that `agent_role` is checked via `requirePmRole` before project resolution and any disk I/O.
  - Align the module notes at L4279–L4320 to the single order.
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md`: add the rule "PM-only tools reject a non-PM caller before any disk I/O", enforced by `tests/tools/pm-only-guard-order.test.ts`.
- `mcp-server/docs/agents/project-manifest/file-tree.md`:
  - Add `tests/tools/pm-only-guard-order.test.ts`.
  - Extend the `knowledge-help.test.ts` entry (L260): it also asserts that the `## Guards` lists of `ledger_reset_rework_count` and `ledger_update_acceptance_criteria` start with the PM-only check.
- Root `AGENTS.md`:
  - Generated Context Docs table: add the three outputs it lacks, `.context/mcp-server/manifest-ui-components.md`, `.context/personas/model-registry.md` and `.context/personas/build-system-guide.md`. Each description must come from its document entry in `mcp-server/module-context.yaml` or `personas/module-context.yaml`. Verify that the table then matches the 38 documents defined by `context.yaml` and every `**/module-context.yaml`.
  - Generated Context Docs paragraph: a failed swap whose restore also fails leaves the previous output in `.context.previous/`, reported by the CLI and restored by the next run. A recovery failure aborts before generation. `--check` never touches `.context.previous/`.
  - `scripts/lib/ctx-generate.js` row in Root-Level Tooling: the new `recovery-failed` reason, `previousOutput`, `leftoverPrevious`, and the `mode` option of `recoverInterruptedSwap`.
  - `scripts/install-hooks.js` row: ruff now covers orchestrator source and tests.
  - `CLAUDE.md` is regenerated by step 7.
- `docs/references/development.md` "CI — Automated Quality Gate" (L48–L60): six jobs instead of five; add the Root Scripts Tests row; update the ruff row to `ruff check src/ tests/`.
- `orchestrator/README.md` L592–L609: ruff covers `src/` and `tests/`; commands become `ruff check src/ tests/` (and the `--fix` / `format` variants); update the CI enforcement note.
- `mcp-server/changelog.md`, `orchestrator/changelog.md`, root `changelog.md` — WIP entries extended (step 7).
- `.context/` regenerated by step 7 (`build-maintain`), per insight `53454e24-…`.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Accept the role aliases in `requirePmRole` as spec §6.5 requires, through one role-identity helper | Synthesis Deferred (WP-004); rework-1 Deferred 3 | User decision: separate focused plan | Stub: `docs/agents/plans/2026-10-19-p08-role-alias-alignment/` |
| 2 | Align `updateWorkPackageStatus` guards with spec v2.4.0 (§6.2, §6.5, §21.10) | Found during this plan's research | User decision: separate focused plan | Stub: `docs/agents/plans/2026-10-19-p07-status-guard-spec-alignment/` |
| 3 | Halted sweep routes straight to synthesis | rework-1 Deferred 1 (P03 → P04) | Owned by pending plan P05 | Reconsider when P05 executes. |
| 4 | GUI control for editing a WP's stage list | rework-1 Deferred 2 | Needs an authorisation model the GUI lacks | Own plan if requested. |
| 5 | `ctx-generate --check` as a CI job | rework-1 Deferred 4 | Needs a `ctx` install in CI and is only verifiable by a push | Reconsider once the root scripts job has proven stable. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **A caller relied on the resolution error coming before the role error** | No test or persona depends on it (verified). Authorised calls are unchanged, and the order change is recorded in the changelog. |
| **`compareTrees`'s missing-directory behaviour changes later, breaking the check-mode case** | The behaviour was verified (`collect()` returns an empty set, L221). Step 3 pins it with a test and states it in the JSDoc. |
| **The role-alias plan changes the guard's module or call shape and the completeness scan stops matching** | The scan is keyed on the bindings imported from `pm-role-guard` (aliases and multi-line calls included), the non-vacuity assertion fails loudly on an unrecognised form, and a header comment names the coupling with the role-alias plan. |
| **A swap-failure classification hides a state it did not anticipate** | Every unexpected observed pair falls through to `'unknown'` with the raw `observed` flags, so the CLI reports the disk as it is instead of a guessed recovery path. |
| **Wrapping long lines changes a test string's value** | Strings are split with implicit concatenation that produces the identical value. The suite is compared with the baseline after the cleanup. |
| **The root scripts job fails on GitHub despite the rehearsal** | The rehearsal uses `npm ci` in a clean copy. Human Action 2 confirms the job on GitHub, and the job is independent, so a failure blocks no other job. |
| **Widened hook blocks commits for contributors without ruff** | The hook keeps its existing "ruff not found — skipping" fallback. |
| **The stub plans later edit the same help entries** | They touch different `TOOL_HELP` entries, and the role-alias stub names this plan as a predecessor. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** Four independent concerns across the MCP server, root scripts, orchestrator tests and CI each benefit from separate QA and review, and the CI change needs explicit verification evidence.
