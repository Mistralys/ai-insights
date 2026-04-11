/**
 * chunk-renderer.ts — Chunk-to-Markdown renderer for streaming dialogue capture.
 *
 * Public API
 * ----------
 * renderChunksToMarkdown(jsonlContent: string): string
 *   Parses a JSONL chunk file produced by the Python `ChunkWriter`, merges
 *   token-level `AIMessageChunk` data into complete messages, groups messages
 *   by namespace (main agent vs. sub-agents), and renders Markdown consistent
 *   with the orchestrator's `serialize_messages_to_markdown()` output format.
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
 * The rendering step mirrors `serialize_messages_to_markdown()` in
 * `orchestrator/src/utils/dialogue_writer.py`:
 *   - Document heading + metadata table
 *   - Per-message `## Role` section with content and tool-call blocks
 *   - Token-usage footer (horizontal rule + `## Token Usage` table)
 *
 * Pure data transformation: no I/O, no side effects, easily testable.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw JSON value accepted in chunk payloads. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** A single tool-call fragment as it appears in an AIMessageChunk. */
interface ToolCallChunk {
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
interface MergedToolCall {
  id: string;
  name: string;
  /** Accumulated JSON-encoded args string — may be partial if chunks are malformed. */
  args: string;
}

/** Content block from an AIMessageChunk / AIMessage. */
interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: JsonValue | undefined;
}

/** Merged/reconstructed message ready for rendering. */
interface MergedMessage {
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
type NamespaceKey = string;

// ---------------------------------------------------------------------------
// Internal helpers — chunk merging
// ---------------------------------------------------------------------------

/**
 * Returns the canonical role label for a LangChain message type string.
 * Mirrors `_msg_role()` in `dialogue_writer.py`.
 */
function msgRole(type: string): string {
  switch (type.toLowerCase()) {
    case 'human':
    case 'humanmessage':
      return 'Human';
    case 'ai':
    case 'aimessage':
    case 'aimessagechunk':
      return 'Assistant';
    case 'tool':
    case 'toolmessage':
      return 'Tool Result';
    case 'system':
    case 'systemmessage':
      return 'System';
    default: {
      // Strip trailing "message"/"messagechunk" suffix, capitalise first char.
      const base = type.toLowerCase()
        .replace(/messagechunk$/, '')
        .replace(/message$/, '');
      return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Message';
    }
  }
}

/**
 * Renders a content value (string or list-of-blocks) to a plain string
 * suitable for Markdown body text.
 * Mirrors `_render_content()` in `dialogue_writer.py`.
 */
function renderContent(content: string | ContentBlock[] | null | undefined): string {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block);
      } else if (block && typeof block === 'object') {
        const btype = block.type ?? '';
        if (btype === 'text') {
          parts.push(typeof block.text === 'string' ? block.text : '');
        } else {
          // Non-text blocks rendered as compact JSON fences.
          parts.push('```json\n' + JSON.stringify(block, null, 2) + '\n```');
        }
      } else {
        parts.push(String(block));
      }
    }
    return parts.filter(Boolean).join('\n\n');
  }
  return String(content);
}

/**
 * Renders a list of merged tool calls as fenced Markdown code blocks.
 * Mirrors `_render_tool_calls()` in `dialogue_writer.py`.
 *
 * **Unparseable args fallback contract:**
 * When a tool call's accumulated `args` string is not valid JSON (e.g. because
 * the stream was truncated mid-token), `JSON.parse()` throws and the raw arg
 * string is used as-is.  The rendered output places this raw string directly
 * inside a ` ```json ` fence without any further transformation.  This means
 * the rendered block will contain partial JSON rather than a pretty-printed
 * object.  Consumers should treat a ` ```json ` block that is not valid JSON
 * as an indicator of a truncated or incomplete stream capture.
 */
function renderToolCalls(toolCalls: MergedToolCall[]): string {
  const blocks: string[] = [];
  for (const tc of toolCalls) {
    const name = tc.name || 'unknown_tool';
    const tcId = tc.id || '';
    const header = `**Tool call:** \`${name}\`` + (tcId ? ` (id: \`${tcId}\`)` : '');

    let argsObj: unknown = {};
    try {
      argsObj = tc.args ? JSON.parse(tc.args) : {};
    } catch {
      // Treat unparseable args as a raw string.
      argsObj = tc.args;
    }
    const body = '```json\n' + JSON.stringify(argsObj, null, 2) + '\n```';
    blocks.push(`${header}\n\n${body}`);
  }
  return blocks.join('\n\n');
}

/**
 * Extracts a stable string id from a chunk payload.
 * LangChain's `AIMessageChunk.model_dump()` places the message id in the
 * top-level `id` field.  Falls back to an empty string when absent.
 */
function chunkId(chunk: Record<string, JsonValue>): string {
  return typeof chunk['id'] === 'string' ? chunk['id'] : '';
}

/**
 * Returns the message type from a chunk payload.
 * LangChain's message dumps use the `type` field (e.g. "AIMessageChunk").
 */
function chunkType(chunk: Record<string, JsonValue>): string {
  return typeof chunk['type'] === 'string' ? chunk['type'] : 'ai';
}

/**
 * Merges a new content value into an existing accumulated content value.
 * Both string-concatenation (token streaming) and block-list merging are
 * supported.
 */
function mergeContent(
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
function mergeToolCallChunks(
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
function mergeUsageMetadata(
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
function isValidHeader(line: string): boolean {
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
function parseChunkLine(line: string): {
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
function namespaceKey(ns: string[]): NamespaceKey {
  return ns.join('/');
}

/**
 * Returns a human-readable label for a namespace key.
 */
function namespaceLabel(key: NamespaceKey): string {
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
function accumulateChunks(
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

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

/**
 * Renders a namespace block to Markdown lines.
 *
 * For the main agent (nsKey === '') the messages are rendered without an extra
 * namespace heading.  For sub-agents a `### Subagent: {label}` heading is
 * prepended so the reader can easily identify the agent boundary.
 */
function renderNamespaceBlock(
  nsKey: NamespaceKey,
  messages: MergedMessage[],
  isSubagent: boolean,
): string[] {
  const lines: string[] = [];

  if (isSubagent) {
    lines.push(`### Subagent: ${namespaceLabel(nsKey)}`);
    lines.push('');
  }

  for (const msg of messages) {
    const role = msgRole(msg.type);
    lines.push(`## ${role}`);
    lines.push('');

    const contentStr = renderContent(msg.content);
    if (contentStr) {
      lines.push(contentStr);
      lines.push('');
    }

    if (msg.tool_calls.length > 0) {
      lines.push(renderToolCalls(msg.tool_calls));
      lines.push('');
    }
  }

  return lines;
}

/**
 * Collects aggregated token usage across all namespaces and messages.
 */
function collectTotalUsage(
  nsMap: Map<NamespaceKey, MergedMessage[]>,
): Record<string, number> | null {
  const totals: Record<string, number> = {};
  for (const messages of nsMap.values()) {
    for (const msg of messages) {
      for (const [key, value] of Object.entries(msg.usage_metadata)) {
        if (typeof value === 'number') {
          totals[key] = (totals[key] ?? 0) + value;
        }
      }
    }
  }
  return Object.keys(totals).length > 0 ? totals : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a JSONL chunk file and renders its contents to a Markdown string
 * structurally consistent with the orchestrator's `serialize_messages_to_markdown()`
 * format.
 *
 * @param jsonlContent  Raw JSONL string (e.g. the content of a `.jsonl` chunk file).
 * @returns             A Markdown document string (always ends with a trailing newline).
 */
export function renderChunksToMarkdown(jsonlContent: string): string {
  const rawLines = jsonlContent.split('\n');
  const nonEmptyLines = rawLines.map(l => l.trim()).filter(Boolean);

  // --- Header validation ---
  // If the first non-empty line is a valid chunk_format:1 header, skip it.
  // If no lines at all, produce a minimal valid document.
  let dataLines: string[];
  if (nonEmptyLines.length === 0) {
    dataLines = [];
  } else {
    const firstLine = nonEmptyLines[0]!;
    dataLines = isValidHeader(firstLine)
      ? nonEmptyLines.slice(1)
      : nonEmptyLines;
  }

  // --- Parse chunk lines, skipping malformed ones gracefully ---
  const records: Array<{ namespace: string[]; msg: Record<string, JsonValue> }> = [];
  for (const line of dataLines) {
    const parsed = parseChunkLine(line);
    if (parsed) {
      records.push({ namespace: parsed.namespace, msg: parsed.msg });
    }
    // Malformed lines are silently skipped.
  }

  // --- Accumulate chunks into merged messages per namespace ---
  const nsMap = accumulateChunks(records);

  // --- Build output lines ---
  const lines: string[] = [
    '# Dialogue — streaming capture',
    '',
    '| Field | Value |',
    '| ----- | ----- |',
    '| Format | `chunks` |',
    '',
  ];

  if (nsMap.size === 0) {
    lines.push('*No messages recorded.*');
    return lines.join('\n') + '\n';
  }

  // Render main-agent namespace first (empty key), then sub-agents in insertion order.
  const mainMessages = nsMap.get('');
  if (mainMessages && mainMessages.length > 0) {
    lines.push(...renderNamespaceBlock('', mainMessages, false));
  }

  for (const [nsKey, messages] of nsMap.entries()) {
    if (nsKey === '') continue; // already rendered above
    if (messages.length > 0) {
      lines.push(...renderNamespaceBlock(nsKey, messages, true));
    }
  }

  // --- Token-usage footer ---
  const usage = collectTotalUsage(nsMap);
  if (usage) {
    lines.push('---');
    lines.push('');
    lines.push('## Token Usage');
    lines.push('');
    lines.push('| Metric | Count |');
    lines.push('| ------ | ----- |');
    for (const key of Object.keys(usage).sort()) {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      lines.push(`| ${label} | ${usage[key]} |`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}
