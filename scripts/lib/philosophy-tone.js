/**
 * scripts/lib/philosophy-tone.js
 *
 * Heuristic detector for imperative phrasing in persona "Operating Philosophy"
 * sections. The Persona Design Guide (v3.0+) requires philosophy principles to
 * be stated in the indicative mood — claims about the domain, not instructions
 * addressed to the agent. Positively framed commands ("Prefer X over Y") pass
 * the older polarity rule while still violating the mood rule, which is the
 * drift this check exists to surface.
 *
 * This is a lint, not a proof: it flags candidates for human review. The
 * authoritative test remains the guide's "You should" test.
 */

import fs from 'fs';
import path from 'path';

/**
 * Verbs that read as commands when they open a philosophy title or body.
 * Deliberately broad — a missed verb is a silent false negative, whereas a
 * false positive costs one human glance at a warning.
 */
const IMPERATIVE_VERBS = new Set([
  'accept', 'acknowledge', 'adopt', 'aim', 'allow', 'always', 'anchor',
  'apply', 'ask', 'assess', 'assume', 'audit', 'avoid', 'balance', 'begin',
  'break', 'build', 'capture', 'challenge', 'check', 'choose', 'cite',
  'clarify', 'classify', 'collect', 'compare', 'complete', 'confirm',
  'consider', 'consult', 'convert', 'cover', 'create', 'decide', 'declare',
  'decompose', 'defer', 'define', 'delegate', 'deliver', 'describe', 'design',
  'detect', 'determine', 'distinguish', 'document', 'draft', 'drop', 'edit',
  'eliminate', 'embrace', 'enforce', 'ensure', 'escalate', 'establish',
  'evaluate', 'examine', 'exclude', 'execute', 'exhaust', 'expand', 'explain',
  'explore', 'express', 'extract', 'favor', 'favour', 'find', 'finish', 'fix',
  'flag', 'focus', 'follow', 'frame', 'gather', 'generate', 'ground', 'group',
  'guard', 'handle', 'hold', 'identify', 'ignore', 'implement', 'include',
  'inspect', 'interpret', 'investigate', 'judge', 'justify', 'keep', 'label',
  'lean', 'leave', 'limit', 'list', 'locate', 'log', 'maintain', 'make', 'map',
  'mark', 'match', 'maximise', 'maximize', 'measure', 'merge', 'minimise',
  'minimize', 'model', 'monitor', 'move', 'name', 'never', 'note', 'observe',
  'omit', 'optimise', 'optimize', 'order', 'organise', 'organize', 'pause',
  'perform', 'pick', 'place', 'plan', 'prefer', 'prepare', 'present',
  'preserve', 'prevent', 'prioritise', 'prioritize', 'probe', 'proceed',
  'produce', 'promote', 'propose', 'protect', 'prove', 'provide', 'quantify',
  'query', 'question', 'quote', 'raise', 'rank', 'read', 'reason', 'recognise',
  'recognize', 'recommend', 'reconcile', 'record', 'reduce', 'refine',
  'reflect', 'register', 'reject', 'relocate', 'rely', 'remember', 'remove',
  'rename', 'repair', 'repeat', 'replace', 'report', 'request', 'require',
  'research', 'reserve', 'resist', 'resolve', 'respect', 'restate', 'restore',
  'restrict', 'retain', 'reuse', 'reveal', 'review', 'revisit', 'rewrite',
  'run', 'save', 'scan', 'score', 'search', 'seek', 'select', 'separate',
  'set', 'settle', 'share', 'show', 'sift', 'simplify', 'sketch', 'solve',
  'sort', 'source', 'specify', 'split', 'start', 'state', 'stay', 'stick',
  'stop', 'store', 'structure', 'suggest', 'summarise', 'summarize', 'supply',
  'support', 'surface', 'survey', 'tag', 'take', 'target', 'teach', 'tell',
  'test', 'think', 'tighten', 'trace', 'track', 'transform', 'translate',
  'treat', 'trim', 'trust', 'try', 'uncover', 'understand', 'unify', 'update',
  'upgrade', 'use', 'validate', 'value', 'verify', 'view', 'weigh', 'widen',
  'work', 'wrap', 'write',
]);

/**
 * Verbs above that are at least as common as nouns at the head of a title.
 * "Value Over Volume" is a noun phrase; "Value the Manifest" is a command.
 * These count as imperative only when a determiner follows, which is what
 * separates a verb+object from a bare noun phrase.
 */
const AMBIGUOUS_HEADS = new Set([
  'design', 'focus', 'label', 'map', 'model', 'name', 'order', 'place', 'plan',
  'question', 'reason', 'record', 'report', 'research', 'run', 'set', 'sketch',
  'source', 'state', 'structure', 'support', 'surface', 'survey', 'target',
  'test', 'trust', 'use', 'value', 'view', 'work',
]);

/**
 * Separators forming a comparison idiom ("Show Over Describe", "Merge Before
 * Multiply", "Verify, Not Trust"). The guide permits comparisons as titles, so
 * a bare verb on each side is aphorism rather than instruction.
 */
const COMPARISON_SEPARATORS = new Set(['over', 'before', 'not', 'beats', 'than']);

/** Determiners that mark the following token as the object of a verb. */
const DETERMINERS = new Set([
  'a', 'all', 'an', 'any', 'each', 'every', 'her', 'his', 'its', 'my', 'no',
  'our', 'that', 'the', 'their', 'these', 'this', 'those', 'what', 'whatever',
  'your',
]);

/** Copulas and third-person verbs that mark the preceding tokens as a subject. */
const COPULAS = new Set([
  'are', "aren't", 'beats', 'belongs', 'buys', 'carries', 'comes', 'costs',
  'creates', 'decides', 'defines', 'delivers', 'depends', 'determines',
  'drives', 'earns', 'exists', 'fails', 'follows', 'gives', 'goes', 'happens',
  'has', 'have', 'holds', 'is', "isn't", 'leads', 'lies', 'makes', 'matters',
  'means', 'needs', 'outperforms', 'outranks', 'outweighs', 'pays', 'points',
  'precedes', 'produces', 'remains', 'requires', 'rests', 'says', 'serves',
  'shapes', 'signals', 'stands', 'stays', 'takes', 'tells', 'was', 'were',
  'wins', 'works', 'yields',
]);

/** Relative pronouns — a copula after one of these sits in a subordinate clause. */
const RELATIVE_PRONOUNS = new Set([
  'that', 'when', 'where', 'which', 'while', 'who', 'whom', 'whose',
]);

function tokens(text) {
  return text
    .replace(/[*_`]/g, '')
    .trim()
    .split(/\s+/)
    .map(t => t.replace(/^[^\w']+|[^\w']+$/g, '').toLowerCase())
    .filter(Boolean);
}

/**
 * A verb-initial phrase is declarative when the leading words form the subject
 * of a main-clause copula: "State Is Measured", "Design for Growth Is Cheap".
 * A copula behind a relative pronoun belongs to a subordinate clause and says
 * nothing about the phrase's own mood.
 */
function isDeclarative(words) {
  const limit = Math.min(words.length, 5);

  for (let i = 1; i < limit; i++) {
    if (RELATIVE_PRONOUNS.has(words[i])) return false;
    if (COPULAS.has(words[i])) return true;
  }

  return false;
}

/**
 * "Show Over Describe" is an aphorism; "Show the Reader Everything" is a
 * command. A comparison separator immediately after the head verb, with no
 * intervening object, marks the former.
 */
function isComparisonIdiom(words) {
  return words.length > 1 && COMPARISON_SEPARATORS.has(words[1]);
}

function isImperative(text) {
  const words = tokens(text);
  if (words.length === 0) return false;
  if (!IMPERATIVE_VERBS.has(words[0])) return false;
  if (isDeclarative(words)) return false;
  if (isComparisonIdiom(words)) return false;

  // A bare noun phrase ("Value Over Volume") needs a determiner to read as a
  // command; an unambiguous verb ("Prefer X") does not.
  if (AMBIGUOUS_HEADS.has(words[0])) {
    return words.length > 1 && DETERMINERS.has(words[1]);
  }

  return true;
}

/**
 * Extract the `- **Title:** body` bullets of a persona's Operating Philosophy
 * section. Returns [] when the persona has no such section.
 * @param {string} markdown - persona content file text
 * @returns {Array<{title: string, body: string, line: number}>}
 */
export function extractPhilosophyPrinciples(markdown) {
  const lines = markdown.split(/\r?\n/);
  const principles = [];
  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^(#{2,6})\s+(.*)$/);

    if (heading) {
      // Sub-headings inside the section (e.g. "### Protocol") do not end it;
      // any heading at the section's own level or above does.
      const isPhilosophy = /^Operating Philosophy\b/i.test(heading[2].trim());
      if (isPhilosophy) {
        inSection = true;
      } else if (inSection && heading[1].length <= 2) {
        inSection = false;
      }
      continue;
    }

    if (!inSection) continue;

    const bullet = line.match(/^\s*[-*]\s+\*\*(.+?):?\*\*:?\s*(.*)$/);
    if (bullet) {
      principles.push({ title: bullet[1].trim(), body: bullet[2].trim(), line: i + 1 });
    }
  }

  return principles;
}

/**
 * Check one persona's philosophy section for imperative phrasing.
 * @param {string} markdown - persona content file text
 * @param {string} filename - filename for message context
 * @returns {string[]} warning strings (empty = no drift detected)
 */
export function checkPhilosophyTone(markdown, filename) {
  const warnings = [];

  for (const { title, body, line } of extractPhilosophyPrinciples(markdown)) {
    if (isImperative(title)) {
      warnings.push(
        `${filename}:${line}: philosophy title "${title}" is verb-initial. ` +
        `Titles are noun phrases, comparisons, or statements — never commands.`,
      );
    }

    const firstSentence = body.split(/(?<=[.!?])\s/)[0] || '';
    if (isImperative(firstSentence)) {
      warnings.push(
        `${filename}:${line}: philosophy body under "${title}" opens in the ` +
        `imperative ("${tokens(firstSentence)[0]}…"). State the principle as a ` +
        `claim about the domain, not an instruction to the agent.`,
      );
    }
  }

  return warnings;
}

/**
 * Check every persona content file in the given suite content directories.
 * @param {string[]} contentDirs - absolute paths to suite content directories
 * @returns {string[]} warning strings (empty = no drift detected)
 */
export function checkPhilosophyToneInDirs(contentDirs) {
  const warnings = [];

  for (const contentDir of contentDirs) {
    if (!fs.existsSync(contentDir)) continue;

    const files = fs.readdirSync(contentDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const text = fs.readFileSync(path.join(contentDir, file), 'utf8');
      warnings.push(...checkPhilosophyTone(text, file));
    }
  }

  return warnings;
}
