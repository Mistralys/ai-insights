#!/usr/bin/env node

/**
 * sync-personas.js
 *
 * Builds persona files from source templates and copies them to each IDE's
 * agent/prompt directory.
 *
 * Usage:
 *   node scripts/sync-personas.js
 *   node scripts/sync-personas.js --target vscode         # VS Code only
 *   node scripts/sync-personas.js --target claude-code    # Claude Code only
 *   node scripts/sync-personas.js --dry-run               # Preview without copying
 *   node scripts/sync-personas.js --custom-path "C:\Custom\Path"  # Custom VS Code prompts dir
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// NOTE: Keep in sync with AGENT_ROLES in src/utils/constants.ts whenever agent
// roles are added or renamed. This file is plain JS and cannot import TypeScript
// source directly.
const KNOWN_ROLES = [
  'Planner',
  'Project Manager',
  'Developer',
  'QA',
  'Reviewer',
  'Documentation',
  'Synthesis',
];

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

/**
 * Determine the VS Code User prompts directory based on the platform
 */
function getVSCodePromptsDir() {
  const platform = os.platform();
  const homeDir = os.homedir();

  switch (platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Code', 'User', 'prompts');
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'prompts');
    case 'linux':
      return path.join(homeDir, '.config', 'Code', 'User', 'prompts');
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Determine the Claude Code agents directory based on the platform.
 * Creates the directory if it does not exist.
 * @returns {string} - Path to ~/.claude/agents/
 */
function getClaudeCodeAgentsDir() {
  return path.join(os.homedir(), '.claude', 'agents');
}

/**
 * Extract the VS File Name from a persona file's YAML frontmatter (vs_file_name field).
 * @param {string} filePath - Path to the persona file
 * @returns {string|null} - The VS File Name or null if not found
 */
function extractVSFileName(filePath) {
  try {
    const rawContent = fs.readFileSync(filePath, 'utf8');
    // Strip optional AUTO-GENERATED comment header produced by build-personas.js
    const content = rawContent.startsWith('<!--') ? rawContent.slice(rawContent.indexOf('\n') + 1) : rawContent;

    if (!content.startsWith('---')) return null;

    const afterFirst = content.slice(3);
    const closingIdx = afterFirst.indexOf('\n---');
    if (closingIdx === -1) return null;

    const frontmatter = afterFirst.slice(0, closingIdx);

    for (const line of frontmatter.split('\n')) {
      const match = line.trim().match(/^vs_file_name:\s*['"]?(.+?)['"]?\s*$/);
      if (match) return match[1];
    }

    return null;
  } catch (error) {
    console.error(`${colors.red}Error reading file ${filePath}:${colors.reset}`, error.message);
    return null;
  }
}

/**
 * Extract the Claude Code deployment filename from a CC persona file's YAML
 * frontmatter. Uses the `name` field and appends `.md`.
 * @param {string} filePath - Path to the persona file
 * @returns {string|null} - e.g. "1-planner.md" or null if not found
 */
function extractCCFileName(filePath) {
  try {
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const content = rawContent.startsWith('<!--') ? rawContent.slice(rawContent.indexOf('\n') + 1) : rawContent;

    if (!content.startsWith('---')) return null;

    const afterFirst = content.slice(3);
    const closingIdx = afterFirst.indexOf('\n---');
    if (closingIdx === -1) return null;

    const frontmatter = afterFirst.slice(0, closingIdx);

    for (const line of frontmatter.split('\n')) {
      const match = line.trim().match(/^name:\s*['"]?(.+?)['"]?\s*$/);
      if (match) return match[1].trim() + '.md';
    }

    return null;
  } catch (error) {
    console.error(`${colors.red}Error reading file ${filePath}:${colors.reset}`, error.message);
    return null;
  }
}

/**
 * Recursively find all markdown files in a directory
 * @param {string} dir - Directory to search
 * @param {string[]} fileList - Accumulator for found files
 * @param {string[]} excludeDirs - Absolute directory paths to skip
 * @returns {string[]} - Array of file paths
 */
function findMarkdownFiles(dir, fileList = [], excludeDirs = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (excludeDirs.includes(filePath)) return;
      findMarkdownFiles(filePath, fileList, excludeDirs);
    } else if (file.endsWith('.md')) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * Parse YAML frontmatter fields from a persona file into a plain object.
 * Returns null if the file has no valid YAML frontmatter block.
 * @param {string} filePath
 * @returns {Object|null}
 */
function parseFrontmatter(filePath) {
  try {
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const content = rawContent.startsWith('<!--') ? rawContent.slice(rawContent.indexOf('\n') + 1) : rawContent;
    if (!content.startsWith('---')) return null;
    const afterFirst = content.slice(3);
    const closingIdx = afterFirst.indexOf('\n---');
    if (closingIdx === -1) return null;
    const fields = {};
    for (const line of afterFirst.slice(0, closingIdx).split('\n')) {
      const m = line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (m) fields[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return fields;
  } catch {
    return null;
  }
}

/**
 * Validate VS Code persona frontmatter: requires role (in KNOWN_ROLES),
 * name, and vs_file_name fields.
 * @param {string} dir - Absolute path to personas/ledger/vs-code/
 */
function validateVSCodeFrontmatter(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== VS Code Frontmatter Validation ===${colors.reset}`);

  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join('ledger', 'vs-code', file);

    if (!fields) {
      console.warn(`${colors.yellow}⚠ ${relPath}: could not parse frontmatter${colors.reset}`);
      warningCount++;
      continue;
    }

    if (!fields.role) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'role:' field${colors.reset}`);
      warningCount++;
    } else if (!KNOWN_ROLES.includes(fields.role)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: unknown role "${fields.role}". Expected: ${KNOWN_ROLES.join(', ')}${colors.reset}`);
      warningCount++;
    }

    if (!fields.name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'name:' field${colors.reset}`);
      warningCount++;
    }

    if (!fields.vs_file_name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'vs_file_name:' field${colors.reset}`);
      warningCount++;
    }
  }

  if (warningCount === 0) {
    console.log(`${colors.green}✓ All ${files.length} VS Code persona file(s) passed frontmatter validation${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${warningCount} frontmatter warning(s) found — sync was not blocked${colors.reset}`);
  }
}

/**
 * Validate Claude Code persona frontmatter: requires name (kebab-case with
 * numeric prefix), role (in KNOWN_ROLES), permissionMode, model, and memory.
 * @param {string} dir - Absolute path to personas/ledger/claude-code/
 */
function validateCCFrontmatter(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== Claude Code Frontmatter Validation ===${colors.reset}`);

  const CC_NAME_RE = /^\d-[a-z][a-z0-9-]*$/;
  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join('ledger', 'claude-code', file);

    if (!fields) {
      console.warn(`${colors.yellow}⚠ ${relPath}: could not parse frontmatter${colors.reset}`);
      warningCount++;
      continue;
    }

    // name: must be present and match N-kebab-case
    if (!fields.name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'name:' field${colors.reset}`);
      warningCount++;
    } else if (!CC_NAME_RE.test(fields.name)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: 'name: ${fields.name}' does not match N-kebab-case pattern (e.g. "1-planner")${colors.reset}`);
      warningCount++;
    }

    // role: must be present and in KNOWN_ROLES
    if (!fields.role) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'role:' field${colors.reset}`);
      warningCount++;
    } else if (!KNOWN_ROLES.includes(fields.role)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: unknown role "${fields.role}". Expected: ${KNOWN_ROLES.join(', ')}${colors.reset}`);
      warningCount++;
    }

    // permissionMode, model, memory: must be present strings
    for (const requiredField of ['permissionMode', 'model', 'memory']) {
      if (!fields[requiredField]) {
        console.warn(`${colors.yellow}⚠ ${relPath}: missing '${requiredField}:' field${colors.reset}`);
        warningCount++;
      }
    }
  }

  if (warningCount === 0) {
    console.log(`${colors.green}✓ All ${files.length} Claude Code persona file(s) passed frontmatter validation${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${warningCount} frontmatter warning(s) found — sync was not blocked${colors.reset}`);
  }
}

/**
 * Validate Claude Code frontmatter for standalone personas: requires name
 * (kebab-case without numeric prefix), permissionMode, model, and memory.
 * Standalone personas do not require a 'role' field.
 * @param {string} dir - Absolute path to personas/standalone/claude-code/
 */
function validateStandaloneCCFrontmatter(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== Standalone Claude Code Frontmatter Validation ===${colors.reset}`);

  const STANDALONE_NAME_RE = /^[a-z][a-z0-9-]*$/;
  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join('standalone', 'claude-code', file);

    if (!fields) {
      console.warn(`${colors.yellow}⚠ ${relPath}: could not parse frontmatter${colors.reset}`);
      warningCount++;
      continue;
    }

    // name: must be present and match kebab-case (no numeric prefix)
    if (!fields.name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'name:' field${colors.reset}`);
      warningCount++;
    } else if (!STANDALONE_NAME_RE.test(fields.name)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: 'name: ${fields.name}' does not match kebab-case pattern (e.g. "manifest-curator")${colors.reset}`);
      warningCount++;
    }

    // permissionMode, model, memory: must be present strings
    for (const requiredField of ['permissionMode', 'model', 'memory']) {
      if (!fields[requiredField]) {
        console.warn(`${colors.yellow}⚠ ${relPath}: missing '${requiredField}:' field${colors.reset}`);
        warningCount++;
      }
    }
  }

  if (warningCount === 0) {
    console.log(`${colors.green}✓ All ${files.length} standalone Claude Code persona file(s) passed frontmatter validation${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${warningCount} frontmatter warning(s) found — sync was not blocked${colors.reset}`);
  }
}

/**
 * Generic helper: copy persona files from sourceDir to targetDir using the
 * provided filename-extraction function.
 *
 * @param {string} sourceDir - Directory containing built persona .md files
 * @param {string} targetDir - Destination directory on the system
 * @param {Function} extractFileNameFn - Returns the target filename given a file path
 * @param {string} label - Human-readable label for console output (e.g. "VS Code")
 * @param {boolean} dryRun - If true, preview only; no files are written
 */
function syncFromDir(sourceDir, targetDir, extractFileNameFn, label, dryRun = false) {
  if (!fs.existsSync(sourceDir)) {
    console.error(`${colors.red}Error: Source directory not found: ${sourceDir}${colors.reset}`);
    process.exit(1);
  }

  const personaFiles = fs.readdirSync(sourceDir)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(sourceDir, f));

  console.log(`${colors.bright}${colors.cyan}=== ${label} Persona Sync ===${colors.reset}\n`);
  console.log(`${colors.blue}Source:${colors.reset} ${sourceDir}`);
  console.log(`${colors.blue}Target:${colors.reset} ${targetDir}`);
  console.log(`${colors.blue}Mode:${colors.reset} ${dryRun ? 'DRY RUN (preview only)' : 'COPY'}\n`);

  if (!dryRun && !fs.existsSync(targetDir)) {
    console.log(`${colors.yellow}Creating target directory: ${targetDir}${colors.reset}\n`);
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let copiedCount = 0;
  let skippedCount = 0;

  for (const filePath of personaFiles) {
    const deployName = extractFileNameFn(filePath);
    const relSrc = path.relative(path.join(__dirname, '..'), filePath);

    if (!deployName) {
      console.log(`${colors.yellow}⊘ Skipped:${colors.reset} ${relSrc} ${colors.yellow}(no deployable filename in frontmatter)${colors.reset}`);
      skippedCount++;
      continue;
    }

    const targetPath = path.join(targetDir, deployName);

    if (dryRun) {
      console.log(`${colors.cyan}→ Would copy:${colors.reset} ${relSrc} ${colors.cyan}→${colors.reset} ${deployName}`);
      copiedCount++;
    } else {
      try {
        fs.copyFileSync(filePath, targetPath);
        console.log(`${colors.green}✓ Copied:${colors.reset} ${relSrc} ${colors.green}→${colors.reset} ${deployName}`);
        copiedCount++;
      } catch (error) {
        console.error(`${colors.red}✗ Error copying ${relSrc}:${colors.reset}`, error.message);
        skippedCount++;
      }
    }
  }

  console.log(`\n${colors.bright}${colors.cyan}=== Summary ===${colors.reset}`);
  console.log(`${colors.green}${dryRun ? 'Would copy' : 'Copied'}:${colors.reset} ${copiedCount} file(s)`);
  console.log(`${colors.yellow}Skipped:${colors.reset} ${skippedCount} file(s)`);

  if (dryRun) {
    console.log(`\n${colors.yellow}This was a dry run. Run without --dry-run to actually copy files.${colors.reset}`);
  }
}

/**
 * Sync VS Code personas: personas/ledger/vs-code/ → VS Code prompts directory.
 * @param {boolean} dryRun
 * @param {string|null} customPath - Override the default VS Code prompts directory
 */
function syncVSCode(dryRun = false, customPath = null) {
  const sourceDir = path.join(__dirname, '..', 'personas', 'ledger', 'vs-code');
  const targetDir = customPath || getVSCodePromptsDir();
  syncFromDir(sourceDir, targetDir, extractVSFileName, 'VS Code', dryRun);
  validateVSCodeFrontmatter(sourceDir);
}

/**
 * Sync Claude Code personas: personas/ledger/claude-code/ → ~/.claude/agents/.
 * @param {boolean} dryRun
 */
function syncClaudeCode(dryRun = false) {
  const sourceDir = path.join(__dirname, '..', 'personas', 'ledger', 'claude-code');
  const targetDir = getClaudeCodeAgentsDir();
  syncFromDir(sourceDir, targetDir, extractCCFileName, 'Claude Code', dryRun);
  validateCCFrontmatter(sourceDir);
}

/**
 * Sync standalone Claude Code personas: personas/standalone/claude-code/ → ~/.claude/agents/.
 * @param {boolean} dryRun
 */
function syncStandaloneClaudeCode(dryRun = false) {
  const sourceDir = path.join(__dirname, '..', 'personas', 'standalone', 'claude-code');
  const targetDir = getClaudeCodeAgentsDir();
  syncFromDir(sourceDir, targetDir, extractCCFileName, 'Standalone Claude Code', dryRun);
  validateStandaloneCCFrontmatter(sourceDir);
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let customPath = null;
  let target = 'all'; // default: sync both targets

  const VALID_TARGETS = ['vscode', 'claude-code', 'all'];

  // Parse command-line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--custom-path' && i + 1 < args.length) {
      customPath = args[i + 1];
      i++;
    } else if (args[i] === '--target' && i + 1 < args.length) {
      const val = args[i + 1];
      if (!VALID_TARGETS.includes(val)) {
        console.error(`${colors.red}Error: Invalid --target value: "${val}". Valid values: ${VALID_TARGETS.join(', ')}${colors.reset}`);
        process.exit(1);
      }
      target = val;
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
${colors.bright}${colors.cyan}Multi-IDE Persona Sync Tool${colors.reset}

${colors.bright}Usage:${colors.reset}
  node scripts/sync-personas.js [options]

${colors.bright}Options:${colors.reset}
  --target <value>       Which IDE target to sync: vscode, claude-code, all (default: all)
  --dry-run              Preview without copying
  --custom-path <path>   Override default VS Code prompts directory (vscode target only)
  --help, -h             Show this help message

${colors.bright}Examples:${colors.reset}
  node scripts/sync-personas.js
  node scripts/sync-personas.js --target vscode
  node scripts/sync-personas.js --target claude-code --dry-run
  node scripts/sync-personas.js --dry-run
  node scripts/sync-personas.js --custom-path "C:\\Custom\\Path"
`);
      process.exit(0);
    }
  }

  try {
    // Build personas from source templates, forwarding --target and --dry-run
    const buildScript = path.join(__dirname, 'build-personas.js');
    const buildArgs = [];
    if (dryRun) buildArgs.push('--dry-run');
    if (target !== 'all') buildArgs.push('--target', target);

    console.log(`${colors.bright}${colors.cyan}=== Building Personas ===${colors.reset}\n`);
    execFileSync(process.execPath, [buildScript, ...buildArgs], { stdio: 'inherit' });
    console.log();

    // Sync to the requested target(s)
    if (target === 'vscode' || target === 'all') {
      syncVSCode(dryRun, customPath);
      console.log();
    }
    if (target === 'claude-code' || target === 'all') {
      syncClaudeCode(dryRun);
      console.log();
      syncStandaloneClaudeCode(dryRun);
    }
  } catch (error) {
    console.error(`${colors.red}Error:${colors.reset}`, error.message);
    process.exit(1);
  }
}

main();

