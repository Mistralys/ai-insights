# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.11.0
- Architectural Reviews: none — Plan Architect Reviewer v2.3.4

## Prior Project Context

- **`2026-09-28-agent-picker-resume-entry`** widened the picker's unit from a bare agent id to a *launch entry* carrying its own `claudeArgs`, so that new pinned rows would be data additions rather than spawn-site branches. This plan builds on that seam: a toggle is a new pinned row kind, and its effect on argv is produced by a toggle model, so the spawn site stays branch-free.
- **Strategic vision (short-term):** onboarding and daily use with as little friction as possible. Auto mode currently refuses some ledger MCP calls (one synthesis agent reported a refused synthesis import), and the user has no visible way to tell why. A visible toggle in the launcher removes that friction without forcing the flag on every session.
- **Insight `00b9e901-0229-42dd-a68b-fc90ead7a0be`**: an agent cannot change its own session's permission configuration. That supports putting the control in the launcher, outside the session. This plan does not invalidate the insight.

## Summary

Add a session-scoped **"Skip permission prompts"** toggle to the `ai-insights agent` picker. When it is on, every `claude` launch from the picker (persona or resume) gets `--dangerously-skip-permissions`. The toggle is a pinned row under "Resume a previous session". Pressing Enter on it flips the state in place without launching anything. While the toggle is on, a warning shows on the picker's instructions line, so the state is visible even when a filter query hides the row. The state starts **off** on every `ai-insights agent` invocation and persists across loop-backs within that invocation. It can be seeded on with a new `--skip-permissions` own-flag, or by passing `-- --dangerously-skip-permissions`. The passthrough form is detected and absorbed into the toggle so the flag is never duplicated and can still be switched off. Toggles are defined in a small registry module, so a future toggle (e.g. `--verbose` to diagnose MCP failures) is a data addition.

## Architectural Context

- `scripts/launch-agent.js` — thin entry point. It owns arg parsing (`parseArgs`, private, untested), preflight checks, the picker loop, and `spawn('claude', [...selected.claudeArgs, ...passthroughArgs])`. It contains no test-importable logic, and `main()` runs unconditionally.
- `scripts/lib/launch-agent-core.js` — pure logic plus both picker I/O shells:
  - `SESSION_LAUNCH_ENTRIES` and `buildLaunchEntries(agents)` build the pinned resume row plus the agent rows.
  - `filterEntries`, `firstAgentIndex` (keeps pinned rows from stealing the default cursor), the pure `reducePickerInput`, the pure `renderPickerLines` (with the session/agent divider), and `CHROME_ROWS = 5`.
  - `runInteractivePicker(entries, initialQuery)` and `runNonInteractivePicker(entries, initialQuery, { readlineFactory })` both resolve with the selected entry.
- `scripts/cli.js` — the `agent` menu item (`key: 'a'`, `helpVariants`) and `cmdAgent(args)`, which forwards args verbatim.
- `scripts/tests/launch-agent.test.js` — Vitest unit tests that import only from the core module. `vitest.config.ts` picks up `scripts/tests/**/*.test.{js,ts}`.
- Docs that describe the picker: `README.md` (L76), `docs/references/menu-guide.md` (L45, L97–L98), and the `AGENTS.md` Root-Level Tooling table (rows for `launch-agent.js` and `launch-agent-core.js`).

## Approach / Architecture

1. **Toggle model (new `scripts/lib/launch-toggles.js`).**
   - `LAUNCH_TOGGLES` is a frozen registry of toggle definitions: `{ id: 'skip-permissions', label: 'Skip permission prompts', description, claudeFlag: '--dangerously-skip-permissions', seedFlag: '--skip-permissions', warning: true }`.
   - `LaunchToggles` is a small class holding the enabled-id set for one picker run. Methods:
     - `isOn(id)`
     - `toggle(id)` — throws on an unknown id
     - `toClaudeArgs()` — emits enabled flags in registry order
     - `activeWarnings()` — labels of enabled toggles that have `warning: true`
     - static `fromArgs(ownArgs, passthroughArgs, defs = LAUNCH_TOGGLES)`, which returns `{ toggles, passthroughArgs }`. It seeds a toggle on when its `seedFlag` is in `ownArgs` or its `claudeFlag` is in `passthroughArgs`, and strips that `claudeFlag` from the returned passthrough list.
   - `LaunchToggles` is the single owner of toggle state, created once in `main()` and mutated in place by the pickers across loop iterations.
2. **Toggle rows in the launch-entry list (`launch-agent-core.js`).**
   - `buildLaunchEntries(agents, toggleDefs = [])` emits the session row, then one `{ id: 'toggle:<id>', label, description, kind: 'toggle', toggleId, claudeArgs: [] }` per definition, then the agents.
   - The default `[]` keeps every existing caller and test unchanged. `launch-agent.js` passes `LAUNCH_TOGGLES`.
3. **Pinned-block generalisation.** `renderPickerLines` currently has session-only divider logic. It becomes "pinned (any `kind !== 'agent'`) vs agent", so session and toggle rows form one block above the divider. `firstAgentIndex` already skips every non-agent kind.
4. **Toggle-aware rendering.**
   - `renderPickerLines(state, filtered, maxVisibleRows, toggles = null)` renders toggle rows as `<label>: ON` or `<label>: OFF`, with ON highlighted.
   - While any warning toggle is on, it appends a highlighted `· ⚠ <label> ON` segment to the existing instructions line. This adds no new line, so `CHROME_ROWS` stays at 5.
   - The instructions text reads "Enter launch/toggle".
5. **In-picker toggle action.**
   - Interactive picker: when `action === 'select'` lands on a `kind: 'toggle'` entry, the shell calls `toggles.toggle(entry.toggleId)` and redraws instead of resolving. Query and cursor are kept, so repeated Enter flips back and forth.
   - Non-interactive picker: a number that selects a toggle flips it and reprints the list. The numbered rows show the ON/OFF state, and a warning line is printed while the toggle is on.
   - Both pickers receive the `LaunchToggles` instance as an optional parameter:
     - `runInteractivePicker(entries, initialQuery, toggles)`
     - `runNonInteractivePicker(entries, initialQuery, { readlineFactory, toggles })`
   - When `toggles` is absent and a toggle row is selected, it is ignored (no-op redraw). This keeps the shells safe if called without a toggle model.
6. **Arg parsing extracted and composed (`launch-agent-core.js` + `launch-agent.js`).**
   - `parseArgs` moves into the core module as the exported `parseLaunchArgs(argv)` → `{ filter, ownArgs, passthroughArgs }`, so it becomes testable.
   - `main()` calls `LaunchToggles.fromArgs(ownArgs, passthroughArgs)`.
   - Spawn argv becomes `[...selected.claudeArgs, ...toggles.toClaudeArgs(), ...passthroughArgs]`. The spawn site stays branch-free.
7. **Menu and docs.** Add `['agent --skip-permissions', 'Start with permission prompts skipped']` to `helpVariants`, update the menu description, the README, the menu guide, the `AGENTS.md` tooling table, and a root changelog entry. Regenerate `.context/`.

## Rationale

- **The picker is where the problem is felt.** Auto-mode refusals happen inside long-running agent sessions launched from this picker. Switching the flag on per launch, and seeing that it is on, is exactly what the user asked for. A toggle row also keeps the setting visible instead of hiding it in a passthrough argument.
- **Session-scoped and default OFF.** The flag disables every safety prompt. Starting each `ai-insights agent` invocation in the safe state means the dangerous mode is always a deliberate choice. Keeping the state across loop-backs fits the picker's "switch agents" loop: once switched on for a working session, it stays on until the user leaves the picker or flips it back.
- **A registry, not a single boolean.** This is justified by a named growth path. The picker has already gained one pinned row (resume), and the problem that triggered this plan — invisible MCP failures — points at the next likely toggles: `--verbose`, and an MCP debug flag for diagnosing exactly those failures. With a registry, those are one-object additions with ON/OFF rendering, seeding, and argv emission already in place.
- **A class for `LaunchToggles`.** The state carries behaviour (`toggle`, argv emission, warnings, arg-based seeding) and has one owner whose instance is shared between `main()` and both pickers. A plain object passed around would need every consumer to reimplement those rules.
- **Absorbing the passthrough flag** stops `-- --dangerously-skip-permissions` from creating a hidden, un-toggleable second source of the same flag, and stops it being emitted twice.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Toggle UI | Pinned toggle row activated by Enter, plus a warning on the instructions line | (a) Hotkey such as Tab / Ctrl+key; (b) separate "options" sub-screen; (c) a duplicate "launch with skip-permissions" row per persona | Every printable key already feeds the filter query, and a hotkey cannot be discovered or used in the readline fallback. A sub-screen adds navigation for a single control, and duplicate rows double the list. A pinned row works the same in both pickers and follows the existing pinned-row pattern. |
| State lifetime | Per `ai-insights agent` invocation, default OFF, survives loop-backs | (a) Persisted in a local config file; (b) reset after every launch | Persisting a "skip all permission prompts" setting risks leaving it on unnoticed across days. Resetting after every launch makes long sessions with several agents tedious. Per-invocation is the safe middle ground. |
| Where the flag is applied | Appended to every launch's argv, including `--resume` | Only persona launches | Resumed sessions run the same ledger workflows and hit the same refusals. `claude --resume --dangerously-skip-permissions` is a valid combination. |
| Fixing the root cause instead | Toggle (user request) | Allow-list `mcp__central_pm__*` in Claude Code permission settings | An allow-list is narrower, but auto mode's classifier decisions are not under this workspace's control. Settings can't be edited from inside a session (insight `00b9e901-…`), and the user explicitly asked for a toggle. Recorded as Out of Scope rather than rejected outright. |
| Toggle model placement | New `scripts/lib/launch-toggles.js` | Inline in `launch-agent-core.js` (412 lines) | Toggle state is a separate concern from discovery and rendering, and a dedicated module keeps the core file focused and the model independently testable. |

## Pattern Alignment

- **Follows** the launch-entry-carries-its-argv pattern (`scripts/lib/launch-agent-core.js` L38–L43). Toggle argv comes from `toggles.toClaudeArgs()`, and the spawn site in `scripts/launch-agent.js` still does not switch on entry kind.
- **Follows** the pure render/reducer plus I/O shell split (`scripts/lib/launch-agent-core.js` L143–L146). Toggle rendering lives in the pure `renderPickerLines`, and toggle mutation happens only in the shells.
- **Follows** the `scripts/lib/*.js` no-`main()` module shape (`scripts/lib/launch-agent-core.js` L4–L9) for the new `launch-toggles.js`.
- **Follows** `opts`-based test injection (`readlineFactory`, L369–L375) by adding `toggles` to the same options bag.
- **Deliberate departure:** `reducePickerInput` stays untouched, but the shells now have a `select` outcome that does not resolve (toggle rows). This is justified because a toggle is an in-picker action by nature, and keeping it out of the reducer preserves the reducer's existing tests and contract.
- **Deliberate departure:** the module uses a class (`LaunchToggles`), while the other `scripts/lib` modules are plain functions. This is justified by the shared mutable state with behaviour and a single owner (see Rationale). Every other new export stays a plain function.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `scripts/lib/launch-agent-core.js` → `renderPickerLines()` divider logic | Hard-coded to `kind === 'session'`, so a second pinned kind would render below the divider or break divider placement | Promoted to step 3 | The toggle row needs it. Generalising to "pinned vs agent" makes any future pinned row work with no further render changes. |
| `scripts/launch-agent.js` → private `parseArgs()` | Untestable, because the file runs `main()` on import. This plan adds a second own-flag and passthrough absorption to it | Promoted to step 4 | Growing untested parsing logic is the exact case the core/shell split exists to prevent. Moving it into the core module makes it testable at no extra cost. |
| `scripts/lib/launch-agent-core.js` → picker shells' "select always resolves" contract | No notion of an in-picker action | Promoted to step 5 | Required for the toggle. Implemented as a narrow kind check in the shells rather than a general action framework, because toggles are the only in-picker action and a general framework would have no second consumer. |
| `scripts/lib/launch-agent-core.js` → `SESSION_LAUNCH_ENTRIES` | Single pinned block, already designed for data additions | Rejected | Already the right shape. Toggle rows come from the registry, not from this array, because their label depends on runtime state. |

## Detailed Steps

1. **Create `scripts/lib/launch-toggles.js` (new).**
   - Export a frozen `LAUNCH_TOGGLES` array with the `skip-permissions` definition: `id: 'skip-permissions'`, `label: 'Skip permission prompts'`, `description` mentioning `--dangerously-skip-permissions` and that it applies to every launch from this picker, `claudeFlag: '--dangerously-skip-permissions'`, `seedFlag: '--skip-permissions'`, `warning: true`.
   - Export class `LaunchToggles`:
     - constructor `(defs = LAUNCH_TOGGLES, enabledIds = [])` — rejects unknown ids
     - `isOn(id)`
     - `toggle(id)` — throws `Error` on an unknown id; returns the new boolean
     - `toClaudeArgs()` — registry order, enabled only
     - `activeWarnings()` — labels of enabled `warning: true` defs
     - `get definitions()`
     - `static fromArgs(ownArgs, passthroughArgs, defs = LAUNCH_TOGGLES)` → `{ toggles, passthroughArgs }`, which seeds from `seedFlag` in own args or `claudeFlag` in passthrough and removes every occurrence of each seeded `claudeFlag` from the returned passthrough array without mutating the input.
   - Add a module docstring explaining the registry and the growth path.
2. **Extend `buildLaunchEntries` in `scripts/lib/launch-agent-core.js`.**
   - The new signature is `buildLaunchEntries(agents, toggleDefs = [])`.
   - Insert one toggle entry per def between the session entries and the agents: `{ id: 'toggle:' + def.id, label: def.label, description: def.description, kind: 'toggle', toggleId: def.id, claudeArgs: [] }`.
   - Update the JSDoc `kind` union to `'session'|'toggle'|'agent'`.
3. **Generalise the pinned block and add toggle rendering in `renderPickerLines`.**
   - Replace `hasBothKinds` with `hasPinnedAndAgents`, where pinned means `kind !== 'agent'`. Update the trailing-divider branch the same way.
   - Add an optional 4th parameter `toggles` (a `LaunchToggles` or `null`):
     - toggle rows render as `${label}: ON` (ON in a highlight colour from `C`) or `${label}: OFF` (dim)
     - when `toggles` is null, a toggle row renders as `${label}: OFF`
   - The instructions line becomes `'  Type to filter · ↑/↓ navigate · Enter launch/toggle · Esc/Ctrl+C cancel'`. While `toggles.activeWarnings()` is non-empty, append `' · ⚠ ' + warnings.join(', ') + ' ON'` in a highlight colour. Do not add any new line, so `CHROME_ROWS` stays 5.
   - Update the docstrings for `CHROME_ROWS` and `renderPickerLines` to say "pinned block" instead of "session row".
4. **Extract arg parsing.**
   - Move `parseArgs` from `scripts/launch-agent.js` into `scripts/lib/launch-agent-core.js` as the exported `parseLaunchArgs(argv)` → `{ filter, ownArgs, passthroughArgs }`, keeping today's `--filter <term>` and `--` semantics.
   - Remove the private copy from `launch-agent.js`.
5. **Make both picker shells toggle-aware.**
   - `runInteractivePicker(entries, initialQuery = '', toggles = null)`: on `action === 'select'`, if `filtered[state.cursor]?.kind === 'toggle'`, call `toggles?.toggle(entry.toggleId)` and `draw()`, then return without cleanup. Otherwise keep the current behaviour. Pass `toggles` to `renderPickerLines` in `draw()`.
   - `runNonInteractivePicker(entries, initialQuery = '', { readlineFactory, toggles = null } = {})`: print toggle rows as `[n] Label: ON|OFF`, and print `  ⚠ <warnings> ON` above the prompt while any warning toggle is on. A number selecting a toggle row flips it and continues the loop without resolving. Keep the current filter.
   - Update both docstrings.
6. **Wire `scripts/launch-agent.js`.**
   - Import `parseLaunchArgs` and `LaunchToggles`/`LAUNCH_TOGGLES`.
   - In `main()`: `const { filter, ownArgs, passthroughArgs: rawPassthrough } = parseLaunchArgs(process.argv.slice(2)); const { toggles, passthroughArgs } = LaunchToggles.fromArgs(ownArgs, rawPassthrough);`
   - Build entries with `buildLaunchEntries(agents, LAUNCH_TOGGLES)`, and pass `toggles` to both pickers.
   - Spawn with `[...selected.claudeArgs, ...toggles.toClaudeArgs(), ...passthroughArgs]`.
   - Update the header docstring (usage gains `node scripts/launch-agent.js --skip-permissions`) and the launch-entry paragraph to mention toggle rows.
7. **Update `scripts/cli.js`.**
   - In the `agent` menu item, add `['agent --skip-permissions', 'Start with permission prompts skipped']` to `helpVariants`.
   - Change `description` to `'Launch a persona with Claude Code, or resume a session (permission toggle)'`, or equivalent wording within the existing style.
8. **Tests.**
   - Add the new `scripts/tests/launch-toggles.test.js`.
   - Extend `scripts/tests/launch-agent.test.js` per the Test Plan.
   - Run `npx vitest run scripts/tests` and confirm everything is green.
9. **Documentation** per the Documentation Updates section, then regenerate `.context/` with `node scripts/cli.js ctx-generate`.

## Dependencies

- Steps 2–5 depend on step 1, since they reference the `LaunchToggles` API and the definition shape.
- Step 6 depends on steps 1, 2, 4 and 5.
- Step 8 depends on steps 1–6. Step 9 depends on steps 6–7, because the docs describe the final flags.
- No new npm dependencies. Colours come from `C` in `@mistralys/cli-menu`, which is already imported.

## Required Components

- `scripts/lib/launch-toggles.js` — **new**
- `scripts/lib/launch-agent-core.js` — modified
- `scripts/launch-agent.js` — modified
- `scripts/cli.js` — modified
- `scripts/tests/launch-toggles.test.js` — **new**
- `scripts/tests/launch-agent.test.js` — modified
- `README.md`, `docs/references/menu-guide.md`, `AGENTS.md`, `changelog.md` — modified
- `.context/` — regenerated

## Assumptions

- `claude` accepts `--dangerously-skip-permissions` together with both `--agent <id>` and `--resume`.
- On first use, Claude Code may show its own one-time bypass-permissions acceptance dialog inside the launched session. That dialog belongs to Claude Code's TUI and needs no handling here.
- `C.yellow` from `@mistralys/cli-menu` (verified in `node_modules/@mistralys/cli-menu/dist/index.d.cts`) is the highlight colour for the ON state and the warning segment.

## Constraints

- The toggle is off by default on every `ai-insights agent` invocation. Nothing persists it to disk.
- `CHROME_ROWS` must not grow. The warning reuses the instructions line.
- Pinned rows (session and toggle) must never receive the default cursor (`firstAgentIndex`).
- Cross-platform policy: Node built-ins only, and no shell-specific behaviour.
- `reducePickerInput` keeps its current signature and behaviour.

## Out of Scope

- Persisting the toggle across invocations, or a global config file for launcher preferences.
- Allow-listing `mcp__central_pm__*` (or other ledger tools) in Claude Code permission settings as a narrower fix for auto-mode refusals.
- Other permission modes (`--permission-mode plan/acceptEdits`), and additional toggles such as `--verbose`. The registry makes these one-object additions for a later plan.
- Investigating why auto mode refuses specific ledger MCP calls.
- A toggle in the VS Code or orchestrator launch paths.

## Acceptance Criteria

- AC-01: `LaunchToggles` defaults every registered toggle to off, `toggle(id)` flips state and returns the new value, `toClaudeArgs()` emits `--dangerously-skip-permissions` only when `skip-permissions` is on, and `toggle()` with an unknown id throws.
- AC-02: `LaunchToggles.fromArgs()` seeds `skip-permissions` on from `--skip-permissions` in own args or `--dangerously-skip-permissions` in passthrough args, and returns a passthrough array with that flag removed (input not mutated). Unrelated passthrough args are preserved in order.
- AC-03: `buildLaunchEntries(agents, LAUNCH_TOGGLES)` returns the session row, then one `kind: 'toggle'` row with `claudeArgs: []`, then the agents. `buildLaunchEntries(agents)` (no defs) returns exactly the pre-change list.
- AC-04: `renderPickerLines` renders a toggle row as `<label>: OFF`/`<label>: ON` according to the passed `LaunchToggles`, groups session and toggle rows above a single divider, and keeps `lines.length <= maxVisibleRows + CHROME_ROWS`. `CHROME_ROWS` stays `5`.
- AC-05: While `skip-permissions` is on, the instructions line contains a `⚠` warning naming the toggle, and the warning is present even when the filtered list excludes the toggle row. While it is off, no warning is rendered.
- AC-06: In `runNonInteractivePicker`, selecting the toggle row's number flips the toggle and re-prompts without resolving, and a subsequent agent selection resolves with that agent entry.
- AC-07: In `runInteractivePicker`, Enter on a toggle row flips the toggle and redraws without resolving or exiting raw mode. Enter on any other row resolves exactly as before.
- AC-08: `parseLaunchArgs` returns `filter`, `ownArgs` and `passthroughArgs` with unchanged `--filter <term>` and `--` semantics.
- AC-09: `scripts/launch-agent.js` spawns `claude` with `[...selected.claudeArgs, ...toggles.toClaudeArgs(), ...passthroughArgs]`, so `--dangerously-skip-permissions` appears exactly once when on (including when seeded via passthrough) and never when off. Toggle state persists across picker loop-backs within one invocation.
- AC-10: `firstAgentIndex` still places the default cursor on the first agent when toggle rows are present.
- AC-11: All existing tests in `scripts/tests/launch-agent.test.js` pass unchanged, or with only additive changes, and the full `scripts/tests` suite is green.
- AC-12: `scripts/cli.js` lists `agent --skip-permissions` in the `agent` item's `helpVariants`. `README.md`, `docs/references/menu-guide.md`, the `AGENTS.md` Root-Level Tooling table and the root `changelog.md` describe the toggle, and `.context/` is regenerated.

## Testing Strategy

Unit tests cover the pure pieces: the toggle model, entry building, rendering, arg parsing and cursor seeding. The non-interactive picker gets behavioural tests through the existing stub readline factory. The raw-mode interactive picker can't be driven by the current tests, so it is covered by:

- (a) moving every decision it makes into pure, tested functions (render with toggles, entry kind)
- (b) a focused test that emits synthetic `keypress` events on `process.stdin`. This is only possible if the shell can run with raw mode stubbed. Otherwise, a documented manual check in the implementation summary.

The spawn composition in `launch-agent.js` is one line built only from tested parts. It is verified by inspection and a manual smoke run (`ai-insights agent`, toggle on, launch a persona, confirm the session starts in bypass mode).

## Test Plan

- `scripts/tests/launch-toggles.test.js` (new) — `LaunchToggles` defaults off, `isOn`, `toggle` flip/return value, `toClaudeArgs` empty vs `['--dangerously-skip-permissions']`, unknown-id `toggle` throws, constructor rejects unknown enabled ids — AC-01
- `scripts/tests/launch-toggles.test.js` (new) — `activeWarnings()` empty when off, `['Skip permission prompts']` when on — AC-05
- `scripts/tests/launch-toggles.test.js` (new) — `fromArgs` seeds from `--skip-permissions` own arg; seeds from passthrough `--dangerously-skip-permissions` and strips it (all occurrences); keeps unrelated passthrough args in order; does not mutate input arrays; leaves the toggle off with no seeds — AC-02, AC-09
- `scripts/tests/launch-toggles.test.js` (new) — the composed argv `[...['--agent','x'], ...toggles.toClaudeArgs(), ...passthroughArgs]` built from `fromArgs([], ['--dangerously-skip-permissions','--verbose'])` contains the flag exactly once — AC-09
- `scripts/tests/launch-agent.test.js` → `buildLaunchEntries()` — new case: with `LAUNCH_TOGGLES`, index 1 is `{ id: 'toggle:skip-permissions', kind: 'toggle', toggleId: 'skip-permissions', claudeArgs: [] }` and agents follow; the existing no-defs cases are unchanged — AC-03
- `scripts/tests/launch-agent.test.js` → `firstAgentIndex()` — new case: session + toggle + agents returns 2; toggle-only list returns 0 — AC-10
- `scripts/tests/launch-agent.test.js` → `renderPickerLines()` — new cases: toggle row shows `: OFF`/`: ON` per a `LaunchToggles` instance; with session + toggle + agents exactly one divider appears, after the toggle row; toggle-plus-session-only list renders no divider; budget-1 case still bounded by `1 + CHROME_ROWS`; `CHROME_ROWS === 5` — AC-04
- `scripts/tests/launch-agent.test.js` → `renderPickerLines()` — new cases: warning segment with `⚠` present on line 2 when on, including when `filtered` contains only agent rows; absent when off or `toggles` null — AC-05
- `scripts/tests/launch-agent.test.js` → `runNonInteractivePicker()` — new case: entries built with `LAUNCH_TOGGLES`, answers `['2', '3']`, toggles passed: the toggle is on afterwards and the result is the first agent entry; new case: answers `['2', '2', '']` leaves the toggle off and resolves null — AC-06
- `scripts/tests/launch-agent.test.js` → `runInteractivePicker()` (new describe) — with `isTTY`/raw mode stubbed via `vi.spyOn` on `process.stdin.setRawMode` and stdout writes, emit `keypress` down + return on the toggle row and assert the promise is still pending and the toggle is on; then emit return on an agent row and assert it resolves with that entry. If raw mode cannot be stubbed reliably, record the manual verification in the implementation summary instead — AC-07
- `scripts/tests/launch-agent.test.js` → `parseLaunchArgs()` (new describe) — `[]`, `['--filter','plan']`, `['--skip-permissions','--','--x']`, `['--','--filter','y']` (filter after `--` is passthrough) — AC-08
- Full suite: `npx vitest run scripts/tests` green, with existing assertions unmodified — AC-11
- Manual smoke check of the spawn wiring (toggle on → launched session runs with permissions bypassed; toggle off after loop-back → normal prompts) recorded in the implementation summary — AC-09
- Doc check: grep for `--skip-permissions` in `scripts/cli.js`, `README.md`, `docs/references/menu-guide.md`, `AGENTS.md`, `changelog.md`, and confirm `.context/scripts.md` contains `launch-toggles.js` — AC-12

## Documentation Updates

- `README.md` (L76 paragraph) — mention the pinned "Skip permission prompts" toggle: off by default, applies to every launch from the picker while on, and why it exists (auto mode can silently refuse ledger MCP calls).
- `docs/references/menu-guide.md` (L45 "Launch an agent" row) — describe the toggle row, Enter-to-toggle, the instructions-line warning, and per-invocation lifetime. In the Examples block (L97–L98), add `./menu.sh agent --skip-permissions   # start the picker with permission prompts skipped` and note that `-- --dangerously-skip-permissions` is absorbed into the toggle.
- `AGENTS.md` → Root-Level Tooling table:
  - add a row for `scripts/lib/launch-toggles.js` (exports `LAUNCH_TOGGLES` and `LaunchToggles`)
  - update the `scripts/lib/launch-agent-core.js` row (`buildLaunchEntries(agents, toggleDefs)`, `parseLaunchArgs`, toggle-aware `renderPickerLines` and pickers)
  - update the `scripts/launch-agent.js` row (toggle state ownership, `--skip-permissions`)
- `changelog.md` (root) — new top entry `## v2.16.0 - Agent Picker Permission Toggle` with house-style bullets, e.g. `- CLI: Agent picker gained a toggle to launch Claude with permission prompts skipped.` No module blockquote, since no module changed. The root `package.json` version follows via `syncRootVersion()` during `build-maintain`. Running it is part of release preparation and is not required for this plan.
- `.context/` — regenerate with `node scripts/cli.js ctx-generate` (covers `.context/scripts.md` and `.context/agents.md`).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **User leaves skip-permissions on unintentionally** | Default OFF per invocation, no persistence, a persistent `⚠` warning on the instructions line whenever on (visible even when the row is filtered out), and the toggle row shows ON in a highlight colour. |
| **Flag duplicated or impossible to switch off when passed via `--`** | `LaunchToggles.fromArgs` absorbs and strips the passthrough flag (AC-02, AC-09). |
| **Organisation policy disables bypass mode (`disableBypassPermissionsMode`)** | Claude Code reports this itself when launched, and the picker loops back as usual. The README note states that the toggle passes the flag but cannot override managed settings. |
| **Existing numbered-selection tests shift** | Toggle rows appear only when `toggleDefs` is passed. Existing tests call `buildLaunchEntries(agents)` and stay valid (AC-11). |
| **Interactive picker regression from the new non-resolving select path** | The kind check is limited to `kind === 'toggle'`, there is a dedicated keypress test or documented manual check, and all other select paths are unchanged (AC-07). |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** The change stays inside the single, well-understood `ai-insights agent` launcher module family, extends a pattern the previous picker plan set up, adds no new architecture beyond a small toggle registry, and a single developer session with self-review and the listed unit tests is sufficient.
