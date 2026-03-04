import type { WorkPackageDetail, Pipeline } from '../../src/schema/work-package.js';
import type { WorkPackageSummary } from '../../src/schema/root-index.js';

export function makeWorkPackageDetail(
  overrides: Partial<WorkPackageDetail> = {}
): WorkPackageDetail {
  return {
    work_package_id: 'WP-001',
    work_package_file: 'work/WP-001.md',
    status: 'IN_PROGRESS',
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [{ criterion: 'All tests pass', met: false }],
    revision: 0,
    pipelines: [],
    ...overrides,
  };
}

export function makePipeline(overrides?: Partial<Pipeline>): Pipeline;
export function makePipeline(type: string, status: string, started_at?: string, completed_at?: string): Pipeline;
export function makePipeline(
  typeOrOverrides?: string | Partial<Pipeline>,
  status?: string,
  started_at?: string,
  completed_at?: string,
): Pipeline {
  if (typeof typeOrOverrides === 'string') {
    return {
      type: typeOrOverrides,
      status: status as Pipeline['status'],
      summary: [],
      ...(started_at ? { started_at } : {}),
      ...(completed_at ? { completed_at } : {}),
    };
  }
  return {
    type: 'implementation',
    status: 'IN_PROGRESS',
    started_at: new Date().toISOString(),
    summary: [],
    ...typeOrOverrides,
  };
}

export function makeWorkPackageSummary(
  overrides: Partial<WorkPackageSummary> = {}
): WorkPackageSummary {
  return {
    work_package_id: 'WP-001',
    status: 'IN_PROGRESS',
    assigned_to: 'Developer',
    dependencies: [],
    file: 'ledger/WP-001.json',
    ...overrides,
  };
}
