/**
 * GUI API Route Handlers — Error-Code Provider Domain
 *
 * All REST handlers for the `/api/error-codes/*` endpoints that back the
 * GUI's Error Codes settings tab. Follows the domain-split pattern
 * established by `api-repos.ts` / `api-knowledge.ts` — each API domain gets
 * its own handler file imported from `server.ts`.
 *
 * Every route here is registered with `requireLoopbackRequest` (and the
 * `PUT`/`POST` routes additionally with `requireJsonContentType`) in
 * `server.ts`'s `buildErrorCodeRoutes()` — this module assumes that guard
 * has already run and never re-checks it.
 *
 * Routes provided:
 *   GET  /api/error-codes/providers  — list every registered provider (built-in and plugin), plus plugin load errors
 *   GET  /api/error-codes/config     — the allocator's config, with every secret masked to { set: boolean }
 *   PUT  /api/error-codes/config     — update the config and/or one provider's settings
 *   POST /api/error-codes/test       — connection-test a provider's settings without allocating a code
 *   GET  /api/error-codes/temporary  — list logged temporary codes, newest-first, capped by `limit`
 *
 * Error shape: { code: string, message: string, details?: unknown }
 *   NOT_FOUND            → 404
 *   VALIDATION_ERROR     → 400
 *   UNSUPPORTED_MEDIA_TYPE → 415 (guard-only; never thrown by a handler in this file)
 *   (unhandled)          → 500
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { ApiError, describeZodIssues } from '../src/gui/errors.js';
import { getProvider, listProviders, listProviderLoadErrors, type ProviderLoadError } from '../src/error-codes/provider-registry.js';
import { loadErrorCodeConfig, readErrorCodeConfig, updateErrorCodeConfig, TemporaryPrefixSchema, type ErrorCodeConfig } from '../src/error-codes/config-store.js';
import {
  buildSettingsSchema,
  toPublicSettings,
  mergeSettingsUpdate,
  mergeSettingsForTest,
  collectSecrets,
} from '../src/error-codes/settings-schema.js';
import { createRedactingLogger, redact } from '../src/error-codes/redact.js';
import { listTemporaryCodes, type TemporaryCodeEntry } from '../src/error-codes/temporary-codes.js';
import { resolveErrorCodesDir, resolveErrorCodePluginDir, resolveErrorCodeProviderDataDir } from '../src/storage/store-registry.js';
import type { AllocationRequest, ErrorCodeProvider, ProviderContext, SettingField, TestOutcome } from '../src/error-codes/provider-api.js';

function validationError(message: string, details?: unknown): never {
  throw new ApiError('VALIDATION_ERROR', message, details);
}

// ---------------------------------------------------------------------------
// GET /api/error-codes/providers
// ---------------------------------------------------------------------------

/** One provider as returned to the GUI — descriptors only, never a settings value. */
export interface ProviderListItem {
  id: string;
  label: string;
  description?: string;
  settings: SettingField[];
  /** `true` when the provider offers `test` or `peek` — the GUI only renders a "Test connection" button when this is `true`. */
  supports_test: boolean;
  source: 'builtin' | 'plugin';
  /** Absolute path to the plugin's file or folder. Present only for `source: 'plugin'`. Showing this path is a deliberate, loopback-guarded exception to the GUI's "no internal paths in responses" rule. */
  path?: string;
}

/**
 * Lists every provider currently registered (built-in and plugin alike),
 * plus the plugin directory that was scanned and any load errors recorded
 * by the most recent `initProviderRegistry()` call.
 */
export async function handleListErrorCodeProviders(): Promise<{
  providers: ProviderListItem[];
  plugin_dir: string;
  load_errors: ProviderLoadError[];
}> {
  const providers: ProviderListItem[] = listProviders().map((entry) => ({
    id: entry.provider.id,
    label: entry.provider.label,
    ...(entry.provider.description !== undefined ? { description: entry.provider.description } : {}),
    settings: entry.provider.settings,
    supports_test: typeof entry.provider.test === 'function' || typeof entry.provider.peek === 'function',
    source: entry.source,
    ...(entry.path !== undefined ? { path: entry.path } : {}),
  }));

  return {
    providers,
    plugin_dir: resolveErrorCodePluginDir(),
    load_errors: listProviderLoadErrors(),
  };
}

// ---------------------------------------------------------------------------
// GET / PUT /api/error-codes/config
// ---------------------------------------------------------------------------

/** Shared GET/PUT response shape: every secret is masked to `{ set: boolean }`. */
export interface ErrorCodeConfigResponse {
  active_provider: string;
  temporary_prefix: string;
  timeout_ms: number;
  retry: { default_wait_ms: number; max_wait_ms: number };
  /** Keyed by provider id. Only currently-registered providers appear here — an uninstalled provider's stored settings are preserved in config.json but omitted from this response, since this module has no settings descriptors to mask its secrets safely. */
  providers: Record<string, Record<string, unknown>>;
  /** Present only when `config.json` needed salvage or could not be used as stored — see `readErrorCodeConfig()`. Never a stored value or a parser message. */
  warning?: string;
}

function buildConfigResponse(config: ErrorCodeConfig, warning?: string): ErrorCodeConfigResponse {
  const providers: Record<string, Record<string, unknown>> = {};
  for (const entry of listProviders()) {
    const stored = config.providers[entry.provider.id] ?? {};
    providers[entry.provider.id] = toPublicSettings(entry.provider.settings, stored);
  }

  return {
    active_provider: config.active_provider,
    temporary_prefix: config.temporary_prefix,
    timeout_ms: config.timeout_ms,
    retry: config.retry,
    providers,
    ...(warning !== undefined ? { warning } : {}),
  };
}

/**
 * Returns the allocator's config, with every secret masked to `{ set: boolean }`.
 *
 * Uses {@link readErrorCodeConfig} (not {@link loadErrorCodeConfig}) so a
 * salvaged/corrupt/unreadable config.json surfaces its `warning` to the GUI
 * instead of only to stderr, which this GET route's caller never sees.
 */
export async function handleGetErrorCodeConfig(): Promise<ErrorCodeConfigResponse> {
  const { config, warning } = await readErrorCodeConfig();
  return buildConfigResponse(config, warning);
}

/**
 * Body schema for `PUT /api/error-codes/config`.
 *
 * Exported so that test code can construct and inspect validated shapes
 * directly. Not intended as a stable public API — treat as `@internal`.
 *
 * Every top-level field is optional and independently applied: an omitted
 * field leaves the corresponding stored value unchanged. `provider_id` /
 * `settings` / `clear_secrets` together update one provider's settings
 * block — `settings` and `clear_secrets` are ignored when `provider_id` is
 * absent.
 */
export const PutErrorCodeConfigBodySchema = z
  .object({
    active_provider: z.string().optional(),
    temporary_prefix: TemporaryPrefixSchema.optional(),
    timeout_ms: z.number().int().positive().optional(),
    retry: z
      .object({
        default_wait_ms: z.number().int().positive().optional(),
        max_wait_ms: z.number().int().positive().optional(),
      })
      .optional(),
    provider_id: z.string().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    clear_secrets: z.array(z.string()).optional(),
  })
  .strict();

/**
 * Updates the allocator's top-level config and/or one provider's settings.
 *
 * - `provider_id` must name a currently-registered provider — this route
 *   has no settings descriptors for an uninstalled one, so it cannot
 *   validate or mask its secrets, and rejects the attempt with
 *   `VALIDATION_ERROR` rather than writing an unvalidated blob. Omitting
 *   `provider_id` (to change only `active_provider` or the other top-level
 *   fields) leaves every provider's stored settings untouched, which is
 *   exactly how an uninstalled provider's settings survive the round trip.
 * - When `provider_id` is present, `settings` is merged onto the stored
 *   settings via `mergeSettingsUpdate` (an absent/empty secret keeps the
 *   stored value; a key listed in `clear_secrets` is cleared), then
 *   validated against that provider's own `buildSettingsSchema` — invalid
 *   settings are rejected with `VALIDATION_ERROR` and never written.
 * - `active_provider`, when present, must also name a currently-registered
 *   provider — the GUI's provider selector only ever offers a registered
 *   id, so this guards against a stale or hand-crafted request silently
 *   pointing the allocator at a provider it does not know about yet.
 */
export async function handleUpdateErrorCodeConfig(body: unknown): Promise<ErrorCodeConfigResponse> {
  const parsed = PutErrorCodeConfigBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(`Invalid request body: ${describeZodIssues(parsed.error.issues)}`, parsed.error.flatten().fieldErrors);
  }

  const { active_provider, temporary_prefix, timeout_ms, retry, provider_id, settings, clear_secrets } = parsed.data;

  if (active_provider !== undefined && getProvider(active_provider) === undefined) {
    validationError(`Unknown or uninstalled provider: '${active_provider}'.`);
  }

  let validatedProviderSettings: Record<string, unknown> | undefined;
  let targetProvider: ErrorCodeProvider | undefined;

  if (provider_id !== undefined) {
    targetProvider = getProvider(provider_id);
    if (targetProvider === undefined) {
      validationError(`Unknown or uninstalled provider: '${provider_id}'.`);
    }

    const current = await loadErrorCodeConfig();
    const stored = current.providers[provider_id] ?? {};
    const merged = mergeSettingsUpdate(targetProvider.settings, stored, settings ?? {}, clear_secrets ?? []);
    const schemaResult = buildSettingsSchema(targetProvider.settings).safeParse(merged);
    if (!schemaResult.success) {
      validationError(`Invalid provider settings: ${describeZodIssues(schemaResult.error.issues)}`, schemaResult.error.flatten().fieldErrors);
    }
    validatedProviderSettings = schemaResult.data;
  }

  const updated = await updateErrorCodeConfig((current) => {
    const next: ErrorCodeConfig = {
      ...current,
      ...(active_provider !== undefined ? { active_provider } : {}),
      ...(temporary_prefix !== undefined ? { temporary_prefix } : {}),
      ...(timeout_ms !== undefined ? { timeout_ms } : {}),
      ...(retry !== undefined ? { retry: { ...current.retry, ...retry } } : {}),
    };

    if (provider_id !== undefined && validatedProviderSettings !== undefined) {
      next.providers = { ...current.providers, [provider_id]: validatedProviderSettings };
    }

    return next;
  });

  return buildConfigResponse(updated);
}

// ---------------------------------------------------------------------------
// POST /api/error-codes/test
// ---------------------------------------------------------------------------

/**
 * Body schema for `POST /api/error-codes/test`.
 *
 * Exported so that test code can construct and inspect validated shapes
 * directly. Not intended as a stable public API — treat as `@internal`.
 */
export const TestErrorCodeProviderBodySchema = z
  .object({
    provider_id: z.string(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** Response shape for `POST /api/error-codes/test`. */
export interface TestConnectionResponse {
  /** `false` when the provider offers neither `test` nor `peek` — `ok`/`reason`/`detail`/`value` are then absent. */
  supported: boolean;
  /** `true` when a stored secret was merged into the settings actually tested (see `mergeSettingsForTest`). */
  secrets_merged: boolean;
  ok?: boolean;
  reason?: string;
  detail?: string;
  value?: number;
  message?: string;
}

/**
 * Connection-tests a provider's settings without ever calling `allocate` —
 * this is the one route in the server that combines a provider's stored
 * secrets with client-supplied settings, so it follows the fail-closed
 * merge rule documented on `mergeSettingsForTest`: stored secrets are
 * merged in only when every non-secret field (of any type) matches its
 * stored value; otherwise the incoming settings are tested as given,
 * including any incoming secret, and `secrets_merged` is `false`.
 *
 * Calls the provider's `test` hook when present; falls back to `peek` when
 * `test` is absent (built with a core-constructed `AllocationRequest`
 * carrying no repository and no context, since a connection test is not
 * about any one allocation); when neither hook is offered, returns
 * `{ supported: false, message: "… offers no connection test" }` without
 * calling the provider at all.
 *
 * A throw from `test`/`peek` is caught and reported as `{ ok: false,
 * reason: 'failed' }`; a timeout (the same `config.timeout_ms` the
 * allocator itself uses) is reported as `{ ok: false, reason: 'unavailable' }`.
 * Every text field is redacted of the tested settings' secrets before
 * leaving this function.
 */
export async function handleTestErrorCodeProvider(body: unknown): Promise<TestConnectionResponse> {
  const parsed = TestErrorCodeProviderBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(`Invalid request body: ${describeZodIssues(parsed.error.issues)}`, parsed.error.flatten().fieldErrors);
  }
  const { provider_id, settings } = parsed.data;

  const provider = getProvider(provider_id);
  if (provider === undefined) {
    validationError(`Unknown or uninstalled provider: '${provider_id}'.`);
  }

  const config = await loadErrorCodeConfig();
  const stored = config.providers[provider_id] ?? {};
  const merge = mergeSettingsForTest(provider.settings, stored, settings ?? {});

  const schemaResult = buildSettingsSchema(provider.settings).safeParse(merge.settings);
  if (!schemaResult.success) {
    validationError(`Invalid provider settings: ${describeZodIssues(schemaResult.error.issues)}`, schemaResult.error.flatten().fieldErrors);
  }
  const validatedSettings = schemaResult.data;
  const secrets = collectSecrets(provider.settings, validatedSettings);

  if (typeof provider.test !== 'function' && typeof provider.peek !== 'function') {
    return {
      supported: false,
      secrets_merged: merge.secrets_merged,
      message: `Provider '${provider_id}' offers no connection test.`,
    };
  }

  const signal = AbortSignal.timeout(config.timeout_ms);
  const log = createRedactingLogger(`${provider_id}-test`, secrets);
  const ctx: ProviderContext = {
    settings: validatedSettings,
    signal,
    data_dir: resolveErrorCodeProviderDataDir(provider_id),
    log,
  };

  try {
    let outcome: TestOutcome;
    if (typeof provider.test === 'function') {
      outcome = await provider.test(ctx);
    } else {
      const request: AllocationRequest = { request_id: randomUUID(), cwd_path: null, repository: null, context: null };
      const peekOutcome = await provider.peek!(request, ctx);
      outcome = peekOutcome;
    }

    if (outcome.ok) {
      return {
        supported: true,
        secrets_merged: merge.secrets_merged,
        ok: true,
        ...(outcome.detail !== undefined ? { detail: redact(outcome.detail, secrets) } : {}),
        ...(outcome.value !== undefined ? { value: outcome.value } : {}),
      };
    }

    return {
      supported: true,
      secrets_merged: merge.secrets_merged,
      ok: false,
      reason: outcome.reason,
      ...(outcome.detail !== undefined ? { detail: redact(outcome.detail, secrets) } : {}),
    };
  } catch (error) {
    if (signal.aborted) {
      return {
        supported: true,
        secrets_merged: merge.secrets_merged,
        ok: false,
        reason: 'unavailable',
        detail: `provider '${provider_id}' timed out after ${config.timeout_ms}ms`,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      supported: true,
      secrets_merged: merge.secrets_merged,
      ok: false,
      reason: 'failed',
      detail: redact(message, secrets),
    };
  }
}

// ---------------------------------------------------------------------------
// GET /api/error-codes/temporary
// ---------------------------------------------------------------------------

/** Default, and maximum sane, number of entries `GET /api/error-codes/temporary` returns when `limit` is omitted. */
const DEFAULT_TEMPORARY_CODES_LIMIT = 200;

/**
 * Lists logged temporary codes, newest-first, capped at `limit` (default
 * {@link DEFAULT_TEMPORARY_CODES_LIMIT}).
 *
 * @param query - Parsed query-string parameters from the request URL. An
 *   optional `limit` must be a positive integer.
 * @returns The entries, plus a `warning` passed through unchanged when the log is corrupt.
 */
export async function handleListTemporaryErrorCodesGui(
  query?: URLSearchParams
): Promise<{ entries: TemporaryCodeEntry[]; warning?: string }> {
  let limit = DEFAULT_TEMPORARY_CODES_LIMIT;
  const limitParam = query?.get('limit');
  if (limitParam !== null && limitParam !== undefined) {
    const parsedLimit = Number(limitParam);
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      validationError('limit must be a positive integer.');
    }
    limit = parsedLimit;
  }

  const { entries, warning } = await listTemporaryCodes(resolveErrorCodesDir());
  const newestFirst = [...entries].reverse();
  return { entries: newestFirst.slice(0, limit), ...(warning !== undefined ? { warning } : {}) };
}
