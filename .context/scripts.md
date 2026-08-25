# AI Insights - Scripts
<INSTRUCTION>
# AI Insights - Root Scripts
All root-level Node.js scripts: CLI command centre, persona sync and build, version checks, orchestrator management, changelog extraction, and CTX generation.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: Workspace scripts (CLI, persona sync, build, bundling, validation)_
# Workspace scripts (CLI, persona sync, build, bundling, validation)
```
// Structure of documents
└── scripts/
    └── backfill-duration.js
    └── build-personas.js
    └── build-skills.js
    └── bundle-docs.js
    └── check-known-roles.js
    └── check-version-sync.js
    └── cli.js
    └── extract-changelog-entry.js
    └── extract-dialogue.js
    └── generate-agents-overview.js
    └── import-standalone.js
    └── install-hooks.js
    └── install-mcp-global.js
    └── kill-orchestrator.js
    └── lib/
        ├── health-checks.js
        ├── insight-validation.js
        ├── ledger-dirs.js
        ├── persona-model-resolution.js
        ├── store-commands.js
        ├── yaml-utils.js
    └── migrate-knowledge-uuids.js
    └── normalize-ctx-paths.js
    └── package-personas.js
    └── preflight-bootstrap.js
    └── preflight-orchestrator.js
    └── publish-locations.js
    └── publish-skills.js
    └── read-log.js
    └── run-gui.js
    └── run-orchestrator.js
    └── sync-personas.js
    └── validate-workflow-manifest.js

```
###  Path: `/scripts/backfill-duration.js`

```js
#!/usr/bin/env node
/**
 * scripts/backfill-duration.js
 *
 * One-time backfill: populates `duration_ms` in `.meta.json` for existing
 * projects that already have `synthesis_generated_at` set on their root index
 * (`project-ledger.json`) but predate the enrichment-cache field.
 *
 * duration_ms = synthesis_generated_at - date_created (milliseconds).
 * Standalone projects with a zero-duration same-session import are nulled out,
 * matching the semantics of `LedgerStore.writeRootIndex()`.
 *
 * Usage:
 *   node scripts/backfill-duration.js [options]
 *   node scripts/cli.js backfill-duration [options]
 *
 * Options:
 *   --dry-run    Report planned changes without writing any files.
 *   --verbose    Log each project processed.
 *
 * Store discovery order:
 *   1. ~/.ai-insights/stores.json — multi-store config
 *   2. LEDGER_ROOT env var         — single-store fallback path
 *
 * Idempotent: projects whose .meta.json already has a non-null duration_ms
 * are skipped.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { listAllProjectDirs } from './lib/ledger-dirs.js';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

// ─── Store discovery ──────────────────────────────────────────────────────────

/**
 * Returns an array of absolute store root paths.
 * Precedence: stores.json → LEDGER_ROOT env var.
 * @returns {string[]}
 */
function resolveStorePaths() {
  const storesConfigPath = join(homedir(), '.ai-insights', 'stores.json');
  if (existsSync(storesConfigPath)) {
    try {
      const config = JSON.parse(readFileSync(storesConfigPath, 'utf8'));
      if (Array.isArray(config.stores) && config.stores.length > 0) {
        const paths = config.stores
          .map((s) => (typeof s.path === 'string' ? resolve(s.path.replace(/^~/, homedir())) : null))
          .filter(Boolean);
        if (paths.length > 0) {
          return paths;
        }
      }
    } catch {
      console.error(`[backfill-duration] Warning: failed to parse ${storesConfigPath} — ignoring.`);
    }
  }

  const envRoot = process.env['LEDGER_ROOT'];
  if (envRoot) {
    return [resolve(envRoot)];
  }

  return [];
}

// ─── Backfill logic ───────────────────────────────────────────────────────────

/**
 * Backfills `duration_ms` for a single project directory.
 * @param {string} projectDir
 * @returns {{ action: 'skipped-has-duration'|'skipped-no-synthesis'|'skipped-error'|'backfilled'|'dry-run', durationMs?: number|null, error?: string }}
 */
function backfillProject(projectDir) {
  const metaPath = join(projectDir, '.meta.json');
  const rootIndexPath = join(projectDir, 'project-ledger.json');

  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (err) {
    return { action: 'skipped-error', error: `Malformed .meta.json: ${err.message}` };
  }

  if (meta.duration_ms !== undefined && meta.duration_ms !== null) {
    return { action: 'skipped-has-duration' };
  }

  let rootIndex;
  try {
    rootIndex = JSON.parse(readFileSync(rootIndexPath, 'utf8'));
  } catch (err) {
    return { action: 'skipped-error', error: `Malformed project-ledger.json: ${err.message}` };
  }

  if (!rootIndex.synthesis_generated_at) {
    return { action: 'skipped-no-synthesis' };
  }

  // Use the root index's date_created — it is the source of truth (e.g. standalone imports
  // derive it from plan.md's filesystem birthtime, which can predate .meta.json's own
  // date_created by days). Falling back to meta.date_created would silently misreport duration.
  const created = new Date(rootIndex.date_created ?? meta.date_created).getTime();
  const synth = new Date(rootIndex.synthesis_generated_at).getTime();

  let durationMs;
  if (isNaN(created) || isNaN(synth) || synth < created) {
    durationMs = null;
  } else if (synth === created && rootIndex.runner === 'standalone') {
    durationMs = null;
  } else {
    durationMs = synth - created;
  }

  if (DRY_RUN) {
    return { action: 'dry-run', durationMs };
  }

  const updatedMeta = { ...meta, duration_ms: durationMs };
  const tmp = metaPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(updatedMeta, null, 2) + '\n', 'utf8');
  renameSync(tmp, metaPath);

  return { action: 'backfilled', durationMs };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const storePaths = resolveStorePaths();

  if (storePaths.length === 0) {
    console.error(
      '[backfill-duration] Error: no store paths found.\n' +
      '  Options:\n' +
      '    ~/.ai-insights/stores.json  Configure multi-store paths.\n' +
      '    LEDGER_ROOT=<path>          Set an env var for single-store mode.'
    );
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('[backfill-duration] Dry-run mode — no files will be written.\n');
  }

  let total = 0;
  let backfilled = 0;
  let skippedHasDuration = 0;
  let skippedNoSynthesis = 0;
  let skippedError = 0;

  for (const storePath of storePaths) {
    if (!existsSync(storePath) || !statSync(storePath).isDirectory()) {
      console.log(`[backfill-duration] Store not found, skipping: ${storePath}`);
      continue;
    }

    const projectDirs = await listAllProjectDirs(storePath);
    console.log(`[backfill-duration] Store: ${storePath} (${projectDirs.length} project(s))`);

    for (const projectDir of projectDirs) {
      const result = backfillProject(projectDir);
      total++;

      switch (result.action) {
        case 'skipped-has-duration':
          skippedHasDuration++;
          if (VERBOSE) console.log(`  [skip]      ${projectDir} — already has duration_ms`);
          break;
        case 'skipped-no-synthesis':
          skippedNoSynthesis++;
          if (VERBOSE) console.log(`  [skip]      ${projectDir} — no synthesis_generated_at`);
          break;
        case 'skipped-error':
          skippedError++;
          console.log(`  [error]     ${projectDir} — ${result.error}`);
          break;
        case 'dry-run':
          backfilled++;
          console.log(`  [dry-run]   ${projectDir} — duration_ms would be ${result.durationMs}`);
          break;
        case 'backfilled':
          backfilled++;
          if (VERBOSE) console.log(`  [backfilled] ${projectDir} — duration_ms = ${result.durationMs}`);
          break;
      }
    }
  }

  console.log(
    `\n[backfill-duration] Done. ${total} project(s) processed: ` +
    `${backfilled} ${DRY_RUN ? 'would be backfilled' : 'backfilled'}, ` +
    `${skippedHasDuration} skipped (already had duration), ` +
    `${skippedNoSynthesis} skipped (no synthesis), ` +
    `${skippedError} skipped (error).`
  );
}

main().catch((err) => {
  console.error('[backfill-duration] Fatal:', err.message ?? err);
  process.exit(1);
});

```
###  Path: `/scripts/build-personas.js`

```js
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
import { parseYamlScalars, extractYamlBlockScalar } from './lib/yaml-utils.js';
import { validateInsightFieldsInDirs } from './lib/insight-validation.js';

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
// Always: validate insight_agent / insight_report_target pairing and role match.
{
  const suiteMetas = [
    path.join(ROOT, 'personas', 'ledger', 'src', 'meta'),
    path.join(ROOT, 'personas', 'standalone', 'src', 'meta'),
    path.join(ROOT, 'personas', 'ledger-support', 'src', 'meta'),
  ];

  const errors = validateInsightFieldsInDirs(suiteMetas);

  if (errors.length > 0) {
    console.error('\n[ERROR] insight_agent validation failed:\n');
    for (const err of errors) {
      console.error('  ' + err);
    }
    process.exit(1);
  }
}
```
###  Path: `/scripts/build-skills.js`

```js
#!/usr/bin/env node

/**
 * build-skills.js — build skill output files using a custom TargetRegistry.
 * Uses @mistralys/persona-builder programmatic API with vscode-skill and claude-skill targets.
 * Usage: node scripts/build-skills.js [--check] [--dry-run] [--strict]
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

const ROOT   = path.join(import.meta.dirname, '..');
const LIB    = path.join(ROOT, 'personas', 'node_modules', '@mistralys', 'persona-builder', 'dist', 'index.cjs');
const SKILLS = path.join(ROOT, 'skills');
const DIST   = path.join(ROOT, 'dist');

const { build, TargetRegistry } = _require(LIB);

// --dry-run is accepted as a convenience alias for --check (same behaviour)
const CHECK  = process.argv.includes('--check') || process.argv.includes('--dry-run');
const STRICT = process.argv.includes('--strict');

// Frontmatter templates for skill targets.
// VS Code skills: name, description, and optional argument-hint only.
// context/agent are not emitted for VS Code (VS Code doesn't use context: fork).
const VSCODE_SKILL_FRONTMATTER = `---
name: {{name}}
description: "{{description}}"
{{#if argument_hint}}argument-hint: "{{argument_hint}}"
{{/if}}---`;

// Claude Code skills: name, description, plus optional context and agent.
const CLAUDE_SKILL_FRONTMATTER = `---
name: {{name}}
description: "{{description}}"
{{#if context}}context: {{context}}
{{/if}}{{#if agent}}agent: {{agent}}
{{/if}}---`;

// Custom registry — do not register on defaultRegistry (reserved for persona targets).
const skillRegistry = new TargetRegistry();

skillRegistry.register({
    name:               'vscode-skill',
    outputDirKey:       'vscode-skill',
    defaultFrontmatter: VSCODE_SKILL_FRONTMATTER,
    contextFlags:       { target_vscode_skill: true },
});

skillRegistry.register({
    name:               'claude-skill',
    outputDirKey:       'claude-skill',
    defaultFrontmatter: CLAUDE_SKILL_FRONTMATTER,
    contextFlags:       { target_claude_skill: true },
});

// Output directories
const OUT_VSCODE  = path.join(DIST, 'vscode-skills');
const OUT_CLAUDE  = path.join(DIST, 'claude-skills');

// Pre-build: clear output directories so stale/renamed files don't linger.
// Uses recursive removal to catch any subdirectory output, not just top-level .md files.
// Skipped in --check / --dry-run mode (read-only).
if (!CHECK) {
    for (const dir of [OUT_VSCODE, OUT_CLAUDE]) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Suite config: srcDir points at the skills/ source tree.
// contentSubdir: 'src' matches the actual layout (skills/src/).
const suiteConfig = {
    srcDir:        SKILLS,
    contentSubdir: 'src',
    outputDirs: {
        'vscode-skill': OUT_VSCODE,
        'claude-skill':  OUT_CLAUDE,
    },
};

// Build
try {
    const summary = await build({
        suites:         { skills: suiteConfig },
        targets:        ['vscode-skill', 'claude-skill'],
        targetRegistry: skillRegistry,
        check:          CHECK,
        strict:         STRICT,
    });

    const mode = CHECK ? ' (check mode — no files written)' : '';
    console.log(`[build-skills] ${summary.totalBuilt} built, ${summary.totalWritten} written${mode}`);

    if (!summary.success) {
        process.exit(1);
    }
} catch (err) {
    console.error('[build-skills] Build failed:', err.message);
    process.exit(1);
}

```
###  Path: `/scripts/bundle-docs.js`

```js
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

import fs from 'fs';
import path from 'path';

const ROOT        = path.resolve(import.meta.dirname, '..');
const BUILD_DIR   = path.join(ROOT, 'build');
const TEMPLATES   = path.join(ROOT, 'scripts', 'templates');

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
  'handoff.md',
  'recommendations.md',
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

  // Preamble — static content from template; date injected after heading
  const headerTpl = fs.readFileSync(path.join(TEMPLATES, 'notebooklm-bundle-header.md'), 'utf-8');
  const now       = new Date().toISOString().slice(0, 10);
  parts.push(
    headerTpl
      .replace(
        /^(# AI Insights — Combined Reference for NotebookLM)\n/,
        `$1\n\n> **Generated:** ${now}\n> \n`,
      )
      .trimEnd(),
  );

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

```
###  Path: `/scripts/check-known-roles.js`

```js
#!/usr/bin/env node

/**
 * scripts/check-known-roles.js
 *
 * Previously: compared KNOWN_ROLES in sync-personas.js against AGENT_ROLES in
 * mcp-server/src/utils/constants.ts to detect drift.
 *
 * Now superseded: both sync-personas.js and mcp-server/src/utils/constants.ts
 * derive their role lists directly from shared/workflow-manifest.json — so the
 * JS ↔ TS drift check is no longer meaningful. This script now delegates to
 * scripts/validate-workflow-manifest.js, which performs structural and semantic
 * validation of the manifest itself (unique IDs, DAG prerequisites, fail_routing
 * cross-references, and more).
 *
 * Usage:
 *   node scripts/check-known-roles.js          # from workspace root
 *   npm run check:roles                         # from mcp-server/ directory
 */

import path from 'path';
import { execFileSync } from 'child_process';

const WORKSPACE_ROOT     = path.resolve(import.meta.dirname, '..');
const VALIDATE_SCRIPT    = path.join(WORKSPACE_ROOT, 'scripts', 'validate-workflow-manifest.js');

console.log('[check-known-roles] Role list is now derived from shared/workflow-manifest.json.');
console.log('[check-known-roles] Delegating to validate-workflow-manifest.js...\n');

try {
  execFileSync(process.execPath, [VALIDATE_SCRIPT], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
  });
} catch {
  // validate-workflow-manifest.js already printed the errors; just propagate exit code.
  process.exit(1);
}


```
###  Path: `/scripts/check-version-sync.js`

```js
#!/usr/bin/env node

/**
 * scripts/check-version-sync.js
 *
 * Compares each module's changelog version (source of truth) against its
 * package manifest version. Exits with code 1 on any mismatch.
 *
 * Usage:
 *   node scripts/check-version-sync.js          # from workspace root
 *
 * Modules checked:
 *   - mcp-server:   changelog.md  vs  package.json
 *   - orchestrator:  changelog.md  vs  pyproject.toml
 *   - personas:      changelog.md  vs  package.json
 */

import path from 'path';
import fs from 'fs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');

// ─── Module definitions ──────────────────────────────────────────────────────

const MODULES = [
  {
    name:        'mcp-server',
    changelog:   path.join(WORKSPACE_ROOT, 'mcp-server', 'changelog.md'),
    manifest:    path.join(WORKSPACE_ROOT, 'mcp-server', 'package.json'),
    manifestFmt: 'package.json',
    readManifestVersion(filePath) {
      const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return pkg.version || null;
    },
  },
  {
    name:        'orchestrator',
    changelog:   path.join(WORKSPACE_ROOT, 'orchestrator', 'changelog.md'),
    manifest:    path.join(WORKSPACE_ROOT, 'orchestrator', 'pyproject.toml'),
    manifestFmt: 'pyproject.toml',
    readManifestVersion(filePath) {
      const content = fs.readFileSync(filePath, 'utf8');
      const m = content.match(/^version\s*=\s*"([^"]+)"/m);
      return m ? m[1] : null;
    },
  },
  {
    name:        'personas',
    changelog:   path.join(WORKSPACE_ROOT, 'personas', 'changelog.md'),
    manifest:    path.join(WORKSPACE_ROOT, 'personas', 'package.json'),
    manifestFmt: 'package.json',
    readManifestVersion(filePath) {
      const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return pkg.version || null;
    },
  },
];

// ─── Changelog version extractor ─────────────────────────────────────────────

/**
 * Extract the first semver version from a changelog's `## v{X.Y.Z}` heading.
 * Returns 'UNRELEASED' if the first heading is an UNRELEASED entry.
 * @param {string} filePath - Absolute path to the changelog file.
 * @returns {string|null} The version string (without the "v" prefix), 'UNRELEASED', or null.
 */
function readChangelogVersion(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const firstHeading = content.match(/^##\s+(.+)/m);
  if (firstHeading && /unreleased/i.test(firstHeading[1])) {
    return 'UNRELEASED';
  }
  const m = content.match(/^##\s+v(\d+\.\d+\.\d+)/m);
  return m ? m[1] : null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const mismatches = [];

for (const mod of MODULES) {
  let changelogVer, manifestVer;

  try {
    changelogVer = readChangelogVersion(mod.changelog);
  } catch (err) {
    console.error(`[check-version-sync] ERROR: Cannot read ${mod.name}/changelog.md: ${err.message}`);
    process.exit(1);
  }

  try {
    manifestVer = mod.readManifestVersion(mod.manifest);
  } catch (err) {
    console.error(`[check-version-sync] ERROR: Cannot read ${mod.name}/${mod.manifestFmt}: ${err.message}`);
    process.exit(1);
  }

  if (changelogVer === 'UNRELEASED') {
    console.log(`[check-version-sync] Skipping ${mod.name}: changelog has an UNRELEASED entry.`);
    continue;
  }

  if (!changelogVer) {
    console.error(`[check-version-sync] ERROR: No version heading found in ${mod.name}/changelog.md`);
    process.exit(1);
  }

  if (!manifestVer) {
    console.error(`[check-version-sync] ERROR: No version found in ${mod.name}/${mod.manifestFmt}`);
    process.exit(1);
  }

  if (changelogVer !== manifestVer) {
    mismatches.push({
      name:         mod.name,
      changelogVer,
      manifestVer,
      manifestFmt:  mod.manifestFmt,
    });
  }
}

if (mismatches.length > 0) {
  console.error('[check-version-sync] Version mismatch detected:\n');
  for (const m of mismatches) {
    console.error(`  ${m.name}: changelog says v${m.changelogVer}, ${m.manifestFmt} says v${m.manifestVer}`);
  }
  console.error('\nRun this to fix:  node scripts/cli.js build-maintain\n');
  process.exit(1);
}

console.log('[check-version-sync] All module versions are in sync.');
process.exit(0);

```
###  Path: `/scripts/cli.js`

```js
#!/usr/bin/env node

/**
 * scripts/cli.js
 *
 * Unified workspace CLI -- interactive command center and direct CLI entry point.
 *
 * Usage:
 *   node scripts/cli.js                     Interactive main menu
 *   node scripts/cli.js help                Show all commands
 *   node scripts/cli.js setup               Interactive setup wizard
 *   node scripts/cli.js setup --all         Non-interactive full setup
 *   node scripts/cli.js setup --components  Run selected components
 *   node scripts/cli.js --skip-setup-check  Skip first-run detection (for CI/automated use)
 *   node scripts/cli.js <command> [flags]   Run a command directly
 */

import {
  createMenu,
  C,
  log,
  IS_WIN,
  NPM,
  sh,
  runScript,
  runLongScript,
  checkNodeVersion,
  PreflightError,
  waitForKey,
} from '@mistralys/cli-menu';

import {
  readChangelogVersion,
  readPackageVersion,
  readPyprojectVersion,
} from '@mistralys/cli-menu/changelog';

import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { spawnSync } from 'child_process';
import { getPublishLocations } from './publish-locations.js';
import { install as mcpGlobalInstall, dryRun as mcpGlobalDryRun, shimConfigExists } from './install-mcp-global.js';
import { HEALTH_CHECKS, runChecks } from './lib/health-checks.js';
import {
  storeInit,
  storeAdd,
  storeRemove,
  storeList,
  storeSetDefault,
  storeConflicts,
  storeStatus,
  storeRepoAdd,
  storeRepoMove,
  storeRepoList,
} from './lib/store-commands.js';

// --- Constants ---

const WORKSPACE_ROOT   = path.resolve(import.meta.dirname, '..');
const SCRIPTS_DIR      = import.meta.dirname;
const MCP_SERVER_DIR   = path.join(WORKSPACE_ROOT, 'mcp-server');
const PERSONAS_DIR     = path.join(WORKSPACE_ROOT, 'personas');
const ORCHESTRATOR_DIR = path.join(WORKSPACE_ROOT, 'orchestrator');
const CHANGELOG_FILE   = path.join(WORKSPACE_ROOT, 'changelog.md');
// --- Pre-flight checks ---

function checkWorkspaceRoot() {
  if (!fs.existsSync(MCP_SERVER_DIR)) {
    throw new PreflightError('Run from the workspace root (mcp-server/ not found)');
  }
}

// --- Python finder (for orchestrator setup) ---

function findPython() {
  const candidates = IS_WIN ? ['python', 'python3', 'py'] : ['python3', 'python'];
  for (const cand of candidates) {
    const a = cand === 'py' ? ['-3', '--version'] : ['--version'];
    const r = spawnSync(cand, a, { encoding: 'utf8', shell: false });
    if (r.status !== 0) continue;
    const raw = (r.stdout || '') + (r.stderr || '');
    const m = raw.match(/Python (\d+)\.(\d+)/);
    if (!m) continue;
    if (parseInt(m[1], 10) === 3 && parseInt(m[2], 10) >= 11) return cand;
  }
  return null;
}

function syncOrchestratorVersion() {
  const changelogPath = path.join(ORCHESTRATOR_DIR, 'changelog.md');
  const pyprojectPath = path.join(ORCHESTRATOR_DIR, 'pyproject.toml');

  if (!fs.existsSync(changelogPath)) {
    log('  ✗ orchestrator/changelog.md not found');
    return;
  }
  if (!fs.existsSync(pyprojectPath)) {
    log('  ✗ orchestrator/pyproject.toml not found');
    return;
  }

  try {
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    const versionMatch = changelog.match(/^##\s+(?:\[|v)?(\d+\.\d+\.\d+)/m);

    if (!versionMatch) {
      log('  ⚠ Could not find version in orchestrator/changelog.md');
      return;
    }

    const newVersion = versionMatch[1];
    let pyproject = fs.readFileSync(pyprojectPath, 'utf8');

    const versionRegex = /^version\s*=\s*"[^"]+"/m;
    if (!versionRegex.test(pyproject)) {
      log('  ⚠ Could not find "version" key in pyproject.toml');
      return;
    }

    const newContent = pyproject.replace(versionRegex, `version = "${newVersion}"`);

    if (newContent !== pyproject) {
      fs.writeFileSync(pyprojectPath, newContent, 'utf8');
      log(`  ✓ Updated orchestrator/pyproject.toml to ${newVersion}`, 'green');
    } else {
      log(`  ✓ orchestrator/pyproject.toml already at ${newVersion}`, 'green');
    }
  } catch (e) {
    log(`  ✗ Failed to sync orchestrator version: ${e.message}`, 'red');
  }
}

function venvBin(name) {
  return IS_WIN
    ? path.join(ORCHESTRATOR_DIR, '.venv', 'Scripts', `${name}.exe`)
    : path.join(ORCHESTRATOR_DIR, '.venv', 'bin', name);
}

// --- Setup components ---

const SETUP_COMPONENTS = [
  {
    id:    'mcp-server',
    label: 'MCP Server',
    desc:  'npm install + build',
    detect() {
      if (!fs.existsSync(path.join(MCP_SERVER_DIR, 'dist'))) return false;
      // node_modules must exist AND be in sync with package-lock.json
      const outerLock = path.join(MCP_SERVER_DIR, 'package-lock.json');
      const innerLock = path.join(MCP_SERVER_DIR, 'node_modules', '.package-lock.json');
      if (!fs.existsSync(innerLock)) return false;
      return fs.statSync(outerLock).mtimeMs <= fs.statSync(innerLock).mtimeMs;
    },
    run() {
      log('  Installing MCP server dependencies…', 'dim');
      if (sh(NPM, ['install'], { cwd: MCP_SERVER_DIR }) !== 0) return false;
      log('  Building MCP server…', 'dim');
      if (sh(NPM, ['run', 'build'], { cwd: MCP_SERVER_DIR }) !== 0) return false;
      return true;
    },
    validate: () => fs.existsSync(path.join(MCP_SERVER_DIR, 'dist', 'index.js')),
  },
  {
    id:    'personas',
    label: 'Personas',
    desc:  'npm install + build + sync to IDE',
    detect() {
      // node_modules must exist AND be in sync with package-lock.json
      const outerLock = path.join(PERSONAS_DIR, 'package-lock.json');
      const innerLock = path.join(PERSONAS_DIR, 'node_modules', '.package-lock.json');
      if (!fs.existsSync(innerLock)) return false;
      return fs.statSync(outerLock).mtimeMs <= fs.statSync(innerLock).mtimeMs;
    },
    run() {
      log('  Installing personas dependencies…', 'dim');
      if (sh(NPM, ['install'], { cwd: PERSONAS_DIR }) !== 0) return false;
      log('  Syncing personas to IDE…', 'dim');
      const r = spawnSync('node', [path.join(SCRIPTS_DIR, 'sync-personas.js')], {
        cwd: WORKSPACE_ROOT,
        stdio: 'inherit',
      });
      return (r.status ?? 1) === 0;
    },
    validate() {
      try {
        const dir = path.join(PERSONAS_DIR, 'ledger', 'vs-code');
        return fs.readdirSync(dir).some((f) => f.endsWith('.md'));
      } catch { return false; }
    },
  },
  {
    id:    'orchestrator',
    label: 'Orchestrator',
    desc:  'Python venv + pip install',
    detect: () => fs.existsSync(path.join(ORCHESTRATOR_DIR, '.venv')),
    run(args = []) {
      const pIdx  = args.indexOf('--provider');
      const prov  = (pIdx !== -1 && args[pIdx + 1]) ? args[pIdx + 1] : 'anthropic';
      const ckpt  = args.includes('--checkpoint');
      const force = args.includes('--force');
      const VENV  = path.join(ORCHESTRATOR_DIR, '.venv');

      const pyBin = findPython();
      if (!pyBin) {
        log('  ✗ Python 3.11+ not found. Install from https://python.org', 'red');
        return false;
      }

      if (fs.existsSync(VENV) && force) {
        log('  --force: removing existing .venv…', 'dim');
        fs.rmSync(VENV, { recursive: true, force: true });
      }
      if (!fs.existsSync(VENV)) {
        log('  Creating virtual environment…', 'dim');
        const vArgs = pyBin === 'py' ? ['-3', '-m', 'venv', VENV] : ['-m', 'venv', VENV];
        if (sh(pyBin, vArgs, { cwd: WORKSPACE_ROOT }) !== 0) return false;
      } else {
        log('  .venv exists — skipping creation (use --force to recreate)', 'dim');
      }

      const sitePkgsCandidates = [
        path.join(VENV, 'Lib', 'site-packages'),
        ...(() => { try { return fs.readdirSync(path.join(VENV, 'lib')).map(d => path.join(VENV, 'lib', d, 'site-packages')); } catch { return []; } })(),
      ];
      for (const sp of sitePkgsCandidates) {
        if (!fs.existsSync(sp)) continue;
        for (const entry of fs.readdirSync(sp, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name.startsWith('~') && entry.name.endsWith('.dist-info')) {
            fs.rmSync(path.join(sp, entry.name), { recursive: true, force: true });
            log(`  Removed partial dist-info: ${entry.name}`, 'dim');
          }
        }
      }

      log('  Upgrading pip…', 'dim');
      if (sh(venvBin('python'), ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], { cwd: WORKSPACE_ROOT }) !== 0) {
        return false;
      }

      const extras = [prov, 'dev', ...(ckpt ? ['checkpoint'] : [])];
      const target = `.[${extras.join(',')}]`;
      log(`  Installing ${target}…`, 'dim');
      if (sh(venvBin('pip'), ['install', '--quiet', '-e', target], { cwd: ORCHESTRATOR_DIR }) !== 0) {
        return false;
      }

      const envFile = path.join(ORCHESTRATOR_DIR, '.env');
      const envEx   = path.join(ORCHESTRATOR_DIR, '.env.example');
      if (!fs.existsSync(envFile) || force) {
        if (fs.existsSync(envEx)) {
          fs.copyFileSync(envEx, envFile);
          log('  ✓ orchestrator/.env created from .env.example', 'green');
        } else {
          fs.writeFileSync(envFile, `PROVIDER=${prov}\n`, 'utf8');
          log('  ✓ orchestrator/.env scaffolded with defaults', 'green');
        }
      } else {
        log('  orchestrator/.env already exists (use --force to overwrite)', 'dim');
      }

      return true;
    },
    validate: () => fs.existsSync(venvBin('python')),
  },
  {
    id:    'global-mcp',
    label: 'Global MCP',
    desc:  'User-level IDE registration (recommended)',
    detect: () => shimConfigExists(),
    run() {
      try {
        mcpGlobalInstall({ log: (msg) => log(msg) });
        return true;
      } catch (err) {
        log(`  \u2717 ${err.message}`, 'red');
        return false;
      }
    },
    validate: () => shimConfigExists(),
  },
  {
    id:    'git-hooks',
    label: 'Git hooks',
    desc:  'Pre-commit persona guard',
    detect() {
      const r = spawnSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' });
      return r.status === 0 && r.stdout.trim() === '.githooks';
    },
    run: () => sh('node', [path.join(SCRIPTS_DIR, 'install-hooks.js')], { cwd: WORKSPACE_ROOT }) === 0,
    validate() {
      const r = spawnSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' });
      return r.status === 0 && r.stdout.trim() === '.githooks';
    },
  },
];

// --- Delegating command functions ---

function cmdSyncPersonas(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'sync-personas.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

async function cmdCleanAgents(args) {
  const force = args.includes('--force');
  const allTargets = getPublishLocations();
  for (const target of allTargets) {
    if (fs.existsSync(target.dir)) {
      target.files = fs.readdirSync(target.dir).filter(target.filter);
    } else {
      target.files = [];
    }
  }
  const nonEmpty = allTargets.filter(t => t.files.length > 0);
  if (nonEmpty.length === 0) {
    log('\n  No persona files found in any publish location.', 'green');
    for (const target of allTargets) {
      log(C.dim(`    ${target.label}: ${target.dir}`));
    }
    return;
  }
  let targets;
  if (force) {
    targets = nonEmpty;
  } else {
    console.log('');
    log('  Select locations to clean:\n');
    for (let i = 0; i < allTargets.length; i++) {
      const t = allTargets[i];
      const num = C.bold(`  [${i + 1}]`);
      if (t.files.length === 0) {
        log(`${num} ${C.dim(t.label + ' (empty)')}`);
      } else {
        log(`${num} ${t.label} ${C.dim(`(${t.files.length} file${t.files.length === 1 ? '' : 's'})`)}`);
      }
    }
    log(C.dim(`\n  Enter numbers separated by commas, or ${C.bold('a')} for all.`));
    const answer = await askCleanInput('  Selection: ');
    const trimmed = answer.trim().toLowerCase();
    if (!trimmed) { log(C.dim('  Cancelled \u2014 no files deleted.')); return; }
    if (trimmed === 'a') {
      targets = nonEmpty;
    } else {
      const indices = trimmed.split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n >= 1 && n <= allTargets.length);
      if (indices.length === 0) {
        log('  Invalid selection \u2014 no files deleted.', 'red');
        return;
      }
      targets = indices.map(i => allTargets[i - 1]).filter(t => t.files.length > 0);
      if (targets.length === 0) {
        log('\n  Selected locations are all empty \u2014 nothing to delete.', 'green');
        return;
      }
    }
  }
  let totalFiles = 0;
  console.log('');
  for (const target of targets) {
    totalFiles += target.files.length;
    log(`  ${C.bold(target.label)} ${C.dim('\u2014 ' + target.dir)}`);
    log(`  ${target.files.length} file${target.files.length === 1 ? '' : 's'}:`);
    for (const file of target.files) {
      log(`    ${C.yellow('\u2022')} ${file}`);
    }
    console.log('');
  }
  if (!force) {
    const activeCount = targets.filter(t => t.files.length > 0).length;
    const answer = await askCleanInput(
      `  Delete all ${totalFiles} file${totalFiles === 1 ? '' : 's'} across ${activeCount} location${activeCount === 1 ? '' : 's'}? [y/N] `,
    );
    if (answer.trim().toLowerCase() !== 'y') {
      log(C.dim('  Cancelled \u2014 no files deleted.'));
      return;
    }
  }
  let deleted = 0;
  for (const target of targets) {
    for (const file of target.files) {
      try {
        fs.unlinkSync(path.join(target.dir, file));
        deleted++;
      } catch (err) {
        log(`  \u2717 Failed to delete ${file}: ${err.message}`, 'red');
      }
    }
  }
  log(`\n  ${C.green('\u2713')} Deleted ${deleted} file${deleted === 1 ? '' : 's'} across all publish locations.`);
}

function askCleanInput(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

function cmdBuildPersonas(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'build-personas.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdBuildSkills(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'build-skills.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdPublishSkills(args) {
  const buildCode = runScript('node', [path.join(SCRIPTS_DIR, 'build-skills.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (buildCode !== 0) process.exit(buildCode);
  const publishArgs = args.includes('--dry-run') ? ['--dry-run'] : [];
  const publishCode = runScript('node', [path.join(SCRIPTS_DIR, 'publish-skills.js'), ...publishArgs], { cwd: WORKSPACE_ROOT });
  if (publishCode !== 0) process.exit(publishCode);
}

function cmdPackagePersonas(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'package-personas.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

async function cmdGui(args) {
  if (!args.includes('--port')) {
    const portInput = await askCleanInput('  Port [3420]: ');
    const trimmed = portInput.trim();
    if (trimmed) {
      const p = parseInt(trimmed, 10);
      if (isNaN(p) || p <= 0) { log('  Invalid port number.', 'red'); return; }
      args = [...args, '--port', String(p)];
    }
  }
  const { child, exitCode } = runLongScript('node', [path.join(SCRIPTS_DIR, 'run-gui.js'), ...args], { cwd: WORKSPACE_ROOT });
  child.on('error', (err) => { log(`\u2717 Failed to launch run-gui.js: ${err.message}`, 'red'); process.exit(1); });
  process.once('SIGINT', () => child.kill('SIGINT'));
  return exitCode.then(code => { process.exit(code); });
}

function cmdBuildMaintain(args) {
  const syncCode = runScript('node', [path.join(MCP_SERVER_DIR, 'scripts', 'sync-version.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (syncCode !== 0) process.exit(syncCode);
  syncOrchestratorVersion();
  const buildArgs = args.includes('--suite') ? args : ['--suite', 'all', ...args];
  const buildCode = runScript('node', [path.join(SCRIPTS_DIR, 'build-personas.js'), ...buildArgs], { cwd: WORKSPACE_ROOT });
  if (buildCode !== 0) process.exit(buildCode);
  const overviewCode = runScript('node', [path.join(SCRIPTS_DIR, 'generate-agents-overview.js')], { cwd: WORKSPACE_ROOT });
  if (overviewCode !== 0) process.exit(overviewCode);
  const rolesCode = runScript('node', [path.join(SCRIPTS_DIR, 'check-known-roles.js')], { cwd: WORKSPACE_ROOT });
  if (rolesCode !== 0) process.exit(rolesCode);
  cmdCtxGenerate(args);
}

function cmdOrchestrator(args) {
  const { child, exitCode } = runLongScript('node', [path.join(SCRIPTS_DIR, 'run-orchestrator.js'), ...args], { cwd: WORKSPACE_ROOT });
  child.on('error', (err) => { log(`\u2717 Failed to launch run-orchestrator.js: ${err.message}`, 'red'); process.exit(1); });
  process.once('SIGINT', () => child.kill('SIGINT'));
  return exitCode.then(code => { process.exit(code); });
}

function cmdPreflight(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'preflight-orchestrator.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdPreviewPrompts(args) {
  const code = runScript(venvBin('python'), [path.join(SCRIPTS_DIR, 'preview-prompts.py'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdCheckRoles() {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'check-known-roles.js')], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdCheckVersions() {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'check-version-sync.js')], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdBundleDocs(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'bundle-docs.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdGenerateOverview(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'generate-agents-overview.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdCtxGenerate(args) {
  const ctxDir = path.join(WORKSPACE_ROOT, '.context');
  if (fs.existsSync(ctxDir)) {
    fs.rmSync(ctxDir, { recursive: true, force: true });
    log('Cleaned .context/', 'dim');
  }
  const result = spawnSync('ctx', ['generate', ...args], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
    shell: IS_WIN,
  });
  if (result.status !== 0) {
    log('\n\u2717 ctx generate exited with code ' + (result.status ?? 1), 'red');
    process.exit(result.status ?? 1);
  }
  sh('node', [path.join(SCRIPTS_DIR, 'normalize-ctx-paths.js'), ctxDir], { cwd: WORKSPACE_ROOT });
  fs.writeFileSync(path.join(ctxDir, 'generated-at.txt'), new Date().toISOString() + '\n');
  const agentsMd = path.join(WORKSPACE_ROOT, 'AGENTS.md');
  const claudeMd = path.join(WORKSPACE_ROOT, 'CLAUDE.md');
  if (fs.existsSync(agentsMd)) {
    const agentsContent = fs.readFileSync(agentsMd, 'utf8');
    const header = '<!-- NOTE: This file is generated automatically from AGENTS.md whenever CTX documents are updated -->\n\n';
    fs.writeFileSync(claudeMd, header + agentsContent, 'utf8');
    log('Synced AGENTS.md \u2192 CLAUDE.md', 'dim');
  } else {
    log('\u26a0 AGENTS.md not found \u2014 CLAUDE.md not updated', 'yellow');
  }
}

function cmdGitHooks() {
  sh('node', [path.join(SCRIPTS_DIR, 'install-hooks.js')], { cwd: WORKSPACE_ROOT });
}

async function cmdDoctor() {
  const results = await runChecks('all');
  let anyFailed = false;
  for (const { label, passed, fix } of results) {
    if (passed) {
      log(`  ${C.green('\u2713')} ${label}`);
    } else {
      anyFailed = true;
      log(`  ${C.red('\u2717')} ${label}`);
      if (fix) {
        log(`       ${C.dim(fix)}`);
      }
    }
  }
  if (anyFailed) {
    process.exit(1);
  }
}

async function cmdInstallMcp(args) {
  if (args.includes('--dry-run')) {
    mcpGlobalDryRun();
  } else {
    try {
      mcpGlobalInstall({ log: (msg) => log(msg) });
    } catch (err) {
      log(`  \u2717 ${err.message}`, 'red');
      process.exit(1);
    }
  }
  await waitForKey();
}

function cmdReadLog(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'read-log.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdExtractDialogue(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'extract-dialogue.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdImportStandalone(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'import-standalone.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdKillOrchestrator(args) {

  const code = runScript('node', [path.join(SCRIPTS_DIR, 'kill-orchestrator.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdBackfillDuration(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'backfill-duration.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

// ─── Store command group ──────────────────────────────────────────────────────

/**
 * Formats and prints a storeList result to the console.
 * @param {Array} stores
 * @param {string} defaultStore
 */
function printStoreList(stores, defaultStore) {
  if (stores.length === 0) {
    log('  No stores configured. Run `store init` to get started.', 'dim');
    return;
  }
  for (const s of stores) {
    const marker = s.is_default ? C.green('★ default') : C.dim('         ');
    log(`  ${marker}  ${C.bold(s.id)}  ${C.dim(s.path)}`);
    log(`           repos: ${s.repo_count}  projects: ${s.project_count}`);
  }
}

async function cmdStore(args) {
  const sub  = args[0];
  const rest = args.slice(1);

  switch (sub) {

    case 'init': {
      const ledgerRoot = rest[0] ?? undefined;
      const result = storeInit({ ledgerRoot });
      if (!result.ok) {
        log(`  ${C.red('✗')} ${result.reason}`, 'red');
        process.exit(1);
      }
      log(`  ${C.green('✓')} stores.json created at ${result.configPath}`);
      log(`    Default store → ${result.config.stores[0].path}`);
      break;
    }

    case 'add': {
      const [id, storePath] = rest;
      if (!id || !storePath) {
        log('  Usage: store add <id> <path>', 'red');
        process.exit(1);
      }
      const result = storeAdd({ id, storePath });
      if (!result.ok) {
        log(`  ${C.red('✗')} ${result.reason}`, 'red');
        process.exit(1);
      }
      log(`  ${C.green('✓')} Store '${result.id}' added → ${result.path}`);
      break;
    }

    case 'remove': {
      const [id] = rest;
      if (!id) { log('  Usage: store remove <id>', 'red'); process.exit(1); }
      const result = storeRemove({ id });
      if (!result.ok) {
        log(`  ${C.red('✗')} ${result.reason}`, 'red');
        process.exit(1);
      }
      if (result.warned) {
        log(`  ${C.yellow('⚠')} Store '${id}' removed from stores.json.`, 'yellow');
        log(`    ${C.yellow('Warning:')} The store's .repositories.json contains entries. The directory was NOT deleted.`, 'yellow');
      } else {
        log(`  ${C.green('✓')} Store '${id}' removed from stores.json (directory not deleted).`);
      }
      break;
    }

    case 'list': {
      const result = await storeList();
      if (!result.ok) {
        log(`  ${C.red('✗')} Failed to load stores.json.`, 'red');
        process.exit(1);
      }
      printStoreList(result.stores, result.default_store);
      break;
    }

    case 'default': {
      const [id] = rest;
      if (!id) { log('  Usage: store default <id>', 'red'); process.exit(1); }
      const result = storeSetDefault({ id });
      if (!result.ok) {
        log(`  ${C.red('✗')} ${result.reason}`, 'red');
        process.exit(1);
      }
      log(`  ${C.green('✓')} Default store set to '${result.default_store}'.`);
      break;
    }

    case 'conflicts': {
      const result = storeConflicts();
      if (!result.ok) {
        log(`  ${C.red('✗')} Failed to detect conflicts.`, 'red');
        process.exit(1);
      }
      if (result.conflicts.length === 0) {
        log(`  ${C.green('✓')} No conflicts — each repository is registered in exactly one store.`);
      } else {
        log(`  ${C.yellow('⚠')} Found ${result.conflicts.length} conflict(s):`);
        for (const c of result.conflicts) {
          log(`\n  ${C.bold(c.repo_name)}`);
          for (const e of c.entries) {
            const tag = e.store_id === c.winner_store_id
              ? C.green('  Active (winner)  ')
              : C.red('  Shadowed         ');
            log(`    ${tag}  ${C.dim('store:')} ${e.store_id}`);
          }
        }
      }
      break;
    }

    case 'status': {
      const result = storeStatus();
      if (!result.ok) {
        log(`  ${C.red('✗')} Failed to retrieve store status.`, 'red');
        process.exit(1);
      }
      if (result.statuses.length === 0) {
        log('  No stores configured.', 'dim');
      } else {
        for (const s of result.statuses) {
          if (!s.is_git) {
            log(`  ${C.dim('—')} ${C.bold(s.id)}  ${C.dim('(not a git repo)')}`);
          } else if (s.status === 'no upstream') {
            log(`  ${C.yellow('?')} ${C.bold(s.id)}  ${C.dim('(no upstream configured)')}`);
          } else {
            const ahead  = s.ahead  > 0 ? C.yellow(`↑${s.ahead}`)  : '';
            const behind = s.behind > 0 ? C.yellow(`↓${s.behind}`) : '';
            const sync   = (s.ahead === 0 && s.behind === 0)
              ? C.green('in sync')
              : [ahead, behind].filter(Boolean).join(' ');
            log(`  ${C.bold(s.id)}  ${sync}  ${C.dim(s.path)}`);
          }
        }
      }
      break;
    }

    case 'repo': {
      const repoSub = rest[0];
      const repoRest = rest.slice(1);

      switch (repoSub) {

        case 'add': {
          const [repoName, storeId] = repoRest;
          if (!repoName || !storeId) {
            log('  Usage: store repo add <repo-name> <store-id>', 'red');
            process.exit(1);
          }
          const result = storeRepoAdd({ repoName, storeId });
          if (!result.ok) {
            log(`  ${C.red('✗')} ${result.reason}`, 'red');
            process.exit(1);
          }
          log(`  ${C.green('✓')} Repository '${result.repoName}' added to store '${result.storeId}'.`);
          break;
        }

        case 'move': {
          const [repoName, targetStoreId] = repoRest;
          if (!repoName || !targetStoreId) {
            log('  Usage: store repo move <repo-name> <target-store-id>', 'red');
            process.exit(1);
          }
          const result = storeRepoMove({ repoName, targetStoreId });
          if (!result.ok) {
            log(`  ${C.red('✗')} ${result.reason}`, 'red');
            process.exit(1);
          }
          log(`  ${C.green('✓')} Repository '${result.repoName}' moved from '${result.fromStoreId}' → '${result.toStoreId}'.`);
          break;
        }

        case 'list': {
          const result = storeRepoList();
          if (!result.ok) {
            log(`  ${C.red('✗')} Failed to load repo list.`, 'red');
            process.exit(1);
          }
          if (result.repos.length === 0) {
            log('  No repositories registered in any store.', 'dim');
          } else {
            for (const r of result.repos) {
              const shadow = r.is_shadowed ? C.red(' [shadowed]') : '';
              log(`  ${C.bold(r.folder_names?.join(', ') ?? r.id)}${shadow}  ${C.dim('store:')} ${r.store_id}`);
            }
          }
          break;
        }

        default:
          log(`  Unknown repo subcommand '${repoSub ?? ''}'. Use: store repo add|move|list`, 'red');
          process.exit(1);
      }
      break;
    }

    default:
      log(`  Unknown store subcommand '${sub ?? ''}'. Use: store init|add|remove|list|default|conflicts|status|repo`, 'red');
      process.exit(1);
  }
}

async function cmdOrchestratorTests(args) {
  const pytest = venvBin('python');
  let marker = 'integration or deepagent';

  if (args.includes('--live')) {
    marker = 'integration or deepagent or live';
    args = args.filter((a) => a !== '--live');
  } else if (!args.some((a) => a === '-m' || a === '--markers')) {
    const answer = await askCleanInput('  Include live MCP tests? (requires API key) [y/N] ');
    if (answer.trim().toLowerCase() === 'y') {
      marker = 'integration or deepagent or live';
    }
  }

  // Auto-build MCP server dist when live tests are included
  if (marker.includes('live')) {
    const sentinel = path.join(MCP_SERVER_DIR, 'dist', 'index.js');
    const srcDir   = path.join(MCP_SERVER_DIR, 'src');
    let needBuild  = !fs.existsSync(sentinel);
    if (!needBuild) {
      const sentinelMtime = fs.statSync(sentinel).mtimeMs;
      needBuild = latestMtime(srcDir) > sentinelMtime;
    }
    if (needBuild) {
      log('  MCP server dist is stale — rebuilding…', 'dim');
      if (sh(NPM, ['run', 'build'], { cwd: MCP_SERVER_DIR }) !== 0) {
        log('  ✗ MCP server build failed', 'red');
        process.exit(1);
      }
    }
  }

  const testArgs = ['-m', 'pytest', 'tests/', '-v', '-m', marker, ...args];
  const code = runScript(pytest, testArgs, { cwd: ORCHESTRATOR_DIR });
  if (code !== 0) process.exit(code);
  await waitForKey();
}

/**
 * Recursively find the latest mtime (ms) of any file under `dir`.
 */
function latestMtime(dir) {
  let latest = -Infinity;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestMtime(full));
    } else if (entry.isFile()) {
      latest = Math.max(latest, fs.statSync(full).mtimeMs);
    }
  }
  return latest;
}

// --- Command registry ---

const COMMANDS = [
  {
    id:           'setup',
    key:          's',
    label:        'Setup & Refresh',
    category:     'Setup & Configuration',
    description:  'Full workspace setup & refresh wizard',
    helpVariants: [
      ['setup --all',              'Non-interactive full setup'],
      ['setup --components <ids>', 'Run selected components (e.g. mcp-server,personas)'],
    ],
  },
  {
    id:          'build-maintain',
    key:         'b',
    label:       'Build & Maintain',
    category:    'Validation & Utilities',
    description: 'Sync versions, build personas & CTX generate',
    run:         cmdBuildMaintain,
  },
  {
    id:           'install-mcp',
    key:          'i',
    label:        'Install MCP (Global)',
    category:     'Setup & Configuration',
    description:  'Register MCP server in VS Code user config via stable shim',
    helpVariants: [
      ['install-mcp --dry-run', 'Preview changes without writing'],
    ],
    run:          cmdInstallMcp,
  },
  {
    id:          'git-hooks',
    key:         'o',
    label:       'Install git hooks',
    category:    'Setup & Configuration',
    description: 'Install git hooks (pre-commit build & version guards)',
    run:         cmdGitHooks,
  },
  {
    id:          'sync-personas',
    key:         'p',
    label:       'Sync personas',
    category:    'Personas',
    description: 'Deploy to VS Code & Claude Code',
    run:         cmdSyncPersonas,
  },
  {
    id:          'build-skills',
    key:         null,
    label:       'Build skills',
    category:    'Skills',
    description: 'Build skill output files',
    run:         cmdBuildSkills,
  },
  {
    id:          'publish-skills',
    key:         null,
    label:       'Publish skills',
    category:    'Skills',
    description: 'Build & deploy skills to VS Code and Claude Code',
    run:         cmdPublishSkills,
  },
  {
    id:          'package-personas',
    key:         'z',
    label:       'Package personas',
    category:    'Personas',
    description: 'ZIP standalone personas',
    run:         cmdPackagePersonas,
  },
  {
    id:           'clean-agents',
    key:          'c',
    label:        'Clean agent folder',
    category:     'Personas',
    description:  'Delete persona files from all publish locations',
    helpVariants: [
      ['clean-agents --force', 'Delete without confirmation (agent use)'],
    ],
    run:          cmdCleanAgents,
  },
  {
    id:          'gui',
    key:         'g',
    label:       'Launch GUI dashboard',
    category:    'MCP Server',
    description: 'Launch MCP GUI dashboard (long-running)',
    run:         cmdGui,
  },
  {
    id:           'import-standalone',
    key:          null,
    label:        'Import standalone plan',
    category:     'MCP Server',
    description:  'Import a standalone plan folder into the project ledger',
    helpVariants: [
      ['import-standalone --path <dir>',                    'Import a single plan folder'],
      ['import-standalone --batch',                         'Scan docs/agents/ and import untracked plans'],
      ['import-standalone --batch --base-dir <dir>',        'Scan a custom directory'],
      ['import-standalone --batch --dry-run',               'Preview without writing'],
    ],
    run: cmdImportStandalone,
  },
  {
    id:           'preflight',
    key:          'f',
    label:        'Pre-flight checks',
    category:     'Orchestrator',
    description:  'Pre-flight checks for orchestrator readiness',
    helpVariants: [
      ['preflight --plan <path>', 'Also verify plan file exists'],
    ],
    run:          cmdPreflight,
  },
  {
    id:           'preview-prompts',
    key:          'r',
    label:        'Preview stage prompts',
    category:     'Orchestrator',
    description:  'Render prompts for reviewing',
    helpVariants: [
      ['preview-prompts --stage <name>', 'Preview a single stage only'],
      ['preview-prompts --list',         'List available stage names'],
    ],
    run:          cmdPreviewPrompts,
  },
  {
    id:          'orchestrator',
    key:         null,
    label:       'Run orchestrator',
    category:    'Orchestrator',
    description: 'Run orchestrator pipeline (requires --plan <path>)',
    run:         cmdOrchestrator,
  },
  {
    id:           'read-log',
    key:          null,
    label:        'Read orchestrator log',
    category:     'Orchestrator',
    description:  'Query & filter JSONL run logs',
    helpVariants: [
      ['read-log --summary', 'One-line run overview with token totals'],
    ],
    helpHidden:   true,
    run:          cmdReadLog,
  },
  {
    id:           'extract-dialogue',
    key:          null,
    label:        'Extract chunk dialogue',
    category:     'Orchestrator',
    description:  'Extract prose text from chunk .jsonl files into .md files',
    helpVariants: [
      ['extract-dialogue <chunk-file>',      'Extract a single .jsonl file'],
      ['extract-dialogue <directory>',        'Extract all .jsonl files in a directory'],
      ['extract-dialogue <target> --force',   'Overwrite existing .md files'],
      ['extract-dialogue <target> --dry-run', 'Preview output paths without writing'],
    ],
    helpHidden:   true,
    run:          cmdExtractDialogue,
  },
  {
    id:           'kill-orchestrator',
    key:          'k',
    label:        'Kill stale processes',
    category:     'Orchestrator',
    description:  'Find & terminate stale orchestrator processes',
    helpVariants: [
      ['kill-orchestrator --force', 'Kill without confirmation (agent use)'],
    ],
    helpHidden:   true,
    run:          cmdKillOrchestrator,
  },
  {
    id:           'backfill-duration',
    key:          null,
    label:        'Backfill project duration',
    category:     'MCP Server',
    description:  'One-time backfill of duration_ms in .meta.json for existing projects',
    helpVariants: [
      ['backfill-duration --dry-run', 'Preview changes without writing'],
      ['backfill-duration --verbose', 'Log each project processed'],
    ],
    helpHidden:   true,
    run:          cmdBackfillDuration,
  },
  {
    id:           'doctor',
    key:          'v',
    label:        'Doctor',
    category:     'Validation & Utilities',
    description:  'Full environment health check (all tiers)',
    helpVariants: [
      ['doctor', 'Full environment health check'],
    ],
    run:          cmdDoctor,
  },
  {
    id:          'bundle-docs',
    key:         'd',
    label:       'Bundle docs',
    category:    'Validation & Utilities',
    description: 'Compile doc bundles',
    run:         cmdBundleDocs,
  },
  {
    id:          'ctx-generate',
    key:         null,
    label:       'CTX generate',
    category:    'Validation & Utilities',
    description: 'Generate context documentation (ctx generate)',
    run:         cmdCtxGenerate,
  },
  {
    id:          'generate-overview',
    key:         null,
    label:       'Generate agents overview',
    category:    'Validation & Utilities',
    description: 'Generate docs/references/agents-overview.md from persona YAML metadata',
    run:         cmdGenerateOverview,
  },
  {
    id:          'check-versions',
    key:         null,
    label:       'Check version sync',
    category:    'Validation & Utilities',
    description: 'Verify changelog vs manifest versions',
    run:         cmdCheckVersions,
  },
  {
    id:           'orchestrator-tests',
    key:          't',
    label:        'Integration tests',
    category:     'Validation & Utilities',
    description:  'Run integration & deep-agent tests (optionally live)',
    helpVariants: [
      ['orchestrator-tests',        'Run integration + deepagent tests (prompts for live)'],
      ['orchestrator-tests --live',  'Include live MCP tests (auto-builds, needs API key)'],
    ],
    run:          cmdOrchestratorTests,
  },
  {
    id:           'store',
    key:          null,
    label:        'Store management',
    category:     'MCP Server',
    description:  'Manage multi-store ledger configuration and repositories',
    helpVariants: [
      ['store init [ledger-root]',                    'Create stores.json pointing at ledger root'],
      ['store add <id> <path>',                       'Register a new store directory'],
      ['store remove <id>',                           'Remove a store (directory not deleted)'],
      ['store list',                                  'Show all stores with repo and project counts'],
      ['store default <id>',                          'Set the default store'],
      ['store conflicts',                             'Show cross-store repository registry conflicts'],
      ['store status',                                'Show Git sync status for each store'],
      ['store repo add <repo-name> <store-id>',       'Add a repository to a store registry'],
      ['store repo move <repo-name> <target-store-id>', 'Move a repository between stores'],
      ['store repo list',                             'List all repositories across all stores'],
    ],
    helpHidden:   true,
    run:          cmdStore,
  },
];

// --- ASCII banner ---

const BANNER_LINES = [
  ' ',
  ' █████╗ ██╗   ██╗███╗   ██╗███████╗██╗ ██████╗ ██╗  ██╗████████╗███████╗',
  '██╔══██╗██║   ██║████╗  ██║██╔════╝██║██╔════╝ ██║  ██║╚══██╔══╝██╔════╝',
  '███████║██║   ██║██╔██╗ ██║███████╗██║██║  ███╗███████║   ██║   ███████╗',
  '██╔══██║██║   ██║██║╚██╗██║╚════██║██║██║   ██║██╔══██║   ██║   ╚════██║',
  '██║  ██║██║   ██║██║ ╚████║███████║██║╚██████╔╝██║  ██║   ██║   ███████║',
  '╚═╝  ╚═╝╚═╝   ╚═╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝',
];

// --- Status lines (instant-tier health checks, synchronous) ---
// Renders a single "all clear" line when every check passes; shows only
// the failing items (with fix hints) when one or more checks fail.

const STATUS_LINES = [() => {
  const failures = [];
  for (const check of HEALTH_CHECKS.filter(c => c.cost === 'instant')) {
    const result = check.detect();
    // Guard against Promise (contract violation: instant checks must be synchronous)
    if (result instanceof Promise) {
      failures.push(C.yellow(`\u26a0 ${check.label} (detect returned Promise \u2014 check must be synchronous)`));
    } else if (!result) {
      const fixHint = check.fix ? C.dim(` \u2014 ${check.fix}`) : '';
      failures.push(C.red(`\u2717 ${check.label}`) + fixHint);
    }
  }
  if (failures.length === 0) {
    return C.green('\u2713 All checks passed');
  }
  return failures.join('\n  ');
}];

// --- First-run wizard ---

const skipSetupCheck = process.argv.includes('--skip-setup-check');

/**
 * Scope-selection prompt for the first-run wizard.
 * Presents two options and returns the chosen SETUP_COMPONENT id(s).
 * Called by cli-menu in cooked mode (readline-compatible).
 * @returns {Promise<string[]>}
 */
function handleFirstRun() {
  return Promise.resolve(['global-mcp']);
}

// --- Entry point ---

createMenu({
  name:            'AI Insights CLI',
  banner:          BANNER_LINES,
  version:         () => readChangelogVersion(CHANGELOG_FILE).replace(/^v/, ''),
  commands:        COMMANDS,
  workspaceRoot:   WORKSPACE_ROOT,
  setupComponents: SETUP_COMPONENTS,
  preflightChecks: [
    () => checkNodeVersion(18),
    checkWorkspaceRoot,
  ],
  categoryVersions: {
    'MCP Server':   () => readPackageVersion(MCP_SERVER_DIR).replace(/^v/, ''),
    'Personas':     () => readPackageVersion(PERSONAS_DIR).replace(/^v/, ''),
    'Orchestrator': () => readPyprojectVersion(ORCHESTRATOR_DIR).replace(/^v/, ''),
  },
  usageLine:  'node scripts/cli.js [command] [options]',
  statusLines: STATUS_LINES,
  firstRunRedirect: !skipSetupCheck,
  onFirstRun: handleFirstRun,
}).run(process.argv.slice(2)).then(code => process.exit(code));

```
###  Path: `/scripts/extract-changelog-entry.js`

```js
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

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Locate changelog.md (always relative to workspace root = parent of scripts/)
// ---------------------------------------------------------------------------
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');
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

```
###  Path: `/scripts/extract-dialogue.js`

```js
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

```
###  Path: `/scripts/generate-agents-overview.js`

```js
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

```
###  Path: `/scripts/import-standalone.js`

```js
#!/usr/bin/env node

/**
 * import-standalone.js
 *
 * Import standalone plan folder(s) into the project ledger.
 *
 * Calls the compiled `mcp-server/dist/tools/standalone-import.js` handler
 * directly — no MCP protocol overhead, no schema duplication.
 * Includes a dist-freshness check that rebuilds mcp-server when stale,
 * following the same pattern as scripts/run-orchestrator.js.
 *
 * Usage:
 *   node scripts/import-standalone.js --path <plan-folder>
 *   node scripts/import-standalone.js --batch [--base-dir <dir>] [--dry-run]
 *
 * Flags:
 *   --path <dir>      Import a single plan folder.
 *   --batch           Scan docs/agents/ (or --base-dir) for untracked plans.
 *   --base-dir <dir>  Override the default batch scan root (default: docs/agents/).
 *   --dry-run         Preview what would be imported; write nothing.
 *   --verbose         Log full error stacks on I/O failures in collectKnownSlugs().
 */

import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { listAllProjectDirs } from './lib/ledger-dirs.js';

// ---------------------------------------------------------------------------
// 1. Resolve paths
// ---------------------------------------------------------------------------
const WORKSPACE_ROOT    = path.resolve(import.meta.dirname, '..');
const MCP_SRC           = path.join(WORKSPACE_ROOT, 'mcp-server', 'src');
const MCP_DIST_SENTINEL = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist', 'index.js');
const MCP_DIST_TOOL     = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist', 'tools', 'standalone-import.js');
const LEDGER_ROOT       = path.join(WORKSPACE_ROOT, 'mcp-server', 'storage', 'ledger');
const DEFAULT_SCAN_ROOT = path.join(WORKSPACE_ROOT, 'docs', 'agents');

/** Matches plan folder names: YYYY-MM-DD-{name} */
const PLAN_SLUG_RE = /^\d{4}-\d{2}-\d{2}-.+$/;

// ---------------------------------------------------------------------------
// 2. Dist-freshness check (same pattern as run-orchestrator.js)
// ---------------------------------------------------------------------------

/**
 * Recursively returns the largest mtime (ms) of any file under `dir`.
 * @param {string} dir
 * @returns {number}
 */
function latestMtime(dir) {
  let latest = -Infinity;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestMtime(full));
    } else if (entry.isFile()) {
      latest = Math.max(latest, fs.statSync(full).mtimeMs);
    }
  }
  return latest;
}

function ensureDistFresh() {
  let needBuild = false;

  if (!fs.existsSync(MCP_DIST_SENTINEL)) {
    needBuild = true;
  } else {
    const sentinelMtime = fs.statSync(MCP_DIST_SENTINEL).mtimeMs;
    if (latestMtime(MCP_SRC) > sentinelMtime) {
      needBuild = true;
    }
  }

  if (needBuild) {
    console.log('[import-standalone.js] mcp-server/dist is stale or missing — building MCP server...');
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';
    const build = spawnSync(npmCmd, ['run', 'build'], {
      cwd: path.join(WORKSPACE_ROOT, 'mcp-server'),
      stdio: 'inherit',
      shell: isWindows,
    });
    if (build.status !== 0) {
      console.error('[import-standalone.js] MCP server build failed.');
      process.exit(build.status ?? 1);
    }
  }

  if (!fs.existsSync(MCP_DIST_TOOL)) {
    console.error(`Error: compiled tool not found at ${MCP_DIST_TOOL}`);
    console.error('Try running: cd mcp-server && npm run build');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 3. Ledger cross-reference — collect all known slugs
// ---------------------------------------------------------------------------

/**
 * Scans the ledger storage root and returns a Set of all known project slugs.
 * Directory discovery (legacy flat layout vs. namespaced
 * `{repoName}/{slug}/` layout) is delegated to the canonical
 * `LedgerStore.listAllProjectDirs()` via `scripts/lib/ledger-dirs.js` —
 * never re-implemented here.
 *
 * @returns {Promise<Set<string>>}
 */
async function collectKnownSlugs(verbose = false) {
  const slugs = new Set();

  let projectDirs;
  try {
    projectDirs = await listAllProjectDirs(LEDGER_ROOT);
  } catch (err) {
    console.warn(`  ⚠ Could not scan ${LEDGER_ROOT}: ${err.message}`);
    if (verbose) {
      console.warn(err.stack);
    }
    return slugs;
  }

  for (const dir of projectDirs) {
    const slug = path.basename(dir);
    if (PLAN_SLUG_RE.test(slug)) {
      slugs.add(slug);
    }
  }

  return slugs;
}

// ---------------------------------------------------------------------------
// 4. Plan folder scanning
// ---------------------------------------------------------------------------

/**
 * Returns true if `folderPath` is a valid importable plan folder:
 * - basename matches YYYY-MM-DD-{name}
 * - contains plan.md
 * - contains synthesis.md
 *
 * @param {string} folderPath
 * @returns {boolean}
 */
function isPlanFolder(folderPath) {
  const name = path.basename(folderPath);
  return (
    PLAN_SLUG_RE.test(name) &&
    fs.existsSync(path.join(folderPath, 'plan.md')) &&
    fs.existsSync(path.join(folderPath, 'synthesis.md'))
  );
}

/**
 * Recursively scans `scanRoot` and returns all plan folder paths that satisfy
 * `isPlanFolder`. Does not recurse into matched plan folders.
 *
 * @param {string} scanRoot
 * @returns {string[]}
 */
function scanPlanFolders(scanRoot) {
  const results = [];
  if (!fs.existsSync(scanRoot)) return results;

  function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (PLAN_SLUG_RE.test(entry.name)) {
        if (isPlanFolder(full)) {
          results.push(full);
        }
        // Don't recurse into plan folders — they don't nest.
      } else {
        walkDir(full);
      }
    }
  }

  walkDir(scanRoot);
  return results;
}

// ---------------------------------------------------------------------------
// 5. Confirmation helper
// ---------------------------------------------------------------------------

/**
 * Prompts the user for a yes/no answer and resolves to `true` when they
 * confirm (answer starts with 'y').
 *
 * @param {string} prompt
 * @returns {Promise<boolean>}
 */
function askConfirm(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ---------------------------------------------------------------------------
// 6. Single-plan import
// ---------------------------------------------------------------------------

/**
 * @param {Function} importFn
 * @param {string} planPath  Absolute path to the plan folder.
 * @param {boolean} dryRun
 * @returns {Promise<void>}
 */
async function importSinglePlan(importFn, planPath, dryRun) {
  const slug = path.basename(planPath);
  console.log(`Importing: ${slug}`);
  console.log(`  Path: ${planPath}`);

  if (dryRun) {
    console.log('  [dry-run] No files written.');
    return;
  }

  const result = await importFn({ project_path: planPath });

  if (result.isError) {
    const msg = result.content[0]?.text ?? 'Unknown error';
    console.error(`  ✗ ${msg}`);
    process.exit(1);
  }

  const data = JSON.parse(result.content[0].text);
  console.log(`  ✓ Imported successfully`);
  console.log(`    Slug:    ${data.slug}`);
  if (data.outcome_summary) {
    console.log(`    Summary: ${data.outcome_summary}`);
  }
  console.log(`    Storage: ${data.project_storage_path}`);
  if (data.archived_files && data.archived_files.length > 0) {
    console.log(`    Archived: ${data.archived_files.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// 7. Batch import
// ---------------------------------------------------------------------------

/**
 * @param {Function} importFn
 * @param {string} scanRoot   Root directory to scan for plan folders.
 * @param {boolean} dryRun
 * @returns {Promise<void>}
 */
async function runBatch(importFn, scanRoot, dryRun, verbose = false) {
  console.log(`\nScanning: ${scanRoot}\n`);

  const candidates = scanPlanFolders(scanRoot);

  if (candidates.length === 0) {
    console.log('No plan folders found (requires plan.md and synthesis.md).');
    return;
  }

  const knownSlugs = await collectKnownSlugs(verbose);
  const toImport       = candidates.filter(p => !knownSlugs.has(path.basename(p)));
  const alreadyTracked = candidates.filter(p =>  knownSlugs.has(path.basename(p)));

  if (alreadyTracked.length > 0) {
    console.log(`Already imported (${alreadyTracked.length}):`);
    for (const p of alreadyTracked) {
      console.log(`  ✓ ${path.basename(p)}`);
    }
    console.log('');
  }

  if (toImport.length === 0) {
    console.log('All plans are already imported — nothing to do.');
    return;
  }

  console.log(`Plans to import (${toImport.length}):`);
  for (const p of toImport) {
    console.log(`  • ${path.basename(p)}`);
  }

  if (dryRun) {
    console.log('\n[dry-run] No files written.');
    return;
  }

  const confirmed = await askConfirm(`\nImport ${toImport.length} plan(s)? [y/N] `);
  if (!confirmed) {
    console.log('Aborted.');
    return;
  }

  console.log('\nImporting:');
  let imported = 0;
  let skipped  = 0;
  let failed   = 0;

  for (const planPath of toImport) {
    const slug = path.basename(planPath);
    process.stdout.write(`  → ${slug} ... `);

    const result = await importFn({ project_path: planPath });

    if (result.isError) {
      const msg = result.content[0]?.text ?? 'Unknown error';
      if (msg.includes('already exists')) {
        console.log('already imported (skipped)');
        skipped++;
      } else {
        console.log(`FAILED — ${msg}`);
        failed++;
      }
    } else {
      const data = JSON.parse(result.content[0].text);
      console.log(`imported → ${data.project_storage_path}`);
      imported++;
    }
  }

  console.log(`\nDone: ${imported} imported, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// 8. Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  const pathIdx  = args.indexOf('--path');
  const planPath = pathIdx !== -1 ? args[pathIdx + 1] : null;

  const isBatch  = args.includes('--batch');
  const isDryRun = args.includes('--dry-run');
  const isVerbose = args.includes('--verbose');

  const baseDirIdx = args.indexOf('--base-dir');
  const baseDir    = baseDirIdx !== -1
    ? path.resolve(args[baseDirIdx + 1])
    : DEFAULT_SCAN_ROOT;

  if (!planPath && !isBatch) {
    console.error('Error: specify --path <plan-folder> or --batch');
    console.error('');
    console.error('Usage:');
    console.error('  node scripts/import-standalone.js --path <plan-folder>');
    console.error('  node scripts/import-standalone.js --batch [--base-dir <dir>] [--dry-run]');
    process.exit(1);
  }

  // Dist-freshness check — rebuild mcp-server if needed.
  ensureDistFresh();

  // Load the compiled tool handler.
  const toolModule = await import(pathToFileURL(MCP_DIST_TOOL).href);
  const { importStandalone } = toolModule._internal;

  if (planPath) {
    await importSinglePlan(importStandalone, path.resolve(planPath), isDryRun);
  } else {
    await runBatch(importStandalone, baseDir, isDryRun, isVerbose);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});

```
###  Path: `/scripts/install-hooks.js`

```js
#!/usr/bin/env node

/**
 * scripts/install-hooks.js
 *
 * Activates the workspace Git hooks by pointing core.hooksPath at .githooks/.
 * Run this once after cloning the repository to enable the pre-commit
 * persona freshness check.
 *
 * Usage (from workspace root):
 *   node scripts/install-hooks.js
 */

import { execSync } from 'child_process';

execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
console.log('Git hooks installed. Pre-commit persona guard active.');

```
###  Path: `/scripts/install-mcp-global.js`

```js
/**
 * scripts/install-mcp-global.js
 *
 * Stable-shim strategy for user-level MCP server registration.
 * Writes a launcher shim at ~/.ai-insights/bin/launch-server.js that
 * reads a config.json to find the repo, then spawns the MCP server with
 * { stdio: 'inherit' } so STDIO JSON-RPC messages are never buffered.
 *
 * Exported API (see each function for details):
 *   getShimDir(shimBaseDir?)    — path to ~/.ai-insights/bin/
 *   shimConfigExists(opts?)     — true if config.json is present
 *   writeShim(opts?)            — write shim file; throws if dist missing
 *   writeConfig(repoPath, opts?)— write config.json
 *   installVSCode(opts?)        — merge central_pm into VS Code user mcp.json
 *   installClaudeCode(opts?)    — register via claude CLI (optional)
 *   uninstall(opts?)            — remove all registrations
 *   dryRun(opts?)               — print diff without writing
 *   install(opts?)              — run full install flow
 */

import fs   from 'fs';
import os   from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT    = path.resolve(import.meta.dirname, '..');
const MCP_DIST_SENTINEL = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist', 'index.js');
const IS_WIN            = process.platform === 'win32';

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Platform-specific path to the VS Code user-level mcp.json.
 * @returns {string}
 */
function _getVSCodeMcpPath() {
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || os.homedir(),
      'Code', 'User', 'mcp.json'
    );
  }
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library', 'Application Support', 'Code', 'User', 'mcp.json'
    );
  }
  return path.join(os.homedir(), '.config', 'Code', 'User', 'mcp.json');
}

/**
 * Resolve all internal paths, allowing tests to inject temp-dir overrides.
 * @param {{ shimBaseDir?: string, mcpPath?: string }} [overrides]
 */
function _resolvePaths(overrides = {}) {
  const base = overrides.shimBaseDir ?? path.join(os.homedir(), '.ai-insights');
  return {
    shimBaseDir: base,
    shimPath:    path.join(base, 'bin', 'launch-server.js'),
    configPath:  path.join(base, 'config.json'),
    mcpPath:     overrides.mcpPath ?? _getVSCodeMcpPath(),
  };
}

// ─── Shim content ─────────────────────────────────────────────────────────────

/**
 * Build the content of the launch-server.js shim.
 * Uses CommonJS so it runs without a package.json "type" field.
 * The shim:
 *   1. Reads config.json from the sibling directory.
 *   2. Validates that the configured repoPath exists.
 *   3. Spawns mcp-server/dist/index.js via spawn({ stdio: 'inherit' }).
 * @returns {string}
 */
function _buildShimContent() {
  return [
    '#!/usr/bin/env node',
    "// launch-server.js — stable launcher shim for ai-insights MCP server",
    "// Generated by: node scripts/cli.js install-mcp",
    "'use strict';",
    "const { readFileSync, existsSync } = require('fs');",
    "const { join, resolve, sep } = require('path');",
    "const { spawn } = require('child_process');",
    '',
    "const configPath = join(__dirname, '..', 'config.json');",
    'let config;',
    'try {',
    "  config = JSON.parse(readFileSync(configPath, 'utf8'));",
    '} catch (err) {',
    "  process.stderr.write('[ai-insights] Could not read shim config: ' + configPath + '\\n');",
    '  process.exit(1);',
    '}',
    '',
    'var repoPath = config.repoPath;',
    'if (!repoPath || !existsSync(repoPath)) {',
    '  process.stderr.write(',
    "    '[ai-insights] Configured repo path no longer exists: ' + (repoPath || '(unset)') +",
    "    '\\nRe-run \\'node scripts/cli.js install-mcp\\' to update.\\n'",
    '  );',
    '  process.exit(1);',
    '}',
    '',
    "var distPath = join(repoPath, 'mcp-server', 'dist', 'index.js');",
    'if (!resolve(distPath).startsWith(resolve(repoPath) + sep)) {',
    "  process.stderr.write('[ai-insights] Security: distPath escapes repoPath — aborting.\\n');",
    '  process.exit(1);',
    '}',
    '',
    'var proc = spawn(process.execPath, [distPath].concat(process.argv.slice(2)), { stdio: \u0027inherit\u0027 });',
    'proc.on(\u0027close\u0027, function(code) { process.exit(code !== null ? code : 0); });',
    'proc.on(\u0027error\u0027, function(err) {',
    "  process.stderr.write('[ai-insights] Failed to start MCP server: ' + err.message + '\\n');",
    '  process.exit(1);',
    '});',
  ].join('\n') + '\n';
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Check Claude Code CLI availability and central_pm registration status.
 * Runs `claude mcp list` and looks for `central_pm` in the output.
 * @returns {{ available: boolean, registered: boolean }}
 */
function _checkClaudeCodeStatus() {
  const whichCmd = IS_WIN ? 'where' : 'which';
  const check    = spawnSync(whichCmd, ['claude'], { encoding: 'utf8', shell: false });
  if (check.status !== 0) {
    return { available: false, registered: false };
  }
  const result = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf8', shell: false });
  return {
    available:  true,
    registered: result.status === 0 && (result.stdout ?? '').includes('central_pm'),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Path to the shim directory (parent of launch-server.js).
 * @param {string} [shimBaseDir] — override base (for tests)
 * @returns {string}
 */
export function getShimDir(shimBaseDir) {
  return path.join(_resolvePaths({ shimBaseDir }).shimBaseDir, 'bin');
}

/**
 * True when ~/.ai-insights/config.json exists (shim is registered).
 * @param {{ shimBaseDir?: string }} [opts]
 * @returns {boolean}
 */
export function shimConfigExists(opts = {}) {
  return fs.existsSync(_resolvePaths(opts).configPath);
}

/**
 * Write the shim file to ~/.ai-insights/bin/launch-server.js.
 * Throws with .code = 'DIST_MISSING' if mcp-server/dist/index.js is absent.
 * @param {{ shimBaseDir?: string }} [opts]
 * @returns {string} absolute path to the written shim
 */
export function writeShim(opts = {}) {
  if (!fs.existsSync(MCP_DIST_SENTINEL)) {
    const err = new Error(
      'MCP server is not built. Run the menu and rebuild the MCP server first.\n' +
      '  → cd mcp-server && npm run build'
    );
    err.code = 'DIST_MISSING';
    throw err;
  }
  const { shimPath } = _resolvePaths(opts);
  fs.mkdirSync(path.dirname(shimPath), { recursive: true });
  fs.writeFileSync(shimPath, _buildShimContent(), 'utf8');
  try { fs.chmodSync(shimPath, 0o755); } catch { /* ignored on Windows */ }
  return shimPath;
}

/**
 * Write ~/.ai-insights/config.json with { repoPath }.
 * @param {string} repoPath
 * @param {{ shimBaseDir?: string }} [opts]
 * @returns {string} absolute path to the written config file
 */
export function writeConfig(repoPath, opts = {}) {
  const { configPath, shimBaseDir } = _resolvePaths(opts);
  fs.mkdirSync(shimBaseDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ repoPath }, null, 2) + '\n', 'utf8');
  return configPath;
}

/**
 * Merge the central_pm entry into the VS Code user-level mcp.json.
 * Only the central_pm key is touched; all other keys are preserved in order.
 * A timestamped backup is created before any write.
 *
 * @param {{ dryRun?: boolean, mcpPath?: string, shimBaseDir?: string }} [opts]
 * @returns {{ changed: boolean, path: string, diff?: string }}
 */
export function installVSCode(opts = {}) {
  const { mcpPath, shimPath } = _resolvePaths(opts);
  const dryRun = Boolean(opts.dryRun);

  // Read existing config or default to empty
  let existing = {};
  if (fs.existsSync(mcpPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    } catch {
      existing = {};
    }
  }

  const servers   = existing.servers || {};
  const newEntry  = { type: 'stdio', command: 'node', args: [shimPath] };
  const current   = servers.central_pm;

  // Idempotency check
  if (
    current?.command === newEntry.command &&
    JSON.stringify(current?.args) === JSON.stringify(newEntry.args)
  ) {
    return { changed: false, path: mcpPath };
  }

  const updated = {
    ...existing,
    servers: { ...servers, central_pm: newEntry },
  };

  if (dryRun) {
    return { changed: true, path: mcpPath, diff: JSON.stringify(updated, null, 2) + '\n' };
  }

  // Backup before write
  if (fs.existsSync(mcpPath)) {
    const ts     = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = mcpPath + '.' + ts + '.bak';
    fs.copyFileSync(mcpPath, backup);
  }

  fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
  fs.writeFileSync(mcpPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  return { changed: true, path: mcpPath };
}

/**
 * Register central_pm via the claude CLI (optional — skipped if claude not found).
 * @param {{ dryRun?: boolean, shimBaseDir?: string }} [opts]
 * @returns {{ skipped?: boolean, alreadyRegistered?: boolean, reason?: string, command?: string, status?: number }}
 */
export function installClaudeCode(opts = {}) {
  const { shimPath } = _resolvePaths(opts);
  const dryRun = Boolean(opts.dryRun);

  if (dryRun) {
    return {
      command: `claude mcp add --scope user --transport stdio central_pm -- node ${shimPath}`,
    };
  }

  const ccStatus = _checkClaudeCodeStatus();
  if (!ccStatus.available) {
    return { skipped: true, reason: 'claude CLI not found' };
  }
  if (ccStatus.registered) {
    return { alreadyRegistered: true };
  }

  const result = spawnSync(
    'claude',
    ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'central_pm', '--', 'node', shimPath],
    { encoding: 'utf8', shell: false }
  );
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Remove all global MCP registrations (VS Code, Claude Code, shim files).
 * @param {{ shimBaseDir?: string, mcpPath?: string }} [opts]
 */
export function uninstall(opts = {}) {
  const { mcpPath, shimPath, configPath } = _resolvePaths(opts);

  // Remove from VS Code mcp.json
  if (fs.existsSync(mcpPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      if (existing.servers?.central_pm) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(mcpPath, mcpPath + '.' + ts + '.bak');
        delete existing.servers.central_pm;
        fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
      }
    } catch {
      // Best-effort; ignore errors during uninstall
    }
  }

  // Remove from Claude Code (if CLI available)
  const whichCmd = IS_WIN ? 'where' : 'which';
  const check    = spawnSync(whichCmd, ['claude'], { encoding: 'utf8', shell: false });
  if (check.status === 0) {
    spawnSync('claude', ['mcp', 'remove', 'central_pm', '--scope', 'user'], {
      encoding: 'utf8', shell: false,
    });
  }

  // Remove shim and config files
  if (fs.existsSync(shimPath))   fs.rmSync(shimPath,   { force: true });
  if (fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
}

/**
 * Print what would be written to stdout without touching any files.
 * @param {{ shimBaseDir?: string, mcpPath?: string, log?: (msg: string) => void, error?: (msg: string) => void }} [opts]
 */
export function dryRun(opts = {}) {
  const logFn = opts.log   ?? console.log;
  const errFn = opts.error ?? console.error;
  const { shimPath, configPath, mcpPath } = _resolvePaths(opts);

  if (!fs.existsSync(MCP_DIST_SENTINEL)) {
    errFn('  \u2717 MCP server is not built. Run: cd mcp-server && npm run build');
    return;
  }

  logFn('\n  Dry run \u2014 no files will be written.\n');

  // config.json
  logFn(`  [\u2139\ufe0f  ${configPath}]`);
  logFn(JSON.stringify({ repoPath: WORKSPACE_ROOT }, null, 2));
  logFn('');

  // VS Code mcp.json
  const vsResult = installVSCode({ ...opts, dryRun: true });
  if (vsResult.changed) {
    logFn(`  [\u2139\ufe0f  ${mcpPath}]`);
    logFn(vsResult.diff);
  } else {
    logFn(`  [\u2713 ${mcpPath}] already configured \u2014 no change`);
    logFn('');
  }

  // Claude Code
  const ccResult = installClaudeCode({ ...opts, dryRun: true });
  logFn(`  [\u2139\ufe0f  Claude Code]`);
  logFn(`  ${ccResult.command}`);
  logFn('');
}

/**
 * Run the full install flow.
 * Idempotent: re-running when already installed is a no-op.
 *
 * @param {{ shimBaseDir?: string, mcpPath?: string, log?: (msg: string) => void }} [opts]
 */
export function install(opts = {}) {
  const logFn = opts.log ?? console.log;
  const { shimPath, configPath } = _resolvePaths(opts);

  // Pre-flight: dist must exist
  if (!fs.existsSync(MCP_DIST_SENTINEL)) {
    throw new Error(
      'MCP server is not built. Run the menu and rebuild the MCP server first.\n' +
      '  \u2192 cd mcp-server && npm run build'
    );
  }

  // Idempotency check: config, shim, VS Code entry, and Claude Code are all already correct
  if (fs.existsSync(configPath) && fs.existsSync(shimPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (existing.repoPath === WORKSPACE_ROOT) {
        const vsResult  = installVSCode({ ...opts, dryRun: true });
        const ccStatus  = _checkClaudeCodeStatus();
        const ccSettled = !ccStatus.available || ccStatus.registered;
        if (!vsResult.changed && ccSettled) {
          logFn('  \u2713 Global MCP already registered (no change)');
          return;
        }
      }
    } catch {
      // Config unreadable — proceed with write
    }
  }

  // Write shim and config
  writeShim(opts);
  writeConfig(WORKSPACE_ROOT, opts);
  logFn(`  \u2713 Shim written \u2192 ${shimPath}`);
  logFn(`  \u2713 Config written \u2192 ${configPath}`);

  // VS Code
  const vsResult = installVSCode(opts);
  if (vsResult.changed) {
    logFn(`  \u2713 VS Code user mcp.json updated \u2192 ${vsResult.path}`);
  } else {
    logFn(`  \u2713 VS Code user mcp.json already configured`);
  }

  // Claude Code (optional)
  const ccResult = installClaudeCode(opts);
  if (ccResult.skipped) {
    logFn(`  \u26a0 Claude Code registration skipped: ${ccResult.reason}`);
  } else if (ccResult.alreadyRegistered) {
    logFn(`  \u2713 Claude Code already registered`);
  } else if (ccResult.status === 0) {
    logFn(`  \u2713 Claude Code registered`);
  } else if (ccResult.command) {
    // dry run branch — should not happen here
  } else {
    logFn(`  \u26a0 Claude Code registration may have failed (exit ${ccResult.status})`);
  }
}

```
###  Path: `/scripts/kill-orchestrator.js`

```js
#!/usr/bin/env node

/**
 * scripts/kill-orchestrator.js
 *
 * Detect and terminate stale orchestrator processes. Cleans up stale
 * .orchestrator.lock files after killing.
 *
 * Usage:
 *   node scripts/kill-orchestrator.js            Interactive — prompts before killing
 *   node scripts/kill-orchestrator.js --force      Kill without prompting (agent use)
 *   node scripts/kill-orchestrator.js --json       List processes as JSON; no kill
 *   node scripts/kill-orchestrator.js --depth N    Scan last N log files for lock cleanup (default: 20)
 *   node scripts/kill-orchestrator.js --help       Show this help
 *
 * Exit codes:
 *   0 — No processes found, or processes successfully killed
 *   1 — Processes found but user declined to kill (interactive mode)
 *
 * No external dependencies — stdlib only (fs, path, child_process, readline).
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawnSync } from 'child_process';

// ─── Paths ────────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');
const LOGS_DIR       = path.join(WORKSPACE_ROOT, 'orchestrator', 'logs');

// ─── Platform ─────────────────────────────────────────────────────────────────

const IS_WIN = process.platform === 'win32';

// ─── Tunable constants ────────────────────────────────────────────────────────

const SIGTERM_GRACE_MS  = 3000; // ms to wait before escalating to SIGKILL
const DEFAULT_LOG_DEPTH = 20;   // number of recent log files to scan for lock cleanup

// ─── ANSI colors ──────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY;

const C = {
  dim:    (s) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   (s) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  red:    (s) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  green:  (s) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:   (s) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
Usage: node scripts/kill-orchestrator.js [options]

Detect and terminate stale orchestrator processes.
Also cleans up stale .orchestrator.lock files from recently-used plan directories.

Flags:
  (default)     List found processes and prompt for confirmation before killing
  --force       Kill all found processes without prompting (for agent/CI use)
  --json        Output process list as JSON array; does NOT kill anything
  --depth N     Scan last N log files for lock-file cleanup (default: 20); must be a positive integer
  --help, -h    Show this help

Exit codes:
  0   No processes found, or processes successfully killed
  1   Processes found but user declined (interactive mode)

Examples:
  node scripts/kill-orchestrator.js
  node scripts/kill-orchestrator.js --force
  node scripts/kill-orchestrator.js --json
  node scripts/kill-orchestrator.js --depth 5
`;

// ─── Argument parser ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const depthIdx = argv.indexOf('--depth');
  let depth = DEFAULT_LOG_DEPTH;
  if (depthIdx !== -1) {
    const raw = argv[depthIdx + 1];
    const parsed = parseInt(raw, 10);
    if (raw === undefined || isNaN(parsed) || parsed <= 0) {
      const got = raw === undefined ? 'nothing' : JSON.stringify(raw);
      console.error(`Error: --depth requires a positive integer (got ${got})`);
      process.exit(1);
    }
    depth = parsed;
  }
  return {
    force: argv.includes('--force'),
    json:  argv.includes('--json'),
    help:  argv.includes('--help') || argv.includes('-h'),
    depth,
  };
}

// ─── Process detection ────────────────────────────────────────────────────────

/**
 * Get elapsed time for a PID using `ps -o etime= <pid>`.
 *
 * @param {number} pid
 * @returns {string}  e.g. "01:23" or "2-04:05" — empty string on failure
 */
function getElapsed(pid) {
  const r = spawnSync('ps', ['-o', 'etime=', String(pid)], { encoding: 'utf8', shell: false });
  return r.status === 0 ? r.stdout.trim() : '';
}

/**
 * Detect running orchestrator processes using pgrep.
 * Filters out: this script, pgrep itself, preflight-orchestrator.
 *
 * Returns an array of { pid, cmdline, elapsed } objects.
 * Returns null when pgrep is not available (unexpected on macOS/Linux).
 *
 * @returns {Array<{pid: number, cmdline: string, elapsed: string}>|null}
 */
function detectProcesses() {
  const r = spawnSync('pgrep', ['-fl', 'orchestrate'], { encoding: 'utf8', shell: false });

  // pgrep exits 1 when no matches — that is fine (not an error)
  if (r.error) return null; // pgrep not available

  if (!r.stdout || !r.stdout.trim()) return [];

  const SELF_SCRIPT = path.basename(import.meta.filename);
  const procs = [];

  for (const line of r.stdout.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Filter out this script, pgrep, and preflight-orchestrator
    if (trimmed.includes('kill-orchestrator'))   continue;
    if (trimmed.includes('preflight-orchestrator')) continue;
    if (trimmed.includes('pgrep'))               continue;

    // pgrep -fl output: "<pid> <cmdline>"
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) continue;

    const pid     = parseInt(trimmed.slice(0, spaceIdx), 10);
    const cmdline = trimmed.slice(spaceIdx + 1).trim();
    if (isNaN(pid)) continue;

    const elapsed = getElapsed(pid);
    procs.push({ pid, cmdline: cmdline.slice(0, 120), elapsed });
  }

  return procs;
}

// ─── Process display ──────────────────────────────────────────────────────────

function printProcess(proc) {
  const elapsed = proc.elapsed ? C.dim(` (running ${proc.elapsed})`) : '';
  console.log(`  ${C.yellow('PID ' + proc.pid)}${elapsed}`);
  console.log(`  ${C.dim(proc.cmdline)}`);
}

// ─── Kill logic ───────────────────────────────────────────────────────────────

/**
 * Check if a process is still alive (ESRCH = not found).
 *
 * @param {number} pid
 * @returns {boolean}
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
}

/**
 * Kill a single process: SIGTERM first, then SIGKILL after 3s if still alive.
 *
 * @param {number} pid
 * @returns {Promise<void>}
 */
async function killProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    if (e.code === 'ESRCH') return; // already gone
    throw e;
  }

  // Wait for graceful exit before escalating to SIGKILL
  await new Promise((resolve) => setTimeout(resolve, SIGTERM_GRACE_MS));

  if (isAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
  }
}

// ─── Lock file cleanup ────────────────────────────────────────────────────────

/**
 * Scan recent JSONL log files for plan paths (via run_start entries).
 * Returns a set of unique plan directory paths.
 *
 * @param {number} depth  Number of recent log files to scan (default: DEFAULT_LOG_DEPTH)
 * @returns {Set<string>}
 */
function findRecentPlanDirs(depth) {
  const planDirs = new Set();
  if (!fs.existsSync(LOGS_DIR)) return planDirs;

  const logFiles = fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .slice(-depth); // check last N log files

  for (const file of logFiles) {
    const filePath = path.join(LOGS_DIR, file);
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch { continue; }

    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const entry = JSON.parse(t);
        if (entry.action === 'run_start' && entry.plan) {
          // plan is the plan FILE path; lock is in the plan's parent directory
          const planFile = entry.plan;
          const planDir  = fs.statSync(planFile).isFile()
            ? path.dirname(planFile)
            : planFile;
          // Defence-in-depth: only clean up locks within the workspace root.
          // Prevents a malicious log entry from targeting arbitrary filesystem paths.
          if (!path.resolve(planDir).startsWith(WORKSPACE_ROOT)) continue;
          planDirs.add(planDir);
        }
      } catch { /* malformed / file not found — skip */ }
    }
  }

  return planDirs;
}

/**
 * Remove stale .orchestrator.lock files from recently-used plan directories.
 *
 * @param {number} depth  Passed through to findRecentPlanDirs
 * @returns {string[]}  Paths of lock files removed
 */
function cleanupStaleLocks(depth) {
  const removed = [];
  let planDirs;
  try { planDirs = findRecentPlanDirs(depth); } catch { return removed; }

  for (const dir of planDirs) {
    const lockPath = path.join(dir, '.orchestrator.lock');
    if (fs.existsSync(lockPath)) {
      try {
        fs.rmSync(lockPath);
        removed.push(lockPath);
      } catch { /* ignore permission errors */ }
    }
  }

  return removed;
}

// ─── Interactive prompt ───────────────────────────────────────────────────────

/**
 * Prompt the user for a y/N answer.
 *
 * @param {string} question
 * @returns {Promise<boolean>}
 */
function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ─── Windows advisory ─────────────────────────────────────────────────────────

function printWindowsAdvisory() {
  console.log('\nAutomatic process detection is not supported on Windows.');
  console.log('To find and stop stale orchestrator processes manually:');
  console.log('  1. Open Task Manager (Ctrl+Shift+Esc) → Details tab');
  console.log('  2. Look for python.exe processes running "orchestrate"');
  console.log('  3. Right-click → End Task');
  console.log('');
  console.log('Alternatively, use PowerShell:');
  console.log('  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*orchestrate*" }');
  console.log('  Stop-Process -Id <PID>');
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  // ── Windows: advisory only ───────────────────────────────────────────────
  if (IS_WIN) {
    printWindowsAdvisory();
    process.exit(0);
  }

  // ── Detect processes ─────────────────────────────────────────────────────
  const procs = detectProcesses();

  if (procs === null) {
    console.error('pgrep not found — cannot detect orchestrator processes.');
    process.exit(1);
  }

  // ── JSON mode — just list, no kill ────────────────────────────────────────
  if (opts.json) {
    console.log(JSON.stringify(procs, null, 2));
    process.exit(0);
  }

  // ── No processes found ────────────────────────────────────────────────────
  if (procs.length === 0) {
    console.log('No orchestrator processes found.');
    process.exit(0);
  }

  // ── List found processes ──────────────────────────────────────────────────
  console.log(`\nFound ${C.bold(String(procs.length))} orchestrator process${procs.length === 1 ? '' : 'es'}:\n`);
  for (const proc of procs) {
    printProcess(proc);
    console.log('');
  }

  // ── Interactive confirmation ──────────────────────────────────────────────
  if (!opts.force) {
    const confirmed = await askYesNo(
      `Kill ${procs.length === 1 ? 'this process' : `all ${procs.length} processes`}? [y/N] `,
    );
    if (!confirmed) {
      console.log(C.dim('Cancelled — no processes killed.'));
      process.exit(1);
    }
  }

  // ── Kill ──────────────────────────────────────────────────────────────────
  console.log('');
  for (const proc of procs) {
    process.stdout.write(`Sending SIGTERM to PID ${proc.pid}…`);
    try {
      await killProcess(proc.pid);
      if (!isAlive(proc.pid)) {
        process.stdout.write(C.green(' killed\n'));
      } else {
        process.stdout.write(C.yellow(' process may still be running\n'));
      }
    } catch (e) {
      process.stdout.write(C.red(` error: ${e.message}\n`));
    }
  }

  // ── Lock file cleanup ─────────────────────────────────────────────────────
  const removed = cleanupStaleLocks(opts.depth);
  if (removed.length > 0) {
    console.log('');
    for (const p of removed) {
      const rel = path.relative(WORKSPACE_ROOT, p);
      console.log(C.dim(`Removed lock: ${rel.startsWith('..') ? p : rel}`));
    }
  }

  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});

```
###  Path: `/scripts/lib/health-checks.js`

```js
/**
 * scripts/lib/health-checks.js
 *
 * Unified health-check registry for the ai-insights workspace.
 * Single source of detection logic shared by status lines, the doctor command,
 * and preflight flows.
 *
 * Cost tier boundaries:
 *   instant  — file-existence stats, process.versions checks (< 5 ms)
 *   fast     — mtime comparisons, JSON config parsing (< 50 ms)
 *   slow     — subprocess spawns, network reachability (100 ms – 2 s)
 *
 * Exports:
 *   HEALTH_CHECKS  — Array<HealthCheck> (see registry below for the full list).
 *   runChecks(costFilter) — Filter by tier and resolve all detectors.
 *
 * Dependency direction: this file MUST NOT import from scripts/cli.js,
 * SETUP_COMPONENTS, or any other file in scripts/ outside of scripts/lib/.
 */

import fs   from 'fs';
import os   from 'os';
import path from 'path';
import { spawn } from 'child_process';

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT    = path.resolve(import.meta.dirname, '../..');
const MCP_DIST_DIR      = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist');
const MCP_DIST_SENTINEL = path.join(MCP_DIST_DIR, 'index.js');
const MCP_SRC_DIR       = path.join(WORKSPACE_ROOT, 'mcp-server', 'src');
const ORCHESTRATOR_DIR  = path.join(WORKSPACE_ROOT, 'orchestrator');
const VENV_DIR          = path.join(ORCHESTRATOR_DIR, '.venv');
const PERSONAS_DIR      = path.join(WORKSPACE_ROOT, 'personas');
const MCP_SERVER_DIR    = path.join(WORKSPACE_ROOT, 'mcp-server');
const OVERVIEW_FILE     = path.join(WORKSPACE_ROOT, 'docs', 'references', 'agents-overview.md');
const PERSONA_META_DIRS = [
  path.join(PERSONAS_DIR, 'ledger',        'src', 'meta'),
  path.join(PERSONAS_DIR, 'standalone',    'src', 'meta'),
  path.join(PERSONAS_DIR, 'ledger-support', 'src', 'meta'),
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the latest mtime (ms) among the immediate files of a flat directory
 * (no subdirectory recursion). Returns -Infinity when unreadable or empty.
 * Use this for known flat dirs (e.g. persona meta/ directories).
 * @param {string} dir
 * @returns {number}
 */
function latestMtimeFlat(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile())
      .reduce((max, e) => Math.max(max, fs.statSync(path.join(dir, e.name)).mtimeMs), -Infinity);
  } catch {
    return -Infinity;
  }
}

/**
 * Recursively find the latest mtime (ms) among all files in a directory.
 * Returns -Infinity if the directory is unreadable or empty.
 * @param {string} dir
 * @returns {number}
 */
function latestMtime(dir) {
  let latest = -Infinity;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        latest = Math.max(latest, latestMtime(full));
      } else if (entry.isFile()) {
        latest = Math.max(latest, fs.statSync(full).mtimeMs);
      }
    }
  } catch {
    // Directory unreadable — treat as empty.
  }
  return latest;
}

// ─── Helpers (continued) ─────────────────────────────────────────────────────

/**
 * Returns true when the installed `node_modules` are up to date with
 * `package-lock.json`.  npm writes `node_modules/.package-lock.json` after
 * every successful install; comparing its mtime against the outer lock file
 * detects changes pulled in via git without a follow-up `npm install`.
 *
 * Returns false when:
 *   - `package-lock.json` is missing (no lock file → cannot determine state)
 *   - `node_modules/` is absent
 *   - `node_modules/.package-lock.json` is absent or older than the outer lock
 *
 * @param {string} dir  Directory containing `package-lock.json` and `node_modules/`
 * @returns {boolean}
 */
function lockfileFresh(dir) {
  const outerLock = path.join(dir, 'package-lock.json');
  const innerLock = path.join(dir, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(outerLock) || !fs.existsSync(innerLock)) return false;
  return fs.statSync(outerLock).mtimeMs <= fs.statSync(innerLock).mtimeMs;
}

// ─── Type definitions ─────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string, label: string, cost: 'instant'|'fast', detect(): boolean, fix?: string }} SyncCheck
 * @typedef {{ id: string, label: string, cost: 'slow', detect(): Promise<boolean>, fix?: string }} SlowCheck
 * @typedef {SyncCheck | SlowCheck} HealthCheck
 * @typedef {{ id: string, label: string, passed: boolean, fix?: string }} CheckResult
 */

// ─── Health-Check Registry ───────────────────────────────────────────────────

/** @type {Array<HealthCheck>} */
export const HEALTH_CHECKS = [

  // ── instant tier (< 5 ms — safe on every menu render) ────────────────────

  /** @type {SyncCheck} */
  {
    id: 'mcp-dist',
    label: 'MCP Server dist built',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      return fs.existsSync(MCP_DIST_SENTINEL);
    },
    fix: 'cd mcp-server && npm run build',
  },

  /** @type {SyncCheck} */
  {
    id: 'orchestrator-venv',
    label: 'Orchestrator venv present',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      return fs.existsSync(VENV_DIR);
    },
    fix: 'node scripts/cli.js setup --components orchestrator',
  },

  /** @type {SyncCheck} */
  {
    id: 'hooks-installed',
    label: 'Git hooks installed',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      try {
        const gitConfig = fs.readFileSync(
          path.join(WORKSPACE_ROOT, '.git', 'config'),
          'utf8'
        );
        return /hooksPath\s*=\s*\.githooks/.test(gitConfig);
      } catch {
        return false;
      }
    },
    fix: 'node scripts/cli.js install-hooks',
  },

  /** @type {SyncCheck} */
  {
    id: 'node-version',
    label: 'Node.js \u2265 18',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      const major = parseInt(process.versions.node.split('.')[0], 10);
      return major >= 18;
    },
    fix: 'Install Node.js 18 or later from https://nodejs.org',
  },

  // ── fast tier (< 50 ms — mtime comparisons, JSON reads) ──────────────────

  /** @type {SyncCheck} */
  {
    id: 'global-mcp-registered',
    label: 'Global MCP registered',
    cost: 'fast',
    /** @returns {boolean} */
    detect() {
      return fs.existsSync(path.join(os.homedir(), '.ai-insights', 'config.json'));
    },
    fix: 'node scripts/cli.js install-mcp',
  },

  /** @type {SyncCheck} */
  {
    id: 'mcp-dist-fresh',
    label: 'MCP Server dist up to date',
    cost: 'fast',
    /** @returns {boolean} */
    detect() {
      if (!fs.existsSync(MCP_DIST_SENTINEL)) return false;
      const distMtime = latestMtime(MCP_DIST_DIR);
      return latestMtime(MCP_SRC_DIR) <= distMtime;
    },
    fix: 'cd mcp-server && npm run build',
  },

  /** @type {SyncCheck} */
  {
    id: 'overview-fresh',
    label: 'Agents overview up to date',
    cost: 'fast',
    /** @returns {boolean} */
    detect() {
      if (!fs.existsSync(OVERVIEW_FILE)) return false;
      const overviewMtime = fs.statSync(OVERVIEW_FILE).mtimeMs;
      const latestYaml = Math.max(...PERSONA_META_DIRS.map(d => latestMtimeFlat(d)));
      return latestYaml <= overviewMtime;
    },
    fix: 'node scripts/cli.js generate-overview',
  },

  /** @type {SyncCheck} */
  {
    id: 'personas-deps-fresh',
    label: 'Personas dependencies up to date',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      return lockfileFresh(PERSONAS_DIR);
    },
    fix: 'cd personas && npm install',
  },

  /** @type {SyncCheck} */
  {
    id: 'mcp-deps-fresh',
    label: 'MCP Server dependencies up to date',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      return lockfileFresh(MCP_SERVER_DIR);
    },
    fix: 'cd mcp-server && npm install',
  },

  /** @type {SyncCheck} */
  {
    id: 'orchestrator-deps-fresh',
    label: 'Orchestrator Python dependencies up to date',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      const pyproject  = path.join(ORCHESTRATOR_DIR, 'pyproject.toml');
      const reqsTxt    = path.join(ORCHESTRATOR_DIR, 'requirements.txt');
      const eggInfo    = path.join(ORCHESTRATOR_DIR, 'ai_insights_orchestrator.egg-info', 'requires.txt');
      if (!fs.existsSync(eggInfo)) return false;
      const eggMtime = fs.statSync(eggInfo).mtimeMs;
      const srcMtime = Math.max(
        fs.existsSync(pyproject) ? fs.statSync(pyproject).mtimeMs : 0,
        fs.existsSync(reqsTxt)   ? fs.statSync(reqsTxt).mtimeMs   : 0,
      );
      return srcMtime <= eggMtime;
    },
  },

  // ── slow tier (100 ms – 2 s — subprocess spawns) ─────────────────────────

  /** @type {SlowCheck} */
  {
    id: 'personas-fresh',
    label: 'Personas up to date',
    cost: 'slow',
    /** @returns {Promise<boolean>} */
    detect() {
      return new Promise((resolve) => {
        const proc = spawn(
          'node',
          [path.join(WORKSPACE_ROOT, 'scripts', 'build-personas.js'), '--check'],
          { stdio: 'ignore', shell: false }
        );
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });
    },
    fix: 'node scripts/cli.js sync-personas',
  },

];

// ─── runChecks helper ─────────────────────────────────────────────────────────

/**
 * Run the subset of health checks matching the given cost filter and resolve
 * all detectors, awaiting async slow checks.
 *
 * Filter behaviour:
 *   'instant' — only instant-tier checks; all detectors are synchronous.
 *   'fast'    — instant + fast checks; all detectors are synchronous.
 *   'slow'    — only slow-tier checks; all detectors are async (Promise).
 *   'all'     — all checks; async slow detectors are awaited.
 *
 * @param {'instant'|'fast'|'slow'|'all'} costFilter
 * @returns {Promise<CheckResult[]>}
 */
export async function runChecks(costFilter) {
  /** @type {Record<string, string[]>} */
  const tierSets = {
    instant: ['instant'],
    fast:    ['instant', 'fast'],
    slow:    ['slow'],
    all:     ['instant', 'fast', 'slow'],
  };

  const allowed = tierSets[costFilter];
  if (!allowed) {
    throw new Error(
      `Unknown costFilter "${costFilter}". Expected: instant | fast | slow | all`
    );
  }

  const checks = HEALTH_CHECKS.filter(c => allowed.includes(c.cost));

  const results = await Promise.all(
    checks.map(async (check) => {
      let passed;
      try {
        const raw = check.detect();
        // instant/fast detectors return a plain boolean — no await needed.
        // slow detectors return a Promise — await it.
        passed = raw instanceof Promise ? await raw : raw;
      } catch {
        passed = false;
      }

      /** @type {CheckResult} */
      const result = { id: check.id, label: check.label, passed: Boolean(passed) };
      if (check.fix) result.fix = check.fix;
      return result;
    })
  );

  return results;
}

```
###  Path: `/scripts/lib/insight-validation.js`

```js
/**
 * scripts/lib/insight-validation.js
 *
 * Validates insight_agent / insight_report_target pairing and role match
 * across persona YAML metadata. Used by build-personas.js.
 */

import fs from 'fs';
import path from 'path';
import { parseYamlScalars } from './yaml-utils.js';

/**
 * Validate a single persona's YAML text for insight field consistency.
 * @param {string} yamlText - raw YAML content
 * @param {string} filename - filename for error messages
 * @returns {string[]} array of error strings (empty = valid)
 */
export function validateInsightFields(yamlText, filename) {
  const fields = parseYamlScalars(yamlText, ['role', 'insight_agent', 'insight_report_target']);
  const errors = [];

  const hasAgent  = 'insight_agent' in fields;
  const hasTarget = 'insight_report_target' in fields;

  if (hasAgent !== hasTarget) {
    const missing = hasAgent ? 'insight_report_target' : 'insight_agent';
    errors.push(
      `${filename}: defines ${hasAgent ? 'insight_agent' : 'insight_report_target'} ` +
      `but not ${missing}. Both must be declared together.`,
    );
  }

  if (hasAgent && fields.role && fields.insight_agent !== fields.role) {
    errors.push(
      `${filename}: insight_agent "${fields.insight_agent}" differs from ` +
      `role "${fields.role}". They must be identical for ledger personas.`,
    );
  }

  return errors;
}

/**
 * Validate insight fields across all persona YAML files in the given meta directories.
 * @param {string[]} metaDirs - absolute paths to suite meta directories
 * @returns {string[]} array of error strings (empty = all valid)
 */
export function validateInsightFieldsInDirs(metaDirs) {
  const errors = [];

  for (const metaDir of metaDirs) {
    if (!fs.existsSync(metaDir)) continue;
    const yamlFiles = fs.readdirSync(metaDir).filter(
      f => f.endsWith('.yaml') && !f.startsWith('_'),
    );

    for (const yamlFile of yamlFiles) {
      const text = fs.readFileSync(path.join(metaDir, yamlFile), 'utf8');
      errors.push(...validateInsightFields(text, yamlFile));
    }
  }

  return errors;
}

```
###  Path: `/scripts/lib/ledger-dirs.js`

```js
/**
 * scripts/lib/ledger-dirs.js
 *
 * Canonical project-directory discovery for root-level `scripts/` utilities.
 *
 * Ledger project storage supports two on-disk layouts:
 *   - Legacy flat layout:      {storeRoot}/{slug}/
 *   - Namespaced layout:       {storeRoot}/{repoName}/{slug}/
 *
 * The rules for distinguishing them (dot-prefix exclusion, depth-1 vs depth-2
 * `.meta.json` probing) are owned by `LedgerStore.listAllProjectDirs()` in the
 * MCP server source. This module loads that compiled implementation from
 * `mcp-server/dist/` and re-exports it for Node scripts, so the discovery
 * logic is never re-implemented outside of `mcp-server/src/storage/ledger-store.ts`.
 *
 * Rebuilds `mcp-server/dist/` automatically when stale, mirroring the
 * freshness guard already used by `scripts/import-standalone.js`.
 */

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MCP_SERVER_DIR = path.join(WORKSPACE_ROOT, 'mcp-server');
const MCP_SRC_DIR = path.join(MCP_SERVER_DIR, 'src');
const MCP_DIST_SENTINEL = path.join(MCP_SERVER_DIR, 'dist', 'index.js');
const MCP_DIST_LEDGER_STORE = path.join(MCP_SERVER_DIR, 'dist', 'storage', 'ledger-store.js');

/**
 * Recursively returns the largest mtime (ms) of any file under `dir`.
 * @param {string} dir
 * @returns {number}
 */
function latestMtime(dir) {
  let latest = -Infinity;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestMtime(full));
    } else if (entry.isFile()) {
      latest = Math.max(latest, fs.statSync(full).mtimeMs);
    }
  }
  return latest;
}

/**
 * Rebuilds `mcp-server/dist/` when missing or older than `mcp-server/src/`.
 * Exits the process on build failure, consistent with `import-standalone.js`.
 */
function ensureMcpDistFresh() {
  let needBuild = !fs.existsSync(MCP_DIST_SENTINEL);
  if (!needBuild) {
    needBuild = latestMtime(MCP_SRC_DIR) > fs.statSync(MCP_DIST_SENTINEL).mtimeMs;
  }

  if (needBuild) {
    console.log('[ledger-dirs] mcp-server/dist is stale or missing — building MCP server...');
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';
    const build = spawnSync(npmCmd, ['run', 'build'], {
      cwd: MCP_SERVER_DIR,
      stdio: 'inherit',
      shell: isWindows,
    });
    if (build.status !== 0) {
      console.error('[ledger-dirs] MCP server build failed.');
      process.exit(build.status ?? 1);
    }
  }

  if (!fs.existsSync(MCP_DIST_LEDGER_STORE)) {
    console.error(`[ledger-dirs] Error: compiled module not found at ${MCP_DIST_LEDGER_STORE}`);
    console.error('Try running: cd mcp-server && npm run build');
    process.exit(1);
  }
}

/** @type {Promise<{ LedgerStore: unknown }> | null} */
let ledgerStoreModulePromise = null;

/**
 * Loads (and caches) the compiled `LedgerStore` class from `mcp-server/dist/`.
 * @returns {Promise<any>}
 */
async function loadLedgerStore() {
  ensureMcpDistFresh();
  if (!ledgerStoreModulePromise) {
    ledgerStoreModulePromise = import(pathToFileURL(MCP_DIST_LEDGER_STORE).href);
  }
  const mod = await ledgerStoreModulePromise;
  return mod.LedgerStore;
}

/**
 * Returns the absolute storage directory path for every project found under
 * `storeRoot`, delegating to `LedgerStore.listAllProjectDirs()`.
 *
 * @param {string} storeRoot - Absolute path to a ledger store root.
 * @returns {Promise<string[]>}
 */
export async function listAllProjectDirs(storeRoot) {
  const LedgerStore = await loadLedgerStore();
  return LedgerStore.listAllProjectDirs(storeRoot);
}

```
###  Path: `/scripts/lib/persona-model-resolution.js`

```js
/**
 * scripts/lib/persona-model-resolution.js
 *
 * Model resolution helpers for the personas name-mapping build pass.
 *
 * Provides:
 *   loadModelRegistry(registryDir)  — reads local.json / default.json + assignments.json
 *   resolveModel(...)               — resolves model fields using the priority chain
 *
 * Both functions are pure (no side-effects beyond the file reads performed by
 * loadModelRegistry), making them straightforwardly unit-testable.
 *
 * Priority chain for resolveModel:
 *   1. assignments.json persona_models[personaId]  (skip when resolved slug === "inherit")
 *   2. per-persona YAML model_slug                 (skip when value === "inherit")
 *   3. assignments.json default_model_uuid          (skip when resolved slug === "inherit")
 *   4. _shared.yaml default_model_slug
 *   5. "inherit" sentinel fallback
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// loadModelRegistry
// ---------------------------------------------------------------------------

/**
 * Load the model registry files from `registryDir`.
 *
 * Reads `local.json` (falling back to `default.json`) to build the UUID → slug
 * map, and reads `assignments.json` when present.
 *
 * @param {string} registryDir  Absolute path to the model-registry directory.
 * @param {{ warn?: (msg: string) => void }} [opts]
 *   Optional overrides — `warn` defaults to `console.warn`.
 * @returns {{ uuidToSlug: Map<string,string>, registryEntries: object[], assignments: object|null }}
 */
export function loadModelRegistry(registryDir, opts = {}) {
  const warn = opts.warn ?? ((msg) => console.warn(msg));

  const localJsonPath   = path.join(registryDir, 'local.json');
  const defaultJsonPath = path.join(registryDir, 'default.json');
  const assignmentsPath = path.join(registryDir, 'assignments.json');

  // Build UUID → slug map from local.json (seed from default.json if absent)
  const uuidToSlug     = new Map();
  let   registryEntries = [];

  const regPath = fs.existsSync(localJsonPath) ? localJsonPath : defaultJsonPath;
  if (fs.existsSync(regPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      if (Array.isArray(parsed)) {
        registryEntries = parsed;
        for (const entry of parsed) {
          if (entry && typeof entry.id === 'string' && typeof entry.slug === 'string') {
            uuidToSlug.set(entry.id, entry.slug);
          }
        }
      }
    } catch (e) {
      warn(`[WARN] build-personas: failed to parse model registry at ${regPath}: ${e.message}`);
    }
  }

  // Load assignments.json (optional — absent in clean installs)
  let assignments = null;
  if (fs.existsSync(assignmentsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(assignmentsPath, 'utf8'));
      if (raw && typeof raw === 'object') {
        assignments = raw;
      }
    } catch (e) {
      warn(`[WARN] build-personas: failed to parse assignments.json: ${e.message}`);
    }
  }

  return { uuidToSlug, registryEntries, assignments };
}

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

/**
 * Resolve display name, slug, and cc_model for a persona.
 *
 * Priority chain (mirrors the build plugin + orchestrator):
 *   1. assignments.json persona_models[personaId]  (skip if resolved slug === "inherit")
 *   2. yamlModelSlug                               (skip if value === "inherit")
 *   3. assignments.json default_model_uuid          (skip if resolved slug === "inherit")
 *   4. sharedModelSlug / sharedModelName
 *   5. "inherit" sentinel — { model: "Inherit / Auto", model_slug: "inherit", cc_model: "inherit" }
 *
 * @param {string|undefined}       personaId       Persona ID (used as assignments key).
 * @param {string|undefined}       yamlModelSlug   Per-persona model_slug from YAML.
 * @param {string|undefined}       sharedModelSlug Shared default model slug (_shared.yaml).
 * @param {string|undefined}       sharedModelName Shared default model name (_shared.yaml).
 * @param {Map<string,string>}     uuidToSlug      UUID → slug from registry.
 * @param {object|null}            assignments     Parsed assignments.json (or null).
 * @param {object[]}               registryEntries Array of { id, name, slug, cc_model } registry entries.
 * @returns {{ model: string, model_slug: string, cc_model: string }}
 */
export function resolveModel(
  personaId,
  yamlModelSlug,
  sharedModelSlug,
  sharedModelName,
  uuidToSlug,
  assignments,
  registryEntries,
) {
  // Build slug → entry map for name / cc_model lookups
  const slugToEntry = new Map();
  for (const entry of registryEntries) {
    if (entry && typeof entry.slug === 'string') {
      slugToEntry.set(entry.slug, entry);
    }
  }

  function entryForSlug(slug) {
    return slugToEntry.get(slug) || null;
  }

  // 1. Per-persona assignment
  if (assignments && assignments.persona_models && personaId) {
    const uuid = assignments.persona_models[personaId];
    if (uuid) {
      const slug = uuidToSlug.get(uuid);
      if (slug && slug !== 'inherit') {
        const entry = entryForSlug(slug);
        return {
          model:      entry ? entry.name : slug,
          model_slug: slug,
          cc_model:   entry ? entry.cc_model : 'inherit',
        };
      }
      // slug === 'inherit' → skip, fall through
    }
  }

  // 2. Per-persona YAML model_slug
  if (yamlModelSlug && yamlModelSlug !== 'inherit') {
    const entry = entryForSlug(yamlModelSlug);
    return {
      model:      entry ? entry.name : yamlModelSlug,
      model_slug: yamlModelSlug,
      cc_model:   entry ? entry.cc_model : 'inherit',
    };
  }

  // 3. Default assignment from assignments.json
  if (assignments && assignments.default_model_uuid) {
    const slug = uuidToSlug.get(assignments.default_model_uuid);
    if (slug && slug !== 'inherit') {
      const entry = entryForSlug(slug);
      return {
        model:      entry ? entry.name : slug,
        model_slug: slug,
        cc_model:   entry ? entry.cc_model : 'inherit',
      };
    }
    // slug === 'inherit' → skip, fall through
  }

  // 4. _shared.yaml default
  if (sharedModelSlug && sharedModelSlug !== 'inherit') {
    const entry = entryForSlug(sharedModelSlug);
    return {
      model:      entry ? entry.name : (sharedModelName || sharedModelSlug),
      model_slug: sharedModelSlug,
      cc_model:   entry ? entry.cc_model : 'inherit',
    };
  }

  // 5. Ultimate fallback — inherit sentinel
  return { model: 'Inherit / Auto', model_slug: 'inherit', cc_model: 'inherit' };
}

```
###  Path: `/scripts/lib/store-commands.js`

```js
/**
 * scripts/lib/store-commands.js
 *
 * Pure-JavaScript implementation of the `store` command group.
 *
 * All exported functions accept an optional `_configPath` parameter for test
 * isolation — when provided, it overrides the default `~/.ai-insights/stores.json`
 * location so tests can work with temporary directories without touching real
 * user-level config.
 *
 * File formats are compatible with the TypeScript storage modules:
 *   - stores.json      → StoresConfigSchema
 *   - .repositories.json → RepositoryRegistrySchema
 *
 * ## Public command API (consumed by scripts/cli.js → cmdStore())
 *
 *   storeInit, storeAdd, storeRemove, storeList, storeSetDefault,
 *   storeConflicts, storeStatus, storeRepoAdd, storeRepoMove, storeRepoList
 *
 * ## Exported for test isolation only (not part of the public CLI API)
 *
 *   resolveConfigPath, expandPath, registryPath,
 *   loadConfig, saveConfig, loadRegistry, saveRegistry
 *
 *   These helpers are exported so tests can pre-seed config and registry files
 *   in temporary directories and inject override paths. They are not intended
 *   to be called by scripts other than the test suite.
 */

import { homedir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import fs from 'fs';
import { listAllProjectDirs } from './ledger-dirs.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const AI_INSIGHTS_DIR   = '.ai-insights';
const STORES_FILENAME   = 'stores.json';
const REGISTRY_FILENAME = '.repositories.json';

// ─── Path Utilities ───────────────────────────────────────────────────────────

/**
 * Returns the default path to `~/.ai-insights/stores.json`.
 */
export function resolveConfigPath() {
  return join(homedir(), AI_INSIGHTS_DIR, STORES_FILENAME);
}

/**
 * Expands a `~`-prefixed path to an absolute path, then normalizes with
 * `path.resolve()`. Mirrors the TypeScript `expandStorePath()` in store-registry.ts.
 *
 * @param {string} p
 * @returns {string}
 */
export function expandPath(p) {
  if (p.startsWith('~/') || p === '~') {
    return resolve(join(homedir(), p.slice(2)));
  }
  return resolve(p);
}

/**
 * Returns the absolute path of the `.repositories.json` for a store.
 *
 * @param {string} storePath - Absolute path to the store root directory
 * @returns {string}
 */
export function registryPath(storePath) {
  return join(storePath, REGISTRY_FILENAME);
}

// ─── JSON I/O ────────────────────────────────────────────────────────────────

/**
 * Reads and parses a JSON file synchronously.
 * Returns `null` on any error (missing file, malformed JSON, permissions).
 *
 * @param {string} filePath
 * @returns {unknown | null}
 */
function readJsonSync(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Writes `data` as formatted JSON to `filePath` synchronously.
 * Creates parent directories as needed.
 *
 * @param {string} filePath
 * @param {unknown} data
 */
function writeJsonSync(filePath, data) {
  fs.mkdirSync(join(filePath, '..'), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─── Config I/O ──────────────────────────────────────────────────────────────

/**
 * Loads the stores.json config from the given path (or the default path).
 * Returns `null` if the file doesn't exist or cannot be parsed.
 *
 * @param {string | undefined} configPath
 * @returns {{ stores: Array, default_store: string } | null}
 */
export function loadConfig(configPath) {
  const data = readJsonSync(configPath ?? resolveConfigPath());
  if (!data || !Array.isArray(data.stores)) return null;
  return data;
}

/**
 * Writes the stores.json config atomically (JSON.stringify + writeFileSync).
 *
 * @param {{ stores: Array, default_store: string }} config
 * @param {string | undefined} configPath
 * @param {string | undefined} _storesDirOverride - When provided, used instead of
 *   `~/.ai-insights/` for the parent-directory mkdirSync call. Intended for test
 *   isolation so tests never touch the real user-level config directory.
 */
export function saveConfig(config, configPath, _storesDirOverride) {
  const p = configPath ?? resolveConfigPath();
  const storesDir = _storesDirOverride ?? join(homedir(), AI_INSIGHTS_DIR);
  fs.mkdirSync(storesDir, { recursive: true });
  writeJsonSync(p, config);
}

// ─── Registry I/O ────────────────────────────────────────────────────────────

/**
 * Loads the `.repositories.json` for a store. Returns `{ repositories: [] }`
 * if the file doesn't exist or is invalid — same behaviour as the TypeScript
 * `loadRegistry()` in repository-registry.ts.
 *
 * @param {string} storePath - Absolute path to the store root directory
 * @returns {{ repositories: Array }}
 */
export function loadRegistry(storePath) {
  const data = readJsonSync(registryPath(storePath));
  if (!data || !Array.isArray(data.repositories)) {
    return { repositories: [] };
  }
  return data;
}

/**
 * Writes the repository registry for a store.
 *
 * @param {string} storePath - Absolute path to the store root directory
 * @param {{ repositories: Array }} registry
 */
export function saveRegistry(storePath, registry) {
  const sorted = { ...registry, repositories: [...registry.repositories].sort((a, b) => a.id.localeCompare(b.id)) };
  writeJsonSync(registryPath(storePath), sorted);
}

// ─── store init ───────────────────────────────────────────────────────────────

/**
 * Creates `~/.ai-insights/stores.json` with a single default store pointing
 * at the provided `ledgerRoot` (or the default `mcp-server/storage/ledger/`).
 *
 * Also creates `~/.ai-insights/stores/` as the recommended stores directory.
 *
 * @param {{ configPath?: string, ledgerRoot?: string, _storesDirOverride?: string }} [opts]
 * @returns {{ ok: boolean, config?: object, configPath?: string, reason?: string }}
 */
export function storeInit({ configPath, ledgerRoot, _storesDirOverride } = {}) {
  const cp = configPath ?? resolveConfigPath();

  if (fs.existsSync(cp)) {
    return { ok: false, reason: `stores.json already exists at ${cp}` };
  }

  // Create the recommended stores directory.
  const baseDir = _storesDirOverride ?? join(homedir(), AI_INSIGHTS_DIR);
  const storesDir = join(baseDir, 'stores');
  fs.mkdirSync(storesDir, { recursive: true });

  const root = ledgerRoot ?? join(process.cwd(), 'mcp-server', 'storage', 'ledger');
  const absRoot = expandPath(root);

  const config = {
    stores: [{ id: 'default', label: 'Default', path: absRoot }],
    default_store: 'default',
  };

  saveConfig(config, cp, _storesDirOverride);
  return { ok: true, config, configPath: cp };
}

// ─── store add ────────────────────────────────────────────────────────────────

/**
 * Registers a new store in `stores.json`, creates the store directory, and
 * initializes an empty `.repositories.json` if one doesn't exist.
 *
 * @param {{ id: string, storePath: string, label?: string, configPath?: string }} opts
 * @returns {{ ok: boolean, id?: string, path?: string, reason?: string }}
 */
export function storeAdd({ id, storePath, label, configPath } = {}) {
  if (!id)        return { ok: false, reason: 'Store ID is required.' };
  if (!storePath) return { ok: false, reason: 'Store path is required.' };

  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp) ?? { stores: [], default_store: id };
  const absPath = expandPath(storePath);

  if (config.stores.some(s => s.id === id)) {
    return { ok: false, reason: `Store '${id}' already exists in stores.json.` };
  }

  try {
    fs.mkdirSync(absPath, { recursive: true });
  } catch (err) {
    return { ok: false, reason: `Cannot create store directory '${absPath}': ${err.message}` };
  }

  // Initialize an empty registry if the store doesn't have one.
  const regPath = registryPath(absPath);
  if (!fs.existsSync(regPath)) {
    saveRegistry(absPath, { repositories: [] });
  }

  config.stores.push({ id, label: label ?? id, path: absPath });
  saveConfig(config, cp);

  return { ok: true, id, path: absPath };
}

// ─── store remove ─────────────────────────────────────────────────────────────

/**
 * Removes a store entry from `stores.json`. Does NOT delete the directory.
 * Returns `warned: true` when the store's `.repositories.json` has entries —
 * the caller should display a warning.
 *
 * @param {{ id: string, configPath?: string }} opts
 * @returns {{ ok: boolean, id?: string, hasRepos?: boolean, warned?: boolean, reason?: string }}
 */
export function storeRemove({ id, configPath } = {}) {
  if (!id) return { ok: false, reason: 'Store ID is required.' };

  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: false, reason: 'No stores.json found.' };

  const idx = config.stores.findIndex(s => s.id === id);
  if (idx === -1) return { ok: false, reason: `Store '${id}' not found in stores.json.` };

  const store   = config.stores[idx];
  const absPath = expandPath(store.path);
  const registry = loadRegistry(absPath);
  const hasRepos = registry.repositories.length > 0;

  config.stores.splice(idx, 1);

  // Reassign default_store if it pointed at the removed store.
  if (config.stores.length === 0) {
    config.default_store = null;
  } else if (config.default_store === id) {
    config.default_store = config.stores[0].id;
  }

  saveConfig(config, cp);
  return { ok: true, id, hasRepos, warned: hasRepos };
}

// ─── store list ───────────────────────────────────────────────────────────────

/**
 * Returns a summary of all registered stores with repo and project counts.
 *
 * Project counts are derived from `LedgerStore.listAllProjectDirs()` (via
 * `scripts/lib/ledger-dirs.js`) — directory discovery is never re-implemented
 * here.
 *
 * @param {{ configPath?: string }} [opts]
 * @returns {Promise<{ ok: boolean, stores: Array, default_store?: string }>}
 */
export async function storeList({ configPath } = {}) {
  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: true, stores: [] };

  const stores = await Promise.all(config.stores.map(async (s) => {
    const absPath  = expandPath(s.path);
    const registry = loadRegistry(absPath);
    const repoCount = registry.repositories.length;

    let projectCount = 0;
    try {
      projectCount = (await listAllProjectDirs(absPath)).length;
    } catch { /* store path may not exist yet — skip silently */ }

    return {
      id:            s.id,
      label:         s.label ?? s.id,
      path:          absPath,
      is_default:    s.id === config.default_store,
      repo_count:    repoCount,
      project_count: projectCount,
    };
  }));

  return { ok: true, stores, default_store: config.default_store };
}

// ─── store default ────────────────────────────────────────────────────────────

/**
 * Sets the `default_store` field in `stores.json`.
 *
 * @param {{ id: string, configPath?: string }} opts
 * @returns {{ ok: boolean, default_store?: string, reason?: string }}
 */
export function storeSetDefault({ id, configPath } = {}) {
  if (!id) return { ok: false, reason: 'Store ID is required.' };

  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: false, reason: 'No stores.json found.' };

  if (!config.stores.some(s => s.id === id)) {
    return { ok: false, reason: `Store '${id}' not found in stores.json.` };
  }

  config.default_store = id;
  saveConfig(config, cp);
  return { ok: true, default_store: id };
}

// ─── store conflicts ──────────────────────────────────────────────────────────

/**
 * Returns a list of repositories registered in more than one store's
 * `.repositories.json`. Store-order priority (first store in `stores.json`
 * order) determines the winner — consistent with `MultiStoreManager.getRegistryConflicts()`.
 *
 * @param {{ configPath?: string }} [opts]
 * @returns {{ ok: boolean, conflicts: Array }}
 */
export function storeConflicts({ configPath } = {}) {
  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: true, conflicts: [] };

  /** @type {Map<string, { store_id: string, entry: object }>} */
  const seen      = new Map(); // folder_name → first-seen { store_id, entry }
  const conflicts = []; // Array<{ repo_name, entries[], winner_store_id }>

  for (const s of config.stores) {
    const absPath  = expandPath(s.path);
    const registry = loadRegistry(absPath);

    for (const entry of registry.repositories) {
      for (const folderName of (Array.isArray(entry.folder_names) ? entry.folder_names : [])) {
        if (seen.has(folderName)) {
          // Conflict detected — locate or create conflict record.
          const winner = seen.get(folderName);
          let conflict = conflicts.find(c => c.repo_name === folderName);
          if (!conflict) {
            conflict = {
              repo_name:       folderName,
              entries:         [{ store_id: winner.store_id, entry: winner.entry }],
              winner_store_id: winner.store_id,
            };
            conflicts.push(conflict);
          }
          conflict.entries.push({ store_id: s.id, entry });
        } else {
          seen.set(folderName, { store_id: s.id, entry });
        }
      }
    }
  }

  return { ok: true, conflicts };
}

// ─── store status ─────────────────────────────────────────────────────────────

/**
 * For each registered store that is also a Git repository, shows the
 * ahead/behind count relative to `@{upstream}`. Stores that are not Git repos
 * are shown with status "not a git repo".
 *
 * @param {{ configPath?: string }} [opts]
 * @returns {{ ok: boolean, statuses: Array }}
 */
export function storeStatus({ configPath } = {}) {
  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: true, statuses: [] };

  const statuses = config.stores.map(s => {
    const absPath = expandPath(s.path);

    // Check if the path is a Git repo.
    const revParse = spawnSync('git', ['-C', absPath, 'rev-parse', '--git-dir'], {
      encoding: 'utf8',
      shell:    false,
    });
    if (revParse.status !== 0) {
      return { id: s.id, path: absPath, is_git: false };
    }

    // Get ahead/behind counts.
    const revList = spawnSync(
      'git',
      ['-C', absPath, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
      { encoding: 'utf8', shell: false }
    );

    if (revList.status !== 0) {
      return { id: s.id, path: absPath, is_git: true, status: 'no upstream' };
    }

    const [ahead = '0', behind = '0'] = revList.stdout.trim().split(/\s+/);
    return {
      id:     s.id,
      path:   absPath,
      is_git: true,
      ahead:  parseInt(ahead, 10),
      behind: parseInt(behind, 10),
    };
  });

  return { ok: true, statuses };
}

// ─── store repo add ───────────────────────────────────────────────────────────

/**
 * Adds a repository entry to the specified store's `.repositories.json`.
 * Creates a minimal entry compatible with `RepositoryEntrySchema`.
 *
 * @param {{ repoName: string, storeId: string, label?: string, configPath?: string }} opts
 * @returns {{ ok: boolean, repoName?: string, storeId?: string, reason?: string }}
 */
export function storeRepoAdd({ repoName, storeId, label, configPath } = {}) {
  if (!repoName) return { ok: false, reason: 'Repository name is required.' };
  if (!storeId)  return { ok: false, reason: 'Store ID is required.' };

  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: false, reason: 'No stores.json found. Run `store init` first.' };

  const storeEntry = config.stores.find(s => s.id === storeId);
  if (!storeEntry) return { ok: false, reason: `Store '${storeId}' not found in stores.json.` };

  const absPath  = expandPath(storeEntry.path);
  const registry = loadRegistry(absPath);

  // Check for duplicate folder_name.
  const duplicate = registry.repositories.find(r =>
    Array.isArray(r.folder_names) && r.folder_names.includes(repoName)
  );
  if (duplicate) {
    return { ok: false, reason: `Repository '${repoName}' is already registered in store '${storeId}'.` };
  }

  const now = new Date().toISOString();
  const entry = {
    id:           crypto.randomUUID(),
    label:        label ?? repoName,
    folder_names: [repoName],
    vision:       { short_term: null, mid_term: null, long_term: null },
    created_at:   now,
    last_modified: now,
  };

  registry.repositories.push(entry);
  saveRegistry(absPath, registry);

  return { ok: true, repoName, storeId, entry };
}

// ─── store repo move ──────────────────────────────────────────────────────────

/**
 * Moves a repository entry from its current store's `.repositories.json` to
 * the target store's registry. Uses `folder_names` to locate the source entry.
 *
 * @param {{ repoName: string, targetStoreId: string, configPath?: string }} opts
 * @returns {{ ok: boolean, repoName?: string, fromStoreId?: string, toStoreId?: string, reason?: string }}
 */
export function storeRepoMove({ repoName, targetStoreId, configPath } = {}) {
  if (!repoName)      return { ok: false, reason: 'Repository name is required.' };
  if (!targetStoreId) return { ok: false, reason: 'Target store ID is required.' };

  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: false, reason: 'No stores.json found.' };

  if (!config.stores.some(s => s.id === targetStoreId)) {
    return { ok: false, reason: `Target store '${targetStoreId}' not found in stores.json.` };
  }

  // Pre-load the target registry and check for duplicates BEFORE modifying
  // the source. This prevents a partial-mutation failure where the repo is
  // removed from source but we return ok:false because the target has a copy.
  const targetEntry = config.stores.find(s => s.id === targetStoreId);
  const targetPath  = expandPath(targetEntry.path);
  const targetReg   = loadRegistry(targetPath);

  if (targetReg.repositories.some(r =>
    Array.isArray(r.folder_names) && r.folder_names.includes(repoName)
  )) {
    return { ok: false, reason: `Repository '${repoName}' is already registered in target store '${targetStoreId}'.` };
  }

  // Find the source store and entry. The target store is excluded from the
  // search so that an intra-target lookup never mutates source state.
  let fromStoreId = null;
  let entryToMove = null;

  for (const s of config.stores) {
    if (s.id === targetStoreId) continue;
    const absPath  = expandPath(s.path);
    const registry = loadRegistry(absPath);
    const idx = registry.repositories.findIndex(r =>
      Array.isArray(r.folder_names) && r.folder_names.includes(repoName)
    );
    if (idx !== -1) {
      fromStoreId = s.id;
      entryToMove = registry.repositories[idx];
      // Remove from source only now that we know the target is clear.
      registry.repositories.splice(idx, 1);
      saveRegistry(absPath, registry);
      break;
    }
  }

  if (!fromStoreId || !entryToMove) {
    return { ok: false, reason: `Repository '${repoName}' not found in any store (except possibly '${targetStoreId}').` };
  }

  // Add to target.
  const now = new Date().toISOString();
  entryToMove.last_modified = now;
  targetReg.repositories.push(entryToMove);
  saveRegistry(targetPath, targetReg);

  return { ok: true, repoName, fromStoreId, toStoreId: targetStoreId };
}

// ─── store repo list ──────────────────────────────────────────────────────────

/**
 * Returns a merged view of all repositories from all stores, with store-order
 * priority (first store that claims a folder_name wins).
 *
 * @param {{ configPath?: string }} [opts]
 * @returns {{ ok: boolean, repos: Array }}
 */
export function storeRepoList({ configPath } = {}) {
  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: true, repos: [] };

  const seen = new Set(); // folder_names already claimed
  const repos = [];

  for (const s of config.stores) {
    const absPath  = expandPath(s.path);
    const registry = loadRegistry(absPath);

    for (const entry of registry.repositories) {
      const folderNames = Array.isArray(entry.folder_names) ? entry.folder_names : [];
      // Determine if this entry is shadowed (any folder_name already claimed).
      const isShadowed = folderNames.some(fn => seen.has(fn));

      repos.push({
        store_id:   s.id,
        store_label: s.label ?? s.id,
        is_shadowed: isShadowed,
        ...entry,
      });

      // Mark folder_names as claimed only if this is the winner.
      if (!isShadowed) {
        for (const fn of folderNames) seen.add(fn);
      }
    }
  }

  return { ok: true, repos };
}

```
###  Path: `/scripts/lib/yaml-utils.js`

```js
/**
 * scripts/lib/yaml-utils.js
 *
 * Lightweight YAML utilities for parsing persona YAML files without external
 * dependencies. Used by build-personas.js and generate-agents-overview.js.
 */

/**
 * Extracts simple scalar (string/number) fields from a YAML file without
 * external dependencies. Only top-level key: value lines are parsed; nested
 * structures and lists are ignored.
 */
export function parseYamlScalars(text, fields) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1];
    if (!fields.includes(key)) continue;
    let val = m[2].trim();
    if (val.startsWith('"') || val.startsWith("'")) {
      const q = val[0];
      const closeIdx = val.indexOf(q, 1);
      if (closeIdx !== -1) {
        val = val.slice(1, closeIdx);
      } else {
        val = val.replace(/\s+#.*$/, '').trim();
      }
    } else {
      val = val.replace(/\s+#.*$/, '').trim();
    }
    result[key] = val;
  }
  return result;
}

/**
 * Extracts the string content of a YAML block scalar (`key: |` or `key: |-`).
 * Returns the block content (newline-joined, trimmed) or undefined when the
 * key is absent or does not use a block scalar indicator.
 */
export function extractYamlBlockScalar(text, key) {
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
    if (lineIndent === 0) break;
    if (indent === -1) indent = lineIndent;
    if (lineIndent < indent) break;
    content.push(line.slice(indent));
  }

  const joined = content.join('\n').trimEnd();
  return joined || undefined;
}

/**
 * Extracts a YAML sequence (list) value.
 * e.g.:
 *   subagents:
 *     - ledger-wp-decomposer
 *     - ledger-dependency-sequencer
 */
export function extractYamlSequence(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}\\s*:\\s*$`, 'm');
  const match = re.exec(text);
  if (!match) return undefined;

  const after = text.slice(match.index + match[0].length);
  const lines = after.split(/\r?\n/);
  const items = [];

  for (const line of lines) {
    const itemMatch = line.match(/^\s+-\s+(\S.*)$/);
    if (!itemMatch) {
      if (line.trim() !== '') break;
      continue;
    }
    items.push(itemMatch[1].trim());
  }

  return items.length > 0 ? items : undefined;
}

```
###  Path: `/scripts/migrate-knowledge-uuids.js`

```js
#!/usr/bin/env node
/**
 * scripts/migrate-knowledge-uuids.js
 *
 * One-time batch migration: converts all knowledge store files from schema
 * v1 (numeric `id`, `next_id` counter) to v2 (UUID v4 `id`, no `next_id`).
 *
 * Run this script before deploying the WP-002–WP-006 code changes that update
 * the MCP server schema and storage layer to require UUID identifiers.
 *
 * Usage:
 *   node scripts/migrate-knowledge-uuids.js [options]
 *
 * Options:
 *   --dry-run         Report planned changes without writing any files.
 *   --verbose         Log each file and the old→new ID mappings.
 *   --store <path>    Explicit store root path. Repeatable; overrides
 *                     auto-detection. Example:
 *                       --store /path/to/ledger-storage/store \
 *                       --store /path/to/nexus-ledger-storage/store
 *
 * Store discovery order (when --store flags are absent):
 *   1. ~/.ai-insights/stores.json  — multi-store config
 *   2. LEDGER_ROOT env var          — single-store fallback path
 *
 * Idempotent: files already at version "2.0.0" are silently skipped.
 */

import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

// ─── CLI argument parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);

const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

/** Collect all --store <path> arguments. */
const EXPLICIT_STORES = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--store' && args[i + 1] && !args[i + 1].startsWith('--')) {
    EXPLICIT_STORES.push(resolve(args[++i]));
  }
}

// ─── Store discovery ──────────────────────────────────────────────────────────

/**
 * Returns an array of absolute store root paths.
 * Precedence: explicit --store flags → stores.json → LEDGER_ROOT env var.
 * @returns {string[]}
 */
function resolveStorePaths() {
  if (EXPLICIT_STORES.length > 0) {
    return EXPLICIT_STORES;
  }

  // Try ~/.ai-insights/stores.json
  const storesConfigPath = join(homedir(), '.ai-insights', 'stores.json');
  if (existsSync(storesConfigPath)) {
    try {
      const config = JSON.parse(readFileSync(storesConfigPath, 'utf8'));
      if (Array.isArray(config.stores) && config.stores.length > 0) {
        const paths = config.stores
          .map((s) => (typeof s.path === 'string' ? resolve(s.path.replace(/^~/, homedir())) : null))
          .filter(Boolean);
        if (paths.length > 0) {
          return paths;
        }
      }
    } catch {
      console.error(`[migrate] Warning: failed to parse ${storesConfigPath} — ignoring.`);
    }
  }

  // Fall back to LEDGER_ROOT env var
  const envRoot = process.env['LEDGER_ROOT'];
  if (envRoot) {
    return [resolve(envRoot)];
  }

  return [];
}

// ─── Migration helpers ────────────────────────────────────────────────────────

/**
 * Collects all *-insights.json files inside {storePath}/.knowledge/.
 * Returns an empty array if the directory does not exist.
 * @param {string} storePath
 * @returns {string[]} Absolute file paths.
 */
function collectKnowledgeFiles(storePath) {
  const knowledgeDir = join(storePath, '.knowledge');
  if (!existsSync(knowledgeDir)) {
    return [];
  }
  return readdirSync(knowledgeDir)
    .filter((name) => name.endsWith('-insights.json'))
    .map((name) => join(knowledgeDir, name));
}

/**
 * Migrates a single knowledge store file in-place.
 * Returns a summary object describing what happened.
 * @param {string} filePath
 * @returns {{ filePath: string, action: 'skipped'|'migrated'|'dry-run', count: number, mappings: Map<number, string> }}
 */
function migrateFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  if (data.version === '2.0.0') {
    return { filePath, action: 'skipped', count: 0, mappings: new Map() };
  }

  const insights = Array.isArray(data.insights) ? data.insights : [];

  // Build numeric→UUID mapping for this file.
  /** @type {Map<number, string>} */
  const idMap = new Map();
  for (const insight of insights) {
    if (typeof insight.id === 'number') {
      idMap.set(insight.id, randomUUID());
    }
  }

  // Rewrite each insight.
  const migrated = insights.map((insight) => {
    const updated = { ...insight };

    // Replace numeric id with UUID.
    if (typeof insight.id === 'number') {
      updated.id = idMap.get(insight.id);
    }

    // Map superseded_by reference; drop if the source ID is not in this file.
    // Each knowledge store file is a self-contained scope unit with its own
    // independent ID namespace: ID 3 in global-insights.json and ID 3 in
    // repo-insights.json are different insights. Cross-file superseded_by
    // references are therefore structurally invalid, so dropping unmapped
    // references is safe and correct.
    if (typeof insight.superseded_by === 'number') {
      const mappedRef = idMap.get(insight.superseded_by);
      if (mappedRef !== undefined) {
        updated.superseded_by = mappedRef;
      } else {
        delete updated.superseded_by;
      }
    }

    return updated;
  });

  // Build the v2 store object — omit next_id entirely.
  const v2 = {
    version: '2.0.0',
    last_updated: new Date().toISOString(),
    insights: migrated,
  };

  if (!DRY_RUN) {
    const tmp = filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(v2, null, 2) + '\n', 'utf8');
    renameSync(tmp, filePath);
  }

  return {
    filePath,
    action: DRY_RUN ? 'dry-run' : 'migrated',
    count: migrated.length,
    mappings: idMap,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const storePaths = resolveStorePaths();

  if (storePaths.length === 0) {
    console.error(
      '[migrate] Error: no store paths found.\n' +
      '  Options:\n' +
      '    --store <path>     Specify one or more store root paths.\n' +
      '    ~/.ai-insights/stores.json  Configure multi-store paths.\n' +
      '    LEDGER_ROOT=<path> Set an env var for single-store mode.'
    );
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('[migrate] Dry-run mode — no files will be written.\n');
  }

  let totalFiles = 0;
  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const storePath of storePaths) {
    const files = collectKnowledgeFiles(storePath);

    if (files.length === 0) {
      console.log(`[migrate] ${storePath}/.knowledge/ — no insight files found.`);
      continue;
    }

    console.log(`[migrate] Store: ${storePath} (${files.length} file(s))`);

    for (const filePath of files) {
      const result = migrateFile(filePath);
      totalFiles++;

      if (result.action === 'skipped') {
        totalSkipped++;
        console.log(`  [skip]    ${filePath} — already at v2.0.0`);
        continue;
      }

      totalMigrated++;
      const label = result.action === 'dry-run' ? '[dry-run]' : '[migrated]';
      console.log(`  ${label} ${filePath} — ${result.count} insight(s)`);

      if (VERBOSE && result.mappings.size > 0) {
        for (const [oldId, newUuid] of result.mappings) {
          console.log(`            id ${oldId} → ${newUuid}`);
        }
      }
    }
  }

  console.log(
    `\n[migrate] Done. ${totalFiles} file(s) processed: ` +
    `${totalMigrated} ${DRY_RUN ? 'would be migrated' : 'migrated'}, ` +
    `${totalSkipped} skipped (already v2.0.0).`
  );
}

main();

```
###  Path: `/scripts/normalize-ctx-paths.js`

```js
#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const targetDir = process.argv[2]
  || path.join(import.meta.dirname, '..', '.context');

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
let pathsFixed    = 0;
let newlinesFixed = 0;

for (const file of files) {
  const raw     = fs.readFileSync(file, 'utf8');
  const content = raw.replace(/\r/g, '');       // normalise to LF
  const hadCR   = content !== raw;

  const updated = normalizePaths(content);      // path-separator pass

  if (updated !== null || hadCR) {
    fs.writeFileSync(file, updated ?? content, 'utf8');
    if (updated !== null) pathsFixed++;
    if (hadCR) newlinesFixed++;
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    console.log(`  normalized: ${rel}`);
  }
}

const total = pathsFixed + newlinesFixed;
if (total > 0) {
  const parts = [];
  if (pathsFixed)    parts.push(`paths in ${pathsFixed} file(s)`);
  if (newlinesFixed) parts.push(`line endings in ${newlinesFixed} file(s)`);
  console.log(`\nNormalized ${parts.join(', ')}.`);
} else {
  console.log('All files already normalized.');
}

```
###  Path: `/scripts/package-personas.js`

```js
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execSync } from 'child_process';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args             = process.argv.slice(2);
const SKIP_BUILD       = args.includes('--skip-build');
const versionArgIdx    = args.indexOf('--version');
const VERSION_OVERRIDE = versionArgIdx !== -1 ? args[versionArgIdx + 1] : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function die(msg) {
  process.stderr.write(`package-personas: ${msg}\n`);
  process.exit(1);
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// ---------------------------------------------------------------------------
// Parse version from changelog.md (mirrors extract-changelog-entry.js logic)
// ---------------------------------------------------------------------------
function parseVersion() {
  if (VERSION_OVERRIDE) return VERSION_OVERRIDE;

  const changelogPath = path.join(WORKSPACE_ROOT, 'changelog.md');
  let raw;
  try {
    raw = fs.readFileSync(changelogPath, 'utf8');
  } catch (err) {
    die(`Cannot read changelog.md: ${err.message}`);
  }

  // Matches: ## v1.2.3 — Title  or  ## v1.2.3 - Title
  const HEADER_RE = /^## (v[\d.]+(?:-\w+)?)\s+[-\u2014]\s+/m;
  const m = HEADER_RE.exec(raw);
  if (!m) die('No parseable ## v* entry found in changelog.md');
  return m[1];
}

// ---------------------------------------------------------------------------
// CRC-32 (required by ZIP spec)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// ZIP builder — pure Node.js, no external dependencies
//
// Spec references:
//   https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
//   DEFLATE (method 8) via Node's built-in zlib.deflateRawSync
// ---------------------------------------------------------------------------

/**
 * Build a complete ZIP file buffer from an array of file entries.
 * Each entry: { name: string, data: Buffer }
 * Stores only the filename (no directory prefix), mirroring `zip -j`.
 */
function buildZip(entries) {
  const localParts  = [];  // interleaved [headerBuf, dataBuf, ...]
  const centralDirs = [];
  const offsets     = [];
  let   offset      = 0;

  // Fixed DOS date/time: 2000-01-01 00:00:00 — deterministic, no TZ issues
  const DOS_TIME = 0x0000;
  const DOS_DATE = 0x2821;

  for (const entry of entries) {
    const nameBytes  = Buffer.from(entry.name, 'utf8');
    const rawData    = entry.data;
    const crc        = crc32(rawData);
    const deflated   = zlib.deflateRawSync(rawData, { level: 6 });
    const useDeflate = deflated.length < rawData.length;
    const compData   = useDeflate ? deflated : rawData;
    const method     = useDeflate ? 8 : 0;   // 8 = DEFLATE, 0 = STORE

    // ---- Local file header (30 bytes + filename) ----
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);          // PK\x03\x04
    local.writeUInt16LE(20, 4);                  // version needed (2.0)
    local.writeUInt16LE(0, 6);                   // flags
    local.writeUInt16LE(method, 8);              // compression method
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compData.length, 18);    // compressed size
    local.writeUInt32LE(rawData.length, 22);     // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);                  // extra field length
    nameBytes.copy(local, 30);

    offsets.push(offset);
    localParts.push(local, compData);
    offset += local.length + compData.length;

    // ---- Central directory entry (46 bytes + filename) ----
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);             // PK\x01\x02
    cd.writeUInt16LE(20, 4);                     // version made by
    cd.writeUInt16LE(20, 6);                     // version needed
    cd.writeUInt16LE(0, 8);                      // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compData.length, 20);
    cd.writeUInt32LE(rawData.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);                     // extra field length
    cd.writeUInt16LE(0, 32);                     // comment length
    cd.writeUInt16LE(0, 34);                     // disk number start
    cd.writeUInt16LE(0, 36);                     // internal attributes
    cd.writeUInt32LE(0, 38);                     // external attributes
    cd.writeUInt32LE(offsets[offsets.length - 1], 42); // local header offset
    nameBytes.copy(cd, 46);

    centralDirs.push(cd);
  }

  const cdOffset = offset;
  const cdSize   = centralDirs.reduce((s, b) => s + b.length, 0);

  // ---- End of central directory record (22 bytes) ----
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);             // PK\x05\x06
  eocd.writeUInt16LE(0, 4);                      // disk number
  eocd.writeUInt16LE(0, 6);                      // disk with start of CD
  eocd.writeUInt16LE(entries.length, 8);         // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);        // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);                     // comment length

  return Buffer.concat([...localParts, ...centralDirs, eocd]);
}

// ---------------------------------------------------------------------------
// Collect .md files from a directory (sorted, filenames only — mirrors zip -j)
// ---------------------------------------------------------------------------
function collectMdFiles(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    die(`Cannot read directory ${dir}: ${err.message}`);
  }
  return names
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => ({
      name: f,
      data: fs.readFileSync(path.join(dir, f)),
    }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const version = parseVersion();
log(`Version: ${version}`);

if (!SKIP_BUILD) {
  log('\nBuilding standalone personas...');
  try {
    execSync('node scripts/build-personas.js --suite standalone --target all --strict', {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit',
    });
  } catch {
    die('build-personas.js failed — aborting packaging.');
  }
} else {
  log('Skipping build (--skip-build).');
}

const distDir = path.join(WORKSPACE_ROOT, 'dist');
fs.mkdirSync(distDir, { recursive: true });
log(`\nOutput directory: dist/`);

const TARGETS = [
  { dir: 'personas/standalone/vs-code',          label: 'VS Code',                   slug: 'vscode'                    },
  { dir: 'personas/standalone/claude-code',       label: 'Claude Code',               slug: 'claudecode'                },
];

for (const target of TARGETS) {
  const srcDir  = path.join(WORKSPACE_ROOT, target.dir);
  const zipName = `ai-insights-personas-${target.slug}-${version}.zip`;
  const zipPath = path.join(distDir, zipName);

  log(`\nPackaging ${target.label} personas → dist/${zipName}`);

  const files = collectMdFiles(srcDir);
  if (files.length === 0) die(`No .md files found in ${target.dir}`);
  log(`  ${files.length} file(s): ${files.map(f => f.name).join(', ')}`);

  const zipBuf = buildZip(files);
  fs.writeFileSync(zipPath, zipBuf);
  log(`  Written: ${zipBuf.length.toLocaleString()} bytes`);
}

log('\nDone.');

```
###  Path: `/scripts/preflight-bootstrap.js`

```js
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Return the latest mtime (ms) of any file found recursively inside `dir`.
 * Returns 0 if the directory does not exist or is empty.
 * Uses fs.statSync only — no subprocess is spawned.
 */
function latestMtime(dir) {
  if (!fs.existsSync(dir)) return 0;
  let latest = 0;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    try {
      const { mtimeMs } = fs.statSync(full);
      if (mtimeMs > latest) latest = mtimeMs;
    } catch { /* ignore permission errors on individual files */ }
  }
  return latest;
}

/**
 * Return true when `srcDir` contains a file newer than `distFile`.
 * Considers the dist stale (returns true) when `distFile` does not exist.
 * Uses mtime comparison only — no subprocess is spawned for the check.
 */
function isStale(srcDir, distFile) {
  if (!fs.existsSync(distFile)) return true;
  const srcMtime  = latestMtime(srcDir);
  const distMtime = fs.statSync(distFile).mtimeMs;
  return srcMtime > distMtime;
}

function bootstrap() {
  const root = ROOT;

  // --- Ensure root node_modules are installed and up to date ---
  // Use node_modules/.package-lock.json mtime (updated by every npm install)
  // to detect whether package.json has changed since the last install.
  const pkgJson       = path.join(root, 'package.json');
  const internalLock  = path.join(root, 'node_modules', '.package-lock.json');
  const needsInstall  = !fs.existsSync(internalLock)
    || fs.statSync(pkgJson).mtimeMs > fs.statSync(internalLock).mtimeMs;
  if (needsInstall) {
    console.log(`[Bootstrap] Preparing ai-insights...`);
    try {
      execSync('npm install', { cwd: root, stdio: 'inherit' });
    } catch {
      console.error(`[Bootstrap] Failed to run npm install in ai-insights.`);
      process.exit(1);
    }
  }

  // --- mcp-server staleness detection (mtime comparison only) ---
  const mcpSrcDir  = path.join(root, 'mcp-server', 'src');
  const mcpDistFile = path.join(root, 'mcp-server', 'dist', 'index.js');
  if (isStale(mcpSrcDir, mcpDistFile)) {
    console.log(`[Bootstrap] mcp-server source is newer than dist, rebuilding...`);
    try {
      execSync('npm run build', { cwd: path.join(root, 'mcp-server'), stdio: 'inherit' });
    } catch {
      console.error(`[Bootstrap] Failed to rebuild mcp-server.`);
      process.exit(1);
    }
  }
}

bootstrap();


```
###  Path: `/scripts/preflight-orchestrator.js`

```js
#!/usr/bin/env node

/**
 * scripts/preflight-orchestrator.js
 *
 * Pre-flight validation for the AI Insights orchestrator.
 *
 * Checks that the orchestrator environment is ready to run:
 *   - Python venv exists with `orchestrate` binary
 *   - .env is configured with at least one API key
 *   - MCP server dist is up to date
 *   - No conflicting orchestrator process is already running
 *   - (Optional) Plan file exists (when --plan <path> is given)
 *   - (Optional) API key(s) are accepted by the provider (when --check-api-key is given)
 *
 * Usage:
 *   node scripts/preflight-orchestrator.js
 *   node scripts/preflight-orchestrator.js --plan path/to/plan.md
 *   node scripts/preflight-orchestrator.js --plan path/to/plan.md --json
 *   node scripts/preflight-orchestrator.js --check-api-key
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — one or more checks failed
 */

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { HEALTH_CHECKS } from './lib/health-checks.js';

// ─── Constants ──────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT   = path.resolve(import.meta.dirname, '..');
const ORCHESTRATOR_DIR = path.join(WORKSPACE_ROOT, 'orchestrator');
const IS_WIN           = process.platform === 'win32';
const VENV_DIR         = path.join(ORCHESTRATOR_DIR, '.venv');
const ENV_FILE         = path.join(ORCHESTRATOR_DIR, '.env');

const hcMcpDist      = HEALTH_CHECKS.find(c => c.id === 'mcp-dist');
const hcMcpDistFresh = HEALTH_CHECKS.find(c => c.id === 'mcp-dist-fresh');
const hcOrcVenv      = HEALTH_CHECKS.find(c => c.id === 'orchestrator-venv');
if (!hcMcpDist)      throw new Error("Health check 'mcp-dist' not found in HEALTH_CHECKS — was its id renamed?");
if (!hcMcpDistFresh) throw new Error("Health check 'mcp-dist-fresh' not found in HEALTH_CHECKS — was its id renamed?");
if (!hcOrcVenv)      throw new Error("Health check 'orchestrator-venv' not found in HEALTH_CHECKS — was its id renamed?");

function venvBin(name) {
  return IS_WIN
    ? path.join(VENV_DIR, 'Scripts', `${name}.exe`)
    : path.join(VENV_DIR, 'bin', name);
}

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const C = {
  green:  (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:    (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  dim:    (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   (s) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
};

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  let planPath = null;
  let jsonOutput = false;
  let checkApiKey = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plan' && argv[i + 1]) {
      planPath = argv[++i];
    } else if (argv[i] === '--json') {
      jsonOutput = true;
    } else if (argv[i] === '--check-api-key') {
      checkApiKey = true;
    }
  }

  return { planPath, jsonOutput, checkApiKey };
}

// ─── Check implementations ───────────────────────────────────────────────────

/**
 * @typedef {{ name: string, pass: boolean, detail: string, fix?: string }} CheckResult
 */

/**
 * Parse orchestrator/.env and return a map of key → value.
 * Comment lines and lines without a value are skipped.
 * @returns {Record<string, string>}
 */
function parseEnvVars() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const vars = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (val) vars[key] = val;
  }
  return vars;
}

/** Check that the Python venv exists and contains the orchestrate binary. */
function checkVenv() {
  // Delegate basic venv-dir detection to shared registry
  if (!hcOrcVenv.detect()) {
    return {
      name: 'venv',
      pass: false,
      detail: '.venv directory not found',
      fix: hcOrcVenv.fix,
    };
  }

  // orchestrate binary check is preflight-specific
  const orchestrateBin = venvBin('orchestrate');
  if (!fs.existsSync(orchestrateBin)) {
    return {
      name: 'venv',
      pass: false,
      detail: 'orchestrate binary not found in .venv',
      fix: 'node scripts/cli.js setup --components orchestrator --force',
    };
  }

  return { name: 'venv', pass: true, detail: 'orchestrate binary found' };
}

/** Check that .env exists and contains at least one API key. */
function checkEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    return {
      name: 'env',
      pass: false,
      detail: '.env file not found',
      fix: 'cp orchestrator/.env.example orchestrator/.env  # then edit it',
    };
  }

  const vars = parseEnvVars();

  if (!vars.ANTHROPIC_API_KEY && !vars.GOOGLE_API_KEY) {
    return {
      name: 'env',
      pass: false,
      detail: 'No API key set in .env (need ANTHROPIC_API_KEY or GOOGLE_API_KEY)',
      fix: 'Set the appropriate API key in orchestrator/.env',
    };
  }

  return { name: 'env', pass: true, detail: 'API key configured' };
}

/** Check that MCP server dist is built and up to date. */
function checkMcpDist() {
  // Delegate detection to shared registry — no local mtime logic needed.
  if (!hcMcpDist.detect()) {
    return {
      name: 'mcp-dist',
      pass: false,
      detail: 'mcp-server/dist/index.js not found',
      fix: hcMcpDist.fix,
    };
  }

  if (!hcMcpDistFresh.detect()) {
    return {
      name: 'mcp-dist',
      pass: false,
      detail: 'mcp-server/dist is stale (source is newer)',
      fix: hcMcpDistFresh.fix,
    };
  }

  return { name: 'mcp-dist', pass: true, detail: 'mcp-server/dist is up to date' };
}

/** Check that no other orchestrator process is running. */
function checkNoConflict() {
  if (IS_WIN) {
    // On Windows, skip ps-based check — the lock file check below is sufficient
    return { name: 'no-conflict', pass: true, detail: 'process check skipped (Windows)' };
  }

  const r = spawnSync('pgrep', ['-fl', 'orchestrate'], { encoding: 'utf8', shell: false });
  if (r.status === 0 && r.stdout.trim()) {
    // Filter out this script and grep itself
    const procs = r.stdout
      .trim()
      .split('\n')
      .filter((line) => !line.includes('preflight-orchestrator') && !line.includes('pgrep'));
    if (procs.length > 0) {
      return {
        name: 'no-conflict',
        pass: false,
        detail: `Orchestrator process already running (${procs.length} found)`,
        fix: 'Kill existing process first, or wait for it to finish',
      };
    }
  }

  return { name: 'no-conflict', pass: true, detail: 'no running orchestrator process' };
}

/** Check that the plan file exists (when --plan is given). */
function checkPlanFile(planPath) {
  const resolved = path.resolve(planPath);
  if (!fs.existsSync(resolved)) {
    return {
      name: 'plan-file',
      pass: false,
      detail: `Plan file not found: ${resolved}`,
    };
  }

  return { name: 'plan-file', pass: true, detail: path.basename(resolved) };
}

/**
 * Live-validate an Anthropic API key via GET /v1/models — no tokens consumed.
 * @param {string} apiKey
 * @returns {Promise<CheckResult>}
 */
async function checkAnthropicKey(apiKey) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (res.ok) {
      return { name: 'anthropic-key', pass: true, detail: 'key accepted by Anthropic API' };
    }
    const hint = res.status === 401 ? 'invalid or expired key' : `HTTP ${res.status}`;
    return {
      name: 'anthropic-key',
      pass: false,
      detail: `Anthropic rejected key: ${hint}`,
      fix: 'Update ANTHROPIC_API_KEY in orchestrator/.env',
    };
  } catch (err) {
    return {
      name: 'anthropic-key',
      pass: false,
      detail: `Anthropic key check failed: ${err.message}`,
    };
  }
}

/**
 * Live-validate a Google AI Studio API key via GET /v1beta/models — no tokens consumed.
 * @param {string} apiKey
 * @returns {Promise<CheckResult>}
 */
async function checkGoogleKey(apiKey) {
  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (res.ok) {
      return { name: 'google-key', pass: true, detail: 'key accepted by Google AI Studio API' };
    }
    const hint =
      res.status === 400 || res.status === 403 ? 'invalid or expired key' : `HTTP ${res.status}`;
    return {
      name: 'google-key',
      pass: false,
      detail: `Google rejected key: ${hint}`,
      fix: 'Update GOOGLE_API_KEY in orchestrator/.env',
    };
  } catch (err) {
    return {
      name: 'google-key',
      pass: false,
      detail: `Google key check failed: ${err.message}`,
    };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { planPath, jsonOutput, checkApiKey } = parseArgs();

  /** @type {CheckResult[]} */
  const results = [
    checkVenv(),
    checkEnv(),
    checkMcpDist(),
    checkNoConflict(),
  ];

  if (planPath) {
    results.push(checkPlanFile(planPath));
  }

  if (checkApiKey) {
    const vars = parseEnvVars();
    const pending = [];
    if (vars.ANTHROPIC_API_KEY) pending.push(checkAnthropicKey(vars.ANTHROPIC_API_KEY));
    if (vars.GOOGLE_API_KEY)    pending.push(checkGoogleKey(vars.GOOGLE_API_KEY));
    if (pending.length === 0) {
      results.push({
        name: 'api-key',
        pass: false,
        detail: 'No API key found in .env to validate',
        fix: 'Set ANTHROPIC_API_KEY or GOOGLE_API_KEY in orchestrator/.env',
      });
    } else {
      results.push(...await Promise.all(pending));
    }
  }

  const allPass = results.every((r) => r.pass);

  // ─── JSON output ──────────────────────────────────────────────────────
  if (jsonOutput) {
    const output = { ok: allPass, checks: results };
    console.log(JSON.stringify(output, null, 2));
    process.exit(allPass ? 0 : 1);
  }

  // ─── Human-readable output ────────────────────────────────────────────
  console.log('');
  console.log(C.bold('Orchestrator Pre-Flight Checks'));
  console.log('');

  for (const r of results) {
    const icon  = r.pass ? C.green('✓') : C.red('✗');
    const label = r.name.padEnd(14);
    const detail = r.pass ? C.dim(r.detail) : C.red(r.detail);
    console.log(`  ${icon} ${label} ${detail}`);
    if (!r.pass && r.fix) {
      console.log(`               ${C.yellow('Fix:')} ${r.fix}`);
    }
  }

  console.log('');
  if (allPass) {
    console.log(C.green('All pre-flight checks passed.'));
  } else {
    const failCount = results.filter((r) => !r.pass).length;
    console.log(C.red(`${failCount} check(s) failed. Resolve the issues above before launching.`));
  }
  console.log('');

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

```
###  Path: `/scripts/publish-locations.js`

```js
/**
 * scripts/publish-locations.js
 *
 * Single source of truth for persona publish locations.
 * Used by sync-personas.js (deploy) and cli.js (clean-agents).
 * Individual path helpers (getClaudeCodeSkillsDir, etc.) are also imported
 * directly by publish-skills.js for skills deployment.
 *
 * Each location defines:
 *   - label:  Human-readable name for display
 *   - dir:    Resolved absolute path to the target directory
 *   - filter: Function to match persona files in that directory
 */

import path from 'path';
import os from 'os';

/**
 * Determine the VS Code User prompts directory based on the platform.
 * @returns {string}
 */
function getVSCodePromptsDir() {
  const platform = os.platform();
  const homeDir = os.homedir();
  switch (platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Code', 'User', 'prompts');
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'prompts');
    case 'linux':
      return path.join(homeDir, '.config', 'Code', 'User', 'prompts');
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Determine the Claude Code agents directory.
 * @returns {string} Path to ~/.claude/agents/
 */
function getClaudeCodeAgentsDir() {
  return path.join(os.homedir(), '.claude', 'agents');
}

/**
 * Determine the Claude Code skills directory.
 * @returns {string} Path to ~/.claude/skills/
 */
function getClaudeCodeSkillsDir() {
  return path.join(os.homedir(), '.claude', 'skills');
}

/**
 * Return all persona publish locations.
 * Adding a new target here automatically makes it available to both
 * sync-personas (deploy) and cli.js clean-agents (cleanup).
 *
 * @returns {Array<{label: string, dir: string, filter: (filename: string) => boolean}>}
 */
function getPublishLocations() {
  return [
    { label: 'VS Code prompts',    dir: getVSCodePromptsDir(),    filter: (f) => f.endsWith('.agent.md') },
    { label: 'Claude Code agents', dir: getClaudeCodeAgentsDir(), filter: (f) => f.endsWith('.md') },
  ];
}

export {
  getVSCodePromptsDir,
  getClaudeCodeAgentsDir,
  getClaudeCodeSkillsDir,
  getPublishLocations,
};

```
###  Path: `/scripts/publish-skills.js`

```js
#!/usr/bin/env node

/**
 * publish-skills.js — deploy built skill files to VS Code and Claude Code locations.
 *
 * Reads built .md files from dist/vscode-skills/ and dist/claude-skills/ and
 * deploys each as {stem}/SKILL.md under:
 *   .github/skills/      (VS Code, workspace-relative)
 *   ~/.claude/skills/    (Claude Code, user-global)
 *
 * Only directories whose stems match build output are cleared before publishing.
 * Hand-written skill directories (e.g. release-check) are never touched.
 *
 * Usage: node scripts/publish-skills.js [--dry-run]
 *   --dry-run  Log what would be deployed without writing any files.
 */

import fs from 'fs';
import path from 'path';
import { getClaudeCodeSkillsDir } from './publish-locations.js';

const ROOT        = path.resolve(import.meta.dirname, '..');
const DIST_VSCODE = path.join(ROOT, 'dist', 'vscode-skills');
const DIST_CLAUDE = path.join(ROOT, 'dist', 'claude-skills');
const GH_SKILLS   = path.join(ROOT, '.github', 'skills');
const CC_SKILLS   = getClaudeCodeSkillsDir();

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Read all .md files from a directory and return an array of { stem, content } objects.
 * Returns an empty array if the directory doesn't exist.
 * @param {string} dir
 * @returns {{ stem: string, content: string }[]}
 */
function readBuiltFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({
      stem:    path.basename(f, '.md'),
      content: fs.readFileSync(path.join(dir, f), 'utf8'),
    }));
}

/**
 * Deploy a skill file to {targetDir}/{stem}/SKILL.md.
 * Clears the {stem}/ directory first (preserving sibling directories not in the build).
 * When dryRun is true, logs what would be deployed without writing any files.
 * @param {string} stem
 * @param {string} content
 * @param {string} targetDir
 * @param {boolean} dryRun
 */
function deploySkill(stem, content, targetDir, dryRun) {
  const destDir  = path.join(targetDir, stem);
  const destFile = path.join(destDir, 'SKILL.md');

  if (dryRun) {
    console.log(`[publish-skills] [dry-run] would deploy → ${destFile}`);
    return;
  }

  // Clear only the stem directory — sibling directories (e.g. release-check) are untouched.
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(destFile, content, 'utf8');
}

// --- Main ---

const vsFiles  = readBuiltFiles(DIST_VSCODE);
const ccFiles  = readBuiltFiles(DIST_CLAUDE);

if (vsFiles.length === 0 && ccFiles.length === 0) {
  console.error('[publish-skills] No built skill files found. Run node scripts/build-skills.js first.');
  process.exit(1);
}

let published = 0;
const errors  = [];

// Deploy VS Code skills (.github/skills/{stem}/SKILL.md)
for (const { stem, content } of vsFiles) {
  try {
    deploySkill(stem, content, GH_SKILLS, DRY_RUN);
    if (!DRY_RUN) console.log(`[publish-skills] VS Code  → .github/skills/${stem}/SKILL.md`);
    published++;
  } catch (err) {
    errors.push(`VS Code / ${stem}: ${err.message}`);
  }
}

// Deploy Claude Code skills (~/.claude/skills/{stem}/SKILL.md)
for (const { stem, content } of ccFiles) {
  try {
    deploySkill(stem, content, CC_SKILLS, DRY_RUN);
    if (!DRY_RUN) console.log(`[publish-skills] Claude   → ${path.join(CC_SKILLS, stem, 'SKILL.md')}`);
    published++;
  } catch (err) {
    errors.push(`Claude Code / ${stem}: ${err.message}`);
  }
}

// Report
if (errors.length > 0) {
  for (const e of errors) console.error(`[publish-skills] ERROR: ${e}`);
  process.exit(1);
}

if (DRY_RUN) {
  console.log(`[publish-skills] ${published} skill file(s) would be published (dry-run).`);
} else {
  console.log(`[publish-skills] ${published} skill file(s) published.`);
}

```
###  Path: `/scripts/read-log.js`

```js
#!/usr/bin/env node

/**
 * scripts/read-log.js
 *
 * Structured, cross-platform reader for orchestrator JSONL run logs.
 * Replaces ad-hoc jq/grep pipelines with simple flag-based queries.
 *
 * Usage:
 *   node scripts/read-log.js                        Last 20 entries, most recent log
 *   node scripts/read-log.js --errors               Only ERROR + WARNING entries
 *   node scripts/read-log.js --actions route        Filter by action type(s)
 *   node scripts/read-log.js --wp WP-003            Filter to a specific WP
 *   node scripts/read-log.js --summary              One-line run overview
 *   node scripts/read-log.js --slug my-project      Target latest log matching slug
 *   node scripts/read-log.js --file path/to/log     Explicit log file
 *   node scripts/read-log.js --format json          JSON array output
 *   node scripts/read-log.js --help                 Show this help
 *
 * No external dependencies — stdlib only (fs, path).
 */

import fs from 'fs';
import path from 'path';

// ─── Paths ────────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');
const LOGS_DIR       = path.join(WORKSPACE_ROOT, 'orchestrator', 'logs');

// ─── ANSI colors (disabled when stdout is not a TTY) ─────────────────────────

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
Usage: node scripts/read-log.js [options]

Query and filter orchestrator JSONL run logs.

Log Selection:
  (default)           Most recent .jsonl file in orchestrator/logs/
  --slug <name>       Latest log whose filename ends with -<name>.jsonl
  --file <path>       Explicit log file path (absolute or relative to workspace root)

Filtering:
  --last <n>          Show last N entries (default: 20 when no other filter is set)
  --actions <types>   Filter by action type(s), comma-separated
                      e.g. --actions route,stage_complete
  --level <levels>    Filter by log level(s), comma-separated (case-insensitive)
                      e.g. --level ERROR,WARNING
  --errors            Shorthand for --level ERROR,WARNING
  --wp <id>           Filter to a specific work package, e.g. --wp WP-003
  --summary           Print one-line run overview with token totals

Output:
  --format text       Human-readable colored output (default)
  --format json       Raw JSON array to stdout (for piping)

  --help, -h          Show this help text

Examples:
  node scripts/read-log.js
  node scripts/read-log.js --last 50
  node scripts/read-log.js --errors
  node scripts/read-log.js --actions route
  node scripts/read-log.js --actions stage_start,stage_complete
  node scripts/read-log.js --wp WP-003
  node scripts/read-log.js --summary
  node scripts/read-log.js --slug my-project-slug
  node scripts/read-log.js --errors --format json
  node scripts/read-log.js --file orchestrator/logs/20260324T142851-my-run.jsonl
`;

// ─── Argument parser ──────────────────────────────────────────────────────────

/**
 * Minimal CLI arg parser — no external dependencies.
 * Supports both `--flag value` and `--flag=value` forms.
 *
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {{
 *   last: number|null,
 *   actions: string[]|null,
 *   level: string[]|null,
 *   errors: boolean,
 *   wp: string|null,
 *   summary: boolean,
 *   slug: string|null,
 *   file: string|null,
 *   format: string,
 *   help: boolean,
 * }}
 */
function parseArgs(argv) {
  const opts = {
    last:    null,
    actions: null,
    level:   null,
    errors:  false,
    wp:      null,
    summary: false,
    slug:    null,
    file:    null,
    format:  'text',
    help:    false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    // ── boolean flags ──
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--errors')    { opts.errors = true; continue; }
    if (a === '--summary')   { opts.summary = true; continue; }

    // ── value flags — support both --flag val and --flag=val ──
    const eq = a.indexOf('=');
    const key = eq === -1 ? a         : a.slice(0, eq);
    const val = eq === -1 ? argv[++i] : a.slice(eq + 1);

    switch (key) {
      case '--last':
        { const n = parseInt(val, 10); if (!isNaN(n) && n > 0) opts.last = n; break; }
      case '--actions':
        opts.actions = val.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--level':
        opts.level = val.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
        break;
      case '--wp':
        opts.wp = val;
        break;
      case '--slug':
        opts.slug = val;
        break;
      case '--file':
        opts.file = val;
        break;
      case '--format':
        opts.format = val.toLowerCase();
        break;
      default:
        // unknown flag — ignore silently
        if (eq === -1) i--; // undo argv[++i] that consumed the next element as val
        break;
    }
  }

  return opts;
}

// ─── Log discovery ────────────────────────────────────────────────────────────

/**
 * Return sorted list of .jsonl file paths from the logs directory.
 * Alphabetical sort = chronological (filenames start with YYYYMMDDTHHmmSS).
 *
 * @param {string} logsDir
 * @returns {string[]}
 */
function discoverLogs(logsDir) {
  if (!fs.existsSync(logsDir)) return [];
  return fs
    .readdirSync(logsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => path.join(logsDir, f));
}

// ─── JSONL parser ─────────────────────────────────────────────────────────────

/**
 * Parse every line of a JSONL file, silently skipping malformed lines.
 *
 * @param {string} filePath
 * @returns {object[]}
 */
function parseJsonl(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      entries.push(JSON.parse(t));
    } catch {
      // malformed line — skip silently
    }
  }
  return entries;
}

// ─── Filtering ────────────────────────────────────────────────────────────────

/**
 * Apply filter flags to an array of parsed log entries.
 * --last is applied last (tail semantics).
 *
 * @param {object[]} entries
 * @param {object} opts  parsed args
 * @returns {object[]}
 */
function applyFilters(entries, opts) {
  let result = entries;

  // --wp
  if (opts.wp) {
    result = result.filter((e) => e.wp_id === opts.wp);
  }

  // --actions
  if (opts.actions) {
    const set = new Set(opts.actions);
    result = result.filter((e) => set.has(e.action));
  }

  // --level / --errors
  const levels = opts.errors
    ? new Set(['ERROR', 'WARNING'])
    : opts.level ? new Set(opts.level) : null;
  if (levels) {
    result = result.filter((e) => levels.has((e.level || 'INFO').toUpperCase()));
  }

  // --last N (default 20 when no other filter is active)
  const noActiveFilter = !opts.wp && !opts.actions && !levels;
  const lastN = opts.last !== null
    ? opts.last
    : (noActiveFilter ? 20 : null);
  if (lastN !== null) {
    result = result.slice(-lastN);
  }

  return result;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/**
 * Format a duration in seconds as a human-readable string.
 * Matches orchestrator/src/utils/logging.py::_format_duration()
 *
 * @param {number|null|undefined} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '';
  const secs = Math.round(seconds);
  if (secs < 60) return `${secs}s`;
  const minutes = Math.floor(secs / 60);
  const remSecs  = secs % 60;
  if (minutes < 60) return `${minutes}m ${remSecs}s`;
  const hours   = Math.floor(minutes / 60);
  const remMins = minutes % 60;
  return `${hours}h ${remMins}m`;
}

/**
 * Extract HH:MM:SS from an ISO 8601 timestamp string.
 *
 * @param {string|undefined} ts
 * @returns {string}
 */
function formatTime(ts) {
  if (!ts) return '??:??:??';
  try {
    return new Date(ts).toISOString().slice(11, 19);
  } catch {
    return '??:??:??';
  }
}

/**
 * Format a number with comma-separated thousands (cross-platform).
 *
 * @param {number} n
 * @returns {string}
 */
function numFmt(n) {
  const s = String(Math.round(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ─── Text entry formatter ─────────────────────────────────────────────────────

/**
 * Format a single log entry as one human-readable line.
 *
 * Pattern:  HH:MM:SS [stage] WP-NNN action → result (duration, tokens)
 *
 * @param {object} entry
 * @returns {string}
 */
function formatEntry(entry) {
  const time   = formatTime(entry.timestamp);
  const stage  = entry.stage  || '—';
  const wpId   = entry.wp_id  || '';
  const action = entry.action || '?';
  const result = entry.result || '';
  const level  = (entry.level || 'INFO').toUpperCase();

  const stageStr = C.cyan(`[${stage}]`);
  const parts = [`${time} ${stageStr}`];

  if (wpId) parts.push(wpId);
  parts.push(action);

  if (result) {
    const arrow = result === 'PASS' ? C.green(`→ ${result}`) : C.red(`→ ${result}`);
    parts.push(arrow);
  }

  // Detail: duration + tokens
  const details = [];
  if (entry.duration_s !== null && entry.duration_s !== undefined) {
    const d = formatDuration(entry.duration_s);
    if (d) details.push(d);
  }
  if (entry.tokens_used && typeof entry.tokens_used === 'object') {
    const t = entry.tokens_used.total_tokens;
    if (t) details.push(`${numFmt(t)} tokens`);
  }
  if (details.length > 0) parts.push(`(${details.join(', ')})`);

  // Model tag for stage_start (mirrors logging.py _build_stream_console_line)
  if (action === 'stage_start' && entry.model) {
    parts.push(C.dim(`[${entry.model}]`));
  }

  let line = parts.filter(Boolean).join(' ');

  // Level-based coloring (applied to whole line)
  if (level === 'ERROR')   return C.red(line);
  if (level === 'WARNING') return C.yellow(line);
  return line;
}

// ─── Summary mode ─────────────────────────────────────────────────────────────

/**
 * Build the one-line run summary from the full entries array.
 *
 * Format: Run: <ts> | Duration: <d> | WPs: N (x complete, ...) |
 *         Result: <r> | Tokens: N (in: N / out: N) | Errors: N | Warnings: N
 *
 * @param {object[]} entries
 * @returns {string}
 */
function buildSummary(entries) {
  const runStart        = entries.find((e) => e.action === 'run_start');
  const runEnd          = entries.find((e) => e.action === 'run_end');
  const progressEntries = entries.filter((e) => e.action === 'progress_snapshot');
  const lastProgress    = progressEntries[progressEntries.length - 1];

  // Token totals from all stage_complete entries
  let tokenIn = 0, tokenOut = 0, hasTokens = false;
  for (const e of entries) {
    if (e.action === 'stage_complete' && e.tokens_used) {
      tokenIn  += e.tokens_used.input_tokens  || 0;
      tokenOut += e.tokens_used.output_tokens || 0;
      hasTokens = true;
    }
  }

  // Error / warning counts
  let errorCount = 0, warnCount = 0;
  for (const e of entries) {
    const lvl = (e.level || '').toUpperCase();
    if (lvl === 'ERROR')   errorCount++;
    else if (lvl === 'WARNING') warnCount++;
  }

  const parts = [];

  // Run timestamp
  const ts = runStart?.run_start_ts || runStart?.timestamp;
  if (ts) parts.push(`Run: ${ts}`);

  // Duration
  const totalDur = runEnd?.total_duration_s;
  if (totalDur !== undefined && totalDur !== null) {
    parts.push(`Duration: ${formatDuration(totalDur)}`);
  } else if (lastProgress?.elapsed_s !== undefined) {
    parts.push(`Elapsed: ${formatDuration(lastProgress.elapsed_s)}`);
  }

  // WP counts
  if (lastProgress) {
    const total     = lastProgress.total_wps || 0;
    const breakdown = lastProgress.status_breakdown || {};
    const complete  = breakdown.COMPLETE    || 0;
    const inProg    = breakdown.IN_PROGRESS || 0;
    const ready     = breakdown.READY       || 0;
    const detail    = [];
    if (complete) detail.push(`${complete} complete`);
    if (inProg)   detail.push(`${inProg} in-progress`);
    if (ready)    detail.push(`${ready} ready`);
    parts.push(`WPs: ${total}${detail.length ? ` (${detail.join(', ')})` : ''}`);
  }

  // Result
  const result = runEnd?.result || (runEnd ? 'COMPLETE' : 'IN_PROGRESS');
  parts.push(`Result: ${result}`);

  // Tokens
  if (hasTokens) {
    const total = tokenIn + tokenOut;
    parts.push(`Tokens: ${numFmt(total)} (in: ${numFmt(tokenIn)} / out: ${numFmt(tokenOut)})`);
  }

  parts.push(`Errors: ${errorCount}`);
  parts.push(`Warnings: ${warnCount}`);

  return parts.join(' | ');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  // ── Resolve log file ──
  let filePath;

  if (opts.file) {
    filePath = path.isAbsolute(opts.file)
      ? opts.file
      : path.resolve(WORKSPACE_ROOT, opts.file);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
  } else {
    const allLogs = discoverLogs(LOGS_DIR);
    if (allLogs.length === 0) {
      console.error(`No log files found in ${LOGS_DIR}`);
      process.exit(1);
    }

    if (opts.slug) {
      const suffix = `-${opts.slug}.jsonl`;
      const matched = allLogs.filter((f) => path.basename(f).endsWith(suffix));
      if (matched.length === 0) {
        console.error(`No log files found matching slug: ${opts.slug}`);
        process.exit(1);
      }
      filePath = matched[matched.length - 1]; // latest among matches
    } else {
      filePath = allLogs[allLogs.length - 1]; // latest overall
    }
  }

  // ── Parse JSONL ──
  let entries;
  try {
    entries = parseJsonl(filePath);
  } catch (err) {
    console.error(`Failed to read log file: ${err.message}`);
    process.exit(1);
  }

  // ── Summary mode ──
  if (opts.summary) {
    console.log(buildSummary(entries));
    process.exit(0);
  }

  // ── Apply filters ──
  const filtered = applyFilters(entries, opts);

  // ── Output ──
  if (opts.format === 'json') {
    console.log(JSON.stringify(filtered, null, 2));
  } else {
    // Print a dim header showing which file is being read.
    // Use relative path when the file is inside the workspace, absolute otherwise.
    const rel = path.relative(WORKSPACE_ROOT, filePath);
    const displayPath = rel.startsWith('..') ? filePath : rel;
    console.log(C.dim(`Log: ${displayPath}\n`));

    if (filtered.length === 0) {
      console.log(C.dim('(no entries match the filter)'));
    } else {
      for (const entry of filtered) {
        console.log(formatEntry(entry));
      }
    }
  }

  process.exit(0);
}

main();

```
###  Path: `/scripts/run-gui.js`

```js
#!/usr/bin/env node

/**
 * run-gui.js
 *
 * Launches the MCP GUI server from the workspace root and opens the default
 * browser once the server is ready.
 * Delegates to `tsx gui/server.ts` inside mcp-server/.
 *
 * Usage (from workspace root):
 *   node scripts/run-gui.js
 *   node scripts/run-gui.js -- --port 3460
 *   node scripts/run-gui.js -- --port 3460 --ledger-dir "C:\path\to\ledger"
 *
 * Port convention:
 *   3420 — LIVE workspace (default; reserved for the production MCP server used in workflows)
 *   3460 — DEV workspace / feature branch (use this when working on the codebase)
 *
 * CLI arguments after `--` are forwarded to the GUI server process.
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';

const MCP_SERVER_DIR = path.resolve(import.meta.dirname, '..', 'mcp-server');

// Collect args to forward: everything after a bare `--` separator, or all
// extra args if no separator is present.
const separatorIndex = process.argv.indexOf('--');
const forwardedArgs =
  separatorIndex !== -1 ? process.argv.slice(separatorIndex + 1) : process.argv.slice(2);

// Derive the port from forwarded args so we can open the right URL.
const portFlagIndex = forwardedArgs.indexOf('--port');
const port =
  portFlagIndex !== -1 && forwardedArgs[portFlagIndex + 1]
    ? parseInt(forwardedArgs[portFlagIndex + 1], 10)
    : 3420;
const guiUrl = `http://localhost:${port}`;

const isWindows = process.platform === 'win32';

// Open the system's default browser (cross-platform).
function openBrowser(url) {
  const isMac = process.platform === 'darwin';
  if (isWindows) {
    // Use cmd /c start so we never need to locate an executable.
    spawn('cmd', ['/c', 'start', '""', url], { shell: false, stdio: 'ignore', detached: true }).unref();
  } else {
    const cmd = isMac ? 'open' : 'xdg-open';
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  }
}

// Build the command: `npx tsx gui/server.ts [...forwardedArgs]`
// On Windows .cmd files must be run through the shell.
const child = spawn('npx', ['tsx', 'gui/server.ts', ...forwardedArgs], {
  cwd: MCP_SERVER_DIR,
  stdio: ['inherit', 'pipe', 'inherit'],
  shell: isWindows,
});

// Watch stdout for the ready message, then pass all lines through to the
// parent terminal as normal.
let browserOpened = false;
const rl = createInterface({ input: child.stdout });

rl.on('line', (line) => {
  process.stdout.write(line + '\n');
  if (!browserOpened && line.includes('GUI dashboard running at')) {
    browserOpened = true;
    console.log(`[run-gui] Opening ${guiUrl} in your default browser…`);
    openBrowser(guiUrl);
  }
});

child.on('error', (err) => {
  console.error(`[run-gui] Failed to start GUI server: ${err.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

```
###  Path: `/scripts/run-orchestrator.js`

```js
#!/usr/bin/env node

/**
 * run-orchestrator.js
 *
 * Pre-flight dist freshness guard + orchestrate launcher.
 *
 * Checks whether mcp-server/dist/ is up to date relative to mcp-server/src/.
 * Rebuilds via `npm run build` when any source file is newer than the compiled
 * output sentinel (dist/index.js), or when dist/ does not yet exist, then
 * delegates to the `orchestrate` CLI with all supplied arguments.
 *
 * Usage (from workspace root):
 *   node scripts/run-orchestrator.js [orchestrate options…]
 *   node scripts/run-orchestrator.js path/to/plan.md --dry-run
 *
 * Replaces orchestrator/run.sh for cross-platform (macOS, Linux, Windows)
 * compatibility.
 */

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// 1. Resolve paths
// ---------------------------------------------------------------------------
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');
const MCP_SRC       = path.join(WORKSPACE_ROOT, 'mcp-server', 'src');
const MCP_DIST_SENTINEL = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist', 'index.js');

// ---------------------------------------------------------------------------
// 2. Determine whether a rebuild is needed
//    Walk mcp-server/src/ recursively; compare each file's mtime against the
//    sentinel's mtime.  Any src file newer than the sentinel → stale build.
// ---------------------------------------------------------------------------

/**
 * Recursively collect mtimeMs of every file under `dir`.
 * Returns the largest mtime found (i.e. the most recently modified file's
 * timestamp), or -Infinity when the directory is empty.
 *
 * @param {string} dir
 * @returns {number}
 */
function latestMtime(dir) {
  let latest = -Infinity;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestMtime(full));
    } else if (entry.isFile()) {
      latest = Math.max(latest, fs.statSync(full).mtimeMs);
    }
  }
  return latest;
}

let needBuild = false;

if (!fs.existsSync(MCP_DIST_SENTINEL)) {
  needBuild = true;
} else {
  const sentinelMtime = fs.statSync(MCP_DIST_SENTINEL).mtimeMs;
  if (latestMtime(MCP_SRC) > sentinelMtime) {
    needBuild = true;
  }
}

// ---------------------------------------------------------------------------
// 3. Rebuild when necessary
// ---------------------------------------------------------------------------
const isWindows = process.platform === 'win32';
const npmCmd    = isWindows ? 'npm.cmd' : 'npm';

if (needBuild) {
  console.log('[run-orchestrator.js] mcp-server/dist is stale or missing — building MCP server...');
  const build = spawnSync(npmCmd, ['run', 'build'], {
    cwd:   path.join(WORKSPACE_ROOT, 'mcp-server'),
    stdio: 'inherit',
    shell: isWindows, // npm.cmd requires shell:true on Windows/Node22+ to avoid EINVAL
  });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
} else {
  console.log('[run-orchestrator.js] mcp-server/dist is up to date — skipping build.');
}

// ---------------------------------------------------------------------------
// 4. Launch the orchestrator, forwarding all arguments verbatim
// ---------------------------------------------------------------------------
const forwardedArgs = process.argv.slice(2);

// ---------------------------------------------------------------------------
// 5. Remind the caller about companion scripts
// ---------------------------------------------------------------------------
console.log('');
console.log('[run-orchestrator.js] Companion scripts available while the orchestrator is running:');
console.log('  Read logs  →  node scripts/read-log.js <path/to/log.jsonl>');
console.log('               (alias: node scripts/cli.js read-log <path/to/log.jsonl>)');
console.log('  Kill stale →  node scripts/kill-orchestrator.js');
console.log('               (alias: node scripts/cli.js kill-orchestrator)');
  console.log('  TIP: Prefer using read-log.js over native command line tools to read logs —');
console.log('       it understands the JSONL format.');
console.log('');

// Resolve the orchestrate binary from the local venv to avoid picking up a
// stale system-wide install via $PATH.  Python venv uses "Scripts" on Windows
// and "bin" elsewhere; the binary is "orchestrate.exe" on Windows.
const venvBin = process.platform === 'win32' ? 'Scripts' : 'bin';
const orchestrateCmd = path.join(WORKSPACE_ROOT, 'orchestrator', '.venv', venvBin, 'orchestrate');
const result = spawnSync(orchestrateCmd, forwardedArgs, {
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, PYTHONUTF8: '1' },
});

process.exit(result.status ?? 1);

```
###  Path: `/scripts/sync-personas.js`

```js
#!/usr/bin/env node

/**
 * sync-personas.js
 *
 * Builds persona files from source templates and copies them to each IDE's
 * agent/prompt directory.
 *
 * Usage:
 *   node scripts/sync-personas.js
 *   node scripts/sync-personas.js --target vscode         # VS Code only
 *   node scripts/sync-personas.js --target claude-code    # Claude Code only
 *   node scripts/sync-personas.js --dry-run               # Preview without copying
 *   node scripts/sync-personas.js --custom-path "C:\Custom\Path"  # Custom VS Code prompts dir
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { getVSCodePromptsDir, getClaudeCodeAgentsDir, getClaudeCodeSkillsDir } from './publish-locations.js';

// Role names are loaded from the shared workflow manifest — the single source
// of truth for all agent roles across the workspace.
const KNOWN_ROLES = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../shared/workflow-manifest.json'), 'utf-8')
).roles.map(r => r.name);

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

/**
 * Extract the VS File Name from a persona file's YAML frontmatter (vs_file_name field).
 * @param {string} filePath - Path to the persona file
 * @returns {string|null} - The VS File Name or null if not found
 */
function extractVSFileName(filePath) {
  const fields = parseFrontmatter(filePath);
  return fields?.vs_file_name || null;
}

/**
 * Extract the Claude Code deployment filename from a CC persona file's YAML
 * frontmatter. Uses the `name` field and appends `.md`.
 * @param {string} filePath - Path to the persona file
 * @returns {string|null} - e.g. "1-planner.md" or null if not found
 */
function extractCCFileName(filePath) {
  const fields = parseFrontmatter(filePath);
  return fields?.name ? fields.name.trim() + '.md' : null;
}

/**
 * Parse YAML frontmatter fields from a persona file into a plain object.
 * Returns null if the file has no valid YAML frontmatter block.
 * @param {string} filePath
 * @returns {Object|null}
 */
function parseFrontmatter(filePath) {
  try {
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const content = rawContent.startsWith('<!--') ? rawContent.slice(rawContent.indexOf('\n') + 1) : rawContent;
    if (!content.startsWith('---')) return null;
    const afterFirst = content.slice(3);
    const closingIdx = afterFirst.indexOf('\n---');
    if (closingIdx === -1) return null;
    const fields = {};
    for (const line of afterFirst.slice(0, closingIdx).split('\n')) {
      const m = line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (m) fields[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return fields;
  } catch {
    return null;
  }
}

/**
 * Validate VS Code persona frontmatter: requires role (in KNOWN_ROLES),
 * name, vs_file_name, id, and model fields.
 * @param {string} dir - Absolute path to personas/ledger/vs-code/
 */
function validateVSCodeFrontmatter(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== VS Code Frontmatter Validation ===${colors.reset}`);

  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join('ledger', 'vs-code', file);

    if (!fields) {
      console.warn(`${colors.yellow}⚠ ${relPath}: could not parse frontmatter${colors.reset}`);
      warningCount++;
      continue;
    }

    if (!fields.role) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'role:' field${colors.reset}`);
      warningCount++;
    } else if (!KNOWN_ROLES.includes(fields.role)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: unknown role "${fields.role}". Expected: ${KNOWN_ROLES.join(', ')}${colors.reset}`);
      warningCount++;
    }

    if (!fields.name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'name:' field${colors.reset}`);
      warningCount++;
    }

    if (!fields.vs_file_name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'vs_file_name:' field${colors.reset}`);
      warningCount++;
    }

    if (!fields.id) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'id:' field${colors.reset}`);
      warningCount++;
    }

    if (!fields.model) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'model:' field${colors.reset}`);
      warningCount++;
    }
  }

  if (warningCount === 0) {
    console.log(`${colors.green}✓ All ${files.length} VS Code persona file(s) passed frontmatter validation${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${warningCount} frontmatter warning(s) found — sync was not blocked${colors.reset}`);
  }
}

/**
 * Validate Claude Code persona frontmatter: requires name (kebab-case with
 * numeric prefix), role (in KNOWN_ROLES), permissionMode, model, and memory.
 * @param {string} dir - Absolute path to personas/ledger/claude-code/
 */
function validateCCFrontmatter(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== Claude Code Frontmatter Validation ===${colors.reset}`);

  const CC_NAME_RE = /^\d-[a-z][a-z0-9-]*$/;
  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join('ledger', 'claude-code', file);

    if (!fields) {
      console.warn(`${colors.yellow}⚠ ${relPath}: could not parse frontmatter${colors.reset}`);
      warningCount++;
      continue;
    }

    // name: must be present and match N-kebab-case
    if (!fields.name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'name:' field${colors.reset}`);
      warningCount++;
    } else if (!CC_NAME_RE.test(fields.name)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: 'name: ${fields.name}' does not match N-kebab-case pattern (e.g. "1-planner")${colors.reset}`);
      warningCount++;
    }

    // role: must be present and in KNOWN_ROLES
    if (!fields.role) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'role:' field${colors.reset}`);
      warningCount++;
    } else if (!KNOWN_ROLES.includes(fields.role)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: unknown role "${fields.role}". Expected: ${KNOWN_ROLES.join(', ')}${colors.reset}`);
      warningCount++;
    }

    // permissionMode, model, memory: must be present strings
    for (const requiredField of ['permissionMode', 'model', 'memory']) {
      if (!fields[requiredField]) {
        console.warn(`${colors.yellow}⚠ ${relPath}: missing '${requiredField}:' field${colors.reset}`);
        warningCount++;
      }
    }
  }

  if (warningCount === 0) {
    console.log(`${colors.green}✓ All ${files.length} Claude Code persona file(s) passed frontmatter validation${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${warningCount} frontmatter warning(s) found — sync was not blocked${colors.reset}`);
  }
}

/**
 * Validate Claude Code frontmatter for slug-mode personas: requires name
 * (kebab-case without numeric prefix), permissionMode, model, and memory.
 * Slug-mode personas do not require a 'role' field.
 * @param {string} dir - Absolute path to personas/{suite}/claude-code/
 * @param {string} suiteLabel - Suite name for display (e.g. 'standalone', 'ledger-support')
 */
function validateSlugModeCCFrontmatter(dir, suiteLabel) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== ${suiteLabel} Claude Code Frontmatter Validation ===${colors.reset}`);

  const SLUG_NAME_RE = /^[a-z][a-z0-9-]*$/;
  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join(suiteLabel, 'claude-code', file);

    if (!fields) {
      console.warn(`${colors.yellow}⚠ ${relPath}: could not parse frontmatter${colors.reset}`);
      warningCount++;
      continue;
    }

    // name: must be present and match kebab-case (no numeric prefix)
    if (!fields.name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'name:' field${colors.reset}`);
      warningCount++;
    } else if (!SLUG_NAME_RE.test(fields.name)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: 'name: ${fields.name}' does not match kebab-case pattern (e.g. "manifest-curator")${colors.reset}`);
      warningCount++;
    }

    // permissionMode, model, memory: must be present strings
    for (const requiredField of ['permissionMode', 'model', 'memory']) {
      if (!fields[requiredField]) {
        console.warn(`${colors.yellow}⚠ ${relPath}: missing '${requiredField}:' field${colors.reset}`);
        warningCount++;
      }
    }
  }

  if (warningCount === 0) {
    console.log(`${colors.green}✓ All ${files.length} ${suiteLabel} Claude Code persona file(s) passed frontmatter validation${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${warningCount} frontmatter warning(s) found — sync was not blocked${colors.reset}`);
  }
}

/**
 * Generic helper: copy persona files from sourceDir to targetDir using the
 * provided filename-extraction function.
 *
 * @param {string} sourceDir - Directory containing built persona .md files
 * @param {string} targetDir - Destination directory on the system
 * @param {Function} extractFileNameFn - Returns the target filename given a file path
 * @param {string} label - Human-readable label for console output (e.g. "VS Code")
 * @param {boolean} dryRun - If true, preview only; no files are written
 */
function syncFromDir(sourceDir, targetDir, extractFileNameFn, label, dryRun = false) {
  if (!fs.existsSync(sourceDir)) {
    console.error(`${colors.red}Error: Source directory not found: ${sourceDir}${colors.reset}`);
    process.exit(1);
  }

  const personaFiles = fs.readdirSync(sourceDir)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(sourceDir, f));

  console.log(`${colors.bright}${colors.cyan}=== ${label} Persona Sync ===${colors.reset}\n`);
  console.log(`${colors.blue}Source:${colors.reset} ${sourceDir}`);
  console.log(`${colors.blue}Target:${colors.reset} ${targetDir}`);
  console.log(`${colors.blue}Mode:${colors.reset} ${dryRun ? 'DRY RUN (preview only)' : 'COPY'}\n`);

  if (!dryRun && !fs.existsSync(targetDir)) {
    console.log(`${colors.yellow}Creating target directory: ${targetDir}${colors.reset}\n`);
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let copiedCount = 0;
  let skippedCount = 0;

  for (const filePath of personaFiles) {
    const deployName = extractFileNameFn(filePath);
    const relSrc = path.relative(path.join(import.meta.dirname, '..'), filePath);

    if (!deployName) {
      console.log(`${colors.yellow}⊘ Skipped:${colors.reset} ${relSrc} ${colors.yellow}(no deployable filename in frontmatter)${colors.reset}`);
      skippedCount++;
      continue;
    }

    // Guard: skip stale artifact files whose own filename doesn't match the
    // declared deploy name. This prevents old plain .md files (legacy build
    // output) from overwriting the correct .agent.md files they share a
    // vs_file_name with.
    const srcBasename = path.basename(filePath);
    if (srcBasename !== deployName) {
      console.log(`${colors.yellow}⊘ Skipped:${colors.reset} ${relSrc} ${colors.yellow}(filename mismatch: source "${srcBasename}" vs deploy target "${deployName}" — stale artifact)${colors.reset}`);
      skippedCount++;
      continue;
    }

    const targetPath = path.join(targetDir, deployName);

    if (dryRun) {
      console.log(`${colors.cyan}→ Would copy:${colors.reset} ${relSrc} ${colors.cyan}→${colors.reset} ${deployName}`);
      copiedCount++;
    } else {
      try {
        fs.copyFileSync(filePath, targetPath);
        console.log(`${colors.green}✓ Copied:${colors.reset} ${relSrc} ${colors.green}→${colors.reset} ${deployName}`);
        copiedCount++;
      } catch (error) {
        console.error(`${colors.red}✗ Error copying ${relSrc}:${colors.reset}`, error.message);
        skippedCount++;
      }
    }
  }

  console.log(`\n${colors.bright}${colors.cyan}=== Summary ===${colors.reset}`);
  console.log(`${colors.green}${dryRun ? 'Would copy' : 'Copied'}:${colors.reset} ${copiedCount} file(s)`);
  console.log(`${colors.yellow}Skipped:${colors.reset} ${skippedCount} file(s)`);

  if (dryRun) {
    console.log(`\n${colors.yellow}This was a dry run. Run without --dry-run to actually copy files.${colors.reset}`);
  }
}

/**
 * Sync VS Code personas: personas/ledger/vs-code/ → VS Code prompts directory.
 * @param {boolean} dryRun
 * @param {string|null} customPath - Override the default VS Code prompts directory
 */
function syncVSCode(dryRun = false, customPath = null) {
  const sourceDir = path.join(import.meta.dirname, '..', 'personas', 'ledger', 'vs-code');
  const targetDir = customPath || getVSCodePromptsDir();
  syncFromDir(sourceDir, targetDir, extractVSFileName, 'VS Code', dryRun);
  validateVSCodeFrontmatter(sourceDir);
}

/**
 * Validate VS Code frontmatter for slug-mode personas: requires name and
 * vs_file_name. Slug-mode personas do not require a 'role' field.
 * @param {string} dir - Absolute path to personas/{suite}/vs-code/
 * @param {string} suiteLabel - Suite name for display (e.g. 'standalone', 'ledger-support')
 */
function validateSlugModeVSCodeFrontmatter(dir, suiteLabel) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== ${suiteLabel} VS Code Frontmatter Validation ===${colors.reset}`);

  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join(suiteLabel, 'vs-code', file);

    if (!fields) {
      console.warn(`${colors.yellow}⚠ ${relPath}: could not parse frontmatter${colors.reset}`);
      warningCount++;
      continue;
    }

    if (!fields.name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'name:' field${colors.reset}`);
      warningCount++;
    }

    if (!fields.vs_file_name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'vs_file_name:' field${colors.reset}`);
      warningCount++;
    }

    if (!fields.id) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'id:' field${colors.reset}`);
      warningCount++;
    }
  }

  if (warningCount === 0) {
    console.log(`${colors.green}✓ All ${files.length} ${suiteLabel} VS Code persona file(s) passed frontmatter validation${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${warningCount} frontmatter warning(s) found — sync was not blocked${colors.reset}`);
  }
}

/**
 * Sync standalone VS Code personas: personas/standalone/vs-code/ → VS Code prompts directory.
 * @param {boolean} dryRun
 * @param {string|null} customPath - Override the default VS Code prompts directory
 */
function syncStandaloneVSCode(dryRun = false, customPath = null) {
  const sourceDir = path.join(import.meta.dirname, '..', 'personas', 'standalone', 'vs-code');
  const targetDir = customPath || getVSCodePromptsDir();
  syncFromDir(sourceDir, targetDir, extractVSFileName, 'Standalone VS Code', dryRun);
  validateSlugModeVSCodeFrontmatter(sourceDir, 'standalone');
}

/**
 * Sync ledger-support VS Code personas: personas/ledger-support/vs-code/ → VS Code prompts directory.
 * @param {boolean} dryRun
 * @param {string|null} customPath - Override the default VS Code prompts directory
 */
function syncLedgerSupportVSCode(dryRun = false, customPath = null) {
  const sourceDir = path.join(import.meta.dirname, '..', 'personas', 'ledger-support', 'vs-code');
  const targetDir = customPath || getVSCodePromptsDir();
  syncFromDir(sourceDir, targetDir, extractVSFileName, 'Ledger Support VS Code', dryRun);
  validateSlugModeVSCodeFrontmatter(sourceDir, 'ledger-support');
}

/**
 * Sync Claude Code personas: personas/ledger/claude-code/ → ~/.claude/agents/.
 * @param {boolean} dryRun
 */
function syncClaudeCode(dryRun = false) {
  const sourceDir = path.join(import.meta.dirname, '..', 'personas', 'ledger', 'claude-code');
  const targetDir = getClaudeCodeAgentsDir();
  syncFromDir(sourceDir, targetDir, extractCCFileName, 'Claude Code', dryRun);
  validateCCFrontmatter(sourceDir);
}

/**
 * Sync standalone Claude Code personas: personas/standalone/claude-code/ → ~/.claude/agents/.
 * @param {boolean} dryRun
 */
function syncStandaloneClaudeCode(dryRun = false) {
  const sourceDir = path.join(import.meta.dirname, '..', 'personas', 'standalone', 'claude-code');
  const targetDir = getClaudeCodeAgentsDir();
  syncFromDir(sourceDir, targetDir, extractCCFileName, 'Standalone Claude Code', dryRun);
  validateSlugModeCCFrontmatter(sourceDir, 'standalone');
}

/**
 * Sync ledger-support Claude Code personas: personas/ledger-support/claude-code/ → ~/.claude/agents/.
 * @param {boolean} dryRun
 */
function syncLedgerSupportClaudeCode(dryRun = false) {
  const sourceDir = path.join(import.meta.dirname, '..', 'personas', 'ledger-support', 'claude-code');
  const targetDir = getClaudeCodeAgentsDir();
  syncFromDir(sourceDir, targetDir, extractCCFileName, 'Ledger Support Claude Code', dryRun);
  validateSlugModeCCFrontmatter(sourceDir, 'ledger-support');
}

/**
 * Sync Claude Code skills: .claude/skills/ → ~/.claude/skills/.
 * Copies all .md files from the local project skills directory to the global
 * Claude Code skills directory, making them available in any project.
 * @param {boolean} dryRun
 */
function syncSkills(dryRun = false) {
  const sourceDir = path.join(import.meta.dirname, '..', '.claude', 'skills');
  const targetDir = getClaudeCodeSkillsDir();

  if (!fs.existsSync(sourceDir)) {
    console.log(`${colors.yellow}⊘ No local skills directory found at ${sourceDir} — skipping skill sync${colors.reset}`);
    return;
  }

  const skillFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith('.md'));

  if (skillFiles.length === 0) {
    console.log(`${colors.yellow}⊘ No skill files found in ${sourceDir} — skipping skill sync${colors.reset}`);
    return;
  }

  console.log(`${colors.bright}${colors.cyan}=== Claude Code Skills Sync ===${colors.reset}\n`);
  console.log(`${colors.blue}Source:${colors.reset} ${sourceDir}`);
  console.log(`${colors.blue}Target:${colors.reset} ${targetDir}`);
  console.log(`${colors.blue}Mode:${colors.reset} ${dryRun ? 'DRY RUN (preview only)' : 'COPY'}\n`);

  if (!dryRun && !fs.existsSync(targetDir)) {
    console.log(`${colors.yellow}Creating target directory: ${targetDir}${colors.reset}\n`);
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let copiedCount = 0;
  let skippedCount = 0;

  for (const file of skillFiles) {
    const srcPath = path.join(sourceDir, file);
    const relSrc = path.join('.claude', 'skills', file);

    if (dryRun) {
      console.log(`${colors.cyan}→ Would copy:${colors.reset} ${relSrc} ${colors.cyan}→${colors.reset} ${file}`);
      copiedCount++;
    } else {
      try {
        fs.copyFileSync(srcPath, path.join(targetDir, file));
        console.log(`${colors.green}✓ Copied:${colors.reset} ${relSrc} ${colors.green}→${colors.reset} ${file}`);
        copiedCount++;
      } catch (error) {
        console.error(`${colors.red}✗ Error copying ${relSrc}:${colors.reset}`, error.message);
        skippedCount++;
      }
    }
  }

  console.log(`\n${colors.bright}${colors.cyan}=== Summary ===${colors.reset}`);
  console.log(`${colors.green}${dryRun ? 'Would copy' : 'Copied'}:${colors.reset} ${copiedCount} skill file(s)`);
  if (skippedCount > 0) {
    console.log(`${colors.yellow}Skipped:${colors.reset} ${skippedCount} file(s)`);
  }

  if (dryRun) {
    console.log(`\n${colors.yellow}This was a dry run. Run without --dry-run to actually copy files.${colors.reset}`);
  }
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let customPath = null;
  let target = 'all'; // default: sync both targets

  const VALID_TARGETS = ['vscode', 'claude-code', 'all'];

  // Parse command-line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--custom-path' && i + 1 < args.length) {
      customPath = args[i + 1];
      i++;
    } else if (args[i] === '--target' && i + 1 < args.length) {
      const val = args[i + 1];
      if (!VALID_TARGETS.includes(val)) {
        console.error(`${colors.red}Error: Invalid --target value: "${val}". Valid values: ${VALID_TARGETS.join(', ')}${colors.reset}`);
        process.exit(1);
      }
      target = val;
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
${colors.bright}${colors.cyan}Multi-IDE Persona Sync Tool${colors.reset}

${colors.bright}Usage:${colors.reset}
  node scripts/sync-personas.js [options]

${colors.bright}Options:${colors.reset}
  --target <value>       Which IDE target to sync: vscode, claude-code, all (default: all)
  --dry-run              Preview without copying
  --custom-path <path>   Override default VS Code prompts directory (vscode target only)
  --help, -h             Show this help message

${colors.bright}Notes:${colors.reset}
  - The claude-code and all targets also sync .claude/skills/ → ~/.claude/skills/,
    making workflow skills available globally across all Claude Code projects.

${colors.bright}Examples:${colors.reset}
  node scripts/sync-personas.js
  node scripts/sync-personas.js --target vscode
  node scripts/sync-personas.js --target claude-code --dry-run
  node scripts/sync-personas.js --dry-run
  node scripts/sync-personas.js --custom-path "C:\\Custom\\Path"
`);
      process.exit(0);
    }
  }

  try {
    // Build personas from source templates, forwarding --target and --dry-run
    const buildScript = path.join(import.meta.dirname, 'build-personas.js');
    const buildArgs = ['--suite', 'ledger,standalone,ledger-support'];
    // NOTE: --dry-run is forwarded to build-personas.js, which previews but
    // does not regenerate output files. syncFromDir() then reads from the
    // existing output directories. On a clean checkout where output dirs
    // don't exist yet, a dry-run will report stale or empty content.
    if (dryRun) buildArgs.push('--dry-run');
    if (target !== 'all') buildArgs.push('--target', target);

    console.log(`${colors.bright}${colors.cyan}=== Building Personas ===${colors.reset}\n`);
    execFileSync(process.execPath, [buildScript, ...buildArgs], { stdio: 'inherit' });
    console.log();

    // Sync to the requested target(s)
    if (target === 'vscode' || target === 'all') {
      syncVSCode(dryRun, customPath);
      console.log();
      syncStandaloneVSCode(dryRun, customPath);
      console.log();
      syncLedgerSupportVSCode(dryRun, customPath);
      console.log();
    }
    if (target === 'claude-code' || target === 'all') {
      syncClaudeCode(dryRun);
      console.log();
      syncStandaloneClaudeCode(dryRun);
      console.log();
      syncLedgerSupportClaudeCode(dryRun);
      console.log();
      syncSkills(dryRun);
    }
  } catch (error) {
    console.error(`${colors.red}Error:${colors.reset}`, error.message);
    process.exit(1);
  }
}

main();


```
###  Path: `/scripts/validate-workflow-manifest.js`

```js
#!/usr/bin/env node

/**
 * scripts/validate-workflow-manifest.js
 *
 * Validates `shared/workflow-manifest.json` against `shared/workflow-manifest.schema.json`
 * and performs semantic cross-reference checks that the JSON Schema cannot express:
 *
 *   1. Unique role IDs, names, and numbers.
 *   2. Prerequisites DAG is acyclic and references only known pipeline types.
 *   3. fail_routing values reference only known (non-orchestrating) role IDs.
 *   4. default_stages is a subset of canonical_order pipeline types.
 *
 * JSON Schema structural validation is performed without any external library —
 * the script reads and checks the schema's `required` and `enum` constraints
 * manually. For full Draft-07 validation use `npx ajv-cli validate`.
 *
 * Usage:
 *   node scripts/validate-workflow-manifest.js       # from workspace root
 *
 * Exit codes:
 *   0  — manifest is valid
 *   1  — one or more validation errors
 */

import fs from 'fs';
import path from 'path';

const WORKSPACE_ROOT  = path.resolve(import.meta.dirname, '..');
const MANIFEST_PATH   = path.join(WORKSPACE_ROOT, 'shared', 'workflow-manifest.json');
const SCHEMA_PATH     = path.join(WORKSPACE_ROOT, 'shared', 'workflow-manifest.schema.json');

// ---------------------------------------------------------------------------
// Load files
// ---------------------------------------------------------------------------

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`[validate-manifest] ERROR: Manifest not found: ${MANIFEST_PATH}`);
  process.exit(1);
}
if (!fs.existsSync(SCHEMA_PATH)) {
  console.error(`[validate-manifest] ERROR: Schema not found: ${SCHEMA_PATH}`);
  process.exit(1);
}

/** @type {import('../shared/workflow-manifest.json')} */
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const schema   = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

const errors = [];

function fail(msg) {
  errors.push(msg);
}

// ---------------------------------------------------------------------------
// 1. Top-level required properties (from JSON Schema)
// ---------------------------------------------------------------------------

const topRequired = schema.required || [];
for (const prop of topRequired) {
  if (!(prop in manifest)) {
    fail(`Missing required top-level property: "${prop}"`);
  }
}

// ---------------------------------------------------------------------------
// 2. spec_version must be a non-empty string
// ---------------------------------------------------------------------------

if (manifest.spec_version !== undefined && typeof manifest.spec_version !== 'string') {
  fail(`"spec_version" must be a string, got ${typeof manifest.spec_version}`);
}

// ---------------------------------------------------------------------------
// 3. Roles array checks
// ---------------------------------------------------------------------------

const roles = Array.isArray(manifest.roles) ? manifest.roles : [];

if (roles.length === 0) {
  fail('"roles" must be a non-empty array');
}

const seenIds      = new Set();
const seenNames    = new Set();
const seenNumbers  = new Set();
const nonOrchIds   = new Set();
const pipelineIds  = new Set();

for (const role of roles) {
  // Required fields
  for (const field of ['id', 'name', 'number', 'persona_file']) {
    if (role[field] === undefined || role[field] === null || role[field] === '') {
      fail(`Role ${JSON.stringify(role.id || '(unknown)')}: missing required field "${field}"`);
    }
  }

  // Unique id
  if (seenIds.has(role.id)) {
    fail(`Duplicate role id: "${role.id}"`);
  }
  seenIds.add(role.id);

  // Unique name
  if (seenNames.has(role.name)) {
    fail(`Duplicate role name: "${role.name}"`);
  }
  seenNames.add(role.name);

  // Unique number
  if (seenNumbers.has(role.number)) {
    fail(`Duplicate role number: ${role.number} (role id: "${role.id}")`);
  }
  seenNumbers.add(role.number);

  // orchestrating field must be boolean
  if (typeof role.orchestrating !== 'boolean') {
    fail(`Role "${role.id}": "orchestrating" must be a boolean, got ${typeof role.orchestrating}`);
  }

  // Non-orchestrating roles may not have a null id in a pipeline context
  if (!role.orchestrating) {
    nonOrchIds.add(role.id);
  }

  // Track roles that own a pipeline
  if (role.pipeline) {
    pipelineIds.add(role.pipeline);
  }
}

// ---------------------------------------------------------------------------
// 4. Pipelines section checks
// ---------------------------------------------------------------------------

const pipelines = manifest.pipelines || {};

// canonical_order
const canonicalOrder = Array.isArray(pipelines.canonical_order) ? pipelines.canonical_order : [];
if (canonicalOrder.length === 0) {
  fail('"pipelines.canonical_order" must be a non-empty array');
}

const canonicalSet = new Set(canonicalOrder);

// Every pipeline type in canonical_order must be owned by a role
for (const pType of canonicalOrder) {
  if (!pipelineIds.has(pType)) {
    fail(`Pipeline type "${pType}" in canonical_order has no owning role (no role with pipeline: "${pType}")`);
  }
}

// default_stages must be a subset of canonical_order
const defaultStages = Array.isArray(pipelines.default_stages) ? pipelines.default_stages : [];
for (const stage of defaultStages) {
  if (!canonicalSet.has(stage)) {
    fail(`"pipelines.default_stages" entry "${stage}" is not in canonical_order`);
  }
}

// prerequisites: values must be null or known pipeline types; must form a DAG
const prereqs = pipelines.prerequisites || {};
for (const [pType, prereq] of Object.entries(prereqs)) {
  if (!canonicalSet.has(pType)) {
    fail(`"pipelines.prerequisites" key "${pType}" is not a known pipeline type`);
  }
  if (prereq !== null && !canonicalSet.has(prereq)) {
    fail(`"pipelines.prerequisites.${pType}" value "${prereq}" is not a known pipeline type`);
  }
}

// Cycle detection on prerequisites (simple DFS)
function hasCycle(node, visiting, visited) {
  if (visiting.has(node)) return true;
  if (visited.has(node))  return false;
  visiting.add(node);
  const prereq = prereqs[node];
  if (prereq && hasCycle(prereq, visiting, visited)) return true;
  visiting.delete(node);
  visited.add(node);
  return false;
}

const visiting = new Set();
const visited  = new Set();
for (const pType of canonicalOrder) {
  if (hasCycle(pType, visiting, visited)) {
    fail(`Cycle detected in pipelines.prerequisites involving "${pType}"`);
  }
}

// fail_routing: values must reference known non-orchestrating role IDs
const failRouting = pipelines.fail_routing || {};
for (const [pType, destId] of Object.entries(failRouting)) {
  if (!canonicalSet.has(pType)) {
    fail(`"pipelines.fail_routing" key "${pType}" is not a known pipeline type`);
  }
  if (!nonOrchIds.has(destId)) {
    fail(`"pipelines.fail_routing.${pType}" value "${destId}" is not a known non-orchestrating role id`);
  }
}

// ---------------------------------------------------------------------------
// 5. Statuses checks
// ---------------------------------------------------------------------------

const statuses = manifest.statuses || {};
for (const key of ['project', 'work_package', 'terminal_work_package', 'pipeline', 'blocker_type']) {
  if (!Array.isArray(statuses[key]) || statuses[key].length === 0) {
    fail(`"statuses.${key}" must be a non-empty array`);
  }
}

// terminal_work_package must be a subset of work_package
if (Array.isArray(statuses.terminal_work_package) && Array.isArray(statuses.work_package)) {
  const wpSet = new Set(statuses.work_package);
  for (const s of statuses.terminal_work_package) {
    if (!wpSet.has(s)) {
      fail(`"statuses.terminal_work_package" entry "${s}" is not in statuses.work_package`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Constants checks
// ---------------------------------------------------------------------------

const constants = manifest.constants || {};
const numericConstants = ['max_rework_count', 'stale_pipeline_hours', 'max_handoff_depth', 'handoff_depth_multiplier'];
for (const key of numericConstants) {
  if (constants[key] === undefined) {
    fail(`"constants.${key}" is required`);
  } else if (typeof constants[key] !== 'number' || constants[key] <= 0) {
    fail(`"constants.${key}" must be a positive number, got ${constants[key]}`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (errors.length === 0) {
  const roleCount     = roles.length;
  const pipelineCount = canonicalOrder.length;
  console.log(
    `[validate-manifest] OK: ${MANIFEST_PATH.replace(WORKSPACE_ROOT + '/', '')}\n` +
    `  spec_version=${manifest.spec_version}, roles=${roleCount}, pipelines=${pipelineCount}`
  );
  process.exit(0);
} else {
  console.error(`[validate-manifest] FAIL: ${errors.length} error(s) found in ${MANIFEST_PATH.replace(WORKSPACE_ROOT + '/', '')}:\n`);
  for (const err of errors) {
    console.error(`  ✗ ${err}`);
  }
  process.exit(1);
}

```