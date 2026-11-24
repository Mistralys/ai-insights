import type { AllocationOutcome, AllocationRequest, ErrorCodeProvider, ProviderContext } from '../provider-api.js';

/**
 * The built-in HTTP client for the user's public Errorcode Incrementor
 * counter service (id `errorcode-incrementor`).
 *
 * The Errorcode Incrementor library is public and MIT-licensed — this
 * module is a driver for its published protocol, like a database driver.
 * Only the host and credentials are private, and they live solely in the
 * user's own stored settings, never in this repository (see
 * `tests/error-codes/no-private-config.test.ts`).
 *
 * Protocol: `GET {base_url}?pw={password}&counter={counter}[&increment=yes]`.
 * The response body is the raw counter value followed by a configured
 * `response_suffix` (e.g. `52001` with suffix `01` means value `520`).
 * `allocate` always sends `increment=yes`; `peek` omits it, returning the
 * current value without consuming it. Query parameters named `pw`, `counter`
 * or `increment` that `base_url` already carries are always overridden by the
 * provider (and `increment` is removed for `peek`).
 *
 * Imports only from `../provider-api.js` — same rule every provider
 * (built-in or plugin) follows, so the contract stays proven sufficient by
 * its own built-ins. Uses Node's global `fetch`; no HTTP client dependency
 * is added (see `tech-stack.md`).
 */

/** This provider's settings shape, after `buildSettingsSchema(ERRORCODE_INCREMENTOR_SETTINGS).safeParse(...)`. */
interface ErrorcodeIncrementorSettings {
  base_url: string;
  password: string;
  counter: string;
  response_suffix: string;
  throttle_delay_ms: number;
}

/** Status codes that mean the provider's own configuration is wrong (never retried). */
const MISCONFIGURED_STATUSES = new Set([400, 401, 404]);

/**
 * `errno` codes from Node's `fetch` (undici) that specifically mean "the
 * request never reached a server" — DNS resolution failure or an actively
 * refused TCP connection. These are the only network failures reported as
 * `ambiguous: false`, since no byte of the request could have been received
 * by the remote service.
 */
const NON_AMBIGUOUS_NETWORK_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']);

/**
 * Builds the request URL for `action`, URL-encoding every parameter via `URLSearchParams`.
 *
 * The provider owns three query parameters — `pw`, `counter` and `increment` —
 * and always overrides whatever `base_url` carries for them. `increment` is
 * set for `allocate` and *deleted* for `peek`: a saved `base_url` that already
 * contains `increment=yes` would otherwise make a read-only `peek` (and the
 * GUI's "Test connection", which falls back to it) consume a real code.
 */
function buildRequestUrl(settings: ErrorcodeIncrementorSettings, action: 'allocate' | 'peek'): URL {
  const url = new URL(settings.base_url);
  url.searchParams.set('pw', settings.password);
  url.searchParams.set('counter', settings.counter);
  if (action === 'allocate') {
    url.searchParams.set('increment', 'yes');
  } else {
    url.searchParams.delete('increment');
  }
  return url;
}

/**
 * Parses the response body, stripping the configured `response_suffix` and
 * returning the remaining digits as an integer. Returns `null` when the
 * body does not match the expected `{digits}{suffix}` shape — the caller
 * turns that into `invalid_response`.
 */
function parseResponseBody(body: string, suffix: string): number | null {
  const trimmed = body.trim();

  const withoutSuffix = suffix.length > 0
    ? (trimmed.endsWith(suffix) ? trimmed.slice(0, trimmed.length - suffix.length) : null)
    : trimmed;

  if (withoutSuffix === null || withoutSuffix.length === 0 || !/^\d+$/.test(withoutSuffix)) {
    return null;
  }

  const value = Number.parseInt(withoutSuffix, 10);
  return Number.isSafeInteger(value) ? value : null;
}

/** Maps a non-2xx HTTP status to its documented `AllocationOutcome`. */
function mapStatusToOutcome(status: number, settings: ErrorcodeIncrementorSettings): AllocationOutcome {
  if (MISCONFIGURED_STATUSES.has(status)) {
    return { ok: false, reason: 'misconfigured', detail: `errorcode-incrementor: HTTP ${status}` };
  }
  if (status === 403) {
    return {
      ok: false,
      reason: 'throttled',
      retry_after_ms: settings.throttle_delay_ms + 1000,
      detail: 'errorcode-incrementor: HTTP 403 (throttled)',
    };
  }
  if (status === 500) {
    return { ok: false, reason: 'unavailable', ambiguous: true, detail: 'errorcode-incrementor: HTTP 500' };
  }
  return { ok: false, reason: 'rejected', detail: `errorcode-incrementor: HTTP ${status}` };
}

/** Extracts the undici/libuv `errno` code (e.g. `ENOTFOUND`) from a `fetch` rejection's `cause` chain, when present. */
function networkErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'cause' in err) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === 'object' && 'code' in cause && typeof (cause as { code?: unknown }).code === 'string') {
      return (cause as { code: string }).code;
    }
  }
  return undefined;
}

/** Shared implementation behind both `allocate` and `peek` — they differ only in whether `increment=yes` is sent. */
async function performRequest(ctx: ProviderContext, action: 'allocate' | 'peek'): Promise<AllocationOutcome> {
  const settings = ctx.settings as unknown as ErrorcodeIncrementorSettings;
  const url = buildRequestUrl(settings, action);

  let response: Response;
  try {
    response = await fetch(url, { signal: ctx.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, reason: 'unavailable', ambiguous: true, detail: 'errorcode-incrementor: request aborted' };
    }
    const code = networkErrorCode(err);
    if (code !== undefined && NON_AMBIGUOUS_NETWORK_ERROR_CODES.has(code)) {
      return { ok: false, reason: 'unavailable', ambiguous: false, detail: `errorcode-incrementor: network error (${code})` };
    }
    return { ok: false, reason: 'unavailable', ambiguous: true, detail: 'errorcode-incrementor: network error' };
  }

  if (!response.ok) {
    return mapStatusToOutcome(response.status, settings);
  }

  const body = await response.text();
  const value = parseResponseBody(body, settings.response_suffix);
  if (value === null) {
    return { ok: false, reason: 'invalid_response', detail: 'errorcode-incrementor: response body did not match the expected {digits}{suffix} shape' };
  }

  return { ok: true, value };
}

async function allocate(_request: AllocationRequest, ctx: ProviderContext): Promise<AllocationOutcome> {
  return performRequest(ctx, 'allocate');
}

async function peek(_request: AllocationRequest, ctx: ProviderContext): Promise<AllocationOutcome> {
  return performRequest(ctx, 'peek');
}

export const errorcodeIncrementorProvider: ErrorCodeProvider = {
  apiVersion: 1,
  id: 'errorcode-incrementor',
  label: 'Errorcode Incrementor (HTTP)',
  description:
    'Allocates error codes from a self-hosted Errorcode Incrementor counter service over HTTP. Requires the service URL, password and counter name — configured in your own settings, never stored in this repository.',
  settings: [
    {
      key: 'base_url',
      label: 'Base URL',
      type: 'url',
      required: true,
      description: 'The Errorcode Incrementor service URL, e.g. https://errorcodes.example.com/.',
    },
    {
      key: 'password',
      label: 'Password',
      type: 'secret',
      required: true,
      description: 'The service\'s shared password (sent as the `pw` query parameter).',
    },
    {
      key: 'counter',
      label: 'Counter Name',
      type: 'string',
      required: true,
      description: 'The counter name to allocate from on the remote service.',
    },
    {
      key: 'response_suffix',
      label: 'Response Suffix',
      type: 'string',
      default: '01',
      description: 'The fixed suffix appended to every counter value in the response body (e.g. "52001" with suffix "01" means value 520).',
    },
    {
      key: 'throttle_delay_ms',
      label: 'Throttle Delay (ms)',
      type: 'integer',
      default: 10000,
      min: 0,
      description: 'Base delay used to compute retry_after_ms when the service responds with HTTP 403 (throttled).',
    },
  ],
  allocate,
  peek,
};
