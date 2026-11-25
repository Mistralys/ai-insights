/**
 * Help content tests for the six task MCP tools.
 */
import { describe, it, expect } from 'vitest';
import { TOOL_HELP } from '../../src/tools/help-content.js';
import { TASK_COLOR_IDS } from '../../src/schema/task.js';

const TASK_TOOLS = [
  'ledger_add_task',
  'ledger_get_task',
  'ledger_list_tasks',
  'ledger_search_tasks',
  'ledger_update_task',
  'ledger_delete_task',
] as const;

describe('Task tool help content', () => {
  for (const name of TASK_TOOLS) {
    it(`${name} has a non-empty entry headed by its name`, () => {
      const text = TOOL_HELP[name];
      expect(text, `Missing TOOL_HELP entry for ${name}`).toBeDefined();
      expect(text!.trim().length).toBeGreaterThan(0);
      expect(text).toContain(`# ${name}`);
    });

    it(`${name} has a row in the overview table`, () => {
      expect(TOOL_HELP['overview']).toContain(`| ${name} |`);
    });
  }

  it('documents OR search semantics', () => {
    expect(TOOL_HELP['ledger_search_tasks']).toMatch(/OR semantics/);
  });

  it('documents the store_id default', () => {
    expect(TOOL_HELP['ledger_add_task']).toMatch(/Defaults to the default store/);
    expect(TOOL_HELP['ledger_list_tasks']).toMatch(/Defaults to all stores/);
  });

  it('documents completion_source', () => {
    expect(TOOL_HELP['ledger_update_task']).toContain('completion_source');
  });

  it('documents the colour ids and the empty-string vs none distinction', () => {
    for (const id of TASK_COLOR_IDS) {
      expect(TOOL_HELP['ledger_list_tasks']).toContain(id);
      expect(TOOL_HELP['ledger_update_task']).toContain(id);
    }
    expect(TOOL_HELP['ledger_list_tasks']).toContain("'none'");
    expect(TOOL_HELP['ledger_update_task']).toContain("''");
  });

  it('states that bulk reordering is a GUI concern', () => {
    expect(TOOL_HELP['ledger_list_tasks']).toMatch(/reordering[^.]*GUI/);
  });
});
