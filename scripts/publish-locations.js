/**
 * scripts/publish-locations.js
 *
 * Single source of truth for persona publish locations.
 * Used by sync-personas.js (deploy) and cli.js (clean-agents).
 *
 * Each location defines:
 *   - label:  Human-readable name for display
 *   - dir:    Resolved absolute path to the target directory
 *   - filter: Function to match persona files in that directory
 */

import path from 'path';
import os from 'os';

/**
 * Determine the VS Code User prompts directory based on the platform.
 * @returns {string}
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
 * Determine the Claude Code agents directory.
 * @returns {string} Path to ~/.claude/agents/
 */
function getClaudeCodeAgentsDir() {
  return path.join(os.homedir(), '.claude', 'agents');
}

/**
 * Determine the Claude Code skills directory.
 * @returns {string} Path to ~/.claude/skills/
 */
function getClaudeCodeSkillsDir() {
  return path.join(os.homedir(), '.claude', 'skills');
}

/**
 * Return all persona publish locations.
 * Adding a new target here automatically makes it available to both
 * sync-personas (deploy) and cli.js clean-agents (cleanup).
 *
 * @returns {Array<{label: string, dir: string, filter: (filename: string) => boolean}>}
 */
function getPublishLocations() {
  return [
    { label: 'VS Code prompts',    dir: getVSCodePromptsDir(),    filter: (f) => f.endsWith('.agent.md') },
    { label: 'Claude Code agents', dir: getClaudeCodeAgentsDir(), filter: (f) => f.endsWith('.md') },
    { label: 'Claude Code skills', dir: getClaudeCodeSkillsDir(), filter: (f) => f.endsWith('.md') },
  ];
}

export {
  getVSCodePromptsDir,
  getClaudeCodeAgentsDir,
  getClaudeCodeSkillsDir,
  getPublishLocations,
};
