# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.9.2
- Architectural Reviews: 1 — Plan Architect Reviewer v2.3.2

## Prior Project Context

The repository's declared **short-term strategic vision** is minimizing setup and daily-usage friction for developers. The most recent completed project, `2026-09-15-global-agent-launcher`, shipped the `ai-insights agent` command this plan fixes; its synthesis reported all acceptance criteria met and all follow-up items resolved, with no mention of a working-directory issue — this is a newly discovered regression against a just-shipped feature, not a carried-forward synthesis action item. No stored knowledge-base insight describes this code path, so `## Knowledge Base Reconciliation` is omitted below.

## Summary

`ai-insights agent` (and the interactive menu's "Launch an agent" entry) silently discards the user's actual terminal working directory before launching `claude --agent <id>`, so the resulting Claude Code session always operates against the `ai-insights` workspace root instead of whatever project directory the user invoked the command from. This plan fixes the incorrect call site, and does so by introducing a small named accessor — `scripts/lib/original-cwd.js` — that captures the invoking terminal's directory once at process start and exposes it via `getOriginalCwd()`, so both ends of the process chain (`cmdAgent`'s delegation and `launch-agent.js`'s `spawn('claude', ...)` call) request it explicitly instead of relying on an unlabelled default. A regression test covers both the accessor and the fixed call site, and a one-line documentation clarification makes the command's working-directory contract explicit to users.

## Architectural Context

`scripts/cli.js` is the single entry point for both the globally linked `ai-insights` binary (`package.json` → `bin.ai-insights`) and the `./menu.sh` interactive wrapper. Every subcommand is wired through a `cmdX(args)` delegate function that calls the shared `runScript()` helper (from `@mistralys/cli-menu`, a thin `spawnSync` wrapper) to run the corresponding script under `scripts/` as a child process. All existing `cmdX` delegates pass `{ cwd: WORKSPACE_ROOT }` to `runScript()`, because every one of their downstream scripts (persona builders, ledger importers, changelog tooling, etc.) operates on the `ai-insights` workspace's own files and must resolve workspace-relative paths correctly regardless of where the user's shell happened to be.

`cmdAgent` (`scripts/cli.js` L357–360) was added by the `2026-09-15-global-agent-launcher` project and copy-pasted the same `{ cwd: WORKSPACE_ROOT }` pattern. But its downstream script, `scripts/launch-agent.js`, is structurally different from every sibling: after discovering and picking a persona, it hands off to a *second* child process — `claude --agent <id>`, spawned via `child_process.spawn('claude', [...], { stdio: 'inherit' })` with no explicit `cwd`, so it inherits `launch-agent.js`'s own `process.cwd()`. Because `cmdAgent` forced that intermediate process's `cwd` to `WORKSPACE_ROOT`, the launched `claude` session always starts in the `ai-insights` repository, not the user's actual project — even when the user ran the globally linked `ai-insights agent` command from an entirely different directory.

## Approach / Architecture

Introduce a small, single-purpose accessor module, `scripts/lib/original-cwd.js`, that captures `process.cwd()` once at module-load time (the earliest point in any `ai-insights` process's lifetime, before any command logic runs) and exposes it via `getOriginalCwd()`. Both ends of the two-process chain that currently loses the user's directory then request it explicitly through this shared module instead of relying on an unlabelled default:

- `scripts/cli.js`'s `cmdAgent` passes `{ cwd: getOriginalCwd() }` to `runScript()` in place of the incorrect `{ cwd: WORKSPACE_ROOT }` — so the intermediate `launch-agent.js` process starts in the directory the user actually invoked `ai-insights` from (or `WORKSPACE_ROOT`, correctly, when invoked via `./menu.sh`, which already `cd`s there at the shell level before `node scripts/cli.js` even starts — a no-op change for that entry point).
- `scripts/launch-agent.js`'s `spawn('claude', ...)` call passes `{ cwd: getOriginalCwd() }` — read from the same module, now imported into this second process — instead of omitting `cwd` and relying on Node's implicit "inherit the caller's `process.cwd()`" default.

No other `cmdX` delegate in `scripts/cli.js` is touched: every one of them correctly needs `WORKSPACE_ROOT`, since their downstream scripts operate on this workspace's own files rather than handing off to a further user-facing process.

## Rationale

The bug is a copy-paste-origin defect: `cmdAgent` inherited the `{ cwd: WORKSPACE_ROOT }` pattern from sibling commands without accounting for the fact that its downstream script spawns a *further* interactive process meant to operate on the user's project, not on the `ai-insights` workspace. A minimal fix that simply omits the `cwd` option (relying on Node's implicit default to carry the correct value through both process hops) would work today, but it encodes the fix as an absence — nothing at either call site signals that cwd correctness here is load-bearing, or why. A dedicated accessor makes the intent explicit and named at both ends of the chain, matches this workspace's own established `scripts/lib/*.js` convention for exactly this shape of extraction (see Pattern Alignment), and gives the two consumers (`cmdAgent`, `launch-agent.js`) a single, testable source of truth rather than each depending on an implicit runtime default independently.

**Clarification on the two call-site edits:** only `cmdAgent`'s forced `{ cwd: WORKSPACE_ROOT }` is the actual root cause of the reported bug. Once that override is corrected, `launch-agent.js`'s own `process.cwd()` already reflects the user's real directory (inherited from the now-fixed parent process), so its `spawn('claude', ...)` call — which never set an explicit `cwd` — already resolves correctly today via Node's own "inherit the caller's `process.cwd()`" default, with no further code change required for the bug itself to be fixed. The second edit (explicitly setting `cwd: getOriginalCwd()` on that `spawn()` call) is deliberate hardening — naming an invariant that was previously carried only by an unlabelled implicit default — not an independent bug fix. This plan proceeds with both edits regardless (see Approach / Architecture and Detailed Steps 2), but the distinction matters: this is a one-bug-fix-plus-one-defensive-hardening change, not a fix for two independent defects.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|--------------------------|--------------------|
| Where to fix the cwd loss | New `scripts/lib/original-cwd.js` module exporting `getOriginalCwd()`, consumed explicitly by both `cmdAgent` (`scripts/cli.js`) and the `spawn('claude', ...)` call (`scripts/launch-agent.js`) | (a) Omit the `cwd` option at both call sites and rely on Node's implicit "inherit caller's cwd" default, guarded only by an inline comment against regression; (b) capture the user's original cwd in an env var before the `runScript()` call and have `launch-agent.js` read it back; (c) pass the original cwd as a CLI flag to `launch-agent.js` | (a) works today but encodes the fix as an absence — an implicit default with a comment is exactly the shape that let the original bug go unnoticed, and a comment offers no compile-time or test-time enforcement beyond what a reviewer happens to read. (b) and (c) add an indirect plumbing mechanism (env var or flag) to carry a value that is already correctly present in both processes' own `process.cwd()` — unnecessary indirection for a same-machine, same-invocation process chain with no intervening `chdir()` anywhere in this codebase (confirmed by the Research Brief). The chosen shape is the only option that gives the value a name, a single definition, and two explicit call sites — consistent with how `scripts/lib/claude-cli.js`, `scripts/lib/frontmatter.js`, and `scripts/lib/npm-link.js` were each extracted for the same reason: a value or predicate needed by more than one file, named once. |
| Regression test strategy | Static source-text assertion against `scripts/cli.js`'s `cmdAgent` function body (new `scripts/tests/cli-cmd-agent.test.js`) plus a direct unit test of `getOriginalCwd()` (new `scripts/tests/original-cwd.test.js`) | (a) End-to-end integration test: spawn `node scripts/cli.js agent` from a temp directory with a faked `claude` executable on `PATH` and assert the observed cwd; (b) Testable-extraction refactor: guard `scripts/cli.js`'s unconditional `createMenu(...)` call (L1267–1269) behind a run-as-entry-point check and export `cmdAgent` (or a pure cwd-resolution helper) so it can be unit-tested via direct import, mirroring why `scripts/tests/launch-agent.test.js` already imports only from `scripts/lib/launch-agent-core.js` and never from `scripts/launch-agent.js` itself | (a) is more thorough but requires a platform-specific fake executable (POSIX shell script vs. Windows `.cmd`), which this workspace's Cross-Platform Policy (`AGENTS.md`) requires to behave identically across Windows/macOS/Linux, and for which no shared test helper exists in this repo. (b) would let `cmdAgent` graduate to a real behavioral unit test, but is a workspace-wide entry-point contract change — `scripts/cli.js` currently has zero exports and calls `createMenu(...)` unconditionally at module scope — and Node's main-module-detection checks are a known gotcha under the npm-linked `bin` shim's symlink resolution; that risk and blast radius are out of proportion to this narrowly-scoped bug-fix plan, so it is rejected here (see Out of Scope) though it remains a legitimate future direction. The two-part static/unit approach directly covers both halves of the fix — the accessor returns the right value, and the call site actually uses it — and is trivially cross-platform, at the cost of not exercising the full process chain (mitigated by manual verification, step 5) and of being the first test in `scripts/tests/` to assert against source text rather than imported, executed logic; it is accepted specifically because `cli.js`'s entry point is not import-safe today, not because no better test shape exists in the abstract. |

## Pattern Alignment

- `scripts/lib/original-cwd.js` follows this workspace's own established `scripts/lib/*.js` convention for small, single-purpose, cross-file-consumed helpers — the exact shape already documented in `AGENTS.md` → "Root-Level Tooling" for `scripts/lib/claude-cli.js` ("Shared '...' predicate... consumed by `install-mcp-global.js` and `scripts/launch-agent.js`"), `scripts/lib/frontmatter.js`, and `scripts/lib/npm-link.js` — each extracted once a value or predicate gained a second consumer, exactly the situation here (`cmdAgent` and `launch-agent.js`'s `spawn()` call).
- The module's "compute once at load time, store as a constant, expose via getter" shape mirrors `scripts/cli.js`'s own `const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');` (L61) — this plan introduces no new pattern, only extends an already-established one to a second, cross-file-shared constant.
- Follows the existing `cmdX(args) { const code = runScript(...); if (code !== 0) process.exit(code); }` delegation shape used by every other command in `scripts/cli.js` — this plan changes only the `options` object passed to `runScript()` inside `cmdAgent`, not the function's overall shape.
- Follows `scripts/tests/<subject>.test.js` + Vitest `describe`/`it`/`expect` naming and structure, matching every existing file in `scripts/tests/`.
- Departure: `scripts/tests/cli-cmd-agent.test.js` is the first test in `scripts/tests/` that asserts against `scripts/cli.js`'s source text rather than importing and calling exported logic. This departure is necessary because `scripts/cli.js`'s `cmdX` functions are not exported for import (confirmed: no `export` statements in the file for these delegates); `scripts/tests/original-cwd.test.js`, by contrast, needs no such departure — it imports and calls `getOriginalCwd()` directly, following the same pattern as every other `scripts/lib/*.js` test.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `scripts/cli.js` → `cmdAgent` | Copy-pasted `{ cwd: WORKSPACE_ROOT }` from sibling `cmdX` delegates without accounting for `launch-agent.js`'s further process hand-off | Promoted to step 2 | Root cause of the reported bug |
| `scripts/launch-agent.js` → `main()`'s `spawn('claude', ...)` call | Relies on an unlabelled implicit default (`process.cwd()` inherited silently) for a value that is load-bearing to the whole feature working correctly | Promoted to step 2 | Making the value explicit, sourced from the new shared accessor, removes the implicit assumption that let the bug go unnoticed in the first place |

## Detailed Steps

1. **Create the shared accessor** — add `scripts/lib/original-cwd.js`: a module-level `const ORIGINAL_CWD = process.cwd();` (captured at import time, before any command logic runs) plus a single named export, `getOriginalCwd()`, returning it. Include a file-header docstring explaining why the module exists (per Rationale) and which two files consume it.
2. **Fix the root cause** — in `scripts/cli.js`, import `getOriginalCwd` from `./lib/original-cwd.js` near the top of the file (alongside the other imports, so capture happens immediately at process start), and change `cmdAgent` (L357–360) to call `runScript('node', [path.join(SCRIPTS_DIR, 'launch-agent.js'), ...args], { cwd: getOriginalCwd() })` in place of `{ cwd: WORKSPACE_ROOT }`. In `scripts/launch-agent.js`, import the same `getOriginalCwd` and change the `spawn('claude', ['--agent', selectedId, ...passthroughArgs], { stdio: 'inherit' })` call to `spawn('claude', ['--agent', selectedId, ...passthroughArgs], { stdio: 'inherit', cwd: getOriginalCwd() })`.
3. **Add the regression tests**:
   - `scripts/tests/original-cwd.test.js` — imports `getOriginalCwd` from `scripts/lib/original-cwd.js` and asserts it returns a string equal to `process.cwd()` at the time of the assertion (the module is imported once per test run, before any `chdir` could occur — matching real-world usage), and that repeated calls return the identical (referentially stable) value.
   - `scripts/tests/cli-cmd-agent.test.js` — reads `scripts/cli.js`'s source text, extracts the `cmdAgent` function body via a regex bounded to `function cmdAgent(...) { ... }`, and asserts: (a) the extracted body contains `getOriginalCwd()`; (b) it does **not** contain `WORKSPACE_ROOT`; (c) it still calls `runScript(...)` with `launch-agent.js` in its argument list (so the test fails loudly, rather than vacuously passing, if the delegate is ever renamed or restructured). A parallel assertion over `scripts/launch-agent.js`'s source text confirms its `spawn('claude', ...)` call also contains `getOriginalCwd()`.
4. **Clarify the documentation**:
   - `docs/references/menu-guide.md` — extend the `agent` row's description (L45) to note that the command operates relative to the terminal's current working directory, e.g.: "Pick a deployed persona from a type-to-filter list and launch it with `claude --agent`, from your current directory."
   - `AGENTS.md` → "Root-Level Tooling" table — add a row for `scripts/lib/original-cwd.js` following the exact structure of the `scripts/lib/claude-cli.js` / `scripts/lib/frontmatter.js` / `scripts/lib/npm-link.js` rows (purpose, exports, named consumers). Then run `node scripts/cli.js ctx-generate` to propagate the edit into `CLAUDE.md` and the `.context/` snapshots — never hand-edit `CLAUDE.md` directly.
5. **Manually verify the fix** — after `npm link` (or via `node scripts/cli.js agent` directly), run the command from a directory outside the `ai-insights` workspace (e.g. `cd /tmp && ai-insights agent --filter <a-persona-name>` in an environment where `claude` is on `PATH`), select a persona, and confirm the launched Claude Code session's working directory is `/tmp` (or wherever it was invoked from), not the `ai-insights` workspace root. Also confirm `./menu.sh agent` is unaffected (still opens in the workspace root). Record both results in the handoff notes.

## Dependencies
- None — this is a self-contained change to already-shipped code within `scripts/`.

## Required Components
- `scripts/lib/original-cwd.js` (new — shared `getOriginalCwd()` accessor)
- `scripts/cli.js` (modified — `cmdAgent` now imports and uses `getOriginalCwd()`)
- `scripts/launch-agent.js` (modified — `spawn()` call in `main()` now imports and uses `getOriginalCwd()`)
- `scripts/tests/original-cwd.test.js` (new — unit test for the accessor)
- `scripts/tests/cli-cmd-agent.test.js` (new — regression test for both call sites)
- `docs/references/menu-guide.md` (modified — `agent` row description)
- `AGENTS.md` (modified — "Root-Level Tooling" table row for the new lib file; propagated to `CLAUDE.md`/`.context/` via `ctx-generate`)

## Assumptions
- The globally linked `ai-insights` binary is the primary way this bug manifests for users (per the user's own report); `./menu.sh agent` is unaffected before and after this fix because `menu.sh` already forces its own `cd` to the workspace root at the shell level, ahead of any Node process starting.
- No other command in `scripts/cli.js` shares this bug — confirmed by the Research Brief's review of every `cmdX` delegate, all of which correctly operate on workspace-local files and correctly need `cwd: WORKSPACE_ROOT`.

## Constraints
- The fix must remain cross-platform per `AGENTS.md` → 🖥️ Cross-Platform Policy: no OS-specific path or shell assumptions are introduced (the new accessor and both of its call sites use only `process.cwd()`, which is cross-platform).
- The regression test must not depend on a live `claude` binary being installed or on any network/filesystem state outside the repository itself, consistent with every other test in `scripts/tests/`.

## Out of Scope
- Any change to how `~/.claude/agents/` is discovered, filtered, or displayed (`scripts/lib/launch-agent-core.js`) — verified in the Research Brief to have no cwd dependency and is not implicated in this bug.
- Any change to the other `cmdX` delegates in `scripts/cli.js` — all verified correct and unaffected.
- Broader refactor of the shared `runScript()` helper (owned by the external `@mistralys/cli-menu` package, out of this repo's control) — not needed since the bug is a misuse of the helper's options at one call site, not a defect in the helper itself.
- Adding an actual `process.chdir()`-based "restore" function (e.g. temporarily `chdir` elsewhere, then restore) to `scripts/lib/original-cwd.js` — no code in this repository currently calls `process.chdir()` anywhere (confirmed in the Research Brief), so such a function would have no current consumer and no named growth trajectory; `getOriginalCwd()` alone fully satisfies both current consumers' actual need (reading the value, not restoring a mutated process state).
- Migrating `scripts/normalize-ctx-paths.js` or `scripts/lib/store-commands.js` (the only other two root-level files reading `process.cwd()` directly) onto the new accessor — neither hands off to a further interactive process and neither is implicated in this bug; out of the blast radius of this fix.
- Making `scripts/cli.js`'s entry point import-safe (guarding its unconditional `createMenu(...)` call at L1267–1269 behind a run-as-entry-point check, and exporting `cmdAgent` or a pure cwd-resolution helper for direct unit testing) — a legitimate future direction that would let this and future `cmdX` regressions graduate from source-text assertions to real behavioral unit tests, but a workspace-wide entry-point contract change with npm-linked-symlink main-module-detection risk, out of proportion to this narrowly-scoped bug-fix plan (see Considered Alternatives, "Regression test strategy" row).

## Acceptance Criteria

- AC-01: Running `ai-insights agent` (globally linked binary) from any directory outside the `ai-insights` workspace launches `claude --agent <id>` with that same directory as its working directory, not the `ai-insights` workspace root.
- AC-02: Running `./menu.sh` → "Launch an agent" (or `./menu.sh agent`) continues to work exactly as before (unaffected by this fix, since `menu.sh` already sets its own cwd to the workspace root).
- AC-03: `scripts/lib/original-cwd.js` exists, exports `getOriginalCwd()`, and captures `process.cwd()` at module-load time.
- AC-04: `scripts/cli.js`'s `cmdAgent` passes `{ cwd: getOriginalCwd() }` to `runScript()` in place of `{ cwd: WORKSPACE_ROOT }`.
- AC-05: `scripts/launch-agent.js`'s `spawn('claude', ...)` call explicitly sets `cwd: getOriginalCwd()`.
- AC-06: The full `scripts/tests/` Vitest suite (`npm run test:scripts`) passes, including the two new tests.
- AC-07: `docs/references/menu-guide.md`'s `agent` row documents the command's working-directory behavior.
- AC-08: `AGENTS.md` → "Root-Level Tooling" table documents `scripts/lib/original-cwd.js`, and `CLAUDE.md`/`.context/` are regenerated to match.

## Testing Strategy

Unit-level regression coverage via two new Vitest files in `scripts/tests/`, run as part of the existing `npm run test:scripts` suite — consistent with this repository's existing test architecture for `scripts/lib/*.js` helpers (direct import/call) and for `scripts/cli.js`-adjacent code (static source-text assertion, since `cmdX` delegates are not exported). No live `claude` process is faked or spawned, per the Considered Alternatives trade-off. Manual verification (step 5) confirms the actual end-to-end behavior the automated tests cannot practically cover without a cross-platform fake executable.

## Test Plan

- `scripts/tests/original-cwd.test.js` — new file — asserts `getOriginalCwd()` returns a string equal to `process.cwd()` and is referentially stable across repeated calls — covers AC-03.
- `scripts/tests/cli-cmd-agent.test.js` — new file — asserts `cmdAgent`'s function body in `scripts/cli.js`'s source text contains `getOriginalCwd()`, does not contain `WORKSPACE_ROOT`, and still correctly delegates to `launch-agent.js` via `runScript`; a parallel assertion over `scripts/launch-agent.js`'s source text confirms its `spawn('claude', ...)` call also contains `getOriginalCwd()` — covers AC-04 and AC-05.
- Manual verification (plan step 5, recorded in handoff notes) — confirms `claude --agent <id>` is launched with the invoking terminal's actual working directory when run via the globally linked `ai-insights` binary from outside the workspace — covers AC-01.
- Manual verification (plan step 5 variant) — confirms `./menu.sh agent` is unaffected — covers AC-02.
- Full `npm run test:scripts` run (pre-existing suite + the two new tests) — covers AC-06.

## Documentation Updates

- `docs/references/menu-guide.md` — extend the `agent` row's description in the command-reference table to state that the command operates relative to the invoking terminal's current directory. — covers AC-07.
- `AGENTS.md` → "Root-Level Tooling" table — add a row for `scripts/lib/original-cwd.js` (purpose, exports, named consumers), matching the structure of the `scripts/lib/claude-cli.js` / `scripts/lib/frontmatter.js` / `scripts/lib/npm-link.js` rows; then run `node scripts/cli.js ctx-generate` to propagate the edit into `CLAUDE.md` and the `.context/agents.md` snapshot (never hand-edit `CLAUDE.md` directly) — covers AC-08.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **A future contributor re-introduces `cwd: WORKSPACE_ROOT` on `cmdAgent` by copy-pasting a sibling command** | The new regression test (`scripts/tests/cli-cmd-agent.test.js`) fails immediately if `WORKSPACE_ROOT` reappears in `cmdAgent`'s body or `getOriginalCwd()` is removed from either call site; the named accessor and its own dedicated file-header docstring make the intent discoverable without relying on an inline comment being read. |
| **Some other, not-yet-discovered code path also spawns `claude` (or another user-facing interactive tool) with a forced workspace-root `cwd`** | Out of scope per the Research Brief's confirmation that `cmdAgent` is the only `cmdX` delegate whose downstream script hands off to a further interactive process; no other call site matches this shape today. |
| **A future contributor assumes `getOriginalCwd()` also restores a previously-changed `cwd` (given the module's name)**, since no such capability exists | The module's docstring and the plan's Out of Scope entry are explicit: this is a read-only capture-once accessor, not a `chdir`/restore pair — no code in this repository calls `process.chdir()` today, so a restore capability has no current consumer and is deliberately not built speculatively. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** One small new lib module, two call-site edits, two self-contained unit tests, and two documentation edits, entirely within already-understood, already-shipped code — well within the scope of a single standalone developer session with self-review.
