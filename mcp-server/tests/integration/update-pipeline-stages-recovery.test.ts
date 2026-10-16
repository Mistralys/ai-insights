/**
 * Tool-driven recovery integration test for ledger_update_pipeline_stages (AC-10).
 *
 * Walks a 4-stage work package to COMPLETE, reopens it, adds a missing
 * security-audit stage through the new tool, and drives the WP back to
 * COMPLETE through the re-engaged downstream stages — all via real tool
 * handlers, with no seeded stage list or counters. Modelled on
 * tests/integration/rework-limit.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import { _internal as beginWorkInternal } from '../../src/tools/begin-work.js';
import { _internal as pipelineInternal } from '../../src/tools/pipeline.js';
import { _internal as wpInternal } from '../../src/tools/work-package.js';
import { _internal as adminInternal } from '../../src/tools/work-package-admin.js';
import { _internal as nextActionInternal } from '../../src/tools/workflow-next-action.js';
import type { RootIndex } from '../../src/schema/root-index.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-update-pipeline-stages-recovery-test');

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

function json(result: ToolResult): any {
  return JSON.parse(result.content[0]!.text);
}

function emptyRoot(): RootIndex {
  return {
    plan_file: 'plan.md',
    date_created: now(),
    last_updated: now(),
    status: 'READY',
    total_work_packages: 0,
    pending_work_packages: 0,
    work_packages: [],
    project_comments: [],
  };
}

describe('ledger_update_pipeline_stages — tool-driven reopen-then-restage recovery (AC-10)', () => {
  let tempDir: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'update-pipeline-stages-recovery-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempDir);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempDir, { recursive: true, force: true });
  });

  const nextAction = async (role: string) =>
    json((await nextActionInternal.getNextAction({ project_path: PLAN_PATH, agent_role: role })) as ToolResult);

  const begin = (id: string, type: string, role: string) =>
    beginWorkInternal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: id,
      type: type as any,
      agent_role: role,
    }) as Promise<ToolResult>;

  const startPipeline = (id: string, type: string, role: string) =>
    pipelineInternal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: id,
      type: type as any,
      agent_role: role,
    } as any) as Promise<ToolResult>;

  const complete = (id: string, type: string, role: string, status: 'PASS' | 'FAIL', extra: Record<string, unknown> = {}) =>
    pipelineInternal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: id,
      type: type as any,
      agent_role: role,
      status,
      summary: [`${type} ${status}`],
      ...(type === 'implementation' ? { artifacts: { files_modified: ['src/x.ts'] } } : {}),
      ...extra,
    } as any) as Promise<ToolResult>;

  it('reopens a COMPLETE 4-stage WP, adds security-audit via the tool, and drives it back to COMPLETE with no seeded state', async () => {
    await store.writeRootIndex(emptyRoot());

    // 1. Create a standard 4-stage WP.
    const created = (await wpInternal.createWorkPackage(
      {
        project_path: PLAN_PATH,
        assigned_to: 'Developer',
        dependencies: [],
        title: 'WP',
        description: 'Reopen-then-restage recovery walk.',
        acceptance_criteria: ['Works'],
      },
      tempDir,
    )) as ToolResult;
    expect(created.isError, created.content[0]!.text).toBeFalsy();

    // 2. Walk WP-001 to COMPLETE: implementation -> qa -> code-review -> documentation, all PASS.
    expect((await begin('WP-001', 'implementation', 'Developer')).isError).toBeFalsy();
    expect((await complete('WP-001', 'implementation', 'Developer', 'PASS')).isError).toBeFalsy();

    expect((await begin('WP-001', 'qa', 'QA')).isError).toBeFalsy();
    expect((await complete('WP-001', 'qa', 'QA', 'PASS')).isError).toBeFalsy();

    expect((await begin('WP-001', 'code-review', 'Reviewer')).isError).toBeFalsy();
    expect((await complete('WP-001', 'code-review', 'Reviewer', 'PASS')).isError).toBeFalsy();

    expect((await begin('WP-001', 'documentation', 'Documentation')).isError).toBeFalsy();
    const docComplete = await complete('WP-001', 'documentation', 'Documentation', 'PASS', {
      acceptance_criteria_updates: [{ criterion: 'Works', met: true }],
    });
    expect(docComplete.isError, docComplete.content[0]!.text).toBeFalsy();
    expect((await store.readWorkPackage('WP-001')).status).toBe('COMPLETE');

    // 3. Reopen via ledger_update_work_package_status (COMPLETE -> IN_PROGRESS, Project Manager).
    const reopened = (await wpInternal.updateWorkPackageStatus(
      { project_path: PLAN_PATH, work_package_id: 'WP-001', status: 'IN_PROGRESS', agent: 'Project Manager' },
      tempDir,
    )) as ToolResult;
    expect(reopened.isError, reopened.content[0]!.text).toBeFalsy();
    expect((await store.readWorkPackage('WP-001')).status).toBe('IN_PROGRESS');

    // 4. Add security-audit through ledger_update_pipeline_stages.
    const restaged = (await adminInternal.updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'qa', 'security-audit', 'code-review', 'documentation'],
        reason: 'Original stage list was mis-transcribed and omitted security-audit.',
      },
      tempDir,
    )) as ToolResult;
    expect(restaged.isError, restaged.content[0]!.text).toBeFalsy();
    expect((await store.readWorkPackage('WP-001')).active_pipeline_stages).toEqual([
      'implementation', 'qa', 'security-audit', 'code-review', 'documentation',
    ]);

    // 5. Security Auditor's recommendation is RUN_SECURITY_AUDIT.
    const auditorAction = await nextAction('Security Auditor');
    expect(auditorAction.action).toBe('RUN_SECURITY_AUDIT');
    expect(auditorAction.work_package_id).toBe('WP-001');

    // 6. startPipeline('security-audit') is accepted.
    const auditStarted = await startPipeline('WP-001', 'security-audit', 'Security Auditor');
    expect(auditStarted.isError, auditStarted.content[0]!.text).toBeFalsy();

    // 7. Audit PASS re-engages code-review then documentation.
    const auditCompleted = await complete('WP-001', 'security-audit', 'Security Auditor', 'PASS');
    expect(auditCompleted.isError, auditCompleted.content[0]!.text).toBeFalsy();

    const reviewerAction = await nextAction('Reviewer');
    expect(reviewerAction.action).toBe('RUN_REVIEW');
    expect(reviewerAction.work_package_id).toBe('WP-001');

    expect((await begin('WP-001', 'code-review', 'Reviewer')).isError).toBeFalsy();
    const reviewCompleted = await complete('WP-001', 'code-review', 'Reviewer', 'PASS');
    expect(reviewCompleted.isError, reviewCompleted.content[0]!.text).toBeFalsy();

    const docAction = await nextAction('Documentation');
    expect(docAction.work_package_id).toBe('WP-001');
    expect(docAction.action).not.toBe('WAIT');

    // 8. WP finalizes COMPLETE after the re-engaged documentation stage passes.
    expect((await begin('WP-001', 'documentation', 'Documentation')).isError).toBeFalsy();
    const finalDoc = await complete('WP-001', 'documentation', 'Documentation', 'PASS');
    expect(finalDoc.isError, finalDoc.content[0]!.text).toBeFalsy();

    expect((await store.readWorkPackage('WP-001')).status).toBe('COMPLETE');
  });
});
