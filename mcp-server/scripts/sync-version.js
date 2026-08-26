#!/usr/bin/env node

/**
 * Sync Version Script
 *
 * Extracts the latest version from changelog.md and updates package.json plus
 * package-lock.json. Changelog is the source of truth for versioning.
 *
 * Changelog format: ## v{VERSION} - {TITLE}
 * Example: ## v1.0.1 - 2026-02-16
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  readChangelogVersion,
  syncModuleVersion,
} from '../../scripts/lib/package-version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

function main() {
  try {
    console.log('📝 Syncing version from changelog.md to package.json…');

    const version = readChangelogVersion(join(rootDir, 'changelog.md'));

    if (version === 'UNRELEASED') {
      console.log('✓ Changelog has an UNRELEASED entry — nothing to sync.');
      process.exit(0);
    }
    if (!version) {
      throw new Error('Could not find version in changelog.md. Expected format: ## v{VERSION} - {TITLE}');
    }

    console.log(`✓ Found version in changelog: v${version}`);

    syncModuleVersion({
      packageJson: join(rootDir, 'package.json'),
      lockFile:    join(rootDir, 'package-lock.json'),
      version,
      log:         (msg) => console.log(msg),
    });

    console.log('✅ Version sync complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Version sync failed:', error.message);
    process.exit(1);
  }
}

main();
