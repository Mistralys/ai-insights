/**
 * Help content tests for the 4 knowledge MCP tools.
 *
 * Verifies that TOOL_HELP contains a non-empty string entry for each of the
 * new knowledge tools so that ledger_help returns useful documentation when
 * agents query any of them.
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
