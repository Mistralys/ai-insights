import { describe, it, expect } from 'vitest';
import { isNodeError, hasErrorCode } from '../../src/utils/node-errors.js';

describe('isNodeError', () => {
  it('returns true for an ErrnoException-shaped error', () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
    expect(isNodeError(err)).toBe(true);
  });

  it('returns false for a plain Error without a code property', () => {
    expect(isNodeError(new Error('plain'))).toBe(false);
  });

  it('returns false for a non-error value', () => {
    expect(isNodeError('not an error')).toBe(false);
    expect(isNodeError(undefined)).toBe(false);
    expect(isNodeError(null)).toBe(false);
    expect(isNodeError({ code: 'ENOENT' })).toBe(false);
  });

  it('returns false for an Error whose code is not a string', () => {
    const err = Object.assign(new Error('weird'), { code: 404 });
    expect(isNodeError(err)).toBe(false);
  });
});

describe('hasErrorCode', () => {
  it('returns true when the error code matches exactly', () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
    expect(hasErrorCode(err, 'ENOENT')).toBe(true);
  });

  it('returns false when the error code does not match', () => {
    const err = Object.assign(new Error('exists'), { code: 'EEXIST' });
    expect(hasErrorCode(err, 'ENOENT')).toBe(false);
  });

  it('returns false for a non-Node error even if it coincidentally has a matching property elsewhere', () => {
    expect(hasErrorCode(new Error('plain'), 'ENOENT')).toBe(false);
    expect(hasErrorCode('ENOENT', 'ENOENT')).toBe(false);
  });

  it('returns false for an Error whose code is a non-matching different type', () => {
    const err = Object.assign(new Error('weird'), { code: 404 });
    expect(hasErrorCode(err, '404')).toBe(false);
  });
});
