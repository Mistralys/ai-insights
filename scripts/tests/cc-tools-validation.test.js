/**
 * scripts/tests/cc-tools-validation.test.js
 *
 * Fixture-based tests for the Claude Code dispatch-tool check in
 * scripts/lib/cc-tools-validation.js: a persona that declares `subagents`
 * or includes the `handoff-block-claude-code` partial needs `Task` in its
 * effective Claude Code tool list.
 */

import { describe, it, expect } from 'vitest';
import { validateCcTools } from '../lib/cc-tools-validation.js';

const SHARED_DEFAULT = ['Bash', 'Read', 'Task'];
const HANDOFF_CONTENT = '7. {{> handoff-block-claude-code}}\n';

const ccToolsWithoutTask = ['cc_tools:', '  - Bash', '  - Read', '  - mcp__central_pm'].join('\n');
const ccToolsWithTask    = ['cc_tools:', '  - Bash', '  - Task', '  - mcp__central_pm'].join('\n');

describe('cc_tools dispatch validation', () => {
  it('passes a persona with neither subagents nor the handoff partial', () => {
    expect(validateCcTools(ccToolsWithoutTask, 'p.yaml', SHARED_DEFAULT, 'no dispatch here')).toEqual([]);
  });

  it('fails a persona declaring subagents without Task', () => {
    const yaml = [ccToolsWithoutTask, 'subagents:', '  - ctx-architect'].join('\n');
    const errors = validateCcTools(yaml, 'p.yaml', SHARED_DEFAULT);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('declares 1 subagent(s)');
    expect(errors[0]).toContain('cc_tools');
  });

  it('fails a persona including the handoff partial without Task', () => {
    const errors = validateCcTools(ccToolsWithoutTask, 'p.yaml', SHARED_DEFAULT, HANDOFF_CONTENT);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('handoff-block-claude-code');
  });

  it('names both reasons when both apply', () => {
    const yaml = [ccToolsWithoutTask, 'subagents:', '  - ctx-architect'].join('\n');
    const errors = validateCcTools(yaml, 'p.yaml', SHARED_DEFAULT, HANDOFF_CONTENT);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('subagent(s) and includes the handoff-block-claude-code partial');
  });

  it('passes a persona including the handoff partial when cc_tools has Task', () => {
    expect(validateCcTools(ccToolsWithTask, 'p.yaml', SHARED_DEFAULT, HANDOFF_CONTENT)).toEqual([]);
  });

  it('passes a handoff persona with no tool list when the shared default has Task', () => {
    expect(validateCcTools('role: QA', 'p.yaml', SHARED_DEFAULT, HANDOFF_CONTENT)).toEqual([]);
  });

  it('flags the shared default when it lacks Task and no persona list overrides it', () => {
    const errors = validateCcTools('role: QA', 'p.yaml', ['Bash'], HANDOFF_CONTENT);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('default_cc_tools');
  });

  it('ignores the VS Code and manual handoff partials', () => {
    const content = '{{> handoff-block-vscode}}\n{{> handoff-block-manual}}\n';
    expect(validateCcTools(ccToolsWithoutTask, 'p.yaml', SHARED_DEFAULT, content)).toEqual([]);
  });
});
