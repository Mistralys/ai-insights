/**
 * scripts/tests/stdin-handoff.test.js
 *
 * Unit tests for scripts/lib/stdin-handoff.js — releasing the parent's stdin
 * read before an inherited-stdio child (agent picker, claude) takes over.
 */

import { describe, it, expect, vi } from 'vitest';
import { releaseStdinForChild } from '../lib/stdin-handoff.js';

function fakeStdin({ isTTY = true, reading = true, readStopResult = 0 } = {}) {
  const calls = [];
  return {
    calls,
    isTTY,
    setRawMode: vi.fn((v) => calls.push(`setRawMode(${v})`)),
    pause: vi.fn(() => calls.push('pause')),
    _handle: {
      reading,
      readStop: vi.fn(() => { calls.push('readStop'); return readStopResult; }),
    },
    _readableState: { reading: true },
  };
}

describe('releaseStdinForChild', () => {
  it('stops the handle read on Windows and resets both reading flags', () => {
    const stdin = fakeStdin();
    const stopped = releaseStdinForChild({ stdin, platform: 'win32' });

    expect(stopped).toBe(true);
    expect(stdin.calls).toEqual(['setRawMode(false)', 'pause', 'readStop']);
    expect(stdin._handle.reading).toBe(false);
    expect(stdin._readableState.reading).toBe(false);
  });

  it('only leaves raw mode and pauses on non-Windows platforms', () => {
    const stdin = fakeStdin();
    const stopped = releaseStdinForChild({ stdin, platform: 'darwin' });

    expect(stopped).toBe(false);
    expect(stdin._handle.readStop).not.toHaveBeenCalled();
    expect(stdin._handle.reading).toBe(true);
    expect(stdin.calls).toEqual(['setRawMode(false)', 'pause']);
  });

  it('does not call readStop when the handle is not reading', () => {
    const stdin = fakeStdin({ reading: false });
    expect(releaseStdinForChild({ stdin, platform: 'win32' })).toBe(false);
    expect(stdin._handle.readStop).not.toHaveBeenCalled();
  });

  it('skips setRawMode on non-TTY stdin', () => {
    const stdin = fakeStdin({ isTTY: false });
    releaseStdinForChild({ stdin, platform: 'win32' });
    expect(stdin.setRawMode).not.toHaveBeenCalled();
    expect(stdin._handle.readStop).toHaveBeenCalled();
  });

  it('reports a libuv readStop error and leaves the flags untouched', () => {
    const stdin = fakeStdin({ readStopResult: -4071 });
    const onError = vi.fn();
    const stopped = releaseStdinForChild({ stdin, platform: 'win32', onError });

    expect(stopped).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toContain('-4071');
    expect(stdin._handle.reading).toBe(true);
  });

  it('tolerates a setRawMode that throws and a missing handle', () => {
    const stdin = fakeStdin();
    stdin.setRawMode = () => { throw new Error('closed console'); };
    stdin._handle = null;
    expect(() => releaseStdinForChild({ stdin, platform: 'win32' })).not.toThrow();
  });
});
