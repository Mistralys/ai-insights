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
      warnings++;
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
    warnings++;
    return match;
  });
}

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
// Helper: render the agent roster as a numbered Markdown list
// ---------------------------------------------------------------------------

/**
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

// ---------------------------------------------------------------------------
// Helper: render the MCP tools array as Markdown table rows
// ---------------------------------------------------------------------------

/**
 * @param {Array<{tool: string, purpose: string}>} tools
 * @returns {string}
 */
function renderMcpToolsTable(tools) {
  return tools
    .filter(t => !t.note_only)
    .map(t => `| \`${t.tool}\` | ${t.purpose} |`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Helper: serialize a tools array in YAML single-quote flow format
// e.g. ['vscode', 'execute', 'read', ...]  — includes outer brackets.
// Used by the ledger suite (preserves byte-identical output).
// ---------------------------------------------------------------------------

/**
 * @param {string[]} tools
 * @returns {string}  e.g. "['vscode', 'execute']"
 */
function serializeTools(tools) {
  return '[' + tools.map(t => `'${t}'`).join(', ') + ']';
}

// ---------------------------------------------------------------------------
// Helper: serialize tools list WITHOUT outer brackets.
// Used inside standalone frontmatter templates (which supply [ ]).
// ---------------------------------------------------------------------------

/**
 * @param {string[]} tools
 * @returns {string}  e.g. "'vscode', 'execute'"
 */
function serializeToolsList(tools) {
  return tools.map(t => `'${t}'`).join(', ');
}

// ---------------------------------------------------------------------------
// Helper: validate that a persona has a cc_file_name (required for CC output)
// ---------------------------------------------------------------------------

/**
 * Validates that a persona has the `cc_file_name` field set.
 * Exits with code 1 and prints an error if the field is missing.
 *
 * @param {{cc_file_name?: string, role?: string, number?: number}} persona
 * @param {string} suite
 */
function validateCcFileName(persona, suite) {
  if (!persona.cc_file_name) {
    console.error(`[ERROR] cc_file_name is required for persona '${persona.role || persona.number}' in suite '${suite}'`);
    process.exit(1);
  }
}

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

// STANDALONE — no role, no mcpServers; uses slug-based identification
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

const FRONTMATTER_STANDALONE_CC = `---
name: {{cc_name}}
description: '{{description}}'
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
tools: [{{cc_tools_list}}]
${ccFrontmatterFields()}
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

    // Determine content file (same basename, .md extension)
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

      validateCcFileName(persona, suite);
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
      validateCcFileName(persona, suite);
      cc_name = persona.cc_file_name.replace(/\.md$/, '');
    }

    const context = {
      // Shared metadata fields
      author:             sharedMeta.author,
      last_updated:       sharedMeta.last_updated,
      mcp_server_name:    sharedMeta.mcp_server_name,
      cc_permission_mode: sharedMeta.cc_permission_mode,
      cc_model:           sharedMeta.cc_model,
      cc_memory:          sharedMeta.cc_memory,
      // Per-persona fields (spread; may override shared where keys collide)
      ...persona,
      // Computed / derived
      version,
      // For standalone personas: auto-append version to base name so the YAML
      // only needs to carry the display name without a version suffix.
      ...(personaMode === 'standalone' && persona.name
        ? { name: `${persona.name} v${version}` }
        : {}),
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
    // Render frontmatter (variable interpolation only)
    // ------------------------------------------------------------------

    const frontmatter = resolveVariables(fmTemplate, context, yamlFile);

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
    // NOTE: This regex operates on the full assembled output text.
    // If a persona template body ever contains literal {{…}} inside a Markdown
    // fenced-code block, this scan will produce false positives. None of the
    // current 40 personas hit this path. Mitigation: strip fenced blocks before
    // scanning if this becomes relevant.
    // ------------------------------------------------------------------

    if (STRICT) {
      const unresolved = output.match(/\{\{>?\s*[\w-]+\}\}/g);
      if (unresolved) {
        const markers = [...new Set(unresolved)].join(', ');
        process.stderr.write(
          `[STRICT] Unresolved marker(s) in ${suite}/${target}/${contentBasename}: ${markers}\n`
        );
        strictFailures++;
      }
    }

    // ------------------------------------------------------------------
    // Output: write / check / dry-run
    // ------------------------------------------------------------------

    const outputFile = path.join(outputDir, contentBasename);

    builtCount++;

    if (DRY_RUN) {
      const preview = output.slice(0, 300).replace(/\n/g, '\n  ');
      console.log(`[dry-run] ${suite}/${target}/${contentBasename}:`);
      console.log(`  ${preview}`);
      if (output.length > 300) console.log('  ...(truncated)');
      console.log();
    } else if (CHECK) {
      // Check 1: Staleness — generated output must match the file on disk.
      if (!fs.existsSync(outputFile)) {
        console.log(`[missing] ${contentBasename}`);
        staleCount++;
      } else {
        const current = fs.readFileSync(outputFile, 'utf8');
        if (current !== output) {
          console.log(`[stale]   ${contentBasename}`);
          staleCount++;
        } else {
          console.log(`[ok]      ${contentBasename}`);
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
      console.log(`Built [${suite}/${target}]: ${contentBasename}`);
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
