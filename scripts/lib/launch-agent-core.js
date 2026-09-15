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
// instructions line, one blank line, and the trailing "…and N more" line
// that appears whenever the list is truncated. Reserving room for all four
// up front (rather than only when actually rendered) keeps the row budget
// stable across redraws, which matters because the query line is drawn
// first — if a redraw ever grows taller than the terminal, the terminal
// auto-scrolls and it's always the *top* line (the one showing what the
// user is currently typing) that scrolls out of view first.
const CHROME_ROWS = 4;

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
 * Case-insensitive substring filter against label, id, and description.
 * An empty/whitespace-only query returns the full list unfiltered.
 *
 * @param {Array<{id: string, label: string, description: string}>} agents
 * @param {string} query
 * @returns {Array<object>}
 */
export function filterAgents(agents, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return agents;
  return agents.filter((agent) => {
    return (
      agent.label.toLowerCase().includes(q) ||
      agent.id.toLowerCase().includes(q) ||
      (agent.description || '').toLowerCase().includes(q)
    );
  });
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

function renderPickerLines(state, filtered, maxVisibleRows = MAX_VISIBLE_ROWS) {
  const lines = [];
  lines.push(C.bold('  Filter agents:') + ' ' + state.query);
  lines.push(C.dim('  Type to filter · ↑/↓ navigate · Enter launch · Esc/Ctrl+C cancel'));
  lines.push('');
  const visible = filtered.slice(0, maxVisibleRows);
  if (visible.length === 0) {
    lines.push(C.dim('  No matches.'));
  } else {
    visible.forEach((agent, i) => {
      const isActive = i === state.cursor;
      const pointer = isActive ? C.cyan('▶') : ' ';
      const label = isActive ? C.bold(agent.label) : agent.label;
      lines.push(`  ${pointer} ${label}`);
    });
    if (filtered.length > maxVisibleRows) {
      lines.push(C.dim(`  … and ${filtered.length - maxVisibleRows} more (keep typing to narrow)`));
    }
  }
  return lines;
}

/**
 * Raw-mode, type-to-filter interactive picker. Resolves with the selected
 * agent's `id`, or `null` when the user cancels (Escape / Ctrl+C).
 *
 * @param {Array<{id: string, label: string, description: string}>} agents
 * @returns {Promise<string|null>}
 */
export function runInteractivePicker(agents) {
  return new Promise((resolve) => {
    let state = { query: '', cursor: 0 };
    let filtered = filterAgents(agents, state.query);

    // Full clear-and-redraw on every frame, rather than the original
    // relative "move cursor up N rows, erase to end" delta redraw (which
    // assumed the terminal's cursor tracked our own line count exactly —
    // not true on every terminal). The picker's screen is further
    // isolated from the primary buffer's scroll state via enterAltScreen()
    // below; see its docstring for why clearScreen() alone wasn't enough.
    const draw = () => {
      clearScreen();
      const lines = renderPickerLines(state, filtered, getVisibleRowBudget());
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
      const next = reducePickerInput(state, { str, key }, filtered.length);
      const { action, ...nextState } = next;
      state = nextState;
      filtered = filterAgents(agents, state.query);
      if (state.cursor > Math.max(0, filtered.length - 1)) {
        state.cursor = Math.max(0, filtered.length - 1);
      }

      if (action === 'select') {
        cleanup(filtered[state.cursor] ? filtered[state.cursor].id : null);
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
 * @param {Array<{id: string, label: string, description: string}>} agents
 * @param {string} [initialQuery]
 * @param {{readlineFactory?: Function}} [opts] - `readlineFactory` defaults
 *   to `readline.createInterface`; overridable for tests with a stub
 *   `{ question(prompt, cb), close() }`-shaped object.
 * @returns {Promise<string|null>}
 */
export async function runNonInteractivePicker(agents, initialQuery = '', opts = {}) {
  const { readlineFactory = readline.createInterface } = opts;
  let query = initialQuery || '';
  let filtered = filterAgents(agents, query);

  const ask = (rl, prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  enterAltScreen();
  try {
    for (;;) {
      clearScreen();
      console.log('');
      if (filtered.length === 0) {
        console.log('  No matching agents.');
      } else {
        filtered.forEach((agent, i) => {
          console.log(`  [${i + 1}] ${agent.label}`);
        });
      }

      const rl = readlineFactory({ input: process.stdin, output: process.stdout });
      const answer = await ask(rl, '  Select a number, type to filter, or press Enter to cancel: ');
      rl.close();

      const trimmed = (answer || '').trim();
      if (!trimmed) return null;

      const num = Number(trimmed);
      if (Number.isInteger(num) && num >= 1 && num <= filtered.length) {
        return filtered[num - 1].id;
      }

      query = trimmed;
      filtered = filterAgents(agents, query);
    }
  } finally {
    exitAltScreen();
  }
}
