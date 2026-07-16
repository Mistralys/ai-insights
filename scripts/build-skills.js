#!/usr/bin/env node

/**
 * build-skills.js — build skill output files using a custom TargetRegistry.
 * Uses @mistralys/persona-builder programmatic API with vscode-skill and claude-skill targets.
 * Usage: node scripts/build-skills.js [--check] [--dry-run] [--strict]
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

const ROOT   = path.join(import.meta.dirname, '..');
const LIB    = path.join(ROOT, 'personas', 'node_modules', '@mistralys', 'persona-builder', 'dist', 'index.cjs');
const SKILLS = path.join(ROOT, 'skills');
const DIST   = path.join(ROOT, 'dist');

const { build, TargetRegistry } = _require(LIB);

// --dry-run is accepted as a convenience alias for --check (same behaviour)
const CHECK  = process.argv.includes('--check') || process.argv.includes('--dry-run');
const STRICT = process.argv.includes('--strict');

// Frontmatter templates for skill targets.
// VS Code skills: name, description, and optional argument-hint only.
// context/agent are not emitted for VS Code (VS Code doesn't use context: fork).
const VSCODE_SKILL_FRONTMATTER = `---
name: {{name}}
description: "{{description}}"
{{#if argument_hint}}argument-hint: "{{argument_hint}}"
{{/if}}---`;

// Claude Code skills: name, description, plus optional context and agent.
const CLAUDE_SKILL_FRONTMATTER = `---
name: {{name}}
description: "{{description}}"
{{#if context}}context: {{context}}
{{/if}}{{#if agent}}agent: {{agent}}
{{/if}}---`;

// Custom registry — do not register on defaultRegistry (reserved for persona targets).
const skillRegistry = new TargetRegistry();

skillRegistry.register({
    name:               'vscode-skill',
    outputDirKey:       'vscode-skill',
    defaultFrontmatter: VSCODE_SKILL_FRONTMATTER,
    contextFlags:       { target_vscode_skill: true },
});

skillRegistry.register({
    name:               'claude-skill',
    outputDirKey:       'claude-skill',
    defaultFrontmatter: CLAUDE_SKILL_FRONTMATTER,
    contextFlags:       { target_claude_skill: true },
});

// Output directories
const OUT_VSCODE  = path.join(DIST, 'vscode-skills');
const OUT_CLAUDE  = path.join(DIST, 'claude-skills');

// Pre-build: clear output directories so stale/renamed files don't linger.
// Uses recursive removal to catch any subdirectory output, not just top-level .md files.
// Skipped in --check / --dry-run mode (read-only).
if (!CHECK) {
    for (const dir of [OUT_VSCODE, OUT_CLAUDE]) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Suite config: srcDir points at the skills/ source tree.
// contentSubdir: 'src' matches the actual layout (skills/src/).
const suiteConfig = {
    srcDir:        SKILLS,
    contentSubdir: 'src',
    outputDirs: {
        'vscode-skill': OUT_VSCODE,
        'claude-skill':  OUT_CLAUDE,
    },
};

// Build
try {
    const summary = await build({
        suites:         { skills: suiteConfig },
        targets:        ['vscode-skill', 'claude-skill'],
        targetRegistry: skillRegistry,
        check:          CHECK,
        strict:         STRICT,
    });

    const mode = CHECK ? ' (check mode — no files written)' : '';
    console.log(`[build-skills] ${summary.totalBuilt} built, ${summary.totalWritten} written${mode}`);

    if (!summary.success) {
        process.exit(1);
    }
} catch (err) {
    console.error('[build-skills] Build failed:', err.message);
    process.exit(1);
}
