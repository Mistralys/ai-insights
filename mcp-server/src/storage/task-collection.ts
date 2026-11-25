import { randomUUID } from 'crypto';
import { getStoreRouter, isStoreContextInitialized } from './store-context.js';
import { resolveLedgerRoot } from '../utils/ledger-root.js';
import { readTaskFile, mutateTaskFile, TaskFileInvalidError } from './task-store.js';
import {
  colorKey,
  compareTasks,
  normaliseTag,
  TASK_COLOR_IDS,
  TaskColorInput,
  TaskTextInput,
  type Task,
  type TaskSort,
  type TaskStatusFilter,
  type TaskView,
} from '../schema/task.js';
import { normaliseReference, ticketLabel, ticketUrl } from '../utils/ticket-reference.js';
import { getTaskSettings, type TaskSettings } from '../gui/config.js';
import { now } from '../utils/timestamp.js';

/**
 * Cross-store task collection. The single shared layer that iterates stores for
 * tasks (load, filter, sort, search, get, create, update, delete, reorder).
 * Both the MCP tools and the GUI API call it.
 *
 * @remarks
 * `store_id` and `store_label` are derived from the file's location on every
 * load and never persisted, so they cannot go stale when a store is
 * re-imported under another id.
 *
 * Reorder is a documented exception to the read-only multi-store collation
 * rule: it writes to several stores, but never holds two store locks at once.
 *
 * Nothing here writes to stdout (MCP STDIO discipline).
 */

export { TaskFileInvalidError };

// ─── Errors ────────────────────────────────────────────────────────────────

/** Thrown when no task with the given id exists in any readable store. */
export class TaskNotFoundError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
    this.taskId = taskId;
  }
}

/** Thrown when a requested store id is not configured. */
export class TaskStoreNotFoundError extends Error {
  readonly storeId: string;
  readonly validIds: string[];

  constructor(storeId: string, validIds: string[]) {
    super(`Store not found: "${storeId}". Valid store ids: ${validIds.join(', ')}`);
    this.name = 'TaskStoreNotFoundError';
    this.storeId = storeId;
    this.validIds = validIds;
  }
}

/** Thrown when task input violates a rule (bad reference, colour, text, tags, ...). */
export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskValidationError';
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TaskStore {
  id: string;
  path: string;
  label: string;
}

export interface TaskStoreError {
  store_id: string;
  store_label: string;
  path: string;
  message: string;
}

export interface LoadedTasks {
  tasks: TaskView[];
  store_errors: TaskStoreError[];
}

/** Filter shared by list and the GUI. `reference` must already be normalised. */
export interface TaskFilter {
  status?: TaskStatusFilter;
  /** AND, exact match. */
  tags?: string[];
  /** OR, via {@link colorKey}; `'none'` matches tasks without a (known) colour. */
  colors?: string[];
  store?: string;
  /** Normalised reference (see `normaliseReference`). */
  reference?: string;
}

/** Search filter: the list filter without `colors`. */
export type TaskSearchFilter = Omit<TaskFilter, 'colors'>;

export interface TaskListOptions {
  sort?: TaskSort;
  limit?: number;
  offset?: number;
}

export interface TaskPage extends LoadedTasks {
  /** Total matches before pagination. */
  total: number;
}

export interface CreateTaskInput {
  text: string;
  /** Store id; defaults to the default store. */
  store?: string;
  tags?: string[];
  reference?: string | null;
  color?: string;
}

export interface UpdateTaskInput {
  text?: string;
  tags?: string[];
  /** String is re-normalised; `null` clears. */
  reference?: string | null;
  /** `''` clears. */
  color?: string;
  priority?: number;
  completed?: boolean;
  completion_source?: string | null;
}

export interface ReorderAssignment {
  id: string;
  priority: number;
}

export interface ReorderFailure {
  store_id: string;
  ids: string[];
  message: string;
}

export interface ReorderResult {
  updated: string[];
  failed: ReorderFailure[];
}

// ─── Store resolution ──────────────────────────────────────────────────────

/** The router's stores when the store context is initialised, otherwise the single legacy `default` store. */
export function resolveTaskStores(): TaskStore[] {
  if (isStoreContextInitialized()) {
    return getStoreRouter().getAllStores();
  }
  return [{ id: 'default', path: resolveLedgerRoot(), label: 'Default Store' }];
}

/** The default store, with the same legacy fallback as {@link resolveTaskStores}. */
export function resolveDefaultTaskStore(): TaskStore {
  if (isStoreContextInitialized()) {
    const router = getStoreRouter();
    const path = router.resolveDefaultStore();
    const match = router.getAllStores().find((s) => s.path === path);
    return match ?? { id: 'default', path, label: 'Default Store' };
  }
  return { id: 'default', path: resolveLedgerRoot(), label: 'Default Store' };
}

// ─── Loading ───────────────────────────────────────────────────────────────

function toView(task: Task, store: TaskStore, settings: TaskSettings): TaskView {
  return {
    ...task,
    color: task.color ?? '',
    store_id: store.id,
    store_label: store.label,
    ticket_label: ticketLabel(task.reference, settings.ticket_queue),
    ticket_url: ticketUrl(task.reference, settings),
  };
}

/**
 * Loads every readable store's tasks, tagged with store and ticket data.
 * Invalid stores are skipped and reported in `store_errors`. When an id occurs
 * in several stores, the first store wins.
 */
export async function loadAllTasks(): Promise<LoadedTasks> {
  const settings = getTaskSettings();
  const tasks: TaskView[] = [];
  const store_errors: TaskStoreError[] = [];
  const seen = new Set<string>();

  for (const store of resolveTaskStores()) {
    let read;
    try {
      read = await readTaskFile(store.path);
    } catch (err) {
      store_errors.push({
        store_id: store.id,
        store_label: store.label,
        path: store.path,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (read.status === 'invalid') {
      store_errors.push({ store_id: store.id, store_label: store.label, path: read.path, message: read.message });
      continue;
    }
    for (const task of read.file.tasks) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      tasks.push(toView(task, store, settings));
    }
  }
  return { tasks, store_errors };
}

// ─── Filtering, listing, searching ─────────────────────────────────────────

/**
 * Applies a filter to one task: status, AND exact-match tags, OR colours (via
 * `colorKey`; absent or empty matches everything), store and normalised reference.
 */
export function matchesFilters(
  task: Pick<TaskView, 'completed' | 'tags' | 'color' | 'store_id' | 'reference'>,
  filter: TaskFilter,
): boolean {
  const status = filter.status ?? 'all';
  if (status === 'open' && task.completed) return false;
  if (status === 'completed' && !task.completed) return false;
  if (filter.store !== undefined && filter.store !== '' && task.store_id !== filter.store) return false;
  if (filter.reference !== undefined && (task.reference ?? null) !== filter.reference) return false;
  if (filter.tags !== undefined && !filter.tags.every((t) => task.tags.includes(t))) return false;
  if (filter.colors !== undefined && filter.colors.length > 0 && !filter.colors.includes(colorKey(task))) {
    return false;
  }
  return true;
}

function paginate<T>(items: T[], opts: TaskListOptions): T[] {
  const offset = Math.max(0, opts.offset ?? 0);
  if (opts.limit === undefined) return items.slice(offset);
  return items.slice(offset, offset + Math.max(0, opts.limit));
}

/** Normalises a reference given as a filter; invalid input is a validation error. */
function normaliseFilterReference<F extends TaskSearchFilter>(filter: F, settings: TaskSettings): F {
  if (filter.reference === undefined) return filter;
  const result = normaliseReference(filter.reference, settings.ticket_queue);
  if (!result.ok) throw new TaskValidationError(result.message);
  if (result.value === null) {
    const { reference: _drop, ...rest } = filter;
    return rest as F;
  }
  return { ...filter, reference: result.value };
}

/** Filters, sorts (default `priority`) and paginates the collection. */
export async function listTasks(filter: TaskFilter = {}, options: TaskListOptions = {}): Promise<TaskPage> {
  const settings = getTaskSettings();
  const normalised = normaliseFilterReference(filter, settings);
  const { tasks, store_errors } = await loadAllTasks();
  const matched = tasks.filter((t) => matchesFilters(t, normalised)).sort(compareTasks(options.sort ?? 'priority'));
  return { tasks: paginate(matched, options), total: matched.length, store_errors };
}

/**
 * Ranks by OR match count over text, ticket label and tags (lowercased
 * whitespace tokens, substring match), then the sort. An empty query behaves as list.
 */
export async function searchTasks(
  query: string,
  filter: TaskSearchFilter = {},
  options: TaskListOptions = {},
): Promise<TaskPage> {
  const tokens = Array.from(new Set(query.toLowerCase().split(/\s+/).filter((t) => t !== '')));
  if (tokens.length === 0) return listTasks(filter, options);

  const settings = getTaskSettings();
  const normalised = normaliseFilterReference(filter, settings);
  const { tasks, store_errors } = await loadAllTasks();
  const cmp = compareTasks(options.sort ?? 'priority');

  const scored: Array<{ task: TaskView; score: number }> = [];
  for (const task of tasks) {
    if (!matchesFilters(task, normalised)) continue;
    const haystack = [task.text, task.ticket_label, ...task.tags].join('\n').toLowerCase();
    const score = tokens.filter((t) => haystack.includes(t)).length;
    if (score > 0) scored.push({ task, score });
  }
  scored.sort((a, b) => b.score - a.score || cmp(a.task, b.task));
  const matched = scored.map((s) => s.task);
  return { tasks: paginate(matched, options), total: matched.length, store_errors };
}

/** Returns the task with the given id. @throws {TaskNotFoundError} */
export async function getTask(id: string): Promise<TaskView> {
  const { tasks } = await loadAllTasks();
  const found = tasks.find((t) => t.id === id);
  if (!found) throw new TaskNotFoundError(id);
  return found;
}

// ─── Mutation helpers ──────────────────────────────────────────────────────

function findStore(storeId: string): TaskStore {
  const stores = resolveTaskStores();
  const store = stores.find((s) => s.id === storeId);
  if (!store) throw new TaskStoreNotFoundError(storeId, stores.map((s) => s.id));
  return store;
}

function validateText(text: string): string {
  const parsed = TaskTextInput.safeParse(text);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? 'Invalid task text.');
  return parsed.data;
}

function validateTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = normaliseTag(raw);
    if (tag === null) {
      throw new TaskValidationError(
        `Invalid tag "${raw}": use letters, digits and hyphens, starting with a letter or digit, at most 32 characters.`,
      );
    }
    if (!out.includes(tag)) out.push(tag);
  }
  if (out.length > 20) throw new TaskValidationError('A task can have at most 20 tags.');
  return out;
}

function validateColor(color: string): string {
  const parsed = TaskColorInput.safeParse(color);
  if (!parsed.success) {
    throw new TaskValidationError(
      `Color must be one of: ${TASK_COLOR_IDS.join(', ')} (or '' for no colour).`,
    );
  }
  return parsed.data;
}

function validateReference(reference: string, settings: TaskSettings): string | null {
  const result = normaliseReference(reference, settings.ticket_queue);
  if (!result.ok) throw new TaskValidationError(result.message);
  return result.value;
}

// ─── Create / update / delete ──────────────────────────────────────────────

/**
 * Creates a task: UUID v4, `created_at = now()`, `completed: false`, priority
 * = max over all readable stores + 1 (1 when empty).
 *
 * @throws {TaskStoreNotFoundError} Unknown store (message lists the valid ids).
 * @throws {TaskValidationError} Invalid text, tags, reference or colour.
 * @throws {TaskFileInvalidError} The target store's task file is unreadable.
 */
export async function createTask(input: CreateTaskInput): Promise<TaskView> {
  const store = input.store === undefined ? resolveDefaultTaskStore() : findStore(input.store);
  const settings = getTaskSettings();

  const text = validateText(input.text);
  const tags = validateTags(input.tags ?? []);
  const color = validateColor(input.color ?? '');
  const reference = input.reference == null ? null : validateReference(input.reference, settings);

  const { tasks } = await loadAllTasks();
  const priority = tasks.reduce((max, t) => Math.max(max, t.priority), 0) + 1;

  const task: Task = {
    id: randomUUID(),
    reference,
    text,
    tags,
    priority,
    completed: false,
    created_at: now(),
    color,
  };

  await mutateTaskFile(store.path, (file) => {
    file.tasks.push(task);
  });
  return toView(task, store, settings);
}

/** Locates the store that owns a task (first store wins on duplicates). */
async function locate(id: string): Promise<{ view: TaskView; store: TaskStore }> {
  const view = await getTask(id);
  return { view, store: findStore(view.store_id) };
}

/**
 * Updates a task. Completing sets `completed_at`; reopening clears
 * `completed_at` and `completion_source`. `completion_source` is stored only
 * while the task is (or becomes) completed.
 *
 * @throws {TaskNotFoundError}
 * @throws {TaskValidationError}
 * @throws {TaskFileInvalidError}
 */
export async function updateTask(id: string, patch: UpdateTaskInput): Promise<TaskView> {
  const settings = getTaskSettings();

  const text = patch.text === undefined ? undefined : validateText(patch.text);
  const tags = patch.tags === undefined ? undefined : validateTags(patch.tags);
  const color = patch.color === undefined ? undefined : validateColor(patch.color);
  let reference: string | null | undefined;
  if (patch.reference === null) reference = null;
  else if (patch.reference !== undefined) reference = validateReference(patch.reference, settings);
  if (patch.priority !== undefined && !Number.isInteger(patch.priority)) {
    throw new TaskValidationError('Priority must be an integer.');
  }

  const { store } = await locate(id);

  const updated = await mutateTaskFile(store.path, (file) => {
    const task = file.tasks.find((t) => t.id === id);
    if (!task) throw new TaskNotFoundError(id);

    const willBeCompleted = patch.completed ?? task.completed;
    if (patch.completion_source !== undefined && patch.completion_source !== null && !willBeCompleted) {
      throw new TaskValidationError('completion_source can only be set on a completed task.');
    }

    if (text !== undefined) task.text = text;
    if (tags !== undefined) task.tags = tags;
    if (reference !== undefined) task.reference = reference;
    if (color !== undefined) task.color = color;
    if (patch.priority !== undefined) task.priority = patch.priority;

    if (patch.completed === true && !task.completed) {
      task.completed = true;
      task.completed_at = now();
    } else if (patch.completed === false && task.completed) {
      task.completed = false;
      delete task.completed_at;
      delete task.completion_source;
    }
    if (patch.completion_source !== undefined && task.completed) {
      if (patch.completion_source === null) delete task.completion_source;
      else task.completion_source = patch.completion_source;
    }

    task.updated_at = now();
    return { ...task };
  });
  return toView(updated, store, settings);
}

/** Removes a task from its owning store under that store's lock. @throws {TaskNotFoundError} */
export async function deleteTask(id: string): Promise<void> {
  const { store } = await locate(id);
  await mutateTaskFile(store.path, (file) => {
    const index = file.tasks.findIndex((t) => t.id === id);
    if (index === -1) throw new TaskNotFoundError(id);
    file.tasks.splice(index, 1);
  });
}

// ─── Reorder ───────────────────────────────────────────────────────────────

/**
 * Applies priority assignments across stores. Every id must exist (else
 * {@link TaskNotFoundError}, nothing applied). Assignments are grouped by owning
 * store and each group is applied in one `mutateTaskFile` call, store by store,
 * so two store locks are never held at once. A failing store (e.g. a corrupt
 * file) is reported in `failed` while the others are still applied.
 */
export async function reorderTasks(assignments: ReorderAssignment[]): Promise<ReorderResult> {
  const { tasks } = await loadAllTasks();
  const owner = new Map(tasks.map((t) => [t.id, t.store_id]));

  const groups = new Map<string, ReorderAssignment[]>();
  for (const a of assignments) {
    const storeId = owner.get(a.id);
    if (storeId === undefined) throw new TaskNotFoundError(a.id);
    if (!Number.isInteger(a.priority)) throw new TaskValidationError('Priority must be an integer.');
    const group = groups.get(storeId) ?? [];
    group.push(a);
    groups.set(storeId, group);
  }

  const result: ReorderResult = { updated: [], failed: [] };
  for (const [storeId, group] of groups) {
    try {
      const store = findStore(storeId);
      const applied = await mutateTaskFile(store.path, (file) => {
        const ids: string[] = [];
        const stamp = now();
        for (const a of group) {
          const task = file.tasks.find((t) => t.id === a.id);
          if (!task) continue;
          task.priority = a.priority;
          task.updated_at = stamp;
          ids.push(a.id);
        }
        return ids;
      });
      result.updated.push(...applied);
    } catch (err) {
      result.failed.push({
        store_id: storeId,
        ids: group.map((a) => a.id),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
