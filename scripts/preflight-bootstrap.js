import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(import.meta.dirname, '..');

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

  // --- Ensure root node_modules are installed and up to date ---
  // Use node_modules/.package-lock.json mtime (updated by every npm install)
  // to detect whether package.json has changed since the last install.
  const pkgJson       = path.join(root, 'package.json');
  const internalLock  = path.join(root, 'node_modules', '.package-lock.json');
  const needsInstall  = !fs.existsSync(internalLock)
    || fs.statSync(pkgJson).mtimeMs > fs.statSync(internalLock).mtimeMs;
  if (needsInstall) {
    console.log(`[Bootstrap] Preparing ai-insights...`);
    try {
      execSync('npm install', { cwd: root, stdio: 'inherit' });
    } catch {
      console.error(`[Bootstrap] Failed to run npm install in ai-insights.`);
      process.exit(1);
    }
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
}

bootstrap();

