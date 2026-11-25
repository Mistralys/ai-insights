/**
 * Pins the three owners of the task colour palette together: the server ids
 * (TASK_COLOR_IDS), TasksModel.PALETTE and the styles.css tokens/rules.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TASK_COLOR_IDS, colorKey, normaliseTag } from '../../src/schema/task.js';
import { loadTasksModel, PUBLIC_DIR } from './tasks-model-loader.js';

const model = loadTasksModel();
const css = readFileSync(join(PUBLIC_DIR, 'styles.css'), 'utf-8');

/** Body of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Selector not found: ${selector}`);
  return css.slice(start, css.indexOf('\n}', start));
}

describe('task palette pin', () => {
  it('PALETTE ids equal TASK_COLOR_IDS in order, with names and no hex values', () => {
    expect(model.PALETTE.map((p: { id: string }) => p.id)).toEqual([...TASK_COLOR_IDS]);
    for (const entry of model.PALETTE) {
      expect(Object.keys(entry).sort()).toEqual(['id', 'name']);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it.each([':root', '[data-theme="dark"]'])('every id has a --task-color-{id} declaration in %s', (selector) => {
    const body = ruleBody(selector);
    for (const id of TASK_COLOR_IDS) {
      expect(body, `${selector} lacks --task-color-${id}`).toMatch(new RegExp(`--task-color-${id}:\\s*#`));
    }
  });

  it('every id has a .tc-{id} rule', () => {
    for (const id of TASK_COLOR_IDS) {
      expect(css).toContain(`.tc-${id} { --dot: var(--task-color-${id}); }`);
    }
  });

  it('colorKey equals the server colorKey on a shared fixture', () => {
    const fixtures: Array<{ color?: string | null }> = [
      {}, { color: '' }, { color: null }, { color: 'red' }, { color: 'gray' },
      { color: 'Red' }, { color: '#ef4444' }, { color: 'unknown' }, { color: 'none' },
      ...TASK_COLOR_IDS.map((color) => ({ color })),
    ];
    for (const f of fixtures) expect(model.colorKey(f)).toBe(colorKey(f));
  });

  it('normaliseTag equals the server normaliseTag on a shared fixture', () => {
    const raws = [
      'a', 'Foo', '  foo bar  ', 'foo,bar', 'a  b   c', '-lead', '', '   ', ',', 'UPPER-case',
      'x'.repeat(32), 'x'.repeat(33), 'tag_1', 'tag.1', 'ünï', '1abc', 'a-b-c', 'a\tb',
    ];
    for (const raw of raws) expect(model.normaliseTag(raw), JSON.stringify(raw)).toBe(normaliseTag(raw));
  });
});
