#!/usr/bin/env node

/**
 * build-personas.js — thin wrapper around @mistralys/persona-builder.
 * All build logic is delegated to the library via the CLI binary.
 * Usage: node scripts/build-personas.js [--check] [--strict] [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { loadModelRegistry, resolveModel } from './lib/persona-model-resolution.js';

const _require = createRequire(import.meta.url);

const ROOT     = path.join(import.meta.dirname, '..');
const PERSONAS = path.join(ROOT, 'personas');
const CONFIG   = path.join(PERSONAS, 'persona-build.config.js');
const CLI      = path.join(PERSONAS, 'node_modules', '@mistralys', 'persona-builder', 'dist', 'cli.js');

// --dry-run is accepted as a convenience alias for --check (same behaviour)
const CHECK  = process.argv.includes('--check') || process.argv.includes('--dry-run');
const STRICT = process.argv.includes('--strict');

// Pre-build: clean output directories so stale/renamed files don't linger.
// Skipped in --check / --dry-run mode (read-only).
if (!CHECK) {
  const config = _require(CONFIG);
  const outputDirs = [];
  for (const suite of Object.values(config.suites)) {
    if (suite.outVscode)     outputDirs.push(suite.outVscode);
    if (suite.outClaudeCode) outputDirs.push(suite.outClaudeCode);
    if (suite.outputDirs) {
      for (const dir of Object.values(suite.outputDirs)) {
        outputDirs.push(dir);
      }
    }
  }
  for (const dir of outputDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      fs.unlinkSync(path.join(dir, file));
    }
  }
}

// Delegate build to the library CLI
const cliArgs = ['--config', CONFIG];
if (CHECK)  cliArgs.push('--check');
if (STRICT) cliArgs.push('--strict');

try {
  execFileSync(process.execPath, [CLI, ...cliArgs], { stdio: 'inherit' });
} catch (err) {
  process.exit(err.status ?? 1);
}

// Post-build: sync personas/package.json version from changelog (real builds only)
if (!CHECK) {
  const changelogPath = path.join(ROOT, 'personas', 'changelog.md');
  const pkgPath       = path.join(ROOT, 'personas', 'package.json');
  const changelog     = fs.readFileSync(changelogPath, 'utf8');
  const match         = changelog.match(/^## v(\d+\.\d+\.\d+)/m);

  if (!match) {
    console.warn('[WARN] Could not extract version from personas/changelog.md — skipping package.json update.');
  } else {
    const newVersion = match[1];
    const pkg        = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.version !== newVersion) {
      const oldVersion = pkg.version;
      pkg.version = newVersion;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      console.log(`Updated personas/package.json: ${oldVersion} → ${newVersion}`);
    } else {
      console.log(`personas/package.json already at v${newVersion} — no update needed.`);
    }
  }
}

// Post-build: generate personas/name-mapping.json (real builds only)
if (!CHECK) {
  const ledgerMetaDir = path.join(ROOT, 'personas', 'ledger', 'src', 'meta');
  const outPath       = path.join(ROOT, 'personas', 'name-mapping.json');

  // Dynamically derive ledger persona filenames from the filesystem — all files matching
  // /^\d+-.*\.yaml$/ in personas/ledger/src/meta/, sorted by leading digit.
  // This eliminates manual synchronization with shared/workflow-manifest.json.
  const LEDGER_PERSONA_FILES = fs.readdirSync(ledgerMetaDir)
    .filter(f => /^\d+-.*\.yaml$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/^(\d+)/)[1], 10);
      const numB = parseInt(b.match(/^(\d+)/)[1], 10);
      return numA - numB;
    });

  // Non-ledger suite definitions: [suiteName, metaDir]
  const NON_LEDGER_SUITES = [
    ['standalone',     path.join(ROOT, 'personas', 'standalone', 'src', 'meta')],
    ['ledger-support', path.join(ROOT, 'personas', 'ledger-support', 'src', 'meta')],
  ];

  const SCALAR_FIELDS = ['number', 'role', 'id', 'version', 'vs_file_name', 'cc_file_name', 'da_file_name'];

  // Non-ledger personas use the same scalar fields minus number/role (which are
  // absent or derived differently).
  const STANDALONE_SCALAR_FIELDS = ['id', 'name', 'version', 'vs_file_name', 'cc_file_name', 'da_file_name', 'model_slug'];

  // ---------------------------------------------------------------------------
  // Load model registry once for the entire name-mapping pass
  // (loadModelRegistry and resolveModel are imported from lib/persona-model-resolution.js)
  // ---------------------------------------------------------------------------

  const registryDir = path.join(ROOT, 'personas', 'model-registry');
  const { uuidToSlug, registryEntries, assignments } = loadModelRegistry(registryDir);

  /**
   * Extracts simple scalar (string/number) fields from a YAML file without
   * external dependencies. Only top-level key: value lines are parsed; nested
   * structures and lists are ignored.
   */
  function parseYamlScalars(text, fields) {

    const result = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
      if (!m) continue;
      const key = m[1];
      if (!fields.includes(key)) continue;
      let val = m[2].trim();
      // Strip surrounding single or double quotes (handles `"value"` and `'value'`).
      // Also handles quoted values followed by a trailing inline comment:
      //   `key: "value"   # comment` → first match the closing quote, strip comment, then unquote.
      if (val.startsWith('"') || val.startsWith("'")) {
        const q = val[0];
        // Find the closing quote; content between quotes may contain any char.
        const closeIdx = val.indexOf(q, 1);
        if (closeIdx !== -1) {
          val = val.slice(1, closeIdx);
        } else {
          // Unclosed quote — fall back to comment-strip and trim
          val = val.replace(/\s+#.*$/, '').trim();
        }
      } else {
        // Unquoted scalar: strip trailing inline YAML comment
        // e.g. `role: Developer # note` → `Developer`
        val = val.replace(/\s+#.*$/, '').trim();
      }
      result[key] = val;
    }
    return result;
  }

  /**
   * Extracts the string content of a YAML block scalar (`key: |` or `key: |-`)
   * from raw YAML text without a full YAML parse.
   * Returns the block content (newline-joined, trimmed) or undefined when the
   * key is absent or does not use a block scalar indicator.
   */
  function extractYamlBlockScalar(text, key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re    = new RegExp(`^${escaped}\\s*:\\s*\\|[-+]?\\s*$`, 'm');
    const match = re.exec(text);
    if (!match) return undefined;

    const after   = text.slice(match.index + match[0].length);
    const lines   = after.split(/\r?\n/);
    let   indent  = -1;
    const content = [];

    for (const line of lines) {
      if (line.trim() === '') {
        if (indent !== -1) content.push('');
        continue;
      }
      const m          = line.match(/^(\s+)/);
      const lineIndent = m ? m[1].length : 0;
      if (lineIndent === 0) break;            // outdented — end of block scalar
      if (indent === -1) indent = lineIndent; // first content line determines indent
      if (lineIndent < indent) break;
      content.push(line.slice(indent));
    }

    const joined = content.join('\n').trimEnd();
    return joined || undefined;
  }

  /**
   * Extracts the version string from a `changelog: |` block scalar in raw YAML
   * text. Returns the version string (e.g. "3.6.3") or undefined when absent.
   *
   * Regex patterns mirror resolveChangelogMeta() in @mistralys/persona-builder:
   *   Primary:  "3.6.3 (2026-05-29): description"
   *   Fallback: "3.6.3: description"            (no date)
   */
  function resolveVersionFromChangelog(text) {
    if (typeof text !== 'string') return undefined;
    const content = extractYamlBlockScalar(text, 'changelog');
    if (!content) return undefined;
    // Line-by-line first-wins, mirrors resolveChangelogMeta() in the library
    for (const line of content.split(/\r?\n/)) {
      const withDate = line.match(/^(\d+\.\d+\.\d+)\s*\(\d{4}-\d{2}-\d{2}\)\s*:/);
      if (withDate) return withDate[1];
      const withoutDate = line.match(/^(\d+\.\d+\.\d+)\s*:/);
      if (withoutDate) return withoutDate[1];
    }
    return undefined;
  }

  /**
   * Validates the `changelog` field in a persona YAML.
   * Warns when the field is present but unparseable, or when the first version
   * entry has no date. Logs an info message when explicit `version` or
   * `last_updated` scalar fields coexist with the changelog (indicating they
   * can be removed).
   */
  function validateChangelogField(raw, filename) {
    const content = extractYamlBlockScalar(raw, 'changelog');
    if (content === undefined) return;

    // Track first-entry date status and detect same-version/different-date duplicates.
    let firstHasDate = null; // null = not yet seen, true/false = first entry result
    let firstVersion = null;
    const versionDates = {}; // version → date string (first occurrence)

    for (const line of content.split(/\r?\n/)) {
      const withDate = line.match(/^(\d+\.\d+\.\d+)\s*\((\d{4}-\d{2}-\d{2})\)\s*:/);
      if (withDate) {
        const [, ver, date] = withDate;
        if (firstHasDate === null) { firstHasDate = true; firstVersion = ver; }
        if (Object.prototype.hasOwnProperty.call(versionDates, ver)) {
          if (versionDates[ver] !== date) {
            console.warn(`[WARN] ${filename}: version "${ver}" appears with two different dates` +
              ` (${versionDates[ver]} and ${date}).`);
          }
        } else {
          versionDates[ver] = date;
        }
        continue;
      }
      const withoutDate = line.match(/^(\d+\.\d+\.\d+)\s*:/);
      if (withoutDate && firstHasDate === null) { firstHasDate = false; firstVersion = withoutDate[1]; }
    }

    if (firstHasDate === null) {
      console.warn(`[WARN] ${filename}: changelog present but no parseable version found.`);
    } else if (!firstHasDate) {
      console.warn(`[WARN] ${filename}: changelog first entry has no date (version "${firstVersion}").`);
    }

    const scalars = parseYamlScalars(raw, ['version', 'last_updated']);
    if (scalars.version) {
      console.info(`[INFO] ${filename}: explicit version "${scalars.version}" coexists with changelog.`);
    }
    if (scalars.last_updated) {
      console.info(`[INFO] ${filename}: explicit last_updated "${scalars.last_updated}" coexists with changelog.`);
    }
  }

  /** Returns the filename stem (strips the last extension). */
  function stem(filename) {
    return filename.replace(/\.[^.]+$/, '');
  }

  // ---------------------------------------------------------------------------
  // Ledger suite — read _shared.yaml for default_version and default model info
  // ---------------------------------------------------------------------------

  const ledgerSharedRaw   = fs.readFileSync(path.join(ledgerMetaDir, '_shared.yaml'), 'utf8');
  const ledgerSharedData  = parseYamlScalars(ledgerSharedRaw, ['default_version', 'default_model', 'default_model_slug']);
  const DEFAULT_VERSION   = ledgerSharedData.default_version;
  const LEDGER_DEFAULT_MODEL      = ledgerSharedData.default_model;
  const LEDGER_DEFAULT_MODEL_SLUG = ledgerSharedData.default_model_slug;

  // ---------------------------------------------------------------------------
  // Build ledger entries
  // ---------------------------------------------------------------------------

  const ledgerEntries = LEDGER_PERSONA_FILES.map(file => {
    const raw  = fs.readFileSync(path.join(ledgerMetaDir, file), 'utf8');
    const data = parseYamlScalars(raw, SCALAR_FIELDS);

    validateChangelogField(raw, file);

    const ccFileName = data.cc_file_name;
    const daFileName = data.da_file_name || ccFileName;
    const ccStem     = stem(ccFileName);
    const daStem     = stem(daFileName);
    const number     = Number(data.number);
    const version    = resolveVersionFromChangelog(raw) || data.version || DEFAULT_VERSION;

    const modelInfo = resolveModel(
      data.id,
      undefined, // ledger personas don't carry per-persona model_slug in YAML (uses shared default)
      LEDGER_DEFAULT_MODEL_SLUG,
      LEDGER_DEFAULT_MODEL,
      uuidToSlug,
      assignments,
      registryEntries,
    );

    return {
      number,
      id:         data.id,
      role:       data.role,
      version,
      suite:      'ledger',
      model:      modelInfo.model,
      model_slug: modelInfo.model_slug,
      cc_model:   modelInfo.cc_model,
      vscode: {
        file_name:  data.vs_file_name,
        agent_name: `${number} - ${data.role} v${version}`,
      },
      claude_code: {
        file_name:  ccFileName,
        agent_name: ccStem,
      },
      deep_agents: {
        file_name:  daFileName,
        agent_name: daStem,
      },
    };
  });

  // Sort by number (files are already ordered, but be explicit)
  ledgerEntries.sort((a, b) => a.number - b.number);

  // ---------------------------------------------------------------------------
  // Non-ledger suites (standalone, ledger-support)
  // ---------------------------------------------------------------------------

  /**
   * Derives the role name for a non-ledger persona by stripping the known suite
   * suffix from the persona's `name` field.
   * e.g. "Developer (Standalone)"  → "Developer"
   *      "Ledger Bootstrapper"     → "Ledger Bootstrapper"  (no recognized suffix)
   */
  function deriveRole(name) {
    return name
      .replace(/\s+\(Standalone\)$/i, '')
      .replace(/\s+\(Ledger Support\)$/i, '')
      .trim();
  }

  const nonLedgerEntries = [];

  for (const [suiteName, suiteMetaDir] of NON_LEDGER_SUITES) {
    if (!fs.existsSync(suiteMetaDir)) continue;

    const suiteFiles = fs.readdirSync(suiteMetaDir)
      .filter(f => f.endsWith('.yaml') && !f.startsWith('_'));

    // Read suite-level _shared.yaml for default model slug (if present)
    const suiteSharedPath = path.join(suiteMetaDir, '_shared.yaml');
    let suiteDefaultModelSlug = undefined;
    if (fs.existsSync(suiteSharedPath)) {
      const suiteSharedData = parseYamlScalars(
        fs.readFileSync(suiteSharedPath, 'utf8'),
        ['default_model_slug'],
      );
      suiteDefaultModelSlug = suiteSharedData.default_model_slug || undefined;
    }

    for (const file of suiteFiles) {
      const raw  = fs.readFileSync(path.join(suiteMetaDir, file), 'utf8');
      const data = parseYamlScalars(raw, STANDALONE_SCALAR_FIELDS);

      if (!data.id) continue; // malformed YAML — skip silently

      const ccFileName = data.cc_file_name;
      if (!ccFileName) continue; // no output target — skip

      const daFileName = data.da_file_name || ccFileName;
      const ccStem     = stem(ccFileName);
      const daStem     = stem(daFileName);
      const version    = resolveVersionFromChangelog(raw) || data.version || DEFAULT_VERSION;
      const personaName = data.name || stem(file);
      const role        = deriveRole(personaName);

      const modelInfo = resolveModel(
        data.id,
        data.model_slug || suiteDefaultModelSlug,
        undefined,  // no ledger-style shared model default for non-ledger suites
        undefined,
        uuidToSlug,
        assignments,
        registryEntries,
      );

      const entry = {
        number:     null,
        id:         data.id,
        role,
        version,
        suite:      suiteName,
        model:      modelInfo.model,
        model_slug: modelInfo.model_slug,
        cc_model:   modelInfo.cc_model,
        vscode: {
          file_name:  data.vs_file_name || ccFileName,
          agent_name: personaName,
        },
        claude_code: {
          file_name:  ccFileName,
          agent_name: ccStem,
        },
        deep_agents: {
          file_name:  daFileName,
          agent_name: daStem,
        },
      };

      nonLedgerEntries.push(entry);
    }
  }

  // Sort non-ledger entries alphabetically by suite then role for stable output
  nonLedgerEntries.sort((a, b) => {
    if (a.suite !== b.suite) return a.suite < b.suite ? -1 : 1;
    return a.role < b.role ? -1 : 1;
  });

  // ---------------------------------------------------------------------------
  // Write name-mapping.json — ledger entries first, then non-ledger suites
  // ---------------------------------------------------------------------------

  const mapping = [...ledgerEntries, ...nonLedgerEntries];

  fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2) + '\n', 'utf8');
  console.log(`Generated personas/name-mapping.json with ${mapping.length} entries (${ledgerEntries.length} ledger, ${nonLedgerEntries.length} non-ledger).`);
}

// Always: validate {{agent_slug_*}} cross-references (real builds AND --check).
// Ensures every {{agent_slug_X_Y}} reference in a persona content file has a
// matching slug "x-y" declared in that persona's `subagents` list in the YAML.
{
  const metaDir    = path.join(ROOT, 'personas', 'ledger', 'src', 'meta');
  const contentDir = path.join(ROOT, 'personas', 'ledger', 'src', 'content');

  /**
   * Parse a flat dash-prefixed block list from YAML text under `key`.
   * Handles: key:\n  - item1\n  - item2
   * Returns [] when the key is absent, empty, or has an inline scalar value.
   */
  function extractSubagentsList(text, key) {
    const prefix = key + ':';
    let collecting = false;
    const result = [];

    for (const line of text.split('\n')) {
      const stripped = line.trim();
      if (!stripped || stripped.startsWith('#')) continue;

      if (stripped.startsWith(prefix)) {
        const rest = stripped.slice(prefix.length).trim();
        if (!rest) {
          collecting = true;
        }
        continue;
      }

      if (collecting) {
        if (stripped.startsWith('- ')) {
          let val = stripped.slice(2).trim();
          if ((val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          const ci = val.indexOf(' #');
          if (ci !== -1) val = val.slice(0, ci).trim();
          result.push(val);
        } else {
          break;  // next top-level key — stop collecting
        }
      }
    }
    return result;
  }

  const metaFiles = fs.existsSync(metaDir)
    ? fs.readdirSync(metaDir).filter(f => /^\d+-/.test(f) && f.endsWith('.yaml'))
    : [];

  const errors = [];

  for (const yamlFile of metaFiles) {
    const baseName    = yamlFile.replace('.yaml', '');
    const contentPath = path.join(contentDir, baseName + '.md');
    if (!fs.existsSync(contentPath)) continue;

    const subagents   = extractSubagentsList(
      fs.readFileSync(path.join(metaDir, yamlFile), 'utf8'),
      'subagents',
    );
    const contentText = fs.readFileSync(contentPath, 'utf8');

    const agentSlugRe = /\{\{agent_slug_([a-z0-9_]+)\}\}/g;
    let m;
    while ((m = agentSlugRe.exec(contentText)) !== null) {
      const suffix       = m[1];
      const expectedSlug = suffix.replace(/_/g, '-');

      if (!subagents.includes(expectedSlug)) {
        errors.push(
          `Persona "${baseName}": {{agent_slug_${suffix}}} references slug ` +
          `"${expectedSlug}" which is not declared in the subagents list. ` +
          `Add "${expectedSlug}" to the subagents field in ${yamlFile}.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error('\n[ERROR] agent_slug cross-reference check failed:\n');
    for (const err of errors) {
      console.error('  ' + err);
    }
    process.exit(1);
  }
}
