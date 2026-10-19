import { describe, it, expect } from 'vitest';
import { requirePmRole } from '../../src/utils/pm-role-guard.js';

describe('requirePmRole', () => {
  it('returns null for "Project Manager" (authorised)', () => {
    expect(requirePmRole('ledger_reset_rework_count', 'Project Manager')).toBeNull();
  });

  it.each([
    'Developer',
    'Project Manager Agent',
    'project manager',
    '',
  ])('rejects agentRole %j with the standard PM-only error shape', (agentRole) => {
    const result = requirePmRole('ledger_reset_rework_count', agentRole);

    expect(result).not.toBeNull();
    expect(result!.isError).toBe(true);
    expect(result!.content).toHaveLength(1);
    expect(result!.content[0]).toEqual({
      type: 'text',
      text: `Error: ledger_reset_rework_count is a PM-only tool. You are: ${agentRole}`,
    });
  });

  it('inserts toolName verbatim into the rejection message', () => {
    const result = requirePmRole('ledger_update_pipeline_stages', 'Developer');

    expect(result!.content[0].text).toBe(
      'Error: ledger_update_pipeline_stages is a PM-only tool. You are: Developer'
    );
  });

  it('does not accept "Project Manager Agent" — current contract is an exact match on "Project Manager" only', () => {
    // This pins a deliberate asymmetry: ledger_update_work_package_status's
    // agent-name check accepts both "Project Manager" and
    // "Project Manager Agent" for COMPLETE-setting purposes elsewhere in the
    // codebase, but requirePmRole() does not. See the plan's Deferred Items
    // for a future decision on reconciling the two checks.
    const result = requirePmRole('ledger_reopen_cancelled_wp', 'Project Manager Agent');

    expect(result).not.toBeNull();
    expect(result!.isError).toBe(true);
  });
});
