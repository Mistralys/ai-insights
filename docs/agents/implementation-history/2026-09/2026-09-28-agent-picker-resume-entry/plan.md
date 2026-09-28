# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.9.3
- Architectural Reviews: 1 (Sonnet 5 ×1) — Plan Architect Reviewer v2.3.3

## Prior Project Context

The repository's declared **short-term strategic vision** is minimising setup and daily-usage friction for developers, which is exactly the axis this change sits on: the agent picker is where the user already is when a Claude Code session ends, and resuming a session currently requires leaving it and typing `claude --resume` by hand.

Two prior projects own this code. `2026-09-15-global-agent-launcher` shipped `ai-insights agent` together with the core/shell split that `scripts/lib/launch-agent-core.js` still follows. `2026-09-15-agent-launcher-cwd-fix` corrected the working-directory hand-off so the spawned `claude` process starts in the user's actual invocation directory, and locked that in with two source-text regression tests. The cwd fix is load-bearing for *this* plan too: Claude Code's `--resume` picker is scoped to the current working directory, so a resumed session only lists the right project's history because `cwd: getOriginalCwd()` is already set on the `spawn` call.

Stored insight `14827914-580d-42d2-ae54-82689b3a15bd` ("Core/shell split is the established convention for interactive root-level CLI verbs") records that pure logic belongs in `*-core.js` with thin entry-point shells. This plan stays entirely inside that convention. Insight `53454e24-4329-4946-ab9f-3b94cd682f17` ("Run `ctx generate` after every edit to project-manifest files") is the reason step 8 exists.

## Summary

Add a **"Resume a previous session"** entry to the `ai-insights agent` picker, pinned above the persona list, that launches `claude --resume` instead of `claude --agent <id>`. Reaching it costs one ↑ keypress or typing `resume`. To make room for a non-agent row, the picker's list model is widened from "agents, selected by `id`" to **launch entries** — each carrying the argv it wants handed to `claude` — so the spawn site stops hard-coding the `--agent` shape and future entries (a "continue last session" row, a plain agent-less session) slot in as data rather than as another branch. Two adjacent defects in the same code are fixed while it is open: the documented `--filter <term>` flag is currently ignored on the interactive path, and `filterAgents` is named for a list that will no longer contain only agents.

## Architectural Context

The launcher is a two-module, two-process feature.

- `scripts/lib/launch-agent-core.js` holds every pure function *and* both picker I/O shells, with no `main()` and no `process.exit()` — the established `scripts/lib/*.js` shape (`yaml-utils.js`, `health-checks.js`, `store-commands.js`, `ledger-dirs.js`). Both shells live here specifically so `scripts/tests/launch-agent.test.js` can import `runNonInteractivePicker` without triggering an entry point's side effects.
- `scripts/launch-agent.js` is the thin shell: arg parsing, preflight checks, picker dispatch on `isRawModeSupported()`, and an exit-code-forwarding `spawn`. Its `main()` runs unconditionally on import, so it is deliberately not import-safe and is covered only by source-text assertions in `scripts/tests/cli-cmd-agent.test.js`.
- `scripts/cli.js` (L358–361, L981–991) reaches the script through `cmdAgent`, passing `{ cwd: getOriginalCwd() }`.

The selection contract between the two modules is today a bare `string | null` — an agent `id`, or cancel — and `scripts/launch-agent.js` (L92) turns that string into `['--agent', selectedId, ...passthroughArgs]` at the spawn site.

## Approach / Architecture

**1. A launch entry replaces a bare agent id as the picker's unit.**

A new pure function in `scripts/lib/launch-agent-core.js` — `buildLaunchEntries(agents)` (new) — composes the discovered agents into the list the picker actually renders:

```
{ id, label, description, kind: 'agent' | 'session', claudeArgs: string[], file? }
```

Agents map to `kind: 'agent'`, `claudeArgs: ['--agent', agent.id]`, preserving their existing locale-aware label sort. A single module-level session entry is prepended:

```
id:          'resume-session'
label:       'Resume a previous session'
description: "Open Claude Code's own session picker for this directory (claude --resume)"
kind:        'session'
claudeArgs:  ['--resume']
```

`discoverAgents()` is untouched — it still discovers agents, and that is still all it does.

**2. Both pickers resolve with the entry, not with an id.**

`runInteractivePicker` and `runNonInteractivePicker` return the selected entry object (or `null` on cancel). `scripts/launch-agent.js` then spawns `claude` with `[...entry.claudeArgs, ...passthroughArgs]`, so the argv shape is supplied by the list rather than hard-coded at the spawn site. The `{ stdio: 'inherit', cwd: getOriginalCwd() }` options object is unchanged, as is the reopen-the-picker loop — resuming a session and then dropping back to the picker behaves exactly like launching an agent and dropping back.

**3. The pinned row does not steal the default selection.**

A new pure helper `firstAgentIndex(entries)` (new, in the core module) returns the index of the first `kind === 'agent'` entry, or `0` when there is none. `runInteractivePicker` seeds its cursor from it, and re-seeds from it whenever the query changes. `reducePickerInput` is **not** touched — it stays a pure `(state, input, filteredLength)` function returning `cursor: 0` on query-changing input, and the picker shell normalises that to `firstAgentIndex(filtered)` only when the query actually changed, leaving ↑/↓ movement alone. Net effect: type-then-Enter still lands on the top *persona*, exactly as today; the session row is one ↑ away, or is selected directly by typing `resume`/`session` until it is the only match.

**4. Rendering separates the pinned block visually.**

`renderPickerLines` draws the session entries, then a dim divider rule, then the agents. The divider occupies a row, so `CHROME_ROWS` rises from 4 to 5 and its docstring gains the divider in its enumeration — without that, a redraw can exceed the terminal height by one line and scroll the filter line out of view, which is the exact failure `CHROME_ROWS` was introduced to prevent.

Whether the divider renders is decided from the **full `filtered` list, before it is sliced to the visible rows** — never from the post-slice `visible` rows. On a short terminal `getVisibleRowBudget()` can return as low as `1`, which makes the visible slice the session row alone with every agent row folded into the `… and N more` line; deciding from the slice would drop the divider in exactly that case, leaving the one visible row indistinguishable from a persona. Deriving the decision from complete state rather than partial state also matches how `getVisibleRowBudget()` itself answers "is there room" independently of what has already been drawn.

`renderPickerLines` is also **exported** by this plan. It is already a pure function of `(state, filtered, maxVisibleRows)` returning an array of strings with no raw-mode or `process.stdout` I/O of its own, so the export costs one keyword and no signature change — and it puts the row-budget invariant this plan is actively changing (`CHROME_ROWS` 4 → 5) and the divider condition above under repeatable unit test rather than one-time manual inspection.

**5. Two adjacent fixes in the same functions.**

- `filterAgents(agents, query)` → `filterEntries(entries, query)`. Same matching logic; the name stops lying about its input.
- `runInteractivePicker(entries, initialQuery = '')` gains the initial-query parameter the `readline` fallback already has, so `--filter <term>` — documented in `scripts/cli.js` (L986–988) and `docs/references/menu-guide.md` (L98) as "Pre-fill the filter query" — is honoured on the TTY path instead of silently discarded.

## Rationale

The user's ask is a single menu row, and the cheapest way to get one is a sentinel id string (`'__resume__'`) compared at the spawn site. That is rejected because the picker's return value shares a namespace with persona `name:` frontmatter: a sentinel is a string that a real deployed agent could, in principle, also carry, and the comparison lives far from the list that defines it. Widening the entry to carry its own `claudeArgs` removes the namespace collision entirely and moves the "how do I launch this" decision next to the "what is this" definition. The cost is one extra field and a changed return type on two internal functions with exactly two call sites.

The `claudeArgs: string[]` shape is chosen over a `kind`-switched `resolveLaunchArgv(entry)` mapping because a switch would encode today's two cases in code that must be edited for a third, whereas the array makes a new row pure data. `kind` is retained *not* as a launch discriminator but because pinning and default-cursor placement are genuine behaviour that needs to distinguish the two groups.

Both adjacent fixes are in the blast radius by construction: `filterAgents` is being re-pointed at a list that is no longer all agents, and `runInteractivePicker`'s signature is being changed for the entry model anyway. Fixing the `--filter` gap separately would mean a second pass over the same two functions for three lines of change, and a standalone "make `--filter` work on TTYs" task is exactly the kind of item that never gets funded on its own.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| How the picker expresses a non-agent selection | Pickers resolve with a launch-entry object carrying `claudeArgs` | (a) Sentinel id string (`'__resume__'`) compared at the spawn site; (b) pickers return `{ kind, id }` and a `resolveLaunchArgv()` switch builds the argv | (a) puts a magic string in the same namespace as persona `name:` values and separates the launch decision from the list definition; (b) needs a code edit per new row where the chosen shape needs a data edit. The entry object costs one field and changes two internal signatures with two call sites total. |
| Where the session row sits in the list | Pinned above the agents, with a dim divider, default cursor on the first agent | (a) Bottom of the list; (b) top of the list with the cursor defaulting to it | (a) is invisible in practice — ~34 personas against a 15-row budget means it is always truncated away; (b) changes what Enter-on-open does, which is a silent behaviour shift for a list people navigate by muscle memory. Pinning plus `firstAgentIndex()` gives visibility with zero change to the agent path. |
| How the row is reached | A filterable, navigable list entry | (a) A dedicated keybinding (e.g. `Ctrl+R`) in the raw-mode loop | Explicitly set aside by the user in favour of a menu item; a keybinding also has no equivalent in the `readline` fallback, so the two picker modes would diverge. |
| Where the feature is surfaced | Inside the existing `agent` picker | (a) A new top-level `ai-insights resume` command in `scripts/cli.js`; (b) both | The picker is where the user already is when a session exits, and it reopens automatically in a loop — a sibling top-level command adds a second surface, a second help entry, and a second doc row for a flag pass-through that `claude --resume` already provides directly from any shell. |
| Default-cursor placement mechanism | Picker shell normalises the cursor via `firstAgentIndex()` on query change | (a) Teach `reducePickerInput` about entry kinds and have it return the right cursor | (a) would force the pure reducer to take the entry list instead of a bare `filteredLength`, widening its contract and its four existing test cases to serve a rendering concern. |
| What the divider's visibility is computed from | The full `filtered` list, before slicing to the visible rows | (a) The post-slice `visible` rows; (b) no divider at all, relying on row order and the `▶`/bold treatment | (a) costs the same one boolean but silently drops the divider when `getVisibleRowBudget()` is small enough that only the session row is visible — the case where the visual distinction matters most; (b) gives up the pinned-block separation this plan exists to provide. |
| How the row-budget and divider invariants are verified | `renderPickerLines` exported and unit-tested | (a) Manual-only verification in step 9; (b) extract just the "does the divider render" predicate and test that in isolation | (a) leaves the invariant this plan is changing with no regression guard, and every future edit to the renderer repeats the same manual check; (b) covers the divider but not the line-count bound AC-12 asks for. Exporting an already-pure function costs one keyword, unlike the raw-mode harness `runInteractivePicker` would need. |

## Pattern Alignment

- **Core/shell split** — all new logic (`buildLaunchEntries`, `firstAgentIndex`, the renamed `filterEntries`) lands in `scripts/lib/launch-agent-core.js`; `scripts/launch-agent.js` gains only wiring. Follows the convention recorded in insight `14827914-580d-42d2-ae54-82689b3a15bd` and the module's own docstring (L1–16).
- **Pure reducer kept separate from the raw-mode loop** — `reducePickerInput` remains untouched and un-widened; cursor normalisation is a shell concern handled in `runInteractivePicker`. Follows `scripts/lib/launch-agent-core.js` (L93–102).
- **No `process.exit()` in library code** — the new core functions return values only, per `AGENTS.md` Failure Protocol.
- **Cross-platform by construction** — no OS-specific code; `--resume` is a Claude Code CLI flag on every platform, per `AGENTS.md` §Cross-Platform Policy.
- **Terminal helpers from `@mistralys/cli-menu`** — the divider uses the already-imported `C.dim`, adding no import and no dependency.
- **No departures from an existing pattern.** The one rename (`filterAgents` → `filterEntries`) tightens an existing naming convention rather than departing from it.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `scripts/lib/launch-agent-core.js` — picker return contract | `string \| null` cannot express a non-agent selection without a sentinel that shares a namespace with persona `name:` values | Promoted to step 2 | It is the structure blocking the requested feature; widening it is the work |
| `scripts/launch-agent.js` (L92) — hard-coded `['--agent', selectedId, …]` at the spawn site | The launch argv is decided far from the list that defines what is launchable, so every new row needs a branch here | Promoted to step 4 | Moving argv into the entry is what keeps the spawn site branch-free as rows are added |
| `scripts/lib/launch-agent-core.js` (L81) — `filterAgents` | Named for a list that will contain a non-agent row after this change | Promoted to step 1 | The name would be actively misleading the moment step 1 lands; renaming now costs one test-file pass that is happening anyway |
| `scripts/lib/launch-agent-core.js` (L202) — `runInteractivePicker` ignores `--filter` | Documented in two places as "Pre-fill the filter query", honoured only by the non-TTY fallback | Promoted to step 3 | The signature is being changed for the entry model regardless; the fix is a parameter and one seeded state field |
| `scripts/lib/launch-agent-core.js` (L34) — `CHROME_ROWS = 4` | Does not account for the new divider row, so a full-height redraw could overflow by one line | Promoted to step 3 | Directly caused by this plan's rendering change; leaving it stale reintroduces the scroll bug the constant exists to prevent |
| `scripts/lib/launch-agent-core.js` (L173) — `renderPickerLines` is module-private and untested | Already pure and side-effect-free, yet bundled with `runInteractivePicker` into the "no test seam" bucket, leaving the row-budget invariant this plan changes with no regression guard | Promoted to steps 3 and 5 | Exporting it costs one keyword and no signature change, and it is the only new or changed function in step 3 that would otherwise ship untested |
| `scripts/launch-agent.js` (L60–67) — empty-agents-directory hard exit | With a session row present, an empty `~/.claude/agents/` no longer makes the picker useless | **Rejected** | The command is `agent`; "run sync-personas" remains the correct guidance for that state, and a user with no personas can reach `claude --resume` directly from the shell. Changing it would alter a preflight contract this plan has no other reason to touch |
| `scripts/cli.js` (L358–361) — `cmdAgent` | Unchanged pass-through; its `{ cwd: getOriginalCwd() }` option is correct and regression-tested | **Rejected** | Nothing about it is a poor fit; the only edit in `scripts/cli.js` is the command's user-facing `description` string (step 6) |

## Detailed Steps

1. **Introduce the launch-entry model** in `scripts/lib/launch-agent-core.js`. Add a module-level `SESSION_LAUNCH_ENTRIES` constant holding the single resume entry (`id: 'resume-session'`, `label: 'Resume a previous session'`, `description: "Open Claude Code's own session picker for this directory (claude --resume)"`, `kind: 'session'`, `claudeArgs: ['--resume']`). Export a new pure `buildLaunchEntries(agents)` returning `[...SESSION_LAUNCH_ENTRIES, ...agents.map(a => ({ ...a, kind: 'agent', claudeArgs: ['--agent', a.id] }))]`. Rename `filterAgents` to `filterEntries(entries, query)` with its matching logic unchanged, and update its docstring and the call sites at L205, L242 and L279. Leave `discoverAgents()` and `reducePickerInput()` untouched.

2. **Add `firstAgentIndex(entries)`** to the same module as an exported pure helper: the index of the first entry whose `kind === 'agent'`, or `0` when the list contains none (including the empty list).

3. **Update the picker shells** in `scripts/lib/launch-agent-core.js`:
   - `renderPickerLines(state, filtered, maxVisibleRows)` — compute `const hasBothKinds = filtered.some(e => e.kind === 'session') && filtered.some(e => e.kind === 'agent')` from the **full `filtered` array, before it is sliced** to `maxVisibleRows`. Then, over the sliced rows, draw the `kind === 'session'` rows first, then `C.dim('  ─────────────')` as a divider whenever `hasBothKinds` is true and at least one session row appears in the slice, then the agent rows. Never re-derive the kind mix from the sliced rows: on a short terminal `getVisibleRowBudget()` can return `1`, leaving a session-only slice whose agent rows are hidden in the `… and N more` line, and a slice-derived test would drop the divider exactly there. Keep the existing `▶`/bold active-row treatment for every row regardless of kind.
   - Change `function renderPickerLines(...)` to `export function renderPickerLines(...)` — no signature change, no behaviour change; it is already pure, and step 5 unit-tests it.
   - Raise `CHROME_ROWS` from 4 to 5, extend its docstring to name the divider as the fifth reserved row, and export the constant so the step-5 render tests assert the line-count bound against it rather than against a hard-coded `5`.
   - `runInteractivePicker(entries, initialQuery = '')` — seed `state` as `{ query: initialQuery, cursor: firstAgentIndex(filterEntries(entries, initialQuery)) }`; in `onKeypress`, capture the pre-reduce query, and after recomputing `filtered`, set `state.cursor = firstAgentIndex(filtered)` when the query changed, otherwise apply the existing clamp. Resolve with `filtered[state.cursor]` (the entry) or `null`.
   - `runNonInteractivePicker(entries, initialQuery = '', opts = {})` — return `filtered[num - 1]` (the entry) instead of `.id`; the printed `  [N] label` rows and the number/free-text/empty-input handling are otherwise unchanged.

4. **Wire the entry point** in `scripts/launch-agent.js`: after the two preflight checks, build the list once with `buildLaunchEntries(agents)`; pass it plus `pickerFilter` to both pickers (`runInteractivePicker(entries, pickerFilter)` / `runNonInteractivePicker(entries, pickerFilter)`); rename `selectedId` to `selected`; and change the spawn to `spawn('claude', [...selected.claudeArgs, ...passthroughArgs], { stdio: 'inherit', cwd: getOriginalCwd() })`. Keep `getOriginalCwd()` inside that argument list and introduce no `');'` sequence within it — `scripts/tests/cli-cmd-agent.test.js` (L79–82) asserts against the literal source text between `spawn('claude'` and the next `');'`. Update the `child.on('error', …)` message to interpolate `selected.label` rather than an agent id, and refresh the file's header docstring to describe the entry model.

5. **Update the unit tests** in `scripts/tests/launch-agent.test.js` (see Test Plan for the full obligation list): rename the `filterAgents()` suite to `filterEntries()`, add suites for `buildLaunchEntries()` and `firstAgentIndex()`, and rewrite the `runNonInteractivePicker()` assertions to expect entry objects. Add a `renderPickerLines()` suite against the export added in step 3, covering: a session-plus-agents mix within budget (divider present, total line count within `maxVisibleRows + CHROME_ROWS`); a session-only `filtered` list (no divider); an agents-only `filtered` list (no divider); and a mixed `filtered` list with `maxVisibleRows: 1`, which asserts the divider still renders even though the slice is session-only, and that the returned line count never exceeds `maxVisibleRows + CHROME_ROWS`. Import `CHROME_ROWS` rather than hard-coding `5`, so the bound assertion tracks the constant instead of freezing today's value.

6. **Update the command's user-facing copy** in `scripts/cli.js`: change the `agent` command `description` (L987) from `'Pick a persona and launch it with Claude Code'` to wording that covers both outcomes, e.g. `'Launch a persona with Claude Code, or resume a session'`. Leave `id`, `key`, `category`, `helpVariants` and `run` untouched.

7. **Update the documentation**: `AGENTS.md` rows L388 and L389 (new and renamed exports, the session entry, the `initialQuery` parameter on `runInteractivePicker`); `docs/references/menu-guide.md` L45 (the "Launch an agent" description) and the L97–98 example block; `README.md` L76 (the picker now covers sessions as well as personas). Do **not** hand-edit `CLAUDE.md` — it is generated from `AGENTS.md`. Do not add a `changelog.md` entry: per `AGENTS.md` §Changelog Convention the root changelog is curated at release time from `git log`, and `scripts/` has no module changelog.

8. **Regenerate the context bundle** with `node scripts/cli.js build-maintain`, which refreshes `.context/agents.md`, `.context/scripts.md` and the generated `CLAUDE.md` from the edited `AGENTS.md`. Confirm the regenerated files are staged alongside the source edits.

9. **Verify end to end**: run `npm test` (full Vitest suite, not just the launcher file). Then, from a directory with at least one prior Claude Code session, run `node scripts/cli.js agent` and confirm — (a) the session row renders above the divider and the cursor opens on the first persona; (b) ↑ then Enter opens Claude Code's session picker scoped to that directory; (c) exiting that session returns to the agent picker; (d) typing `resume` narrows to the session row alone; (e) selecting a persona still launches `claude --agent <id>` in the same directory; (f) `node scripts/cli.js agent --filter <term>` opens with the filter pre-filled on a TTY. Record each result in the handoff notes.

## Dependencies

- Step 2 depends on step 1 (`kind` must exist before it can be searched for).
- Step 3 depends on steps 1–2.
- Step 4 depends on steps 1–3 (both picker signatures and the return type).
- Step 5 depends on steps 1–3.
- Step 6 is independent of steps 1–5.
- Steps 7–8 depend on steps 1–6; step 8 must run after step 7's `AGENTS.md` edit.
- Step 9 depends on all preceding steps.
- External: the `claude` CLI on `PATH` supporting `-r, --resume` with no value (verified against the installed CLI).

## Required Components

- `scripts/lib/launch-agent-core.js` (modified — new `SESSION_LAUNCH_ENTRIES` constant, new `buildLaunchEntries()` and `firstAgentIndex()` exports, `filterAgents` renamed to `filterEntries`, both picker shells re-typed, `renderPickerLines` divider plus its export, `CHROME_ROWS` 4 → 5 and exported)
- `scripts/launch-agent.js` (modified — entry-list construction, picker call sites, `spawn` argv from `selected.claudeArgs`, error message, header docstring)
- `scripts/cli.js` (modified — the `agent` command `description` string only)
- `scripts/tests/launch-agent.test.js` (modified — renamed suite plus new suites and re-typed picker assertions)
- `AGENTS.md`, `docs/references/menu-guide.md`, `README.md` (modified — user- and agent-facing docs)
- `.context/agents.md`, `.context/scripts.md`, `CLAUDE.md` (regenerated — never hand-edited)
- External: Claude Code CLI (`claude`), already a hard requirement of this command via `isClaudeCliAvailable()`

## Assumptions

- `claude --resume` invoked with no value opens Claude Code's interactive session picker and exits with a normal status code when cancelled, so the launcher's existing `child.on('close')` reopen loop needs no special-casing.
- Claude Code scopes its `--resume` picker to the process working directory, so `cwd: getOriginalCwd()` already carries the correct scope.
- Persona frontmatter never produces an agent whose `kind` field would collide — `discoverAgents()` constructs its objects from a fixed four-field shape (L61–66), so `kind` is added by `buildLaunchEntries()` alone.

## Constraints

- `scripts/launch-agent.js`'s `main()` runs unconditionally on import; tests must keep importing only from `scripts/lib/launch-agent-core.js`.
- `scripts/tests/cli-cmd-agent.test.js` asserts against raw source text of the `spawn('claude', …)` call — see the formatting constraint in step 4.
- No `process.exit()` may be introduced into `scripts/lib/launch-agent-core.js`.
- Behaviour must be identical on Windows, Linux and macOS (`AGENTS.md` §Cross-Platform Policy).
- The full render must stay within the terminal's row budget; the divider is the reason `CHROME_ROWS` changes.

## Out of Scope

- A top-level `ai-insights resume` command, or any new `scripts/cli.js` command definition.
- A `--continue` ("resume the most recent session") entry — the model added here makes it a one-line addition later, but it is not part of this plan.
- Reading or parsing `~/.claude/projects/**/*.jsonl` transcripts to render session titles, dates, or a custom session list inside this picker. That is Claude Code's private storage format, and `--resume` already owns this UI.
- Changing the empty-agents-directory preflight (see Structural Improvements).
- Making `scripts/cli.js` import-safe so `cmdAgent` can be unit-tested directly — a pre-existing, workspace-wide limitation already recorded as out of scope by `2026-09-15-agent-launcher-cwd-fix`.
- Any change to `discoverAgents()`, `reducePickerInput()`, `parseFrontmatter()`, or the persona build pipeline.

## Acceptance Criteria

- AC-01: `buildLaunchEntries(agents)` returns the session entry first, followed by every agent in the order given, with each agent entry carrying `kind: 'agent'` and `claudeArgs: ['--agent', <id>]` and preserving `id`, `label`, `description` and `file`.
- AC-02: `buildLaunchEntries([])` returns exactly the session entry, with `kind: 'session'` and `claudeArgs: ['--resume']`.
- AC-03: `filterEntries(entries, query)` matches case-insensitively against `label`, `id` and `description`, returns the list unfiltered for an empty or whitespace-only query, and matches the session entry for the queries `resume` and `session`.
- AC-04: `firstAgentIndex(entries)` returns the index of the first `kind === 'agent'` entry, and `0` for a list containing no agent entry (including `[]`).
- AC-05: `runNonInteractivePicker` resolves with the selected **entry object** for a valid number, re-filters on free text, and resolves with `null` on empty input.
- AC-06: `runNonInteractivePicker(entries, 'resume')` resolves with the session entry when `1` is entered — i.e. the session row is selectable through the non-TTY path.
- AC-07: `runInteractivePicker(entries, initialQuery)` opens with `initialQuery` applied, so `ai-insights agent --filter <term>` pre-fills the filter on a TTY.
- AC-08: With an empty query, the interactive picker's initial cursor is the first agent entry, not the session entry; pressing ↑ once moves it to the session entry.
- AC-09: `scripts/launch-agent.js` spawns `claude` with `[...selected.claudeArgs, ...passthroughArgs]`, and the spawn call still passes `cwd: getOriginalCwd()`.
- AC-10: Selecting the session entry launches `claude --resume` in the invoking directory; exiting that session returns to the picker rather than to the caller, exactly as with an agent selection.
- AC-11: Selecting a persona still launches `claude --agent <id>` with unchanged behaviour, including the reopen loop and Escape/Ctrl+C cancellation.
- AC-12: `CHROME_ROWS` accounts for the divider row, and `renderPickerLines` never returns more than `maxVisibleRows + CHROME_ROWS` lines for any entry mix, so a full-height picker render does not exceed `process.stdout.rows`.
- AC-13: `npm test` passes with no remaining references to `filterAgents` anywhere under `scripts/`.
- AC-14: `AGENTS.md` (L388–389 rows), `docs/references/menu-guide.md` (L45, L97–98), `README.md` (L76) and the `agent` command `description` in `scripts/cli.js` all describe the session entry; `.context/` and `CLAUDE.md` are regenerated, not hand-edited.
- AC-15: `renderPickerLines` renders the divider whenever the **full `filtered` list** contains both a `kind === 'session'` and a `kind === 'agent'` entry and a session row is visible — including when `maxVisibleRows` is small enough that the visible slice holds only the session row — and omits it when `filtered` is all one kind.

## Testing Strategy

Three layers, matching what each module allows. The pure core functions (`buildLaunchEntries`, `filterEntries`, `firstAgentIndex`) get direct unit tests, and `renderPickerLines` joins them: it is already a pure `(state, filtered, maxVisibleRows) → string[]` function with no raw-mode or `process.stdout` I/O, so exporting it (step 3) brings the divider condition and the row-budget bound under unit test — AC-12 and AC-15 are machine-checked rather than eyeballed. `runNonInteractivePicker` is exercised through its existing `readlineFactory` stub seam.

`runInteractivePicker` is the one function with no test seam today (raw mode, alt-screen, direct `process.stdout` writes), and `scripts/launch-agent.js` is not import-safe, so AC-07, AC-08 and AC-10 remain covered by the step-9 manual verification, with AC-09 locked in by the existing source-text regression test. Building a raw-mode harness for the interactive picker is deliberately not attempted here — it is a larger change than the feature and would be the first such harness in `scripts/tests/`. That reasoning applies to the raw-mode loop alone and does not extend to `renderPickerLines`, which needs no harness at all.

## Test Plan

- `scripts/tests/launch-agent.test.js` → new `buildLaunchEntries()` suite — session entry is first; agent order and the four original fields are preserved; each agent carries `kind: 'agent'` and `claudeArgs: ['--agent', id]` — AC-01
- `scripts/tests/launch-agent.test.js` → `buildLaunchEntries()` suite, empty-input case — `buildLaunchEntries([])` returns exactly one entry with `kind: 'session'` and `claudeArgs: ['--resume']` — AC-02
- `scripts/tests/launch-agent.test.js` → `filterEntries()` suite (renamed from `filterAgents()`) — existing label/id/description and empty-query cases retained, plus new cases asserting `resume` and `session` both match the session entry and that a persona-specific query excludes it — AC-03
- `scripts/tests/launch-agent.test.js` → new `firstAgentIndex()` suite — returns `1` for a session-then-agents list, `0` for an agents-only list, `0` for a session-only list, `0` for `[]` — AC-04
- `scripts/tests/launch-agent.test.js` → `runNonInteractivePicker()` suite, re-typed — number selection resolves with the entry object (asserting on `.id` *and* `.claudeArgs`), free text re-filters, empty input resolves `null` — AC-05
- `scripts/tests/launch-agent.test.js` → `runNonInteractivePicker()` suite, new case — with `initialQuery: 'resume'` and a stubbed answer of `'1'`, resolves with the session entry — AC-06
- `scripts/tests/launch-agent.test.js` → existing `discoverAgents()` and `reducePickerInput()` suites — retained unchanged, guarding the two functions this plan deliberately does not touch — AC-11 (non-regression)
- `scripts/tests/cli-cmd-agent.test.js` → existing `spawn('claude', …)` source-text assertion — retained unchanged; still asserts `getOriginalCwd()` appears in the spawn argument list after the argv edit — AC-09
- `scripts/tests/launch-agent.test.js` → new `renderPickerLines()` suite, mixed-list case — a session-plus-agents `filtered` list within budget renders the divider between the two groups, and the returned line count is ≤ `maxVisibleRows + CHROME_ROWS` — AC-12, AC-15
- `scripts/tests/launch-agent.test.js` → `renderPickerLines()` suite, single-kind cases — a session-only `filtered` list and an agents-only `filtered` list each render no divider — AC-15
- `scripts/tests/launch-agent.test.js` → `renderPickerLines()` suite, short-terminal case — a mixed `filtered` list rendered with `maxVisibleRows: 1` still renders the divider even though the visible slice holds only the session row, and returns no more than `1 + CHROME_ROWS` lines — AC-12, AC-15
- Manual verification, step 9 (a)–(f) — on-screen divider placement and initial cursor (AC-08), resume launch and loop-back (AC-10), unchanged agent launch (AC-11), `--filter` on a TTY (AC-07)
- `npm test` plus `grep -r filterAgents scripts/` returning no matches — AC-13

## Documentation Updates

- `AGENTS.md` (L388) — `scripts/launch-agent.js` row: the picker now presents a pinned "Resume a previous session" entry alongside the personas, and launches `claude` with the argv carried by the selected entry
- `AGENTS.md` (L389) — `scripts/lib/launch-agent-core.js` row: add `buildLaunchEntries(agents)` and `firstAgentIndex(entries)`, rename `filterAgents` to `filterEntries(entries, query)`, record the new `runInteractivePicker(entries, initialQuery)` signature, and note that `renderPickerLines(state, filtered, maxVisibleRows)` and `CHROME_ROWS` are now exported for test coverage
- `docs/references/menu-guide.md` (L45) — "Launch an agent" row: mention the pinned session entry and that it opens Claude Code's own session picker
- `docs/references/menu-guide.md` (L97–98) — example block: note that `--filter` now pre-fills on the interactive path too
- `README.md` (L76) — the one-line launcher callout: the picker covers deployed personas *and* resuming a prior session
- `scripts/cli.js` (L987) — the `agent` command `description` shown in the interactive menu and `--help`
- `CLAUDE.md`, `.context/agents.md`, `.context/scripts.md` — regenerated by `node scripts/cli.js build-maintain`; never hand-edited (per the generation notice at `CLAUDE.md` L1 and `AGENTS.md`'s "regenerate `.context/`" rule)
- `changelog.md` (root) — **no edit**: per `AGENTS.md` §Changelog Convention the root changelog is written at release time from `git log`, and `scripts/` has no module changelog
- `docs/references/development.md` (L39) — **no edit**: lists `ai-insights agent` without describing its behaviour

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Changing the picker return type from `string` to an object silently breaks a caller** | There are exactly two call sites, both in `scripts/launch-agent.js` (L86–87), and both are edited in step 4. `grep -r "runInteractivePicker\|runNonInteractivePicker\|filterAgents" scripts/` during step 5 confirms no third consumer, and AC-13 makes the absence of `filterAgents` an explicit criterion. |
| **Reformatting the `spawn('claude', …)` call breaks `scripts/tests/cli-cmd-agent.test.js`'s source-text assertion** | Step 4 states the formatting constraint inline (keep `getOriginalCwd()` in the argument list, introduce no `');'` within it). The test runs as part of `npm test` in step 9, so a violation fails loudly rather than silently. |
| **The pinned row shifts what Enter-on-open selects, surprising muscle memory** | `firstAgentIndex()` seeds and re-seeds the cursor to the first persona, so the agent path is byte-for-byte unchanged from the user's perspective; AC-08 makes this an explicit criterion and step 9(a) verifies it by hand. |
| **The divider row overflows the render on a short terminal, scrolling the filter line out of view** | `CHROME_ROWS` rises to 5 in the same step that adds the divider (step 3), preserving the invariant its docstring describes. AC-12 covers it, and the step-5 `renderPickerLines()` suite asserts the `maxVisibleRows + CHROME_ROWS` bound automatically — including a `maxVisibleRows: 1` case — so a future edit to the renderer fails the suite instead of relying on someone repeating step 9(a) by hand. |
| **The divider silently disappears on a short terminal, where the session/persona distinction matters most** | Visibility is computed from the pre-slice `filtered` list, never from the sliced rows (step 3), so a `getVisibleRowBudget()` of 1 still renders it above the `… and N more` line. AC-15 states the rule and the step-5 short-terminal test case locks it in. |
| **`claude --resume` finds no sessions for the invoking directory and the child exits immediately, appearing to do nothing** | Claude Code owns that empty-state message. The launcher's loop returns to the picker on child close, so the user lands back where they started rather than at a dead end; step 9(b) exercises a directory with prior sessions, and the behaviour with none is Claude Code's to report. |
| **`--resume` behaviour changes in a future Claude Code release** | The coupling is a single flag in one data constant (`SESSION_LAUNCH_ENTRIES`), not logic spread across the module, so a change is a one-line edit. The launcher already hard-depends on the `claude` CLI via `isClaudeCliAvailable()` and `--agent`. |
| **`.context/` and `CLAUDE.md` drift from the edited `AGENTS.md`** | Step 8 runs `build-maintain` as a named step after the doc edits, and AC-14 requires the regenerated files to be present — the obligation recorded in insight `53454e24-4329-4946-ab9f-3b94cd682f17`. |

## Recommended Workflow

- **Workflow:** standalone
- **Rationale:** A single-module change inside a well-understood, already-tested pattern — two source files plus their tests and documentation, with no new dependency, no architectural departure, and no cross-project blast radius.
