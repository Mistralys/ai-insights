import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '../../gui/public/styles.css'), 'utf-8');
const html = readFileSync(join(__dirname, '../../gui/public/index.html'), 'utf-8');

describe('Global style foundations (Step 10a)', () => {
  it('declares --color-border-strong in light and dark themes', () => {
    const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('[data-theme="dark"]'));
    const darkStart = css.indexOf('[data-theme="dark"] {');
    const darkBlock = css.slice(darkStart, css.indexOf('}', darkStart));
    expect(rootBlock).toMatch(/--color-border-strong:\s*#7d8ba1/i);
    expect(darkBlock).toMatch(/--color-border-strong:\s*#64748b/i);
  });

  it('applies the strong border to form controls and secondary buttons', () => {
    expect(css).toMatch(/\.btn-secondary\s*\{[^}]*border-color:\s*var\(--color-border-strong\)/);
    expect(css).toMatch(/\.form-control\s*\{[^}]*border:\s*1px solid var\(--color-border-strong\)/);
    expect(css).toMatch(/select,\s*textarea\s*\{[^}]*var\(--color-border-strong\)/);
  });

  it('has a global :focus-visible rule and an input variant', () => {
    expect(css).toMatch(/^:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-link\);[^}]*outline-offset:\s*2px/m);
    expect(css).toMatch(/input:focus-visible,\s*select:focus-visible,\s*textarea:focus-visible\s*\{/);
  });

  it('keeps the header nav on one scrollable row inside the narrow breakpoint', () => {
    const start = css.indexOf('@media (max-width: 900px)');
    const block = css.slice(start, css.indexOf('header nav a {', start));
    expect(block).toMatch(/header nav\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/);
  });

  it('has a prefers-reduced-motion guard', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('keeps a styles.css cache-buster', () => {
    expect(html).toMatch(/styles\.css\?v=\d+/);
  });
});

describe('Task palette tokens (Step 10b)', () => {
  const PALETTE: Record<string, string> = {
    red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#facc15',
    lime: '#84cc16', green: '#16a34a', teal: '#14b8a6', cyan: '#22d3ee',
    blue: '#3b82f6', indigo: '#4f46e5', violet: '#8b5cf6', fuchsia: '#d946ef',
    pink: '#f472b6', brown: '#92400e', slate: '#475569', gray: '#a1a1aa',
  };
  const darkStart = css.indexOf('[data-theme="dark"] {');
  const rootBlock = css.slice(css.indexOf(':root'), darkStart);
  const darkBlock = css.slice(darkStart, css.indexOf('}', darkStart));

  it.each(Object.entries(PALETTE))('declares --task-color-%s in both themes', (id, hex) => {
    const re = new RegExp(String.raw`--task-color-${id}:\s*${hex}\s*;`, 'i');
    expect(rootBlock).toMatch(re);
    expect(darkBlock).toMatch(re);
  });

  it.each(Object.keys(PALETTE))('has a .tc-%s rule feeding --dot', (id) => {
    expect(css).toMatch(new RegExp(String.raw`\.tc-${id}\s*\{\s*--dot:\s*var\(--task-color-${id}\)`));
  });

  it('keeps hex values out of the .tc-* rules', () => {
    const rules = css.match(/\.tc-[a-z]+\s*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBe(Object.keys(PALETTE).length);
    for (const r of rules) expect(r).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('bumps the styles.css cache-buster past v=8', () => {
    expect(html).toMatch(/styles\.css\?v=(?!8)\d+/);
  });
});
