#!/usr/bin/env node

/**
 * scripts/read-log.js
 *
 * Structured, cross-platform reader for orchestrator JSONL run logs.
 * Replaces ad-hoc jq/grep pipelines with simple flag-based queries.
 *
 * Usage:
 *   node scripts/read-log.js                        Last 20 entries, most recent log
 *   node scripts/read-log.js --errors               Only ERROR + WARNING entries
 *   node scripts/read-log.js --actions route        Filter by action type(s)
 *   node scripts/read-log.js --wp WP-003            Filter to a specific WP
 *   node scripts/read-log.js --summary              One-line run overview
 *   node scripts/read-log.js --slug my-project      Target latest log matching slug
 *   node scripts/read-log.js --file path/to/log     Explicit log file
 *   node scripts/read-log.js --format json          JSON array output
 *   node scripts/read-log.js --help                 Show this help
 *
 * No external dependencies — stdlib only (fs, path).
 */

import fs from 'fs';
import path from 'path';

// ─── Paths ────────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');
const LOGS_DIR       = path.join(WORKSPACE_ROOT, 'orchestrator', 'logs');

// ─── ANSI colors (disabled when stdout is not a TTY) ─────────────────────────

const USE_COLOR = process.stdout.isTTY;

const C = {
  reset:  (s) => USE_COLOR ? `\x1b[0m${s}\x1b[0m` : s,
  dim:    (s) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   (s) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  red:    (s) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  green:  (s) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:   (s) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
Usage: node scripts/read-log.js [options]

Query and filter orchestrator JSONL run logs.

Log Selection:
  (default)           Most recent .jsonl file in orchestrator/logs/
  --slug <name>       Latest log whose filename ends with -<name>.jsonl
  --file <path>       Explicit log file path (absolute or relative to workspace root)

Filtering:
  --last <n>          Show last N entries (default: 20 when no other filter is set)
  --actions <types>   Filter by action type(s), comma-separated
                      e.g. --actions route,stage_complete
  --level <levels>    Filter by log level(s), comma-separated (case-insensitive)
                      e.g. --level ERROR,WARNING
  --errors            Shorthand for --level ERROR,WARNING
  --wp <id>           Filter to a specific work package, e.g. --wp WP-003
  --summary           Print one-line run overview with token totals

Output:
  --format text       Human-readable colored output (default)
  --format json       Raw JSON array to stdout (for piping)

  --help, -h          Show this help text

Examples:
  node scripts/read-log.js
  node scripts/read-log.js --last 50
  node scripts/read-log.js --errors
  node scripts/read-log.js --actions route
  node scripts/read-log.js --actions stage_start,stage_complete
  node scripts/read-log.js --wp WP-003
  node scripts/read-log.js --summary
  node scripts/read-log.js --slug my-project-slug
  node scripts/read-log.js --errors --format json
  node scripts/read-log.js --file orchestrator/logs/20260324T142851-my-run.jsonl
`;

// ─── Argument parser ──────────────────────────────────────────────────────────

/**
 * Minimal CLI arg parser — no external dependencies.
 * Supports both `--flag value` and `--flag=value` forms.
 *
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {{
 *   last: number|null,
 *   actions: string[]|null,
 *   level: string[]|null,
 *   errors: boolean,
 *   wp: string|null,
 *   summary: boolean,
 *   slug: string|null,
 *   file: string|null,
 *   format: string,
 *   help: boolean,
 * }}
 */
function parseArgs(argv) {
  const opts = {
    last:    null,
    actions: null,
    level:   null,
    errors:  false,
    wp:      null,
    summary: false,
    slug:    null,
    file:    null,
    format:  'text',
    help:    false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    // ── boolean flags ──
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--errors')    { opts.errors = true; continue; }
    if (a === '--summary')   { opts.summary = true; continue; }

    // ── value flags — support both --flag val and --flag=val ──
    const eq = a.indexOf('=');
    const key = eq === -1 ? a         : a.slice(0, eq);
    const val = eq === -1 ? argv[++i] : a.slice(eq + 1);

    switch (key) {
      case '--last':
        { const n = parseInt(val, 10); if (!isNaN(n) && n > 0) opts.last = n; break; }
      case '--actions':
        opts.actions = val.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--level':
        opts.level = val.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
        break;
      case '--wp':
        opts.wp = val;
        break;
      case '--slug':
        opts.slug = val;
        break;
      case '--file':
        opts.file = val;
        break;
      case '--format':
        opts.format = val.toLowerCase();
        break;
      default:
        // unknown flag — ignore silently
        if (eq === -1) i--; // undo argv[++i] that consumed the next element as val
        break;
    }
  }

  return opts;
}

// ─── Log discovery ────────────────────────────────────────────────────────────

/**
 * Return sorted list of .jsonl file paths from the logs directory.
 * Alphabetical sort = chronological (filenames start with YYYYMMDDTHHmmSS).
 *
 * @param {string} logsDir
 * @returns {string[]}
 */
function discoverLogs(logsDir) {
  if (!fs.existsSync(logsDir)) return [];
  return fs
    .readdirSync(logsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => path.join(logsDir, f));
}

// ─── JSONL parser ─────────────────────────────────────────────────────────────

/**
 * Parse every line of a JSONL file, silently skipping malformed lines.
 *
 * @param {string} filePath
 * @returns {object[]}
 */
function parseJsonl(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      entries.push(JSON.parse(t));
    } catch {
      // malformed line — skip silently
    }
  }
  return entries;
}

// ─── Filtering ────────────────────────────────────────────────────────────────

/**
 * Apply filter flags to an array of parsed log entries.
 * --last is applied last (tail semantics).
 *
 * @param {object[]} entries
 * @param {object} opts  parsed args
 * @returns {object[]}
 */
function applyFilters(entries, opts) {
  let result = entries;

  // --wp
  if (opts.wp) {
    result = result.filter((e) => e.wp_id === opts.wp);
  }

  // --actions
  if (opts.actions) {
    const set = new Set(opts.actions);
    result = result.filter((e) => set.has(e.action));
  }

  // --level / --errors
  const levels = opts.errors
    ? new Set(['ERROR', 'WARNING'])
    : opts.level ? new Set(opts.level) : null;
  if (levels) {
    result = result.filter((e) => levels.has((e.level || 'INFO').toUpperCase()));
  }

  // --last N (default 20 when no other filter is active)
  const noActiveFilter = !opts.wp && !opts.actions && !levels;
  const lastN = opts.last !== null
    ? opts.last
    : (noActiveFilter ? 20 : null);
  if (lastN !== null) {
    result = result.slice(-lastN);
  }

  return result;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/**
 * Format a duration in seconds as a human-readable string.
 * Matches orchestrator/src/utils/logging.py::_format_duration()
 *
 * @param {number|null|undefined} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '';
  const secs = Math.round(seconds);
  if (secs < 60) return `${secs}s`;
  const minutes = Math.floor(secs / 60);
  const remSecs  = secs % 60;
  if (minutes < 60) return `${minutes}m ${remSecs}s`;
  const hours   = Math.floor(minutes / 60);
  const remMins = minutes % 60;
  return `${hours}h ${remMins}m`;
}

/**
 * Extract HH:MM:SS from an ISO 8601 timestamp string.
 *
 * @param {string|undefined} ts
 * @returns {string}
 */
function formatTime(ts) {
  if (!ts) return '??:??:??';
  try {
    return new Date(ts).toISOString().slice(11, 19);
  } catch {
    return '??:??:??';
  }
}

/**
 * Format a number with comma-separated thousands (cross-platform).
 *
 * @param {number} n
 * @returns {string}
 */
function numFmt(n) {
  const s = String(Math.round(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ─── Text entry formatter ─────────────────────────────────────────────────────

/**
 * Format a single log entry as one human-readable line.
 *
 * Pattern:  HH:MM:SS [stage] WP-NNN action → result (duration, tokens)
 *
 * @param {object} entry
 * @returns {string}
 */
function formatEntry(entry) {
  const time   = formatTime(entry.timestamp);
  const stage  = entry.stage  || '—';
  const wpId   = entry.wp_id  || '';
  const action = entry.action || '?';
  const result = entry.result || '';
  const level  = (entry.level || 'INFO').toUpperCase();

  const stageStr = C.cyan(`[${stage}]`);
  const parts = [`${time} ${stageStr}`];

  if (wpId) parts.push(wpId);
  parts.push(action);

  if (result) {
    const arrow = result === 'PASS' ? C.green(`→ ${result}`) : C.red(`→ ${result}`);
    parts.push(arrow);
  }

  // Detail: duration + tokens
  const details = [];
  if (entry.duration_s !== null && entry.duration_s !== undefined) {
    const d = formatDuration(entry.duration_s);
    if (d) details.push(d);
  }
  if (entry.tokens_used && typeof entry.tokens_used === 'object') {
    const t = entry.tokens_used.total_tokens;
    if (t) details.push(`${numFmt(t)} tokens`);
  }
  if (details.length > 0) parts.push(`(${details.join(', ')})`);

  // Model tag for stage_start (mirrors logging.py _build_stream_console_line)
  if (action === 'stage_start' && entry.model) {
    parts.push(C.dim(`[${entry.model}]`));
  }

  let line = parts.filter(Boolean).join(' ');

  // Level-based coloring (applied to whole line)
  if (level === 'ERROR')   return C.red(line);
  if (level === 'WARNING') return C.yellow(line);
  return line;
}

// ─── Summary mode ─────────────────────────────────────────────────────────────

/**
 * Build the one-line run summary from the full entries array.
 *
 * Format: Run: <ts> | Duration: <d> | WPs: N (x complete, ...) |
 *         Result: <r> | Tokens: N (in: N / out: N) | Errors: N | Warnings: N
 *
 * @param {object[]} entries
 * @returns {string}
 */
function buildSummary(entries) {
  const runStart        = entries.find((e) => e.action === 'run_start');
  const runEnd          = entries.find((e) => e.action === 'run_end');
  const progressEntries = entries.filter((e) => e.action === 'progress_snapshot');
  const lastProgress    = progressEntries[progressEntries.length - 1];

  // Token totals from all stage_complete entries
  let tokenIn = 0, tokenOut = 0, hasTokens = false;
  for (const e of entries) {
    if (e.action === 'stage_complete' && e.tokens_used) {
      tokenIn  += e.tokens_used.input_tokens  || 0;
      tokenOut += e.tokens_used.output_tokens || 0;
      hasTokens = true;
    }
  }

  // Error / warning counts
  let errorCount = 0, warnCount = 0;
  for (const e of entries) {
    const lvl = (e.level || '').toUpperCase();
    if (lvl === 'ERROR')   errorCount++;
    else if (lvl === 'WARNING') warnCount++;
  }

  const parts = [];

  // Run timestamp
  const ts = runStart?.run_start_ts || runStart?.timestamp;
  if (ts) parts.push(`Run: ${ts}`);

  // Duration
  const totalDur = runEnd?.total_duration_s;
  if (totalDur !== undefined && totalDur !== null) {
    parts.push(`Duration: ${formatDuration(totalDur)}`);
  } else if (lastProgress?.elapsed_s !== undefined) {
    parts.push(`Elapsed: ${formatDuration(lastProgress.elapsed_s)}`);
  }

  // WP counts
  if (lastProgress) {
    const total     = lastProgress.total_wps || 0;
    const breakdown = lastProgress.status_breakdown || {};
    const complete  = breakdown.COMPLETE    || 0;
    const inProg    = breakdown.IN_PROGRESS || 0;
    const ready     = breakdown.READY       || 0;
    const detail    = [];
    if (complete) detail.push(`${complete} complete`);
    if (inProg)   detail.push(`${inProg} in-progress`);
    if (ready)    detail.push(`${ready} ready`);
    parts.push(`WPs: ${total}${detail.length ? ` (${detail.join(', ')})` : ''}`);
  }

  // Result
  const result = runEnd?.result || (runEnd ? 'COMPLETE' : 'IN_PROGRESS');
  parts.push(`Result: ${result}`);

  // Tokens
  if (hasTokens) {
    const total = tokenIn + tokenOut;
    parts.push(`Tokens: ${numFmt(total)} (in: ${numFmt(tokenIn)} / out: ${numFmt(tokenOut)})`);
  }

  parts.push(`Errors: ${errorCount}`);
  parts.push(`Warnings: ${warnCount}`);

  return parts.join(' | ');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  // ── Resolve log file ──
  let filePath;

  if (opts.file) {
    filePath = path.isAbsolute(opts.file)
      ? opts.file
      : path.resolve(WORKSPACE_ROOT, opts.file);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
  } else {
    const allLogs = discoverLogs(LOGS_DIR);
    if (allLogs.length === 0) {
      console.error(`No log files found in ${LOGS_DIR}`);
      process.exit(1);
    }

    if (opts.slug) {
      const suffix = `-${opts.slug}.jsonl`;
      const matched = allLogs.filter((f) => path.basename(f).endsWith(suffix));
      if (matched.length === 0) {
        console.error(`No log files found matching slug: ${opts.slug}`);
        process.exit(1);
      }
      filePath = matched[matched.length - 1]; // latest among matches
    } else {
      filePath = allLogs[allLogs.length - 1]; // latest overall
    }
  }

  // ── Parse JSONL ──
  let entries;
  try {
    entries = parseJsonl(filePath);
  } catch (err) {
    console.error(`Failed to read log file: ${err.message}`);
    process.exit(1);
  }

  // ── Summary mode ──
  if (opts.summary) {
    console.log(buildSummary(entries));
    process.exit(0);
  }

  // ── Apply filters ──
  const filtered = applyFilters(entries, opts);

  // ── Output ──
  if (opts.format === 'json') {
    console.log(JSON.stringify(filtered, null, 2));
  } else {
    // Print a dim header showing which file is being read.
    // Use relative path when the file is inside the workspace, absolute otherwise.
    const rel = path.relative(WORKSPACE_ROOT, filePath);
    const displayPath = rel.startsWith('..') ? filePath : rel;
    console.log(C.dim(`Log: ${displayPath}\n`));

    if (filtered.length === 0) {
      console.log(C.dim('(no entries match the filter)'));
    } else {
      for (const entry of filtered) {
        console.log(formatEntry(entry));
      }
    }
  }

  process.exit(0);
}

main();
