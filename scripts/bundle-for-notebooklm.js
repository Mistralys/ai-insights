#!/usr/bin/env node

/**
 * scripts/bundle-for-notebooklm.js
 *
 * Bundles the MCP Server's README + project manifest and the Ledger Personas'
 * README + project manifest into a single Markdown file suitable for import
 * into Google NotebookLM (or any tool that ingests a single document).
 *
 * Each source file is wrapped in a clearly labelled section so NotebookLM can
 * reason about the two sub-projects coherently.
 *
 * Usage:
 *   node scripts/bundle-for-notebooklm.js                 # writes to dist/notebooklm-bundle.md
 *   node scripts/bundle-for-notebooklm.js --out custom.md  # custom output path
 *   node scripts/bundle-for-notebooklm.js --dry-run        # preview to stdout
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

const MCP_README       = path.join(WORKSPACE_ROOT, 'mcp-server', 'README.md');
const MCP_MANIFEST_DIR = path.join(WORKSPACE_ROOT, 'mcp-server', 'docs', 'agents', 'project-manifest');

const PERSONAS_README       = path.join(WORKSPACE_ROOT, 'personas', 'ledger', 'README.md');
const PERSONAS_MANIFEST_DIR = path.join(WORKSPACE_ROOT, 'personas', 'docs', 'agents', 'project-manifest');

const DEFAULT_OUTPUT = path.join(WORKSPACE_ROOT, 'dist', 'notebooklm-bundle.md');

// Manifest section files in reading order (README.md first, then the sections
// in the same order they appear in the manifest's table of contents).
const MANIFEST_SECTIONS = [
  'README.md',
  'tech-stack.md',
  'file-tree.md',
  'api-surface.md',
  'data-flows.md',
  'constraints.md',
];

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const c = {
  reset:  '\x1b[0m',
  bright: '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  red:    '\x1b[31m',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a file and return its contents, trimming trailing whitespace.
 * Exits with code 1 if the file does not exist.
 */
function readRequired(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`${c.red}ERROR${c.reset}: Required file not found: ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf-8').trimEnd();
}

/**
 * Build a Markdown section from a directory of manifest files.
 * Each file becomes a sub-section separated by a horizontal rule.
 */
function buildManifestBlock(dir, label) {
  const parts = [];
  for (const file of MANIFEST_SECTIONS) {
    const filePath = path.join(dir, file);
    const content  = readRequired(filePath);
    const relPath  = path.relative(WORKSPACE_ROOT, filePath).replace(/\\/g, '/');
    parts.push(`<!-- source: ${relPath} -->\n${content}`);
  }
  return parts.join('\n\n---\n\n');
}

/**
 * Wrap a block of content in a top-level document section.
 */
function section(heading, body) {
  const divider = '='.repeat(heading.length + 4);
  return [
    `<!-- ${'='.repeat(72)} -->`,
    `<!-- ${heading} -->`,
    `<!-- ${'='.repeat(72)} -->`,
    '',
    body,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args     = process.argv.slice(2);
const dryRun   = args.includes('--dry-run');
const outIndex = args.indexOf('--out');
const outPath  = outIndex !== -1 ? path.resolve(args[outIndex + 1]) : DEFAULT_OUTPUT;

if (outIndex !== -1 && !args[outIndex + 1]) {
  console.error(`${c.red}ERROR${c.reset}: --out requires a file path argument.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Assemble the bundle
// ---------------------------------------------------------------------------

console.log(`${c.bright}[bundle-for-notebooklm]${c.reset} Assembling bundle...\n`);

const parts = [];

// ---- Preamble ----
parts.push([
  '# AI Insights — Combined Reference for NotebookLM',
  '',
  `> **Generated:** ${new Date().toISOString().slice(0, 10)}`,
  '> ',
  '> This document bundles the core documentation from two sub-projects in the',
  '> **AI Insights** workspace so that NotebookLM can reason about them in a',
  '> single source.',
  '>',
  '> **Contents:**',
  '> 1. Project Ledger MCP Server — README + Project Manifest',
  '> 2. Ledger Personas Build System — README + Project Manifest',
].join('\n'));

// ---- MCP Server README ----
console.log(`  ${c.cyan}+${c.reset} MCP Server README`);
const mcpReadme = readRequired(MCP_README);
parts.push(section(
  'PART 1A — MCP SERVER README',
  mcpReadme,
));

// ---- MCP Server Manifest ----
console.log(`  ${c.cyan}+${c.reset} MCP Server Project Manifest (${MANIFEST_SECTIONS.length} files)`);
const mcpManifest = buildManifestBlock(MCP_MANIFEST_DIR, 'MCP Server');
parts.push(section(
  'PART 1B — MCP SERVER PROJECT MANIFEST',
  mcpManifest,
));

// ---- Personas README ----
console.log(`  ${c.cyan}+${c.reset} Ledger Personas README`);
const personasReadme = readRequired(PERSONAS_README);
parts.push(section(
  'PART 2A — LEDGER PERSONAS README',
  personasReadme,
));

// ---- Personas Manifest ----
console.log(`  ${c.cyan}+${c.reset} Ledger Personas Project Manifest (${MANIFEST_SECTIONS.length} files)`);
const personasManifest = buildManifestBlock(PERSONAS_MANIFEST_DIR, 'Personas');
parts.push(section(
  'PART 2B — LEDGER PERSONAS PROJECT MANIFEST',
  personasManifest,
));

// ---- Combine ----
const bundle = parts.join('\n\n---\n\n') + '\n';

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (dryRun) {
  console.log(`\n${c.yellow}--dry-run${c.reset}: Would write ${bundle.length.toLocaleString()} characters to ${outPath}\n`);
  console.log(bundle);
  process.exit(0);
}

// Ensure output directory exists
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

fs.writeFileSync(outPath, bundle, 'utf-8');

const relOut = path.relative(WORKSPACE_ROOT, outPath).replace(/\\/g, '/');
const sizeKB = (Buffer.byteLength(bundle, 'utf-8') / 1024).toFixed(1);

console.log(`\n${c.green}✔${c.reset} Bundle written to ${c.bright}${relOut}${c.reset} (${sizeKB} KB)`);
console.log(`  Ready to import into NotebookLM.\n`);
