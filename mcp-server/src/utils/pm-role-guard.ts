/**
 * Shared authorisation guard for PM-only administrative tools.
 *
 * Several tools (`ledger_reset_rework_count`, `ledger_reopen_cancelled_wp`,
 * `ledger_update_acceptance_criteria`, `ledger_update_pipeline_stages`) are
 * restricted to the Project Manager role. Each previously carried its own
 * verbatim-copied `agent_role !== 'Project Manager'` check — this module
 * extracts that into a single call so the rejection message format cannot
 * diverge across call sites.
 */

/**
 * Checks whether `agentRole` is authorised to call a PM-only tool.
 *
 * @param toolName  The tool's registered name (e.g. `ledger_reset_rework_count`),
 *                   used verbatim in the rejection message.
 * @param agentRole  The `agent_role` value supplied by the caller.
 * @returns `null` when `agentRole === 'Project Manager'` (caller is authorised).
 *          Otherwise the standard `{ content, isError: true }` rejection result,
 *          ready to be returned directly from the tool handler.
 */
export function requirePmRole(
  toolName: string,
  agentRole: string
): { content: [{ type: 'text'; text: string }]; isError: true } | null {
  if (agentRole === 'Project Manager') {
    return null;
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: `Error: ${toolName} is a PM-only tool. You are: ${agentRole}`,
      },
    ],
    isError: true,
  };
}
