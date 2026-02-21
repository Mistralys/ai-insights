#!/usr/bin/env node
'use strict';

/**
 * build-personas.js
 *
 * Reads sidecar YAML metadata and Markdown content templates from
 * personas/ledger/src/ and assembles the 7 ledger persona .md files in
 * personas/ledger/.
 *
 * Usage (from workspace root):
 *   node personas/build-personas.js              # build all personas
 *   node personas/build-personas.js --dry-run    # preview output, no writes
 *   node personas/build-personas.js --check      # exit 1 if any output is stale
 *
 * Usage (from personas/ directory):
 *   node build-personas.js [same flags]
 */

const fs   = require('fs');
const path = require('path');
const yaml = require(path.join(__dirname, 'node_modules', 'js-yaml'));

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const CHECK   = process.argv.includes('--check');
const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Paths (all relative to this script's directory)
// ---------------------------------------------------------------------------

const SRC_DIR      = path.join(__dirname, 'ledger', 'src');
const META_DIR     = path.join(SRC_DIR, 'meta');
const PARTIALS_DIR = path.join(SRC_DIR, 'partials');
const CONTENT_DIR  = path.join(SRC_DIR, 'content');
const OUTPUT_DIR   = path.join(__dirname, 'ledger');

// ---------------------------------------------------------------------------
// Auto-generated header
// ---------------------------------------------------------------------------

const AUTO_HEADER = '<!-- AUTO-GENERATED \u2014 do not edit. Source: personas/ledger/src/ -->';

// ---------------------------------------------------------------------------
// Load shared metadata
// ---------------------------------------------------------------------------

const sharedMeta = yaml.load(
  fs.readFileSync(path.join(META_DIR, '_shared.yaml'), 'utf8')
);

// ---------------------------------------------------------------------------
// Discover per-persona YAML files (sorted by number prefix)
// ---------------------------------------------------------------------------

const personaYamlFiles = fs.readdirSync(META_DIR)
  .filter(f => f.endsWith('.yaml') && !f.startsWith('_'))
  .sort();

// ---------------------------------------------------------------------------
// Load all partials into a map keyed by name (without .md extension)
// ---------------------------------------------------------------------------

const partials = {};
for (const f of fs.readdirSync(PARTIALS_DIR).filter(f => f.endsWith('.md'))) {
  partials[f.replace(/\.md$/, '')] = fs.readFileSync(
    path.join(PARTIALS_DIR, f), 'utf8'
  );
}

// ---------------------------------------------------------------------------
// Template engine
// ---------------------------------------------------------------------------

/**
 * Step 1 — Partial resolution.
 * Replaces {{> name}} with the content of partials/name.md.
 * Supports up to depth 2 to resolve partials-within-partials.
 * Warns and leaves the marker as-is if a partial is not found.
 *
 * @param {string} text
 * @param {number} depth current recursion depth (starts at 0)
 * @returns {string}
 */
function resolvePartials(text, depth = 0) {
  if (depth >= 2) return text;
  return text.replace(/\{\{> ([\w-]+)\}\}/g, (match, name) => {
    if (!(name in partials)) {
      console.warn(`[WARN] Partial not found: ${match}`);
      warnings++;
      return match;
    }
    // Recursively resolve nested partials (depth + 1).
    // trimEnd() strips trailing whitespace from the embedded partial to avoid
    // accumulating extra blank lines when the partial is followed by a blank
    // line in the containing template.
    return resolvePartials(partials[name], depth + 1).trimEnd();
  });
}

/**
 * Step 2 — Conditional block resolution.
 * Handles {{#if flag}}...{{/if}} blocks (no {{else}}, no {{#each}}).
 * When the flag is truthy, strips the delimiters and keeps the inner content.
 * When falsy, removes the entire block.
 *
 * @param {string} text
 * @param {Object} context merged metadata context
 * @returns {string}
 */
function resolveConditionals(text, context) {
  return text.replace(
    /\n*\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}\n*/g,
    (match, flag, inner) => {
      if (context[flag]) {
        // Keep inner content; trim leading/trailing newlines from the delimiters
        return '\n' + inner.replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
      }
      // Remove entire block; leave a single newline to avoid run-together paragraphs
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
    .map(t => `| \`${t.tool}\` | ${t.purpose} |`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Helper: serialize a tools array in YAML single-quote flow format
// e.g. ['vscode', 'execute', 'read', ...]  — matches existing persona files
// ---------------------------------------------------------------------------

/**
 * @param {string[]} tools
 * @returns {string}
 */
function serializeTools(tools) {
  return '[' + tools.map(t => `'${t}'`).join(', ') + ']';
}

// ---------------------------------------------------------------------------
// Frontmatter template
// ---------------------------------------------------------------------------

const FRONTMATTER_TEMPLATE = `---
name: '{{number}} - {{role}} v{{version}}'
description: 'Step {{number}}/{{total}} in the agent workflow.'
role: {{role}}
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
vs_file_name: {{vs_file_name}}
tools: {{tools_json}}
---`;

// ---------------------------------------------------------------------------
// Build loop
// ---------------------------------------------------------------------------

let warnings  = 0;   // count of [WARN] messages
let staleCount = 0;  // files with stale content (--check mode)
let builtCount = 0;  // files processed

for (const yamlFile of personaYamlFiles) {
  const persona = yaml.load(
    fs.readFileSync(path.join(META_DIR, yamlFile), 'utf8')
  );

  // Determine content template filename (same basename, .md extension)
  const contentBasename = yamlFile.replace(/\.yaml$/, '.md');
  const contentFile = path.join(CONTENT_DIR, contentBasename);

  if (!fs.existsSync(contentFile)) {
    console.error(`[ERROR] Content template not found: ${contentFile}`);
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // Build merged context
  // ------------------------------------------------------------------

  const version         = persona.version !== undefined ? persona.version : sharedMeta.default_version;
  const total           = sharedMeta.roster.length;
  const tools_json      = serializeTools(persona.tools);
  const roster_rendered = renderRoster(sharedMeta.roster, persona.number);
  const mcp_tools_table = persona.mcp_tools ? renderMcpToolsTable(persona.mcp_tools) : '';
  const no_detect_project = !persona.has_detect_project;

  const context = {
    // Shared fields
    author:          sharedMeta.author,
    last_updated:    sharedMeta.last_updated,
    mcp_server_name: sharedMeta.mcp_server_name,
    // Per-persona fields (override shared where applicable)
    ...persona,
    // Computed / derived
    version,
    total,
    tools_json,
    roster_rendered,
    mcp_tools_table,
    no_detect_project,
  };

  // ------------------------------------------------------------------
  // Render frontmatter (variable interpolation only)
  // ------------------------------------------------------------------

  const frontmatter = resolveVariables(FRONTMATTER_TEMPLATE, context, yamlFile);

  // ------------------------------------------------------------------
  // Render body: partials → conditionals → variables → post-process
  // ------------------------------------------------------------------

  const bodyTemplate = fs.readFileSync(contentFile, 'utf8');

  let body = resolvePartials(bodyTemplate);
  body = resolveConditionals(body, context);
  body = resolveVariables(body, context, contentBasename);
  body = collapseBlankLines(body);
  body = body.trimEnd();

  // ------------------------------------------------------------------
  // Assemble final output
  // ------------------------------------------------------------------

  const output = `${frontmatter}\n\n${AUTO_HEADER}\n\n${body}\n`;

  // ------------------------------------------------------------------
  // Output: write / check / dry-run
  // ------------------------------------------------------------------

  const outputFile = path.join(OUTPUT_DIR, contentBasename);

  builtCount++;

  if (DRY_RUN) {
    const preview = output.slice(0, 300).replace(/\n/g, '\n  ');
    console.log(`[dry-run] ${contentBasename}:`);
    console.log(`  ${preview}`);
    if (output.length > 300) console.log('  ...(truncated)');
    console.log();
  } else if (CHECK) {
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
  } else {
    fs.writeFileSync(outputFile, output, 'utf8');
    console.log(`Built: ${contentBasename}`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

if (CHECK) {
  console.log();
  if (staleCount === 0) {
    console.log(`Checked ${builtCount} personas \u2014 all up-to-date.`);
  } else {
    console.log(`Checked ${builtCount} personas \u2014 ${staleCount} stale.`);
    process.exit(1);
  }
} else if (DRY_RUN) {
  console.log(`Dry-run complete. Would build ${builtCount} personas.`);
  if (warnings > 0) console.log(`${warnings} warning(s).`);
} else {
  console.log(`\nBuilt ${builtCount} personas.`);
  if (warnings > 0) console.log(`${warnings} warning(s).`);
}
