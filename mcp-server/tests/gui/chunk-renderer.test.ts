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
import { renderChunksToMarkdown } from '../../gui/chunk-renderer.js';

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
