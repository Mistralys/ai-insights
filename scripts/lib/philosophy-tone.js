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
 * This is a lint, not a proof: it flags verb-initial titles and bodies for
 * human review. The authoritative test remains the guide's "You should" test.
 */

import fs from 'fs';
import path from 'path';

/**
 * Verbs that read as commands when they open a philosophy title or body.
 * Entries that double as nouns ("Focus", "Default", "Report") are disambiguated
 * by the copula check in `isDeclarative()`.
 */
const IMPERATIVE_VERBS = new Set([
  'aim', 'always', 'apply', 'assume', 'avoid', 'capture', 'check',
  'choose', 'confirm', 'consider', 'default', 'do', 'dont', "don't", 'ensure',
  'extract', 'favor', 'favour', 'focus', 'follow', 'keep', 'lean', 'limit',
  'maintain', 'make', 'maximize', 'maximise', 'minimize', 'minimise', 'never',
  'optimize', 'optimise', 'prefer', 'prioritise', 'prioritize', 'read',
  'record', 'reduce', 'remember', 'report', 'reserve', 'respect', 'seek',
  'separate', 'start', 'stick', 'stop', 'treat', 'trust', 'use', 'validate',
  'verify', 'write',
]);

/** Copulas and third-person verbs that mark the preceding token as a subject. */
const COPULAS = new Set([
  'is', 'are', 'was', 'were', "isn't", "aren't", 'beats', 'outranks',
  'carries', 'wins', 'comes', 'decides', 'means', 'matters', 'belongs',
  'produces', 'outperforms', 'has', 'have', 'remains', 'stays',
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
 * A verb-initial phrase is declarative when its first word is the subject of a
 * following copula — "State Is Measured" reads as a claim, "State the version"
 * as a command.
 */
function isDeclarative(words) {
  return words.length > 1 && COPULAS.has(words[1]);
}

function isImperative(text) {
  const words = tokens(text);
  if (words.length === 0) return false;
  if (!IMPERATIVE_VERBS.has(words[0])) return false;
  return !isDeclarative(words);
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
