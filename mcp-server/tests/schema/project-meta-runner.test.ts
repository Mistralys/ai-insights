/**
 * Tests for runner fields added to ProjectMetaSchema and RootIndexSchema.
 *
 * Verifies:
 * - New runner fields are accepted when present
 * - Existing .meta.json files without runner fields parse successfully (AC5)
 */

import { describe, it, expect } from 'vitest';
import { ProjectMetaSchema } from '../../src/schema/project-meta.js';
import { RootIndexSchema } from '../../src/schema/root-index.js';

// --- Shared base objects (no runner fields) ---

const BASE_META = {
  slug: '2026-01-01-my-project',
  plan_path: '/plans/2026-01-01-my-project',
  status: 'READY' as const,
  date_created: '2026-01-01T00:00:00.000Z',
  last_updated: '2026-01-01T00:00:00.000Z',
};

const BASE_ROOT = {
  plan_file: 'plan.md',
  date_created: '2026-01-01T00:00:00.000Z',
  last_updated: '2026-01-01T00:00:00.000Z',
  status: 'READY' as const,
  total_work_packages: 0,
  pending_work_packages: 0,
  work_packages: [],
  project_comments: [],
};

// --- ProjectMetaSchema runner fields ---

describe('ProjectMetaSchema - runner fields', () => {
  it('accepts all runner fields when present', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      runner: 'orchestrator',
      runner_client: 'langchain-mcp-adapters',
      runner_version: '1.0',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runner).toBe('orchestrator');
      expect(result.data.runner_client).toBe('langchain-mcp-adapters');
      expect(result.data.runner_version).toBe('1.0');
    }
  });

  it('accepts vscode runner', () => {
    const result = ProjectMetaSchema.safeParse({ ...BASE_META, runner: 'vscode', runner_client: 'Visual Studio Code', runner_version: '1.99' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.runner).toBe('vscode');
  });

  it('accepts claude-code runner', () => {
    const result = ProjectMetaSchema.safeParse({ ...BASE_META, runner: 'claude-code', runner_client: 'claude-code', runner_version: '0.2' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.runner).toBe('claude-code');
  });

  // AC5: backward compatibility
  it('accepts existing meta without runner fields (AC5 - backward compat)', () => {
    const result = ProjectMetaSchema.safeParse(BASE_META);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runner).toBeUndefined();
      expect(result.data.runner_client).toBeUndefined();
      expect(result.data.runner_version).toBeUndefined();
    }
  });

  it('rejects invalid runner enum value', () => {
    const result = ProjectMetaSchema.safeParse({ ...BASE_META, runner: 'cursor' });
    expect(result.success).toBe(false);
  });

  it('runner_client and runner_version accept empty strings', () => {
    const result = ProjectMetaSchema.safeParse({ ...BASE_META, runner: 'unknown', runner_client: '', runner_version: '' });
    expect(result.success).toBe(true);
  });
});

// --- RootIndexSchema runner fields ---

describe('RootIndexSchema - runner fields', () => {
  it('accepts all runner fields when present', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      runner: 'orchestrator',
      runner_client: 'langchain-mcp-adapters',
      runner_version: '1.0',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runner).toBe('orchestrator');
    }
  });

  // AC5: backward compatibility for root index
  it('accepts existing root index without runner fields (AC5 - backward compat)', () => {
    const result = RootIndexSchema.safeParse(BASE_ROOT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runner).toBeUndefined();
      expect(result.data.runner_client).toBeUndefined();
      expect(result.data.runner_version).toBeUndefined();
    }
  });

  it('rejects invalid runner enum value', () => {
    const result = RootIndexSchema.safeParse({ ...BASE_ROOT, runner: 'cursor' });
    expect(result.success).toBe(false);
  });

  it('accepts a full legacy root index without runner fields', () => {
    // Simulates a real project-ledger.json written before runner fields were added
    const legacy = {
      plan_file: 'plan.md',
      date_created: '2025-12-01T08:00:00.000Z',
      last_updated: '2025-12-15T14:30:00.000Z',
      status: 'COMPLETE',
      total_work_packages: 2,
      pending_work_packages: 0,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Documentation', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
      synthesis_generated: true,
      ledger_version: '2.3.0',
    };
    const result = RootIndexSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runner).toBeUndefined();
      expect(result.data.runner_client).toBeUndefined();
      expect(result.data.runner_version).toBeUndefined();
    }
  });
});
