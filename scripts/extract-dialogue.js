#!/usr/bin/env node

/**
 * scripts/extract-dialogue.js
 *
 * Extracts readable prose text from LangGraph agent chunk `.jsonl` files,
 * assembling streaming message fragments into paragraph turns and writing
 * `.md` files alongside the source `.jsonl`.
 *
 * Usage:
 *   node scripts/extract-dialogue.js <chunk-file>          Extract a single file
 *   node scripts/extract-dialogue.js <directory>           Extract all *.jsonl in a directory
 *   node scripts/extract-dialogue.js --file <path>         Explicit file path
 *   node scripts/extract-dialogue.js --dir <path>          Explicit directory path
 *   node scripts/extract-dialogue.js --force               Overwrite existing .md files
 *   node scripts/extract-dialogue.js --dry-run             Print output paths without writing
 *   node scripts/extract-dialogue.js --help, -h            Show this help
 *
 * Output format:
 *   Single-namespace files → flat prose (no section headers)
 *   Dual-namespace files   → ## Outer Agent / ## Inner Agent section headers
 *
 * No external dependencies — stdlib only (fs, path).
 */

import fs from 'fs';
import path from 'path';

// ─── Paths ────────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');

// ─── ANSI colours (disabled when stdout is not a TTY) ────────────────────────

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
Usage: node scripts/extract-dialogue.js <target> [options]

Extract readable prose text from LangGraph agent chunk .jsonl files.
Assembles streaming message fragments into paragraph turns and writes
a .md file alongside the source .jsonl (same directory, same base name).

Arguments:
  <target>            Path to a .jsonl file or a directory of .jsonl files.
                      Auto-detected via fs.statSync (file vs. directory).

Options:
  --file <path>       Explicit .jsonl file path (alternative to positional arg)
  --dir <path>        Explicit directory path (alternative to positional arg)
  --force             Overwrite existing .md files (default: skip if exists)
  --dry-run           Print output paths without writing any files
  --help, -h          Show this help text

Output format:
  Single-namespace .jsonl  →  flat prose, no section headers
  Dual-namespace .jsonl    →  ## Outer Agent / ## Inner Agent section headers

Examples:
  node scripts/extract-dialogue.js chunks/run-001.jsonl
  node scripts/extract-dialogue.js chunks/
  node scripts/extract-dialogue.js --file chunks/run-001.jsonl --force
  node scripts/extract-dialogue.js --dir chunks/ --dry-run
`;

// ─── Argument parser ──────────────────────────────────────────────────────────

/**
 * Parses CLI arguments into an options object.
 *
 * Accepts:
 *   --file <path>   Explicit .jsonl file path
 *   --dir <path>    Explicit directory path
 *   --force         Overwrite existing .md files
 *   --dry-run       Print output paths without writing
 *   --help, -h      Show help and exit
 *   <positional>    Single positional arg, auto-detected as file or directory
 *
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {{ target: string|null, isDir: boolean|null, force: boolean, dryRun: boolean, help: boolean }}
 */
function parseArgs(argv) {
  const opts = {
    target: null,
    isDir:  null,   // null = not determined yet (auto-detect from positional)
    force:  false,
    dryRun: false,
    help:   false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    // ── Boolean flags ──
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--force')              { opts.force = true; continue; }
    if (a === '--dry-run')            { opts.dryRun = true; continue; }

    // ── Positional argument (non-flag token) ──
    if (!a.startsWith('-')) {
      if (opts.target === null) {
        opts.target = a;
        opts.isDir  = null; // auto-detect via statSync
      }
      continue;
    }

    // ── Value flags — support both --flag val and --flag=val ──
    const eq  = a.indexOf('=');
    const key = eq === -1 ? a         : a.slice(0, eq);
    const val = eq === -1 ? argv[++i] : a.slice(eq + 1);

    if (key === '--file') {
      opts.target = val;
      opts.isDir  = false;
      continue;
    }
    if (key === '--dir') {
      opts.target = val;
      opts.isDir  = true;
      continue;
    }

    // Unknown flag with no '=' — we consumed argv[++i] as val above; undo.
    if (eq === -1) i--;
  }

  return opts;
}

// ─── File discovery ───────────────────────────────────────────────────────────

/**
 * Returns the list of `.jsonl` files to process for a given target path.
 *
 * - If target is a `.jsonl` file: returns `[target]`.
 * - If target is a directory: returns all `*.jsonl` files in that directory
 *   (non-recursive), sorted alphabetically.
 *
 * Resolves paths relative to `WORKSPACE_ROOT`.
 *
 * @param {string} target  Path to a .jsonl file or a directory.
 * @param {boolean|null} isDir  If true, treat as directory; if false, treat as file;
 *                              if null, auto-detect via fs.statSync.
 * @returns {string[]}  Absolute paths to .jsonl files.
 */
function discoverChunkFiles(target, isDir) {
  const resolved = path.isAbsolute(target)
    ? target
    : path.resolve(WORKSPACE_ROOT, target);

  // Auto-detect when isDir is null.
  let treatAsDir = isDir;
  if (treatAsDir === null) {
    try {
      const stat = fs.statSync(resolved);
      treatAsDir = stat.isDirectory();
    } catch {
      // Let the caller handle the missing-path error.
      return [resolved];
    }
  }

  if (!treatAsDir) {
    return [resolved];
  }

  // Directory mode: collect all *.jsonl files (non-recursive, sorted).
  try {
    const entries = fs.readdirSync(resolved);
    return entries
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .map((f) => path.join(resolved, f));
  } catch {
    return [];
  }
}

// ─── JSONL parser ─────────────────────────────────────────────────────────────

/**
 * Reads a `.jsonl` chunk file and returns its parsed data lines.
 *
 * Skips:
 *   - Empty/blank lines
 *   - The `chunk_format` header line (first line with key `chunk_format`)
 *   - Malformed lines that cannot be parsed as JSON
 *
 * @param {string} filePath  Absolute path to the .jsonl file.
 * @returns {object[]}  Array of parsed chunk objects (with `ns` and `msg` fields).
 */
function parseJsonl(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const rawLines = content.split('\n');
  const nonEmpty = rawLines.map((l) => l.trim()).filter(Boolean);

  if (nonEmpty.length === 0) return [];

  // Skip the header line (first line with `chunk_format` key).
  const firstLine = nonEmpty[0];
  let dataLines;
  try {
    const firstParsed = JSON.parse(firstLine);
    if (firstParsed && typeof firstParsed === 'object' && 'chunk_format' in firstParsed) {
      dataLines = nonEmpty.slice(1);
    } else {
      dataLines = nonEmpty;
    }
  } catch {
    dataLines = nonEmpty;
  }

  const entries = [];
  for (const line of dataLines) {
    try {
      const parsed = JSON.parse(line);

      // Normalise object shape: { ns, msg } and array shape: [ns, msg, metadata].
      if (Array.isArray(parsed) && parsed.length >= 2) {
        entries.push({ ns: parsed[0], msg: parsed[1] });
      } else if (parsed && typeof parsed === 'object' && 'ns' in parsed && 'msg' in parsed) {
        entries.push({ ns: parsed.ns, msg: parsed.msg });
      }
      // Lines that don't match either shape are silently skipped.
    } catch {
      // Malformed JSON — skip silently.
    }
  }

  return entries;
}

// ─── Text assembly ────────────────────────────────────────────────────────────

/**
 * Extracts plain text content from a content value.
 *
 * Handles:
 *   - string content (returned as-is)
 *   - array of content blocks (joins `text`-type blocks)
 *
 * @param {string|Array|null|undefined} content
 * @returns {string}
 */
function extractContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
    } else if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
    // Skip tool_use, input_json_delta, and other non-text block types.
  }
  return parts.join('');
}

/**
 * Assembles streaming chunk entries into per-namespace prose text.
 *
 * Groups AIMessageChunk entries by `msg.id` within each namespace:
 *   - `ns.length === 0` (empty array) → outer / sole agent
 *   - `ns.length > 0`                 → inner agent
 *
 * Concatenates `content` text fragments per AI turn, then joins
 * non-empty turns with `'\n\n'`.
 *
 * @param {object[]} entries  Parsed chunk objects from `parseJsonl()`.
 * @returns {{ outer: string, inner: string }}  Assembled prose per namespace depth.
 */
function assembleText(entries) {
  // Map: namespaceKey → Map(messageId → string)
  // We use two buckets: outer (ns.length === 0) and inner (ns.length > 0).
  // Within each bucket, messages are accumulated in insertion order by id.
  const outerMessages = new Map(); // msgId → accumulated text
  const innerMessages = new Map(); // msgId → accumulated text

  for (const entry of entries) {
    const { ns, msg } = entry;
    if (!msg || typeof msg !== 'object') continue;

    const msgType = typeof msg.type === 'string' ? msg.type.toLowerCase() : '';
    // Only process AI message types.
    if (msgType !== 'ai' && msgType !== 'aimessage' && msgType !== 'aimessagechunk') continue;

    const msgId = typeof msg.id === 'string' ? msg.id : '';
    if (!msgId) continue;

    const text = extractContent(msg.content);
    if (!text) continue;

    const isInner = Array.isArray(ns) && ns.length > 0;
    const bucket  = isInner ? innerMessages : outerMessages;

    bucket.set(msgId, (bucket.get(msgId) ?? '') + text);
  }

  // Join accumulated turn texts with double newlines, filtering blank turns.
  const joinTurns = (msgMap) =>
    [...msgMap.values()]
      .map((t) => t.trim())
      .filter(Boolean)
      .join('\n\n');

  return {
    outer: joinTurns(outerMessages),
    inner: joinTurns(innerMessages),
  };
}

// ─── Per-file extractor ───────────────────────────────────────────────────────

/**
 * Extracts prose text from a single `.jsonl` chunk file and writes a `.md` file
 * alongside it (same directory, same base name, `.jsonl` → `.md`).
 *
 * Behaviour:
 *   - Skips write if the `.md` already exists and `opts.force` is false.
 *   - With `opts.dryRun`, prints the output path without writing.
 *   - Single-namespace output: flat prose (no section headers).
 *   - Dual-namespace output: `## Outer Agent` / `## Inner Agent` headers.
 *
 * @param {string} chunkPath  Absolute path to the source `.jsonl` file.
 * @param {{ force: boolean, dryRun: boolean }} opts
 * @returns {{ status: 'written'|'skipped'|'dry-run'|'empty', mdPath: string }}
 */
function extractFile(chunkPath, opts) {
  // Derive the output path from the validated source path (server-side derivation
  // only — never from user-controlled filenames in the API case).
  const ext    = path.extname(chunkPath);          // '.jsonl'
  const base   = path.basename(chunkPath, ext);    // e.g. 'run-001'
  const dir    = path.dirname(chunkPath);
  const mdPath = path.join(dir, base + '.md');

  // Dry-run: print path and exit early.
  if (opts.dryRun) {
    console.log(C.cyan(mdPath));
    return { status: 'dry-run', mdPath };
  }

  // Skip if the .md already exists and --force was not passed.
  if (!opts.force && fs.existsSync(mdPath)) {
    console.log(C.dim(`  skip  ${mdPath} (already exists; use --force to overwrite)`));
    return { status: 'skipped', mdPath };
  }

  // Parse and assemble.
  const entries          = parseJsonl(chunkPath);
  const { outer, inner } = assembleText(entries);
  const hasOuter         = outer.length > 0;
  const hasInner         = inner.length > 0;
  const hasDual          = hasOuter && hasInner;  // both namespaces have content
  const hasContent       = hasOuter || hasInner;

  let mdContent;
  if (!hasContent) {
    mdContent = '*No dialogue recorded.*\n';
  } else if (hasDual) {
    // Both outer and inner namespaces have prose — emit section headers.
    const parts = [
      '## Outer Agent',
      '',
      outer,
      '',
      '## Inner Agent',
      '',
      inner,
    ];
    mdContent = parts.join('\n') + '\n';
  } else {
    // Single-namespace: flat prose (whichever namespace has content).
    mdContent = (hasOuter ? outer : inner) + '\n';
  }

  fs.writeFileSync(mdPath, mdContent, 'utf8');
  console.log(C.green(`  write ${mdPath}`));
  return { status: hasContent ? 'written' : 'empty', mdPath };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (!opts.target) {
    console.error(C.red('Error: No target specified. Pass a .jsonl file or directory path.'));
    console.error('       Run with --help for usage information.');
    process.exit(1);
  }

  // Validate that the target exists before discovery.
  const resolved = path.isAbsolute(opts.target)
    ? opts.target
    : path.resolve(WORKSPACE_ROOT, opts.target);

  if (!fs.existsSync(resolved)) {
    console.error(C.red(`Error: Path not found: ${resolved}`));
    process.exit(1);
  }

  const files = discoverChunkFiles(opts.target, opts.isDir);

  if (files.length === 0) {
    console.log(C.yellow('No .jsonl files found.'));
    process.exit(0);
  }

  let written  = 0;
  let skipped  = 0;
  let dryRuns  = 0;
  let empties  = 0;

  for (const file of files) {
    const result = extractFile(file, { force: opts.force, dryRun: opts.dryRun });
    if (result.status === 'written')  written++;
    if (result.status === 'skipped')  skipped++;
    if (result.status === 'dry-run')  dryRuns++;
    if (result.status === 'empty')    empties++;
  }

  // Summary line.
  if (opts.dryRun) {
    console.log(C.dim(`\n${dryRuns} file(s) would be written (dry-run).`));
  } else {
    const parts = [];
    if (written > 0) parts.push(C.green(`${written} written`));
    if (skipped > 0) parts.push(C.dim(`${skipped} skipped`));
    if (empties > 0) parts.push(C.yellow(`${empties} empty`));
    if (parts.length > 0) {
      console.log(`\n${parts.join(', ')}.`);
    }
  }
}

main();
