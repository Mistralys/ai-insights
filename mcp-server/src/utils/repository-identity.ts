/**
 * Repository identity resolution.
 *
 * Gives `ledger_get_repository_context` (and any future consumer) a single,
 * three-tier precedence contract for turning caller-supplied input into a
 * concrete repository identity:
 *
 * 1. **explicit** — the caller passed `repository_name` directly.
 * 2. **declared** — `cwd_path` resolves (via `findProjectRoot()`) to a
 *    project carrying a `.ledger/settings.json` declaration, whose
 *    `repository_id` is looked up by id across every configured store
 *    (`findEntryInStores()`).
 * 3. **derived** — neither of the above applied; the repository name is
 *    derived from `cwd_path` via `deriveRepoNameFromCwd()`, exactly as
 *    `ledger_get_repository_context` did before this module existed.
 *
 * The declared tier never falls back to the derived tier on a lookup
 * failure — a declared `repository_id` that matches no entry in any store,
 * or a malformed declaration, is always reported as an error. Silently
 * falling back would risk binding a project to a *different* repository's
 * strategic vision (see the plan's Rejected Approaches for this WP).
 */

import {
  findProjectRoot,
  loadProjectDeclaration,
  type ProjectDeclarationResult,
} from '../storage/project-declaration.js';
import { findEntryInStores } from '../storage/repository-lookup.js';
import { getStoreRouter, isStoreContextInitialized } from '../storage/store-context.js';
import { deriveRepoNameFromCwd, resolveLedgerRoot } from './ledger-root.js';
import type { ProjectSettings } from '../schema/project-declaration.js';
import type { RepositoryEntry } from '../schema/repository-registry.js';

/** Which resolution tier produced a {@link ResolvedIdentity}. */
export type IdentitySource = 'explicit' | 'declared' | 'derived';

/**
 * Declaration context captured only when `source === 'declared'`. Carries
 * everything a caller needs to act on the declared project (e.g. compute
 * the `mirror` field) without re-deriving it.
 */
export interface DeclaredIdentity {
  /** Absolute path to the project root containing `.ledger/`. */
  projectRoot: string;
  /** The project's merged declaration settings. */
  settings: ProjectSettings;
  /** The matched registry entry (looked up by `settings.repository_id`). */
  entry: RepositoryEntry;
  /** Absolute path to the store whose registry contained the matched entry. */
  storePath: string;
}

/** The result of a successful {@link resolveRepositoryIdentity} call. */
export interface ResolvedIdentity {
  repositoryName: string;
  source: IdentitySource;
  /** Present only when `source === 'declared'`; `null` for every other tier. */
  declaration: DeclaredIdentity | null;
}

/**
 * Discriminated-union result of {@link resolveRepositoryIdentity}, mirroring
 * the `{ kind, ... }` style already established by
 * `loadProjectDeclaration()`'s `ProjectDeclarationResult` and
 * `resolveOutputPath()`'s `ResolvedOutputPath`, so callers branch on `kind`
 * rather than on thrown exceptions for an expected, user-triggerable
 * rejection class (an unresolvable declared `repository_id`, or an invalid
 * declaration file).
 */
export type ResolveRepositoryIdentityResult =
  | { kind: 'ok'; identity: ResolvedIdentity }
  | { kind: 'error'; message: string };

/**
 * Resolves a repository identity in explicit → declared → derived
 * precedence order.
 *
 * - `explicitName` set → `source: 'explicit'`, `declaration: null`. Neither
 *   `cwdPath` nor the filesystem is consulted.
 * - `explicitName` absent, `cwdPath` set → walks ancestors from `cwdPath`
 *   via `findProjectRoot()`. When a declaration is found:
 *   - `{ kind: 'declared' }` → looks `settings.repository_id` up across every
 *     configured store via `findEntryInStores()`. A match yields
 *     `source: 'declared'` with `repositoryName` set to the matched entry's
 *     `id` (guaranteed slug-safe, unlike `folder_names`, which may not be).
 *     No match yields `{ kind: 'error' }` naming the id and every store
 *     searched — **no fallback to the derived tier**.
 *   - `{ kind: 'invalid' }` (malformed JSON, schema failure, or a
 *     `settings.local.json` carrying `repository_id`) also yields
 *     `{ kind: 'error' }` rather than silently falling back — a malformed
 *     hand-authored declaration is always a mistake that must surface to the
 *     caller (see `loadProjectDeclaration()`'s doc comment).
 *   - `{ kind: 'not_declared' }`, or no project root found at all, falls
 *     through to the derived tier below.
 * - Otherwise → `source: 'derived'`, `repositoryName` from
 *   `deriveRepoNameFromCwd(cwdPath)` — behaviour-identical to the inline
 *   synthetic-plan-path expression this module replaces (AC-18b).
 * - Neither `explicitName` nor `cwdPath` provided → `{ kind: 'error' }`,
 *   matching the tool's pre-existing validation message.
 *
 * @param cwdPath - Absolute path to the workspace root directory, or
 *   `undefined` when the caller supplied `explicitName` instead.
 * @param explicitName - Explicit repository name override, or `undefined`
 *   to resolve through the declared/derived tiers.
 */
export async function resolveRepositoryIdentity(
  cwdPath: string | undefined,
  explicitName: string | undefined
): Promise<ResolveRepositoryIdentityResult> {
  if (explicitName) {
    return {
      kind: 'ok',
      identity: { repositoryName: explicitName, source: 'explicit', declaration: null },
    };
  }

  if (!cwdPath) {
    return {
      kind: 'error',
      message: 'Either cwd_path or repository_name must be provided.',
    };
  }

  const projectRoot = await findProjectRoot(cwdPath);
  if (projectRoot !== null) {
    const declResult: ProjectDeclarationResult = await loadProjectDeclaration(projectRoot);

    if (declResult.kind === 'invalid') {
      return {
        kind: 'error',
        message:
          `Project declaration at '${projectRoot}/.ledger/' is invalid: ` +
          declResult.errors.join('; '),
      };
    }

    if (declResult.kind === 'declared') {
      const repoId = declResult.settings.repository_id;
      const ledgerRoot = resolveLedgerRoot();
      const found = await findEntryInStores(ledgerRoot, repoId);

      if (found === null) {
        const storesSearched =
          isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()
            ? getStoreRouter().getAllStorePaths()
            : [ledgerRoot];
        return {
          kind: 'error',
          message:
            `Declared repository_id '${repoId}' (from '${projectRoot}/.ledger/settings.json') ` +
            `was not found in any configured store. Searched: ${storesSearched.join(', ')}.`,
        };
      }

      return {
        kind: 'ok',
        identity: {
          repositoryName: found.entry.id,
          source: 'declared',
          declaration: {
            projectRoot,
            settings: declResult.settings,
            entry: found.entry,
            storePath: found.storePath,
          },
        },
      };
    }

    // declResult.kind === 'not_declared' — fall through to the derived tier.
  }

  return {
    kind: 'ok',
    identity: { repositoryName: deriveRepoNameFromCwd(cwdPath), source: 'derived', declaration: null },
  };
}
