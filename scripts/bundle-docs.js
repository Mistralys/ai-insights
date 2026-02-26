#!/usr/bin/env node

/**
 * scripts/bundle-docs.js
 *
 * Generates two standalone Markdown bundles into the build/ directory:
 *
 *   1. notebooklm-bundle.md     — MCP Server + Ledger Personas READMEs and
 *                                  project manifests, suitable for Google
 *                                  NotebookLM import.
 *   2. workflow-specification.md — All files from the Workflow Specification
 *                                  compiled into a single document.
 *
 * Usage:
 *   node scripts/bundle-docs.js                       # build both bundles
 *   node scripts/bundle-docs.js --only notebooklm     # build only the NotebookLM bundle
 *   node scripts/bundle-docs.js --only workflow-spec   # build only the workflow spec
 *   node scripts/bundle-docs.js --dry-run              # preview sizes, write nothing
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');

// NotebookLM sources
const MCP_README            = path.join(ROOT, 'mcp-server', 'README.md');
const MCP_MANIFEST_DIR      = path.join(ROOT, 'mcp-server', 'docs', 'agents', 'project-manifest');
const PERSONAS_README       = path.join(ROOT, 'personas', 'ledger', 'README.md');
const PERSONAS_MANIFEST_DIR = path.join(ROOT, 'personas', 'docs', 'agents', 'project-manifest');

const MANIFEST_SECTIONS = [
  'README.md',
  'tech-stack.md',
  'file-tree.md',
  'api-surface.md',
  'data-flows.md',
  'constraints.md',
];

// Workflow specification sources
const SPEC_DIR = path.join(ROOT, 'mcp-server', 'docs', 'agents', 'workflow-specification');

const SPEC_SECTION_FILES = [
  'data-model.md',
  'state-machines.md',
  'pipeline-routing.md',
  'operations.md',
  'handoff-and-recommendations.md',
  'dependencies-and-rework.md',
  'auxiliary-systems.md',
  'edge-cases.md',
  'walkthrough.md',
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

function readRequired(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`${c.red}ERROR${c.reset}: Required file not found: ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf-8').trimEnd();
}

function sizeKB(content) {
  return (Buffer.byteLength(content, 'utf-8') / 1024).toFixed(1);
}

function section(heading, body) {
  return [
    `<!-- ${'='.repeat(72)} -->`,
    `<!-- ${heading} -->`,
    `<!-- ${'='.repeat(72)} -->`,
    '',
    body,
  ].join('\n');
}

function buildManifestBlock(dir) {
  const parts = [];
  for (const file of MANIFEST_SECTIONS) {
    const filePath = path.join(dir, file);
    const content  = readRequired(filePath);
    const relPath  = path.relative(ROOT, filePath).replace(/\\/g, '/');
    parts.push(`<!-- source: ${relPath} -->\n${content}`);
  }
  return parts.join('\n\n---\n\n');
}

function writeBundle(filePath, content, dryRun) {
  const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');

  if (dryRun) {
    console.log(`  ${c.yellow}dry-run${c.reset}: ${relPath} (${sizeKB(content)} KB)`);
    return;
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`  ${c.green}\u2714${c.reset} ${c.bright}${relPath}${c.reset} (${sizeKB(content)} KB)`);
}

// ---------------------------------------------------------------------------
// Bundle builders
// ---------------------------------------------------------------------------

function buildNotebookLM() {
  console.log(`\n  ${c.cyan}NotebookLM bundle${c.reset}`);

  const parts = [];

  // Preamble
  parts.push([
    '# AI Insights \u2014 Combined Reference for NotebookLM',
    '',
    `> **Generated:** ${new Date().toISOString().slice(0, 10)}`,
    '> ',
    '> This document bundles the core documentation from two sub-projects in the',
    '> **AI Insights** workspace so that NotebookLM can reason about them in a',
    '> single source.',
    '>',
    '> **Contents:**',
    '> 1. Project Ledger MCP Server \u2014 README + Project Manifest',
    '> 2. Ledger Personas Build System \u2014 README + Project Manifest',
  ].join('\n'));

  // MCP Server README
  console.log(`    ${c.cyan}+${c.reset} MCP Server README`);
  parts.push(section('PART 1A \u2014 MCP SERVER README', readRequired(MCP_README)));

  // MCP Server Manifest
  console.log(`    ${c.cyan}+${c.reset} MCP Server Project Manifest (${MANIFEST_SECTIONS.length} files)`);
  parts.push(section('PART 1B \u2014 MCP SERVER PROJECT MANIFEST', buildManifestBlock(MCP_MANIFEST_DIR)));

  // Personas README
  console.log(`    ${c.cyan}+${c.reset} Ledger Personas README`);
  parts.push(section('PART 2A \u2014 LEDGER PERSONAS README', readRequired(PERSONAS_README)));

  // Personas Manifest
  console.log(`    ${c.cyan}+${c.reset} Ledger Personas Project Manifest (${MANIFEST_SECTIONS.length} files)`);
  parts.push(section('PART 2B \u2014 LEDGER PERSONAS PROJECT MANIFEST', buildManifestBlock(PERSONAS_MANIFEST_DIR)));

  return parts.join('\n\n---\n\n') + '\n';
}

function buildWorkflowSpec() {
  console.log(`\n  ${c.cyan}Workflow Specification bundle${c.reset}`);

  const parts = [];

  console.log(`    ${c.cyan}+${c.reset} README.md (overview)`);
  parts.push(readRequired(path.join(SPEC_DIR, 'README.md')));

  for (const file of SPEC_SECTION_FILES) {
    console.log(`    ${c.cyan}+${c.reset} ${file}`);
    parts.push(readRequired(path.join(SPEC_DIR, file)));
  }

  return parts.join('\n\n---\n\n') + '\n';
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args      = process.argv.slice(2);
const dryRun    = args.includes('--dry-run');
const onlyIndex = args.indexOf('--only');
const only      = onlyIndex !== -1 ? args[onlyIndex + 1] : null;

if (only && !['notebooklm', 'workflow-spec'].includes(only)) {
  console.error(`${c.red}ERROR${c.reset}: --only accepts "notebooklm" or "workflow-spec".`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log(`${c.bright}[bundle-docs]${c.reset} Assembling bundles...`);

const shouldNotebook = !only || only === 'notebooklm';
const shouldWorkflow = !only || only === 'workflow-spec';

if (shouldNotebook) {
  const content = buildNotebookLM();
  writeBundle(path.join(BUILD_DIR, 'notebooklm-bundle.md'), content, dryRun);
}

if (shouldWorkflow) {
  const content = buildWorkflowSpec();
  writeBundle(path.join(BUILD_DIR, 'workflow-specification.md'), content, dryRun);
}

console.log(`\n${c.green}Done.${c.reset}\n`);
