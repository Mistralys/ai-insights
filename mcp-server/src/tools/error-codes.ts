import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { allocateErrorCode, type AllocatorDeps } from '../error-codes/allocator.js';
import { loadErrorCodeConfig } from '../error-codes/config-store.js';
import { getProvider } from '../error-codes/provider-registry.js';
import { resolveRepositoryInfo } from '../error-codes/project-info.js';
import { issueTemporaryCode, listTemporaryCodes } from '../error-codes/temporary-codes.js';
import { resolveErrorCodesDir } from '../storage/store-registry.js';

/**
 * Tools: ledger_generate_error_code, ledger_list_temporary_error_codes
 *
 * Exposes the pluggable error-code allocator (`../error-codes/allocator.js`)
 * and the temporary-code log (`../error-codes/temporary-codes.js`) to
 * agents, wired with real dependencies (the live provider registry, the
 * real filesystem-backed config/temporary-code stores, a real `setTimeout`
 * sleep and `Date.now()`). Every other MCP tool module in this directory
 * resolves a ledger project; these two do not — the allocator's state lives
 * under `~/.ai-insights/error-codes/`, keyed by the resolved repository
 * rather than by a ledger plan folder.
 */

/** A real, non-fake `setTimeout`-backed sleep — used only by the allocator's single throttled-retry backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Builds the real {@link AllocatorDeps} this server wires `allocateErrorCode` with — no fakes, no test doubles. */
function buildAllocatorDeps(): AllocatorDeps {
  return {
    loadConfig: loadErrorCodeConfig,
    getProvider,
    resolveRepositoryInfo,
    temporaryCodes: {
      issue: (prefix, entry) => issueTemporaryCode(resolveErrorCodesDir(), prefix, entry),
    },
    sleep,
    now: () => Date.now(),
  };
}

const GenerateErrorCodeSchema = z.object({
  cwd_path: z
    .string()
    .optional()
    .describe(
      'Your current workspace root directory, or a repository path. Passed through to repository resolution so a "file" provider in "repository" scope (and any plugin that scopes by repository) can key its sequence correctly. Omit only when no repository context applies.'
    ),
  context: z
    .string()
    .optional()
    .describe('Free text describing what the code is for, e.g. a class or namespace name. Stored alongside a temporary code and passed to the active provider; never required.'),
  temporary: z
    .boolean()
    .optional()
    .describe('Set to true to skip the active provider entirely and issue a temporary code directly (fallback_reason "requested"). Use when you need a placeholder immediately and will replace it later.'),
});

async function generateErrorCode(args: z.infer<typeof GenerateErrorCodeSchema>) {
  try {
    const result = await allocateErrorCode(
      {
        cwd_path: args.cwd_path ?? null,
        context: args.context ?? null,
        temporary: args.temporary,
      },
      buildAllocatorDeps()
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result),
        },
      ],
    };
  } catch (error) {
    // allocateErrorCode only ever rejects when the temporary-code store
    // itself fails (disk full, lock timeout, counter exhausted) — never for
    // a provider or configuration failure, which it falls back from
    // instead. This is therefore the one case that becomes an MCP error.
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error generating error code: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

const ListTemporaryErrorCodesSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe('When supplied, only entries whose context or repository contains this substring (case-sensitive) are returned. Omit to list every logged entry.'),
});

async function listTemporaryErrorCodes(args: z.infer<typeof ListTemporaryErrorCodesSchema>) {
  try {
    const entries = await listTemporaryCodes(resolveErrorCodesDir(), args.filter);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ entries }),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error listing temporary error codes: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * @internal — exported for unit testing only. Follows the `_internal` naming convention (§53).
 */
export const _internal = {
  generateErrorCode,
  listTemporaryErrorCodes,
  buildAllocatorDeps,
  GenerateErrorCodeSchema,
  ListTemporaryErrorCodesSchema,
};

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_generate_error_code',
    {
      description:
        'Allocate a new error-code base number through the configured provider (falls back to a temporary code on any failure). Optional params: cwd_path (for repository-scoped providers), context (free text), temporary (true to skip the provider and issue a temporary code directly). Returns an ErrorCodeResult as JSON; the result carries fallback_reason/detail/instruction when the code is temporary. An MCP error is returned only when the temporary-code store itself fails.',
      inputSchema: GenerateErrorCodeSchema,
    },
    generateErrorCode as any
  );

  server.registerTool(
    'ledger_list_temporary_error_codes',
    {
      description:
        'List logged temporary error codes issued by ledger_generate_error_code. Optional param: filter (substring match against context or repository). Use this to find temporary codes that still need replacing with a real provider-issued base.',
      inputSchema: ListTemporaryErrorCodesSchema,
    },
    listTemporaryErrorCodes as any
  );
}
