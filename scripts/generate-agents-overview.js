#!/usr/bin/env node
/**
 * scripts/generate-agents-overview.js
 *
 * Generates docs/references/agents-overview.md from persona YAML metadata across all
 * three suites (ledger, standalone, ledger-support).
 *
 * Usage:
 *   node scripts/generate-agents-overview.js          — generate and write
 *   node scripts/generate-agents-overview.js --check  — exit 0 if current, 1 if stale
 *   node scripts/generate-agents-overview.js --dry-run — alias for --check
 */

import fs   from 'fs';
import path from 'path';
import {
  parseYamlScalars,
  extractYamlBlockScalar,
  extractYamlSequence,
} from './lib/yaml-utils.js';

const ROOT          = path.resolve(import.meta.dirname, '..');
const OUTPUT_FILE   = path.join(ROOT, 'docs', 'references', 'agents-overview.md');
const HEADER_FILE   = path.join(ROOT, 'scripts', 'templates', 'agents-overview-header.md');

const LEDGER_META   = path.join(ROOT, 'personas', 'ledger',        'src', 'meta');
const STANDALONE_META = path.join(ROOT, 'personas', 'standalone',  'src', 'meta');
const SUPPORT_META  = path.join(ROOT, 'personas', 'ledger-support', 'src', 'meta');

const isCheck = process.argv.includes('--check') || process.argv.includes('--dry-run');

// ─── Version helper ───────────────────────────────────────────────────────────

/**
 * Extracts version from a `changelog: |` block scalar.
 */
function resolveVersionFromChangelog(text) {
  const content = extractYamlBlockScalar(text, 'changelog');
  if (!content) return undefined;
  for (const line of content.split(/\r?\n/)) {
    const withDate = line.match(/^(\d+\.\d+\.\d+)\s*\(\d{4}-\d{2}-\d{2}\)\s*:/);
    if (withDate) return withDate[1];
    const withoutDate = line.match(/^(\d+\.\d+\.\d+)\s*:/);
    if (withoutDate) return withoutDate[1];
  }
  return undefined;
}

// ─── Persona loading ──────────────────────────────────────────────────────────

const LEDGER_SCALARS     = ['number', 'role', 'identity', 'description', 'inputs', 'outputs', 'notes'];
const STANDALONE_SCALARS = ['slug', 'name', 'description', 'identity', 'use_when', 'notes'];

/**
 * Parse one persona YAML file into a normalized persona object.
 * @param {string} filePath
 * @param {'ledger'|'standalone'|'support'} suite
 * @returns {object}
 */
function loadPersona(filePath, suite) {
  const text    = fs.readFileSync(filePath, 'utf8');
  const fields  = suite === 'ledger' ? LEDGER_SCALARS : STANDALONE_SCALARS;
  const scalars = parseYamlScalars(text, fields);

  const version     = resolveVersionFromChangelog(text);
  const key_behavior = extractYamlBlockScalar(text, 'key_behavior');
  const modes        = extractYamlBlockScalar(text, 'modes');
  const subagents    = extractYamlSequence(text, 'subagents');

  return { ...scalars, version, key_behavior, modes, subagents, suite };
}

/**
 * Load all non-_shared.yaml personas from a meta directory.
 */
function loadSuite(dir, suite) {
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.yaml') && !f.startsWith('_'))
    .sort()
    .map(f => loadPersona(path.join(dir, f), suite));
}

// ─── Slug → name lookup ───────────────────────────────────────────────────────

/**
 * Build a map of slug → display name from standalone + support personas so
 * subagent references can be rendered with human-readable names.
 */
function buildSlugMap(standalone, support) {
  const map = {};
  for (const p of [...standalone, ...support]) {
    const slug = p.slug || p.name?.toLowerCase().replace(/\s+/g, '-') || '';
    if (slug) map[slug] = p.name || slug;
  }
  return map;
}

// ─── Name formatting ──────────────────────────────────────────────────────────

/**
 * Normalize display names: "(Standalone)" → "— Standalone" to avoid
 * double-parentheses in headings like "### Developer (Standalone) (v1.4.0)".
 */
function displayName(name) {
  return name.replace(/\(Standalone\)/, '— Standalone');
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

function renderSubagents(slugs, slugMap) {
  if (!slugs || slugs.length === 0) return '';
  const names = slugs.map(s => slugMap[s] || s);
  return `- **Sub-agents:** ${names.join(', ')}\n`;
}

function renderKeyBehavior(kb) {
  if (!kb) return '';
  const firstLine = kb.split(/\r?\n/).find(l => l.trim());
  return firstLine ? `- **Key Behavior:** ${firstLine}\n` : '';
}

function renderModes(modes) {
  if (!modes) return '';
  const items = modes.split(/\r?\n/).filter(l => l.trim()).join(', ');
  return items ? `- **Modes:** ${items}\n` : '';
}

/**
 * Render a ledger pipeline persona entry.
 */
function renderLedgerPersona(p, slugMap) {
  const name    = p.role || '(unknown)';
  const version = p.version || '?';
  const number  = p.number || '?';

  let md = `### Stage ${number} — ${name} (v${version})\n\n`;
  if (p.identity) md += `**Identity:** ${p.identity}\n\n`;
  if (p.description) md += `${p.description}\n\n`;
  if (p.inputs)  md += `- **Inputs:** ${p.inputs}\n`;
  if (p.outputs) md += `- **Outputs:** ${p.outputs}\n`;
  md += renderKeyBehavior(p.key_behavior);
  md += renderSubagents(p.subagents, slugMap);
  md += '\n---\n\n';
  return md;
}

/**
 * Render a standalone or ledger-support persona entry.
 */
function renderStandalonePersona(p, slugMap) {
  const name    = displayName(p.name || '(unknown)');
  const version = p.version || '?';

  let md = `### ${name} (v${version})\n\n`;
  if (p.identity)    md += `**Identity:** ${p.identity}\n\n`;
  if (p.description) md += `${p.description}\n\n`;
  md += renderModes(p.modes);
  if (p.use_when) md += `- **Use When:** ${p.use_when}\n`;
  md += renderKeyBehavior(p.key_behavior);
  md += renderSubagents(p.subagents, slugMap);
  if (p.notes) md += `- **Notes:** ${p.notes}\n`;
  md += '\n---\n\n';
  return md;
}

// ─── Document generation ──────────────────────────────────────────────────────

function generate(ledger, standalone, support, slugMap) {
  const header     = fs.readFileSync(HEADER_FILE, 'utf8');
  const now        = new Date().toISOString().slice(0, 10);
  const total      = ledger.length + standalone.length + support.length;

  let doc = '';

  // Front matter comment and generated-by notice
  doc += `<!-- Generated by scripts/generate-agents-overview.js — do not edit manually -->\n`;
  doc += `<!-- To regenerate: node scripts/generate-agents-overview.js -->\n\n`;

  // Replace the first heading in the header with a heading that includes the timestamp
  const headerWithMeta = header.replace(
    /^# AI Insights — Agent Persona Overview\n/,
    `# AI Insights — Agent Persona Overview\n\n` +
    `> **Generated:** ${now}\n` +
    `> **Total Personas:** ${total}\n\n` +
    `This document provides a complete overview of all AI agent personas available in the AI Insights project. The system uses a structured multi-agent workflow where specialized personas handle different aspects of software development, from planning through implementation, review, and release.\n`
  );
  doc += headerWithMeta;

  // Ledger section
  doc += `## Ledger Pipeline Personas (9-Stage Workflow)\n\n`;
  for (const p of ledger) doc += renderLedgerPersona(p, slugMap);

  // Standalone section
  doc += `## Standalone Personas\n\n`;
  for (const p of standalone) doc += renderStandalonePersona(p, slugMap);

  // Ledger-support section
  doc += `## Ledger-Support Personas\n\n`;
  for (const p of support) doc += renderStandalonePersona(p, slugMap);

  // Summary table
  doc += `## Summary\n\n`;
  doc += `| Suite | Count | Description |\n`;
  doc += `|-------|-------|-------------|\n`;
  doc += `| Ledger Pipeline | ${ledger.length} | Core sequential development workflow (Plan → Implement → Test → Review → Release → Document → Synthesize) |\n`;
  doc += `| Standalone | ${standalone.length} | On-demand utility agents for planning, documentation, code review, release management, and more |\n`;
  doc += `| Ledger-Support | ${support.length} | Workflow infrastructure agents for bootstrapping, sequencing, diagnosing, and archiving ledger projects |\n`;
  doc += `| **Total** | **${total}** | |\n`;

  return doc;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ledger     = loadSuite(LEDGER_META,     'ledger');
const standalone = loadSuite(STANDALONE_META, 'standalone');
const support    = loadSuite(SUPPORT_META,    'support');
const slugMap    = buildSlugMap(standalone, support);

const output = generate(ledger, standalone, support, slugMap);

if (isCheck) {
  if (!fs.existsSync(OUTPUT_FILE)) {
    console.error(`[STALE] ${OUTPUT_FILE} does not exist. Run without --check to generate.`);
    process.exit(1);
  }
  const existing = fs.readFileSync(OUTPUT_FILE, 'utf8');

  // Strip the generated timestamp before comparing so date changes don't cause
  // false-positive stale detection.
  const normalize = s => s.replace(/^> \*\*Generated:\*\* .+$/m, '> **Generated:** (date)');
  if (normalize(existing) === normalize(output)) {
    console.log('docs/references/agents-overview.md is up to date.');
    process.exit(0);
  } else {
    console.error('[STALE] docs/references/agents-overview.md is out of date. Run node scripts/generate-agents-overview.js to regenerate.');
    process.exit(1);
  }
} else {
  fs.writeFileSync(OUTPUT_FILE, output, 'utf8');
  const total = ledger.length + standalone.length + support.length;
  console.log(`Generated docs/references/agents-overview.md (${total} personas).`);
}
