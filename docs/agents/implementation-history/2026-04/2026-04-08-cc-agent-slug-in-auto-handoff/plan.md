# Plan

## Summary

Eliminate the brittle Claude Code agent name derivation in persona handoff instructions by generating a `name-mapping.json` file during the persona build process and having the MCP server load it to provide target-specific agent names (`cc_agent_name`, `vs_agent_name`, `da_agent_name`) directly in the `auto_handoff` response.

Currently, CC personas must regex-transform `agent_name` (a VS Code–centric display name like `"4 - QA v3.5.0"`) into a CC slug (`4-qa`) using fragile string manipulation. The persona builder already has all the naming metadata in per-persona YAML files — it should emit a structured mapping file that the MCP server reads at startup.

## Architectural Context

- **Persona YAML metadata** (`personas/ledger/src/meta/N-*.yaml`) defines per-persona fields including `cc_file_name` (`3-developer.md`), `vs_file_name` (`3-dev.agent.md`), `da_file_name` (`3-developer.md`), `role`, `number`, `version`, and `id` (`ledger-3-dev`).
- **Shared metadata** (`personas/ledger/src/meta/_shared.yaml`) provides `default_version` (`3.5.0`) used as fallback when a persona omits `version`.
- **Frontmatter templates** compute the target-specific agent names at build time:
  - VS Code: `{{number}} - {{role}} v{{version}}` → `3 - Developer v3.6.1`
  - Claude Code: `{{cc_name}}` (= `cc_file_name` stem) → `3-developer`
  - Deep Agents: `{{id}}` → `ledger-3-dev`
- **Build script** (`scripts/build-personas.js`) delegates to the persona builder CLI and already has a post-build phase (version sync). Adding JSON generation here is a natural extension.
- **Workflow manifest** (`shared/workflow-manifest.json`) is the single source of truth for roles. The MCP server loads it at startup via `createRequire` with a relative path. The same pattern works for the new mapping file.
- **Constants** (`mcp-server/src/utils/constants.ts`) derives `AGENT_ROLES`, `ROLE_IDS`, etc. from the manifest at load time. A similar pattern will load the name mapping.
- **Auto-handoff builder** (`mcp-server/src/tools/workflow-handoff.ts`, ~L218) assembles the `auto_handoff` payload with `agent_name` (VS Code display name from registry), optional `agent_id`, and `prompt`.
- **CC handoff partial** (`personas/ledger/src/partials/handoff-block-claude-code.md`) instructs agents to derive the CC slug from `agent_name` using string manipulation.
- **Workflow spec** (`mcp-server/docs/agents/workflow-specification/auxiliary-systems.md`, §18.3) documents the `auto_handoff` response structure.

## Approach / Architecture

Three-layer change:

1. **Persona build** (producer) — `scripts/build-personas.js` reads persona YAML metadata after the build and writes `personas/name-mapping.json`.
2. **MCP server** (consumer) — loads `name-mapping.json` at startup, builds a `role → names` lookup, and includes `cc_agent_name`, `vs_agent_name`, and `da_agent_name` in every `auto_handoff` response.
3. **Persona partials** (instructions) — CC handoff partial simplified to read `auto_handoff.cc_agent_name` directly.

```
Build time:
  YAML metadata ──► build-personas.js ──► personas/name-mapping.json

Runtime:
  name-mapping.json ──► MCP server constants ──► auto_handoff response
                                                   ├── cc_agent_name: "3-developer"
                                                   ├── vs_agent_name: "3 - Developer v3.6.1"
                                                   └── da_agent_name: "3-developer"
```

### Name Mapping File Structure

**Path:** `personas/name-mapping.json` (checked into Git, regenerated on every persona build)

```json
[
  {
    "role": "Developer",
    "number": 3,
    "id": "ledger-3-dev",
    "version": "3.6.1",
    "vscode": {
      "file_name": "3-dev.agent.md",
      "agent_name": "3 - Developer v3.6.1"
    },
    "claude_code": {
      "file_name": "3-developer.md",
      "agent_name": "3-developer"
    },
    "deep_agents": {
      "file_name": "3-developer.md",
      "agent_name": "3-developer"
    }
  }
]
```

**Design rationale for the structure:**

- **`role`** as the primary key — matches the manifest's `name` field and how handoff resolution identifies agents. The MCP server does lookups by role name (e.g. `"Developer"`, `"QA"`).
- **`number`** for ordering context and human readability (array is sorted by number).
- **`id`** (e.g. `ledger-3-dev`) — the VS Code persona `id` field, already used in `auto_handoff.agent_id`. Including it here allows the mapping file to be a self-contained reference.
- **`version`** — the persona's actual version (per-persona override or `default_version` fallback), needed to compose the VS Code agent name.
- **Per-target blocks** (`vscode`, `claude_code`, `deep_agents`) each contain:
  - `file_name` — the output filename (useful for deployment tooling and cross-reference).
  - `agent_name` — the canonical name used to invoke/route to this agent on that platform.
- **No `tool_prefix`** — that's a build-system concept, not runtime metadata. The field names in the `auto_handoff` response (`cc_agent_name`, `vs_agent_name`, `da_agent_name`) are fixed by the MCP server code, not derived from data.
- **Array, not object** — maintains ordering (sorted by `number`). The MCP server builds a `Record<AgentRole, ...>` map at load time from the array, just like it does with the manifest's `roles` array.

## Rationale

- **Persona builder as naming authority**: The builder already computes every agent name variant at build time. Emitting a structured mapping makes the MCP server a consumer rather than a re-implementer of naming logic.
- **Future-proof**: Adding a new target platform means adding a new block to the mapping — no MCP server code changes needed for the lookup.
- **Eliminates fragility**: The current regex-based derivation assumes `agent_name` follows the pattern `"N - RoleName vX.Y.Z"`. Any naming change (version format, prefix convention, display name) would silently break CC handoffs.
- **All targets served equally**: By including `vs_agent_name` and `da_agent_name` alongside `cc_agent_name`, the handoff response becomes platform-agnostic. Any consumer can pick the right name for its target.
- **Checked into Git**: The mapping file is a build artifact that's deterministic from the YAML sources. Checking it in ensures the MCP server works without running the persona build first and makes changes visible in diffs.
- **Option (a) — additive**: The existing `agent_name` from the VS Code agent registry is preserved in `auto_handoff`. The new fields supplement it. Decoupling from the registry entirely (option b) is deferred.

## Detailed Steps

### 1. Generate `personas/name-mapping.json` in `scripts/build-personas.js`

Add a post-build step after the existing version sync. The script reads the ledger persona YAML metadata files and `_shared.yaml`, computes the agent names using the same formulas the builder uses, and writes the JSON:

```javascript
// Post-build: generate personas/name-mapping.json
if (!CHECK) {
  const yaml = require('js-yaml'); // already a dependency of personas/

  const META_DIR = path.join(PERSONAS, 'ledger', 'src', 'meta');
  const shared = yaml.load(fs.readFileSync(path.join(META_DIR, '_shared.yaml'), 'utf8'));
  const defaultVersion = shared.default_version;

  const files = fs.readdirSync(META_DIR)
    .filter(f => /^\d+-/.test(f) && f.endsWith('.yaml'))
    .sort();

  const mapping = files.map(f => {
    const meta = yaml.load(fs.readFileSync(path.join(META_DIR, f), 'utf8'));
    const version = meta.version || defaultVersion;
    const ccStem = meta.cc_file_name.replace(/\.md$/, '');
    const daStem = (meta.da_file_name || meta.cc_file_name).replace(/\.md$/, '');
    return {
      role: meta.role,
      number: meta.number,
      id: meta.id,
      version,
      vscode: {
        file_name: meta.vs_file_name,
        agent_name: `${meta.number} - ${meta.role} v${version}`,
      },
      claude_code: {
        file_name: meta.cc_file_name,
        agent_name: ccStem,
      },
      deep_agents: {
        file_name: meta.da_file_name || meta.cc_file_name,
        agent_name: daStem,
      },
    };
  });

  const outPath = path.join(PERSONAS, 'name-mapping.json');
  fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2) + '\n', 'utf8');
  console.log(`Generated ${path.relative(ROOT, outPath)} (${mapping.length} entries)`);
}
```

This is deterministic — the same YAML inputs always produce the same JSON output.

### 2. Load the mapping in `mcp-server/src/utils/constants.ts`

Add a new constant alongside `ROLE_IDS`:

```typescript
// ── Name mapping from persona build ─────────────────────────────────────────

interface TargetNames {
  file_name: string;
  agent_name: string;
}

interface NameMappingEntry {
  role: string;
  number: number;
  id: string;
  version: string;
  vscode: TargetNames;
  claude_code: TargetNames;
  deep_agents: TargetNames;
}

const nameMapping: NameMappingEntry[] = _require('../../../personas/name-mapping.json');

/**
 * Map of agent role → target-specific agent names.
 * Loaded from `personas/name-mapping.json` (generated by build-personas.js).
 */
export const AGENT_NAMES: Record<AgentRole, NameMappingEntry> = Object.fromEntries(
  nameMapping.map(e => [e.role, e])
) as Record<AgentRole, NameMappingEntry>;
```

The `_require` / `createRequire` pattern is already used for loading `workflow-manifest.json`.

### 3. Include target-specific names in the `auto_handoff` response

In `mcp-server/src/tools/workflow-handoff.ts`, inside the block that populates `payload.auto_handoff` (~L218):

```typescript
import { AGENT_NAMES } from '../utils/constants.js';

const names = nextAgent ? AGENT_NAMES[nextAgent] : undefined;
payload.auto_handoff = {
  agent_name: agentName,
  ...(agentId !== null ? { agent_id: agentId } : {}),
  ...(names ? {
    cc_agent_name: names.claude_code.agent_name,
    vs_agent_name: names.vscode.agent_name,
    da_agent_name: names.deep_agents.agent_name,
  } : {}),
  prompt: buildHandoffPrompt(projectPath, agentId ?? undefined),
};
```

`nextAgent` is guaranteed non-null at this point (the code already validated `agentName !== null` which depends on `nextAgent`), so the lookup always succeeds.

### 4. Update the CC handoff partial

In `personas/ledger/src/partials/handoff-block-claude-code.md`, replace the regex-derivation instructions:

**Before:**
```markdown
Derive the CC sub-agent name from `auto_handoff.agent_name` using this rule:
strip the version suffix (e.g. `v3.5.0`), trim, lowercase, replace ` - `
with `-`, replace remaining spaces with `-`. Examples: ...
```

**After:**
```markdown
- **`auto_handoff` present** — Invoke the `Task` tool immediately with these parameters:
  - `description`: The sub-agent name from `auto_handoff.cc_agent_name` (e.g. `3-developer`).
  - `prompt`: the value of `auto_handoff.prompt`
```

### 5. Rebuild persona output

Run `node scripts/build-personas.js` to regenerate all persona files. This both produces the updated CC persona files (with simplified handoff instructions) and generates the initial `personas/name-mapping.json`.

### 6. Update workflow specification

In `mcp-server/docs/agents/workflow-specification/auxiliary-systems.md` (§18.3), update the auto_handoff payload pseudocode:

```
include auto_handoff in response payload:
  {
    agent_name: nextAgentHandle,
    ...(agentId !== null ? { agent_id: agentId } : {}),
    cc_agent_name: AGENT_NAMES[nextAgent].claude_code.agent_name,
    vs_agent_name: AGENT_NAMES[nextAgent].vscode.agent_name,
    da_agent_name: AGENT_NAMES[nextAgent].deep_agents.agent_name,
    prompt: buildHandoffPrompt(projectPath, agentId ?? undefined)
  }
```

### 7. Update MCP server project manifest

- `mcp-server/docs/agents/project-manifest/api-surface.md` — document `AGENT_NAMES` constant and the three new `auto_handoff` fields.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — update the auto_handoff flow description.

### 8. Update tests

In `mcp-server/tests/gui/handoff-config-integration.test.ts`, add assertions for all three new fields:

```typescript
expect(payload.auto_handoff.cc_agent_name).toBe('4-qa');
expect(payload.auto_handoff.vs_agent_name).toBe('4 - QA v3.5.0');
expect(payload.auto_handoff.da_agent_name).toBe('4-qa');
```

### 9. Add `name-mapping.json` to cross-system dependencies

Update this `AGENTS.md` (root) and the root manifest hub in `docs/agents/project-manifest/README.md` to document the new synchronization point.

## Dependencies

- `personas/ledger/src/meta/*.yaml` — source YAML metadata (no change needed)
- `personas/ledger/src/meta/_shared.yaml` — `default_version` fallback (no change needed)
- `js-yaml` — already a dependency of `personas/package.json` (no new dependency)
- `mcp-server/src/schema/workflow-manifest-schema.ts` — `createRequire` pattern for JSON loading (no change needed)

## Required Components

**New files:**
- `personas/name-mapping.json` — generated JSON mapping file (checked into Git)

**Modified files:**
- `scripts/build-personas.js` — add post-build JSON generation step
- `mcp-server/src/utils/constants.ts` — add `AGENT_NAMES` constant loaded from mapping file
- `mcp-server/src/tools/workflow-handoff.ts` — add `cc_agent_name`, `vs_agent_name`, `da_agent_name` to `auto_handoff` payload
- `personas/ledger/src/partials/handoff-block-claude-code.md` — simplify handoff instructions
- `mcp-server/docs/agents/workflow-specification/auxiliary-systems.md` — update §18.3 pseudocode
- `mcp-server/docs/agents/project-manifest/api-surface.md` — document new constant + fields
- `mcp-server/docs/agents/project-manifest/data-flows.md` — update auto_handoff flow
- `mcp-server/tests/gui/handoff-config-integration.test.ts` — add assertions
- `AGENTS.md` (root) — add cross-system dependency entry

## Assumptions

- The CC agent name always equals the `cc_file_name` stem. This is enforced by the persona builder (the `cc_file_name_stem` variable) and by `sync-personas.js` which deploys files using their original filenames.
- The VS Code agent name always follows the pattern `{number} - {role} v{version}`, matching the `FRONTMATTER_LEDGER_VSCODE` template in `personas/plugins/ledger/frontmatter-templates.js`.
- The DA agent name always equals the `id` field from persona YAML metadata, matching the `FRONTMATTER_DA` template in `personas/persona-build.config.js`.
- `name-mapping.json` is regenerated on every persona build. Stale mappings are detectable by version mismatches.

## Constraints

- No new npm dependencies (uses `js-yaml` already available in `personas/node_modules`).
- `name-mapping.json` must be deterministic from YAML sources — same inputs → same output.
- The `auto_handoff` structure change is additive only — `agent_name` and `agent_id` from the registry are preserved (option a).
- Cross-platform: the generation script uses `path.join()` and Node.js `fs` APIs only.

## Out of Scope

- Replacing the VS Code agent registry with the mapping file (option b — potential follow-up).
- Adding the mapping file to the workflow manifest schema (it's a separate concern).
- Standalone persona suite name mapping (standalone personas don't participate in ledger handoffs).
- Adding a Zod schema for `name-mapping.json` validation at MCP server startup (for now, if the file is malformed, the `createRequire` import will fail with a clear error; a schema can be added later).

## Acceptance Criteria

- `personas/name-mapping.json` is generated by `node scripts/build-personas.js` with correct entries for all 9 ledger personas.
- `AGENT_NAMES` constant exists in MCP server and maps all 9 roles to their target-specific names.
- `auto_handoff` responses include `cc_agent_name`, `vs_agent_name`, and `da_agent_name`.
- The CC handoff partial no longer contains string manipulation instructions.
- Generated CC persona files reflect the simplified handoff instructions.
- All existing tests pass; new assertions cover the three name fields.
- Workflow specification §18.3 documents the new fields.

## Testing Strategy

- **Generation**: Run `node scripts/build-personas.js` and verify `personas/name-mapping.json` contains 9 entries with correct names for all targets.
- **Integration**: Extend `handoff-config-integration.test.ts` to assert all three name fields are present and correct in auto_handoff responses.
- **Persona build check**: Run `node scripts/build-personas.js --check` after updating the partial to verify generated output is consistent.
- **Staleness**: Verify that modifying a persona YAML and rebuilding produces an updated mapping file.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Mapping file out of sync with YAML** | Generated as part of the same build step. The pre-commit hook (`scripts/install-hooks.js`) runs `--check` to detect stale persona output. |
| **MCP server started without mapping file** | `createRequire` throws a clear `MODULE_NOT_FOUND` error at startup. Document that the mapping file must exist (generated by first persona build). |
| **Frontmatter template changes break name computation** | The generation script mirrors the exact template formulas. If a template changes, the script must be updated in the same commit. Added as a cross-system dependency. |
| **CC consumers still using old derivation logic** | The new fields are additive — old logic still works until partials are regenerated. After rebuild, all CC personas use the new field. |
