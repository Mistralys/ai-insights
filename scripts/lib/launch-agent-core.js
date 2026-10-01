/**
 * scripts/lib/launch-agent-core.js
 *
 * Pure discovery/filtering/reducer logic and picker I/O shells for the
 * `ai-insights agent` launcher. Deliberately has no `main()` and no
 * process-wiring/CLI-invocation logic, matching this workspace's
 * established scripts/lib/*.js shape (see yaml-utils.js, health-checks.js,
 * store-commands.js, ledger-dirs.js) — the thin CLI entry point lives in
 * scripts/launch-agent.js, which imports everything it needs from here.
 *
 * Both picker I/O shells (runInteractivePicker, runNonInteractivePicker)
 * live in this module rather than in scripts/launch-agent.js so that
 * scripts/tests/launch-agent.test.js can import runNonInteractivePicker
 * directly without triggering scripts/launch-agent.js's unconditionally-
 * invoked main() as a side effect of the import.
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { enterRawMode, restoreTerminal, clearScreen, C } from '@mistralys/cli-menu';
import { parseFrontmatter } from './frontmatter.js';

const MAX_VISIBLE_ROWS = 15;

// Non-list overhead rendered by renderPickerLines(): the query line, the
// instructions line, one blank line, the pinned-block divider (drawn
// whenever both a pinned (session/toggle) entry and an agent entry are present),
// and the trailing "…and N more" line that appears whenever the list is
// truncated. Reserving room for all five up front (rather than only when
// actually rendered) keeps the row budget stable across redraws, which
// matters because the query line is drawn first — if a redraw ever grows
// taller than the terminal, the terminal auto-scrolls and it's always the
// *top* line (the one showing what the user is currently typing) that
// scrolls out of view first.
export const CHROME_ROWS = 5;

/**
 * The single pinned "resume a previous session" launch entry, prepended to
 * every discovered agent by {@link buildLaunchEntries}. `claudeArgs` is what
 * lets the spawn site in scripts/launch-agent.js stay branch-free: it reads
 * argv straight off the selected entry instead of switching on `kind`.
 */
const SESSION_LAUNCH_ENTRIES = [
  {
    id: 'resume-session',
    label: 'Resume a previous session',
    description: "Open Claude Code's own session picker for this directory (claude --resume)",
    kind: 'session',
    claudeArgs: ['--resume'],
  },
];

/**
 * Scan a Claude Code agents directory and build the discoverable agent list.
 * Returns `[]` when the directory does not exist — never throws.
 *
 * Label rule (two-tier fallback): the `role:` frontmatter field when present,
 * otherwise the filename without its `.md` extension. Every persona built by
 * this workspace's persona pipeline (ledger, standalone, and ledger-support
 * suites) now emits a pretty `role:` line — see FRONTMATTER_LEDGER_CC and
 * FRONTMATTER_STANDALONE_CC in personas/persona-build.config.js. The basename
 * fallback still matters for any agent deployed to ~/.claude/agents/ from
 * outside this pipeline (e.g. hand-authored or from another project), which
 * carries no `role:` field at all.
 *
 * @param {string} agentsDir - Absolute path to ~/.claude/agents/
 * @returns {Array<{id: string, label: string, description: string, file: string}>}
 *   Sorted by `label` (locale-aware).
 */
export function discoverAgents(agentsDir) {
  if (!fs.existsSync(agentsDir)) return [];

  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  const agents = files.map((file) => {
    const filePath = path.join(agentsDir, file);
    const fields = parseFrontmatter(filePath);
    const basename = path.basename(file, '.md');
    return {
      id: fields?.name || basename,
      label: fields?.role || basename,
      description: fields?.description || '',
      file: filePath,
    };
  });

  agents.sort((a, b) => a.label.localeCompare(b.label));
  return agents;
}

/**
 * Splits CLI args into `ai-insights agent` own args and passthrough args for
 * `claude` (everything after a bare `--`), and extracts `--filter <term>`.
 *
 * @param {string[]} argv
 * @returns {{filter: string, ownArgs: string[], passthroughArgs: string[]}}
 */
export function parseLaunchArgs(argv) {
  const separatorIndex = argv.indexOf('--');
  const ownArgs = separatorIndex !== -1 ? argv.slice(0, separatorIndex) : argv;
  const passthroughArgs = separatorIndex !== -1 ? argv.slice(separatorIndex + 1) : [];

  let filter = '';
  const filterIndex = ownArgs.indexOf('--filter');
  if (filterIndex !== -1 && ownArgs[filterIndex + 1] !== undefined) {
    filter = ownArgs[filterIndex + 1];
  }

  return { filter, ownArgs, passthroughArgs };
}

/**
 * Composes the discovered agents into the launch-entry list the picker
 * actually renders: the pinned {@link SESSION_LAUNCH_ENTRIES} first, then
 * one pinned toggle row per toggle definition, then every discovered agent (in the order given) widened with `kind: 'agent'`
 * and `claudeArgs: ['--agent', id]`. Each entry carries the argv it wants
 * handed to `claude`, so the spawn site in scripts/launch-agent.js reads
 * `claudeArgs` off the selection instead of switching on `kind`.
 *
 * Toggle rows carry `claudeArgs: []`; their effect on argv is produced by the
 * `LaunchToggles` model, not by the entry.
 *
 * @param {Array<{id: string, label: string, description: string, file: string}>} agents
 * @param {ReadonlyArray<{id: string, label: string, description: string}>} [toggleDefs]
 * @returns {Array<{id: string, label: string, description: string, kind: ('session'|'toggle'|'agent'), claudeArgs: string[], toggleId?: string, file?: string}>}
 */
export function buildLaunchEntries(agents, toggleDefs = []) {
  return [
    ...SESSION_LAUNCH_ENTRIES,
    ...toggleDefs.map((def) => ({
      id: `toggle:${def.id}`,
      label: def.label,
      description: def.description,
      kind: 'toggle',
      toggleId: def.id,
      claudeArgs: [],
    })),
    ...agents.map((agent) => ({ ...agent, kind: 'agent', claudeArgs: ['--agent', agent.id] })),
  ];
}

/**
 * Case-insensitive substring filter against label, id, and description.
 * An empty/whitespace-only query returns the full list unfiltered.
 *
 * @param {Array<{id: string, label: string, description: string}>} entries
 * @param {string} query
 * @returns {Array<object>}
 */
export function filterEntries(entries, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((entry) => {
    return (
      entry.label.toLowerCase().includes(q) ||
      entry.id.toLowerCase().includes(q) ||
      (entry.description || '').toLowerCase().includes(q)
    );
  });
}

/**
 * Index of the first `kind === 'agent'` entry in a launch-entry list, or `0`
 * when the list contains none (including the empty list). Used to seed and
 * re-seed the interactive picker's cursor so the pinned session row never
 * steals the default selection from the agent path.
 *
 * @param {Array<{kind: string}>} entries
 * @returns {number}
 */
export function firstAgentIndex(entries) {
  const index = entries.findIndex((entry) => entry.kind === 'agent');
  return index === -1 ? 0 : index;
}

/**
 * Pure state reducer for the interactive picker's keypress loop. Mirrors the
 * "separate the pure state transition from the raw-mode I/O loop" shape
 * @mistralys/cli-menu's own runCheckboxMenu uses internally.
 *
 * @param {{query: string, cursor: number}} state
 * @param {{str: string, key: object}} input - a Node `keypress` event pair
 * @param {number} filteredLength - length of the currently filtered agent list
 * @returns {{query: string, cursor: number, action: ('select'|'cancel'|null)}}
 */
export function reducePickerInput(state, input, filteredLength) {
  const { str = '', key } = input || {};
  const k = key || {};
  const name = k.name || '';

  if (name === 'escape' || (k.ctrl && name === 'c')) {
    return { ...state, action: 'cancel' };
  }

  if (name === 'return') {
    return { ...state, action: filteredLength > 0 ? 'select' : null };
  }

  if (name === 'backspace') {
    return { query: state.query.slice(0, -1), cursor: 0, action: null };
  }

  if (name === 'up' || name === 'down') {
    const maxCursor = Math.max(0, filteredLength - 1);
    const delta = name === 'up' ? -1 : 1;
    const cursor = Math.max(0, Math.min(maxCursor, state.cursor + delta));
    return { ...state, cursor, action: null };
  }

  const isPrintable =
    str && str.length === 1 && !k.ctrl && !k.meta && str.charCodeAt(0) >= 0x20 && str !== '\x7f';
  if (isPrintable) {
    return { query: state.query + str, cursor: 0, action: null };
  }

  return { ...state, action: null };
}

/**
 * Caps the number of agent rows drawn per frame so the full render never
 * exceeds the terminal's actual height. Falls back to MAX_VISIBLE_ROWS when
 * the row count is unknown (e.g. not a TTY, as in test harnesses).
 *
 * @returns {number}
 */
function getVisibleRowBudget() {
  const rows = process.stdout.rows;
  if (!rows || rows <= 0) return MAX_VISIBLE_ROWS;
  return Math.max(1, Math.min(MAX_VISIBLE_ROWS, rows - CHROME_ROWS));
}

/**
 * Switches the terminal to its alternate screen buffer — the same
 * isolated, scroll-independent drawing surface full-screen TUIs like
 * `less`, `vim`, and `htop` use. `clearScreen()`'s `\x1B[2J\x1B[0;0H`
 * alone was not enough on every terminal: block-based UIs (observed with
 * Warp) can home the cursor without actually resetting the *viewport's*
 * scroll offset, so a redraw taller than the currently-scrolled-to
 * position gets written above the visible area — exactly the "scroll up
 * one line to see it" symptom. The alternate buffer sidesteps that
 * entirely: it starts blank with the viewport pinned to its top on
 * every entry, regardless of how the primary buffer was scrolled.
 * No-ops when stdout isn't a TTY.
 */
function enterAltScreen() {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1B[?1049h');
}

/** Restores the primary screen buffer exactly as it was before {@link enterAltScreen}. */
function exitAltScreen() {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1B[?1049l');
}

/**
 * Renders the picker's full frame as an array of lines: the filter/query
 * row, the instructions row, a blank line, the pinned rows (session and
 * toggle), a dim divider (only when both pinned and agent rows are present in
 * the full `filtered` list), the agent rows, and — when the list is truncated — a trailing
 * "…and N more" row. Pure: no raw-mode or `process.stdout` I/O of its own.
 *
 * Whether the divider renders is decided from the full `filtered` array,
 * *before* it is sliced to `maxVisibleRows` — never from the post-slice
 * `visible` rows. On a short terminal `getVisibleRowBudget()` can return as
 * low as `1`, which makes the visible slice the session row alone with
 * every agent row folded into the `… and N more` line; deciding from the
 * slice would drop the divider in exactly that case, leaving the one
 * visible row indistinguishable from a persona.
 *
 * @param {{query: string, cursor: number}} state
 * @param {Array<{kind?: string, label: string}>} filtered
 * @param {number} [maxVisibleRows]
 * @param {import('./launch-toggles.js').LaunchToggles|null} [toggles] - Supplies
 *   toggle ON/OFF state and the instructions-line warning; `null` renders
 *   every toggle row as OFF with no warning.
 * @returns {string[]}
 */
export function renderPickerLines(state, filtered, maxVisibleRows = MAX_VISIBLE_ROWS, toggles = null) {
  const lines = [];
  lines.push(C.bold('  Filter agents:') + ' ' + state.query);
  let instructions = C.dim('  Type to filter · ↑/↓ navigate · Enter launch/toggle · Esc/Ctrl+C cancel');
  const warnings = toggles ? toggles.activeWarnings() : [];
  if (warnings.length > 0) {
    instructions += C.yellow(' · ⚠ ' + warnings.join(', ') + ' ON');
  }
  lines.push(instructions);
  lines.push('');

  const isPinned = (entry) => entry.kind !== 'agent';
  const hasPinnedAndAgents = filtered.some(isPinned) && filtered.some((entry) => !isPinned(entry));
  const visible = filtered.slice(0, maxVisibleRows);

  if (visible.length === 0) {
    lines.push(C.dim('  No matches.'));
  } else {
    let dividerDrawn = false;
    visible.forEach((entry, i) => {
      if (hasPinnedAndAgents && !dividerDrawn && !isPinned(entry)) {
        lines.push(C.dim('  ─────────────'));
        dividerDrawn = true;
      }
      const isActive = i === state.cursor;
      const pointer = isActive ? C.cyan('▶') : ' ';
      let text = entry.label;
      if (entry.kind === 'toggle') {
        const on = toggles ? toggles.isOn(entry.toggleId) : false;
        text += on ? ': ' + C.yellow('ON') : ': ' + C.dim('OFF');
      }
      const label = isActive ? C.bold(text) : text;
      lines.push(`  ${pointer} ${label}`);
    });
    if (hasPinnedAndAgents && !dividerDrawn && visible.some(isPinned)) {
      // Every visible row is a pinned row (a very short terminal folded
      // every agent row into "… and N more") — the divider still belongs
      // above that trailing line so the pinned block stays visually set
      // apart even though no agent row made it into the slice.
      lines.push(C.dim('  ─────────────'));
    }
    if (filtered.length > maxVisibleRows) {
      lines.push(C.dim(`  … and ${filtered.length - maxVisibleRows} more (keep typing to narrow)`));
    }
  }
  return lines;
}

/**
 * Raw-mode, type-to-filter interactive picker. Resolves with the selected
 * launch entry (see {@link buildLaunchEntries}), or `null` when the user
 * cancels (Escape / Ctrl+C).
 *
 * The initial cursor — and the cursor after any query-changing keystroke —
 * is seeded via {@link firstAgentIndex}, so the pinned session entry never
 * steals the default selection: type-then-Enter still lands on the top
 * persona, exactly as before the session entry existed. `reducePickerInput`
 * itself stays untouched; this re-seeding is a shell concern layered on top
 * of its pure `cursor: 0` result whenever the query changed.
 *
 * @param {Array<{id: string, label: string, description: string, kind: string, claudeArgs: string[]}>} entries
 * Enter on a `kind: 'toggle'` row flips that toggle on `toggles` and redraws
 * without resolving (query and cursor are kept); with no `toggles` model it is
 * a no-op redraw.
 *
 * @param {string} [initialQuery]
 * @param {import('./launch-toggles.js').LaunchToggles|null} [toggles]
 * @returns {Promise<object|null>}
 */
export function runInteractivePicker(entries, initialQuery = '', toggles = null) {
  return new Promise((resolve) => {
    let state = { query: initialQuery, cursor: firstAgentIndex(filterEntries(entries, initialQuery)) };
    let filtered = filterEntries(entries, state.query);

    // Full clear-and-redraw on every frame, rather than the original
    // relative "move cursor up N rows, erase to end" delta redraw (which
    // assumed the terminal's cursor tracked our own line count exactly —
    // not true on every terminal). The picker's screen is further
    // isolated from the primary buffer's scroll state via enterAltScreen()
    // below; see its docstring for why clearScreen() alone wasn't enough.
    const draw = () => {
      clearScreen();
      const lines = renderPickerLines(state, filtered, getVisibleRowBudget(), toggles);
      process.stdout.write(lines.join('\n') + '\n');
    };

    enterAltScreen();
    enterRawMode();
    draw();

    const sigintHandler = () => {
      process.off('SIGINT', sigintHandler);
      restoreTerminal();
      exitAltScreen();
      process.kill(process.pid, 'SIGINT');
    };
    process.on('SIGINT', sigintHandler);

    const cleanup = (result) => {
      process.off('SIGINT', sigintHandler);
      restoreTerminal();
      exitAltScreen();
      resolve(result);
    };

    const onKeypress = (str, key) => {
      const queryBefore = state.query;
      const next = reducePickerInput(state, { str, key }, filtered.length);
      const { action, ...nextState } = next;
      state = nextState;
      filtered = filterEntries(entries, state.query);
      if (state.query !== queryBefore) {
        state.cursor = firstAgentIndex(filtered);
      } else if (state.cursor > Math.max(0, filtered.length - 1)) {
        state.cursor = Math.max(0, filtered.length - 1);
      }

      if (action === 'select') {
        const selected = filtered[state.cursor] || null;
        if (selected && selected.kind === 'toggle') {
          toggles?.toggle(selected.toggleId);
          draw();
          return;
        }
        cleanup(selected);
        return;
      }
      if (action === 'cancel') {
        cleanup(null);
        return;
      }
      draw();
    };

    process.stdin.on('keypress', onKeypress);
  });
}

/**
 * `readline`-based fallback picker used when raw mode / a TTY isn't
 * available (CI, piped input, some SSH/tmux terminal configurations).
 * Prints a numbered, optionally pre-filtered list, then loops a single
 * prompt accepting either a number (selects that row) or free text
 * (re-filters and reprints); empty input cancels.
 *
 * @param {Array<{id: string, label: string, description: string}>} entries
 * @param {string} [initialQuery]
 * Selecting a toggle row's number flips the toggle and re-prompts instead of
 * resolving.
 *
 * @param {{readlineFactory?: Function, toggles?: import('./launch-toggles.js').LaunchToggles|null}} [opts]
 *   `readlineFactory` defaults to `readline.createInterface`; overridable for
 *   tests with a stub `{ question(prompt, cb), close() }`-shaped object.
 *   `toggles` is the shared toggle model (optional).
 * @returns {Promise<object|null>}
 */
export async function runNonInteractivePicker(entries, initialQuery = '', opts = {}) {
  const { readlineFactory = readline.createInterface, toggles = null } = opts;
  let query = initialQuery || '';
  let filtered = filterEntries(entries, query);

  const ask = (rl, prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  enterAltScreen();
  try {
    for (;;) {
      clearScreen();
      console.log('');
      if (filtered.length === 0) {
        console.log('  No matching agents.');
      } else {
        filtered.forEach((entry, i) => {
          const stateText = entry.kind === 'toggle' ? `: ${toggles?.isOn(entry.toggleId) ? 'ON' : 'OFF'}` : '';
          console.log(`  [${i + 1}] ${entry.label}${stateText}`);
        });
      }
      const warnings = toggles ? toggles.activeWarnings() : [];
      if (warnings.length > 0) {
        console.log(`  ⚠ ${warnings.join(', ')} ON`);
      }

      const rl = readlineFactory({ input: process.stdin, output: process.stdout });
      const answer = await ask(rl, '  Select a number, type to filter, or press Enter to cancel: ');
      rl.close();

      const trimmed = (answer || '').trim();
      if (!trimmed) return null;

      const num = Number(trimmed);
      if (Number.isInteger(num) && num >= 1 && num <= filtered.length) {
        const picked = filtered[num - 1];
        if (picked.kind === 'toggle') {
          toggles?.toggle(picked.toggleId);
          continue;
        }
        return picked;
      }

      query = trimmed;
      filtered = filterEntries(entries, query);
    }
  } finally {
    exitAltScreen();
  }
}
