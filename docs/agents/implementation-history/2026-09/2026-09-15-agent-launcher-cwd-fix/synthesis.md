
## Synthesis

### Completion Status
- Date: 2026-09-15
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Research brief: used
- Archived in Ledger: 2026-09-15

### Outcome Summary

`ai-insights agent`'s working-directory bug is fixed: `scripts/cli.js`'s `cmdAgent` no longer forces the intermediate `launch-agent.js` process's `cwd` to the workspace root, so the launched `claude --agent <id>` session now starts in the directory the user actually invoked the command from. The fix introduces a small shared accessor, `scripts/lib/original-cwd.js`, consumed explicitly by both ends of the two-process hand-off, following the plan's approach exactly. Manual end-to-end verification with a temporary fake `claude` executable confirmed both the fix (`ai-insights agent` from an outside directory) and the non-regression (`./menu.sh agent` unaffected).

### Implementation Summary
- Added `scripts/lib/original-cwd.js`, exporting `getOriginalCwd()`, which captures `process.cwd()` once at module-load time and documents why both call sites need it.
- Fixed the root cause: `scripts/cli.js`'s `cmdAgent` now passes `{ cwd: getOriginalCwd() }` to `runScript()` instead of `{ cwd: WORKSPACE_ROOT }`.
- Applied the companion hardening edit: `scripts/launch-agent.js`'s `spawn('claude', ...)` call now explicitly sets `cwd: getOriginalCwd()` instead of relying on Node's implicit "inherit caller's cwd" default.
- No other `cmdX` delegate in `scripts/cli.js` was touched — all correctly require `WORKSPACE_ROOT` per the plan's Out of Scope section.

### Documentation Updates
- `docs/references/menu-guide.md` — extended the `agent` row's description to state the command operates relative to the invoking terminal's current directory.
- `AGENTS.md` → "Root-Level Tooling" table — added a row for `scripts/lib/original-cwd.js`, matching the structure of the sibling `scripts/lib/claude-cli.js` / `frontmatter.js` / `npm-link.js` rows. Ran `node scripts/cli.js ctx-generate` to propagate the edit into `CLAUDE.md` and the `.context/` snapshots, rather than hand-editing the generated copies.

### Verification Summary
- Tests run: `npm run test:scripts` (full Vitest suite under `scripts/tests/`, including the two new files `scripts/tests/original-cwd.test.js` and `scripts/tests/cli-cmd-agent.test.js`)
- Static analysis run: none — no lint script or ESLint config exists at the workspace root for `scripts/`; verification relied on the test suite and manual end-to-end checks
- Manual verification: confirmed via a temporary fake `claude` shell script placed ahead of the real binary on `PATH` (not committed — scratchpad-only) — `ai-insights agent` invoked from outside the workspace launched with that outside directory as `cwd` (AC-01); `./menu.sh agent` invoked from the same outside directory still launched with the workspace root as `cwd`, unaffected (AC-02)
- Result: PASS — all acceptance criteria (AC-01 through AC-08) met; full test suite green

### Code Insights

#### Implementation Decisions
- [low] (decision) `scripts/lib/original-cwd.js`: Implemented as a module-level `const` captured at import time with a single `getOriginalCwd()` getter, per the plan's exact specification — deliberately not a `chdir`/restore pair, since no code in this repository calls `process.chdir()` today.
- [low] (decision) `scripts/cli.js` / `scripts/launch-agent.js`: Applied both call-site edits from the plan — the `cmdAgent` fix is the actual root-cause correction; the `launch-agent.js` `spawn()` edit is deliberate defensive hardening naming a previously-implicit invariant, not an independent bug fix (per the plan's Rationale).
- [low] (decision) `scripts/tests/cli-cmd-agent.test.js`: Used a brace-depth-counting body extractor rather than a bounded regex, since a naive non-greedy match risks truncating at the first nested closing brace; also asserted the accessor's `import` statement is present at both call sites so the regression test fails loudly if either import is later removed independently of the function body.
- [low] (decision) Manual verification (plan step 5): Used a temporary fake `claude` shell script on `PATH`, confined to the session scratchpad and cleaned up afterward, instead of a real interactive `claude` session or a committed platform-specific stub — consistent with the plan's Considered Alternatives rejection of a committed fake executable.

### Additional Comments
- All eight acceptance criteria (AC-01 through AC-08) are satisfied and independently demonstrated: AC-01/AC-02 by manual end-to-end verification, AC-03 through AC-06 by the new/passing test suite, AC-07/AC-08 by the documentation edits and successful `ctx-generate` regeneration.
- Per the plan's Out of Scope section, no other `cmdX` delegate, no `scripts/lib/launch-agent-core.js` logic, and no broader `runScript()`/`chdir()` capability were touched.
