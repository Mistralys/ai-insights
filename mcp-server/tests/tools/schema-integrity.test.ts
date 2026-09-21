/**
 * Schema Integrity Regression Test
 *
 * Verifies that all 29 tool schemas registered with the MCP server produce
 * non-empty JSON Schema `properties`. This test fails if anyone re-adds
 * `.refine()`, `.transform()`, or `.superRefine()` to an outer `z.object()`
 * schema — those methods convert `ZodObject` to `ZodEffects`, causing the
 * MCP SDK to emit empty `properties: {}` in the `tools/list` response.
 *
 * See: constraints.md §63 — Do Not Use .refine() on Outer Tool Schemas
 * Bug report: docs/agents/bug-reports/2026-03-05-zod-refine-empty-schema.md
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ── Tool registration imports ──────────────────────────────────────────────
import { register as registerBeginWork } from '../../src/tools/begin-work.js';
import { register as registerHelp } from '../../src/tools/help.js';
import { register as registerObservations } from '../../src/tools/observations.js';
import { register as registerPipeline } from '../../src/tools/pipeline.js';
import { register as registerProjectLifecycle } from '../../src/tools/project-lifecycle.js';
import { register as registerWorkflowHandoff } from '../../src/tools/workflow-handoff.js';
import { register as registerWorkflowNextAction } from '../../src/tools/workflow-next-action.js';
import { register as registerWorkPackage } from '../../src/tools/work-package.js';
import { register as registerKnowledge } from '../../src/tools/knowledge.js';
import { register as registerRepositoryContext } from '../../src/tools/repository-context.js';

// ── Capture schemas from registerTool() ───────────────────────────────────
const capturedSchemas = new Map<string, z.ZodTypeAny>();

const mockServer = {
  registerTool: (
    name: string,
    config: { description: string; inputSchema: z.ZodTypeAny },
    _handler: unknown
  ) => {
    capturedSchemas.set(name, config.inputSchema);
  },
} as unknown as McpServer;

beforeAll(() => {
  registerBeginWork(mockServer);
  registerHelp(mockServer);
  registerObservations(mockServer);
  registerPipeline(mockServer);
  registerProjectLifecycle(mockServer);
  registerWorkflowHandoff(mockServer);
  registerWorkflowNextAction(mockServer);
  registerWorkPackage(mockServer);
  registerKnowledge(mockServer);
  registerRepositoryContext(mockServer);
});

// ── Expected tool names (all 29) ──────────────────────────────────────────
const EXPECTED_TOOL_NAMES = [
  // begin-work
  'ledger_begin_work',
  // help
  'ledger_help',
  // observations
  'ledger_add_observation',
  'ledger_add_project_comment',
  // pipeline
  'ledger_start_pipeline',
  'ledger_complete_pipeline',
  'ledger_cancel_pipeline',
  'ledger_update_pipeline_progress',
  // project-lifecycle
  'ledger_detect_project',
  'ledger_initialize_project',
  'ledger_get_project_status',
  'ledger_list_projects',
  'ledger_complete_synthesis',
  // workflow-handoff
  'ledger_get_handoff_status',
  // workflow-next-action
  'ledger_get_next_action',
  // repository-context
  'ledger_get_repository_context',
  // work-package
  'ledger_get_work_package',
  'ledger_list_work_packages',
  'ledger_create_work_package',
  'ledger_claim_work_package',
  'ledger_update_work_package_status',
  'ledger_reset_rework_count',
  'ledger_reopen_cancelled_wp',
  'ledger_update_acceptance_criteria',
  // knowledge
  'ledger_add_insight',
  'ledger_search_insights',
  'ledger_list_insights',
  'ledger_update_insight',
  'ledger_delete_insight',
] as const;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Schema Integrity — all tool schemas produce non-empty JSON Schema', () => {
  it(`registers exactly ${EXPECTED_TOOL_NAMES.length} tools`, () => {
    expect(capturedSchemas.size).toBe(EXPECTED_TOOL_NAMES.length);
  });

  it('registers all expected tool names', () => {
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(capturedSchemas.has(name), `Missing schema for tool: ${name}`).toBe(true);
    }
  });

  for (const toolName of EXPECTED_TOOL_NAMES) {
    it(`${toolName}: properties is non-empty (schema is ZodObject, not ZodEffects)`, () => {
      const schema = capturedSchemas.get(toolName);
      expect(schema, `No schema captured for ${toolName}`).toBeDefined();

      // Convert to JSON Schema — a ZodEffects schema (from .refine/.transform)
      // produces an empty properties object, while a ZodObject produces the
      // correct field list.
      const jsonSchema = zodToJsonSchema(schema!) as { properties?: Record<string, unknown> };
      expect(
        jsonSchema.properties,
        `${toolName}: JSON Schema missing 'properties' key — schema may be ZodEffects`
      ).toBeDefined();
      expect(
        Object.keys(jsonSchema.properties!).length,
        `${toolName}: 'properties' is empty — schema is ZodEffects (check for outer .refine())`
      ).toBeGreaterThan(0);
    });
  }
});

// ── Numeric-input helper field-type assertions ─────────────────────────────
//
// The helpers in schema/common.ts (confidenceInput, positiveIntInput,
// nonNegativeIntInput, numberInput) wrap their inner z.number() schema in a
// field-level z.preprocess() so string-encoded numeric arguments are
// tolerated. These assertions pin the emitted JSON Schema for every
// helper-wrapped field so a future switch to z.coerce or z.union — either of
// which would degrade or change the advertised signature — fails the build.

type JsonSchemaObject = { properties?: Record<string, any> };

function propertiesOf(toolName: string): Record<string, any> {
  const schema = capturedSchemas.get(toolName);
  expect(schema, `No schema captured for ${toolName}`).toBeDefined();
  const jsonSchema = zodToJsonSchema(schema!) as JsonSchemaObject;
  expect(jsonSchema.properties, `${toolName}: missing properties`).toBeDefined();
  return jsonSchema.properties!;
}

describe('Schema Integrity — numeric-input helper field types are unchanged', () => {
  it('ledger_add_insight.confidence emits {"type":"number","minimum":0,"maximum":1}', () => {
    const props = propertiesOf('ledger_add_insight');
    expect(props.confidence).toMatchObject({ type: 'number', minimum: 0, maximum: 1 });
  });

  it('ledger_update_insight.confidence emits {"type":"number","minimum":0,"maximum":1}', () => {
    const props = propertiesOf('ledger_update_insight');
    expect(props.confidence).toMatchObject({ type: 'number', minimum: 0, maximum: 1 });
  });

  it('ledger_search_insights.limit and ledger_list_insights.limit/offset stay "type":"integer" with existing bounds', () => {
    const searchProps = propertiesOf('ledger_search_insights');
    expect(searchProps.limit).toMatchObject({ type: 'integer', exclusiveMinimum: 0 });

    const listProps = propertiesOf('ledger_list_insights');
    expect(listProps.limit).toMatchObject({ type: 'integer', exclusiveMinimum: 0 });
    expect(listProps.offset).toMatchObject({ type: 'integer', minimum: 0 });
  });

  it('ledger_get_next_action.max_results stays "type":"integer" with existing bounds', () => {
    const props = propertiesOf('ledger_get_next_action');
    expect(props.max_results).toMatchObject({ type: 'integer', exclusiveMinimum: 0 });
  });

  it('ledger_get_repository_context.max_projects stays "type":"integer" with existing bounds', () => {
    const props = propertiesOf('ledger_get_repository_context');
    expect(props.max_projects).toMatchObject({ type: 'integer', exclusiveMinimum: 0 });
  });

  it('ledger_complete_pipeline.metrics counters stay "type":"number"', () => {
    const props = propertiesOf('ledger_complete_pipeline');
    const metricsProps = props.metrics?.properties;
    expect(metricsProps, 'ledger_complete_pipeline.metrics: missing properties').toBeDefined();
    expect(metricsProps.tests_passed).toMatchObject({ type: 'number' });
    expect(metricsProps.tests_failed).toMatchObject({ type: 'number' });
    expect(metricsProps.security_issues).toMatchObject({ type: 'number' });
  });
});
