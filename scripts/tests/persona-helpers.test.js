'use strict';

/**
 * persona-helpers.test.js
 *
 * Vitest test suite for scripts/lib/persona-helpers.js.
 *
 * Globals (describe, it, expect, vi, afterEach) are injected by vitest
 * via the `globals: true` config option. `require` is available because
 * the root package.json has no "type": "module" (CJS default).
 */

const helpers = require('../lib/persona-helpers');

const {
  serializeTools,
  serializeToolsList,
  validateFileName,
  resolveConditionals,
  resolvePartials,
  normalizeNewlines,
} = helpers;

// ---------------------------------------------------------------------------
// Group 1: serializeTools() and serializeToolsList()
// ---------------------------------------------------------------------------

describe('serializeTools()', () => {
  it('serializes a single tool with outer brackets', () => {
    expect(serializeTools(['vscode'])).toBe("['vscode']");
  });

  it('serializes multiple tools with outer brackets', () => {
    expect(serializeTools(['vscode', 'execute'])).toBe("['vscode', 'execute']");
  });

  it('serializes an empty array to "[]"', () => {
    expect(serializeTools([])).toBe('[]');
  });
});

describe('serializeToolsList()', () => {
  it('serializes a single tool without outer brackets', () => {
    expect(serializeToolsList(['vscode'])).toBe("'vscode'");
  });

  it('serializes multiple tools without outer brackets', () => {
    expect(serializeToolsList(['vscode', 'execute'])).toBe("'vscode', 'execute'");
  });

  it('serializes an empty array to empty string', () => {
    expect(serializeToolsList([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Group 3: validateFileName()
// ---------------------------------------------------------------------------

describe('validateFileName()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call process.exit when vs_file_name is set', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    expect(() => {
      validateFileName({ vs_file_name: '1-developer.agent.md', role: 'Developer' }, 'vs_file_name', 'ledger');
    }).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('calls process.exit(1) when vs_file_name is missing', () => {
    vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); });
    expect(() => {
      validateFileName({ role: 'Developer' }, 'vs_file_name', 'ledger');
    }).toThrow('exit:1');
  });

  it('includes the persona role in the error message when vs_file_name is missing', () => {
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      validateFileName({ role: 'Developer' }, 'vs_file_name', 'ledger');
    } catch (_) { /* expected */ }
    expect(errSpy.mock.calls[0][0]).toContain('Developer');
  });

  it('does not call process.exit when cc_file_name is set', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    expect(() => {
      validateFileName({ cc_file_name: 'developer.md', role: 'Developer' }, 'cc_file_name', 'ledger');
    }).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('calls process.exit(1) when cc_file_name is missing', () => {
    vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); });
    expect(() => {
      validateFileName({ slug: 'unit-test-auditor' }, 'cc_file_name', 'standalone');
    }).toThrow('exit:1');
  });

  it('includes the persona identifier in the error message when cc_file_name is missing', () => {
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      validateFileName({ slug: 'unit-test-auditor' }, 'cc_file_name', 'standalone');
    } catch (_) { /* expected */ }
    expect(errSpy.mock.calls[0][0]).toContain('unit-test-auditor');
  });

  it('includes the fieldName in the error message', () => {
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      validateFileName({ role: 'Developer' }, 'vs_file_name', 'ledger');
    } catch (_) { /* expected */ }
    expect(errSpy.mock.calls[0][0]).toContain('vs_file_name');
  });
});

// ---------------------------------------------------------------------------
// Group 4: resolveConditionals()
// ---------------------------------------------------------------------------

describe('resolveConditionals()', () => {
  it('keeps {{#if}} content and removes {{else}} content when flag is truthy', () => {
    const text = '{{#if show}}visible{{else}}hidden{{/if}}';
    const result = resolveConditionals(text, { show: true });
    expect(result).toContain('visible');
    expect(result).not.toContain('hidden');
  });

  it('keeps {{else}} content and removes {{#if}} content when flag is falsy', () => {
    const text = '{{#if show}}visible{{else}}hidden{{/if}}';
    const result = resolveConditionals(text, { show: false });
    expect(result).toContain('hidden');
    expect(result).not.toContain('visible');
  });

  it('keeps inner content when flag is truthy and no {{else}} branch exists', () => {
    const text = '{{#if show}}only-content{{/if}}';
    const result = resolveConditionals(text, { show: true });
    expect(result).toContain('only-content');
  });

  it('removes entire block when flag is falsy and no {{else}} branch exists', () => {
    const text = 'before{{#if show}}never-shown{{/if}}after';
    const result = resolveConditionals(text, { show: false });
    expect(result).not.toContain('never-shown');
  });

  it('treats unknown flag as falsy (removes block when flag absent from context)', () => {
    const text = '{{#if unknownFlag}}should-not-appear{{/if}}';
    const result = resolveConditionals(text, {});
    expect(result).not.toContain('should-not-appear');
  });
});

// ---------------------------------------------------------------------------
// Group 5: resolvePartials()
// ---------------------------------------------------------------------------

describe('resolvePartials()', () => {
  it('resolves a single partial', () => {
    const partialsMap = { greeting: 'Hello World' };
    const result = resolvePartials('{{> greeting}}', partialsMap);
    expect(result).toBe('Hello World');
  });

  it('resolves nested partials (depth 1 recursion)', () => {
    const partialsMap = {
      outer: 'start {{> inner}} end',
      inner: 'INNER',
    };
    const result = resolvePartials('{{> outer}}', partialsMap);
    expect(result).toBe('start INNER end');
  });

  it('preserves unresolvable marker when depth limit (>= 2) is reached', () => {
    // 3-level chain: root → a → b → c (c cannot be resolved at depth 2)
    const partialsMap = {
      a: '{{> b}}',
      b: '{{> c}}',
      c: 'deep',
    };
    const result = resolvePartials('{{> a}}', partialsMap);
    // At depth 2, {{> c}} is returned as-is (depth limit hit)
    expect(result).toBe('{{> c}}');
  });
});

// ---------------------------------------------------------------------------
// Group 6: normalizeNewlines()
// ---------------------------------------------------------------------------

describe('normalizeNewlines()', () => {
  it('converts CRLF to LF', () => {
    expect(normalizeNewlines('hello\r\nworld')).toBe('hello\nworld');
  });

  it('converts mixed CRLF and LF to all LF', () => {
    expect(normalizeNewlines('a\r\nb\nc\r\nd')).toBe('a\nb\nc\nd');
  });

  it('converts standalone CR to LF', () => {
    expect(normalizeNewlines('a\rb')).toBe('a\nb');
  });

  it('leaves already-normalized LF-only text unchanged', () => {
    const text = 'line1\nline2\nline3';
    expect(normalizeNewlines(text)).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// STRICT regex pattern (tested standalone, not via CLI)
// The regex used in --strict scan: /\{\{>?\s*[\w-]+\}\}/g
// ---------------------------------------------------------------------------

describe('STRICT unresolved-marker regex', () => {
  const STRICT_REGEX = /\{\{>?\s*[\w-]+\}\}/g;

  it('matches {{variable}} (plain variable marker)', () => {
    const matches = '{{myVariable}}'.match(STRICT_REGEX);
    expect(matches).not.toBeNull();
    expect(matches).toContain('{{myVariable}}');
  });

  it('matches {{> partial}} (partial inclusion marker)', () => {
    const matches = '{{> myPartial}}'.match(STRICT_REGEX);
    expect(matches).not.toBeNull();
    expect(matches).toContain('{{> myPartial}}');
  });

  it('does NOT match {{#if flag}} (conditional opener)', () => {
    const matches = '{{#if someFlag}}'.match(STRICT_REGEX);
    expect(matches).toBeNull();
  });

  it('does NOT match {{/if}} (conditional closer)', () => {
    const matches = '{{/if}}'.match(STRICT_REGEX);
    expect(matches).toBeNull();
  });
});
