/**
 * GUI Route Guards
 *
 * Request-level guards run by `dispatchRoute()` (`gui/server.ts`) after a
 * route matches and before its body is parsed. Each guard implements the
 * `RouteGuard` type declared in `server.ts`: `(req, port) => void`, throwing
 * `ApiError` to reject the request.
 *
 * These exist because the GUI server binds every network interface, not
 * just loopback (`server.listen(port, …)` passes no host), and serves no
 * authentication of its own. A route that reaches third-party code with the
 * user's own secrets (the error-code provider routes) needs its own
 * request-level defence against both a LAN client and a malicious web page
 * open in the same browser (DNS rebinding / CSRF-style access), since the
 * existing `Access-Control-Allow-Origin` header on the *response* does
 * nothing to stop either from ever reaching the handler in the first place.
 */

import type { IncomingMessage } from 'node:http';
import { ApiError } from '../src/gui/errors.js';

/**
 * Hostnames treated as loopback. `URL#hostname` keeps the brackets for an
 * IPv6 literal (`new URL('http://[::1]').hostname === '[::1]'`), so both the
 * bracketed and bare forms are listed defensively.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * True when `address` (as reported by `req.socket.remoteAddress`) is a
 * loopback address: the IPv4 `127.0.0.0/8` range, the IPv6 `::1`, or either
 * one's IPv4-mapped-IPv6 form (`::ffff:127.0.0.1`), which is what Node
 * reports for an IPv4 connection on a dual-stack socket. This is checked
 * against the actual TCP connection, not a client-supplied header, so it
 * cannot be spoofed by a request's `Host` or `Origin` the way the checks
 * below can.
 */
function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return normalized === '::1' || normalized.startsWith('127.');
}

/** The default port a bare `protocol://host` (no explicit `:port`) resolves to. */
function defaultPortFor(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}

/**
 * Rejects a request whose actual TCP connection is not loopback, whose
 * `Host` header is not a loopback address, and — when an `Origin` header is
 * present — whose origin is not the GUI's own loopback origin at `port`.
 *
 * - `req.socket.remoteAddress` is checked first, against the real
 *   connection the server accepted (`127.0.0.0/8`, `::1`, or the
 *   IPv4-mapped-IPv6 form of either). This is the primary defence: unlike
 *   every header below, a client cannot spoof which socket the OS handed
 *   the server. A non-loopback `remoteAddress` is rejected with
 *   `ApiError('FORBIDDEN')` regardless of what `Host`/`Origin` claim,
 *   because this is what stops a direct, non-browser client elsewhere on
 *   the LAN or network — the GUI server binds every interface, and such a
 *   client fully controls both headers.
 * - `Host` is required and must parse to a loopback hostname
 *   (`localhost`, `127.0.0.1`, `[::1]`). A missing or malformed `Host`, or a
 *   non-loopback one, is rejected with `ApiError('FORBIDDEN')`.
 * - `Origin`, when present (browser-originated requests always send it for
 *   a cross-origin `fetch`; same-origin requests may omit it), must also
 *   resolve to a loopback hostname AND to the same `port` this server is
 *   listening on. A request with no `Origin` header at all (e.g. a plain
 *   `curl` from the same machine) is accepted on the `remoteAddress`/`Host`
 *   checks alone — there is no browser origin to compare against.
 *
 * Checking `Host` *and* `Origin` in addition to `remoteAddress` is
 * deliberate: `remoteAddress` alone stops a non-browser LAN/network client,
 * but not a hostile web page open in a browser on the *same* machine — that
 * request's `remoteAddress` is genuinely loopback, so `Host` and `Origin`
 * remain the defence against that attacker class specifically. `Host` alone
 * would accept a hostile page's cross-origin `fetch` to
 * `http://localhost:{port}/...` (the attacker controls the URL, not the
 * `Host` header, but the browser sets `Host` to the request's own
 * destination, which is loopback here); `Origin` alone would accept a
 * non-loopback client that spoofs (or genuinely carries) no `Origin` header
 * at all, such as a non-browser LAN client.
 */
export function requireLoopbackRequest(req: IncomingMessage, port: number): void {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    throw new ApiError('FORBIDDEN', 'This endpoint only accepts connections from a loopback address.');
  }

  const hostHeader = req.headers.host;
  if (hostHeader === undefined) {
    throw new ApiError('FORBIDDEN', 'This endpoint requires a Host header.');
  }

  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${hostHeader}`);
  } catch {
    throw new ApiError('FORBIDDEN', 'This endpoint rejected a malformed Host header.');
  }

  if (!isLoopbackHostname(hostUrl.hostname)) {
    throw new ApiError('FORBIDDEN', 'This endpoint only accepts requests addressed to a loopback host.');
  }

  const originHeader = req.headers.origin;
  if (originHeader === undefined) {
    return;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(originHeader);
  } catch {
    throw new ApiError('FORBIDDEN', 'This endpoint rejected a malformed Origin header.');
  }

  const originPort = originUrl.port === '' ? defaultPortFor(originUrl.protocol) : Number(originUrl.port);

  if (!isLoopbackHostname(originUrl.hostname) || originPort !== port) {
    throw new ApiError('FORBIDDEN', 'This endpoint only accepts requests from the GUI\'s own origin.');
  }
}

/**
 * Rejects a request body whose `Content-Type` is not `application/json`
 * (a parameter such as `; charset=utf-8` is tolerated) with
 * `ApiError('UNSUPPORTED_MEDIA_TYPE')`.
 *
 * Intended for `PUT`/`POST` routes carrying a body — pair with
 * `requireLoopbackRequest` on those routes, never as a substitute for it:
 * a `Content-Type` check alone does not stop a non-browser LAN client or a
 * DNS-rebinding attack, since neither has to respect it.
 */
export function requireJsonContentType(req: IncomingMessage): void {
  const contentType = req.headers['content-type'];
  if (contentType === undefined || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'This endpoint requires a Content-Type of application/json.');
  }
}
