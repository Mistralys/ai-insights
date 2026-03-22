import { describe, it, expect } from 'vitest';
import { classifyRunner } from '../../src/utils/runner.js';

describe('classifyRunner', () => {

  // --- Acceptance criterion 1: langchain-mcp-adapters ---
  it('classifies langchain-mcp-adapters as orchestrator (AC1)', () => {
    const result = classifyRunner({ name: 'langchain-mcp-adapters', version: '1.0' });
    expect(result).toEqual({
      runner: 'orchestrator',
      runner_client: 'langchain-mcp-adapters',
      runner_version: '1.0',
    });
  });

  // --- Acceptance criterion 2: Visual Studio Code ---
  it('classifies Visual Studio Code as vscode (AC2)', () => {
    const result = classifyRunner({ name: 'Visual Studio Code', version: '1.99' });
    expect(result).toEqual({
      runner: 'vscode',
      runner_client: 'Visual Studio Code',
      runner_version: '1.99',
    });
  });

  // --- Acceptance criterion 3: claude-code ---
  it('classifies claude-code as claude-code (AC3)', () => {
    const result = classifyRunner({ name: 'claude-code', version: '0.2' });
    expect(result).toEqual({
      runner: 'claude-code',
      runner_client: 'claude-code',
      runner_version: '0.2',
    });
  });

  // --- Acceptance criterion 4: undefined input ---
  it('returns unknown runner for undefined input without throwing (AC4)', () => {
    const result = classifyRunner(undefined);
    expect(result).toEqual({ runner: 'unknown', runner_client: '', runner_version: '' });
  });

  // --- Additional edge cases ---
  it('classifies lowercase vscode as vscode', () => {
    expect(classifyRunner({ name: 'vscode', version: '1.0' }).runner).toBe('vscode');
  });

  it('classifies Visual Studio Code (case insensitive) as vscode', () => {
    expect(classifyRunner({ name: 'visual studio code extension host', version: '1.0' }).runner).toBe('vscode');
  });

  it('classifies Claude (uppercase C) as claude-code', () => {
    expect(classifyRunner({ name: 'Claude', version: '3.5' }).runner).toBe('claude-code');
  });

  it('classifies langchain variants as orchestrator', () => {
    expect(classifyRunner({ name: 'langchain-core', version: '0.1' }).runner).toBe('orchestrator');
    expect(classifyRunner({ name: 'mcp-adapters-py', version: '0.1' }).runner).toBe('orchestrator');
  });

  it('classifies unknown clients as unknown', () => {
    expect(classifyRunner({ name: 'cursor', version: '0.1' }).runner).toBe('unknown');
    expect(classifyRunner({ name: '', version: '' }).runner).toBe('unknown');
  });

  it('preserves raw name and version in runner_client and runner_version', () => {
    const r = classifyRunner({ name: 'My Custom Client', version: '2.0.1' });
    expect(r.runner_client).toBe('My Custom Client');
    expect(r.runner_version).toBe('2.0.1');
    expect(r.runner).toBe('unknown');
  });
});
