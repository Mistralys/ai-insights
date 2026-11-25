/**
 * GUI API Route Handlers — Tasks Domain
 *
 * REST handlers, body schemas and helpers for the `/api/tasks*` endpoints that
 * back the GUI's Tasks tab. A thin layer over `src/storage/task-collection.ts`
 * (the same layer the MCP task tools use): handlers validate the request,
 * delegate, and translate collection errors into {@link ApiError}s.
 *
 * Routes provided (guards are attached in `server.ts`'s `buildTaskRoutes()`):
 *   GET    /api/tasks        — every task plus the stores and display settings
 *   POST   /api/tasks        — create a task (201)
 *   POST   /api/tasks/order  — apply priority assignments, possibly across stores
 *   PATCH  /api/tasks/:id    — partial update
 *   DELETE /api/tasks/:id    — delete
 *
 * Error shape: { code: string, message: string }
 *   VALIDATION_ERROR → 400
 *   NOT_FOUND        → 404 (unknown task or store)
 *   CONFLICT         → 409 (a store's task file is unreadable)
 *   (unhandled)      → 500
 *
 * No filesystem path is ever placed in a message: the task-file errors carry
 * an absolute path, which is withheld here.
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import { z } from 'zod';
import { ApiError, describeZodIssues } from '../src/gui/errors.js';
import {
  createTask,
  deleteTask,
  loadAllTasks,
  reorderTasks,
  resolveDefaultTaskStore,
  resolveTaskStores,
  TaskFileInvalidError,
  TaskNotFoundError,
  TaskStoreNotFoundError,
  TaskValidationError,
  updateTask,
  type ReorderResult,
  type TaskStoreError,
  type UpdateTaskInput,
} from '../src/storage/task-collection.js';
import { compareTasks, type TaskView } from '../src/schema/task.js';
import { getTaskSettings, type TaskSettings } from '../src/gui/config.js';

export { ApiError };

// ---------------------------------------------------------------------------
// Body schemas
// ---------------------------------------------------------------------------

/**
 * POST /api/tasks body. `color` is a plain string here; the collection checks
 * it against the palette and answers with a message naming the valid ids.
 */
export const TaskCreateBodySchema = z
  .object({
    text: z.string(),
    store_id: z.string().optional(),
    tags: z.array(z.string()).optional(),
    reference: z.string().max(64).nullable().optional(),
    color: z.string().max(32).optional(),
  })
  .strict();

/** PATCH /api/tasks/:id body. `color: ''` clears; `null` is rejected. */
export const TaskUpdateBodySchema = z
  .object({
    text: z.string().optional(),
    tags: z.array(z.string()).optional(),
    reference: z.string().max(64).nullable().optional(),
    color: z.string().max(32).optional(),
    priority: z.number().int().optional(),
    completed: z.boolean().optional(),
    completion_source: z.string().max(200).nullable().optional(),
  })
  .strict();

/** POST /api/tasks/order body: 1–500 priority assignments. */
export const TaskReorderBodySchema = z
  .object({
    assignments: z
      .array(z.object({ id: z.string().uuid(), priority: z.number().int() }).strict())
      .min(1)
      .max(500),
  })
  .strict();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UNREADABLE_MESSAGE = 'Task file is unreadable and was left untouched.';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a task id taken from the URL.
 * @throws ApiError VALIDATION_ERROR `Invalid task id.` for anything but a UUID.
 */
export function parseTaskId(raw: string): string {
  if (!UUID_REGEX.test(raw)) {
    throw new ApiError('VALIDATION_ERROR', 'Invalid task id.');
  }
  return raw;
}

function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', describeZodIssues(parsed.error.issues));
  }
  return parsed.data;
}

/** Translates a collection error into an {@link ApiError}; unknown errors pass through. */
function mapTaskError(err: unknown): never {
  if (err instanceof ApiError) throw err;
  if (err instanceof TaskNotFoundError) throw new ApiError('NOT_FOUND', 'Task not found.');
  if (err instanceof TaskStoreNotFoundError) {
    throw new ApiError('NOT_FOUND', `Store not found. Valid store ids: ${err.validIds.join(', ')}`);
  }
  if (err instanceof TaskValidationError) throw new ApiError('VALIDATION_ERROR', err.message);
  if (err instanceof TaskFileInvalidError) throw new ApiError('CONFLICT', UNREADABLE_MESSAGE);
  throw err;
}

type PublicStoreError = Omit<TaskStoreError, 'path' | 'message'> & { message: string };

function toPublicStoreError(e: TaskStoreError): PublicStoreError {
  return { store_id: e.store_id, store_label: e.store_label, message: UNREADABLE_MESSAGE };
}

// ---------------------------------------------------------------------------
// GET /api/tasks
// ---------------------------------------------------------------------------

export interface TaskListResponse {
  tasks: TaskView[];
  stores: Array<{ id: string; label: string; is_default: boolean }>;
  settings: TaskSettings;
  store_errors: PublicStoreError[];
}

/**
 * Returns every task (open and completed, sorted by priority) across all
 * readable stores, the configured stores, the task display settings, and the
 * stores that were skipped. Filtering and paging are client-side.
 */
export async function handleListTasks(): Promise<TaskListResponse> {
  try {
    const { tasks, store_errors } = await loadAllTasks();
    const defaultId = resolveDefaultTaskStore().id;
    return {
      tasks: [...tasks].sort(compareTasks('priority')),
      stores: resolveTaskStores().map((s) => ({ id: s.id, label: s.label, is_default: s.id === defaultId })),
      settings: getTaskSettings(),
      store_errors: store_errors.map(toPublicStoreError),
    };
  } catch (err) {
    return mapTaskError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/tasks
// ---------------------------------------------------------------------------

/** Creates a task in the given (or default) store. */
export async function handleCreateTask(body: unknown): Promise<TaskView> {
  const data = parseBody(TaskCreateBodySchema, body);
  try {
    return await createTask({
      text: data.text,
      store: data.store_id === '' ? undefined : data.store_id,
      tags: data.tags,
      reference: data.reference,
      color: data.color,
    });
  } catch (err) {
    return mapTaskError(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/tasks/:id
// ---------------------------------------------------------------------------

/** Applies a partial update and returns the updated task. */
export async function handleUpdateTask(rawId: string, body: unknown): Promise<TaskView> {
  const id = parseTaskId(rawId);
  const data = parseBody(TaskUpdateBodySchema, body);
  const patch: UpdateTaskInput = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
  }
  try {
    return await updateTask(id, patch);
  } catch (err) {
    return mapTaskError(err);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/tasks/:id
// ---------------------------------------------------------------------------

/** Deletes a task. */
export async function handleDeleteTask(rawId: string): Promise<{ id: string; deleted: true }> {
  const id = parseTaskId(rawId);
  try {
    await deleteTask(id);
    return { id, deleted: true };
  } catch (err) {
    return mapTaskError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/tasks/order
// ---------------------------------------------------------------------------

/**
 * Applies priority assignments. An unknown id aborts the whole request (404);
 * a store that fails mid-way is reported in `failed[]` with a 200 while the
 * other stores are still applied.
 */
export async function handleReorderTasks(body: unknown): Promise<ReorderResult> {
  const data = parseBody(TaskReorderBodySchema, body);
  try {
    const result = await reorderTasks(data.assignments);
    return {
      updated: result.updated,
      failed: result.failed.map((f) => ({
        ...f,
        message: f.message.startsWith('Task file is unreadable') ? UNREADABLE_MESSAGE : 'Store could not be updated.',
      })),
    };
  } catch (err) {
    return mapTaskError(err);
  }
}
