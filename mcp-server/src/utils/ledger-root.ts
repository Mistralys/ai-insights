import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { planFolderBasename } from './path-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Package root: from src/utils/ up two levels
const serverDir = join(__dirname, '..', '..');

/**
 * Returns the absolute path to the central ledger root directory.
 *
 * Resolution order:
 * 1. `--ledger-dir <path>` CLI argument — must be followed by an explicit path
 *    value. Providing the flag with no subsequent argument is a configuration
 *    error and will throw rather than silently falling back to the default.
 * 2. Default: `{serverDir}/storage/ledger/`
 *
 * @throws {Error} When `--ledger-dir` is present but not followed by a path.
 */
export function resolveLedgerRoot(): string {
  const args = process.argv;
  const flagIndex = args.indexOf('--ledger-dir');
  if (flagIndex !== -1) {
    // Next token must exist and must not itself be a flag
    if (flagIndex + 1 >= args.length || args[flagIndex + 1].startsWith('--')) {
      throw new Error(
        '--ledger-dir flag requires a path argument (e.g. --ledger-dir /data/ledger)'
      );
    }
    return args[flagIndex + 1] as string;
  }
  return join(serverDir, 'storage', 'ledger');
}

/**
 * Extracts the project slug (plan folder basename) from an absolute project path.
 * Delegates to planFolderBasename() from path-validator.
 */
export function projectSlugFromPath(projectPath: string): string {
  return planFolderBasename(projectPath);
}
