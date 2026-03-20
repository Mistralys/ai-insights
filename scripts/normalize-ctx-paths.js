#!/usr/bin/env node
'use strict';

/**
 * normalize-ctx-paths.js
 *
 * Post-processes CTX-generated Markdown files in .context/ to replace
 * Windows backslash path separators with forward slashes.
 *
 * CTX emits OS-native separators in its "###  Path:" header lines.
 * On Windows these contain backslashes, which causes noisy Git diffs
 * when the same files are regenerated on Linux/macOS.
 *
 * This script surgically targets only the CTX structural patterns
 * (Path headers, directory-structure lines) and leaves fenced code
 * blocks untouched so source-code content is never mangled.
 *
 * Usage:
 *   node scripts/normalize-ctx-paths.js          # default: .context/
 *   node scripts/normalize-ctx-paths.js <dir>    # custom directory
 */

const fs   = require('fs');
const path = require('path');

const targetDir = process.argv[2]
  || path.join(__dirname, '..', '.context');

if (!fs.existsSync(targetDir)) {
  console.error(`Directory not found: ${targetDir}`);
  process.exit(1);
}

/** Collect all .md files recursively. */
function collectMarkdown(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdown(full));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

// Patterns that CTX generates outside fenced code blocks where
// backslashes represent path separators (not escape sequences):
//
//   ###  Path: `\mcp-server\src\tools/begin-work.ts`
//   └── mcp-server\src\
//
// We match these specifically to avoid replacing backslashes in
// inline code or documentation text (e.g. "\n", "\d", regex escapes).

/** Regex for CTX "Path:" header lines: ###  Path: `…` */
const PATH_HEADER_RE = /^(#{1,6}\s+Path:\s*`)([^`]+)(`.*)$/;

/** Regex for CTX directory-structure lines (└──, ├──, │) with paths */
const TREE_LINE_RE = /^(\s*(?:└──|├──|│\s+(?:└──|├──))\s+)(.+)$/;

/**
 * Normalize backslash path separators in CTX structural lines only.
 * Skips all content inside fenced code blocks.
 *
 * Returns the updated content string, or null if nothing changed.
 */
function normalizePaths(content) {
  const lines   = content.split('\n');
  let inFence   = false;
  let changed   = false;

  for (let i = 0; i < lines.length; i++) {
    // Track fenced code blocks (``` or ~~~)
    if (/^(`{3,}|~{3,})/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    let m;

    // ###  Path: `\dir\file.ts`  →  ###  Path: `/dir/file.ts`
    if ((m = lines[i].match(PATH_HEADER_RE))) {
      const normalized = m[2].replace(/\\/g, '/');
      if (normalized !== m[2]) {
        lines[i] = m[1] + normalized + m[3];
        changed = true;
      }
      continue;
    }

    // └── dir\subdir\  →  └── dir/subdir/
    if ((m = lines[i].match(TREE_LINE_RE))) {
      const normalized = m[2].replace(/\\/g, '/');
      if (normalized !== m[2]) {
        lines[i] = m[1] + normalized;
        changed = true;
      }
    }
  }

  return changed ? lines.join('\n') : null;
}

// ── Main ────────────────────────────────────────────────────────────────────────

const files = collectMarkdown(targetDir);
let totalFixed = 0;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const updated = normalizePaths(content);
  if (updated !== null) {
    fs.writeFileSync(file, updated, 'utf8');
    totalFixed++;
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    console.log(`  normalized: ${rel}`);
  }
}

if (totalFixed > 0) {
  console.log(`\nNormalized paths in ${totalFixed} file(s).`);
} else {
  console.log('All paths already use forward slashes.');
}
