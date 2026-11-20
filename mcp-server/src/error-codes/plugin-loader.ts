import { readdir, readFile, stat } from 'fs/promises';
import type { Dirent } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { validateProvider } from './provider-validation.js';
import type { ErrorCodeProvider } from './provider-api.js';

/**
 * Discovers and loads third-party error-code providers from
 * `~/.ai-insights/plugins/error-codes/` (`resolveErrorCodePluginDir()`).
 *
 * The trust boundary for a plugin is the filesystem: installing one means
 * putting code at this path, the same trust level as `npm install`. The
 * GUI never writes to, or loads code from, an arbitrary path — only this
 * loader, scanning this one fixed directory, ever imports plugin code.
 *
 * Each top-level entry in the plugin directory is either:
 * - a `*.mjs` or `*.js` file whose default export is the provider; or
 * - a folder, so a plugin can carry its own `node_modules`. The entry
 *   module is the folder's `package.json` `main` field when present,
 *   otherwise `index.mjs`. This loader does **not** resolve `package.json`
 *   `exports` maps (conditions, subpaths) — a folder with neither `main`
 *   nor `index.mjs` is reported as a load error that says so, rather than
 *   partially re-implementing Node's resolver.
 *
 * A symbolic link in the plugin directory is followed: a link to a `*.mjs`
 * or `*.js` file, or to a folder, loads like the file or folder itself. The
 * extension check uses the link's own name, and the reported `path` stays the
 * link path (the name the user placed in the directory). A link whose target
 * is missing or unreadable (dangling, or a link loop) is recorded as a load
 * error rather than skipped silently. Following a link adds no trust: whoever
 * can write a link into this directory could write the code there directly.
 *
 * Each import is bounded by {@link PLUGIN_IMPORT_TIMEOUT_MS}. When a module
 * has not settled by then, the plugin is recorded as a load error and the scan
 * moves on, so one hanging plugin cannot block server startup indefinitely.
 * The budget is per plugin and the scan is sequential, so the worst-case
 * delay is (number of hanging plugins) x the timeout. A dynamic `import()`
 * cannot be cancelled: a timed-out module may keep evaluating in the
 * background, but it is never registered. A plugin that blocks the event loop
 * synchronously at the top level cannot be interrupted at all.
 *
 * Modules are imported through `pathToFileURL(path).href`, which is the
 * form Node's dynamic `import()` accepts correctly on Windows as well as
 * POSIX.
 *
 * A failing plugin — a syntax error, a thrown error during module
 * evaluation, an invalid provider shape, or an `id` clashing with another
 * plugin already loaded from this directory — is recorded in `errors` and
 * never thrown: one broken plugin never prevents the rest of the directory
 * from loading, and never prevents the server from starting. A missing
 * plugin directory yields no providers and no errors — this loader does
 * not treat "plugins are not installed" as a failure.
 *
 * This loader knows nothing of the built-in providers; a plugin `id` that
 * clashes with a built-in is accepted here and resolved by
 * `provider-registry.ts`, which owns that policy.
 */

/** A provider successfully loaded from the plugin directory, with the path it was loaded from. */
export interface LoadedPlugin {
  provider: ErrorCodeProvider;
  /** Absolute path to the plugin entry: the file itself, or the folder containing it. */
  path: string;
}

/** A single plugin load failure. `message` never carries stack trace text. */
export interface PluginLoadError {
  /** Absolute path to the plugin entry (file or folder) that failed to load. */
  source: string;
  message: string;
}

export interface LoadPluginProvidersResult {
  providers: LoadedPlugin[];
  errors: PluginLoadError[];
}

/** Default per-plugin budget, in milliseconds, for a plugin module's `import()` to settle. */
export const PLUGIN_IMPORT_TIMEOUT_MS = 10_000;

/** Optional settings for {@link loadPluginProviders}. */
export interface LoadPluginProvidersOptions {
  /** Per-plugin import timeout in milliseconds. Defaults to {@link PLUGIN_IMPORT_TIMEOUT_MS}. */
  importTimeoutMs?: number;
}

/** How a plugin directory entry is handled by the scan loop. */
type EntryKind = 'file' | 'directory' | 'dangling-link' | 'other';

/**
 * Classifies a directory entry, looking through symbolic links.
 * `stat` follows links, so a link is classified by its target; a failing
 * `stat` (missing target, or a link loop) yields `'dangling-link'`.
 */
async function classifyEntry(entry: Dirent, entryPath: string): Promise<EntryKind> {
  if (entry.isSymbolicLink()) {
    try {
      const target = await stat(entryPath);
      if (target.isFile()) return 'file';
      if (target.isDirectory()) return 'directory';
      return 'other';
    } catch {
      return 'dangling-link';
    }
  }
  if (entry.isFile()) return 'file';
  if (entry.isDirectory()) return 'directory';
  return 'other';
}

/**
 * Races `promise` against a timer. The timer is unref'd and always cleared,
 * so a fast import leaves no pending handle. The losing promise is given a
 * no-op rejection handler so a late failure is not reported as unhandled.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`import timed out after ${timeoutMs} ms`)), timeoutMs);
    timer.unref();
  });
  promise.catch(() => undefined);
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** `true` for an entry file this loader attempts to import directly: `*.mjs` or `*.js`. */
function isPluginFile(fileName: string): boolean {
  return fileName.endsWith('.mjs') || fileName.endsWith('.js');
}

/**
 * Resolves a folder plugin's entry module path.
 *
 * @returns The absolute entry module path, or `null` when the folder has
 *   neither a `package.json` `main` nor an `index.mjs`.
 */
async function resolveFolderEntryPath(folderPath: string): Promise<string | null> {
  const packageJsonPath = join(folderPath, 'package.json');
  try {
    const raw = await readFile(packageJsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'main' in parsed &&
      typeof (parsed as Record<string, unknown>).main === 'string' &&
      (parsed as Record<string, unknown>).main !== ''
    ) {
      return join(folderPath, (parsed as Record<string, unknown>).main as string);
    }
  } catch {
    // Missing/malformed package.json: fall through to the index.mjs check.
  }

  const indexPath = join(folderPath, 'index.mjs');
  try {
    await stat(indexPath);
    return indexPath;
  } catch {
    return null;
  }
}

/** Strips a thrown value down to a plain, stack-free message string. */
function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Imports `modulePath`, validates its default export as a provider, and
 * records the outcome into `providers`/`errors`. `source` is the path
 * reported in any error (the plugin's own file or folder, not necessarily
 * `modulePath` for a folder plugin).
 */
async function loadOneModule(
  modulePath: string,
  source: string,
  providers: LoadedPlugin[],
  errors: PluginLoadError[],
  importTimeoutMs: number
): Promise<void> {
  let moduleExports: unknown;
  try {
    moduleExports = await withTimeout(import(pathToFileURL(modulePath).href), importTimeoutMs);
  } catch (error) {
    const message = messageOf(error);
    errors.push({
      source,
      message: message.startsWith('import timed out') ? message : `failed to import plugin: ${message}`,
    });
    return;
  }

  const candidate =
    moduleExports !== null && typeof moduleExports === 'object' && 'default' in moduleExports
      ? (moduleExports as { default: unknown }).default
      : undefined;

  const result = validateProvider(candidate);
  if (!result.ok) {
    errors.push({ source, message: `invalid provider: ${result.errors.join('; ')}` });
    return;
  }

  const clash = providers.find((p) => p.provider.id === result.provider.id);
  if (clash !== undefined) {
    errors.push({
      source,
      message: `id '${result.provider.id}' clashes with a provider already loaded from ${clash.path} and was ignored`,
    });
    return;
  }

  providers.push({ provider: result.provider, path: source });
}

/**
 * Scans `pluginDir` and loads every discovered provider.
 *
 * @param pluginDir - Absolute path to the plugin directory, normally
 *   `resolveErrorCodePluginDir()`.
 * @param options - Optional settings; `importTimeoutMs` overrides the
 *   per-plugin import timeout (used by tests).
 */
export async function loadPluginProviders(
  pluginDir: string,
  options: LoadPluginProvidersOptions = {}
): Promise<LoadPluginProvidersResult> {
  const importTimeoutMs = options.importTimeoutMs ?? PLUGIN_IMPORT_TIMEOUT_MS;
  const providers: LoadedPlugin[] = [];
  const errors: PluginLoadError[] = [];

  let entries;
  try {
    entries = await readdir(pluginDir, { withFileTypes: true });
  } catch {
    // Missing plugin directory: no providers, no errors.
    return { providers: [], errors: [] };
  }

  for (const entry of entries) {
    const entryPath = join(pluginDir, entry.name);

    switch (await classifyEntry(entry, entryPath)) {
      case 'file':
        if (isPluginFile(entry.name)) {
          await loadOneModule(entryPath, entryPath, providers, errors, importTimeoutMs);
        }
        break;
      case 'directory': {
        const resolvedEntry = await resolveFolderEntryPath(entryPath);
        if (resolvedEntry === null) {
          errors.push({
            source: entryPath,
            message: `folder plugin has neither a package.json "main" nor an index.mjs entry file`,
          });
          break;
        }
        await loadOneModule(resolvedEntry, entryPath, providers, errors, importTimeoutMs);
        break;
      }
      case 'dangling-link':
        errors.push({ source: entryPath, message: 'symbolic link target is missing or unreadable' });
        break;
      default:
        break;
    }
  }

  return { providers, errors };
}
