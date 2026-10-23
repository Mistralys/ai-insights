/**
 * scripts/publish-locations.js
 *
 * Single source of truth for persona publish locations.
 * Used by sync-personas.js (deploy) and cli.js (clean-agents).
 * Individual path helpers (getVSCodeSkillsDir, getClaudeCodeSkillsDir, etc.) are also imported
 * directly by publish-skills.js for skills deployment.
 *
 * Each location defines:
 *   - label:  Human-readable name for display
 *   - dir:    Resolved absolute path to the target directory
 *   - filter: Function to match persona files in that directory
 */

import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Home-relative location segments shared with the MCP server
 * (see shared/publish-locations.json and mcp-server/src/utils/publish-locations.ts).
 */
const LOCATIONS = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../shared/publish-locations.json'), 'utf-8')
);

/**
 * @param {string} key
 * @returns {string[]}
 */
function segmentsFor(key) {
  const segments = LOCATIONS[key];
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error(`shared/publish-locations.json: missing or invalid "${key}"`);
  }
  return segments;
}

/**
 * Resolve a location under the user's home directory. Locations that start with
 * the "copilot_home" segments are rebased onto $COPILOT_HOME when it is set,
 * mirroring Copilot CLI, which replaces ~/.copilot with it.
 * @param {'copilot_mcp_config'|'vscode_agents'|'vscode_skills'|'claude_agents'|'claude_skills'} key
 * @returns {string}
 */
function homeLocation(key) {
  const segments = segmentsFor(key);
  const base     = segmentsFor('copilot_home');
  const override = process.env.COPILOT_HOME?.trim();
  if (override && base.every((seg, i) => segments[i] === seg)) {
    return path.join(path.resolve(override), ...segments.slice(base.length));
  }
  return path.join(os.homedir(), ...segments);
}

/**
 * Determine the VS Code (GitHub Copilot) agents directory.
 * Personas live in ~/.copilot/agents/ on every platform.
 * @returns {string} Path to ~/.copilot/agents/ (or under $COPILOT_HOME)
 */
function getVSCodeAgentsDir() {
  return homeLocation('vscode_agents');
}

/**
 * Determine the VS Code (GitHub Copilot) global skills directory.
 * @returns {string} Path to ~/.copilot/skills/ (or under $COPILOT_HOME)
 */
function getVSCodeSkillsDir() {
  return homeLocation('vscode_skills');
}

/**
 * Determine the global Copilot MCP config file (read by Copilot CLI and VS Code).
 * @returns {string} Path to ~/.copilot/mcp-config.json (or under $COPILOT_HOME)
 */
function getCopilotMcpConfigPath() {
  return homeLocation('copilot_mcp_config');
}

/**
 * Determine the Claude Code agents directory.
 * @returns {string} Path to ~/.claude/agents/
 */
function getClaudeCodeAgentsDir() {
  return homeLocation('claude_agents');
}

/**
 * Determine the Claude Code skills directory.
 * @returns {string} Path to ~/.claude/skills/
 */
function getClaudeCodeSkillsDir() {
  return homeLocation('claude_skills');
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
    { label: 'VS Code agents',     dir: getVSCodeAgentsDir(),     filter: (f) => f.endsWith('.agent.md') },
    { label: 'Claude Code agents', dir: getClaudeCodeAgentsDir(), filter: (f) => f.endsWith('.md') },
  ];
}

export {
  getVSCodeAgentsDir,
  getVSCodeSkillsDir,
  getCopilotMcpConfigPath,
  getClaudeCodeAgentsDir,
  getClaudeCodeSkillsDir,
  getPublishLocations,
};
