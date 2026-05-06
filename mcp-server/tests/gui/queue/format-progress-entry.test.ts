/**
 * Tests for src/gui/queue/format-progress-entry.ts — WP-002
 *
 * Verifies:
 *   AC-1: formatProgressEntry() returns "Tool call: {tool_name}" for tool_call entries.
 *   AC-3: Test verifies tool_call formatting.
 *
 * Note: resolve-progress.test.ts covers 7 of the 11 event types via integration;
 * this file focuses specifically on the tool_call addition from WP-002.
 */

import { describe, it, expect } from 'vitest';
import { formatProgressEntry } from '../../../src/gui/queue/format-progress-entry.js';

describe('formatProgressEntry — tool_call (WP-002)', () => {
  it('AC-1: returns "Tool call: {tool_name}" when tool_name is present', () => {
    expect(
      formatProgressEntry({ action: 'tool_call', tool_name: 'ledger_get_next_action' }),
    ).toBe('Tool call: ledger_get_next_action');
  });

  it('returns "Tool call" when tool_name is absent', () => {
    expect(formatProgressEntry({ action: 'tool_call' })).toBe('Tool call');
  });

  it('returns "Tool call" when tool_name is a non-string value', () => {
    expect(formatProgressEntry({ action: 'tool_call', tool_name: 42 })).toBe('Tool call');
  });

  it('returns "Tool call" when tool_name is an empty string', () => {
    expect(formatProgressEntry({ action: 'tool_call', tool_name: '' })).toBe('Tool call');
  });

  it('existing actions are unaffected: run_start still returns "Run started"', () => {
    expect(formatProgressEntry({ action: 'run_start' })).toBe('Run started');
  });

  it('existing actions are unaffected: heartbeat still returns null', () => {
    expect(formatProgressEntry({ action: 'heartbeat' })).toBeNull();
  });
});
