/**
 * scripts/lib/name-mapping.js
 *
 * Generates `personas/name-mapping.json` from persona YAML metadata across
 * all three suites (ledger, standalone, ledger-support).
 *
 * Extracted verbatim from the former inline block in `scripts/build-personas.js`
 * (its post-build "generate personas/name-mapping.json" step) — the logic and
 * message texts are unchanged; only the module boundary changed, so the two
 * exported functions here plug into `build-personas.js` in place of what used
 * to be a single untestable 280-line block.
 *
 * `resolveVersionFromChangelog()` intentionally does not call into the
 * library's own `resolveChangelogMeta()`: using the compiled library here
 * would break name-mapping generation whenever `dist/` fails to load, which
 * the wrapper deliberately tolerates (see `build-personas.js`'s hoisted,
 * try/catch-wrapped library load).
 */

import fs from 'fs';
import path from 'path';
import { loadModelRegistry, resolveModel } from './persona-model-resolution.js';
import { parseYamlScalars, extractYamlBlockScalar } from './yaml-utils.js';

const SCALAR_FIELDS = ['number', 'role', 'id', 'version', 'vs_file_name', 'cc_file_name', 'da_file_name'];

// Non-ledger personas use the same scalar fields minus number/role (which are
// absent or derived differently).
const STANDALONE_SCALAR_FIELDS = ['id', 'name', 'version', 'vs_file_name', 'cc_file_name', 'da_file_name', 'model_slug'];

/**
 * Extracts the version string from a `changelog: |` block scalar in raw YAML
 * text. Returns the version string (e.g. "3.6.3") or undefined when absent.
 *
 * Regex patterns mirror `resolveChangelogMeta()` in `@mistralys/persona-builder`:
 *   Primary:  "3.6.3 (2026-05-29): description"
 *   Fallback: "3.6.3: description"            (no date)
 *
 * @param {string} text
 * @returns {string | undefined}
 */
export function resolveVersionFromChangelog(text) {
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
 * entry has no date. Routes an info message when explicit `version` or
 * `last_updated` scalar fields coexist with the changelog (indicating they
 * can be removed).
 *
 * @param {string} raw - raw YAML file content
 * @param {string} filename - filename used in warning/info message prefixes
 * @param {{ warn?: (msg: string) => void, info?: (msg: string) => void }} [io]
 */
export function validateChangelogField(raw, filename, io = {}) {
  const warn = io.warn ?? ((msg) => console.warn(msg));
  const info = io.info ?? ((msg) => console.info(msg));

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
          warn(`[WARN] ${filename}: version "${ver}" appears with two different dates` +
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
    warn(`[WARN] ${filename}: changelog present but no parseable version found.`);
  } else if (!firstHasDate) {
    warn(`[WARN] ${filename}: changelog first entry has no date (version "${firstVersion}").`);
  }

  const scalars = parseYamlScalars(raw, ['version', 'last_updated']);
  if (scalars.version) {
    info(`[INFO] ${filename}: explicit version "${scalars.version}" coexists with changelog.`);
  }
  if (scalars.last_updated) {
    info(`[INFO] ${filename}: explicit last_updated "${scalars.last_updated}" coexists with changelog.`);
  }
}

/** Returns the filename stem (strips the last extension). */
function stem(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

/**
 * Derives the role name for a non-ledger persona by stripping the known suite
 * suffix from the persona's `name` field.
 * e.g. "Developer (Standalone)"  → "Developer"
 *      "Ledger Bootstrapper"     → "Ledger Bootstrapper"  (no recognized suffix)
 *
 * @param {string} name
 * @returns {string}
 */
export function deriveRole(name) {
  return name
    .replace(/\s+\(Standalone\)$/i, '')
    .replace(/\s+\(Ledger Support\)$/i, '')
    .trim();
}

/**
 * Generate the full name-mapping entry list from persona YAML metadata
 * across all three suites.
 *
 * @param {object} options
 * @param {string} options.personasDir - absolute path to the `personas/` directory
 * @param {(msg: string) => void} [options.warn] - defaults to `console.warn`
 * @param {(msg: string) => void} [options.info] - defaults to `console.info`
 * @returns {{ entries: object[], ledgerCount: number, nonLedgerCount: number }}
 */
export function generateNameMapping({ personasDir, warn = (msg) => console.warn(msg), info = (msg) => console.info(msg) }) {
  const ledgerMetaDir = path.join(personasDir, 'ledger', 'src', 'meta');

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
    ['standalone',     path.join(personasDir, 'standalone', 'src', 'meta')],
    ['ledger-support', path.join(personasDir, 'ledger-support', 'src', 'meta')],
  ];

  // ---------------------------------------------------------------------------
  // Load model registry once for the entire name-mapping pass
  // ---------------------------------------------------------------------------

  const registryDir = path.join(personasDir, 'model-registry');
  const { uuidToSlug, registryEntries, assignments } = loadModelRegistry(registryDir, { warn });

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

    validateChangelogField(raw, file, { warn, info });

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

  return {
    entries: [...ledgerEntries, ...nonLedgerEntries],
    ledgerCount: ledgerEntries.length,
    nonLedgerCount: nonLedgerEntries.length,
  };
}

/**
 * Writes the name-mapping entries to `outPath` as pretty-printed JSON with a
 * trailing newline, matching the format `build-personas.js` always wrote.
 *
 * @param {string} outPath
 * @param {object[]} entries
 */
export function writeNameMapping(outPath, entries) {
  fs.writeFileSync(outPath, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}
