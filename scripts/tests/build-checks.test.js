/**
 * scripts/tests/build-checks.test.js
 *
 * Unit tests for scripts/lib/build-checks.js — the generic check-runner
 * (WP-007 of the 2026-09-30-persona-targets-and-tool-validation-rework-1
 * plan) that replaced build-personas.js's five scattered process.exit
 * points.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runBuildChecks, resolveExitCode } from '../lib/build-checks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeIo() {
  const logs = [];
  const warns = [];
  const errors = [];
  return {
    io: {
      log: (msg) => logs.push(msg),
      warn: (msg) => warns.push(msg),
      error: (msg) => errors.push(msg),
    },
    logs,
    warns,
    errors,
  };
}

describe('runBuildChecks', () => {
  it('runs every descriptor in order and returns zero counts when all are clean', async () => {
    const order = [];
    const checks = [
      { id: 'a', label: 'Check A', severity: 'error', run: () => { order.push('a'); return []; } },
      { id: 'b', label: 'Check B', severity: 'warn',  run: () => { order.push('b'); return []; } },
    ];

    const { io } = makeIo();
    const result = await runBuildChecks(checks, io);

    expect(order).toEqual(['a', 'b']);
    expect(result).toEqual({ errorCount: 0, warningCount: 0 });
  });

  it('awaits an async descriptor before moving to the next one', async () => {
    const order = [];
    const checks = [
      {
        id: 'async-a', label: 'Async A', severity: 'error',
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push('async-a');
          return [];
        },
      },
      { id: 'b', label: 'Sync B', severity: 'error', run: () => { order.push('b'); return []; } },
    ];

    await runBuildChecks(checks);
    expect(order).toEqual(['async-a', 'b']);
  });

  it('reports error-severity findings under an [ERROR] prefix and counts them', async () => {
    const { io, errors } = makeIo();
    const checks = [
      { id: 'a', label: 'Check A', severity: 'error', run: () => ['finding one', 'finding two'] },
    ];

    const result = await runBuildChecks(checks, io);

    expect(result.errorCount).toBe(2);
    expect(result.warningCount).toBe(0);
    expect(errors.some((line) => line.includes('[ERROR]') && line.includes('Check A'))).toBe(true);
    expect(errors.some((line) => line.includes('finding one'))).toBe(true);
    expect(errors.some((line) => line.includes('finding two'))).toBe(true);
  });

  it('reports warn-severity findings under a [WARN] prefix and counts them', async () => {
    const { io, warns } = makeIo();
    const checks = [
      { id: 'a', label: 'Check A', severity: 'warn', run: () => ['soft finding'] },
    ];

    const result = await runBuildChecks(checks, io);

    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(1);
    expect(warns.some((line) => line.includes('[WARN]'))).toBe(true);
    expect(warns.some((line) => line.includes('soft finding'))).toBe(true);
  });

  it('prints nothing for a descriptor whose run() returns an empty array', async () => {
    const { io, logs, warns, errors } = makeIo();
    const checks = [
      { id: 'a', label: 'Check A', severity: 'error', run: () => [] },
    ];

    await runBuildChecks(checks, io);

    expect(logs).toEqual([]);
    expect(warns).toEqual([]);
    expect(errors).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Synthetic failing-descriptor fixture — a descriptor whose run() throws or
  // rejects is recorded as an error-severity result for that descriptor
  // (whatever its declared severity), and the loop continues.
  // ---------------------------------------------------------------------------

  it('records a synchronously-throwing descriptor as an error result and continues to the next', async () => {
    const order = [];
    const { io, errors } = makeIo();
    const checks = [
      {
        id: 'boom', label: 'Boom Check', severity: 'warn',
        run: () => { order.push('boom'); throw new Error('synthetic failure'); },
      },
      { id: 'after', label: 'After Check', severity: 'error', run: () => { order.push('after'); return []; } },
    ];

    const result = await runBuildChecks(checks, io);

    expect(order).toEqual(['boom', 'after']);
    expect(result.errorCount).toBe(1);
    expect(errors.some((line) =>
      line.includes('[ERROR]') && line.includes('Boom Check') && line.includes('check failed to run') && line.includes('synthetic failure'),
    )).toBe(true);
  });

  it('records a rejecting async descriptor as an error result and continues to the next', async () => {
    const order = [];
    const { io, errors } = makeIo();
    const checks = [
      {
        id: 'rejects', label: 'Rejecting Check', severity: 'error',
        run: async () => { order.push('rejects'); throw new Error('async synthetic failure'); },
      },
      { id: 'after', label: 'After Check', severity: 'error', run: () => { order.push('after'); return []; } },
    ];

    const result = await runBuildChecks(checks, io);

    expect(order).toEqual(['rejects', 'after']);
    expect(result.errorCount).toBe(1);
    expect(errors.some((line) => line.includes('async synthetic failure'))).toBe(true);
  });
});

describe('resolveExitCode', () => {
  it('returns the library status when it is non-zero, regardless of errorCount', () => {
    expect(resolveExitCode(1, { errorCount: 0 })).toBe(1);
    expect(resolveExitCode(2, { errorCount: 5 })).toBe(2);
  });

  it('returns 1 when the library status is zero but errorCount is positive', () => {
    expect(resolveExitCode(0, { errorCount: 1 })).toBe(1);
  });

  it('returns 0 when the library status is zero and errorCount is zero', () => {
    expect(resolveExitCode(0, { errorCount: 0 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Source-text assertion: build-personas.js must call process.exit exactly
// once (Plan AC-12) — a failing library CLI or check must no longer exit
// early and hide later checks or post-build steps.
// ---------------------------------------------------------------------------

describe('build-personas.js — single process.exit call', () => {
  it('contains exactly one process.exit( call site', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'build-personas.js'),
      'utf8',
    );

    const matches = source.match(/process\.exit\(/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
