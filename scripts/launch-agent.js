#!/usr/bin/env node

/**
 * scripts/launch-agent.js
 *
 * Thin CLI entry point for `ai-insights agent`. Scans the deployed Claude
 * Code personas in ~/.claude/agents/, presents a type-to-filter picker, and
 * launches `claude --agent <id>` with the selection.
 *
 * After the launched `claude` session exits, control returns to the picker
 * rather than to the caller (typically the AI Insights main menu) — exiting
 * a Claude session usually means "switch agents," so looping here keeps
 * that the default, one-key-away action. The loop only ends when the
 * picker itself is cancelled (Escape / Ctrl+C / empty input), at which
 * point this process exits and the caller regains control.
 *
 * All discovery/filtering/reducer logic and both picker I/O shells live in
 * scripts/lib/launch-agent-core.js — this file contains only process
 * wiring (arg parsing, preflight checks, dispatch, spawn + exit-code
 * forwarding) and no test-importable logic, so main() is invoked
 * unconditionally at the bottom with no run-guard, matching every other
 * standalone script under scripts/.
 *
 * Usage:
 *   node scripts/launch-agent.js
 *   node scripts/launch-agent.js --filter <term>
 *   node scripts/launch-agent.js -- --some-claude-flag
 */

import { spawn } from 'child_process';
import { isRawModeSupported } from '@mistralys/cli-menu';
import { getClaudeCodeAgentsDir } from './publish-locations.js';
import { isClaudeCliAvailable } from './lib/claude-cli.js';
import { discoverAgents, runInteractivePicker, runNonInteractivePicker } from './lib/launch-agent-core.js';
import { getOriginalCwd } from './lib/original-cwd.js';

function parseArgs(argv) {
  const separatorIndex = argv.indexOf('--');
  const ownArgs = separatorIndex !== -1 ? argv.slice(0, separatorIndex) : argv;
  const passthroughArgs = separatorIndex !== -1 ? argv.slice(separatorIndex + 1) : [];

  let filter = '';
  const filterIndex = ownArgs.indexOf('--filter');
  if (filterIndex !== -1 && ownArgs[filterIndex + 1] !== undefined) {
    filter = ownArgs[filterIndex + 1];
  }

  return { filter, passthroughArgs };
}

async function main() {
  const { filter, passthroughArgs } = parseArgs(process.argv.slice(2));

  const agentsDir = getClaudeCodeAgentsDir();
  const agents = discoverAgents(agentsDir);

  if (agents.length === 0) {
    console.error(
      `No personas found in ${agentsDir}.\nRun "ai-insights sync-personas" (or "./menu.sh sync-personas") to deploy them first.`,
    );
    process.exit(1);
    return;
  }

  if (!isClaudeCliAvailable()) {
    console.error('The "claude" CLI was not found on PATH. Install Claude Code before running this command.');
    process.exit(1);
    return;
  }

  // First pass honors --filter (if given); the picker is re-shown with no
  // pre-filter on every subsequent loop iteration.
  let pickerFilter = filter;

  for (;;) {
    // Both picker implementations clear the screen themselves before their
    // first draw (the AI Insights main menu on first entry, or the previous
    // claude session's output on a loop-back), so the picker always opens
    // against a clean screen.
    const selectedId = isRawModeSupported()
      ? await runInteractivePicker(agents)
      : await runNonInteractivePicker(agents, pickerFilter);
    pickerFilter = '';

    if (!selectedId) {
      console.log('Cancelled.');
      process.exit(0);
      return;
    }

    await new Promise((resolve) => {
      const child = spawn('claude', ['--agent', selectedId, ...passthroughArgs], {
        stdio: 'inherit',
        cwd: getOriginalCwd(),
      });

      child.on('error', (err) => {
        console.error(`Failed to launch "claude --agent ${selectedId}": ${err.message}`);
        resolve(1);
      });

      child.on('close', (code) => {
        resolve(code ?? 0);
      });
    });
  }
}

main();
