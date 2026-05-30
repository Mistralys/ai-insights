/**
 * Schema Integrity Regression Test
 *
 * Verifies that all 26 tool schemas registered with the MCP server produce
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
});

// ── Expected tool names (all 22) ──────────────────────────────────────────
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
  // work-package
  'ledger_get_work_package',
  'ledger_list_work_packages',
  'ledger_create_work_package',
  'ledger_claim_work_package',
  'ledger_update_work_package_status',
  'ledger_reset_rework_count',
  'ledger_update_acceptance_criteria',
  // knowledge
  'ledger_add_insight',
  'ledger_search_insights',
  'ledger_list_insights',
  'ledger_update_insight',
] as const;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Schema Integrity — all 26 tool schemas produce non-empty JSON Schema', () => {
  it('registers exactly 26 tools', () => {
    expect(capturedSchemas.size).toBe(26);
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
