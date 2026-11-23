/**
 * Spawned test worker — not a test file itself.
 *
 * Several copies run at once against one shared temp directory so the
 * concurrency tests exercise real OS processes contending on the real
 * `proper-lockfile` lock (the DEV and STABLE servers, the GUI and parallel
 * workflow runs allocating together). Each worker fires its calls in
 * parallel through a single context, prints the resulting values as one JSON
 * array on stdout, and exits non-zero with the cause on stderr when any call
 * fails.
 *
 * Usage (run with `node --import tsx`):
 *   [--fast-lock] file-provider    <dataDir> <counterFile> <count>   prints the allocated values
 *   [--fast-lock] temporary-codes  <dir> <count>                     prints the issued codes
 *
 * The optional leading `--fast-lock` flag installs the same test-only
 * withLock retry policy the in-process concurrency tests use
 * (`__setLockRetryForTesting`), so a cross-process test run contends on a
 * short backoff instead of paying the full production retry window inside
 * every spawned worker.
 */

import { fileProvider } from '../../../src/error-codes/providers/file-provider.js';
import { issueTemporaryCode } from '../../../src/error-codes/temporary-codes.js';
import type { AllocationOutcome, ProviderContext } from '../../../src/error-codes/provider-api.js';
import { __setLockRetryForTesting } from '../../../src/storage/file-lock.js';

async function runFileProvider(dataDir: string, counterFile: string, count: number): Promise<number[]> {
  const ctx: ProviderContext = {
    settings: { scope: 'global', counter_file: counterFile, counter_name: 'default', start_value: 1 },
    signal: new AbortController().signal,
    data_dir: dataDir,
    log: { info: () => undefined, warn: () => undefined },
  };
  const request = { request_id: 'worker', cwd_path: null, repository: null, context: null };

  const outcomes: AllocationOutcome[] = await Promise.all(
    Array.from({ length: count }, () => fileProvider.allocate(request, ctx))
  );

  return outcomes.map((outcome) => {
    if (!outcome.ok) {
      throw new Error(`allocate failed: ${outcome.reason}${outcome.detail ? ` (${outcome.detail})` : ''}`);
    }
    return outcome.value;
  });
}

async function runTemporaryCodes(dir: string, count: number): Promise<string[]> {
  const entry = { provider: null, fallback_reason: null, detail: null, repository: null, context: null };
  const issued = await Promise.all(Array.from({ length: count }, () => issueTemporaryCode(dir, '777', entry)));
  return issued.map((i) => i.code);
}

async function main(): Promise<void> {
  let rest = process.argv.slice(2);

  if (rest[0] === '--fast-lock') {
    __setLockRetryForTesting({ minTimeout: 5, maxTimeout: 25 });
    rest = rest.slice(1);
  }

  const [mode, ...args] = rest;

  if (mode === 'file-provider') {
    const [dataDir, counterFile, count] = args as [string, string, string];
    process.stdout.write(JSON.stringify(await runFileProvider(dataDir, counterFile, Number(count))));
  } else if (mode === 'temporary-codes') {
    const [dir, count] = args as [string, string];
    process.stdout.write(JSON.stringify(await runTemporaryCodes(dir, Number(count))));
  } else {
    throw new Error(`unknown mode: ${mode ?? '(none)'}`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
