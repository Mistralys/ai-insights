/**
 * scripts/tests/pr-review-comments.test.js
 *
 * Unit tests for scripts/lib/pr-review-comments.js (gh is injected, no network).
 */

import { describe, it, expect } from 'vitest';

import {
  parseArgs,
  resolveTarget,
  fetchReviewThreads,
  selectThreads,
} from '../lib/pr-review-comments.js';

function thread(overrides = {}) {
  return {
    id: 'T1',
    isResolved: false,
    isOutdated: false,
    path: 'src/a.js',
    line: 10,
    startLine: null,
    comments: {
      totalCount: 1,
      nodes: [{ author: { login: 'copilot-pull-request-reviewer' }, body: 'Fix this', url: 'https://x/1' }],
    },
    ...overrides,
  };
}

function page(nodes, hasNextPage = false, endCursor = null) {
  return JSON.stringify({
    data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage, endCursor }, nodes } } } },
  });
}

describe('parseArgs()', () => {
  it('returns defaults for no arguments', () => {
    expect(parseArgs([])).toEqual({
      help: false, pr: null, repo: null, author: 'copilot',
      includeResolved: false, includeOutdated: false,
    });
  });

  it('parses all options', () => {
    const o = parseArgs(['--pr', '42', '--repo', 'a/b', '--author', 'bot', '--include-resolved', '--include-outdated']);
    expect(o).toMatchObject({ pr: 42, repo: 'a/b', author: 'bot', includeResolved: true, includeOutdated: true });
  });

  it.each([
    [['--pr']],
    [['--pr', 'abc']],
    [['--pr', '0']],
    [['--repo', 'nope']],
    [['--author', '--help']],
    [['--bogus']],
  ])('rejects %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });
});

describe('resolveTarget()', () => {
  it('uses explicit values without calling gh', () => {
    const gh = () => { throw new Error('should not be called'); };
    expect(resolveTarget({ repo: 'o/r', pr: 5 }, gh)).toEqual({ owner: 'o', repo: 'r', pr: 5 });
  });

  it('asks gh for the missing repo and PR', () => {
    const gh = (args) => (args[0] === 'repo' ? 'o/r\n' : '7\n');
    expect(resolveTarget({ repo: null, pr: null }, gh)).toEqual({ owner: 'o', repo: 'r', pr: 7 });
  });

  it('fails clearly when the PR cannot be determined', () => {
    const gh = () => 'garbage';
    expect(() => resolveTarget({ repo: 'o/r', pr: null }, gh)).toThrow(/--pr/);
  });
});

describe('fetchReviewThreads()', () => {
  it('follows pagination using the end cursor', () => {
    const calls = [];
    const gh = (args) => {
      calls.push(args);
      return calls.length === 1 ? page([thread({ id: 'A' })], true, 'CUR') : page([thread({ id: 'B' })]);
    };
    const result = fetchReviewThreads({ owner: 'o', repo: 'r', pr: 1 }, gh);
    expect(result.map((t) => t.id)).toEqual(['A', 'B']);
    expect(calls[0]).not.toContain('cursor=CUR');
    expect(calls[1]).toContain('cursor=CUR');
  });

  it('throws on GraphQL errors', () => {
    const gh = () => JSON.stringify({ errors: [{ message: 'boom' }] });
    expect(() => fetchReviewThreads({ owner: 'o', repo: 'r', pr: 1 }, gh)).toThrow(/boom/);
  });

  it('throws when the PR does not exist', () => {
    const gh = () => JSON.stringify({ data: { repository: { pullRequest: null } } });
    expect(() => fetchReviewThreads({ owner: 'o', repo: 'r', pr: 9 }, gh)).toThrow(/#9 not found/);
  });

  it('throws on malformed JSON', () => {
    expect(() => fetchReviewThreads({ owner: 'o', repo: 'r', pr: 1 }, () => 'not json')).toThrow(/malformed/);
  });
});

describe('selectThreads()', () => {
  const defaults = { author: 'copilot', includeResolved: false, includeOutdated: false };

  it('keeps unresolved, current Copilot threads and flattens them', () => {
    expect(selectThreads([thread()], defaults)).toEqual([{
      id: 'T1', path: 'src/a.js', line: 10, startLine: null,
      isResolved: false, isOutdated: false,
      author: 'copilot-pull-request-reviewer', body: 'Fix this', url: 'https://x/1', commentCount: 1,
    }]);
  });

  it('drops resolved and outdated threads unless included', () => {
    const list = [thread({ id: 'R', isResolved: true }), thread({ id: 'O', isOutdated: true })];
    expect(selectThreads(list, defaults)).toEqual([]);
    const all = selectThreads(list, { ...defaults, includeResolved: true, includeOutdated: true });
    expect(all.map((t) => t.id)).toEqual(['R', 'O']);
  });

  it('filters by author pattern, case-insensitively, and tolerates deleted authors', () => {
    const human = thread({ id: 'H', comments: { totalCount: 1, nodes: [{ author: { login: 'alice' }, body: 'x', url: 'u' }] } });
    const ghost = thread({ id: 'G', comments: { totalCount: 1, nodes: [{ author: null, body: 'x', url: 'u' }] } });
    const empty = thread({ id: 'E', comments: { totalCount: 0, nodes: [] } });
    const list = [thread(), human, ghost, empty];
    expect(selectThreads(list, { ...defaults, author: 'COPILOT' }).map((t) => t.id)).toEqual(['T1']);
    expect(selectThreads(list, { ...defaults, author: '.*' }).map((t) => t.id)).toEqual(['T1', 'H', 'G']);
  });

  it('rejects an invalid author regex', () => {
    expect(() => selectThreads([], { ...defaults, author: '(' })).toThrow(/--author/);
  });
});
