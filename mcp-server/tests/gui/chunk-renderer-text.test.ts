/**
 * QA verification tests for renderChunksToText() — WP-002
 *
 * AC-1: renderChunksToText is exported from chunk-renderer.ts and callable
 *       with a JSONL string argument
 * AC-2: For single-namespace JSONL input, the returned string contains only
 *       assembled prose text from AI turns with no section headers, no tool
 *       call JSON, and no tool results
 * AC-3: For dual-namespace JSONL input (both ns.length === 0 and ns.length > 0
 *       entries), the returned string contains ## Outer Agent and ## Inner Agent
 *       section headers with prose beneath each
 * AC-4: When the input JSONL is empty or contains no AI text content, the
 *       function returns '*No dialogue recorded.*\n'
 * AC-5: The function is pure (no I/O, no side effects) — consistent with the
 *       existing renderers in the same module
 * AC-6: The return value is terminated with '\n'
 *
 * Edge cases:
 * EC-1: Multiple AI chunks with same id → text is concatenated (deduped)
 * EC-2: Malformed JSONL lines are skipped gracefully
 * EC-3: ToolMessages are not emitted as prose
 * EC-4: HumanMessages are not emitted as prose (dual-namespace with empty inner → sentinel)
 * EC-5: ContentBlock array content — only text blocks extracted (tool_use/input_json_delta filtered)
 * EC-6: Header-less JSONL (no chunk_format line) is accepted
 */

import { describe, it, expect } from 'vitest';
import { renderChunksToText } from '../../gui/chunk-renderer.js';

// ---------------------------------------------------------------------------
// Helpers (mirrors chunk-renderer.test.ts conventions)
// ---------------------------------------------------------------------------

const HEADER = JSON.stringify({ chunk_format: 1, stream_mode: 'messages', langgraph_stream_version: 'v2' });

function chunkLine(ns: string[], msg: Record<string, unknown>): string {
  return JSON.stringify({ ns, msg, metadata: {} });
}

function jsonl(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

function aiChunk(id: string, text: string): Record<string, unknown> {
  return { type: 'AIMessageChunk', id, content: text, tool_call_chunks: [] };
}

function aiChunkWithToolCall(
  id: string,
  toolName: string,
  toolId: string,
  argsPart: string,
): Record<string, unknown> {
  return {
    type: 'AIMessageChunk',
    id,
    content: '',
    tool_call_chunks: [{ index: 0, id: toolId, name: toolName, args: argsPart }],
  };
}

function humanMsg(id: string, text: string): Record<string, unknown> {
  return { type: 'HumanMessage', id, content: text };
}

function toolResultMsg(id: string, content: string, toolCallId: string): Record<string, unknown> {
  return { type: 'ToolMessage', id, content, tool_call_id: toolCallId };
}

// ---------------------------------------------------------------------------
// AC-1: Export and callability
// ---------------------------------------------------------------------------

describe('AC-1: renderChunksToText — exported and callable', () => {
  it('is a function exported from chunk-renderer', () => {
    expect(typeof renderChunksToText).toBe('function');
  });

  it('accepts a JSONL string argument and returns a string', () => {
    const result = renderChunksToText('');
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// AC-2: Single-namespace — prose only, no section headers, no tool calls
// ---------------------------------------------------------------------------

describe('AC-2: renderChunksToText — single-namespace input', () => {
  it('returns prose text from a single AI turn', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-1', 'Hello from the AI.')),
    );
    const result = renderChunksToText(content);
    expect(result).toContain('Hello from the AI.');
  });

  it('contains no ## section headers in single-namespace output', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-1', 'Just some prose.')),
    );
    const result = renderChunksToText(content);
    expect(result).not.toContain('##');
  });

  it('contains no tool call JSON in output', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithToolCall('ai-1', 'read_file', 'tc-1', '{"file_path":"/foo"}')),
      chunkLine([], toolResultMsg('tool-1', 'file contents', 'tc-1')),
    );
    const result = renderChunksToText(content);
    // The tool call has no text content, so the result should be the sentinel
    expect(result).toBe('*No dialogue recorded.*\n');
  });

  it('does not include tool result content in output', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-1', 'I will read the file.')),
      chunkLine([], aiChunkWithToolCall('ai-1', 'read_file', 'tc-1', '{"file_path":"/foo"}')),
      chunkLine([], toolResultMsg('tool-1', 'SECRET_TOOL_RESULT_CONTENT', 'tc-1')),
    );
    const result = renderChunksToText(content);
    expect(result).toContain('I will read the file.');
    expect(result).not.toContain('SECRET_TOOL_RESULT_CONTENT');
  });

  it('renders multiple AI turns separated by double newline', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-1', 'First turn.')),
      chunkLine([], humanMsg('h-1', 'User question')),
      chunkLine([], aiChunk('ai-2', 'Second turn.')),
    );
    const result = renderChunksToText(content);
    expect(result).toContain('First turn.');
    expect(result).toContain('Second turn.');
    expect(result).toContain('\n\n'); // turns separated by blank line
  });

  it('does not include Human message content in output', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], humanMsg('h-1', 'HUMAN_TEXT_SHOULD_NOT_APPEAR')),
      chunkLine([], aiChunk('ai-1', 'AI response.')),
    );
    const result = renderChunksToText(content);
    expect(result).not.toContain('HUMAN_TEXT_SHOULD_NOT_APPEAR');
    expect(result).toContain('AI response.');
  });
});

// ---------------------------------------------------------------------------
// AC-3: Dual-namespace — ## Outer Agent and ## Inner Agent headers
// ---------------------------------------------------------------------------

describe('AC-3: renderChunksToText — dual-namespace input', () => {
  it('includes ## Outer Agent section header', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-outer-1', 'Outer prose.')),
      chunkLine(['inner:abc123'], aiChunk('ai-inner-1', 'Inner prose.')),
    );
    const result = renderChunksToText(content);
    expect(result).toContain('## Outer Agent');
  });

  it('includes ## Inner Agent section header', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-outer-1', 'Outer prose.')),
      chunkLine(['inner:abc123'], aiChunk('ai-inner-1', 'Inner prose.')),
    );
    const result = renderChunksToText(content);
    expect(result).toContain('## Inner Agent');
  });

  it('places outer prose under ## Outer Agent section', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-outer-1', 'Outer prose here.')),
      chunkLine(['inner:abc123'], aiChunk('ai-inner-1', 'Inner prose here.')),
    );
    const result = renderChunksToText(content);
    const outerIdx = result.indexOf('## Outer Agent');
    const innerIdx = result.indexOf('## Inner Agent');
    const outerProseIdx = result.indexOf('Outer prose here.');
    expect(outerProseIdx).toBeGreaterThan(outerIdx);
    expect(outerProseIdx).toBeLessThan(innerIdx);
  });

  it('places inner prose under ## Inner Agent section', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-outer-1', 'Outer prose here.')),
      chunkLine(['inner:abc123'], aiChunk('ai-inner-1', 'Inner prose here.')),
    );
    const result = renderChunksToText(content);
    const innerIdx = result.indexOf('## Inner Agent');
    const innerProseIdx = result.indexOf('Inner prose here.');
    expect(innerProseIdx).toBeGreaterThan(innerIdx);
  });

  it('contains no tool call JSON in dual-namespace output', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-outer-1', 'Outer text.')),
      chunkLine([], aiChunkWithToolCall('ai-outer-1', 'execute', 'tc-1', '{"command":"ls"}')),
      chunkLine(['inner:abc123'], aiChunk('ai-inner-1', 'Inner text.')),
    );
    const result = renderChunksToText(content);
    expect(result).not.toContain('```json');
    expect(result).not.toContain('Tool call:');
  });
});

// ---------------------------------------------------------------------------
// AC-4: Empty or no-AI-text input → '*No dialogue recorded.*\n'
// ---------------------------------------------------------------------------

describe('AC-4: renderChunksToText — empty or no-AI-text input', () => {
  it('returns sentinel for completely empty string', () => {
    expect(renderChunksToText('')).toBe('*No dialogue recorded.*\n');
  });

  it('returns sentinel for whitespace-only string', () => {
    expect(renderChunksToText('   \n\n   ')).toBe('*No dialogue recorded.*\n');
  });

  it('returns sentinel for header-only JSONL', () => {
    expect(renderChunksToText(HEADER + '\n')).toBe('*No dialogue recorded.*\n');
  });

  it('returns sentinel when only human messages present', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], humanMsg('h-1', 'Just a human message.')),
    );
    expect(renderChunksToText(content)).toBe('*No dialogue recorded.*\n');
  });

  it('returns sentinel when only tool result messages present', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], toolResultMsg('tool-1', 'result content', 'tc-1')),
    );
    expect(renderChunksToText(content)).toBe('*No dialogue recorded.*\n');
  });

  it('returns sentinel when AI message has no text content (only tool calls)', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithToolCall('ai-1', 'execute', 'tc-1', '{"command":"ls"}')),
    );
    expect(renderChunksToText(content)).toBe('*No dialogue recorded.*\n');
  });

  it('returns sentinel for dual-namespace with all-empty text', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunkWithToolCall('ai-1', 'execute', 'tc-1', '{"command":"ls"}')),
      chunkLine(['inner:abc123'], aiChunkWithToolCall('ai-2', 'ls', 'tc-2', '{}')),
    );
    expect(renderChunksToText(content)).toBe('*No dialogue recorded.*\n');
  });
});

// ---------------------------------------------------------------------------
// AC-5: Purity — no side effects
// ---------------------------------------------------------------------------

describe('AC-5: renderChunksToText — pure function, no side effects', () => {
  it('returns the same result on repeated calls with the same input', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-1', 'Deterministic output.')),
    );
    const r1 = renderChunksToText(content);
    const r2 = renderChunksToText(content);
    expect(r1).toBe(r2);
  });

  it('does not mutate the input string', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-1', 'Some text.')),
    );
    const original = content;
    renderChunksToText(content);
    expect(content).toBe(original);
  });

  it('independent calls do not share state', () => {
    const a = jsonl(HEADER, chunkLine([], aiChunk('ai-1', 'Alpha.')));
    const b = jsonl(HEADER, chunkLine([], aiChunk('ai-1', 'Beta.')));
    const ra = renderChunksToText(a);
    const rb = renderChunksToText(b);
    expect(ra).toContain('Alpha.');
    expect(rb).toContain('Beta.');
    expect(ra).not.toContain('Beta.');
    expect(rb).not.toContain('Alpha.');
  });
});

// ---------------------------------------------------------------------------
// AC-6: Return value always ends with '\n'
// ---------------------------------------------------------------------------

describe('AC-6: renderChunksToText — return value terminated with \\n', () => {
  it('sentinel value ends with \\n', () => {
    expect(renderChunksToText('')).toMatch(/\n$/);
  });

  it('single-namespace output ends with \\n', () => {
    const content = jsonl(HEADER, chunkLine([], aiChunk('ai-1', 'Text.')));
    expect(renderChunksToText(content)).toMatch(/\n$/);
  });

  it('dual-namespace output ends with \\n', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-1', 'Outer.')),
      chunkLine(['inner:abc123'], aiChunk('ai-2', 'Inner.')),
    );
    expect(renderChunksToText(content)).toMatch(/\n$/);
  });

  it('output does not end with multiple consecutive newlines', () => {
    const content = jsonl(HEADER, chunkLine([], aiChunk('ai-1', 'Text.')));
    expect(renderChunksToText(content)).not.toMatch(/\n\n$/);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('EC: renderChunksToText — edge cases', () => {
  it('EC-1: AI chunks with same id are merged (text concatenated)', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-1', 'Part one. ')),
      chunkLine([], aiChunk('ai-1', 'Part two.')),
    );
    const result = renderChunksToText(content);
    // Both text parts should appear (concatenated in one merged message)
    expect(result).toContain('Part one.');
    expect(result).toContain('Part two.');
    // Should not have two separate paragraphs for the same id
    expect(result).not.toContain('\n\n'); // single message → no double newline between turns
  });

  it('EC-2: Malformed JSONL lines are skipped gracefully', () => {
    const content = jsonl(
      HEADER,
      'THIS IS NOT VALID JSON !!!',
      chunkLine([], aiChunk('ai-1', 'Valid turn.')),
    );
    const result = renderChunksToText(content);
    expect(result).toContain('Valid turn.');
  });

  it('EC-3: ToolMessages never appear in text output', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-1', 'AI says hello.')),
      chunkLine([], toolResultMsg('tool-1', 'TOOL_OUTPUT_CONTENT', 'tc-1')),
    );
    const result = renderChunksToText(content);
    expect(result).not.toContain('TOOL_OUTPUT_CONTENT');
  });

  it('EC-4: dual-namespace with empty inner → inner section gets its own sentinel', () => {
    const content = jsonl(
      HEADER,
      chunkLine([], aiChunk('ai-outer-1', 'Outer has text.')),
      // Inner agent only has a tool call, no text
      chunkLine(['inner:abc123'], aiChunkWithToolCall('ai-inner-1', 'ls', 'tc-1', '{}')),
    );
    const result = renderChunksToText(content);
    // Both section headers must be present
    expect(result).toContain('## Outer Agent');
    expect(result).toContain('## Inner Agent');
    // Outer text is present
    expect(result).toContain('Outer has text.');
    // Inner section gets a sentinel (not empty)
    expect(result).toContain('*No dialogue recorded.*');
    // Entire output ends with \n
    expect(result).toMatch(/\n$/);
  });

  it('EC-5: ContentBlock array content — only text blocks extracted', () => {
    // AI message with content as array of blocks (text + tool_use)
    const aiMsg: Record<string, unknown> = {
      type: 'AIMessageChunk',
      id: 'ai-1',
      content: [
        { type: 'text', text: 'Prose from block.' },
        { type: 'tool_use', id: 'tc-1', name: 'ls', input: {} },
        { type: 'input_json_delta', partial_json: '{}' },
      ],
      tool_call_chunks: [],
    };
    const content = jsonl(HEADER, chunkLine([], aiMsg));
    const result = renderChunksToText(content);
    expect(result).toContain('Prose from block.');
    expect(result).not.toContain('tool_use');
    expect(result).not.toContain('input_json_delta');
  });

  it('EC-6: header-less JSONL (no chunk_format line) is accepted', () => {
    // Without a HEADER line, all lines are treated as data
    const content = jsonl(chunkLine([], aiChunk('ai-1', 'No header, still works.')));
    const result = renderChunksToText(content);
    expect(result).toContain('No header, still works.');
  });
});
