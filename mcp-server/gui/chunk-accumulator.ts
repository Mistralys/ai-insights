/**
 * chunk-accumulator.ts — Shared accumulation layer for JSONL chunk parsing and merging.
 *
 * This module contains the types, JSONL parsing functions, chunk-merging functions,
 * namespace helpers, and the `accumulateChunks()` function that transforms raw JSONL
 * chunk records into merged messages grouped by namespace.
 *
 * It is consumed exclusively by `chunk-renderer.ts`, which builds the rendering layer
 * on top of the accumulated message maps.
 *
 * JSONL format (chunk_format: 1)
 * --------------------------------
 * Line 0 (header):
 *   {"chunk_format": 1, "stream_mode": "messages", "langgraph_stream_version": "v2"}
 *
 * Lines 1-N (chunks):
 *   Each chunk represents one streaming event and can arrive in either of two
 *   wire shapes — both are parsed identically:
 *
 *   Object shape (default Python serialisation):
 *     {"ns": namespace, "msg": AIMessageChunk.model_dump(), "metadata": {...}}
 *
 *   Array shape (tuple serialisation):
 *     [namespace, AIMessageChunk.model_dump(), metadata]
 *
 *   In both shapes, `namespace` is an array of strings (e.g. [] for the main
 *   agent or ["subgraph_name", "node_name"] for sub-agents).  The two shapes
 *   are fully interchangeable; `parseChunkLine()` normalises them to a common
 *   internal representation before any further processing.
 *
 * Merge semantics
 * ---------------
 * LangGraph streams `AIMessageChunk` objects — one per token / tool-call fragment.
 * Chunks sharing the same `id` field belong to the same logical message.  We
 * accumulate them in order and merge fields as follows:
 *   - `content`:    if string, concatenate; if list, merge by index/id
 *   - `tool_calls`: accumulate by index; merge `name`, `args` (string-concat), `id`
 *   - `usage_metadata`: sum numeric fields (input_tokens, output_tokens, …)
 *
 * Pure data transformation: no I/O, no side effects, no imports from
 * `mcp-server/src/`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw JSON value accepted in chunk payloads. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** A single tool-call fragment as it appears in an AIMessageChunk. */
export interface ToolCallChunk {
  /** Numeric index (used when merging multi-fragment tool calls). */
  index?: number;
  /** Tool call id (set on the first fragment). */
  id?: string | null;
  /** Tool name (set on the first fragment). */
  name?: string | null;
  /** Partial JSON-encoded args string. */
  args?: string | null;
}

/** Accumulated tool-call state keyed by index. */
export interface MergedToolCall {
  id: string;
  name: string;
  /** Accumulated JSON-encoded args string — may be partial if chunks are malformed. */
  args: string;
}

/** Content block from an AIMessageChunk / AIMessage. */
export interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: JsonValue | undefined;
}

/** Merged/reconstructed message ready for rendering. */
export interface MergedMessage {
  /** LangChain message type: "ai", "human", "tool", "system", … */
  type: string;
  /** Message ID (for grouping chunks). */
  id: string;
  /** Reconstructed text or list-of-block content. */
  content: string | ContentBlock[];
  /** Merged tool calls (AI messages only). */
  tool_calls: MergedToolCall[];
  /** Aggregated token usage metadata. */
  usage_metadata: Record<string, number>;
  /** Tool message correlation id. */
  tool_call_id?: string;
}

/** Namespace key: empty string for the main agent, "subgraph/node" for sub-agents. */
export type NamespaceKey = string;

// ---------------------------------------------------------------------------
// Internal helpers — chunk merging
// ---------------------------------------------------------------------------

/**
 * Extracts a stable string id from a chunk payload.
 * LangChain's `AIMessageChunk.model_dump()` places the message id in the
 * top-level `id` field.  Falls back to an empty string when absent.
 */
export function chunkId(chunk: Record<string, JsonValue>): string {
  return typeof chunk['id'] === 'string' ? chunk['id'] : '';
}

/**
 * Returns the message type from a chunk payload.
 * LangChain's message dumps use the `type` field (e.g. "AIMessageChunk").
 */
export function chunkType(chunk: Record<string, JsonValue>): string {
  return typeof chunk['type'] === 'string' ? chunk['type'] : 'ai';
}

/**
 * Merges a new content value into an existing accumulated content value.
 * Both string-concatenation (token streaming) and block-list merging are
 * supported.
 */
export function mergeContent(
  acc: string | ContentBlock[],
  incoming: string | ContentBlock[] | null | undefined,
): string | ContentBlock[] {
  if (incoming === null || incoming === undefined) return acc;

  // String + string → concatenate.
  if (typeof acc === 'string' && typeof incoming === 'string') {
    return acc + incoming;
  }

  // Array + array → merge blocks by index or by id.
  if (Array.isArray(acc) && Array.isArray(incoming)) {
    const result: ContentBlock[] = [...acc];
    for (let i = 0; i < incoming.length; i++) {
      const block = incoming[i];
      if (!block) continue;
      if (i < result.length && result[i]) {
        const existing = result[i]!;
        if (existing.type === 'text' && block.type === 'text') {
          result[i] = { ...existing, text: (existing.text ?? '') + (block.text ?? '') };
        } else {
          result[i] = { ...existing, ...block };
        }
      } else {
        result.push({ ...block });
      }
    }
    return result;
  }

  // String + array → upgrade accumulator to array, reprocess.
  if (typeof acc === 'string' && Array.isArray(incoming)) {
    const upgraded: ContentBlock[] = acc ? [{ type: 'text', text: acc }] : [];
    return mergeContent(upgraded, incoming);
  }

  // Array + string → append as text block.
  if (Array.isArray(acc) && typeof incoming === 'string') {
    if (!incoming) return acc;
    return [...acc, { type: 'text', text: incoming }];
  }

  return acc;
}

/**
 * Merges a `tool_call_chunks` array from a new chunk into the accumulated
 * tool-calls map (keyed by integer index).
 */
export function mergeToolCallChunks(
  acc: Map<number, MergedToolCall>,
  chunks: ToolCallChunk[],
): void {
  for (const tc of chunks) {
    const idx = typeof tc.index === 'number' ? tc.index : 0;
    const existing = acc.get(idx);
    if (!existing) {
      acc.set(idx, {
        id: tc.id ?? '',
        name: tc.name ?? '',
        args: tc.args ?? '',
      });
    } else {
      acc.set(idx, {
        id: existing.id || (tc.id ?? ''),
        name: existing.name || (tc.name ?? ''),
        args: existing.args + (tc.args ?? ''),
      });
    }
  }
}

/**
 * Merges usage_metadata from a new chunk into the accumulator.
 */
export function mergeUsageMetadata(
  acc: Record<string, number>,
  incoming: Record<string, number> | null | undefined,
): Record<string, number> {
  if (!incoming) return acc;
  const result: Record<string, number> = { ...acc };
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === 'number') {
      result[key] = (result[key] ?? 0) + value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers — JSONL parsing
// ---------------------------------------------------------------------------

/**
 * Validates that the first JSONL line is a valid chunk_format:1 header.
 */
export function isValidHeader(line: string): boolean {
  try {
    const obj = JSON.parse(line);
    return obj !== null
      && typeof obj === 'object'
      && !Array.isArray(obj)
      && obj.chunk_format === 1;
  } catch {
    return false;
  }
}

/**
 * Parses a single JSONL data line.
 *
 * The Python side writes each chunk as:
 *   json.dumps({"ns": ns, "msg": msg.model_dump(), "metadata": metadata})
 *
 * or equivalently as a tuple/array:
 *   json.dumps([ns, msg.model_dump(), metadata])
 *
 * Both shapes are accepted.  Returns null on parse errors or unrecognised
 * shapes (the caller skips null lines gracefully).
 */
export function parseChunkLine(line: string): {
  namespace: string[];
  msg: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  // Array shape: [namespace, msg_dump, metadata]
  if (Array.isArray(parsed)) {
    const [ns, msg, meta] = parsed as [unknown, unknown, unknown];
    if (!Array.isArray(ns)) return null;
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
    return {
      namespace: ns.filter((n): n is string => typeof n === 'string'),
      msg: msg as Record<string, JsonValue>,
      metadata: (meta && typeof meta === 'object' && !Array.isArray(meta))
        ? meta as Record<string, JsonValue>
        : {},
    };
  }

  // Object shape: {ns, msg, metadata}
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const ns = obj['ns'];
    const msg = obj['msg'];
    const meta = obj['metadata'];
    if (!Array.isArray(ns)) return null;
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
    return {
      namespace: ns.filter((n): n is string => typeof n === 'string'),
      msg: msg as Record<string, JsonValue>,
      metadata: (meta && typeof meta === 'object' && !Array.isArray(meta))
        ? meta as Record<string, JsonValue>
        : {},
    };
  }

  return null;
}

/**
 * Converts a raw namespace array to a display key.
 * An empty array → "" (main agent); otherwise → joined string.
 */
export function namespaceKey(ns: string[]): NamespaceKey {
  return ns.join('/');
}

/**
 * Returns a human-readable label for a namespace key.
 */
export function namespaceLabel(key: NamespaceKey): string {
  return key === '' ? 'Main Agent' : key;
}

// ---------------------------------------------------------------------------
// Core accumulation logic
// ---------------------------------------------------------------------------

/**
 * Accumulates a sequence of parsed chunk records into a map of
 * namespace → list-of-merged-messages.
 *
 * Within each namespace, messages with the same `id` are merged
 * (token-by-token accumulation).  Messages without an id are each
 * treated as a standalone message.
 */
export function accumulateChunks(
  records: Array<{
    namespace: string[];
    msg: Record<string, JsonValue>;
  }>,
): Map<NamespaceKey, MergedMessage[]> {
  // namespace → (messageId → {mergedMessage, toolCallAcc})
  const nsMap = new Map<NamespaceKey, Map<string, {
    merged: MergedMessage;
    toolCallAcc: Map<number, MergedToolCall>;
  }>>();
  // namespace → ordered list of message ids (for output ordering)
  const nsOrder = new Map<NamespaceKey, string[]>();
  // Counter for anonymous messages (no id)
  let anonCounter = 0;

  for (const { namespace, msg } of records) {
    const nsKey = namespaceKey(namespace);

    if (!nsMap.has(nsKey)) {
      nsMap.set(nsKey, new Map());
      nsOrder.set(nsKey, []);
    }
    const msgMap = nsMap.get(nsKey)!;
    const orderList = nsOrder.get(nsKey)!;

    const rawId = chunkId(msg);
    // Assign a synthetic id for anonymous chunks so each gets its own slot.
    const msgId = rawId || `__anon_${anonCounter++}`;

    const rawContent = msg['content'];
    const incomingContent: string | ContentBlock[] | null | undefined =
      typeof rawContent === 'string' ? rawContent
      : Array.isArray(rawContent) ? (rawContent as ContentBlock[])
      : null;

    const incomingToolChunks: ToolCallChunk[] = Array.isArray(msg['tool_call_chunks'])
      ? (msg['tool_call_chunks'] as ToolCallChunk[])
      : [];

    const incomingUsage = msg['usage_metadata'];
    const usageMap: Record<string, number> | null =
      incomingUsage && typeof incomingUsage === 'object' && !Array.isArray(incomingUsage)
        ? incomingUsage as Record<string, number>
        : null;

    if (!msgMap.has(msgId)) {
      // First chunk for this message.
      const initialContent: string | ContentBlock[] =
        incomingContent !== null && incomingContent !== undefined
          ? incomingContent
          : '';
      const toolCallAcc = new Map<number, MergedToolCall>();
      mergeToolCallChunks(toolCallAcc, incomingToolChunks);

      const merged: MergedMessage = {
        type: chunkType(msg),
        id: rawId,
        content: initialContent,
        tool_calls: [],
        usage_metadata: mergeUsageMetadata({}, usageMap),
        ...(msg['tool_call_id'] !== undefined && {
          tool_call_id: typeof msg['tool_call_id'] === 'string'
            ? msg['tool_call_id']
            : String(msg['tool_call_id']),
        }),
      };

      msgMap.set(msgId, { merged, toolCallAcc });
      orderList.push(msgId);
    } else {
      // Subsequent chunk — merge into existing.
      const existing = msgMap.get(msgId)!;

      if (incomingContent !== null && incomingContent !== undefined) {
        existing.merged.content = mergeContent(existing.merged.content, incomingContent);
      }
      mergeToolCallChunks(existing.toolCallAcc, incomingToolChunks);
      existing.merged.usage_metadata = mergeUsageMetadata(
        existing.merged.usage_metadata,
        usageMap,
      );
    }
  }

  // Finalise: convert toolCallAcc maps to sorted arrays on each merged message.
  const result = new Map<NamespaceKey, MergedMessage[]>();
  for (const [nsKey, orderList] of nsOrder.entries()) {
    const msgMap = nsMap.get(nsKey)!;
    const messages: MergedMessage[] = [];
    for (const msgId of orderList) {
      const entry = msgMap.get(msgId);
      if (!entry) continue;
      const { merged, toolCallAcc } = entry;
      // Convert tool call accumulator to sorted array.
      merged.tool_calls = [...toolCallAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => tc);
      messages.push(merged);
    }
    result.set(nsKey, messages);
  }

  return result;
}
