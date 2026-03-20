# Plan — Shared Workflow Manifest: Single Source for Specification-Derived Constants

> **Prerequisite for:** [`2026-03-18-orchestrator-runner-sync`](../2026-03-18-orchestrator-runner-sync/plan.md) — completing this manifest work first makes the orchestrator sync straightforward, since the supervisor will derive its role/stage maps from the shared manifest instead of requiring manual constant additions.

## Summary

Introduce a single, language-agnostic JSON manifest (`shared/workflow-manifest.json`) at the workspace root that captures all specification-derived constructs: agent roles, pipeline definitions, status enums, routing maps, and workflow tuning constants. TypeScript (mcp-server), Python (orchestrator), and JavaScript (scripts) will all derive their constants from this file at build/import time instead of maintaining parallel, manually-synced copies. This eliminates the entire class of cross-project drift bugs for any data defined by the workflow specification.

## Architectural Context

The [workflow specification](mcp-server/docs/agents/workflow-specification/) (v2.4.1) defines a rich vocabulary of enumerated values, routing maps, and tuning constants. Today this vocabulary is duplicated across implementations in three languages, with manual synchronization and partial validation:

### Duplication inventory

| Spec Concept | TypeScript (mcp-server) | Python (orchestrator) | JS (scripts) |
|--------------|------------------------|----------------------|---------------|
| 9 Agent Roles | `constants.ts` → `AGENT_ROLES` | `config.py` → `PIPELINE_AGENT_MAP` values, `supervisor.py` → `_ROLES`, `_ROLE_STAGE_MAP` | `sync-personas.js` → `KNOWN_ROLES` |
| 6 Pipeline Types + ordering | `pipeline-maps.ts` → `PIPELINE_TYPES`, `CANONICAL_PIPELINE_ORDERING` | `config.py` → `PIPELINE_TYPES` | — |
| Pipeline prerequisites | `pipeline-maps.ts` → `PIPELINE_PREREQUISITES` | `config.py` → `PIPELINE_PREREQUISITES` | — |
| Pipeline → Role mapping | `pipeline-maps.ts` → `PIPELINE_AGENT_MAP` | `config.py` → `PIPELINE_AGENT_MAP` | — |
| Fail routing map | `pipeline-maps.ts` → `FAIL_ROUTING_MAP` | — (relies on MCP server) | — |
| Default pipeline stages | `pipeline-maps.ts` → `DEFAULT_PIPELINE_STAGES` | — | — |
| WP / Pipeline / Project statuses | `schema/enums.ts` → 4 Zod enums | `supervisor.py` → `_TERMINAL_STATUSES` (partial) | — |
| Blocker types | `schema/enums.ts` → `BlockerType` | — | — |
| MAX_REWORK_COUNT | `workflow-helpers.ts` → `5` | — (relies on MCP server) | — |
| STALE_PIPELINE_HOURS | `workflow-helpers.ts` → `24` | — (relies on MCP server) | — |
| MAX_HANDOFF_DEPTH | `workflow-helpers.ts` / `gui/config.ts` → `50` | — | — |
| Persona file paths | — | `config.py` → `PERSONA_FILES` | `sync-personas.js` |

### Current validation

- `scripts/check-known-roles.js` validates JS↔TS role parity (roles only).
- **Nothing validates Python↔TS parity.** The Python config explicitly warns: *"These constants are NOT auto-synced."*
- Status values, pipeline maps, and workflow constants have zero cross-project validation.

### Why JSON

- **Native to all three languages:** TypeScript imports JSON via `resolveJsonModule` (already enabled in `tsconfig.json`), Python's `json` module is stdlib, JavaScript uses `require()`.
- **No new dependencies:** Unlike YAML (which would need a parser on the TS side), JSON adds zero packages.
- **Schema-validatable:** JSON Schema can enforce structure at CI time.
- **IDE support:** Full autocompletion and validation in VS Code via `$schema`.

## Approach / Architecture

### 1. Create `shared/workflow-manifest.json`

A new file at `shared/workflow-manifest.json` (workspace root) becomes the **single source of truth** for all specification-derived constructs. The manifest is structured into four sections that mirror the specification's conceptual domains:

```json
{
  "$schema": "./workflow-manifest.schema.json",
  "spec_version": "2.4.1",

  "roles": [
    {
      "id": "planner",
      "name": "Planner",
      "number": 1,
      "orchestrating": true,
      "pipeline": null,
      "persona_file": "personas/ledger/vs-code/1-planner.md"
    },
    {
      "id": "pm",
      "name": "Project Manager",
      "number": 2,
      "orchestrating": false,
      "pipeline": null,
      "persona_file": "personas/ledger/vs-code/2-project-manager.md"
    },
    {
      "id": "developer",
      "name": "Developer",
      "number": 3,
      "orchestrating": false,
      "pipeline": "implementation",
      "persona_file": "personas/ledger/vs-code/3-developer.md"
    },
    {
      "id": "qa",
      "name": "QA",
      "number": 4,
      "orchestrating": false,
      "pipeline": "qa",
      "persona_file": "personas/ledger/vs-code/4-qa.md"
    },
    {
      "id": "security_auditor",
      "name": "Security Auditor",
      "number": 5,
      "orchestrating": false,
      "pipeline": "security-audit",
      "persona_file": "personas/ledger/vs-code/5-security-auditor.md"
    },
    {
      "id": "reviewer",
      "name": "Reviewer",
      "number": 6,
      "orchestrating": false,
      "pipeline": "code-review",
      "persona_file": "personas/ledger/vs-code/6-reviewer.md"
    },
    {
      "id": "release_engineer",
      "name": "Release Engineer",
      "number": 7,
      "orchestrating": false,
      "pipeline": "release-engineering",
      "persona_file": "personas/ledger/vs-code/7-release-engineer.md"
    },
    {
      "id": "docs",
      "name": "Documentation",
      "number": 8,
      "orchestrating": false,
      "pipeline": "documentation",
      "persona_file": "personas/ledger/vs-code/8-documentation.md"
    },
    {
      "id": "synthesis",
      "name": "Synthesis",
      "number": 9,
      "orchestrating": true,
      "pipeline": null,
      "persona_file": "personas/ledger/vs-code/9-synthesis.md"
    }
  ],

  "pipelines": {
    "canonical_order": [
      "implementation", "qa", "security-audit",
      "code-review", "release-engineering", "documentation"
    ],
    "default_stages": [
      "implementation", "qa", "code-review", "documentation"
    ],
    "prerequisites": {
      "implementation": null,
      "qa": "implementation",
      "security-audit": "qa",
      "code-review": "security-audit",
      "release-engineering": "code-review",
      "documentation": "release-engineering"
    },
    "fail_routing": {
      "implementation": "developer",
      "qa": "developer",
      "security-audit": "developer",
      "code-review": "developer",
      "release-engineering": "release_engineer",
      "documentation": "docs"
    }
  },

  "statuses": {
    "project":      ["READY", "IN_PROGRESS", "COMPLETE", "BLOCKED"],
    "work_package": ["READY", "IN_PROGRESS", "COMPLETE", "BLOCKED", "CANCELLED"],
    "pipeline":     ["IN_PROGRESS", "PASS", "FAIL"],
    "blocker_type": ["dependency", "decision", "external", "technical"]
  },

  "constants": {
    "max_rework_count": 5,
    "stale_pipeline_hours": 24,
    "max_handoff_depth": 50,
    "handoff_depth_multiplier": 30
  }
}
```

#### Design decisions for the manifest structure

| Decision | Rationale |
|----------|-----------|
| **Role `id` field** (e.g. `pm`, `developer`, `security_auditor`) | Machine-friendly identifier usable as graph stage names, config keys, and programmatic handles. Pattern: `^[a-z][a-z0-9_]*$` |
| **`pipeline` on each role** (not a separate map) | Captures the 1:1 relationship at the source. Consumers derive `PIPELINE_AGENT_MAP` by iterating roles. Avoids duplicating role names in a separate map object |
| **`fail_routing` uses role IDs** | Machine-readable cross-references within the manifest. Consumers map IDs to names/objects via the roles array |
| **`statuses` as string arrays** | Consumers apply their own type treatment (Zod enums in TS, frozensets in Python). The manifest supplies the vocabulary, not the type system |
| **`constants` section** | Captures spec-defined tuning parameters (§7, §8, §18) in one place. Avoids magic numbers scattered across implementations |
| **`spec_version`** | Tracks which specification version this manifest encodes. Changed when spec evolves |
| **`pipelines.default_stages`** | The 4-stage legacy default (§3.2). Distinct from `canonical_order` (all 6 stages). Both are spec-defined |

#### What's intentionally NOT in the manifest

| Data | Reason |
|------|--------|
| **Action names** (IMPLEMENT, RUN_QA, WAIT…) | Only the orchestrator classifies them; the MCP server generates them as recommendation output. Adding them would create a consumer-specific section |
| **Handoff logic / state machine transitions** | These are algorithms, not data. They belong in the spec and code, not in a data manifest |
| **Comment priority values** (`low`, `medium`, `high`) | Implementation convenience, not a spec-level construct |
| **Persona YAML `roster` metadata** (titles, short descriptions) | Serves the template engine; different concern from workflow routing |

### 2. Consumers derive constants, never duplicate them

**TypeScript (mcp-server):**

- `constants.ts` imports the manifest and derives:
  - `AGENT_ROLES` from `roles[].name`
  - `ORCHESTRATING_ROLES` from roles with `orchestrating === true`
  - `ROLE_IDS` map (role name → role ID) for programmatic lookups
  - `AgentRole` and `OrchestratingRole` types
- `pipeline-maps.ts` imports the manifest and derives:
  - `PIPELINE_TYPES` from `pipelines.canonical_order`
  - `DEFAULT_PIPELINE_STAGES` from `pipelines.default_stages`
  - `PIPELINE_AGENT_MAP` from roles with non-null `pipeline`
  - `PIPELINE_PREREQUISITES` from `pipelines.prerequisites`
  - `FAIL_ROUTING_MAP` from `pipelines.fail_routing` (mapping role IDs back to role names)
  - All computed maps (`AGENT_PIPELINE_MAP`, `NEXT_AGENT_MAP`) remain derived from the primary maps
  - All resolver functions unchanged (they operate on the derived maps)
- `schema/enums.ts` imports the manifest and derives:
  - `ProjectStatus`, `WorkPackageStatus`, `PipelineStatus`, `BlockerType` Zod enums
- `workflow-helpers.ts` imports the manifest and derives:
  - `MAX_REWORK_COUNT`, `STALE_PIPELINE_HOURS` from `constants` section
  - `MAX_HANDOFF_DEPTH` default + multiplier from `constants` section
- Type safety is preserved through Zod `.parse()` with literal schemas, recovering narrow union types from the JSON import (the existing Zod infrastructure already supports this pattern)

**Python (orchestrator):**

- `config.py` reads the manifest via a `_load_workflow_manifest()` helper:
  - Derives `PIPELINE_AGENT_MAP`, `PIPELINE_PREREQUISITES`, `PIPELINE_TYPES` directly
  - Derives `PERSONA_FILES`, `STAGE_TO_PIPELINE`, `PIPELINE_TO_STAGE`, `NEXT_STAGE_MAP`, `VALID_STAGES` from the roles array
  - Each role's `id` is used directly as the graph stage name
  - `NEXT_STAGE_MAP` is derived from consecutive non-orchestrating role IDs in the roles array
  - Removes all hardcoded constant dicts
- `supervisor.py` derives from `config.py`:
  - `_ROLE_STAGE_MAP` (role name → role ID) replaces the hardcoded dict
  - `_ROLES` list replaces the hardcoded list
  - `_TERMINAL_STATUSES` derived from the `statuses.work_package` vocabulary
  - Destination constants (`_DEST_PM`, `_DEST_DEVELOPER`, etc.) derived from role IDs

**JavaScript (scripts):**

- `sync-personas.js` replaces `KNOWN_ROLES` with `require('../shared/workflow-manifest.json').roles.map(r => r.name)`
- `check-known-roles.js` is repurposed to validate manifest schema compliance

### 3. Validation layer

- **`shared/workflow-manifest.schema.json`** — JSON Schema enforcing:
  - Required sections (`roles`, `pipelines`, `statuses`, `constants`)
  - Unique role `id`, `name`, and `number` values
  - Role ID pattern: `^[a-z][a-z0-9_]*$`
  - Pipeline types in `canonical_order` must be a superset of `default_stages`
  - Pipeline references in `prerequisites` and `fail_routing` are valid
  - `fail_routing` values reference valid role IDs
  - Status arrays contain known values
  - Constants are positive numbers
- **`scripts/validate-workflow-manifest.js`** — validates the JSON against the schema; runnable in CI and pre-commit hooks
- **Persona build cross-check** — `build-personas.js` validates each persona YAML `role` field against the manifest's role names
- **Existing `check-known-roles.js`** — retired or repurposed (the class of bugs it catches no longer exists)

## Rationale

**Why a shared JSON manifest instead of alternatives:**

| Alternative | Pros | Cons | Verdict |
|-------------|------|------|---------|
| **Shared JSON (chosen)** | Zero new deps; native in all 3 languages; schema-validatable; IDE support | Not as human-friendly as YAML | ✅ Best fit |
| **Derive from persona YAML** | Persona files exist | Couples role list to persona existence; needs YAML parser in TS; persona system becomes dependency of mcp-server | ❌ Too coupled |
| **Code generation** (.ts + .py from source) | Strong typing | Build step complexity; generated files need .gitignore discipline | ❌ Over-engineered |
| **Shared YAML** | More readable | Needs js-yaml in TS (new dependency) | ❌ New dependency |
| **Validate harder** (keep duplicates, add more checks) | No structural change | Detection ≠ prevention; catches drift after the fact, not before | ❌ Wrong approach |

**Why specification-first scoping:**

Rather than identifying duplicated *code* and extracting it, this plan identifies duplicated *specification concepts* and provides a single machine-readable encoding. This means:
- Future consumers (new tools, CI scripts, documentation generators) get the vocabulary for free
- The manifest is driven by the spec, not by implementation accidents
- Adding a new implementation (e.g., a Go orchestrator) requires reading one file, not reverse-engineering TypeScript constants

## Detailed Steps

1. **Create `shared/workflow-manifest.json`** with all 4 sections (roles, pipelines, statuses, constants).
2. **Create `shared/workflow-manifest.schema.json`** for structural validation.
3. **Refactor `mcp-server/src/schema/enums.ts`:**
   - Import the manifest's `statuses` section.
   - Derive `ProjectStatus`, `WorkPackageStatus`, `PipelineStatus`, `BlockerType` Zod enums from the arrays.
   - Preserve all existing type exports.
4. **Refactor `mcp-server/src/utils/constants.ts`:**
   - Import the manifest.
   - Derive `AGENT_ROLES`, `ORCHESTRATING_ROLES` from `roles`.
   - Expose `ROLE_IDS` map (role name → role ID).
   - Derive `SPEC_VERSION` from `spec_version`.
   - Preserve `AgentRole`, `OrchestratingRole` type exports.
5. **Refactor `mcp-server/src/utils/pipeline-maps.ts`:**
   - Import the manifest.
   - Derive `PIPELINE_TYPES` from `pipelines.canonical_order`.
   - Derive `DEFAULT_PIPELINE_STAGES` from `pipelines.default_stages`.
   - Derive `PIPELINE_AGENT_MAP` from roles with non-null `pipeline`.
   - Derive `PIPELINE_PREREQUISITES` from `pipelines.prerequisites`.
   - Derive `FAIL_ROUTING_MAP` from `pipelines.fail_routing` (map role IDs → role names).
   - Keep all computed maps and resolver functions.
6. **Refactor `mcp-server/src/utils/workflow-helpers.ts`:**
   - Import the manifest's `constants` section.
   - Derive `MAX_REWORK_COUNT`, `STALE_PIPELINE_HOURS` from manifest.
   - Derive `getMaxHandoffDepth()` default from `max_handoff_depth`.
   - Derive `effectiveMaxDepth()` multiplier from `handoff_depth_multiplier`.
7. **Refactor `orchestrator/src/config.py`:**
   - Add `_load_workflow_manifest()` helper to read the JSON.
   - Derive all pipeline routing constants from the manifest.
   - Use role IDs as graph stage names.
   - Remove all hardcoded constant dicts.
8. **Refactor `orchestrator/src/supervisor.py`:**
   - Derive `_ROLE_STAGE_MAP`, `_ROLES`, `_TERMINAL_STATUSES`, destination constants from config.
   - Remove hardcoded dicts.
9. **Refactor `scripts/sync-personas.js`:**
   - Replace `KNOWN_ROLES` with manifest import.
10. **Repurpose `scripts/check-known-roles.js`:**
    - Simplify to JSON schema validation, or retire.
11. **Create `scripts/validate-workflow-manifest.js`:**
    - Validate manifest against schema.
    - Runnable in CI and pre-commit hooks.
12. **Update persona build validation:**
    - `build-personas.js` cross-checks persona YAML `role` fields against manifest role names.
13. **Update tests:**
    - Verify existing tests in `mcp-server/tests/` and `orchestrator/tests/` pass.
    - Add manifest validation test.
14. **Update documentation:**
    - `AGENTS.md` — update Cross-System Dependencies table to reference manifest.
    - Both project manifests (`tech-stack.md`, `constraints.md`, `file-tree.md`).
    - Workflow specification README — note the manifest as the machine-readable encoding.

## Dependencies

- `resolveJsonModule: true` in `mcp-server/tsconfig.json` — **already enabled**.
- Python `json` module — **stdlib, no install needed**.
- The `shared/` path must be accessible from both `mcp-server/src/` (via `../../shared/`) and `orchestrator/src/` (via `../../shared/`). Both sub-projects already resolve paths relative to the workspace root.

## Required Components

### New files

| File | Purpose |
|------|---------|
| `shared/workflow-manifest.json` | The shared manifest — single source of truth |
| `shared/workflow-manifest.schema.json` | JSON Schema for validation |
| `scripts/validate-workflow-manifest.js` | Schema validation script |

### Modified files

| File | Change |
|------|--------|
| `mcp-server/src/schema/enums.ts` | Derive status enums from manifest |
| `mcp-server/src/utils/constants.ts` | Derive roles, IDs, spec version from manifest |
| `mcp-server/src/utils/pipeline-maps.ts` | Derive pipeline types, maps, routing from manifest |
| `mcp-server/src/utils/workflow-helpers.ts` | Derive workflow constants from manifest |
| `orchestrator/src/config.py` | Load manifest; derive all routing constants |
| `orchestrator/src/supervisor.py` | Derive role maps, status sets from config |
| `scripts/sync-personas.js` | Load roles from manifest |
| `scripts/check-known-roles.js` | Retire or repurpose |
| `AGENTS.md` | Update cross-system dependencies table |

## Assumptions

- The workspace root directory structure remains stable (`shared/` alongside `mcp-server/`, `orchestrator/`, `scripts/`).
- TypeScript's `resolveJsonModule` can import a JSON file from outside the `rootDir` (it can — `rootDir` constrains `.ts` sources, not JSON imports; the compiled output will inline the JSON values).
- The orchestrator's `config.py` can reliably compute the workspace root path (it already does this via `_ORCHESTRATOR_ROOT.parent`).
- The mcp-server implementation's `ARCHIVED` project status (not in spec §5.2) is an implementation extension that can be added locally alongside the manifest-provided values.

## Constraints

- **No new runtime dependencies** may be added for this change.
- **TypeScript type safety must be preserved.** `AgentRole`, `PipelineType`, `WorkPackageStatus`, etc. must remain narrow union types, not degrade to `string`. Achieved via Zod schemas or mapped types after JSON import.
- **Backward compatibility.** All existing public exports from modified files must retain their names and types. Consumers should not need changes.
- **The manifest is a data file, not a code artifact.** It must not encode TypeScript-specific or Python-specific concerns.
- **Role IDs must be stable.** Once assigned, a role's `id` must not change without a coordinated migration across all consumers.
- **The manifest tracks the spec.** When the workflow specification version advances, `spec_version` and the affected sections are updated in the manifest. The manifest is the machine-readable encoding of the spec's vocabulary, not an independent source of truth.

## Out of Scope

- **Action name vocabulary** (IMPLEMENT, RUN_QA, WAIT…) — only classified by the orchestrator; generated as output by the MCP server. Not cross-project data.
- **State machine transition rules** — algorithmic logic, not data.
- **Persona YAML `roster` metadata** (titles, short descriptions) — serves the template engine; different concern.
- **`orchestrator/src/graph.py` refactor** — graph node names should adopt role IDs from config, but the full refactor is a separate concern.
- **Comment priority values** — implementation detail, not spec-level.

## Acceptance Criteria

- `shared/workflow-manifest.json` defines all 9 roles (each with unique `id`, `name`, `number`), 6 pipeline types with ordering, prerequisites, fail routing, default stages, 4 status enums, and 4 workflow constants.
- `mcp-server/src/schema/enums.ts` derives its Zod enums from the manifest; no hardcoded status arrays remain.
- `mcp-server/src/utils/constants.ts` derives roles from the manifest; no hardcoded role arrays remain.
- `mcp-server/src/utils/pipeline-maps.ts` derives pipeline data from the manifest; no hardcoded pipeline maps remain.
- `mcp-server/src/utils/workflow-helpers.ts` derives workflow constants from the manifest; no magic numbers remain.
- `orchestrator/src/config.py` loads from the manifest; no hardcoded routing constants remain.
- `orchestrator/src/supervisor.py` derives status sets and role maps from config; no hardcoded role/status values remain.
- `scripts/sync-personas.js` loads roles from the manifest; `KNOWN_ROLES` array literal is removed.
- All existing tests pass without modification (or with minimal import path adjustments).
- All TypeScript union types remain narrow (not `string`).
- A schema validation script exists and passes.
- Adding a new role requires editing exactly one file (`shared/workflow-manifest.json`) plus creating the new persona YAML. No TypeScript or Python constant files need manual updates.
- Changing a workflow constant (e.g., `max_rework_count`) requires editing one file.
- Adding a new status value requires editing one file.

## Testing Strategy

- **Unit tests:** Existing tests in `mcp-server/tests/` and `orchestrator/tests/` are run to verify no regressions. The constants and maps they test must produce identical values to their current hardcoded equivalents.
- **Manifest validation test:** New test/script that validates:
  - All 9 roles present with unique `id`, `name`, `number` values.
  - All `id` values match `^[a-z][a-z0-9_]*$`.
  - All pipeline types in `canonical_order` have entries in `prerequisites` and `fail_routing`.
  - `default_stages` is a valid subsequence of `canonical_order`.
  - `fail_routing` values reference valid role IDs.
  - Pipeline prerequisites form a valid DAG (no cycles).
  - Status arrays are non-empty.
  - Constants are positive numbers.
- **Cross-check test:** Persona build validates that each persona YAML `role` field matches a manifest role name.
- **Smoke test:** `npm run build` in mcp-server and `pytest` in orchestrator confirm everything compiles/imports correctly.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **TypeScript type narrowing lost** when importing JSON (JSON imports widen to `string[]`) | Use Zod `.parse()` with literal schemas to recover narrow types. Existing Zod infrastructure already supports this. |
| **Python import-time failure** if JSON missing or malformed | Clear error message in `_load_workflow_manifest()` with expected path. Schema validation in CI catches issues pre-runtime. |
| **Relative path fragility** (`../../shared/`) | Both sub-projects already resolve workspace-root-relative paths. Add existence check with actionable error. |
| **Manifest edited incorrectly** (typo, missing field) | JSON Schema validation in CI + pre-commit hook. Persona build cross-checks role names. |
| **Breaking change during migration** | All existing exports preserved — they derive from JSON instead of literals. Zero external API changes. |
| **Spec evolves, manifest lags** | `spec_version` field makes staleness visible. Spec changes trigger a manifest update as part of the workflow spec maintenance process. |
| **ARCHIVED project status** (implementation extension not in spec) | mcp-server adds it locally alongside manifest-derived values. The manifest tracks the spec; extensions are consumer-specific. |
