import { loadPluginProviders } from './plugin-loader.js';
import { fileProvider } from './providers/file-provider.js';
import { errorcodeIncrementorProvider } from './providers/errorcode-incrementor-provider.js';
import type { ErrorCodeProvider } from './provider-api.js';

/**
 * The built-in error-code providers, in registration order. A built-in
 * always wins over a plugin declaring the same `id` (see
 * {@link initProviderRegistry}).
 */
export const BUILTIN_PROVIDERS: ErrorCodeProvider[] = [fileProvider, errorcodeIncrementorProvider];

/** A single entry in the registry: a provider plus where it came from. */
export interface ProviderRegistryEntry {
  provider: ErrorCodeProvider;
  source: 'builtin' | 'plugin';
  /** Absolute path to the plugin's file or folder. Present only for `source: 'plugin'`. */
  path?: string;
}

/** A load failure surfaced by the most recent {@link initProviderRegistry} call. */
export interface ProviderLoadError {
  source: string;
  message: string;
}

/**
 * Holds the registry built by the most recent {@link initProviderRegistry}
 * call, in this process. Module-level state is intentional here: both the
 * MCP server and the GUI server call `initProviderRegistry()` once at their
 * own startup, and every later `getProvider`/`listProviders` call in that
 * process reads the result of that process's own scan.
 */
let registry: Map<string, ProviderRegistryEntry> = new Map();
let errors: ProviderLoadError[] = [];

/**
 * Builds (or rebuilds) the provider registry for this process: every
 * built-in provider, plus every provider discovered under `pluginDir`
 * (`loadPluginProviders`) that does not clash with a built-in `id`.
 *
 * A plugin `id` that clashes with a built-in is rejected and recorded as a
 * load error — the built-in keeps working under that id. A plugin `id`
 * clash with another plugin is already resolved by `loadPluginProviders`
 * itself (see that module's docblock); this function never sees the loser.
 *
 * Safe to call more than once per process: each call replaces the whole
 * registry and error list with a freshly built one, rather than
 * accumulating into the previous state, so a repeated call never produces
 * duplicate entries.
 *
 * @param options.pluginDir - Absolute path to the plugin directory, normally `resolveErrorCodePluginDir()`.
 */
export async function initProviderRegistry(options: { pluginDir: string }): Promise<void> {
  const nextRegistry = new Map<string, ProviderRegistryEntry>();
  const nextErrors: ProviderLoadError[] = [];

  for (const provider of BUILTIN_PROVIDERS) {
    nextRegistry.set(provider.id, { provider, source: 'builtin' });
  }

  const pluginResult = await loadPluginProviders(options.pluginDir);
  nextErrors.push(...pluginResult.errors);

  for (const loaded of pluginResult.providers) {
    if (nextRegistry.has(loaded.provider.id)) {
      nextErrors.push({
        source: loaded.path,
        message: `plugin id '${loaded.provider.id}' clashes with a built-in provider and was ignored`,
      });
      continue;
    }
    nextRegistry.set(loaded.provider.id, {
      provider: loaded.provider,
      source: 'plugin',
      path: loaded.path,
    });
  }

  registry = nextRegistry;
  errors = nextErrors;
}

/** Returns the provider registered under `id`, or `undefined` when none is. */
export function getProvider(id: string): ErrorCodeProvider | undefined {
  return registry.get(id)?.provider;
}

/** Lists every registered provider entry, built-ins and plugins alike. */
export function listProviders(): ProviderRegistryEntry[] {
  return Array.from(registry.values());
}

/** Lists every load error recorded by the most recent {@link initProviderRegistry} call. */
export function listProviderLoadErrors(): ProviderLoadError[] {
  return errors;
}
