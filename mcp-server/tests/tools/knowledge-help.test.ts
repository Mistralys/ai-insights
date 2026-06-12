/**
 * Help content tests for the 4 knowledge MCP tools and ledger_get_repository_context.
 *
 * Verifies that TOOL_HELP contains a non-empty string entry for each of the
 * new knowledge tools and the repository context tool so that ledger_help
 * returns useful documentation when agents query any of them.
 */
import { describe, it, expect } from 'vitest';
import { TOOL_HELP } from '../../src/tools/help-content.js';

const KNOWLEDGE_TOOL_NAMES = [
  'ledger_add_insight',
  'ledger_search_insights',
  'ledger_list_insights',
  'ledger_update_insight',
] as const;

describe('Knowledge tool help content', () => {
  for (const toolName of KNOWLEDGE_TOOL_NAMES) {
    it(`TOOL_HELP has a non-empty entry for ${toolName}`, () => {
      const helpText = TOOL_HELP[toolName];
      expect(helpText, `Missing TOOL_HELP entry for ${toolName}`).toBeDefined();
      expect(typeof helpText).toBe('string');
      expect(helpText!.trim().length, `TOOL_HELP entry for ${toolName} is empty`).toBeGreaterThan(0);
    });

    it(`${toolName} help entry includes the tool name as a heading`, () => {
      const helpText = TOOL_HELP[toolName]!;
      expect(helpText).toContain(`# ${toolName}`);
    });
  }
});

describe('ledger_get_repository_context help content', () => {
  const toolName = 'ledger_get_repository_context';

  it('TOOL_HELP has a non-empty entry for ledger_get_repository_context', () => {
    const helpText = TOOL_HELP[toolName];
    expect(helpText, `Missing TOOL_HELP entry for ${toolName}`).toBeDefined();
    expect(typeof helpText).toBe('string');
    expect(helpText!.trim().length, `TOOL_HELP entry for ${toolName} is empty`).toBeGreaterThan(0);
  });

  it('help entry includes the tool name as a heading', () => {
    const helpText = TOOL_HELP[toolName]!;
    expect(helpText).toContain(`# ${toolName}`);
  });

  it('help entry documents the cwd_path parameter', () => {
    const helpText = TOOL_HELP[toolName]!;
    expect(helpText).toContain('cwd_path');
  });

  it('help entry documents the repository_name parameter', () => {
    const helpText = TOOL_HELP[toolName]!;
    expect(helpText).toContain('repository_name');
  });

  it('help entry documents the include_insights parameter', () => {
    const helpText = TOOL_HELP[toolName]!;
    expect(helpText).toContain('include_insights');
  });

  it('help entry documents the max_projects parameter', () => {
    const helpText = TOOL_HELP[toolName]!;
    expect(helpText).toContain('max_projects');
  });

  it('help entry describes the response shape fields', () => {
    const helpText = TOOL_HELP[toolName]!;
    expect(helpText).toContain('repository_name');
    expect(helpText).toContain('repository_id');
    expect(helpText).toContain('repository_label');
    expect(helpText).toContain('total_projects');
    expect(helpText).toContain('strategic_vision');
    expect(helpText).toContain('projects');
    expect(helpText).toContain('relevant_insights');
  });

  it('help entry documents outcome_summary in the response shape', () => {
    const helpText = TOOL_HELP[toolName]!;
    expect(helpText).toContain('outcome_summary');
  });

  it('help entry appears in the overview tool table', () => {
    const overviewText = TOOL_HELP['overview']!;
    expect(overviewText).toContain(toolName);
  });
});
