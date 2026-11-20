/**
 * The single owner of secret redaction for the error-code allocator.
 *
 * Plain functions, no state. Lives in its own module (not inside
 * `settings-schema.ts`) because the plugin loader and the provider
 * registry need to redact log/error text without needing Zod or the
 * settings-descriptor logic, and any future secret-handling code path can
 * import `redact`/`createRedactingLogger` on its own.
 */

/** The literal substituted for every matched secret occurrence. */
const REDACTED_PLACEHOLDER = '[REDACTED]';

/** Escapes every regex metacharacter in `value`, so it can be used as a literal match inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces every occurrence of each non-empty secret in `text` with
 * `[REDACTED]`.
 *
 * - Secrets are matched literally — any regex metacharacters they contain
 *   (`.`, `*`, `(`, etc.) are escaped first, so a secret is never
 *   accidentally treated as a pattern.
 * - Secrets are replaced longest-first, so a secret that is a substring of
 *   another (e.g. `"ab"` inside `"abc123"`) never partially exposes the
 *   longer one by being redacted out from under it first.
 * - Empty or whitespace-only secrets are ignored (never matched), so an
 *   unset/blank settings field cannot blank out unrelated text.
 *
 * @param text - The text to redact. Returned unchanged when `secrets` is empty.
 * @param secrets - Secret values to redact, in any order.
 */
export function redact(text: string, secrets: readonly string[]): string {
  const nonEmpty = secrets.filter((s) => s.trim().length > 0);
  if (nonEmpty.length === 0) {
    return text;
  }

  // Longest first, so a secret contained within a longer one never gets
  // partially redacted by the shorter match running first.
  const ordered = [...nonEmpty].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(ordered.map(escapeRegExp).join('|'), 'g');

  return text.replace(pattern, REDACTED_PLACEHOLDER);
}

/** The logger shape handed to providers as `ctx.log` (see `provider-api.ts`), and used internally by the allocator, registry and loader. */
export interface RedactingLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

/**
 * Creates a `{ info, warn }` logger that writes `[{prefix}] {message}` to
 * stderr only, passing every message through {@link redact} first.
 *
 * Writing to stderr only (never stdout) matches the rest of the server's
 * logging convention, keeping stdout clean for the MCP JSON-RPC stream.
 *
 * @param prefix - Short identifying prefix, e.g. a provider id or module name.
 * @param secrets - Secret values redacted from every message written through this logger.
 */
export function createRedactingLogger(prefix: string, secrets: readonly string[]): RedactingLogger {
  const write = (msg: string): void => {
    process.stderr.write(`[${prefix}] ${redact(msg, secrets)}\n`);
  };

  return {
    info: write,
    warn: write,
  };
}
