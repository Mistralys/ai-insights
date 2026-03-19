/**
 * Structural integrity tests for shared/workflow-manifest.json.
 *
 * These tests validate the manifest's internal consistency — unique IDs,
 * cross-reference validity, DAG structure, non-empty enums, and positive
 * constants.  They serve as a regression guard so any future edit to the
 * manifest that breaks invariants is caught immediately by the test suite.
 *
 * Manifest validation tests for shared/workflow-manifest.json.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const manifest = _require('../../../shared/workflow-manifest.json') as
  typeof import('../../../shared/workflow-manifest.json');

// ─── ManifestSchema startup validation ───────────────────────────────────────
// Verify that ManifestSchema.parse() succeeds on the current workflow-manifest.json.
// Guards against accidentally malforming the manifest in a way that would cause
// a startup failure in the MCP server.

describe('ManifestSchema — startup-time Zod validation', () => {
  it('ManifestSchema.parse() succeeds on the current workflow-manifest.json', async () => {
    const { ManifestSchema } = await import('../../src/schema/workflow-manifest-schema.js');
    expect(() => ManifestSchema.parse(_require('../../../shared/workflow-manifest.json'))).not.toThrow();
  });

  it('parsed workflowManifest singleton has correct spec_version shape', async () => {
    const { workflowManifest } = await import('../../src/schema/workflow-manifest-schema.js');
    expect(typeof workflowManifest.spec_version).toBe('string');
    expect(workflowManifest.spec_version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('parsed workflowManifest roles[].name values are valid AgentRole enum members', async () => {
    const { workflowManifest, AgentRoleEnum } = await import('../../src/schema/workflow-manifest-schema.js');
    for (const role of workflowManifest.roles) {
      expect(AgentRoleEnum.options, `"${role.name}" should be a valid AgentRole`).toContain(role.name);
    }
  });

  it('ManifestSchema.parse() throws ZodError on malformed input', async () => {
    const { ManifestSchema } = await import('../../src/schema/workflow-manifest-schema.js');
    expect(() => ManifestSchema.parse({ spec_version: 1 })).toThrow();
  });
});

// ─── Roles ──────────────────────────────────────────────────────────────────

describe('workflow-manifest.json — roles', () => {
  it('contains exactly 9 roles', () => {
    expect(manifest.roles).toHaveLength(9);
  });

  it('role id values are unique', () => {
    const ids = manifest.roles.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('role name values are unique', () => {
    const names = manifest.roles.map(r => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('role number values are unique', () => {
    const numbers = manifest.roles.map(r => r.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('role numbers are sequential starting from 1', () => {
    const sorted = [...manifest.roles].sort((a, b) => a.number - b.number);
    sorted.forEach((r, i) => {
      expect(r.number).toBe(i + 1);
    });
  });

  it('all role id values match ^[a-z][a-z0-9_]*$', () => {
    const pattern = /^[a-z][a-z0-9_]*$/;
    for (const role of manifest.roles) {
      expect(role.id, `role id "${role.id}" does not match pattern`).toMatch(pattern);
    }
  });

  it('all role names are non-empty strings', () => {
    for (const role of manifest.roles) {
      expect(typeof role.name).toBe('string');
      expect(role.name.length, `role name for id "${role.id}" is empty`).toBeGreaterThan(0);
    }
  });

  it('roles with non-null pipeline reference a valid canonical_order entry', () => {
    const canonical = new Set(manifest.pipelines.canonical_order);
    for (const role of manifest.roles) {
      if (role.pipeline !== null) {
        expect(
          canonical.has(role.pipeline as string),
          `role "${role.id}" pipeline "${role.pipeline}" is not in canonical_order`,
        ).toBe(true);
      }
    }
  });

  it('each pipeline type in canonical_order is owned by exactly one role', () => {
    const pipelineToRole: Record<string, string[]> = {};
    for (const role of manifest.roles) {
      if (role.pipeline !== null) {
        const p = role.pipeline as string;
        pipelineToRole[p] = [...(pipelineToRole[p] ?? []), role.id];
      }
    }
    for (const pipelineType of manifest.pipelines.canonical_order) {
      const owners = pipelineToRole[pipelineType] ?? [];
      expect(
        owners,
        `pipeline type "${pipelineType}" must be owned by exactly one role`,
      ).toHaveLength(1);
    }
  });
});

// ─── Pipelines ──────────────────────────────────────────────────────────────

describe('workflow-manifest.json — pipelines', () => {
  it('canonical_order is non-empty', () => {
    expect(manifest.pipelines.canonical_order.length).toBeGreaterThan(0);
  });

  it('default_stages is a valid subsequence of canonical_order', () => {
    const order = manifest.pipelines.canonical_order;
    let orderIdx = 0;
    for (const stage of manifest.pipelines.default_stages) {
      const found = order.slice(orderIdx).indexOf(stage as typeof order[number]);
      expect(found, `default_stage "${stage}" not found in canonical_order from position ${orderIdx}`).toBeGreaterThanOrEqual(0);
      orderIdx += found + 1;
    }
  });

  it('every canonical_order entry has a prerequisites key', () => {
    const prereqs = manifest.pipelines.prerequisites as Record<string, string | null>;
    for (const pType of manifest.pipelines.canonical_order) {
      expect(
        Object.prototype.hasOwnProperty.call(prereqs, pType),
        `pipeline "${pType}" missing from prerequisites`,
      ).toBe(true);
    }
  });

  it('every canonical_order entry has a fail_routing key', () => {
    const routing = manifest.pipelines.fail_routing as Record<string, string>;
    for (const pType of manifest.pipelines.canonical_order) {
      expect(
        Object.prototype.hasOwnProperty.call(routing, pType),
        `pipeline "${pType}" missing from fail_routing`,
      ).toBe(true);
    }
  });

  it('fail_routing values reference valid role IDs', () => {
    const validIds = new Set(manifest.roles.map(r => r.id));
    const routing = manifest.pipelines.fail_routing as Record<string, string>;
    for (const [pType, roleId] of Object.entries(routing)) {
      expect(
        validIds.has(roleId),
        `fail_routing["${pType}"] = "${roleId}" is not a valid role id`,
      ).toBe(true);
    }
  });

  it('prerequisites form a valid DAG (no cycles)', () => {
    // Kahn's algorithm: detect cycles via topological sort
    const prereqs = manifest.pipelines.prerequisites as Record<string, string | null>;
    const nodes = new Set(Object.keys(prereqs));

    // Build adjacency: prereq → node (prereq must complete before node)
    const inDegree: Record<string, number> = {};
    const dependents: Record<string, string[]> = {};
    for (const node of nodes) {
      inDegree[node] = 0;
      dependents[node] = [];
    }
    for (const [node, prereq] of Object.entries(prereqs)) {
      if (prereq !== null) {
        dependents[prereq].push(node);
        inDegree[node]++;
      }
    }

    const queue = Object.keys(inDegree).filter(n => inDegree[n] === 0);
    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      visited++;
      for (const dep of dependents[current]) {
        inDegree[dep]--;
        if (inDegree[dep] === 0) queue.push(dep);
      }
    }

    expect(visited, 'pipeline prerequisites contain a cycle').toBe(nodes.size);
  });

  it('prerequisites values are either null or a valid canonical_order entry', () => {
    const canonical = new Set(manifest.pipelines.canonical_order);
    const prereqs = manifest.pipelines.prerequisites as Record<string, string | null>;
    for (const [pType, prereq] of Object.entries(prereqs)) {
      if (prereq !== null) {
        expect(
          canonical.has(prereq as typeof manifest.pipelines.canonical_order[number]),
          `prerequisites["${pType}"] = "${prereq}" is not in canonical_order`,
        ).toBe(true);
      }
    }
  });
});

// ─── Statuses ───────────────────────────────────────────────────────────────

describe('workflow-manifest.json — statuses', () => {
  it('project statuses array is non-empty', () => {
    expect(manifest.statuses.project.length).toBeGreaterThan(0);
  });

  it('work_package statuses array is non-empty', () => {
    expect(manifest.statuses.work_package.length).toBeGreaterThan(0);
  });

  it('pipeline statuses array is non-empty', () => {
    expect(manifest.statuses.pipeline.length).toBeGreaterThan(0);
  });

  it('blocker_type statuses array is non-empty', () => {
    expect(manifest.statuses.blocker_type.length).toBeGreaterThan(0);
  });

  it('all status values in every array are non-empty strings', () => {
    const allArrays: Record<string, string[]> = manifest.statuses as Record<string, string[]>;
    for (const [key, values] of Object.entries(allArrays)) {
      for (const v of values) {
        expect(typeof v, `non-string found in statuses.${key}`).toBe('string');
        expect(v.length, `empty string found in statuses.${key}`).toBeGreaterThan(0);
      }
    }
  });
});

// ─── Constants ──────────────────────────────────────────────────────────────

describe('workflow-manifest.json — constants', () => {
  it('max_rework_count is a positive number', () => {
    expect(typeof manifest.constants.max_rework_count).toBe('number');
    expect(manifest.constants.max_rework_count).toBeGreaterThan(0);
  });

  it('stale_pipeline_hours is a positive number', () => {
    expect(typeof manifest.constants.stale_pipeline_hours).toBe('number');
    expect(manifest.constants.stale_pipeline_hours).toBeGreaterThan(0);
  });

  it('max_handoff_depth is a positive number', () => {
    expect(typeof manifest.constants.max_handoff_depth).toBe('number');
    expect(manifest.constants.max_handoff_depth).toBeGreaterThan(0);
  });

  it('handoff_depth_multiplier is a positive number', () => {
    expect(typeof manifest.constants.handoff_depth_multiplier).toBe('number');
    expect(manifest.constants.handoff_depth_multiplier).toBeGreaterThan(0);
  });
});

// ─── Derived-constant parity ─────────────────────────────────────────────────
// Verify that the constants consumed by the mcp-server match the manifest values
// exactly — guarding against accidental drift between the manifest and the
// in-code derived exports.

describe('derived constant parity — mcp-server vs manifest', () => {
  it('AGENT_ROLES matches manifest roles[].name in order', async () => {
    const { AGENT_ROLES } = await import('../../src/utils/constants.js');
    expect(AGENT_ROLES).toEqual(manifest.roles.map(r => r.name));
  });

  it('ORCHESTRATING_ROLES contains only manifest roles with orchestrating=true', async () => {
    const { ORCHESTRATING_ROLES } = await import('../../src/utils/constants.js');
    const expected = manifest.roles.filter(r => r.orchestrating).map(r => r.name);
    expect(ORCHESTRATING_ROLES).toEqual(expected);
  });

  it('PIPELINE_TYPES matches manifest pipelines.canonical_order', async () => {
    const { PIPELINE_TYPES } = await import('../../src/utils/pipeline-maps.js');
    expect([...PIPELINE_TYPES]).toEqual(manifest.pipelines.canonical_order);
  });

  it('DEFAULT_PIPELINE_STAGES matches manifest pipelines.default_stages', async () => {
    const { DEFAULT_PIPELINE_STAGES } = await import('../../src/utils/pipeline-maps.js');
    expect([...DEFAULT_PIPELINE_STAGES]).toEqual(manifest.pipelines.default_stages);
  });

  it('PIPELINE_AGENT_MAP keys match canonical_order (non-null pipeline roles)', async () => {
    const { PIPELINE_AGENT_MAP } = await import('../../src/utils/pipeline-maps.js');
    // Each canonical pipeline type must have an entry
    for (const pType of manifest.pipelines.canonical_order) {
      expect(
        Object.prototype.hasOwnProperty.call(PIPELINE_AGENT_MAP, pType),
        `PIPELINE_AGENT_MAP missing key "${pType}"`,
      ).toBe(true);
    }
  });

  it('PIPELINE_AGENT_MAP values match manifest role names for each pipeline', async () => {
    const { PIPELINE_AGENT_MAP } = await import('../../src/utils/pipeline-maps.js');
    const pipelineToRoleName: Record<string, string> = {};
    for (const role of manifest.roles) {
      if (role.pipeline !== null) {
        pipelineToRoleName[role.pipeline as string] = role.name;
      }
    }
    for (const [pType, roleName] of Object.entries(pipelineToRoleName)) {
      expect(
        PIPELINE_AGENT_MAP[pType as keyof typeof PIPELINE_AGENT_MAP],
        `PIPELINE_AGENT_MAP["${pType}"] should be "${roleName}"`,
      ).toBe(roleName);
    }
  });

  it('MAX_REWORK_COUNT matches manifest constant', async () => {
    const { MAX_REWORK_COUNT } = await import('../../src/utils/workflow-helpers.js');
    expect(MAX_REWORK_COUNT).toBe(manifest.constants.max_rework_count);
  });

  it('STALE_PIPELINE_HOURS matches manifest constant', async () => {
    const { STALE_PIPELINE_HOURS } = await import('../../src/utils/workflow-helpers.js');
    expect(STALE_PIPELINE_HOURS).toBe(manifest.constants.stale_pipeline_hours);
  });

  it('SPEC_VERSION matches manifest spec_version', async () => {
    const { SPEC_VERSION } = await import('../../src/utils/constants.js');
    expect(SPEC_VERSION).toBe(manifest.spec_version);
  });
});

// ─── resolveFailAgent() parity ────────────────────────────────────────────────
// Verify that resolveFailAgent() output for each pipeline type matches the
// manifest's fail_routing → role name resolution.  Guards against drift if
// the manifest fail_routing values change without updating the implementation.

describe('resolveFailAgent() parity — manifest fail_routing', () => {
  it('resolveFailAgent() output matches manifest fail_routing for all 6 pipeline types', async () => {
    const { resolveFailAgent } = await import('../../src/utils/pipeline-maps.js');
    const roleById: Record<string, string> = Object.fromEntries(
      manifest.roles.map(r => [r.id, r.name])
    );
    const failRouting = manifest.pipelines.fail_routing as Record<string, string>;
    for (const [pipelineType, roleId] of Object.entries(failRouting)) {
      const expectedAgent = roleById[roleId] ?? 'Developer';
      // Pass the full canonical order as activeStages so the base route is always taken.
      const actual = resolveFailAgent(
        pipelineType as Parameters<typeof resolveFailAgent>[0],
        manifest.pipelines.canonical_order as Parameters<typeof resolveFailAgent>[1],
      );
      expect(actual, `resolveFailAgent("${pipelineType}") should be "${expectedAgent}"`).toBe(expectedAgent);
    }
  });
});
