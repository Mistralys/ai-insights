/**
 * Schema Integrity Regression Test
 *
 * Verifies that every tool schema registered with the MCP server is an
 * outer `z.object()` (ZodObject) schema and that most of them produce
 * non-empty JSON Schema `properties`. This test fails if anyone re-adds
 * `.refine()`, `.transform()`, or `.superRefine()` to an outer `z.object()`
 * schema — those methods convert `ZodObject` to `ZodEffects`, causing the
 * MCP SDK to emit empty `properties: {}` in the `tools/list` response.
 *
 * The tool set under test is derived from `registerAllTools()` /
 * `TOOL_MODULES` rather than a hand-maintained import+name list, so a new
 * tool module gains schema coverage automatically once it is added to the
 * registry.
 *
 * See: constraints.md §63 — Do Not Use .refine() on Outer Tool Schemas
 * Bug report: docs/agents/bug-reports/2026-03-05-zod-refine-empty-schema.md
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type ToolModule } from '../../src/tools/registry.js';

// ── Capture schemas via the registry's recording mechanism ────────────────
const capturedSchemas = new Map<string, z.ZodTypeAny>();
let registeredToolNames: string[] = [];

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
  registeredToolNames = registerAllTools(mockServer);
});

// ── Tools with a legitimately empty parameter schema ───────────────────────
//
// z.object({}) is a valid ZodObject whose JSON Schema has no `properties`
// entries — this is correct for a tool that takes no arguments, not a sign
// of an accidental .refine()/.transform() wrapper. Each entry here must be
// justified by a genuinely zero-parameter tool.
const ZERO_PARAMETER_TOOLS: ReadonlySet<string> = new Set(['ledger_ping']);

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Schema Integrity — tool set derived from the registry', () => {
  it('registers at least one tool', () => {
    expect(registeredToolNames.length).toBeGreaterThan(0);
  });

  it('captures a schema for every tool name registerAllTools returned', () => {
    for (const name of registeredToolNames) {
      expect(capturedSchemas.has(name), `Missing schema for tool: ${name}`).toBe(true);
    }
  });

  it('includes ledger_ping, ledger_import_standalone and ledger_update_synthesis', () => {
    for (const name of ['ledger_ping', 'ledger_import_standalone', 'ledger_update_synthesis']) {
      expect(
        registeredToolNames.includes(name),
        `Expected ${name} to be registered via TOOL_MODULES`
      ).toBe(true);
    }
  });
});

describe('Schema Integrity — all tool schemas are outer ZodObject schemas', () => {
  it('every registered tool schema is a ZodObject, not ZodEffects', () => {
    for (const toolName of registeredToolNames) {
      const schema = capturedSchemas.get(toolName);
      expect(schema, `No schema captured for ${toolName}`).toBeDefined();
      expect(
        schema instanceof z.ZodObject,
        `${toolName}: outer schema is not a ZodObject (likely wrapped in .refine()/.transform()/.superRefine())`
      ).toBe(true);
    }
  });

  it('every registered tool except ZERO_PARAMETER_TOOLS has non-empty JSON Schema properties', () => {
    for (const toolName of registeredToolNames) {
      if (ZERO_PARAMETER_TOOLS.has(toolName)) {
        continue;
      }

      const schema = capturedSchemas.get(toolName)!;
      const jsonSchema = zodToJsonSchema(schema) as { properties?: Record<string, unknown> };

      expect(
        jsonSchema.properties,
        `${toolName}: JSON Schema missing 'properties' key — schema may be ZodEffects`
      ).toBeDefined();
      expect(
        Object.keys(jsonSchema.properties!).length,
        `${toolName}: 'properties' is empty — schema is ZodEffects (check for outer .refine())`
      ).toBeGreaterThan(0);
    }
  });

  it('ZERO_PARAMETER_TOOLS entries are still ZodObject, just with empty properties', () => {
    for (const toolName of ZERO_PARAMETER_TOOLS) {
      const schema = capturedSchemas.get(toolName);
      expect(schema, `No schema captured for ${toolName}`).toBeDefined();
      expect(schema instanceof z.ZodObject).toBe(true);

      const jsonSchema = zodToJsonSchema(schema!) as { properties?: Record<string, unknown> };
      expect(Object.keys(jsonSchema.properties ?? {}).length).toBe(0);
    }
  });
});

describe('Schema Integrity — synthetic .refine() detection', () => {
  it('flags a .refine()-wrapped schema as non-ZodObject', () => {
    // The instanceof check is the structural assertion the regression
    // actually depends on — zod-to-json-schema's own emptiness behavior for
    // ZodEffects has varied across versions, so this test pins the
    // structural signal (ZodObject vs. ZodEffects) rather than a
    // version-dependent JSON Schema shape.
    const refined = z.object({ foo: z.string() }).refine(() => true);
    expect(refined instanceof z.ZodObject).toBe(false);
  });

  it('a synthetic module registering a .refine()-wrapped schema is caught by the ZodObject assertion', () => {
    const capturedSynthetic = new Map<string, z.ZodTypeAny>();
    const syntheticMockServer = {
      registerTool: (name: string, config: { inputSchema: z.ZodTypeAny }) => {
        capturedSynthetic.set(name, config.inputSchema);
      },
    } as unknown as McpServer;

    const syntheticModules: ToolModule[] = [
      {
        id: 'synthetic-refine-module',
        register: (s) => {
          (s as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool(
            'ledger_synthetic_refined',
            { description: 'synthetic', inputSchema: z.object({ foo: z.string() }).refine(() => true) },
            () => undefined
          );
        },
      },
    ];

    registerAllTools(syntheticMockServer, syntheticModules);

    const schema = capturedSynthetic.get('ledger_synthetic_refined');
    expect(schema instanceof z.ZodObject).toBe(false);
  });
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
