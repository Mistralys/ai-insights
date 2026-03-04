import { describe, it, expect } from 'vitest';
import { _internal } from '../../src/tools/observations.js';

const { AddObservationSchema } = _internal;

// Base valid input for AddObservationSchema (work_package_id varied per test)
const base = {
  project_path: '/tmp/test-project',
  pipeline_type: 'implementation',
  type: 'improvement',
  priority: 'low',
  note: 'test note',
} as const;

// ─── AddObservationSchema work_package_id regex (WP-\d{3,}) ────────────────

describe('AddObservationSchema work_package_id regex (WP-\\d{3,})', () => {
  it('accepts a standard 3-digit WP ID (WP-001)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-001' })).not.toThrow();
  });

  it('accepts a 3-digit WP ID at upper boundary (WP-999)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-999' })).not.toThrow();
  });

  it('accepts a 4-digit WP ID (WP-1000)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-1000' })).not.toThrow();
  });

  it('accepts a 5-digit WP ID (WP-12345)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-12345' })).not.toThrow();
  });

  it('rejects a 1-digit WP ID (WP-1)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-1' })).toThrow();
  });

  it('rejects a 2-digit WP ID (WP-12)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-12' })).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: '' })).toThrow();
  });

  it('rejects a lowercase prefix (wp-001)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'wp-001' })).toThrow();
  });

  it('rejects missing prefix (just digits)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: '001' })).toThrow();
  });

  it('rejects WP- with no digits', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-' })).toThrow();
  });

  it('rejects a trailing-alpha WP ID (WP-123abc) — L-6', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-123abc' })).toThrow();
  });
});
