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
