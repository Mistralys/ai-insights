# AI Insights - Scripts
_SOURCE: Workspace scripts (CLI, persona sync, build, bundling, validation)_
# Workspace scripts (CLI, persona sync, build, bundling, validation)
```
// Structure of documents
└── scripts/
    └── build-personas.js
    └── bundle-docs.js
    └── check-known-roles.js
    └── cli.js
    └── extract-changelog-entry.js
    └── install-hooks.js
    └── lib/
        ├── persona-helpers.js
    └── package-personas.js
    └── run-gui.js
    └── run-orchestrator.js
    └── sync-personas.js
    └── validate-workflow-manifest.js

```
###  Path: `\scripts/build-personas.js`

```js
#!/usr/bin/env node
'use strict';

/**
 * build-personas.js
 *
 * Reads sidecar YAML metadata and Markdown content templates from
 * personas/<suite>/src/ and assembles persona .md files into
 * target-specific output directories.
 *
 * Usage (from workspace root):
 *   node scripts/build-personas.js                              # build ledger (default)
 *   node scripts/build-personas.js --suite standalone           # standalone suite only
 *   node scripts/build-personas.js --suite all                  # both suites (ledger + standalone)
 *   node scripts/build-personas.js --suite ledger,standalone    # comma-separated list
 *   node scripts/build-personas.js --target vscode              # VS Code only
 *   node scripts/build-personas.js --target claude-code         # Claude Code only
 *   node scripts/build-personas.js --dry-run                    # preview, no writes
 *   node scripts/build-personas.js --check                      # exit 1 if stale
 *   node scripts/build-personas.js --strict                    # exit 1 if unresolved markers remain
 *   node scripts/build-personas.js --strict --suite all        # strict mode across all suites
 */

const fs   = require('fs');
const path = require('path');
const yaml = require(path.join(__dirname, '..', 'personas', 'node_modules', 'js-yaml'));

// Role names from the shared workflow manifest — used to cross-check persona YAML files.
const _MANIFEST_ROLE_NAMES = new Set(
  require('../shared/workflow-manifest.json').roles.map(r => r.name)
);
const {
  serializeTools,
  serializeToolsList,
  validateFileName,
  resolvePartials,
  resolveConditionals,
  resolveVariables,
  collapseBlankLines,
  ensureBlankLineBeforeHeadings,
  normalizeNewlines,
  renderRoster,
  renderMcpToolsTable,
} = require('./lib/persona-helpers');

// ---------------------------------------------------------------------------
// Version sync
// ---------------------------------------------------------------------------

/**
 * Reads the latest version from personas/changelog.md and writes it to
 * personas/package.json.  Called once at the end of a real (non-dry-run,
 * non-check) build so package.json always reflects the changelog version.
 */
function syncPersonasVersion() {
  const changelogPath = path.join(__dirname, '..', 'personas', 'changelog.md');
  const pkgPath       = path.join(__dirname, '..', 'personas', 'package.json');

  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const match     = changelog.match(/^## v(\d+\.\d+\.\d+)/m);

  if (!match) {
    console.warn('[WARN] Could not extract version from personas/changelog.md — skipping package.json update.');
    return;
  }

  const newVersion = match[1];
  const pkg        = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const oldVersion = pkg.version;

  if (oldVersion === newVersion) {
    console.log(`personas/package.json already at v${newVersion} — no update needed.`);
    return;
  }

  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`Updated personas/package.json: v${oldVersion} → v${newVersion}`);
}

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const CHECK   = process.argv.includes('--check');
const DRY_RUN = process.argv.includes('--dry-run');
const STRICT  = process.argv.includes('--strict');

// --target flag: vscode | claude-code | all (default: all)
const VALID_TARGETS = ['vscode', 'claude-code', 'all'];
const targetArgIdx  = process.argv.indexOf('--target');
let TARGET = 'all';
if (targetArgIdx !== -1) {
  const targetVal = process.argv[targetArgIdx + 1];
  if (!targetVal || !VALID_TARGETS.includes(targetVal)) {
    console.error(
      `[ERROR] Invalid --target value: "${targetVal || '(none)'}".\
  Valid values: vscode, claude-code, all`
    );
    console.error(
      'Usage: node scripts/build-personas.js [--target vscode|claude-code|all]'
    );
    process.exit(1);
  }
  TARGET = targetVal;
}

// --suite flag: ledger | standalone | all (default: ledger)
// Supports comma-separated values, e.g. --suite ledger,standalone
const VALID_SUITES = ['ledger', 'standalone', 'all'];
const suiteArgIdx  = process.argv.indexOf('--suite');
let SUITE_ARG = 'ledger';
if (suiteArgIdx !== -1) {
  const suiteVal = process.argv[suiteArgIdx + 1];
  if (!suiteVal) {
    console.error(
      '[ERROR] --suite requires a value. Valid values: ledger, standalone, all (comma-separated allowed).'
    );
    process.exit(1);
  }
  const requested = suiteVal.split(',').map(s => s.trim());
  const invalid   = requested.filter(s => !VALID_SUITES.includes(s));
  if (invalid.length > 0) {
    console.error(
      `[ERROR] Invalid --suite value(s): ${invalid.join(', ')}. Valid values: ${VALID_SUITES.join(', ')}`
    );
    process.exit(1);
  }
  SUITE_ARG = suiteVal;
}

/**
 * Expand a suite arg (possibly comma-separated, possibly containing "all")
 * to a deduplicated ordered list of concrete suite names.
 *
 * @param {string} suiteArg
 * @returns {string[]}
 */
function expandSuites(suiteArg) {
  const parts  = suiteArg.split(',').map(s => s.trim());
  const result = [];
  for (const p of parts) {
    if (p === 'all') {
      for (const s of ['ledger', 'standalone']) {
        if (!result.includes(s)) result.push(s);
      }
    } else if (!result.includes(p)) {
      result.push(p);
    }
  }
  return result;
}

const SUITES_TO_BUILD = expandSuites(SUITE_ARG);

// ---------------------------------------------------------------------------
// Suite configuration map
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');

const SUITE_CONFIGS = {
  ledger: {
    srcDir:      path.join(ROOT, 'personas', 'ledger', 'src'),
    outVscode:   path.join(ROOT, 'personas', 'ledger', 'vs-code'),
    outCC:       path.join(ROOT, 'personas', 'ledger', 'claude-code'),
    personaMode: 'numbered',
  },
  standalone: {
    srcDir:      path.join(ROOT, 'personas', 'standalone', 'src'),
    outVscode:   path.join(ROOT, 'personas', 'standalone', 'vs-code'),
    outCC:       path.join(ROOT, 'personas', 'standalone', 'claude-code'),
    personaMode: 'standalone',
  },
};

const SHARED_PARTIALS_DIR = path.join(ROOT, 'personas', 'shared', 'partials');

// ---------------------------------------------------------------------------
// Per-suite helpers
// ---------------------------------------------------------------------------

/**
 * Load the merged partials map for a given suite.
 * Load order: shared/partials (base) → <suite>/src/partials (override).
 * Suite-local partials take precedence over shared ones of the same name.
 *
 * @param {Object} suiteConfig
 * @returns {Object.<string, string>}
 */
function loadPartials(suiteConfig) {
  const partialsMap = {};

  // 1. Base layer: shared partials (suite-agnostic)
  if (fs.existsSync(SHARED_PARTIALS_DIR)) {
    for (const f of fs.readdirSync(SHARED_PARTIALS_DIR).filter(f => f.endsWith('.md'))) {
      partialsMap[f.replace(/\.md$/, '')] = normalizeNewlines(
        fs.readFileSync(path.join(SHARED_PARTIALS_DIR, f), 'utf8')
      );
    }
  } else {
    console.warn(`[WARN] Shared partials directory not found: ${SHARED_PARTIALS_DIR}`);
    warnings++;
  }

  // 2. Override layer: suite-specific partials
  const suitePartialsDir = path.join(suiteConfig.srcDir, 'partials');
  if (fs.existsSync(suitePartialsDir)) {
    for (const f of fs.readdirSync(suitePartialsDir).filter(f => f.endsWith('.md'))) {
      partialsMap[f.replace(/\.md$/, '')] = normalizeNewlines(
        fs.readFileSync(path.join(suitePartialsDir, f), 'utf8')
      );
    }
  }

  return partialsMap;
}

/**
 * Discover per-persona YAML files for a suite (sorted).
 *
 * @param {Object} suiteConfig
 * @returns {string[]}  array of filenames (not full paths)
 */
function discoverPersonaYamls(suiteConfig) {
  const metaDir = path.join(suiteConfig.srcDir, 'meta');
  return fs.readdirSync(metaDir)
    .filter(f => f.endsWith('.yaml') && !f.startsWith('_'))
    .sort();
}

// ---------------------------------------------------------------------------
// Template engine, serialization helpers, and validators
// (extracted to scripts/lib/persona-helpers.js)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Frontmatter templates
// ---------------------------------------------------------------------------

/**
 * Shared CC-specific frontmatter fields.
 * Used by both FRONTMATTER_LEDGER_CC and FRONTMATTER_STANDALONE_CC
 * to avoid verbatim duplication of these three fields.
 *
 * @note This helper is intentionally monomorphic — it returns the same
 * fields regardless of suite context (ledger vs. standalone). If ledger
 * and standalone CC frontmatter ever diverge (e.g., different
 * permissionMode defaults, or a suite-specific field), this function
 * will need to accept a suite parameter or be split into per-suite
 * variants. See 2026-03-10-persona-build-hardening synthesis §3.
 *
 * @returns {string} Multi-line YAML fragment (no leading/trailing newline)
 */
function ccFrontmatterFields() {
  return `permissionMode: {{cc_permission_mode}}
model: '{{cc_model}}'
memory: {{cc_memory}}`;
}

// LEDGER — WP-002 added id: field; remaining fields are the pre-WP-002 baseline
const FRONTMATTER_LEDGER_VSCODE = `---
id: {{id}}
name: '{{number}} - {{role}} v{{version}}'
description: 'Step {{number}}/{{total}} in the agent workflow.'
model: '{{model}}'
role: {{role}}
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
vs_file_name: {{vs_file_name}}
tools: {{tools_json}}
---`;

const FRONTMATTER_LEDGER_CC = `---
name: {{cc_name}}
description: '{{cc_description}}'
role: {{role}}
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
tools: {{cc_tools_json}}
${ccFrontmatterFields()}
mcpServers:
  - {{mcp_server_name}}
---`;

// STANDALONE — no role; mcpServers is optional via {{#if mcp_server_name}}; uses slug-based identification
const FRONTMATTER_STANDALONE_VSCODE = `---
id: {{id}}
name: '{{name}}'
description: '{{description}}'
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
vs_file_name: {{vs_file_name}}
tools: [{{tools_list}}]
---`;

// mcpServers is conditionally injected via {{#if mcp_server_name}} — set
// mcp_server_name in the per-persona YAML to enable this block.
const FRONTMATTER_STANDALONE_CC = `---
name: {{cc_name}}
description: '{{description}}'
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
tools: [{{cc_tools_list}}]
${ccFrontmatterFields()}
{{#if mcp_server_name}}
mcpServers:
  - {{mcp_server_name}}
{{/if}}
---`;

// ---------------------------------------------------------------------------
// Build loop
// ---------------------------------------------------------------------------

let warnings       = 0;   // count of [WARN] messages
let strictFailures = 0;   // count of unresolved-marker failures in --strict mode
let staleCount     = 0;   // files with stale content (--check mode)
let builtCount     = 0;   // files processed

/**
 * Build all personas for a single suite + target platform combination.
 *
 * @param {string}                 suite   'ledger' | 'standalone'
 * @param {'vscode'|'claude-code'} target
 */
function buildForTarget(suite, target) {
  const suiteConfig = SUITE_CONFIGS[suite];
  const isVscode    = target === 'vscode';
  const outputDir   = isVscode ? suiteConfig.outVscode : suiteConfig.outCC;
  const metaDir     = path.join(suiteConfig.srcDir, 'meta');
  const contentDir  = path.join(suiteConfig.srcDir, 'content');
  const personaMode = suiteConfig.personaMode;

  // Auto-generated header referencing the correct source path for this suite
  const autoHeader = `<!-- AUTO-GENERATED \u2014 do not edit. Source: personas/${suite}/src/ -->`;

  // Load suite-specific shared metadata
  const sharedMeta = yaml.load(
    fs.readFileSync(path.join(metaDir, '_shared.yaml'), 'utf8')
  );

  // Fail fast if default_version is missing — prevents 'undefined' from reaching output
  if (!sharedMeta.default_version) {
    console.error(`[ERROR] Missing 'default_version' in ${suite}/_shared.yaml`);
    process.exit(1);
  }

  // Load merged partials (shared + suite-specific)
  const partialsMap = loadPartials(suiteConfig);

  // Discover persona YAML files for this suite
  const personaYamlFiles = discoverPersonaYamls(suiteConfig);

  // Select frontmatter template based on suite + target
  let fmTemplate;
  if (suite === 'ledger') {
    fmTemplate = isVscode ? FRONTMATTER_LEDGER_VSCODE : FRONTMATTER_LEDGER_CC;
  } else {
    // standalone
    fmTemplate = isVscode ? FRONTMATTER_STANDALONE_VSCODE : FRONTMATTER_STANDALONE_CC;
  }

  // Ensure output directory exists (skip in dry-run / check modes)
  if (!DRY_RUN && !CHECK) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (CHECK || DRY_RUN) {
    console.log(`\n[suite: ${suite}, target: ${target}]`);
  }

  for (const yamlFile of personaYamlFiles) {
    const persona = yaml.load(
      fs.readFileSync(path.join(metaDir, yamlFile), 'utf8')
    );

    // Cross-check: persona role field must match a manifest role name.
    // Only ledger personas carry a role field (numbered mode).
    if (personaMode === 'numbered' && persona.role !== undefined) {
      if (!_MANIFEST_ROLE_NAMES.has(persona.role)) {
        const known = [..._MANIFEST_ROLE_NAMES].join(', ');
        process.stderr.write(
          `[WARN] ${suite}/${yamlFile}: role "${persona.role}" is not in shared/workflow-manifest.json.` +
          ` Known roles: ${known}\n`
        );
        warnings++;
      }
    }

    const contentBasename = yamlFile.replace(/\.yaml$/, '.md');
    const contentFile     = path.join(contentDir, contentBasename);

    if (!fs.existsSync(contentFile)) {
      console.error(`[ERROR] Content template not found: ${contentFile}`);
      process.exit(1);
    }

    // ------------------------------------------------------------------
    // Build merged context
    // ------------------------------------------------------------------

    const version = persona.version !== undefined
      ? persona.version
      : sharedMeta.default_version;

    const model = persona.model !== undefined
      ? persona.model
      // sharedMeta.cc_model is a legacy bridge field for configs that predate
      // default_model; for most suites only one of the two will be present.
      : (sharedMeta.default_model || sharedMeta.cc_model || 'inherit');

    if (personaMode === 'numbered' && model === 'inherit') {
      console.warn(`[WARN] ${suite}/${yamlFile}: model resolved to 'inherit' — check default_model in _shared.yaml`);
    }

    const ccModel = persona.cc_model !== undefined
      ? persona.cc_model
      : model;

    // Numbered-mode computed fields (ledger)
    let total           = undefined;
    let roster_rendered = '';
    let mcp_tools_table = '';
    let tools_json      = '';
    let cc_tools_json   = '';
    let cc_name         = '';
    let cc_description  = '';

    if (personaMode === 'numbered') {
      const roster     = sharedMeta.roster || [];
      const rosterEntry = roster.find(r => r.number === persona.number);

      total           = roster.length;
      roster_rendered = renderRoster(roster, persona.number);
      mcp_tools_table = persona.mcp_tools ? renderMcpToolsTable(persona.mcp_tools) : '';
      tools_json      = serializeTools(persona.tools || []);

      const ccTools = persona.cc_tools || sharedMeta.default_cc_tools || [];
      cc_tools_json = serializeTools(ccTools);

      validateFileName(persona, 'cc_file_name', suite);
      cc_name = persona.cc_file_name.replace(/\.md$/, '');

      // cc_description: explicit per-persona value wins; fallback to roster derivation
      if (persona.cc_description) {
        cc_description = persona.cc_description;
      } else if (rosterEntry) {
        cc_description = `${rosterEntry.title} \u2014 ${rosterEntry.short}`;
      } else {
        cc_description = `Step ${persona.number}/${total} in the ${suite} workflow`;
      }
    }

    // Tools-list variants (without outer brackets) — used by standalone
    const tools_list    = serializeToolsList(persona.tools    || []);
    const cc_tools_list = serializeToolsList(
      persona.cc_tools || sharedMeta.default_cc_tools || []
    );

    // Standalone: cc_name from cc_file_name
    if (personaMode === 'standalone') {
      validateFileName(persona, 'cc_file_name', suite);
      cc_name = persona.cc_file_name.replace(/\.md$/, '');
    }

    // For standalone personas, append version to the display name so the YAML
    // only needs to carry the base name without a version suffix.
    const standaloneNameOverride = (personaMode === 'standalone' && persona.name)
      ? { name: `${persona.name} v${version}` }
      : {};

    const context = {
      // Shared metadata fields
      author:             sharedMeta.author,
      last_updated:       sharedMeta.last_updated,
      mcp_server_name:    sharedMeta.mcp_server_name,
      cc_permission_mode: sharedMeta.cc_permission_mode,
      cc_memory:          sharedMeta.cc_memory,
      // Per-persona fields (spread; may override shared where keys collide)
      ...persona,
      // Computed / derived (must follow ...persona spread to prevent clobbering)
      version,
      model,
      cc_model:           ccModel,
      ...standaloneNameOverride,
      total,
      tools_json,
      cc_tools_json,
      tools_list,
      cc_tools_list,
      roster_rendered,
      mcp_tools_table,
      cc_name,
      cc_description,
      // Platform feature flags
      target_vscode:      isVscode,
      target_claude_code: !isVscode,
    };

    // ------------------------------------------------------------------
    // Render frontmatter (conditionals first, then variable interpolation)
    // ------------------------------------------------------------------

    let frontmatter = resolveConditionals(fmTemplate, context);
    frontmatter = resolveVariables(frontmatter, context, yamlFile);

    // ------------------------------------------------------------------
    // Render body: partials → conditionals → variables → post-process
    // ------------------------------------------------------------------

    const bodyTemplate = normalizeNewlines(fs.readFileSync(contentFile, 'utf8'));

    let body = resolvePartials(bodyTemplate, partialsMap);
    body = resolveConditionals(body, context);
    body = resolveVariables(body, context, contentBasename);
    body = collapseBlankLines(body);
    body = ensureBlankLineBeforeHeadings(body);
    body = body.trimEnd();

    // ------------------------------------------------------------------
    // Assemble final output
    // ------------------------------------------------------------------

    const output = normalizeNewlines(`${frontmatter}\n\n${autoHeader}\n\n${body}\n`);

    // ------------------------------------------------------------------
    // Strict mode: scan for unresolved markers in final output
    // NOTE: Fenced code blocks are stripped from the scan target before matching
    // to prevent false positives from literal {{…}} markers inside Markdown code
    // examples (WP-002). Currently covers 48 personas across all suites.
    // ------------------------------------------------------------------

    if (STRICT) {
      const strippedForScan = output.replace(/```[\s\S]*?```/g, '');
      const unresolved = strippedForScan.match(/\{\{>?\s*[\w-]+\}\}/g);
      if (unresolved) {
        const markers = [...new Set(unresolved)].join(', ');
        process.stderr.write(
          `[STRICT] Unresolved marker(s) in ${suite}/${target}/${contentBasename}: ${markers}\n`
        );
        strictFailures++;
      }
    }

    // ------------------------------------------------------------------
    // Determine output filename from YAML-declared field (constraint 13).
    // contentBasename is used only for the input content template lookup above.
    // ------------------------------------------------------------------

    let outputBasename;
    if (isVscode) {
      validateFileName(persona, 'vs_file_name', suite);
      outputBasename = persona.vs_file_name;
    } else {
      // cc_file_name already validated above during personaMode processing
      outputBasename = persona.cc_file_name;
    }

    // ------------------------------------------------------------------
    // Output: write / check / dry-run
    // ------------------------------------------------------------------

    const outputFile = path.join(outputDir, outputBasename);

    builtCount++;

    if (DRY_RUN) {
      const preview = output.slice(0, 300).replace(/\n/g, '\n  ');
      console.log(`[dry-run] ${suite}/${target}/${outputBasename}:`);
      console.log(`  ${preview}`);
      if (output.length > 300) console.log('  ...(truncated)');
      console.log();
    } else if (CHECK) {
      // Check 1: Staleness — generated output must match the file on disk.
      if (!fs.existsSync(outputFile)) {
        console.log(`[missing] ${outputBasename}`);
        staleCount++;
      } else {
        const current = fs.readFileSync(outputFile, 'utf8');
        if (current !== output) {
          console.log(`[stale]   ${outputBasename}`);
          staleCount++;
        } else {
          console.log(`[ok]      ${outputBasename}`);
        }
      }
      // Check 2: note_only regression guard.
      // Assert that tools marked note_only: true are absent from the generated
      // output. This guards against accidental removal of the `.filter(t => !t.note_only)`
      // in renderMcpToolsTable() — which would silently surface internal-only
      // tooling in published persona documents.
      if (persona.mcp_tools) {
        const noteOnlyTools = persona.mcp_tools.filter(t => t.note_only).map(t => t.tool);
        for (const toolName of noteOnlyTools) {
          const toolNameRegex = new RegExp(`\\|\\s*\`${toolName}\`\\s*\\|`);
          if (toolNameRegex.test(output)) {
            process.stderr.write(
              `[note_only-violation] ${suite}/${target}/${contentBasename}: note_only tool "${toolName}" appears in generated output.\n`
            );
            staleCount++;
          }
        }
      }
    } else {
      fs.writeFileSync(outputFile, output, 'utf8');
      console.log(`Built [${suite}/${target}]: ${outputBasename}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main: iterate over requested suites × targets
// ---------------------------------------------------------------------------

const targets = TARGET === 'all' ? ['vscode', 'claude-code'] : [TARGET];

for (const suite of SUITES_TO_BUILD) {
  for (const target of targets) {
    buildForTarget(suite, target);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const suiteLabel = SUITES_TO_BUILD.join(', ');

if (CHECK) {
  console.log();
  if (staleCount === 0) {
    console.log(
      `Checked ${builtCount} persona(s) across ${SUITES_TO_BUILD.length} suite(s) × ${targets.length} target(s) \u2014 all up-to-date.`
    );
  } else {
    console.log(
      `Checked ${builtCount} persona(s) across ${SUITES_TO_BUILD.length} suite(s) × ${targets.length} target(s) \u2014 ${staleCount} stale.`
    );
    process.exit(1);
  }
} else if (DRY_RUN) {
  console.log(
    `Dry-run complete. Would build ${builtCount} persona(s) across ${SUITES_TO_BUILD.length} suite(s) × ${targets.length} target(s).`
  );
  if (warnings > 0) console.log(`${warnings} warning(s).`);
} else {
  console.log(
    `\nBuilt ${builtCount} persona(s) across ${SUITES_TO_BUILD.length} suite(s) × ${targets.length} target(s). [suites: ${suiteLabel}]`
  );
  if (warnings > 0) console.log(`${warnings} warning(s).`);
  syncPersonasVersion();
}

if (STRICT && strictFailures > 0) {
  process.exit(1);
}

```
###  Path: `\scripts/bundle-docs.js`

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

```
###  Path: `\scripts/check-known-roles.js`

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

'use strict';

const path      = require('path');
const { execFileSync } = require('child_process');

const WORKSPACE_ROOT     = path.resolve(__dirname, '..');
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
###  Path: `\scripts/cli.js`

```js
#!/usr/bin/env node

/**
 * scripts/cli.js
 *
 * Unified workspace CLI — interactive command center and direct CLI entry point.
 * Replaces the need to remember individual `node scripts/X.js` invocations.
 *
 * Usage:
 *   node scripts/cli.js                     Interactive main menu
 *   node scripts/cli.js help                Show all commands
 *   node scripts/cli.js setup               Interactive setup wizard
 *   node scripts/cli.js setup --all         Non-interactive full setup
 *   node scripts/cli.js setup --components  Run selected components
 *   node scripts/cli.js <command> [flags]   Run a command directly
 *
 * Note: scripts/setup-orchestrator.js has been removed.
 *       Use `node scripts/cli.js setup` instead.
 */

'use strict';

const path     = require('path');
const fs       = require('fs');
const readline = require('readline');
const { spawnSync, spawn } = require('child_process');

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT   = path.resolve(__dirname, '..');
const SCRIPTS_DIR      = __dirname;
const MCP_SERVER_DIR   = path.join(WORKSPACE_ROOT, 'mcp-server');
const PERSONAS_DIR     = path.join(WORKSPACE_ROOT, 'personas');
const ORCHESTRATOR_DIR = path.join(WORKSPACE_ROOT, 'orchestrator');
const CHANGELOG_FILE   = path.join(WORKSPACE_ROOT, 'changelog.md');
const MCP_DIST_JSON    = path.join(WORKSPACE_ROOT, '.mcp.dist.json');
const MCP_JSON         = path.join(WORKSPACE_ROOT, '.mcp.json');
const IS_WIN           = process.platform === 'win32';
const NPM              = IS_WIN ? 'npm.cmd' : 'npm';

// ─── ANSI color helpers ───────────────────────────────────────────────────────

const C = {
  reset:       (s) => `\x1b[0m${s}\x1b[0m`,
  bold:        (s) => `\x1b[1m${s}\x1b[0m`,
  dim:         (s) => `\x1b[2m${s}\x1b[0m`,
  red:         (s) => `\x1b[31m${s}\x1b[0m`,
  green:       (s) => `\x1b[32m${s}\x1b[0m`,
  yellow:      (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:        (s) => `\x1b[36m${s}\x1b[0m`,
  white:       (s) => `\x1b[37m${s}\x1b[0m`,
  brightWhite: (s) => `\x1b[97m${s}\x1b[0m`,
  brightCyan:  (s) => `\x1b[96m${s}\x1b[0m`,
};

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg, color) {
  console.log(color && C[color] ? C[color](msg) : msg);
}

// ─── Pre-flight checks ────────────────────────────────────────────────────────

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) {
    log(`✗ Node.js >= 18 required (found ${process.versions.node})`, 'red');
    process.exit(1);
  }
}

function checkWorkspaceRoot() {
  if (!fs.existsSync(MCP_SERVER_DIR)) {
    log('✗ Run from the workspace root (mcp-server/ not found)', 'red');
    process.exit(1);
  }
}

// ─── Version string helper ────────────────────────────────────────────────────

function readVersion() {
  try {
    // Matches `## v1.2.3` and `## [1.2.3]` style headings.
    // Verified against changelog.md format `## v{semver} - {title}` — 2026-03-04.
    const m = fs.readFileSync(CHANGELOG_FILE, 'utf8').match(/^##\s+(?:\[|v)?(\d+\.\d+\.\d+)/m);
    return m ? `v${m[1]}` : 'unknown';
  } catch { return 'unknown'; }
}

function readSubVersion(subDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(subDir, 'package.json'), 'utf8'));
    return pkg.version ? `v${pkg.version}` : 'unknown';
  } catch { return 'unknown'; }
}

// ─── Script runners ───────────────────────────────────────────────────────────

/**
 * Run a script synchronously; exit on failure.
 * Used for direct delegating commands (sync-personas, build-personas, etc.).
 */
function runScript(scriptName, args = []) {
  const result = spawnSync('node', [path.join(SCRIPTS_DIR, scriptName), ...args], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    log(`\n✗ ${scriptName} exited with code ${result.status}`, 'red');
    process.exit(result.status ?? 1);
  }
}

/**
 * Run a long-running script asynchronously (gui, orchestrator).
 * Forwards SIGINT to child; exits when child exits.
 */
function runLongScript(scriptName, args = []) {
  const child = spawn('node', [path.join(SCRIPTS_DIR, scriptName), ...args], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
  });
  child.on('error', (err) => {
    log(`✗ Failed to launch ${scriptName}: ${err.message}`, 'red');
    process.exit(1);
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  child.on('exit', (code) => process.exit(code ?? 0));
}

/**
 * Run a command, returning the exit code.
 * Used inside setup components — does NOT exit on failure.
 *
 * On Windows, .cmd files (npm.cmd, pip.cmd) require shell:true in Node 22+
 * to avoid EINVAL from spawnSync. We default shell to IS_WIN; callers can
 * override via opts if needed.
 */
function sh(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: WORKSPACE_ROOT, shell: IS_WIN, ...opts });
  return r.status ?? 1;
}

// ─── Python finder (for orchestrator setup) ───────────────────────────────────

function findPython() {
  const candidates = IS_WIN ? ['python', 'python3', 'py'] : ['python3', 'python'];
  for (const cand of candidates) {
    const a = cand === 'py' ? ['-3', '--version'] : ['--version'];
    // python, python3, py are .exe on Windows — no shell wrapper needed
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
    log('  ✗ orchestrator/changelog.md not found', 'red');
    return;
  }
  if (!fs.existsSync(pyprojectPath)) {
    log('  ✗ orchestrator/pyproject.toml not found', 'red');
    return;
  }

  try {
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    // Match ## v1.2.3 or ## [1.2.3]
    const versionMatch = changelog.match(/^##\s+(?:\[|v)?(\d+\.\d+\.\d+)/m);
    
    if (!versionMatch) {
      // It's possible the changelog hasn't been started or format differs
      log('  ⚠ Could not find version in orchestrator/changelog.md', 'yellow');
      return;
    }

    const newVersion = versionMatch[1];
    let pyproject = fs.readFileSync(pyprojectPath, 'utf8');

    // Simple regex for top-level version = "..."
    const versionRegex = /^version\s*=\s*"[^"]+"/m;
    if (!versionRegex.test(pyproject)) {
      log('  ⚠ Could not find "version" key in pyproject.toml', 'yellow');
      return;
    }

    const newContent = pyproject.replace(versionRegex, `version = "${newVersion}"`);
    
    // Only write if changed
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

// ─── .mcp.json scaffold ───────────────────────────────────────────────────────

/**
 * Scaffold .mcp.json from .mcp.dist.json, replacing the placeholder path
 * with the real absolute path to mcp-server/src/index.ts.
 *
 * Returns true if the file was written or already exists (satisfied).
 * Returns false only on hard error (e.g. missing .mcp.dist.json).
 */
function scaffoldMcpJson(force = false) {
  if (fs.existsSync(MCP_JSON) && !force) {
    log('  .mcp.json already exists. Use --force to overwrite.', 'yellow');
    return true; // already satisfied
  }
  if (!fs.existsSync(MCP_DIST_JSON)) {
    log('  ✗ .mcp.dist.json not found; cannot scaffold .mcp.json', 'red');
    return false;
  }
  let template;
  try {
    template = JSON.parse(fs.readFileSync(MCP_DIST_JSON, 'utf8'));
  } catch (e) {
    log(`  ✗ Failed to parse .mcp.dist.json: ${e.message}`, 'red');
    return false;
  }

  const indexTs     = path.join(MCP_SERVER_DIR, 'src', 'index.ts');
  const PLACEHOLDER = '/Users/path/to/repo/ai-insights/mcp-server/src/index.ts';

  // Walk every string value in the parsed JSON and replace the placeholder
  function replaceInObj(obj) {
    if (typeof obj === 'string')  return obj === PLACEHOLDER ? indexTs : obj;
    if (Array.isArray(obj))       return obj.map(replaceInObj);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const k of Object.keys(obj)) out[k] = replaceInObj(obj[k]);
      return out;
    }
    return obj;
  }

  fs.writeFileSync(MCP_JSON, JSON.stringify(replaceInObj(template), null, 2) + '\n', 'utf8');
  log(`  ✓ .mcp.json written → ${indexTs}`, 'green');
  return true;
}

// ─── Setup components ─────────────────────────────────────────────────────────

const SETUP_COMPONENTS = [
  {
    id:    'mcp-server',
    label: 'MCP Server',
    desc:  'npm install + build',
    detect() {
      return (
        fs.existsSync(path.join(MCP_SERVER_DIR, 'node_modules')) &&
        fs.existsSync(path.join(MCP_SERVER_DIR, 'dist'))
      );
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
    detect: () => fs.existsSync(path.join(PERSONAS_DIR, 'node_modules')),
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
      // Parse orchestrator-specific flags forwarded through args
      const pIdx  = args.indexOf('--provider');
      const prov  = (pIdx !== -1 && args[pIdx + 1]) ? args[pIdx + 1] : 'anthropic';
      const dev   = args.includes('--dev');
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
        if (sh(pyBin, vArgs) !== 0) return false;
      } else {
        log('  .venv exists — skipping creation (use --force to recreate)', 'dim');
      }

      log('  Upgrading pip…', 'dim');
      if (sh(venvBin('python'), ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']) !== 0) {
        return false;
      }

      const extras = [prov, ...(dev ? ['dev'] : []), ...(ckpt ? ['checkpoint'] : [])];
      const target = `.[${extras.join(',')}]`;
      log(`  Installing ${target}…`, 'dim');
      if (sh(venvBin('pip'), ['install', '--quiet', '-e', target], { cwd: ORCHESTRATOR_DIR }) !== 0) {
        return false;
      }

      // Scaffold .env if missing
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
    id:    'mcp-json',
    label: '.mcp.json',
    desc:  'IDE MCP server config',
    detect: () => fs.existsSync(MCP_JSON),
    run:      (args = []) => scaffoldMcpJson(args.includes('--force')),
    validate() {
      if (!fs.existsSync(MCP_JSON)) return false;
      try { JSON.parse(fs.readFileSync(MCP_JSON, 'utf8')); return true; } catch { return false; }
    },
  },
  {
    id:    'git-hooks',
    label: 'Git hooks',
    desc:  'Pre-commit persona guard',
    detect() {
      const r = spawnSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' });
      return r.status === 0 && r.stdout.trim() === '.githooks';
    },
    run: () => sh('node', [path.join(SCRIPTS_DIR, 'install-hooks.js')]) === 0,
    validate() {
      const r = spawnSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' });
      return r.status === 0 && r.stdout.trim() === '.githooks';
    },
  },
];

// ─── Delegating command functions ─────────────────────────────────────────────

function cmdSyncPersonas(args)    { runScript('sync-personas.js', args); }
function cmdBuildPersonas(args)   { runScript('build-personas.js', args); }
function cmdPackagePersonas(args) { runScript('package-personas.js', args); }
function cmdGui(args)             { runLongScript('run-gui.js', args); }
function cmdBuildMaintain(args) {
  // 1. Sync MCP server version (existing behavior)
  runScript(path.join('..', 'mcp-server', 'scripts', 'sync-version.js'), args);

  // 2. Sync Orchestrator version (new behavior)
  syncOrchestratorVersion();

  // 3. Build Personas (all suites: ledger + standalone)
  const buildArgs = args.includes('--suite') ? args : ['--suite', 'all', ...args];
  runScript('build-personas.js', buildArgs);
}
function cmdOrchestrator(args)    { runLongScript('run-orchestrator.js', args); }
function cmdCheckRoles()          { runScript('check-known-roles.js'); }
function cmdBundleDocs(args)      { runScript('bundle-docs.js', args); }
function cmdCtxGenerate(args) {
  const ctxDir = path.join(WORKSPACE_ROOT, '.context');
  if (fs.existsSync(ctxDir)) {
    fs.rmSync(ctxDir, { recursive: true, force: true });
    log('Cleaned .context/', 'dim');
  }
  const result = spawnSync('ctx', ['generate', ...args], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    log('\n\u2717 ctx generate exited with code ' + (result.status ?? 1), 'red');
    process.exit(result.status ?? 1);
  }
  fs.writeFileSync(
    path.join(ctxDir, 'generated-at.txt'),
    new Date().toISOString() + '\n',
  );
}
function cmdMcpJson(args)         { scaffoldMcpJson(args.includes('--force')); }
function cmdGitHooks()            { sh('node', [path.join(SCRIPTS_DIR, 'install-hooks.js')]); }

// ─── Command registry ─────────────────────────────────────────────────────────

// forward-declares runSetup (defined below) — hoisting is fine for functions
const COMMANDS = [
  {
    id:          'setup',
    key:         '1',
    label:       'First-time setup',
    category:    'Setup & Configuration',
    description: 'Full workspace setup wizard',
    run:         (args) => runSetup(args),
  },
  {
    id:          'mcp-json',
    key:         '2',
    label:       'Scaffold .mcp.json',
    category:    'Setup & Configuration',
    description: 'Generate IDE MCP config',
    run:         cmdMcpJson,
  },
  {
    id:          'git-hooks',
    key:         '3',
    label:       'Install git hooks',
    category:    'Setup & Configuration',
    description: 'Pre-commit persona guard',
    run:         cmdGitHooks,
  },
  {
    id:          'sync-personas',
    key:         '4',
    label:       'Sync personas',
    category:    'Personas',
    description: 'Deploy to VS Code & Claude Code',
    run:         cmdSyncPersonas,
  },

  {
    id:          'package-personas',
    key:         '6',
    label:       'Package personas',
    category:    'Personas',
    description: 'ZIP standalone personas',
    run:         cmdPackagePersonas,
  },
  {
    id:          'gui',
    key:         '7',
    label:       'Launch GUI dashboard',
    category:    'MCP Server',
    description: 'Open the ledger GUI in browser',
    run:         cmdGui,
  },
  {
    id:          'build-maintain',
    key:         '0',
    label:       'Build & Maintain',
    category:    'Validation & Utilities',
    description: 'Sync versions & build personas',
    run:         cmdBuildMaintain,
  },
  {
    id:          'check-roles',
    key:         '8',
    label:       'Check role parity',
    category:    'Validation & Utilities',
    description: 'Verify persona ↔ MCP server roles',
    run:         cmdCheckRoles,
  },
  {
    id:          'bundle-docs',
    key:         '9',
    label:       'Bundle docs',
    category:    'Validation & Utilities',
    description: 'Compile doc bundles',
    run:         cmdBundleDocs,
  },
  {
    id:          'ctx-generate',
    key:         'c',
    label:       'CTX generate',
    category:    'Validation & Utilities',
    description: 'Generate context documentation',
    run:         cmdCtxGenerate,
  },
];

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  const ver = readVersion();
  console.log(`\nAI Insights CLI — ${ver}\n`);
  console.log('Usage: node scripts/cli.js [command] [options]\n');
  console.log('Commands:');
  const rows = [
    ['setup',                    'Full workspace setup wizard'],
    ['setup --all',              'Non-interactive full setup'],
    ['build-maintain',           'Sync versions & build personas'],
    ['setup --components <ids>', 'Run selected components (e.g. mcp-server,personas)'],
    ['mcp-json',                 'Generate IDE MCP server config'],
    ['mcp-json --force',         'Overwrite existing .mcp.json'],
    ['git-hooks',                'Install git hooks (pre-commit persona guard)'],
    ['sync-personas',            'Deploy to VS Code & Claude Code'],
    ['package-personas',         'ZIP standalone personas'],
    ['gui',                      'Launch MCP GUI dashboard (long-running)'],
    // Note: orchestrator requires --plan <path>; not available in interactive menu
    ['orchestrator',             'Run orchestrator pipeline (requires --plan <path>)'],
    ['check-roles',              'Verify persona ↔ MCP server role parity'],
    ['bundle-docs',              'Compile doc bundles'],    ['ctx-generate',             'Generate context documentation (ctx generate)'],    ['help',                     'Show this help'],
  ];
  for (const [cmd, desc] of rows) {
    process.stdout.write('  ' + cmd.padEnd(28) + C.dim(desc) + '\n');
  }
  console.log('\nRun without arguments for interactive mode.\n');
}

// ─── Argument parser ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const [first, ...rest] = argv;
  if (!first || first.startsWith('-')) return { command: null, flags: argv };
  return { command: first, flags: rest };
}

// ─── Setup wizard ─────────────────────────────────────────────────────────────

/**
 * Interactive checkbox menu for setup component selection.
 * Returns a Promise that resolves to an array of component IDs,
 * or null if the user quit without selecting.
 */
function runSetupMenu() {
  const items = SETUP_COMPONENTS.map((c) => ({
    id:      c.id,
    label:   c.label,
    desc:    c.desc,
    checked: true,
    done:    c.detect(),
  }));
  let cursor = 0;

  function render() {
    process.stdout.write('\x1b[2J\x1b[0;0H'); // clear screen + cursor home
    console.log(C.bold('Select components to set up:\n'));
    items.forEach((item, i) => {
      const mark  = i === cursor ? C.cyan('▶') : ' ';
      const box   = item.checked ? C.green('[x]') : '[ ]';
      const num   = `${i + 1}.`.padEnd(3);
      const label = item.label.padEnd(14);
      const desc  = C.dim(item.desc.padEnd(32));
      const done  = item.done ? C.dim(' (done)') : '';
      console.log(`  ${mark} ${box} ${num} ${label} ${desc}${done}`);
    });
    console.log('');
    console.log(C.dim('  (done) = already set up — toggle to re-run'));
    console.log('');
    console.log(
      `  ${C.bold('[a]')} Toggle all   ` +
      `${C.bold('[Enter]')} Run selected   ` +
      `${C.bold('[q]')} Back`
    );
    console.log('  ↑/↓ or j/k move   Space toggles\n');
  }

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    let rawSet = false;
    try { process.stdin.setRawMode(true); rawSet = true; } catch {}
    process.stdin.resume();
    render();

    function finish(result) {
      process.stdin.removeAllListeners('keypress');
      if (rawSet) try { process.stdin.setRawMode(false); } catch {}
      process.stdin.pause();
      resolve(result);
    }

    process.stdin.on('keypress', (ch, key) => {
      if (!key) return;
      // Ctrl+C
      if ((key.ctrl && key.name === 'c') || key.sequence === '\x03') {
        finish(null);
        return;
      }
      const k = key.name;
      if (k === 'up'   || ch === 'k') { cursor = Math.max(0, cursor - 1);                  render(); return; }
      if (k === 'down' || ch === 'j') { cursor = Math.min(items.length - 1, cursor + 1);   render(); return; }
      if (ch === ' ')  { items[cursor].checked = !items[cursor].checked;                   render(); return; }
      if (ch === 'a')  {
        const allOn = items.every((i) => i.checked);
        items.forEach((i) => { i.checked = !allOn; });
        render();
        return;
      }
      if (k === 'return' || k === 'enter') {
        finish(items.filter((i) => i.checked).map((i) => i.id));
        return;
      }
      if (ch === 'q') { finish(null); return; }
    });
  });
}

/**
 * Entry function for the `setup` command.
 * async so it can await the interactive checkbox menu when needed.
 */
async function runSetup(args) {
  const runAll   = args.includes('--all');
  const compIdx  = args.indexOf('--components');
  const compList = compIdx !== -1
    ? (args[compIdx + 1] || '').split(',').filter(Boolean)
    : null;

  let selectedIds;

  if (runAll) {
    selectedIds = SETUP_COMPONENTS.map((c) => c.id);
  } else if (compList) {
    selectedIds = compList;
  } else if (!process.stdin.isTTY) {
    log('✗ Non-interactive mode requires --all or --components <list>', 'red');
    log('  Example: node scripts/cli.js setup --all', 'dim');
    process.exit(1);
  } else {
    selectedIds = await runSetupMenu();
    if (!selectedIds || selectedIds.length === 0) {
      log('No components selected — aborted.', 'dim');
      return;
    }
  }

  const toRun = SETUP_COMPONENTS.filter((c) => selectedIds.includes(c.id));
  if (toRun.length === 0) {
    log('No matching components. Available: ' + SETUP_COMPONENTS.map((c) => c.id).join(', '), 'yellow');
    return;
  }

  console.log('');

  const results = [];
  for (const comp of toRun) {
    log(`→ ${comp.label}  ${C.dim(comp.desc)}`, 'bold');
    let ok = false;
    try {
      ok = await Promise.resolve(comp.run(args));
    } catch (e) {
      log(`  ✗ ${comp.label} threw: ${e.message}`, 'red');
    }
    if (ok) ok = comp.validate();
    results.push({ comp, ok });
  }

  // Print summary table
  const LINE = '─'.repeat(50);
  console.log('\nSetup Summary');
  console.log(LINE);
  for (const { comp, ok } of results) {
    const icon  = ok ? C.green('✓') : C.red('✗');
    const label = comp.label.padEnd(16);
    const msg   = ok ? C.dim('OK') : C.red('Failed — see output above');
    console.log(`  ${icon}  ${label} ${msg}`);
  }
  console.log(LINE);
  const passed = results.filter((r) => r.ok).length;
  const total  = results.length;
  const color  = passed === total ? 'green' : passed > 0 ? 'yellow' : 'red';
  log(`  ${passed}/${total} components succeeded`, color);
  console.log('');
  if (passed < total) process.exit(1);
}

// ─── Wait-for-key helper ──────────────────────────────────────────────────────

/**
 * Display a prompt and wait for the user to press any key.
 * Used after blocking commands so their output stays visible before the menu
 * re-renders and clears the screen.
 */
function waitForKey(prompt = '\n  Press any key to continue…') {
  return new Promise((resolve) => {
    process.stdout.write(C.dim(prompt));
    readline.emitKeypressEvents(process.stdin);
    let rawSet = false;
    try { process.stdin.setRawMode(true); rawSet = true; } catch {}
    process.stdin.resume();

    function done() {
      process.stdin.removeAllListeners('keypress');
      if (rawSet) try { process.stdin.setRawMode(false); } catch {}
      process.stdin.pause();
      console.log('');
      resolve();
    }

    process.stdin.on('keypress', (ch, key) => {
      if (key && key.ctrl && key.name === 'c') {
        done();
        process.exit(0);
      }
      done();
    });
  });
}

// ─── Interactive main menu ────────────────────────────────────────────────────

const BANNER_LINES = [
  " ",
  " █████╗ ██╗   ██╗███╗   ██╗███████╗██╗ ██████╗ ██╗  ██╗████████╗███████╗",
  "██╔══██╗██║   ██║████╗  ██║██╔════╝██║██╔════╝ ██║  ██║╚══██╔══╝██╔════╝",
  "███████║██║   ██║██╔██╗ ██║███████╗██║██║  ███╗███████║   ██║   ███████╗",
  "██╔══██║██║   ██║██║╚██╗██║╚════██║██║██║   ██║██╔══██║   ██║   ╚════██║",
  "██║  ██║██║   ██║██║ ╚████║███████║██║╚██████╔╝██║  ██║   ██║   ███████║",
  "╚═╝  ╚═╝╚═╝   ╚═╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝",
];

function renderMenu(version) {
  process.stdout.write('\x1b[2J\x1b[0;0H'); // clear screen + cursor home
  console.log(C.cyan(BANNER_LINES.join('\n')));
  console.log(C.dim(`  Workspace CLI  ${version}\n`));

  const catVersions = {
    'MCP Server': readSubVersion(MCP_SERVER_DIR),
    'Personas':   readSubVersion(PERSONAS_DIR),
  };

  // Group commands by category (preserving insertion order)
  const cats = [...new Set(COMMANDS.map((c) => c.category))];
  for (const cat of cats) {
    const subVer = catVersions[cat] ? C.dim(` ${catVersions[cat]}`) : '';
    console.log(C.bold(`  ${cat}`) + subVer);
    for (const cmd of COMMANDS.filter((c) => c.category === cat)) {
      const key   = C.cyan(`${cmd.key}.`);
      const label = cmd.label.padEnd(26);
      const desc  = C.dim(cmd.description);
      console.log(`    ${key} ${label} ${desc}`);
    }
    console.log('');
  }

  console.log(`  ${C.dim('[h] Help   [q] Quit')}\n`);
  process.stdout.write('  Choose: ');
}

/**
 * Show the interactive main menu and handle keypresses.
 * Called on first launch and after each non-long-running command completes.
 */
function showInteractiveMenu() {
  const version = readVersion();
  renderMenu(version);

  readline.emitKeypressEvents(process.stdin);
  let rawSet = false;
  try {
    process.stdin.setRawMode(true);
    rawSet = true;
  } catch {
    log('\n✗ Interactive mode requires a TTY terminal.', 'red');
    log('  Use: node scripts/cli.js help', 'dim');
    process.exit(1);
  }
  process.stdin.resume();

  function restoreTerminal() {
    process.stdin.removeAllListeners('keypress');
    if (rawSet) try { process.stdin.setRawMode(false); } catch {}
    process.stdin.pause();
  }

  process.stdin.on('keypress', async (ch, key) => {
    if (!key) return;
    try {

      // Ctrl+C or 'q' → exit
      if ((key.ctrl && key.name === 'c') || key.sequence === '\x03' || ch === 'q') {
        restoreTerminal();
        console.log('');
        process.exit(0);
      }

      // 'h' → show help, pause for user, then re-render menu
      if (ch === 'h') {
        restoreTerminal();
        console.log('');
        printHelp();
        await waitForKey('\n  Press any key to return to menu…');
        setImmediate(() => showInteractiveMenu());
        return;
      }

      // Check if the keypress matches a command
      const cmd = COMMANDS.find((c) => c.key === ch);
      if (!cmd) {
        renderMenu(version); // unknown key — just re-render
        return;
      }

      // Restore terminal before running any command
      restoreTerminal();
      console.log('');

      const isLong = cmd.id === 'gui' || cmd.id === 'orchestrator';
      if (isLong) {
        // Long-running: runLongScript manages process exit when child exits
        cmd.run([]);
      } else {
        // Blocking command: run it, pause for user, then re-show menu
        try {
          const result = cmd.run([]);
          if (result && typeof result.then === 'function') await result;
        } catch { /* errors are already logged inside command implementations */ }
        await waitForKey('\n  Press any key to return to menu…');
        setImmediate(() => showInteractiveMenu());
      }

    } catch (e) {
      // Safety net: if something unexpected throws, restore terminal and re-show menu
      restoreTerminal();
      console.error('\n' + C.red(`Unexpected error: ${e.message}`));
      setImmediate(() => showInteractiveMenu());
    }
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  checkNodeVersion();
  checkWorkspaceRoot();

  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === 'help') {
    printHelp();
    process.exit(0);
  }

  if (command !== null) {
    const cmd = COMMANDS.find((c) => c.id === command);
    if (!cmd) {
      log(`\n✗ Unknown command: "${command}"`, 'red');
      log('  Run `node scripts/cli.js help` for a list of commands.', 'dim');
      process.exit(1);
    }
    const result = cmd.run(flags);
    if (result && typeof result.then === 'function') await result;
    return;
  }

  // No command provided
  if (!process.stdin.isTTY) {
    log('Usage: node scripts/cli.js [command]', 'dim');
    log('Run `node scripts/cli.js help` for a list of commands.', 'dim');
    process.exit(1);
  }

  showInteractiveMenu();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

```
###  Path: `\scripts/extract-changelog-entry.js`

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

```
###  Path: `\scripts/install-hooks.js`

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

'use strict';

const { execSync } = require('child_process');

execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
console.log('Git hooks installed. Pre-commit persona guard active.');

```
###  Path: `\scripts\lib/persona-helpers.js`

```js
'use strict';

/**
 * persona-helpers.js
 *
 * Pure helper functions extracted from scripts/build-personas.js.
 * All functions are side-effect-free (no filesystem I/O, no process.exit)
 * except for the filename validator which calls process.exit(1) on
 * invalid input and the resolve* functions which call console.warn for
 * unresolved markers.
 *
 * CJS module — loaded via require('./lib/persona-helpers') in build-personas.js
 * and imported by the vitest test suite.
 */

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a tools array in YAML single-quote flow format.
 * e.g. ['vscode', 'execute', 'read', ...]  — includes outer brackets.
 * Used by the ledger suite (preserves byte-identical output).
 *
 * @param {string[]} tools
 * @returns {string}  e.g. "['vscode', 'execute']"
 */
function serializeTools(tools) {
  return '[' + tools.map(t => `'${t}'`).join(', ') + ']';
}

/**
 * Serialize tools list WITHOUT outer brackets.
 * Used inside standalone frontmatter templates (which supply [ ]).
 *
 * @param {string[]} tools
 * @returns {string}  e.g. "'vscode', 'execute'"
 */
function serializeToolsList(tools) {
  return tools.map(t => `'${t}'`).join(', ');
}

// ---------------------------------------------------------------------------
// Filename validators
// ---------------------------------------------------------------------------

/**
 * Validates that a persona has the specified filename field set.
 * Exits with code 1 and prints an error if the field is missing.
 *
 * @param {{role?: string, number?: number, slug?: string, [key: string]: any}} persona
 * @param {'cc_file_name'|'vs_file_name'} fieldName  the filename field to validate
 * @param {string} suite
 */
function validateFileName(persona, fieldName, suite) {
  if (!persona[fieldName]) {
    console.error(`[ERROR] ${fieldName} is required for persona '${persona.role || persona.slug || persona.number}' in suite '${suite}'`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Template engine
// ---------------------------------------------------------------------------

/**
 * Step 1 — Partial resolution.
 * Replaces {{> name}} with the content of the provided partialsMap.
 * Supports up to depth 2 to resolve partials-within-partials.
 * Warns and leaves the marker as-is if a partial is not found.
 *
 * @param {string} text
 * @param {Object.<string, string>} partialsMap
 * @param {number} depth current recursion depth (starts at 0)
 * @returns {string}
 */
function resolvePartials(text, partialsMap, depth = 0) {
  if (depth >= 2) return text;
  return text.replace(/\{\{> ([\w-]+)\}\}/g, (match, name) => {
    if (!(name in partialsMap)) {
      console.warn(`[WARN] Partial not found: ${match}`);
      return match;
    }
    // Recursively resolve nested partials (depth + 1).
    // trimEnd() strips trailing whitespace to avoid extra blank lines.
    return resolvePartials(partialsMap[name], partialsMap, depth + 1).trimEnd();
  });
}

/**
 * Step 2 — Conditional block resolution.
 * Handles {{#if flag}}...{{/if}} blocks with optional {{else}} branch.
 * When the flag is truthy, strips the delimiters and keeps the inner content
 * (content before {{else}} if present).
 * When falsy with {{else}}, keeps the content after {{else}}.
 * When falsy without {{else}}, removes the entire block.
 *
 * @param {string} text
 * @param {Object} context merged metadata context
 * @returns {string}
 */
function resolveConditionals(text, context) {
  return text.replace(
    /\n*\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}\n*/g,
    (match, flag, inner, elseInner) => {
      if (context[flag]) {
        // Truthy: keep content before {{else}} (or entire inner if no {{else}})
        return '\n' + inner.replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
      }
      if (elseInner !== undefined) {
        // Falsy with {{else}}: keep content after {{else}}
        return '\n' + elseInner.replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
      }
      // Falsy without {{else}}: remove entire block
      return '\n';
    }
  );
}

/**
 * Step 3 — Variable interpolation.
 * Replaces {{varName}} with String(context[varName]).
 * Warns and leaves the marker as-is if the variable is not found.
 *
 * @param {string} text
 * @param {Object} context merged metadata context
 * @param {string} filename for warning messages
 * @returns {string}
 */
function resolveVariables(text, context, filename) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    if (varName in context && context[varName] !== undefined) {
      return String(context[varName]);
    }
    console.warn(`[WARN] Unresolved variable: ${match} in ${filename}`);
    return match;
  });
}

// ---------------------------------------------------------------------------
// Post-processing helpers
// ---------------------------------------------------------------------------

/**
 * Post-processing: collapse 3 or more consecutive blank lines into 2.
 * (4+ newlines → 3 newlines = 2 blank lines between paragraphs)
 *
 * @param {string} text
 * @returns {string}
 */
function collapseBlankLines(text) {
  return text.replace(/\n{4,}/g, '\n\n\n');
}

/**
 * Post-processing: ensure every Markdown heading has a blank line before it.
 * Fixes spacing gaps caused by partial concatenation where trimEnd() strips
 * trailing newlines and conditionals add only single \n delimiters.
 *
 * @param {string} text
 * @returns {string}
 */
function ensureBlankLineBeforeHeadings(text) {
  // Blank line before headings
  text = text.replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2');
  // Blank line before and after horizontal rules (---)
  text = text.replace(/([^\n])\n(---)\n/g, '$1\n\n$2\n');
  text = text.replace(/\n(---)\n([^\n])/g, '\n$1\n\n$2');
  return text;
}

/**
 * Normalize line endings to LF (\n) for OS-agnostic output.
 * Converts CRLF (\r\n) first, then strips any remaining stray CR (\r).
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/**
 * Render the agent roster as a numbered Markdown list.
 *
 * @param {Array<{number: number, title: string, short: string}>} roster
 * @param {number} activeNumber the persona's own agent number
 * @returns {string}
 */
function renderRoster(roster, activeNumber) {
  return roster
    .map(entry => {
      const you = entry.number === activeNumber ? ' (YOU)' : '';
      return `${entry.number}. **${entry.title}${you}** (${entry.short})`;
    })
    .join('\n');
}

/**
 * Render the MCP tools array as Markdown table rows.
 *
 * @param {Array<{tool: string, purpose: string, note_only?: boolean}>} tools
 * @returns {string}
 */
function renderMcpToolsTable(tools) {
  return tools
    .filter(t => !t.note_only)
    .map(t => `| \`${t.tool}\` | ${t.purpose} |`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  serializeTools,
  serializeToolsList,
  validateFileName,
  resolvePartials,
  resolveConditionals,
  resolveVariables,
  collapseBlankLines,
  ensureBlankLineBeforeHeadings,
  normalizeNewlines,
  renderRoster,
  renderMcpToolsTable,
};

```
###  Path: `\scripts/package-personas.js`

```js
'use strict';

/**
 * package-personas.js
 *
 * Builds the standalone personas and packages them into ZIP archives
 * under /dist. Zero external dependencies — ZIP is written in pure Node.js
 * using the built-in zlib module, so this works identically on Windows,
 * macOS, and Linux.
 *
 * Usage (from workspace root):
 *   node scripts/package-personas.js
 *   node scripts/package-personas.js --skip-build        # zip existing output only
 *   node scripts/package-personas.js --version v1.2.3    # override version stamp
 *
 * Outputs (in dist/):
 *   ai-insights-personas-vscode-<version>.zip
 *   ai-insights-personas-claudecode-<version>.zip
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

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
  { dir: 'personas/standalone/vs-code',     label: 'VS Code',     slug: 'vscode'     },
  { dir: 'personas/standalone/claude-code', label: 'Claude Code', slug: 'claudecode' },
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
###  Path: `\scripts/run-gui.js`

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
 *   node scripts/run-gui.js -- --port 3421
 *   node scripts/run-gui.js -- --port 3421 --ledger-dir "C:\path\to\ledger"
 *
 * CLI arguments after `--` are forwarded to the GUI server process.
 */

const { spawn } = require('child_process');
const { createInterface } = require('readline');
const path = require('path');

const MCP_SERVER_DIR = path.resolve(__dirname, '..', 'mcp-server');

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
###  Path: `\scripts/run-orchestrator.js`

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

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// 1. Resolve paths
// ---------------------------------------------------------------------------
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
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

// Python venv installs orchestrate as "orchestrate.exe" on Windows, not
// "orchestrate.cmd" (the .cmd suffix is for npm-installed wrappers).
// Using "orchestrate" works cross-platform: Node resolves .exe via PATHEXT.
const orchestrateCmd = 'orchestrate';
const result = spawnSync(orchestrateCmd, forwardedArgs, {
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);

```
###  Path: `\scripts/sync-personas.js`

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

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// Role names are loaded from the shared workflow manifest — the single source
// of truth for all agent roles across the workspace.
const KNOWN_ROLES = require('../shared/workflow-manifest.json').roles.map(r => r.name);

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
 * Determine the VS Code User prompts directory based on the platform
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
 * Determine the Claude Code agents directory based on the platform.
 * Creates the directory if it does not exist.
 * @returns {string} - Path to ~/.claude/agents/
 */
function getClaudeCodeAgentsDir() {
  return path.join(os.homedir(), '.claude', 'agents');
}

/**
 * Determine the Claude Code global skills directory.
 * @returns {string} - Path to ~/.claude/skills/
 */
function getClaudeCodeSkillsDir() {
  return path.join(os.homedir(), '.claude', 'skills');
}

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
 * Validate Claude Code frontmatter for standalone personas: requires name
 * (kebab-case without numeric prefix), permissionMode, model, and memory.
 * Standalone personas do not require a 'role' field.
 * @param {string} dir - Absolute path to personas/standalone/claude-code/
 */
function validateStandaloneCCFrontmatter(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== Standalone Claude Code Frontmatter Validation ===${colors.reset}`);

  const STANDALONE_NAME_RE = /^[a-z][a-z0-9-]*$/;
  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join('standalone', 'claude-code', file);

    if (!fields) {
      console.warn(`${colors.yellow}⚠ ${relPath}: could not parse frontmatter${colors.reset}`);
      warningCount++;
      continue;
    }

    // name: must be present and match kebab-case (no numeric prefix)
    if (!fields.name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'name:' field${colors.reset}`);
      warningCount++;
    } else if (!STANDALONE_NAME_RE.test(fields.name)) {
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
    console.log(`${colors.green}✓ All ${files.length} standalone Claude Code persona file(s) passed frontmatter validation${colors.reset}`);
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
    const relSrc = path.relative(path.join(__dirname, '..'), filePath);

    if (!deployName) {
      console.log(`${colors.yellow}⊘ Skipped:${colors.reset} ${relSrc} ${colors.yellow}(no deployable filename in frontmatter)${colors.reset}`);
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
  const sourceDir = path.join(__dirname, '..', 'personas', 'ledger', 'vs-code');
  const targetDir = customPath || getVSCodePromptsDir();
  syncFromDir(sourceDir, targetDir, extractVSFileName, 'VS Code', dryRun);
  validateVSCodeFrontmatter(sourceDir);
}

/**
 * Validate VS Code frontmatter for standalone personas: requires name and
 * vs_file_name. Standalone personas do not require a 'role' field.
 * @param {string} dir - Absolute path to personas/standalone/vs-code/
 */
function validateStandaloneVSCodeFrontmatter(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== Standalone VS Code Frontmatter Validation ===${colors.reset}`);

  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join('standalone', 'vs-code', file);

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
    console.log(`${colors.green}✓ All ${files.length} standalone VS Code persona file(s) passed frontmatter validation${colors.reset}`);
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
  const sourceDir = path.join(__dirname, '..', 'personas', 'standalone', 'vs-code');
  const targetDir = customPath || getVSCodePromptsDir();
  syncFromDir(sourceDir, targetDir, extractVSFileName, 'Standalone VS Code', dryRun);
  validateStandaloneVSCodeFrontmatter(sourceDir);
}

/**
 * Sync Claude Code personas: personas/ledger/claude-code/ → ~/.claude/agents/.
 * @param {boolean} dryRun
 */
function syncClaudeCode(dryRun = false) {
  const sourceDir = path.join(__dirname, '..', 'personas', 'ledger', 'claude-code');
  const targetDir = getClaudeCodeAgentsDir();
  syncFromDir(sourceDir, targetDir, extractCCFileName, 'Claude Code', dryRun);
  validateCCFrontmatter(sourceDir);
}

/**
 * Sync standalone Claude Code personas: personas/standalone/claude-code/ → ~/.claude/agents/.
 * @param {boolean} dryRun
 */
function syncStandaloneClaudeCode(dryRun = false) {
  const sourceDir = path.join(__dirname, '..', 'personas', 'standalone', 'claude-code');
  const targetDir = getClaudeCodeAgentsDir();
  syncFromDir(sourceDir, targetDir, extractCCFileName, 'Standalone Claude Code', dryRun);
  validateStandaloneCCFrontmatter(sourceDir);
}

/**
 * Sync Claude Code skills: .claude/skills/ → ~/.claude/skills/.
 * Copies all .md files from the local project skills directory to the global
 * Claude Code skills directory, making them available in any project.
 * @param {boolean} dryRun
 */
function syncSkills(dryRun = false) {
  const sourceDir = path.join(__dirname, '..', '.claude', 'skills');
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
    const buildScript = path.join(__dirname, 'build-personas.js');
    const buildArgs = ['--suite', 'ledger,standalone'];
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
    }
    if (target === 'claude-code' || target === 'all') {
      syncClaudeCode(dryRun);
      console.log();
      syncStandaloneClaudeCode(dryRun);
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
###  Path: `\scripts/validate-workflow-manifest.js`

```js
#!/usr/bin/env node
'use strict';

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

const fs   = require('fs');
const path = require('path');

const WORKSPACE_ROOT  = path.resolve(__dirname, '..');
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