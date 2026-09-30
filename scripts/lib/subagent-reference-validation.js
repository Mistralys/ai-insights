/**
 * scripts/lib/subagent-reference-validation.js
 *
 * Validates sub-agent references in the *rendered* persona output, one output
 * target at a time. Source-level checks (the `{{agent_slug_*}}` cross-reference
 * in build-personas.js, the library's `subagents` slug check) prove that a
 * template variable resolves; they cannot prove that the rendered dispatch uses
 * the argument and the identifier the target platform actually matches.
 *
 * What each target matches when selecting a sub-agent:
 *   - vscode       `runSubagent` → `agentName` = the sub-agent's rendered VS Code
 *                  frontmatter `name` (display name with version).
 *   - claude-code  `Task`/`Agent` → `subagent_type` = the sub-agent's rendered
 *                  Claude Code frontmatter `name` (the `cc_file_name` stem).
 *   - deep-agents  `task` → `subagent_type` = the sub-agent's slug, which is the
 *                  name the orchestrator registers (`load_subagents()`); the
 *                  deep-agents frontmatter `name` is the persona `id` and is
 *                  NOT what the orchestrator matches.
 *
 * Checks, per persona and target:
 *   1. Declared but unreferenced — every slug in `subagents` appears in the
 *      rendered output as that target's identifier, quoted ("x"), in
 *      backticks (`x`) or bold (**x**).
 *   2. Wrong or undeclared selector — every literal selector value
 *      (`agentName` on vscode, `subagent_type` elsewhere) equals the identifier
 *      of a declared sub-agent for that target.
 *   3. Label-only dispatch — a Claude Code `Task` call whose agent sits in
 *      `description`, or a deep-agents call passing a `task` parameter the
 *      tool does not have.
 *
 * Runs against the library's in-memory render (`build({ ...config, check: true })`),
 * never the files on disk: generated output is gitignored, and `--check` does
 * not compare against disk, so on-disk files may be stale or absent.
 *
 * Per-persona `targets` (optional YAML list) limits the targets a persona is
 * built for. Excluded targets are skipped here and pruned from disk by
 * build-personas.js; dispatching an excluded persona on that target is an error.
 */

import fs from 'fs';
import path from 'path';
import { parseYamlScalars, extractYamlSequence } from './yaml-utils.js';

export const TARGETS = ['vscode', 'claude-code', 'deep-agents'];

/** Literal selector patterns per target. Group 1 is the selected identifier. */
const SELECTOR_RE = {
  vscode:        /`agentName`\s*:?\s*`?\s*"([^"]+)"/g,
  'claude-code': /`?subagent_type`?\s*:?\s*`?\s*"([^"]+)"/g,
  'deep-agents': /`?subagent_type`?\s*:?\s*`?\s*"([^"]+)"/g,
};

/** Label-only dispatch patterns per target. */
const LABEL_ONLY_RE = {
  'claude-code': [
    { re: /`(?:Task|Agent)` tool with `description:/g,
      why: 'names the agent in `description`, which Claude Code treats as a label — add `subagent_type`' },
  ],
  'deep-agents': [
    { re: /as `task`|^\s*- `task`:/gm,
      why: 'passes a `task` parameter the deep-agents `task` tool does not have — use `description`' },
  ],
};

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Read the frontmatter `name` of a rendered persona file, unquoted. */
export function readRenderedName(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^name:\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** 1-based line number of a string offset, for error messages. */
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Check one rendered persona file for one target.
 *
 * @param {object}   args
 * @param {string}   args.persona    - persona label for messages (e.g. "standalone/plan-refiner")
 * @param {string}   args.target     - one of TARGETS
 * @param {string}   args.text       - rendered file content
 * @param {string[]} args.subagents  - slugs declared in the persona's `subagents`
 * @param {Map<string, Record<string, string>>} args.index
 *                                   - slug → { vscode, 'claude-code', 'deep-agents' } identifiers
 * @returns {string[]} error strings (empty = valid)
 */
export function checkRenderedReferences({ persona, target, text, subagents, index }) {
  const errors = [];
  const where  = `${persona} [${target}]`;

  const expected = new Map(); // identifier → slug
  for (const slug of subagents) {
    const ids = index.get(slug);
    if (!ids) {
      errors.push(`${where}: declares sub-agent "${slug}", but no persona with that slug exists.`);
      continue;
    }
    if (ids[target] === undefined) {
      errors.push(`${where}: declares sub-agent "${slug}", which is not built for ${target} (see its \`targets\`).`);
      continue;
    }
    expected.set(ids[target], slug);
  }

  // 1. Declared but unreferenced.
  for (const [ident, slug] of expected) {
    const e  = escapeRe(ident);
    const re = new RegExp(`"${e}"|\`${e}\`|\\*\\*${e}\\*\\*`);
    if (!re.test(text)) {
      errors.push(
        `${where}: declares sub-agent "${slug}", but the rendered output never references it as ` +
        `"${ident}" — the identifier ${target} matches. Reference it in this target's dispatch, ` +
        `or remove it from \`subagents\`.`,
      );
    }
  }

  // 2. Wrong or undeclared selector values.
  for (const m of text.matchAll(SELECTOR_RE[target])) {
    const ident = m[1];
    if (expected.has(ident)) continue;
    const owner = [...index].find(([, ids]) => ids[target] === ident)?.[0];
    const hint  = owner
      ? `it is "${owner}"'s ${target} identifier, but "${owner}" is not in \`subagents\``
      : `no persona has that ${target} identifier`;
    errors.push(`${where}:${lineOf(text, m.index)}: selects sub-agent "${ident}" — ${hint}.`);
  }

  // 3. Label-only dispatch.
  for (const { re, why } of LABEL_ONLY_RE[target] ?? []) {
    for (const m of text.matchAll(re)) {
      errors.push(`${where}:${lineOf(text, m.index)}: dispatch ${why}.`);
    }
  }

  return errors;
}

/**
 * Resolve the targets a persona is built for from its YAML. Absent `targets`
 * means every target.
 *
 * @param {string} yamlText
 * @returns {{ targets: string[], errors: string[] }}
 */
export function resolvePersonaTargets(yamlText) {
  const declared = extractYamlSequence(yamlText, 'targets');
  if (!declared || declared.length === 0) return { targets: [...TARGETS], errors: [] };
  const unknown = declared.filter(t => !TARGETS.includes(t));
  return {
    targets: declared.filter(t => TARGETS.includes(t)),
    errors:  unknown.map(t => `unknown target "${t}" in \`targets\` (known: ${TARGETS.join(', ')})`),
  };
}

/**
 * Read persona metadata for every rendered result, keyed by YAML path.
 *
 * @param {Array<{suite: string, personaYamlPath: string}>} results
 */
export function collectPersonas(results) {
  const personas = new Map();
  for (const r of results) {
    if (personas.has(r.personaYamlPath)) continue;
    const yaml = fs.readFileSync(r.personaYamlPath, 'utf8');
    const base = path.basename(r.personaYamlPath, '.yaml');
    const { slug } = parseYamlScalars(yaml, ['slug']);
    const { targets, errors } = resolvePersonaTargets(yaml);
    personas.set(r.personaYamlPath, {
      label:     `${r.suite}/${base}`,
      slug:      slug ?? base,
      subagents: extractYamlSequence(yaml, 'subagents') ?? [],
      targets,
      errors,
    });
  }
  return personas;
}

/**
 * Validate sub-agent references in the rendered output of every persona.
 *
 * @param {Array<{suite: string, target: string, personaYamlPath: string, content: string}>} results
 *   The `results` array returned by the persona-builder library's `build()`.
 * @returns {string[]} error strings (empty = all valid)
 */
export function validateSubagentReferences(results) {
  const personas = collectPersonas(results);
  const errors   = [];
  for (const p of personas.values()) {
    for (const e of p.errors) errors.push(`${p.label}: ${e}.`);
  }

  // Identifier index: what each target matches for each persona, built only
  // for the targets the persona is actually built for.
  const index = new Map();
  for (const p of personas.values()) index.set(p.slug, {});
  for (const r of results) {
    const p = personas.get(r.personaYamlPath);
    if (!p.targets.includes(r.target)) continue;
    index.get(p.slug)[r.target] = r.target === 'deep-agents'
      ? p.slug
      : (readRenderedName(r.content) ?? p.slug);
  }

  for (const r of results) {
    const p = personas.get(r.personaYamlPath);
    if (!p.targets.includes(r.target)) continue;
    errors.push(...checkRenderedReferences({
      persona: p.label, target: r.target, text: r.content, subagents: p.subagents, index,
    }));
  }
  return errors;
}
