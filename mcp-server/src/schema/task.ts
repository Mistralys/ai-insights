import { z } from 'zod';

/**
 * Task schema module.
 *
 * Holds the storage schemas (permissive, tolerant-reader), the strict input
 * pieces shared by the MCP tools and the GUI REST bodies, the colour palette
 * ids, and the shared comparator. Pure module — no I/O.
 */

// ─── Colour palette ────────────────────────────────────────────────────────

/**
 * The 16 valid task colour ids, in display order. This is the only
 * server-side palette definition; it holds no display values (the GUI owns
 * names and CSS owns the actual colours).
 */
export const TASK_COLOR_IDS = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan',
  'blue', 'indigo', 'violet', 'fuchsia', 'pink', 'brown', 'slate', 'gray',
] as const;

export type TaskColorId = (typeof TASK_COLOR_IDS)[number];

const VALID_IDS_MESSAGE = `Color must be one of: ${TASK_COLOR_IDS.join(', ')} (or '' for no colour).`;
const VALID_FILTER_IDS_MESSAGE = `Color filter values must be one of: ${TASK_COLOR_IDS.join(', ')}, none.`;

/** A palette id, or `''` for no colour. `null` is deliberately rejected. */
export const TaskColorInput = z.enum([...TASK_COLOR_IDS, ''], {
  errorMap: () => ({ message: VALID_IDS_MESSAGE }),
});

/** Colour filter entry: a palette id or `'none'` (tasks without a colour). */
const TaskColorFilterEntry = z.enum([...TASK_COLOR_IDS, 'none'], {
  errorMap: () => ({ message: VALID_FILTER_IDS_MESSAGE }),
});

/** Colour filter: 1–17 entries, deduplicated. Entries combine as OR. */
export const TaskColorFilterInput = z
  .array(TaskColorFilterEntry)
  .min(1)
  .max(TASK_COLOR_IDS.length + 1)
  .transform((values) => Array.from(new Set(values)));

/**
 * Resolve the colour key used for filtering: the stored id when it is in the
 * palette, otherwise `'none'` (covers `''`, a missing field and unknown ids).
 */
export function colorKey(task: { color?: string | null }): TaskColorId | 'none' {
  const color = task.color;
  return typeof color === 'string' && (TASK_COLOR_IDS as readonly string[]).includes(color)
    ? (color as TaskColorId)
    : 'none';
}

// ─── Tags ──────────────────────────────────────────────────────────────────

/** A normalised tag: lowercase alphanumerics and hyphens, 1–32 chars. */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Normalise a raw tag: lowercase, whitespace runs become `-`, commas removed.
 * Returns `null` when the result does not match {@link TAG_PATTERN}.
 */
export function normaliseTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '-');
  return TAG_PATTERN.test(tag) ? tag : null;
}

const TagInput = z.string().transform((raw, ctx) => {
  const tag = normaliseTag(raw);
  if (tag === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid tag "${raw}": use letters, digits and hyphens, starting with a letter or digit, at most 32 characters.`,
    });
    return z.NEVER;
  }
  return tag;
});

/** Up to 20 tags, each normalised, deduplicated. */
export const TaskTagsInput = z
  .array(TagInput)
  .max(20, 'A task can have at most 20 tags.')
  .transform((tags) => Array.from(new Set(tags)));

// ─── Text and reference ────────────────────────────────────────────────────

export const TASK_TEXT_MAX_LENGTH = 20_000;

/** Task text: trailing whitespace trimmed, non-empty, first line non-empty, max 20 000 chars. */
export const TaskTextInput = z
  .string()
  .transform((s) => s.trimEnd())
  .pipe(
    z
      .string()
      .min(1, 'Task text must not be empty.')
      .max(TASK_TEXT_MAX_LENGTH, `Task text must be at most ${TASK_TEXT_MAX_LENGTH} characters.`)
      .refine((s) => (s.split(/\r?\n/)[0] ?? '').trim().length > 0, {
        message: 'The first line of the task text must not be empty.',
      }),
  );

/** Raw ticket reference (max 64 chars), or `null` to clear. Normalised by ticket-reference.ts. */
export const TaskReferenceInput = z.string().max(64).nullable();

// ─── Storage schemas ───────────────────────────────────────────────────────

/** Permissive storage schema: `color` accepts any short string on read. */
export const TaskSchema = z.object({
  id: z.string().uuid(),
  reference: z.string().max(64).nullable().optional(),
  text: z.string(),
  tags: z.array(z.string()),
  priority: z.number().int(),
  completed: z.boolean(),
  created_at: z.string(),
  completed_at: z.string().nullable().optional(),
  completion_source: z.string().max(200).nullable().optional(),
  color: z.string().max(32).optional(),
  updated_at: z.string().optional(),
});

export type Task = z.infer<typeof TaskSchema>;

export const TaskFileSchema = z.object({
  version: z.literal(1),
  last_updated: z.string(),
  tasks: z.array(TaskSchema),
});

export type TaskFile = z.infer<typeof TaskFileSchema>;

/** A task as returned to consumers: tagged with its store and ticket link. */
export type TaskView = Task & {
  color: string;
  store_id: string;
  store_label: string;
  ticket_label: string;
  ticket_url: string | null;
};

// ─── Filters and sorting ───────────────────────────────────────────────────

export const TaskStatusFilter = z.enum(['open', 'completed', 'all']);
export type TaskStatusFilter = z.infer<typeof TaskStatusFilter>;

export const TaskSort = z.enum(['priority', 'created', 'completed']);
export type TaskSort = z.infer<typeof TaskSort>;

type SortableTask = Pick<Task, 'id' | 'priority' | 'created_at' | 'completed_at'>;

function cmpDesc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

function cmpAsc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Build a comparator for the given sort.
 *  - `priority`: priority desc, created_at desc, id asc.
 *  - `created`: created_at desc, id asc.
 *  - `completed`: completed_at desc with open tasks last, ties by priority desc
 *    (then created_at desc, id asc for determinism).
 */
export function compareTasks(sort: TaskSort): (a: SortableTask, b: SortableTask) => number {
  switch (sort) {
    case 'created':
      return (a, b) => cmpDesc(a.created_at, b.created_at) || cmpAsc(a.id, b.id);
    case 'completed':
      return (a, b) => {
        const ac = a.completed_at ?? '';
        const bc = b.completed_at ?? '';
        if (ac !== bc) {
          if (ac === '') return 1;
          if (bc === '') return -1;
          return cmpDesc(ac, bc);
        }
        return (b.priority - a.priority) || cmpDesc(a.created_at, b.created_at) || cmpAsc(a.id, b.id);
      };
    case 'priority':
    default:
      return (a, b) =>
        (b.priority - a.priority) || cmpDesc(a.created_at, b.created_at) || cmpAsc(a.id, b.id);
  }
}
