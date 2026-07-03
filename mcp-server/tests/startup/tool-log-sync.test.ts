import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths relative to this test file (tests/startup/ → two levels up → mcp-server/)
const srcDir = join(__dirname, '..', '..', 'src');
const toolsDir = join(srcDir, 'tools');
const indexPath = join(srcDir, 'index.ts');

/**
 * Data-only module — exports no register() function and contains no
 * server.registerTool() calls. Excluded from the source scan.
 */
const EXCLUDED_TOOL_FILES = new Set(['help-content.ts']);

describe('Startup tool log sync', () => {
  it('startup log contains exactly the set of registered tool names', () => {
    // ── 1. Extract tool names from the startup log in src/index.ts ─────────
    const indexSource = readFileSync(indexPath, 'utf8');
    const logMatch = indexSource.match(/Registered tools:\s*([^']+)'/);
    expect(
      logMatch,
      'Could not locate the "Registered tools:" line in src/index.ts'
    ).toBeTruthy();

    const logTools = new Set(
      logMatch![1].split(',').map(t => t.trim()).filter(Boolean)
    );

    // ── 2. Collect tool names from all registration modules ─────────────────
    const toolFiles = readdirSync(toolsDir)
      .filter(f => f.endsWith('.ts') && !EXCLUDED_TOOL_FILES.has(f));

    const registeredTools = new Set<string>();
    for (const file of toolFiles) {
      const source = readFileSync(join(toolsDir, file), 'utf8');
      // Pattern: server.registerTool(\n    'tool_name',
      const toolPattern = /server\.registerTool\(\s*'([^']+)'/g;
      let match: RegExpExecArray | null;
      while ((match = toolPattern.exec(source)) !== null) {
        registeredTools.add(match[1]);
      }
    }

    // ── 3. Diff and assert ──────────────────────────────────────────────────
    const missingFromLog = [...registeredTools].filter(t => !logTools.has(t)).sort();
    const extraInLog     = [...logTools].filter(t => !registeredTools.has(t)).sort();

    expect(
      missingFromLog,
      `Tools registered in src/tools/ but MISSING from the startup log:\n  ${missingFromLog.join('\n  ')}`
    ).toEqual([]);

    expect(
      extraInLog,
      `Tools listed in startup log but NOT registered in src/tools/:\n  ${extraInLog.join('\n  ')}`
    ).toEqual([]);
  });
});
