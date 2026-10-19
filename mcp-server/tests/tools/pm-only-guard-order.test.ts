/**
 * PM-only guard order tests (pipeline-stage-adjustment rework-2, WP-002).
 *
 * Two independent concerns are covered here:
 *
 * 1. **Behavioural guard order (AC-01):** each of the four PM-only tools,
 *    called by a non-PM `agent_role` with a syntactically valid but
 *    non-existent `project_path`, must return the exact `requirePmRole`
 *    rejection and must write nothing to disk. This proves the guard runs
 *    before any project resolution or storage access, regardless of whether
 *    the target project exists.
 *
 * 2. **Completeness of the guarded-tool inventory (AC-02):** `PM_ONLY_TOOLS`
 *    below is a hand-maintained table of tool names expected to be guarded by
 *    `requirePmRole`. `collectPmGuardedTools()` independently *derives* the
 *    guarded tool names by scanning every `.ts` file under `src/tools/` that
 *    imports a binding from `pm-role-guard` (including an aliased import or a
 *    multi-line call) and reading the string literal passed as that binding's
 *    first argument. `findUndeclaredGuardedTools()` diffs the derived set
 *    against `PM_ONLY_TOOLS`: a name the scan finds that isn't in the table
 *    fails the test, so an un-updated table is caught the moment a new guarded
 *    tool is added — this is deliberately independent of the hand-maintained
 *    table so it can't drift silently.
 *
 * NOTE for the role-alias stub plan (`docs/agents/plans/2026-10-19-role-alias-alignment/`):
 * this scan is coupled to the *name* `requirePmRole` as exported by
 * `pm-role-guard.ts`. If that plan renames or wraps the guard behind a new
 * export, `collectPmGuardedTools()`'s `requirePmRole` identifier below must be
 * updated (or generalised) to track it, or this completeness check will
 * silently stop finding any guarded tool.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'fs/promises';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { _internal } from '../../src/tools/work-package-admin.js';

const { resetReworkCount, reopenCancelledWp, updateAcceptanceCriteria, updatePipelineStages } = _internal;

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, '../../src/tools');

// ─── Hand-maintained inventory of PM-only tools (cross-checked below) ────────

const PM_ONLY_TOOLS = [
  'ledger_reset_rework_count',
  'ledger_reopen_cancelled_wp',
  'ledger_update_acceptance_criteria',
  'ledger_update_pipeline_stages',
] as const;

// ─── Derived-completeness scanner ────────────────────────────────────────────

/**
 * Scans `sourceText` for every bound name imported from a module path
 * containing `pm-role-guard` (handling a plain import and an aliased
 * `X as Y` import), then collects the first string-literal argument of every
 * call to any such bound name — including a call whose arguments span
 * multiple lines.
 */
export function collectPmGuardedTools(sourceText: string): string[] {
  const boundNames: string[] = [];
  const importRegex = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*pm-role-guard(?:\.js)?['"]/g;
  let importMatch: RegExpExecArray | null;

  while ((importMatch = importRegex.exec(sourceText)) !== null) {
    const specifiers = importMatch[1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const spec of specifiers) {
      const aliasMatch = spec.match(/^(\w+)\s+as\s+(\w+)$/);
      if (aliasMatch) {
        if (aliasMatch[1] === 'requirePmRole') {
          boundNames.push(aliasMatch[2]!);
        }
      } else if (spec === 'requirePmRole') {
        boundNames.push('requirePmRole');
      }
    }
  }

  const toolNames: string[] = [];
  for (const name of boundNames) {
    // `[\s\S]*?` (not `.`) so a call whose opening paren and string literal
    // are separated by a newline is still matched.
    const callRegex = new RegExp(`\\b${name}\\s*\\([\\s\\S]*?['"\`]([^'"\`]+)['"\`]`, 'g');
    let callMatch: RegExpExecArray | null;
    while ((callMatch = callRegex.exec(sourceText)) !== null) {
      toolNames.push(callMatch[1]!);
    }
  }

  return toolNames;
}

/** Returns every name in `guardedToolNames` that has no row in `knownTools`. */
export function findUndeclaredGuardedTools(
  guardedToolNames: string[],
  knownTools: readonly string[]
): string[] {
  return guardedToolNames.filter((name) => !knownTools.includes(name));
}

/** Scans every `.ts` file directly under `src/tools/` that imports `pm-role-guard`. */
function scanToolsDirectory(): { importingFiles: string[]; guardedToolNames: string[] } {
  const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'));
  const importingFiles: string[] = [];
  const guardedToolNames: string[] = [];

  for (const file of files) {
    const text = readFileSync(join(TOOLS_DIR, file), 'utf-8');
    if (!text.includes('pm-role-guard')) {
      continue;
    }
    importingFiles.push(file);
    guardedToolNames.push(...collectPmGuardedTools(text));
  }

  return { importingFiles, guardedToolNames };
}

describe('collectPmGuardedTools — unit behaviour', () => {
  it('finds a tool name behind a plain, single-line import and call', () => {
    const source = `
import { requirePmRole } from '../utils/pm-role-guard.js';
function handler(args) {
  const pmGuard = requirePmRole('ledger_example_tool', args.agent_role);
}
`;
    expect(collectPmGuardedTools(source)).toEqual(['ledger_example_tool']);
  });

  it('finds a tool name behind an aliased import', () => {
    const source = `
import { requirePmRole as checkPm } from '../utils/pm-role-guard.js';
function handler(args) {
  const pmGuard = checkPm('ledger_aliased_tool', args.agent_role);
}
`;
    expect(collectPmGuardedTools(source)).toEqual(['ledger_aliased_tool']);
  });

  it('finds a tool name behind a multi-line call', () => {
    const source = `
import { requirePmRole } from '../utils/pm-role-guard.js';
function handler(args) {
  const pmGuard = requirePmRole(
    'ledger_multiline_tool',
    args.agent_role
  );
}
`;
    expect(collectPmGuardedTools(source)).toEqual(['ledger_multiline_tool']);
  });

  it('returns an empty array for a file that never imports pm-role-guard', () => {
    const source = `
function handler(args) {
  return args.agent_role === 'Project Manager';
}
`;
    expect(collectPmGuardedTools(source)).toEqual([]);
  });

  it('finds every call when the same bound name guards multiple tools', () => {
    const source = `
import { requirePmRole } from '../utils/pm-role-guard.js';
function a(args) { return requirePmRole('ledger_tool_a', args.agent_role); }
function b(args) { return requirePmRole('ledger_tool_b', args.agent_role); }
`;
    expect(collectPmGuardedTools(source)).toEqual(['ledger_tool_a', 'ledger_tool_b']);
  });
});

describe('findUndeclaredGuardedTools — completeness check', () => {
  it('reports a guarded tool name absent from the known-tools table', () => {
    const result = findUndeclaredGuardedTools(['ledger_unknown_tool'], PM_ONLY_TOOLS);
    expect(result).toEqual(['ledger_unknown_tool']);
  });

  it('reports nothing when every guarded name is already known', () => {
    const result = findUndeclaredGuardedTools(['ledger_reset_rework_count'], PM_ONLY_TOOLS);
    expect(result).toEqual([]);
  });
});

describe('pm-only-guard-order.test.ts — derived completeness against src/tools/', () => {
  it('non-vacuity: finds at least one file under src/tools/ importing pm-role-guard', () => {
    const { importingFiles } = scanToolsDirectory();
    expect(importingFiles.length).toBeGreaterThan(0);
  });

  it('non-vacuity: finds at least one guarded tool name', () => {
    const { guardedToolNames } = scanToolsDirectory();
    expect(guardedToolNames.length).toBeGreaterThan(0);
  });

  it('every tool guarded via a pm-role-guard binding has a row in PM_ONLY_TOOLS', () => {
    const { guardedToolNames } = scanToolsDirectory();
    const undeclared = findUndeclaredGuardedTools(guardedToolNames, PM_ONLY_TOOLS);
    expect(undeclared, `Undeclared PM-only tool(s) found by source scan: ${undeclared.join(', ')}`).toEqual([]);
  });

  it('every row in PM_ONLY_TOOLS is actually found by the source scan (no stale entries)', () => {
    const { guardedToolNames } = scanToolsDirectory();
    for (const toolName of PM_ONLY_TOOLS) {
      expect(guardedToolNames, `PM_ONLY_TOOLS entry "${toolName}" was not found by the source scan`).toContain(
        toolName
      );
    }
  });
});

// ─── AC-01: behavioural guard order — rejects before any disk I/O ───────────

const PLAN_PATH = join(tmpdir(), '2026-01-01-pm-only-guard-order-nonexistent-project');

describe('AC-01 — all four PM-only tools reject a non-PM caller before any disk I/O', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pm-only-guard-order-'));
    // Intentionally not seeding any LedgerStore data — PLAN_PATH never existed
    // under tempDir. A guard that resolves the project or touches the store
    // before checking the role would throw/404 instead of returning the
    // requirePmRole rejection, and would also be the only path that could
    // write anything under tempDir.
    void new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function assertNoFilesWritten() {
    const entries = await readdir(tempDir).catch(() => []);
    expect(entries, `Expected no files under the ledger root, found: ${entries.join(', ')}`).toEqual([]);
  }

  it('ledger_reset_rework_count', async () => {
    const result = await resetReworkCount(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        pipeline_type: 'implementation',
        agent_role: 'Developer',
        reason: 'test reason',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toBe(
      'Error: ledger_reset_rework_count is a PM-only tool. You are: Developer'
    );
    await assertNoFilesWritten();
  });

  it('ledger_reopen_cancelled_wp', async () => {
    const result = await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Developer',
        reason: 'test reason',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toBe(
      'Error: ledger_reopen_cancelled_wp is a PM-only tool. You are: Developer'
    );
    await assertNoFilesWritten();
  });

  it('ledger_update_acceptance_criteria', async () => {
    const result = await updateAcceptanceCriteria(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Developer',
        operations: [{ action: 'remove', criterion: 'some criterion' }],
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toBe(
      'Error: ledger_update_acceptance_criteria is a PM-only tool. You are: Developer'
    );
    await assertNoFilesWritten();
  });

  it('ledger_update_pipeline_stages', async () => {
    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Developer',
        stages: ['implementation'],
        reason: 'test reason',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toBe(
      'Error: ledger_update_pipeline_stages is a PM-only tool. You are: Developer'
    );
    await assertNoFilesWritten();
  });
});
