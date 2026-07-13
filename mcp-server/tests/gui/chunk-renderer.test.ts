/**
 * Unit tests for gui/chunk-renderer.ts — renderChunksToMarkdown()
 *
 * Coverage:
 *  - Empty input (no content, header only, whitespace-only)
 *  - Single text message (main agent)
 *  - Multi-turn conversation (human → assistant → tool result)
 *  - Token-level chunk merging (multiple AIMessageChunks with same id)
 *  - Sub-agent messages (identified by namespace)
 *  - Tool calls (name + args + id rendering)
 *  - Mixed content blocks (text + tool_use JSON fences)
 *  - Malformed JSONL lines (graceful skip)
 *  - Usage metadata aggregation (token-usage footer)
 *  - Structural consistency with serialize_messages_to_markdown() format
 */

import { describe, it, expect } from 'vitest';
import { renderChunksToMarkdown, renderChunksToDialogue } from '../../gui/chunk-renderer.js';

// ---------------------------------------------------------------------------
// JSONL builder helpers
// ---------------------------------------------------------------------------

const HEADER = JSON.stringify({ chunk_format: 1, stream_mode: 'messages', langgraph_stream_version: 'v2' });

/**
 * Builds a chunk line in the object shape {ns, msg, metadata}.
 */
function chunkLine(
  ns: string[],
  msg: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): string {
  return JSON.stringify({ ns, msg, metadata });
}

/**
 * Builds a chunk line in the array shape [ns, msg, metadata].
 */
function chunkLineArray(
  ns: string[],
  msg: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): string {
  return JSON.stringify([ns, msg, metadata]);
}

/**
 * Joins lines into a JSONL string (with trailing newline).
 */
function jsonl(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function humanMsg(id: string, text: string): Record<string, unknown> {
  return { type: 'HumanMessage', id, content: text };
}

function aiChunk(id: string, text: string, usage?: Record<string, number>): Record<string, unknown> {
  return {
    type: 'AIMessageChunk',
    id,
    content: text,
    tool_call_chunks: [],
    ...(usage ? { usage_metadata: usage } : {}),
  };
}

function aiChunkWithToolCall(
  id: string,
  toolName: string,
  toolId: string,
  argsPart: string,
  index = 0,
): Record<string, unknown> {
  return {
    type: 'AIMessageChunk',
    id,
    content: '',
    tool_call_chunks: [{ index, id: toolId, name: toolName, args: argsPart }],
  };
}

function toolResultMsg(id: string, content: string, toolCallId: string): Record<string, unknown> {
  return { type: 'ToolMessage', id, content, tool_call_id: toolCallId };
}

// ---------------------------------------------------------------------------
// Tests — empty input
// ---------------------------------------------------------------------------

describe('renderChunksToMarkdown — empty input', () => {
  it('returns minimal valid Markdown for completely empty string', () => {
    const result = renderChunksToMarkdown('');
    expect(result).toContain('# Dialogue');
    expect(result).toContain('*No messages recorded.*');
    expect(result.endsWith('\n')).toBe(true);
  });

  it('returns minimal valid Markdown for whitespace-only string', () => {
    const result = renderChunksToMarkdown('   \n\n   \t  \n');
    expect(result).toContain('*No messages recorded.*');
  });

  it('returns minimal valid Markdown for header-only file', () => {
    const result = renderChunksToMarkdown(HEADER + '\n');
    expect(result).toContain('# Dialogue');
    expect(result).toContain('*No messages recorded.*');
  });

  it('includes the metadata table', () => {
    const result = renderChunksToMarkdown('');
    expect(result).toContain('| Format | `chunks` |');
  });

  it('always ends with a trailing newline', () => {
    expect(renderChunksToMarkdown('').endsWith('\n')).toBe(true);
    expect(renderChunksToMarkdown(HEADER).endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — single message
// ---------------------------------------------------------------------------

describe('renderChunksToMarkdown — single message', () => {
  it('renders a single human message with correct role heading', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], humanMsg('msg-1', 'Hello, world!'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('## Human');
    expect(result).toContain('Hello, world!');
  });

  it('renders a single AI message with correct role heading', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('msg-2', 'Hi there!'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('## Assistant');
    expect(result).toContain('Hi there!');
  });

  it('renders a tool result message', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], toolResultMsg('msg-3', 'Tool output here.', 'call-abc'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('## Tool Result');
    expect(result).toContain('Tool output here.');
  });
});

// ---------------------------------------------------------------------------
// Tests — multi-turn conversation
// ---------------------------------------------------------------------------

describe('renderChunksToMarkdown — multi-turn conversation', () => {
  it('renders messages in order', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], humanMsg('h1', 'What is 2+2?'), {}),
      chunkLine([], aiChunk('a1', 'It is 4.'), {}),
    );
    const result = renderChunksToMarkdown(content);
    const humanIdx = result.indexOf('## Human');
    const assistantIdx = result.indexOf('## Assistant');
    expect(humanIdx).toBeGreaterThanOrEqual(0);
    expect(assistantIdx).toBeGreaterThan(humanIdx);
  });

  it('renders human → assistant → tool result in order', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], humanMsg('h1', 'Search for cats.'), {}),
      chunkLine([], aiChunkWithToolCall('a1', 'search', 'tc-1', '{"q":"cats"}'), {}),
      chunkLine([], toolResultMsg('t1', 'Found: many cats.', 'tc-1'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result.indexOf('## Human')).toBeLessThan(result.indexOf('## Assistant'));
    expect(result.indexOf('## Assistant')).toBeLessThan(result.indexOf('## Tool Result'));
    expect(result).toContain('Found: many cats.');
  });
});

// ---------------------------------------------------------------------------
// Tests — token-level chunk merging
// ---------------------------------------------------------------------------

describe('renderChunksToMarkdown — token-level chunk merging', () => {
  it('merges string content from multiple chunks with the same id', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('a1', 'Hello'), {}),
      chunkLine([], aiChunk('a1', ', '), {}),
      chunkLine([], aiChunk('a1', 'world!'), {}),
    );
    const result = renderChunksToMarkdown(content);
    // All three fragments merge into a single message.
    expect(result).toContain('Hello, world!');
    // Only one Assistant heading should appear.
    const matches = result.match(/## Assistant/g);
    expect(matches).toHaveLength(1);
  });

  it('keeps different message ids as separate messages', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('a1', 'First.'), {}),
      chunkLine([], aiChunk('a2', 'Second.'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('First.');
    expect(result).toContain('Second.');
    const matches = result.match(/## Assistant/g);
    expect(matches).toHaveLength(2);
  });

  it('accumulates usage_metadata across chunks for the same message', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('a1', 'Part 1', { input_tokens: 10 }), {}),
      chunkLine([], aiChunk('a1', ' Part 2', { output_tokens: 5 }), {}),
      chunkLine([], aiChunk('a1', ' Part 3', { output_tokens: 7 }), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('## Token Usage');
    expect(result).toContain('| Input Tokens | 10 |');
    expect(result).toContain('| Output Tokens | 12 |');
  });

  it('merges list-of-blocks content by index', () => {
    const block1 = { type: 'text', text: 'Hello' };
    const block2 = { type: 'text', text: ' world' };
    const msg1: Record<string, unknown> = { type: 'AIMessageChunk', id: 'a1', content: [block1], tool_call_chunks: [] };
    const msg2: Record<string, unknown> = { type: 'AIMessageChunk', id: 'a1', content: [block2], tool_call_chunks: [] };
    const content = jsonl(HEADER, chunkLine([], msg1), chunkLine([], msg2));
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('Hello world');
  });
});

// ---------------------------------------------------------------------------
// Tests — tool calls
// ---------------------------------------------------------------------------

describe('renderChunksToMarkdown — tool calls', () => {
  it('renders a tool call with name, id, and args', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithToolCall('a1', 'my_tool', 'tc-123', '{"key":"val"}'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('**Tool call:** `my_tool`');
    expect(result).toContain('(id: `tc-123`)');
    expect(result).toContain('"key"');
    expect(result).toContain('"val"');
    expect(result).toContain('```json');
  });

  it('merges multi-fragment tool call args', () => {
    // First chunk carries tool name + id + first args fragment.
    const chunk1: Record<string, unknown> = {
      type: 'AIMessageChunk',
      id: 'a1',
      content: '',
      tool_call_chunks: [{ index: 0, id: 'tc-1', name: 'get_weather', args: '{"city":' }],
    };
    // Second chunk carries the rest of the args fragment.
    const chunk2: Record<string, unknown> = {
      type: 'AIMessageChunk',
      id: 'a1',
      content: '',
      tool_call_chunks: [{ index: 0, id: null, name: null, args: '"Paris"}' }],
    };
    const content = jsonl(HEADER, chunkLine([], chunk1), chunkLine([], chunk2));
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('**Tool call:** `get_weather`');
    // Args are reassembled as valid JSON.
    expect(result).toContain('"city"');
    expect(result).toContain('"Paris"');
  });

  it('renders a tool call without an id', () => {
    const msg: Record<string, unknown> = {
      type: 'AIMessageChunk',
      id: 'a1',
      content: '',
      tool_call_chunks: [{ index: 0, id: '', name: 'anon_tool', args: '{}' }],
    };
    const content = jsonl(HEADER, chunkLine([], msg));
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('**Tool call:** `anon_tool`');
    // No id annotation when id is empty.
    expect(result).not.toContain('(id:');
  });
});

// ---------------------------------------------------------------------------
// Tests — mixed content blocks (text + non-text)
// ---------------------------------------------------------------------------

describe('renderChunksToMarkdown — mixed content blocks', () => {
  it('renders text blocks as plain text', () => {
    const msg: Record<string, unknown> = {
      type: 'AIMessageChunk',
      id: 'a1',
      content: [{ type: 'text', text: 'Plain text.' }],
      tool_call_chunks: [],
    };
    const result = renderChunksToMarkdown(jsonl(HEADER, chunkLine([], msg)));
    expect(result).toContain('Plain text.');
    expect(result).not.toContain('```json');
  });

  it('renders non-text blocks as JSON fences', () => {
    const msg: Record<string, unknown> = {
      type: 'AIMessageChunk',
      id: 'a1',
      content: [
        { type: 'text', text: 'Before.' },
        { type: 'image', url: 'https://example.com/img.png' },
      ],
      tool_call_chunks: [],
    };
    const result = renderChunksToMarkdown(jsonl(HEADER, chunkLine([], msg)));
    expect(result).toContain('Before.');
    expect(result).toContain('```json');
    expect(result).toContain('"type": "image"');
  });
});

// ---------------------------------------------------------------------------
// Tests — sub-agent messages
// ---------------------------------------------------------------------------

describe('renderChunksToMarkdown — subagent messages', () => {
  it('renders sub-agent messages under a Subagent heading', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], humanMsg('h1', 'Main question'), {}),
      chunkLine(['subgraph_a', 'node_1'], aiChunk('s1', 'Subagent reply'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('### Subagent: subgraph_a/node_1');
    expect(result).toContain('Subagent reply');
  });

  it('renders main-agent messages before sub-agent messages', () => {
    const content = jsonl(
      HEADER,
      chunkLine(['sub'], aiChunk('s1', 'Sub output'), {}),
      chunkLine([], aiChunk('m1', 'Main output'), {}),
    );
    const result = renderChunksToMarkdown(content);
    // Main agent rendered first.
    expect(result.indexOf('Main output')).toBeLessThan(result.indexOf('Sub output'));
  });

  it('groups messages from the same sub-agent namespace together', () => {
    const content = jsonl(
      HEADER,
      chunkLine(['agent_x'], humanMsg('h1', 'Q1 from agent_x'), {}),
      chunkLine(['agent_x'], aiChunk('a1', 'A1 from agent_x'), {}),
    );
    const result = renderChunksToMarkdown(content);
    // Should have exactly one Subagent heading for agent_x.
    const headingCount = (result.match(/### Subagent: agent_x/g) ?? []).length;
    expect(headingCount).toBe(1);
    // Both messages under that namespace.
    expect(result).toContain('Q1 from agent_x');
    expect(result).toContain('A1 from agent_x');
  });

  it('renders multiple distinct sub-agent namespaces separately', () => {
    const content = jsonl(
      HEADER,
      chunkLine(['agent_a'], aiChunk('a1', 'From A'), {}),
      chunkLine(['agent_b'], aiChunk('b1', 'From B'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('### Subagent: agent_a');
    expect(result).toContain('### Subagent: agent_b');
    expect(result).toContain('From A');
    expect(result).toContain('From B');
  });
});

// ---------------------------------------------------------------------------
// Tests — malformed JSONL lines
// ---------------------------------------------------------------------------

describe('renderChunksToMarkdown — malformed JSONL lines', () => {
  it('skips completely unparseable lines', () => {
    const content = jsonl(
      HEADER,
      'THIS IS NOT JSON !!!',
      chunkLine([], humanMsg('h1', 'Valid message'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('Valid message');
    expect(result).not.toContain('THIS IS NOT JSON');
  });

  it('skips lines that are valid JSON but wrong shape (scalar)', () => {
    const content = jsonl(
      HEADER,
      '42',
      chunkLine([], aiChunk('a1', 'After scalar'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('After scalar');
  });

  it('skips lines that are valid JSON but wrong shape (missing ns)', () => {
    const bad = JSON.stringify({ msg: { type: 'AIMessageChunk', id: 'x', content: 'bad' } });
    const content = jsonl(
      HEADER,
      bad,
      chunkLine([], aiChunk('a1', 'After bad'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('After bad');
  });

  it('tolerates a mix of good and bad lines and renders all valid messages', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], humanMsg('h1', 'First'), {}),
      '{broken json',
      chunkLine([], aiChunk('a1', 'Second'), {}),
      'null',
      chunkLine([], humanMsg('h2', 'Third'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('First');
    expect(result).toContain('Second');
    expect(result).toContain('Third');
  });

  it('handles a file with only malformed lines gracefully', () => {
    const content = jsonl(HEADER, 'not-json', '!!!', '{}');
    const result = renderChunksToMarkdown(content);
    // Empty object {} has ns = undefined → should be skipped.
    expect(result).toContain('# Dialogue');
    // May contain *No messages recorded.* or at least not crash.
    expect(typeof result).toBe('string');
    expect(result.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — structural consistency with serialize_messages_to_markdown()
// ---------------------------------------------------------------------------

describe('renderChunksToMarkdown — structural consistency', () => {
  it('produces a document heading as the first non-blank line', () => {
    const result = renderChunksToMarkdown(jsonl(
      HEADER,
      chunkLine([], aiChunk('a1', 'Hello'), {}),
    ));
    const firstLine = result.trimStart().split('\n')[0] ?? '';
    expect(firstLine.startsWith('# ')).toBe(true);
  });

  it('wraps each message in an h2 section', () => {
    const result = renderChunksToMarkdown(jsonl(
      HEADER,
      chunkLine([], humanMsg('h1', 'A'), {}),
      chunkLine([], aiChunk('a1', 'B'), {}),
    ));
    expect(result).toMatch(/## Human/);
    expect(result).toMatch(/## Assistant/);
  });

  it('renders the token usage footer with a horizontal rule separator', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('a1', 'Text', { input_tokens: 5, output_tokens: 10 }), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('---');
    expect(result).toContain('## Token Usage');
    expect(result).toContain('| Metric | Count |');
    expect(result).toContain('| Input Tokens | 5 |');
    expect(result).toContain('| Output Tokens | 10 |');
  });

  it('omits the token usage footer when no usage data is present', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], humanMsg('h1', 'No tokens here'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).not.toContain('## Token Usage');
  });

  it('aggregates usage_metadata across multiple messages', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('a1', 'First', { input_tokens: 3, output_tokens: 7 }), {}),
      chunkLine([], aiChunk('a2', 'Second', { input_tokens: 2, output_tokens: 4 }), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('| Input Tokens | 5 |');
    expect(result).toContain('| Output Tokens | 11 |');
  });
});

// ---------------------------------------------------------------------------
// Tests — array-shape chunk lines
// ---------------------------------------------------------------------------

describe('renderChunksToMarkdown — array-shape chunk lines', () => {
  it('parses array-shape [ns, msg, metadata] chunk lines', () => {
    const content = jsonl(
      HEADER,
      chunkLineArray([], aiChunk('a1', 'Array shape works'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('Array shape works');
  });
});

// ---------------------------------------------------------------------------
// Tests — missing header
// ---------------------------------------------------------------------------

describe('renderChunksToMarkdown — missing header', () => {
  it('renders data lines even when no valid header is present', () => {
    // No header line — just data.
    const content = jsonl(
      chunkLine([], humanMsg('h1', 'No header present'), {}),
    );
    const result = renderChunksToMarkdown(content);
    expect(result).toContain('No header present');
  });
});

// ===========================================================================
// renderChunksToDialogue tests
// ===========================================================================

// ---------------------------------------------------------------------------
// Additional builder helpers for dialogue tests
// ---------------------------------------------------------------------------

function systemMsg(id: string, text: string): Record<string, unknown> {
  return { type: 'SystemMessage', id, content: text };
}

function aiChunkWithNamedToolCall(
  msgId: string,
  toolName: string,
  toolId: string,
  argsJson: string,
): Record<string, unknown> {
  return {
    type: 'AIMessageChunk',
    id: msgId,
    content: '',
    tool_call_chunks: [{ index: 0, id: toolId, name: toolName, args: argsJson }],
  };
}

// ---------------------------------------------------------------------------
// describe: empty input
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — empty input', () => {
  it('returns a non-empty string ending in \\n for empty JSONL', () => {
    const result = renderChunksToDialogue('');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result.endsWith('\n')).toBe(true);
  });

  it('returns no-messages sentinel for empty JSONL', () => {
    const result = renderChunksToDialogue('');
    expect(result).toContain('*No dialogue recorded.*');
  });

  it('returns sentinel for header-only input', () => {
    const result = renderChunksToDialogue(HEADER + '\n');
    expect(result).toContain('*No dialogue recorded.*');
    expect(result.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describe: text rendering
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — text rendering', () => {
  it('renders AI text content as plain paragraphs with no ## heading', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('a1', 'Hello, this is a plain paragraph.'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Hello, this is a plain paragraph.');
    expect(result).not.toContain('## Assistant');
    expect(result).not.toContain('## ');
    expect(result).not.toContain('# Dialogue');
  });

  it('skips HumanMessage content from output', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], humanMsg('h1', 'This is a human message'), {}),
      chunkLine([], aiChunk('a1', 'AI response here'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).not.toContain('This is a human message');
    expect(result).toContain('AI response here');
  });

  it('skips SystemMessage content from output', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], systemMsg('s1', 'System prompt here'), {}),
      chunkLine([], aiChunk('a1', 'AI reply'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).not.toContain('System prompt here');
    expect(result).toContain('AI reply');
  });
});

// ---------------------------------------------------------------------------
// describe: file tools
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — file tools', () => {
  it('edit_file renders Tool call header with file link and no JSON block', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'edit_file', 'tc-1', '{"file_path":"/src/foo.ts","old_string":"x","new_string":"y"}'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `edit_file`');
    expect(result).toContain('↳ [foo.ts](/src/foo.ts)');
    expect(result).not.toContain('```json');
  });

  it('write_file renders Tool call header with file link', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'write_file', 'tc-2', '{"file_path":"/out/bar.md","content":"hello"}'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `write_file`');
    expect(result).toContain('↳ [bar.md](/out/bar.md)');
    expect(result).not.toContain('```json');
  });

  it('read_file renders Tool call header with file link', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'read_file', 'tc-3', '{"file_path":"/data/baz.json"}'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `read_file`');
    expect(result).toContain('↳ [baz.json](/data/baz.json)');
    expect(result).not.toContain('```json');
  });
});

// ---------------------------------------------------------------------------
// describe: execute tool
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — execute tool', () => {
  it('renders abbreviated command in a ↳ backtick line', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'execute', 'tc-ex', '{"command":"npm test"}'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `execute`');
    expect(result).toContain('↳ `npm test`');
  });

  it('strips leading cd … && prefix before abbreviating command', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'execute', 'tc-cd', '{"command":"cd /project && npm run build"}'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('↳ `npm run build`');
    expect(result).not.toContain('cd /project');
  });

  it('appends last output line with ✓ for exit code 0', () => {
    const toolResult = toolResultMsg('t1', 'BUILD SUCCESS\nAll tests passed\n[Command succeeded with exit code 0]', 'tc-ex');
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'execute', 'tc-ex', '{"command":"npm test"}'), {}),
      chunkLine([], toolResult, {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('All tests passed ✓');
  });

  it('appends last output line with ✗ for non-zero exit code', () => {
    const toolResult = toolResultMsg('t1', 'Error: build failed\n[Command failed with exit code 1]', 'tc-ex2');
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'execute', 'tc-ex2', '{"command":"npm run build"}'), {}),
      chunkLine([], toolResult, {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Error: build failed ✗');
  });

  it('omits result line when execute has no matching ToolMessage', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'execute', 'tc-noResult', '{"command":"ls -la"}'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `execute`');
    expect(result).toContain('↳ `ls -la`');
    // No second ↳ line with ✓ or ✗
    const lines = result.split('\n');
    const arrowLines = lines.filter(l => l.startsWith('↳'));
    expect(arrowLines).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// describe: tool results hidden
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — tool results hidden', () => {
  it('a non-execute ToolMessage produces no visible output', () => {
    const tcId = 'tc-read';
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'read_file', tcId, '{"file_path":"/x.ts"}'), {}),
      chunkLine([], toolResultMsg('t1', 'FILE CONTENT HERE: sensitive data', tcId), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).not.toContain('FILE CONTENT HERE');
    expect(result).not.toContain('sensitive data');
    // The tool call header should still appear.
    expect(result).toContain('Tool call: `read_file`');
  });

  it('a non-task non-execute ToolMessage is not shown even as a block', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'glob', 'tc-g', '{"pattern":"**/*.ts"}'), {}),
      chunkLine([], toolResultMsg('t1', '["/src/a.ts","/src/b.ts"]', 'tc-g'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).not.toContain('/src/a.ts');
    expect(result).not.toContain('/src/b.ts');
  });
});

// ---------------------------------------------------------------------------
// describe: write_todos tool
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — write_todos tool', () => {
  it('renders compact checklist with - [x] / - [ ] markers', () => {
    const todos = JSON.stringify({
      todos: [
        { content: 'Task A', status: 'completed' },
        { content: 'Task B', status: 'in_progress' },
        { content: 'Task C', status: 'pending' },
      ],
    });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'write_todos', 'tc-wt', todos), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `write_todos`');
    expect(result).toContain('- [x] Task A');
    expect(result).toContain('- [ ] Task B');
    expect(result).toContain('- [ ] Task C');
    expect(result).not.toContain('```json');
  });
});

// ---------------------------------------------------------------------------
// describe: task tool
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — task tool', () => {
  it('renders Sub-agent type from args', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'task', 'tc-task', '{"subagent_type":"general-purpose","description":"Do research"}'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `task`');
    expect(result).toContain('↳ Sub-agent: **general-purpose**');
  });

  it('renders first line of result when matching ToolMessage exists', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'task', 'tc-task2', '{"subagent_type":"general-purpose","description":"Search"}'), {}),
      chunkLine([], toolResultMsg('t1', 'Found 5 relevant files.\nSee /src/utils.ts for the main entry.', 'tc-task2'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('↳ Sub-agent: **general-purpose**');
    expect(result).toContain('↳ Found 5 relevant files.');
  });

  it('omits result line when task has no matching ToolMessage', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'task', 'tc-task3', '{"subagent_type":"general-purpose","description":"X"}'), {}),
    );
    const result = renderChunksToDialogue(content);
    const lines = result.split('\n');
    const arrowLines = lines.filter(l => l.startsWith('↳'));
    // Only the sub-agent type line, no result line.
    expect(arrowLines).toHaveLength(1);
    expect(arrowLines[0]).toContain('Sub-agent:');
  });
});

// ---------------------------------------------------------------------------
// describe: minimal tools (glob, grep, ls)
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — minimal tools', () => {
  it('glob renders only Tool call header with no ↳ detail line', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'glob', 'tc-gl', '{"pattern":"**/*.ts"}'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `glob`');
    expect(result).not.toContain('↳');
  });

  it('grep renders only Tool call header with no ↳ detail line', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'grep', 'tc-gr', '{"pattern":"TODO"}'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `grep`');
    expect(result).not.toContain('↳');
  });

  it('ls renders only Tool call header with no ↳ detail line', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ls', 'tc-ls', '{"path":"/src"}'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ls`');
    expect(result).not.toContain('↳');
  });
});

// ---------------------------------------------------------------------------
// describe: ledger workflow tools (mutations)
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — ledger workflow tools', () => {
  it('ledger_begin_work renders WP, type, and agent_role', () => {
    const args = JSON.stringify({ work_package_id: 'WP-001', type: 'implementation', agent_role: 'Developer' });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ledger_begin_work', 'tc-bw', args), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ledger_begin_work`');
    expect(result).toContain('↳ WP-001 — implementation (Developer)');
  });

  it('ledger_complete_pipeline renders WP, type, status, and first summary item', () => {
    const args = JSON.stringify({
      work_package_id: 'WP-002',
      type: 'qa',
      status: 'PASS',
      agent_role: 'QA',
      summary: ['All tests passed.', 'No regressions found.'],
    });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ledger_complete_pipeline', 'tc-cp', args), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ledger_complete_pipeline`');
    expect(result).toContain('↳ WP-002 qa → PASS');
    expect(result).toContain('↳ All tests passed.');
  });

  it('ledger_cancel_pipeline renders WP, type, and reason', () => {
    const args = JSON.stringify({ work_package_id: 'WP-003', type: 'implementation', reason: 'Stale pipeline detected' });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ledger_cancel_pipeline', 'tc-cpl', args), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ledger_cancel_pipeline`');
    expect(result).toContain('↳ WP-003 implementation — Stale pipeline detected');
  });

  it('ledger_claim_work_package renders WP → agent', () => {
    const args = JSON.stringify({ work_package_id: 'WP-004', agent: 'Developer' });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ledger_claim_work_package', 'tc-cwp', args), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ledger_claim_work_package`');
    expect(result).toContain('↳ WP-004 → Developer');
  });

  it('ledger_update_work_package_status renders WP → status', () => {
    const args = JSON.stringify({ work_package_id: 'WP-005', status: 'COMPLETE', agent: 'Documentation' });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ledger_update_work_package_status', 'tc-uwps', args), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ledger_update_work_package_status`');
    expect(result).toContain('↳ WP-005 → COMPLETE');
  });

  it('ledger_add_project_comment renders type, priority, and first note line', () => {
    const args = JSON.stringify({ type: 'incident', priority: 'high', agent: 'Developer', note: 'File write failed silently.\nNo error was thrown.' });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ledger_add_project_comment', 'tc-apc', args), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ledger_add_project_comment`');
    expect(result).toContain('↳ incident (high): File write failed silently.');
  });
});

// ---------------------------------------------------------------------------
// describe: ledger query tools
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — ledger query tools', () => {
  it('ledger_get_next_action renders agent_role', () => {
    const args = JSON.stringify({ agent_role: 'Developer' });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ledger_get_next_action', 'tc-gna', args), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ledger_get_next_action`');
    expect(result).toContain('↳ Developer');
  });

  it('ledger_get_work_package renders work_package_id', () => {
    const args = JSON.stringify({ work_package_id: 'WP-001' });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ledger_get_work_package', 'tc-gwp', args), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ledger_get_work_package`');
    expect(result).toContain('↳ WP-001');
  });

  it('ledger_get_handoff_status renders current_agent', () => {
    const args = JSON.stringify({ current_agent: 'QA' });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ledger_get_handoff_status', 'tc-ghs', args), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ledger_get_handoff_status`');
    expect(result).toContain('↳ QA');
  });

  it('ledger_get_project_status renders header only (no ↳ line)', () => {
    const args = JSON.stringify({ cwd_path: '/some/path' });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ledger_get_project_status', 'tc-gps', args), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ledger_get_project_status`');
    expect(result).not.toContain('↳');
  });

  it('ledger_list_work_packages renders header only (no ↳ line)', () => {
    const args = JSON.stringify({ cwd_path: '/some/path' });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ledger_list_work_packages', 'tc-lwp', args), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ledger_list_work_packages`');
    expect(result).not.toContain('↳');
  });

  it('ledger_search_insights renders the query string', () => {
    const args = JSON.stringify({ query: 'testing patterns TypeScript' });
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'ledger_search_insights', 'tc-si', args), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `ledger_search_insights`');
    expect(result).toContain('↳ "testing patterns TypeScript"');
  });
});

// ---------------------------------------------------------------------------
// describe: unknown tool
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — unknown tool', () => {
  it('unknown tool renders Tool call header and is always visible', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'some_mystery_tool', 'tc-unk', '{"x":1}'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `some_mystery_tool`');
  });

  it('unknown tool produces no ↳ detail line', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithNamedToolCall('a1', 'future_tool', 'tc-ft', '{"a":"b"}'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).not.toContain('↳');
  });
});

// ---------------------------------------------------------------------------
// describe: token merging
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — token merging', () => {
  it('reassembles multi-chunk tool call args correctly before rendering', () => {
    // Two AIMessageChunk lines with same id and partial args (input_json_delta).
    const chunk1: Record<string, unknown> = {
      type: 'AIMessageChunk',
      id: 'a-merge',
      content: '',
      tool_call_chunks: [{ index: 0, id: 'tc-merge', name: 'edit_file', args: '{"file_path":"/src/u' }],
    };
    const chunk2: Record<string, unknown> = {
      type: 'AIMessageChunk',
      id: 'a-merge',
      content: '',
      tool_call_chunks: [{ index: 0, id: null, name: null, args: 'tils.ts","old_string":"a","new_string":"b"}' }],
    };
    const content = jsonl(HEADER, chunkLine([], chunk1), chunkLine([], chunk2));
    const result = renderChunksToDialogue(content);
    expect(result).toContain('Tool call: `edit_file`');
    // Full path must be reconstructed correctly.
    expect(result).toContain('[utils.ts](/src/utils.ts)');
  });
});

// ---------------------------------------------------------------------------
// describe: sub-agents
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — sub-agents', () => {
  it('renders sub-agent block with ### Subagent: namespace heading', () => {
    const content = jsonl(
      HEADER,
      chunkLine(['subgraph_a', 'node_1'], aiChunk('s1', 'Sub-agent output here'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('### Subagent: subgraph_a/node_1');
    expect(result).toContain('Sub-agent output here');
  });

  it('renders main agent content before sub-agent content', () => {
    const content = jsonl(
      HEADER,
      chunkLine(['sub'], aiChunk('s1', 'Sub output'), {}),
      chunkLine([], aiChunk('m1', 'Main output'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result.indexOf('Main output')).toBeLessThan(result.indexOf('Sub output'));
  });

  it('renders multiple distinct sub-agent namespaces with separate headings', () => {
    const content = jsonl(
      HEADER,
      chunkLine(['agent_a'], aiChunk('a1', 'From A'), {}),
      chunkLine(['agent_b'], aiChunk('b1', 'From B'), {}),
    );
    const result = renderChunksToDialogue(content);
    expect(result).toContain('### Subagent: agent_a');
    expect(result).toContain('### Subagent: agent_b');
    expect(result).toContain('From A');
    expect(result).toContain('From B');
  });
});

// ---------------------------------------------------------------------------
// describe: regression — renderChunksToMarkdown is unaffected
// ---------------------------------------------------------------------------

describe('renderChunksToDialogue — regression', () => {
  it('does not affect renderChunksToMarkdown output', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('a1', 'Test message'), {}),
    );
    const dialogueResult = renderChunksToDialogue(content);
    const markdownResult = renderChunksToMarkdown(content);
    // Outputs must differ.
    expect(dialogueResult).not.toBe(markdownResult);
    // renderChunksToMarkdown still produces verbose format with ## headings.
    expect(markdownResult).toContain('## Assistant');
    expect(markdownResult).toContain('# Dialogue');
    // Dialogue result has no ## headings.
    expect(dialogueResult).not.toContain('## Assistant');
    expect(dialogueResult).not.toContain('# Dialogue');
    // Both contain the message text.
    expect(dialogueResult).toContain('Test message');
    expect(markdownResult).toContain('Test message');
  });
});
