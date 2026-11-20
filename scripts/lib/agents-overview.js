/**
 * scripts/lib/agents-overview.js
 *
 * Renders, checks and writes `docs/references/agents-overview.md` from persona
 * YAML metadata across all three suites (ledger, standalone, ledger-support).
 *
 * Extracted from the former top-level `scripts/generate-agents-overview.js`
 * (now a thin CLI over this module) so that the persona build can keep the
 * overview current in-process, and so the write path and the check path share
 * one render function. No `main()` — matches `scripts/lib/name-mapping.js`.
 *
 * The render is deterministic apart from the `> **Generated:**` date line
 * (suite entries are sorted), and `normalize()` blanks exactly that line. A
 * write therefore happens only when normalized content differs, so a run that
 * would change nothing but the date leaves the file untouched.
 */

import fs   from 'fs';
import path from 'path';
import {
  parseYamlScalars,
  extractYamlBlockScalar,
  extractYamlText,
  extractYamlSequence,
} from './yaml-utils.js';

const OVERVIEW_RELATIVE_PATH = 'docs/references/agents-overview.md';
const REGENERATE_COMMAND     = 'node scripts/build-personas.js';

/** Strip the generated date so a date change alone never counts as a difference. */
function normalize(s) {
  return s.replace(/^> \*\*Generated:\*\* .+$/m, '> **Generated:** (date)');
}

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

  const version      = resolveVersionFromChangelog(text);
  const key_behavior = extractYamlText(text, 'key_behavior');
  const modes        = extractYamlText(text, 'modes');
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

function generate(ledger, standalone, support, slugMap, headerFile) {
  const header     = fs.readFileSync(headerFile, 'utf8').replace(/\r\n/g, '\n');
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

// ─── Public API ───────────────────────────────────────────────────────────────

function resolvePaths(root, outputFile) {
  return {
    outputFile: outputFile ?? path.join(root, 'docs', 'references', 'agents-overview.md'),
    headerFile: path.join(root, 'scripts', 'templates', 'agents-overview-header.md'),
    ledgerMeta:     path.join(root, 'personas', 'ledger',         'src', 'meta'),
    standaloneMeta: path.join(root, 'personas', 'standalone',     'src', 'meta'),
    supportMeta:    path.join(root, 'personas', 'ledger-support', 'src', 'meta'),
  };
}

function renderWithCount(root, outputFile) {
  const paths      = resolvePaths(root, outputFile);
  const ledger     = loadSuite(paths.ledgerMeta,     'ledger');
  const standalone = loadSuite(paths.standaloneMeta, 'standalone');
  const support    = loadSuite(paths.supportMeta,    'support');
  const slugMap    = buildSlugMap(standalone, support);
  return {
    paths,
    output: generate(ledger, standalone, support, slugMap, paths.headerFile),
    personaCount: ledger.length + standalone.length + support.length,
  };
}

/**
 * Renders the full overview document for today's date.
 * @param {{ root: string }} options
 * @returns {string}
 */
export function renderAgentsOverview({ root }) {
  return renderWithCount(root).output;
}

/**
 * Compares the overview on disk with the freshly rendered one, ignoring the date line.
 * @param {{ root: string, outputFile?: string }} options
 * @returns {string[]} Empty when current; otherwise one finding naming the file and the regenerate command.
 */
export function checkAgentsOverview({ root, outputFile }) {
  const { paths, output } = renderWithCount(root, outputFile);
  if (!fs.existsSync(paths.outputFile)) {
    return [`${OVERVIEW_RELATIVE_PATH} does not exist. Run ${REGENERATE_COMMAND} to generate it.`];
  }
  const existing = fs.readFileSync(paths.outputFile, 'utf8');
  if (normalize(existing) === normalize(output)) return [];
  return [`${OVERVIEW_RELATIVE_PATH} is out of date. Run ${REGENERATE_COMMAND} to regenerate it.`];
}

/**
 * Renders the overview and writes it only when normalized content differs (or the file is missing).
 * @param {{ root: string, outputFile?: string }} options
 * @returns {{ written: boolean, personaCount: number }}
 */
export function writeAgentsOverview({ root, outputFile }) {
  const { paths, output, personaCount } = renderWithCount(root, outputFile);
  if (fs.existsSync(paths.outputFile)) {
    const existing = fs.readFileSync(paths.outputFile, 'utf8');
    if (normalize(existing) === normalize(output)) return { written: false, personaCount };
  }
  fs.mkdirSync(path.dirname(paths.outputFile), { recursive: true });
  fs.writeFileSync(paths.outputFile, output, 'utf8');
  return { written: true, personaCount };
}
