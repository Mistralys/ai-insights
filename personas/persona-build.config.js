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

module.exports = {
  sharedPartialsDir: path.join(ROOT, 'personas', 'shared', 'partials'),

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
