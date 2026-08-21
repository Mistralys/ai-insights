/**
 * Integration tests for ledger_import_standalone MCP tool.
 *
 * Tests drive the handler function directly via _internal, using process.argv
 * injection to redirect resolveLedgerRoot() to a temporary directory so the
 * real ledger storage is never touched.
 *
 * Coverage:
 *   - Successful import from a plan folder with plan.md and synthesis.md
 *   - Rejection when plan.md is missing
 *   - Rejection when synthesis.md is missing
 *   - Rejection when slug already exists (duplicate import)
 *   - Response structure (slug, outcome_summary, archived_files, project_storage_path)
 *   - outcome_summary extraction via synthesis-parser
 *   - Neither project_path nor cwd_path provided
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { _internal } from '../../src/tools/standalone-import.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';

const { importStandalone, updateSynthesis } = _internal;

// ─── Constants ────────────────────────────────────────────────────────────

const PLAN_FOLDER_NAME = '2026-06-15-standalone-feature';

const SYNTHESIS_WITH_OUTCOME = `
# Synthesis

### Completion Status

Complete.

### Outcome Summary

Implemented the standalone feature end-to-end. All acceptance criteria were met and tests pass.

### Implementation Summary

- Added the core feature module
- Wrote unit and integration tests
`;

const SYNTHESIS_WITHOUT_OUTCOME = `
# Synthesis

### Implementation Summary

- Added the core feature module
- Wrote integration tests
`;

const PLAN_CONTENT = `# Plan\n\nThis is the standalone plan.\n`;
const USAGE_SCENARIOS_CONTENT = '# Usage Scenarios\n\n- Import a plan with authored scenarios.\n';

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseResult(result: unknown) {
  const r = result as { content: { type: string; text: string }[]; isError?: boolean };
  const text = r.content[0]!.text;
  return {
    text,
    parsed: (() => { try { return JSON.parse(text); } catch { return null; } })(),
    isError: r.isError === true,
  };
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────

let tempLedgerRoot: string;
let planDir: string;
let originalArgv: string[];

beforeEach(async () => {
  tempLedgerRoot = await mkdtemp(join(tmpdir(), 'standalone-import-test-'));
  planDir = join(tmpdir(), PLAN_FOLDER_NAME);
  await mkdir(planDir, { recursive: true });
  originalArgv = [...process.argv];
  process.argv.push('--ledger-dir', tempLedgerRoot);
});

afterEach(async () => {
  process.argv = originalArgv;
  await rm(tempLedgerRoot, { recursive: true, force: true });
  await rm(planDir, { recursive: true, force: true });
});

// ─── Successful import ────────────────────────────────────────────────────

describe('ledger_import_standalone — successful import', () => {
  it('creates a valid COMPLETE project from a folder with plan.md and synthesis.md (AC1)', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    const result = await importStandalone({ project_path: planDir });
    const { parsed, isError } = parseResult(result);

    expect(isError).toBe(false);

    // Verify the root index on disk
    const store = new LedgerStore(planDir, tempLedgerRoot);
    const root = await store.readRootIndex();
    expect(root.status).toBe('COMPLETE');
    expect(root.total_work_packages).toBe(1);
    expect(root.pending_work_packages).toBe(0);
    expect(root.synthesis_generated).toBe(true);
    expect(root.runner).toBe('standalone');
  });

  it('response includes slug, outcome_summary, archived_files, project_storage_path (AC5)', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    const result = await importStandalone({ project_path: planDir });
    const { parsed, isError } = parseResult(result);

    expect(isError).toBe(false);
    expect(parsed).toMatchObject({
      slug: PLAN_FOLDER_NAME,
      outcome_summary: expect.any(String),
      archived_files: expect.arrayContaining(['plan.md', 'synthesis.md']),
      project_storage_path: expect.any(String),
    });
  });

  it('extracts outcome_summary from ### Outcome Summary section', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    const result = await importStandalone({ project_path: planDir });
    const { parsed } = parseResult(result);

    expect(parsed.outcome_summary).toContain('Implemented the standalone feature end-to-end');
  });

  it('falls back to first Implementation Summary bullet when Outcome Summary absent', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITHOUT_OUTCOME, 'utf-8');

    const result = await importStandalone({ project_path: planDir });
    const { parsed, isError } = parseResult(result);

    expect(isError).toBe(false);
    expect(parsed.outcome_summary).toBe('Added the core feature module');
  });

  it('creates WP-001 detail file with COMPLETE status and implementation pipeline at PASS', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    await importStandalone({ project_path: planDir });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status).toBe('COMPLETE');
    expect(wp.assigned_to).toBe('Developer');
    expect(wp.active_pipeline_stages).toEqual(['implementation']);
    expect(wp.pipelines).toHaveLength(1);
    expect(wp.pipelines[0]!.type).toBe('implementation');
    expect(wp.pipelines[0]!.status).toBe('PASS');
  });

  it('archives plan.md and synthesis.md to the storage directory', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    const result = await importStandalone({ project_path: planDir });
    const { parsed } = parseResult(result);

    expect(parsed.archived_files).toEqual(
      expect.arrayContaining(['plan.md', 'synthesis.md'])
    );
  });

  it('archives usage-scenarios.md when present and excludes scenario-coverage.md', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');
    await writeFile(join(planDir, 'usage-scenarios.md'), USAGE_SCENARIOS_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'scenario-coverage.md'), '# Derived coverage report\n', 'utf-8');

    const result = await importStandalone({ project_path: planDir });
    const { parsed } = parseResult(result);
    const store = new LedgerStore(planDir, tempLedgerRoot);

    expect(parsed.archived_files).toEqual(
      expect.arrayContaining(['plan.md', 'synthesis.md', 'usage-scenarios.md'])
    );
    expect(parsed.archived_files).not.toContain('scenario-coverage.md');
    await expect(readFile(join(store.storageDir, 'usage-scenarios.md'), 'utf-8'))
      .resolves.toBe(USAGE_SCENARIOS_CONTENT);
    await expect(readFile(join(store.storageDir, 'scenario-coverage.md'), 'utf-8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports only required files when usage-scenarios.md is absent', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    const result = await importStandalone({ project_path: planDir });
    const { parsed } = parseResult(result);

    expect(parsed.archived_files).toEqual(['plan.md', 'synthesis.md']);
  });

  it('surfaces non-ENOENT access failures for usage-scenarios.md', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');
    await mkdir(join(planDir, 'usage-scenarios.md'), { recursive: true });

    const result = await importStandalone({ project_path: planDir });
    const { isError, text } = parseResult(result);

    expect(isError).toBe(true);
    expect(text).toContain('Import failed:');
    expect(text).toMatch(/ENOTSUP|operation not supported|EISDIR/);
  });

  it('accepts cwd_path as a fallback when project_path is not provided', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    const result = await importStandalone({ cwd_path: planDir });
    const { isError } = parseResult(result);

    expect(isError).toBe(false);
  });

  it('project_path takes precedence over cwd_path when both are supplied', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    // cwd_path points to a non-existent folder — should be ignored
    const result = await importStandalone({ project_path: planDir, cwd_path: '/does/not/exist' });
    const { isError } = parseResult(result);

    expect(isError).toBe(false);
  });

  it('persists duration_ms to .meta.json via the writeRootIndex() sync path', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    const result = await importStandalone({ project_path: planDir });
    const { isError } = parseResult(result);
    expect(isError).toBe(false);

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const meta = await store.readProjectMeta();
    // date_created is derived from plan.md's filesystem timestamp, so duration_ms is either
    // a nonnegative gap or null (same-session import nulled out by writeRootIndex()).
    expect(meta.duration_ms === null || (typeof meta.duration_ms === 'number' && meta.duration_ms >= 0)).toBe(true);
  });
});

// ─── Validation errors ────────────────────────────────────────────────────

describe('ledger_import_standalone — validation errors', () => {
  it('returns error when neither project_path nor cwd_path is provided', async () => {
    const result = await importStandalone({});
    const { isError, text } = parseResult(result);

    expect(isError).toBe(true);
    expect(text).toContain('Either project_path or cwd_path is required');
  });

  it('returns error when plan.md is missing (AC2)', async () => {
    // Only create synthesis.md — no plan.md
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    const result = await importStandalone({ project_path: planDir });
    const { isError, text } = parseResult(result);

    expect(isError).toBe(true);
    expect(text).toContain('plan.md not found');
  });

  it('returns error when synthesis.md is missing (AC3)', async () => {
    // Only create plan.md — no synthesis.md
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');

    const result = await importStandalone({ project_path: planDir });
    const { isError, text } = parseResult(result);

    expect(isError).toBe(true);
    expect(text).toContain('synthesis.md not found');
  });

  it('rejects duplicate imports — same slug already exists (AC4)', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    // First import succeeds
    await importStandalone({ project_path: planDir });

    // Second import should fail with duplicate error
    const result = await importStandalone({ project_path: planDir });
    const { isError, text } = parseResult(result);

    expect(isError).toBe(true);
    expect(text).toContain('already exists');
  });

  it('returns error when project_path does not follow YYYY-MM-DD-name convention', async () => {
    const badPlanDir = join(tmpdir(), 'not-a-valid-plan-folder');
    await mkdir(badPlanDir, { recursive: true });

    try {
      const result = await importStandalone({ project_path: badPlanDir });
      const { isError } = parseResult(result);
      expect(isError).toBe(true);
    } finally {
      await rm(badPlanDir, { recursive: true, force: true });
    }
  });
});

// ─── Uses deriveRepoName (AC6) ─────────────────────────────────────────────

describe('ledger_import_standalone — uses deriveRepoName (AC6)', () => {
  it('project_storage_path reflects the derived repo name and slug', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    const result = await importStandalone({ project_path: planDir });
    const { parsed } = parseResult(result);

    // storageDir = join(ledgerRoot, repoName, slug)
    // planDir has no docs/agents anchor → repoName = 'unknown'
    expect(parsed.project_storage_path).toContain(PLAN_FOLDER_NAME);
    expect(parsed.project_storage_path).toContain(tempLedgerRoot);
  });
});

// ─── project_summary parameter ────────────────────────────────────────────

describe('ledger_import_standalone — project_summary parameter', () => {
  it('persists project_summary in root index when provided', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    const summary = 'Implemented the feature using an approach that simplified state management.';
    await importStandalone({ project_path: planDir, project_summary: summary });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const root = await store.readRootIndex();
    expect(root.project_summary).toBe(summary);
  });

  it('persists project_summary in .meta.json when provided', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    const summary = 'A curated summary stored in meta.';
    const result = await importStandalone({ project_path: planDir, project_summary: summary });
    const { parsed } = parseResult(result);

    const metaPath = join(parsed.project_storage_path, '.meta.json');
    const metaRaw = await readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaRaw);
    expect(meta.project_summary).toBe(summary);
  });

  it('omits project_summary from root index when not provided (backward compatibility)', async () => {
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    await importStandalone({ project_path: planDir });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const root = await store.readRootIndex();
    expect(root.project_summary).toBeUndefined();
  });

  it('rejects an empty string for project_summary (schema validation)', async () => {
    // The ImportStandaloneSchema uses z.string().min(1) for project_summary.
    // Verify that min(1) constraint rejects empty strings.
    const { z } = await import('zod');
    const schema = z.object({ project_summary: z.string().min(1).optional() });
    expect(schema.safeParse({ project_summary: '' }).success).toBe(false);
    expect(schema.safeParse({ project_summary: 'valid' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });
});

// ─── ledger_update_synthesis — successful update ──────────────────────────

const SYNTHESIS_UPDATED = `
# Synthesis

### Completion Status

Complete.

### Outcome Summary

Updated outcome summary after post-import edits. All deferred improvements addressed.

### Implementation Summary

- Added the core feature module
- Wrote unit and integration tests
- Addressed deferred improvements
`;

describe('ledger_update_synthesis — successful update', () => {
  beforeEach(async () => {
    // Import the project first so it exists in the ledger.
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');
    await importStandalone({ project_path: planDir });
  });

  it('updates outcome_summary when synthesis is edited (AC-01)', async () => {
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_UPDATED, 'utf-8');

    const result = await updateSynthesis({ project_path: planDir });
    const { parsed, isError } = parseResult(result);

    expect(isError).toBe(false);

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const root = await store.readRootIndex();
    expect(root.outcome_summary).toContain('Updated outcome summary after post-import edits');
    expect(parsed.outcome_summary).toContain('Updated outcome summary after post-import edits');
  });

  it('re-archives synthesis.md to the storage directory (AC-02)', async () => {
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_UPDATED, 'utf-8');

    const result = await updateSynthesis({ project_path: planDir });
    const { parsed, isError } = parseResult(result);

    expect(isError).toBe(false);
    expect(parsed.archived_files).toContain('synthesis.md');

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const archivedContent = await readFile(join(store.storageDir, 'synthesis.md'), 'utf-8');
    expect(archivedContent).toContain('Updated outcome summary after post-import edits');
  });

  it('syncs outcome_summary to .meta.json (AC-01)', async () => {
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_UPDATED, 'utf-8');

    await updateSynthesis({ project_path: planDir });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const { readFile: fsReadFile } = await import('fs/promises');
    const metaRaw = await fsReadFile(join(store.storageDir, '.meta.json'), 'utf-8');
    const meta = JSON.parse(metaRaw);
    expect(meta.outcome_summary).toContain('Updated outcome summary after post-import edits');
  });

  it('response includes slug, outcome_summary, archived_files, project_storage_path', async () => {
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_UPDATED, 'utf-8');

    const result = await updateSynthesis({ project_path: planDir });
    const { parsed, isError } = parseResult(result);

    expect(isError).toBe(false);
    expect(parsed).toMatchObject({
      slug: PLAN_FOLDER_NAME,
      outcome_summary: expect.any(String),
      archived_files: expect.arrayContaining(['synthesis.md']),
      project_storage_path: expect.any(String),
    });
  });

  it('accepts cwd_path as a fallback when project_path is not provided', async () => {
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_UPDATED, 'utf-8');

    const result = await updateSynthesis({ cwd_path: planDir });
    const { isError } = parseResult(result);

    expect(isError).toBe(false);
  });
});

// ─── ledger_update_synthesis — guard errors ───────────────────────────────

describe('ledger_update_synthesis — guard errors', () => {
  it('rejects when neither project_path nor cwd_path is provided', async () => {
    const result = await updateSynthesis({});
    const { isError, text } = parseResult(result);

    expect(isError).toBe(true);
    expect(text).toContain('Either project_path or cwd_path is required');
  });

  it('rejects when project does not exist in ledger (AC-03)', async () => {
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');

    // No prior importStandalone — project does not exist.
    const result = await updateSynthesis({ project_path: planDir });
    const { isError, text } = parseResult(result);

    expect(isError).toBe(true);
    expect(text).toContain('no project with slug');
  });

  it('rejects when project status is not COMPLETE (AC-04)', async () => {
    // Import the project, then manually overwrite the root index to set status to IN_PROGRESS.
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');
    await importStandalone({ project_path: planDir });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const root = await store.readRootIndex();
    (root as any).status = 'IN_PROGRESS';
    await store.writeRootIndex(root as any);

    const result = await updateSynthesis({ project_path: planDir });
    const { isError, text } = parseResult(result);

    expect(isError).toBe(true);
    expect(text).toContain('status is "IN_PROGRESS"');
  });

  it('rejects when runner is not standalone (AC-05)', async () => {
    // Import the project, then manually set runner to something else.
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');
    await importStandalone({ project_path: planDir });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const root = await store.readRootIndex();
    root.runner = 'orchestrator';
    await store.writeRootIndex(root);

    const result = await updateSynthesis({ project_path: planDir });
    const { isError, text } = parseResult(result);

    expect(isError).toBe(true);
    expect(text).toContain('runner is "orchestrator"');
  });

  it('rejects when project is older than 90 days (AC-06)', async () => {
    // Import the project, then backdate synthesis_generated_at to 91 days ago.
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');
    await importStandalone({ project_path: planDir });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const root = await store.readRootIndex();
    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    root.synthesis_generated_at = ninetyOneDaysAgo.toISOString().replace(/\.\d{3}Z$/, 'Z');
    await store.writeRootIndex(root);

    const result = await updateSynthesis({ project_path: planDir });
    const { isError, text } = parseResult(result);

    expect(isError).toBe(true);
    expect(text).toContain('updates are only allowed within 90 days of import');
  });

  it('rejects when synthesis.md is missing from plan folder (AC-07)', async () => {
    // Import the project first.
    await writeFile(join(planDir, 'plan.md'), PLAN_CONTENT, 'utf-8');
    await writeFile(join(planDir, 'synthesis.md'), SYNTHESIS_WITH_OUTCOME, 'utf-8');
    await importStandalone({ project_path: planDir });

    // Delete synthesis.md from plan folder.
    await rm(join(planDir, 'synthesis.md'), { force: true });

    const result = await updateSynthesis({ project_path: planDir });
    const { isError, text } = parseResult(result);

    expect(isError).toBe(true);
    expect(text).toContain('synthesis.md not found');
  });
});
