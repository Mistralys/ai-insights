'use strict';

/**
 * persona-build.config.js
 *
 * Configuration for @mistralys/persona-builder CLI.
 *
 * Defines the three persona suites (ledger, standalone, ledger-support) and
 * the per-target output directories they render into: vs-code/, claude-code/
 * and deep-agents/ under each suite folder.
 *
 * The rendered persona files are build output, not source: the *.md files in
 * those directories are gitignored (Git tracks nothing there beyond a few
 * .gitkeep placeholders) and are regenerated from the YAML + Markdown
 * sources under each suite's src/. There is no committed copy to compare
 * the output against.
 *
 * Usage (from the workspace root) — always through the wrapper script, which
 * clears stale *.md output before a real build and runs the workspace's own
 * validation checks on top of the library CLI:
 *   node scripts/build-personas.js            # clean + build + post-build steps
 *   node scripts/build-personas.js --check    # render in memory, write nothing
 *   node scripts/build-personas.js --strict   # also fail on library warnings
 *
 * --check (alias --dry-run) renders every persona without writing files and
 * fails on any error-severity validation result. It validates the sources;
 * it does not diff the rendered output against the files on disk, so it does
 * not detect output that is merely out of date. The .githooks/pre-commit hook
 * runs this check mode.
 */

const path         = require('path');
const { ledgerPlugin } = require('./plugins/ledger');
const manifest     = require('../shared/workflow-manifest.json');

// Resolve all paths relative to this config file so the CLI can be invoked
// from any working directory.
const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Standalone frontmatter templates
// ---------------------------------------------------------------------------
// These are used as config-level defaults. For the ledger suite, the ledger
// plugin's onSuiteInit hook sets plugin-level frontmatter templates that take
// priority. For the standalone suite, the plugin removes its templates so
// these config-level templates take effect instead.

const FRONTMATTER_STANDALONE_VSCODE = `---
id: {{id}}
name: '{{name}} v{{version}}'
description: '{{description}}'
author: {{author}}
version: {{version}}
{{#if last_updated}}
last_updated: {{last_updated}}
{{/if}}
vs_file_name: {{vs_file_name}}
tools: [{{tools_list}}]
---`;

const FRONTMATTER_STANDALONE_CC = `---
name: {{cc_name}}
description: '{{description}}'
role: {{name}}
author: {{author}}
version: {{version}}
{{#if last_updated}}
last_updated: {{last_updated}}
{{/if}}
tools: [{{cc_tools_list}}]
permissionMode: {{cc_permission_mode}}
model: {{cc_model}}
memory: {{cc_memory}}
{{#if mcp_server_name}}
mcpServers:
  - {{mcp_server_name}}
{{/if}}
---`;

// ---------------------------------------------------------------------------
// Deep Agents frontmatter template
// ---------------------------------------------------------------------------
// Minimal frontmatter for headless LangGraph / Deep Agents pipeline executors.
// Uses the persona id (machine-readable identifier present in all personas)
// and cc_description (computed by the ledger plugin from the roster for ledger
// personas, or from the description YAML field for standalone personas).

const FRONTMATTER_DA = `---
name: {{id}}
description: '{{cc_description}}'
---`;

module.exports = {
  sharedPartialsDir: path.join(ROOT, 'personas', 'shared', 'partials'),

  targets: ['vscode', 'claude-code', 'deep-agents'],

  // Both handoff partials dispatch the successor agent in the ledger
  // workflow — a persona whose rendered content includes one of these
  // partials must grant the target's dispatch tool (`agent` on VS Code,
  // `Task`/`Agent` on Claude Code), or the handoff instruction it renders
  // would be unactionable on that target. The built-in
  // SUBAGENT_DISPATCH_REQUIREMENT (keyed on a declared `subagents` field)
  // already covers ledger personas; these two entries extend the same
  // dispatch-grant check to any persona whose content merely *includes* a
  // handoff block without declaring `subagents` itself.
  toolRequirements: [
    { id: 'ledger-handoff-claude-code', when: { partial: 'handoff-block-claude-code' }, targets: ['claude-code'] },
    { id: 'ledger-handoff-vscode',      when: { partial: 'handoff-block-vscode' },      targets: ['vscode'] },
  ],

  frontmatter: {
    vscode: FRONTMATTER_STANDALONE_VSCODE,
    'claude-code': FRONTMATTER_STANDALONE_CC,
    'deep-agents': FRONTMATTER_DA,
  },

  suites: {
    ledger: {
      srcDir:        path.join(ROOT, 'personas', 'ledger', 'src'),
      outVscode:     path.join(ROOT, 'personas', 'ledger', 'vs-code'),
      outClaudeCode: path.join(ROOT, 'personas', 'ledger', 'claude-code'),
      outputDirs: {
        'deep-agents': path.join(ROOT, 'personas', 'ledger', 'deep-agents'),
      },
      personaMode:   'numbered',
    },
    standalone: {
      srcDir:        path.join(ROOT, 'personas', 'standalone', 'src'),
      outVscode:     path.join(ROOT, 'personas', 'standalone', 'vs-code'),
      outClaudeCode: path.join(ROOT, 'personas', 'standalone', 'claude-code'),
      outputDirs: {
        'deep-agents': path.join(ROOT, 'personas', 'standalone', 'deep-agents'),
      },
      personaMode:   'standalone',
    },
    'ledger-support': {
      srcDir:        path.join(ROOT, 'personas', 'ledger-support', 'src'),
      outVscode:     path.join(ROOT, 'personas', 'ledger-support', 'vs-code'),
      outClaudeCode: path.join(ROOT, 'personas', 'ledger-support', 'claude-code'),
      outputDirs: {
        'deep-agents': path.join(ROOT, 'personas', 'ledger-support', 'deep-agents'),
      },
      personaMode:   'standalone',
    },
  },

  plugins: [
    ledgerPlugin({
      manifestRoles: manifest.roles.map(r => r.name),
      warnOnUnknownRole: true,
    }),
  ],
};
