#!/usr/bin/env node
/**
 * scripts/generate-persona-audit.js
 *
 * Generates a persona audit tracking document from persona YAML metadata
 * across all three suites (ledger, standalone, ledger-support).
 * Personas are sorted oldest-first within each suite.
 *
 * Writes to personas/docs/audits/status.md by default. That file is fully
 * generated — the hand-written audit narrative lives alongside it in notes.md,
 * and editorial Notes-column text in annotations.json.
 *
 * Usage:
 *   node scripts/generate-persona-audit.js                — write to the default path
 *   node scripts/generate-persona-audit.js -o <file>      — write to a different file
 *   node scripts/generate-persona-audit.js --stdout       — write to stdout
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

const GUIDE_FILE  = path.join(ROOT, 'personas', 'docs', 'persona-design-guide.md');
const AUDITS_DIR  = path.join(ROOT, 'personas', 'docs', 'audits');
const STATUS_FILE = path.join(AUDITS_DIR, 'status.md');
const ANNOTATIONS_FILE = path.join(AUDITS_DIR, 'annotations.json');

// ─── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let outputFile = null;
  let guideVersion = null;
  let toStdout = false;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-o' || args[i] === '--output') && args[i + 1]) {
      outputFile = args[++i];
    } else if (args[i] === '--stdout') {
      toStdout = true;
    } else if (args[i] === '--guide-version' && args[i + 1]) {
      guideVersion = args[++i];
    }
  }

  return { outputFile, guideVersion, toStdout };
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

// ─── Annotations sidecar ──────────────────────────────────────────────────────

function loadAnnotations() {
  if (!fs.existsSync(ANNOTATIONS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(ANNOTATIONS_FILE, 'utf8'));
  } catch (err) {
    console.warn(`Warning: could not parse ${path.relative(ROOT, ANNOTATIONS_FILE)} — ${err.message}`);
    return {};
  }
}

// ─── Composition tier ─────────────────────────────────────────────────────────

/**
 * Classifies a persona by how much its build assembles.
 *
 * Tier A sources carry no partials and no target conditionals, so the rendered
 * output is the source plus frontmatter — design guide v3.3's rendered-output
 * requirement has nothing to bite on. Tier B sources compose, and their
 * assembled document has to be read to be verified.
 */
function computeTier(contentFile) {
  const abs = path.join(ROOT, contentFile);
  if (!fs.existsSync(abs)) return { tier: '?', partials: 0, conditionals: 0 };

  const text = fs.readFileSync(abs, 'utf8');
  const partials     = (text.match(/\{\{>\s*[\w-]+\s*\}\}/g)     || []).length;
  const conditionals = (text.match(/\{\{#(?:if|unless)\s/g)      || []).length;

  return { tier: partials === 0 && conditionals === 0 ? 'A' : 'B', partials, conditionals };
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
  const key = path.basename(filePath, '.yaml');
  // Content files are named after the YAML stem, not the slug — the two diverge
  // for personas whose slug is disambiguated across suites (e.g. developer-standalone).
  const suiteDir = suite === 'support' ? 'ledger-support' : suite;
  const contentFile = `personas/${suiteDir}/src/content/${key}.md`;
  const name = scalars.role || scalars.name || key;

  return {
    name, version, date, contentFile, suite, key,
    ...computeTier(contentFile),
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

function renderTable(personas, guideChangelog, currentGuideVersion, annotations) {
  const sorted = [...personas].sort((a, b) => {
    if (!a.date) return -1;
    if (!b.date) return 1;
    return a.date.localeCompare(b.date);
  });

  const lines = [
    '| # | Persona | Version | Last Updated | Guide | Audited | Tier | Status | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  sorted.forEach((p, i) => {
    const guide = guideVersionAtDate(p.date, guideChangelog);
    const audited = p.auditGuideVersion ? `v${p.auditGuideVersion}` : '—';
    const status = deriveStatus(p, currentGuideVersion);
    const note = annotations[p.suite]?.[p.key] || '';
    const tier = p.tier === 'B'
      ? `B (${p.partials}p/${p.conditionals}c)`
      : p.tier;
    lines.push(`| ${i + 1} | ${p.name} | v${p.version || '?'} | ${p.date || '?'} | v${guide} | ${audited} | ${tier} | ${status} | ${note} |`);
  });
  return lines.join('\n');
}

function generate(ledger, standalone, support, guideVersion, guideChangelog, annotations) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];

  lines.push(`# Persona Audit Status — Design Guide v${guideVersion}`);
  lines.push('');
  lines.push('<!-- GENERATED FILE — do not edit by hand.');
  lines.push('     Regenerate: node scripts/cli.js generate-persona-audit');
  lines.push('     Narrative: notes.md · Notes-column text: annotations.json -->');
  lines.push('');
  lines.push(`**Generated:** ${today}`);
  lines.push(`**Guide Version:** ${guideVersion}`);
  lines.push('');
  lines.push('> **Companion:** [notes.md](notes.md) — audit methodology, generalising findings, and');
  lines.push('> roll-forward reasoning. Editorial text in the Notes column below comes from');
  lines.push('> [annotations.json](annotations.json); the Tier column is computed from persona source.');
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
  lines.push('Status values: `—` not started · `PASS` (audited at the current guide version) ·');
  lines.push('`PASS (vX.Y)` (audited at an older version — stale).');
  lines.push('');
  lines.push('**Tier** is computed from the persona\'s source composition, not recorded by hand:');
  lines.push('**A** = no partials and no target conditionals, so the rendered output is the source');
  lines.push('plus frontmatter and guide v3.3\'s rendered-output requirement does not apply.');
  lines.push('**B (Np/Mc)** = N partial references and M conditionals, so the assembled document');
  lines.push('must be read to be verified. A persona that gains its first partial flips A → B here');
  lines.push('automatically, marking its existing audit stamp as no longer sufficient.');
  lines.push('');
  lines.push('Sorted oldest-first within each suite so the most outdated personas are at the top.');

  lines.push('');
  lines.push(`### Ledger Suite (${ledger.length} personas)`);
  lines.push('');
  lines.push(renderTable(ledger, guideChangelog, guideVersion, annotations));

  lines.push('');
  lines.push(`### Standalone Suite (${standalone.length} personas)`);
  lines.push('');
  lines.push(renderTable(standalone, guideChangelog, guideVersion, annotations));

  lines.push('');
  lines.push(`### Ledger Support Suite (${support.length} personas)`);
  lines.push('');
  lines.push(renderTable(support, guideChangelog, guideVersion, annotations));

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
  lines.push('**Stale** personas hold a real PASS at an older guide version — their remaining work');
  lines.push('depends on tier. **Unaudited** personas have never been through a Quality Checklist at');
  lines.push('any version, and that is where the substantive backlog sits.');
  lines.push('');

  const staleB = all.filter(p => p.auditGuideVersion && p.auditGuideVersion !== guideVersion && p.tier === 'B').length;
  const staleA = staleCount - staleB;
  if (staleCount > 0) {
    lines.push(`Of the ${staleCount} stale, ${staleB} are Tier B (composed — need a rendered read) and`);
    lines.push(`${staleA} are Tier A (no composition — eligible for roll-forward on the guide's own terms).`);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const { outputFile, guideVersion: guideVersionOverride, toStdout } = parseArgs();

const guideVersion   = guideVersionOverride || detectGuideVersion();
const guideChangelog = detectGuideChangelog();
const annotations    = loadAnnotations();
const ledger         = loadSuite(LEDGER_META, 'ledger');
const standalone     = loadSuite(STANDALONE_META, 'standalone');
const support        = loadSuite(SUPPORT_META, 'support');

const output = generate(ledger, standalone, support, guideVersion, guideChangelog, annotations);

if (toStdout) {
  process.stdout.write(output);
} else {
  const target = outputFile || STATUS_FILE;
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, output, 'utf8');

  const all = [...ledger, ...standalone, ...support];
  const tierB = all.filter(p => p.tier === 'B').length;
  console.log(`Generated ${path.relative(ROOT, target)} (${all.length} personas, guide v${guideVersion}).`);
  console.log(`  Tier A: ${all.length - tierB}  ·  Tier B: ${tierB}`);
}
