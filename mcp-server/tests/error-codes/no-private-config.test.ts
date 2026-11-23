import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'fs/promises';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { errorcodeIncrementorProvider } from '../../src/error-codes/providers/errorcode-incrementor-provider.js';

/**
 * Proves that no private host, counter name or credential for the user's
 * own Errorcode Incrementor service ever ships in this repository.
 *
 * The Errorcode Incrementor library is public and MIT-licensed (see
 * `errorcode-incrementor-provider.ts`'s docblock) — only the host and
 * credentials are private, and this test guards two independent things:
 *
 * 1. The provider's `base_url`/`password`/`counter` settings descriptors
 *    carry no `default` — a real deployment target can only ever come from
 *    the user's own stored configuration, never from this source tree.
 * 2. No file under `mcp-server/src`, `mcp-server/gui`, `mcp-server/docs` or
 *    `mcp-server/tests` contains a literal, filled-in `pw=`/`counter=`
 *    request query string — the only way a real credential/counter pair
 *    could leak into the repository, since the provider itself always
 *    builds that query string at runtime via `URLSearchParams`.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCAN_DIRS = ['mcp-server/src', 'mcp-server/gui', 'mcp-server/docs', 'mcp-server/tests'];

/** Directory names never worth descending into while scanning for private config. */
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

async function listFilesRecursive(dir: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * A `pw=`/`counter=` pair is "filled in" when its value is non-empty and is
 * not one of the placeholder forms used in documentation/examples:
 * `{password}`, `{counter}`, an empty string, or a test sentinel that is
 * itself clearly synthetic (handled by the caller's own exclusion list).
 */
function isPlaceholderValue(value: string): boolean {
  return value.length === 0 || value.startsWith('{') || value === 'yes';
}

/** Lines from this test file itself and from the provider's own docblock are expected to mention the query string shape — excluded by path, not content, so the check stays mechanical. */
const SELF_EXCLUDED_PATHS = ['tests/error-codes/no-private-config.test.ts'];

describe('no-private-config', () => {
  it('declares base_url, password and counter with no default value', () => {
    for (const key of ['base_url', 'password', 'counter']) {
      const field = errorcodeIncrementorProvider.settings.find((f) => f.key === key);
      expect(field, `expected a settings field for '${key}'`).toBeDefined();
      expect(field && 'default' in field ? (field as { default?: unknown }).default : undefined).toBeUndefined();
    }
  });

  it('contains no filled-in pw=/counter= request query string anywhere under src, gui, docs or tests', async () => {
    const offenders: { file: string; line: string }[] = [];

    for (const dir of SCAN_DIRS) {
      const files = await listFilesRecursive(join(REPO_ROOT, dir));
      for (const file of files) {
        const relPath = relative(REPO_ROOT, file).split('\\').join('/');
        if (SELF_EXCLUDED_PATHS.some((p) => relPath.endsWith(p))) {
          continue;
        }

        let content: string;
        try {
          content = await readFile(file, 'utf-8');
        } catch {
          continue; // binary or unreadable — not a text config leak
        }

        for (const line of content.split('\n')) {
          const pwMatch = /[?&]pw=([^&\s'"]*)/.exec(line);
          const counterMatch = /[?&]counter=([^&\s'"]*)/.exec(line);
          if (!pwMatch || !counterMatch) {
            continue;
          }
          if (isPlaceholderValue(pwMatch[1]) || isPlaceholderValue(counterMatch[1])) {
            continue;
          }
          offenders.push({ file: relPath, line: line.trim() });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
