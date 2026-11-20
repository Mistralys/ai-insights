/**
 * Unit tests for gui/route-guards.ts (WP-011).
 *
 * Verifies that:
 * - requireLoopbackRequest accepts a loopback Host with no Origin, or with
 *   a matching loopback Origin at the listening port, on a loopback socket.
 * - requireLoopbackRequest rejects a non-loopback socket remoteAddress
 *   (even when Host/Origin spoof a loopback value), a non-loopback Host, a
 *   missing Host, a malformed Host, a foreign Origin, a loopback Origin at
 *   the wrong port, and a malformed Origin — all with ApiError('FORBIDDEN').
 * - requireJsonContentType accepts application/json (with parameters) and
 *   rejects anything else, or an absent header, with
 *   ApiError('UNSUPPORTED_MEDIA_TYPE').
 */

import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { requireLoopbackRequest, requireJsonContentType } from '../../gui/route-guards.js';
import { ApiError } from '../../src/gui/errors.js';

/**
 * Builds a fake `IncomingMessage` with the given headers and a socket whose
 * `remoteAddress` defaults to a loopback address (`127.0.0.1`) so existing
 * Host/Origin-focused test cases do not need to know about the socket-level
 * check. Pass `remoteAddress` explicitly to exercise that check itself.
 */
function fakeRequest(
  headers: Record<string, string | undefined>,
  remoteAddress: string | undefined = '127.0.0.1'
): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

describe('requireLoopbackRequest', () => {
  const PORT = 3420;

  it('accepts a loopback Host with no Origin header', () => {
    expect(() => requireLoopbackRequest(fakeRequest({ host: `localhost:${PORT}` }), PORT)).not.toThrow();
    expect(() => requireLoopbackRequest(fakeRequest({ host: `127.0.0.1:${PORT}` }), PORT)).not.toThrow();
    expect(() => requireLoopbackRequest(fakeRequest({ host: `[::1]:${PORT}` }), PORT)).not.toThrow();
  });

  it('accepts a loopback Host with a matching loopback Origin at the listening port', () => {
    expect(() =>
      requireLoopbackRequest(
        fakeRequest({ host: `localhost:${PORT}`, origin: `http://localhost:${PORT}` }),
        PORT
      )
    ).not.toThrow();

    expect(() =>
      requireLoopbackRequest(
        fakeRequest({ host: `localhost:${PORT}`, origin: `http://127.0.0.1:${PORT}` }),
        PORT
      )
    ).not.toThrow();
  });

  it('rejects a missing Host header', () => {
    try {
      requireLoopbackRequest(fakeRequest({}), PORT);
      throw new Error('expected requireLoopbackRequest to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('FORBIDDEN');
    }
  });

  it('rejects a malformed Host header', () => {
    try {
      requireLoopbackRequest(fakeRequest({ host: '::::not-a-host::::' }), PORT);
      throw new Error('expected requireLoopbackRequest to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('FORBIDDEN');
    }
  });

  it('rejects a non-loopback Host', () => {
    try {
      requireLoopbackRequest(fakeRequest({ host: `example.com:${PORT}` }), PORT);
      throw new Error('expected requireLoopbackRequest to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('FORBIDDEN');
    }
  });

  it('rejects a foreign Origin even when Host is loopback', () => {
    try {
      requireLoopbackRequest(
        fakeRequest({ host: `localhost:${PORT}`, origin: 'https://evil.example.com' }),
        PORT
      );
      throw new Error('expected requireLoopbackRequest to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('FORBIDDEN');
    }
  });

  it('rejects a loopback Origin at the wrong port', () => {
    try {
      requireLoopbackRequest(
        fakeRequest({ host: `localhost:${PORT}`, origin: `http://localhost:${PORT + 1}` }),
        PORT
      );
      throw new Error('expected requireLoopbackRequest to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('FORBIDDEN');
    }
  });

  it('rejects a malformed Origin header', () => {
    try {
      requireLoopbackRequest(
        fakeRequest({ host: `localhost:${PORT}`, origin: '::::not-a-url::::' }),
        PORT
      );
      throw new Error('expected requireLoopbackRequest to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('FORBIDDEN');
    }
  });

  it('resolves an Origin with no explicit port against the protocol default (http → 80)', () => {
    expect(() =>
      requireLoopbackRequest(fakeRequest({ host: 'localhost:80', origin: 'http://localhost' }), 80)
    ).not.toThrow();
    expect(() =>
      requireLoopbackRequest(fakeRequest({ host: 'localhost:80', origin: 'http://localhost' }), 81)
    ).toThrow(ApiError);
  });

  it('accepts an IPv6 loopback remoteAddress (::1)', () => {
    expect(() =>
      requireLoopbackRequest(fakeRequest({ host: `localhost:${PORT}` }, '::1'), PORT)
    ).not.toThrow();
  });

  it('accepts an IPv4-mapped-IPv6 loopback remoteAddress (::ffff:127.0.0.1)', () => {
    expect(() =>
      requireLoopbackRequest(fakeRequest({ host: `localhost:${PORT}` }, '::ffff:127.0.0.1'), PORT)
    ).not.toThrow();
  });

  it('rejects a non-loopback remoteAddress even when Host and Origin claim loopback', () => {
    try {
      requireLoopbackRequest(
        fakeRequest({ host: `localhost:${PORT}`, origin: `http://localhost:${PORT}` }, '203.0.113.7'),
        PORT
      );
      throw new Error('expected requireLoopbackRequest to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('FORBIDDEN');
    }
  });

  it('rejects a LAN remoteAddress with a spoofed loopback Host and no Origin header', () => {
    try {
      requireLoopbackRequest(fakeRequest({ host: `localhost:${PORT}` }, '192.168.1.50'), PORT);
      throw new Error('expected requireLoopbackRequest to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('FORBIDDEN');
    }
  });

  it('rejects a missing remoteAddress', () => {
    // Passed via a literal request object (not fakeRequest's default param)
    // since a default parameter also applies to an explicit `undefined` arg.
    const req = { headers: { host: `localhost:${PORT}` }, socket: {} } as unknown as IncomingMessage;
    try {
      requireLoopbackRequest(req, PORT);
      throw new Error('expected requireLoopbackRequest to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('FORBIDDEN');
    }
  });
});

describe('requireJsonContentType', () => {
  it('accepts application/json', () => {
    expect(() => requireJsonContentType(fakeRequest({ 'content-type': 'application/json' }))).not.toThrow();
  });

  it('accepts application/json with a charset parameter', () => {
    expect(() =>
      requireJsonContentType(fakeRequest({ 'content-type': 'application/json; charset=utf-8' }))
    ).not.toThrow();
  });

  it('rejects an absent Content-Type header', () => {
    try {
      requireJsonContentType(fakeRequest({}));
      throw new Error('expected requireJsonContentType to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });

  it('rejects a non-JSON Content-Type', () => {
    try {
      requireJsonContentType(fakeRequest({ 'content-type': 'text/plain' }));
      throw new Error('expected requireJsonContentType to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });
});
