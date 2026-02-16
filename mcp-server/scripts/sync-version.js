#!/usr/bin/env node

/**
 * Sync Version Script
 * 
 * Extracts the latest version from changelog.md and updates package.json.
 * Changelog is the source of truth for versioning.
 * 
 * Changelog format: ## v{VERSION} - {TITLE}
 * Example: ## v1.0.1 - 2026-02-16
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

function extractVersionFromChangelog() {
  const changelogPath = join(rootDir, 'changelog.md');
  const changelogContent = readFileSync(changelogPath, 'utf-8');
  
  // Match version header: ## v{VERSION} - {anything}
  const versionMatch = changelogContent.match(/^## v(\d+\.\d+\.\d+)/m);
  
  if (!versionMatch) {
    throw new Error('Could not find version in changelog.md. Expected format: ## v{VERSION} - {TITLE}');
  }
  
  return versionMatch[1];
}

function updatePackageJson(version) {
  const packagePath = join(rootDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
  
  const oldVersion = packageJson.version;
  packageJson.version = version;
  
  writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
  
  return { oldVersion, newVersion: version };
}

function main() {
  try {
    console.log('📝 Syncing version from changelog.md to package.json...');
    
    const version = extractVersionFromChangelog();
    console.log(`✓ Found version in changelog: v${version}`);
    
    const { oldVersion, newVersion } = updatePackageJson(version);
    
    if (oldVersion === newVersion) {
      console.log(`✓ package.json already at v${newVersion} (no change needed)`);
    } else {
      console.log(`✓ Updated package.json: v${oldVersion} → v${newVersion}`);
    }
    
    console.log('✅ Version sync complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Version sync failed:', error.message);
    process.exit(1);
  }
}

main();
