import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const WORKER_PATH = fileURLToPath(new URL('./concurrent-allocation-worker.ts', import.meta.url));
/** The `mcp-server/` root, so `--import tsx` resolves against this package's `node_modules`. */
const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Options shared by {@link runWorker} and {@link runWorkers}. */
export interface RunWorkerOptions {
  /**
   * Prepends `--fast-lock` to the worker's argv, installing the test-only
   * withLock retry policy (see `concurrent-allocation-worker.ts`) inside the
   * spawned process so cross-process concurrency tests don't pay the full
   * production lock backoff.
   */
  fastLock?: boolean;
}

/**
 * Runs one `concurrent-allocation-worker.ts` as a separate OS process and
 * resolves with the JSON array it printed. Rejects with the worker's stderr
 * when it exits non-zero, so a failing test shows the cause.
 */
export function runWorker(args: string[], options: RunWorkerOptions = {}): Promise<unknown[]> {
  const workerArgs = options.fastLock ? ['--fast-lock', ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', WORKER_PATH, ...workerArgs], {
      cwd: PACKAGE_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`worker ${args[0] ?? ''} exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as unknown[]);
      } catch (err) {
        reject(new Error(`worker ${args[0] ?? ''} printed invalid JSON (${(err as Error).message}): ${stdout}`));
      }
    });
  });
}

/** Starts every worker at once (they contend for the same lock) and returns all printed values, flattened. */
export async function runWorkers(argLists: string[][], options: RunWorkerOptions = {}): Promise<unknown[]> {
  return (await Promise.all(argLists.map((args) => runWorker(args, options)))).flat();
}
