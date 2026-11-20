/**
 * The error-code provider contract.
 *
 * This is the only module a provider depends on, conceptually. Plugins are
 * plain ESM and import nothing from the server; these types ARE the
 * documentation. The built-in providers (`providers/file-provider.ts`,
 * `providers/errorcode-incrementor-provider.ts`) import only from this
 * file, so the contract is proven sufficient by its own built-ins.
 *
 * ## Stability rules (`apiVersion: 1`)
 *
 * - Within `apiVersion: 1`, every change is **additive**: new optional
 *   request fields, context members, provider hooks, and setting-field
 *   types. Nothing required is ever added, and nothing is ever removed or
 *   renamed.
 * - An optional hook is detected by its presence
 *   (`typeof provider.peek === 'function'`). The contract deliberately
 *   ships no `capabilities` bag and no `ctx.api_version`: the first would
 *   duplicate what hook presence already says, and the provider already
 *   declares its own `apiVersion`. Either can be added later as an
 *   optional member without a version bump, once a capability exists that
 *   hook presence cannot express.
 * - Providers MUST ignore unknown request and context fields — a future
 *   additive field must never break an existing provider that does not
 *   read it.
 * - The core treats unknown outcome `reason`s as `failed`, and ignores
 *   unknown provider properties.
 * - The failure taxonomy ({@link FailureReason}) is deliberately coarse. It
 *   encodes only what the core's retry/fallback policy needs: wait and
 *   retry, fix the configuration, or fall back. Provider-specific nuance
 *   belongs in `detail`, never in a new reason value.
 * - A breaking change requires `apiVersion: 2`. The core then keeps loading
 *   `apiVersion: 1` providers through an adapter.
 *   {@link SUPPORTED_PROVIDER_API_VERSIONS} lists what the core currently
 *   accepts.
 */

/** The current provider contract version implemented by this module. */
export const PROVIDER_API_VERSION = 1 as const;

/**
 * Every `apiVersion` the core currently accepts from a provider. Used by
 * `provider-validation.ts` to reject providers declaring an unsupported
 * version instead of silently misbehaving.
 */
export const SUPPORTED_PROVIDER_API_VERSIONS: readonly number[] = [
  PROVIDER_API_VERSION,
];

/**
 * A single error-code provider: built-in or loaded from
 * `~/.ai-insights/plugins/error-codes/`.
 *
 * `allocate` is the only required method. `peek` and `test` are optional
 * hooks — their presence on the object IS the capability; there is no
 * separate capability flag (see the module docblock's stability rules).
 */
export interface ErrorCodeProvider {
  /** Contract version this provider was written against. Currently always `1`. */
  apiVersion: 1;
  /**
   * Unique identifier. Must match `/^[a-z][a-z0-9-]{1,47}$/`. Used as the
   * config key under `providers.<id>` and as the `active_provider` value.
   */
  id: string;
  /** Human-readable display name shown in the GUI's provider selector. */
  label: string;
  /** Optional longer description shown in the GUI, e.g. a link to the backing service. */
  description?: string;
  /**
   * Declarative settings descriptors. Drives runtime validation
   * (`settings-schema.ts`), the GUI's generated settings form, and secret
   * handling — a provider never writes GUI code.
   */
  settings: SettingField[];
  /**
   * Allocates and returns the next error-code base number. Called with a
   * validated, read-only settings object and a core-owned context. MUST
   * ignore unknown fields on `request` and `ctx`.
   */
  allocate(
    request: AllocationRequest,
    ctx: ProviderContext
  ): Promise<AllocationOutcome>;
  /**
   * Optional: returns the current value without consuming/incrementing it.
   * When absent, the core's "Test connection" flow falls back to `test`,
   * and finally reports that the provider offers no connection test.
   */
  peek?(request: AllocationRequest, ctx: ProviderContext): Promise<AllocationOutcome>;
  /**
   * Optional: a lightweight connectivity/credentials check used by the
   * GUI's "Test connection" button. When absent, the core falls back to
   * `peek`.
   */
  test?(ctx: ProviderContext): Promise<TestOutcome>;
}

/**
 * A declarative settings field. One entry drives three things at once:
 * runtime Zod validation (`settings-schema.ts`), the GUI's generated form
 * control, and — for `type: 'secret'` — redaction and `{ set: boolean }`
 * rendering instead of the raw value.
 */
export type SettingField =
  | {
      key: string;
      label: string;
      type: 'string' | 'url' | 'path';
      required?: boolean;
      default?: string;
      description?: string;
      placeholder?: string;
    }
  | {
      key: string;
      label: string;
      type: 'secret';
      required?: boolean;
      description?: string;
    }
  | {
      key: string;
      label: string;
      type: 'integer';
      required?: boolean;
      default?: number;
      min?: number;
      max?: number;
      description?: string;
    }
  | {
      key: string;
      label: string;
      type: 'boolean';
      default?: boolean;
      description?: string;
    }
  | {
      key: string;
      label: string;
      type: 'select';
      options: { value: string; label: string }[];
      default?: string;
      description?: string;
    };

/**
 * Request passed to `allocate`/`peek`. Provided by the core from the
 * agent's tool call; providers MUST ignore unknown fields so a future
 * additive field never breaks an existing provider.
 */
export interface AllocationRequest {
  /** UUID, unique per call. For provider-side logging/idempotency only — never used by the core to detect duplicates. */
  request_id: string;
  /** As supplied by the agent, or `null` when omitted. */
  cwd_path: string | null;
  /** Resolved repository info for `cwd_path`, or `null` when none resolves. */
  repository: RepositoryInfo | null;
  /** Free text from the agent, e.g. a class or namespace name. `null` when omitted. */
  context: string | null;
}

/**
 * Identifies the MAIN repository root for a resolved `cwd_path`. Every
 * linked worktree of one repository resolves to the same values (see
 * `project-info.ts`), so a provider scoping by repository never splits one
 * repository's sequence across its worktrees.
 */
export interface RepositoryInfo {
  root_path: string;
  folder_name: string;
  package_name: string | null;
}

/**
 * Core-owned context passed to every provider hook alongside the request.
 */
export interface ProviderContext {
  /** This provider's settings, already validated against its `settings` descriptors. Secrets are included in plain text — never log or echo this object directly. */
  settings: Readonly<Record<string, unknown>>;
  /** Aborts when the core-owned allocation timeout elapses. Providers should pass this to any I/O they perform (e.g. `fetch(url, { signal })`). */
  signal: AbortSignal;
  /** `~/.ai-insights/error-codes/data/{provider-id}/`, created on demand. Scratch space for a provider's own persisted state (e.g. the `file` provider's counters). */
  data_dir: string;
  /** Stderr-only logger. Every message is redacted of the provider's configured secrets before it is written — safe to log settings-derived text directly. */
  log: {
    info(msg: string): void;
    warn(msg: string): void;
  };
}

/**
 * Result of `allocate`/`peek`: either a freshly allocated/peeked integer, or
 * a coarse failure the core's retry/fallback policy can act on.
 */
export type AllocationOutcome =
  | { ok: true; value: number }
  | {
      ok: false;
      reason: FailureReason;
      /** `true` when the provider cannot say whether the underlying operation actually completed (e.g. a network timeout after the request was sent). The core never retries an ambiguous failure — it falls back to a temporary code instead, to avoid issuing two codes for one request. */
      ambiguous?: boolean;
      /** Present only for `reason: 'throttled'`. The core waits `min(retry_after_ms, retry.max_wait_ms)` once, then retries once. */
      retry_after_ms?: number;
      /** Free-text detail for logs and the agent-facing message. Always passed through `redact()` before leaving the core — never put a raw secret here on purpose, but the core will catch it if you do. */
      detail?: string;
    };

/**
 * Coarse failure taxonomy. Deliberately small — see the module docblock's
 * stability rules for why a fine-grained enum is rejected.
 *
 * - `throttled`: back off and retry once (see `retry_after_ms`).
 * - `misconfigured`: the provider's settings are wrong; never retried.
 * - `unavailable`: the backend could not be reached (network/DNS/5xx); set `ambiguous` based on whether the request may have landed.
 * - `rejected`: the backend explicitly refused the request for a reason that is not `misconfigured`.
 * - `invalid_response`: the backend responded, but not in the shape the provider expects.
 * - `failed`: anything else, including an uncaught throw from the provider.
 */
export type FailureReason =
  | 'throttled'
  | 'misconfigured'
  | 'unavailable'
  | 'rejected'
  | 'invalid_response'
  | 'failed';

/** Result of the optional `test` hook (or the `peek` fallback used for the same purpose). */
export type TestOutcome =
  | { ok: true; detail?: string; value?: number }
  | { ok: false; reason: FailureReason; detail?: string };
