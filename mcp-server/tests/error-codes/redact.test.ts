import { describe, it, expect, vi, afterEach } from 'vitest';
import { redact, createRedactingLogger } from '../../src/error-codes/redact.js';

describe('redact', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('redact()', () => {
    it('replaces a single occurrence of a secret', () => {
      expect(redact('password is hunter2', ['hunter2'])).toBe('password is [REDACTED]');
    });

    it('replaces every occurrence of a secret', () => {
      expect(redact('hunter2 and hunter2 again', ['hunter2'])).toBe('[REDACTED] and [REDACTED] again');
    });

    it('replaces occurrences of multiple distinct secrets', () => {
      expect(redact('user=admin pw=hunter2', ['admin', 'hunter2'])).toBe('user=[REDACTED] pw=[REDACTED]');
    });

    it('replaces longer secrets first so a secret contained in another is never partly exposed', () => {
      // "ab" is a substring of "abcdef" — if "ab" were replaced first, the
      // result would be "[REDACTED]cdef" instead of a full redaction.
      expect(redact('token=abcdef', ['ab', 'abcdef'])).toBe('token=[REDACTED]');
    });

    it('ignores empty secrets', () => {
      expect(redact('hello world', ['', 'world'])).toBe('hello [REDACTED]');
    });

    it('ignores whitespace-only secrets', () => {
      expect(redact('hello world', ['   ', 'world'])).toBe('hello [REDACTED]');
    });

    it('returns the text unchanged when secrets is empty', () => {
      expect(redact('nothing to redact here', [])).toBe('nothing to redact here');
    });

    it('returns the text unchanged when no secret matches', () => {
      expect(redact('nothing to redact here', ['missing'])).toBe('nothing to redact here');
    });

    it('treats a secret containing regex metacharacters literally', () => {
      const secret = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
      const text = `value=${secret} end`;
      expect(redact(text, [secret])).toBe('value=[REDACTED] end');
    });

    it('does not throw when a metacharacter-laden secret has no match', () => {
      expect(() => redact('safe text', ['a.*(b'])).not.toThrow();
    });
  });

  describe('createRedactingLogger()', () => {
    it('writes "[prefix] message" to stderr for info()', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const logger = createRedactingLogger('my-module', []);
      logger.info('hello');
      expect(spy).toHaveBeenCalledWith('[my-module] hello\n');
    });

    it('writes "[prefix] message" to stderr for warn()', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const logger = createRedactingLogger('my-module', []);
      logger.warn('careful');
      expect(spy).toHaveBeenCalledWith('[my-module] careful\n');
    });

    it('redacts secrets from every message', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const logger = createRedactingLogger('prov', ['hunter2']);
      logger.info('login with hunter2');
      expect(spy).toHaveBeenCalledWith('[prov] login with [REDACTED]\n');
    });

    it('never writes to stdout', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const logger = createRedactingLogger('prov', []);
      logger.info('hello');
      logger.warn('hello');
      expect(stdoutSpy).not.toHaveBeenCalled();
    });
  });
});
