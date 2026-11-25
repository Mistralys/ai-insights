// @vitest-environment jsdom

/**
 * Tests for gui/public/safe-markdown.js (SafeMarkdown).
 * Uses the real vendored marked library.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const publicDir = join(__dirname, '../../gui/public');
const markedJs = readFileSync(join(publicDir, 'libs/marked.min.js'), 'utf-8');
const safeJs = readFileSync(join(publicDir, 'safe-markdown.js'), 'utf-8');
const indexHtml = readFileSync(join(publicDir, 'index.html'), 'utf-8');

interface SM { render(t: string): string; renderInline(t: string): string }

function loadSafe(): SM {
  const ctx: any = {};
  vm.createContext(ctx);
  vm.runInContext(safeJs + '\nthis.SafeMarkdown = SafeMarkdown;', ctx);
  return ctx.SafeMarkdown;
}

let SafeMarkdown: SM;
let globalMarked: any;
let parseBefore: string;

beforeAll(() => {
  // marked UMD attaches to globalThis/self in jsdom
  vm.runInThisContext(markedJs);
  globalMarked = (globalThis as any).marked;
  parseBefore = globalMarked.parse('<b>x</b> [a](javascript:alert(1))');
  vm.runInThisContext(safeJs);
  SafeMarkdown = (globalThis as any).SafeMarkdown ?? (0, eval)('SafeMarkdown');
});

describe('SafeMarkdown', () => {
  it('escapes script and img onerror HTML', () => {
    const out = SafeMarkdown.render('<script>alert(1)</script>\n\nhi <img src=x onerror=alert(1)>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&lt;img');
    expect(SafeMarkdown.renderInline('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });

  it('drops javascript: links and keeps allowed schemes with target/rel', () => {
    expect(SafeMarkdown.render('[x](javascript:alert(1))')).not.toContain('<a');
    expect(SafeMarkdown.render('[x](JaVa\tScript:alert(1))')).not.toContain('<a');
    expect(SafeMarkdown.render('[x](data:text/html,hi)')).not.toContain('<a');
    for (const href of ['http://a.test/', 'https://a.test/', 'mailto:a@b.test']) {
      const out = SafeMarkdown.render(`[x](${href})`);
      expect(out).toContain(`href="${href}"`);
      expect(out).toContain('target="_blank" rel="noopener noreferrer"');
    }
  });

  it('turns images into links, never <img>', () => {
    const out = SafeMarkdown.render('![a](https://x/y.png)');
    expect(out).not.toContain('<img');
    expect(out).toContain('<a href="https://x/y.png"');
    expect(SafeMarkdown.render('![a](javascript:alert(1))')).not.toContain('<a');
  });

  it('does not double-escape code spans', () => {
    const out = SafeMarkdown.render('`a<b`');
    expect(out).toContain('a&lt;b');
    expect(out).not.toContain('&amp;lt;');
  });

  it('falls back to escaped text with <br> without marked', () => {
    const sm = loadSafe();
    expect(sm.render('a<b\nc')).toBe('a&lt;b<br>c');
    expect(sm.renderInline('<i>')).toBe('&lt;i&gt;');
  });

  it('leaves global marked defaults unchanged', () => {
    expect(globalMarked.parse('<b>x</b> [a](javascript:alert(1))')).toBe(parseBefore);
    expect(globalMarked.parse('<b>x</b>')).toContain('<b>x</b>');
  });

  it('is loaded in index.html directly after marked', () => {
    const lines = indexHtml.split('\n').map((l) => l.trim());
    const i = lines.findIndex((l) => l.includes('libs/marked.min.js'));
    expect(lines[i + 1]).toContain('/safe-markdown.js');
  });
});
