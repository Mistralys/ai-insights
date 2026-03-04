'use strict';

/**
 * extract-changelog-entry.js
 *
 * Parses changelog.md from the workspace root and extracts the topmost entry.
 *
 * Outputs:
 *   - When run locally (GITHUB_OUTPUT not set): prints JSON to stdout.
 *   - When run in GitHub Actions (GITHUB_OUTPUT is set): writes step outputs
 *     (version, title, body) in the multiline heredoc format expected by the
 *     Actions runner.
 *
 * Exit codes:
 *   0 — success
 *   1 — changelog.md not found, unreadable, or malformed (no parseable entry)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Locate changelog.md (always relative to workspace root = parent of scripts/)
// ---------------------------------------------------------------------------
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const CHANGELOG_PATH = path.join(WORKSPACE_ROOT, 'changelog.md');

// ---------------------------------------------------------------------------
// Read file
// ---------------------------------------------------------------------------
let raw;
try {
  raw = fs.readFileSync(CHANGELOG_PATH, 'utf8');
} catch (err) {
  process.stderr.write(`extract-changelog-entry: cannot read changelog.md: ${err.message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse: find topmost ## v* entry
// ---------------------------------------------------------------------------
// Normalise line endings so the regex anchor ($) works on Windows checkouts
const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

// Header pattern: ## v{version} [-—] {title} (optional date in parens)
const HEADER_RE = /^## (v[\d.]+(?:-\w+)?)\s+[-\u2014]\s+(.+?)(?:\s*\(\d{4}-\d{2}-\d{2}\))?$/;

let version = null;
let title = null;
let bodyLines = [];
let inEntry = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  if (!inEntry) {
    const m = HEADER_RE.exec(line);
    if (m) {
      version = m[1];
      title = m[2].trim();
      inEntry = true;
    }
  } else {
    // Stop at the next ## heading
    if (line.startsWith('## ')) {
      break;
    }
    // Collect non-empty lines as body
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      bodyLines.push(trimmed);
    }
  }
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------
if (!version || !title) {
  process.stderr.write(
    'extract-changelog-entry: no parseable ## v* entry found in changelog.md\n'
  );
  process.exit(1);
}

const body = bodyLines.join('\n');

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const githubOutput = process.env.GITHUB_OUTPUT;

if (githubOutput) {
  // GitHub Actions multiline heredoc format
  // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/passing-information-between-jobs
  const delimiter = 'EOF_BODY';
  const outputContent =
    `version=${version}\n` +
    `title=${title}\n` +
    `body<<${delimiter}\n${body}\n${delimiter}\n`;

  try {
    fs.appendFileSync(githubOutput, outputContent, 'utf8');
  } catch (err) {
    process.stderr.write(
      `extract-changelog-entry: cannot write to GITHUB_OUTPUT file: ${err.message}\n`
    );
    process.exit(1);
  }
} else {
  // Local: pretty-print JSON for inspection
  const result = { version, title, body };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
