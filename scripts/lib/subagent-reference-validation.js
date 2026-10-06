/**
 * scripts/lib/subagent-reference-validation.js
 *
 * Validates sub-agent references in the *rendered* persona output, one output
 * target at a time. Source-level checks (the `{{agent_slug_*}}` cross-reference
 * in build-personas.js, the library's `subagents` slug check, and the
 * library's target-aware sub-agent validator — see `@mistralys/persona-builder`
 * `validateSubagentRefs()`) prove that a template variable resolves and that a
 * declared sub-agent is built for the target that dispatches it; they cannot
 * prove that the rendered dispatch uses the argument and the identifier the
 * target platform actually matches. That is this file's job, and only this
 * file's job — per-persona `targets` resolution and the "declared sub-agent
 * not built for this target" error are the library's responsibility now (see
 * `PersonaMetadata.targets` / `resolvePersonaTargets()` in the library).
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
 * Each persona's built targets are derived from which `target` values its
 * `build()` results actually carry — the library already skips rendering a
 * persona for a target its `targets` YAML field excludes (see
 * `BuildSummary.skipped`), so an excluded target simply produces no result
 * here and needs no separate resolution or pruning step.
 */

import fs from 'fs';
import path from 'path';
import { parseYamlScalars, extractYamlSequence } from './yaml-utils.js';

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
 * @param {string}   args.target     - one of 'vscode', 'claude-code', 'deep-agents'
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
      // Declared sub-agent isn't built for this target — the library's own
      // target-aware validateSubagentRefs() owns this case now; skip it here
      // rather than duplicate the error.
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
 * Read persona metadata for every rendered result, keyed by YAML path.
 *
 * Each persona's `targets` is derived from which `target` values its own
 * results actually carry — the library has already skipped rendering it for
 * any target its `targets` YAML field excludes, so the set of `r.target`
 * values seen here is, by construction, exactly the targets it was built for.
 *
 * @param {Array<{suite: string, target: string, personaYamlPath: string}>} results
 */
export function collectPersonas(results) {
  const personas = new Map();
  for (const r of results) {
    if (personas.has(r.personaYamlPath)) continue;
    const yaml = fs.readFileSync(r.personaYamlPath, 'utf8');
    const base = path.basename(r.personaYamlPath, '.yaml');
    const { slug } = parseYamlScalars(yaml, ['slug']);
    personas.set(r.personaYamlPath, {
      label:     `${r.suite}/${base}`,
      slug:      slug ?? base,
      subagents: extractYamlSequence(yaml, 'subagents') ?? [],
      targets:   [],
    });
  }

  for (const r of results) {
    const p = personas.get(r.personaYamlPath);
    if (!p.targets.includes(r.target)) p.targets.push(r.target);
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

  // Identifier index: what each target matches for each persona. `results`
  // already contains exactly the personas × targets the library built (see
  // collectPersonas() above), so no further target filtering is needed here.
  const index = new Map();
  for (const p of personas.values()) index.set(p.slug, {});
  for (const r of results) {
    const p = personas.get(r.personaYamlPath);
    index.get(p.slug)[r.target] = r.target === 'deep-agents'
      ? p.slug
      : (readRenderedName(r.content) ?? p.slug);
  }

  for (const r of results) {
    const p = personas.get(r.personaYamlPath);
    errors.push(...checkRenderedReferences({
      persona: p.label, target: r.target, text: r.content, subagents: p.subagents, index,
    }));
  }
  return errors;
}
