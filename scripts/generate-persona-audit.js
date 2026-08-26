#!/usr/bin/env node
/**
 * scripts/generate-persona-audit.js
 *
 * Generates a persona audit tracking document from persona YAML metadata
 * across all three suites (ledger, standalone, ledger-support).
 * Personas are sorted oldest-first within each suite.
 *
 * Usage:
 *   node scripts/generate-persona-audit.js                — write to stdout
 *   node scripts/generate-persona-audit.js -o <file>      — write to file
 *   node scripts/generate-persona-audit.js --guide-version — override guide version label
 */

import fs   from 'fs';
import path from 'path';
import {
  parseYamlScalars,
  extractYamlBlockScalar,
} from './lib/yaml-utils.js';

const ROOT = path.resolve(import.meta.dirname, '..');

const LEDGER_META   = path.join(ROOT, 'personas', 'ledger',         'src', 'meta');
const STANDALONE_META = path.join(ROOT, 'personas', 'standalone',   'src', 'meta');
const SUPPORT_META  = path.join(ROOT, 'personas', 'ledger-support', 'src', 'meta');

const GUIDE_FILE = path.join(ROOT, 'personas', 'docs', 'persona-design-guide.md');

// ─── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let outputFile = null;
  let guideVersion = null;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-o' || args[i] === '--output') && args[i + 1]) {
      outputFile = args[++i];
    } else if (args[i] === '--guide-version' && args[i + 1]) {
      guideVersion = args[++i];
    }
  }

  return { outputFile, guideVersion };
}

// ─── Guide version detection ─────────────────────────────────────────────────

function detectGuideVersion() {
  if (!fs.existsSync(GUIDE_FILE)) return 'unknown';
  const text = fs.readFileSync(GUIDE_FILE, 'utf8');
  const m = text.match(/\*\*Version:\*\*\s*(\S+)/);
  return m ? m[1] : 'unknown';
}

function detectGuideChangelog() {
  if (!fs.existsSync(GUIDE_FILE)) return [];
  const text = fs.readFileSync(GUIDE_FILE, 'utf8');
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^- v([\d.]+)\s*-\s*(\d{4}-\d{2}-\d{2}):\s*(.+)$/);
    if (m) entries.push({ version: m[1], date: m[2], summary: m[3] });
  }
  return entries;
}

// ─── Persona loading ──────────────────────────────────────────────────────────

function resolveFromChangelog(text) {
  const content = extractYamlBlockScalar(text, 'changelog');
  if (!content) return { version: undefined, date: undefined };
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^(\d+\.\d+\.\d+)\s*\((\d{4}-\d{2}-\d{2})\)\s*:/);
    if (m) return { version: m[1], date: m[2] };
  }
  return { version: undefined, date: undefined };
}

function loadPersona(filePath, suite) {
  const text = fs.readFileSync(filePath, 'utf8');
  const fields = suite === 'ledger'
    ? ['number', 'role', 'audit_guide_version', 'audit_date']
    : ['slug', 'name', 'audit_guide_version', 'audit_date'];
  const scalars = parseYamlScalars(text, fields);
  const { version, date } = resolveFromChangelog(text);
  const contentFile = suite === 'ledger'
    ? `personas/ledger/src/content/${scalars.number}-${scalars.role?.toLowerCase().replace(/\s+/g, '-')}.md`
    : `personas/${suite === 'support' ? 'ledger-support' : 'standalone'}/src/content/${scalars.slug || path.basename(filePath, '.yaml')}.md`;
  const name = scalars.role || scalars.name || path.basename(filePath, '.yaml');

  return {
    name, version, date, contentFile, suite,
    auditGuideVersion: scalars.audit_guide_version || null,
    auditDate: scalars.audit_date || null,
  };
}

function loadSuite(dir, suite) {
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.yaml') && !f.startsWith('_'))
    .sort()
    .map(f => loadPersona(path.join(dir, f), suite));
}

// ─── Guide version at date ────────────────────────────────────────────────────

/**
 * Returns the guide version that was current on a given date by finding the
 * latest changelog entry whose date is <= the persona's last-updated date.
 */
function guideVersionAtDate(personaDate, guideChangelog) {
  if (!personaDate || guideChangelog.length === 0) return '?';
  // Guide changelog is newest-first; find the first entry whose date <= personaDate
  for (const entry of guideChangelog) {
    if (entry.date <= personaDate) return entry.version;
  }
  // Persona predates all guide versions
  return `<${guideChangelog[guideChangelog.length - 1].version}`;
}

// ─── Markdown rendering ──────────────────────────────────────────────────────

/**
 * Derives audit status from the persona's audit metadata vs current guide version.
 */
function deriveStatus(persona, currentGuideVersion) {
  if (!persona.auditGuideVersion) return '—';
  if (persona.auditGuideVersion === currentGuideVersion) return 'PASS';
  return `PASS (v${persona.auditGuideVersion})`;
}

function renderTable(personas, guideChangelog, currentGuideVersion) {
  const sorted = [...personas].sort((a, b) => {
    if (!a.date) return -1;
    if (!b.date) return 1;
    return a.date.localeCompare(b.date);
  });

  const lines = [
    '| # | Persona | Version | Last Updated | Guide | Audited | Status | Notes |',
    '|---|---|---|---|---|---|---|---|',
  ];
  sorted.forEach((p, i) => {
    const guide = guideVersionAtDate(p.date, guideChangelog);
    const audited = p.auditGuideVersion ? `v${p.auditGuideVersion}` : '—';
    const status = deriveStatus(p, currentGuideVersion);
    lines.push(`| ${i + 1} | ${p.name} | v${p.version || '?'} | ${p.date || '?'} | v${guide} | ${audited} | ${status} | |`);
  });
  return lines.join('\n');
}

function generate(ledger, standalone, support, guideVersion, guideChangelog) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];

  lines.push(`# Persona Audit — Design Guide v${guideVersion}`);
  lines.push('');
  lines.push(`**Created:** ${today}`);
  lines.push(`**Guide Version:** ${guideVersion}`);
  lines.push('**Mode:** Audit');
  lines.push('');
  lines.push('## Audit Focus');
  lines.push('');
  lines.push('Recent guide updates that personas should be checked against:');
  lines.push('');
  lines.push('| Guide Version | Key Changes |');
  lines.push('|---|---|');

  for (const entry of guideChangelog) {
    lines.push(`| v${entry.version} | ${entry.summary} |`);
  }

  lines.push('');
  lines.push('## Tracking');
  lines.push('');
  lines.push('Status values: `—` not started · `IN PROGRESS` · `PASS` · `NEEDS WORK` · `DONE` (fixes applied)');
  lines.push('');
  lines.push('Sorted oldest-first within each suite so the most outdated personas are at the top.');

  lines.push('');
  lines.push(`### Ledger Suite (${ledger.length} personas)`);
  lines.push('');
  lines.push(renderTable(ledger, guideChangelog, guideVersion));

  lines.push('');
  lines.push(`### Standalone Suite (${standalone.length} personas)`);
  lines.push('');
  lines.push(renderTable(standalone, guideChangelog, guideVersion));

  lines.push('');
  lines.push(`### Ledger Support Suite (${support.length} personas)`);
  lines.push('');
  lines.push(renderTable(support, guideChangelog, guideVersion));

  lines.push('');
  lines.push('## Summary');
  lines.push('');
  const all = [...ledger, ...standalone, ...support];
  const total = all.length;
  const currentCount = all.filter(p => p.auditGuideVersion === guideVersion).length;
  const staleCount = all.filter(p => p.auditGuideVersion && p.auditGuideVersion !== guideVersion).length;
  const remaining = total - currentCount;

  const countCurrent = ps => ps.filter(p => p.auditGuideVersion === guideVersion).length;
  const countStale = ps => ps.filter(p => p.auditGuideVersion && p.auditGuideVersion !== guideVersion).length;

  lines.push('| Suite | Total | Current | Stale | Unaudited | Remaining |');
  lines.push('|---|---|---|---|---|---|');
  lines.push(`| Ledger | ${ledger.length} | ${countCurrent(ledger)} | ${countStale(ledger)} | ${ledger.length - countCurrent(ledger) - countStale(ledger)} | ${ledger.length - countCurrent(ledger)} |`);
  lines.push(`| Standalone | ${standalone.length} | ${countCurrent(standalone)} | ${countStale(standalone)} | ${standalone.length - countCurrent(standalone) - countStale(standalone)} | ${standalone.length - countCurrent(standalone)} |`);
  lines.push(`| Ledger Support | ${support.length} | ${countCurrent(support)} | ${countStale(support)} | ${support.length - countCurrent(support) - countStale(support)} | ${support.length - countCurrent(support)} |`);
  lines.push(`| **Total** | **${total}** | **${currentCount}** | **${staleCount}** | **${total - currentCount - staleCount}** | **${remaining}** |`);
  lines.push('');

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const { outputFile, guideVersion: guideVersionOverride } = parseArgs();

const guideVersion   = guideVersionOverride || detectGuideVersion();
const guideChangelog = detectGuideChangelog();
const ledger         = loadSuite(LEDGER_META, 'ledger');
const standalone     = loadSuite(STANDALONE_META, 'standalone');
const support        = loadSuite(SUPPORT_META, 'support');

const output = generate(ledger, standalone, support, guideVersion, guideChangelog);

if (outputFile) {
  const dir = path.dirname(outputFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputFile, output, 'utf8');
  const total = ledger.length + standalone.length + support.length;
  console.log(`Generated ${outputFile} (${total} personas, guide v${guideVersion}).`);
} else {
  process.stdout.write(output);
}
