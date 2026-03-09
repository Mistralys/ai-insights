/**
 * Resolves the human-readable project name from the managed workspace's
 * manifest file. Tries package.json → composer.json → pyproject.toml in
 * order. Returns null if no file is found or any parse/read fails.
 *
 * @param projectRoot - Absolute path to the project root directory
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readProjectName(projectRoot: string): Promise<string | null> {
  // 1. Try package.json
  try {
    const raw = await readFile(join(projectRoot, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === 'object' && 'name' in parsed) {
      const nameVal = (parsed as Record<string, unknown>).name;
      if (typeof nameVal === 'string' && nameVal.trim() !== '') {
        return nameVal;
      }
    }
  } catch {
    // fall through
  }

  // 2. Try composer.json
  try {
    const raw = await readFile(join(projectRoot, 'composer.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === 'object' && 'name' in parsed) {
      const nameVal = (parsed as Record<string, unknown>).name;
      if (typeof nameVal === 'string' && nameVal.trim() !== '') {
        return nameVal;
      }
    }
  } catch {
    // fall through
  }

  // 3. Try pyproject.toml (best-effort regex)
  try {
    const raw = await readFile(join(projectRoot, 'pyproject.toml'), 'utf-8');
    const match = raw.match(/name\s*=\s*"([^"]+)"/);
    if (match) {
      const captured = match[1];
      if (captured !== undefined && captured.trim() !== '') {
        return captured;
      }
    }
  } catch {
    // fall through
  }

  return null;
}
