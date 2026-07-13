/**
 * chunk-renderer.ts — Rendering layer for streaming dialogue capture.
 *
 * This module builds on the shared accumulation layer in `chunk-accumulator.ts`
 * and exposes two pure renderers:
 *
 * renderChunksToMarkdown(jsonlContent: string): string
 *   Verbose format: `## Role` headings, JSON fenced tool-call blocks, and a
 *   token-usage footer.  Retained for debugging and diff-based consumers.
 *
 * renderChunksToDialogue(jsonlContent: string): string
 *   Compact chat-like format: plain-paragraph AI text, per-tool single-line
 *   summaries, hidden ToolMessages (execute/task results shown inline), and
 *   sub-agent `### Subagent:` headings.  Primary renderer used in production.
 *
 * Types, parsing, merging, and `accumulateChunks()` live in `chunk-accumulator.ts`.
 *
 * Pure data transformation: no I/O, no side effects, no imports from
 * `mcp-server/src/`.
 */

import {
  type JsonValue,
  type MergedToolCall,
  type ContentBlock,
  type MergedMessage,
  type NamespaceKey,
  accumulateChunks,
  isValidHeader,
  namespaceLabel,
  parseChunkLine,
} from './chunk-accumulator.js';

// ---------------------------------------------------------------------------
// Internal rendering helpers
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

// ---------------------------------------------------------------------------
// Dialogue rendering — private helpers
// ---------------------------------------------------------------------------

/**
 * Builds a map from toolCallId → toolName by scanning all AI messages across
 * all namespaces in the accumulated message map.
 */
function buildToolCallIndex(
  nsMap: Map<NamespaceKey, MergedMessage[]>,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const messages of nsMap.values()) {
    for (const msg of messages) {
      for (const tc of msg.tool_calls) {
        if (tc.id) {
          index.set(tc.id, tc.name);
        }
      }
    }
  }
  return index;
}

/**
 * Builds a map from toolCallId → { toolName, content } by scanning all
 * ToolMessages across all namespaces.  Only stores entries for tools whose
 * rendering rule needs inline results (currently `execute` and `task`).
 */
function buildToolResultIndex(
  nsMap: Map<NamespaceKey, MergedMessage[]>,
  toolCallIndex: Map<string, string>,
): Map<string, { toolName: string; content: string }> {
  const INLINE_RESULT_TOOLS = new Set(['execute', 'task']);
  const index = new Map<string, { toolName: string; content: string }>();

  for (const messages of nsMap.values()) {
    for (const msg of messages) {
      const msgType = msg.type.toLowerCase();
      if (msgType !== 'tool' && msgType !== 'toolmessage') continue;
      const tcId = msg.tool_call_id;
      if (!tcId) continue;

      const toolName = toolCallIndex.get(tcId);
      if (!toolName || !INLINE_RESULT_TOOLS.has(toolName)) continue;

      const content = renderContent(msg.content);
      index.set(tcId, { toolName, content });
    }
  }
  return index;
}

/**
 * Strips a leading `cd … &&` prefix from a shell command, takes the first
 * meaningful command token, and truncates to ≤ 80 characters with `…`.
 */
function abbreviateCommand(command: string): string {
  // Strip leading `cd <dir> &&` or `cd "<dir>" &&` prefix (possibly chained).
  let cmd = command.trim();
  cmd = cmd.replace(/^(cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*)+/i, '').trim();

  // Truncate to 80 chars with ellipsis if needed.
  if (cmd.length > 80) {
    return cmd.slice(0, 79) + '…';
  }
  return cmd;
}

/**
 * Extracts the last meaningful output line and exit-code success flag from a
 * ToolMessage content string produced by `execute`.
 *
 * Content format (approximate):
 *   <output lines…>
 *   [Command succeeded with exit code 0]   ← or "failed with exit code N"
 *
 * Returns null if content is empty or no meaningful line exists.
 *
 * @remarks
 * **Default-success behaviour.**
 * When no `[Command succeeded/failed…]` footer line is found in the content,
 * the function defaults to `success = true`.  This is intentional: commands
 * that produce output without a footer line are assumed to have succeeded (e.g.
 * tools that emit a result without a trailing exit-code annotation).  The
 * sibling formatter `formatExecuteDetail` renders ✓ or ✗ based on this value.
 *
 * **Summary truncation.**
 * The returned `summary` string is capped at 120 characters (with a trailing
 * `…` when truncated) to prevent unwieldy `↳` lines in the dialogue output.
 * The full content is always available in the raw JSONL.
 */
function extractExecuteResult(
  content: string,
): { summary: string; success: boolean } | null {
  const lines = content.split('\n').map(l => l.trim());

  // Find the exit-code footer line.
  let footerIdx = -1;
  let success = true;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    const match = line.match(/^\[Command\s+(succeeded|failed)\s+with\s+exit\s+code\s+(\d+)\]$/i);
    if (match) {
      footerIdx = i;
      success = match[1]?.toLowerCase() === 'succeeded';
      break;
    }
  }

  // Collect all non-empty, non-footer lines.
  const outputLines = lines.filter(
    (l, i) => l && i !== footerIdx,
  );

  if (outputLines.length === 0) return null;

  let summary = outputLines[outputLines.length - 1]!;
  const MAX_SUMMARY_LENGTH = 120;
  if (summary.length > MAX_SUMMARY_LENGTH) {
    summary = summary.slice(0, MAX_SUMMARY_LENGTH - 1) + '…';
  }
  return { summary, success };
}

// ---------------------------------------------------------------------------
// Dialogue rendering — per-family formatter helpers
// ---------------------------------------------------------------------------

/**
 * Formats a `↳ [filename](file_path)` detail line for file tools
 * (`edit_file`, `write_file`, `read_file`).
 */
function formatFileToolDetail(args: unknown): string[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  const a = args as Record<string, unknown>;

  // edit_file / write_file use `file_path`; read_file also uses `file_path`.
  const filePath =
    typeof a['file_path'] === 'string' ? a['file_path'] :
    typeof a['path'] === 'string' ? a['path'] :
    null;

  if (!filePath) return [];

  const filename = filePath.split('/').pop() ?? filePath;
  return [`↳ [${filename}](${filePath})`];
}

/**
 * Formats `↳ \`abbreviated_command\`` and an optional result line for `execute`.
 */
function formatExecuteDetail(
  args: unknown,
  resultEntry?: { toolName: string; content: string },
): string[] {
  const lines: string[] = [];
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const command = (args as Record<string, unknown>)['command'];
    if (typeof command === 'string') {
      lines.push('↳ `' + abbreviateCommand(command) + '`');
    }
  }
  if (resultEntry) {
    const extracted = extractExecuteResult(resultEntry.content);
    if (extracted) {
      const tick = extracted.success ? '✓' : '✗';
      // extracted.summary is guaranteed ≤ 120 chars (truncated by extractExecuteResult).
      lines.push(`↳ ${extracted.summary} ${tick}`);
    }
  }
  return lines;
}

/**
 * Formats `↳ Sub-agent: **subagent_type**` and an optional first-result-line for `task`.
 */
function formatTaskDetail(
  args: unknown,
  resultEntry?: { toolName: string; content: string },
): string[] {
  const lines: string[] = [];
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const subagentType = (args as Record<string, unknown>)['subagent_type'];
    if (typeof subagentType === 'string') {
      lines.push(`↳ Sub-agent: **${subagentType}**`);
    }
  }
  if (resultEntry) {
    const firstLine = resultEntry.content
      .split('\n')
      .map(l => l.trim())
      .find(l => l.length > 0);
    if (firstLine) {
      lines.push(`↳ ${firstLine}`);
    }
  }
  return lines;
}

/**
 * Formats `write_todos` as a compact checklist.
 *
 * The args `todos` field is an array of `{ content: string; status: string }`
 * objects.  Each item is rendered as `- [x] content` (completed) or
 * `- [ ] content` (pending / in_progress).
 *
 * @remarks
 * **Return-shape divergence from sibling formatters.**
 * Unlike `formatFileToolDetail`, `formatExecuteDetail`, `formatTaskDetail`, and
 * `formatLedgerToolDetail` — which all return `'↳ …'`-prefixed strings —
 * this function returns raw Markdown list items (`'- [x] …'` / `'- [ ] …'`).
 *
 * This is intentional: `write_todos` renders a visual checklist, not a
 * summary line.  The `getToolDetailLines` dispatcher pushes return values
 * verbatim into the output line buffer, so the rendered Markdown is correct.
 *
 * If you add a new formatter to this family, follow the `'↳ …'` convention
 * unless the tool's output is inherently list-shaped.  Do **not** model a new
 * formatter on `formatWriteTodosDetail` for the general case.
 */
function formatWriteTodosDetail(args: unknown): string[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  const a = args as Record<string, unknown>;
  const todos = a['todos'];
  if (!Array.isArray(todos) || todos.length === 0) return [];

  return todos.map((todo: unknown) => {
    if (!todo || typeof todo !== 'object' || Array.isArray(todo)) return '- [ ] (unknown)';
    const t = todo as Record<string, unknown>;
    const content = typeof t['content'] === 'string' ? t['content'] : '(unknown)';
    const status = typeof t['status'] === 'string' ? t['status'] : '';
    const checked = status === 'completed' ? 'x' : ' ';
    return `- [${checked}] ${content}`;
  });
}

/**
 * Formats contextual `↳ …` detail lines for `ledger_*` tools.
 *
 * Tools are split into mutation and query families; each has its own detail
 * format.  Unrecognised ledger tools emit no detail line (but the header is
 * always emitted by the caller).
 */
function formatLedgerToolDetail(name: string, args: unknown): string[] {
  const a = (args && typeof args === 'object' && !Array.isArray(args))
    ? (args as Record<string, unknown>)
    : {};

  const wp = typeof a['work_package_id'] === 'string' ? a['work_package_id'] : '';

  switch (name) {
    // --- Mutation tools ---
    case 'ledger_begin_work':
    case 'ledger_start_pipeline': {
      const type = typeof a['type'] === 'string' ? a['type'] : '';
      const role = typeof a['agent_role'] === 'string' ? a['agent_role'] : '';
      if (!wp) return [];
      return [`↳ ${wp} — ${type} (${role})`];
    }

    case 'ledger_complete_pipeline': {
      const type = typeof a['type'] === 'string' ? a['type'] : '';
      const status = typeof a['status'] === 'string' ? a['status'] : '';
      if (!wp) return [];
      const detail = [`↳ ${wp} ${type} → ${status}`];
      // Append first summary bullet if available.
      const summary = a['summary'];
      let firstItem: string | null = null;
      if (typeof summary === 'string' && summary.trim()) {
        firstItem = summary.trim().split('\n')[0] ?? null;
      } else if (Array.isArray(summary) && summary.length > 0) {
        const first = summary[0];
        if (typeof first === 'string' && first.trim()) firstItem = first.trim();
      }
      if (firstItem) detail.push(`↳ ${firstItem}`);
      return detail;
    }

    case 'ledger_cancel_pipeline': {
      const type = typeof a['type'] === 'string' ? a['type'] : '';
      const reason = typeof a['reason'] === 'string' ? a['reason'] : '';
      if (!wp) return [];
      return [`↳ ${wp} ${type} — ${reason}`];
    }

    case 'ledger_claim_work_package': {
      const agent = typeof a['agent'] === 'string' ? a['agent'] : '';
      if (!wp) return [];
      return [`↳ ${wp} → ${agent}`];
    }

    case 'ledger_update_work_package_status': {
      const status = typeof a['status'] === 'string' ? a['status'] : '';
      if (!wp) return [];
      return [`↳ ${wp} → ${status}`];
    }

    case 'ledger_update_pipeline_progress': {
      const type = typeof a['type'] === 'string' ? a['type'] : '';
      const summary = a['summary'];
      let firstItem = '';
      if (typeof summary === 'string') firstItem = summary.trim().split('\n')[0] ?? '';
      else if (Array.isArray(summary) && summary.length > 0) {
        const first = summary[0];
        if (typeof first === 'string') firstItem = first.trim();
      }
      if (!wp) return [];
      return [`↳ ${wp} ${type} — ${firstItem}`];
    }

    case 'ledger_update_acceptance_criteria': {
      const ops = a['operations'];
      const n = Array.isArray(ops) ? ops.length : 0;
      if (!wp) return [];
      return [`↳ ${wp} (${n} operations)`];
    }

    case 'ledger_add_project_comment': {
      const type = typeof a['type'] === 'string' ? a['type'] : '';
      const priority = typeof a['priority'] === 'string' ? a['priority'] : '';
      const note = typeof a['note'] === 'string' ? a['note'] : '';
      const firstNoteLine = note.split('\n')[0] ?? '';
      return [`↳ ${type} (${priority}): ${firstNoteLine}`];
    }

    // --- Query tools ---
    case 'ledger_get_next_action': {
      const role = typeof a['agent_role'] === 'string' ? a['agent_role'] : '';
      return role ? [`↳ ${role}`] : [];
    }

    case 'ledger_get_work_package': {
      return wp ? [`↳ ${wp}`] : [];
    }

    case 'ledger_get_handoff_status': {
      const agent = typeof a['current_agent'] === 'string' ? a['current_agent'] : '';
      return agent ? [`↳ ${agent}`] : [];
    }

    case 'ledger_search_insights': {
      const query = typeof a['query'] === 'string' ? a['query'] : '';
      return query ? [`↳ "${query}"`] : [];
    }

    // --- No-detail query tools ---
    case 'ledger_get_project_status':
    case 'ledger_list_work_packages':
      return [];

    // --- Other ledger_* tools (no detail, but always shown via header) ---
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Dialogue rendering — tool detail dispatcher
// ---------------------------------------------------------------------------

/**
 * Returns 0–N `↳ …` detail lines for a given tool call.  Dispatches to the
 * appropriate per-family formatter helper.
 *
 * @param name         Tool name.
 * @param args         Parsed tool arguments (object or null).
 * @param resultEntry  Optional result index entry for tools needing inline results.
 */
function getToolDetailLines(
  name: string,
  args: unknown,
  resultEntry?: { toolName: string; content: string },
): string[] {
  // File family
  if (name === 'edit_file' || name === 'write_file' || name === 'read_file') {
    return formatFileToolDetail(args);
  }
  // Execution family
  if (name === 'execute') {
    return formatExecuteDetail(args, resultEntry);
  }
  // Task family
  if (name === 'task') {
    return formatTaskDetail(args, resultEntry);
  }
  // Todo family
  if (name === 'write_todos') {
    return formatWriteTodosDetail(args);
  }
  // Search family — no detail line
  if (name === 'glob' || name === 'grep' || name === 'ls') {
    return [];
  }
  // Ledger family
  if (name.startsWith('ledger_')) {
    return formatLedgerToolDetail(name, args);
  }
  // Default / unknown — no detail line, header always shown by caller
  return [];
}

// ---------------------------------------------------------------------------
// Dialogue rendering — message walker
// ---------------------------------------------------------------------------

/**
 * Renders a list of merged messages in dialogue style.
 *
 * - AI messages: text content as plain paragraphs; tool calls as `Tool call: \`name\`` lines.
 * - ToolMessages: skipped (results already consumed inline for `execute` and `task`).
 * - All other message types (Human, System, …): skipped silently.
 */
function renderDialogueMessages(
  messages: MergedMessage[],
  toolResultIndex: Map<string, { toolName: string; content: string }>,
): string[] {
  const lines: string[] = [];

  for (const msg of messages) {
    const msgType = msg.type.toLowerCase();

    // Only AI messages contribute dialogue output.
    if (
      msgType !== 'ai' &&
      msgType !== 'aimessage' &&
      msgType !== 'aimessagechunk'
    ) {
      continue; // Skip Human, System, ToolMessage, etc.
    }

    // Render text content as plain paragraphs.
    const contentStr = renderContent(msg.content).trim();
    if (contentStr) {
      lines.push(contentStr);
      lines.push('');
    }

    // Render each tool call as a `Tool call: \`name\`` header + detail lines.
    for (const tc of msg.tool_calls) {
      const toolName = tc.name || 'unknown_tool';
      lines.push(`Tool call: \`${toolName}\``);

      // Parse args once.
      let parsedArgs: unknown = null;
      try {
        parsedArgs = tc.args ? JSON.parse(tc.args) : null;
      } catch {
        parsedArgs = null;
      }

      // Look up result entry (only populated for `execute` and `task`).
      const resultEntry = tc.id ? toolResultIndex.get(tc.id) : undefined;

      const detailLines = getToolDetailLines(toolName, parsedArgs, resultEntry);
      lines.push(...detailLines);
      lines.push('');
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Dialogue rendering — sub-agent section wrapper
// ---------------------------------------------------------------------------

/**
 * Renders a namespace block in dialogue style.
 *
 * For sub-agents a `### Subagent: {label}` heading is prepended.
 * For the main agent (nsKey === '') no heading is added.
 */
function renderDialogueNamespaceBlock(
  nsKey: NamespaceKey,
  messages: MergedMessage[],
  toolResultIndex: Map<string, { toolName: string; content: string }>,
  isSubagent: boolean,
): string[] {
  const lines: string[] = [];

  if (isSubagent) {
    lines.push(`### Subagent: ${namespaceLabel(nsKey)}`);
    lines.push('');
  }

  lines.push(...renderDialogueMessages(messages, toolResultIndex));
  return lines;
}

// ---------------------------------------------------------------------------
// Public API — dialogue renderer
// ---------------------------------------------------------------------------

/**
 * Parses a JSONL chunk file and renders its contents in a clean, chat-like
 * dialogue format.
 *
 * Differences from `renderChunksToMarkdown`:
 * - No `# Dialogue` document header or metadata table.
 * - No `## Role` headings — AI text appears as plain paragraphs.
 * - Tool calls are rendered as `Tool call: \`name\`` with a compact detail line
 *   instead of a full JSON fenced block.
 * - ToolMessages are hidden; `execute` and `task` results are shown inline with
 *   their tool call.
 * - No token-usage footer.
 *
 * @param jsonlContent  Raw JSONL string (e.g. the content of a `.jsonl` chunk file).
 * @returns             A Markdown string (always ends with a trailing `\n`).
 *                      Returns `*No dialogue recorded.*\n` for empty or header-only input.
 */
export function renderChunksToDialogue(jsonlContent: string): string {
  const rawLines = jsonlContent.split('\n');
  const nonEmptyLines = rawLines.map(l => l.trim()).filter(Boolean);

  // --- Header validation (same as renderChunksToMarkdown) ---
  let dataLines: string[];
  if (nonEmptyLines.length === 0) {
    dataLines = [];
  } else {
    const firstLine = nonEmptyLines[0]!;
    dataLines = isValidHeader(firstLine)
      ? nonEmptyLines.slice(1)
      : nonEmptyLines;
  }

  // --- Parse chunk lines ---
  const records: Array<{ namespace: string[]; msg: Record<string, JsonValue> }> = [];
  for (const line of dataLines) {
    const parsed = parseChunkLine(line);
    if (parsed) {
      records.push({ namespace: parsed.namespace, msg: parsed.msg });
    }
  }

  // --- Accumulate chunks into merged messages per namespace ---
  const nsMap = accumulateChunks(records);

  if (nsMap.size === 0) {
    return '*No dialogue recorded.*\n';
  }

  // --- Build correlation indexes ---
  const toolCallIndex = buildToolCallIndex(nsMap);
  const toolResultIndex = buildToolResultIndex(nsMap, toolCallIndex);

  // --- Render per namespace (main agent first, sub-agents next) ---
  const lines: string[] = [];

  const mainMessages = nsMap.get('');
  if (mainMessages && mainMessages.length > 0) {
    lines.push(...renderDialogueNamespaceBlock('', mainMessages, toolResultIndex, false));
  }

  for (const [nsKey, messages] of nsMap.entries()) {
    if (nsKey === '') continue;
    if (messages.length > 0) {
      lines.push(...renderDialogueNamespaceBlock(nsKey, messages, toolResultIndex, true));
    }
  }

  // Remove any trailing blank lines before adding the final newline.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n') + '\n';
}
