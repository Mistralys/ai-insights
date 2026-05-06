/**
 * Maps JSONL orchestrator log entries to human-readable progress strings.
 *
 * This module is pure — it has no I/O dependencies and no side effects.
 * All event types that do not produce a useful summary return `null`.
 */

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

/**
 * Maps a single JSONL log entry to a human-readable progress string.
 *
 * Returns `null` for event types that do not produce a useful summary
 * (e.g. `heartbeat`, unrecognised actions).
 *
 * Exported for unit testing.
 */
export function formatProgressEntry(entry: Record<string, unknown>): string | null {
  const action   = typeof entry['action']    === 'string' ? entry['action']    : undefined;
  const stage    = typeof entry['stage']     === 'string' ? entry['stage']     : undefined;
  const wpId     = typeof entry['wp_id']     === 'string' ? entry['wp_id']     : undefined;
  const toolName = typeof entry['tool_name'] === 'string' && entry['tool_name'].length > 0
    ? entry['tool_name']
    : undefined;

  switch (action) {
    case 'run_start':
      return 'Run started';

    case 'stage_start': {
      const label = stage ?? '(unknown stage)';
      return wpId ? `Starting ${label} for ${wpId}` : `Starting ${label}`;
    }

    case 'stage_complete': {
      const result = typeof entry['result'] === 'string' ? entry['result'] : undefined;
      const label  = stage ?? '(unknown stage)';
      const suffix = wpId ? ` (${wpId})` : '';
      return result
        ? `${label} complete — ${result}${suffix}`
        : `${label} complete${suffix}`;
    }

    case 'progress_snapshot': {
      const total = typeof entry['total_wps'] === 'number' ? entry['total_wps'] : undefined;
      const bd    = (entry['status_breakdown'] ?? {}) as Record<string, number>;
      const done  = bd['COMPLETE'] ?? 0;
      return total != null ? `Progress: ${done}/${total} WPs complete` : 'Progress update';
    }

    case 'tool_call':
      return toolName ? `Tool call: ${toolName}` : 'Tool call';

    case 'wp_complete':
      return wpId ? `${wpId} complete` : 'WP complete';

    case 'wp_status_change': {
      const newStatus =
        typeof entry['new_status'] === 'string' ? entry['new_status'] : undefined;
      const prefix = wpId ? `${wpId} ` : '';
      return `${prefix}${newStatus ? `→ ${newStatus}` : 'status change'}`;
    }

    case 'run_end': {
      const result = typeof entry['result'] === 'string' ? entry['result'] : undefined;
      return result ? `Run ended: ${result}` : 'Run ended';
    }

    case 'run_error':
      return 'Run error';

    case 'signal_shutdown':
      return 'Interrupted by signal';

    case 'heartbeat':
      return null;  // intentionally skipped

    default:
      return null;
  }
}
