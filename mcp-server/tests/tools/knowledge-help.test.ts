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

describe('Knowledge tool help content — confidence wording (AC-13)', () => {
  it('ledger_add_insight help states the decimal [0, 1] range and string-encoded acceptance', () => {
    const helpText = TOOL_HELP['ledger_add_insight']!;
    expect(helpText).toMatch(/decimal fraction between 0 and 1/);
    expect(helpText).toMatch(/rejected/);
    expect(helpText).toMatch(/string-encoded number/);
  });

  it('ledger_update_insight help states the decimal [0, 1] range and string-encoded acceptance', () => {
    const helpText = TOOL_HELP['ledger_update_insight']!;
    expect(helpText).toMatch(/decimal fraction between 0 and 1/);
    expect(helpText).toMatch(/rejected/);
    expect(helpText).toMatch(/string-encoded number/);
  });

  it('ledger_update_insight help includes a worked recalibration example', () => {
    const helpText = TOOL_HELP['ledger_update_insight']!;
    expect(helpText).toContain('"confidence": 0.9');
  });
});

describe('ledger_update_pipeline_stages help content', () => {
  const toolName = 'ledger_update_pipeline_stages';

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

  it('help entry appears in the overview tool table', () => {
    const overviewText = TOOL_HELP['overview']!;
    expect(overviewText).toContain(toolName);
  });
});

describe('Newly completed TOOL_HELP entries (help-content-coverage follow-up)', () => {
  const PM_ONLY_TOOLS = [
    'ledger_reset_rework_count',
    'ledger_reopen_cancelled_wp',
    'ledger_update_acceptance_criteria',
  ] as const;
  const ALL_FOUR_TOOLS = [...PM_ONLY_TOOLS, 'ledger_detect_project'] as const;

  for (const toolName of ALL_FOUR_TOOLS) {
    describe(toolName, () => {
      it('has a non-empty TOOL_HELP entry headed by the tool name', () => {
        const helpText = TOOL_HELP[toolName];
        expect(helpText, `Missing TOOL_HELP entry for ${toolName}`).toBeDefined();
        expect(helpText!.trim().length).toBeGreaterThan(0);
        expect(helpText).toContain(`# ${toolName}`);
      });

      it('documents Required Parameters', () => {
        expect(TOOL_HELP[toolName]).toContain('## Required Parameters');
      });

      it('documents an Example', () => {
        expect(TOOL_HELP[toolName]).toContain('## Example');
      });

      it('appears in the overview tool table', () => {
        expect(TOOL_HELP['overview']).toContain(toolName);
      });
    });
  }

  for (const toolName of PM_ONLY_TOOLS) {
    describe(`${toolName} (PM-only)`, () => {
      it('documents Guards in evaluation order', () => {
        expect(TOOL_HELP[toolName]).toMatch(/## Guards/);
      });

      it('carries "PM-only" wording', () => {
        expect(TOOL_HELP[toolName]).toMatch(/PM-only/);
      });
    });
  }

  it('ledger_detect_project does not document a project_path parameter (cwd_path is its only input)', () => {
    const helpText = TOOL_HELP['ledger_detect_project']!;
    expect(helpText).toContain('cwd_path');
    expect(helpText).not.toContain('**project_path**');
  });
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
