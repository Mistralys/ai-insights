/**
 * scripts/tests/browser-tool.test.js
 *
 * Unit tests for scripts/lib/browser-tool.js and the shim entry declared in
 * the workspace root package.json, including the shim's guards (named
 * session incl. `attach <name>`, output directory, absolute file paths,
 * teardown --force, help path rewrite).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs   from 'fs';
import os   from 'os';
import path from 'path';
import {
  BROWSER_COMMAND,
  getBrowserCliEntry,
  isBrowserToolInstalled,
  isBrowserShimOnPath,
  areBrowsersInstalled,
  parseBrowserArgs,
  browserOutputDir,
  prepareBrowserInvocation,
  resolveBrowserSession,
  absolutizeHelpOutput,
} from '../lib/browser-tool.js';
import { spawnSync } from 'child_process';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-tool-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function fakeInstall(dir, bin = { 'playwright-cli': 'cli.js' }, writeEntry = true) {
  const pkgDir = path.join(dir, 'node_modules', '@playwright', 'cli');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@playwright/cli', bin }));
  if (writeEntry) fs.writeFileSync(path.join(pkgDir, 'cli.js'), '');
  return pkgDir;
}

describe('getBrowserCliEntry / isBrowserToolInstalled', () => {
  it('returns null when nothing is installed', () => {
    expect(getBrowserCliEntry(tmp)).toBeNull();
    expect(isBrowserToolInstalled(tmp)).toBe(false);
  });

  it('resolves the entry script from the package bin field', () => {
    const pkgDir = fakeInstall(tmp);
    expect(getBrowserCliEntry(tmp)).toBe(path.join(pkgDir, 'cli.js'));
    expect(isBrowserToolInstalled(tmp)).toBe(true);
  });

  it('accepts a string bin field', () => {
    const pkgDir = fakeInstall(tmp, 'cli.js');
    expect(getBrowserCliEntry(tmp)).toBe(path.join(pkgDir, 'cli.js'));
  });

  it('returns null when the declared entry file is missing', () => {
    fakeInstall(tmp, { 'playwright-cli': 'cli.js' }, false);
    expect(getBrowserCliEntry(tmp)).toBeNull();
  });
});

describe('isBrowserShimOnPath', () => {
  it('finds the command in a PATH directory', () => {
    const file = process.platform === 'win32' ? `${BROWSER_COMMAND}.cmd` : BROWSER_COMMAND;
    fs.writeFileSync(path.join(tmp, file), '');
    expect(isBrowserShimOnPath({ pathEnv: tmp, pathExt: '.CMD' })).toBe(true);
  });

  it('is false when the command is absent from PATH', () => {
    expect(isBrowserShimOnPath({ pathEnv: tmp, pathExt: '.CMD' })).toBe(false);
  });

  it('is false for an empty PATH', () => {
    expect(isBrowserShimOnPath({ pathEnv: '' })).toBe(false);
  });
});

describe('areBrowsersInstalled', () => {
  it('detects a chromium build in PLAYWRIGHT_BROWSERS_PATH', () => {
    fs.mkdirSync(path.join(tmp, 'chromium-1234'));
    expect(areBrowsersInstalled({ env: { PLAYWRIGHT_BROWSERS_PATH: tmp } })).toBe(true);
  });

  it('ignores non-chromium builds', () => {
    fs.mkdirSync(path.join(tmp, 'firefox-1234'));
    expect(areBrowsersInstalled({ env: { PLAYWRIGHT_BROWSERS_PATH: tmp } })).toBe(false);
  });

  it('is false when the browsers directory does not exist', () => {
    expect(areBrowsersInstalled({ env: { PLAYWRIGHT_BROWSERS_PATH: path.join(tmp, 'nope') } })).toBe(false);
  });
});

describe('global command registration', () => {
  it('declares the shim as a bin entry of the workspace package', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(WORKSPACE_ROOT, 'package.json'), 'utf8'));
    expect(pkg.bin[BROWSER_COMMAND]).toBe('./scripts/ai-insights-browser.js');
    expect(fs.existsSync(path.join(WORKSPACE_ROOT, 'scripts', 'ai-insights-browser.js'))).toBe(true);
  });

  it('keeps the tool dependency in tools/browser, not in the root package', () => {
    const tool = JSON.parse(fs.readFileSync(path.join(WORKSPACE_ROOT, 'tools', 'browser', 'package.json'), 'utf8'));
    expect(tool.dependencies).toHaveProperty('@playwright/cli');
    const root = JSON.parse(fs.readFileSync(path.join(WORKSPACE_ROOT, 'package.json'), 'utf8'));
    expect(root.dependencies ?? {}).not.toHaveProperty('@playwright/cli');
  });
});

describe('parseBrowserArgs', () => {
  it.each([
    [['-s=one', 'open'], 'one'],
    [['-s', 'two', 'open'], 'two'],
    [['--session=three', 'open'], 'three'],
    [['--session', 'four', 'open'], 'four'],
    [['open', 'http://x', '-s=late'], 'late'],
  ])('reads the session from %j', (argv, session) => {
    const parsed = parseBrowserArgs(argv);
    expect(parsed.session).toBe(session);
    expect(parsed.command).toBe('open');
  });

  it('treats an empty or missing session value as no session', () => {
    expect(parseBrowserArgs(['-s=', 'open']).session).toBeNull();
    expect(parseBrowserArgs(['open', '-s']).session).toBeNull();
    expect(parseBrowserArgs(['-s', '--json', 'open']).session).toBeNull();
  });

  it('takes the first positional argument as the command, skipping the session value', () => {
    expect(parseBrowserArgs(['-s', 'mine', 'snapshot']).command).toBe('snapshot');
    expect(parseBrowserArgs(['--json', 'list']).command).toBe('list');
    expect(parseBrowserArgs([]).command).toBeNull();
  });

  it('detects --help and --version anywhere', () => {
    expect(parseBrowserArgs(['open', '--help']).help).toBe(true);
    expect(parseBrowserArgs(['--version']).version).toBe(true);
  });

  it('stops parsing at --', () => {
    expect(parseBrowserArgs(['eval', '--', '-s=x']).session).toBeNull();
  });

  it('collects the operands after the command', () => {
    expect(parseBrowserArgs(['-s=a', 'fill', 'e1', 'hello']).operands).toEqual(['e1', 'hello']);
    expect(parseBrowserArgs(['attach', 'my-browser']).operands).toEqual(['my-browser']);
    expect(parseBrowserArgs(['--json', 'attach', 'my-browser', '--raw']).operands).toEqual(['my-browser']);
  });

  it('does not take an option value as an operand', () => {
    expect(parseBrowserArgs(['attach', '--cdp', 'chrome']).operands).toEqual([]);
    expect(parseBrowserArgs(['attach', '--cdp=chrome']).operands).toEqual([]);
    expect(parseBrowserArgs(['attach', '--extension', 'chrome']).operands).toEqual([]);
    expect(parseBrowserArgs(['attach', 'my-browser', '--idle-timeout', '500']).operands).toEqual(['my-browser']);
  });
});

describe('resolveBrowserSession', () => {
  const resolve = (argv, env = {}) => resolveBrowserSession(parseBrowserArgs(argv), env);

  it('uses the attach name when no session is set', () => {
    expect(resolve(['attach', 'my-browser'])).toBe('my-browser');
  });

  it('prefers the session option and PLAYWRIGHT_CLI_SESSION over the attach name', () => {
    expect(resolve(['-s=opt', 'attach', 'my-browser'])).toBe('opt');
    expect(resolve(['attach', 'my-browser'], { PLAYWRIGHT_CLI_SESSION: 'env' })).toBe('env');
  });

  it('ignores the first operand of other commands', () => {
    expect(resolve(['goto', 'http://x'])).toBeNull();
  });

  it('is null for attach without a name', () => {
    expect(resolve(['attach', '--cdp=chrome'])).toBeNull();
    expect(resolve(['attach', ''])).toBeNull();
  });
});

describe('browserOutputDir', () => {
  it('places the session under {tmp}/ai-insights-browser/', () => {
    expect(browserOutputDir('my-task', tmp)).toBe(path.join(tmp, BROWSER_COMMAND, 'my-task'));
  });

  it('keeps unsafe session names inside the base directory', () => {
    const base = path.join(tmp, BROWSER_COMMAND);
    for (const name of ['../escape', '..', '.', 'a/b\\c', '']) {
      expect(path.dirname(browserOutputDir(name, tmp))).toBe(base);
    }
  });
});

describe('prepareBrowserInvocation', () => {
  const run = (argv, env = {}) => prepareBrowserInvocation({ argv, env, tmpDir: tmp });

  describe('named session requirement', () => {
    it('refuses a session command without a session name', () => {
      const r = run(['open', 'http://localhost']);
      expect(r.ok).toBe(false);
      expect(r.message).toContain('shared by every');
      expect(r.message).toContain('-s=my-task');
      expect(r.message).toContain('PLAYWRIGHT_CLI_SESSION');
      expect(r.message).toContain('-s=default');
    });

    it('accepts each session option form', () => {
      for (const argv of [['-s=a', 'open'], ['-s', 'a', 'open'], ['--session=a', 'open'], ['--session', 'a', 'open']]) {
        expect(run(argv).ok).toBe(true);
      }
    });

    it('accepts PLAYWRIGHT_CLI_SESSION', () => {
      const r = run(['snapshot'], { PLAYWRIGHT_CLI_SESSION: 'env-task' });
      expect(r.ok).toBe(true);
      expect(r.outputDir).toBe(path.join(tmp, BROWSER_COMMAND, 'env-task'));
    });

    it('lets an explicit -s=default opt into the shared session', () => {
      const r = run(['-s=default', 'open']);
      expect(r.ok).toBe(true);
      expect(r.args).toEqual(['-s=default', 'open']);
    });

    it.each([[['attach', 'my-browser']], [['attach', 'my-browser', '--idle-timeout=0']], [['--json', 'attach', 'b1']]])(
      'accepts %j as a named session',
      (argv) => { expect(run(argv).ok).toBe(true); },
    );

    it('keys the output directory on the attach name', () => {
      expect(run(['attach', 'my-browser']).outputDir).toBe(path.join(tmp, BROWSER_COMMAND, 'my-browser'));
    });

    it.each([[['attach', '--cdp=chrome']], [['attach', '--cdp', 'chrome']], [['attach', '--extension']], [['attach']]])(
      'refuses %j, which falls back to the shared session',
      (argv) => {
        const r = run(argv);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('no session named');
      },
    );

    it.each([[['--help']], [['open', '--help']], [['--version']], [['list']], [[]], [['install-browser', 'chromium']]])(
      'exempts %j',
      (argv) => { expect(run(argv).ok).toBe(true); },
    );
  });

  describe('output directory', () => {
    it('sets PLAYWRIGHT_MCP_OUTPUT_DIR to the per-session temp directory', () => {
      const r = run(['-s=t1', 'open']);
      expect(r.env.PLAYWRIGHT_MCP_OUTPUT_DIR).toBe(path.join(tmp, BROWSER_COMMAND, 't1'));
      expect(r.outputDir).toBe(r.env.PLAYWRIGHT_MCP_OUTPUT_DIR);
    });

    it('never overrides a caller-set PLAYWRIGHT_MCP_OUTPUT_DIR', () => {
      const r = run(['-s=t1', 'open'], { PLAYWRIGHT_MCP_OUTPUT_DIR: '/mine' });
      expect(r.env.PLAYWRIGHT_MCP_OUTPUT_DIR).toBe('/mine');
    });

    it('prefers the session option over PLAYWRIGHT_CLI_SESSION', () => {
      const r = run(['-s=opt', 'open'], { PLAYWRIGHT_CLI_SESSION: 'env' });
      expect(r.outputDir).toBe(path.join(tmp, BROWSER_COMMAND, 'opt'));
    });

    it('keeps the rest of the environment and forwards args unchanged', () => {
      const r = run(['-s=t1', 'fill', 'e1', 'hello'], { FOO: 'bar' });
      expect(r.env.FOO).toBe('bar');
      expect(r.args).toEqual(['-s=t1', 'fill', 'e1', 'hello']);
    });
  });

  describe('file paths', () => {
    it('defaults PLAYWRIGHT_MCP_FILE_PATHS to absolute', () => {
      expect(run(['-s=t1', 'open']).env.PLAYWRIGHT_MCP_FILE_PATHS).toBe('absolute');
      expect(run(['attach', 'b1']).env.PLAYWRIGHT_MCP_FILE_PATHS).toBe('absolute');
    });

    it('never overrides a caller-set PLAYWRIGHT_MCP_FILE_PATHS', () => {
      const r = run(['-s=t1', 'open'], { PLAYWRIGHT_MCP_FILE_PATHS: 'relative' });
      expect(r.env.PLAYWRIGHT_MCP_FILE_PATHS).toBe('relative');
    });

    it('flags global help for the Agent skill rewrite, and nothing else', () => {
      expect(run(['--help']).rewriteHelp).toBe(true);
      expect(run([]).rewriteHelp).toBe(true);
      expect(run(['--json', '--help']).rewriteHelp).toBe(true);
      expect(run(['--version']).rewriteHelp).toBe(false);
      expect(run(['-s=t1', 'snapshot']).rewriteHelp).toBe(false);
    });
  });

  describe('teardown guard', () => {
    it.each(['close-all', 'kill-all'])('refuses %s without --force', (cmd) => {
      const r = run([cmd]);
      expect(r.ok).toBe(false);
      expect(r.message).toContain(`"${cmd}" ends every browser session`);
      expect(r.message).toContain(`${cmd} --force`);
    });

    it.each(['close-all', 'kill-all'])('forwards %s with --force stripped, without needing a session', (cmd) => {
      const r = run([cmd, '--force']);
      expect(r.ok).toBe(true);
      expect(r.args).toEqual([cmd]);
    });

    it('leaves --force alone on other commands', () => {
      expect(run(['-s=a', 'close', '--force']).args).toEqual(['-s=a', 'close', '--force']);
    });

    it('does not guard help for a teardown command', () => {
      expect(run(['--help', 'close-all']).ok).toBe(true);
    });
  });
});

describe('absolutizeHelpOutput', () => {
  const cwd = path.join(os.tmpdir(), 'work');
  const rel = path.join('..', 'tools', 'SKILL.md');
  const abs = path.resolve(cwd, rel);
  const NL  = '\n';

  it('makes the Agent skill path absolute in text help', () => {
    const out = ['playwright-cli - x', '', `Agent skill: ${rel}`, '', 'Usage: y', ''].join(NL);
    const expected = ['playwright-cli - x', '', `Agent skill: ${abs}`, '', 'Usage: y', ''].join(NL);
    expect(absolutizeHelpOutput(out, cwd)).toBe(expected);
  });

  it('keeps CRLF line endings', () => {
    const out = [`Agent skill: ${rel}`, 'Usage', ''].join('\r\n');
    expect(absolutizeHelpOutput(out, cwd)).toBe([`Agent skill: ${abs}`, 'Usage', ''].join('\r\n'));
  });

  it("rewrites the path inside --json help, in the CLI's 2-space format", () => {
    const help = (file) => ['x', '', `Agent skill: ${file}`, '', 'Usage'].join(NL);
    const out = JSON.stringify({ help: help(rel) }, null, 2) + NL;
    const expected = JSON.stringify({ help: help(abs) }, null, 2) + NL;
    expect(absolutizeHelpOutput(out, cwd)).toBe(expected);
  });

  it('leaves output without an Agent skill line untouched', () => {
    const json = JSON.stringify({ help: 'Usage' }, null, 2) + NL;
    expect(absolutizeHelpOutput(json, cwd)).toBe(json);
    expect(absolutizeHelpOutput('Usage: x' + NL, cwd)).toBe('Usage: x' + NL);
    expect(absolutizeHelpOutput('{ not json', cwd)).toBe('{ not json');
  });
});

describe('ai-insights-browser shim', () => {
  const shim = path.join(WORKSPACE_ROOT, 'scripts', 'ai-insights-browser.js');
  const exec = (args) => {
    const env = { ...process.env };
    delete env.PLAYWRIGHT_CLI_SESSION;
    return spawnSync(process.execPath, [shim, ...args], { encoding: 'utf8', env });
  };

  it('exits 1 with the session error when no session is named', () => {
    const r = exec(['snapshot']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no session named');
  });

  describe.skipIf(!isBrowserToolInstalled())('global help (needs the installed CLI)', () => {
    const help = (args) => spawnSync(process.execPath, [shim, ...args], {
      encoding: 'utf8',
      cwd: tmp,
      env: { ...process.env, CLAUDECODE: '1' },
    });

    it('prints the Agent skill path as an existing absolute path', () => {
      const r = help(['--help']);
      expect(r.status).toBe(0);
      const file = /^Agent skill: (.+?)\r?$/m.exec(r.stdout)?.[1];
      expect(file).toBeDefined();
      expect(path.isAbsolute(file)).toBe(true);
      expect(fs.existsSync(file)).toBe(true);
    });

    it('prints it absolute inside --json help as well', () => {
      const r = help(['--json', '--help']);
      expect(r.status).toBe(0);
      const file = /^Agent skill: (.+?)\r?$/m.exec(JSON.parse(r.stdout).help)?.[1];
      expect(path.isAbsolute(file)).toBe(true);
      expect(fs.existsSync(file)).toBe(true);
    });
  });

  it('exits 1 for attach without a name', () => {
    const r = exec(['attach', '--cdp=chrome']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no session named');
  });

  it('exits 1 with the teardown error for close-all without --force', () => {
    const r = exec(['close-all']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('"close-all" ends every browser session');
  });
});
