'use strict';

/**
 * personas/plugins/ledger/frontmatter-templates.js
 *
 * Ledger-suite frontmatter template strings, ported from
 * src/plugins/ledger/frontmatter-templates.ts in persona-builder.
 *
 * Two templates are defined — one for each supported output target:
 *   - FRONTMATTER_LEDGER_VSCODE   → VS Code instruction files
 *   - FRONTMATTER_LEDGER_CC       → Claude Code instruction files
 *
 * Template variables ({{varName}}) and conditionals ({{#if flag}}...{{/if}})
 * are resolved by the library's template engine at build time.
 */

// ---------------------------------------------------------------------------
// Shared CC fields helper (inlined constant)
// ---------------------------------------------------------------------------

/**
 * Shared Claude Code frontmatter fields used by the ledger CC template.
 *
 * Mirrors the return value of ccFrontmatterFields() from build-personas.js.
 */
const CC_FRONTMATTER_FIELDS =
  `permissionMode: {{cc_permission_mode}}
model: '{{cc_model}}'
memory: {{cc_memory}}`;

// ---------------------------------------------------------------------------
// Ledger frontmatter templates
// ---------------------------------------------------------------------------

/**
 * VS Code frontmatter template for the ledger persona suite.
 *
 * Used when target === 'vscode' and suite === 'ledger'.
 */
const FRONTMATTER_LEDGER_VSCODE = `---
id: {{id}}
name: '{{number}} - {{role}} v{{version}}'
description: 'Step {{number}}/{{total}} in the agent workflow.'
model: '{{model}}'
role: {{role}}
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
vs_file_name: {{vs_file_name}}
tools: {{tools_json}}
---`;

/**
 * Claude Code frontmatter template for the ledger persona suite.
 *
 * The mcpServers block is conditionally included — it appears only when
 * the has_mcp context variable is truthy.
 *
 * Used when target === 'claude-code' and suite === 'ledger'.
 */
const FRONTMATTER_LEDGER_CC = `---
name: {{cc_name}}
description: '{{cc_description}}'
role: {{role}}
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
tools: {{cc_tools_json}}
${CC_FRONTMATTER_FIELDS}
{{#if has_mcp}}
mcpServers:
  - {{mcp_server_name}}
{{/if}}
---`;

module.exports = { FRONTMATTER_LEDGER_VSCODE, FRONTMATTER_LEDGER_CC };
