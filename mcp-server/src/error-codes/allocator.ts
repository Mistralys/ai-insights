import { randomUUID } from 'crypto';
import { resolveErrorCodesDir } from '../storage/store-registry.js';
import { buildSettingsSchema, collectSecrets } from './settings-schema.js';
import { createRedactingLogger, redact } from './redact.js';
import type { ErrorCodeConfig } from './config-store.js';
import type { TemporaryCodeEntryInput } from './temporary-codes.js';
import type { AllocationOutcome, AllocationRequest, ErrorCodeProvider, FailureReason, RepositoryInfo } from './provider-api.js';

/**
 * The single policy pipeline that turns an agent's request into an
 * {@link ErrorCodeResult}: load config, resolve the repository, call the
 * active provider, validate its outcome, retry once on throttling, and fall
 * back to a temporary code on every other failure.
 *
 * All policy — retry, fallback, timeouts, redaction and result validation —
 * lives here rather than in providers (see the "Policy Lives in the
 * Allocator, Not in Providers" constraint), so a plugin cannot get it wrong
 * and a future policy change never touches the provider contract.
 *
 * There is no separate `types.ts`: {@link ErrorCodeResult} is exported from
 * this module because this is the module that owns it (the config schema
 * lives in `config-store.ts`, the temporary-entry schema in
 * `temporary-codes.ts`).
 */

/** Input the caller (the `ledger_generate_error_code` tool) passes to {@link allocateErrorCode}. */
export interface AllocateErrorCodeInput {
  /** The agent's working directory or repository root, or `null` when omitted. */
  cwd_path: string | null;
  /** Free text from the agent, e.g. a class or namespace name. `null` when omitted. */
  context: string | null;
  /** `true` skips the provider on purpose and issues a temporary code directly (fallback reason `requested`). */
  temporary?: boolean;
}

/**
 * Every reason a result can carry: the six {@link FailureReason} values the
 * core's retry/fallback policy understands, plus `requested` for an
 * explicit `temporary: true` call. Present only when {@link ErrorCodeResult.temporary}
 * is `true` — a successfully allocated, non-temporary code carries no reason.
 */
export type FallbackReason = FailureReason | 'requested';

/**
 * Result of {@link allocateErrorCode}, returned to the agent as JSON.
 */
export interface ErrorCodeResult {
  /** The allocated (or temporary) base number, as a string of digits. */
  code: string;
  /** `true` when `code` is a temporary/placeholder code rather than a real provider-issued base. */
  temporary: boolean;
  /** The provider id that produced `code`, or `null` for a temporary code issued before any provider was consulted (`requested`, `misconfigured` with no resolvable id). */
  provider: string | null;
  /** Why a temporary code was issued. Absent for a successful, non-temporary allocation. */
  fallback_reason?: FallbackReason;
  /** Free-text detail for the agent-facing message, always redacted. Absent when there is nothing to add beyond `fallback_reason`. */
  detail?: string;
  /** Milliseconds actually waited for a single throttled-retry backoff. Present only when a retry occurred. */
  waited_ms?: number;
  /** The resolved repository for the request's `cwd_path`, or `null` when none resolved. */
  repository: RepositoryInfo | null;
  /** `code` with `'01'` appended — the first component code a caller would use immediately. */
  first_component_code: string;
  /** Human-readable summary of the outcome. */
  message: string;
  /** What the agent should do next — e.g. add a `TEMPORARY ERROR CODE` marker, or check the GUI's Error Codes tab. */
  instruction: string;
}

/** Narrow façade over `temporary-codes.ts` — the allocator never needs `listTemporaryCodes` or the raw state directory. */
export interface TemporaryCodesDep {
  /** Issues and logs the next temporary code under `prefix`, combining it with the caller's own resolved context. */
  issue(prefix: string, entry: TemporaryCodeEntryInput): Promise<string>;
}

/**
 * Dependencies {@link allocateErrorCode} is injected with, for testability
 * with fakes — no real file I/O, network call or timer is exercised by the
 * allocator's own unit tests.
 */
export interface AllocatorDeps {
  loadConfig(): Promise<ErrorCodeConfig>;
  getProvider(id: string): ErrorCodeProvider | undefined;
  resolveRepositoryInfo(cwdPath: string): Promise<RepositoryInfo | null>;
  temporaryCodes: TemporaryCodesDep;
  /** Resolves after (approximately) `ms` milliseconds. Real wiring passes a `setTimeout`-backed sleep; tests pass a fake that resolves immediately. */
  sleep(ms: number): Promise<void>;
  /** Current time in milliseconds, used only to measure the actual elapsed time of a throttled retry's backoff for `waited_ms` — never to decide policy. */
  now(): number;
}

/** The minimum safe positive integer every provider-reported value must satisfy to be accepted as a real code. */
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Builds the final `message`/`instruction` pair for a successfully allocated (non-temporary) code. */
function successMessage(code: string): { message: string; instruction: string } {
  return {
    message: `Allocated error-code base ${code}.`,
    instruction: 'Use this as the base for the new class/module’s component codes, e.g. {base}01, {base}02, in the order they are introduced.',
  };
}

/** Builds the final `message`/`instruction` pair for a temporary/placeholder code. */
function temporaryMessage(code: string, reason: FallbackReason, detail: string | undefined): { message: string; instruction: string } {
  const why = detail !== undefined ? `: ${detail}` : '.';
  const message = `Issued temporary error-code base ${code} (${reason})${why}`;
  const instruction =
    reason === 'misconfigured'
      ? `Add a TEMPORARY ERROR CODE marker at the call site and report it, then check the GUI's Error Codes tab once the configuration is fixed, and call ledger_list_temporary_error_codes to replace this code with a real base later.`
      : `Add a TEMPORARY ERROR CODE marker at the call site and report it, then call ledger_list_temporary_error_codes to replace this code with a real base later.`;
  return { message, instruction };
}

/** Builds the `AllocationRequest` object passed to a provider's `allocate`/`peek` hooks. */
function buildAllocationRequest(
  input: AllocateErrorCodeInput,
  repository: RepositoryInfo | null
): AllocationRequest {
  return {
    request_id: randomUUID(),
    cwd_path: input.cwd_path ?? null,
    repository,
    context: input.context ?? null,
  };
}

/** Issues a temporary code and assembles the final {@link ErrorCodeResult}, with every text field already redacted. */
async function fallBackToTemporary(
  deps: AllocatorDeps,
  config: ErrorCodeConfig,
  repository: RepositoryInfo | null,
  context: string | null,
  providerId: string | null,
  reason: FallbackReason,
  rawDetail: string | undefined,
  secrets: readonly string[],
  waitedMs?: number
): Promise<ErrorCodeResult> {
  const detail = rawDetail !== undefined ? redact(rawDetail, secrets) : undefined;

  const code = await deps.temporaryCodes.issue(config.temporary_prefix, {
    provider: providerId,
    fallback_reason: reason,
    detail: detail ?? null,
    repository: repository !== null ? repository.folder_name : null,
    context,
  });

  const { message, instruction } = temporaryMessage(code, reason, detail);

  return {
    code,
    temporary: true,
    provider: providerId,
    fallback_reason: reason,
    ...(detail !== undefined ? { detail } : {}),
    ...(waitedMs !== undefined ? { waited_ms: waitedMs } : {}),
    repository,
    first_component_code: `${code}01`,
    message,
    instruction,
  };
}

/**
 * Turns an agent's request into an {@link ErrorCodeResult}. Never throws for
 * a provider, configuration or network failure — every one of those falls
 * back to a temporary code instead. The only way this rejects is an
 * underlying failure in the temporary-code store itself (disk full, lock
 * timeout, counter exhausted), which the caller (the MCP tool) turns into
 * an MCP error.
 *
 * Policy, in order:
 * 1. Load the config and resolve the repository info for `input.cwd_path`.
 * 2. `input.temporary: true` short-circuits straight to a temporary code
 *    (`requested`), without consulting a provider at all.
 * 3. Resolve the active provider and validate its stored settings. Either
 *    failure falls back as `misconfigured`, naming only the invalid setting
 *    keys, never their values.
 * 4. Call `allocate` with a `ProviderContext` (validated settings, an
 *    `AbortSignal.timeout(config.timeout_ms)`, a per-provider `data_dir`,
 *    and a redacting logger). A throw is `failed`+ambiguous; an abort is
 *    `unavailable`+ambiguous.
 * 5. Validate the outcome: a non-positive/non-safe-integer value becomes
 *    `invalid_response`; an unrecognised `reason` string is treated as
 *    `failed`.
 * 6. On `throttled`, wait once for `min(retry_after_ms ?? retry.default_wait_ms, retry.max_wait_ms)`
 *    and retry exactly once.
 * 7. An ambiguous failure, or a second `throttled`, or anything else,
 *    falls back to a temporary code — never retried twice.
 * 8. Every text field (`detail`, provider log lines) is passed through
 *    `redact()` with the active provider's configured secrets before
 *    leaving this function.
 */
export async function allocateErrorCode(
  input: AllocateErrorCodeInput,
  deps: AllocatorDeps
): Promise<ErrorCodeResult> {
  const config = await deps.loadConfig();
  const repository = input.cwd_path !== null ? await deps.resolveRepositoryInfo(input.cwd_path) : null;

  if (input.temporary === true) {
    return fallBackToTemporary(deps, config, repository, input.context, null, 'requested', undefined, []);
  }

  const provider = deps.getProvider(config.active_provider);
  if (provider === undefined) {
    return fallBackToTemporary(
      deps,
      config,
      repository,
      input.context,
      config.active_provider,
      'misconfigured',
      `provider '${config.active_provider}' is not installed or failed to load`,
      []
    );
  }

  const storedSettings = config.providers[provider.id] ?? {};
  const schema = buildSettingsSchema(provider.settings);
  const parsed = schema.safeParse(storedSettings);
  const secrets = parsed.success ? collectSecrets(provider.settings, parsed.data) : [];

  if (!parsed.success) {
    const invalidKeys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '(unknown)')))];
    return fallBackToTemporary(
      deps,
      config,
      repository,
      input.context,
      provider.id,
      'misconfigured',
      `settings invalid: ${invalidKeys.join(', ')}`,
      []
    );
  }

  const settings = parsed.data;
  const allocationRequest = buildAllocationRequest(input, repository);

  const firstAttempt = await callProvider(provider, allocationRequest, settings, config.timeout_ms, secrets);
  const firstValidated = validateOutcome(firstAttempt);

  if (firstValidated.ok) {
    const code = String(firstValidated.value);
    const { message, instruction } = successMessage(code);
    return {
      code,
      temporary: false,
      provider: provider.id,
      repository,
      first_component_code: `${code}01`,
      message,
      instruction,
    };
  }

  if (firstValidated.reason === 'throttled' && !firstValidated.ambiguous) {
    const waitMs = Math.min(
      firstValidated.retry_after_ms ?? config.retry.default_wait_ms,
      config.retry.max_wait_ms
    );

    const start = deps.now();
    await deps.sleep(waitMs);
    const waitedMs = deps.now() - start;

    const secondAttempt = await callProvider(provider, allocationRequest, settings, config.timeout_ms, secrets);
    const secondValidated = validateOutcome(secondAttempt);

    if (secondValidated.ok) {
      const code = String(secondValidated.value);
      const { message, instruction } = successMessage(code);
      return {
        code,
        temporary: false,
        provider: provider.id,
        waited_ms: waitedMs,
        repository,
        first_component_code: `${code}01`,
        message,
        instruction,
      };
    }

    return fallBackToTemporary(
      deps,
      config,
      repository,
      input.context,
      provider.id,
      secondValidated.reason,
      secondValidated.detail,
      secrets,
      waitedMs
    );
  }

  return fallBackToTemporary(
    deps,
    config,
    repository,
    input.context,
    provider.id,
    firstValidated.reason,
    firstValidated.detail,
    secrets
  );
}

/** Internal, normalised shape {@link validateOutcome} reduces every provider response (or throw/abort) to. */
type NormalisedOutcome =
  | { ok: true; value: number }
  | { ok: false; reason: FailureReason; ambiguous: boolean; retry_after_ms?: number; detail?: string };

/**
 * Calls `provider.allocate`, never letting a throw or an abort escape:
 * - A throw becomes `{ ok: false, reason: 'failed', ambiguous: true }`.
 * - `ctx.signal` aborting (the `AbortSignal.timeout`) becomes
 *   `{ ok: false, reason: 'unavailable', ambiguous: true }`.
 */
async function callProvider(
  provider: ErrorCodeProvider,
  request: AllocationRequest,
  settings: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  secrets: readonly string[]
): Promise<AllocationOutcome | { ok: false; reason: 'failed' | 'unavailable'; ambiguous: true; detail: string }> {
  const signal = AbortSignal.timeout(timeoutMs);
  const log = createRedactingLogger(provider.id, secrets);

  try {
    return await provider.allocate(request, { settings, signal, data_dir: resolveProviderDataDir(provider.id), log });
  } catch (error) {
    if (signal.aborted) {
      return { ok: false, reason: 'unavailable', ambiguous: true, detail: `provider '${provider.id}' timed out after ${timeoutMs}ms` };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: 'failed', ambiguous: true, detail: message };
  }
}

/** `~/.ai-insights/error-codes/data/{provider-id}/`, the scratch directory a provider's `ProviderContext.data_dir` points to. */
function resolveProviderDataDir(providerId: string): string {
  return `${resolveErrorCodesDir()}/data/${providerId}`;
}

/**
 * Validates a provider's raw outcome against the core's policy, reducing it
 * to a {@link NormalisedOutcome}:
 * - A successful outcome whose `value` is not a positive safe integer
 *   becomes `invalid_response` (never ambiguous — the provider definitely
 *   responded, just not usefully).
 * - An outcome reporting a `reason` outside {@link FailureReason}'s known
 *   values is treated as `failed`.
 * - Every other field (`ambiguous`, `retry_after_ms`, `detail`) passes
 *   through unchanged, defaulting `ambiguous` to `false` when absent.
 */
function validateOutcome(
  outcome: AllocationOutcome | { ok: false; reason: 'failed' | 'unavailable'; ambiguous: true; detail: string }
): NormalisedOutcome {
  if (outcome.ok) {
    if (!isPositiveSafeInteger(outcome.value)) {
      return { ok: false, reason: 'invalid_response', ambiguous: false, detail: `provider returned a non-positive or unsafe value: ${JSON.stringify(outcome.value)}` };
    }
    return { ok: true, value: outcome.value };
  }

  const knownReasons: readonly FailureReason[] = ['throttled', 'misconfigured', 'unavailable', 'rejected', 'invalid_response', 'failed'];
  const reason: FailureReason = (knownReasons as readonly string[]).includes(outcome.reason) ? outcome.reason : 'failed';
  const retryAfterMs = 'retry_after_ms' in outcome ? outcome.retry_after_ms : undefined;

  return {
    ok: false,
    reason,
    ambiguous: outcome.ambiguous ?? false,
    ...(retryAfterMs !== undefined ? { retry_after_ms: retryAfterMs } : {}),
    ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
  };
}
