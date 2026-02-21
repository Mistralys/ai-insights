#!/usr/bin/env node

/**
 * sync-personas.js
 * 
 * Copies persona files to VS Code's User prompts folder.
 * Reads the `vs_file_name` field from each persona file's YAML frontmatter and uses it as the target filename.
 * 
 * Usage:
 *   node sync-personas.js
 *   node sync-personas.js --dry-run    # Preview what would be copied without actually copying
 *   node sync-personas.js --custom-path "C:\Custom\Path"  # Use custom target directory
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
 * Validate frontmatter in all persona files under the ledger/ subdirectory.
 * Emits advisory warnings if a file is missing a `role:` field, or has `role:`
 * but is missing a `name:` field. Does NOT block the sync process.
 *
 * @param {string} ledgerDir - Absolute path to the personas/ledger/ directory
 */
function validateLedgerFrontmatter(ledgerDir) {
  if (!fs.existsSync(ledgerDir)) return;

  const files = fs.readdirSync(ledgerDir).filter(f => f.endsWith('.md'));

  console.log(`\n${colors.bright}${colors.cyan}=== Ledger Frontmatter Validation ===${colors.reset}`);

  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(ledgerDir, file);
    let rawContent;
    try {
      rawContent = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.warn(`${colors.yellow}⚠ ${file}: could not read file — ${err.message}${colors.reset}`);
      warningCount++;
      continue;
    }

    // Strip optional AUTO-GENERATED comment header produced by build-personas.js
    const content = rawContent.startsWith('<!--') ? rawContent.slice(rawContent.indexOf('\n') + 1) : rawContent;

    // Only validate files that start with YAML frontmatter
    if (!content.startsWith('---')) continue;

    const afterFirst = content.slice(3);
    const closingIdx = afterFirst.indexOf('\n---');
    if (closingIdx === -1) continue;

    const frontmatter = afterFirst.slice(0, closingIdx);

    let role = null;
    let name = null;

    for (const line of frontmatter.split('\n')) {
      const trimmed = line.trim();
      const roleMatch = trimmed.match(/^role:\s*(.+)$/);
      if (roleMatch) {
        role = roleMatch[1].trim().replace(/^['"]|['"]$/g, '');
        continue;
      }
      const nameMatch = trimmed.match(/^name:\s*(.+)$/);
      if (nameMatch) {
        name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
        continue;
      }
    }

    const relPath = path.join('ledger', file);

    if (!role) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'role:' field in frontmatter${colors.reset}`);
      warningCount++;
    } else if (!KNOWN_ROLES.includes(role)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: unknown role "${role}" in frontmatter. Expected one of: ${KNOWN_ROLES.join(', ')}${colors.reset}`);
      warningCount++;
    } else if (!name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: has 'role: ${role}' but missing 'name:' field in frontmatter${colors.reset}`);
      warningCount++;
    }
  }

  if (warningCount === 0) {
    console.log(`${colors.green}✓ All ${files.length} ledger persona file(s) passed frontmatter validation${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${warningCount} frontmatter warning(s) found — sync was not blocked${colors.reset}`);
  }
}

/**
 * Copy persona files to VS Code prompts directory
 * @param {string} targetDir - Target directory for copying
 * @param {boolean} dryRun - If true, only preview what would be copied
 */
function syncPersonas(targetDir, dryRun = false) {
  const personasDir = path.join(__dirname, 'personas');

  // Check if personas directory exists
  if (!fs.existsSync(personasDir)) {
    console.error(`${colors.red}Error: Personas directory not found at ${personasDir}${colors.reset}`);
    process.exit(1);
  }

  // Find all markdown files in personas directory (excluding source/build subdirs)
  const excludeDirs = [
    path.join(personasDir, 'ledger', 'src'),
  ];
  const personaFiles = findMarkdownFiles(personasDir, [], excludeDirs);

  console.log(`${colors.bright}${colors.cyan}=== VS Code Persona Sync ===${colors.reset}\n`);
  console.log(`${colors.blue}Source:${colors.reset} ${personasDir}`);
  console.log(`${colors.blue}Target:${colors.reset} ${targetDir}`);
  console.log(`${colors.blue}Mode:${colors.reset} ${dryRun ? 'DRY RUN (preview only)' : 'COPY'}\n`);

  // Create target directory if it doesn't exist (unless dry run)
  if (!dryRun && !fs.existsSync(targetDir)) {
    console.log(`${colors.yellow}Creating target directory: ${targetDir}${colors.reset}\n`);
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let copiedCount = 0;
  let skippedCount = 0;

  // Process each persona file
  personaFiles.forEach(filePath => {
    const vsFileName = extractVSFileName(filePath);

    if (!vsFileName) {
      console.log(`${colors.yellow}⊘ Skipped:${colors.reset} ${path.relative(personasDir, filePath)} ${colors.yellow}(no vs_file_name in frontmatter)${colors.reset}`);
      skippedCount++;
      return;
    }

    const targetPath = path.join(targetDir, vsFileName);
    const relativeSourcePath = path.relative(personasDir, filePath);

    if (dryRun) {
      console.log(`${colors.cyan}→ Would copy:${colors.reset} ${relativeSourcePath} ${colors.cyan}→${colors.reset} ${vsFileName}`);
      copiedCount++;
    } else {
      try {
        fs.copyFileSync(filePath, targetPath);
        console.log(`${colors.green}✓ Copied:${colors.reset} ${relativeSourcePath} ${colors.green}→${colors.reset} ${vsFileName}`);
        copiedCount++;
      } catch (error) {
        console.error(`${colors.red}✗ Error copying ${relativeSourcePath}:${colors.reset}`, error.message);
        skippedCount++;
      }
    }
  });

  // Summary
  console.log(`\n${colors.bright}${colors.cyan}=== Summary ===${colors.reset}`);
  console.log(`${colors.green}${dryRun ? 'Would copy' : 'Copied'}:${colors.reset} ${copiedCount} file(s)`);
  console.log(`${colors.yellow}Skipped:${colors.reset} ${skippedCount} file(s)`);

  if (dryRun) {
    console.log(`\n${colors.yellow}This was a dry run. Run without --dry-run to actually copy files.${colors.reset}`);
  }
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let customPath = null;

  // Parse command-line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--custom-path' && i + 1 < args.length) {
      customPath = args[i + 1];
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
${colors.bright}${colors.cyan}VS Code Persona Sync Tool${colors.reset}

${colors.bright}Usage:${colors.reset}
  node sync-personas.js [options]

${colors.bright}Options:${colors.reset}
  --dry-run              Preview what would be copied without actually copying
  --custom-path <path>   Use a custom target directory instead of the default VS Code prompts folder
  --help, -h             Show this help message

${colors.bright}Examples:${colors.reset}
  node sync-personas.js
  node sync-personas.js --dry-run
  node sync-personas.js --custom-path "C:\\Custom\\Path"
`);
      process.exit(0);
    }
  }

  try {
    // Build personas from source templates before copying
    const buildScript = path.join(__dirname, 'personas', 'build-personas.js');
    const buildArgs = dryRun ? ['--dry-run'] : [];
    console.log(`${colors.bright}${colors.cyan}=== Building Personas ===${colors.reset}\n`);
    execFileSync(process.execPath, [buildScript, ...buildArgs], { stdio: 'inherit' });
    console.log();

    const targetDir = customPath || getVSCodePromptsDir();
    syncPersonas(targetDir, dryRun);
    validateLedgerFrontmatter(path.join(__dirname, 'personas', 'ledger'));
  } catch (error) {
    console.error(`${colors.red}Error:${colors.reset}`, error.message);
    process.exit(1);
  }
}

main();
