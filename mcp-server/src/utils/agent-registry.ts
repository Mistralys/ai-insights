import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Known agent roles for validation warnings.
 * Must match the AGENT_ROLES constant in workflow.ts.
 */
const KNOWN_AGENT_ROLES = [
  'Planner',
  'Project Manager',
  'Developer',
  'QA',
  'Reviewer',
  'Documentation',
  'Synthesis',
] as const;

/** Module-level cache: role → VS Code agent name */
let agentHandleMap: Record<string, string> = {};
let registryLoaded = false;

/**
 * Parses a simple YAML frontmatter block (the text between the first pair
 * of `---` delimiters at the top of a file) and extracts `name:` and `role:`.
 *
 * Handles both quoted strings (`name: '3 - Developer v3.1.2'`) and bare
 * strings (`role: Developer`).
 *
 * @returns An object with the parsed `name` and `role` string values, or
 *   `undefined` for each field if not found.
 */
function parseFrontmatter(content: string): { name?: string; role?: string } {
  // Frontmatter block must start at the very beginning of the file
  if (!content.startsWith('---')) {
    return {};
  }

  const afterFirst = content.slice(3);
  const closingIdx = afterFirst.indexOf('\n---');
  if (closingIdx === -1) {
    return {};
  }

  const frontmatter = afterFirst.slice(0, closingIdx);

  let name: string | undefined;
  let role: string | undefined;

  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.trim();

    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      name = stripYamlQuotes(nameMatch[1].trim());
      continue;
    }

    const roleMatch = line.match(/^role:\s*(.+)$/);
    if (roleMatch) {
      role = stripYamlQuotes(roleMatch[1].trim());
      continue;
    }
  }

  return { name, role };
}

/**
 * Strips leading/trailing single or double quotes from a YAML scalar value.
 * e.g. `'3 - Developer v3.1.2'` → `3 - Developer v3.1.2`
 */
function stripYamlQuotes(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Scans `agentsDir` for `*.agent.md` files, parses YAML frontmatter in each,
 * and builds an in-memory map from workflow `role` names to VS Code agent
 * `name` handles.
 *
 * Behaviour:
 * - Files without a `role:` field are silently skipped.
 * - Files with `role:` but without `name:` produce a `stderr` warning and are
 *   skipped.
 * - `role:` values that do not match a known agent role produce a `stderr`
 *   warning but are still added to the map (forward-compatible).
 * - If `agentsDir` does not exist or is unreadable, a warning is written to
 *   `stderr` and an empty map is returned.
 * - If no `*.agent.md` files are found, an empty map is returned silently.
 * - When two files share the same `role:` value, the **last** one wins.
 *
 * The result is stored in the module-level cache and returned.
 *
 * @param agentsDir - Absolute path to the directory containing `*.agent.md`
 *   files (e.g. the VS Code User prompts folder).
 * @returns A `Record<role, agentName>` mapping.
 */
export async function discoverAgents(agentsDir: string): Promise<Record<string, string>> {
  let entries: string[];

  try {
    entries = await readdir(agentsDir);
  } catch {
    process.stderr.write(
      `[agent-registry] Warning: could not read agents directory "${agentsDir}" — auto-handoff disabled.\n`,
    );
    agentHandleMap = {};
    registryLoaded = false;
    return {};
  }

  const agentFiles = entries.filter((e) => e.endsWith('.agent.md'));
  const newMap: Record<string, string> = {};

  for (const filename of agentFiles) {
    const filePath = join(agentsDir, filename);

    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      process.stderr.write(
        `[agent-registry] Warning: could not read file "${filePath}" — skipping.\n`,
      );
      continue;
    }

    const { name, role } = parseFrontmatter(content);

    if (!role) {
      // No role: field — silently skip (e.g. standalone agents like Researcher)
      continue;
    }

    if (!name) {
      process.stderr.write(
        `[agent-registry] Warning: "${filename}" has role: "${role}" but no name: field — skipping.\n`,
      );
      continue;
    }

    if (!(KNOWN_AGENT_ROLES as readonly string[]).includes(role)) {
      process.stderr.write(
        `[agent-registry] Warning: "${filename}" has unknown role: "${role}" — adding anyway.\n`,
      );
    }

    newMap[role] = name;
  }

  agentHandleMap = newMap;
  registryLoaded = Object.keys(newMap).length > 0;
  return { ...newMap };
}

/**
 * Looks up the VS Code agent handle for a given workflow role.
 *
 * @param role - The workflow role name (e.g. `"Developer"`, `"QA"`).
 * @returns The agent's `name` string (e.g. `"3 - Developer v3.1.2"`) or
 *   `null` if the role is not in the registry.
 */
export function getAgentHandle(role: string): string | null {
  return agentHandleMap[role] ?? null;
}

/**
 * Returns `true` if the registry has been populated by a successful
 * `discoverAgents()` call that found at least one agent file with a valid
 * `role:` field.
 */
export function isRegistryLoaded(): boolean {
  return registryLoaded;
}

/**
 * Clears the cached agent handle map and resets the loaded flag.
 * Intended for use in unit tests only.
 */
export function resetRegistry(): void {
  agentHandleMap = {};
  registryLoaded = false;
}
