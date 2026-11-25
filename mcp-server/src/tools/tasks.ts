import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  resolveTaskStores,
  searchTasks,
  TaskStoreNotFoundError,
  TaskValidationError,
  updateTask,
  type TaskFilter,
  type TaskPage,
  type UpdateTaskInput,
} from '../storage/task-collection.js';
import {
  normaliseTag,
  TASK_COLOR_IDS,
  TaskColorFilterInput,
  TaskSort,
  TaskStatusFilter,
} from '../schema/task.js';
import { nonNegativeIntInput, numericInput, positiveIntInput } from '../schema/common.js';

/**
 * Task MCP tools. Thin wrappers over `storage/task-collection.ts`: they
 * validate input shape and translate errors into `isError` responses; the
 * workflow (when to complete, how to reconcile) belongs to the Task Curator
 * persona, not to these tools.
 *
 * `store_id` is a documented exception to the multi-store routing rule: tasks
 * are not tied to repositories, so the store is chosen explicitly (or by
 * default) rather than derived from `cwd_path`.
 */

const COLOR_IDS = TASK_COLOR_IDS.join(', ');

const COLOR_DESCRIPTION =
  `Optional. Colour label: one of ${COLOR_IDS}. Pass '' (empty string) for no colour` +
  ` (on update this clears the colour). Any other value is rejected.`;

const COLORS_FILTER_DESCRIPTION =
  `Optional. Colour filter, OR semantics: array of ${COLOR_IDS}, and/or 'none' to match tasks without a colour.`;

// ─── Helpers ──────────────────────────────────────────────────────────────

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text' as const, text: `Error ${action}: ${message}` }], isError: true as const };
}

function normaliseTags(tags: string[]): string[] {
  return tags.map((raw) => {
    const tag = normaliseTag(raw);
    if (tag === null) {
      throw new TaskValidationError(
        `Invalid tag "${raw}": use letters, digits and hyphens, starting with a letter or digit, at most 32 characters.`,
      );
    }
    return tag;
  });
}

function parseColors(colors: string[] | undefined): string[] | undefined {
  if (colors === undefined) return undefined;
  const parsed = TaskColorFilterInput.safeParse(colors);
  if (!parsed.success) {
    throw new TaskValidationError(
      parsed.error.issues[0]?.message ?? `Color filter values must be one of: ${COLOR_IDS}, none.`,
    );
  }
  return parsed.data;
}

/** Throws {@link TaskStoreNotFoundError} (listing valid ids) when `storeId` is unknown. */
function assertStore(storeId: string | undefined): void {
  if (storeId === undefined || storeId === '') return;
  const stores = resolveTaskStores();
  if (!stores.some((s) => s.id === storeId)) {
    throw new TaskStoreNotFoundError(storeId, stores.map((s) => s.id));
  }
}

function pageResponse(page: TaskPage, offset: number | undefined) {
  const out: Record<string, unknown> = {
    total: page.total,
    offset: offset ?? 0,
    count: page.tasks.length,
    tasks: page.tasks,
  };
  if (page.store_errors.length > 0) out.store_errors = page.store_errors;
  return ok(out);
}

// ─── Shared parameter shapes ──────────────────────────────────────────────

const storeIdParam = (fallback: string) =>
  z
    .string()
    .optional()
    .describe(`Optional. Store id to restrict to. ${fallback} An unknown id is rejected with the list of valid ids.`);

const statusParam = TaskStatusFilter.optional().describe('Optional. "open" (default), "completed" or "all".');
const sortParam = TaskSort.optional().describe(
  'Optional. "priority" (default; highest priority first), "created" (newest first) or "completed" (most recently completed first, open tasks last).',
);
const tagsParam = z
  .array(z.string())
  .optional()
  .describe('Optional. Only tasks carrying ALL of these tags (AND). Tags are normalised (lowercase, hyphens).');
const referenceParam = z
  .string()
  .optional()
  .describe('Optional. Only tasks with this ticket reference (normalised the same way as on add).');
const limitParam = positiveIntInput()
  .optional()
  .describe('Optional. Maximum number of tasks to return. A string-encoded integer is also accepted.');
const offsetParam = nonNegativeIntInput()
  .optional()
  .describe('Optional. Number of tasks to skip (pagination). A string-encoded integer is also accepted.');

// ─── Tool: ledger_add_task ────────────────────────────────────────────────

const AddTaskSchema = z.object({
  text: z.string().describe('Task text. Non-empty first line (the title); up to 20000 characters.'),
  store_id: storeIdParam('Defaults to the default store.'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Optional. Up to 20 tags; normalised to lowercase alphanumerics and hyphens.'),
  reference: z
    .string()
    .nullable()
    .optional()
    .describe('Optional. Ticket reference (e.g. "1234" or "ABC-1234"); null or omitted for none.'),
  color: z.string().optional().describe(COLOR_DESCRIPTION),
});

async function addTask(args: z.infer<typeof AddTaskSchema>) {
  try {
    const task = await createTask({
      text: args.text,
      store: args.store_id === '' ? undefined : args.store_id,
      tags: args.tags,
      reference: args.reference,
      color: args.color,
    });
    return ok(task);
  } catch (error) {
    return fail('adding task', error);
  }
}

// ─── Tool: ledger_get_task ────────────────────────────────────────────────

const GetTaskSchema = z.object({
  id: z.string().uuid().describe('UUID of the task.'),
});

async function getTaskTool(args: z.infer<typeof GetTaskSchema>) {
  try {
    return ok(await getTask(args.id));
  } catch (error) {
    return fail('getting task', error);
  }
}

// ─── Tool: ledger_list_tasks ──────────────────────────────────────────────

const ListTasksSchema = z.object({
  store_id: storeIdParam('Defaults to all stores.'),
  status: statusParam,
  tags: tagsParam,
  colors: z.array(z.string()).optional().describe(COLORS_FILTER_DESCRIPTION),
  reference: referenceParam,
  sort: sortParam,
  limit: limitParam,
  offset: offsetParam,
});

async function listTasksTool(args: z.infer<typeof ListTasksSchema>) {
  try {
    assertStore(args.store_id);
    const filter: TaskFilter = {
      status: args.status ?? 'open',
      store: args.store_id,
      tags: args.tags === undefined ? undefined : normaliseTags(args.tags),
      colors: parseColors(args.colors),
      reference: args.reference,
    };
    const page = await listTasks(filter, { sort: args.sort ?? 'priority', limit: args.limit, offset: args.offset });
    return pageResponse(page, args.offset);
  } catch (error) {
    return fail('listing tasks', error);
  }
}

// ─── Tool: ledger_search_tasks ────────────────────────────────────────────

const SearchTasksSchema = z.object({
  query: z
    .string()
    .describe(
      'Space-separated search terms (OR logic, case-insensitive substring match over task text, ticket label and tags). Results are ranked by number of matched terms, then by sort. An empty query behaves like a list.',
    ),
  store_id: storeIdParam('Defaults to all stores.'),
  status: statusParam,
  tags: tagsParam,
  reference: referenceParam,
  sort: sortParam,
  limit: limitParam,
  offset: offsetParam,
});

async function searchTasksTool(args: z.infer<typeof SearchTasksSchema>) {
  try {
    assertStore(args.store_id);
    const page = await searchTasks(
      args.query,
      {
        status: args.status ?? 'open',
        store: args.store_id,
        tags: args.tags === undefined ? undefined : normaliseTags(args.tags),
        reference: args.reference,
      },
      { sort: args.sort ?? 'priority', limit: args.limit, offset: args.offset },
    );
    return pageResponse(page, args.offset);
  } catch (error) {
    return fail('searching tasks', error);
  }
}

// ─── Tool: ledger_update_task ─────────────────────────────────────────────

const UpdateTaskSchema = z.object({
  id: z.string().uuid().describe('UUID of the task to update.'),
  text: z.string().optional().describe('Optional. Replacement task text.'),
  tags: z.array(z.string()).optional().describe('Optional. Replaces the full tag list.'),
  reference: z.string().nullable().optional().describe('Optional. New ticket reference; null clears it.'),
  color: z.string().optional().describe(COLOR_DESCRIPTION),
  priority: numericInput(z.number().int())
    .optional()
    .describe('Optional. Replaces the priority (integer; higher sorts first). A string-encoded integer is also accepted.'),
  completed: z
    .boolean()
    .optional()
    .describe(
      'Optional. true completes the task (sets completed_at); false reopens it (clears completed_at and completion_source).',
    ),
  completion_source: z
    .string()
    .max(200)
    .nullable()
    .optional()
    .describe(
      'Optional. Free-text note on what completed the task (max 200 chars, e.g. a plan slug). Only valid on a task that is or becomes completed; null clears it.',
    ),
});

async function updateTaskTool(args: z.infer<typeof UpdateTaskSchema>) {
  try {
    const { id, ...rest } = args;
    const patch: UpdateTaskInput = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
    }
    return ok(await updateTask(id, patch));
  } catch (error) {
    return fail('updating task', error);
  }
}

// ─── Tool: ledger_delete_task ─────────────────────────────────────────────

const DeleteTaskSchema = z.object({
  id: z.string().uuid().describe('UUID of the task to delete.'),
});

async function deleteTaskTool(args: z.infer<typeof DeleteTaskSchema>) {
  try {
    await deleteTask(args.id);
    return ok({ id: args.id, deleted: true });
  } catch (error) {
    return fail('deleting task', error);
  }
}

/**
 * @internal — exported for unit testing only. Follows the `_internal` naming convention (§53).
 */
export const _internal = {
  AddTaskSchema,
  GetTaskSchema,
  ListTasksSchema,
  SearchTasksSchema,
  UpdateTaskSchema,
  DeleteTaskSchema,
  addTask,
  getTask: getTaskTool,
  listTasks: listTasksTool,
  searchTasks: searchTasksTool,
  updateTask: updateTaskTool,
  deleteTask: deleteTaskTool,
};

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_add_task',
    {
      description:
        'Add a task to the task list. REQUIRED: text. OPTIONAL: store_id (defaults to the default store), tags, reference, color. New tasks get the highest priority + 1.',
      inputSchema: AddTaskSchema,
    },
    addTask as any,
  );

  server.registerTool(
    'ledger_get_task',
    {
      description: 'Read a single task by UUID. REQUIRED: id.',
      inputSchema: GetTaskSchema,
    },
    getTaskTool as any,
  );

  server.registerTool(
    'ledger_list_tasks',
    {
      description:
        'List tasks across all stores (default: open tasks, sorted by priority). All params optional: store_id, status, tags, colors, reference, sort, limit, offset.',
      inputSchema: ListTasksSchema,
    },
    listTasksTool as any,
  );

  server.registerTool(
    'ledger_search_tasks',
    {
      description:
        'Search tasks by text, ticket label and tags (OR over terms, ranked by matches; default: open tasks). REQUIRED: query. Optional: store_id, status, tags, reference, sort, limit, offset.',
      inputSchema: SearchTasksSchema,
    },
    searchTasksTool as any,
  );

  server.registerTool(
    'ledger_update_task',
    {
      description:
        'Update a task by UUID: text, tags, reference, color, priority, completed, completion_source. REQUIRED: id. Only supplied fields change.',
      inputSchema: UpdateTaskSchema,
    },
    updateTaskTool as any,
  );

  server.registerTool(
    'ledger_delete_task',
    {
      description: 'Permanently delete a task by UUID. REQUIRED: id.',
      inputSchema: DeleteTaskSchema,
    },
    deleteTaskTool as any,
  );
}
