import { describe, it, expect } from 'vitest';
import {
  TASK_COLOR_IDS, TaskColorInput, TaskColorFilterInput, TaskSchema, TaskFileSchema,
  colorKey, normaliseTag, TaskTagsInput, TaskTextInput, TaskReferenceInput,
  TaskStatusFilter, TaskSort, compareTasks,
} from '../../src/schema/task.js';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const base = { id: UUID, text: 't', tags: [], priority: 1, completed: false, created_at: '2026-01-01T00:00:00Z' };

describe('TASK_COLOR_IDS', () => {
  it('holds the 16 ids in order, unique', () => {
    expect([...TASK_COLOR_IDS]).toEqual(['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan',
      'blue', 'indigo', 'violet', 'fuchsia', 'pink', 'brown', 'slate', 'gray']);
    expect(new Set(TASK_COLOR_IDS).size).toBe(TASK_COLOR_IDS.length);
  });
});

describe('colour inputs', () => {
  it('TaskColorInput accepts ids and empty string', () => {
    for (const id of [...TASK_COLOR_IDS, '']) expect(TaskColorInput.safeParse(id).success).toBe(true);
  });
  it('TaskColorInput rejects others with the valid ids listed', () => {
    for (const bad of [null, '#ef4444', 'Red', 'mauve']) {
      const r = TaskColorInput.safeParse(bad);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toContain('red, orange');
    }
  });
  it('TaskColorFilterInput accepts ids and none, rejects others, dedupes', () => {
    expect(TaskColorFilterInput.parse(['red', 'none', 'red'])).toEqual(['red', 'none']);
    expect(TaskColorFilterInput.safeParse(['']).success).toBe(false);
    expect(TaskColorFilterInput.safeParse(['mauve']).success).toBe(false);
    expect(TaskColorFilterInput.safeParse([]).success).toBe(false);
  });
});

describe('TaskSchema / colorKey', () => {
  it('accepts missing and unknown color, rejects non-UUID id', () => {
    expect(TaskSchema.safeParse(base).success).toBe(true);
    expect(TaskSchema.safeParse({ ...base, color: 'mauve' }).success).toBe(true);
    expect(TaskSchema.safeParse({ ...base, id: 'nope' }).success).toBe(false);
  });
  it('colorKey resolves ids and falls back to none', () => {
    expect(colorKey({ color: 'blue' })).toBe('blue');
    expect(colorKey({ color: '' })).toBe('none');
    expect(colorKey({})).toBe('none');
    expect(colorKey({ color: 'mauve' })).toBe('none');
  });
  it('TaskFileSchema requires version 1 and tasks array', () => {
    expect(TaskFileSchema.safeParse({ version: 1, last_updated: 'x', tasks: [] }).success).toBe(true);
    expect(TaskFileSchema.safeParse({ version: 2, last_updated: 'x', tasks: [] }).success).toBe(false);
    expect(TaskFileSchema.safeParse({ version: 1, last_updated: 'x' }).success).toBe(false);
  });
});

describe('tags and text', () => {
  it('normaliseTag', () => {
    expect(normaliseTag('  Foo  Bar,')).toBe('foo-bar');
    expect(normaliseTag('-x')).toBeNull();
    expect(normaliseTag('')).toBeNull();
    expect(normaliseTag('a'.repeat(33))).toBeNull();
    expect(normaliseTag('a'.repeat(32))).toBe('a'.repeat(32));
  });
  it('TaskTagsInput limits and dedupes', () => {
    expect(TaskTagsInput.parse(['A', 'a', 'b'])).toEqual(['a', 'b']);
    expect(TaskTagsInput.safeParse(Array.from({ length: 21 }, (_, i) => `t${i}`)).success).toBe(false);
    expect(TaskTagsInput.safeParse(Array.from({ length: 20 }, (_, i) => `t${i}`)).success).toBe(true);
    expect(TaskTagsInput.safeParse(['!!']).success).toBe(false);
  });
  it('TaskTextInput', () => {
    expect(TaskTextInput.parse('hello  \n')).toBe('hello');
    for (const bad of ['', '   ', '\nsecond', 'x'.repeat(20_001)]) expect(TaskTextInput.safeParse(bad).success).toBe(false);
    expect(TaskTextInput.safeParse('x'.repeat(20_000)).success).toBe(true);
  });
  it('TaskReferenceInput', () => {
    expect(TaskReferenceInput.safeParse('x'.repeat(64)).success).toBe(true);
    expect(TaskReferenceInput.safeParse(null).success).toBe(true);
    expect(TaskReferenceInput.safeParse('x'.repeat(65)).success).toBe(false);
  });
});

describe('enums', () => {
  it('accept exactly their members', () => {
    expect(TaskStatusFilter.options).toEqual(['open', 'completed', 'all']);
    expect(TaskSort.options).toEqual(['priority', 'created', 'completed']);
  });
});

describe('compareTasks', () => {
  const t = (id: string, priority: number, created_at: string, completed_at?: string) => ({ id, priority, created_at, completed_at });
  it('priority', () => {
    const l = [t('b', 1, '2'), t('a', 1, '2'), t('c', 2, '1'), t('d', 1, '3')];
    expect(l.sort(compareTasks('priority')).map((x) => x.id)).toEqual(['c', 'd', 'a', 'b']);
  });
  it('created', () => {
    const l = [t('b', 1, '2'), t('a', 9, '2'), t('c', 1, '3')];
    expect(l.sort(compareTasks('created')).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
  it('completed: newest first, open last, ties by priority desc', () => {
    const l = [t('open', 5, '1'), t('old', 1, '1', '1'), t('newLow', 1, '1', '2'), t('newHigh', 3, '1', '2')];
    expect(l.sort(compareTasks('completed')).map((x) => x.id)).toEqual(['newHigh', 'newLow', 'old', 'open']);
  });
});
