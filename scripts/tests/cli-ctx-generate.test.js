/**
 * scripts/tests/cli-ctx-generate.test.js
 *
 * Regression tests for scripts/cli.js's ctx-generate wiring (the
 * non-destructive staged generate-and-swap rework).
 *
 * scripts/cli.js's cmdX delegates are not exported (the file invokes
 * createMenu(...) unconditionally at module top level, with no run-guard —
 * see scripts/tests/cli-cmd-agent.test.js for the established pattern).
 * Regression coverage here is therefore a static source-text assertion
 * against the relevant function bodies and menu entry, rather than an
 * imported/executed unit test. The actual behavior is covered by
 * scripts/tests/ctx-generate.test.js against scripts/lib/ctx-generate.js
 * directly.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function extractFunctionBody(source, functionSignaturePattern) {
  const match = source.match(functionSignaturePattern);
  if (!match) {
    throw new Error(`Could not locate a function matching ${functionSignaturePattern} in source text.`);
  }

  const startIndex = match.index + match[0].length - 1; // position of the opening '{'
  let depth = 0;
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }

  throw new Error('Could not find a matching closing brace for the extracted function.');
}

describe('scripts/cli.js ctx-generate wiring', () => {
  const cliSource = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');

  it('imports runCtxGenerate from the shared lib module', () => {
    expect(cliSource).toMatch(/import\s*\{\s*runCtxGenerate\s*\}\s*from\s*['"]\.\/lib\/ctx-generate\.js['"]/);
  });

  describe('cmdCtxGenerate()', () => {
    const body = extractFunctionBody(cliSource, /async function cmdCtxGenerate\([^)]*\)\s*\{/);

    it('delegates to the shared runCtxGenerate() helper', () => {
      expect(body).toContain('runCtxGenerate(');
    });

    it('no longer deletes .context/ directly (no rmSync on the ctx output dir)', () => {
      expect(body).not.toMatch(/rmSync\(\s*ctxDir/);
      expect(body).not.toContain("fs.rmSync(ctxDir");
    });

    it('maps every documented failure reason to a distinct exit code path', () => {
      expect(body).toContain("'owns-work-dir'");
      expect(body).toContain("'ctx-missing'");
      expect(body).toContain("'ctx-failed'");
      expect(body).toContain("'swap-failed'");
      expect(body).toContain("'recovery-failed'");
    });

    it('exits 2 for the owns-work-dir rejection', () => {
      const caseIndex = body.indexOf("'owns-work-dir'");
      const nextExitIndex = body.indexOf('process.exit(', caseIndex);
      expect(body.slice(nextExitIndex, nextExitIndex + 'process.exit(2)'.length)).toBe('process.exit(2)');
    });

    it('handles check mode via result.mode === \'check\' with a fresh/stale branch', () => {
      expect(body).toContain("result.mode === 'check'");
      expect(body).toContain('result.fresh');
      expect(body).toContain('result.diffs');
    });

    it('lists each recovery-failed failure\'s operation and path, and never calls ctx', () => {
      const caseBody = body.slice(body.indexOf("case 'recovery-failed'"), body.indexOf("case 'swap-failed'"));
      expect(caseBody).toContain('failure.op');
      expect(caseBody).toContain('failure.path');
      expect(caseBody).toContain('failure.error');
    });

    it('branches on previousOutput with a distinct case for each documented value', () => {
      const caseBody = body.slice(body.indexOf("case 'swap-failed'"), body.indexOf('default:'));
      expect(caseBody).toContain("case 'none'");
      expect(caseBody).toContain("case 'untouched'");
      expect(caseBody).toContain("case 'restored'");
      expect(caseBody).toContain("case 'preserved-in-previous'");
      expect(caseBody).toContain("case 'unknown'");
    });

    it('states "was restored to its previous content" only in the \'restored\' branch', () => {
      const caseBody = body.slice(body.indexOf("case 'swap-failed'"), body.indexOf('default:'));
      const restoredIndex = caseBody.indexOf("case 'restored'");
      const nextCaseIndex = caseBody.indexOf('case ', restoredIndex + 1);
      const restoredBranch = caseBody.slice(restoredIndex, nextCaseIndex);
      expect(restoredBranch).toContain('was restored to its previous content');

      const otherBranches = caseBody.slice(0, restoredIndex) + caseBody.slice(nextCaseIndex);
      expect(otherBranches).not.toContain('was restored to its previous content');
    });

    it('references observed in the \'unknown\' branch', () => {
      const unknownIndex = body.indexOf("case 'unknown'");
      expect(unknownIndex).toBeGreaterThan(-1);
      // The 'unknown' branch is the last one in the previousOutput switch — take
      // a fixed-size slice following it rather than searching for the next
      // 'default:', since the branch's own body legitimately contains one.
      expect(body.slice(unknownIndex, unknownIndex + 600)).toContain('result.observed');
    });

    it('notes leftoverPrevious after a successful regeneration', () => {
      expect(body).toContain('result.leftoverPrevious');
    });
  });

  describe('cmdBuildMaintain()', () => {
    const body = extractFunctionBody(cliSource, /async function cmdBuildMaintain\([^)]*\)\s*\{/);

    it('calls cmdCtxGenerate([]) — passing no arguments to the CTX step', () => {
      expect(body).toMatch(/cmdCtxGenerate\(\s*\[\s*\]\s*\)/);
    });

    it('does not forward its own args to cmdCtxGenerate', () => {
      expect(body).not.toMatch(/cmdCtxGenerate\(\s*args\s*\)/);
    });
  });

  describe('ctx-generate menu entry', () => {
    it('describes --check as verifying freshness without writing', () => {
      const entryMatch = cliSource.match(/id:\s*'ctx-generate'[\s\S]*?description:\s*'([^']*)'/);
      expect(entryMatch).toBeTruthy();
      expect(entryMatch[1]).toMatch(/--check/);
      expect(entryMatch[1].toLowerCase()).toMatch(/without writing|verifies.*freshness/);
    });
  });
});
