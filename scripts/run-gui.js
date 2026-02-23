#!/usr/bin/env node

/**
 * run-gui.js
 *
 * Launches the MCP GUI server from the workspace root and opens the default
 * browser once the server is ready.
 * Delegates to `tsx gui/server.ts` inside mcp-server/.
 *
 * Usage (from workspace root):
 *   node scripts/run-gui.js
 *   node scripts/run-gui.js -- --port 3421
 *   node scripts/run-gui.js -- --port 3421 --ledger-dir "C:\path\to\ledger"
 *
 * CLI arguments after `--` are forwarded to the GUI server process.
 */

const { spawn } = require('child_process');
const { createInterface } = require('readline');
const path = require('path');

const MCP_SERVER_DIR = path.resolve(__dirname, '..', 'mcp-server');

// Collect args to forward: everything after a bare `--` separator, or all
// extra args if no separator is present.
const separatorIndex = process.argv.indexOf('--');
const forwardedArgs =
  separatorIndex !== -1 ? process.argv.slice(separatorIndex + 1) : process.argv.slice(2);

// Derive the port from forwarded args so we can open the right URL.
const portFlagIndex = forwardedArgs.indexOf('--port');
const port =
  portFlagIndex !== -1 && forwardedArgs[portFlagIndex + 1]
    ? parseInt(forwardedArgs[portFlagIndex + 1], 10)
    : 3420;
const guiUrl = `http://localhost:${port}`;

const isWindows = process.platform === 'win32';

// Open the system's default browser (cross-platform).
function openBrowser(url) {
  const isMac = process.platform === 'darwin';
  if (isWindows) {
    // Use cmd /c start so we never need to locate an executable.
    spawn('cmd', ['/c', 'start', '""', url], { shell: false, stdio: 'ignore', detached: true }).unref();
  } else {
    const cmd = isMac ? 'open' : 'xdg-open';
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  }
}

// Build the command: `npx tsx gui/server.ts [...forwardedArgs]`
// On Windows .cmd files must be run through the shell.
const child = spawn('npx', ['tsx', 'gui/server.ts', ...forwardedArgs], {
  cwd: MCP_SERVER_DIR,
  stdio: ['inherit', 'pipe', 'inherit'],
  shell: isWindows,
});

// Watch stdout for the ready message, then pass all lines through to the
// parent terminal as normal.
let browserOpened = false;
const rl = createInterface({ input: child.stdout });

rl.on('line', (line) => {
  process.stdout.write(line + '\n');
  if (!browserOpened && line.includes('GUI dashboard running at')) {
    browserOpened = true;
    console.log(`[run-gui] Opening ${guiUrl} in your default browser…`);
    openBrowser(guiUrl);
  }
});

child.on('error', (err) => {
  console.error(`[run-gui] Failed to start GUI server: ${err.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
