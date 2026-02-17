#!/usr/bin/env node

/**
 * sync-personas.js
 * 
 * Copies persona files to VS Code's User prompts folder.
 * Reads the "VS File Name" metadata from each persona file and uses it as the target filename.
 * 
 * Usage:
 *   node sync-personas.js
 *   node sync-personas.js --dry-run    # Preview what would be copied without actually copying
 *   node sync-personas.js --custom-path "C:\Custom\Path"  # Use custom target directory
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

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
 * Extract the VS File Name from a persona file's metadata
 * @param {string} filePath - Path to the persona file
 * @returns {string|null} - The VS File Name or null if not found
 */
function extractVSFileName(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/VS File Name:\s*(.+)/);
    return match ? match[1].trim() : null;
  } catch (error) {
    console.error(`${colors.red}Error reading file ${filePath}:${colors.reset}`, error.message);
    return null;
  }
}

/**
 * Recursively find all markdown files in a directory
 * @param {string} dir - Directory to search
 * @param {string[]} fileList - Accumulator for found files
 * @returns {string[]} - Array of file paths
 */
function findMarkdownFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      findMarkdownFiles(filePath, fileList);
    } else if (file.endsWith('.md')) {
      fileList.push(filePath);
    }
  });

  return fileList;
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

  // Find all markdown files in personas directory
  const personaFiles = findMarkdownFiles(personasDir);

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
      console.log(`${colors.yellow}⊘ Skipped:${colors.reset} ${path.relative(personasDir, filePath)} ${colors.yellow}(no VS File Name metadata)${colors.reset}`);
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
    const targetDir = customPath || getVSCodePromptsDir();
    syncPersonas(targetDir, dryRun);
  } catch (error) {
    console.error(`${colors.red}Error:${colors.reset}`, error.message);
    process.exit(1);
  }
}

main();
