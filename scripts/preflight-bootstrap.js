import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SIBLING_DIR = path.resolve(ROOT, '..');

/** Canonical repository clone URLs (no embedded credentials). */
const SIBLING_CLONE_URLS = {
  'ai-persona-builder':'https://github.com/Mistralys/ai-persona-builder.git',
};

/**
 * Return the latest mtime (ms) of any file found recursively inside `dir`.
 * Returns 0 if the directory does not exist or is empty.
 * Uses fs.statSync only — no subprocess is spawned.
 */
function latestMtime(dir) {
  if (!fs.existsSync(dir)) return 0;
  let latest = 0;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    try {
      const { mtimeMs } = fs.statSync(full);
      if (mtimeMs > latest) latest = mtimeMs;
    } catch { /* ignore permission errors on individual files */ }
  }
  return latest;
}

/**
 * Return true when `srcDir` contains a file newer than `distFile`.
 * Considers the dist stale (returns true) when `distFile` does not exist.
 * Uses mtime comparison only — no subprocess is spawned for the check.
 */
function isStale(srcDir, distFile) {
  if (!fs.existsSync(distFile)) return true;
  const srcMtime  = latestMtime(srcDir);
  const distMtime = fs.statSync(distFile).mtimeMs;
  return srcMtime > distMtime;
}

function bootstrap() {
  const root = ROOT;
  const workspaceRoot = SIBLING_DIR;
  const personaBuilderDir = path.join(workspaceRoot, 'ai-persona-builder');

  // --- Missing sibling repo guidance ---
  if (!fs.existsSync(personaBuilderDir)) {
    console.log(`[Bootstrap] Sibling repo 'ai-persona-builder' not found.`);
    console.log(`           Run: git clone ${SIBLING_CLONE_URLS['ai-persona-builder']} ${personaBuilderDir}`);
  }

  // --- mcp-server staleness detection (mtime comparison only) ---
  const mcpSrcDir  = path.join(root, 'mcp-server', 'src');
  const mcpDistFile = path.join(root, 'mcp-server', 'dist', 'index.js');
  if (isStale(mcpSrcDir, mcpDistFile)) {
    console.log(`[Bootstrap] mcp-server source is newer than dist, rebuilding...`);
    try {
      execSync('npm run build', { cwd: path.join(root, 'mcp-server'), stdio: 'inherit' });
    } catch {
      console.error(`[Bootstrap] Failed to rebuild mcp-server.`);
      process.exit(1);
    }
  }

  // --- Sibling repo: install + build (initial setup and staleness) ---
  const packages = [
    {
      name:     '@mistralys/persona-builder',
      dir:      personaBuilderDir,
      distFile: path.join(personaBuilderDir, 'dist', 'index.js'),
    },
  ];

  let builtAny = false;

  for (const pkg of packages) {
    if (!fs.existsSync(pkg.dir)) continue;

    const distDir    = path.join(pkg.dir, 'dist');
    const nodeModules = path.join(pkg.dir, 'node_modules');
    const srcDir     = path.join(pkg.dir, 'src');

    const stale = !fs.existsSync(distDir)
               || !fs.existsSync(nodeModules)
               || isStale(srcDir, pkg.distFile);

    if (stale) {
      console.log(`[Bootstrap] Preparing ${pkg.name}...`);
      try {
        if (!fs.existsSync(nodeModules)) {
          execSync('npm install', { cwd: pkg.dir, stdio: 'inherit' });
        }
        execSync('npm run build', { cwd: pkg.dir, stdio: 'inherit' });
        builtAny = true;
      } catch {
        console.error(`[Bootstrap] Failed to prepare ${pkg.name}.`);
        process.exit(1);
      }
    }
  }

  // Also ensure ai-insights root has node_modules
  const insightsModules = path.join(root, 'node_modules');
  if (builtAny || !fs.existsSync(insightsModules)) {
    console.log(`[Bootstrap] Preparing ai-insights...`);
    try {
      execSync('npm install', { cwd: root, stdio: 'inherit' });
    } catch {
      console.error(`[Bootstrap] Failed to run npm install in ai-insights.`);
      process.exit(1);
    }
  }
}

bootstrap();

