'use strict';

/**
 * persona-build.config.js
 *
 * Configuration for @mistralys/persona-builder CLI.
 *
 * Runs a shadow build of both persona suites using the library, producing
 * output that must be byte-identical to the currently committed persona files
 * in personas/ledger/ and personas/standalone/.
 *
 * Usage (from the workspace root):
 *   npx persona-build --config personas/persona-build.config.js
 *   npx persona-build --config personas/persona-build.config.js --check
 *   npx persona-build --config personas/persona-build.config.js --strict
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
permissionMode: {{cc_permission_mode}}
model: {{cc_model}}
memory: {{cc_memory}}
{{#if mcp_server_name}}
mcpServers:
  - {{mcp_server_name}}
{{/if}}
---`;

module.exports = {
  sharedPartialsDir: path.join(ROOT, 'personas', 'shared', 'partials'),

  frontmatter: {
    vscode: FRONTMATTER_STANDALONE_VSCODE,
    'claude-code': FRONTMATTER_STANDALONE_CC,
  },

  suites: {
    ledger: {
      srcDir:       path.join(ROOT, 'personas', 'ledger', 'src'),
      outVscode:    path.join(ROOT, 'personas', 'ledger', 'vs-code'),
      outClaudeCode: path.join(ROOT, 'personas', 'ledger', 'claude-code'),
      personaMode:  'numbered',
    },
    standalone: {
      srcDir:       path.join(ROOT, 'personas', 'standalone', 'src'),
      outVscode:    path.join(ROOT, 'personas', 'standalone', 'vs-code'),
      outClaudeCode: path.join(ROOT, 'personas', 'standalone', 'claude-code'),
      personaMode:  'standalone',
    },
  },

  plugins: [
    ledgerPlugin({
      manifestRoles: manifest.roles.map(r => r.name),
      warnOnUnknownRole: true,
    }),
  ],
};
