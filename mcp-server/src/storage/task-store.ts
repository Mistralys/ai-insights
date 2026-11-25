import { join } from 'path';
import { atomicWriteJson } from './atomic-writer.js';
import { withLock } from './file-lock.js';
import { readJsonStateFile } from './json-state-file.js';
import { TaskFileSchema, type TaskFile } from '../schema/task.js';
import { now } from '../utils/timestamp.js';

/**
 * Per-store task file layer. Plain functions over `{storePath}/.tasks/tasks.json`.
 *
 * The dot-directory has its own lock scope (`withLock({storePath}/.tasks)`), so
 * task writes never contend with `.repositories.json` or the `.knowledge/` store,
 * and project enumeration skips it like any other dot-directory.
 *
 * Nothing here writes to stdout (MCP STDIO discipline).
 */

const TASK_DIR_NAME = '.tasks';
const TASK_FILE_NAME = 'tasks.json';

/** Result of {@link readTaskFile}. */
export type TaskFileRead =
  | { status: 'ok'; file: TaskFile }
  | { status: 'invalid'; path: string; message: string };

/**
 * Thrown by {@link mutateTaskFile} when the existing task file cannot be read
 * as a valid task file.
 *
 * @remarks
 * Fallback contract: an unreadable task file (merge-conflict markers, truncated
 * JSON, schema violation) is reported, never overwritten. Stores are user-synced,
 * often with Git, so "start from empty" would silently destroy the user's tasks
 * on the next write. The file's bytes stay untouched until the user repairs it.
 */
export class TaskFileInvalidError extends Error {
  /** Absolute path of the unreadable task file. */
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Task file is unreadable and was left untouched: ${path} (${message})`);
    this.name = 'TaskFileInvalidError';
    this.path = path;
  }
}

/** Absolute path of the task directory (and lock scope) of a store. */
export function taskDir(storePath: string): string {
  return join(storePath, TASK_DIR_NAME);
}

/** Absolute path of a store's task file. */
export function taskFilePath(storePath: string): string {
  return join(taskDir(storePath), TASK_FILE_NAME);
}

function emptyTaskFile(): TaskFile {
  return { version: 1, last_updated: now(), tasks: [] };
}

/**
 * Reads a store's task file without locking.
 *
 * @remarks
 * Fallback contract: a missing file reads as an empty file (`ok`); an unparsable
 * or schema-invalid file reads as `invalid` so the caller can report it and keep
 * serving the other stores; every other I/O error (`EACCES`, `EISDIR`, ...)
 * is rethrown unchanged. A reader never writes, so `invalid` never alters the file.
 *
 * @param storePath - Absolute path of the store root.
 * @throws {NodeJS.ErrnoException} For read errors other than `ENOENT`.
 */
export async function readTaskFile(storePath: string): Promise<TaskFileRead> {
  const path = taskFilePath(storePath);
  const read = await readJsonStateFile(path);

  if (read.status === 'missing') {
    return { status: 'ok', file: emptyTaskFile() };
  }
  if (read.status === 'unparsable') {
    return { status: 'invalid', path, message: `Invalid JSON: ${read.error}` };
  }

  const parsed = TaskFileSchema.safeParse(read.value);
  if (!parsed.success) {
    return { status: 'invalid', path, message: `Schema validation failed: ${parsed.error.message}` };
  }
  return { status: 'ok', file: parsed.data };
}

/**
 * Locked read-modify-write of a store's task file.
 *
 * `fn` receives the current file (empty when missing) and may mutate it in
 * place; its return value is passed through. The result is validated, stamped
 * with a fresh `last_updated` and written atomically, all inside
 * `withLock(taskDir(storePath))`, so concurrent calls serialise.
 *
 * @remarks
 * Fallback contract: when the existing file is `invalid`, this throws
 * {@link TaskFileInvalidError} and writes nothing. An unreadable file is
 * reported, never overwritten. If `fn` throws, nothing is written either.
 *
 * @param storePath - Absolute path of the store root.
 * @param fn - Mutator; receives the task file and returns a result for the caller.
 * @throws {TaskFileInvalidError} When the existing file is unreadable.
 * @throws {NodeJS.ErrnoException} For read errors other than `ENOENT`.
 * @throws {ZodError} When the mutated file no longer satisfies `TaskFileSchema`.
 */
export async function mutateTaskFile<T>(
  storePath: string,
  fn: (file: TaskFile) => T | Promise<T>,
): Promise<T> {
  return withLock(taskDir(storePath), async () => {
    const read = await readTaskFile(storePath);
    if (read.status === 'invalid') {
      throw new TaskFileInvalidError(read.path, read.message);
    }

    const file = read.file;
    const result = await fn(file);

    file.last_updated = now();
    const validated = TaskFileSchema.parse(file);
    await atomicWriteJson(taskFilePath(storePath), validated);
    return result;
  });
}
