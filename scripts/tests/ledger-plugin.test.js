/**
 * scripts/tests/ledger-plugin.test.js
 *
 * Unit tests for the ledger plugin modules:
 *   - renderRoster()          (personas/plugins/ledger/roster-renderer.js)
 *   - renderMcpToolsTable()   (personas/plugins/ledger/mcp-tools-renderer.js)
 *   - validateRole()          (personas/plugins/ledger/role-validator.js)
 *   - validateNoteOnlyGuard() (personas/plugins/ledger/role-validator.js)
 *   - ledgerPlugin()          (personas/plugins/ledger/index.js) — hook composition
 *
 * Ported from tests/plugins/ledger.test.ts in persona-builder.
 *
 * Acceptance Criteria verified:
 *   AC-2: renderRoster() — multi-persona roster, single-persona roster, active-persona highlighting
 *   AC-3: renderMcpToolsTable() — note_only excluded, non-note_only included
 *   AC-4: Role validator — valid role, invalid role with warnOnUnknownRole:false (error),
 *         invalid role with warnOnUnknownRole:true (warning), undefined role (skip)
 *   AC-5: Plugin hook composition — roster_rendered and mcp_tools_table in context after onBuildContext
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { renderRoster }                       = require('../../personas/plugins/ledger/roster-renderer.js');
const { renderMcpToolsTable }                = require('../../personas/plugins/ledger/mcp-tools-renderer.js');
const { validateRole, validateNoteOnlyGuard } = require('../../personas/plugins/ledger/role-validator.js');
const { ledgerPlugin }                       = require('../../personas/plugins/ledger/index.js');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Minimal SuiteConfig-equivalent for testing purposes (numbered = ledger) */
const suite = {
  srcDir: '/fixtures/ledger-suite',
  outVscode: '/out/vscode',
  outClaudeCode: '/out/claude-code',
  personaMode: 'numbered',
};

/** Canonical three-entry roster used across multiple roster tests */
const threeEntryRoster = [
  { number: 1, title: 'Planner',   short: 'plans the work' },
  { number: 2, title: 'Developer', short: 'writes code'    },
  { number: 3, title: 'QA',        short: 'verifies quality' },
];

// ---------------------------------------------------------------------------
// renderRoster()
// ---------------------------------------------------------------------------

describe('renderRoster()', () => {
  // AC-2: normal multi-persona roster
  it('renders a multi-persona roster as a numbered Markdown list', () => {
    const result = renderRoster(threeEntryRoster, 2);
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('1. **Planner** (plans the work)');
    expect(lines[1]).toBe('2. **Developer (YOU)** (writes code)');
    expect(lines[2]).toBe('3. **QA** (verifies quality)');
  });

  // AC-2: active persona highlighted correctly — first entry
  it('appends "(YOU)" to the active persona when it is the first entry', () => {
    const result = renderRoster(threeEntryRoster, 1);
    expect(result).toContain('**Planner (YOU)**');
    expect(result).not.toContain('**Developer (YOU)**');
    expect(result).not.toContain('**QA (YOU)**');
  });

  // AC-2: active persona highlighted correctly — last entry
  it('appends "(YOU)" to the active persona when it is the last entry', () => {
    const result = renderRoster(threeEntryRoster, 3);
    expect(result).toContain('**QA (YOU)**');
    expect(result).not.toContain('**Planner (YOU)**');
    expect(result).not.toContain('**Developer (YOU)**');
  });

  // AC-2: single-persona roster
  it('renders a single-persona roster correctly', () => {
    const single = [
      { number: 1, title: 'Solo Agent', short: 'does everything' },
    ];
    const result = renderRoster(single, 1);
    expect(result).toBe('1. **Solo Agent (YOU)** (does everything)');
  });

  // Edge case: single-persona roster where active number does not match
  it('does not append "(YOU)" when activeNumber does not match any entry', () => {
    const single = [
      { number: 1, title: 'Solo Agent', short: 'does everything' },
    ];
    const result = renderRoster(single, 99);
    expect(result).toBe('1. **Solo Agent** (does everything)');
  });

  // Edge case: empty roster
  it('returns an empty string for an empty roster array', () => {
    const result = renderRoster([], 1);
    expect(result).toBe('');
  });

  // Structural check: no trailing newline
  it('does not produce a trailing newline', () => {
    const result = renderRoster(threeEntryRoster, 1);
    expect(result.endsWith('\n')).toBe(false);
  });

  // Structural check: uses the entry's own number field (non-sequential numbers)
  it('uses the entry number field verbatim — preserves non-sequential numbers', () => {
    const roster = [
      { number: 10, title: 'Alpha', short: 'alpha role' },
      { number: 20, title: 'Beta',  short: 'beta role'  },
    ];
    const result = renderRoster(roster, 10);
    const lines = result.split('\n');
    expect(lines[0]).toBe('10. **Alpha (YOU)** (alpha role)');
    expect(lines[1]).toBe('20. **Beta** (beta role)');
  });
});

// ---------------------------------------------------------------------------
// renderMcpToolsTable()
// ---------------------------------------------------------------------------

describe('renderMcpToolsTable()', () => {
  // AC-3: non-note_only entries are included
  it('renders non-note_only entries as Markdown table rows', () => {
    const tools = [
      { tool: 'ledger_get_status', purpose: 'Read project status'  },
      { tool: 'ledger_claim_wp',   purpose: 'Claim a work package' },
    ];
    const result = renderMcpToolsTable(tools);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('| `ledger_get_status` | Read project status |');
    expect(lines[1]).toBe('| `ledger_claim_wp` | Claim a work package |');
  });

  // AC-3: note_only entries are excluded
  it('excludes entries with note_only: true', () => {
    const tools = [
      { tool: 'public_tool',   purpose: 'A public tool'       },
      { tool: 'internal_tool', purpose: 'Internal use only', note_only: true },
    ];
    const result = renderMcpToolsTable(tools);
    expect(result).toContain('public_tool');
    expect(result).not.toContain('internal_tool');
  });

  // AC-3: all entries are note_only → empty output
  it('returns an empty string when all entries are note_only', () => {
    const tools = [
      { tool: 'internal_a', purpose: 'Internal A', note_only: true },
      { tool: 'internal_b', purpose: 'Internal B', note_only: true },
    ];
    const result = renderMcpToolsTable(tools);
    expect(result).toBe('');
  });

  // Edge case: mixed — multiple note_only and multiple regular entries
  it('filters out all note_only entries and renders only the visible ones', () => {
    const tools = [
      { tool: 'tool_a', purpose: 'Purpose A' },
      { tool: 'note_1', purpose: 'Note 1',   note_only: true },
      { tool: 'tool_b', purpose: 'Purpose B' },
      { tool: 'note_2', purpose: 'Note 2',   note_only: true },
    ];
    const result = renderMcpToolsTable(tools);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('| `tool_a` | Purpose A |');
    expect(lines[1]).toBe('| `tool_b` | Purpose B |');
  });

  // Edge case: empty array
  it('returns an empty string for an empty tools array', () => {
    const result = renderMcpToolsTable([]);
    expect(result).toBe('');
  });

  // Edge case: note_only: false is treated as non-note-only (included)
  it('includes entries with note_only: false', () => {
    const tools = [
      { tool: 'explicit_false', purpose: 'Explicitly not note-only', note_only: false },
    ];
    const result = renderMcpToolsTable(tools);
    expect(result).toBe('| `explicit_false` | Explicitly not note-only |');
  });

  // Structural check: no trailing newline
  it('does not produce a trailing newline', () => {
    const tools = [
      { tool: 'my_tool', purpose: 'My purpose' },
    ];
    const result = renderMcpToolsTable(tools);
    expect(result.endsWith('\n')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRole()
// ---------------------------------------------------------------------------

describe('validateRole()', () => {
  const knownRoles = ['Planner', 'Developer', 'QA', 'Reviewer'];

  // AC-4: valid role returns no results
  it('returns an empty array for a role that is in the manifest', () => {
    const result = validateRole('Developer', knownRoles);
    expect(result).toEqual([]);
  });

  // AC-4: valid role — works with a Set
  it('accepts a ReadonlySet as manifestRoles and validates correctly', () => {
    const roleSet = new Set(knownRoles);
    const result = validateRole('QA', roleSet);
    expect(result).toEqual([]);
  });

  // AC-4: invalid role emits a warning-level ValidationResult
  it('returns a warning-level result for an unknown role', () => {
    const result = validateRole('Coder', knownRoles);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warning');
    expect(result[0].message).toContain('"Coder"');
    expect(result[0].message).toContain('workflow manifest');
  });

  // AC-4: invalid role message includes known roles list
  it('includes the known roles in the warning message', () => {
    const result = validateRole('Hacker', knownRoles);
    expect(result[0].message).toContain('Planner');
    expect(result[0].message).toContain('Developer');
    expect(result[0].message).toContain('QA');
    expect(result[0].message).toContain('Reviewer');
  });

  // AC-4: undefined role (non-ledger persona) is silently skipped
  it('returns an empty array when role is undefined', () => {
    const result = validateRole(undefined, knownRoles);
    expect(result).toEqual([]);
  });

  // Edge case: empty manifestRoles — any role is flagged as unknown
  it('flags any role as unknown when manifestRoles is empty', () => {
    const result = validateRole('Developer', []);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warning');
  });

  // Edge case: empty string role is treated as unknown (not same as undefined)
  it('treats an empty string role as an unknown role', () => {
    const result = validateRole('', knownRoles);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// validateNoteOnlyGuard()
// ---------------------------------------------------------------------------

describe('validateNoteOnlyGuard()', () => {
  const noteOnlyTool = {
    tool: 'internal_tool',
    purpose: 'Internal use only',
    note_only: true,
  };
  const publicTool = {
    tool: 'public_tool',
    purpose: 'A public tool',
  };

  // No violation when note_only tool is absent from output
  it('returns an empty array when no note_only tools appear in the output', () => {
    const output = '| `public_tool` | A public tool |';
    const result = validateNoteOnlyGuard(output, [noteOnlyTool, publicTool]);
    expect(result).toEqual([]);
  });

  // Violation when note_only tool appears in output
  it('returns an error-level result when a note_only tool appears in the rendered output', () => {
    const output = '| `internal_tool` | Internal use only |';
    const result = validateNoteOnlyGuard(output, [noteOnlyTool]);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('error');
    expect(result[0].message).toContain('"internal_tool"');
  });

  // Multiple violations — one per leaking tool
  it('returns one error per leaking note_only tool', () => {
    const tools = [
      { tool: 'tool_a', purpose: 'A', note_only: true },
      { tool: 'tool_b', purpose: 'B', note_only: true },
    ];
    const output = '| `tool_a` | A |\n| `tool_b` | B |';
    const result = validateNoteOnlyGuard(output, tools);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.severity === 'error')).toBe(true);
  });

  // No violation when mcpTools is undefined
  it('returns an empty array when mcpTools is undefined', () => {
    const result = validateNoteOnlyGuard('| `tool` | something |', undefined);
    expect(result).toEqual([]);
  });

  // No violation when mcpTools is empty
  it('returns an empty array when mcpTools is empty', () => {
    const result = validateNoteOnlyGuard('| `tool` | something |', []);
    expect(result).toEqual([]);
  });

  // Non-note_only tools in output are not flagged
  it('does not flag tools without note_only: true even if they appear in output', () => {
    const result = validateNoteOnlyGuard('| `public_tool` | A public tool |', [publicTool]);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ledgerPlugin() — hook composition (AC-5)
// ---------------------------------------------------------------------------

describe('ledgerPlugin()', () => {
  // Plugin is constructible with defaults
  it('returns a plugin with name "ledger"', () => {
    const plugin = ledgerPlugin();
    expect(plugin.name).toBe('ledger');
  });

  // AC-5: onBuildContext injects roster_rendered
  it('onBuildContext injects roster_rendered into the context when persona has roster and number', () => {
    const plugin = ledgerPlugin();
    const persona = { name: 'developer' };
    // In real builds, roster (from shared YAML) and number (from per-persona YAML)
    // are both merged into the context by the library before onBuildContext runs.
    const context = { roster: threeEntryRoster, number: 2 };
    const ctx = plugin.onBuildContext(context, persona, suite);
    expect(ctx).toHaveProperty('roster_rendered');
    expect(typeof ctx['roster_rendered']).toBe('string');
    // Active persona is number 2 (Developer)
    expect(ctx['roster_rendered']).toContain('**Developer (YOU)**');
    expect(ctx['roster_rendered']).toContain('**Planner**');
    expect(ctx['roster_rendered']).toContain('**QA**');
  });

  // AC-5: onBuildContext injects mcp_tools_table
  it('onBuildContext injects mcp_tools_table into the context when persona has mcp_tools', () => {
    const plugin = ledgerPlugin();
    const tools = [
      { tool: 'ledger_get_status', purpose: 'Read status'  },
      { tool: 'hidden_tool',       purpose: 'Internal', note_only: true },
    ];
    const persona = {
      name: 'developer',
      mcp_tools: tools,
    };
    const ctx = plugin.onBuildContext({}, persona, suite);
    expect(ctx).toHaveProperty('mcp_tools_table');
    expect(typeof ctx['mcp_tools_table']).toBe('string');
    expect(ctx['mcp_tools_table']).toContain('ledger_get_status');
    expect(ctx['mcp_tools_table']).not.toContain('hidden_tool');
  });

  // AC-5: both roster_rendered and mcp_tools_table appear in context
  it('onBuildContext injects both roster_rendered and mcp_tools_table in a single call', () => {
    const plugin = ledgerPlugin();
    const tools = [{ tool: 'some_tool', purpose: 'Does something' }];
    const persona = { name: 'planner', mcp_tools: tools };
    const context = { roster: threeEntryRoster, number: 1 };
    const ctx = plugin.onBuildContext(context, persona, suite);
    expect(ctx).toHaveProperty('roster_rendered');
    expect(ctx).toHaveProperty('mcp_tools_table');
    // Both must be non-empty for this persona
    expect(ctx['roster_rendered']).not.toBe('');
    expect(ctx['mcp_tools_table']).not.toBe('');
  });

  // Fallback: persona without roster → roster_rendered is empty string
  it('sets roster_rendered to an empty string when persona has no roster', () => {
    const plugin = ledgerPlugin();
    const persona = { name: 'standalone' };
    const ctx = plugin.onBuildContext({}, persona, suite);
    expect(ctx['roster_rendered']).toBe('');
  });

  // Fallback: persona without mcp_tools → mcp_tools_table is empty string
  it('sets mcp_tools_table to an empty string when persona has no mcp_tools', () => {
    const plugin = ledgerPlugin();
    const persona = { name: 'standalone' };
    const ctx = plugin.onBuildContext({}, persona, suite);
    expect(ctx['mcp_tools_table']).toBe('');
  });

  // Fallback: context has roster but no number → roster_rendered is empty string
  it('sets roster_rendered to an empty string when context has roster but no number', () => {
    const plugin = ledgerPlugin();
    const persona = { name: 'no-number' };
    const context = { roster: threeEntryRoster /* number intentionally absent */ };
    const ctx = plugin.onBuildContext(context, persona, suite);
    expect(ctx['roster_rendered']).toBe('');
  });

  // onBuildContext preserves existing context keys
  it('onBuildContext preserves keys that were already in the context', () => {
    const plugin = ledgerPlugin();
    const persona = { name: 'test' };
    const existing = { pre_existing_key: 'value123' };
    const ctx = plugin.onBuildContext(existing, persona, suite);
    expect(ctx['pre_existing_key']).toBe('value123');
  });

  // onValidate: valid role returns empty array
  it('onValidate returns no results for a valid role', () => {
    const plugin = ledgerPlugin({ manifestRoles: ['Developer', 'QA'] });
    // First populate the rendered output cache via onPostRender
    const persona = { name: 'dev', role: 'Developer' };
    plugin.onPostRender('some output', persona, 'vscode');
    const results = plugin.onValidate(persona, suite, 'vscode');
    expect(results).toEqual([]);
  });

  // onValidate: invalid role returns a warning
  it('onValidate returns a warning for a role not in manifestRoles', () => {
    const plugin = ledgerPlugin({ manifestRoles: ['Developer', 'QA'] });
    const persona = { name: 'dev', role: 'Coder' };
    plugin.onPostRender('some output', persona, 'vscode');
    const results = plugin.onValidate(persona, suite, 'vscode');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const roleResult = results.find((r) => r.message.includes('"Coder"'));
    expect(roleResult).toBeDefined();
    expect(roleResult.severity).toBe('warning');
  });

  // AC-4: invalid role with warnOnUnknownRole: false → severity:'error'
  it('onValidate returns error severity for unknown role when warnOnUnknownRole is false', () => {
    const plugin = ledgerPlugin({ manifestRoles: ['Developer', 'QA'], warnOnUnknownRole: false });
    const persona = { name: 'dev', role: 'Coder' };
    plugin.onPostRender('some output', persona, 'vscode');
    const results = plugin.onValidate(persona, suite, 'vscode');
    const roleResult = results.find((r) => r.message.includes('"Coder"'));
    expect(roleResult).toBeDefined();
    expect(roleResult.severity).toBe('error');
  });

  // AC-4: invalid role with warnOnUnknownRole: true → severity:'warning'
  it('onValidate returns warning severity for unknown role when warnOnUnknownRole is true', () => {
    const plugin = ledgerPlugin({ manifestRoles: ['Developer', 'QA'], warnOnUnknownRole: true });
    const persona = { name: 'dev', role: 'Coder' };
    plugin.onPostRender('some output', persona, 'vscode');
    const results = plugin.onValidate(persona, suite, 'vscode');
    const roleResult = results.find((r) => r.message.includes('"Coder"'));
    expect(roleResult).toBeDefined();
    expect(roleResult.severity).toBe('warning');
  });

  // AC-4: valid role with warnOnUnknownRole: false → no results (role IS in manifest)
  it('onValidate returns no results for a valid role even when warnOnUnknownRole is false', () => {
    const plugin = ledgerPlugin({ manifestRoles: ['Developer', 'QA'], warnOnUnknownRole: false });
    const persona = { name: 'dev', role: 'Developer' };
    plugin.onPostRender('some output', persona, 'vscode');
    const results = plugin.onValidate(persona, suite, 'vscode');
    expect(results).toEqual([]);
  });

  // onValidate: no role → no validation results (non-ledger persona)
  it('onValidate skips role validation when persona has no role field', () => {
    const plugin = ledgerPlugin({ manifestRoles: ['Developer', 'QA'] });
    const persona = { name: 'standalone' };
    plugin.onPostRender('some output', persona, 'vscode');
    const results = plugin.onValidate(persona, suite, 'vscode');
    expect(results).toEqual([]);
  });

  // onValidate: note_only guard catches leaking tools in rendered output
  it('onValidate flags note_only tools that appear in rendered output', () => {
    const plugin = ledgerPlugin();
    const tools = [
      { tool: 'internal_tool', purpose: 'Internal', note_only: true },
    ];
    const persona = { name: 'dev', mcp_tools: tools };
    // Simulate a render that accidentally includes the note_only tool
    const leakyOutput = '| `internal_tool` | Internal |';
    plugin.onPostRender(leakyOutput, persona, 'vscode');
    const results = plugin.onValidate(persona, suite, 'vscode');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const guardResult = results.find((r) => r.message.includes('"internal_tool"'));
    expect(guardResult).toBeDefined();
    expect(guardResult.severity).toBe('error');
  });

  // Composite key: per-target cache isolation
  it('onValidate uses per-target cache — vscode and claude-code outputs are validated independently', () => {
    const plugin = ledgerPlugin();
    const tools = [
      { tool: 'internal_tool', purpose: 'Internal', note_only: true },
    ];
    const persona = { name: 'dev', mcp_tools: tools };
    // vscode render leaks the note_only tool; claude-code render is clean
    plugin.onPostRender('| `internal_tool` | Internal |', persona, 'vscode');
    plugin.onPostRender('clean output', persona, 'claude-code');
    // Validating the vscode target should flag the leak
    const vsResults = plugin.onValidate(persona, suite, 'vscode');
    expect(vsResults.some((r) => r.message.includes('"internal_tool"'))).toBe(true);
    // Validating the claude-code target should find no violations
    const ccResults = plugin.onValidate(persona, suite, 'claude-code');
    expect(ccResults.every((r) => !r.message.includes('"internal_tool"'))).toBe(true);
  });

  // Composite key fallback: onValidate without target uses 'unknown' fallback
  it('onValidate uses unknown fallback when no target is provided', () => {
    const plugin = ledgerPlugin();
    const tools = [
      { tool: 'internal_tool', purpose: 'Internal', note_only: true },
    ];
    const persona = { name: 'dev', mcp_tools: tools };
    // When target is absent the note_only guard should not fire (cache miss → empty string)
    const results = plugin.onValidate(persona, suite);
    expect(results.every((r) => !r.message.includes('"internal_tool"'))).toBe(true);
  });

  // onPostRender: returns the output string unchanged
  it('onPostRender returns the output string unchanged', () => {
    const plugin = ledgerPlugin();
    const persona = { name: 'dev' };
    const output = 'rendered content here';
    const returned = plugin.onPostRender(output, persona, 'vscode');
    expect(returned).toBe(output);
  });

  // frontmatterTemplates: vscode and claude-code keys are present after onSuiteInit (numbered)
  it('exposes frontmatterTemplates for both vscode and claude-code targets after onSuiteInit', () => {
    const plugin = ledgerPlugin();
    plugin.onSuiteInit(suite, {});
    expect(plugin.frontmatterTemplates).toBeDefined();
    expect(typeof plugin.frontmatterTemplates['vscode']).toBe('string');
    expect(typeof plugin.frontmatterTemplates['claude-code']).toBe('string');
  });

  // frontmatterTemplates: vscode template starts with frontmatter fence
  it('vscode frontmatter template begins with --- and contains expected fields', () => {
    const plugin = ledgerPlugin();
    plugin.onSuiteInit(suite, {});
    const vsTemplate = plugin.frontmatterTemplates['vscode'];
    expect(vsTemplate.startsWith('---')).toBe(true);
    expect(vsTemplate).toContain('{{id}}');
    expect(vsTemplate).toContain('{{role}}');
    expect(vsTemplate).toContain('{{version}}');
    expect(vsTemplate).toContain('{{#if last_updated}}');
  });

  // frontmatterTemplates: claude-code template starts with frontmatter fence
  it('claude-code frontmatter template begins with --- and contains expected fields', () => {
    const plugin = ledgerPlugin();
    plugin.onSuiteInit(suite, {});
    const ccTemplate = plugin.frontmatterTemplates['claude-code'];
    expect(ccTemplate.startsWith('---')).toBe(true);
    expect(ccTemplate).toContain('{{role}}');
    expect(ccTemplate).toContain('{{version}}');
    expect(ccTemplate).toContain('{{#if has_mcp}}');
    expect(ccTemplate).toContain('{{#if last_updated}}');
  });

  // Plugin satisfies PersonaBuildPlugin interface: has required hooks
  it('returned plugin has onBuildContext, onPostRender, onValidate, and onSuiteInit', () => {
    const plugin = ledgerPlugin();
    expect(typeof plugin.onBuildContext).toBe('function');
    expect(typeof plugin.onPostRender).toBe('function');
    expect(typeof plugin.onValidate).toBe('function');
    expect(typeof plugin.onSuiteInit).toBe('function');
  });

  // onSuiteInit: frontmatterTemplates removed for non-numbered suites
  it('removes frontmatterTemplates when suite is not numbered', () => {
    const plugin = ledgerPlugin();
    const standaloneSuite = { ...suite, personaMode: 'standalone' };
    plugin.onSuiteInit(suite, {});
    expect(plugin.frontmatterTemplates).toBeDefined();
    plugin.onSuiteInit(standaloneSuite, {});
    expect(plugin.frontmatterTemplates).toBeUndefined();
  });
});
