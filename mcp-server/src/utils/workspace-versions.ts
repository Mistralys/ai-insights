import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Package root: from src/utils/ (dev) or dist/utils/ (compiled) up two levels → mcp-server/
const serverDir = join(__dirname, '..', '..');

// Workspace root: from mcp-server/ up one level → ai-insights/
const workspaceRoot = join(serverDir, '..');

const MCP_SERVER_PACKAGE_JSON = join(serverDir, 'package.json');
const PERSONAS_PACKAGE_JSON = join(workspaceRoot, 'personas', 'package.json');
const ORCHESTRATOR_PYPROJECT = join(workspaceRoot, 'orchestrator', 'pyproject.toml');

/** Version strings for all three workspace components. */
export type WorkspaceVersions = {
  mcpServer: string;
  personas: string;
  orchestrator: string;
};

/**
 * Reads the current on-disk version strings for the MCP server, personas build
 * system, and orchestrator.
 *
 * All reads are synchronous. Throws if any version file is missing or unreadable.
 * There is no silent fallback — a missing file is always an error.
 *
 * Safe to call from both `src/utils/` (dev via tsx) and `dist/utils/` (compiled):
 * the relative path offsets are identical in both cases.
 */
export function captureWorkspaceVersions(): WorkspaceVersions {
  const mcpServer = JSON.parse(readFileSync(MCP_SERVER_PACKAGE_JSON, 'utf-8')).version as string;
  const personas = JSON.parse(readFileSync(PERSONAS_PACKAGE_JSON, 'utf-8')).version as string;

  const toml = readFileSync(ORCHESTRATOR_PYPROJECT, 'utf-8');
  const match = toml.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(
      `Could not parse orchestrator version from ${ORCHESTRATOR_PYPROJECT}`
    );
  }
  const orchestrator = match[1] as string;

  return { mcpServer, personas, orchestrator };
}
