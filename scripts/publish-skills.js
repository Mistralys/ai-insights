#!/usr/bin/env node

/**
 * publish-skills.js — deploy built skill files to VS Code and Claude Code locations.
 *
 * Reads built .md files from dist/vscode-skills/ and dist/claude-skills/ and
 * deploys each as {stem}/SKILL.md under:
 *   .github/skills/      (VS Code, workspace-relative)
 *   ~/.claude/skills/    (Claude Code, user-global)
 *
 * Only directories whose stems match build output are cleared before publishing.
 * Hand-written skill directories (e.g. release-check) are never touched.
 *
 * Usage: node scripts/publish-skills.js [--dry-run]
 *   --dry-run  Log what would be deployed without writing any files.
 */

import fs from 'fs';
import path from 'path';
import { getClaudeCodeSkillsDir } from './publish-locations.js';

const ROOT        = path.resolve(import.meta.dirname, '..');
const DIST_VSCODE = path.join(ROOT, 'dist', 'vscode-skills');
const DIST_CLAUDE = path.join(ROOT, 'dist', 'claude-skills');
const GH_SKILLS   = path.join(ROOT, '.github', 'skills');
const CC_SKILLS   = getClaudeCodeSkillsDir();

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Read all .md files from a directory and return an array of { stem, content } objects.
 * Returns an empty array if the directory doesn't exist.
 * @param {string} dir
 * @returns {{ stem: string, content: string }[]}
 */
function readBuiltFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({
      stem:    path.basename(f, '.md'),
      content: fs.readFileSync(path.join(dir, f), 'utf8'),
    }));
}

/**
 * Deploy a skill file to {targetDir}/{stem}/SKILL.md.
 * Clears the {stem}/ directory first (preserving sibling directories not in the build).
 * When dryRun is true, logs what would be deployed without writing any files.
 * @param {string} stem
 * @param {string} content
 * @param {string} targetDir
 * @param {boolean} dryRun
 */
function deploySkill(stem, content, targetDir, dryRun) {
  const destDir  = path.join(targetDir, stem);
  const destFile = path.join(destDir, 'SKILL.md');

  if (dryRun) {
    console.log(`[publish-skills] [dry-run] would deploy → ${destFile}`);
    return;
  }

  // Clear only the stem directory — sibling directories (e.g. release-check) are untouched.
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(destFile, content, 'utf8');
}

// --- Main ---

const vsFiles  = readBuiltFiles(DIST_VSCODE);
const ccFiles  = readBuiltFiles(DIST_CLAUDE);

if (vsFiles.length === 0 && ccFiles.length === 0) {
  console.error('[publish-skills] No built skill files found. Run node scripts/build-skills.js first.');
  process.exit(1);
}

let published = 0;
const errors  = [];

// Deploy VS Code skills (.github/skills/{stem}/SKILL.md)
for (const { stem, content } of vsFiles) {
  try {
    deploySkill(stem, content, GH_SKILLS, DRY_RUN);
    if (!DRY_RUN) console.log(`[publish-skills] VS Code  → .github/skills/${stem}/SKILL.md`);
    published++;
  } catch (err) {
    errors.push(`VS Code / ${stem}: ${err.message}`);
  }
}

// Deploy Claude Code skills (~/.claude/skills/{stem}/SKILL.md)
for (const { stem, content } of ccFiles) {
  try {
    deploySkill(stem, content, CC_SKILLS, DRY_RUN);
    if (!DRY_RUN) console.log(`[publish-skills] Claude   → ${path.join(CC_SKILLS, stem, 'SKILL.md')}`);
    published++;
  } catch (err) {
    errors.push(`Claude Code / ${stem}: ${err.message}`);
  }
}

// Report
if (errors.length > 0) {
  for (const e of errors) console.error(`[publish-skills] ERROR: ${e}`);
  process.exit(1);
}

if (DRY_RUN) {
  console.log(`[publish-skills] ${published} skill file(s) would be published (dry-run).`);
} else {
  console.log(`[publish-skills] ${published} skill file(s) published.`);
}
