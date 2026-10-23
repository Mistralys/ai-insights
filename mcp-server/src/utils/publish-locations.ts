/**
 * Persona deploy locations shared with the persona sync scripts.
 *
 * The segments come from `shared/publish-locations.json`, the single source of
 * truth also read by `scripts/publish-locations.js`, so the sync target and the
 * agent registry's default directory cannot drift apart.
 */
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const _require = createRequire(import.meta.url);

interface PublishLocations {
  copilot_home: string[];
  vscode_agents: string[];
}

function loadLocations(): PublishLocations {
  const raw = _require('../../../shared/publish-locations.json') as Partial<PublishLocations>;
  for (const key of ['copilot_home', 'vscode_agents'] as const) {
    if (!Array.isArray(raw[key]) || raw[key]!.length === 0) {
      throw new Error(`shared/publish-locations.json: missing or invalid "${key}"`);
    }
  }
  return { copilot_home: raw.copilot_home!, vscode_agents: raw.vscode_agents! };
}

/**
 * Default VS Code (GitHub Copilot) agents directory: `~/.copilot/agents`.
 * Rebased onto `$COPILOT_HOME` when set, as Copilot CLI replaces `~/.copilot` with it.
 */
export function getVSCodeAgentsDir(): string {
  const { copilot_home: base, vscode_agents: segments } = loadLocations();
  const override = process.env.COPILOT_HOME?.trim();
  if (override && base.every((seg, i) => segments[i] === seg)) {
    return join(resolve(override), ...segments.slice(base.length));
  }
  return join(homedir(), ...segments);
}
