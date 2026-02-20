import { describe, it, expect, vi } from 'vitest';
import { ifDefined } from '../../src/utils/if-defined.js';

describe('ifDefined', () => {
  it('calls fn with the value when value is defined', () => {
    const fn = vi.fn();
    ifDefined('hello', fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('hello');
  });

  it('does not call fn when value is undefined', () => {
    const fn = vi.fn();
    ifDefined(undefined, fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns void in both branches', () => {
    expect(ifDefined('x', () => {})).toBeUndefined();
    expect(ifDefined(undefined, () => {})).toBeUndefined();
  });

  it('supports mutation of an outer variable (primary use case)', () => {
    let result: string | undefined;
    ifDefined('captured', (v) => { result = v.trim(); });
    expect(result).toBe('captured');
  });

  it('works with numeric values including 0', () => {
    const fn = vi.fn();
    ifDefined(0, fn);
    expect(fn).toHaveBeenCalledWith(0);
  });

  it('works with boolean false (only undefined is skipped, not falsy)', () => {
    const fn = vi.fn();
    ifDefined(false, fn);
    expect(fn).toHaveBeenCalledWith(false);
  });
});
